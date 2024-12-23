import {
  cloudwatchEventRule,
  cloudwatchEventTarget,
  dataAwsIamPolicyDocument,
  sqsQueuePolicy,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as compute from "../../../../src/aws/compute";
import * as iam from "../../../../src/aws/iam";
import * as notify from "../../../../src/aws/notify";
import * as targets from "../../../../src/aws/notify/targets";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

test("State machine can be used as Event Rule target", () => {
  // GIVEN
  const stack = getAwsStack();
  const rule = new notify.Rule(stack, "Rule", {
    schedule: notify.Schedule.rate(Duration.minutes(1)),
  });
  const stateMachine = new compute.StateMachine(stack, "SM", {
    definitionBody: compute.DefinitionBody.fromChainable(
      new compute.Wait(stack, "Hello", {
        time: compute.WaitTime.duration(Duration.seconds(10)),
      }),
    ),
  });

  // WHEN
  rule.addTarget(
    new targets.SfnStateMachine(stateMachine, {
      input: notify.RuleTargetInput.fromObject({ SomeParam: "SomeValue" }),
    }),
  );

  // THEN
  const template = Template.synth(stack);
  template.toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      input: '{"SomeParam":"SomeValue"}',
      arn: "${aws_sfn_state_machine.SM_934E715A.arn}",
      role_arn: "${aws_iam_role.SM_EventsRole_B320A902.arn}",
    },
  );
  // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
  //   Targets: [
  //     {
  //       Input: '{"SomeParam":"SomeValue"}',
  //     },
  //   ],
  // });
  template.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["sts:AssumeRole"],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_events.name}",
              ],
              type: "Service",
            },
          ],
        },
      ],
    },
  );
  // hasResourceProperties("AWS::IAM::Role", {
  //   AssumeRolePolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "sts:AssumeRole",
  //         Effect: "Allow",
  //         Principal: {
  //           Service: "events.amazonaws.com",
  //         },
  //       },
  //     ],
  //   },
  // });
  template.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["states:StartExecution"],
          effect: "Allow",
          resources: ["${aws_sfn_state_machine.SM_934E715A.arn}"],
        },
      ],
    },
  );
  // hasResourceProperties("AWS::IAM::Policy", {
  //   PolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "states:StartExecution",
  //         Effect: "Allow",
  //         Resource: {
  //           Ref: "SM934E715A",
  //         },
  //       },
  //     ],
  //   },
  // });
});

test("Existing role can be used for State machine Rule target", () => {
  // GIVEN
  const stack = getAwsStack();
  const rule = new notify.Rule(stack, "Rule", {
    schedule: notify.Schedule.rate(Duration.minutes(1)),
  });
  const role = new iam.Role(stack, "Role", {
    assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
  });
  const stateMachine = new compute.StateMachine(stack, "SM", {
    definitionBody: compute.DefinitionBody.fromChainable(
      new compute.Wait(stack, "Hello", {
        time: compute.WaitTime.duration(Duration.seconds(10)),
      }),
    ),
  });

  // WHEN
  rule.addTarget(
    new targets.SfnStateMachine(stateMachine, {
      input: notify.RuleTargetInput.fromObject({ SomeParam: "SomeValue" }),
      role: role,
    }),
  );

  // THEN
  const template = Template.synth(stack);
  template.toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      input: '{"SomeParam":"SomeValue"}',
      arn: "${aws_sfn_state_machine.SM_934E715A.arn}",
      role_arn: "${aws_iam_role.Role_1ABCC5F0.arn}",
    },
  );
  // .hasResourceProperties("AWS::Events::Rule", {
  //   Targets: [
  //     {
  //       Input: '{"SomeParam":"SomeValue"}',
  //     },
  //   ],
  // });
  template.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["sts:AssumeRole"],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_events.name}",
              ],
              type: "Service",
            },
          ],
        },
      ],
    },
  );
  // .hasResourceProperties("AWS::IAM::Role", {
  //   AssumeRolePolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "sts:AssumeRole",
  //         Effect: "Allow",
  //         Principal: {
  //           Service: "events.amazonaws.com",
  //         },
  //       },
  //     ],
  //   },
  // });
  template.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["states:StartExecution"],
          effect: "Allow",
          resources: ["${aws_sfn_state_machine.SM_934E715A.arn}"],
        },
      ],
    },
  );
  // .hasResourceProperties("AWS::IAM::Policy", {
  //   PolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "states:StartExecution",
  //         Effect: "Allow",
  //         Resource: {
  //           Ref: "SM934E715A",
  //         },
  //       },
  //     ],
  //   },
  // });
});

