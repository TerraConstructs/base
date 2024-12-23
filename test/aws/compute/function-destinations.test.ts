import path from "path";
import {
  dataAwsIamPolicyDocument,
  cloudwatchEventRule,
  cloudwatchEventTarget,
  lambdaFunctionEventInvokeConfig,
  lambdaPermission,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { compute, notify, AwsStack } from "../../../src/aws";

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

const fnProps: compute.NodejsFunctionProps = {
  path: path.join(__dirname, "fixtures", "hello-world.ts"),
};

test("event bus as destination", () => {
  // GIVEN
  const eventBus = new notify.EventBus(stack, "EventBus");

  // WHEN
  new compute.NodejsFunction(stack, "Function", {
    ...fnProps,
    onSuccess: new compute.destinations.EventBridgeDestination(eventBus),
  });

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveResourceWithProperties(
    lambdaFunctionEventInvokeConfig.LambdaFunctionEventInvokeConfig,
    {
      function_name: "${aws_lambda_function.Function_76856677.function_name}",
      destination_config: {
        on_success: {
          destination: "${aws_cloudwatch_event_bus.EventBus_7B8748AA.arn}",
        },
      },
    },
  );
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: expect.arrayContaining([
        {
          actions: ["events:PutEvents"],
          effect: "Allow",
          resources: ["${aws_cloudwatch_event_bus.EventBus_7B8748AA.arn}"],
        },
      ]),
    },
  );
  // Template.fromStack(stack).hasResourceProperties(
  //   "AWS::Lambda::EventInvokeConfig",
  //   {
  //     DestinationConfig: {
  //       OnSuccess: {
  //         Destination: {
  //           "Fn::GetAtt": ["EventBus7B8748AA", "Arn"],
  //         },
  //       },
  //     },
  //   },
  // );
  // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //   PolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "events:PutEvents",
  //         Effect: "Allow",
  //         Resource: {
  //           "Fn::GetAtt": ["EventBus7B8748AA", "Arn"],
  //         },
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});

test("lambda as destination", () => {
  // GIVEN
  const successFunction = new compute.NodejsFunction(
    stack,
    "SuccessFunction",
    fnProps,
  );

  // WHEN
  new compute.NodejsFunction(stack, "Function", {
    ...fnProps,
    onSuccess: new compute.destinations.FunctionDestination(successFunction),
  });

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveResourceWithProperties(
    lambdaFunctionEventInvokeConfig.LambdaFunctionEventInvokeConfig,
    {
      destination_config: {
        on_success: {
          destination: "${aws_lambda_function.SuccessFunction_93C61D39.arn}",
        },
      },
    },
  );
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: expect.arrayContaining([
        {
          actions: ["lambda:InvokeFunction"],
          effect: "Allow",
          resources: [
            "${aws_lambda_function.SuccessFunction_93C61D39.arn}", // TODO: Integration test for this!
            "${aws_lambda_function.SuccessFunction_93C61D39.qualified_invoke_arn}",
          ],
        },
      ]),
    },
  );
  // Template.fromStack(stack).hasResourceProperties(
  //   "AWS::Lambda::EventInvokeConfig",
  //   {
  //     DestinationConfig: {
  //       OnSuccess: {
  //         Destination: {
  //           "Fn::GetAtt": ["SuccessFunction93C61D39", "Arn"],
  //         },
  //       },
  //     },
  //   },
  // );

  // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //   PolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "lambda:InvokeFunction",
  //         Effect: "Allow",
  //         Resource: [
  //           { "Fn::GetAtt": ["SuccessFunction93C61D39", "Arn"] },
  //           {
  //             "Fn::Join": [
  //               "",
  //               [{ "Fn::GetAtt": ["SuccessFunction93C61D39", "Arn"] }, ":*"],
  //             ],
  //           },
  //         ],
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});

