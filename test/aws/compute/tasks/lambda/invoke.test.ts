import path from "path";
import "cdktf/lib/testing/adapters/jest";
import { Testing } from "cdktf";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import * as compute from "../../../../../src/aws/compute";
import {
  LambdaInvocationType,
  LambdaInvoke,
} from "../../../../../src/aws/compute/tasks";

describe("LambdaInvoke", () => {
  let stack: AwsStack;
  let lambdaFunction: compute.NodejsFunction;

  beforeEach(() => {
    // GIVEN
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName: "Test",
      gridUUID: "123e4567-e89b-12d3",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
    lambdaFunction = new compute.NodejsFunction(stack, "Fn", {
      path: path.join(__dirname, "fixtures", "hello-world.ts"),
    });
  });

  test("default settings", () => {
    // WHEN
    const task = new LambdaInvoke(stack, "Task", {
      lambdaFunction,
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      End: true,
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::lambda:invoke",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::lambda:invoke",
      //     ],
      //   ],
      // },
      Parameters: {
        FunctionName: "${aws_lambda_function.Fn_9270CBC0.arn}",
        // FunctionName: {
        //   "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
        // },
        "Payload.$": "$",
      },
      Retry: [
        {
          ErrorEquals: [
            "Lambda.ClientExecutionTimeoutException",
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
          ],
          IntervalSeconds: 2,
          MaxAttempts: 6,
          BackoffRate: 2,
        },
      ],
    });
  });

  test("optional settings", () => {
    // WHEN
    const task = new LambdaInvoke(stack, "Task", {
      lambdaFunction,
      payload: compute.TaskInput.fromObject({
        foo: "bar",
      }),
      invocationType: LambdaInvocationType.REQUEST_RESPONSE,
      clientContext: "eyJoZWxsbyI6IndvcmxkIn0=",
      qualifier: "1",
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual(
      expect.objectContaining({
        Type: "Task",
        Resource:
          "arn:${data.aws_partition.Partitition.partition}:states:::lambda:invoke",
        // Resource: {
        //   "Fn::Join": [
        //     "",
        //     [
        //       "arn:",
        //       {
        //         Ref: "AWS::Partition",
        //       },
        //       ":states:::lambda:invoke",
        //     ],
        //   ],
        // },
        End: true,
        Parameters: {
          FunctionName: "${aws_lambda_function.Fn_9270CBC0.arn}",
          // FunctionName: {
          //   "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
          // },
          Payload: {
            foo: "bar",
          },
          InvocationType: "RequestResponse",
          ClientContext: "eyJoZWxsbyI6IndvcmxkIn0=",
          Qualifier: "1",
        },
      }),
    );
  });

  test("resultSelector", () => {
    // WHEN
    const task = new LambdaInvoke(stack, "Task", {
      lambdaFunction,
      resultSelector: {
        Result: compute.JsonPath.stringAt("$.output.Payload"),
      },
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual(
      expect.objectContaining({
        Type: "Task",
        Resource:
          "arn:${data.aws_partition.Partitition.partition}:states:::lambda:invoke",
        // Resource: {
        //   "Fn::Join": [
        //     "",
        //     [
        //       "arn:",
        //       {
        //         Ref: "AWS::Partition",
        //       },
        //       ":states:::lambda:invoke",
        //     ],
        //   ],
        // },
        End: true,
        Parameters: {
          FunctionName: "${aws_lambda_function.Fn_9270CBC0.arn}",
          // FunctionName: {
          //   "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
          // },
          "Payload.$": "$",
        },
        ResultSelector: {
          "Result.$": "$.output.Payload",
        },
        Retry: [
          {
            ErrorEquals: [
              "Lambda.ClientExecutionTimeoutException",
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException",
            ],
            IntervalSeconds: 2,
            MaxAttempts: 6,
            BackoffRate: 2,
          },
        ],
      }),
    );
  });

  test("invoke Lambda function and wait for task token", () => {
    // GIVEN
    const task = new LambdaInvoke(stack, "Task", {
      lambdaFunction,
      integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: compute.TaskInput.fromObject({
        token: compute.JsonPath.taskToken,
      }),
      qualifier: "my-alias",
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual(
      expect.objectContaining({
        Type: "Task",
        Resource:
          "arn:${data.aws_partition.Partitition.partition}:states:::lambda:invoke.waitForTaskToken",
        // Resource: {
        //   "Fn::Join": [
        //     "",
        //     [
        //       "arn:",
        //       {
        //         Ref: "AWS::Partition",
        //       },
        //       ":states:::lambda:invoke.waitForTaskToken",
        //     ],
        //   ],
        // },
        End: true,
        Parameters: {
          FunctionName: "${aws_lambda_function.Fn_9270CBC0.arn}",
          // FunctionName: {
          //   "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
          // },
          Payload: {
            "token.$": "$$.Task.Token",
          },
          Qualifier: "my-alias",
        },
      }),
    );
  });

  test("pass part of state input as input to Lambda function ", () => {
    // WHEN
    const task = new LambdaInvoke(stack, "Task", {
      lambdaFunction,
      payload: compute.TaskInput.fromJsonPathAt("$.foo"),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual(
      expect.objectContaining({
        Type: "Task",
        Resource:
          "arn:${data.aws_partition.Partitition.partition}:states:::lambda:invoke",
        // Resource: {
        //   "Fn::Join": [
        //     "",
        //     [
        //       "arn:",
        //       {
        //         Ref: "AWS::Partition",
        //       },
        //       ":states:::lambda:invoke",
        //     ],
        //   ],
        // },
        End: true,
        Parameters: {
          FunctionName: "${aws_lambda_function.Fn_9270CBC0.arn}",
          // FunctionName: {
          //   "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
          // },
          "Payload.$": "$.foo",
        },
      }),
    );
  });

  test("Invoke lambda with payloadResponseOnly", () => {
    // WHEN
    const task = new LambdaInvoke(stack, "Task", {
      lambdaFunction,
      payloadResponseOnly: true,
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual(
      expect.objectContaining({
        End: true,
        Type: "Task",
        Resource: "${aws_lambda_function.Fn_9270CBC0.arn}",
        // Resource: {
        //   "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
        // },
      }),
    );
  });

  test("Invoke lambda with payloadResponseOnly with payload", () => {
    // WHEN
    const task = new LambdaInvoke(stack, "Task", {
      lambdaFunction,
      payloadResponseOnly: true,
      payload: compute.TaskInput.fromObject({
        foo: "bar",
      }),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual(
      expect.objectContaining({
        End: true,
        Type: "Task",
        Resource: "${aws_lambda_function.Fn_9270CBC0.arn}",
        // Resource: {
        //   "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
        // },
        Parameters: {
          foo: "bar",
        },
      }),
    );
  });

  test("with retryOnServiceExceptions set to false", () => {
    // WHEN
    const task = new LambdaInvoke(stack, "Task", {
      lambdaFunction,
      retryOnServiceExceptions: false,
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      End: true,
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::lambda:invoke",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::lambda:invoke",
      //     ],
      //   ],
      // },
      Parameters: {
        FunctionName: "${aws_lambda_function.Fn_9270CBC0.arn}",
        // FunctionName: {
        //   "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
        // },
        "Payload.$": "$",
      },
    });
  });

  test("fails when integrationPattern used with payloadResponseOnly", () => {
    expect(() => {
      new LambdaInvoke(stack, "Task", {
        lambdaFunction,
        payloadResponseOnly: true,
        integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        payload: compute.TaskInput.fromObject({
          token: compute.JsonPath.taskToken,
        }),
      });
    }).toThrow(
      /The 'payloadResponseOnly' property cannot be used if 'integrationPattern', 'invocationType', 'clientContext', or 'qualifier' are specified./,
    );
  });

  test("fails when invocationType used with payloadResponseOnly", () => {
    expect(() => {
      new LambdaInvoke(stack, "Task", {
        lambdaFunction,
        payloadResponseOnly: true,
        payload: compute.TaskInput.fromObject({
          foo: "bar",
        }),
        invocationType: LambdaInvocationType.REQUEST_RESPONSE,
      });
    }).toThrow(
      /The 'payloadResponseOnly' property cannot be used if 'integrationPattern', 'invocationType', 'clientContext', or 'qualifier' are specified./,
    );
  });

  test("fails when clientContext used with payloadResponseOnly", () => {
    expect(() => {
      new LambdaInvoke(stack, "Task", {
        lambdaFunction,
        payloadResponseOnly: true,
        payload: compute.TaskInput.fromObject({
          foo: "bar",
        }),
        clientContext: "eyJoZWxsbyI6IndvcmxkIn0=",
      });
    }).toThrow(
      /The 'payloadResponseOnly' property cannot be used if 'integrationPattern', 'invocationType', 'clientContext', or 'qualifier' are specified./,
    );
  });

  test("fails when qualifier used with payloadResponseOnly", () => {
    expect(() => {
      new LambdaInvoke(stack, "Task", {
        lambdaFunction,
        payloadResponseOnly: true,
        payload: compute.TaskInput.fromObject({
          foo: "bar",
        }),
        qualifier: "1",
      });
    }).toThrow(
      /The 'payloadResponseOnly' property cannot be used if 'integrationPattern', 'invocationType', 'clientContext', or 'qualifier' are specified./,
    );
  });

  test("fails when WAIT_FOR_TASK_TOKEN integration pattern is used without supplying a task token in payload", () => {
    expect(() => {
      new LambdaInvoke(stack, "Task", {
        lambdaFunction,
        integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      });
    }).toThrow(
      /Task Token is required in `payload` for callback. Use JsonPath.taskToken to set the token./,
    );
  });

  test("fails when RUN_JOB integration pattern is used", () => {
    expect(() => {
      new LambdaInvoke(stack, "Task", {
        lambdaFunction,
        integrationPattern: compute.IntegrationPattern.RUN_JOB,
      });
    }).toThrow(
      /Unsupported service integration pattern. Supported Patterns: REQUEST_RESPONSE,WAIT_FOR_TASK_TOKEN. Received: RUN_JOB/,
    );
  });
});
