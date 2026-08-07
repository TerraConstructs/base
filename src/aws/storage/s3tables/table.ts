// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table.ts
//
// TODO(alpha-tracker): ported from @aws-cdk/aws-s3tables-alpha@2.263.0-alpha.0 (stability:
// experimental). Re-diff against upstream on every reference-tag bump — alpha surfaces churn
// without deprecation cycles.

import { EOL } from "node:os";
import { s3TablesTable, s3TablesTablePolicy } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import type { INamespace } from "./namespace";
import * as perms from "./permissions";
import { AssumptionError, UnscopedValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as iam from "../../iam";

/**
 * Represents an S3 Table.
 */
export interface ITable extends IAwsConstruct {
  /**
   * The ARN of this table.
   * @attribute
   */
  readonly tableArn: string;

  /**
   * The name of this table.
   * @attribute
   */
  readonly tableName: string;

  /**
   * The accountId containing this table.
   * @attribute
   */
  readonly account?: string;

  /**
   * The region containing this table.
   * @attribute
   */
  readonly region?: string;

  /**
   * The namespace containing this table.
   *
   * TERRACONSTRUCTS DEVIATION: not present on upstream `ITable` (only exposed on the concrete
   * `Table` class there). Unlike CloudFormation's `AWS::S3Tables::TablePolicy` (addressed via a
   * bare `TableArn`), the Terraform `aws_s3tables_table_policy` resource has no ARN-only
   * addressing mode — it identifies its target table via `name` + `namespace` + `table_bucket_arn`
   * — so building the default (or a standalone `./table-policy.ts`) policy needs namespace access
   * from `ITable`. Optional because imported tables (`fromTableAttributes`) don't carry it, which
   * mirrors `autoCreatePolicy = false` for imports below: the default-policy branch that
   * dereferences `namespace` is only ever reached when `autoCreatePolicy` is `true`, and only the
   * concrete `Table` class ever sets that to `true`.
   * https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3tables_table_policy
   */
  readonly namespace?: INamespace;

  /**
   * Adds a statement to the resource policy for a principal (i.e.
   * account/role/service) to perform actions on this table.
   *
   * Note that the policy statement may or may not be added to the policy.
   * For example, when an `ITable` is created from an existing table,
   * it's not possible to tell whether the table already has a policy
   * attached, let alone to re-use that policy to add more statements to it.
   * So it's safest to do nothing in these cases.
   *
   * @param statement the policy statement to be added to the table's
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
   * Grant read permissions for this table to an IAM principal (Role/Group/User).
   *
   * If the parent TableBucket of this table has encryption,
   * you should grant kms:Decrypt permission to use this key to the same principal.
   *
   * @param identity The principal to allow read permissions to
   */
  grantRead(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant write permissions for this table to an IAM principal (Role/Group/User).
   *
   * If the parent TableBucket of this table has encryption,
   * you should grant kms:GenerateDataKey and kms:Decrypt permission
   * to use this key to the same principal.
   *
   * @param identity The principal to allow write permissions to
   */
  grantWrite(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant read and write permissions for this table to an IAM principal (Role/Group/User).
   *
   * If the parent TableBucket of this table has encryption,
   * you should grant kms:GenerateDataKey and kms:Decrypt permission
   * to use this key to the same principal.
   *
   * @param identity The principal to allow read and write permissions to
   */
  grantReadWrite(identity: iam.IGrantable): iam.Grant;
}

/**
 * Base class for Table implementations.
 */
abstract class TableBase extends AwsConstructBase implements ITable {
  public abstract readonly tableName: string;
  public abstract readonly tableArn: string;
  public abstract readonly namespace?: INamespace;

  /**
   * The resource policy associated with this table.
   *
   * If `autoCreatePolicy` is true, a `S3TablesTablePolicy` will be created upon the
   * first call to addToResourcePolicy(s).
   */
  public abstract tablePolicy?: s3TablesTablePolicy.S3TablesTablePolicy;

  /**
   * Indicates if a table resource policy should automatically created upon
   * the first call to `addToResourcePolicy`.
   */
  protected abstract autoCreatePolicy: boolean;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * e.g. `TableBucketBase.outputs` in `./table-bucket.ts`) — bare, bound-per-construct `outputs`
   * for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      tableArn: this.tableArn,
      tableName: this.tableName,
    };
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Upstream's `CfnTablePolicy.resourcePolicy`
   * accepts an `iam.PolicyDocument` object directly (CloudFormation resolves it at deploy-time),
   * so statements added after the policy resource is created are picked up automatically.
   * `aws_s3tables_table_policy`'s `resource_policy` is a plain Terraform string attribute instead,
   * so this repo keeps a separate `iam.PolicyDocument` construct around (its `.json` getter is a
   * Lazy-resolved token, so later `addStatements()` calls still flow through) — identical idiom to
   * `resourcePolicy`/`DynamodbResourcePolicy` in `../table.ts`.
   */
  private policyDocument?: iam.PolicyDocument;

  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.tablePolicy && this.autoCreatePolicy) {
      if (!this.namespace) {
        // unreachable: only the concrete `Table` class sets `autoCreatePolicy = true`, and it
        // always sets `namespace` in its constructor.
        throw new AssumptionError(
          "Cannot auto-create a table resource policy without a namespace",
        );
      }

      this.policyDocument = new iam.PolicyDocument(this, "Policy", {
        statement: [],
      });
      this.tablePolicy = new s3TablesTablePolicy.S3TablesTablePolicy(
        this,
        "DefaultPolicy",
        {
          name: this.tableName,
          namespace: this.namespace.namespaceName,
          tableBucketArn: this.namespace.tableBucket.tableBucketArn,
          resourcePolicy: this.policyDocument.json,
        },
      );
    }

    if (this.tablePolicy && this.policyDocument) {
      this.policyDocument.addStatements(statement);
      return { statementAdded: true, policyDependable: this.tablePolicy };
    }

    return { statementAdded: false };
  }

  /**
   * [disable-awslint:no-grants]
   */
  public grantRead(identity: iam.IGrantable) {
    return this.grant(identity, perms.TABLE_READ_ACCESS, this.tableArn);
  }

  /**
   * [disable-awslint:no-grants]
   */
  public grantWrite(identity: iam.IGrantable) {
    return this.grant(identity, perms.TABLE_WRITE_ACCESS, this.tableArn);
  }

  /**
   * [disable-awslint:no-grants]
   */
  public grantReadWrite(identity: iam.IGrantable) {
    return this.grant(identity, perms.TABLE_READ_WRITE_ACCESS, this.tableArn);
  }

  /**
   * Grants the given s3tables permissions to the provided principal
   * @returns Grant object
   */
  private grant(
    grantee: iam.IGrantable,
    tableActions: string[],
    resourceArn: string,
    ...otherResourceArns: (string | undefined)[]
  ) {
    const resources = [resourceArn, ...otherResourceArns].filter(
      (arn) => arn != undefined,
    );

    const grant = iam.Grant.addToPrincipalOrResource({
      grantee,
      actions: tableActions,
      resourceArns: resources,
      resource: this,
    });

    return grant;
  }
}