test("lambda payload as destination", () => {
  // GIVEN
  const successFunction = new compute.NodejsFunction(
    stack,
    "SuccessFunction",
    fnProps,
  );
  const failureFunction = new compute.NodejsFunction(
    stack,
    "FailureFunction",
    fnProps,
  );

  // WHEN
  new compute.NodejsFunction(stack, "Function", {
    ...fnProps,
    onSuccess: new compute.destinations.FunctionDestination(successFunction, {
      responseOnly: true,
    }),
    onFailure: new compute.destinations.FunctionDestination(failureFunction, {
      responseOnly: true,
    }),
  });

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  // Lambda destinations to event bus
  expect(synthesized).toHaveResourceWithProperties(
    lambdaFunctionEventInvokeConfig.LambdaFunctionEventInvokeConfig,
    {
      destination_config: {
        on_failure: {
          destination:
            "arn:${data.aws_partition.Partitition.partition}:events:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:event-bus/default",
        },
        on_success: {
          destination:
            "arn:${data.aws_partition.Partitition.partition}:events:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:event-bus/default",
        },
      },
    },
  );
  // Lambda permissions for event bus
  expect(synthesized).toHaveResourceWithProperties(
    lambdaPermission.LambdaPermission,
    {
      action: "lambda:InvokeFunction",
      function_name: "${aws_lambda_function.SuccessFunction_93C61D39.arn}",
      principal: "events.amazonaws.com", // TODO: fix discrepancy between this principal and the iam policy principal
      source_arn:
        "${aws_cloudwatch_event_rule.Function_EventInvokeConfig_Success_0CD84C7A.arn}",
    },
  );
  expect(synthesized).toHaveResourceWithProperties(
    lambdaPermission.LambdaPermission,
    {
      action: "lambda:InvokeFunction",
      function_name: "${aws_lambda_function.FailureFunction_E917A574.arn}",
      principal: "events.amazonaws.com",
      source_arn:
        "${aws_cloudwatch_event_rule.Function_EventInvokeConfig_Failure_1964342B.arn}",
    },
  );
  // event bus permissions to assume Success/Failure service roles
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: expect.arrayContaining([
        {
          actions: ["sts:AssumeRole"],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_lambda.name}",
              ],
              type: "Service",
            },
          ],
        },
      ]),
    },
  );
  // EventBridge rules for Success/Failure
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventRule.CloudwatchEventRule,
    {
      event_pattern:
        '{"detail-type":["Lambda Function Invocation Result - Success"],"resources":["${aws_lambda_function.Function_76856677.arn}:$LATEST"],"source":["lambda"]}',
    },
  );
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      rule: "${aws_cloudwatch_event_rule.Function_EventInvokeConfig_Success_0CD84C7A.name}",
      target_id: "Target0",
      arn: "${aws_lambda_function.SuccessFunction_93C61D39.arn}",
      input_path: "$.detail.responsePayload",
    },
  );
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventRule.CloudwatchEventRule,
    {
      event_pattern:
        '{"detail-type":["Lambda Function Invocation Result - Failure"],"resources":["${aws_lambda_function.Function_76856677.arn}:$LATEST"],"source":["lambda"]}',
    },
  );
  expect(synthesized).toHaveResourceWithProperties(
    cloudwatchEventTarget.CloudwatchEventTarget,
    {
      rule: "${aws_cloudwatch_event_rule.Function_EventInvokeConfig_Failure_1964342B.name}",
      target_id: "Target0",
      arn: "${aws_lambda_function.FailureFunction_E917A574.arn}",
      input_path: "$.detail.responsePayload",
    },
  );
  // Template.fromStack(stack).hasResourceProperties(
  //   "AWS::Lambda::EventInvokeConfig",
  //   {
  //     DestinationConfig: {
  //       OnSuccess: {
  //         Destination: {
  //           "Fn::Join": [
  //             "",
  //             [
  //               "arn:",
  //               {
  //                 Ref: "AWS::Partition",
  //               },
  //               ":events:",
  //               {
  //                 Ref: "AWS::Region",
  //               },
  //               ":",
  //               {
  //                 Ref: "AWS::AccountId",
  //               },
  //               ":event-bus/default",
  //             ],
  //           ],
  //         },
  //       },
  //       OnFailure: {
  //         Destination: {
  //           "Fn::Join": [
  //             "",
  //             [
  //               "arn:",
  //               {
  //                 Ref: "AWS::Partition",
  //               },
  //               ":events:",
  //               {
  //                 Ref: "AWS::Region",
  //               },
  //               ":",
  //               {
  //                 Ref: "AWS::AccountId",
  //               },
  //               ":event-bus/default",
  //             ],
  //           ],
  //         },
  //       },
  //     },
  //   },
  // );

  // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //   PolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "events:PutEvents",
  //         Effect: "Allow",
  //         Resource: {
  //           "Fn::Join": [
  //             "",
  //             [
  //               "arn:",
  //               {
  //                 Ref: "AWS::Partition",
  //               },
  //               ":events:",
  //               {
  //                 Ref: "AWS::Region",
  //               },
  //               ":",
  //               {
  //                 Ref: "AWS::AccountId",
  //               },
  //               ":event-bus/default",
  //             ],
  //           ],
  //         },
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });

  // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
  //   EventPattern: {
  //     "detail-type": ["Lambda Function Invocation Result - Success"],
  //     resources: [
  //       {
  //         "Fn::Join": [
  //           "",
  //           [
  //             {
  //               "Fn::GetAtt": ["Function76856677", "Arn"],
  //             },
  //             ":$LATEST",
  //           ],
  //         ],
  //       },
  //     ],
  //     source: ["lambda"],
  //   },
  //   Targets: [
  //     {
  //       Arn: {
  //         "Fn::GetAtt": ["SuccessFunction93C61D39", "Arn"],
  //       },
  //       Id: "Target0",
  //       InputPath: "$.detail.responsePayload",
  //     },
  //   ],
  // });

  // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
  //   EventPattern: {
  //     "detail-type": ["Lambda Function Invocation Result - Failure"],
  //     resources: [
  //       {
  //         "Fn::Join": [
  //           "",
  //           [
  //             {
  //               "Fn::GetAtt": ["Function76856677", "Arn"],
  //             },
  //             ":$LATEST",
  //           ],
  //         ],
  //       },
  //     ],
  //     source: ["lambda"],
  //   },
  //   Targets: [
  //     {
  //       Arn: {
  //         "Fn::GetAtt": ["FailureFunctionE917A574", "Arn"],
  //       },
  //       Id: "Target0",
  //       InputPath: "$.detail.responsePayload",
  //     },
  //   ],
  // });
});

