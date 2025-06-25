import { Construct } from "constructs";
import * as compute from "../";
import { AwsStack } from "../..";
import * as notify from "../../notify";

/**
 * Use an Event Bridge event bus as a Lambda destination.
 *
 * If no event bus is specified, the default event bus is used.
 */
export class EventBridgeDestination implements compute.IDestination {
  /**
   * @default - use the default event bus
   */
  constructor(private readonly eventBus?: notify.IEventBus) {}

  /**
   * Returns a destination configuration
   */
  public bind(
    _scope: Construct,
    fn: compute.IFunction,
    _options?: compute.DestinationOptions,
  ): compute.DestinationConfig {
    if (this.eventBus) {
      this.eventBus.grantPutEventsTo(fn);

      return {
        destination: this.eventBus.eventBusArn,
      };
    }

    const existingDefaultEventBus = _scope.node.tryFindChild("DefaultEventBus");
    const eventBus =
      (existingDefaultEventBus as notify.EventBus) ||
      notify.EventBus.fromEventBusArn(
        _scope,
        "DefaultEventBus",
        AwsStack.ofAwsConstruct(fn).formatArn({
          service: "events",
          resource: "event-bus",
          resourceName: "default",
        }),
      );

    eventBus.grantPutEventsTo(fn);

    return {
      destination: eventBus.eventBusArn,
    };
  }
}
