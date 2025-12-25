// https://github.com/aws/aws-cdk/blob/v2.176.0/packages/aws-cdk-lib/aws-sns-subscriptions/lib/sqs.ts

import { Token } from "cdktf";
import { Construct } from "constructs";
import * as notify from "..";
import { SubscriptionProps } from "./subscription";
import { ArnFormat } from "../../arn";
import { AwsStack } from "../../aws-stack";
import * as iam from "../../iam";
// import * as cxapi from '../../cx-api';

/**
 * Properties for an SQS subscription
 */
export interface SqsSubscriptionProps extends SubscriptionProps {
  /**
   * The message to the queue is the same as it was sent to the topic
   *
   * If false, the message will be wrapped in an SNS envelope.
   *
   * @default false
   */
  readonly rawMessageDelivery?: boolean;
}

/**
 * Use an SQS queue as a subscription target
 */
export class SqsSubscription implements notify.ITopicSubscription {
  constructor(
    private readonly queue: notify.IQueue,
    private readonly props: SqsSubscriptionProps = {},
  ) {}

  /**
   * Returns a configuration for an SQS queue to subscribe to an SNS topic
   */
  public bind(topic: notify.ITopic): notify.TopicSubscriptionConfig {
    // Create subscription under *consuming* construct to make sure it ends up
    // in the correct stack in cases of cross-stack subscriptions.
    if (!Construct.isConstruct(this.queue)) {
      throw new Error(
        "The supplied Queue object must be an instance of Construct",
      );
    }
    const snsServicePrincipal = new iam.ServicePrincipal("sns.amazonaws.com");

    // if the queue is encrypted by AWS managed KMS key (alias/aws/sqs),
    // throw error message
    if (this.queue.encryptionType === notify.QueueEncryption.KMS_MANAGED) {
      throw new Error(
        "SQS queue encrypted by AWS managed KMS key cannot be used as SNS subscription",
      );
    }

    // if the dead-letter queue is encrypted by AWS managed KMS key (alias/aws/sqs),
    // throw error message
    if (
      this.props.deadLetterQueue &&
      this.props.deadLetterQueue.encryptionType ===
        notify.QueueEncryption.KMS_MANAGED
    ) {
      throw new Error(
        "SQS queue encrypted by AWS managed KMS key cannot be used as dead-letter queue",
      );
    }

    // add a statement to the queue resource policy which allows this topic
    // to send messages to the queue.
    const queuePolicyDependable = this.queue.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: [this.queue.queueArn],
        actions: ["sqs:SendMessage"],
        principals: [snsServicePrincipal],
        condition: [
          {
            test: "ArnEquals",
            variable: "aws:SourceArn",
            values: [topic.topicArn],
          },
        ],
      }),
    ).policyDependable;

    // if the queue is encrypted, add a statement to the key resource policy
    // which allows this topic to decrypt KMS keys
    if (this.queue.encryptionMasterKey) {
      this.queue.encryptionMasterKey.addToResourcePolicy(
        new iam.PolicyStatement({
          resources: ["*"],
          actions: ["kms:Decrypt", "kms:GenerateDataKey"],
          principals: [snsServicePrincipal],
          condition: [
            {
              test: "ArnEquals",
              variable: "aws:SourceArn",
              values: [topic.topicArn],
            },
          ],
        }),
      );
    }

    // if the topic and queue are created in different stacks
    // then we need to make sure the topic is created first
    if (topic instanceof notify.Topic && topic.stack !== this.queue.stack) {
      this.queue.stack.addDependency(topic.stack);
    }

    return {
      subscriberScope: this.queue,
      subscriberId: AwsStack.uniqueId(topic),
      endpoint: this.queue.queueArn,
      protocol: notify.SubscriptionProtocol.SQS,
      rawMessageDelivery: this.props.rawMessageDelivery,
      filterPolicy: this.props.filterPolicy,
      filterPolicyWithMessageBody: this.props.filterPolicyWithMessageBody,
      region: this.regionFromArn(topic),
      deadLetterQueue: this.props.deadLetterQueue,
      subscriptionDependency: queuePolicyDependable,
    };
  }

  private regionFromArn(topic: notify.ITopic): string | undefined {
    // no need to specify `region` for topics defined within the same stack
    if (topic instanceof notify.Topic) {
      if (topic.stack !== this.queue.stack) {
        // only if we know the region, will not work for
        // env agnostic stacks
        if (
          !Token.isUnresolved(topic.env.region) &&
          topic.env.region !== this.queue.env.region
        ) {
          return topic.env.region;
        }
      }
      return undefined;
    }
    return AwsStack.ofAwsConstruct(topic).splitArn(
      topic.topicArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    ).region;
  }
}
