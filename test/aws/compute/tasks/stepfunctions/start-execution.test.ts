import { dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import "cdktf/lib/testing/adapters/jest";
import { Testing } from "cdktf";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import * as compute from "../../../../../src/aws/compute";
import { StepFunctionsStartExecution } from "../../../../../src/aws/compute/tasks/stepfunctions/start-execution";

let stack: AwsStack;
let child: compute.StateMachine;
beforeEach(() => {
  const app = Testing.app();
  stack = new AwsStack(app, "TestStack", {
    environmentName: "Test",
    gridUUID: "123e4567-e89b-12d3",
    providerConfig: { region: "us-east-1" },
    gridBackendConfig: {
      address: "http://localhost:3000",
    },
  });
  child = new compute.StateMachine(stack, "ChildStateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(
      compute.Chain.start(new compute.Pass(stack, "PassState")),
    ),
  });
});

test("Execute State Machine - Default - Request Response", () => {
  const task = new StepFunctionsStartExecution(stack, "ChildTask", {
    stateMachine: child,
    input: compute.TaskInput.fromObject({
      foo: "bar",
    }),
    name: "myExecutionName",
  });

  new compute.StateMachine(stack, "ParentStateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
  });

  expect(stack.resolve(task.toStateJson())).toEqual({
    Type: "Task",
    Resource:
      "arn:${data.aws_partition.Partitition.partition}:states:::states:startExecution",
    // Resource: {
    //   "Fn::Join": [
    //     "",
    //     [
    //       "arn:",
    //       {
    //         Ref: "AWS::Partition",
    //       },
    //       ":states:::states:startExecution",
    //     ],
    //   ],
    // },
    End: true,
    Parameters: {
      Input: {
        foo: "bar",
      },
      Name: "myExecutionName",
      StateMachineArn:
        "${aws_sfn_state_machine.ChildStateMachine_9133117F.arn}",
      // StateMachineArn: {
      //   Ref: "ChildStateMachine9133117F",
      // },
    },
  });
});

test("Execute State Machine - Run Job", () => {
  const task = new StepFunctionsStartExecution(stack, "ChildTask", {
    stateMachine: child,
    integrationPattern: compute.IntegrationPattern.RUN_JOB,
  });

  new compute.StateMachine(stack, "ParentStateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
  });

  expect(stack.resolve(task.toStateJson())).toEqual({
    Type: "Task",
    Resource:
      "arn:${data.aws_partition.Partitition.partition}:states:::states:startExecution.sync:2",
    // Resource: {
    //   "Fn::Join": [
    //     "",
    //     [
    //       "arn:",
    //       {
    //         Ref: "AWS::Partition",
    //       },
    //       ":states:::states:startExecution.sync:2",
    //     ],
    //   ],
    // },
    End: true,
    Parameters: {
      "Input.$": "$",
      StateMachineArn:
        "${aws_sfn_state_machine.ChildStateMachine_9133117F.arn}",
      // StateMachineArn: {
      //   Ref: "ChildStateMachine9133117F",
      // },
    },
  });

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
          resources: [
            "${aws_sfn_state_machine.ChildStateMachine_9133117F.arn}",
          ],
        },
        {
          actions: ["states:DescribeExecution", "states:StopExecution"],
          effect: "Allow",
          resources: [
            'arn:${data.aws_partition.Partitition.partition}:states:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:execution:${element(split(":", aws_sfn_state_machine.ChildStateMachine_9133117F.arn), 6)}*',
          ],
        },
        {
          actions: [
            "events:PutTargets",
            "events:PutRule",
            "events:DescribeRule",
          ],
          effect: "Allow",
          resources: [
            "arn:${data.aws_partition.Partitition.partition}:events:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule",
          ],
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
  //         Resource: {
  //           Ref: "ChildStateMachine9133117F",
  //         },
  //       },
  //       {
  //         Action: ["states:DescribeExecution", "states:StopExecution"],
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
  //                         Ref: "ChildStateMachine9133117F",
  //                       },
  //                     ],
  //                   },
  //                 ],
  //               },
  //               "*",
  //             ],
  //           ],
  //         },
  //       },
  //       {
  //         Action: [
  //           "events:PutTargets",
  //           "events:PutRule",
  //           "events:DescribeRule",
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
  //               ":events:",
  //               {
  //                 Ref: "AWS::Region",
  //               },
  //               ":",
  //               {
  //                 Ref: "AWS::AccountId",
  //               },
  //               ":rule/StepFunctionsGetEventsForStepFunctionsExecutionRule",
  //             ],
  //           ],
  //         },
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  //   Roles: [
  //     {
  //       Ref: "ParentStateMachineRoleE902D002",
  //     },
  //   ],
  // });
});

