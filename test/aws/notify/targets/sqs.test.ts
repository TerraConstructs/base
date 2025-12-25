import {
  cloudwatchEventTarget,
  dataAwsIamPolicyDocument,
  dataAwsServicePrincipal,
  cloudwatchEventRule,
  sqsQueuePolicy,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import { Key } from "../../../../src/aws/encryption";
import { Queue } from "../../../../src/aws/notify/queue";
import { Rule } from "../../../../src/aws/notify/rule";
import { Schedule } from "../../../../src/aws/notify/schedule";
import { SqsQueue } from "../../../../src/aws/notify/targets/sqs";
import { Duration } from "../../../../src/duration";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

test("sqs queue as an event rule target", () => {
  // GIVEN
  const stack = getAwsStack();
  const queue = new Queue(stack, "MyQueue");
  const rule = new Rule(stack, "MyRule", {
    schedule: Schedule.rate(Duration.hours(1)),
  });

  // WHEN
  rule.addTarget(new SqsQueue(queue));

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  // ensure aws_svcp_default_region_events is created
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsServicePrincipal.DataAwsServicePrincipal,
    {
      service_name: "events",
    },
  );
  // ensure policy queue policy is created
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: [
            "sqs:SendMessage",
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl",
          ],
          condition: [
            {
              test: "ArnEquals",
              values: ["${aws_cloudwatch_event_rule.MyRule_A44AB831.arn}"],
              variable: "aws:SourceArn",
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_events.name}",
              ],
              type: "Service",
            },
          ],
          resources: ["${aws_sqs_queue.MyQueue_E6CA6235.arn}"],
        },
      ],
    },
  );
  // ensure event bridge rule and target are created
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventRule.CloudwatchEventRule,
    {
      schedule_expression: "rate(1 hour)",
      state: "ENABLED",
    },
  );
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      arn: "${aws_sqs_queue.MyQueue_E6CA6235.arn}",
    },
  );
  // ensure policy queue policy is created
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: [
            "sqs:SendMessage",
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl",
          ],
          condition: [
            {
              test: "ArnEquals",
              values: ["${aws_cloudwatch_event_rule.MyRule_A44AB831.arn}"],
              variable: "aws:SourceArn",
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_events.name}",
              ],
              type: "Service",
            },
          ],
          resources: ["${aws_sqs_queue.MyQueue_E6CA6235.arn}"],
        },
      ],
    },
  );
});

test("multiple uses of a queue as a target results in multi policy statement because of condition", () => {
  // GIVEN
  const stack = getAwsStack();
  const queue = new Queue(stack, "MyQueue");

  // WHEN
  for (let i = 0; i < 2; ++i) {
    const rule = new Rule(stack, `Rule${i}`, {
      schedule: Schedule.rate(Duration.hours(1)),
    });
    rule.addTarget(new SqsQueue(queue));
  }

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      arn: "${aws_sqs_queue.MyQueue_E6CA6235.arn}",
    },
  );
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: [
            "sqs:SendMessage",
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl",
          ],
          condition: [
            {
              test: "ArnEquals",
              values: ["${aws_cloudwatch_event_rule.Rule0_71281D88.arn}"],
              variable: "aws:SourceArn",
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_events.name}",
              ],
              type: "Service",
            },
          ],
          resources: ["${aws_sqs_queue.MyQueue_E6CA6235.arn}"],
        },
        {
          actions: [
            "sqs:SendMessage",
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl",
          ],
          condition: [
            {
              test: "ArnEquals",
              values: ["${aws_cloudwatch_event_rule.Rule1_36483A30.arn}"],
              variable: "aws:SourceArn",
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_events.name}",
              ],
              type: "Service",
            },
          ],
          resources: ["${aws_sqs_queue.MyQueue_E6CA6235.arn}"],
        },
      ],
    },
  );
});

test("Encrypted queues result in a policy statement with aws:sourceAccount condition", () => {
  const app = Testing.app();
  // GIVEN
  const ruleStack = new AwsStack(app, "ruleStack");
  // ruleStack.node.setContext(cxapi.EVENTS_TARGET_QUEUE_SAME_ACCOUNT, true);

  const rule = new Rule(ruleStack, "MyRule", {
    schedule: Schedule.rate(Duration.hours(1)),
  });

  const queueStack = new AwsStack(app, "queueStack");
  const queue = new Queue(queueStack, "MyQueue", {
    encryptionMasterKey: Key.fromKeyArn(
      queueStack,
      "key",
      "arn:aws:kms:us-west-2:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab",
    ),
  });

  // WHEN
  rule.addTarget(new SqsQueue(queue));

  // THEN
  queueStack.prepareStack();
  const synthesized = Testing.synth(queueStack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveResourceWithProperties(
    sqsQueuePolicy.SqsQueuePolicy,
    {
      policy: "${data.aws_iam_policy_document.MyQueue_Policy_B72AE551.json}",
      queue_url: "${aws_sqs_queue.MyQueue_E6CA6235.url}",
    },
  );
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: [
            "sqs:SendMessage",
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl",
          ],
          condition: [
            {
              test: "StringEquals",
              values: [
                "${data.terraform_remote_state.cross-stack-reference-input-ruleStack.outputs.cross-stack-output-dataaws_caller_identityCallerIdentityaccount_id}",
              ],
              variable: "aws:SourceAccount",
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_events.name}",
              ],
              type: "Service",
            },
          ],
          resources: ["${aws_sqs_queue.MyQueue_E6CA6235.arn}"],
        },
      ],
    },
  );
});

