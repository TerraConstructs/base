import { Construct } from "constructs";
import { snsTopic, snsTopicPolicy } from "@cdktf/provider-aws";
import { Lazy, Token } from "cdktf";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import * as iam from "../iam";
import {
  ITopic,
  TopicOutputs,
  INotificationRuleTarget,
  NotificationRuleTargetConfig,
} from "./topic-base";
import { ITopicSubscription, Subscription } from "./subscription";

/**
 * Properties for a new SNS topic
 */
export interface TopicProps extends AwsConstructProps {
  /**
   * A name for the topic.
   * If you don't specify a name, AWS CloudFormation generates a unique physical ID and uses that ID for the topic name.
   * @default - Generated name
   */
  readonly topicName?: string;

  /**
   * A developer-defined string that can be used to identify this SNS topic.
   * @default - No display name
   */
  readonly displayName?: string;

  /**
   * A policy document that contains permissions to add to the specified SNS topics.
   * @default - No policy
   */
  readonly policy?: iam.PolicyDocument;

  /**
   * Enables content-based deduplication for FIFO topics.
   * @default false
   */
  readonly contentBasedDeduplication?: boolean;

  /**
   * Set to true to create a FIFO topic.
   * @default false
   */
  readonly fifo?: boolean;

  /**
   * The KMS master key ID to use for encrypting this topic.
   * @default - No encryption
   */
  readonly masterKey?: string;

  /**
   * Enables server-side encryption for the topic.
   * @default - false
   */
  readonly encrypted?: boolean;

  /**
   * The ID of an AWS-managed customer master key (CMK) for Amazon SNS or a custom CMK.
   * @default - AWS managed CMK (alias/aws/sns)
   */
  readonly kmsMasterKeyId?: string;

  /**
   * Initial subscriptions to add to this topic
   * @default - No subscriptions
   */
  readonly subscriptions?: ITopicSubscription[];

  /**
   * Tags to assign to the topic.
   * @default - No tags
   */
  readonly tags?: { [key: string]: string };
}

/**
 * A new Amazon SNS topic
 *
 * @resource aws_sns_topic
 */
export class Topic extends AwsConstructBase implements ITopic {
  /**
   * Import an existing SNS topic provided an ARN
   *
   * @param scope The parent creating construct
   * @param id The construct's name
   * @param topicArn topic ARN (i.e. arn:aws:sns:us-east-2:444455556666:MyTopic)
   */
  public static fromTopicArn(
    scope: Construct,
    id: string,
    topicArn: string,
  ): ITopic {
    class Import extends AwsConstructBase implements ITopic {
      public readonly topicArn = topicArn;
      public readonly topicName = this.extractNameFromArn(topicArn);
      public readonly fifo = this.topicName.endsWith(".fifo");
      public readonly contentBasedDeduplication = false;

      public get topicOutputs(): TopicOutputs {
        return {
          topicArn: this.topicArn,
          topicName: this.topicName,
        };
      }

      public get outputs(): Record<string, any> {
        return this.topicOutputs;
      }

      public addSubscription(subscription: ITopicSubscription): Subscription {
        const subscriptionConfig = subscription.bind(this);
        const scope = subscriptionConfig.subscriberScope || this;
        const id = subscriptionConfig.subscriberId || "Subscription";
        return new Subscription(scope, id, {
          ...subscriptionConfig,
          topic: this,
        });
      }

      public addToResourcePolicy(
        _statement: iam.PolicyStatement,
      ): iam.AddToResourcePolicyResult {
        // This is imported, so we can't modify the policy
        return { statementAdded: false };
      }

      public grantPublish(identity: iam.IGrantable): iam.Grant {
        return iam.Grant.addToPrincipal({
          grantee: identity,
          actions: ["sns:Publish"],
          resourceArns: [this.topicArn],
        });
      }

      public grantSubscribe(identity: iam.IGrantable): iam.Grant {
        return iam.Grant.addToPrincipal({
          grantee: identity,
          actions: ["sns:Subscribe"],
          resourceArns: [this.topicArn],
        });
      }

      public bindAsNotificationRuleTarget(
        _scope: Construct,
      ): NotificationRuleTargetConfig {
        return {
          targetArn: this.topicArn,
          targetType: "SNS",
        };
      }

      private extractNameFromArn(arn: string): string {
        return arn.split(":").pop() || "";
      }
    }

    return new Import(scope, id);
  }

