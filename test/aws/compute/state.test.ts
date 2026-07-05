import { sfnStateMachine } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { FakeTask } from "./fake-task";
import { innerJson } from "./private/render-util";
import { AwsStack } from "../../../src/aws";
import {
  DefinitionBody,
  JsonPath,
  StateMachine,
} from "../../../src/aws/compute";

test("JsonPath.DISCARD can be used to discard a state's output", () => {
  // GIVEN
  const app = Testing.app();
  const stack = new AwsStack(app);
  const task = new FakeTask(stack, "my-state", {
    inputPath: JsonPath.DISCARD,
    outputPath: JsonPath.DISCARD,
    resultPath: JsonPath.DISCARD,
  });
  new StateMachine(stack, "state-machine", {
    definitionBody: DefinitionBody.fromChainable(task),
  });

  // THEN
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(
    innerJson(synthesized, sfnStateMachine.SfnStateMachine, {
      id: "state-machine_3BB5DA23",
      field: "definition",
    }),
  ).toMatchObject({
    States: {
      "my-state": {
        InputPath: null,
        OutputPath: null,
        ResultPath: null,
      },
    },
  });
});
