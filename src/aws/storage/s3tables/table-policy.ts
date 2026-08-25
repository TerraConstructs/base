// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-policy.ts
//
// TODO(alpha-tracker): ported from @aws-cdk/aws-s3tables-alpha@2.263.0-alpha.0 (stability:
// experimental). Re-diff against upstream on every reference-tag bump — alpha surfaces churn
// without deprecation cycles.

import { s3TablesTablePolicy } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import type { ITable } from "./table";
import { UnscopedValidationError } from "../../../errors";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";
import * as iam from "../../iam";

/**
 * Parameters for constructing a TablePolicy
 */
export interface TablePolicyProps extends AwsConstructProps {
  /**
   * The associated table
   *
   * TERRACONSTRUCTS DEVIATION: must have been constructed via `new Table(...)` in this stack (or
   * otherwise carry a `namespace`). `aws_s3tables_table_policy` identifies its target table via
   * `name` + `namespace` + `table_bucket_arn`, not a bare ARN — see the `ITable.namespace` TODO in
   * `./table.ts`. Tables imported via `Table.fromTableAttributes` don't carry a `namespace` and
   * will fail validation below.
   */
  readonly table: ITable;
  /**
   * The policy document for the table's resource policy
   * @default undefined An empty iam.PolicyDocument will be initialized
   */
  readonly resourcePolicy?: iam.PolicyDocument;

  // NOTE: this repo's `iam.PolicyDocument` is itself a Construct (it renders synth-time to a
  // Terraform `aws_iam_policy_document` data source, see `../../iam/policy-document.ts`), unlike
  // upstream's plain data-object `iam.PolicyDocument` -- identical deviation to
  // `TableBucketPolicyProps.resourcePolicy` in `./table-bucket-policy.ts`.

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.DESTROY`,
  // applied via `_resource.applyRemovalPolicy`) is CloudFormation's DeletionPolicy concept.
  // `core.RemovalPolicy` is not ported anywhere in this repo (see the identical omission on
  // `TableProps`/`NamespaceProps` in `./table.ts`/`./namespace.ts` and on every other ported
  // module, e.g. `../docdb/cluster.ts`). `aws_s3tables_table_policy` has no Terraform-native
  // lifecycle replacement to offer here —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-policy.ts#L24-L28
  // readonly removalPolicy?: RemovalPolicy;
}

/**
 * A Policy for S3 Tables.
 *
 * You will almost never need to use this construct directly.
 * Instead, Table.addToResourcePolicy can be used to add more policies to your table directly
 *
 * @resource aws_s3tables_table_policy
 */
export class TablePolicy extends AwsConstructBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.s3tables.TablePolicy";
  /**
   * The IAM PolicyDocument containing permissions represented by this policy.
   */
  public readonly document: iam.PolicyDocument;
  /**
   * @internal The underlying policy resource.
   */
  private readonly _resource: s3TablesTablePolicy.S3TablesTablePolicy;

  public get outputs(): Record<string, any> {
    return {
      tableBucketArn: this._resource.tableBucketArn,
    };
  }

  constructor(scope: Construct, id: string, props: TablePolicyProps) {
    // NOTE: `props.account`/`props.region` are intentionally NOT forwarded here -- identical
    // rationale to `TableBucket`'s constructor in `./table-bucket.ts` (see the note on
    // `TableBucketProps.region` there): forwarding them would give this construct's
    // `env.account`/`env.region` a literal value that defeats the
    // `iam.Grant.addToPrincipalOrResource()` same-account short-circuit (`../../iam/grant.ts`),
    // spuriously attaching a resource policy to every same-account grant.
    super(scope, id, { ...props, account: undefined, region: undefined });

    if (!props.table.namespace) {
      throw new UnscopedValidationError(
        "TablePolicyProps: 'table' must have been created via `new Table(...)` (with a `namespace`) — imported tables (`Table.fromTableAttributes`) cannot be targeted by a TablePolicy because `aws_s3tables_table_policy` has no ARN-only addressing mode.",
      );
    }

    // Use default policy if not provided with props
    this.document =
      props.resourcePolicy ?? new iam.PolicyDocument(this, "Policy");

    this._resource = new s3TablesTablePolicy.S3TablesTablePolicy(
      this,
      "Resource",
      {
        name: props.table.tableName,
        namespace: props.table.namespace.namespaceName,
        tableBucketArn: props.table.namespace.tableBucket.tableBucketArn,
        resourcePolicy: this.document.json,
      },
    );
  }
}