test("Execute State Machine - Wait For Task Token", () => {
  const task = new StepFunctionsStartExecution(stack, "ChildTask", {
    stateMachine: child,
    integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    input: compute.TaskInput.fromObject({
      token: compute.JsonPath.taskToken,
    }),
  });

  new compute.StateMachine(stack, "ParentStateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
  });

  expect(stack.resolve(task.toStateJson())).toEqual({
    Type: "Task",
    Resource:
      "arn:${data.aws_partition.Partitition.partition}:states:::states:startExecution.waitForTaskToken",
    // Resource: {
    //   "Fn::Join": [
    //     "",
    //     [
    //       "arn:",
    //       {
    //         Ref: "AWS::Partition",
    //       },
    //       ":states:::states:startExecution.waitForTaskToken",
    //     ],
    //   ],
    // },
    End: true,
    Parameters: {
      Input: {
        "token.$": "$$.Task.Token",
      },
      StateMachineArn:
        "${aws_sfn_state_machine.ChildStateMachine_9133117F.arn}",
      // StateMachineArn: {
      //   Ref: "ChildStateMachine9133117F",
      // },
    },
  });
});

test("Execute State Machine - Wait For Task Token - Missing Task Token", () => {
  expect(() => {
    new StepFunctionsStartExecution(stack, "ChildTask", {
      stateMachine: child,
      integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });
  }).toThrow(
    "Task Token is required in `input` for callback. Use JsonPath.taskToken to set the token.",
  );
});

test("Execute State Machine - Associate With Parent - Input Provided", () => {
  const task = new StepFunctionsStartExecution(stack, "ChildTask", {
    stateMachine: child,
    input: compute.TaskInput.fromObject({
      token: compute.JsonPath.taskToken,
    }),
    associateWithParent: true,
  });

  new compute.StateMachine(stack, "ParentStateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
  });

  expect(stack.resolve(task.toStateJson())).toMatchObject({
    Parameters: {
      Input: {
        "token.$": "$$.Task.Token",
        "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID.$": "$$.Execution.Id",
      },
    },
  });
});

test("Execute State Machine - Associate With Parent - Input Not Provided", () => {
  const task = new StepFunctionsStartExecution(stack, "ChildTask", {
    stateMachine: child,
    associateWithParent: true,
  });

  new compute.StateMachine(stack, "ParentStateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
  });

  expect(stack.resolve(task.toStateJson())).toMatchObject({
    Parameters: {
      Input: {
        "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID.$": "$$.Execution.Id",
      },
    },
  });
});

test("Execute State Machine - Associate With Parent - Incorrect Input Type", () => {
  expect(() => {
    new StepFunctionsStartExecution(stack, "ChildTask", {
      stateMachine: child,
      associateWithParent: true,
      input: compute.TaskInput.fromText('{ "token.$": "$$.Task.Token" }'),
    });
  }).toThrow(
    "Could not enable `associateWithParent` because `input` is taken directly from a JSON path. Use `sfn.TaskInput.fromObject` instead.",
  );
});
