// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-kinesis/lib/resource-policy.ts

import { kinesisResourcePolicy } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { AwsBeaconBase, AwsBeaconProps } from "../beacon";
import { IStream } from "./kinesis-stream";
import { PolicyDocument } from "../iam";

/**
 * Properties to associate a data stream with a policy
 */
export interface ResourcePolicyProps extends AwsBeaconProps {
  /**
   * The stream this policy applies to.
   */
  readonly stream: IStream;

  /**
   * IAM policy document to apply to a data stream.
   *
   * @default - empty policy document
   */
  readonly policyDocument?: PolicyDocument;
}

/**
 * The policy for a data stream or registered consumer.
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
  /**
   * The IAM policy document for this policy.
   */
  public readonly document: PolicyDocument;
  public get outputs(): Record<string, any> {
    /**
     * This resource exports no additional attributes.
     */
    return {};
  }

  constructor(scope: Construct, id: string, props: ResourcePolicyProps) {
    super(scope, id);

    this.document = props.policyDocument ?? new PolicyDocument(this, "Policy");

    new kinesisResourcePolicy.KinesisResourcePolicy(this, "Resource", {
      policy: this.document.json,
      resourceArn: props.stream.streamArn,
    });
  }
}
