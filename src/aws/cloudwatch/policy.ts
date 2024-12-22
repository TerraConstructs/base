//https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-logs/lib/policy.ts

import { cloudwatchLogResourcePolicy } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { AwsBeaconBase, AwsBeaconProps } from "../beacon";
import { PolicyDocument, PolicyStatement } from "../iam";

/**
 * Properties to define Cloudwatch log group resource policy
 */
export interface ResourcePolicyProps extends AwsBeaconProps {
  /**
   * Name of the log group resource policy
   * @default - Uses a unique id based on the construct path
   */
  readonly resourcePolicyName?: string;

  /**
   * Initial statements to add to the resource policy
   *
   * @default - No statements
   */
  readonly policyStatements?: PolicyStatement[];
}

/**
 * Resource Policy for CloudWatch Log Groups
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
export class ResourcePolicy extends AwsBeaconBase {
  public readonly resource: cloudwatchLogResourcePolicy.CloudwatchLogResourcePolicy;
  public get outputs(): Record<string, any> {
    return {
      // The name of the CloudWatch log resource policy
      id: this.resource.id,
    };
  }

  /**
   * The IAM policy document for this resource policy.
   */
  public readonly document: PolicyDocument;

  constructor(scope: Construct, id: string, props: ResourcePolicyProps = {}) {
    super(scope, id, props);
    const policyName =
      props.resourcePolicyName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
      });

    this.document = new PolicyDocument(this, "Policy");
    this.resource = new cloudwatchLogResourcePolicy.CloudwatchLogResourcePolicy(
      this,
      "Resource",
      {
        policyDocument: this.document.json,
        policyName,
      },
    );
    if (props?.policyStatements) {
      this.document.addStatements(...props.policyStatements);
    }
  }
}
