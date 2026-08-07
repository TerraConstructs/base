// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket.ts
//
// TODO(alpha-tracker): ported from @aws-cdk/aws-s3tables-alpha@2.263.0-alpha.0 (stability:
// experimental). Re-diff against upstream on every reference-tag bump — alpha surfaces churn
// without deprecation cycles.
//
// SCOPE REDUCTION (this PR): a few upstream surfaces have no Terraform-native equivalent or are
// CloudFormation-only mechanisms -- see the TERRACONSTRUCTS DEVIATION / TODO notes at each call
// site below:
//   - `removalPolicy`               -- OMITTED (commented out, not deleted): CloudFormation's
//                                      DeletionPolicy concept. `core.RemovalPolicy` is not ported
//                                      anywhere in this repo.
//   - `requestMetricsStatus` /      -- OMITTED (commented out, not deleted): the
//     `RequestMetricsStatus` / `aws_s3tables_table_bucket` Terraform resource (provider 6.52.0) has
//     `MetricsConfiguration`          no `metrics_configuration` argument at all -- verified against
//                                      the full config shape in
//                                      `node_modules/@cdktn/provider-aws/lib/s3tables-table-bucket/index.d.ts`.
//   - `ITaggableV2`/`cdkTagManager` -- OMITTED: this repo has no CDK-style `TagManager`. Any
//                                      `aws_s3tables_table_bucket` (it has native `tags`/`tagsInput`
//                                      arguments) is tagged automatically by the repo-wide
//                                      `GridTags` Aspect (`../../construct-base.ts`) -- identical
//                                      omission to every other ported alpha module in this repo.

