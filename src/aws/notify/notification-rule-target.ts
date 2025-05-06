// https://github.com/aws/aws-cdk/blob/a2c633f1e698249496f11338312ab42bd7b1e4f0/packages/aws-cdk-lib/aws-codestarnotifications/lib/notification-rule-target.ts

import * as constructs from "constructs";

/**
 * Information about the SNS topic or AWS Chatbot client associated with a notification target.
 */
export interface NotificationRuleTargetConfig {
  /**
   * The target type. Can be an Amazon SNS topic or AWS Chatbot client.
   */
  readonly targetType: string;

  /**
   * The Amazon Resource Name (ARN) of the Amazon SNS topic or AWS Chatbot client.
   */
  readonly targetAddress: string;
}

/**
 * Represents a notification target
 * That allows AWS Chatbot and SNS topic to associate with this rule target.
 */
export interface INotificationRuleTarget {
  /**
   * Returns a target configuration for notification rule.
   */
  bindAsNotificationRuleTarget(
    scope: constructs.Construct,
  ): NotificationRuleTargetConfig;
}
