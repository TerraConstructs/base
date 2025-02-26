// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-sns/lib/topic-base.ts

import { IAwsConstruct, AwsConstructBase } from "../aws-construct";

/**
 * TODO: This has been copied from aws-codestarnotifications, will need to be moved in the
 * Represents a notification target
 * That allows AWS Chatbot and SNS topic to associate with this rule target.
 */
export interface INotificationRuleTarget {
  /**
   * Returns a target configuration for notification rule.
   */
  bindAsNotificationRuleTarget(scope: constructs.Construct): NotificationRuleTargetConfig;
}

/**
 * Represents an SNS topic
 */
export interface ITopic extends IAwsConstruct, notifications.INotificationRuleTarget {
  /**
   * The ARN of the topic
   *
   * @attribute
   */
  readonly topicArn: string;

  /**
   * The name of the topic
   *
   * @attribute
   */
  readonly topicName: string;

  /**
   * Enables content-based deduplication for FIFO topics.
   *
   * @attribute
   */
  readonly contentBasedDeduplication: boolean;

  /**
   * Whether this topic is an Amazon SNS FIFO queue. If false, this is a standard topic.
   *
   * @attribute
   */
  readonly fifo: boolean;

  /**
   * Subscribe some endpoint to this topic
   */
  addSubscription(subscription: ITopicSubscription): Subscription;

  /**
   * Adds a statement to the IAM resource policy associated with this topic.
   *
   * If this topic was created in this stack (`new Topic`), a topic policy
   * will be automatically created upon the first call to `addToResourcePolicy`. If
   * the topic is imported (`Topic.import`), then this is a no-op.
   */
  addToResourcePolicy(statement: iam.PolicyStatement): iam.AddToResourcePolicyResult;

  /**
   * Grant topic publishing permissions to the given identity
   */
  grantPublish(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant topic subscribing permissions to the given identity
   */
  grantSubscribe(identity: iam.IGrantable): iam.Grant;
}