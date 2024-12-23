import { sfnStateMachine } from "@cdktf/provider-aws";
import "cdktf/lib/testing/adapters/jest";
import { Testing } from "cdktf";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import * as compute from "../../../../../src/aws/compute";
import { StepFunctionsInvokeActivity } from "../../../../../src/aws/compute/tasks/stepfunctions/invoke-activity";

test("Activity can be used in a Task", () => {
  // GIVEN
  const app = Testing.app();
  const stack = new AwsStack(app, "TestSpec", {
    environmentName: "Test",
    gridUUID: "123e4567-e89b-12d3",
    providerConfig: { region: "us-east-1" },
    gridBackendConfig: {
      address: "http://localhost:3000",
    },
  });

  // WHEN
  const activity = new compute.Activity(stack, "Activity");
  const task = new StepFunctionsInvokeActivity(stack, "Task", { activity });
  new compute.StateMachine(stack, "SM", {
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
      definition:
        '{"StartAt":"Task","States":{"Task":{"End":true,"Type":"Task","Resource":"${aws_sfn_activity.Activity_04690B0A.id}"}}}',
    },
  );
  // Template.fromStack(stack).hasResourceProperties(
  //   "AWS::StepFunctions::StateMachine",
  //   {
  //     DefinitionString: {
  //       "Fn::Join": [
  //         "",
  //         [
  //           '{"StartAt":"Task","States":{"Task":{"End":true,"Type":"Task","Resource":"',
  //           { Ref: "Activity04690B0A" },
  //           '"}}}',
  //         ],
  //       ],
  //     },
  //   },
  // );
});
