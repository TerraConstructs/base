/* eslint-disable prettier/prettier,max-len */
import * as sns from './';
import * as iam from '../iam';

export interface TopicGrantsProps {
  /**
   * The SQS topic interface (ITopic) this helper will operate on.
   */
  readonly resource: sns.ITopic;

  /**
   * If the topic is an encrypted resource, provides access to grant KMS key permissions.
   * Typically present if the resource implements iam.IEncryptedResource.
   */
  readonly encryptedResource?: iam.IEncryptedResource;

  /**
   * If the topic supports a resource policy, this enables addToPrincipalOrResource grants.
   * Typically present if the resource implements iam.IResourceWithPolicy.
   */
  readonly policyResource?: iam.IAwsConstructWithPolicy;
}

/**
 * Collection of grant methods for a ITopic
 */
export class TopicGrants {
  /**
   * Creates grants for TopicGrants
   */
  public static fromTopic(resource: sns.ITopic): TopicGrants {
    // Use IAM helper type-guards to discover capabilities on the resource.
    const encryptedResource = iam.GrantableResources.isEncryptedResource(resource)
      ? (resource as unknown as iam.IEncryptedResource)
      : undefined;

    const policyResource = iam.GrantableResources.isResourceWithPolicy(resource)
      ? (resource as unknown as iam.IAwsConstructWithPolicy)
      : undefined;

    return new TopicGrants({
      resource,
      encryptedResource,
      policyResource,
    });
  }

  public readonly resource: sns.ITopic;
  private readonly encryptedResource?: iam.IEncryptedResource;
  private readonly policyResource?: iam.IAwsConstructWithPolicy;

  private constructor(props: TopicGrantsProps) {
    this.resource = props.resource;
    this.encryptedResource = props.encryptedResource;
    this.policyResource = props.policyResource;
  }

  /**
   * Grant topic publishing permissions to the given identity
   */
  public publish(grantee: iam.IGrantable): iam.Grant {
    const actions = ['sns:Publish'];

    const resourceArns = [this.resource.topicArn];

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

    this.encryptedResource?.grantOnKey(
      grantee,
      'kms:Decrypt',
      'kms:GenerateDataKey*'
    );

    return result;
  }

  /**
   * Grant topic subscribing permissions to the given identity
   */
  public subscribe(grantee: iam.IGrantable): iam.Grant {
    const actions = ['sns:Subscribe'];
    const resourceArns = [this.resource.topicArn];

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