test("specifying retry policy", () => {
  // GIVEN
  const stack = getAwsStack();
  const rule = new notify.Rule(stack, "Rule", {
    schedule: notify.Schedule.expression("rate(1 hour)"),
  });

  // WHEN
  const role = new iam.Role(stack, "Role", {
    assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
  });
  const stateMachine = new compute.StateMachine(stack, "SM", {
    definitionBody: compute.DefinitionBody.fromChainable(
      new compute.Wait(stack, "Hello", {
        time: compute.WaitTime.duration(Duration.seconds(10)),
      }),
    ),
  });

  rule.addTarget(
    new targets.SfnStateMachine(stateMachine, {
      input: notify.RuleTargetInput.fromObject({ SomeParam: "SomeValue" }),
      maxEventAge: Duration.hours(2),
      retryAttempts: 2,
      role: role,
    }),
  );

  // THEN
  const template = Template.synth(stack);
  template.toHaveResourceWithProperties(
    cloudwatchEventRule.CloudwatchEventRule,
    {
      schedule_expression: "rate(1 hour)",
      state: "ENABLED",
    },
  );
  template.toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      input: '{"SomeParam":"SomeValue"}',
      arn: "${aws_sfn_state_machine.SM_934E715A.arn}",
      retry_policy: {
        maximum_event_age_in_seconds: 7200,
        maximum_retry_attempts: 2,
      },
      role_arn: "${aws_iam_role.Role_1ABCC5F0.arn}",
    },
  );
  // .hasResourceProperties("AWS::Events::Rule", {
  //   ScheduleExpression: "rate(1 hour)",
  //   State: "ENABLED",
  //   Targets: [
  //     {
  //       Arn: {
  //         Ref: "SM934E715A",
  //       },
  //       Id: "Target0",
  //       Input: '{"SomeParam":"SomeValue"}',
  //       RetryPolicy: {
  //         MaximumEventAgeInSeconds: 7200,
  //         MaximumRetryAttempts: 2,
  //       },
  //       RoleArn: {
  //         "Fn::GetAtt": ["Role1ABCC5F0", "Arn"],
  //       },
  //     },
  //   ],
  // });
});

test("specifying retry policy with 0 retryAttempts", () => {
  // GIVEN
  const stack = getAwsStack();
  const rule = new notify.Rule(stack, "Rule", {
    schedule: notify.Schedule.expression("rate(1 hour)"),
  });

  // WHEN
  const role = new iam.Role(stack, "Role", {
    assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
  });
  const stateMachine = new compute.StateMachine(stack, "SM", {
    definitionBody: compute.DefinitionBody.fromChainable(
      new compute.Wait(stack, "Hello", {
        time: compute.WaitTime.duration(Duration.seconds(10)),
      }),
    ),
  });

  rule.addTarget(
    new targets.SfnStateMachine(stateMachine, {
      input: notify.RuleTargetInput.fromObject({ SomeParam: "SomeValue" }),
      retryAttempts: 0,
      role: role,
    }),
  );

  // THEN
  const template = Template.synth(stack);
  template.toHaveResourceWithProperties(
    cloudwatchEventRule.CloudwatchEventRule,
    {
      schedule_expression: "rate(1 hour)",
      state: "ENABLED",
    },
  );
  template.toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      input: '{"SomeParam":"SomeValue"}',
      arn: "${aws_sfn_state_machine.SM_934E715A.arn}",
      retry_policy: {
        maximum_retry_attempts: 0,
      },
      role_arn: "${aws_iam_role.Role_1ABCC5F0.arn}",
    },
  );
  // .hasResourceProperties("AWS::Events::Rule", {
  //   ScheduleExpression: "rate(1 hour)",
  //   State: "ENABLED",
  //   Targets: [
  //     {
  //       Arn: {
  //         Ref: "SM934E715A",
  //       },
  //       Id: "Target0",
  //       Input: '{"SomeParam":"SomeValue"}',
  //       RetryPolicy: {
  //         MaximumRetryAttempts: 0,
  //       },
  //       RoleArn: {
  //         "Fn::GetAtt": ["Role1ABCC5F0", "Arn"],
  //       },
  //     },
  //   ],
  // });
});

