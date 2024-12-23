import { dataAwsIamPolicyDocument, sfnStateMachine } from "@cdktf/provider-aws";
// import * as cloudwatch from "../../aws-cloudwatch";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { FakeTask } from "./private/fake-task";
import { iam, compute, AwsStack } from "../../../src/aws";

const gridUUID = "123e4567-e89b-12d3";

describe("State Machine Resources", () => {
  let stack: AwsStack;
  beforeEach(() => {
    // GIVEN
    const app = Testing.app();
    stack = new AwsStack(app, `TestStack`, {
      environmentName: "Test",
      gridUUID,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
  });

  // TODO: CDK Deprecated sfn.Task in favour of strongly typed Task classes
  test("Tasks can add permissions to the execution role", () => {
    // GIVEN
    const task = new compute.Task(stack, "Task", {
      task: {
        bind: () => ({
          resourceArn: "resource",
          policyStatements: [
            new iam.PolicyStatement({
              actions: ["resource:Everything"],
              resources: ["resource"],
            }),
          ],
        }),
      },
    });

    // WHEN
    new compute.StateMachine(stack, "SM", {
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
            actions: ["resource:Everything"],
            effect: "Allow",
            resources: ["resource"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Version: "2012-10-17",
    //     Statement: [
    //       {
    //         Action: "resource:Everything",
    //         Effect: "Allow",
    //         Resource: "resource",
    //       },
    //     ],
    //   },
    // });
  });

  test("Tasks hidden inside a Parallel state are also included", () => {
    // GIVEN
    const task = new FakeTask(stack, "Task", {
      policies: [
        new iam.PolicyStatement({
          actions: ["resource:Everything"],
          resources: ["resource"],
        }),
      ],
    });

    const para = new compute.Parallel(stack, "Para");
    para.branch(task);

    // WHEN
    new compute.StateMachine(stack, "SM", {
      definitionBody: compute.DefinitionBody.fromChainable(para),
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
            actions: ["resource:Everything"],
            effect: "Allow",
            resources: ["resource"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Version: "2012-10-17",
    //     Statement: [
    //       {
    //         Action: "resource:Everything",
    //         Effect: "Allow",
    //         Resource: "resource",
    //       },
    //     ],
    //   },
    // });
  });

  test("Fail should render ErrorPath / CausePath correctly", () => {
    // GIVEN
    const fail = new compute.Fail(stack, "Fail", {
      errorPath: compute.JsonPath.stringAt("$.error"),
      causePath: compute.JsonPath.stringAt("$.cause"),
    });

    // WHEN
    const failState = stack.resolve(fail.toStateJson());

    // THEN
    expect(failState).toStrictEqual({
      CausePath: "$.cause",
      ErrorPath: "$.error",
      Type: "Fail",
    });
  });

  test.each([
    [
      "States.Format('error: {}.', $.error)",
      "States.Format('cause: {}.', $.cause)",
    ],
    [
      compute.JsonPath.format(
        "error: {}.",
        compute.JsonPath.stringAt("$.error"),
      ),
      compute.JsonPath.format(
        "cause: {}.",
        compute.JsonPath.stringAt("$.cause"),
      ),
    ],
  ])(
    "Fail should render ErrorPath / CausePath correctly when specifying ErrorPath / CausePath using intrinsics",
    (errorPath, causePath) => {
      // GIVEN
      const fail = new compute.Fail(stack, "Fail", {
        errorPath,
        causePath,
      });

      // WHEN
      const failState = stack.resolve(fail.toStateJson());

      // THEN
      expect(failState).toStrictEqual({
        CausePath: "States.Format('cause: {}.', $.cause)",
        ErrorPath: "States.Format('error: {}.', $.error)",
        Type: "Fail",
      });
      expect(() => Testing.synth(stack, true)).not.toThrow();
    },
  );

  test("fails in synthesis if error and errorPath are defined in Fail state", () => {
    // WHEN
    new compute.Fail(stack, "Fail", {
      error: "error",
      errorPath: "$.error",
    });

    expect(() => Testing.synth(stack, true)).toThrow(
      /Fail state cannot have both error and errorPath/,
    );
  });

  test("fails in synthesis if cause and causePath are defined in Fail state", () => {
    // WHEN
    new compute.Fail(stack, "Fail", {
      cause: "cause",
      causePath: "$.cause",
    });

    expect(() => Testing.synth(stack, true)).toThrow(
      /Fail state cannot have both cause and causePath/,
    );
  });

  test.each([
    "States.Array($.Id)",
    "States.ArrayPartition($.inputArray, 4)",
    "States.ArrayContains($.inputArray, $.lookingFor)",
    "States.ArrayRange(1, 9, 2)",
    "States.ArrayLength($.inputArray)",
    "States.JsonMerge($.json1, $.json2, false)",
    "States.StringToJson($.escapedJsonString)",
    "plainString",
  ])(
    "fails in synthesis if specifying invalid intrinsic functions in the causePath and errorPath (%s)",
    (intrinsic) => {
      // WHEN
      new compute.Fail(stack, "Fail", {
        causePath: intrinsic,
        errorPath: intrinsic,
      });

      expect(() => Testing.synth(stack, true)).toThrow(
        /You must specify a valid intrinsic function in causePath. Must be one of States.Format, States.JsonToString, States.ArrayGetItem, States.Base64Encode, States.Base64Decode, States.Hash, States.UUID/,
      );
      expect(() => Testing.synth(stack, true)).toThrow(
        /You must specify a valid intrinsic function in errorPath. Must be one of States.Format, States.JsonToString, States.ArrayGetItem, States.Base64Encode, States.Base64Decode, States.Hash, States.UUID/,
      );
    },
  );

  // TODO: CDK Deprecated sfn.Task in favour of strongly typed Task classes
  test("Task should render InputPath / Parameters / OutputPath correctly", () => {
    // GIVEN
    const task = new compute.Task(stack, "Task", {
      inputPath: "$",
      outputPath: "$.state",
      task: {
        bind: () => ({
          resourceArn: "resource",
          parameters: {
            "input.$": "$",
            stringArgument: "inital-task",
            numberArgument: 123,
            booleanArgument: true,
            arrayArgument: ["a", "b", "c"],
          },
        }),
      },
    });

    // WHEN
    const taskState = task.toStateJson();

    // THEN
    expect(taskState).toStrictEqual({
      End: true,
      Retry: undefined,
      Catch: undefined,
      InputPath: "$",
      Parameters: {
        "input.$": "$",
        stringArgument: "inital-task",
        numberArgument: 123,
        booleanArgument: true,
        arrayArgument: ["a", "b", "c"],
      },
      OutputPath: "$.state",
      Type: "Task",
      Comment: undefined,
      Resource: "resource",
      ResultPath: undefined,
      TimeoutSeconds: undefined,
      HeartbeatSeconds: undefined,
    });
  });

  // TODO: CDK Deprecated sfn.Task in favour of strongly typed Task classes
  test("Task combines taskobject parameters with direct parameters", () => {
    // GIVEN
    const task = new compute.Task(stack, "Task", {
      inputPath: "$",
      outputPath: "$.state",
      task: {
        bind: () => ({
          resourceArn: "resource",
          parameters: {
            a: "aa",
          },
        }),
      },
      parameters: {
        b: "bb",
      },
    });

    // WHEN
    const taskState = task.toStateJson();

    // THEN
    expect(taskState).toStrictEqual({
      End: true,
      Retry: undefined,
      Catch: undefined,
      InputPath: "$",
      Parameters: {
        a: "aa",
        b: "bb",
      },
      OutputPath: "$.state",
      Type: "Task",
      Comment: undefined,
      Resource: "resource",
      ResultPath: undefined,
      TimeoutSeconds: undefined,
      HeartbeatSeconds: undefined,
    });
  });

  test("Created state machine can grant start execution to a role", () => {
    // GIVEN
    const task = new FakeTask(stack, "Task");
    const stateMachine = new compute.StateMachine(stack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grantStartExecution(role);

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
            actions: ["states:StartExecution"],
            effect: "Allow",
            resources: ["${aws_sfn_state_machine.StateMachine_2E01A3A5.arn}"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: Match.arrayWith([
    //       Match.objectLike({
    //         Action: "states:StartExecution",
    //         Effect: "Allow",
    //         Resource: {
    //           Ref: "StateMachine2E01A3A5",
    //         },
    //       }),
    //     ]),
    //   },
    // });
  });

  test("Created state machine can grant start sync execution to a role", () => {
    // GIVEN
    const task = new FakeTask(stack, "Task");
    const stateMachine = new compute.StateMachine(stack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
      stateMachineType: compute.StateMachineType.EXPRESS,
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grantStartSyncExecution(role);

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
            actions: ["states:StartSyncExecution"],
            effect: "Allow",
            resources: ["${aws_sfn_state_machine.StateMachine_2E01A3A5.arn}"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: Match.arrayWith([
    //       Match.objectLike({
    //         Action: "states:StartSyncExecution",
    //         Effect: "Allow",
    //         Resource: {
    //           Ref: "StateMachine2E01A3A5",
    //         },
    //       }),
    //     ]),
    //   },
    // });
  });

  test("Created state machine can grant read access to a role", () => {
    // GIVEN
    const task = new FakeTask(stack, "Task");
    const stateMachine = new compute.StateMachine(stack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grantRead(role);

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
            actions: ["states:ListExecutions", "states:ListStateMachines"],
            effect: "Allow",
            resources: ["${aws_sfn_state_machine.StateMachine_2E01A3A5.arn}"],
          },
          {
            actions: [
              "states:DescribeExecution",
              "states:DescribeStateMachineForExecution",
              "states:GetExecutionHistory",
            ],
            effect: "Allow",
            resources: [
              'arn:${data.aws_partition.Partitition.partition}:states:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:execution:${element(split(":", aws_sfn_state_machine.StateMachine_2E01A3A5.arn), 6)}:*',
            ],
          },
          {
            actions: [
              "states:ListActivities",
              "states:DescribeStateMachine",
              "states:DescribeActivity",
            ],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: ["states:ListExecutions", "states:ListStateMachines"],
    //         Effect: "Allow",
    //         Resource: {
    //           Ref: "StateMachine2E01A3A5",
    //         },
    //       },
    //       {
    //         Action: [
    //           "states:DescribeExecution",
    //           "states:DescribeStateMachineForExecution",
    //           "states:GetExecutionHistory",
    //         ],
    //         Effect: "Allow",
    //         Resource: {
    //           "Fn::Join": [
    //             "",
    //             [
    //               "arn:",
    //               {
    //                 Ref: "AWS::Partition",
    //               },
    //               ":states:",
    //               {
    //                 Ref: "AWS::Region",
    //               },
    //               ":",
    //               {
    //                 Ref: "AWS::AccountId",
    //               },
    //               ":execution:",
    //               {
    //                 "Fn::Select": [
    //                   6,
    //                   {
    //                     "Fn::Split": [
    //                       ":",
    //                       {
    //                         Ref: "StateMachine2E01A3A5",
    //                       },
    //                     ],
    //                   },
    //                 ],
    //               },
    //               ":*",
    //             ],
    //           ],
    //         },
    //       },
    //       {
    //         Action: [
    //           "states:ListActivities",
    //           "states:DescribeStateMachine",
    //           "states:DescribeActivity",
    //         ],
    //         Effect: "Allow",
    //         Resource: "*",
    //       },
    //     ],
    //   },
    // });
  });

  test("Created state machine can grant task response actions to the state machine", () => {
    // GIVEN
    const task = new FakeTask(stack, "Task");
    const stateMachine = new compute.StateMachine(stack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grantTaskResponse(role);

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
            actions: [
              "states:SendTaskSuccess",
              "states:SendTaskFailure",
              "states:SendTaskHeartbeat",
            ],
            effect: "Allow",
            resources: ["${aws_sfn_state_machine.StateMachine_2E01A3A5.arn}"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: [
    //           "states:SendTaskSuccess",
    //           "states:SendTaskFailure",
    //           "states:SendTaskHeartbeat",
    //         ],
    //         Effect: "Allow",
    //         Resource: {
    //           Ref: "StateMachine2E01A3A5",
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("Created state machine can grant actions to the executions", () => {
    // GIVEN
    const task = new FakeTask(stack, "Task");
    const stateMachine = new compute.StateMachine(stack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grantExecution(role, "states:GetExecutionHistory");

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
            actions: ["states:GetExecutionHistory"],
            effect: "Allow",
            resources: [
              'arn:${data.aws_partition.Partitition.partition}:states:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:execution:${element(split(":", aws_sfn_state_machine.StateMachine_2E01A3A5.arn), 6)}:*',
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: "states:GetExecutionHistory",
    //         Effect: "Allow",
    //         Resource: {
    //           "Fn::Join": [
    //             "",
    //             [
    //               "arn:",
    //               {
    //                 Ref: "AWS::Partition",
    //               },
    //               ":states:",
    //               {
    //                 Ref: "AWS::Region",
    //               },
    //               ":",
    //               {
    //                 Ref: "AWS::AccountId",
    //               },
    //               ":execution:",
    //               {
    //                 "Fn::Select": [
    //                   6,
    //                   {
    //                     "Fn::Split": [
    //                       ":",
    //                       {
    //                         Ref: "StateMachine2E01A3A5",
    //                       },
    //                     ],
    //                   },
    //                 ],
    //               },
    //               ":*",
    //             ],
    //           ],
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("Created state machine can grant actions to a role", () => {
    // GIVEN
    const task = new FakeTask(stack, "Task");
    const stateMachine = new compute.StateMachine(stack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grant(role, "states:ListExecution");

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
            actions: ["states:ListExecution"],
            effect: "Allow",
            resources: ["${aws_sfn_state_machine.StateMachine_2E01A3A5.arn}"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: "states:ListExecution",
    //         Effect: "Allow",
    //         Resource: {
    //           Ref: "StateMachine2E01A3A5",
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("Imported state machine can grant start execution to a role", () => {
    // GIVEN
    const stateMachineArn = "arn:aws:states:::my-state-machine";
    const stateMachine = compute.StateMachine.fromStateMachineArn(
      stack,
      "StateMachine",
      stateMachineArn,
    );
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grantStartExecution(role);

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
            actions: ["states:StartExecution"],
            effect: "Allow",
            resources: ["arn:aws:states:::my-state-machine"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: "states:StartExecution",
    //         Effect: "Allow",
    //         Resource: stateMachineArn,
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   PolicyName: "RoleDefaultPolicy5FFB7DAB",
    //   Roles: [
    //     {
    //       Ref: "Role1ABCC5F0",
    //     },
    //   ],
    // });
  });

  test("Imported state machine can grant read access to a role", () => {
    // GIVEN
    const stateMachineArn = "arn:aws:states:::my-state-machine";
    const stateMachine = compute.StateMachine.fromStateMachineArn(
      stack,
      "StateMachine",
      stateMachineArn,
    );
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grantRead(role);

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
            actions: ["states:ListExecutions", "states:ListStateMachines"],
            effect: "Allow",
            resources: ["arn:aws:states:::my-state-machine"],
          },
          {
            actions: [
              "states:DescribeExecution",
              "states:DescribeStateMachineForExecution",
              "states:GetExecutionHistory",
            ],
            effect: "Allow",
            resources: [
              "arn:${data.aws_partition.Partitition.partition}:states:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:execution:*",
            ],
          },
          {
            actions: [
              "states:ListActivities",
              "states:DescribeStateMachine",
              "states:DescribeActivity",
            ],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: ["states:ListExecutions", "states:ListStateMachines"],
    //         Effect: "Allow",
    //         Resource: stateMachineArn,
    //       },
    //       {
    //         Action: [
    //           "states:DescribeExecution",
    //           "states:DescribeStateMachineForExecution",
    //           "states:GetExecutionHistory",
    //         ],
    //         Effect: "Allow",
    //         Resource: {
    //           "Fn::Join": [
    //             "",
    //             [
    //               "arn:",
    //               {
    //                 Ref: "AWS::Partition",
    //               },
    //               ":states:",
    //               {
    //                 Ref: "AWS::Region",
    //               },
    //               ":",
    //               {
    //                 Ref: "AWS::AccountId",
    //               },
    //               ":execution:*",
    //             ],
    //           ],
    //         },
    //       },
    //       {
    //         Action: [
    //           "states:ListActivities",
    //           "states:DescribeStateMachine",
    //           "states:DescribeActivity",
    //         ],
    //         Effect: "Allow",
    //         Resource: "*",
    //       },
    //     ],
    //   },
    // });
  });

  test("Imported state machine can task response permissions to the state machine", () => {
    // GIVEN
    const stateMachineArn = "arn:aws:states:::my-state-machine";
    const stateMachine = compute.StateMachine.fromStateMachineArn(
      stack,
      "StateMachine",
      stateMachineArn,
    );
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grantTaskResponse(role);

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
            actions: [
              "states:SendTaskSuccess",
              "states:SendTaskFailure",
              "states:SendTaskHeartbeat",
            ],
            effect: "Allow",
            resources: ["arn:aws:states:::my-state-machine"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: [
    //           "states:SendTaskSuccess",
    //           "states:SendTaskFailure",
    //           "states:SendTaskHeartbeat",
    //         ],
    //         Effect: "Allow",
    //         Resource: stateMachineArn,
    //       },
    //     ],
    //   },
    // });
  });

  test("Imported state machine can grant access to a role", () => {
    // GIVEN
    const stateMachineArn = "arn:aws:states:::my-state-machine";
    const stateMachine = compute.StateMachine.fromStateMachineArn(
      stack,
      "StateMachine",
      stateMachineArn,
    );
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    stateMachine.grant(role, "states:ListExecution");

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
            actions: ["states:ListExecution"],
            effect: "Allow",
            resources: ["arn:aws:states:::my-state-machine"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: "states:ListExecution",
    //         Effect: "Allow",
    //         Resource: stateMachine.stateMachineArn,
    //       },
    //     ],
    //   },
    // });
  });

  // test("Imported state machine can provide metrics", () => {
  //   // GIVEN
  //   const stateMachineArn =
  //     "arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine";
  //   const stateMachine = compute.StateMachine.fromStateMachineArn(
  //     stack,
  //     "StateMachine",
  //     stateMachineArn,
  //   );
  //   const color = "#00ff00";

  //   // WHEN
  //   const metrics = new Array<cloudwatch.Metric>();
  //   metrics.push(stateMachine.metricAborted({ color }));
  //   metrics.push(stateMachine.metricFailed({ color }));
  //   metrics.push(stateMachine.metricStarted({ color }));
  //   metrics.push(stateMachine.metricSucceeded({ color }));
  //   metrics.push(stateMachine.metricThrottled({ color }));
  //   metrics.push(stateMachine.metricTime({ color }));
  //   metrics.push(stateMachine.metricTimedOut({ color }));

  //   // THEN
  //   for (const metric of metrics) {
  //     expect(metric.namespace).toEqual("AWS/States");
  //     expect(metric.dimensions).toEqual({ StateMachineArn: stateMachineArn });
  //     expect(metric.color).toEqual(color);
  //   }
  // });

  test("Pass should render InputPath / Parameters / OutputPath correctly", () => {
    // GIVEN
    const task = new compute.Pass(stack, "Pass", {
      stateName: "my-pass-state",
      inputPath: "$",
      outputPath: "$.state",
      parameters: {
        "input.$": "$",
        stringArgument: "inital-task",
        numberArgument: 123,
        booleanArgument: true,
        arrayArgument: ["a", "b", "c"],
      },
    });

    // WHEN
    const taskState = task.toStateJson();

    // THEN
    expect(taskState).toStrictEqual({
      End: true,
      InputPath: "$",
      OutputPath: "$.state",
      Parameters: {
        "input.$": "$",
        stringArgument: "inital-task",
        numberArgument: 123,
        booleanArgument: true,
        arrayArgument: ["a", "b", "c"],
      },
      Type: "Pass",
      Comment: undefined,
      Result: undefined,
      ResultPath: undefined,
    });
  });

  test("parameters can be selected from the input with a path", () => {
    // GIVEN
    const task = new compute.Pass(stack, "Pass", {
      parameters: {
        input: compute.JsonPath.stringAt("$.myField"),
      },
    });

    // WHEN
    const taskState = task.toStateJson();

    // THEN
    expect(taskState).toEqual({
      End: true,
      Parameters: { "input.$": "$.myField" },
      Type: "Pass",
    });
  });

  test("State machines must depend on their roles", () => {
    // GIVEN
    const task = new FakeTask(stack, "Task", {
      policies: [
        new iam.PolicyStatement({
          resources: ["resource"],
          actions: ["lambda:InvokeFunction"],
        }),
      ],
    });
    new compute.StateMachine(stack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        depends_on: [
          "data.aws_iam_policy_document.StateMachine_Role_AssumeRolePolicy_8578B18E",
          "aws_iam_role.StateMachine_Role_B840431D",
          "data.aws_iam_policy_document.StateMachine_Role_DefaultPolicy_536E7ACB",
          "aws_iam_role_policy.StateMachine_Role_DefaultPolicy_ResourceRoles0_0500EB10",
        ],
      },
    );
    // Template.fromStack(stack).hasResource("AWS::StepFunctions::StateMachine", {
    //   DependsOn: [
    //     "StateMachineRoleDefaultPolicyDF1E6607",
    //     "StateMachineRoleB840431D",
    //   ],
    // });
  });
});
