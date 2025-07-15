// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-lambda-event-sources/test/sqs.test.ts

import {
  dataAwsIamPolicyDocument,
  iamRolePolicy,
  lambdaEventSourceMapping,
  // cloudwatchEventRule,
  // cloudwatchEventTarget,
  // lambdaFunctionEventInvokeConfig,
  // lambdaPermission,
  // s3BucketNotification,
} from "@cdktf/provider-aws";
import { Testing, Lazy } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { TestFunction } from "./test-function";
import { iam, compute, notify, AwsStack } from "../../../../src/aws";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

describe("SQSEventSource", () => {
  let stack: AwsStack;
  beforeEach(() => {
    stack = new AwsStack(Testing.app(), `TestStack`, {
      environmentName: "Test",
      gridUUID: "123e4567-e89b-12d3",
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
  });
  test("defaults", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN
    fn.addEventSource(new compute.sources.SqsEventSource(q));

    // THEN
    const expected = Template.synth(stack);
    expected.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          {
            actions: [
              "sqs:ReceiveMessage",
              "sqs:ChangeMessageVisibility",
              "sqs:GetQueueUrl",
              "sqs:DeleteMessage",
              "sqs:GetQueueAttributes",
            ],
            effect: "Allow",
            resources: ["${aws_sqs_queue.Q_63C6E3AB.arn}"],
          },
        ]),
      },
    );
    expected.toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        event_source_arn: "${aws_sqs_queue.Q_63C6E3AB.arn}",
        function_name: "${aws_lambda_function.Fn_9270CBC0.function_name}",
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: [
    //           "sqs:ReceiveMessage",
    //           "sqs:ChangeMessageVisibility",
    //           "sqs:GetQueueUrl",
    //           "sqs:DeleteMessage",
    //           "sqs:GetQueueAttributes",
    //         ],
    //         Effect: "Allow",
    //         Resource: {
    //           "Fn::GetAtt": ["Q63C6E3AB", "Arn"],
    //         },
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    // });

    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     EventSourceArn: {
    //       "Fn::GetAtt": ["Q63C6E3AB", "Arn"],
    //     },
    //     FunctionName: {
    //       Ref: "Fn9270CBC0",
    //     },
    //   },
    // );
  });

  test("specific batch size", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN
    fn.addEventSource(
      new compute.sources.SqsEventSource(q, {
        batchSize: 5,
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        batch_size: 5,
        event_source_arn: "${aws_sqs_queue.Q_63C6E3AB.arn}",
        function_name: "${aws_lambda_function.Fn_9270CBC0.function_name}",
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     EventSourceArn: {
    //       "Fn::GetAtt": ["Q63C6E3AB", "Arn"],
    //     },
    //     FunctionName: {
    //       Ref: "Fn9270CBC0",
    //     },
    //     BatchSize: 5,
    //   },
    // );
  });

  test("unresolved batch size", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");
    const batchSize: number = 500;

    // WHEN
    fn.addEventSource(
      new compute.sources.SqsEventSource(q, {
        batchSize: Lazy.numberValue({
          produce() {
            return batchSize;
          },
        }),
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        batch_size: 500,
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     BatchSize: 500,
    //   },
    // );
  });

  test("fails if batch size is < 1", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN/THEN
    expect(() =>
      fn.addEventSource(
        new compute.sources.SqsEventSource(q, {
          batchSize: 0,
        }),
      ),
    ).toThrow(
      /Maximum batch size must be between 1 and 10 inclusive \(given 0\) when batching window is not specified\./,
    );
  });

  test("fails if batch size is > 10", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN/THEN
    expect(() =>
      fn.addEventSource(
        new compute.sources.SqsEventSource(q, {
          batchSize: 11,
        }),
      ),
    ).toThrow(
      /Maximum batch size must be between 1 and 10 inclusive \(given 11\) when batching window is not specified\./,
    );
  });

  test("batch size is > 10 and batch window is defined", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN
    fn.addEventSource(
      new compute.sources.SqsEventSource(q, {
        batchSize: 1000,
        maxBatchingWindow: Duration.minutes(5),
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        batch_size: 1000,
        maximum_batching_window_in_seconds: 300,
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     BatchSize: 1000,
    //     MaximumBatchingWindowInSeconds: 300,
    //   },
    // );
  });

  test("fails if batch size is > 10000 and batch window is defined", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN/THEN
    expect(() =>
      fn.addEventSource(
        new compute.sources.SqsEventSource(q, {
          batchSize: 11000,
          maxBatchingWindow: Duration.minutes(5),
        }),
      ),
    ).toThrow(/Maximum batch size must be between 1 and 10000 inclusive/i);
  });

  test("specific batch window", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN
    fn.addEventSource(
      new compute.sources.SqsEventSource(q, {
        maxBatchingWindow: Duration.minutes(5),
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        maximum_batching_window_in_seconds: 300,
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     MaximumBatchingWindowInSeconds: 300,
    //   },
    // );
  });

  test("fails if batch window defined for FIFO queue", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q", {
      fifo: true,
    });

    // WHEN/THEN
    expect(() =>
      fn.addEventSource(
        new compute.sources.SqsEventSource(q, {
          maxBatchingWindow: Duration.minutes(5),
        }),
      ),
    ).toThrow(/Batching window is not supported for FIFO queues/);
  });

  test("fails if batch window is > 5", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN/THEN
    expect(() =>
      fn.addEventSource(
        new compute.sources.SqsEventSource(q, {
          maxBatchingWindow: Duration.minutes(7),
        }),
      ),
    ).toThrow(/Maximum batching window must be 300 seconds or less/i);
  });

  test("contains eventSourceMappingId after lambda binding", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");
    const eventSource = new compute.sources.SqsEventSource(q);

    // WHEN
    fn.addEventSource(eventSource);

    // THEN
    expect(eventSource.eventSourceMappingId).toBeDefined();
  });

  test("contains eventSourceMappingArn after lambda binding", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");
    const eventSource = new compute.sources.SqsEventSource(q);

    // WHEN
    fn.addEventSource(eventSource);

    // THEN
    expect(eventSource.eventSourceMappingArn).toBeDefined();
  });

  test("eventSourceMappingId throws error before binding to lambda", () => {
    // GIVEN
    const q = new notify.Queue(stack, "Q");
    const eventSource = new compute.sources.SqsEventSource(q);

    // WHEN/THEN
    expect(() => eventSource.eventSourceMappingId).toThrow(
      /SqsEventSource is not yet bound to an event source mapping/,
    );
  });

  test("eventSourceMappingArn throws error before binding to lambda", () => {
    // GIVEN
    const q = new notify.Queue(stack, "Q");
    const eventSource = new compute.sources.SqsEventSource(q);

    // WHEN/THEN
    expect(() => eventSource.eventSourceMappingArn).toThrow(
      /SqsEventSource is not yet bound to an event source mapping/,
    );
  });

  test("event source disabled", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN
    fn.addEventSource(
      new compute.sources.SqsEventSource(q, {
        enabled: false,
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        enabled: false,
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     Enabled: false,
    //   },
    // );
  });

  test("reportBatchItemFailures", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN
    fn.addEventSource(
      new compute.sources.SqsEventSource(q, {
        reportBatchItemFailures: true,
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        function_response_types: ["ReportBatchItemFailures"],
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     FunctionResponseTypes: ["ReportBatchItemFailures"],
    //   },
    // );
  });

  // test("warning added if lambda function imported without role", () => {
  //   const fn = compute.LambdaFunction.fromFunctionName(
  //     stack,
  //     "Handler",
  //     "testFunction",
  //   );
  //   const q = new notify.Queue(stack, "Q");

  //   // WHEN
  //   fn.addEventSource(new compute.sources.SqsEventSource(q));
  //   // const assembly = app.synth();

  //   Template.synth(stack).toMatchSnapshot();

  //   const messages = assembly.getStackArtifact(stack.artifactId).messages;

  //   // THEN
  //   expect(messages.length).toEqual(1);
  //   expect(messages[0]).toMatchObject({
  //     level: "warning",
  //     id: "/Default/Handler",
  //     entry: {
  //       data: expect.stringMatching(
  //         /Function 'Default\/Handler' was imported without an IAM role/,
  //       ),
  //     },
  //   });

  //   // THEN
  //   // Template.fromStack(stack).resourceCountIs(
  //   //   "AWS::Lambda::EventSourceMapping",
  //   //   1,
  //   // );
  //   // Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 0);
  // });

  // TODO: addEventSource to imported IAM Role needs to be fixed
  test.skip("policy added to imported function role", () => {
    // GIVEN
    const fn = compute.LambdaFunction.fromFunctionAttributes(stack, "Handler", {
      functionArn: stack.formatArn({
        service: "lambda",
        resource: "function",
        resourceName: "testFunction",
      }),
      role: iam.Role.fromRoleName(stack, "Role", "testFunctionRole"),
    });
    const q = new notify.Queue(stack, "Q");

    // WHEN
    fn.addEventSource(new compute.sources.SqsEventSource(q));

    // THEN
    const expected = Template.synth(stack);
    expected.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          {
            actions: [
              "sqs:ReceiveMessage",
              "sqs:ChangeMessageVisibility",
              "sqs:GetQueueUrl",
              "sqs:DeleteMessage",
              "sqs:GetQueueAttributes",
            ],
            effect: "Allow",
            resources: ["${aws_sqs_queue.Q_63C6E3AB.arn}"],
          },
        ]),
      },
    );
    // TODO: Should this be policy attachment instead??
    expected.toHaveResourceWithProperties(iamRolePolicy.IamRolePolicy, {
      name: "TestStackRolePolicyA8726EBF",
      policy: "${data.aws_iam_policy_document.Role_Policy_A6D2CA68.json}",
      role: "testFunctionRole",
    });
    // TODO: this is dumb...
    expected.toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        event_source_arn: "${aws_sqs_queue.Q_63C6E3AB.arn}",
        function_name:
          '${element(split(":", "arn:${data.aws_partition.Partitition.partition}:lambda:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:function/testFunction"), 6)}',
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: [
    //           "sqs:ReceiveMessage",
    //           "sqs:ChangeMessageVisibility",
    //           "sqs:GetQueueUrl",
    //           "sqs:DeleteMessage",
    //           "sqs:GetQueueAttributes",
    //         ],
    //         Effect: "Allow",
    //         Resource: {
    //           "Fn::GetAtt": ["Q63C6E3AB", "Arn"],
    //         },
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   Roles: ["testFunctionRole"],
    // });

    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     EventSourceArn: {
    //       "Fn::GetAtt": ["Q63C6E3AB", "Arn"],
    //     },
    //     FunctionName: {
    //       "Fn::Select": [
    //         6,
    //         {
    //           "Fn::Split": [
    //             ":",
    //             {
    //               "Fn::Join": [
    //                 "",
    //                 [
    //                   "arn:",
    //                   {
    //                     Ref: "AWS::Partition",
    //                   },
    //                   ":lambda:",
    //                   {
    //                     Ref: "AWS::Region",
    //                   },
    //                   ":",
    //                   {
    //                     Ref: "AWS::AccountId",
    //                   },
    //                   ":function/testFunction",
    //                 ],
    //               ],
    //             },
    //           ],
    //         },
    //       ],
    //     },
    //   },
    // );
  });

  test("adding filter criteria", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN
    fn.addEventSource(
      new compute.sources.SqsEventSource(q, {
        filters: [
          compute.FilterCriteria.filter({
            body: {
              id: compute.FilterRule.exists(),
            },
          }),
        ],
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        filter_criteria: {
          filter: [
            {
              pattern: '{"body":{"id":[{"exists":true}]}}',
            },
          ],
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     FilterCriteria: {
    //       Filters: [
    //         {
    //           Pattern: '{"body":{"id":[{"exists":true}]}}',
    //         },
    //       ],
    //     },
    //   },
    // );
  });

  // test("adding filter criteria encryption", () => {
  //   // GIVEN
  //   const fn = new TestFunction(stack, "Fn");
  //   const q = new notify.Queue(stack, "Q");
  //   const myKey = encryption.Key.fromKeyArn(
  //     stack,
  //     "SourceBucketEncryptionKey",
  //     "arn:aws:kms:us-east-1:123456789012:key/<key-id>",
  //   );

  //   // WHEN
  //   fn.addEventSource(
  //     new compute.sources.SqsEventSource(q, {
  //       filters: [
  //         lambda.FilterCriteria.filter({
  //           body: {
  //             id: lambda.FilterRule.exists(),
  //           },
  //         }),
  //       ],
  //       filterEncryption: myKey,
  //     }),
  //   );

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "AWS::Lambda::EventSourceMapping",
  //     {
  //       FilterCriteria: {
  //         Filters: [
  //           {
  //             Pattern: '{"body":{"id":[{"exists":true}]}}',
  //           },
  //         ],
  //       },
  //       KmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/<key-id>",
  //     },
  //   );
  // });

  // test("adding filter criteria encryption with stack key", () => {
  //   // GIVEN

  //   const fn = new TestFunction(stack, "Fn");
  //   const q = new notify.Queue(stack, "Q");
  //   const myKey = new encryption.Key(stack, "fc-test-key-name", {
  //     removalPolicy: cdk.RemovalPolicy.DESTROY,
  //     pendingWindow: Duration.days(7),
  //     description: "KMS key for test fc encryption",
  //   });

  //   // WHEN
  //   fn.addEventSource(
  //     new compute.sources.SqsEventSource(q, {
  //       filters: [
  //         lambda.FilterCriteria.filter({
  //           body: {
  //             id: lambda.FilterRule.exists(),
  //           },
  //         }),
  //       ],
  //       filterEncryption: myKey,
  //     }),
  //   );

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
  //     KeyPolicy: {
  //       Statement: [
  //         {
  //           Action: "kms:*",
  //           Effect: "Allow",
  //           Principal: {
  //             AWS: {
  //               "Fn::Join": [
  //                 "",
  //                 [
  //                   "arn:",
  //                   { Ref: "AWS::Partition" },
  //                   ":iam::",
  //                   { Ref: "AWS::AccountId" },
  //                   ":root",
  //                 ],
  //               ],
  //             },
  //           },
  //           Resource: "*",
  //         },
  //         {
  //           Action: "kms:Decrypt",
  //           Effect: "Allow",
  //           Principal: {
  //             Service: "lambda.amazonaws.com",
  //           },
  //           Resource: "*",
  //         },
  //       ],
  //     },
  //   });
  // });

  test("fails if maxConcurrency < 2", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN/THEN
    expect(() =>
      fn.addEventSource(
        new compute.sources.SqsEventSource(q, {
          maxConcurrency: 1,
        }),
      ),
    ).toThrow(/maxConcurrency must be between 2 and 1000 concurrent instances/);
  });

  test("adding maxConcurrency of 5", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN
    fn.addEventSource(
      new compute.sources.SqsEventSource(q, {
        maxConcurrency: 5,
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        scaling_config: {
          maximum_concurrency: 5,
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     ScalingConfig: { MaximumConcurrency: 5 },
    //   },
    // );
  });

  test("fails if maxConcurrency > 1001", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const q = new notify.Queue(stack, "Q");

    // WHEN/THEN
    expect(() =>
      fn.addEventSource(
        new compute.sources.SqsEventSource(q, {
          maxConcurrency: 1,
        }),
      ),
    ).toThrow(/maxConcurrency must be between 2 and 1000 concurrent instances/);
  });
});
