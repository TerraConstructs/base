// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/aurora-cluster-instance.ts

import { rdsClusterInstance } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import type { Construct } from "constructs";
import type { CaCertificate } from "./ca-certificate";
import { DatabaseCluster } from "./cluster";
import type { IDatabaseCluster } from "./cluster-ref";
import type { IParameterGroup } from "./parameter-group";
import { ParameterGroup } from "./parameter-group";
import { PerformanceInsightRetention } from "./props";
import type { ISubnetGroup } from "./subnet-group";
import type { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import { AwsConstructBase, IAwsConstruct } from "../../aws-construct";
import * as ec2 from "../../compute";
import type * as encryption from "../../encryption";
import type * as iam from "../../iam";

/**
 * Options for binding the instance to the cluster
 */
export interface ClusterInstanceBindOptions {
  /**
   * The interval, in seconds, between points when Amazon RDS collects enhanced
   * monitoring metrics for the DB instances.
   *
   * @default no enhanced monitoring
   */
  readonly monitoringInterval?: Duration;

  /**
   * Role that will be used to manage DB instances monitoring.
   *
   * TERRACONSTRUCTS DEVIATION: `iam.IRole` instead of upstream's `iam.IRoleRef` — see the identical
   * deviation on `DatabaseInstanceNewProps.monitoringRole` in `./instance.ts`.
   *
   * @default - A role is automatically created for you
   */
  readonly monitoringRole?: iam.IRole;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.DESTROY`)
  // drives `instance.applyRemovalPolicy(helperRemovalPolicy(removalPolicy))`, i.e. CloudFormation's
  // DeletionPolicy on the per-instance `AWS::RDS::DBInstance` resource. `core.RemovalPolicy` is not
  // ported in this repo (see `helperRemovalPolicy` -- commented out in `./private/util.ts` -- and
  // the identical omission on `DatabaseInstanceNewProps.removalPolicy`/`skipFinalSnapshot` pattern in
  // `./instance.ts`). Unlike standalone `aws_db_instance`, the Terraform `aws_rds_cluster_instance`
  // resource has NO per-instance final-snapshot/deletion-protection arguments at all (verified
  // against the full config shape in
  // `node_modules/@cdktn/provider-aws/lib/rds-cluster-instance/index.d.ts`) — deletion protection
  // for a cluster is exclusively a cluster-level (`aws_rds_cluster.deletion_protection`) concern, so
  // there is no per-instance equivalent to reinstate here even in TERRACONSTRUCTS-native form —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/aurora-cluster-instance.ts#L43-L47
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * The promotion tier of the cluster instance
   *
   * This matters more for serverlessV2 instances. If a serverless
   * instance is in tier 0-1 then it will scale with the writer.
   *
   * For provisioned instances this just determines the failover priority.
   * If multiple instances have the same priority then one will be picked at random
   *
   * @default 2
   */
  readonly promotionTier?: number;

  /**
   * Existing subnet group for the cluster.
   * This is only needed when using the isFromLegacyInstanceProps
   *
   * TERRACONSTRUCTS DEVIATION: `ISubnetGroup` instead of upstream's `aws_rds.IDBSubnetGroupRef` —
   * see the identical deviation on `DatabaseInstanceNewProps.subnetGroup` in `./instance.ts`.
   *
   * @default - cluster subnet group is used
   */
  readonly subnetGroup?: ISubnetGroup;
}

/**
 * The type of Aurora Cluster Instance. Can be either serverless v2
 * or provisioned
 */
export class ClusterInstanceType {
  /**
   * Aurora Serverless V2 instance type
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html
   */
  public static serverlessV2(): ClusterInstanceType {
    return new ClusterInstanceType("db.serverless", InstanceType.SERVERLESS_V2);
  }

  /**
   * Aurora Provisioned instance type
   */
  public static provisioned(
    instanceType?: ec2.InstanceType,
  ): ClusterInstanceType {
    return new ClusterInstanceType(
      (
        instanceType ??
        ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM)
      ).toString(),
      InstanceType.PROVISIONED,
    );
  }

  private constructor(
    private readonly instanceType: string,
    public readonly type: InstanceType,
  ) {}

  /**
   * String representation of the instance type that can be used in the underlying
   * `aws_rds_cluster_instance` resource
   */
  public toString(): string {
    return this.instanceType;
  }
}

/**
 * Represents an Aurora cluster instance
 * This can be either a provisioned instance or a serverless v2 instance
 */
export interface IClusterInstance {
  /**
   * Create the database instance within the provided cluster
   */
  bind(
    scope: Construct,
    cluster: IDatabaseCluster,
    options: ClusterInstanceBindOptions,
  ): IAuroraClusterInstance;
}

/**
 * Options for creating a provisioned instance
 */
export interface ProvisionedClusterInstanceProps
  extends ClusterInstanceOptions {
  /**
   * The cluster instance type
   *
   * @default db.t3.medium
   */
  readonly instanceType?: ec2.InstanceType;

  /**
   * The promotion tier of the cluster instance
   *
   * Can be between 0-15
   *
   * For provisioned instances this just determines the failover priority.
   * If multiple instances have the same priority then one will be picked at random
   *
   * @default 2
   */
  readonly promotionTier?: number;
}

/**
 * Options for creating a serverless v2 instance
 */
export interface ServerlessV2ClusterInstanceProps
  extends ClusterInstanceOptions {
  /**
   * Only applicable to reader instances.
   *
   * If this is true then the instance will be placed in promotion tier 1, otherwise
   * it will be placed in promotion tier 2.
   *
   * For serverless v2 instances this means:
   * - true: The serverless v2 reader will scale to match the writer instance (provisioned or serverless)
   * - false: The serverless v2 reader will scale with the read workload on the instance
   *
   * @default false
   */
  readonly scaleWithWriter?: boolean;
}

/**
 * Common options for creating cluster instances (both serverless and provisioned)
 */
export interface ClusterInstanceProps extends ClusterInstanceOptions {
  /**
   * The type of cluster instance to create. Can be either
   * provisioned or serverless v2
   */
  readonly instanceType: ClusterInstanceType;

  /**
   * The promotion tier of the cluster instance
   *
   * This matters more for serverlessV2 instances. If a serverless
   * instance is in tier 0-1 then it will scale with the writer.
   *
   * For provisioned instances this just determines the failover priority.
   * If multiple instances have the same priority then one will be picked at random
   *
   * @default 2
   */
  readonly promotionTier?: number;
}

/**
 * Common options for creating a cluster instance
 */
export interface ClusterInstanceOptions {
  /**
   * The identifier for the database instance
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly instanceIdentifier?: string;

  /**
   * Whether to enable automatic upgrade of minor version for the DB instance.
   *
   * @default - true
   */
  readonly autoMinorVersionUpgrade?: boolean;

  /**
   * Whether to enable Performance Insights for the DB instance.
   *
   * @default - false, unless ``performanceInsightRetention`` or ``performanceInsightEncryptionKey`` is set.
   */
  readonly enablePerformanceInsights?: boolean;

  /**
   * The amount of time, in days, to retain Performance Insights data.
   *
   * @default 7
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
   * Indicates whether the DB instance is an internet-facing instance. If not specified,
   * the cluster's vpcSubnets will be used to determine if the instance is internet-facing
   * or not.
   *
   * @default - `true` if the cluster's `vpcSubnets` is `subnetType: SubnetType.PUBLIC`, `false` otherwise
   */
  readonly publiclyAccessible?: boolean;

  /**
   * The Availability Zone (AZ) where the database will be created.
   *
   * For Amazon Aurora, each Aurora DB cluster hosts copies of its storage in three separate Availability Zones.
   * Specify one of these Availability Zones. Aurora automatically chooses an appropriate Availability Zone if you don't specify one.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.RegionsAndAvailabilityZones.html
   * @default - A random, system-chosen Availability Zone in the endpointʼs AWS Region.
   */
  readonly availabilityZone?: string;

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
   * The parameters in the DBParameterGroup to create automatically
   *
   * You can only specify parameterGroup or parameters but not both.
   * You need to use a versioned engine to auto-generate a DBParameterGroup.
   *
   * @default - None
   */
  readonly parameters?: { [key: string]: string };

  // TODO: omitted — upstream's `allowMajorVersionUpgrade?: boolean` maps to
  // `CfnDBInstance.allowMajorVersionUpgrade`. The Terraform `aws_rds_cluster_instance` resource has
  // NO argument for this at all (not a CFN-vs-Terraform semantic difference — the provider simply
  // doesn't expose it on cluster members; verified against the full config shape in
  // `node_modules/@cdktn/provider-aws/lib/rds-cluster-instance/index.d.ts` — contrast with
  // `aws_db_instance`, which DOES support it for standalone instances). Major-version upgrades for
  // Aurora clusters are driven by the cluster's own `engine_version` instead —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/aurora-cluster-instance.ts#L266-L270
  // readonly allowMajorVersionUpgrade?: boolean;

  /**
   * The DB parameter group to associate with the instance.
   * This is only needed if you need to configure different parameter
   * groups for each individual instance, otherwise you should not
   * provide this and just use the cluster parameter group
   *
   * @default the cluster parameter group is used
   */
  readonly parameterGroup?: IParameterGroup;

  /**
   * Only used for migrating existing clusters from using `instanceProps` to `writer` and `readers`
   *
   * TERRACONSTRUCTS DEVIATION: when `true`, an omitted `instanceIdentifier` is left unset (matching
   * the legacy `instanceProps` path's behavior) rather than falling back to a gridUUID-scoped
   * `uniqueResourceName`, so migrating an unnamed legacy instance does not add a new `identifier`
   * argument to the existing `aws_rds_cluster_instance` and force a replacement. Pass
   * `instanceIdentifier` explicitly if you want a stable, grid-scoped name after migrating.
   *
   * @default false
   */
  readonly isFromLegacyInstanceProps?: boolean;

  /**
   * The identifier of the CA certificate for this DB cluster's instances.
   *
   * Specifying or updating this property triggers a reboot.
   *
   * For RDS DB engines:
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL-certificate-rotation.html
   * For Aurora DB engines:
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.SSL-certificate-rotation.html
   *
   * @default - RDS will choose a certificate authority
   */
  readonly caCertificate?: CaCertificate;

  /**
   * Specifies whether changes to the DB instance and any pending modifications are applied immediately, regardless of the `preferredMaintenanceWindow` setting.
   * If set to `false`, changes are applied during the next maintenance window.
   *
   * TERRACONSTRUCTS DEVIATION: upstream's `@default` is "Changes will be applied immediately" (CFN's
   * `ApplyImmediately` default). The Terraform `aws_rds_cluster_instance` resource's
   * `apply_immediately` argument defaults to `false` instead (see
   * `node_modules/@cdktn/provider-aws/lib/rds-cluster-instance/index.d.ts`), so leaving this prop
   * unset — as this port does — renders no `apply_immediately` argument and changes are applied
   * during the next maintenance window. Mirrors the identical deviation on
   * `DatabaseInstanceNewProps.applyImmediately` in `./instance.ts`.
   *
   * @default false - changes are applied during the next maintenance window (the
   * `aws_rds_cluster_instance` provider default)
   */
  readonly applyImmediately?: boolean;
}

/**
 * Create an RDS Aurora Cluster Instance. You can create either provisioned or
 * serverless v2 instances.
 */
export class ClusterInstance implements IClusterInstance {
  /**
   * Add a provisioned instance to the cluster
   *
   * @example
   * rds.ClusterInstance.provisioned('ClusterInstance', {
   *   instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.XLARGE4),
   * });
   */
  public static provisioned(
    id: string,
    props: ProvisionedClusterInstanceProps = {},
  ): IClusterInstance {
    return new ClusterInstance(id, {
      ...props,
      instanceType: ClusterInstanceType.provisioned(props.instanceType),
    });
  }

  /**
   * Add a serverless v2 instance to the cluster
   *
   * @example
   * rds.ClusterInstance.serverlessV2('ClusterInstance', {
   *   scaleWithWriter: true,
   * });
   */
  public static serverlessV2(
    id: string,
    props: ServerlessV2ClusterInstanceProps = {},
  ): IClusterInstance {
    return new ClusterInstance(id, {
      ...props,
      promotionTier: props.scaleWithWriter ? 1 : 2,
      instanceType: ClusterInstanceType.serverlessV2(),
    });
  }

  private constructor(
    private id: string,
    private readonly props: ClusterInstanceProps,
  ) {}

  /**
   * Add the ClusterInstance to the cluster
   */
  public bind(
    scope: Construct,
    cluster: IDatabaseCluster,
    props: ClusterInstanceBindOptions,
  ): IAuroraClusterInstance {
    return new AuroraClusterInstance(scope, this.id, {
      cluster,
      ...this.props,
      ...props,
    });
  }
}

interface AuroraClusterInstanceProps
  extends ClusterInstanceProps,
    ClusterInstanceBindOptions {
  readonly cluster: IDatabaseCluster;
}

export enum InstanceType {
  PROVISIONED = "PROVISIONED",
  SERVERLESS_V2 = "SERVERLESS_V2",
}

/**
 * An Aurora Cluster Instance
 *
 * TODO: omitted — upstream also extends `aws_rds.IDBInstanceRef`, a CloudFormation cross-stack
 * "Reference" marker interface generated from the CFN resource spec. TerraConstructs has no
 * equivalent generated-reference layer (see the identical omission on `IDatabaseInstance` in
 * `./instance.ts`), so `dbInstanceRef` is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/aurora-cluster-instance.ts#L439
 *
 * TERRACONSTRUCTS DEVIATION: `IAwsConstruct` instead of upstream's `IResource` — matches the
 * base-idiom used throughout this repo (`DatabaseInstanceBase`/`DatabaseClusterBase`).
 */
export interface IAuroraClusterInstance extends IAwsConstruct {
  /**
   * The instance ARN
   */
  readonly dbInstanceArn: string;

  /**
   * The instance resource ID
   */
  readonly dbiResourceId: string;

  /**
   * The instance endpoint address
   */
  readonly dbInstanceEndpointAddress: string;

  /**
   * The instance identifier
   */
  readonly instanceIdentifier: string;

  /**
   * The instance type (provisioned vs serverless v2)
   */
  readonly type: InstanceType;

  /**
   * The instance size if the instance is a provisioned type
   */
  readonly instanceSize?: string;

  /**
   * The promotion tier the instance was created in
   */
  readonly tier: number;

  /**
   * Whether Performance Insights is enabled
   */
  readonly performanceInsightsEnabled?: boolean;

  /**
   * The amount of time, in days, to retain Performance Insights data.
   */
  readonly performanceInsightRetention?: PerformanceInsightRetention;

  /**
   * The AWS KMS key for encryption of Performance Insights data.
   *
   * TERRACONSTRUCTS DEVIATION: `encryption.IKey` instead of upstream's `kms.IKey` — see
   * `ClusterInstanceOptions.performanceInsightEncryptionKey` above.
   */
  readonly performanceInsightEncryptionKey?: encryption.IKey;
}

class AuroraClusterInstance
  extends AwsConstructBase
  implements IAuroraClusterInstance
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.AuroraClusterInstance";

  public readonly dbiResourceId: string;
  public readonly dbInstanceEndpointAddress: string;
  public readonly instanceIdentifier: string;

  public readonly type: InstanceType;
  public readonly tier: number;
  public readonly instanceSize?: string;
  public readonly performanceInsightsEnabled: boolean;
  public readonly performanceInsightRetention?: PerformanceInsightRetention;
  public readonly performanceInsightEncryptionKey?: encryption.IKey;

  /**
   * The underlying `aws_rds_cluster_instance` L1.
   */
  public readonly resource: rdsClusterInstance.RdsClusterInstance;

  /**
   * The instance ARN.
   *
   * TERRACONSTRUCTS DEVIATION: read directly off the L1's own `arn` computed attribute instead of
   * upstream's `getResourceArnAttribute` two-phase CFN Ref/attribute resolution (no CDKTF
   * equivalent is needed — the provider resolves and returns the real ARN itself).
   */
  public readonly dbInstanceArn: string;

  constructor(scope: Construct, id: string, props: AuroraClusterInstanceProps) {
    super(scope, props.isFromLegacyInstanceProps ? `${id}Wrapper` : id, {});
    this.tier = props.promotionTier ?? 2;
    if (this.tier < 0 || this.tier > 15) {
      throw new ValidationError("promotionTier must be between 0-15", this);
    }

    const isOwnedResource = AwsConstructBase.isOwnedResource(props.cluster);
    let internetConnected;
    let publiclyAccessible = props.publiclyAccessible;
    if (isOwnedResource) {
      const ownedCluster = props.cluster as DatabaseCluster;
      internetConnected = ownedCluster.vpc.selectSubnets(
        ownedCluster.vpcSubnets,
      ).internetConnectivityEstablished;
      const isInPublicSubnet =
        ownedCluster.vpcSubnets &&
        ownedCluster.vpcSubnets.subnetType === ec2.SubnetType.PUBLIC;
      publiclyAccessible = props.publiclyAccessible ?? isInPublicSubnet;
    }

    // Get the actual subnet objects so we can depend on internet connectivity.
    const instanceType =
      props.instanceType ?? ClusterInstanceType.serverlessV2();
    this.type = instanceType.type;
    this.instanceSize =
      this.type === InstanceType.PROVISIONED
        ? instanceType.toString()
        : undefined;

    // engine is never undefined on a managed resource, i.e. DatabaseCluster
    const engine = props.cluster.engine!;
    const enablePerformanceInsights =
      props.enablePerformanceInsights ||
      props.performanceInsightRetention !== undefined ||
      props.performanceInsightEncryptionKey !== undefined;
    if (
      enablePerformanceInsights &&
      props.enablePerformanceInsights === false
    ) {
      throw new ValidationError(
        "`enablePerformanceInsights` disabled, but `performanceInsightRetention` or `performanceInsightEncryptionKey` was set",
        this,
      );
    }

    this.performanceInsightsEnabled = enablePerformanceInsights;
    this.performanceInsightRetention = enablePerformanceInsights
      ? props.performanceInsightRetention || PerformanceInsightRetention.DEFAULT
      : undefined;
    this.performanceInsightEncryptionKey =
      props.performanceInsightEncryptionKey;

    // TERRACONSTRUCTS DEVIATION: upstream branches on the
    // `AURORA_CLUSTER_CHANGE_SCOPE_OF_INSTANCE_PARAMETER_GROUP_WITH_EACH_PARAMETERS` feature flag
    // between scoping an auto-generated instance parameter group to `this` (corrected behavior) or
    // to `props.cluster` (legacy behavior, kept only for backward compatibility with already
    // deployed CFN stacks). `core.FeatureFlags` is not ported in this repo (see the identical,
    // always-corrected-behavior note on `RDS_LOWERCASE_DB_IDENTIFIER` in `./instance.ts`), so the
    // corrected (`this`-scoped) behavior is simply the only behavior here.
    const instanceParameterGroup =
      props.parameterGroup ??
      (props.parameters
        ? new ParameterGroup(this, "InstanceParameterGroup", {
            engine,
            parameters: props.parameters,
          })
        : undefined);
    const instanceParameterGroupConfig = instanceParameterGroup?.bindToInstance(
      {},
    );

    // TERRACONSTRUCTS DEVIATION: repo invariant -- unnamed resources get a gridUUID-scoped
    // `uniqueResourceName` default (RDS always lowercases DB instance identifiers server-side) --
    // see the identical idiom on `DatabaseInstanceNewProps.instanceIdentifier` in `./instance.ts`.
    // EXCEPTION: when migrating from the legacy `instanceProps`-based cluster API
    // (`isFromLegacyInstanceProps: true`), `legacyCreateInstances` (above) deliberately leaves
    // `identifier` unset whenever neither `instanceIdentifierBase` nor `clusterIdentifier` is
    // provided, relying on the provider's own auto-naming instead. Both code paths construct the
    // same `aws_rds_cluster_instance` (same scope/id) for an already-deployed legacy cluster, so
    // applying the `uniqueResourceName` fallback here too would add a brand-new `identifier`
    // argument to an existing resource and force a replacement. Leaving it unset in the legacy path
    // keeps the migration template-neutral; callers who want a stable, grid-scoped name on a legacy
    // cluster's instances must pass `instanceIdentifier` explicitly.
    const instanceIdentifier = Token.isUnresolved(props.instanceIdentifier)
      ? props.instanceIdentifier
      : props.isFromLegacyInstanceProps
        ? props.instanceIdentifier?.toLowerCase()
        : (
            props.instanceIdentifier ??
            this.stack.uniqueResourceName(this, { maxLength: 63 })
          ).toLowerCase();

    const instance = new rdsClusterInstance.RdsClusterInstance(
      props.isFromLegacyInstanceProps ? scope : this,
      props.isFromLegacyInstanceProps ? id : "Resource",
      {
        // Link to cluster
        engine: engine.engineType,
        clusterIdentifier: props.cluster.clusterIdentifier,
        promotionTier: props.isFromLegacyInstanceProps ? undefined : this.tier,
        identifier: instanceIdentifier,
        // Instance properties
        // TERRACONSTRUCTS DEVIATION: `instanceClass` is a REQUIRED argument on the Terraform
        // `aws_rds_cluster_instance` resource (unlike CFN's optional `DBInstanceClass`, guarded
        // upstream by `props.instanceType ? ... : undefined`). `ClusterInstanceProps.instanceType`
        // is itself non-optional (always supplied by `ClusterInstance.provisioned()`/
        // `.serverlessV2()`), so it is always rendered here.
        instanceClass: databaseInstanceType(instanceType),
        publiclyAccessible,
        availabilityZone: props.availabilityZone,
        preferredMaintenanceWindow: props.preferredMaintenanceWindow,
        performanceInsightsEnabled:
          this.performanceInsightsEnabled || props.enablePerformanceInsights, // fall back to undefined if not set
        performanceInsightsKmsKeyId:
          this.performanceInsightEncryptionKey?.keyArn,
        performanceInsightsRetentionPeriod: this.performanceInsightRetention,
        // only need to supply this when migrating from legacy method.
        // this is not applicable for aurora instances, but if you do provide it and then
        // change it it will cause an instance replacement
        dbSubnetGroupName: props.isFromLegacyInstanceProps
          ? props.subnetGroup?.subnetGroupName
          : undefined,
        dbParameterGroupName: instanceParameterGroupConfig?.parameterGroupName,
        monitoringInterval: props.monitoringInterval?.toSeconds(),
        monitoringRoleArn: props.monitoringRole?.roleArn,
        autoMinorVersionUpgrade: props.autoMinorVersionUpgrade,
        caCertIdentifier: props.caCertificate && props.caCertificate.toString(),
        applyImmediately: props.applyImmediately,
      },
    );

    // We must have a dependency on the NAT gateway provider here to create
    // things in the right order.
    if (internetConnected) {
      instance.node.addDependency(internetConnected);
    }

    this.resource = instance;
    this.dbiResourceId = instance.dbiResourceId;
    this.dbInstanceEndpointAddress = instance.endpoint;
    this.instanceIdentifier = instance.identifier;
    this.dbInstanceArn = instance.arn;
  }

  public get outputs(): Record<string, any> {
    return {
      identifier: this.instanceIdentifier,
      arn: this.dbInstanceArn,
      endpointAddress: this.dbInstanceEndpointAddress,
      resourceId: this.dbiResourceId,
    };
  }
}

/**
 * Turn a regular instance type into a database instance type
 */
function databaseInstanceType(instanceType: ClusterInstanceType) {
  const type = instanceType.toString();
  return instanceType.type === InstanceType.SERVERLESS_V2 ? type : "db." + type;
}
