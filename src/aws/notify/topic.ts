// https://github.com/aws/aws-cdk/blob/a7633a98ce325a620f364bfdeda354342751900a/packages/aws-cdk-lib/aws-sns/lib/topic.ts

import { snsTopic, snsTopicPolicy } from "@cdktf/provider-aws";
import { Fn, Jsonencode, Lazy, TerraformResource, Token } from "cdktf";
import { Construct } from "constructs";
import { ArnFormat, AwsStack } from "..";
import { AwsConstructProps } from "../aws-construct";
import * as encryption from "../encryption";
import * as iam from "../iam";
import { ITopic, TopicBase } from "./topic-base";

/**
 * Properties for a new SNS topic
 */
export interface TopicProps extends AwsConstructProps {
  /**
   * A developer-defined string that can be used to identify this SNS topic.
   *
   * The display name must be maximum 100 characters long, including hyphens (-),
   * underscores (_), spaces, and tabs.
   *
   * @default None
   */
  readonly displayName?: string;

  /**
   * A name for the topic.
   *
   * If you don't specify a name, AWS CloudFormation generates a unique
   * physical ID and uses that ID for the topic name. For more information,
   * see Name Type.
   *
   * @default Generated name
   */
  readonly topicName?: string;

  /**
   * A KMS Key, either managed by this CDK app, or imported.
   *
   * @default None
   */
  readonly masterKey?: encryption.IKey;

  /**
   * Enables content-based deduplication for FIFO topics.
   *
   * @default None
   */
  readonly contentBasedDeduplication?: boolean;

  /**
   * Set to true to create a FIFO topic.
   *
   * @default None
   */
  readonly fifo?: boolean;

  /**
   * The list of delivery status logging configurations for the topic.
   *
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-topic-attributes.html.
   *
   * @default None
   */
  readonly loggingConfigs?: LoggingConfig[];

  /**
   * The number of days Amazon SNS retains messages.
   *
   * It can only be set for FIFO topics.
   *
   * @see https://docs.aws.amazon.com/sns/latest/dg/fifo-message-archiving-replay.html
   *
   * @default - do not archive messages
   */
  readonly messageRetentionPeriodInDays?: number;

  /**
   * Adds a statement to enforce encryption of data in transit when publishing to the topic.
   *
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html#enforce-encryption-data-in-transit.
   *
   * @default false
   */
  readonly enforceSSL?: boolean;

  /**
   * The signature version corresponds to the hashing algorithm used while creating the signature of the notifications,
   * subscription confirmations, or unsubscribe confirmation messages sent by Amazon SNS.
   *
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html.
   *
   * @default 1
   */
  readonly signatureVersion?: string;

  /**
   * Tracing mode of an Amazon SNS topic.
   *
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-active-tracing.html
   *
   * @default TracingConfig.PASS_THROUGH
   */
  readonly tracingConfig?: TracingConfig;

  // TODO: fifoThroughputScope is not directly supported by aws_sns_topic in Terraform as of provider v5.93.0
  // /**
  //  * Specifies the throughput quota and deduplication behavior to apply for the FIFO topic.
  //  *
  //  * You can only set this property when `fifo` is `true`.
  //  *
  //  * @default undefined - SNS default setting is FifoThroughputScope.TOPIC
  //  */
  // readonly fifoThroughputScope?: FifoThroughputScope;
}

// TODO: fifoThroughputScope is not directly supported by aws_sns_topic in Terraform as of provider v5.93.0
// /**
//  * The throughput quota and deduplication behavior to apply for the FIFO topic.
//  */
// export enum FifoThroughputScope {
//   /**
//    * Topic scope
//    * - Throughput: 3000 messages per second and a bandwidth of 20MB per second.
//    * - Deduplication: Message deduplication is verified on the entire FIFO topic.
//    */
//   TOPIC = 'Topic',