// test("Encrypted queues result in a permissive policy statement when the feature flag is off", () => {
//   // GIVEN
//   const stack = getAwsStack();
//   const queue = new Queue(stack, "MyQueue", {
//     encryptionMasterKey: kms.Key.fromKeyArn(
//       stack,
//       "key",
//       "arn:aws:kms:us-west-2:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab",
//     ),
//   });

//   const rule = new Rule(stack, "MyRule", {
//     schedule: Schedule.rate(Duration.hours(1)),
//   });

//   // WHEN
//   rule.addTarget(new SqsQueue(queue));

//   // THEN
//   Template.fromStack(stack).hasResourceProperties("AWS::SQS::QueuePolicy", {
//     PolicyDocument: {
//       Statement: [
//         {
//           Action: [
//             "sqs:SendMessage",
//             "sqs:GetQueueAttributes",
//             "sqs:GetQueueUrl",
//           ],
//           Effect: "Allow",
//           Principal: { Service: "events.amazonaws.com" },
//           Resource: {
//             "Fn::GetAtt": ["MyQueueE6CA6235", "Arn"],
//           },
//         },
//       ],
//       Version: "2012-10-17",
//     },
//     Queues: [{ Ref: "MyQueueE6CA6235" }],
//   });

//   Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
//     ScheduleExpression: "rate(1 hour)",
//     State: "ENABLED",
//     Targets: [
//       {
//         Arn: {
//           "Fn::GetAtt": ["MyQueueE6CA6235", "Arn"],
//         },
//         Id: "Target0",
//       },
//     ],
//   });
// });

test("fail if messageGroupId is specified on non-fifo queues", () => {
  const stack = getAwsStack();
  const queue = new Queue(stack, "MyQueue");

  expect(
    () => new SqsQueue(queue, { messageGroupId: "MyMessageGroupId" }),
  ).toThrow(/messageGroupId cannot be specified/);
});

test("fifo queues are synthesized correctly", () => {
  const stack = getAwsStack();
  const queue = new Queue(stack, "MyQueue", { fifo: true });
  const rule = new Rule(stack, "MyRule", {
    schedule: Schedule.rate(Duration.hours(1)),
  });

  // WHEN
  rule.addTarget(
    new SqsQueue(queue, {
      messageGroupId: "MyMessageGroupId",
    }),
  );

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      arn: "${aws_sqs_queue.MyQueue_E6CA6235.arn}",
      sqs_target: {
        message_group_id: "MyMessageGroupId",
      },
    },
  );
});

test("dead letter queue is configured correctly", () => {
  const stack = getAwsStack();
  const queue = new Queue(stack, "MyQueue", { fifo: true });
  const deadLetterQueue = new Queue(stack, "MyDeadLetterQueue");
  const rule = new Rule(stack, "MyRule", {
    schedule: Schedule.rate(Duration.hours(1)),
  });

  // WHEN
  rule.addTarget(
    new SqsQueue(queue, {
      deadLetterQueue,
    }),
  );

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // refer to full snapshot for debug
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      arn: "${aws_sqs_queue.MyQueue_E6CA6235.arn}",
      dead_letter_config: {
        arn: "${aws_sqs_queue.MyDeadLetterQueue_D997968A.arn}",
      },
    },
  );
});

test("specifying retry policy", () => {
  const stack = getAwsStack();
  const queue = new Queue(stack, "MyQueue", { fifo: true });
  const rule = new Rule(stack, "MyRule", {
    schedule: Schedule.rate(Duration.hours(1)),
  });

  // WHEN
  rule.addTarget(
    new SqsQueue(queue, {
      retryAttempts: 2,
      maxEventAge: Duration.hours(2),
    }),
  );

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      arn: "${aws_sqs_queue.MyQueue_E6CA6235.arn}",
      retry_policy: {
        maximum_retry_attempts: 2,
        maximum_event_age_in_seconds: 7200,
      },
    },
  );
});

test("specifying retry policy with 0 retryAttempts", () => {
  const stack = getAwsStack();
  const queue = new Queue(stack, "MyQueue", { fifo: true });
  const rule = new Rule(stack, "MyRule", {
    schedule: Schedule.rate(Duration.hours(1)),
  });

  // WHEN
  rule.addTarget(
    new SqsQueue(queue, {
      retryAttempts: 0,
    }),
  );

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      arn: "${aws_sqs_queue.MyQueue_E6CA6235.arn}",
      retry_policy: {
        maximum_retry_attempts: 0,
      },
    },
  );
});

test("dead letter queue is imported", () => {
  const stack = getAwsStack();
  const queue = new Queue(stack, "MyQueue", { fifo: true });
  const rule = new Rule(stack, "MyRule", {
    schedule: Schedule.rate(Duration.hours(1)),
  });

  const dlqArn = "arn:aws:sqs:eu-west-1:444455556666:queue1";
  const deadLetterQueue = Queue.fromQueueArn(
    stack,
    "MyDeadLetterQueue",
    dlqArn,
  );

  // WHEN
  rule.addTarget(
    new SqsQueue(queue, {
      deadLetterQueue,
    }),
  );

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventRule.CloudwatchEventRule,
    {
      schedule_expression: "rate(1 hour)",
      state: "ENABLED",
    },
  );
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      arn: "${aws_sqs_queue.MyQueue_E6CA6235.arn}",
      target_id: "Target0",
      dead_letter_config: {
        arn: dlqArn,
      },
    },
  );
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    // providerConfig,
    gridBackendConfig,
  });
}
