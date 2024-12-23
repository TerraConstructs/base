import {
  Testing,
  //Annotations,
} from "cdktf";
import { render } from "./private/render-util";
import "cdktf/lib/testing/adapters/jest";
import { Duration } from "../../../src";
import { compute, AwsStack } from "../../../src/aws";
import { Errors } from "../../../src/aws/compute/types";
import { Annotations } from "../../assertions";

const gridUUID = "123e4567-e89b-12d3";
describe("Custom State", () => {
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

  test("maintains the state Json provided during construction", () => {
    // WHEN
    const customState = new compute.CustomState(stack, "Custom", {
      stateJson,
    });

    // THEN
    expect(customState.toStateJson()).toStrictEqual({
      ...stateJson,
      ...{ Catch: undefined, Retry: undefined },
      End: true,
    });
  });

  test("can add a next state to the chain", () => {
    // WHEN
    const definition = new compute.CustomState(stack, "Custom", {
      stateJson,
    }).next(
      new compute.Pass(stack, "MyPass", {
        stateName: "my-pass-state",
      }),
    );

    // THEN
    expect(render(stack, definition)).toStrictEqual({
      StartAt: "Custom",
      States: {
        Custom: {
          Next: "my-pass-state",
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
        },
        "my-pass-state": {
          Type: "Pass",
          End: true,
        },
      },
    });
  });

  test("can add a catch state", () => {
    // GIVEN
    const failure = new compute.Fail(stack, "failed", {
      error: "DidNotWork",
      cause: "We got stuck",
    });
    const custom = new compute.CustomState(stack, "Custom", {
      stateJson,
    });
    const chain = compute.Chain.start(custom);

    // WHEN
    custom.addCatch(failure);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Custom",
      States: {
        Custom: {
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
          Catch: [
            {
              ErrorEquals: ["States.ALL"],
              Next: "failed",
            },
          ],
          End: true,
        },
        failed: {
          Type: "Fail",
          Error: "DidNotWork",
          Cause: "We got stuck",
        },
      },
    });
  });

  test("can add a retry state", () => {
    // GIVEN
    const custom = new compute.CustomState(stack, "Custom", {
      stateJson,
    });
    const chain = compute.Chain.start(custom);

    // WHEN
    custom.addRetry({
      errors: [compute.Errors.ALL],
      interval: Duration.seconds(10),
      maxAttempts: 5,
    });

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Custom",
      States: {
        Custom: {
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
          Retry: [
            {
              ErrorEquals: ["States.ALL"],
              IntervalSeconds: 10,
              MaxAttempts: 5,
            },
          ],
          End: true,
        },
      },
    });
  });

  test("respect the Retry field in the stateJson", () => {
    // GIVEN
    const custom = new compute.CustomState(stack, "Custom", {
      stateJson: {
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
        Retry: [
          {
            ErrorEquals: [compute.Errors.TIMEOUT],
            IntervalSeconds: 20,
            MaxAttempts: 2,
          },
          {
            ErrorEquals: [compute.Errors.RESULT_PATH_MATCH_FAILURE],
            IntervalSeconds: 20,
            MaxAttempts: 2,
          },
        ],
      },
    });
    const chain = compute.Chain.start(custom);

    // WHEN
    custom.addRetry({
      errors: [compute.Errors.PERMISSIONS],
      interval: Duration.seconds(10),
      maxAttempts: 5,
    });

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Custom",
      States: {
        Custom: {
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
          Retry: [
            {
              ErrorEquals: ["States.Permissions"],
              IntervalSeconds: 10,
              MaxAttempts: 5,
            },
            {
              ErrorEquals: ["States.Timeout"],
              IntervalSeconds: 20,
              MaxAttempts: 2,
            },
            {
              ErrorEquals: ["States.ResultPathMatchFailure"],
              IntervalSeconds: 20,
              MaxAttempts: 2,
            },
          ],
          End: true,
        },
      },
    });
  });

  test("expect retry to not fail when specifying strategy inline", () => {
    // GIVEN
    const custom = new compute.CustomState(stack, "Custom", {
      stateJson: {
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
        Retry: [
          {
            ErrorEquals: [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException",
              "Lambda.TooManyRequestsException",
            ],
            IntervalSeconds: 20,
            MaxAttempts: 2,
          },
        ],
      },
    });
    const chain = compute.Chain.start(custom);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Custom",
      States: {
        Custom: {
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
          Retry: [
            {
              ErrorEquals: [
                "Lambda.ServiceException",
                "Lambda.AWSLambdaException",
                "Lambda.SdkClientException",
                "Lambda.TooManyRequestsException",
              ],
              IntervalSeconds: 20,
              MaxAttempts: 2,
            },
          ],
          End: true,
        },
      },
    });
  });

  test("expect retry to merge when specifying strategy inline and through construct", () => {
    // GIVEN
    const custom = new compute.CustomState(stack, "Custom", {
      stateJson: {
        ...stateJson,
        Retry: [
          {
            ErrorEquals: ["States.TaskFailed"],
          },
        ],
      },
    }).addRetry({ errors: [Errors.TIMEOUT] });
    const chain = compute.Chain.start(custom);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Custom",
      States: {
        Custom: {
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
          Retry: [
            {
              ErrorEquals: ["States.Timeout"],
            },
            {
              ErrorEquals: ["States.TaskFailed"],
            },
          ],
          End: true,
        },
      },
    });
  });

  test("expect catch to not fail when specifying strategy inline", () => {
    // GIVEN
    const custom = new compute.CustomState(stack, "Custom", {
      stateJson: {
        ...stateJson,
        Catch: [
          {
            ErrorEquals: ["States.TaskFailed"],
            Next: "Failed",
          },
        ],
      },
    });
    const chain = compute.Chain.start(custom);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Custom",
      States: {
        Custom: {
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
          Catch: [
            {
              ErrorEquals: ["States.TaskFailed"],
              Next: "Failed",
            },
          ],
          End: true,
        },
      },
    });
  });

  test("expect catch to merge when specifying strategy inline and through construct", () => {
    // GIVEN
    const failure = new compute.Fail(stack, "Failed", {
      error: "DidNotWork",
      cause: "We got stuck",
    });

    const custom = new compute.CustomState(stack, "Custom", {
      stateJson: {
        ...stateJson,
        Catch: [
          {
            ErrorEquals: ["States.TaskFailed"],
            Next: "Failed",
          },
        ],
      },
    }).addCatch(failure, { errors: [Errors.TIMEOUT] });
    const chain = compute.Chain.start(custom);

    // THEN
    expect(render(stack, chain)).toStrictEqual({
      StartAt: "Custom",
      States: {
        Custom: {
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
          Catch: [
            {
              ErrorEquals: ["States.Timeout"],
              Next: "Failed",
            },
            {
              ErrorEquals: ["States.TaskFailed"],
              Next: "Failed",
            },
          ],
          End: true,
        },
        Failed: {
          Type: "Fail",
          Error: "DidNotWork",
          Cause: "We got stuck",
        },
      },
    });
  });

  test("expect warning message to be emitted when retries specified both in stateJson and through addRetry()", () => {
    const customState = new compute.CustomState(stack, "my custom task", {
      stateJson: {
        Type: "Task",
        Resource: "arn:aws:states:::dynamodb:putItem",
        Parameters: {
          TableName: "my-cool-table",
          Item: {
            id: {
              S: "my-entry",
            },
          },
        },
        Retry: [
          {
            ErrorEquals: ["States.TaskFailed"],
          },
        ],
      },
    });

    customState.addRetry({
      errors: [compute.Errors.TIMEOUT],
      interval: Duration.seconds(10),
      maxAttempts: 5,
    });

    new compute.StateMachine(stack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(customState),
      ),
      timeout: Duration.seconds(30),
    });

    // expect(Annotations.fromStack(stack).warnings).toMatchSnapshot();
    Annotations.fromStack(stack).hasWarnings({
      constructPath: "TestStack/my custom task",
      message: /CustomState constructs can configure state retries/,
    });

    // Annotations.of(stack).hasWarning(
    //   "/Default/my custom task",
    //   Match.stringLikeRegexp(
    //     "CustomState constructs can configure state retries",
    //   ),
    // );
  });

  test("expect warning message to be emitted when catchers specified both in stateJson and through addCatch()", () => {
    const customState = new compute.CustomState(stack, "my custom task", {
      stateJson: {
        Type: "Task",
        Resource: "arn:aws:states:::dynamodb:putItem",
        Parameters: {
          TableName: "my-cool-table",
          Item: {
            id: {
              S: "my-entry",
            },
          },
        },
        Catch: [
          {
            ErrorEquals: ["States.Timeout"],
            Next: "Failed",
          },
        ],
      },
    });

    const failure = new compute.Fail(stack, "Failed", {
      error: "DidNotWork",
      cause: "We got stuck",
    });

    customState.addCatch(failure, { errors: [Errors.TIMEOUT] });

    new compute.StateMachine(stack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(customState),
      ),
      timeout: Duration.seconds(30),
    });

    // expect(Annotations.fromStack(stack).warnings).toMatchSnapshot();
    Annotations.fromStack(stack).hasWarnings({
      constructPath: "TestStack/my custom task",
      message: /CustomState constructs can configure state catchers/,
    });
    // Annotations.of(stack).hasWarning(
    //   "/Default/my custom task",
    //   Match.stringLikeRegexp(
    //     "CustomState constructs can configure state catchers",
    //   ),
    // );
  });
});
