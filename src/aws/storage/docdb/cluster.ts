// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/cluster.ts

import {
  docdbCluster,
  docdbClusterInstance,
  docdbSubnetGroup,
} from "@cdktn/provider-aws";
import { Annotations, Token, Tokenization } from "cdktn";
import { Construct } from "constructs";
import type {
  DatabaseClusterAttributes,
  IDatabaseCluster,
} from "./cluster-ref";
import { DatabaseSecret } from "./database-secret";
import { Endpoint } from "./endpoint";
import type { IClusterParameterGroup } from "./parameter-group";
import type { BackupProps, Login, RotationMultiUserOptions } from "./props";
import type { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";
import * as ec2 from "../../compute";
import * as secretsmanager from "../../encryption";
import type * as encryption from "../../encryption";
import { CaCertificate } from "../rds";

const MIN_ENGINE_VERSION_FOR_IO_OPTIMIZED_STORAGE = 5;
const MIN_ENGINE_VERSION_FOR_SERVERLESS = 5;

/**
 * Matches the DocumentDB maintenance window format `ddd:hh24:mi-ddd:hh24:mi`
 * Days: mon | tue | wed | thu | fri | sat | sun (case-insensitive).
 * Time: 00-23 hour, 00-59 minute.
 *
 * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/db-instance-maintain.html#maintenance-window
 */
const MAINTENANCE_WINDOW_REGEX =
  /^(mon|tue|wed|thu|fri|sat|sun):(2[0-3]|[01]\d):[0-5]\d-(mon|tue|wed|thu|fri|sat|sun):(2[0-3]|[01]\d):[0-5]\d$/i;

/**
 * Matches a `x.y.z` DocumentDB engine version.
 */
const VALID_ENGINE_VERSION_REGEX =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/**
 * ServerlessV2 scaling configuration for DocumentDB clusters
 */
export interface ServerlessV2ScalingConfiguration {
  /**
   * The minimum number of DocumentDB capacity units (DCUs) for a DocumentDB instance in a DocumentDB Serverless cluster.
   */
  readonly minCapacity: number;

  /**
   * The maximum number of DocumentDB capacity units (DCUs) for a DocumentDB instance in a DocumentDB Serverless cluster.
   */
  readonly maxCapacity: number;
}

/**
 * The storage type of the DocDB cluster
 */
export enum StorageType {
  /**
   * Standard storage
   */
  STANDARD = "standard",

  /**
   * I/O-optimized storage
   */
  IOPT1 = "iopt1",
}

/**
 * Properties for a new database cluster
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `DatabaseClusterProps` does not — matching the base-idiom used throughout this
 * repo (e.g. `DatabaseClusterProps` in `../rds/cluster.ts`) for cross-account/-region construct
 * placement.
 */
export interface DatabaseClusterProps extends AwsConstructProps {
  /**
   * What version of the database to start
   *
   * @default -  the latest major version
   */
  readonly engineVersion?: string;

  /**
   * The port the DocumentDB cluster will listen on
   *
   * @default DatabaseCluster.DEFAULT_PORT
   */
  readonly port?: number;

  /**
   * Username and password for the administrative user
   */
  readonly masterUser: Login;

  // NOTE: `aws_docdb_cluster` also exposes `manage_master_user_password` /
  // `master_user_secret_kms_key_id` (AWS-managed master passwords). The rds sibling
  // (`../rds/cluster.ts`) surfaces these as a TERRACONSTRUCTS-native extension; that extension
  // is deliberately NOT carried over to docdb in this slice (upstream aws-docdb has no such
  // prop, and the Login-based path is the upstream-faithful surface). Follow-up candidate if
  // DocDB users ask for RDS-managed rotation.

  /**
   * Backup settings
   *
   * @default - Backup retention period for automated backups is 1 day.
   * Backup preferred window is set to a 30-minute window selected at random from an
   * 8-hour block of time for each AWS Region, occurring on a random day of the week.
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/backup-restore.db-cluster-snapshots.html#backup-restore.backup-window
   */
  readonly backup?: BackupProps;

  /**
   * The KMS key for storage encryption.
   *
   * @default - default master key.
   */
  readonly kmsKey?: encryption.IKey;

  /**
   * Whether to enable storage encryption
   *
   * @default true
   */
  readonly storageEncrypted?: boolean;

  /**
   * An optional identifier for the cluster
   *
   * If you specify a name, it is lowercased at synth: DocumentDB stores DB
   * identifiers lowercase server-side, and emitting the original casing would
   * report a perpetual Terraform diff.
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly dbClusterName?: string;

  /**
   * Base identifier for instances
   *
   * Every replica is named by appending the replica number to this string, 1-based.
   * Only applicable for provisioned clusters.
   *
   * If you specify a base, it is lowercased at synth (DocumentDB stores DB
   * identifiers lowercase server-side; see `dbClusterName`).
   *
   * @default - `dbClusterName` is used with the word "Instance" appended. If `dbClusterName` is not provided, the
   * identifier is automatically generated.
   */
  readonly instanceIdentifierBase?: string;

  /**
   * What type of instance to start for the replicas.
   * Required for provisioned clusters, not applicable for serverless clusters.
   *
   * @default None
   */
  readonly instanceType?: ec2.InstanceType;

  /**
   * Number of DocDB compute instances
   * @default 1
   */
  readonly instances?: number;

  /**
   * ServerlessV2 scaling configuration.
   * When specified, the cluster will be created as a serverless cluster.
   *
   * @default None
   */
  readonly serverlessV2ScalingConfiguration?: ServerlessV2ScalingConfiguration;

  /**
   * The identifier of the CA certificate used for the instances.
   *
   * Specifying or updating this property triggers a reboot.
   *
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/ca_cert_rotation.html
   *
   * @default - DocumentDB will choose a certificate authority
   */
  readonly caCertificate?: CaCertificate;

  /**
   * What subnets to run the DocumentDB instances in.
   *
   * Must be at least 2 subnets in two different AZs.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Where to place the instances within the VPC
   *
   * @default private subnets
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Security group.
   *
   * @default a new security group is created.
   */
  readonly securityGroup?: ec2.ISecurityGroup;

  /**
   * The DB parameter group to associate with the instance.
   *
   * TERRACONSTRUCTS DEVIATION: `IClusterParameterGroup` instead of upstream's
   * `aws_docdb.IDBClusterParameterGroupRef` — see the identical omission on
   * `IClusterParameterGroup.dbClusterParameterGroupRef` in `./parameter-group.ts`.
   *
   * @default no parameter group
   */
  readonly parameterGroup?: IClusterParameterGroup;

  /**
   * A weekly time range in which maintenance should preferably execute.
   *
   * Must be at least 30 minutes long.
   *
   * Example: 'tue:04:17-tue:04:47'
   *
   * @default - 30-minute window selected at random from an 8-hour block of time for
   * each AWS Region, occurring on a random day of the week.
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/db-instance-maintain.html#maintenance-window
   */
  readonly preferredMaintenanceWindow?: string;

  /**
   * The weekly time range during which system maintenance can occur on the cluster's instances.
   *
   * The cluster-level `preferredMaintenanceWindow` applies to cluster-wide maintenance events; this prop
   * applies to each auto-created instance independently. To use the same window for both, set this prop
   * to the same value as `preferredMaintenanceWindow`.
   *
   * Format: `ddd:hh24:mi-ddd:hh24:mi`. Must be at least 30 minutes long.
   * Example: 'sat:09:00-sat:09:30'
   *
   * Only applicable to provisioned clusters; has no effect on serverless clusters because they do not
   * create instances.
   *
   * @default - a 30-minute window selected at random from an 8-hour block of time for each AWS Region,
   * occurring on a random day of the week.
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/db-instance-maintain.html#maintenance-window
   */
  readonly instanceMaintenanceWindow?: string;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.RETAIN`),
  // `instanceRemovalPolicy?: RemovalPolicy` and `securityGroupRemovalPolicy?: RemovalPolicy` are
  // CloudFormation's DeletionPolicy concept applied independently to the cluster, its
  // auto-created instances, and its auto-created security group. `core.RemovalPolicy` is not
  // ported anywhere in this repo (see the identical omission on `DatabaseClusterBaseProps` in
  // `../rds/cluster.ts`). Terraform's `aws_docdb_cluster` exposes the cluster-level equivalent
  // natively via `skipFinalSnapshot`/`finalSnapshotIdentifier` below -- the TERRACONSTRUCTS-native
  // replacement, mirroring `../rds/cluster.ts` exactly. Neither `aws_docdb_cluster_instance` nor
  // the auto-created `aws_security_group` exposes an equivalent argument at all (verified against
  // the full config shapes in `node_modules/@cdktn/provider-aws/lib/docdb-cluster-instance/index.d.ts`
  // and `.../security-group/index.d.ts`), so `instanceRemovalPolicy`/`securityGroupRemovalPolicy`
  // have no native replacement and are dropped entirely --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/cluster.ts#L220-L233
  // readonly removalPolicy?: RemovalPolicy;
  // readonly instanceRemovalPolicy?: RemovalPolicy;
  // readonly securityGroupRemovalPolicy?: RemovalPolicy;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — native Terraform replacement for upstream's
   * `removalPolicy` (see the TODO above). Whether Terraform should take a final DB snapshot before
   * destroying this cluster. When `false` (the default) and `finalSnapshotIdentifier` is not set,
   * `terraform destroy`/replace will FAIL at apply-time with an AWS API error (native
   * `aws_docdb_cluster` behavior, not enforced here at synth time). Mirrors
   * `DatabaseClusterProps.skipFinalSnapshot` in `../rds/cluster.ts`.
   *
   * @default false (a final snapshot is taken on delete/replace, so `finalSnapshotIdentifier` should
   * also be set)
   */
  readonly skipFinalSnapshot?: boolean;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see `skipFinalSnapshot` above. The identifier
   * for the final DB cluster snapshot Terraform takes before destroying this cluster. Unlike
   * CloudFormation (which auto-generates a snapshot name), Terraform requires this to be supplied
   * explicitly. Mirrors `DatabaseClusterProps.finalSnapshotIdentifier` in `../rds/cluster.ts`.
   *
   * @default - no final snapshot identifier; required unless `skipFinalSnapshot` is `true`
   */
  readonly finalSnapshotIdentifier?: string;

  /**
   * Specifies whether this cluster can be deleted. If deletionProtection is
   * enabled, the cluster cannot be deleted unless it is modified and
   * deletionProtection is disabled. deletionProtection protects clusters from
   * being accidentally deleted.
   *
   * @default - false
   */
  readonly deletionProtection?: boolean;

  /**
   * Whether the profiler logs should be exported to CloudWatch.
   * Note that you also have to configure the profiler log export in the Cluster's Parameter Group.
   *
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/profiling.html#profiling.enable-profiling
   * @default false
   */
  readonly exportProfilerLogsToCloudWatch?: boolean;

  /**
   * Whether the audit logs should be exported to CloudWatch.
   * Note that you also have to configure the audit log export in the Cluster's Parameter Group.
   *
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/event-auditing.html#event-auditing-enabling-auditing
   * @default false
   */
  readonly exportAuditLogsToCloudWatch?: boolean;

  // TODO: omitted — `cloudWatchLogsRetention`/`cloudWatchLogsRetentionRole` (and the LogRetention
  // custom-resource machinery that consumes them) are dropped for the identical reason given on
  // `DatabaseClusterBaseProps.cloudwatchLogsRetention` in `../rds/cluster.ts` — there is no
  // Terraform-native equivalent of upstream's Lambda-backed `logs.LogRetention` custom resource;
  // the `aws_docdb_cluster` resource only controls WHICH logs are exported
  // (`enabled_cloudwatch_logs_exports`, ported below via `exportProfilerLogsToCloudWatch`/
  // `exportAuditLogsToCloudWatch`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/cluster.ts#L263-L278
  // readonly cloudWatchLogsRetention?: logs.RetentionDays;
  // readonly cloudWatchLogsRetentionRole?: iam.IRole;

  /**
   * A value that indicates whether to enable Performance Insights for the instances in the DB Cluster.
   *
   * @default - false
   */
  readonly enablePerformanceInsights?: boolean;

  // TODO: omitted — upstream's `copyTagsToSnapshot?: boolean` maps to `CfnDBCluster.copyTagsToSnapshot`.
  // The Terraform `aws_docdb_cluster` resource has NO `copy_tags_to_snapshot` argument at all
  // (verified against the full config shape in
  // `node_modules/@cdktn/provider-aws/lib/docdb-cluster/index.d.ts`). Note:
  // `aws_docdb_cluster_instance.copy_tags_to_snapshot` DOES exist, but is deliberately not
  // repurposed here — upstream's prop is a cluster-level CfnDBCluster property, and mapping it
  // onto the auto-created instances would silently change its semantics —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/cluster.ts#L309-L314
  // readonly copyTagsToSnapshot?: boolean;

  /**
   * The storage type of the DocDB cluster.
   *
   * I/O-optimized storage is supported starting with engine version 5.0.0.
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/db-cluster-storage-configs.html
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/release-notes.html#release-notes.11-21-2023
   *
   * @default StorageType.STANDARD
   */
  readonly storageType?: StorageType;
}

/**
 * A new or imported clustered database.
 */
abstract class DatabaseClusterBase
  extends AwsConstructBase
  implements IDatabaseCluster
{
  /**
   * Identifier of the cluster
   */
  public abstract readonly clusterIdentifier: string;
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
   * Security group identifier of this database
   */
  public abstract readonly securityGroupId: string;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. `clusterEndpoint`/`clusterReadEndpoint` are
   * abstract getters that THROW on an `ImportedDatabaseCluster` built via
   * `fromDatabaseClusterAttributes()` without the corresponding endpoint address (see
   * `ImportedDatabaseCluster` below). `asSecretAttachmentTarget()` and `outputs` (both below) need
   * to tolerate that -- host/port and the endpoint outputs are simply omitted for a minimally
   * imported cluster rather than throwing. Concrete (non-imported) subclasses never throw here, so
   * the default implementation is a plain passthrough; `ImportedDatabaseCluster` overrides both to
   * return `undefined` instead of throwing when the corresponding attribute wasn't supplied. Mirrors
   * `DatabaseClusterBase.tryGetClusterEndpoint()` in `../rds/cluster.ts`.
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
   * Renders the secret attachment target specifications.
   *
   * TERRACONSTRUCTS DEVIATION: mirrors the identical deviation note on
   * `DatabaseClusterBase.asSecretAttachmentTarget()` in `../rds/cluster.ts` — upstream returns
   * only `{ targetId, targetType }` because CloudFormation's
   * `AWS::SecretsManager::SecretTargetAttachment` resolves engine/host/port server-side from those
   * fields. The Terraform AWS provider has no such server-side merge, so `connectionFields` is
   * supplied here too, using `dbClusterIdentifier` (not `dbInstanceIdentifier`) as CFN's
   * `SecretTargetAttachment` does for DocDB cluster targets.
   *
   * TERRACONSTRUCTS DEVIATION: `engine: "mongo"` and `ssl: "true"` are also injected, neither of
   * which CFN's `SecretTargetAttachment` needs to set explicitly (it resolves `engine` from the
   * target's resource type, and DocumentDB's Secrets Manager rotation templates default `ssl` to
   * `false` if absent). The Secrets Manager MongoDB rotation Lambda requires `engine` to be
   * literally `"mongo"` in the secret JSON (see the docblock on `RotationMultiUserOptions.secret`
   * in `./props.ts`), and DocumentDB clusters have TLS enabled by default (see
   * https://docs.aws.amazon.com/documentdb/latest/developerguide/security.encryption.ssl.html), so
   * the rotation Lambda must connect over TLS -- `ssl: "true"` mirrors that default.
   */
  public asSecretAttachmentTarget(): secretsmanager.SecretAttachmentTargetProps {
    const endpoint = this.tryGetClusterEndpoint();
    return {
      targetId: this.clusterIdentifier,
      targetType: secretsmanager.AttachmentTargetType.DOCDB_DB_CLUSTER,
      connectionFields: {
        dbClusterIdentifier: this.clusterIdentifier,
        engine: "mongo",
        ssl: "true",
        ...(endpoint
          ? {
              host: endpoint.hostname,
              // NUMBER-typed port token, stringified for embedding in the connection fields map.
              port: Tokenization.stringifyNumber(endpoint.port),
            }
          : {}),
      },
    };
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `DatabaseClusterBase.outputs` in `../rds/cluster.ts`) — bare, bound-per-construct `outputs`
   * for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    const endpoint = this.tryGetClusterEndpoint();
    const readEndpoint = this.tryGetClusterReadEndpoint();
    return {
      identifier: this.clusterIdentifier,
      ...(endpoint && {
        endpointAddress: endpoint.hostname,
        endpointPort: Tokenization.stringifyNumber(endpoint.port),
      }),
      ...(readEndpoint && { readEndpointAddress: readEndpoint.hostname }),
    };
  }
}

/**
 * Create a clustered database with a given number of instances.
 *
 * @resource aws_docdb_cluster
 */
export class DatabaseCluster extends DatabaseClusterBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.docdb.DatabaseCluster";

  /**
   * The default number of instances in the DocDB cluster if none are
   * specified
   */
  public static readonly DEFAULT_NUM_INSTANCES = 1;

  /**
   * The default port Document DB listens on
   */
  public static readonly DEFAULT_PORT = 27017;

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

  /**
   * The single user secret rotation application.
   *
   * CROSS-LANE FIX (Lane B, unblocking `docdb` barrel import): was a `private static readonly`
   * field eagerly evaluating `secretsmanager.SecretRotationApplication.MONGODB_ROTATION_SINGLE_USER`
   * at class-definition (module-load) time. Once `storage/index.ts` re-exports `docdb` (which
   * re-exports this file), that eager read lands mid-way through `encryption/secret-rotation.ts`'s
   * own top-level evaluation (via a `encryption -> compute -> storage -> docdb -> encryption`
   * circular require), so `SecretRotationApplication` is still `undefined` at that point --
   * `TypeError: Cannot read properties of undefined (reading 'MONGODB_ROTATION_SINGLE_USER')` at
   * import time. Converted to a lazily-evaluated static getter (same access syntax at both call
   * sites below, `DatabaseCluster.SINGLE_USER_ROTATION_APPLICATION`) so the read only happens once
   * `addRotationSingleUser()` actually runs, by which point the module graph has fully loaded --
   * matches the (already-lazy, instance-level) precedent in `../rds/cluster.ts`'s
   * `singleUserRotationApplication`/`multiUserRotationApplication`.
   */
  private static get SINGLE_USER_ROTATION_APPLICATION() {
    return secretsmanager.SecretRotationApplication
      .MONGODB_ROTATION_SINGLE_USER;
  }

  /**
   * The multi user secret rotation application.
   *
   * CROSS-LANE FIX: see `SINGLE_USER_ROTATION_APPLICATION` above.
   */
  private static get MULTI_USER_ROTATION_APPLICATION() {
    return secretsmanager.SecretRotationApplication.MONGODB_ROTATION_MULTI_USER;
  }

  /**
   * Identifier of the cluster
   */
  public readonly clusterIdentifier: string;

  /**
   * The endpoint to use for read/write operations
   */
  public readonly clusterEndpoint: Endpoint;

  /**
   * Endpoint to use for load-balanced read-only operations.
   */
  public readonly clusterReadEndpoint: Endpoint;

  /**
   * The resource id for the cluster; for example: cluster-ABCD1234EFGH5678IJKL90MNOP. The cluster ID uniquely
   * identifies the cluster and is used in things like IAM authentication policies.
   */
  public readonly clusterResourceIdentifier: string;

  /**
   * The connections object to implement IConnectable
   */
  public readonly connections: ec2.Connections;

  /**
   * Identifiers of the replicas
   */
  public readonly instanceIdentifiers: string[] = [];

  /**
   * Endpoints which address each individual replica.
   */
  public readonly instanceEndpoints: Endpoint[] = [];

  /**
   * Security group identifier of this database
   */
  public readonly securityGroupId: string;

  /**
   * The secret attached to this cluster
   */
  public readonly secret?: secretsmanager.ISecret;

  /**
   * The underlying `aws_docdb_cluster` L1. NOTE: this construct owns `lifecycle.ignore_changes` on
   * it (see the `ignore_changes`/password-drift note in the constructor) -- code calling
   * `resource.addOverride("lifecycle.ignore_changes", ...)` directly will REPLACE that list rather
   * than merge with it.
   */
  public readonly resource: docdbCluster.DocdbCluster;

  /**
   * The VPC where the DB subnet group is created.
   */
  private readonly vpc: ec2.IVpc;

  /**
   * The subnets used by the DB subnet group.
   */
  private readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see `addSecurityGroups()` below. Tracks the
   * security group ids owned by this construct so `addSecurityGroups()` can extend the underlying
   * `aws_docdb_cluster.vpc_security_group_ids` INPUT list. The Terraform L1's
   * `vpcSecurityGroupIds` GETTER returns a synth-time-resolved attribute reference
   * (`Fn.tolist(getListAttribute("vpc_security_group_ids"))`), not the raw input array -- unlike
   * upstream's `CfnDBCluster.vpcSecurityGroupIds` (a plain mutable CFN L1 property), pushing onto
   * that resolved reference would silently no-op rather than mutating the resource's actual
   * argument, so the ids are tracked locally and re-assigned via the setter instead.
   */
  private readonly securityGroupIds: string[];

  constructor(scope: Construct, id: string, props: DatabaseClusterProps) {
    super(scope, id, props);

    // Validate exactly one of instanceType or serverlessV2ScalingConfiguration is provided
    if (!props.instanceType && !props.serverlessV2ScalingConfiguration) {
      throw new ValidationError(
        "Either instanceType (for provisioned clusters) or serverlessV2ScalingConfiguration (for serverless clusters) must be specified",
        this,
      );
    }

    if (
      props.preferredMaintenanceWindow !== undefined &&
      !Token.isUnresolved(props.preferredMaintenanceWindow) &&
      !MAINTENANCE_WINDOW_REGEX.test(props.preferredMaintenanceWindow)
    ) {
      throw new ValidationError(
        "preferredMaintenanceWindow must be in the format ddd:hh24:mi-ddd:hh24:mi, e.g. sat:09:00-sat:09:30",
        this,
      );
    }

    if (
      props.instanceMaintenanceWindow !== undefined &&
      !Token.isUnresolved(props.instanceMaintenanceWindow) &&
      !MAINTENANCE_WINDOW_REGEX.test(props.instanceMaintenanceWindow)
    ) {
      throw new ValidationError(
        "instanceMaintenanceWindow must be in the format ddd:hh24:mi-ddd:hh24:mi, e.g. sat:09:00-sat:09:30",
        this,
      );
    }

    const isServerless = !!props.serverlessV2ScalingConfiguration;
    if (isServerless && props.instanceType) {
      throw new ValidationError(
        "Cannot specify both instanceType and serverlessV2ScalingConfiguration",
        this,
      );
    }

    this.vpc = props.vpc;
    this.vpcSubnets = props.vpcSubnets;

    // Determine the subnet(s) to deploy the DocDB cluster to
    const { subnetIds, internetConnectivityEstablished } =
      this.vpc.selectSubnets(this.vpcSubnets);

    // DocDB clusters require a subnet group with subnets from at least two AZs.
    // We cannot test whether the subnets are in different AZs, but at least we can test the amount.
    // See https://docs.aws.amazon.com/documentdb/latest/developerguide/replication.html#replication.high-availability
    if (subnetIds.length < 2) {
      throw new ValidationError(
        `Cluster requires at least 2 subnets, got ${subnetIds.length}`,
        this,
      );
    }

    const subnetGroup = new docdbSubnetGroup.DocdbSubnetGroup(this, "Subnets", {
      description: `Subnets for ${id} database`,
      subnetIds,
    });
    // TERRACONSTRUCTS DEVIATION: when unnamed, upstream lets CloudFormation generate a name
    // from the logical id; the repo invariant is a gridUUID-scoped `uniqueResourceName` default
    // instead (mirroring `SubnetGroup` in `../rds/subnet-group.ts`), lowercased to match the
    // DocumentDB/RDS-family server-side storage convention. Scoped to the subnet group's OWN
    // construct path (`subnetGroup`, not `this`/the `DatabaseCluster`) so it does not collide with
    // the cluster's own `uniqueResourceName(this, ...)`-derived `clusterIdentifier` below -- both
    // would otherwise resolve to the identical string, since `uniqueResourceName` hashes the
    // construct's node path and `this` is the same construct in both calls.
    subnetGroup.name = this.stack.uniqueResourceName(subnetGroup).toLowerCase();

    // Create the security group for the DB cluster
    let securityGroup: ec2.ISecurityGroup;
    if (props.securityGroup) {
      securityGroup = props.securityGroup;
    } else {
      securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
        description: "DocumentDB security group",
        vpc: this.vpc,
      });
      // TERRACONSTRUCTS DEVIATION: upstream applies a consistent removal policy to the
      // auto-created security group via an escape-hatch (`securityGroupRemovalPolicy`). `core.RemovalPolicy`
      // is not ported in this repo -- see the TODO on `DatabaseClusterProps.securityGroupRemovalPolicy` above.
    }
    this.securityGroupId = securityGroup.securityGroupId;
    this.securityGroupIds = [this.securityGroupId];

    // Create the CloudwatchLogsConfiguration
    const enableCloudwatchLogsExports: string[] = [];
    if (props.exportAuditLogsToCloudWatch) {
      enableCloudwatchLogsExports.push("audit");
    }
    if (props.exportProfilerLogsToCloudWatch) {
      enableCloudwatchLogsExports.push("profiler");
    }

    // Create the secret manager secret if no password is specified
    let secret: DatabaseSecret | undefined;
    if (!props.masterUser.password) {
      secret = new DatabaseSecret(this, "Secret", {
        username: props.masterUser.username,
        encryptionKey: props.masterUser.kmsKey,
        excludeCharacters: props.masterUser.excludeCharacters,
        secretName: props.masterUser.secretName,
      });
    }

    // Default to encrypted storage
    const storageEncrypted = props.storageEncrypted ?? true;

    if (props.kmsKey && !storageEncrypted) {
      throw new ValidationError(
        "KMS key supplied but storageEncrypted is false",
        this,
      );
    }

    if (
      props.engineVersion !== undefined &&
      !VALID_ENGINE_VERSION_REGEX.test(props.engineVersion)
    ) {
      throw new ValidationError(
        `Invalid engine version: '${props.engineVersion}'. Engine version must be in the format x.y.z`,
        this,
      );
    }

    if (
      props.storageType === StorageType.IOPT1 &&
      props.engineVersion !== undefined &&
      Number(props.engineVersion.split(".")[0]) <
        MIN_ENGINE_VERSION_FOR_IO_OPTIMIZED_STORAGE
    ) {
      throw new ValidationError(
        `I/O-optimized storage is supported starting with engine version 5.0.0, got '${props.engineVersion}'`,
        this,
      );
    }

    // Validate engine version for serverless clusters: https://docs.aws.amazon.com/documentdb/latest/developerguide/docdb-serverless-limitations.html
    if (
      isServerless &&
      props.engineVersion !== undefined &&
      Number(props.engineVersion.split(".")[0]) <
        MIN_ENGINE_VERSION_FOR_SERVERLESS
    ) {
      throw new ValidationError(
        `DocumentDB serverless requires engine version 5.0.0 or higher, got '${props.engineVersion}'`,
        this,
      );
    }

    // Create the DocDB cluster
    // TERRACONSTRUCTS DEVIATION: hoisted so the auto-created instances below can reuse the
    // derived (gridUUID-scoped, lowercased) cluster identifier as their name base -- see the
    // instance-identifier note in the creation loop.
    const derivedClusterIdentifier = Token.isUnresolved(props.dbClusterName)
      ? props.dbClusterName
      : (
          props.dbClusterName ??
          this.stack.uniqueResourceName(this, { maxLength: 55 })
        ).toLowerCase();

    const cluster = new docdbCluster.DocdbCluster(this, "Resource", {
      // Basic
      engineVersion: props.engineVersion,
      // TERRACONSTRUCTS DEVIATION: when unnamed, upstream lets CloudFormation generate a name
      // from the logical id; the repo invariant is a gridUUID-scoped `uniqueResourceName` default
      // instead (mirroring `DatabaseCluster` in `../rds/cluster.ts`), lowercased to match the
      // DocumentDB/RDS-family server-side storage convention. `ClusterIdentifier` is capped at 63
      // characters, so `maxLength` is passed explicitly here.
      clusterIdentifier: derivedClusterIdentifier,
      dbSubnetGroupName: subnetGroup.name,
      port: props.port,
      vpcSecurityGroupIds: this.securityGroupIds,
      dbClusterParameterGroupName: props.parameterGroup?.parameterGroupName,
      deletionProtection: props.deletionProtection,
      // Admin
      masterUsername: props.masterUser.username,
      masterPassword: secret
        ? secret._generatedPassword
        : props.masterUser.password,
      // Backup
      backupRetentionPeriod: props.backup?.retention?.toDays(),
      preferredBackupWindow: props.backup?.preferredWindow,
      preferredMaintenanceWindow: props.preferredMaintenanceWindow,
      // EnableCloudwatchLogsExports
      enabledCloudwatchLogsExports:
        enableCloudwatchLogsExports.length > 0
          ? enableCloudwatchLogsExports
          : undefined,
      // Encryption
      kmsKeyId: props.kmsKey?.keyArn,
      storageEncrypted,
      storageType: props.storageType,
      // Serverless configuration
      serverlessV2ScalingConfiguration: props.serverlessV2ScalingConfiguration,
      skipFinalSnapshot: props.skipFinalSnapshot,
      finalSnapshotIdentifier: props.finalSnapshotIdentifier,
    } as docdbCluster.DocdbClusterConfig);

    this.resource = cluster;
    this.clusterIdentifier = cluster.clusterIdentifier;
    this.clusterResourceIdentifier = cluster.clusterResourceId;

    // TERRACONSTRUCTS DEVIATION: mirrors the identical `ignore_changes` note on `DatabaseCluster`
    // in `../rds/cluster.ts` -- `secret` is only set here when a new `DatabaseSecret` was just
    // generated for us, in which case `masterPassword` above is the SAME regenerating-on-every-plan
    // `aws_secretsmanager_random_password` token stored in that secret. Without `ignore_changes`,
    // every apply after the first would drift and REPLACE the live master password.
    const ignoreChanges: string[] = [];
    if (secret) {
      ignoreChanges.push("master_password");
    }
    if (ignoreChanges.length > 0) {
      cluster.addOverride("lifecycle.ignore_changes", ignoreChanges);
    }

    // TERRACONSTRUCTS DEVIATION: mirrors the identical `skipFinalSnapshot`/`finalSnapshotIdentifier`
    // synth-time warning on `DatabaseCluster` in `../rds/cluster.ts` — see that note for the full
    // rationale.
    if (props.skipFinalSnapshot !== true && !props.finalSnapshotIdentifier) {
      Annotations.of(this).addWarning(
        "Neither `skipFinalSnapshot` nor `finalSnapshotIdentifier` is set: `terraform destroy` (or any change that replaces this cluster) will FAIL at apply time because the AWS provider requires `finalSnapshotIdentifier` when `skipFinalSnapshot` is not `true`. Set `skipFinalSnapshot: true` to skip the final snapshot, or set `finalSnapshotIdentifier` to a snapshot name.",
      );
    }

    // NOTE: must be set before `secret.attach(this)` below -- `attach()` calls
    // `asSecretAttachmentTarget()` synchronously, which reads `this.clusterEndpoint`.
    this.clusterEndpoint = new Endpoint(cluster.endpoint, cluster.port);
    this.clusterReadEndpoint = new Endpoint(
      cluster.readerEndpoint,
      cluster.port,
    );

    this.connections = new ec2.Connections({
      securityGroups: [securityGroup],
      defaultPort: ec2.Port.tcp(this.clusterEndpoint.port),
    });

    if (secret) {
      this.secret = secret.attach(this);
    }

    // Create instances only for provisioned clusters
    if (!isServerless) {
      const instanceCount =
        props.instances ?? DatabaseCluster.DEFAULT_NUM_INSTANCES;
      if (instanceCount < 1) {
        throw new ValidationError(
          "At least one instance is required for provisioned clusters",
          this,
        );
      }

      const caCertificateIdentifier = props.caCertificate
        ? props.caCertificate.toString()
        : undefined;

      for (let i = 0; i < instanceCount; i++) {
        const instanceIndex = i + 1;

        // TERRACONSTRUCTS DEVIATION: upstream lets CloudFormation auto-generate a name from each
        // instance's per-index logical id (`Instance1`, `Instance2`, ...) when neither
        // `instanceIdentifierBase` nor `dbClusterName` is provided. A single
        // `uniqueResourceName(this, ...)` call would collide across loop iterations (shared
        // scope), so the repo naming invariant is preserved by reusing the DERIVED cluster
        // identifier (already gridUUID-scoped + lowercased above, capped at 55 chars to leave
        // room for the `instanceN` suffix) as the per-instance base -- upstream's own fallback
        // semantic (`dbClusterName` + "instance" + N), just with the derived default instead of
        // the raw prop.
        const instanceIdentifierBase =
          props.instanceIdentifierBase != null
            ? `${props.instanceIdentifierBase}${instanceIndex}`
            : `${derivedClusterIdentifier}instance${instanceIndex}`;
        const instanceIdentifier =
          instanceIdentifierBase === undefined
            ? undefined
            : Token.isUnresolved(instanceIdentifierBase)
              ? instanceIdentifierBase
              : instanceIdentifierBase.toLowerCase();

        const instance = new docdbClusterInstance.DocdbClusterInstance(
          this,
          `Instance${instanceIndex}`,
          {
            // Link to cluster
            clusterIdentifier: this.clusterIdentifier,
            identifier: instanceIdentifier,
            // Instance properties
            instanceClass: databaseInstanceType(props.instanceType!),
            enablePerformanceInsights: props.enablePerformanceInsights,
            caCertIdentifier: caCertificateIdentifier,
            preferredMaintenanceWindow: props.instanceMaintenanceWindow,
          } as docdbClusterInstance.DocdbClusterInstanceConfig,
        );

        // We must have a dependency on the NAT gateway provider here to create
        // things in the right order.
        instance.node.addDependency(internetConnectivityEstablished);

        this.instanceIdentifiers.push(instance.identifier);
        this.instanceEndpoints.push(
          new Endpoint(instance.endpoint, this.clusterEndpoint.port),
        );
      }
    }
  }

  public get outputs(): Record<string, any> {
    return {
      ...super.outputs,
      arn: this.resource.arn,
      ...(this.secret && { secretArn: this.secret.secretArn }),
    };
  }

  /**
   * Adds the single user rotation of the master password to this cluster.
   *
   * @param [automaticallyAfter=Duration.days(30)] Specifies the number of days after the previous rotation
   * before Secrets Manager triggers the next automatic rotation.
   */
  public addRotationSingleUser(
    automaticallyAfter?: Duration,
  ): secretsmanager.SecretRotation {
    if (!this.secret) {
      throw new ValidationError(
        "Cannot add single user rotation for a cluster without secret.",
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
      secret: this.secret,
      automaticallyAfter,
      application: DatabaseCluster.SINGLE_USER_ROTATION_APPLICATION,
      excludeCharacters: (this.node.tryFindChild("Secret") as DatabaseSecret)
        ._excludedCharacters,
      vpc: this.vpc,
      vpcSubnets: this.vpcSubnets,
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
    if (!this.secret) {
      throw new ValidationError(
        "Cannot add multi user rotation for a cluster without secret.",
        this,
      );
    }
    return new secretsmanager.SecretRotation(this, id, {
      secret: options.secret,
      masterSecret: this.secret,
      automaticallyAfter: options.automaticallyAfter,
      excludeCharacters: (this.node.tryFindChild("Secret") as DatabaseSecret)
        ._excludedCharacters,
      application: DatabaseCluster.MULTI_USER_ROTATION_APPLICATION,
      vpc: this.vpc,
      vpcSubnets: this.vpcSubnets,
      target: this,
    });
  }

  /**
   * Adds security groups to this cluster.
   * @param securityGroups The security groups to add.
   */
  public addSecurityGroups(...securityGroups: ec2.ISecurityGroup[]): void {
    this.securityGroupIds.push(
      ...securityGroups.map((sg) => sg.securityGroupId),
    );
    this.resource.vpcSecurityGroupIds = [...this.securityGroupIds];
  }
}

/**
 * Turn a regular instance type into a database instance type
 */
function databaseInstanceType(instanceType: ec2.InstanceType) {
  return "db." + instanceType.toString();
}

/**
 * Represents an imported database cluster.
 */
class ImportedDatabaseCluster
  extends DatabaseClusterBase
  implements IDatabaseCluster
{
  public readonly clusterIdentifier: string;
  public readonly connections: ec2.Connections;

  private readonly _instanceIdentifiers?: string[];
  private readonly _clusterEndpoint?: Endpoint;
  private readonly _clusterReadEndpoint?: Endpoint;
  private readonly _instanceEndpoints?: Endpoint[];
  private readonly _securityGroupId?: string;

  constructor(scope: Construct, id: string, attrs: DatabaseClusterAttributes) {
    super(scope, id);

    const defaultPort =
      typeof attrs.port !== "undefined" ? ec2.Port.tcp(attrs.port) : undefined;
    this.connections = new ec2.Connections({
      securityGroups: attrs.securityGroup ? [attrs.securityGroup] : undefined,
      defaultPort,
    });
    this.clusterIdentifier = attrs.clusterIdentifier;
    this._instanceIdentifiers = attrs.instanceIdentifiers;
    this._clusterEndpoint =
      attrs.clusterEndpointAddress && typeof attrs.port !== "undefined"
        ? new Endpoint(attrs.clusterEndpointAddress, attrs.port)
        : undefined;
    this._clusterReadEndpoint =
      attrs.readerEndpointAddress && typeof attrs.port !== "undefined"
        ? new Endpoint(attrs.readerEndpointAddress, attrs.port)
        : undefined;
    this._instanceEndpoints =
      attrs.instanceEndpointAddresses && typeof attrs.port !== "undefined"
        ? attrs.instanceEndpointAddresses.map(
            (addr) => new Endpoint(addr, attrs.port!),
          )
        : undefined;
    this._securityGroupId = attrs.securityGroup?.securityGroupId;
  }

  public get clusterEndpoint(): Endpoint {
    if (!this._clusterEndpoint) {
      throw new ValidationError(
        "Cannot access `clusterEndpoint` of an imported cluster without an endpoint address and port",
        this,
      );
    }
    return this._clusterEndpoint;
  }

  protected tryGetClusterEndpoint(): Endpoint | undefined {
    return this._clusterEndpoint;
  }

  public get clusterReadEndpoint(): Endpoint {
    if (!this._clusterReadEndpoint) {
      throw new ValidationError(
        "Cannot access `clusterReadEndpoint` of an imported cluster without a readerEndpointAddress and port",
        this,
      );
    }
    return this._clusterReadEndpoint;
  }

  protected tryGetClusterReadEndpoint(): Endpoint | undefined {
    return this._clusterReadEndpoint;
  }

  public get instanceIdentifiers(): string[] {
    if (!this._instanceIdentifiers) {
      throw new ValidationError(
        "Cannot access `instanceIdentifiers` of an imported cluster without provided instanceIdentifiers",
        this,
      );
    }
    return this._instanceIdentifiers;
  }

  public get instanceEndpoints(): Endpoint[] {
    if (!this._instanceEndpoints) {
      throw new ValidationError(
        "Cannot access `instanceEndpoints` of an imported cluster without instanceEndpointAddresses and port",
        this,
      );
    }
    return this._instanceEndpoints;
  }

  public get securityGroupId(): string {
    if (!this._securityGroupId) {
      throw new ValidationError(
        "Cannot access `securityGroupId` of an imported cluster without securityGroupId",
        this,
      );
    }
    return this._securityGroupId;
  }
}
