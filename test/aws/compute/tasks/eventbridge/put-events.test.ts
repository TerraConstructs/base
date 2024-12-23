import { dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import "cdktf/lib/testing/adapters/jest";
import { Testing } from "cdktf";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import * as compute from "../../../../../src/aws/compute";
import { EventBridgePutEvents } from "../../../../../src/aws/compute/tasks/eventbridge/put-events";
import * as notify from "../../../../../src/aws/notify";

describe("Put Events", () => {
  let stack: AwsStack;

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
  });

  test("provided all parameters", () => {
    // WHEN
    const task = new EventBridgePutEvents(stack, "PutEvents", {
      entries: [
        {
          detail: compute.TaskInput.fromText("MyDetail"),
          detailType: "MyDetailType",
          source: "my.source",
        },
      ],
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::events:putEvents",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::events:putEvents",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        Entries: [
          {
            Detail: "MyDetail",
            DetailType: "MyDetailType",
            Source: "my.source",
          },
        ],
      },
    });
  });

  test("provided detail as object", () => {
    // WHEN
    const task = new EventBridgePutEvents(stack, "PutEvents", {
      entries: [
        {
          detail: compute.TaskInput.fromObject({
            Message: "MyDetailMessage",
          }),
          detailType: "MyDetailType",
          source: "my.source",
        },
      ],
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::events:putEvents",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::events:putEvents",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        Entries: [
          {
            Detail: {
              Message: "MyDetailMessage",
            },
            DetailType: "MyDetailType",
            Source: "my.source",
          },
        ],
      },
    });
  });

  test("wait for task token", () => {
    // WHEN
    const task = new EventBridgePutEvents(stack, "PutEvents", {
      integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      entries: [
        {
          detail: compute.TaskInput.fromObject({
            Message: "MyDetailMessage",
            Token: compute.JsonPath.taskToken,
          }),
          detailType: "MyDetailType",
          source: "my.source",
        },
      ],
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::events:putEvents.waitForTaskToken",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::events:putEvents.waitForTaskToken",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        Entries: [
          {
            Detail: {
              Message: "MyDetailMessage",
              "Token.$": "$$.Task.Token",
            },
            DetailType: "MyDetailType",
            Source: "my.source",
          },
        ],
      },
    });
  });

  test("fails when WAIT_FOR_TASK_TOKEN integration pattern is used without supplying a task token in entries", () => {
    expect(() => {
      // WHEN
      new EventBridgePutEvents(stack, "PutEvents", {
        integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        entries: [
          {
            detail: compute.TaskInput.fromText("MyDetail"),
            detailType: "MyDetailType",
            source: "my.source",
          },
        ],
      });
      // THEN
    }).toThrowError(
      "Task Token is required in `entries`. Use JsonPath.taskToken to set the token.",
    );
  });

  test("fails when RUN_JOB integration pattern is used", () => {
    expect(() => {
      // WHEN
      new EventBridgePutEvents(stack, "PutEvents", {
        integrationPattern: compute.IntegrationPattern.RUN_JOB,
        entries: [
          {
            detail: compute.TaskInput.fromText("MyDetail"),
            detailType: "MyDetailType",
            source: "my.source",
          },
        ],
      });
      // THEN
    }).toThrowError("Unsupported service integration pattern");
  });

  test('event source cannot start with "aws."', () => {
    expect(() => {
      new EventBridgePutEvents(stack, "PutEvents", {
        entries: [
          {
            detail: compute.TaskInput.fromText("MyDetail"),
            detailType: "MyDetailType",
            source: "aws.source",
          },
        ],
      });
    }).toThrow(/Event source cannot start with "aws."/);
  });

  test('event source can start with "aws" without trailing dot', () => {
    expect(() => {
      new EventBridgePutEvents(stack, "PutEvents", {
        entries: [
          {
            detail: compute.TaskInput.fromText("MyDetail"),
            detailType: "MyDetailType",
            source: "awssource",
          },
        ],
      });
    }).not.toThrow(/Event source cannot start with "aws."/);
  });

  test("provided EventBus", () => {
    // GIVEN
    const eventBus = new notify.EventBus(stack, "EventBus");

    // WHEN
    const task = new EventBridgePutEvents(stack, "PutEvents", {
      entries: [
        {
          eventBus,
          detail: compute.TaskInput.fromText("MyDetail"),
          detailType: "MyDetailType",
          source: "my.source",
        },
      ],
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::events:putEvents",

      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::events:putEvents",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        Entries: [
          {
            EventBusName: "${aws_cloudwatch_event_bus.EventBus_7B8748AA.arn}",
            // EventBusName: {
            //   "Fn::GetAtt": ["EventBus7B8748AA", "Arn"],
            // },
            Detail: "MyDetail",
            DetailType: "MyDetailType",
            Source: "my.source",
          },
        ],
      },
    });
  });

  test("fails when provided an empty array for entries", () => {
    expect(() => {
      // WHEN
      new EventBridgePutEvents(stack, "PutEvents", {
        entries: [],
      });
    })
      // THEN
      .toThrowError("Value for property `entries` must be a non-empty array.");
  });

  test("Validate task policy", () => {
    // GIVEN
    const bus = new notify.EventBus(stack, "EventBus");

    // WHEN
    const task = new EventBridgePutEvents(stack, "PutEvents", {
      entries: [
        {
          detail: compute.TaskInput.fromText("MyDetail"),
          detailType: "MyDetailType",
          source: "my.source",
          eventBus: bus,
        },
        {
          detail: compute.TaskInput.fromText("MyDetail2"),
          detailType: "MyDetailType",
          source: "my.source",
        },
      ],
    });
    new compute.StateMachine(stack, "State Machine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["events:PutEvents"],
            effect: "Allow",
            resources: [
              "${aws_cloudwatch_event_bus.EventBus_7B8748AA.arn}",
              "arn:${data.aws_partition.Partitition.partition}:events:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:event-bus/default",
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: "events:PutEvents",
    //         Effect: "Allow",
    //         Resource: [
    //           {
    //             "Fn::GetAtt": ["EventBus7B8748AA", "Arn"],
    //           },
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 "arn:",
    //                 { Ref: "AWS::Partition" },
    //                 ":events:",
    //                 { Ref: "AWS::Region" },
    //                 ":",
    //                 { Ref: "AWS::AccountId" },
    //                 ":event-bus/default",
    //               ],
    //             ],
    //           },
    //         ],
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   Roles: [
    //     {
    //       Ref: "StateMachineRole543B9670",
    //     },
    //   ],
    // });
  });
});
