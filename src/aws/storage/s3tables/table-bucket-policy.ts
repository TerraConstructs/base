// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket-policy.ts
//
// TODO(alpha-tracker): ported from @aws-cdk/aws-s3tables-alpha@2.263.0-alpha.0 (stability:
// experimental). Re-diff against upstream on every reference-tag bump — alpha surfaces churn
// without deprecation cycles.

import { s3TablesTableBucketPolicy } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import type { ITableBucket } from "./table-bucket";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";
import * as iam from "../../iam";

/**
 * Parameters for constructing a TableBucketPolicy
 */
export interface TableBucketPolicyProps extends AwsConstructProps {
  /**
   * The associated table bucket
   */
  readonly tableBucket: ITableBucket;

  /**
   * The policy document for the bucket's resource policy
   *
   * TERRACONSTRUCTS DEVIATION: this repo's `iam.PolicyDocument` is itself a Construct (it renders
   * synth-time to a Terraform `aws_iam_policy_document` data source, see
   * `../../iam/policy-document.ts`), unlike upstream's plain data-object `iam.PolicyDocument`. A
   * fresh, scope-less `new iam.PolicyDocument({})` therefore cannot be used as the `@default` the
   * way upstream does -- see the constructor below for the TERRACONSTRUCTS-native replacement.
   *
   * @default undefined An empty iam.PolicyDocument will be initialized
   */
  readonly resourcePolicy?: iam.PolicyDocument;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.DESTROY`) is
  // CloudFormation's DeletionPolicy concept. `core.RemovalPolicy` is not ported anywhere in this
  // repo (identical omission to every other ported alpha module, e.g. `../redshift/cluster.ts`,
  // `../docdb/cluster.ts`) --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket-policy.ts#L23-L27
  // readonly removalPolicy?: RemovalPolicy;
}

/**
 * A Bucket Policy for S3 TableBuckets.
 *
 * You will almost never need to use this construct directly.
 * Instead, TableBucket.addToResourcePolicy can be used to add more policies to your bucket directly
 *
 * @resource aws_s3tables_table_bucket_policy
 */
export class TableBucketPolicy extends AwsConstructBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.s3tables.TableBucketPolicy";

  /**
   * The IAM PolicyDocument containing permissions represented by this policy.
   */
  public readonly document: iam.PolicyDocument;

  /**
   * The underlying policy resource.
   * @internal
   */
  private readonly _resource: s3TablesTableBucketPolicy.S3TablesTableBucketPolicy;

  public get outputs(): Record<string, any> {
    return {
      tableBucketArn: this._resource.tableBucketArn,
    };
  }

  constructor(scope: Construct, id: string, props: TableBucketPolicyProps) {
    // NOTE: `props.account`/`props.region` are intentionally NOT forwarded here -- identical
    // rationale to `TableBucket`'s constructor in `./table-bucket.ts` (see the note on
    // `TableBucketProps.region` there): forwarding them would give this construct's
    // `env.account`/`env.region` a literal value that defeats the
    // `iam.Grant.addToPrincipalOrResource()` same-account short-circuit (`../../iam/grant.ts`),
    // spuriously attaching a resource policy to every same-account grant.
    super(scope, id, { ...props, account: undefined, region: undefined });

    // Use default policy if not provided with props
    this.document =
      props.resourcePolicy ?? new iam.PolicyDocument(this, "Policy");

    this._resource = new s3TablesTableBucketPolicy.S3TablesTableBucketPolicy(
      this,
      "Resource",
      {
        tableBucketArn: props.tableBucket.tableBucketArn,
        resourcePolicy: this.document.json,
      },
    );

    // TODO: omitted — upstream's `props.removalPolicy ? this._resource.applyRemovalPolicy(...)`.
    // See the TODO on `TableBucketPolicyProps.removalPolicy` above.
  }
}