import { EOL } from "node:os";
import { s3TablesTableBucket } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import * as perms from "./permissions";
import { TableBucketPolicy } from "./table-bucket-policy";
import { validateTableBucketAttributes } from "./util";
import { UnscopedValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as kms from "../../encryption";
import * as iam from "../../iam";

/**
 * Interface definition for S3 Table Buckets
 */
export interface ITableBucket extends IAwsConstruct {
  /**
   * The ARN of the table bucket.
   * @attribute
   */
  readonly tableBucketArn: string;

  /**
   * The name of the table bucket.
   * @attribute
   */
  readonly tableBucketName: string;

  /**
   * The accountId containing the table bucket.
   * @attribute
   */
  readonly account?: string;

  /**
   * The region containing the table bucket.
   * @attribute
   */
  readonly region?: string;

  /**
   * Optional KMS encryption key associated with this table bucket.
   */
  readonly encryptionKey?: kms.IKey;

  /**
   * Adds a statement to the resource policy for a principal (i.e.
   * account/role/service) to perform actions on this table bucket and/or its
   * tables.
   *
   * Note that the policy statement may or may not be added to the policy.
   * For example, when an `ITableBucket` is created from an existing table bucket,
   * it's not possible to tell whether the bucket already has a policy
   * attached, let alone to re-use that policy to add more statements to it.
   * So it's safest to do nothing in these cases.
   *
   * @param statement the policy statement to be added to the bucket's
   * policy.
   * @returns metadata about the execution of this method. If the policy
   * was not added, the value of `statementAdded` will be `false`. You
   * should always check this value to make sure that the operation was
   * actually carried out. Otherwise, synthesis and deploy will terminate
   * silently, which may be confusing.
   */
  addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult;

  /**
   * Grant read permissions for this table bucket and its tables
   * to an IAM principal (Role/Group/User).
   *
   * If encryption is used, permission to use the key to decrypt the contents
   * of the bucket will also be granted to the same principal.
   *
   * @param identity The principal to allow read permissions to
   * @param tableId Allow the permissions to all tables using '*' or to single table by its unique ID.
   */
  grantRead(identity: iam.IGrantable, tableId: string): iam.Grant;

  /**
   * Grant write permissions for this table bucket and its tables
   * to an IAM principal (Role/Group/User).
   *
   * If encryption is used, permission to use the key to encrypt the contents
   * of the bucket will also be granted to the same principal.
   *
   * @param identity The principal to allow write permissions to
   * @param tableId Allow the permissions to all tables using '*' or to single table by its unique ID.
   */
  grantWrite(identity: iam.IGrantable, tableId: string): iam.Grant;

  /**
   * Grant read and write permissions for this table bucket and its tables
   * to an IAM principal (Role/Group/User).
   *
   * If encryption is used, permission to use the key to encrypt/decrypt the contents
   * of the bucket will also be granted to the same principal.
   *
   * @param identity The principal to allow read and write permissions to
   * @param tableId Allow the permissions to all tables using '*' or to single table by its unique ID.
   */
  grantReadWrite(identity: iam.IGrantable, tableId: string): iam.Grant;
}

/**
 * Unreferenced file removal settings for the this table bucket.
 */
export interface UnreferencedFileRemoval {
  /**
   * Duration after which noncurrent files should be removed. Should be at least one day.
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-table-buckets-maintenance.html
   *
   * @default - See S3 Tables User Guide
   */
  readonly noncurrentDays?: number;

  /**
   * Status of unreferenced file removal. Can be Enabled or Disabled.
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-table-buckets-maintenance.html
   *
   * @default - See S3 Tables User Guide
   */
  readonly status?: UnreferencedFileRemovalStatus;

  /**
   * Duration after which unreferenced files should be removed. Should be at least one day.
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-table-buckets-maintenance.html
   *
   * @default - See S3 Tables User Guide
   */
  readonly unreferencedDays?: number;
}

/**
 * Controls whether unreferenced file removal is enabled or disabled.
 */
export enum UnreferencedFileRemovalStatus {
  /**
   * Enable unreferenced file removal.
   */
  ENABLED = "Enabled",

  /**
   * Disable unreferenced file removal.
   */
  DISABLED = "Disabled",
}

// TODO: omitted — upstream's `RequestMetricsStatus` enum (consumed by
// `TableBucketProps.requestMetricsStatus` below) has no Terraform-native equivalent. See the
// file-header SCOPE REDUCTION note --
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket.ts#L150-L163
// export enum RequestMetricsStatus {
//   ENABLED = 'Enabled',
//   DISABLED = 'Disabled',
// }

/**
 * Controls Server Side Encryption (SSE) for this TableBucket.
 */
export enum TableBucketEncryption {
  /**
   * Use a customer defined KMS key for encryption
   * If `encryptionKey` is specified, this key will be used, otherwise, one will be defined.
   */
  KMS = "aws:kms",

  /**
   * Use S3 managed encryption keys with AES256 encryption
   */
  S3_MANAGED = "AES256",
}

abstract class TableBucketBase
  extends AwsConstructBase
  implements ITableBucket
{
  public abstract readonly tableBucketArn: string;
  public abstract readonly tableBucketName: string;

  /**
   * The resource policy associated with this table bucket.
   *
   * If `autoCreatePolicy` is true, a `TableBucketPolicy` will be created upon the
   * first call to addToResourcePolicy(s).
   */
  public abstract tableBucketPolicy?: TableBucketPolicy;

  /**
   * Indicates if a table bucket resource policy should automatically created upon
   * the first call to `addToResourcePolicy`.
   */
  protected abstract autoCreatePolicy: boolean;

  public abstract encryptionKey?: kms.IKey | undefined;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * e.g. `ClusterBase.outputs` in `../redshift/cluster.ts`) — bare, bound-per-construct `outputs`
   * for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      tableBucketArn: this.tableBucketArn,
      tableBucketName: this.tableBucketName,
    };
  }

  /**
   * Adds a statement to the resource policy for a principal (i.e.
   * account/role/service) to perform actions on this table bucket and/or its
   * contents. Use `tableBucketArn` and `arnForObjects(keys)` to obtain ARNs for
   * this bucket or objects.
   *
   * Note that the policy statement may or may not be added to the policy.
   * For example, when an `ITableBucket` is created from an existing table bucket,
   * it's not possible to tell whether the bucket already has a policy
   * attached, let alone to re-use that policy to add more statements to it.
   * So it's safest to do nothing in these cases.
   *
   * @param statement the policy statement to be added to the bucket's
   * policy.
   * @returns metadata about the execution of this method. If the policy
   * was not added, the value of `statementAdded` will be `false`. You
   * should always check this value to make sure that the operation was
   * actually carried out. Otherwise, synthesis and deploy will terminate
   * silently, which may be confusing.
   */
  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.tableBucketPolicy && this.autoCreatePolicy) {
      this.tableBucketPolicy = new TableBucketPolicy(this, "DefaultPolicy", {
        tableBucket: this,
      });
    }

    if (this.tableBucketPolicy) {
      this.tableBucketPolicy.document.addStatements(statement);
      return { statementAdded: true, policyDependable: this.tableBucketPolicy };
    }

    return { statementAdded: false };
  }

  /**
   * [disable-awslint:no-grants]
   */
  public grantRead(identity: iam.IGrantable, tableId: string) {
    return this.grant(
      identity,
      perms.TABLE_BUCKET_READ_ACCESS,
      perms.KEY_READ_ACCESS,
      this.tableBucketArn,
      this.getTableArn(tableId),
    );
  }

  /**
   * [disable-awslint:no-grants]
   */
  public grantWrite(identity: iam.IGrantable, tableId: string) {
    return this.grant(
      identity,
      perms.TABLE_BUCKET_WRITE_ACCESS,
      perms.KEY_READ_WRITE_ACCESS,
      this.tableBucketArn,
      this.getTableArn(tableId),
    );
  }

  /**
   * [disable-awslint:no-grants]
   */
  public grantReadWrite(identity: iam.IGrantable, tableId: string) {
    return this.grant(
      identity,
      perms.TABLE_BUCKET_READ_WRITE_ACCESS,
      perms.KEY_WRITE_ACCESS,
      this.tableBucketArn,
      this.getTableArn(tableId),
    );
  }

  /**
   * Grants the given s3tables permissions to the provided principal
   * @returns Grant object
   */
  private grant(
    grantee: iam.IGrantable,
    tableBucketActions: string[],
    keyActions: string[],
    resourceArn: string,
    ...otherResourceArns: (string | undefined)[]
  ) {
    const resources = [resourceArn, ...otherResourceArns].filter(
      (arn) => arn != undefined,
    );

    const grant = iam.Grant.addToPrincipalOrResource({
      grantee,
      actions: tableBucketActions,
      resourceArns: resources,
      resource: this,
    });

    if (this.encryptionKey && keyActions && keyActions.length !== 0) {
      this.encryptionKey.grant(grantee, ...keyActions);
    }

    return grant;
  }

  private getTableArn(tableId: string | undefined) {
    return tableId ? `${this.tableBucketArn}/table/${tableId}` : undefined;
  }
}