//   /**
//    * Message group scope
//    * - Throughput: Maximum regional limits.
//    * - Deduplication: Message deduplication is only verified within a message group.
//    */
//   MESSAGE_GROUP = 'MessageGroup',
// }

/**
 * A logging configuration for delivery status of messages sent from SNS topic to subscribed endpoints.
 *
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-topic-attributes.html.
 */
export interface LoggingConfig {
  /**
   * Indicates one of the supported protocols for the SNS topic.
   */
  readonly protocol: LoggingProtocol;

  /**
   * The IAM role to be used when logging failed message deliveries in Amazon CloudWatch.
   *
   * @default None
   */
  readonly failureFeedbackRole?: iam.IRole;

  /**
   * The IAM role to be used when logging successful message deliveries in Amazon CloudWatch.
   *
   * @default None
   */
  readonly successFeedbackRole?: iam.IRole;

  /**
   * The percentage of successful message deliveries to be logged in Amazon CloudWatch.
   *
   * Valid values are integer between 0-100
   *
   * @default None
   */
  readonly successFeedbackSampleRate?: number;
}

/**
 * The type of supported protocol for delivery status logging.
 */
export enum LoggingProtocol {
  /**
   * HTTP
   */
  HTTP = "http/s",

  /**
   * Amazon Simple Queue Service
   */
  SQS = "sqs",

  /**
   * AWS Lambda
   */
  LAMBDA = "lambda",

  /**
   * Amazon Data Firehose
   */
  FIREHOSE = "firehose",

  /**
   * Platform application endpoint
   */
  APPLICATION = "application",
}

/**
 * The tracing mode of an Amazon SNS topic
 */
export enum TracingConfig {
  /**
   * The mode that topic passes trace headers received from the Amazon SNS publisher to its subscription.
   */
  PASS_THROUGH = "PassThrough",

  /**
   * The mode that Amazon SNS vend X-Ray segment data to topic owner account if the sampled flag in the tracing header is true.
   */
  ACTIVE = "Active",
}

/**
 * Represents an SNS topic defined outside of this stack.
 */
export interface TopicAttributes {
  /**
   * The ARN of the SNS topic.
   */
  readonly topicArn: string;

  /**
   * KMS encryption key ARN, if this topic is server-side encrypted by a KMS key.
   *
   * @default - None
   */
  readonly keyArn?: string;

  /**
   * Whether content-based deduplication is enabled.
   * Only applicable for FIFO topics.
   *
   * @default false
   */
  readonly contentBasedDeduplication?: boolean;
}

/**
 * A new SNS topic
 *
 * @resource aws_sns_topic
 */
