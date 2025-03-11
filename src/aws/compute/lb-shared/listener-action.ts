// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/shared/listener-action.ts

import {
  lbListener as tfListener,
  lbListenerRule as tfListenerRule,
} from "@cdktf/provider-aws";

/**
 * Interface for listener actions
 */
export interface IListenerAction {
  /**
   * Render the listener default actions in this chain
   */
  renderActions(): tfListener.LbListenerDefaultAction[];
  /**
   * Render the listener rule actions in this chain
   */
  renderRuleActions(): tfListenerRule.LbListenerRuleAction[];
}