/**
 * Parameters for constructing a TableBucket
 */
export interface TableBucketProps extends AwsConstructProps {
  /**
   * Name of the S3 TableBucket.
   *
   * TERRACONSTRUCTS DEVIATION: kept required, matching upstream verbatim (CFN's
   * `AWS::S3Tables::TableBucket.TableBucketName` is likewise required), rather than adopting this
   * repo's `this.stack.uniqueResourceName(this, {...})` LOWERCASED-default house pattern used by
   * sibling ports (e.g. `../docdb/cluster.ts`, `../neptune/cluster.ts`,
   * `../elasticache/serverless-cache.ts`, `../backup/vault.ts`, `../table.ts`). S3 Tables bucket
   * names are also S3-bucket-like (globally-scoped charset, 3-63 chars -- see
   * `validateTableBucketName` below), same as those sibling constructs, so a default could be
   * added later without a breaking change if desired.
   * @link https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-buckets-naming.html#table-buckets-naming-rules
   */
  readonly tableBucketName: string;

  /**
   * Unreferenced file removal settings for the S3 TableBucket.
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3tables-tablebucket-unreferencedfileremoval.html
   * @default Enabled with default values
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-table-buckets-maintenance.html
   */
  readonly unreferencedFileRemoval?: UnreferencedFileRemoval;

