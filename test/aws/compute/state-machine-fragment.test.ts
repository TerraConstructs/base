import { sfnStateMachine } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { innerJson } from "./private/render-util";
import { compute, AwsStack } from "../../../src/aws";

describe("State Machine Fragment", () => {
  test("Prefix applied correctly on Fragments with Parallel states", () => {
    // GIVEN
    const stack = new AwsStack(Testing.app(), `TestStack`, {
      environmentName: "Test",
      gridUUID: "123e4567-e89b-12d3",
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });

    // WHEN
    const fragment1 = new ParallelMachineFragment(
      stack,
      "Fragment 1",
    ).prefixStates();
    const fragment2 = new ParallelMachineFragment(
      stack,
      "Fragment 2",
    ).prefixStates();

    new compute.StateMachine(stack, "State Machine", {
      definitionBody: compute.DefinitionBody.fromChainable(
        fragment1.next(fragment2),
      ),
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(
      innerJson(synthesized, sfnStateMachine.SfnStateMachine, {
        id: "StateMachine_81935E76",
        field: "definition",
      }),
    ).toMatchObject({
      StartAt: "Fragment 1: Parallel State",
      States: {
        "Fragment 1: Parallel State": {
          Branches: [
            {
              StartAt: "Fragment 1: Step 1",
              States: {
                "Fragment 1: Step 1": expect.anything(),
              },
            },
          ],
          Next: "Fragment 2: Parallel State",
          Type: "Parallel",
        },
        "Fragment 2: Parallel State": {
          Branches: [
            {
              StartAt: "Fragment 2: Step 1",
              States: {
                "Fragment 2: Step 1": expect.anything(),
              },
            },
          ],
          End: true,
          Type: "Parallel",
        },
      },
    });
    // .toHaveResourceWithMatchedProperties(
    //   sfnStateMachine.SfnStateMachine,
    //   {
    //     definition: Match.serializedJson({
    //       StartAt: "Fragment 1: Parallel State",
    //       States: {
    //         "Fragment 1: Parallel State": Match.objectLike({
    //           Branches: [
    //             Match.objectLike({
    //               States: {
    //                 "Fragment 1: Step 1": Match.anyValue(),
    //               },
    //             }),
    //           ],
    //         }),
    //         "Fragment 2: Parallel State": Match.objectLike({
    //           Branches: [
    //             Match.objectLike({
    //               States: {
    //                 "Fragment 2: Step 1": Match.anyValue(),
    //               },
    //             }),
    //           ],
    //         }),
    //       },
    //     }),
    //   },
    // );
  });
});

class ParallelMachineFragment extends compute.StateMachineFragment {
  public readonly startState: compute.State;
  public readonly endStates: compute.INextable[];

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const step1 = new compute.Pass(this, "Step 1");
    const parallelState = new compute.Parallel(this, "Parallel State");
    const chain = parallelState.branch(step1);
    this.startState = parallelState;
    this.endStates = [chain];
  }
}