// test("sns as destination", () => {
//   // GIVEN
//   const topic = new notify.Topic(stack, "Topic");

//   // WHEN
//   new compute.NodejsFunction(stack, "Function", {
//     ...lambdaProps,
//     onSuccess: new compute.destinations.SnsDestination(topic),
//   });

//   // THEN
//   Template.fromStack(stack).hasResourceProperties(
//     "AWS::Lambda::EventInvokeConfig",
//     {
//       DestinationConfig: {
//         OnSuccess: {
//           Destination: {
//             Ref: "TopicBFC7AF6E",
//           },
//         },
//       },
//     },
//   );

//   Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
//     PolicyDocument: {
//       Statement: [
//         {
//           Action: "sns:Publish",
//           Effect: "Allow",
//           Resource: {
//             Ref: "TopicBFC7AF6E",
//           },
//         },
//       ],
//       Version: "2012-10-17",
//     },
//   });
// });

test("sqs as destination", () => {
  // GIVEN
  const queue = new notify.Queue(stack, "Queue");

  // WHEN
  new compute.NodejsFunction(stack, "Function", {
    ...fnProps,
    onSuccess: new compute.destinations.SqsDestination(queue),
  });

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveResourceWithProperties(
    lambdaFunctionEventInvokeConfig.LambdaFunctionEventInvokeConfig,
    {
      destination_config: {
        on_success: {
          destination: "${aws_sqs_queue.Queue_4A7E3555.arn}",
        },
      },
    },
  );
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: expect.arrayContaining([
        {
          actions: [
            "sqs:SendMessage",
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl",
          ],
          effect: "Allow",
          resources: ["${aws_sqs_queue.Queue_4A7E3555.arn}"],
        },
      ]),
    },
  );
  // Template.fromStack(stack).hasResourceProperties(
  //   "AWS::Lambda::EventInvokeConfig",
  //   {
  //     DestinationConfig: {
  //       OnSuccess: {
  //         Destination: {
  //           "Fn::GetAtt": ["Queue4A7E3555", "Arn"],
  //         },
  //       },
  //     },
  //   },
  // );

  // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //   PolicyDocument: {
  //     Statement: [
  //       {
  //         Action: [
  //           "sqs:SendMessage",
  //           "sqs:GetQueueAttributes",
  //           "sqs:GetQueueUrl",
  //         ],
  //         Effect: "Allow",
  //         Resource: {
  //           "Fn::GetAtt": ["Queue4A7E3555", "Arn"],
  //         },
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});
