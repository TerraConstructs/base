// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/aws-cdk-lib/aws-sqs/lib/queue-base.ts

import { Construct } from "constructs";
import { QueueGrants } from "./sqs-grants.generated";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../aws-construct";
import * as kms from "../encryption";
import * as iam from "../iam";
import { GrantOnKeyResult, IEncryptedResource, IGrantable } from "../iam";
import { QueuePolicy } from "./queue-policy";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface QueueOutputs {
  /**
   * Queue name
   */
  readonly name: string;

  /**
   * Queue arn
   */
  readonly arn: string;

  /**
   * Queue url
   */
  readonly url: string;
}

/**
 * Represents an SQS queue
 */
export interface IQueue extends iam.IAwsConstructWithPolicy, IAwsConstruct {
  /** Strongly typed outputs */
  readonly queueOutputs: QueueOutputs;

  /**
   * The ARN of this queue
   * @attribute
   */
  readonly queueArn: string;

  /**
   * The URL of this queue
   * @attribute
   */
  readonly queueUrl: string;

  /**
   * The name of this queue
   * @attribute
   */
  readonly queueName: string;

  /**
   * If this queue is server-side encrypted, this is the KMS encryption key.
   */
  readonly encryptionMasterKey?: kms.IKey;

  /**
   * Whether this queue is an Amazon SQS FIFO queue. If false, this is a standard queue.
   */
  readonly fifo: boolean;

  /**
   * Whether the contents of the queue are encrypted, and by what type of key.
   */
  readonly encryptionType?: QueueEncryption;

  /**
   * Grant permissions to consume messages from a queue
   *
   * This will grant the following permissions:
   *
   *   - sqs:ChangeMessageVisibility
   *   - sqs:DeleteMessage
   *   - sqs:ReceiveMessage
   *   - sqs:GetQueueAttributes
   *   - sqs:GetQueueUrl
   *
   * @param grantee Principal to grant consume rights to
   */
  grantConsumeMessages(grantee: iam.IGrantable): iam.Grant;

  /**
   * Grant access to send messages to a queue to the given identity.
   *
   * This will grant the following permissions:
   *
   *  - sqs:SendMessage
   *  - sqs:GetQueueAttributes
   *  - sqs:GetQueueUrl
   *
   * @param grantee Principal to grant send rights to
   */
  grantSendMessages(grantee: iam.IGrantable): iam.Grant;

  /**
   * Grant an IAM principal permissions to purge all messages from the queue.
   *
   * This will grant the following permissions:
   *
   *  - sqs:PurgeQueue
   *  - sqs:GetQueueAttributes
   *  - sqs:GetQueueUrl
   *
   * @param grantee Principal to grant send rights to
   */
  grantPurge(grantee: iam.IGrantable): iam.Grant;

  /**
   * Grant the actions defined in queueActions to the identity Principal given
   * on this SQS queue resource.
   *
   * @param grantee Principal to grant right to
   * @param queueActions The actions to grant
   */
  grant(grantee: iam.IGrantable, ...queueActions: string[]): iam.Grant;
}

/**
 * Reference to a new or existing Amazon SQS queue
 */
