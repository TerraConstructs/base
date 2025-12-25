import { Testing } from "cdktn";
import { render } from "./private/render-util";
import { compute, AwsStack } from "../../../src/aws";

const gridUUID = "a123e456-e89b-12d3";
describe("Parallel State", () => {
  let stack: AwsStack;
  beforeEach(() => {
    // GIVEN
    stack = new AwsStack(Testing.app());
  });
  test("State Machine With Parallel State", () => {
    // WHEN
    const parallel = new compute.Parallel(stack, "Parallel State");
    parallel.branch(
      new compute.Pass(stack, "Branch 1", { stateName: "first-pass-state" }),
    );
    parallel.branch(new compute.Pass(stack, "Branch 2"));

    // THEN
    expect(render(stack, parallel)).toStrictEqual({
      StartAt: "Parallel State",
      States: {
        "Parallel State": {
          Type: "Parallel",
          End: true,
          Branches: [
            {
              StartAt: "first-pass-state",
              States: { "first-pass-state": { Type: "Pass", End: true } },
            },
            {
              StartAt: "Branch 2",
              States: { "Branch 2": { Type: "Pass", End: true } },
            },
          ],
        },
      },
    });
  });

  test("State Machine With Parallel State and ResultSelector", () => {
    // WHEN
    const parallel = new compute.Parallel(stack, "Parallel State", {
      resultSelector: {
        buz: "buz",
        baz: compute.JsonPath.stringAt("$.baz"),
      },
    });
    parallel.branch(new compute.Pass(stack, "Branch 1"));

    // THEN
    expect(render(stack, parallel)).toStrictEqual({
      StartAt: "Parallel State",
      States: {
        "Parallel State": {
          Type: "Parallel",
          End: true,
          Branches: [
            {
              StartAt: "Branch 1",
              States: { "Branch 1": { Type: "Pass", End: true } },
            },
          ],
          ResultSelector: {
            buz: "buz",
            "baz.$": "$.baz",
          },
        },
      },
    });
  });
});