  /**
   * The ARN of the topic
   */
  public readonly topicArn: string;

  /**
   * The name of the topic
   */
  public readonly topicName: string;

  /**
   * Whether this topic is a FIFO topic
   */
  public readonly fifo: boolean;

  /**
   * Whether content-based deduplication is enabled for this topic
   */
  public readonly contentBasedDeduplication: boolean;

  private readonly resource: snsTopic.SnsTopic;
  private policy?: snsTopicPolicy.SnsTopicPolicy;
  private policyDocument?: iam.PolicyDocument;

  constructor(scope: Construct, id: string, props: TopicProps = {}) {
    super(scope, id, props);

    this.fifo = props.fifo || false;
    this.contentBasedDeduplication = props.contentBasedDeduplication || false;

    let topicName = props.topicName;
    if (this.fifo && topicName && !topicName.endsWith(".fifo")) {
      topicName = `${topicName}.fifo`;
    }

    this.resource = new snsTopic.SnsTopic(this, "Resource", {
      name: topicName,
      displayName: props.displayName,
      fifoTopic: this.fifo,
      contentBasedDeduplication: this.contentBasedDeduplication,
      kmsMasterKeyId: props.kmsMasterKeyId,
      tags: props.tags,
    });

    this.topicArn = this.resource.arn;
    this.topicName = this.resource.name;

    if (props.policy) {
      this.policyDocument = props.policy;
      this.policy = new snsTopicPolicy.SnsTopicPolicy(this, "Policy", {
        arn: this.topicArn,
        policy: this.policyDocument.toJson(),
      });
    }

    for (const subscription of props.subscriptions || []) {
      this.addSubscription(subscription);
    }
  }

  /**
   * Returns the topic outputs
   */
  public get topicOutputs(): TopicOutputs {
    return {
      topicArn: this.topicArn,
      topicName: this.topicName,
    };
  }

  /**
   * Returns the outputs of this resource
   */
  public get outputs(): Record<string, any> {
    return this.topicOutputs;
  }

  /**
   * Subscribe some endpoint to this topic
   */
  public addSubscription(subscription: ITopicSubscription): Subscription {
    const subscriptionConfig = subscription.bind(this);
    const scope = subscriptionConfig.subscriberScope || this;
    const id = subscriptionConfig.subscriberId || "Subscription";
    return new Subscription(scope, id, {
      ...subscriptionConfig,
      topic: this,
    });
  }

  /**
   * Adds a statement to the IAM resource policy associated with this topic.
   *
   * If this topic was created in this stack (`new Topic`), a topic policy
   * will be automatically created upon the first call to `addToResourcePolicy`. If
   * the topic is imported (`Topic.import`), then this is a no-op.
   */
  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.policyDocument) {
      this.policyDocument = new iam.PolicyDocument();
      this.policy = new snsTopicPolicy.SnsTopicPolicy(this, "Policy", {
        arn: this.topicArn,
        policy: Lazy.stringValue({
          produce: () => this.policyDocument!.toJson(),
        }),
      });
    }

    this.policyDocument.addStatements(statement);
    return { statementAdded: true, policyDependable: this.policy };
  }

  /**
   * Grant topic publishing permissions to the given identity
   */
  public grantPublish(identity: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee: identity,
      actions: ["sns:Publish"],
      resourceArns: [this.topicArn],
    });
  }

  /**
   * Grant topic subscribing permissions to the given identity
   */
  public grantSubscribe(identity: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee: identity,
      actions: ["sns:Subscribe"],
      resourceArns: [this.topicArn],
    });
  }

  /**
   * Implements INotificationRuleTarget
   */
  public bindAsNotificationRuleTarget(
    _scope: Construct,
  ): NotificationRuleTargetConfig {
    return {
      targetArn: this.topicArn,
      targetType: "SNS",
    };
  }
}
