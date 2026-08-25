// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/lib/cluster.ts

import { neptuneCluster, neptuneClusterInstance } from "@cdktn/provider-aws";
import { Annotations, Lazy, Token, Tokenization } from "cdktn";
import { Construct } from "constructs";
import { Endpoint } from "./endpoint";
import { InstanceType } from "./instance";
import type {
  IClusterParameterGroup,
  IParameterGroup,
} from "./parameter-group";
import type { ISubnetGroup } from "./subnet-group";
import { SubnetGroup } from "./subnet-group";
import type { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as cloudwatch from "../../cloudwatch";
import * as ec2 from "../../compute";
import type * as encryption from "../../encryption";
import * as iam from "../../iam";

/**
 * Possible Instances Types to use in Neptune cluster
 * used for defining `DatabaseClusterProps.engineVersion`.
 */
export class EngineVersion {
  /**
   * Neptune engine version 1.0.1.0
   */
  public static readonly V1_0_1_0 = new EngineVersion("1.0.1.0");
  /**
   * Neptune engine version 1.0.1.1
   */
  public static readonly V1_0_1_1 = new EngineVersion("1.0.1.1");
  /**
   * Neptune engine version 1.0.1.2
   */
  public static readonly V1_0_1_2 = new EngineVersion("1.0.1.2");
  /**
   * Neptune engine version 1.0.2.1
   */
  public static readonly V1_0_2_1 = new EngineVersion("1.0.2.1");
  /**
   * Neptune engine version 1.0.2.2
   */
  public static readonly V1_0_2_2 = new EngineVersion("1.0.2.2");
  /**
   * Neptune engine version 1.0.3.0
   */
  public static readonly V1_0_3_0 = new EngineVersion("1.0.3.0");
  /**
   * Neptune engine version 1.0.4.0
   */
  public static readonly V1_0_4_0 = new EngineVersion("1.0.4.0");
  /**
   * Neptune engine version 1.0.4.1
   */
  public static readonly V1_0_4_1 = new EngineVersion("1.0.4.1");
  /**
   * Neptune engine version 1.0.5.0
   */
  public static readonly V1_0_5_0 = new EngineVersion("1.0.5.0");
  /**
   * Neptune engine version 1.1.0.0
   */
  public static readonly V1_1_0_0 = new EngineVersion("1.1.0.0");
  /**
   * Neptune engine version 1.1.1.0
   */
  public static readonly V1_1_1_0 = new EngineVersion("1.1.1.0");
  /**
   * Neptune engine version 1.2.0.0
   */
  public static readonly V1_2_0_0 = new EngineVersion("1.2.0.0");
  /**
   * Neptune engine version 1.2.0.1
   */
  public static readonly V1_2_0_1 = new EngineVersion("1.2.0.1");
  /**
   * Neptune engine version 1.2.0.2
   */
  public static readonly V1_2_0_2 = new EngineVersion("1.2.0.2");
  /**
   * Neptune engine version 1.2.1.0
   */
  public static readonly V1_2_1_0 = new EngineVersion("1.2.1.0");
  /**
   * Neptune engine version 1.2.1.1
   */
  public static readonly V1_2_1_1 = new EngineVersion("1.2.1.1");
  /**
   * Neptune engine version 1.2.1.2
   */
  public static readonly V1_2_1_2 = new EngineVersion("1.2.1.2");
  /**
   * Neptune engine version 1.3.0.0
   */
  public static readonly V1_3_0_0 = new EngineVersion("1.3.0.0");
  /**
   * Neptune engine version 1.3.1.0
   */
  public static readonly V1_3_1_0 = new EngineVersion("1.3.1.0");
  /**
   * Neptune engine version 1.3.2.0
   */
  public static readonly V1_3_2_0 = new EngineVersion("1.3.2.0");
  /**
   * Neptune engine version 1.3.2.1
   */
  public static readonly V1_3_2_1 = new EngineVersion("1.3.2.1");
  /**
   * Neptune engine version 1.3.3.0
   */
  public static readonly V1_3_3_0 = new EngineVersion("1.3.3.0");
  /**
   * Neptune engine version 1.3.4.0
   */
  public static readonly V1_3_4_0 = new EngineVersion("1.3.4.0");
  /**
   * Neptune engine version 1.4.0.0
   */
  public static readonly V1_4_0_0 = new EngineVersion("1.4.0.0");
  /**
   * Neptune engine version 1.4.1.0
   */
  public static readonly V1_4_1_0 = new EngineVersion("1.4.1.0");
  /**
   * Neptune engine version 1.4.2.0
   */
  public static readonly V1_4_2_0 = new EngineVersion("1.4.2.0");
  /**
   * Neptune engine version 1.4.3.0
   */
  public static readonly V1_4_3_0 = new EngineVersion("1.4.3.0");
  /**
   * Neptune engine version 1.4.4.0
   */
  public static readonly V1_4_4_0 = new EngineVersion("1.4.4.0");
  /**
   * Neptune engine version 1.4.5.0
   */
  public static readonly V1_4_5_0 = new EngineVersion("1.4.5.0");
  /**
   * Neptune engine version 1.4.5.1
   */
  public static readonly V1_4_5_1 = new EngineVersion("1.4.5.1");
  /**
   * Neptune engine version 1.4.6.0
   */
  public static readonly V1_4_6_0 = new EngineVersion("1.4.6.0");
  /**
   * Neptune engine version 1.4.6.1
   */
  public static readonly V1_4_6_1 = new EngineVersion("1.4.6.1");

  /**
   * Constructor for specifying a custom engine version
   * @param version the engine version of Neptune
   */
  public constructor(public readonly version: string) {}
}

/**
 * Neptune log types that can be exported to CloudWatch logs
 *
 * @see https://docs.aws.amazon.com/neptune/latest/userguide/cloudwatch-logs.html
 */
export class LogType {
  /**
   * Audit logs
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/auditing.html
   */
  public static readonly AUDIT = new LogType("audit");

  /**
   * Constructor for specifying a custom log type
   * @param value the log type
   */
  public constructor(public readonly value: string) {}
}

/**
 * ServerlessV2 scaling configuration for Neptune clusters.
 */
export interface ServerlessScalingConfiguration {
  /**
   * Minimum NCU capacity (min value 1)
   */
  readonly minCapacity: number;

  /**
   * Maximum NCU capacity (min value 2.5 - max value 128)
   */
  readonly maxCapacity: number;
}

/**
 * Properties for a new database cluster
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `DatabaseClusterProps` does not — matching the base-idiom used throughout this
 * repo (e.g. `DatabaseClusterProps` in `../docdb/cluster.ts`) for cross-account/-region construct
 * placement.
 *
 * NOTE: unlike `../rds/cluster.ts` and `../docdb/cluster.ts`, Neptune clusters have no
 * username/password (`Login`/`Credentials`) surface at all upstream — Neptune access is governed by
 * IAM authentication (`iamAuthentication`/`grant`/`grantConnect` below) or left fully open, so there
 * is no generated-password `DatabaseSecret` to port here.
 */
export interface DatabaseClusterProps extends AwsConstructProps {
  /**
   * What version of the database to start
   *
   * @default - The default engine version.
   */
  readonly engineVersion?: EngineVersion;

  /**
   * How many days to retain the backup
   *
   * @default - cdk.Duration.days(1)
   */
  readonly backupRetention?: Duration;

  /**
   * A daily time range in 24-hours UTC format in which backups preferably execute.
   *
   * Must be at least 30 minutes long.
   *
   * Example: '01:00-02:00'
   *
   * @default - a 30-minute window selected at random from an 8-hour block of
   * time for each AWS Region. To see the time blocks available, see
   */
  readonly preferredBackupWindow?: string;

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
   * Number of Neptune compute instances
   *
   * @default 1
   */
  readonly instances?: number;

  /**
   * An optional identifier for the cluster
   *
   * If you specify a name, it is lowercased at synth: Neptune stores DB
   * identifiers lowercase server-side, and emitting the original casing would
   * report a perpetual Terraform diff.
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly dbClusterName?: string;

  /**
   * Map AWS Identity and Access Management (IAM) accounts to database accounts
   *
   * @default - `false`
   */
  readonly iamAuthentication?: boolean;

  /**
   * Base identifier for instances
   *
   * Every replica is named by appending the replica number to this string, 1-based.
   *
   * If you specify a base, it is lowercased at synth (Neptune stores DB identifiers lowercase
   * server-side; see `dbClusterName`).
   *
   * @default - `dbClusterName` is used with the word "Instance" appended. If `dbClusterName` is not provided, the
   * identifier is automatically generated.
   */
  readonly instanceIdentifierBase?: string;

  /**
   * What type of instance to start for the replicas
   */
  readonly instanceType: InstanceType;

  /**
   * A list of AWS Identity and Access Management (IAM) role that can be used by the cluster to access other AWS services.
   *
   * @default - No role is attached to the cluster.
   */
  readonly associatedRoles?: iam.IRole[];

  /**
   * Indicates whether the DB cluster should have deletion protection enabled.
   *
   * TERRACONSTRUCTS DEVIATION: upstream defaults to `true if removalPolicy is RETAIN, false
   * otherwise`. `core.RemovalPolicy` is not ported in this repo (see `skipFinalSnapshot` below), so
   * this defaults straight through to the provider default (`false`) instead.
   *
   * @default false
   */
  readonly deletionProtection?: boolean;

  /**
   * A weekly time range in which maintenance should preferably execute.
   *
   * Must be at least 30 minutes long.
   *
   * Example: 'tue:04:17-tue:04:47'
   *
   * @default - 30-minute window selected at random from an 8-hour block of time for
   * each AWS Region, occurring on a random day of the week.
   */
  readonly preferredMaintenanceWindow?: string;

  /**
   * Additional parameters to pass to the database engine
   *
   * @default - No parameter group.
   */
  readonly clusterParameterGroup?: IClusterParameterGroup;

  /**
   * The DB parameter group to associate with the instance.
   *
   * @default no parameter group
   */
  readonly parameterGroup?: IParameterGroup;

  /**
   * Existing subnet group for the cluster.
   *
   * @default - a new subnet group will be created.
   */
  readonly subnetGroup?: ISubnetGroup;

  /**
   * What subnets to run the Neptune instances in.
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
  readonly securityGroups?: ec2.ISecurityGroup[];

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.RETAIN`,
  // applied uniformly to the cluster, its auto-created instances, and its auto-created security
  // group) is CloudFormation's DeletionPolicy concept. `core.RemovalPolicy` is not ported anywhere
  // in this repo (see the identical omission on `DatabaseClusterProps` in `../docdb/cluster.ts` and
  // `../rds/cluster.ts`). Terraform's `aws_neptune_cluster` exposes the cluster-level equivalent
  // natively via `skipFinalSnapshot`/`finalSnapshotIdentifier` below -- the TERRACONSTRUCTS-native
  // replacement --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/lib/cluster.ts#L128-L134
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — native Terraform replacement for upstream's
   * `removalPolicy` (see the TODO above). Whether Terraform should take a final DB snapshot before
   * destroying this cluster. When `false` (the default) and `finalSnapshotIdentifier` is not set,
   * `terraform destroy`/replace will FAIL at apply-time with an AWS API error (native
   * `aws_neptune_cluster` behavior, not enforced here at synth time). Also threaded through to each
   * auto-created `aws_neptune_cluster_instance` below (mirroring upstream's single `removalPolicy`
   * governing the cluster AND its instances together).
   *
   * @default false (a final snapshot is taken on delete/replace, so `finalSnapshotIdentifier` should
   * also be set)
   */
  readonly skipFinalSnapshot?: boolean;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see `skipFinalSnapshot` above. The identifier
   * for the final DB cluster snapshot Terraform takes before destroying this cluster. Unlike
   * CloudFormation (which auto-generates a snapshot name), Terraform requires this to be supplied
   * explicitly.
   *
   * @default - no final snapshot identifier; required unless `skipFinalSnapshot` is `true`
   */
  readonly finalSnapshotIdentifier?: string;

  /**
   * If set to true, Neptune will automatically update the engine of the entire
   * cluster to the latest minor version after a stabilization window of 2 to 3 weeks.
   *
   * @default - false
   */
  readonly autoMinorVersionUpgrade?: boolean;

  /**
   * The list of log types that need to be enabled for exporting to
   * CloudWatch Logs.
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/cloudwatch-logs.html
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/auditing.html#auditing-enable
   *
   * @default - no log exports
   */
  readonly cloudwatchLogsExports?: LogType[];

  // TODO: omitted — upstream's `cloudwatchLogsRetention?: logs.RetentionDays` and
  // `cloudwatchLogsRetentionRole?: iam.IRole` (and the Lambda-backed `logs.LogRetention` custom
  // resource machinery that consumes them) are dropped for the identical reason given on
  // `DatabaseClusterProps.cloudWatchLogsRetention` in `../docdb/cluster.ts` — there is no
  // Terraform-native equivalent of upstream's Lambda-backed custom resource; the
  // `aws_neptune_cluster` resource only controls WHICH logs are exported
  // (`enable_cloudwatch_logs_exports`, ported above via `cloudwatchLogsExports`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/lib/cluster.ts#L207-L221
  // readonly cloudwatchLogsRetention?: logs.RetentionDays;
  // readonly cloudwatchLogsRetentionRole?: iam.IRole;

  /**
   * Specify minimum and maximum NCUs capacity for a serverless cluster.
   * See https://docs.aws.amazon.com/neptune/latest/userguide/neptune-serverless-capacity-scaling.html
   *
   * @default - required if instanceType is db.serverless
   */
  readonly serverlessScalingConfiguration?: ServerlessScalingConfiguration;

  /**
   * Whether to copy tags to the snapshot when a snapshot is created.
   *
   * @default - false
   */
  readonly copyTagsToSnapshot?: boolean;

  /**
   * The port number on which the DB instances in the DB cluster accept connections.
   *
   * @default 8182
   */
  readonly port?: number;
}

/**
 * Create a clustered database with a given number of instances.
 *
 * TODO: omitted — upstream also extends `cdk.IResource`-equivalent generated-reference typing is
 * not applicable here; see the identical omission note on `IDatabaseCluster` in
 * `../docdb/cluster-ref.ts`.
 */
export interface IDatabaseCluster extends IAwsConstruct, ec2.IConnectable {
  /**
   * Identifier of the cluster
   */
  readonly clusterIdentifier: string;

  /**
   * Resource identifier of the cluster
   */
  readonly clusterResourceIdentifier: string;

  /**
   * The endpoint to use for read/write operations
   */
  readonly clusterEndpoint: Endpoint;

  /**
   * Endpoint to use for load-balanced read-only operations.
   */
  readonly clusterReadEndpoint: Endpoint;

  /**
   * Grant the given identity the specified actions
   * @param grantee the identity to be granted the actions
   * @param actions the data-access actions
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/iam-dp-actions.html
   */
  grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant;

  /**
   * Grant the given identity connection access to the database.
   */
  grantConnect(grantee: iam.IGrantable): iam.Grant;

  /**
   * Return the given named metric associated with this DatabaseCluster instance
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/cw-metrics.html
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/cw-dimensions.html
   */
  metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;
}

/**
 * Properties that describe an existing cluster instance
 */
export interface DatabaseClusterAttributes {
  /**
   * The database port
   */
  readonly port: number;

  /**
   * The security group of the database cluster
   */
  readonly securityGroup: ec2.ISecurityGroup;

  /**
   * Identifier for the cluster
   */
  readonly clusterIdentifier: string;

  /**
   * Resource Identifier for the cluster
   */
  readonly clusterResourceIdentifier: string;

  /**
   * Cluster endpoint address
   */
  readonly clusterEndpointAddress: string;

  /**
   * Reader endpoint address
   */
  readonly readerEndpointAddress: string;
}

/**
 * A new or imported database cluster.
 */
export abstract class DatabaseClusterBase
  extends AwsConstructBase
  implements IDatabaseCluster
{
  /**
   * Import an existing DatabaseCluster from properties
   */
  public static fromDatabaseClusterAttributes(
    scope: Construct,
    id: string,
    attrs: DatabaseClusterAttributes,
  ): IDatabaseCluster {
    class Import extends DatabaseClusterBase implements IDatabaseCluster {
      public readonly defaultPort = ec2.Port.tcp(attrs.port);
      public readonly connections = new ec2.Connections({
        securityGroups: [attrs.securityGroup],
        defaultPort: this.defaultPort,
      });
      public readonly clusterIdentifier = attrs.clusterIdentifier;
      public readonly clusterResourceIdentifier =
        attrs.clusterResourceIdentifier;
      public readonly clusterEndpoint = new Endpoint(
        attrs.clusterEndpointAddress,
        attrs.port,
      );
      public readonly clusterReadEndpoint = new Endpoint(
        attrs.readerEndpointAddress,
        attrs.port,
      );
      protected enableIamAuthentication = true;
    }

    return new Import(scope, id, {});
  }

  /**
   * Identifier of the cluster
   */
  public abstract readonly clusterIdentifier: string;

  /**
   * Resource identifier of the cluster
   */
  public abstract readonly clusterResourceIdentifier: string;

  /**
   * The endpoint to use for read/write operations
   */
  public abstract readonly clusterEndpoint: Endpoint;

  /**
   * Endpoint to use for load-balanced read-only operations.
   */
  public abstract readonly clusterReadEndpoint: Endpoint;

  /**
   * The connections object to implement IConnectable
   */
  public abstract readonly connections: ec2.Connections;

  protected abstract enableIamAuthentication?: boolean;

  /**
   * [disable-awslint:no-grants]
   */
  public grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    if (this.enableIamAuthentication === false) {
      throw new ValidationError(
        "Cannot grant permissions when IAM authentication is disabled",
        this,
      );
    }

    this.enableIamAuthentication = true;
    return iam.Grant.addToPrincipal({
      grantee,
      actions,
      resourceArns: [
        this.stack.formatArn({
          service: "neptune-db",
          resource: `${this.clusterResourceIdentifier}/*`,
        }),
      ],
    });
  }

  /**
   * [disable-awslint:no-grants]
   */
  public grantConnect(grantee: iam.IGrantable): iam.Grant {
    return this.grant(grantee, "neptune-db:*");
  }

  public metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/Neptune",
      dimensionsMap: {
        DBClusterIdentifier: this.clusterIdentifier,
      },
      metricName,
      ...props,
    });
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `DatabaseClusterBase.outputs` in `../docdb/cluster.ts`) — bare, bound-per-construct `outputs`
   * for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      identifier: this.clusterIdentifier,
      endpointAddress: this.clusterEndpoint.hostname,
      endpointPort: Tokenization.stringifyNumber(this.clusterEndpoint.port),
      readEndpointAddress: this.clusterReadEndpoint.hostname,
    };
  }
}