  // TERRACONSTRUCTS DEVIATION: upstream `TableBucketProps` separately re-declares its own
  // `region`/`account` fields (with `@default` docs identical in spirit to
  // `AwsConstructProps.region`/`.account` below) --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket.ts#L327-L338
  // -- and, like this port, never forwards them to `super()` (verified against the upstream
  // constructor body at
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket.ts#L613-L639
  // -- only `physicalName` is passed through). Unlike upstream's plain CDK `ResourceProps`, this
  // repo's `AwsConstructProps` (extended above) ALREADY declares `region?: string`/`account?:
  // string` for environment-override purposes (see `../../aws-construct.ts`) -- re-declaring them
  // here verbatim is not merely redundant, it is a hard jsii compile error (JSII5015: interfaces
  // may not re-declare an inherited member, even with an identical type, because it is invalid
  // C#). So this port relies on the inherited `AwsConstructProps.region`/`.account` fields instead
  // of its own copies.
  //
  // Inherited `region`/`account` are still deliberately NOT forwarded to `super()` below, exactly
  // as upstream ignores its own copies: doing so would give this construct's `env.account`/
  // `env.region` a literal value that diverges from sibling same-stack principals' (still-token)
  // default account, which defeats the `iam.Grant.addToPrincipalOrResource()` same-account
  // short-circuit (`../../iam/grant.ts`) and spuriously attaches a resource policy to every
  // same-account role/user grant. See the constructor's `super(scope, id, { ...props, account:
  // undefined, region: undefined })` call.

  /**
   * The kind of server-side encryption to apply to this bucket.
   *
   * If you choose KMS, you can specify a KMS key via `encryptionKey`. If
   * encryption key is not specified, a key will automatically be created.
   *
   * @default - `KMS` if `encryptionKey` is specified, or `S3_MANAGED` otherwise.
   */
  readonly encryption?: TableBucketEncryption;