export abstract class QueueBase
  extends AwsConstructBase
  implements IQueue, IEncryptedResource
{
  public get queueOutputs(): QueueOutputs {
    return {
      name: this.queueName,
      arn: this.queueArn,
      url: this.queueUrl,
    };
  }

  public get outputs(): Record<string, any> {
    return this.queueOutputs;
  }

  /**
   * The ARN of this queue
   */
  public abstract readonly queueArn: string;

  /**
   * The URL of this queue
   */
  public abstract readonly queueUrl: string;

  /**
   * The name of this queue
   */
  public abstract readonly queueName: string;

  /**
   * If this queue is server-side encrypted, this is the KMS encryption key.
   */
  public abstract readonly encryptionMasterKey?: kms.IKey;

  /**
   * Whether this queue is an Amazon SQS FIFO queue. If false, this is a standard queue.
   */
  public abstract readonly fifo: boolean;

  /**
   * Whether the contents of the queue are encrypted, and by what type of key.
   */
  public abstract readonly encryptionType?: QueueEncryption;

  /**
   * Collection of grant methods for a Queue
   */
  public readonly grants = QueueGrants.fromQueue(this);

  /**
   * Controls automatic creation of policy objects.
   *
   * Set by subclasses.
   */
  protected abstract readonly autoCreatePolicy: boolean;

  private policy?: QueuePolicy;

  constructor(scope: Construct, id: string, props: AwsConstructProps = {}) {
    super(scope, id, props);

    this.node.addValidation({
      validate: () => this.policy?.document.validateForResourcePolicy() ?? [],
    });
  }

  public grantOnKey(
    grantee: IGrantable,
    ...actions: string[]
  ): GrantOnKeyResult {
    const grant = this.encryptionMasterKey
      ? this.encryptionMasterKey.grant(grantee, ...actions)
      : undefined;
    return { grant };
  }

  /**
   * Adds a statement to the IAM resource policy associated with this queue.
   *
   * If this queue was created in this stack (`new Queue`), a queue policy
   * will be automatically created upon the first call to `addToPolicy`.
   */
  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.policy && this.autoCreatePolicy) {
      this.policy = new QueuePolicy(this, "Policy", { queue: this });
    }

    if (this.policy) {
      this.policy.document.addStatements(statement);
      return { statementAdded: true, policyDependable: this.policy };
    }

    return { statementAdded: false };
  }

  /**
   * Grant permissions to consume messages from a queue
   *
   * This will grant the following permissions:
   *
   *   - sqs:ChangeMessageVisibility
   *   - sqs:DeleteMessage
   *   - sqs:ReceiveMessage
   *   - sqs:GetQueueAttributes
   *   - sqs:GetQueueUrl
   *
   * If encryption is used, permission to use the key to decrypt the contents of the queue will also be granted to the same principal.
   *
   * This will grant the following KMS permissions:
   *
   *   - kms:Decrypt
   *
   * @param grantee Principal to grant consume rights to
   */
  public grantConsumeMessages(grantee: iam.IGrantable) {
    return this.grants.consumeMessages(grantee);
  }

  /**
   * Grant access to send messages to a queue to the given identity.
   *
   * This will grant the following permissions:
   *
   *  - sqs:SendMessage
   *  - sqs:GetQueueAttributes
   *  - sqs:GetQueueUrl
   *
   * If encryption is used, permission to use the key to encrypt/decrypt the contents of the queue will also be granted to the same principal.
   *
   * This will grant the following KMS permissions:
   *
   *  - kms:Decrypt
   *  - kms:Encrypt
   *  - kms:ReEncrypt*
   *  - kms:GenerateDataKey*
   *
   * @param grantee Principal to grant send rights to
   */
  public grantSendMessages(grantee: iam.IGrantable) {
    return this.grants.sendMessages(grantee);
  }

  /**
   * Grant an IAM principal permissions to purge all messages from the queue.
   *
   * This will grant the following permissions:
   *
   *  - sqs:PurgeQueue
   *  - sqs:GetQueueAttributes
   *  - sqs:GetQueueUrl
   *
   * @param grantee Principal to grant send rights to
   */
  public grantPurge(grantee: iam.IGrantable) {
    return this.grants.purge(grantee);
  }

  /**
   * Grant the actions defined in queueActions to the identity Principal given
   * on this SQS queue resource.
   *
   * @param grantee Principal to grant right to
   * @param actions The actions to grant
   */
  public grant(grantee: iam.IGrantable, ...actions: string[]) {
    return iam.Grant.addToPrincipalOrResource({
      grantee,
      actions,
      resourceArns: [this.queueArn],
      resource: this,
    });
  }
}

/**
 * What kind of encryption to apply to this queue
 */
export enum QueueEncryption {
  /**
   * Messages in the queue are not encrypted
   */
  UNENCRYPTED = "NONE",

  /**
   * Server-side KMS encryption with a KMS key managed by SQS.
   */
  KMS_MANAGED = "KMS_MANAGED",

  /**
   * Server-side encryption with a KMS key managed by the user.
   *
   * If `encryptionKey` is specified, this key will be used, otherwise, one will be defined.
   */
  KMS = "KMS",

  /**
   * Server-side encryption key managed by SQS (SSE-SQS).
   *
   * To learn more about SSE-SQS on Amazon SQS, please visit the
   * [Amazon SQS documentation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html).
   */
  SQS_MANAGED = "SQS_MANAGED",
}
