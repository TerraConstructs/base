// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster.ts

import {
  rdsCluster,
  rdsClusterInstance,
  rdsClusterRoleAssociation,
} from "@cdktn/provider-aws";
import { Annotations, Lazy, Token, Tokenization } from "cdktn";
import { Construct } from "constructs";
import type {
  IAuroraClusterInstance,
  IClusterInstance,
} from "./aurora-cluster-instance";
import { InstanceType } from "./aurora-cluster-instance";
import type { ClusterEngineConfig, IClusterEngine } from "./cluster-engine";
import type {
  DatabaseClusterAttributes,
  IDatabaseCluster,
} from "./cluster-ref";
import { DatabaseInsightsMode } from "./database-insights-mode";
import { DatabaseSecret } from "./database-secret";
import { Endpoint } from "./endpoint";
import type { NetworkType } from "./instance";
import type { IParameterGroup } from "./parameter-group";
import { ParameterGroup } from "./parameter-group";
import { DATA_API_ACTIONS } from "./perms";
import {
  applyDefaultRotationOptions,
  defaultDeletionProtection,
  setupS3ImportExport,
  validateManagedPasswordCredentials,
  validateManagedPasswordSnapshotCredentials,
} from "./private/util";
import type {
  BackupProps,
  EngineLifecycleSupport,
  InstanceProps,
  RotationMultiUserOptions,
  RotationSingleUserOptions,
  SnapshotCredentials,
} from "./props";
import { Credentials, PerformanceInsightRetention } from "./props";
import type { DatabaseProxyOptions } from "./proxy";
import { DatabaseProxy, ProxyTarget } from "./proxy";
import type { ISubnetGroup } from "./subnet-group";
import { SubnetGroup } from "./subnet-group";
import { validateDatabaseClusterProps } from "./validate-database-insights";
import type { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import { ArnFormat } from "../../arn";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";
import type * as cloudwatch from "../../cloudwatch";
import * as ec2 from "../../compute";
import type * as encryption from "../../encryption";
import * as secretsmanager from "../../encryption";
import * as iam from "../../iam";
import type { IBucket } from "../bucket";

/**
 * Common properties for a new database cluster or cluster from snapshot.
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `DatabaseClusterBaseProps` does not — matching the base-idiom used throughout
 * this repo (e.g. `DatabaseInstanceNewProps` in `./instance.ts`) for cross-account/-region
 * construct placement.
 */
interface DatabaseClusterBaseProps extends AwsConstructProps {
  /**
   * What kind of database to start
   */
  readonly engine: IClusterEngine;

  /**
   * How many replicas/instances to create
   *
   * Has to be at least 1.
   *
   * @default 2
   * @deprecated - use writer and readers instead
   */
  readonly instances?: number;

  /**
   * Settings for the individual instances that are launched
   *
   * @deprecated - use writer and readers instead
   */
  readonly instanceProps?: InstanceProps;

  /**
   * The instance to use for the cluster writer
   *
   * @default - required if instanceProps is not provided
   */
  readonly writer?: IClusterInstance;

  /**
   * A list of instances to create as cluster reader instances
   *
   * @default - no readers are created. The cluster will have a single writer/reader
   */
  readonly readers?: IClusterInstance[];

  /**
   * The maximum number of Aurora capacity units (ACUs) for a DB instance in an Aurora Serverless v2 cluster.
   * You can specify ACU values in half-step increments, such as 40, 40.5, 41, and so on.
   * The largest value that you can use is 256.
   *
   * The maximum capacity must be higher than 0.5 ACUs.
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html#aurora-serverless-v2.max_capacity_considerations
   *
   * @default 2
   */
  readonly serverlessV2MaxCapacity?: number;

  /**
   * The minimum number of Aurora capacity units (ACUs) for a DB instance in an Aurora Serverless v2 cluster.
   * You can specify ACU values in half-step increments, such as 8, 8.5, 9, and so on.
   * The smallest value that you can use is 0.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html#aurora-serverless-v2.min_capacity_considerations
   *
   * @default 0.5
   */
  readonly serverlessV2MinCapacity?: number;

  /**
   * Specifies the duration an Aurora Serverless v2 DB instance must be idle before Aurora attempts to automatically pause it.
   *
   * The duration must be between 300 seconds (5 minutes) and 86,400 seconds (24 hours).
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html
   *
   * @default - The default is 300 seconds (5 minutes).
   */
  readonly serverlessV2AutoPauseDuration?: Duration;

  /**
   * What subnets to run the RDS instances in.
   *
   * Must be at least 2 subnets in two different AZs.
   */
  readonly vpc?: ec2.IVpc;

  /**
   * Where to place the instances within the VPC
   *
   * @default - the Vpc default strategy if not specified.
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Security group.
   *
   * @default - a new security group is created.
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * The ordering of updates for instances
   *
   * @default InstanceUpdateBehaviour.BULK
   */
  readonly instanceUpdateBehaviour?: InstanceUpdateBehaviour;

  /**
   * The number of seconds to set a cluster's target backtrack window to.
   * This feature is only supported by the Aurora MySQL database engine and
   * cannot be enabled on existing clusters.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Managing.Backtrack.html
   * @default 0 seconds (no backtrack)
   */
  readonly backtrackWindow?: Duration;

  /**
   * Backup settings
   *
   * @default - Backup retention period for automated backups is 1 day.
   * Backup preferred window is set to a 30-minute window selected at random from an
   * 8-hour block of time for each AWS Region, occurring on a random day of the week.
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html#USER_WorkingWithAutomatedBackups.BackupWindow
   */
  readonly backup?: BackupProps;

  /**
   * What port to listen on
   *
   * @default - The default for the engine is used.
   */
  readonly port?: number;

  /**
   * An optional identifier for the cluster
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly clusterIdentifier?: string;

  /**
   * Base identifier for instances
   *
   * Every replica is named by appending the replica number to this string, 1-based.
   *
   * @default - clusterIdentifier is used with the word "Instance" appended.
   * If clusterIdentifier is not provided, the identifier is automatically generated.
   */
  readonly instanceIdentifierBase?: string;

  /**
   * Name of a database which is automatically created inside the cluster
   *
   * @default - Database is not created in cluster.
   */
  readonly defaultDatabaseName?: string;

  /**
   * Indicates whether the DB cluster should have deletion protection enabled.
   *
   * TERRACONSTRUCTS DEVIATION: upstream defaults this to `true` when `removalPolicy` is `RETAIN`.
   * `core.RemovalPolicy` is not ported in this repo (see `skipFinalSnapshot`/`finalSnapshotIdentifier`
   * below, and the identical omission on `DatabaseInstanceNewProps.deletionProtection` in
   * `./instance.ts`), so only the explicit flag is honored (see `defaultDeletionProtection` in
   * `./private/util.ts`).
   *
   * @default false
   */
  readonly deletionProtection?: boolean;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.SNAPSHOT`) is
  // CloudFormation's DeletionPolicy concept. `core.RemovalPolicy` is not ported anywhere in this repo
  // (see the identical omission on `DatabaseInstanceNewProps.removalPolicy` in `./instance.ts`).
  // Terraform's `aws_rds_cluster` exposes the equivalent semantics natively via
  // `skipFinalSnapshot`/`finalSnapshotIdentifier` below — the TERRACONSTRUCTS-native replacement,
  // mirroring `./instance.ts` exactly —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster.ts#L234-L239
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — native Terraform replacement for upstream's
   * `removalPolicy` (see the TODO above). Whether Terraform should take a final DB snapshot before
   * destroying this cluster. When `false` (the default — matching upstream's `RemovalPolicy.SNAPSHOT`
   * default) and `finalSnapshotIdentifier` is not set, `terraform destroy`/replace will FAIL at
   * apply-time with an AWS API error (native `aws_rds_cluster` behavior, not enforced here at synth
   * time). Mirrors `DatabaseInstanceNewProps.skipFinalSnapshot` in `./instance.ts`.
   *
   * @default false (a final snapshot is taken on delete/replace, so `finalSnapshotIdentifier` should
   * also be set)
   */
  readonly skipFinalSnapshot?: boolean;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see `skipFinalSnapshot` above. The identifier
   * for the final DB cluster snapshot Terraform takes before destroying this cluster. Unlike
   * CloudFormation (which auto-generates a snapshot name), Terraform requires this to be supplied
   * explicitly. Mirrors `DatabaseInstanceNewProps.finalSnapshotIdentifier` in `./instance.ts`.
   *
   * @default - no final snapshot identifier; required unless `skipFinalSnapshot` is `true`
   */
  readonly finalSnapshotIdentifier?: string;

  /**
   * A preferred maintenance window day/time range. Should be specified as a range ddd:hh24:mi-ddd:hh24:mi (24H Clock UTC).
   *
   * Example: 'Sun:23:45-Mon:00:15'
   *
   * @default - 30-minute window selected at random from an 8-hour block of time for
   * each AWS Region, occurring on a random day of the week.
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_UpgradeDBInstance.Maintenance.html#Concepts.DBMaintenance
   */
  readonly preferredMaintenanceWindow?: string;

  /**
   * Additional parameters to pass to the database engine
   *
   * @default - No parameter group.
   */
  readonly parameterGroup?: IParameterGroup;

  /**
   * The parameters in the DBClusterParameterGroup to create automatically
   *
   * You can only specify parameterGroup or parameters but not both.
   * You need to use a versioned engine to auto-generate a DBClusterParameterGroup.
   *
   * @default - None
   */
  readonly parameters?: { [key: string]: string };

  /**
   * The list of log types that need to be enabled for exporting to
   * CloudWatch Logs.
   *
   * @default - no log exports
   */
  readonly cloudwatchLogsExports?: string[];

  // TODO: omitted — `cloudwatchLogsRetention`/`cloudwatchLogsRetentionRole` (and the LogRetention
  // custom-resource machinery that consumes them) are dropped for the identical reason given on
  // `DatabaseInstanceNewProps.cloudwatchLogsRetention` in `./instance.ts` — there is no
  // Terraform-native equivalent of upstream's Lambda-backed `logs.LogRetention` custom resource; the
  // `aws_rds_cluster` resource only controls WHICH logs are exported
  // (`enabled_cloudwatch_logs_exports`, ported below as `cloudwatchLogsExports`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster.ts#L250-L265
  // readonly cloudwatchLogsRetention?: logs.RetentionDays;
  // readonly cloudwatchLogsRetentionRole?: IRole;

  /**
   * The interval between points when Amazon RDS collects enhanced monitoring metrics.
   *
   * If you enable `enableClusterLevelEnhancedMonitoring`, this property is applied to the cluster,
   * otherwise it is applied to the instances.
   *
   * @default - no enhanced monitoring
   */
  readonly monitoringInterval?: Duration;

  /**
   * Role that will be used to manage DB monitoring.
   *
   * If you enable `enableClusterLevelEnhancedMonitoring`, this property is applied to the cluster,
   * otherwise it is applied to the instances.
   *
   * TERRACONSTRUCTS DEVIATION: `iam.IRole` instead of upstream's `iam.IRoleRef` — see
   * `DatabaseInstanceNewProps.monitoringRole` in `./instance.ts`.
   *
   * @default - A role is automatically created for you
   */
  readonly monitoringRole?: iam.IRole;

  /**
   * Whether to enable enhanced monitoring at the cluster level.
   *
   * If set to true, `monitoringInterval` and `monitoringRole` are applied to not the instances, but the cluster.
   * `monitoringInterval` is required to be set if `enableClusterLevelEnhancedMonitoring` is set to true.
   *
   * @default - When the `monitoringInterval` is set, enhanced monitoring is enabled for each instance.
   */
  readonly enableClusterLevelEnhancedMonitoring?: boolean;

  /**
   * Role that will be associated with this DB cluster to enable S3 import.
   * This feature is only supported by the Aurora database engine.
   *
   * This property must not be used if `s3ImportBuckets` is used.
   *
   * @default - New role is created if `s3ImportBuckets` is set, no role is defined otherwise
   */
  readonly s3ImportRole?: iam.IRole;

  /**
   * S3 buckets that you want to load data from. This feature is only supported by the Aurora database engine.
   *
   * This property must not be used if `s3ImportRole` is used.
   *
   * @default - None
   */
  readonly s3ImportBuckets?: IBucket[];

  /**
   * Role that will be associated with this DB cluster to enable S3 export.
   * This feature is only supported by the Aurora database engine.
   *
   * This property must not be used if `s3ExportBuckets` is used.
   *
   * @default - New role is created if `s3ExportBuckets` is set, no role is defined otherwise
   */
  readonly s3ExportRole?: iam.IRole;

  /**
   * S3 buckets that you want to load data into. This feature is only supported by the Aurora database engine.
   *
   * This property must not be used if `s3ExportRole` is used.
   *
   * @default - None
   */
  readonly s3ExportBuckets?: IBucket[];

  /**
   * Existing subnet group for the cluster.
   *
   * TERRACONSTRUCTS DEVIATION: `ISubnetGroup` instead of upstream's `aws_rds.IDBSubnetGroupRef` —
   * see the identical omission on `DatabaseInstanceNewProps.subnetGroup` in `./instance.ts`.
   *
   * @default - a new subnet group will be created.
   */
  readonly subnetGroup?: ISubnetGroup;

  /**
   * Whether to enable mapping of AWS Identity and Access Management (IAM) accounts
   * to database accounts.
   *
   * @default false
   */
  readonly iamAuthentication?: boolean;

  /**
   * Whether to enable storage encryption.
   *
   * @default - true if storageEncryptionKey is provided, false otherwise
   */
  readonly storageEncrypted?: boolean;

  /**
   * The KMS key for storage encryption.
   * If specified, `storageEncrypted` will be set to `true`.
   *
   * TERRACONSTRUCTS DEVIATION: `encryption.IKey` instead of upstream's `kms.IKeyRef` — see
   * `DatabaseInstanceProps.storageEncryptionKey` in `./instance.ts`.
   *
   * @default - if storageEncrypted is true then the default master key, no key otherwise
   */
  readonly storageEncryptionKey?: encryption.IKey;

  /**
   * The storage type to be associated with the DB cluster.
   *
   * @default - DBClusterStorageType.AURORA
   */
  readonly storageType?: DBClusterStorageType;

  /**
   * Whether to copy tags to the snapshot when a snapshot is created.
   *
   * @default - true
   */
  readonly copyTagsToSnapshot?: boolean;

  /**
   * The network type of the DB instance.
   *
   * @default - IPV4
   */
  readonly networkType?: NetworkType;

  /**
   * Directory ID for associating the DB cluster with a specific Active Directory.
   *
   * Necessary for enabling Kerberos authentication. If specified, the DB cluster joins the given Active Directory, enabling Kerberos authentication.
   * If not specified, the DB cluster will not be associated with any Active Directory, and Kerberos authentication will not be enabled.
   *
   * @default - DB cluster is not associated with an Active Directory; Kerberos authentication is not enabled.
   */
  readonly domain?: string;

  /**
   * The IAM role to be used when making API calls to the Directory Service. The role needs the AWS-managed policy
   * `AmazonRDSDirectoryServiceAccess` or equivalent.
   *
   * TERRACONSTRUCTS DEVIATION: `iam.IRole` instead of upstream's `iam.IRoleRef` — see
   * `DatabaseInstanceNewProps.monitoringRole` in `./instance.ts`.
   *
   * @default - If `DatabaseClusterBaseProps.domain` is specified, a role with the `AmazonRDSDirectoryServiceAccess` policy is automatically created.
   */
  readonly domainRole?: iam.IRole;

  /**
   * Whether to enable the Data API for the cluster.
   *
   * TERRACONSTRUCTS DEVIATION: maps to the `aws_rds_cluster` `enable_http_endpoint` argument (plan
   * decision — see codebase notes on `enableDataApi`).
   *
   * @default - false
   */
  readonly enableDataApi?: boolean;

  /**
   * Whether read replicas can forward write operations to the writer DB instance in the DB cluster.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-mysql-write-forwarding.html
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-postgresql-write-forwarding.html
   *
   * @default false
   */
  readonly enableLocalWriteForwarding?: boolean;

  /**
   * Whether to enable Performance Insights for the DB cluster.
   *
   * @default - false, unless `performanceInsightRetention` or `performanceInsightEncryptionKey` is set,
   * or `databaseInsightsMode` is set to `DatabaseInsightsMode.ADVANCED`.
   */
  readonly enablePerformanceInsights?: boolean;

  /**
   * The amount of time, in days, to retain Performance Insights data.
   *
   * If you set `databaseInsightsMode` to `DatabaseInsightsMode.ADVANCED`, you must set this property to `PerformanceInsightRetention.MONTHS_15`.
   *
   * @default - 7
   */
  readonly performanceInsightRetention?: PerformanceInsightRetention;

  /**
   * The AWS KMS key for encryption of Performance Insights data.
   *
   * TERRACONSTRUCTS DEVIATION: `encryption.IKey` instead of upstream's `kms.IKey` — see
   * `DatabaseInstanceNewProps.performanceInsightEncryptionKey` in `./instance.ts`.
   *
   * @default - default master key
   */
  readonly performanceInsightEncryptionKey?: encryption.IKey;

  /**
   * The database insights mode.
   *
   * @default - DatabaseInsightsMode.STANDARD when performance insights are enabled and Amazon Aurora engine is used, otherwise not set.
   */
  readonly databaseInsightsMode?: DatabaseInsightsMode;

  // TODO: omitted — upstream's `autoMinorVersionUpgrade?: boolean` maps to
  // `CfnDBCluster.autoMinorVersionUpgrade`. The Terraform `aws_rds_cluster` resource has NO
  // argument for this at all (not a CFN-vs-Terraform semantic difference — the provider simply
  // doesn't expose it at the cluster level; verified against the full config shape in
  // `node_modules/@cdktn/provider-aws/lib/rds-cluster/index.d.ts` — contrast with
  // `aws_rds_cluster_instance`, which DOES support it per-instance, already exercised via
  // `ClusterInstance.provisioned/serverlessV2({ autoMinorVersionUpgrade })` in
  // `./aurora-cluster-instance.ts`). Whether a cluster-level convenience prop should cascade a
  // default onto every instance is left as a future enhancement rather than silently accepted and
  // dropped —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster.ts#L478-L484
  // readonly autoMinorVersionUpgrade?: boolean;

  /**
   * Specifies the scalability mode of the Aurora DB cluster.
   *
   * Set LIMITLESS if you want to use a limitless database; otherwise, set it to STANDARD.
   *
   * @default ClusterScalabilityType.STANDARD
   */
  readonly clusterScalabilityType?: ClusterScalabilityType;

  /**
   * [Misspelled] Specifies the scalability mode of the Aurora DB cluster.
   *
   * Set LIMITLESS if you want to use a limitless database; otherwise, set it to STANDARD.
   *
   * @default ClusterScailabilityType.STANDARD
   * @deprecated Use clusterScalabilityType instead. This will be removed in the next major version.
   */
  readonly clusterScailabilityType?: ClusterScailabilityType;

  /**
   * The life cycle type for this DB cluster.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/extended-support.html
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/extended-support.html
   *
   * @default undefined - AWS RDS default setting is `EngineLifecycleSupport.OPEN_SOURCE_RDS_EXTENDED_SUPPORT`
   */
  readonly engineLifecycleSupport?: EngineLifecycleSupport;

  /**
   * Specifies whether to remove automated backups immediately after the DB cluster is deleted.
   *
   * @default undefined - AWS RDS default is to remove automated backups immediately after the DB cluster is deleted, unless the AWS Backup policy specifies a point-in-time restore rule.
   */
  readonly deleteAutomatedBackups?: boolean;
}

/**
 * The storage type to be associated with the DB cluster.
 */
export enum DBClusterStorageType {
  /**
   * Storage type for Aurora DB standard clusters.
   */
  AURORA = "aurora",

  /**
   * Storage type for Aurora DB I/O-Optimized clusters.
   */
  AURORA_IOPT1 = "aurora-iopt1",
}

/**
 * The orchestration of updates of multiple instances
 */
export enum InstanceUpdateBehaviour {
  /**
   * In a bulk update, all instances of the cluster are updated at the same time.
   * This results in a faster update procedure.
   * During the update, however, all instances might be unavailable at the same time and thus a downtime might occur.
   */
  BULK = "BULK",

  /**
   * In a rolling update, one instance after another is updated.
   * This results in at most one instance being unavailable during the update.
   * If your cluster consists of more than 1 instance, the downtime periods are limited to the time a primary switch needs.
   */
  ROLLING = "ROLLING",
}

/**
 * The scalability mode of the Aurora DB cluster.
 */
export enum ClusterScalabilityType {
  /**
   * The cluster uses normal DB instance creation.
   */
  STANDARD = "standard",

  /**
   * The cluster operates as an Aurora Limitless Database,
   * allowing you to create a DB shard group for horizontal scaling (sharding) capabilities.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/limitless.html
   */
  LIMITLESS = "limitless",
}

/**
 * The scalability mode of the Aurora DB cluster.
 * @deprecated Use ClusterScalabilityType instead. This will be removed in the next major version.
 */
export enum ClusterScailabilityType {
  /**
   * The cluster uses normal DB instance creation.
   */
  STANDARD = "standard",

  /**
   * The cluster operates as an Aurora Limitless Database,
   * allowing you to create a DB shard group for horizontal scaling (sharding) capabilities.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/limitless.html
   */
  LIMITLESS = "limitless",
}

/**
 * Properties for looking up an existing DatabaseCluster.
 */
export interface DatabaseClusterLookupOptions {
  /**
   * The cluster identifier of the DatabaseCluster
   */
  readonly clusterIdentifier: string;
}

/**
 * A role associated with a DB cluster, to be materialized as an
 * `aws_rds_cluster_role_association` resource.
 *
 * TERRACONSTRUCTS DEVIATION: not present upstream (see `createClusterRoleAssociations` on
 * `DatabaseClusterBase` below) -- a named interface (rather than an inline object type) is
 * required here because jsii only supports string-indexed map types for inline object-literal
 * types (`JSII1003: Only string-indexed map types are supported`). Mirrors
 * `InstanceAssociatedRole` in `./instance.ts`.
 */
export interface ClusterAssociatedRole {
  /** The ARN of the role to associate with the DB cluster. */
  readonly roleArn: string;

  /** The name of the feature for the DB cluster that the role is to be associated with. */
  readonly featureName?: string;
}

/**
 * A new or imported clustered database.
 */
export abstract class DatabaseClusterBase
  extends AwsConstructBase
  implements IDatabaseCluster
{
  public abstract readonly engine?: IClusterEngine;

  /**
   * Identifier of the cluster
   */
  public abstract readonly clusterIdentifier: string;

  /**
   * The immutable identifier for the cluster; for example: cluster-ABCD1234EFGH5678IJKL90MNOP.
   *
   * This AWS Region-unique identifier is used in things like IAM authentication policies.
   */
  public abstract readonly clusterResourceIdentifier: string;

  /**
   * Identifiers of the replicas
   */
  public abstract readonly instanceIdentifiers: string[];

  /**
   * The endpoint to use for read/write operations
   */
  public abstract readonly clusterEndpoint: Endpoint;

  /**
   * Endpoint to use for load-balanced read-only operations.
   */
  public abstract readonly clusterReadEndpoint: Endpoint;

  /**
   * Endpoints which address each individual replica.
   */
  public abstract readonly instanceEndpoints: Endpoint[];

  /**
   * Access to the network connections
   */
  public abstract readonly connections: ec2.Connections;

  /**
   * The secret attached to this cluster
   */
  public abstract readonly secret?: secretsmanager.ISecret;

  protected abstract enableDataApi?: boolean;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. `clusterEndpoint`/`clusterReadEndpoint` are
   * abstract getters that THROW on an `ImportedDatabaseCluster` built via
   * `fromDatabaseClusterAttributes()` without the corresponding endpoint address (see
   * `ImportedDatabaseCluster` below). `asSecretAttachmentTarget()` and `outputs` (both below) need
   * to tolerate that -- host/port and the endpoint outputs are simply omitted for a minimally
   * imported cluster rather than throwing. Concrete (non-imported) subclasses never throw here, so
   * the default implementation is a plain passthrough; `ImportedDatabaseCluster` overrides both to
   * return `undefined` instead of throwing when the corresponding attribute wasn't supplied.
   */
  protected tryGetClusterEndpoint(): Endpoint | undefined {
    return this.clusterEndpoint;
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see `tryGetClusterEndpoint()` above.
   */
  protected tryGetClusterReadEndpoint(): Endpoint | undefined {
    return this.clusterReadEndpoint;
  }

  /**
   * The ARN of the cluster
   *
   * TERRACONSTRUCTS DEVIATION: mirrors the identical deviation note on `instanceArn` in
   * `./instance.ts` — a single `formatArn` call (deterministic from region/account/identifier, the
   * same way CloudFormation derives it) is sufficient for both owned and imported clusters, since
   * `this.clusterIdentifier` is always the real, final value here.
   */
  public get clusterArn(): string {
    return this.stack.formatArn({
      service: "rds",
      resource: "cluster",
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      resourceName: this.clusterIdentifier,
    });
  }

  /**
   * Add a new db proxy to this cluster.
   */
  public addProxy(id: string, options: DatabaseProxyOptions): DatabaseProxy {
    return new DatabaseProxy(this, id, {
      proxyTarget: ProxyTarget.fromCluster(this),
      ...options,
    });
  }

  /**
   * Renders the secret attachment target specifications.
   *
   * TERRACONSTRUCTS DEVIATION: mirrors the identical deviation note on
   * `DatabaseInstanceBase.asSecretAttachmentTarget()` in `./instance.ts` — upstream returns only
   * `{ targetId, targetType }` because CloudFormation's `AWS::SecretsManager::SecretTargetAttachment`
   * resolves engine/host/port server-side from those two fields. The Terraform AWS provider has no
   * such server-side merge, so `connectionFields` is supplied here too, using `dbClusterIdentifier`
   * (not `dbInstanceIdentifier`) as CFN's `SecretTargetAttachment` does for RDS cluster targets.
   * `dbname` is intentionally not included here — it isn't known at this base-class level; see
   * `DatabaseClusterNew` below, which overrides this method to add it once known.
   */
  public asSecretAttachmentTarget(): secretsmanager.SecretAttachmentTargetProps {
    const endpoint = this.tryGetClusterEndpoint();
    return {
      targetId: this.clusterIdentifier,
      targetType: secretsmanager.AttachmentTargetType.RDS_DB_CLUSTER,
      connectionFields: {
        dbClusterIdentifier: this.clusterIdentifier,
        ...(this.engine?.engineType ? { engine: this.engine.engineType } : {}),
        ...(endpoint
          ? {
              host: endpoint.hostname,
              port: Tokenization.stringifyNumber(endpoint.port),
            }
          : {}),
      },
    };
  }

  /**
   * [disable-awslint:no-grants]
   */
  public grantConnect(grantee: iam.IGrantable, dbUser: string): iam.Grant {
    return iam.Grant.addToPrincipal({
      actions: ["rds-db:connect"],
      grantee,
      resourceArns: [
        this.stack.formatArn({
          service: "rds-db",
          resource: "dbuser",
          resourceName: `${this.clusterResourceIdentifier}/${dbUser}`,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
    });
  }

  /**
   * Grant the given identity to access the Data API.
   *
   * [disable-awslint:no-grants]
   */
  public grantDataApiAccess(grantee: iam.IGrantable): iam.Grant {
    if (this.enableDataApi === false) {
      throw new ValidationError(
        "Cannot grant Data API access when the Data API is disabled",
        this,
      );
    }

    this.enableDataApi = true;
    const ret = iam.Grant.addToPrincipal({
      grantee,
      actions: DATA_API_ACTIONS,
      resourceArns: [this.clusterArn],
    });
    this.secret?.grantRead(grantee);
    return ret;
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `DatabaseInstanceBase.outputs` in `./instance.ts`) — bare, bound-per-construct `outputs` for
   * use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    const endpoint = this.tryGetClusterEndpoint();
    const readEndpoint = this.tryGetClusterReadEndpoint();
    return {
      identifier: this.clusterIdentifier,
      arn: this.clusterArn,
      ...(endpoint && {
        endpointAddress: endpoint.hostname,
        endpointPort: Tokenization.stringifyNumber(endpoint.port),
      }),
      ...(readEndpoint && { readEndpointAddress: readEndpoint.hostname }),
    };
  }
}

/**
 * Abstract base for ``DatabaseCluster`` and ``DatabaseClusterFromSnapshot``
 */
abstract class DatabaseClusterNew extends DatabaseClusterBase {
  /**
   * The engine for this Cluster.
   * Never undefined.
   */
  public readonly engine?: IClusterEngine;

  /**
   * TERRACONSTRUCTS DEVIATION: typed loosely (`Record<string, any>`, mirroring upstream's
   * `CfnDBClusterProps` grab-bag and the identical idiom on `DatabaseInstanceNew.newInstanceProps`
   * in `./instance.ts`) rather than `Partial<rdsCluster.RdsClusterConfig>` — several fields below
   * are `Lazy` tokens (`IResolvable`) that don't structurally match the L1 config's typed shape
   * until the final `as rdsCluster.RdsClusterConfig` cast in each leaf class.
   */
  protected readonly newClusterProps: Record<string, any>;
  protected readonly securityGroups: ec2.ISecurityGroup[];
  protected readonly subnetGroup: ISubnetGroup;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see the note on
   * `createClusterRoleAssociations` below.
   */
  protected readonly clusterAssociatedRoles: ClusterAssociatedRole[];

  private readonly domainId?: string;
  private readonly domainRole?: iam.IRole;

  /**
   * Secret in SecretsManager to store the database cluster user credentials.
   */
  public abstract readonly secret?: secretsmanager.ISecret;

  /**
   * The VPC network to place the cluster in.
   */
  public readonly vpc: ec2.IVpc;

  /**
   * The cluster's subnets.
   */
  public readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Application for single user rotation of the master password to this cluster.
   */
  public readonly singleUserRotationApplication: secretsmanager.SecretRotationApplication;

  /**
   * Application for multi user rotation to this cluster.
   */
  public readonly multiUserRotationApplication: secretsmanager.SecretRotationApplication;

  /**
   * Whether Performance Insights is enabled at cluster level.
   */
  public readonly performanceInsightsEnabled: boolean;

  /**
   * The amount of time, in days, to retain Performance Insights data.
   */
  public readonly performanceInsightRetention?: PerformanceInsightRetention;

  /**
   * The AWS KMS key for encryption of Performance Insights data.
   */
  public readonly performanceInsightEncryptionKey?: encryption.IKey;

  /**
   * The database insights mode.
   */
  public readonly databaseInsightsMode?: DatabaseInsightsMode;

  /**
   * The IAM role for the enhanced monitoring.
   */
  public readonly monitoringRole?: iam.IRole;

  protected readonly serverlessV2MinCapacity: number;
  protected readonly serverlessV2MaxCapacity: number;
  protected readonly serverlessV2AutoPauseDuration?: Duration;

  protected hasServerlessInstance?: boolean;
  protected enableDataApi?: boolean;
  protected manageMasterUserPassword?: boolean;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Stashed so `asSecretAttachmentTarget()`
   * (overridden below) can contribute `dbname` to the attached secret's connection fields — mirrors
   * `DatabaseInstanceSource.databaseName` in `./instance.ts`.
   */
  protected readonly defaultDatabaseName?: string;

  constructor(scope: Construct, id: string, props: DatabaseClusterBaseProps) {
    super(scope, id, props);

    this.defaultDatabaseName = props.defaultDatabaseName;

    if (
      props.clusterScalabilityType !== undefined &&
      props.clusterScailabilityType !== undefined
    ) {
      throw new ValidationError(
        "You cannot specify both clusterScalabilityType and clusterScailabilityType (deprecated). Use clusterScalabilityType.",
        this,
      );
    }

    if (
      (props.vpc && props.instanceProps?.vpc) ||
      (!props.vpc && !props.instanceProps?.vpc)
    ) {
      throw new ValidationError(
        "Provide either vpc or instanceProps.vpc, but not both",
        this,
      );
    }
    if (props.vpcSubnets && props.instanceProps?.vpcSubnets) {
      throw new ValidationError(
        "Provide either vpcSubnets or instanceProps.vpcSubnets, but not both",
        this,
      );
    }
    this.vpc = props.instanceProps?.vpc ?? props.vpc!;
    this.vpcSubnets = props.instanceProps?.vpcSubnets ?? props.vpcSubnets;

    this.singleUserRotationApplication =
      props.engine.singleUserRotationApplication;
    this.multiUserRotationApplication =
      props.engine.multiUserRotationApplication;

    this.serverlessV2MaxCapacity = props.serverlessV2MaxCapacity ?? 2;
    this.serverlessV2MinCapacity = props.serverlessV2MinCapacity ?? 0.5;
    this.serverlessV2AutoPauseDuration = props.serverlessV2AutoPauseDuration;

    this.enableDataApi = props.enableDataApi;

    const { subnetIds } = this.vpc.selectSubnets(this.vpcSubnets);

    // Cannot test whether the subnets are in different AZs, but at least we can test the amount.
    //
    // TERRACONSTRUCTS DEVIATION: upstream uses `Annotations.of(this)._addTrackableError(...)`, a
    // CDK-internal-only API not exposed by `cdktn`'s `Annotations`. `addError` is the closest public
    // equivalent (synthesis fails when errors are reported) — see `errors.ts`/`cdktn`'s
    // `Annotations` for the full public surface.
    if (subnetIds.length < 2) {
      Annotations.of(this).addError(
        `Cluster requires at least 2 subnets, got ${subnetIds.length}`,
      );
    }

    this.subnetGroup =
      props.subnetGroup ??
      new SubnetGroup(this, "Subnets", {
        description: `Subnets for ${id} database`,
        vpc: this.vpc,
        vpcSubnets: this.vpcSubnets,
        // TERRACONSTRUCTS DEVIATION: no `removalPolicy` to pass — see the omission note on
        // `SubnetGroupProps.removalPolicy` in `./subnet-group.ts`.
      });

    this.securityGroups = props.instanceProps?.securityGroups ??
      props.securityGroups ?? [
        new ec2.SecurityGroup(this, "SecurityGroup", {
          description: "RDS security group",
          vpc: this.vpc,
        }),
      ];

    // TERRACONSTRUCTS DEVIATION: unlike `DatabaseInstanceSource` (`combineRoles` depends on
    // engine-specific string prefixes), clusters use the engine's own
    // `combineImportAndExportRoles` flag directly, mirroring upstream exactly.
    const combineRoles = props.engine.combineImportAndExportRoles ?? false;
    const { s3ImportRole, s3ExportRole } = setupS3ImportExport(
      this,
      props,
      combineRoles,
    );

    if (props.parameterGroup && props.parameters) {
      throw new ValidationError(
        "You cannot specify both parameterGroup and parameters",
        this,
      );
    }
    const parameterGroup =
      props.parameterGroup ??
      (props.parameters
        ? new ParameterGroup(this, "ParameterGroup", {
            engine: props.engine,
            parameters: props.parameters,
          })
        : undefined);
    // bind the engine to the Cluster
    const clusterEngineBindConfig = props.engine.bindToCluster(this, {
      s3ImportRole,
      s3ExportRole,
      parameterGroup,
    });

    // TERRACONSTRUCTS DEVIATION: upstream's inline `associatedRoles` (a `CfnDBCluster` array
    // property) is dropped here — the Terraform `aws_rds_cluster` resource has no equivalent
    // inline argument; role/feature-name associations are separate
    // `aws_rds_cluster_role_association` resources instead (see `createClusterRoleAssociations`
    // below, mirroring `DatabaseInstanceNew.createInstanceRoleAssociations` in `./instance.ts`).
    const clusterAssociatedRoles: ClusterAssociatedRole[] = [];
    if (s3ImportRole) {
      clusterAssociatedRoles.push({
        roleArn: s3ImportRole.roleArn,
        featureName: clusterEngineBindConfig.features?.s3Import,
      });
    }
    if (
      s3ExportRole &&
      // only add the second associated Role if it's different than the first
      // (duplicates in the associated Roles array are not allowed by the RDS service)
      (s3ExportRole !== s3ImportRole ||
        clusterEngineBindConfig.features?.s3Import !==
          clusterEngineBindConfig.features?.s3Export)
    ) {
      clusterAssociatedRoles.push({
        roleArn: s3ExportRole.roleArn,
        featureName: clusterEngineBindConfig.features?.s3Export,
      });
    }
    this.clusterAssociatedRoles = clusterAssociatedRoles;

    const clusterParameterGroup =
      props.parameterGroup ?? clusterEngineBindConfig.parameterGroup;
    const clusterParameterGroupConfig = clusterParameterGroup?.bindToCluster(
      {},
    );
    this.engine = props.engine;

    // TERRACONSTRUCTS DEVIATION: upstream branches on the `RDS_LOWERCASE_DB_IDENTIFIER` feature
    // flag between lowercasing `clusterIdentifier` (corrected) or leaving it as-is (legacy, kept
    // only for backward compatibility with already-deployed CFN stacks). `core.FeatureFlags` is not
    // ported in this repo (see the identical, always-corrected-behavior note on
    // `DatabaseInstanceNew`'s `instanceIdentifier` in `./instance.ts`), so the corrected (always
    // lowercase) behavior is simply the only behavior. Additionally, per the repo invariant that
    // unnamed resources get a gridUUID-scoped `uniqueResourceName` default (see the same idiom on
    // `DatabaseInstanceNew`'s `instanceIdentifier`, `SubnetGroup`, `OptionGroup`, `ParameterGroup`)
    // instead of relying on CloudFormation's Ref-based logical-id naming or the provider's own
    // generated `terraform-<hash>` fallback, an omitted `clusterIdentifier` falls back to
    // `uniqueResourceName`. `DBClusterIdentifier` is capped at 63 characters, so `maxLength` is
    // passed explicitly here.
    const clusterIdentifier = Token.isUnresolved(props.clusterIdentifier)
      ? props.clusterIdentifier
      : (
          props.clusterIdentifier ??
          this.stack.uniqueResourceName(this, { maxLength: 63 })
        ).toLowerCase();

    if (props.domain) {
      this.domainId = props.domain;
      this.domainRole =
        props.domainRole ||
        new iam.Role(this, "RDSClusterDirectoryServiceRole", {
          assumedBy: new iam.CompositePrincipal(
            new iam.ServicePrincipal("rds.amazonaws.com"),
            new iam.ServicePrincipal("directoryservice.rds.amazonaws.com"),
          ),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              this,
              "DirectoryServicePolicy",
              "service-role/AmazonRDSDirectoryServiceAccess",
            ),
          ],
        });
    }

    // NOTE: `DatabaseClusterProps`/`DatabaseClusterFromSnapshotProps` both extend
    // `DatabaseClusterBaseProps` by adding only OPTIONAL fields, so a `DatabaseClusterBaseProps`
    // value is always structurally assignable to `DatabaseClusterProps` here — matches upstream,
    // which passes `props` (typed `DatabaseClusterBaseProps` in this shared base constructor)
    // directly to the same, more narrowly-typed function.
    validateDatabaseClusterProps(this, props as DatabaseClusterProps);
    this.validateServerlessScalingConfig(clusterEngineBindConfig);

    const enablePerformanceInsights =
      props.enablePerformanceInsights ||
      props.performanceInsightRetention !== undefined ||
      props.performanceInsightEncryptionKey !== undefined ||
      props.databaseInsightsMode === DatabaseInsightsMode.ADVANCED;
    this.performanceInsightsEnabled = enablePerformanceInsights;
    this.performanceInsightRetention = enablePerformanceInsights
      ? props.performanceInsightRetention || PerformanceInsightRetention.DEFAULT
      : undefined;
    this.performanceInsightEncryptionKey =
      props.performanceInsightEncryptionKey;
    this.databaseInsightsMode = props.databaseInsightsMode;

    // configure enhanced monitoring role for the cluster or instance
    this.monitoringRole = props.monitoringRole;
    if (
      !props.monitoringRole &&
      props.monitoringInterval &&
      props.monitoringInterval.toSeconds()
    ) {
      this.monitoringRole = new iam.Role(this, "MonitoringRole", {
        assumedBy: new iam.ServicePrincipal("monitoring.rds.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            this,
            "MonitoringPolicy",
            "service-role/AmazonRDSEnhancedMonitoringRole",
          ),
        ],
      });
    }

    if (
      props.enableClusterLevelEnhancedMonitoring &&
      !props.monitoringInterval
    ) {
      throw new ValidationError(
        "`monitoringInterval` must be set when `enableClusterLevelEnhancedMonitoring` is true.",
        this,
      );
    }
    if (
      props.monitoringInterval &&
      !props.monitoringInterval.isUnresolved() &&
      [0, 1, 5, 10, 15, 30, 60].indexOf(
        props.monitoringInterval.toSeconds(),
      ) === -1
    ) {
      throw new ValidationError(
        `'monitoringInterval' must be one of 0, 1, 5, 10, 15, 30, or 60 seconds, got: ${props.monitoringInterval.toSeconds()} seconds.`,
        this,
      );
    }

    this.newClusterProps = {
      // Basic
      engine: props.engine.engineType,
      engineVersion: props.engine.engineVersion?.fullVersion,
      clusterIdentifier,
      dbSubnetGroupName: this.subnetGroup.subnetGroupName,
      vpcSecurityGroupIds: this.securityGroups.map((sg) => sg.securityGroupId),
      port: props.port ?? clusterEngineBindConfig.port,
      dbClusterParameterGroupName:
        clusterParameterGroupConfig?.parameterGroupName,
      deletionProtection: defaultDeletionProtection(props.deletionProtection),
      iamDatabaseAuthenticationEnabled: props.iamAuthentication,
      enableHttpEndpoint: Lazy.anyValue({
        produce: () => this.enableDataApi,
      }),
      networkType: props.networkType,
      // TERRACONSTRUCTS DEVIATION: unlike `enableHttpEndpoint` above (a plain top-level scalar
      // argument, for which `Lazy.anyValue()` resolves correctly), `serverlessv2ScalingConfiguration`
      // is a nested BLOCK-typed argument. CDKTF/`cdktn` generates block-typed L1 properties through a
      // `ComplexObject`/"OutputReference" wrapper (`internalValue`) that is never handed to the
      // standard whole-tree token-resolution pass the way scalar attributes are -- empirically, a
      // `Lazy.anyValue()` producer assigned here is simply never invoked (verified against
      // `node_modules/@cdktn/provider-aws/lib/rds-cluster/index.js`: `synthesizeAttributes()` calls
      // `rdsClusterServerlessv2ScalingConfigurationToTerraform(this._serverlessv2ScalingConfiguration.internalValue)`,
      // which recognizes the `IResolvable` and returns it unconverted, but nothing downstream ever
      // resolves it for block-typed attributes specifically). Not set here at all -- see
      // `hasServerlessInstance` is only known once `_createInstances()`/`legacyCreateInstances()` runs
      // (after this resource already exists); leaf classes (`DatabaseCluster`/
      // `DatabaseClusterFromSnapshot`) instead call `cluster.addOverride("serverlessv2_scaling_configuration", ...)`
      // AFTER creating the instances, once `hasServerlessInstance` is definitively known -- `addOverride`
      // bypasses the typed property/token-resolution system entirely and is unaffected by this
      // limitation. BEHAVIORAL DIFFERENCE from upstream: because the override is applied eagerly at
      // the end of the leaf constructor rather than via a `Lazy`/synth-time producer, an
      // `IClusterInstance` bound to this cluster AFTER construction (`bind()` is public jsii API) is
      // NOT reflected -- `hasServerlessInstance` was already read and `serverlessv2_scaling_configuration`
      // will silently never be emitted for such a late-bound serverless instance. Upstream's
      // `Lazy.any` producer observes the final state at synth time and has no such gap.
      storageType: props.storageType?.toString(),
      enableLocalWriteForwarding: props.enableLocalWriteForwarding,
      clusterScalabilityType:
        props.clusterScalabilityType ?? props.clusterScailabilityType,
      // Admin
      backtrackWindow: props.backtrackWindow?.toSeconds(),
      backupRetentionPeriod: props.backup?.retention?.toDays(),
      preferredBackupWindow: props.backup?.preferredWindow,
      preferredMaintenanceWindow: props.preferredMaintenanceWindow,
      databaseName: props.defaultDatabaseName,
      enabledCloudwatchLogsExports: props.cloudwatchLogsExports,
      // Encryption
      kmsKeyId: props.storageEncryptionKey?.keyArn,
      storageEncrypted: props.storageEncryptionKey
        ? true
        : props.storageEncrypted,
      // Tags
      copyTagsToSnapshot: props.copyTagsToSnapshot ?? true,
      domain: this.domainId,
      domainIamRoleName: this.domainRole?.roleName,
      performanceInsightsEnabled:
        this.performanceInsightsEnabled || props.enablePerformanceInsights, // fall back to undefined if not set
      performanceInsightsKmsKeyId: this.performanceInsightEncryptionKey?.keyArn,
      performanceInsightsRetentionPeriod: this.performanceInsightRetention,
      databaseInsightsMode: this.databaseInsightsMode,
      // TODO: omitted — see the omission note on `DatabaseClusterBaseProps.autoMinorVersionUpgrade`
      // above; `aws_rds_cluster` has no `auto_minor_version_upgrade` argument.
      monitoringInterval: props.enableClusterLevelEnhancedMonitoring
        ? props.monitoringInterval?.toSeconds()
        : undefined,
      monitoringRoleArn: props.enableClusterLevelEnhancedMonitoring
        ? this.monitoringRole?.roleArn
        : undefined,
      engineLifecycleSupport: props.engineLifecycleSupport,
      deleteAutomatedBackups: props.deleteAutomatedBackups,
      skipFinalSnapshot: props.skipFinalSnapshot,
      finalSnapshotIdentifier: props.finalSnapshotIdentifier,
    };

    // TERRACONSTRUCTS DEVIATION: mirrors the identical `skipFinalSnapshot`/`finalSnapshotIdentifier`
    // synth-time warning on `DatabaseInstanceNew` in `./instance.ts` — see that note for the full
    // rationale.
    if (props.skipFinalSnapshot !== true && !props.finalSnapshotIdentifier) {
      Annotations.of(this).addWarning(
        "Neither `skipFinalSnapshot` nor `finalSnapshotIdentifier` is set: `terraform destroy` (or any change that replaces this cluster) will FAIL at apply time because the AWS provider requires `finalSnapshotIdentifier` when `skipFinalSnapshot` is not `true`. Set `skipFinalSnapshot: true` to skip the final snapshot, or set `finalSnapshotIdentifier` to a snapshot name.",
      );
    }
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Overrides `DatabaseClusterBase`'s
   * `asSecretAttachmentTarget()` to also contribute `dbname` to the attached secret's connection
   * fields, now that a configured database name is available at this level (`this.defaultDatabaseName`,
   * stashed above from `DatabaseClusterBaseProps.defaultDatabaseName`). Mirrors
   * `DatabaseInstanceSource.asSecretAttachmentTarget()` in `./instance.ts`.
   */
  public asSecretAttachmentTarget(): secretsmanager.SecretAttachmentTargetProps {
    const target = super.asSecretAttachmentTarget();
    return {
      ...target,
      connectionFields: {
        ...target.connectionFields,
        ...(this.defaultDatabaseName
          ? { dbname: this.defaultDatabaseName }
          : {}),
      },
    };
  }

  /**
   * Creates `aws_rds_cluster_role_association` resources for the S3 import/export roles.
   *
   * TERRACONSTRUCTS DEVIATION: not present upstream — the Terraform `aws_rds_cluster` resource has
   * no inline `associated_roles`-equivalent argument; role/feature-name associations are separate
   * `aws_rds_cluster_role_association` resources instead. Mirrors
   * `DatabaseInstanceNew.createInstanceRoleAssociations` in `./instance.ts`. Called by leaf classes
   * after the `aws_rds_cluster` resource exists.
   */
  protected createClusterRoleAssociations(clusterIdentifier: string): void {
    this.clusterAssociatedRoles.forEach((role, index) => {
      new rdsClusterRoleAssociation.RdsClusterRoleAssociation(
        this,
        `RoleAssociation${index}`,
        {
          dbClusterIdentifier: clusterIdentifier,
          featureName: role.featureName,
          roleArn: role.roleArn,
        },
      );
    });
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see the note on
   * `serverlessv2ScalingConfiguration` in the constructor above for why this is applied via
   * `addOverride()` rather than a `Lazy.anyValue()` in `newClusterProps`. Must be called by leaf
   * classes AFTER `_createInstances()`/`legacyCreateInstances()` has run, once
   * `this.hasServerlessInstance` is definitively known.
   *
   * BEHAVIORAL CONSEQUENCE (differs from upstream's synth-time `Lazy.any` producer): a serverless
   * instance bound through the public `IClusterInstance.bind()` API AFTER the leaf constructor
   * returns sets `hasServerlessInstance` too late — the `serverlessv2_scaling_configuration` block
   * is then never emitted. Bind all serverless instances via the `writer`/`readers` props (or
   * before construction completes); late binders must set the scaling block via escape hatch.
   */
  protected applyServerlessV2ScalingConfigurationOverride(
    resource: rdsCluster.RdsCluster,
  ): void {
    if (this.hasServerlessInstance) {
      resource.addOverride("serverlessv2_scaling_configuration", {
        min_capacity: this.serverlessV2MinCapacity,
        max_capacity: this.serverlessV2MaxCapacity,
        seconds_until_auto_pause:
          this.serverlessV2AutoPauseDuration?.toSeconds(),
      });
    }
  }

  /**
   * Create cluster instances
   *
   * @internal
   */
  protected _createInstances(props: DatabaseClusterProps): InstanceConfig {
    const instanceEndpoints: Endpoint[] = [];
    const instanceIdentifiers: string[] = [];
    const readers: IAuroraClusterInstance[] = [];

    // need to create the writer first since writer is determined by what instance is first
    const writer = props.writer!.bind(this, this, {
      // When `enableClusterLevelEnhancedMonitoring` is enabled,
      // both `monitoringInterval` and `monitoringRole` are set at cluster level so no need to re-set it in instance level.
      monitoringInterval: props.enableClusterLevelEnhancedMonitoring
        ? undefined
        : props.monitoringInterval,
      monitoringRole: props.enableClusterLevelEnhancedMonitoring
        ? undefined
        : this.monitoringRole,
      subnetGroup: this.subnetGroup,
      promotionTier: 0, // override the promotion tier so that writers are always 0
    });
    instanceIdentifiers.push(writer.instanceIdentifier);
    instanceEndpoints.push(
      new Endpoint(writer.dbInstanceEndpointAddress, this.clusterEndpoint.port),
    );

    (props.readers ?? []).forEach((instance) => {
      const clusterInstance = instance.bind(this, this, {
        // When `enableClusterLevelEnhancedMonitoring` is enabled,
        // both `monitoringInterval` and `monitoringRole` are set at cluster level so no need to re-set it in instance level.
        monitoringInterval: props.enableClusterLevelEnhancedMonitoring
          ? undefined
          : props.monitoringInterval,
        monitoringRole: props.enableClusterLevelEnhancedMonitoring
          ? undefined
          : this.monitoringRole,
        subnetGroup: this.subnetGroup,
      });
      readers.push(clusterInstance);
      // this makes sure the readers would always be created after the writer
      clusterInstance.node.addDependency(writer);

      if (clusterInstance.tier < 2) {
        this.validateReaderInstance(writer, clusterInstance);
      }
      instanceEndpoints.push(
        new Endpoint(
          clusterInstance.dbInstanceEndpointAddress,
          this.clusterEndpoint.port,
        ),
      );
      instanceIdentifiers.push(clusterInstance.instanceIdentifier);
    });
    this.validateClusterInstances(writer, readers);

    return {
      instanceEndpoints,
      instanceIdentifiers,
    };
  }

  /**
   * Perform validations on the cluster instances
   */
  private validateClusterInstances(
    writer: IAuroraClusterInstance,
    readers: IAuroraClusterInstance[],
  ): void {
    if (writer.type === InstanceType.SERVERLESS_V2) {
      this.hasServerlessInstance = true;
    }
    validatePerformanceInsightsSettings(this, {
      nodeId: writer.node.id,
      performanceInsightsEnabled: writer.performanceInsightsEnabled,
      performanceInsightRetention: writer.performanceInsightRetention,
      performanceInsightEncryptionKey: writer.performanceInsightEncryptionKey,
    });

    if (readers.length > 0) {
      const sortedReaders = readers.sort((a, b) => a.tier - b.tier);
      const highestTierReaders: IAuroraClusterInstance[] = [];
      const highestTier = sortedReaders[0].tier;
      let hasProvisionedReader = false;
      let noFailoverTierInstances = true;
      let serverlessInHighestTier = false;
      let hasServerlessReader = false;
      const someProvisionedReadersDontMatchWriter: IAuroraClusterInstance[] =
        [];
      for (const reader of sortedReaders) {
        if (reader.type === InstanceType.SERVERLESS_V2) {
          hasServerlessReader = true;
          this.hasServerlessInstance = true;
        } else {
          hasProvisionedReader = true;
          if (reader.instanceSize !== writer.instanceSize) {
            someProvisionedReadersDontMatchWriter.push(reader);
          }
        }
        if (reader.tier === highestTier) {
          if (reader.type === InstanceType.SERVERLESS_V2) {
            serverlessInHighestTier = true;
          }
          highestTierReaders.push(reader);
        }
        if (reader.tier <= 1) {
          noFailoverTierInstances = false;
        }
        validatePerformanceInsightsSettings(this, {
          nodeId: reader.node.id,
          performanceInsightsEnabled: reader.performanceInsightsEnabled,
          performanceInsightRetention: reader.performanceInsightRetention,
          performanceInsightEncryptionKey:
            reader.performanceInsightEncryptionKey,
        });
      }

      const hasOnlyServerlessReaders =
        hasServerlessReader && !hasProvisionedReader;
      if (hasOnlyServerlessReaders) {
        if (noFailoverTierInstances) {
          Annotations.of(this).addWarning(
            `Cluster ${this.node.id} only has serverless readers and no reader is in promotion tier 0-1. ` +
              "Serverless readers in promotion tiers >= 2 will NOT scale with the writer, which can lead to " +
              "availability issues if a failover event occurs. It is recommended that at least one reader " +
              "has `scaleWithWriter` set to true",
          );
        }
      } else {
        if (serverlessInHighestTier && highestTier > 1) {
          Annotations.of(this).addWarning(
            `There are serverlessV2 readers in tier ${highestTier}. Since there are no instances in a higher tier, ` +
              "any instance in this tier is a failover target. Since this tier is > 1 the serverless reader will not scale " +
              "with the writer which could lead to availability issues during failover.",
          );
        }
        if (
          someProvisionedReadersDontMatchWriter.length > 0 &&
          writer.type === InstanceType.PROVISIONED
        ) {
          Annotations.of(this).addWarning(
            `There are provisioned readers in the highest promotion tier ${highestTier} that do not have the same ` +
              "InstanceSize as the writer. Any of these instances could be chosen as the new writer in the event " +
              "of a failover.\n" +
              `Writer InstanceSize: ${writer.instanceSize}\n` +
              `Reader InstanceSizes: ${someProvisionedReadersDontMatchWriter.map((reader) => reader.instanceSize).join(", ")}`,
          );
        }
      }
    }
  }

  /**
   * Perform validations on the reader instance
   */
  private validateReaderInstance(
    writer: IAuroraClusterInstance,
    reader: IAuroraClusterInstance,
  ): void {
    if (writer.type === InstanceType.PROVISIONED) {
      if (reader.type === InstanceType.SERVERLESS_V2) {
        if (
          !instanceSizeSupportedByServerlessV2(
            writer.instanceSize!,
            this.serverlessV2MaxCapacity,
          )
        ) {
          Annotations.of(this).addWarning(
            "For high availability any serverless instances in promotion tiers 0-1 " +
              "should be able to scale to match the provisioned instance capacity.\n" +
              `Serverless instance ${reader.node.id} is in promotion tier ${reader.tier},\n` +
              `But can not scale to match the provisioned writer instance (${writer.instanceSize})`,
          );
        }
      }
    }
  }

  /**
   * As a cluster-level metric, it represents the average of the ServerlessDatabaseCapacity
   * values of all the Aurora Serverless v2 DB instances in the cluster.
   *
   * `this.metric()` is supplied by the `declare module`/prototype-augmentation merge in
   * `./rds-augmentations.generated.ts` (generated from `rds-canned-metrics.generated.ts`), not
   * hand-written here — mirrors every other service in this codebase (see e.g.
   * `QueueBase`/`sqs-augmentations.generated.ts`).
   */
  public metricServerlessDatabaseCapacity(props?: cloudwatch.MetricOptions) {
    return this.metric("ServerlessDatabaseCapacity", {
      statistic: "Average",
      ...props,
    });
  }

  /**
   * This value is represented as a percentage. It's calculated as the value of the
   * ServerlessDatabaseCapacity metric divided by the maximum ACU value of the DB cluster.
   *
   * If this metric approaches a value of 100.0, the DB instance has scaled up as high as it can.
   * Consider increasing the maximum ACU setting for the cluster.
   *
   * `this.metric()` is supplied by `./rds-augmentations.generated.ts` — see the note on
   * `metricServerlessDatabaseCapacity` above. `metricVolumeReadIOPs`/`metricVolumeWriteIOPs` (also
   * hand-written upstream, calling `this.metric(...)`) are covered entirely by that same
   * augmentation file and are therefore not repeated here.
   */
  public metricACUUtilization(props?: cloudwatch.MetricOptions) {
    return this.metric("ACUUtilization", { statistic: "Average", ...props });
  }

  private validateServerlessScalingConfig(config: ClusterEngineConfig): void {
    if (
      this.serverlessV2MaxCapacity > 256 ||
      this.serverlessV2MaxCapacity < 1
    ) {
      throw new ValidationError(
        "serverlessV2MaxCapacity must be >= 1 & <= 256",
        this,
      );
    }

    if (
      this.serverlessV2MinCapacity > 256 ||
      this.serverlessV2MinCapacity < 0
    ) {
      throw new ValidationError(
        "serverlessV2MinCapacity must be >= 0 & <= 256",
        this,
      );
    }

    if (this.serverlessV2MaxCapacity < this.serverlessV2MinCapacity) {
      throw new ValidationError(
        "serverlessV2MaxCapacity must be greater than serverlessV2MinCapacity",
        this,
      );
    }

    const regexp = new RegExp(/^[0-9]+\.?5?$/);
    if (
      !regexp.test(this.serverlessV2MaxCapacity.toString()) ||
      !regexp.test(this.serverlessV2MinCapacity.toString())
    ) {
      throw new ValidationError(
        "serverlessV2MinCapacity & serverlessV2MaxCapacity must be in 0.5 step increments, received " +
          `min: ${this.serverlessV2MaxCapacity}, max: ${this.serverlessV2MaxCapacity}`,
        this,
      );
    }

    if (this.serverlessV2AutoPauseDuration) {
      if (!config.features?.serverlessV2AutoPauseSupported) {
        throw new ValidationError(
          `serverlessV2 auto-pause feature is not supported by ${this.engine?.engineType} ${this.engine?.engineVersion?.fullVersion}.`,
          this,
        );
      }
      if (
        !this.serverlessV2AutoPauseDuration.isUnresolved() &&
        (this.serverlessV2AutoPauseDuration.toSeconds() < 300 ||
          this.serverlessV2AutoPauseDuration.toSeconds() > 86400)
      ) {
        throw new ValidationError(
          `serverlessV2AutoPause must be between 300 seconds (5 minutes) and 86,400 seconds (24 hours), received ${this.serverlessV2AutoPauseDuration.toSeconds()} seconds`,
          this,
        );
      }
    }
  }

  /**
   * Adds the single user rotation of the master password to this cluster.
   */
  public addRotationSingleUser(
    options: RotationSingleUserOptions = {},
  ): secretsmanager.SecretRotation {
    if (this.manageMasterUserPassword) {
      throw new ValidationError(
        "Cannot add rotation when `manageMasterUserPassword` is enabled. RDS automatically rotates the master password when it manages the secret.",
        this,
      );
    }
    if (!this.secret) {
      throw new ValidationError(
        "Cannot add a single user rotation for a cluster without a secret.",
        this,
      );
    }

    const id = "RotationSingleUser";
    const existing = this.node.tryFindChild(id);
    if (existing) {
      throw new ValidationError(
        "A single user rotation was already added to this cluster.",
        this,
      );
    }

    return new secretsmanager.SecretRotation(this, id, {
      ...applyDefaultRotationOptions(options, this.vpcSubnets),
      secret: this.secret,
      application: this.singleUserRotationApplication,
      vpc: this.vpc,
      target: this,
    });
  }

  /**
   * Adds the multi user rotation to this cluster.
   */
  public addRotationMultiUser(
    id: string,
    options: RotationMultiUserOptions,
  ): secretsmanager.SecretRotation {
    if (this.manageMasterUserPassword) {
      throw new ValidationError(
        "Cannot add rotation when `manageMasterUserPassword` is enabled. RDS automatically rotates the master password when it manages the secret.",
        this,
      );
    }
    if (!this.secret) {
      throw new ValidationError(
        "Cannot add a multi user rotation for a cluster without a secret.",
        this,
      );
    }

    return new secretsmanager.SecretRotation(this, id, {
      ...applyDefaultRotationOptions(options, this.vpcSubnets),
      secret: options.secret,
      masterSecret: this.secret,
      application: this.multiUserRotationApplication,
      vpc: this.vpc,
      target: this,
    });
  }
}

/**
 * Represents an imported database cluster.
 */
class ImportedDatabaseCluster
  extends DatabaseClusterBase
  implements IDatabaseCluster
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.ImportedDatabaseCluster";

  public readonly clusterIdentifier: string;
  public readonly connections: ec2.Connections;
  public readonly engine?: IClusterEngine;
  public readonly secret?: secretsmanager.ISecret;

  private readonly _clusterResourceIdentifier?: string;
  private readonly _clusterEndpoint?: Endpoint;
  private readonly _clusterReadEndpoint?: Endpoint;
  private readonly _instanceIdentifiers?: string[];
  private readonly _instanceEndpoints?: Endpoint[];

  protected readonly enableDataApi: boolean;

  constructor(scope: Construct, id: string, attrs: DatabaseClusterAttributes) {
    super(scope, id, {});

    this.clusterIdentifier = attrs.clusterIdentifier;
    this._clusterResourceIdentifier = attrs.clusterResourceIdentifier;

    const defaultPort = attrs.port ? ec2.Port.tcp(attrs.port) : undefined;
    this.connections = new ec2.Connections({
      securityGroups: attrs.securityGroups,
      defaultPort,
    });
    this.engine = attrs.engine;
    this.secret = attrs.secret;

    this.enableDataApi = attrs.dataApiEnabled ?? false;

    this._clusterEndpoint =
      attrs.clusterEndpointAddress && attrs.port
        ? new Endpoint(attrs.clusterEndpointAddress, attrs.port)
        : undefined;
    this._clusterReadEndpoint =
      attrs.readerEndpointAddress && attrs.port
        ? new Endpoint(attrs.readerEndpointAddress, attrs.port)
        : undefined;
    this._instanceIdentifiers = attrs.instanceIdentifiers;
    this._instanceEndpoints =
      attrs.instanceEndpointAddresses && attrs.port
        ? attrs.instanceEndpointAddresses.map(
            (addr) => new Endpoint(addr, attrs.port!),
          )
        : undefined;
  }

  public get clusterResourceIdentifier() {
    if (!this._clusterResourceIdentifier) {
      throw new ValidationError(
        "Cannot access `clusterResourceIdentifier` of an imported cluster without a clusterResourceIdentifier",
        this,
      );
    }
    return this._clusterResourceIdentifier;
  }

  public get clusterEndpoint() {
    if (!this._clusterEndpoint) {
      throw new ValidationError(
        "Cannot access `clusterEndpoint` of an imported cluster without an endpoint address and port",
        this,
      );
    }
    return this._clusterEndpoint;
  }

  public get clusterReadEndpoint() {
    if (!this._clusterReadEndpoint) {
      throw new ValidationError(
        "Cannot access `clusterReadEndpoint` of an imported cluster without a readerEndpointAddress and port",
        this,
      );
    }
    return this._clusterReadEndpoint;
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see `DatabaseClusterBase.tryGetClusterEndpoint()`.
   * Returns `undefined` instead of throwing when this import was constructed without an endpoint
   * address/port.
   */
  protected tryGetClusterEndpoint(): Endpoint | undefined {
    return this._clusterEndpoint;
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see `DatabaseClusterBase.tryGetClusterEndpoint()`.
   */
  protected tryGetClusterReadEndpoint(): Endpoint | undefined {
    return this._clusterReadEndpoint;
  }

  public get instanceIdentifiers() {
    if (!this._instanceIdentifiers) {
      throw new ValidationError(
        "Cannot access `instanceIdentifiers` of an imported cluster without provided instanceIdentifiers",
        this,
      );
    }
    return this._instanceIdentifiers;
  }

  public get instanceEndpoints() {
    if (!this._instanceEndpoints) {
      throw new ValidationError(
        "Cannot access `instanceEndpoints` of an imported cluster without instanceEndpointAddresses and port",
        this,
      );
    }
    return this._instanceEndpoints;
  }
}

/**
 * Properties for a new database cluster
 */
export interface DatabaseClusterProps extends DatabaseClusterBaseProps {
  /**
   * Credentials for the administrative user
   *
   * @default - A username of 'admin' (or 'postgres' for PostgreSQL) and SecretsManager-generated password
   */
  readonly credentials?: Credentials;

  /**
   * The Amazon Resource Name (ARN) of the source DB instance or DB cluster if this DB cluster is created as a read replica.
   * Cannot be used with credentials.
   *
   * @default - This DB Cluster is not a read replica
   */
  readonly replicationSourceIdentifier?: string;

  /**
   * Whether to use RDS native integration with AWS Secrets Manager for master user password management.
   *
   * When enabled, RDS generates and manages the master user password in Secrets Manager.
   * Cannot be used together with credentials containing a password.
   *
   * @default false
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html
   */
  readonly manageMasterUserPassword?: boolean;
}

/**
 * Create a clustered database with a given number of instances.
 *
 * @resource aws_rds_cluster
 */
export class DatabaseCluster extends DatabaseClusterNew {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.DatabaseCluster";

  /**
   * Lookup an existing DatabaseCluster using clusterIdentifier.
   */
  public static fromLookup(
    scope: Construct,
    _id: string,
    _options: DatabaseClusterLookupOptions,
  ): IDatabaseCluster {
    // TODO: omitted — upstream implements this via `ContextProvider.getValue(scope, { provider:
    // cxschema.ContextProvider.CC_API_PROVIDER, ... })`, a CDK-CLI-side "cdk synth" context lookup
    // against the CloudControl API. CDKTF/TerraConstructs has no equivalent synth-time
    // context-provider/lookup-cache mechanism (see the identical omission on
    // `DatabaseInstanceBase.fromLookup` in `./instance.ts`), so this cannot be ported —
    // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster.ts#L1419-L1477
    throw new ValidationError(
      "DatabaseCluster.fromLookup() is not supported in TerraConstructs (it depends on the CDK CLI's context-provider lookup mechanism, which has no CDKTF equivalent). Use `fromDatabaseClusterAttributes()` with explicitly known attributes instead.",
      scope,
    );
  }

  /**
   * Import an existing DatabaseCluster from properties
   */
  public static fromDatabaseClusterAttributes(
    scope: Construct,
    id: string,
    attrs: DatabaseClusterAttributes,
  ): IDatabaseCluster {
    return new ImportedDatabaseCluster(scope, id, attrs);
  }

  public readonly clusterIdentifier: string;
  public readonly clusterResourceIdentifier: string;
  public readonly clusterEndpoint: Endpoint;
  public readonly clusterReadEndpoint: Endpoint;
  public readonly connections: ec2.Connections;
  public readonly instanceIdentifiers: string[];
  public readonly instanceEndpoints: Endpoint[];

  /**
   * The secret attached to this cluster
   */
  public readonly secret?: secretsmanager.ISecret;

  /**
   * The underlying `aws_rds_cluster` L1. NOTE: this construct owns `lifecycle.ignore_changes` on
   * it (see the `ignore_changes`/password-drift note in the constructor) -- code calling
   * `resource.addOverride("lifecycle.ignore_changes", ...)` directly will REPLACE that list rather
   * than merge with it.
   */
  public readonly resource: rdsCluster.RdsCluster;

  constructor(scope: Construct, id: string, props: DatabaseClusterProps) {
    super(scope, id, props);

    // Validate manageMasterUserPassword conflicts with unsupported credential properties
    if (props.manageMasterUserPassword) {
      validateManagedPasswordCredentials(this, props.credentials);
    }

    const canHaveCredentials = props.replicationSourceIdentifier === undefined;

    // A read replica inherits the master credentials from its source cluster, so RDS does not
    // manage a master user secret for it. Reject the contradictory combination up front instead
    // of silently dropping `manageMasterUserPassword` from the resource.
    if (props.manageMasterUserPassword && !canHaveCredentials) {
      throw new ValidationError(
        "cannot use `manageMasterUserPassword` with `replicationSourceIdentifier`; read replicas inherit credentials from the source cluster",
        this,
      );
    }

    this.manageMasterUserPassword = props.manageMasterUserPassword;

    // Prepare credential-specific configuration
    let secret: secretsmanager.ISecret | undefined;
    let masterUsername: string | undefined;
    let masterUserPassword: string | undefined;
    let manageMasterUserPassword: boolean | undefined;
    let masterUserSecretKmsKeyId: string | undefined;

    if (props.manageMasterUserPassword) {
      // RDS-managed approach: RDS creates and manages the Secret automatically.
      // `canHaveCredentials` is always true here because the read-replica combination is rejected above.
      masterUsername =
        props.credentials?.username ?? props.engine.defaultUsername ?? "admin";
      manageMasterUserPassword = props.manageMasterUserPassword;
      masterUserSecretKmsKeyId = props.credentials?.encryptionKey?.keyArn;
    } else {
      // Standard approach: CDK creates and manages the Secret via DatabaseSecret
      const rendered = renderClusterCredentials(
        this,
        props.engine,
        props.credentials,
      );
      secret = rendered.secret;
      masterUsername = canHaveCredentials ? rendered.username : undefined;
      masterUserPassword = canHaveCredentials ? rendered.password : undefined;
    }

    // Create the cluster with the prepared configuration
    const cluster = new rdsCluster.RdsCluster(this, "Resource", {
      ...this.newClusterProps,
      masterUsername,
      masterPassword: masterUserPassword,
      manageMasterUserPassword,
      masterUserSecretKmsKeyId,
      replicationSourceIdentifier: props.replicationSourceIdentifier,
    } as rdsCluster.RdsClusterConfig);

    this.resource = cluster;
    this.clusterIdentifier = cluster.clusterIdentifier;
    this.clusterResourceIdentifier = cluster.clusterResourceId;

    // TERRACONSTRUCTS DEVIATION: mirrors the identical `ignore_changes` note on `DatabaseInstance`
    // in `./instance.ts` -- `secret` is only set here when a new `DatabaseSecret` was just generated
    // for us (see `renderClusterCredentials`), in which case `masterUserPassword` above is the SAME
    // regenerating-on-every-plan `aws_secretsmanager_random_password` token stored in that secret.
    // Without `ignore_changes`, every apply after the first would drift and REPLACE the live master
    // password.
    const ignoreChanges: string[] = [];
    if (secret) {
      ignoreChanges.push("master_password");
    }
    if (ignoreChanges.length > 0) {
      cluster.addOverride("lifecycle.ignore_changes", ignoreChanges);
    }

    // NOTE: must be set before `secret.attach(this)` below -- `attach()` calls
    // `asSecretAttachmentTarget()` synchronously, which reads `this.clusterEndpoint`.
    this.clusterEndpoint = new Endpoint(cluster.endpoint, cluster.port);
    this.clusterReadEndpoint = new Endpoint(
      cluster.readerEndpoint,
      cluster.port,
    );
    this.connections = new ec2.Connections({
      securityGroups: this.securityGroups,
      defaultPort: ec2.Port.tcp(this.clusterEndpoint.port),
    });

    // Set up the secret reference
    if (props.manageMasterUserPassword) {
      this.secret = secretsmanager.Secret.fromSecretAttributes(
        this,
        "ManagedSecret",
        {
          secretCompleteArn: cluster.masterUserSecret.get(0).secretArn,
          encryptionKey: props.credentials?.encryptionKey,
        },
      );
    } else if (secret) {
      this.secret = secret.attach(this);
    }

    validateCloudwatchLogsExports(this, props);
    this.createClusterRoleAssociations(this.clusterIdentifier);

    // create the instances for only standard aurora clusters
    if (
      props.clusterScalabilityType !== ClusterScalabilityType.LIMITLESS &&
      props.clusterScailabilityType !== ClusterScailabilityType.LIMITLESS
    ) {
      if (
        (props.writer || props.readers) &&
        (props.instances || props.instanceProps)
      ) {
        throw new ValidationError(
          "Cannot provide writer or readers if instances or instanceProps are provided",
          this,
        );
      }

      if (!props.instanceProps && !props.writer) {
        throw new ValidationError("writer must be provided", this);
      }

      const createdInstances = props.writer
        ? this._createInstances(props)
        : legacyCreateInstances(this, props, this.subnetGroup);
      this.instanceIdentifiers = createdInstances.instanceIdentifiers;
      this.instanceEndpoints = createdInstances.instanceEndpoints;
    } else {
      // Limitless database does not have instances,
      // but an empty array will be assigned to avoid destructive changes.
      this.instanceIdentifiers = [];
      this.instanceEndpoints = [];
    }

    this.applyServerlessV2ScalingConfigurationOverride(cluster);
  }

  public get outputs(): Record<string, any> {
    return {
      ...super.outputs,
      ...(this.secret && { secretArn: this.secret.secretArn }),
    };
  }
}

/**
 * Mapping of instance type to memory setting on the xlarge size
 * The memory is predictable based on the xlarge size. For example
 * if m5.xlarge has 16GB memory then
 *   - m5.2xlarge will have 32 (16*2)
 *   - m5.4xlarge will have 62 (16*4)
 *   - m5.24xlarge will have 384 (16*24)
 */
const INSTANCE_TYPE_XLARGE_MEMORY_MAPPING: { [instanceType: string]: number } =
  {
    m5: 16,
    m5d: 16,
    m6g: 16,
    t4g: 16,
    t3: 16,
    m4: 16,
    r6g: 32,
    r5: 32,
    r5b: 32,
    r5d: 32,
    r4: 30.5,
    x2g: 64,
    x1e: 122,
    x1: 61,
    z1d: 32,
  };

/**
 * This validates that the instance size falls within the maximum configured serverless capacity.
 *
 * @param instanceSize the instance size of the provisioned writer, e.g. r5.xlarge
 * @param serverlessV2MaxCapacity the maxCapacity configured on the cluster
 * @returns true if the instance size is supported by serverless v2 instances
 */
function instanceSizeSupportedByServerlessV2(
  instanceSize: string,
  serverlessV2MaxCapacity: number,
): boolean {
  const serverlessMaxMem = serverlessV2MaxCapacity * 2;
  // i.e. r5.xlarge
  const sizeParts = instanceSize.split(".");
  if (sizeParts.length === 2) {
    const type = sizeParts[0];
    const size = sizeParts[1];
    const xlargeMem = INSTANCE_TYPE_XLARGE_MEMORY_MAPPING[type];
    if (size.endsWith("xlarge")) {
      const instanceMem =
        size === "xlarge" ? xlargeMem : Number(size.slice(0, -6)) * xlargeMem;
      if (instanceMem > serverlessMaxMem) {
        return false;
      }
      // smaller than xlarge
    } else {
      return true;
    }
  } else {
    // some weird non-standard instance types
    // not sure how to add automation around this so for now
    // just handling as one offs
    const unSupportedSizes = [
      "db.r5.2xlarge.tpc2.mem8x",
      "db.r5.4xlarge.tpc2.mem3x",
      "db.r5.4xlarge.tpc2.mem4x",
      "db.r5.6xlarge.tpc2.mem4x",
      "db.r5.8xlarge.tpc2.mem3x",
      "db.r5.12xlarge.tpc2.mem2x",
    ];
    if (unSupportedSizes.includes(instanceSize)) {
      return false;
    }
  }
  return true;
}

/**
 * Properties for ``DatabaseClusterFromSnapshot``
 */
export interface DatabaseClusterFromSnapshotProps
  extends DatabaseClusterBaseProps {
  /**
   * The identifier for the DB instance snapshot or DB cluster snapshot to restore from.
   * You can use either the name or the Amazon Resource Name (ARN) to specify a DB cluster snapshot.
   * However, you can use only the ARN to specify a DB instance snapshot.
   */
  readonly snapshotIdentifier: string;

  /**
   * Credentials for the administrative user
   *
   * TERRACONSTRUCTS DEVIATION: unlike upstream (which still renders this into an orphan
   * `DatabaseSecret` depending on a feature flag — see `snapshotCredentials` below), this
   * deprecated prop is NEVER rendered here: this port always behaves as if upstream's
   * `RDS_PREVENT_RENDERING_DEPRECATED_CREDENTIALS` feature flag is enabled (there is no legacy CDK
   * app here to preserve backward-compatible, but confusing, orphan-secret behavior for — see the
   * identical always-corrected-behavior stance taken throughout this module, e.g.
   * `RDS_LOWERCASE_DB_IDENTIFIER` on `DatabaseClusterNew`). Use `snapshotCredentials` instead.
   *
   * @deprecated use `snapshotCredentials` which allows to generate a new password
   */
  readonly credentials?: Credentials;

  /**
   * Master user credentials.
   *
   * Note - It is not possible to change the master username for a snapshot;
   * however, it is possible to provide (or generate) a new password.
   *
   * @default - The existing username and password from the snapshot will be used.
   */
  readonly snapshotCredentials?: SnapshotCredentials;

  /**
   * Whether to use RDS native integration with AWS Secrets Manager for master user password management.
   *
   * When enabled, RDS generates and manages the master user password in Secrets Manager.
   * This is supported when restoring from snapshots, allowing migration to RDS-managed passwords.
   *
   * @default false
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html
   */
  readonly manageMasterUserPassword?: boolean;
}

/**
 * A database cluster restored from a snapshot.
 *
 * @resource aws_rds_cluster
 */
export class DatabaseClusterFromSnapshot extends DatabaseClusterNew {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.DatabaseClusterFromSnapshot";

  public readonly clusterIdentifier: string;
  public readonly clusterResourceIdentifier: string;
  public readonly clusterEndpoint: Endpoint;
  public readonly clusterReadEndpoint: Endpoint;
  public readonly connections: ec2.Connections;
  public readonly instanceIdentifiers: string[];
  public readonly instanceEndpoints: Endpoint[];

  /**
   * The secret attached to this cluster
   */
  public readonly secret?: secretsmanager.ISecret;

  /**
   * The underlying `aws_rds_cluster` L1. NOTE: see the identical `ignore_changes` ownership note
   * on `DatabaseCluster.resource` above.
   */
  public readonly resource: rdsCluster.RdsCluster;

  constructor(
    scope: Construct,
    id: string,
    props: DatabaseClusterFromSnapshotProps,
  ) {
    super(scope, id, props);

    if (
      props.credentials &&
      !props.credentials.password &&
      !props.credentials.secret
    ) {
      Annotations.of(this).addWarning(
        "Use `snapshotCredentials` to modify password of a cluster created from a snapshot.",
      );
    }
    if (!props.credentials && !props.snapshotCredentials) {
      Annotations.of(this).addWarning(
        "Generated credentials will not be applied to cluster. Use `snapshotCredentials` instead. `addRotationSingleUser()` and `addRotationMultiUser()` cannot be used on this cluster.",
      );
    }

    // Validate manageMasterUserPassword conflicts with unsupported snapshotCredentials properties
    if (props.manageMasterUserPassword) {
      validateManagedPasswordSnapshotCredentials(
        this,
        props.snapshotCredentials,
      );
    }

    this.manageMasterUserPassword = props.manageMasterUserPassword;

    // TERRACONSTRUCTS DEVIATION: see the deviation note on
    // `DatabaseClusterFromSnapshotProps.credentials` above -- the deprecated `credentials` prop is
    // never rendered into an (orphan, unattached) `DatabaseSecret` here, unlike upstream.
    const credentials = props.manageMasterUserPassword
      ? undefined
      : renderClusterSnapshotCredentials(this, props.snapshotCredentials);

    const cluster = new rdsCluster.RdsCluster(this, "Resource", {
      ...this.newClusterProps,
      snapshotIdentifier: props.snapshotIdentifier,
      masterPassword: props.manageMasterUserPassword
        ? undefined
        : credentials?.password,
      manageMasterUserPassword: props.manageMasterUserPassword || undefined,
      masterUserSecretKmsKeyId:
        props.manageMasterUserPassword &&
        props.snapshotCredentials?.encryptionKey
          ? props.snapshotCredentials.encryptionKey.keyArn
          : undefined,
    } as rdsCluster.RdsClusterConfig);

    this.resource = cluster;
    this.clusterIdentifier = cluster.clusterIdentifier;
    this.clusterResourceIdentifier = cluster.clusterResourceId;

    const ignoreChanges: string[] = [];
    if (credentials?.secret) {
      ignoreChanges.push("master_password");
    }
    if (ignoreChanges.length > 0) {
      cluster.addOverride("lifecycle.ignore_changes", ignoreChanges);
    }

    // NOTE: must be set before `credentials.secret.attach(this)` below -- `attach()` calls
    // `asSecretAttachmentTarget()` synchronously, which reads `this.clusterEndpoint`.
    this.clusterEndpoint = new Endpoint(cluster.endpoint, cluster.port);
    this.clusterReadEndpoint = new Endpoint(
      cluster.readerEndpoint,
      cluster.port,
    );
    this.connections = new ec2.Connections({
      securityGroups: this.securityGroups,
      defaultPort: ec2.Port.tcp(this.clusterEndpoint.port),
    });

    if (props.manageMasterUserPassword) {
      this.secret = secretsmanager.Secret.fromSecretAttributes(
        this,
        "ManagedSecret",
        {
          secretCompleteArn: cluster.masterUserSecret.get(0).secretArn,
          encryptionKey: props.snapshotCredentials?.encryptionKey,
        },
      );
    } else if (credentials?.secret) {
      this.secret = credentials.secret.attach(this);
    }

    validateCloudwatchLogsExports(this, props);
    this.createClusterRoleAssociations(this.clusterIdentifier);

    if (
      (props.writer || props.readers) &&
      (props.instances || props.instanceProps)
    ) {
      throw new ValidationError(
        "Cannot provide clusterInstances if instances or instanceProps are provided",
        this,
      );
    }
    const createdInstances = props.writer
      ? this._createInstances(props)
      : legacyCreateInstances(this, props, this.subnetGroup);
    this.instanceIdentifiers = createdInstances.instanceIdentifiers;
    this.instanceEndpoints = createdInstances.instanceEndpoints;

    this.applyServerlessV2ScalingConfigurationOverride(cluster);
  }

  public get outputs(): Record<string, any> {
    return {
      ...super.outputs,
      ...(this.secret && { secretArn: this.secret.secretArn }),
    };
  }
}

/**
 * Validates that the requested `cloudwatchLogsExports` are supported by the engine.
 *
 * TERRACONSTRUCTS DEVIATION: replaces upstream's `setLogRetention`, which ALSO creates a
 * Lambda-backed `logs.LogRetention` custom resource per exported log (see the TODO on
 * `DatabaseClusterBaseProps.cloudwatchLogsRetention` above for why that part isn't portable). Only
 * the (fully portable) log-type validation survives here; `cluster.cloudwatchLogGroups` is dropped
 * entirely for the same reason (mirrors the identical omission in `./instance.ts`).
 */
function validateCloudwatchLogsExports(
  cluster: DatabaseClusterNew,
  props: DatabaseClusterBaseProps,
) {
  if (props.cloudwatchLogsExports) {
    const unsupportedLogTypes = props.cloudwatchLogsExports.filter(
      (logType) => !props.engine.supportedLogTypes.includes(logType),
    );
    if (unsupportedLogTypes.length > 0) {
      throw new ValidationError(
        `Unsupported logs for the current engine type: ${unsupportedLogTypes.join(",")}`,
        cluster,
      );
    }
  }
}

/** Output from the createInstances method; used to set instance identifiers and endpoints */
interface InstanceConfig {
  readonly instanceIdentifiers: string[];
  readonly instanceEndpoints: Endpoint[];
}

/**
 * Creates the instances for the cluster.
 * A function rather than a protected method on ``DatabaseClusterNew`` to avoid exposing
 * ``DatabaseClusterNew`` and ``DatabaseClusterBaseProps`` in the API.
 *
 * TERRACONSTRUCTS DEVIATION: creates `aws_rds_cluster_instance` resources (via
 * `rdsClusterInstance.RdsClusterInstance`) rather than upstream's `CfnDBInstance` — the Terraform
 * AWS provider models cluster members with a dedicated resource type distinct from standalone
 * `aws_db_instance` (see `node_modules/@cdktn/provider-aws/lib/rds-cluster-instance/index.d.ts`).
 */
function legacyCreateInstances(
  cluster: DatabaseClusterNew,
  props: DatabaseClusterBaseProps,
  subnetGroup: ISubnetGroup,
): InstanceConfig {
  const instanceCount = props.instances != null ? props.instances : 2;
  const instanceUpdateBehaviour =
    props.instanceUpdateBehaviour ?? InstanceUpdateBehaviour.BULK;
  if (Token.isUnresolved(instanceCount)) {
    throw new ValidationError(
      "The number of instances an RDS Cluster consists of cannot be provided as a deploy-time only value!",
      cluster,
    );
  }
  if (instanceCount < 1) {
    throw new ValidationError("At least one instance is required", cluster);
  }

  const instanceIdentifiers: string[] = [];
  const instanceEndpoints: Endpoint[] = [];
  const portAttribute = cluster.clusterEndpoint.port;
  const instanceProps = props.instanceProps!;

  // Get the actual subnet objects so we can depend on internet connectivity.
  const internetConnected = instanceProps.vpc.selectSubnets(
    instanceProps.vpcSubnets,
  ).internetConnectivityEstablished;

  const enablePerformanceInsights =
    instanceProps.enablePerformanceInsights ||
    instanceProps.performanceInsightRetention !== undefined ||
    instanceProps.performanceInsightEncryptionKey !== undefined;
  if (
    enablePerformanceInsights &&
    instanceProps.enablePerformanceInsights === false
  ) {
    throw new ValidationError(
      "`enablePerformanceInsights` disabled, but `performanceInsightRetention` or `performanceInsightEncryptionKey` was set",
      cluster,
    );
  }
  const performanceInsightRetention = enablePerformanceInsights
    ? instanceProps.performanceInsightRetention ||
      PerformanceInsightRetention.DEFAULT
    : undefined;
  validatePerformanceInsightsSettings(cluster, {
    performanceInsightsEnabled: enablePerformanceInsights,
    performanceInsightRetention,
    performanceInsightEncryptionKey:
      instanceProps.performanceInsightEncryptionKey,
  });

  const instanceType =
    instanceProps.instanceType ??
    ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM);

  if (instanceProps.parameterGroup && instanceProps.parameters) {
    throw new ValidationError(
      "You cannot specify both parameterGroup and parameters",
      cluster,
    );
  }

  const instanceParameterGroup =
    instanceProps.parameterGroup ??
    (instanceProps.parameters
      ? new ParameterGroup(cluster, "InstanceParameterGroup", {
          engine: props.engine,
          parameters: instanceProps.parameters,
        })
      : undefined);
  const instanceParameterGroupConfig = instanceParameterGroup?.bindToInstance(
    {},
  );

  const instances: rdsClusterInstance.RdsClusterInstance[] = [];

  for (let i = 0; i < instanceCount; i++) {
    const instanceIndex = i + 1;
    const instanceIdentifierBase =
      props.instanceIdentifierBase != null
        ? `${props.instanceIdentifierBase}${instanceIndex}`
        : props.clusterIdentifier != null
          ? `${props.clusterIdentifier}instance${instanceIndex}`
          : undefined;
    // TERRACONSTRUCTS DEVIATION: upstream lets CloudFormation auto-generate a name from each
    // instance's per-index logical id (`Instance1`, `Instance2`, ...) when neither
    // `instanceIdentifierBase` nor `clusterIdentifier` is provided. This loop creates all instances
    // under the SAME shared `cluster` scope, so a single `uniqueResourceName(cluster, ...)` call
    // (the idiom used everywhere else in this module for a single unnamed resource) would collide
    // across iterations. Rather than fabricate a synth-time-derived per-index name, `identifier` is
    // simply left unset in that case and the `aws_rds_cluster_instance` resource's own provider-side
    // auto-naming applies instead.
    const instanceIdentifier =
      instanceIdentifierBase === undefined
        ? undefined
        : Token.isUnresolved(instanceIdentifierBase)
          ? instanceIdentifierBase
          : instanceIdentifierBase.toLowerCase();

    const instance = new rdsClusterInstance.RdsClusterInstance(
      cluster,
      `Instance${instanceIndex}`,
      {
        // Link to cluster
        engine: props.engine.engineType,
        clusterIdentifier: cluster.clusterIdentifier,
        identifier: instanceIdentifier,
        // Instance properties
        instanceClass: databaseInstanceType(instanceType),
        publiclyAccessible:
          instanceProps.publiclyAccessible ??
          (instanceProps.vpcSubnets &&
            instanceProps.vpcSubnets.subnetType === ec2.SubnetType.PUBLIC),
        performanceInsightsEnabled:
          enablePerformanceInsights || instanceProps.enablePerformanceInsights, // fall back to undefined if not set
        performanceInsightsKmsKeyId:
          instanceProps.performanceInsightEncryptionKey?.keyArn,
        performanceInsightsRetentionPeriod: performanceInsightRetention,
        // This is already set on the Cluster. Unclear whether it should be repeated or not. Better yes.
        dbSubnetGroupName: subnetGroup.subnetGroupName,
        dbParameterGroupName: instanceParameterGroupConfig?.parameterGroupName,
        // When `enableClusterLevelEnhancedMonitoring` is enabled,
        // both `monitoringInterval` and `monitoringRole` are set at cluster level so no need to re-set it in instance level.
        monitoringInterval: props.enableClusterLevelEnhancedMonitoring
          ? undefined
          : props.monitoringInterval?.toSeconds(),
        monitoringRoleArn: props.enableClusterLevelEnhancedMonitoring
          ? undefined
          : cluster.monitoringRole?.roleArn,
        autoMinorVersionUpgrade: instanceProps.autoMinorVersionUpgrade,
        preferredMaintenanceWindow: instanceProps.preferredMaintenanceWindow,
        // TODO: omitted — upstream also sets `allowMajorVersionUpgrade:
        // instanceProps.allowMajorVersionUpgrade` and `deleteAutomatedBackups:
        // instanceProps.deleteAutomatedBackups` here. The Terraform `aws_rds_cluster_instance`
        // resource exposes NEITHER argument (verified against the full config shape in
        // `node_modules/@cdktn/provider-aws/lib/rds-cluster-instance/index.d.ts`) — matching the
        // identical omission on `ClusterInstanceOptions.allowMajorVersionUpgrade` in
        // `./aurora-cluster-instance.ts` —
        // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster.ts#L1940-L1941
      } as rdsClusterInstance.RdsClusterInstanceConfig,
    );

    // We must have a dependency on the NAT gateway provider here to create
    // things in the right order.
    instance.node.addDependency(internetConnected);

    instanceIdentifiers.push(instance.identifier);
    instanceEndpoints.push(new Endpoint(instance.endpoint, portAttribute));
    instances.push(instance);
  }

  // Adding dependencies here to ensure that the instances are updated one after the other.
  if (instanceUpdateBehaviour === InstanceUpdateBehaviour.ROLLING) {
    for (let i = 1; i < instanceCount; i++) {
      instances[i].node.addDependency(instances[i - 1]);
    }
  }

  return { instanceEndpoints, instanceIdentifiers };
}

/**
 * Turn a regular instance type into a database instance type
 */
function databaseInstanceType(instanceType: ec2.InstanceType) {
  return "db." + instanceType.toString();
}

/**
 * Validate Performance Insights settings
 */
function validatePerformanceInsightsSettings(
  cluster: DatabaseClusterNew,
  instance: {
    nodeId?: string;
    performanceInsightsEnabled?: boolean;
    performanceInsightRetention?: PerformanceInsightRetention;
    performanceInsightEncryptionKey?: encryption.IKey;
  },
): void {
  const target = instance.nodeId
    ? `instance '${instance.nodeId}'`
    : "`instanceProps`";

  // If Performance Insights is enabled on the cluster, the one for each instance will be enabled as well.
  if (
    cluster.performanceInsightsEnabled &&
    instance.performanceInsightsEnabled === false
  ) {
    Annotations.of(cluster).addWarning(
      `Performance Insights is enabled on cluster '${cluster.node.id}' at cluster level, but disabled for ${target}. ` +
        "However, Performance Insights for this instance will also be automatically enabled if enabled at cluster level.",
    );
  }

  // If `performanceInsightRetention` is enabled on the cluster, the same parameter for each instance must be
  // undefined or the same as the value at cluster level.
  if (
    cluster.performanceInsightRetention &&
    instance.performanceInsightRetention &&
    instance.performanceInsightRetention !== cluster.performanceInsightRetention
  ) {
    throw new ValidationError(
      `\`performanceInsightRetention\` for each instance must be the same as the one at cluster level, got ${target}: ${instance.performanceInsightRetention}, cluster: ${cluster.performanceInsightRetention}`,
      cluster,
    );
  }

  // If `performanceInsightEncryptionKey` is enabled on the cluster, the same parameter for each instance must be
  // undefined or the same as the value at cluster level.
  //
  // TERRACONSTRUCTS DEVIATION: upstream uses `Token.compareStrings`/`TokenComparison` (a
  // `core`-internal comparison helper that additionally understands "both sides are the same
  // unresolved token") to compare the two KMS key ARNs. `cdktn`'s `Token` has no equivalent, so a
  // plain string `!==` comparison is used instead -- this is stricter than upstream only for the
  // (rare) case of two *different* unresolved tokens that would resolve to the same ARN, which
  // isn't distinguishable without `TokenComparison`.
  if (
    cluster.performanceInsightEncryptionKey &&
    instance.performanceInsightEncryptionKey &&
    cluster.performanceInsightEncryptionKey.keyArn !==
      instance.performanceInsightEncryptionKey.keyArn
  ) {
    throw new ValidationError(
      `\`performanceInsightEncryptionKey\` for each instance must be the same as the one at cluster level, got ${target}: '${instance.performanceInsightEncryptionKey.keyArn}', cluster: '${cluster.performanceInsightEncryptionKey.keyArn}'`,
      cluster,
    );
  }
}

/**
 * TERRACONSTRUCTS DEVIATION: replaces upstream's `renderCredentials` (`./private/util.ts`), which
 * is commented out there because it depends on `Credentials.fromSecret` (itself commented out in
 * `./props.ts` — needs `ISecret.secretValueFromJson`, not portable). This local equivalent produces
 * the same three pieces of information (username / password token / owned secret) directly, using
 * `Secret._generatedPassword` — mirrors `renderInstanceCredentials` in `./instance.ts`.
 */
function renderClusterCredentials(
  scope: Construct,
  engine: IClusterEngine,
  credentials?: Credentials,
): {
  username: string;
  password?: string;
  secret?: secretsmanager.ISecret;
} {
  const rendered =
    credentials ?? Credentials.fromUsername(engine.defaultUsername ?? "admin");

  if (rendered.secret) {
    // TERRACONSTRUCTS DEVIATION: see the identical note in `renderInstanceCredentials` in
    // `./instance.ts` — `Credentials.fromSecret()` is not available in this repo.
    throw new ValidationError(
      "Credentials with an existing `secret` are not supported in TerraConstructs (depends on ISecret.secretValueFromJson, not ported). Use Credentials.fromPassword(), Credentials.fromUsername(), or leave `credentials` unset to auto-generate a DatabaseSecret.",
      scope,
    );
  }

  if (rendered.password) {
    return { username: rendered.username, password: rendered.password };
  }

  const secret = new DatabaseSecret(scope, "Secret", {
    username: rendered.username,
    secretName: rendered.secretName,
    encryptionKey: rendered.encryptionKey,
    excludeCharacters: rendered.excludeCharacters,
    replaceOnPasswordCriteriaChanges: credentials?.usernameAsString,
    replicaRegions: rendered.replicaRegions,
  });

  return {
    username: rendered.username,
    password: secret._generatedPassword,
    secret,
  };
}

/**
 * TERRACONSTRUCTS DEVIATION: replaces upstream's `renderSnapshotCredentials`
 * (`./private/util.ts`), commented out there for the identical reason as `renderCredentials` above
 * (depends on `SnapshotCredentials.fromSecret`, not portable) — mirrors the inline snapshot-secret
 * handling in `DatabaseInstanceFromSnapshot`'s constructor in `./instance.ts`.
 */
function renderClusterSnapshotCredentials(
  scope: Construct,
  credentials?: SnapshotCredentials,
):
  | {
      username?: string;
      password?: string;
      secret?: secretsmanager.ISecret;
    }
  | undefined {
  if (!credentials) {
    return undefined;
  }

  if (credentials.secret) {
    // TERRACONSTRUCTS DEVIATION: see `renderClusterCredentials` above — an existing,
    // caller-supplied secret's password cannot be read back out portably
    // (`secretValueFromJson` not ported).
    throw new ValidationError(
      "SnapshotCredentials with an existing `secret` are not supported in TerraConstructs (depends on ISecret.secretValueFromJson, not ported). Use SnapshotCredentials.fromPassword(), SnapshotCredentials.fromGeneratedSecret()/fromGeneratedPassword(), or leave `snapshotCredentials` unset to keep the snapshot's existing password.",
      scope,
    );
  }

  if (credentials.generatePassword) {
    if (!credentials.username) {
      throw new ValidationError(
        "`snapshotCredentials` `username` must be specified when `generatePassword` is set to true",
        scope,
      );
    }

    const secret = new DatabaseSecret(scope, "SnapshotSecret", {
      username: credentials.username,
      encryptionKey: credentials.encryptionKey,
      excludeCharacters: credentials.excludeCharacters,
      replaceOnPasswordCriteriaChanges:
        credentials.replaceOnPasswordCriteriaChanges,
      replicaRegions: credentials.replicaRegions,
    });

    return {
      username: credentials.username,
      password: secret._generatedPassword,
      secret,
    };
  }

  return { username: credentials.username, password: credentials.password };
}