  /**
   * External KMS key to use for bucket encryption.
   *
   * The `encryption` property must be either not specified or set to `KMS`.
   * An error will be emitted if `encryption` is set to `S3_MANAGED`.
   *
   * @default - If `encryption` is set to `KMS` and this property is undefined,
   * a new KMS key will be created and associated with this bucket.
   */
  readonly encryptionKey?: kms.IKey;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.RETAIN`,
  // applied via `_resource.applyRemovalPolicy`) is CloudFormation's DeletionPolicy concept.
  // `core.RemovalPolicy` is not ported anywhere in this repo (see the identical omission on every
  // other ported alpha module, e.g. `../redshift/cluster.ts`, `../docdb/cluster.ts`) --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket.ts#L361-L366
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — native `aws_s3tables_table_bucket.force_destroy`
   * argument (verified against
   * `node_modules/@cdktn/provider-aws/lib/s3tables-table-bucket/index.d.ts`). When `true`, all
   * tables and namespaces in the bucket are deleted when the bucket itself is deleted (Terraform
   * will otherwise fail to destroy a non-empty table bucket).
   *
   * @default false
   */
  readonly forceDestroy?: boolean;

  // TODO: omitted — upstream's `requestMetricsStatus?: RequestMetricsStatus`. See the file-header
  // SCOPE REDUCTION note --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket.ts#L369-L376
  // readonly requestMetricsStatus?: RequestMetricsStatus;
}

/**
 * A reference to a table bucket outside this stack
 *
 * The tableBucketName, region, and account can be provided explicitly
 * or will be inferred from the tableBucketArn
 */
export interface TableBucketAttributes {
  /**
   * AWS region this table bucket exists in
   * @default region inferred from scope
   */
  readonly region?: string;

  /**
   * The accountId containing this table bucket
   * @default account inferred from scope
   */
  readonly account?: string;

  /**
   * The table bucket name, unique per region
   * @default tableBucketName inferred from arn
   */
  readonly tableBucketName?: string;

  /**
   * The table bucket's ARN.
   * @default tableBucketArn constructed from region, account and tableBucketName are provided
   */
  readonly tableBucketArn?: string;

  /**
   * Optional KMS encryption key associated with this bucket.
   * @default - undefined
   */
  readonly encryptionKey?: kms.IKey;
}

/**
 * An S3 table bucket with helpers for associated resource policies
 *
 * This bucket may not yet have all features that exposed by the underlying Terraform resource.
 *
 * @stateful
 * @resource aws_s3tables_table_bucket
 * @example
 * const sampleTableBucket = new TableBucket(scope, 'ExampleTableBucket', {
 *   tableBucketName: 'example-bucket',
 *   // Optional fields:
 *   unreferencedFileRemoval: {
 *     noncurrentDays: 123,
 *     status: UnreferencedFileRemovalStatus.ENABLED,
 *     unreferencedDays: 123,
 *   },
 * });
 */
export class TableBucket extends TableBucketBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.s3tables.TableBucket";

  /**
   * Defines a TableBucket construct from an external table bucket ARN.
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name.
   * @param tableBucketArn Amazon Resource Name (arn) of the table bucket
   */
  public static fromTableBucketArn(
    scope: Construct,
    id: string,
    tableBucketArn: string,
  ): ITableBucket {
    return TableBucket.fromTableBucketAttributes(scope, id, {
      tableBucketArn,
    });
  }

  /**
   * Defines a TableBucket construct that represents an external table bucket.
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name.
   * @param attrs A `TableBucketAttributes` object. Can be manually created.
   */
  public static fromTableBucketAttributes(
    scope: Construct,
    id: string,
    attrs: TableBucketAttributes,
  ): ITableBucket {
    const { tableBucketName, region, account, tableBucketArn } =
      validateTableBucketAttributes(scope, attrs);
    TableBucket.validateTableBucketName(tableBucketName);
    class Import extends TableBucketBase {
      public readonly tableBucketName = tableBucketName!;
      public readonly tableBucketArn = tableBucketArn;
      public readonly tableBucketPolicy?: TableBucketPolicy;
      public readonly region = region;
      public readonly account = account;
      public readonly encryptionKey?: kms.IKey = attrs.encryptionKey;
      protected autoCreatePolicy: boolean = false;
    }

    return new Import(scope, id, {
      account,
      region,
    });
  }

  /**
   * Throws an exception if the given table bucket name is not valid.
   *
   * @param bucketName name of the bucket.
   */
  public static validateTableBucketName(bucketName: string | undefined) {
    if (bucketName == undefined || Token.isUnresolved(bucketName)) {
      // the name is a late-bound value, not a defined string, so skip validation
      return;
    }

    const errors: string[] = [];

    // Length validation
    if (bucketName.length < 3 || bucketName.length > 63) {
      errors.push(
        "Bucket name must be at least 3 and no more than 63 characters",
      );
    }

    // Character set validation
    const illegalCharsetRegEx = /[^a-z0-9-]/;
    const allowedEdgeCharsetRegEx = /[a-z0-9]/;

    const illegalCharMatch = bucketName.match(illegalCharsetRegEx);
    if (illegalCharMatch) {
      errors.push(
        "Bucket name must only contain lowercase characters, numbers, and hyphens (-)" +
          ` (offset: ${illegalCharMatch.index})`,
      );
    }

    // Edge character validation
    if (!allowedEdgeCharsetRegEx.test(bucketName.charAt(0))) {
      errors.push(
        "Bucket name must start with a lowercase letter or number (offset: 0)",
      );
    }
    if (
      !allowedEdgeCharsetRegEx.test(bucketName.charAt(bucketName.length - 1))
    ) {
      errors.push(
        `Bucket name must end with a lowercase letter or number (offset: ${
          bucketName.length - 1
        })`,
      );
    }

    if (errors.length > 0) {
      throw new UnscopedValidationError(
        `Invalid S3 table bucket name (value: ${bucketName})${EOL}${errors.join(EOL)}`,
      );
    }
  }

  /**
   * Throws an exception if the given unreferencedFileRemovalProperty is not valid.
   * @param unreferencedFileRemoval configuration for the table bucket
   */
  public static validateUnreferencedFileRemoval(
    unreferencedFileRemoval?: UnreferencedFileRemoval,
  ): void {
    // Skip validation if property is not defined
    if (!unreferencedFileRemoval) {
      return;
    }

    const { noncurrentDays, status, unreferencedDays } =
      unreferencedFileRemoval;

    const errors: string[] = [];

    if (noncurrentDays != undefined) {
      if (noncurrentDays < 1) {
        errors.push("noncurrentDays must be at least 1 day");
      }
      if (!Number.isInteger(noncurrentDays)) {
        errors.push("noncurrentDays must be a whole number");
      }
    }

    if (unreferencedDays != undefined) {
      if (unreferencedDays < 1) {
        errors.push("unreferencedDays must be at least 1 day");
      }
      // TODO(alpha-tracker): upstream bug, kept verbatim for byte-closeness -- this checks
      // `noncurrentDays` (the OTHER field) instead of `unreferencedDays`, so
      // `{ unreferencedDays: <non-integer> }` with `noncurrentDays` undefined always throws
      // (`Number.isInteger(undefined) === false`), and a non-integer `unreferencedDays` paired
      // with an integer `noncurrentDays` is never caught. Re-diff when upstream fixes this --
      // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket.ts#L571-L578
      if (!Number.isInteger(noncurrentDays)) {
        errors.push("unreferencedDays must be a whole number");
      }
    }

    const allowedStatus = ["Enabled", "Disabled"];
    if (status != undefined && !allowedStatus.includes(status)) {
      errors.push("status must be one of 'Enabled' or 'Disabled'");
    }

    if (errors.length > 0) {
      throw new UnscopedValidationError(
        `Invalid UnreferencedFileRemovalProperty})${EOL}${errors.join(EOL)}`,
      );
    }
  }

  /**
   * The underlying Terraform L1 resource
   * @internal
   */
  private readonly resource: s3TablesTableBucket.S3TablesTableBucket;

  /**
   * The resource policy for this tableBucket.
   */
  public readonly tableBucketPolicy?: TableBucketPolicy;

  public readonly encryptionKey?: kms.IKey | undefined;

  protected autoCreatePolicy: boolean = true;

  constructor(scope: Construct, id: string, props: TableBucketProps) {
    // NOTE: `props.account`/`props.region` are intentionally NOT forwarded here -- see the note on
    // `TableBucketProps.region` above.
    super(scope, id, { ...props, account: undefined, region: undefined });

    TableBucket.validateTableBucketName(props.tableBucketName);
    TableBucket.validateUnreferencedFileRemoval(props.unreferencedFileRemoval);
    const { bucketEncryption, encryptionKey } = this.parseEncryption(props);
    this.encryptionKey = encryptionKey;

    this.resource = new s3TablesTableBucket.S3TablesTableBucket(
      this,
      "Resource",
      {
        name: props.tableBucketName,
        forceDestroy: props.forceDestroy,
        maintenanceConfiguration: this.renderMaintenanceConfiguration(
          props.unreferencedFileRemoval,
        ),
        encryptionConfiguration: bucketEncryption,
      },
    );
  }

  /**
   * The name of this table bucket
   */
  public get tableBucketName(): string {
    return this.resource.name;
  }

  /**
   * The unique Amazon Resource Name (arn) of this table bucket
   */
  public get tableBucketArn(): string {
    return this.resource.arn;
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — maps
   * `UnreferencedFileRemoval.noncurrentDays`/`unreferencedDays`/`status` onto the provider's
   * `maintenance_configuration.iceberg_unreferenced_file_removal` nested block (verified against
   * `node_modules/@cdktn/provider-aws/lib/s3tables-table-bucket/index.d.ts`), which replaces the
   * CFN `AWS::S3Tables::TableBucket.UnreferencedFileRemoval` top-level property upstream maps onto.
   * Note the field-name difference: upstream/CFN `NoncurrentDays` -> provider `nonCurrentDays`
   * (`non_current_days`).
   *
   * TERRACONSTRUCTS DEVIATION: two more divergences verified against the AWS provider (6.52.0, as
   * bundled by `@cdktn/provider-aws` 24.8.0 -- see the doc links in
   * `node_modules/@cdktn/provider-aws/lib/s3tables-table-bucket/index.d.ts`), neither present
   * upstream (CFN tolerates partial/omitted nested properties):
   *   1. `maintenance_configuration.iceberg_unreferenced_file_removal` is a Terraform framework
   *      `schema.ObjectAttribute` -- ALL of its members (`status`, `settings`, and, within
   *      `settings`, `non_current_days`/`unreferenced_days`) must be present in the rendered
   *      config whenever the block itself is present, even though every one of them is optional
   *      (nullable). `terraform validate` rejects a config that merely omits a member (rather than
   *      setting it to an explicit `null`) with e.g. "attribute \"settings\": attribute
   *      \"unreferenced_days\" is required." So the full object graph below is always rendered,
   *      substituting explicit `null` for any unset member.
   *   2. `status`'s enum values are lowercase at the Terraform/API layer (`enabled`/`disabled` --
   *      provider docs: "Valid values are `enabled` and `disabled`"), unlike CFN's
   *      `UnreferencedFileRemovalStatus`/`Enabled`/`Disabled`, which this port keeps (see
   *      `UnreferencedFileRemovalStatus` above) for upstream API fidelity. Lower-cased here at
   *      render time rather than by changing the public enum's literal values.
   */
  private renderMaintenanceConfiguration(
    unreferencedFileRemoval?: UnreferencedFileRemoval,
  ) {
    if (!unreferencedFileRemoval) {
      return undefined;
    }
    const icebergUnreferencedFileRemoval: s3TablesTableBucket.S3TablesTableBucketMaintenanceConfigurationIcebergUnreferencedFileRemoval =
      {
        status: (unreferencedFileRemoval.status
          ? unreferencedFileRemoval.status.toLowerCase()
          : null) as any,
        settings: {
          nonCurrentDays: (unreferencedFileRemoval.noncurrentDays ??
            null) as any,
          unreferencedDays: (unreferencedFileRemoval.unreferencedDays ??
            null) as any,
        },
      };
    return {
      icebergUnreferencedFileRemoval,
    };
  }

  /**
   * Set up key properties and return the Bucket encryption property from the
   * user's configuration, according to the following table:
   *
   * | props.encryption | props.encryptionKey | bucketEncryption (return value) | encryptionKey (return value)  |
   * |------------------|---------------------|---------------------------------|-------------------------------|
   * | undefined        | undefined           | undefined                       | undefined                     |
   * | undefined        | k                   | aws:kms                         | k                             |
   * | KMS              | undefined           | aws:kms                         | new key (allow maintenance SP)|
   * | KMS              | k                   | aws:kms                         | k                             |
   * | S3_MANAGED       | undefined           | AES256                          | undefined                     |
   * | S3_MANAGED       | k                   | ERROR!                          | ERROR!                        |
   */
  private parseEncryption(props: TableBucketProps): {
    bucketEncryption?: s3TablesTableBucket.S3TablesTableBucketEncryptionConfiguration;
    encryptionKey?: kms.IKey;
  } {
    const encryptionType = props.encryption;
    let key = props.encryptionKey;

    if (encryptionType === undefined) {
      if (key === undefined) {
        return { bucketEncryption: undefined, encryptionKey: undefined };
      } else {
        return {
          bucketEncryption: {
            // ID-vs-ARN AUDIT: fed the KMS key ARN (matches upstream's `key.keyArn`; the provider
            // argument is named `kmsKeyArn`, unlike some other Terraform resources in this repo's
            // house pattern that (confusingly) accept a bare key id under a `kmsKeyId`-named
            // argument).
            kmsKeyArn: key.keyArn,
            sseAlgorithm: TableBucketEncryption.KMS,
          },
          encryptionKey: key,
        };
      }
    }

    if (encryptionType === TableBucketEncryption.KMS) {
      if (key === undefined) {
        key = new kms.Key(this, "Key", {
          description: `Created by ${this.node.path}`,
          enableKeyRotation: true,
        });
        this.allowTablesMaintenanceAccessToKey(key, props.tableBucketName);
      }
      return {
        bucketEncryption: {
          kmsKeyArn: key.keyArn,
          sseAlgorithm: TableBucketEncryption.KMS,
        },
        encryptionKey: key,
      };
    }

    if (encryptionType === TableBucketEncryption.S3_MANAGED) {
      if (key === undefined) {
        return {
          bucketEncryption: {
            sseAlgorithm: TableBucketEncryption.S3_MANAGED,
            // TERRACONSTRUCTS DEVIATION: not present upstream (CFN's
            // `EncryptionConfiguration.KMSKeyArn` can simply be omitted). Verified against the AWS
            // provider (6.52.0, as bundled by `@cdktn/provider-aws` 24.8.0):
            // `aws_s3tables_table_bucket.encryption_configuration` is a
            // Terraform framework `schema.ObjectAttribute`, whose members must ALL be present in
            // the rendered config -- `terraform validate` rejects an `encryption_configuration`
            // block that omits `kms_key_arn` entirely with "attribute \"kms_key_arn\" is required",
            // even though the field itself is optional (nullable). Render it explicitly as `null`.
            kmsKeyArn: null as any,
          },
        };
      } else {
        throw new UnscopedValidationError(
          "Expected encryption = `KMS` with user provided encryption key",
        );
      }
    }
    throw new UnscopedValidationError(
      `Unknown encryption configuration detected: ${props.encryption} with key ${props.encryptionKey}`,
    );
  }

  /**
   * Allowlist S3 Tables Maintenance to access this table bucket's encryption key
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-kms-permissions.html
   * @param encryptionKey The key to provide access to
   */
  private allowTablesMaintenanceAccessToKey(
    encryptionKey: kms.IKey,
    tableBucketName: string,
  ) {
    const region = this.stack.region;
    const account = this.stack.account;
    const partition = this.stack.partition;

    encryptionKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowS3TablesMaintenanceAccess",
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ServicePrincipal("maintenance.s3tables.amazonaws.com"),
        ],
        actions: ["kms:GenerateDataKey", "kms:Decrypt"],
        resources: ["*"],
        // TERRACONSTRUCTS DEVIATION: this repo's `iam.PolicyStatement` takes conditions as an
        // array of `{ test, variable, values }` triples (rendered via the
        // `aws_iam_policy_document` data source's `condition` blocks -- see
        // `../../iam/policy-statement.ts`), unlike upstream's nested
        // `{ StringLike: { key: value } }` object shape.
        condition: [
          {
            test: "StringLike",
            variable: "kms:EncryptionContext:aws:s3:arn",
            values: [
              `arn:${partition}:s3tables:${region}:${account}:bucket/${tableBucketName}/*`,
            ],
          },
        ],
      }),
    );
  }
}
