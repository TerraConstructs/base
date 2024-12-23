import "cdktf/lib/testing/adapters/jest";
import { Testing } from "cdktf";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import * as compute from "../../../../../src/aws/compute";
import { SqsSendMessage } from "../../../../../src/aws/compute/tasks/sqs/send-message";
import * as notify from "../../../../../src/aws/notify";
import { Duration } from "../../../../../src/duration";

describe("SqsSendMessage", () => {
  let stack: AwsStack;
  let queue: notify.Queue;

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
    queue = new notify.Queue(stack, "Queue");
  });

  test("default settings", () => {
    // WHEN
    const task = new SqsSendMessage(stack, "SendMessage", {
      queue,
      messageBody: compute.TaskInput.fromText("a simple message"),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::sqs:sendMessage",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::sqs:sendMessage",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        QueueUrl: "${aws_sqs_queue.Queue_4A7E3555.url}",
        // QueueUrl: { Ref: "Queue4A7E3555" },
        MessageBody: "a simple message",
      },
    });
  });

  test("send message with deduplication and delay", () => {
    // WHEN
    const task = new SqsSendMessage(stack, "Send", {
      queue,
      messageBody: compute.TaskInput.fromText("Send this message"),
      messageDeduplicationId: compute.JsonPath.stringAt("$.deduping"),
      comment: "sending a message to my SQS queue",
      delay: Duration.seconds(30),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::sqs:sendMessage",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::sqs:sendMessage",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        QueueUrl: "${aws_sqs_queue.Queue_4A7E3555.url}",
        // QueueUrl: { Ref: "Queue4A7E3555" },
        MessageBody: "Send this message",
        "MessageDeduplicationId.$": "$.deduping",
        DelaySeconds: 30,
      },
      Comment: "sending a message to my SQS queue",
    });
  });

  test("send message to SQS and wait for task token", () => {
    // WHEN
    const task = new SqsSendMessage(stack, "Send", {
      queue,
      integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      messageBody: compute.TaskInput.fromObject({
        Input: "Send this message",
        Token: compute.JsonPath.taskToken,
      }),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::sqs:sendMessage.waitForTaskToken",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::sqs:sendMessage.waitForTaskToken",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        QueueUrl: "${aws_sqs_queue.Queue_4A7E3555.url}",
        // QueueUrl: { Ref: "Queue4A7E3555" },
        MessageBody: {
          Input: "Send this message",
          "Token.$": "$$.Task.Token",
        },
      },
    });
  });

  test("Message body can come from state", () => {
    // WHEN
    const task = new SqsSendMessage(stack, "Send", {
      queue,
      messageBody: compute.TaskInput.fromJsonPathAt("$.theMessage"),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::sqs:sendMessage",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::sqs:sendMessage",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        QueueUrl: "${aws_sqs_queue.Queue_4A7E3555.url}",
        // QueueUrl: { Ref: "Queue4A7E3555" },
        "MessageBody.$": "$.theMessage",
      },
    });
  });

  test("send message with message body defined as an object", () => {
    // WHEN
    const task = new SqsSendMessage(stack, "Send", {
      queue,
      messageBody: compute.TaskInput.fromObject({
        literal: "literal",
        SomeInput: compute.JsonPath.stringAt("$.theMessage"),
      }),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::sqs:sendMessage",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::sqs:sendMessage",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        QueueUrl: "${aws_sqs_queue.Queue_4A7E3555.url}",
        // QueueUrl: { Ref: "Queue4A7E3555" },
        MessageBody: {
          literal: "literal",
          "SomeInput.$": "$.theMessage",
        },
      },
    });
  });

  test("message body can use references", () => {
    // WHEN
    const task = new SqsSendMessage(stack, "Send", {
      queue,
      messageBody: compute.TaskInput.fromObject({
        queueArn: queue.queueArn,
      }),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::sqs:sendMessage",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::sqs:sendMessage",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        QueueUrl: "${aws_sqs_queue.Queue_4A7E3555.url}",
        // QueueUrl: { Ref: "Queue4A7E3555" },
        MessageBody: {
          queueArn: "${aws_sqs_queue.Queue_4A7E3555.arn}",
          // queueArn: { "Fn::GetAtt": ["Queue4A7E3555", "Arn"] },
        },
      },
    });
  });

  test("fails when WAIT_FOR_TASK_TOKEN integration pattern is used without supplying a task token in message body", () => {
    expect(() => {
      new SqsSendMessage(stack, "Send", {
        queue,
        integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        messageBody: compute.TaskInput.fromText("Send this message"),
      });
    }).toThrow(
      /Task Token is required in `messageBody` Use JsonPath.taskToken to set the token./,
    );
  });

  test("fails when RUN_JOB integration pattern is used", () => {
    expect(() => {
      new SqsSendMessage(stack, "Send", {
        queue,
        integrationPattern: compute.IntegrationPattern.RUN_JOB,
        messageBody: compute.TaskInput.fromText("Send this message"),
      });
    }).toThrow(
      /Unsupported service integration pattern. Supported Patterns: REQUEST_RESPONSE,WAIT_FOR_TASK_TOKEN. Received: RUN_JOB/,
    );
  });
});