export class Topic extends TopicBase {
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
    return Topic.fromTopicAttributes(scope, id, { topicArn });
  }

  /**
   * Import an existing SNS topic provided a topic attributes
   *
   * @param scope The parent creating construct
   * @param id The construct's name
   * @param attrs the attributes of the topic to import
   */
  public static fromTopicAttributes(
    scope: Construct,
    id: string,
    attrs: TopicAttributes,
  ): ITopic {
    const stack = AwsStack.ofAwsConstruct(scope);
    const topicName = stack.splitArn(
      attrs.topicArn,
      ArnFormat.NO_RESOURCE_NAME,
    ).resource;
    const fifo = topicName.endsWith(".fifo");

    if (attrs.contentBasedDeduplication && !fifo) {
      throw new Error(
        "Cannot import topic; contentBasedDeduplication is only available for FIFO SNS topics.",
      );
    }

    class Import extends TopicBase {
      public readonly topicArn = attrs.topicArn;
      public readonly topicName = topicName;
      public readonly masterKey = attrs.keyArn
        ? encryption.Key.fromKeyArn(this, "Key", attrs.keyArn)
        : undefined;
      public readonly fifo = fifo;
      public readonly contentBasedDeduplication =
        attrs.contentBasedDeduplication || false;
      protected autoCreatePolicy: boolean = false;
    }

    return new Import(scope, id, {
      environmentFromArn: attrs.topicArn,
    });
  }

  public readonly topicArn: string;
  public readonly topicName: string;
  public readonly masterKey?: encryption.IKey;
  public readonly contentBasedDeduplication: boolean;
  public readonly fifo: boolean;

  protected readonly autoCreatePolicy: boolean = true;

  private readonly resource: snsTopic.SnsTopic;

  constructor(scope: Construct, id: string, props: TopicProps = {}) {
    super(scope, id, props);

    this.enforceSSL = props.enforceSSL;

    if (props.contentBasedDeduplication && !props.fifo) {
      throw new Error(
        "Content based deduplication can only be enabled for FIFO SNS topics.",
      );
    }
    if (props.messageRetentionPeriodInDays && !props.fifo) {
      throw new Error(
        "`messageRetentionPeriodInDays` is only valid for FIFO SNS topics.",
      );
    }
    // TODO: fifoThroughputScope validation removed as property is not supported
    // if (props.fifoThroughputScope && !props.fifo) {
    //   throw new Error('`fifoThroughputScope` can only be set for FIFO SNS topics.');
    // }
    if (
      props.messageRetentionPeriodInDays !== undefined &&
      !Token.isUnresolved(props.messageRetentionPeriodInDays) &&
      (!Number.isInteger(props.messageRetentionPeriodInDays) ||
        props.messageRetentionPeriodInDays > 365 ||
        props.messageRetentionPeriodInDays < 1)
    ) {
      throw new Error(
        "`messageRetentionPeriodInDays` must be an integer between 1 and 365",
      );
    }

    let topicName = props.topicName;
    if (props.fifo && props.topicName && !props.topicName.endsWith(".fifo")) {
      topicName = props.topicName + ".fifo";
    } else if (props.fifo && !props.topicName) {
      // Max length allowed by CloudFormation is 256, we subtract 5 to allow for ".fifo" suffix
      const prefixName = this.stack.uniqueResourceName(this, {
        maxLength: 256 - 5,
        separator: "-",
      });
      topicName = `${prefixName}.fifo`;
    }

    if (
      props.signatureVersion &&
      !Token.isUnresolved(props.signatureVersion) &&
      props.signatureVersion !== "1" &&
      props.signatureVersion !== "2"
    ) {
      throw new Error(
        `signatureVersion must be "1" or "2", received: "${props.signatureVersion}"`,
      );
    }

    if (
      props.displayName &&
      !Token.isUnresolved(props.displayName) &&
      props.displayName.length > 100
    ) {
      throw new Error(
        `displayName must be less than or equal to 100 characters, got ${props.displayName.length}`,
      );
    }

    const loggingProps: Writeable<Partial<snsTopic.SnsTopicConfig>> = {};
    if (props.loggingConfigs) {
      for (const config of props.loggingConfigs) {
        if (config.successFeedbackSampleRate !== undefined) {
          const rate = config.successFeedbackSampleRate;
          if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
            throw new Error(
              "Success feedback sample rate must be an integer between 0 and 100",
            );
          }
        }
        switch (config.protocol) {
          case LoggingProtocol.HTTP:
            loggingProps.httpFailureFeedbackRoleArn =
              config.failureFeedbackRole?.roleArn;
            loggingProps.httpSuccessFeedbackRoleArn =
              config.successFeedbackRole?.roleArn;
            loggingProps.httpSuccessFeedbackSampleRate =
              config.successFeedbackSampleRate;
            break;
          case LoggingProtocol.SQS:
            loggingProps.sqsFailureFeedbackRoleArn =
              config.failureFeedbackRole?.roleArn;
            loggingProps.sqsSuccessFeedbackRoleArn =
              config.successFeedbackRole?.roleArn;
            loggingProps.sqsSuccessFeedbackSampleRate =
              config.successFeedbackSampleRate;
            break;
          case LoggingProtocol.LAMBDA:
            loggingProps.lambdaFailureFeedbackRoleArn =
              config.failureFeedbackRole?.roleArn;
            loggingProps.lambdaSuccessFeedbackRoleArn =
              config.successFeedbackRole?.roleArn;
            loggingProps.lambdaSuccessFeedbackSampleRate =
              config.successFeedbackSampleRate;
            break;
          case LoggingProtocol.FIREHOSE:
            loggingProps.firehoseFailureFeedbackRoleArn =
              config.failureFeedbackRole?.roleArn;
            loggingProps.firehoseSuccessFeedbackRoleArn =
              config.successFeedbackRole?.roleArn;
            loggingProps.firehoseSuccessFeedbackSampleRate =
              config.successFeedbackSampleRate;
            break;
          case LoggingProtocol.APPLICATION:
            loggingProps.applicationFailureFeedbackRoleArn =
              config.failureFeedbackRole?.roleArn;
            loggingProps.applicationSuccessFeedbackRoleArn =
              config.successFeedbackRole?.roleArn;
            loggingProps.applicationSuccessFeedbackSampleRate =
              config.successFeedbackSampleRate;
            break;
          default:
            // Should not happen
            break;
        }
      }
    }

    this.resource = new snsTopic.SnsTopic(this, "Resource", {
      name: topicName,
      displayName: props.displayName,
      kmsMasterKeyId: props.masterKey?.keyArn,
      contentBasedDeduplication: props.contentBasedDeduplication,
      fifoTopic: props.fifo,
      signatureVersion: props.signatureVersion
        ? parseInt(props.signatureVersion, 10)
        : undefined,
      tracingConfig: props.tracingConfig,
      archivePolicy: props.messageRetentionPeriodInDays
        ? Lazy.stringValue({
            produce: () =>
              Jsonencode.encode({
                MessageRetentionPeriod: props.messageRetentionPeriodInDays,
              }),
          })
        : undefined,
      ...loggingProps,
      // TODO: fifoThroughputScope is not supported
    });

    this.topicArn = this.resource.arn;
    this.topicName = this.resource.name;
    this.masterKey = props.masterKey;
    this.fifo = props.fifo || false;
    this.contentBasedDeduplication = props.contentBasedDeduplication || false;

    if (this.enforceSSL) {
      this.addSSLPolicy();
    }
  }

  /**
   * Adds a delivery status logging configuration to the topic.
   * NOTE: This method is difficult to implement correctly with Terraform's declarative model.
   * Configurations should be passed via the constructor's `loggingConfigs` prop.
   * This method is kept for potential future implementation or as a placeholder.
   */
  public addLoggingConfig(_config: LoggingConfig) {
    // In Terraform, modifying logging configs typically requires updating the snsTopic resource properties directly.
    // Dynamically adding configs post-instantiation like in CDK is not straightforward.
    // Consider managing logging configs declaratively through the constructor props.
    console.warn(
      "addLoggingConfig is not fully implemented for TerraConstructs SNS Topic due to limitations in declarative infrastructure management. Please provide logging configurations via the constructor.",
    );
    // If needed, one could potentially use Terraform overrides or complex state management,
    // but that goes against the typical declarative pattern.
  }

  /**
   * Adds an IAM policy statement to enforce the use of TLS for publishing to this topic.
   *
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html#enforce-encryption-data-in-transit
   */
  protected addSSLPolicy(): void {
    this.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "EnforcePublishSSL",
        actions: ["sns:Publish"],
        effect: iam.Effect.DENY,
        resources: [this.topicArn],
        principals: [new iam.AnyPrincipal()],
        condition: [
          {
            test: "Bool",
            variable: "aws:SecureTransport",
            values: ["false"],
          },
        ],
      }),
    );
  }
}

type Writeable<T> = { -readonly [P in keyof T]: T[P] };
