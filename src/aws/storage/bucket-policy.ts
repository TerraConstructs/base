import { s3BucketPolicy } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { AwsBeaconProps, AwsBeaconBase } from "../beacon";
import { IBucket } from "./bucket";
import { PolicyDocument } from "../iam";

export interface BucketPolicyProps extends AwsBeaconProps {
  /**
   * The Amazon S3 bucket that the policy applies to.
   */
  readonly bucket: IBucket;
}

/**
 * The bucket policy for an Amazon S3 bucket
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
 * The bucket policy method is implemented differently than `addToResourcePolicy()`
 * as `BucketPolicy()` creates a new policy without knowing one earlier existed.
 * e.g. if during Bucket creation, if `autoDeleteObject:true`, these policies are
 * added to the bucket policy:
 *    ["s3:DeleteObject*", "s3:GetBucket*", "s3:List*", "s3:PutBucketPolicy"],
 * and when you add a new BucketPolicy with ["s3:GetObject", "s3:ListBucket"] on
 * this existing bucket, invoking `BucketPolicy()` will create a new Policy
 * without knowing one earlier exists already, so it creates a new one.
 * In this case, the custom resource handler will not have access to
 * `s3:GetBucketTagging` action which will cause failure during deletion of stack.
 *
 * Hence its strongly recommended to use `addToResourcePolicy()` method to add
 * new permissions to existing policy.
 *
 */
export class BucketPolicy extends AwsBeaconBase {
  // TODO: re-add static from Method
  public readonly resource: s3BucketPolicy.S3BucketPolicy;
  public get outputs(): Record<string, any> {
    return {};
  }

  /**
   * A policy document containing permissions to add to the specified bucket.
   * For more information, see Access Policy Language Overview in the Amazon
   * Simple Storage Service Developer Guide.
   */
  public readonly document: PolicyDocument;

  /** The Bucket this Policy applies to. */
  public readonly bucket: IBucket;

  constructor(scope: Construct, id: string, props: BucketPolicyProps) {
    super(scope, id);

    this.bucket = props.bucket;
    this.document = new PolicyDocument(this, "Policy");

    this.resource = new s3BucketPolicy.S3BucketPolicy(this, "Resource", {
      bucket: this.bucket.bucketName,
      policy: this.document.json,
    });
  }
}
