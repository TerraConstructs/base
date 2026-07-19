// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-secretsmanager/lib/policy.ts

import { secretsmanagerSecretPolicy } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { ISecret } from "./secret";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { PolicyDocument } from "../iam";

/**
 * Construction properties for a ResourcePolicy
 */
export interface ResourcePolicyProps extends AwsConstructProps {
  /**
   * The secret to attach a resource-based permissions policy
   */
  readonly secret: ISecret;
}

/**
 * Resource Policy for SecretsManager Secrets
 *
 * Policies define the operations that are allowed on this resource.
 *
 * You almost never need to define this construct directly.
 *
 * All AWS resources that support resource policies have a method called
 * `addToResourcePolicy()`, which will automatically create a new resource
 * policy if one doesn't exist yet, otherwise it will add to the existing
 * policy.
 *
 * Prefer to use `addToResourcePolicy()` instead.
 */
export class ResourcePolicy extends AwsConstructBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.encryption.ResourcePolicy";

  /**
   * The underlying `aws_secretsmanager_secret_policy` resource.
   */
  public readonly resource: secretsmanagerSecretPolicy.SecretsmanagerSecretPolicy;

  /**
   * The IAM policy document for this policy.
   *
   * NOTE (TerraConstructs deviation): upstream's `iam.PolicyDocument` is a plain (non-Construct)
   * IResolvable that CloudFormation serializes inline on `CfnResourcePolicy.resourcePolicy`. This
   * repo's `PolicyDocument` synthesizes to its own `data.aws_iam_policy_document` data source and
   * therefore is itself a Construct requiring `(scope, id)` -- see `iam/policy-document.ts`.
   */
  public readonly document: PolicyDocument;

  public get outputs(): Record<string, any> {
    /**
     * This resource exports no additional attributes.
     *
     * NOTE: upstream's `CfnResourcePolicy.attrId` ('Id') doc-defines it as "The Arn of the
     * secret". Downstream code should reference `props.secret.secretArn` directly instead.
     */
    return {};
  }

  constructor(scope: Construct, id: string, props: ResourcePolicyProps) {
    super(scope, id, props);

    this.document = new PolicyDocument(this, "Policy");

    this.resource = new secretsmanagerSecretPolicy.SecretsmanagerSecretPolicy(
      this,
      "Resource",
      {
        secretArn: props.secret.secretArn,
        policy: this.document.json,
      },
    );
  }
}
