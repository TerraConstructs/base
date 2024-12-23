import { Testing } from "cdktf";
import { render } from "./private/render-util";
import { compute, AwsStack } from "../../../src/aws";

const gridUUID = "123e4567-e89b-12d3";
describe("Fail State", () => {
  let stack: AwsStack;
  let stateJson: any;

  beforeEach(() => {
    // GIVEN
    stack = new AwsStack(Testing.app(), `TestStack`, {
      environmentName: "Test",
      gridUUID,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
    stateJson = {
      Type: "Task",
      Resource: "arn:aws:states:::dynamodb:putItem",
      Parameters: {
        TableName: "MyTable",
        Item: {
          id: {
            S: "MyEntry",
          },
        },
      },
      ResultPath: null,
    };
  });

  test("Props are optional", () => {
    new compute.Fail(stack, "Fail");
  });

  test("can add a fail state to the chain with custom state name", () => {
    // WHEN
    const definition = new compute.CustomState(stack, "Custom1", {
      stateJson,
    })
      .next(new compute.Pass(stack, "MyPass"))
      .next(
        new compute.Fail(stack, "Fail", {
          stateName: "my-fail-state",
          comment: "failing state",
          errorPath: compute.JsonPath.stringAt("$.error"),
          causePath: compute.JsonPath.stringAt("$.cause"),
        }),
      );

    // THEN
    expect(render(stack, definition)).toStrictEqual({
      StartAt: "Custom1",
      States: {
        Custom1: {
          Next: "MyPass",
          Type: "Task",
          ...stateJson,
        },
        MyPass: {
          Type: "Pass",
          Next: "my-fail-state",
        },
        "my-fail-state": {
          Comment: "failing state",
          Type: "Fail",
          CausePath: "$.cause",
          ErrorPath: "$.error",
        },
      },
    });
  });
});
