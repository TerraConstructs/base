// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/aws-cdk-lib/aws-sqs/lib/queue.ts

import { sqsQueue } from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct } from "constructs";
import { Duration } from "../../duration";
import { ValidationError } from "../../errors";
import { validateAllProps, ValidationRule } from "../../helpers-internal";
import { ArnFormat } from "../arn";
import { IQueue, QueueBase, QueueEncryption } from "./queue-base";
import { AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as kms from "../encryption";
import * as iam from "../iam";

/**
 * Properties for creating a new Queue
 */
export interface QueueProps extends AwsConstructProps {
  /**
   * Queue Name prefix
   *
   * Queue names must be made up of only uppercase and lowercase ASCII letters,
   * numbers, underscores, and hyphens, and must be between 1 and 80 characters
   * long.
   *
   * Terraform Prefixes must reserve 26 characters for the terraform generated suffix.
   *
   * For a FIFO (first-in-first-out) queue, the name must end with the .fifo
   * @default - GridUUID + Stack Unique Name
   */
  readonly queueName?: string;

  /**
   * The number of seconds that Amazon SQS retains a message.
   *
   * You can specify an integer value from 60 seconds (1 minute) to 1209600
   * seconds (14 days). The default value is 345600 seconds (4 days).
   *
   * @default Duration.days(4)
   */
  readonly retentionPeriod?: Duration;

  /**
   * The time in seconds that the delivery of all messages in the queue is delayed.
   *
   * You can specify an integer value of 0 to 900 (15 minutes). The default
   * value is 0.
   *
   * @default 0
   */
  readonly deliveryDelay?: Duration;

  /**
   * The limit of how many bytes that a message can contain before Amazon SQS rejects it.
   *
   * You can specify an integer value from 1024 bytes (1 KiB) to 1048576 bytes
   * (1 MiB). The default value is 1048576 (1 MiB).
   *
   * @default 1MiB
   */
  readonly maxMessageSizeBytes?: number;

  /**
   * Default wait time for ReceiveMessage calls.
   *
   * Does not wait if set to 0, otherwise waits this amount of seconds
   * by default for messages to arrive.
   *
   * For more information, see Amazon SQS Long Poll.
   *
   *  @default 0
   */
  readonly receiveMessageWaitTime?: Duration;

  /**
   * Timeout of processing a single message.
   *
   * After dequeuing, the processor has this much time to handle the message
   * and delete it from the queue before it becomes visible again for dequeueing
   * by another processor.
   *
   * Values must be from 0 to 43200 seconds (12 hours). If you don't specify
   * a value, AWS CloudFormation uses the default value of 30 seconds.
   *
   * @default Duration.seconds(30)
   */
  readonly visibilityTimeout?: Duration;

  /**
   * Send messages to this queue if they were unsuccessfully dequeued a number of times.
   *
   * See [AWS Docs](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
   *
   * @default no dead-letter queue
   *
   * {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/sqs_queue#redrive_policy SqsQueue#redrive_policy}
   */
  readonly deadLetterQueue?: DeadLetterQueue;

  /**
   * Whether the contents of the queue are encrypted, and by what type of key.
   *
   * Be aware that encryption is not available in all regions, please see the docs
   * for current availability details.
   *
   * @default SQS_MANAGED (SSE-SQS) for newly created queues
   */
  readonly encryption?: QueueEncryption;

  /**
   * External KMS key to use for queue encryption.
   *
   * Individual messages will be encrypted using data keys. The data keys in
   * turn will be encrypted using this key, and reused for a maximum of
   * `dataKeyReuseSecs` seconds.
   *
   * If the 'encryptionMasterKey' property is set, 'encryption' type will be
   * implicitly set to "KMS".
   *
   * @default If encryption is set to KMS and not specified, a key will be created.
   */
  readonly encryptionMasterKey?: kms.IKey;

  /**
   * The length of time that Amazon SQS reuses a data key before calling KMS again.
   *
   * The value must be an integer between 60 (1 minute) and 86,400 (24
   * hours). The default is 300 (5 minutes).
   *
   * @default Duration.minutes(5)
   */
  readonly dataKeyReuse?: Duration;

  /**
   * Whether this a first-in-first-out (FIFO) queue.
   *
   * @default false, unless queueName ends in '.fifo' or 'contentBasedDeduplication' is true.
   */
  readonly fifo?: boolean;

  /**
   * Specifies whether to enable content-based deduplication.
   *
   * During the deduplication interval (5 minutes), Amazon SQS treats
   * messages that are sent with identical content (excluding attributes) as
   * duplicates and delivers only one copy of the message.
   *
   * If you don't enable content-based deduplication and you want to deduplicate
   * messages, provide an explicit deduplication ID in your SendMessage() call.
   *
   * (Only applies to FIFO queues.)
   *
   * @default false
   */
  readonly contentBasedDeduplication?: boolean;

  /**
   * For high throughput for FIFO queues, specifies whether message deduplication
   * occurs at the message group or queue level.
   *
   * (Only applies to FIFO queues.)
   *
   * @default DeduplicationScope.QUEUE
   */
  readonly deduplicationScope?: DeduplicationScope;

  /**
   * For high throughput for FIFO queues, specifies whether the FIFO queue
   * throughput quota applies to the entire queue or per message group.
   *
   * (Only applies to FIFO queues.)
   *
   * @default FifoThroughputLimit.PER_QUEUE
   */
  readonly fifoThroughputLimit?: FifoThroughputLimit;

  /**
   * Policy to apply when the queue is removed from the stack
   *
   * Even though queues are technically stateful, their contents are transient and it
   * is common to add and remove Queues while rearchitecting your application. The
   * default is therefore `DESTROY`. Change it to `RETAIN` if the messages are so
   * valuable that accidentally losing them would be unacceptable.
   *
   * @default RemovalPolicy.DESTROY
   */
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * Enforce encryption of data in transit.
   * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-security-best-practices.html#enforce-encryption-data-in-transit
   *
   * @default false
   */
  readonly enforceSSL?: boolean;

  /**
   * The string that includes the parameters for the permissions for the dead-letter queue
   * redrive permission and which source queues can specify dead-letter queues.
   *
   * @default - All source queues can designate this queue as their dead-letter queue.
   *
   * {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/sqs_queue#redrive_allow_policy SqsQueue#redrive_allow_policy}
   */
  readonly redriveAllowPolicy?: RedriveAllowPolicy;
}

/**
 * A new Amazon SQS queue
 */
export class Queue extends QueueBase {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.sqs.Queue";

  /**
   * Import an existing SQS queue provided an ARN
   *
   * @param scope The parent creating construct
   * @param id The construct's name
   * @param queueArn queue ARN (i.e. arn:aws:sqs:us-east-2:444455556666:queue1)
   */
  public static fromQueueArn(
    scope: Construct,
    id: string,
    queueArn: string,
  ): IQueue {
    const stack = AwsStack.ofAwsConstruct(scope);
    const parsedArn = stack.splitArn(queueArn, ArnFormat.NO_RESOURCE_NAME);
    const queueName = parsedArn.resource;
    const queueUrl = `https://sqs.${parsedArn.region}.${stack.urlSuffix}/${parsedArn.account}/${queueName}`;

    class Import extends QueueBase implements IQueue {
      public readonly queueArn = queueArn; // arn:aws:sqs:us-east-1:123456789012:queue1
      public readonly queueUrl = queueUrl;
      public readonly queueName = queueName;
      public readonly encryptionMasterKey = undefined;
      public readonly fifo: boolean = this.determineFifo();
      public readonly encryptionType = undefined;

      protected readonly autoCreatePolicy = false;

      /**
       * Determine fifo flag based on queueName and fifo attribute
       */
      private determineFifo(): boolean {
        if (Token.isUnresolved(this.queueArn)) {
          return false;
        } else {
          return queueName.endsWith(".fifo");
        }
      }
    }

    return new Import(scope, id, {
      environmentFromArn: queueArn,
    });
  }

  public readonly resource: sqsQueue.SqsQueue;

  /**
   * The ARN of this queue
   */
  public readonly queueArn: string;

  /**
   * The name of this queue
   */
  public readonly queueName: string;

  /**
   * The URL of this queue
   */
  public readonly queueUrl: string;

  /**
   * If this queue is encrypted, this is the KMS key.
   */
  public readonly encryptionMasterKey?: kms.IKey;

  /**
   * Whether this queue is an Amazon SQS FIFO queue. If false, this is a standard queue.
   */
  public readonly fifo: boolean;

  /**
   * Whether the contents of the queue are encrypted, and by what type of key.
   */
  public readonly encryptionType?: QueueEncryption;

  /**
   * If this queue is configured with a dead-letter queue, this is the dead-letter queue settings.
   */
  public readonly deadLetterQueue?: DeadLetterQueue;

  protected readonly autoCreatePolicy = true;

  private readonly physicalName: string;

  constructor(scope: Construct, id: string, props: QueueProps = {}) {
    super(scope, id, props);

    validateQueueProps(this, props);

    if (props.redriveAllowPolicy) {
      validateRedriveAllowPolicy(this, props.redriveAllowPolicy);
    }

    let namePrefix = props.queueName;
    if (namePrefix && !Token.isUnresolved(namePrefix)) {
      if (namePrefix.endsWith(".fifo")) {
        namePrefix = namePrefix.slice(0, -5);
      }
    }
    // TODO: Should we always have the gridUUID as the prefix?
    namePrefix = this.stack.uniqueResourceNamePrefix(this, {
      prefix: namePrefix ?? this.gridUUID + "-",
      allowedSpecialCharacters: "_-",
      maxLength: 80,
    });

    this.physicalName = namePrefix;
    const redrivePolicy = props.deadLetterQueue
      ? {
          deadLetterTargetArn: props.deadLetterQueue.queue.queueArn,
          maxReceiveCount: props.deadLetterQueue.maxReceiveCount,
        }
      : undefined;

    // When `redriveAllowPolicy` is provided, `redrivePermission` defaults to allow all queues (`ALLOW_ALL`);
    const redriveAllowPolicy = props.redriveAllowPolicy
      ? {
          redrivePermission:
            props.redriveAllowPolicy.redrivePermission ??
            // When `sourceQueues` is provided in `redriveAllowPolicy`, `redrivePermission` defaults to
            // allow specified queues (`BY_QUEUE`); otherwise, it defaults to allow all queues (`ALLOW_ALL`).
            (props.redriveAllowPolicy.sourceQueues
              ? RedrivePermission.BY_QUEUE
              : RedrivePermission.ALLOW_ALL),
          sourceQueueArns: props.redriveAllowPolicy.sourceQueues?.map(
            (q) => q.queueArn,
          ),
        }
      : undefined;

    const { encryptionMasterKey, encryptionProps, encryptionType } =
      _determineEncryptionProps.call(this);

    const fifoProps = this.determineFifoProps(props);
    this.fifo = fifoProps.fifoQueue || false;

    this.resource = new sqsQueue.SqsQueue(this, "Resource", {
      namePrefix: this.physicalName,
      ...fifoProps,
      ...encryptionProps,
      redrivePolicy: redrivePolicy ? JSON.stringify(redrivePolicy) : undefined,
      redriveAllowPolicy: redriveAllowPolicy
        ? JSON.stringify(redriveAllowPolicy)
        : undefined,
      delaySeconds: props.deliveryDelay?.toSeconds(),
      maxMessageSize: props.maxMessageSizeBytes,
      messageRetentionSeconds: props.retentionPeriod?.toSeconds(),
      receiveWaitTimeSeconds: props.receiveMessageWaitTime?.toSeconds(),
      visibilityTimeoutSeconds: props.visibilityTimeout?.toSeconds(),
    });
    // queue.applyRemovalPolicy(props.removalPolicy ?? RemovalPolicy.DESTROY);

    this.queueArn = this.resource.arn;
    this.queueName = this.resource.name;
    this.encryptionMasterKey = encryptionMasterKey;
    this.queueUrl = this.resource.url;
    this.deadLetterQueue = props.deadLetterQueue;
    this.encryptionType = encryptionType;

    function _determineEncryptionProps(this: Queue): {
      encryptionProps: EncryptionProps;
      encryptionMasterKey?: kms.IKey;
      encryptionType: QueueEncryption | undefined;
    } {
      let encryption = props.encryption;

      if (
        encryption === QueueEncryption.SQS_MANAGED &&
        props.encryptionMasterKey
      ) {
        throw new ValidationError(
          "'encryptionMasterKey' is not supported if encryption type 'SQS_MANAGED' is used",
          this,
        );
      }

      if (encryption !== QueueEncryption.KMS && props.encryptionMasterKey) {
        encryption = QueueEncryption.KMS; // KMS is implied by specifying an encryption key
      }

      if (!encryption) {
        return { encryptionProps: {}, encryptionType: encryption };
      }

      if (encryption === QueueEncryption.UNENCRYPTED) {
        return {
          encryptionType: encryption,
          encryptionProps: {
            sqsManagedSseEnabled: false,
          },
        };
      }

      if (encryption === QueueEncryption.KMS_MANAGED) {
        return {
          encryptionType: encryption,
          encryptionProps: {
            kmsMasterKeyId: "alias/aws/sqs",
            kmsDataKeyReusePeriodSeconds: props.dataKeyReuse?.toSeconds(),
          },
        };
      }

      if (encryption === QueueEncryption.KMS) {
        const masterKey =
          props.encryptionMasterKey ||
          new kms.Key(this, "Key", {
            description: `Created by ${this.node.path}`,
          });

        return {
          encryptionType: encryption,
          encryptionMasterKey: masterKey,
          encryptionProps: {
            kmsMasterKeyId: masterKey.keyArn,
            kmsDataKeyReusePeriodSeconds: props.dataKeyReuse?.toSeconds(),
          },
        };
      }

      if (encryption === QueueEncryption.SQS_MANAGED) {
        return {
          encryptionType: encryption,
          encryptionProps: {
            sqsManagedSseEnabled: true,
          },
        };
      }

      throw new ValidationError(
        `Unexpected 'encryptionType': ${encryption}`,
        this,
      );
    }

    // Enforce encryption of data in transit
    if (props.enforceSSL) {
      this.enforceSSLStatement();
    }
  }

  /**
   * Look at the props, see if the FIFO props agree, and return the correct subset of props
   */
  private determineFifoProps(props: QueueProps): FifoProps {
    // Check if any of the signals that we have say that this is a FIFO queue.
    let fifoQueue = props.fifo;
    const queueName = props.queueName;
    if (
      typeof fifoQueue === "undefined" &&
      queueName &&
      !Token.isUnresolved(queueName) &&
      queueName.endsWith(".fifo")
    ) {
      fifoQueue = true;
    }
    if (typeof fifoQueue === "undefined" && props.contentBasedDeduplication) {
      fifoQueue = true;
    }
    if (typeof fifoQueue === "undefined" && props.deduplicationScope) {
      fifoQueue = true;
    }
    if (typeof fifoQueue === "undefined" && props.fifoThroughputLimit) {
      fifoQueue = true;
    }

    // If we have a name, see that it agrees with the FIFO setting
    if (typeof queueName === "string") {
      if (fifoQueue && !queueName.endsWith(".fifo")) {
        throw new ValidationError("FIFO queue names must end in '.fifo'", this);
      }
      if (!fifoQueue && queueName.endsWith(".fifo")) {
        throw new ValidationError(
          "Non-FIFO queue name may not end in '.fifo'",
          this,
        );
      }
    }

    if (props.contentBasedDeduplication && !fifoQueue) {
      throw new ValidationError(
        "Content-based deduplication can only be defined for FIFO queues",
        this,
      );
    }

    if (props.deduplicationScope && !fifoQueue) {
      throw new ValidationError(
        "Deduplication scope can only be defined for FIFO queues",
        this,
      );
    }

    if (props.fifoThroughputLimit && !fifoQueue) {
      throw new ValidationError(
        "FIFO throughput limit can only be defined for FIFO queues",
        this,
      );
    }

    return {
      contentBasedDeduplication: props.contentBasedDeduplication,
      deduplicationScope: props.deduplicationScope,
      fifoThroughputLimit: props.fifoThroughputLimit,
      fifoQueue,
    };
  }

  /**
   * Adds an iam statement to enforce encryption of data in transit.
   */
  private enforceSSLStatement() {
    const statement = new iam.PolicyStatement({
      actions: ["sqs:*"],
      condition: [
        {
          test: "Bool",
          variable: "aws:SecureTransport",
          values: ["false"],
        },
      ],
      effect: iam.Effect.DENY,
      resources: [this.queueArn],
      principals: [new iam.AnyPrincipal()],
    });
    this.addToResourcePolicy(statement);
  }
}

interface FifoProps {
  readonly fifoQueue?: boolean;
  readonly contentBasedDeduplication?: boolean;
  readonly deduplicationScope?: DeduplicationScope;
  readonly fifoThroughputLimit?: FifoThroughputLimit;
}

interface EncryptionProps {
  readonly kmsMasterKeyId?: string;
  readonly kmsDataKeyReusePeriodSeconds?: number;
  readonly sqsManagedSseEnabled?: boolean;
}

/**
 * Dead letter queue settings
 */
export interface DeadLetterQueue {
  /**
   * The dead-letter queue to which Amazon SQS moves messages after the value of maxReceiveCount is exceeded.
   */
  readonly queue: IQueue;

  /**
   * The number of times a message can be unsuccessfully dequeued before being moved to the dead-letter queue.
   */
  readonly maxReceiveCount: number;
}

/**
 * Permission settings for the dead letter source queue
 */
export interface RedriveAllowPolicy {
  /**
   * Permission settings for source queues that can designate this queue as their dead-letter queue.
   *
   * @default - `RedrivePermission.BY_QUEUE` if `sourceQueues` is specified,`RedrivePermission.ALLOW_ALL` otherwise.
   */
  readonly redrivePermission?: RedrivePermission;

  /**
   * Source queues that can designate this queue as their dead-letter queue.
   *
   * When `redrivePermission` is set to `RedrivePermission.BY_QUEUE`, this parameter is required.
   *
   * You can specify up to 10 source queues.
   * To allow more than 10 source queues to specify dead-letter queues, set the `redrivePermission` to
   * `RedrivePermission.ALLOW_ALL`.
   *
   * When `redrivePermission` is either `RedrivePermission.ALLOW_ALL` or `RedrivePermission.DENY_ALL`,
   * this parameter cannot be set.
   *
   * @default - Required when `redrivePermission` is `RedrivePermission.BY_QUEUE`, cannot be defined otherwise.
   */
  readonly sourceQueues?: IQueue[];
}

/**
 * What kind of deduplication scope to apply
 */
export enum DeduplicationScope {
  /**
   * Deduplication occurs at the message group level
   */
  MESSAGE_GROUP = "messageGroup",
  /**
   * Deduplication occurs at the message queue level
   */
  QUEUE = "queue",
}

/**
 * Whether the FIFO queue throughput quota applies to the entire queue or per message group
 */
export enum FifoThroughputLimit {
  /**
   * Throughput quota applies per queue
   */
  PER_QUEUE = "perQueue",
  /**
   * Throughput quota applies per message group id
   */
  PER_MESSAGE_GROUP_ID = "perMessageGroupId",
}

/**
 * The permission type that defines which source queues can specify the current queue as the dead-letter queue
 */
export enum RedrivePermission {
  /**
   * Any source queues in this AWS account in the same Region can specify this queue as the dead-letter queue
   */
  ALLOW_ALL = "allowAll",
  /**
   * No source queues can specify this queue as the dead-letter queue
   */
  DENY_ALL = "denyAll",
  /**
   * Only queues specified by the `sourceQueueArns` parameter can specify this queue as the dead-letter queue
   */
  BY_QUEUE = "byQueue",
}

// ref: https://github.com/aws/aws-cdk/blob/v2.232.2/packages/aws-cdk-lib/aws-sqs/lib/validate-queue-props.ts

function validateRange(
  value: number | undefined,
  minValue: number,
  maxValue: number,
): boolean {
  return (
    value !== undefined &&
    !Token.isUnresolved(value) &&
    (value < minValue || value > maxValue)
  );
}

const queueValidationRules: ValidationRule<QueueProps>[] = [
  {
    condition: (props) =>
      validateRange(props.deliveryDelay?.toSeconds(), 0, 900),
    message: (props) =>
      `delivery delay must be between 0 and 900 seconds, but ${props.deliveryDelay?.toSeconds()} was provided`,
  },
  {
    condition: (props) =>
      validateRange(props.maxMessageSizeBytes, 1_024, 1_048_576),
    message: (props) =>
      `maximum message size must be between 1,024 and 1,048,576 bytes, but ${props.maxMessageSizeBytes} was provided`,
  },
  {
    condition: (props) =>
      validateRange(props.retentionPeriod?.toSeconds(), 60, 1_209_600),
    message: (props) =>
      `message retention period must be between 60 and 1,209,600 seconds, but ${props.retentionPeriod?.toSeconds()} was provided`,
  },
  {
    condition: (props) =>
      validateRange(props.receiveMessageWaitTime?.toSeconds(), 0, 20),
    message: (props) =>
      `receive wait time must be between 0 and 20 seconds, but ${props.receiveMessageWaitTime?.toSeconds()} was provided`,
  },
  {
    condition: (props) =>
      validateRange(props.visibilityTimeout?.toSeconds(), 0, 43_200),
    message: (props) =>
      `visibility timeout must be between 0 and 43,200 seconds, but ${props.visibilityTimeout?.toSeconds()} was provided`,
  },
  {
    condition: (props) =>
      validateRange(
        props.deadLetterQueue?.maxReceiveCount,
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    message: (props) =>
      `dead letter target maximum receive count must be 1 or more, but ${props.deadLetterQueue?.maxReceiveCount} was provided`,
  },
];

const redriveValidationRules: ValidationRule<RedriveAllowPolicy>[] = [
  {
    condition: ({ redrivePermission, sourceQueues }) =>
      redrivePermission === RedrivePermission.BY_QUEUE &&
      (!sourceQueues || sourceQueues.length === 0),
    message: () =>
      "At least one source queue must be specified when RedrivePermission is set to 'byQueue'",
  },
  {
    condition: ({ redrivePermission, sourceQueues }) =>
      !!(
        redrivePermission === RedrivePermission.BY_QUEUE &&
        sourceQueues &&
        sourceQueues.length > 10
      ),
    message: () =>
      "Up to 10 sourceQueues can be specified. Set RedrivePermission to 'allowAll' to specify more",
  },
  {
    condition: ({ redrivePermission, sourceQueues }) =>
      !!(
        (redrivePermission === RedrivePermission.ALLOW_ALL ||
          redrivePermission === RedrivePermission.DENY_ALL) &&
        sourceQueues
      ),
    message: () =>
      "sourceQueues cannot be configured when RedrivePermission is set to 'allowAll' or 'denyAll'",
  },
];

export function validateQueueProps(scope: Construct, props: QueueProps) {
  validateAllProps(scope, Queue.name, props, queueValidationRules);
}

export function validateRedriveAllowPolicy(
  scope: Construct,
  policy: RedriveAllowPolicy,
) {
  validateAllProps(scope, Queue.name, policy, redriveValidationRules);
}