/**
 * Create a clustered database with a given number of instances.
 *
 * @resource aws_neptune_cluster
 */
export class DatabaseCluster extends DatabaseClusterBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.neptune.DatabaseCluster";
  /**
   * The default number of instances in the Neptune cluster if none are
   * specified
   */
  public static readonly DEFAULT_NUM_INSTANCES = 1;

  public readonly clusterIdentifier: string;
  public readonly clusterEndpoint: Endpoint;
  public readonly clusterReadEndpoint: Endpoint;
  public readonly connections: ec2.Connections;

  /**
   * The resource id for the cluster; for example: cluster-ABCD1234EFGH5678IJKL90MNOP. The cluster ID uniquely
   * identifies the cluster and is used in things like IAM authentication policies.
   */
  public readonly clusterResourceIdentifier: string;

  /**
   * The VPC where the DB subnet group is created.
   */
  public readonly vpc: ec2.IVpc;

  /**
   * The subnets used by the DB subnet group.
   */
  public readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Subnet group used by the DB
   */
  public readonly subnetGroup: ISubnetGroup;

  /**
   * Identifiers of the instance
   */
  public readonly instanceIdentifiers: string[] = [];

  /**
   * Endpoints which address each individual instance.
   */
  public readonly instanceEndpoints: Endpoint[] = [];

  protected enableIamAuthentication?: boolean;

  /**
   * The underlying `aws_neptune_cluster` L1.
   */
  public readonly resource: neptuneCluster.NeptuneCluster;

  constructor(scope: Construct, id: string, props: DatabaseClusterProps) {
    super(scope, id, props);

    this.vpc = props.vpc;
    this.vpcSubnets = props.vpcSubnets ?? {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };

    // Determine the subnet(s) to deploy the Neptune cluster to
    const { subnetIds, internetConnectivityEstablished } =
      this.vpc.selectSubnets(this.vpcSubnets);

    // Cannot test whether the subnets are in different AZs, but at least we can test the amount.
    if (subnetIds.length < 2) {
      throw new ValidationError(
        `Cluster requires at least 2 subnets, got ${subnetIds.length}`,
        this,
      );
    }

    this.subnetGroup =
      props.subnetGroup ??
      new SubnetGroup(this, "Subnets", {
        description: `Subnets for ${id} database`,
        vpc: this.vpc,
        vpcSubnets: this.vpcSubnets,
      });

    const securityGroups = props.securityGroups ?? [
      new ec2.SecurityGroup(this, "SecurityGroup", {
        description: "Neptune security group",
        vpc: this.vpc,
      }),
    ];

    // Default to encrypted storage
    const storageEncrypted = props.storageEncrypted ?? true;

    if (props.kmsKey && !storageEncrypted) {
      throw new ValidationError(
        "KMS key supplied but storageEncrypted is false",
        this,
      );
    }

    this.enableIamAuthentication = props.iamAuthentication;

    if (
      props.instanceType === InstanceType.SERVERLESS &&
      !props.serverlessScalingConfiguration
    ) {
      throw new ValidationError(
        "You need to specify a serverless scaling configuration with a db.serverless instance type.",
        this,
      );
    }

    this.validateServerlessScalingConfiguration(
      props.serverlessScalingConfiguration,
    );

    // TERRACONSTRUCTS DEVIATION: hoisted so the auto-created instances below can reuse the
    // derived (gridUUID-scoped, lowercased) cluster identifier as their name base -- see the
    // instance-identifier note in the creation loop. `ClusterIdentifier` is capped at 63
    // characters, but a shorter cap is used here to leave room for the `instanceN` suffix
    // appended below (mirrors `../docdb/cluster.ts`'s identical `derivedClusterIdentifier` idiom).
    const derivedClusterIdentifier = Token.isUnresolved(props.dbClusterName)
      ? props.dbClusterName
      : (
          props.dbClusterName ??
          this.stack.uniqueResourceName(this, { maxLength: 55 })
        ).toLowerCase();

    // Create the Neptune cluster
    const cluster = new neptuneCluster.NeptuneCluster(this, "Resource", {
      // Basic
      engineVersion: props.engineVersion?.version,
      clusterIdentifier: derivedClusterIdentifier,
      neptuneSubnetGroupName: this.subnetGroup.subnetGroupName,
      vpcSecurityGroupIds: securityGroups.map((sg) => sg.securityGroupId),
      neptuneClusterParameterGroupName:
        props.clusterParameterGroup?.clusterParameterGroupName,
      deletionProtection: props.deletionProtection,
      iamRoles: props.associatedRoles?.map((role) => role.roleArn),
      // TERRACONSTRUCTS DEVIATION: upstream sets `iamAuthEnabled` via `Lazy.any({ produce: () =>
      // this.enableIamAuthentication })` so that a later `grant()`/`grantConnect()` call (which
      // flips `enableIamAuthentication` to `true` after construction) is still reflected at
      // CloudFormation synth time. `Lazy.anyValue()` is the equivalent CDKTF idiom for a scalar
      // (non-block) L1 attribute -- see the identical idiom on `enableHttpEndpoint` in
      // `../rds/cluster.ts`.
      iamDatabaseAuthenticationEnabled: Lazy.anyValue({
        produce: () => this.enableIamAuthentication,
      }),
      port: props.port,
      // Backup
      backupRetentionPeriod: props.backupRetention?.toDays(),
      preferredBackupWindow: props.preferredBackupWindow,
      preferredMaintenanceWindow: props.preferredMaintenanceWindow,
      // Encryption
      // TERRACONSTRUCTS DEVIATION / ID-vs-ARN AUDIT: `kmsKeyArn` (the Terraform argument name
      // matches upstream's ARN-form `kmsKeyId` 1:1 here) is fed the KMS key ARN, not a bare key
      // id -- AWS always reports the ARN back on read, so supplying the ARN up front avoids a
      // perpetual "inconsistent result after apply" diff (the #151 kms lesson).
      kmsKeyArn: props.kmsKey?.keyArn,
      // CloudWatch Logs exports
      enableCloudwatchLogsExports: props.cloudwatchLogsExports?.map(
        (logType) => logType.value,
      ),
      storageEncrypted,
      serverlessV2ScalingConfiguration: props.serverlessScalingConfiguration,
      // Tags
      copyTagsToSnapshot: props.copyTagsToSnapshot,
      skipFinalSnapshot: props.skipFinalSnapshot,
      finalSnapshotIdentifier: props.finalSnapshotIdentifier,
    } as neptuneCluster.NeptuneClusterConfig);

    this.resource = cluster;
    this.clusterIdentifier = cluster.clusterIdentifier;
    this.clusterResourceIdentifier = cluster.clusterResourceId;

    // TERRACONSTRUCTS DEVIATION: mirrors the identical `skipFinalSnapshot`/`finalSnapshotIdentifier`
    // synth-time warning on `DatabaseCluster` in `../docdb/cluster.ts` — see that note for the full
    // rationale.
    if (props.skipFinalSnapshot !== true && !props.finalSnapshotIdentifier) {
      Annotations.of(this).addWarning(
        "Neither `skipFinalSnapshot` nor `finalSnapshotIdentifier` is set: `terraform destroy` (or any change that replaces this cluster) will FAIL at apply time because the AWS provider requires `finalSnapshotIdentifier` when `skipFinalSnapshot` is not `true`. Set `skipFinalSnapshot: true` to skip the final snapshot, or set `finalSnapshotIdentifier` to a snapshot name.",
      );
    }

    // TERRACONSTRUCTS DEVIATION: upstream converts `cluster.attrPort` (a CFN `Fn::GetAtt` string
    // attribute) into a number token via `cdk.Token.asNumber(...)`. The CDKTF L1 `port` getter
    // already returns a native `number`-typed (Token-backed) attribute, so no string-to-number
    // conversion is needed here (identical deviation to `../docdb/cluster.ts`).
    const port = cluster.port;
    this.clusterEndpoint = new Endpoint(cluster.endpoint, port);
    this.clusterReadEndpoint = new Endpoint(cluster.readerEndpoint, port);

    // Create the instances
    const instanceCount =
      props.instances ?? DatabaseCluster.DEFAULT_NUM_INSTANCES;
    if (instanceCount < 1) {
      throw new ValidationError("At least one instance is required", this);
    }

    for (let i = 0; i < instanceCount; i++) {
      const instanceIndex = i + 1;

      // TERRACONSTRUCTS DEVIATION: upstream lets CloudFormation auto-generate a name from each
      // instance's per-index logical id (`Instance1`, `Instance2`, ...) when neither
      // `instanceIdentifierBase` nor `dbClusterName` is provided. A single
      // `uniqueResourceName(this, ...)` call would collide across loop iterations (shared
      // scope), so the repo naming invariant is preserved by reusing the DERIVED cluster
      // identifier (already gridUUID-scoped + lowercased above) as the per-instance base --
      // upstream's own fallback semantic (`dbClusterName` + "instance" + N), just with the
      // derived default instead of the raw prop (identical idiom to `../docdb/cluster.ts`).
      const instanceIdentifierBase =
        props.instanceIdentifierBase != null
          ? `${props.instanceIdentifierBase}${instanceIndex}`
          : `${derivedClusterIdentifier}instance${instanceIndex}`;
      const instanceIdentifier = Token.isUnresolved(instanceIdentifierBase)
        ? instanceIdentifierBase
        : instanceIdentifierBase.toLowerCase();

      const instance = new neptuneClusterInstance.NeptuneClusterInstance(
        this,
        `Instance${instanceIndex}`,
        {
          // Link to cluster
          clusterIdentifier: cluster.clusterIdentifier,
          identifier: instanceIdentifier,
          // Instance properties
          instanceClass: props.instanceType._instanceType,
          neptuneParameterGroupName: props.parameterGroup?.parameterGroupName,
          autoMinorVersionUpgrade: props.autoMinorVersionUpgrade === true,
          // TERRACONSTRUCTS DEVIATION: not present upstream — see `skipFinalSnapshot` on
          // `DatabaseClusterProps` above. Unlike upstream (a single `removalPolicy` applied to both
          // the cluster and its auto-created instances via `applyRemovalPolicy`), the cluster-level
          // `skipFinalSnapshot` flag is threaded through to each instance here as its own native
          // Terraform equivalent.
          skipFinalSnapshot: props.skipFinalSnapshot,
        },
      );

      // We must have a dependency on the NAT gateway provider here to create
      // things in the right order.
      instance.node.addDependency(internetConnectivityEstablished);

      this.instanceIdentifiers.push(instance.identifier);
      this.instanceEndpoints.push(new Endpoint(instance.endpoint, port));
    }

    this.connections = new ec2.Connections({
      defaultPort: ec2.Port.tcp(port),
      securityGroups,
    });
  }

  public get outputs(): Record<string, any> {
    return {
      ...super.outputs,
      arn: this.resource.arn,
    };
  }

  private validateServerlessScalingConfiguration(
    serverlessScalingConfiguration?: ServerlessScalingConfiguration,
  ) {
    if (!serverlessScalingConfiguration) return;
    if (serverlessScalingConfiguration.minCapacity < 1) {
      throw new ValidationError(
        `ServerlessScalingConfiguration minCapacity must be greater or equal than 1, received ${serverlessScalingConfiguration.minCapacity}`,
        this,
      );
    }
    if (
      serverlessScalingConfiguration.maxCapacity < 2.5 ||
      serverlessScalingConfiguration.maxCapacity > 128
    ) {
      throw new ValidationError(
        `ServerlessScalingConfiguration maxCapacity must be between 2.5 and 128, received ${serverlessScalingConfiguration.maxCapacity}`,
        this,
      );
    }
    if (
      serverlessScalingConfiguration.minCapacity >=
      serverlessScalingConfiguration.maxCapacity
    ) {
      throw new ValidationError(
        `ServerlessScalingConfiguration minCapacity ${serverlessScalingConfiguration.minCapacity} ` +
          `must be less than serverlessScalingConfiguration maxCapacity ${serverlessScalingConfiguration.maxCapacity}`,
        this,
      );
    }
  }
}