test("use a Dead Letter Queue for the rule target", () => {
  // GIVEN
  const stack = getAwsStack();
  const rule = new notify.Rule(stack, "Rule", {
    schedule: notify.Schedule.rate(Duration.minutes(1)),
  });

  const dlq = new notify.Queue(stack, "DeadLetterQueue");

  const role = new iam.Role(stack, "Role", {
    assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
  });
  const stateMachine = new compute.StateMachine(stack, "SM", {
    definitionBody: compute.DefinitionBody.fromChainable(
      new compute.Wait(stack, "Hello", {
        time: compute.WaitTime.duration(Duration.seconds(10)),
      }),
    ),
  });

  // WHEN
  rule.addTarget(
    new targets.SfnStateMachine(stateMachine, {
      input: notify.RuleTargetInput.fromObject({ SomeParam: "SomeValue" }),
      deadLetterQueue: dlq,
      role: role,
    }),
  );

  // the Permission resource should be in the event stack
  const template = Template.synth(stack);
  template.toHaveResourceWithProperties(
    cloudwatchEventRule.CloudwatchEventRule,
    {
      schedule_expression: "rate(1 minute)",
      state: "ENABLED",
    },
  );
  template.toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      input: '{"SomeParam":"SomeValue"}',
      arn: stack.resolve(stateMachine.stateMachineArn),
      dead_letter_config: {
        arn: stack.resolve(dlq.queueArn),
      },
      role_arn: stack.resolve(role.roleArn),
    },
  );
  // .hasResourceProperties("AWS::Events::Rule", {
  //   ScheduleExpression: "rate(1 minute)",
  //   State: "ENABLED",
  //   Targets: [
  //     {
  //       Arn: {
  //         Ref: "SM934E715A",
  //       },
  //       DeadLetterConfig: {
  //         Arn: {
  //           "Fn::GetAtt": ["DeadLetterQueue9F481546", "Arn"],
  //         },
  //       },
  //       Id: "Target0",
  //       Input: '{"SomeParam":"SomeValue"}',
  //       RoleArn: {
  //         "Fn::GetAtt": ["Role1ABCC5F0", "Arn"],
  //       },
  //     },
  //   ],
  // });
  template.toHaveResourceWithProperties(sqsQueuePolicy.SqsQueuePolicy, {
    policy:
      "${data.aws_iam_policy_document.DeadLetterQueue_Policy_D01590FE.json}",
    queue_url: stack.resolve(dlq.queueUrl),
  });
  template.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["sqs:SendMessage"],
          condition: [
            {
              test: "ArnEquals",
              values: ["${aws_cloudwatch_event_rule.Rule_4C995B7F.arn}"],
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
          resources: [stack.resolve(dlq.queueArn)],
          sid: "AllowEventRuleTestStackRule3795E55D",
        },
      ],
    },
  );
  // .hasResourceProperties("AWS::SQS::QueuePolicy", {
  //   PolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "sqs:SendMessage",
  //         Condition: {
  //           ArnEquals: {
  //             "aws:SourceArn": {
  //               "Fn::GetAtt": ["Rule4C995B7F", "Arn"],
  //             },
  //           },
  //         },
  //         Effect: "Allow",
  //         Principal: {
  //           Service: "events.amazonaws.com",
  //         },
  //         Resource: {
  //           "Fn::GetAtt": ["DeadLetterQueue9F481546", "Arn"],
  //         },
  //         Sid: "AllowEventRuleStackRuleF6E31DD0",
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  //   Queues: [
  //     {
  //       Ref: "DeadLetterQueue9F481546",
  //     },
  //   ],
  // });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