/**
 * Properties for creating a new S3 Table.
 */
export interface TableProps extends AwsConstructProps {
  /**
   * Name of this table, unique within the namespace
   *
   * TERRACONSTRUCTS DEVIATION: kept required, matching upstream verbatim -- see the identical note
   * on `TableBucketProps.tableBucketName` in `./table-bucket.ts` for the rationale (this repo's
   * `uniqueResourceName` house-pattern default was deliberately not adopted here).
   */
  readonly tableName: string;
  /**
   * The namespace under which this table is created
   */
  readonly namespace: INamespace;
  /**
   * Format of this table. Currently, the only supported value is OpenTableFormat.ICEBERG.
   */
  readonly openTableFormat: OpenTableFormat;
  /**
   * Settings governing the Compaction maintenance action.
   * @default Amazon S3 selects the best compaction strategy based on your table sort order.
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-maintenance.html
   */
  readonly compaction?: CompactionProperty;
  /**
   * Contains details about the metadata for an Iceberg table.
   * @default table is created without any metadata
   */
  readonly icebergMetadata?: IcebergMetadataProperty;
  /**
   * Contains details about the snapshot management settings for an Iceberg table.
   * @default enabled: MinimumSnapshots is 1 by default and MaximumSnapshotAge is 120 hours by default.
   */
  readonly snapshotManagement?: SnapshotManagementProperty;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.RETAIN`,
  // applied via `_resource.applyRemovalPolicy`) is CloudFormation's DeletionPolicy concept.
  // `core.RemovalPolicy` is not ported anywhere in this repo (see the identical omission on
  // `NamespaceProps`/`TablePolicyProps` in `./namespace.ts`/`./table-policy.ts` and on every other
  // ported module, e.g. `../docdb/cluster.ts`). `aws_s3tables_table` has no Terraform-native
  // lifecycle replacement to offer here (unlike e.g. `skipFinalSnapshot` on `aws_neptune_cluster`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table.ts#L229-L234
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * If true, indicates that you don't want to specify a schema for the table.
   *
   * This property is mutually exclusive to 'IcebergMetadata'.
   *
   * TERRACONSTRUCTS DEVIATION: `aws_s3tables_table` has no dedicated `without_metadata`
   * attribute (unlike `AWS::S3Tables::Table`'s `WithoutMetadata: "ENABLE"`). Simply omitting the
   * `metadata` block from the Terraform resource (this repo's behavior when this is `true`, or
   * when `icebergMetadata` is unset) is the provider-native equivalent — the mutual-exclusivity
   * validation below is kept verbatim regardless.
   *
   * @default false
   */
  readonly withoutMetadata?: boolean;
}

/**
 * Supported open table formats.
 */
export enum OpenTableFormat {
  /**
   * Apache Iceberg table format.
   */
  ICEBERG = "ICEBERG",
}

/**
 * Settings governing the Compaction maintenance action.
 *
 * @default - No compaction settings
 */
export interface CompactionProperty {
  /**
   * Status of the compaction maintenance action.
   */
  readonly status: Status;
  /**
   * Target file size in megabytes for compaction.
   */
  readonly targetFileSizeMb: number;
}

/**
 * Status values for maintenance actions.
 */
export enum Status {
  /**
   * Enable the maintenance action.
   */
  ENABLED = "enabled",
  /**
   * Disable the maintenance action.
   */
  DISABLED = "disabled",
}

// TODO: omitted — upstream also exports `IcebergTransform`, `SortDirection`, `NullOrder`,
// `IcebergPartitionField`, `IcebergPartitionSpec`, `IcebergSortField`, `IcebergSortOrder` and
// `TablePropertyEntry`, used to build `IcebergMetadataProperty.icebergPartitionSpec` /
// `.icebergSortOrder` / `.tableProperties` below. The Terraform `aws_s3tables_table` resource's
// `metadata` block exposes only `iceberg.schema.field.{name,required,type}` — it has no
// partition-spec, sort-order, or custom-table-properties equivalent at all (and no per-field `id`/
// `fieldId` assignment either, see `SchemaFieldProperty`/`IcebergSchemaProperty` below). Per this
// repo's "no accepted-but-dropped props" convention, these types (and the metadata fields that
// would carry them) are commented out in place rather than silently ignored during synthesis —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table.ts#L285-L509
// https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3tables_table#schema
//
// export class IcebergTransform { ... }
// export enum SortDirection { ASC = 'asc', DESC = 'desc' }
// export enum NullOrder { NULLS_FIRST = 'nulls-first', NULLS_LAST = 'nulls-last' }
// export interface IcebergPartitionField { readonly sourceId: number; readonly transform: IcebergTransform; readonly name: string; readonly fieldId?: number; }
// export interface IcebergPartitionSpec { readonly fields: IcebergPartitionField[]; readonly specId?: number; }
// export interface IcebergSortField { readonly sourceId: number; readonly transform: IcebergTransform; readonly direction: SortDirection; readonly nullOrder: NullOrder; }
// export interface IcebergSortOrder { readonly fields: IcebergSortField[]; readonly orderId?: number; }
// export interface TablePropertyEntry { readonly key: string; readonly value: string; }

/**
 * Contains details about the metadata for an Iceberg table.
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3tables-table-icebergmetadata.html
 */
export interface IcebergMetadataProperty {
  /**
   * Contains details about the schema for an Iceberg table.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3tables-table-icebergmetadata.html#cfn-s3tables-table-icebergmetadata-icebergschema
   */
  readonly icebergSchema: IcebergSchemaProperty;

  // TODO: omitted — `icebergPartitionSpec` / `icebergSortOrder` / `tableProperties`. See the
  // `IcebergTransform` TODO block above for the full explanation of the Terraform provider gap.
  // readonly icebergPartitionSpec?: IcebergPartitionSpec;
  // readonly icebergSortOrder?: IcebergSortOrder;
  // readonly tableProperties?: TablePropertyEntry[];
}

/**
 * Contains details about the schema for an Iceberg table.
 */
export interface IcebergSchemaProperty {
  /**
   * Contains details about the schema for an Iceberg table.
   */
  readonly schemaFieldList: SchemaFieldProperty[];
}

/**
 * Contains details about a schema field.
 */
export interface SchemaFieldProperty {
  // TODO: omitted — upstream's `id` (auto-assigned by S3 Tables when unset). The Terraform
  // `aws_s3tables_table` resource's `metadata.iceberg.schema.field` block has no `id` attribute to
  // set it through — see the `IcebergTransform` TODO block above.
  // readonly id?: number;

  /**
   * The name of the field.
   */
  readonly name: string;

  /**
   * A Boolean value that specifies whether values are required for each row in this field.
   *
   * By default, this is `false` and null values are allowed in the field. If this is `true`, the field does not allow null values.
   *
   * @default false
   */
  readonly required?: boolean;

  /**
   * The field type.
   *
   * S3 Tables supports all Apache Iceberg primitive types. For more information, see the [Apache Iceberg documentation](https://iceberg.apache.org/spec/#primitive-types).
   */
  readonly type: string;
}

/**
 * Contains details about the snapshot management settings for an Iceberg table.
 *
 * A snapshot is expired when it exceeds MinSnapshotsToKeep and MaxSnapshotAgeHours.
 *
 * @default - No snapshot management settings
 */
export interface SnapshotManagementProperty {
  /**
   * The maximum age of a snapshot before it can be expired.
   *
   * @default - No maximum age
   */
  readonly maxSnapshotAgeHours?: number;

  /**
   * The minimum number of snapshots to keep.
   *
   * @default - No minimum number
   */
  readonly minSnapshotsToKeep?: number;

  /**
   * Indicates whether the SnapshotManagement maintenance action is enabled.
   *
   * @default - Not specified
   */
  readonly status?: Status;
}

/**
 * A reference to a table outside this stack
 *
 * The tableName and tableArn can be provided explicitly.
 */
export interface TableAttributes {
  /**
   * Name of this table
   */
  readonly tableName: string;

  /**
   * The table's ARN.
   */
  readonly tableArn: string;
}

/**
 * An S3 Table with helpers.
 *
 * @resource aws_s3tables_table
 */
export class Table extends TableBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.s3tables.Table";

  /**
   * Defines a Table construct that represents an external table.
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name.
   * @param attrs A `TableAttributes` object containing the table name and ARN.
   */
  public static fromTableAttributes(
    scope: Construct,
    id: string,
    attrs: TableAttributes,
  ): ITable {
    const tableArn = attrs.tableArn;
    Table.validateTableName(attrs.tableName);

    class Import extends TableBase {
      public readonly tableName = attrs.tableName;
      public readonly tableArn = tableArn;
      public readonly namespace?: INamespace = undefined;
      public tablePolicy?: s3TablesTablePolicy.S3TablesTablePolicy;
      protected autoCreatePolicy: boolean = false;
    }

    return new Import(scope, id, {
      environmentFromArn: tableArn,
    });
  }

  /**
   * See https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-buckets-naming.html
   * @param tableName Name of the table
   * @throws UnscopedValidationError if any naming errors are detected
   */
  public static validateTableName(tableName: string) {
    if (tableName == undefined || Token.isUnresolved(tableName)) {
      // the name is a late-bound value, not a defined string, so skip validation
      return;
    }

    const errors: string[] = [];

    // Length validation
    if (tableName.length < 1 || tableName.length > 255) {
      errors.push(
        "Table name must be at least 1 and no more than 255 characters",
      );
    }

    // Character set validation
    const illegalCharsetRegEx = /[^a-z0-9_]/;
    const allowedEdgeCharsetRegEx = /[a-z0-9]/;

    const illegalCharMatch = tableName.match(illegalCharsetRegEx);
    if (illegalCharMatch) {
      errors.push(
        "Table name must only contain lowercase characters, numbers, and underscores (_)" +
          ` (offset: ${illegalCharMatch.index})`,
      );
    }

    // Edge character validation
    if (!allowedEdgeCharsetRegEx.test(tableName.charAt(0))) {
      errors.push(
        "Table name must start with a lowercase letter or number (offset: 0)",
      );
    }
    if (!allowedEdgeCharsetRegEx.test(tableName.charAt(tableName.length - 1))) {
      errors.push(
        `Table name must end with a lowercase letter or number (offset: ${
          tableName.length - 1
        })`,
      );
    }

    if (errors.length > 0) {
      throw new UnscopedValidationError(
        `Invalid S3 table name (value: ${tableName})${EOL}${errors.join(EOL)}`,
      );
    }
  }

  /**
   * The unique Amazon Resource Name (arn) of this table
   */
  public readonly tableArn: string;

  /**
   * The underlying CfnTable L1 resource
   * @internal
   */
  private readonly _resource: s3TablesTable.S3TablesTable;

  /**
   * The name of this table
   */
  public readonly tableName: string;

  /**
   * The namespace containing this table
   *
   * TERRACONSTRUCTS DEVIATION: not present upstream (only exposed on `ITable`/`TableBase` there,
   * matching this port). Declared `?: INamespace` here too (rather than the always-defined
   * `INamespace` its constructor actually assigns) to satisfy jsii's language-compatibility rule
   * that an implementing class may not turn an interface member required when the interface
   * (`ITable.namespace` above) declares it optional (JSII5009) -- concrete `Table` instances always
   * have this set; only `fromTableAttributes()`-imported tables leave it `undefined` (see
   * `TableBase.namespace` / `ITable.namespace` docs above for why).
   */
  public readonly namespace?: INamespace;

  /**
   * The resource policy for this table.
   */
  public tablePolicy?: s3TablesTablePolicy.S3TablesTablePolicy;

  protected autoCreatePolicy: boolean = true;

  constructor(scope: Construct, id: string, props: TableProps) {
    // NOTE: `props.account`/`props.region` are intentionally NOT forwarded here -- identical
    // rationale to `TableBucket`'s constructor in `./table-bucket.ts` (see the note on
    // `TableBucketProps.region` there): forwarding them would give this construct's
    // `env.account`/`env.region` a literal value that defeats the
    // `iam.Grant.addToPrincipalOrResource()` same-account short-circuit (`../../iam/grant.ts`),
    // spuriously attaching a resource policy to every same-account grant.
    super(scope, id, { ...props, account: undefined, region: undefined });

    if (props.withoutMetadata && props.icebergMetadata) {
      throw new UnscopedValidationError(
        "TableProps: 'withoutMetadata' and 'icebergMetadata' are mutually exclusive. Specify only one.",
      );
    }

    Table.validateTableName(props.tableName);

    this._resource = new s3TablesTable.S3TablesTable(this, "Resource", {
      name: props.tableName,
      format: props.openTableFormat,
      tableBucketArn: props.namespace.tableBucket.tableBucketArn,
      namespace: props.namespace.namespaceName,
      maintenanceConfiguration: this.buildMaintenanceConfiguration(
        props.compaction,
        props.snapshotManagement,
      ),
      metadata: this.buildMetadata(props.icebergMetadata),
    });

    this.namespace = props.namespace;
    this.tableName = props.tableName;
    this.tableArn = this._resource.arn;
    // Non-null assertion: `this.namespace` was just unconditionally assigned above from
    // `props.namespace` (required on `TableProps`) -- only the `fromTableAttributes()` import path
    // (which never reaches this constructor) leaves it `undefined`.
    this.node.addDependency(this.namespace!);
  }

  /**
   * Builds the Terraform maintenance_configuration block from the CDK compaction/snapshot
   * management props.
   *
   * TERRACONSTRUCTS DEVIATION: upstream sets `compaction`/`snapshotManagement` as top-level
   * `CfnTable` properties. `aws_s3tables_table` nests both one level deeper, under
   * `maintenance_configuration.iceberg_compaction`/`.iceberg_snapshot_management`, with the
   * numeric knobs further nested under a `settings` block —
   * https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3tables_table#maintenance_configuration
   *
   * TERRACONSTRUCTS DEVIATION: not present upstream (CFN tolerates a partial/omitted
   * `MaintenanceConfiguration`). `aws_s3tables_table.maintenance_configuration` is a Terraform
   * *object*-typed attribute whose schema requires ALL members
   * (`iceberg_compaction`/`iceberg_snapshot_management`) to be present -- unlike a Terraform
   * *block*, an object type has no concept of an "unset" member; omitting one fails
   * `terraform validate` with `Inappropriate value for attribute "maintenance_configuration":
   * attribute "iceberg_snapshot_management" is required` (and symmetrically for
   * `iceberg_compaction`), verified against the real provider schema
   * (`terraform providers schema -json`, hashicorp/aws 6.55.0). This mirrors the all-members rule
   * already applied to `encryption_configuration`/`maintenance_configuration` in
   * `./table-bucket.ts` -- so both members are always rendered here too, never omitted.
   *
   * Only a literal `null` passed for an entire nested-object member (as opposed to a real object
   * with `null`-valued scalar leaves) throws at construction time -- the generated L1's `set
   * internalValue` (`@cdktn/provider-aws` 24.8.0, AWS provider 6.52.0) unconditionally does
   * `Object.keys(value).length` on any non-`undefined`, non-`IResolvable` value
   * (`node_modules/@cdktn/provider-aws/lib/s3tables-table/index.js`, both the outer
   * `S3TablesTableMaintenanceConfigurationOutputReference` and the
   * `...IcebergCompactionOutputReference`/`...IcebergSnapshotManagementOutputReference` wrappers).
   * So whichever of `compaction`/`snapshotManagement` was not supplied is rendered as a real object
   * with its scalar leaves explicit `null` (verified this constructs cleanly and the resulting
   * config passes `terraform validate`), rather than `undefined`/`null` at the member level.
   */
  private buildMaintenanceConfiguration(
    compaction?: CompactionProperty,
    snapshotManagement?: SnapshotManagementProperty,
  ): s3TablesTable.S3TablesTableMaintenanceConfiguration | undefined {
    if (!compaction && !snapshotManagement) {
      return undefined;
    }

    return {
      icebergCompaction: compaction
        ? {
            status: compaction.status,
            settings: { targetFileSizeMb: compaction.targetFileSizeMb },
          }
        : {
            status: null as any,
            settings: { targetFileSizeMb: null as any },
          },
      icebergSnapshotManagement: snapshotManagement
        ? {
            status: (snapshotManagement.status ?? null) as any,
            settings: {
              maxSnapshotAgeHours: (snapshotManagement.maxSnapshotAgeHours ??
                null) as any,
              minSnapshotsToKeep: (snapshotManagement.minSnapshotsToKeep ??
                null) as any,
            },
          }
        : {
            status: null as any,
            settings: {
              maxSnapshotAgeHours: null as any,
              minSnapshotsToKeep: null as any,
            },
          },
    };
  }

  /**
   * Builds the Terraform `metadata` block from the CDK Iceberg metadata model.
   *
   * TERRACONSTRUCTS DEVIATION: see the `SchemaFieldProperty`/`IcebergMetadataProperty` TODOs
   * above — only `iceberg.schema.field.{name,required,type}` is representable; `metadata`,
   * `iceberg`, and `schema` are themselves single-item Terraform list blocks —
   * https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3tables_table#metadata
   */
  private buildMetadata(
    metadata?: IcebergMetadataProperty,
  ): s3TablesTable.S3TablesTableMetadata[] | undefined {
    if (!metadata) {
      return undefined;
    }

    return [
      {
        iceberg: [
          {
            schema: [
              {
                field: metadata.icebergSchema.schemaFieldList.map((field) => ({
                  name: field.name,
                  type: field.type,
                  ...(field.required !== undefined && {
                    required: field.required,
                  }),
                })),
              },
            ],
          },
        ],
      },
    ];
  }
}
