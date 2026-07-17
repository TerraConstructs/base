// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-secretsmanager/lib/policy.ts

import { secretsmanagerSecretPolicy } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { ISecret } from "./secret";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import * as iam from "../iam";

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
  /**
   * The IAM policy document for this policy.
   */
  public readonly document = new iam.PolicyDocument(this, "Document");

  public get outputs(): Record<string, any> {
    return {};
  }

  constructor(scope: Construct, id: string, props: ResourcePolicyProps) {
    super(scope, id, props);

    new secretsmanagerSecretPolicy.SecretsmanagerSecretPolicy(
      this,
      "Resource",
      {
        policy: this.document.json,
        secretArn: props.secret.secretArn,
      },
    );
  }
}
