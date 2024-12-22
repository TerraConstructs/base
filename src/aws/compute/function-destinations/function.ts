import { Construct } from "constructs";
import * as compute from "..";
import { EventBridgeDestination } from "./event-bridge";
import * as notify from "../../notify";

// TODO: Name this back to LambdaDestination instead?

/**
 * Options for a Lambda destination
 */
export interface FunctionDestinationOptions {
  /**
   * Whether the destination function receives only the `responsePayload` of
   * the source function.
   *
   * When set to `true` and used as `onSuccess` destination, the destination
   * function will be invoked with the payload returned by the source function.
   *
   * When set to `true` and used as `onFailure` destination, the destination
   * function will be invoked with the error object returned by source function.
   *
   * See the README of this module to see a full explanation of this option.
   *
   * @default false The destination function receives the full invocation record.
   */
  readonly responseOnly?: boolean;
}

/**
 * Use a Lambda function as a Lambda destination
 */
export class FunctionDestination implements compute.IDestination {
  constructor(
    private readonly fn: compute.IFunction,
    private readonly options: FunctionDestinationOptions = {},
  ) {}

  /**
   * Returns a destination configuration
   */
  public bind(
    scope: Construct,
    fn: compute.IFunction,
    options?: compute.DestinationOptions,
  ): compute.DestinationConfig {
    // Normal Lambda destination (full invocation record)
    if (!this.options.responseOnly) {
      // deduplicated automatically
      this.fn.grantInvoke(fn);

      return {
        destination: this.fn.functionArn,
      };
    }

    // Otherwise add rule to extract the response payload and use EventBridge
    // as destination
    if (!options) {
      // `options` added to bind() as optionnal to avoid breaking change
      throw new Error("Options must be defined when using `responseOnly`.");
    }

    // Match invocation result of the source function (`fn`) and use it
    // to trigger the destination function (`this.fn`).
    new notify.Rule(scope, options.type, {
      eventPattern: {
        detailType: [`Lambda Function Invocation Result - ${options.type}`],
        resources: [`${fn.functionArn}:$LATEST`],
        source: ["lambda"],
      },
      targets: [
        new notify.targets.LambdaFunction(this.fn, {
          event: notify.RuleTargetInput.fromEventPath(
            "$.detail.responsePayload",
          ), // Extract response payload
        }),
      ],
    });

    const destination = new EventBridgeDestination(); // Use default event bus here
    return destination.bind(scope, fn);
  }
}
