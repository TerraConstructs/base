/* eslint-disable prettier/prettier,max-len */
import * as sqs from './';
import * as iam from '../iam';

export interface QueueGrantsProps {
  /**
   * The SQS queue interface (IQueue) this helper will operate on.
   */
  readonly resource: sqs.IQueue;

  /**
   * If the queue is an encrypted resource, provides access to grant KMS key permissions.
   * Typically present if the resource implements iam.IEncryptedResource.
   */
  readonly encryptedResource?: iam.IEncryptedResource;

  /**
   * If the queue supports a resource policy, this enables addToPrincipalOrResource grants.
   * Typically present if the resource implements iam.IResourceWithPolicy.
   */
  readonly policyResource?: iam.IAwsConstructWithPolicy;
}

/**
 * Collection of grant methods for a IQueue
 */
export class QueueGrants {
  /**
   * Creates grants for QueueGrants
   */
  public static fromQueue(resource: sqs.IQueue): QueueGrants {
    // Use IAM helper type-guards to discover capabilities on the resource.
    const encryptedResource = iam.GrantableResources.isEncryptedResource(resource)
      ? (resource as unknown as iam.IEncryptedResource)
      : undefined;

    const policyResource = iam.GrantableResources.isResourceWithPolicy(resource)
      ? (resource as unknown as iam.IAwsConstructWithPolicy)
      : undefined;

    return new QueueGrants({
      resource,
      encryptedResource,
      policyResource,
    });
  }

  public readonly resource: sqs.IQueue;
  private readonly encryptedResource?: iam.IEncryptedResource;
  private readonly policyResource?: iam.IAwsConstructWithPolicy;

  private constructor(props: QueueGrantsProps) {
    this.resource = props.resource;
    this.encryptedResource = props.encryptedResource;
    this.policyResource = props.policyResource;
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
   */
  public consumeMessages(grantee: iam.IGrantable): iam.Grant {
    const actions = [
      'sqs:ReceiveMessage',
      'sqs:ChangeMessageVisibility',
      'sqs:GetQueueUrl',
      'sqs:DeleteMessage',
      'sqs:GetQueueAttributes',
    ];

    const resourceArns = [this.resource.queueArn];

    const result = this.policyResource
      ? iam.Grant.addToPrincipalOrResource({
          actions,
          grantee,
          resourceArns,
          resource: this.policyResource,
        })
      : iam.Grant.addToPrincipal({
          actions,
          grantee,
          resourceArns,
        });

    // If queue is encrypted, allow decrypt for message consumption.
    this.encryptedResource?.grantOnKey(grantee, 'kms:Decrypt');

    return result;
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
   */
  public sendMessages(grantee: iam.IGrantable): iam.Grant {
    const actions = [
      'sqs:SendMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
    ];

    const resourceArns = [this.resource.queueArn];

    const result = this.policyResource
      ? iam.Grant.addToPrincipalOrResource({
          actions,
          grantee,
          resourceArns,
          resource: this.policyResource,
        })
      : iam.Grant.addToPrincipal({
          actions,
          grantee,
          resourceArns,
        });

    // If queue is encrypted, allow the necessary KMS usage to send messages.
    this.encryptedResource?.grantOnKey(
      grantee,
      'kms:Decrypt',
      'kms:Encrypt',
      'kms:ReEncrypt*',
      'kms:GenerateDataKey*',
    );

    return result;
  }

  /**
   * Grants purge permissions
   */
  public purge(grantee: iam.IGrantable): iam.Grant {
    const actions = ['sqs:PurgeQueue', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'];
    const resourceArns = [this.resource.queueArn];

    return this.policyResource
      ? iam.Grant.addToPrincipalOrResource({
          actions,
          grantee,
          resourceArns,
          resource: this.policyResource,
        })
      : iam.Grant.addToPrincipal({
          actions,
          grantee,
          resourceArns,
               });
  }
}
