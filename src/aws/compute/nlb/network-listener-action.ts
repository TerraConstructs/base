// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/nlb/network-listener-action.ts

import {
  lbListener as tfListener,
  lbListenerRule as tfListenerRule,
} from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { INetworkListener } from "./network-listener";
import { INetworkTargetGroup } from "./network-target-group";
import { Duration } from "../../../duration";
import { IListenerAction } from "../lb-shared/listener-action";

/**
 * What to do when a client makes a request to a listener
 *
 * Some actions can be combined with other ones (specifically,
 * you can perform authentication before serving the request).
 *
 * Multiple actions form a linked chain; the chain must always terminate in a
 * *(weighted)forward*, *fixedResponse* or *redirect* action.
 *
 * If an action supports chaining, the next action can be indicated
 * by passing it in the `next` property.
 */
export class NetworkListenerAction implements IListenerAction {
  /**
   * Forward to one or more Target Groups
   */
  public static forward(
    targetGroups: INetworkTargetGroup[],
    options: NetworkForwardOptions = {},
  ): NetworkListenerAction {
    if (targetGroups.length === 0) {
      throw new Error(
        "Need at least one targetGroup in a NetworkListenerAction.forward()",
      );
    }
    if (targetGroups.length === 1 && options.stickinessDuration === undefined) {
      // Render a "simple" action for backwards compatibility with old templates
      return new TargetGroupListenerAction(targetGroups, {
        type: "forward",
        targetGroupArn: targetGroups[0].targetGroupArn,
      });
    }

    return new TargetGroupListenerAction(targetGroups, {
      type: "forward",
      forward: {
        targetGroup: targetGroups.map((g) => ({
          arn: g.targetGroupArn,
        })),
        stickiness: options.stickinessDuration
          ? {
              duration: options.stickinessDuration.toSeconds(),
              enabled: true,
            }
          : undefined,
      },
    });
  }

  /**
   * Forward to one or more Target Groups which are weighted differently
   */
  public static weightedForward(
    targetGroups: NetworkWeightedTargetGroup[],
    options: NetworkForwardOptions = {},
  ): NetworkListenerAction {
    if (targetGroups.length === 0) {
      throw new Error(
        "Need at least one targetGroup in a NetworkListenerAction.weightedForward()",
      );
    }

    return new TargetGroupListenerAction(
      targetGroups.map((g) => g.targetGroup),
      {
        type: "forward",
        forward: {
          targetGroup: targetGroups.map((g) => ({
            arn: g.targetGroup.targetGroupArn,
            weight: g.weight,
          })),
          stickiness: options.stickinessDuration
            ? {
                duration: options.stickinessDuration.toSeconds(),
                enabled: true,
              }
            : undefined,
        },
      },
    );
  }

  private _actionJson?: tfListenerRule.LbListenerRuleAction;

  /**
   * Create an instance of NetworkListenerAction
   *
   * The default class should be good enough for most cases and
   * should be created by using one of the static factory functions,
   * but allow overriding to make sure we allow flexibility for the future.
   */
  protected constructor(
    private readonly defaultActionJson: tfListener.LbListenerDefaultAction,
    protected readonly next?: NetworkListenerAction,
  ) {}

  /**
   * Render the listener rule actions in this chain
   */
  public renderRuleActions(): tfListenerRule.LbListenerRuleAction[] {
    const actionJson =
      this._actionJson ??
      (this.defaultActionJson as tfListenerRule.LbListenerRuleAction);
    return this._renumber([
      actionJson,
      ...(this.next?.renderRuleActions() ?? []),
    ]);
  }

  /**
   * Render the listener default actions in this chain
   */
  public renderActions(): tfListener.LbListenerDefaultAction[] {
    return this._renumber([
      this.defaultActionJson,
      ...(this.next?.renderActions() ?? []),
    ]);
  }

  /**
   * Called when the action is being used in a listener
   */
  public bind(scope: Construct, listener: INetworkListener) {
    // Empty on purpose
    Array.isArray(scope);
    Array.isArray(listener);
  }

  private _renumber<
    ActionProperty extends
      | tfListener.LbListenerDefaultAction
      | tfListenerRule.LbListenerRuleAction =
      tfListener.LbListenerDefaultAction,
  >(actions: ActionProperty[]): ActionProperty[] {
    if (actions.length < 2) {
      return actions;
    }

    return actions.map((action, i) => ({ ...action, order: i + 1 }));
  }

  /**
   * Renumber the "order" fields in the actions array.
   *
   * We don't number for 0 or 1 elements, but otherwise number them 1...#actions
   * so ELB knows about the right order.
   *
   * Do this in `NetworkListenerAction` instead of in `Listener` so that we give
   * users the opportunity to override by subclassing and overriding `renderActions`.
   */
  protected renumber(
    actions: tfListener.LbListenerDefaultAction[],
  ): tfListener.LbListenerDefaultAction[] {
    return this._renumber(actions);
  }
}

/**
 * Options for `NetworkListenerAction.forward()`
 */
export interface NetworkForwardOptions {
  /**
   * For how long clients should be directed to the same target group
   *
   * Range between 1 second and 7 days.
   *
   * @default - No stickiness
   */
  readonly stickinessDuration?: Duration;
}

/**
 * A Target Group and weight combination
 */
export interface NetworkWeightedTargetGroup {
  /**
   * The target group
   */
  readonly targetGroup: INetworkTargetGroup;

  /**
   * The target group's weight
   *
   * Range is [0..1000).
   *
   * @default 1
   */
  readonly weight?: number;
}

/**
 * Listener Action that calls "registerListener" on TargetGroups
 */
class TargetGroupListenerAction extends NetworkListenerAction {
  constructor(
    private readonly targetGroups: INetworkTargetGroup[],
    defaultActionJson: tfListener.LbListenerDefaultAction,
  ) {
    super(defaultActionJson);
  }

  public bind(_scope: Construct, listener: INetworkListener) {
    for (const tg of this.targetGroups) {
      tg.registerListener(listener);
    }
  }
}
