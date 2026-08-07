// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/serverless-cluster.ts

import { rdsCluster } from "@cdktn/provider-aws";
import { Annotations, Lazy, Token, Tokenization } from "cdktn";
import { Construct } from "constructs";
import type { IClusterEngine } from "./cluster-engine";
import { DatabaseSecret } from "./database-secret";
import { Endpoint } from "./endpoint";
import type { IParameterGroup } from "./parameter-group";
import { DATA_API_ACTIONS } from "./perms";
import {
  applyDefaultRotationOptions,
  defaultDeletionProtection,
} from "./private/util";
import type {
  Credentials,
  RotationMultiUserOptions,
  RotationSingleUserOptions,
  SnapshotCredentials,
} from "./props";
import type { ISubnetGroup } from "./subnet-group";
import { SubnetGroup } from "./subnet-group";
import { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import { ArnFormat } from "../../arn";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as ec2 from "../../compute";
import type * as encryption from "../../encryption";
import * as secretsmanager from "../../encryption";
import * as iam from "../../iam";

/**
 * TERRACONSTRUCTS DEVIATION (AWS REALITY NOTE): Aurora Serverless v1 was RETIRED by AWS -- the
 * `engine_mode = "serverless"` variant of `aws_rds_cluster` is no longer creatable as of 2025 (AWS
 * strongly recommends migrating to Aurora Serverless v2, ported as `serverlessV2MinCapacity` /
 * `serverlessV2MaxCapacity` / `ClusterInstance.serverlessV2()` on `./cluster.ts`'s `DatabaseCluster`
 * instead). This entire module (`ServerlessCluster`, `ServerlessClusterFromSnapshot`, and their
 * shared plumbing) is ported below strictly for API/migration parity with upstream aws-cdk-lib --
 * live deployability against a real AWS account is NOT expected. Upstream aws-cdk-lib does not
 * itself mark this module `@deprecated` (Aurora Serverless v1 predates aws-cdk-lib's own
 * `@deprecated` convention), but every class in this file is marked `@deprecated` here to reflect
 * that reality for TerraConstructs consumers, in addition to this class-level retirement note. See
 * `./cluster.ts`'s `DatabaseCluster` (Aurora Serverless v2) for the actively-supported serverless
 * story.
 */

/**
 * Interface representing a serverless database cluster.
 *
 * TODO: omitted -- upstream also extends `aws_rds.IDBClusterRef`, a CloudFormation cross-stack
 * "Reference" marker interface generated from the CFN resource spec. TerraConstructs has no
 * equivalent generated-reference layer (identical omission to `IDatabaseCluster.dbClusterRef` in
 * `./cluster-ref.ts` -- see the TODO there), so `dbClusterRef` is dropped --
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/serverless-cluster.ts#L45
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note above. Use `DatabaseCluster` with `ClusterInstance.serverlessV2()` (Aurora Serverless v2)
 * instead.
 */
export interface IServerlessCluster
  extends IAwsConstruct,
    ec2.IConnectable,
    secretsmanager.ISecretAttachmentTarget {
  /**
   * Identifier of the cluster
   */
  readonly clusterIdentifier: string;

  /**
   * The ARN of the cluster
   */
  readonly clusterArn: string;

  /**
   * The endpoint to use for read/write operations
   */
  readonly clusterEndpoint: Endpoint;

  /**
   * Endpoint to use for load-balanced read-only operations.
   */
  readonly clusterReadEndpoint: Endpoint;

  /**
   * Grant the given identity to access to the Data API.
   *
   * [disable-awslint:no-grants]
   *
   * @param grantee The principal to grant access to
   */
  grantDataApiAccess(grantee: iam.IGrantable): iam.Grant;
}

/**
 *  Common Properties to configure new Aurora Serverless v1 Cluster or Aurora Serverless v1 Cluster from snapshot
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn), which
 * upstream's `ServerlessClusterNewProps` does not -- matching the base-idiom used throughout this
 * repo (e.g. `DatabaseClusterBaseProps` in `./cluster.ts`) for cross-account/-region construct
 * placement.
 */
interface ServerlessClusterNewProps extends AwsConstructProps {
  /**
   * What kind of database to start
   */
  readonly engine: IClusterEngine;

  /**
   * An optional identifier for the cluster
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly clusterIdentifier?: string;

  /**
   * The number of days during which automatic DB snapshots are retained.
   * Automatic backup retention cannot be disabled on serverless clusters.
   * Must be a value from 1 day to 35 days.
   *
   * @default Duration.days(1)
   */
  readonly backupRetention?: Duration;

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
   * below, and the identical omission on `DatabaseClusterBaseProps.deletionProtection` in
   * `./cluster.ts`), so only the explicit flag is honored (see `defaultDeletionProtection` in
   * `./private/util.ts`).
   *
   * @default false
   */
  readonly deletionProtection?: boolean;

  // TODO: omitted -- upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.SNAPSHOT`) is
  // CloudFormation's DeletionPolicy concept. `core.RemovalPolicy` is not ported anywhere in this repo
  // (see the identical omission on `DatabaseClusterBaseProps.removalPolicy` in `./cluster.ts`).
  // Terraform's `aws_rds_cluster` exposes the equivalent semantics natively via
  // `skipFinalSnapshot`/`finalSnapshotIdentifier` below -- the TERRACONSTRUCTS-native replacement,
  // mirroring `./cluster.ts` exactly --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/serverless-cluster.ts#L149-L154
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream -- native Terraform replacement for upstream's
   * `removalPolicy` (see the TODO above). Whether Terraform should take a final DB snapshot before
   * destroying this cluster. When `false` (the default -- matching upstream's `RemovalPolicy.SNAPSHOT`
   * default) and `finalSnapshotIdentifier` is not set, `terraform destroy`/replace will FAIL at
   * apply-time with an AWS API error (native `aws_rds_cluster` behavior, not enforced here at synth
   * time). Mirrors `DatabaseClusterBaseProps.skipFinalSnapshot` in `./cluster.ts`.
   *
   * @default false (a final snapshot is taken on delete/replace, so `finalSnapshotIdentifier` should
   * also be set)
   */
  readonly skipFinalSnapshot?: boolean;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream -- see `skipFinalSnapshot` above. The identifier
   * for the final DB cluster snapshot Terraform takes before destroying this cluster. Unlike
   * CloudFormation (which auto-generates a snapshot name), Terraform requires this to be supplied
   * explicitly. Mirrors `DatabaseClusterBaseProps.finalSnapshotIdentifier` in `./cluster.ts`.
   *
   * @default - no final snapshot identifier; required unless `skipFinalSnapshot` is `true`
   */
  readonly finalSnapshotIdentifier?: string;

  /**
   * Whether to enable the Data API.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html
   *
   * @default false
   */
  readonly enableDataApi?: boolean;

  /**
   * The VPC that this Aurora Serverless v1 Cluster has been created in.
   *
   * @default - the default VPC in the account and region will be used
   */
  readonly vpc?: ec2.IVpc;

  /**
   * Where to place the instances within the VPC.
   * If provided, the `vpc` property must also be specified.
   *
   * @default - the VPC default strategy if not specified.
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Scaling configuration of an Aurora Serverless database cluster.
   *
   * @default - Serverless cluster is automatically paused after 5 minutes of being idle.
   *   minimum capacity: 2 ACU
   *   maximum capacity: 16 ACU
   */
  readonly scaling?: ServerlessScalingOptions;

  /**
   * Security group.
   *
   * @default - a new security group is created if `vpc` was provided.
   *   If the `vpc` property was not provided, no VPC security groups will be associated with the DB cluster.
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * Additional parameters to pass to the database engine
   *
   * @default - no parameter group.
   */
  readonly parameterGroup?: IParameterGroup;

  /**
   * Existing subnet group for the cluster.
   *
   * TERRACONSTRUCTS DEVIATION: `ISubnetGroup` instead of upstream's `aws_rds.IDBSubnetGroupRef` --
   * see the identical omission on `DatabaseClusterBaseProps.subnetGroup` in `./cluster.ts`.
   *
   * @default - a new subnet group is created if `vpc` was provided.
   *   If the `vpc` property was not provided, no subnet group will be associated with the DB cluster
   */
  readonly subnetGroup?: ISubnetGroup;

  /**
   * Whether to copy tags to the snapshot when a snapshot is created.
   *
   * @default - true
   */
  readonly copyTagsToSnapshot?: boolean;
}

/**
 * Properties that describe an existing cluster instance
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
export interface ServerlessClusterAttributes {
  /**
   * Identifier for the cluster
   */
  readonly clusterIdentifier: string;

  /**
   * The database port
   *
   * @default - none
   */
  readonly port?: number;

  /**
   * The security groups of the database cluster
   *
   * @default - no security groups
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * Cluster endpoint address
   *
   * @default - no endpoint address
   */
  readonly clusterEndpointAddress?: string;

  /**
   * Reader endpoint address
   *
   * @default - no reader address
   */
  readonly readerEndpointAddress?: string;

  /**
   * The secret attached to the database cluster
   *
   * @default - no secret
   */
  readonly secret?: secretsmanager.ISecret;
}

/**
 * Aurora capacity units (ACUs).
 * Each ACU is a combination of processing and memory capacity.
 *
 * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.setting-capacity.html
 * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.how-it-works.html#aurora-serverless.architecture
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
export enum AuroraCapacityUnit {
  /** 1 Aurora Capacity Unit */
  ACU_1 = 1,
  /** 2 Aurora Capacity Units */
  ACU_2 = 2,
  /** 4 Aurora Capacity Units */
  ACU_4 = 4,
  /** 8 Aurora Capacity Units */
  ACU_8 = 8,
  /** 16 Aurora Capacity Units */
  ACU_16 = 16,
  /** 32 Aurora Capacity Units */
  ACU_32 = 32,
  /** 64 Aurora Capacity Units */
  ACU_64 = 64,
  /** 128 Aurora Capacity Units */
  ACU_128 = 128,
  /** 192 Aurora Capacity Units */
  ACU_192 = 192,
  /** 256 Aurora Capacity Units */
  ACU_256 = 256,
  /** 384 Aurora Capacity Units */
  ACU_384 = 384,
}

/**
 * TimeoutAction defines the action to take when a timeout occurs if a scaling point is not found.
 *
 * @see https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v1.how-it-works.html#aurora-serverless.how-it-works.timeout-action
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
export enum TimeoutAction {
  /**
   * FORCE_APPLY_CAPACITY_CHANGE sets the capacity to the specified value as soon as possible.
   * Transactions may be interrupted, and connections to temporary tables and locks may be dropped.
   * Only select this option if your application can recover from dropped connections or incomplete transactions.
   */
  FORCE_APPLY_CAPACITY_CHANGE = "ForceApplyCapacityChange",

  /**
   * ROLLBACK_CAPACITY_CHANGE ignores the capacity change if a scaling point is not found.
   * This is the default behavior.
   */
  ROLLBACK_CAPACITY_CHANGE = "RollbackCapacityChange",
}

/**
 * Options for configuring scaling on an Aurora Serverless v1 Cluster
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
export interface ServerlessScalingOptions {
  /**
   * The minimum capacity for an Aurora Serverless database cluster.
   *
   * @default - determined by Aurora based on database engine
   */
  readonly minCapacity?: AuroraCapacityUnit;

  /**
   * The maximum capacity for an Aurora Serverless database cluster.
   *
   * @default - determined by Aurora based on database engine
   */
  readonly maxCapacity?: AuroraCapacityUnit;

  /**
   * The time before an Aurora Serverless database cluster is paused.
   * A database cluster can be paused only when it is idle (it has no connections).
   * Auto pause time must be between 5 minutes and 1 day.
   *
   * If a DB cluster is paused for more than seven days, the DB cluster might be
   * backed up with a snapshot. In this case, the DB cluster is restored when there
   * is a request to connect to it.
   *
   * Set to 0 to disable
   *
   * @default - automatic pause enabled after 5 minutes
   */
  readonly autoPause?: Duration;

  /**
   * The amount of time that Aurora Serverless v1 tries to find a scaling point to perform
   * seamless scaling before enforcing the timeout action.
   *
   * @default - 5 minutes
   */
  readonly timeout?: Duration;

  /**
   * The action to take when the timeout is reached.
   * Selecting ForceApplyCapacityChange will force the capacity to the specified value as soon as possible, even without a scaling point.
   * Selecting RollbackCapacityChange will ignore the capacity change if a scaling point is not found. This is the default behavior.
   *
   * @default - TimeoutAction.ROLLBACK_CAPACITY_CHANGE
   */
  readonly timeoutAction?: TimeoutAction;
}

/**
 * New or imported Serverless Cluster
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
abstract class ServerlessClusterBase
  extends AwsConstructBase
  implements IServerlessCluster
{
  /**
   * Identifier of the cluster
   */
  public abstract readonly clusterIdentifier: string;

  /**
   * The endpoint to use for read/write operations
   */
  public abstract readonly clusterEndpoint: Endpoint;

  /**
   * The endpoint to use for read/write operations
   */
  public abstract readonly clusterReadEndpoint: Endpoint;

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
   * TERRACONSTRUCTS DEVIATION: not present upstream. Stashed so `asSecretAttachmentTarget()` below
   * can contribute `engine` to the attached secret's connection fields -- mirrors
   * `DatabaseClusterBase.engine` in `./cluster.ts`. Not part of the public `IServerlessCluster`
   * interface (upstream's `IServerlessCluster` doesn't expose `engine` either), so this stays
   * `protected`. Always `undefined` on an imported cluster (`ServerlessClusterAttributes` has no
   * `engine` field, matching upstream).
   */
  protected engine?: IClusterEngine;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Stashed so `asSecretAttachmentTarget()` below
   * can contribute `dbname` to the attached secret's connection fields -- mirrors
   * `DatabaseClusterBase.defaultDatabaseName` in `./cluster.ts`.
   */
  protected defaultDatabaseName?: string;

  /**
   * The ARN of the cluster
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
   * TERRACONSTRUCTS DEVIATION: not present upstream. `clusterEndpoint`/`clusterReadEndpoint` are
   * abstract getters that THROW on an `ImportedServerlessCluster` built via
   * `fromServerlessClusterAttributes()` without the corresponding endpoint address (see
   * `ImportedServerlessCluster` below). `asSecretAttachmentTarget()` and `outputs` (both below) need
   * to tolerate that -- host/port and the endpoint outputs are simply omitted for a minimally
   * imported cluster rather than throwing. Mirrors `DatabaseClusterBase.tryGetClusterEndpoint()` in
   * `./cluster.ts`.
   */
  protected tryGetClusterEndpoint(): Endpoint | undefined {
    return this.clusterEndpoint;
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream -- see `tryGetClusterEndpoint()` above.
   */
  protected tryGetClusterReadEndpoint(): Endpoint | undefined {
    return this.clusterReadEndpoint;
  }

  /**
   * Grant the given identity to access to the Data API, including read access to the secret attached to the cluster if present
   *
   * [disable-awslint:no-grants]
   *
   * @param grantee The principal to grant access to
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
      resourceArns: ["*"],
    });
    this.secret?.grantRead(grantee);
    return ret;
  }

  /**
   * Renders the secret attachment target specifications.
   *
   * TERRACONSTRUCTS DEVIATION: mirrors the identical deviation note on
   * `DatabaseClusterBase.asSecretAttachmentTarget()` in `./cluster.ts` -- upstream returns only
   * `{ targetId, targetType }` because CloudFormation's `AWS::SecretsManager::SecretTargetAttachment`
   * resolves engine/host/port server-side from those two fields. The Terraform AWS provider has no
   * such server-side merge, so `connectionFields` is supplied here too, using `dbClusterIdentifier`
   * (not `dbInstanceIdentifier`) as CFN's `SecretTargetAttachment` does for RDS cluster targets.
   */
  public asSecretAttachmentTarget(): secretsmanager.SecretAttachmentTargetProps {
    const endpoint = this.tryGetClusterEndpoint();
    return {
      targetId: this.clusterIdentifier,
      targetType: secretsmanager.AttachmentTargetType.RDS_DB_CLUSTER,
      connectionFields: {
        dbClusterIdentifier: this.clusterIdentifier,
        ...(this.engine?.engineType ? { engine: this.engine.engineType } : {}),
        ...(this.defaultDatabaseName
          ? { dbname: this.defaultDatabaseName }
          : {}),
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
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `DatabaseClusterBase.outputs` in `./cluster.ts`) -- bare, bound-per-construct `outputs` for use
   * with `registerOutputs`/the Grid.
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
 * Create an Aurora Serverless v1 Cluster
 *
 * @resource aws_rds_cluster
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
abstract class ServerlessClusterNew extends ServerlessClusterBase {
  protected readonly securityGroups: ec2.ISecurityGroup[];

  /**
   * TERRACONSTRUCTS DEVIATION: typed loosely (`Record<string, any>`, mirroring upstream's
   * `CfnDBClusterProps` grab-bag and the identical idiom on `DatabaseClusterNew.newClusterProps` in
   * `./cluster.ts`) rather than `Partial<rdsCluster.RdsClusterConfig>` -- `enableHttpEndpoint` below
   * is a `Lazy` token that doesn't structurally match the L1 config's typed shape until the final
   * `as rdsCluster.RdsClusterConfig` cast in each leaf class.
   */
  protected readonly newClusterProps: Record<string, any>;

  protected enableDataApi?: boolean;

  constructor(scope: Construct, id: string, props: ServerlessClusterNewProps) {
    super(scope, id, props);

    this.engine = props.engine;
    this.defaultDatabaseName = props.defaultDatabaseName;

    if (props.vpc === undefined) {
      if (props.vpcSubnets !== undefined) {
        throw new ValidationError(
          "A VPC is required to use vpcSubnets in ServerlessCluster. Please add a VPC or remove vpcSubnets",
          this,
        );
      }
      if (props.subnetGroup !== undefined) {
        throw new ValidationError(
          "A VPC is required to use subnetGroup in ServerlessCluster. Please add a VPC or remove subnetGroup",
          this,
        );
      }
      if (props.securityGroups !== undefined) {
        throw new ValidationError(
          "A VPC is required to use securityGroups in ServerlessCluster. Please add a VPC or remove securityGroups",
          this,
        );
      }
    }

    let subnetGroup: ISubnetGroup | undefined = props.subnetGroup;
    this.securityGroups = props.securityGroups ?? [];
    if (props.vpc !== undefined) {
      const { subnetIds } = props.vpc.selectSubnets(props.vpcSubnets);

      // Cannot test whether the subnets are in different AZs, but at least we can test the amount.
      //
      // TERRACONSTRUCTS DEVIATION: upstream uses `Annotations.of(this)._addTrackableError(...)`, a
      // CDK-internal-only API not exposed by `cdktn`'s `Annotations`. `addError` is the closest
      // public equivalent (synthesis fails when errors are reported) -- mirrors the identical
      // deviation on `DatabaseClusterNew` in `./cluster.ts`.
      if (subnetIds.length < 2) {
        Annotations.of(this).addError(
          `Cluster requires at least 2 subnets, got ${subnetIds.length}`,
        );
      }

      subnetGroup =
        props.subnetGroup ??
        new SubnetGroup(this, "Subnets", {
          description: `Subnets for ${id} database`,
          vpc: props.vpc,
          vpcSubnets: props.vpcSubnets,
          // TERRACONSTRUCTS DEVIATION: no `removalPolicy` to pass -- see the omission note on
          // `SubnetGroupProps.removalPolicy` in `./subnet-group.ts`.
        });

      this.securityGroups = props.securityGroups ?? [
        new ec2.SecurityGroup(this, "SecurityGroup", {
          description: "RDS security group",
          vpc: props.vpc,
        }),
      ];
    }

    if (props.backupRetention) {
      const backupRetentionDays = props.backupRetention.toDays();
      if (backupRetentionDays < 1 || backupRetentionDays > 35) {
        throw new ValidationError(
          `backup retention period must be between 1 and 35 days. received: ${backupRetentionDays}`,
          this,
        );
      }
    }

    // bind the engine to the Cluster
    const clusterEngineBindConfig = props.engine.bindToCluster(this, {
      parameterGroup: props.parameterGroup,
    });
    const clusterParameterGroup =
      props.parameterGroup ?? clusterEngineBindConfig.parameterGroup;
    const clusterParameterGroupConfig = clusterParameterGroup?.bindToCluster(
      {},
    );

    // TERRACONSTRUCTS DEVIATION: upstream branches on the `RDS_LOWERCASE_DB_IDENTIFIER` feature
    // flag between lowercasing `clusterIdentifier` (corrected) or leaving it as-is (legacy). `core.
    // FeatureFlags` is not ported in this repo (see the identical, always-corrected-behavior note on
    // `DatabaseClusterNew`'s `clusterIdentifier` in `./cluster.ts`), so the corrected (always
    // lowercase) behavior is simply the only behavior. Additionally, per the repo invariant that
    // unnamed resources get a gridUUID-scoped `uniqueResourceName` default (see the same idiom on
    // `DatabaseClusterNew`'s `clusterIdentifier`), an omitted `clusterIdentifier` falls back to
    // `uniqueResourceName`. `DBClusterIdentifier` is capped at 63 characters, so `maxLength` is
    // passed explicitly here.
    const clusterIdentifier = Token.isUnresolved(props.clusterIdentifier)
      ? props.clusterIdentifier
      : (
          props.clusterIdentifier ??
          this.stack.uniqueResourceName(this, { maxLength: 63 })
        ).toLowerCase();

    this.newClusterProps = {
      backupRetentionPeriod: props.backupRetention?.toDays(),
      databaseName: props.defaultDatabaseName,
      clusterIdentifier,
      dbClusterParameterGroupName:
        clusterParameterGroupConfig?.parameterGroupName,
      dbSubnetGroupName: subnetGroup?.subnetGroupName,
      deletionProtection: defaultDeletionProtection(props.deletionProtection),
      engine: props.engine.engineType,
      engineVersion: props.engine.engineVersion?.fullVersion,
      engineMode: "serverless",
      enableHttpEndpoint: Lazy.anyValue({
        produce: () => this.enableDataApi,
      }),
      scalingConfiguration: props.scaling
        ? this.renderScalingConfiguration(props.scaling)
        : undefined,
      storageEncrypted: true,
      vpcSecurityGroupIds: this.securityGroups.map((sg) => sg.securityGroupId),
      copyTagsToSnapshot: props.copyTagsToSnapshot ?? true,
      skipFinalSnapshot: props.skipFinalSnapshot,
      finalSnapshotIdentifier: props.finalSnapshotIdentifier,
    };

    // TERRACONSTRUCTS DEVIATION: mirrors the identical `skipFinalSnapshot`/`finalSnapshotIdentifier`
    // synth-time warning on `DatabaseClusterNew` in `./cluster.ts` -- see that note for the full
    // rationale.
    if (props.skipFinalSnapshot !== true && !props.finalSnapshotIdentifier) {
      Annotations.of(this).addWarning(
        "Neither `skipFinalSnapshot` nor `finalSnapshotIdentifier` is set: `terraform destroy` (or any change that replaces this cluster) will FAIL at apply time because the AWS provider requires `finalSnapshotIdentifier` when `skipFinalSnapshot` is not `true`. Set `skipFinalSnapshot: true` to skip the final snapshot, or set `finalSnapshotIdentifier` to a snapshot name.",
      );
    }
  }

  private renderScalingConfiguration(
    options: ServerlessScalingOptions,
  ): rdsCluster.RdsClusterScalingConfiguration {
    const minCapacity = options.minCapacity;
    const maxCapacity = options.maxCapacity;
    const timeout = options.timeout?.toSeconds();

    if (minCapacity && maxCapacity && minCapacity > maxCapacity) {
      throw new ValidationError(
        "maximum capacity must be greater than or equal to minimum capacity.",
        this,
      );
    }

    const secondsToAutoPause = options.autoPause?.toSeconds();
    if (
      secondsToAutoPause &&
      (secondsToAutoPause < 300 || secondsToAutoPause > 86400)
    ) {
      throw new ValidationError(
        "auto pause time must be between 5 minutes and 1 day.",
        this,
      );
    }

    if (timeout && (timeout < 60 || timeout > 600)) {
      throw new ValidationError(
        `timeout must be between 60 and 600 seconds, but got ${timeout} seconds.`,
        this,
      );
    }

    return {
      autoPause: secondsToAutoPause === 0 ? false : true,
      minCapacity: options.minCapacity,
      maxCapacity: options.maxCapacity,
      secondsUntilAutoPause:
        secondsToAutoPause === 0 ? undefined : secondsToAutoPause,
      secondsBeforeTimeout: timeout,
      timeoutAction: options.timeoutAction,
    };
  }
}

/**
 * Properties for a new Aurora Serverless v1 Cluster
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
export interface ServerlessClusterProps extends ServerlessClusterNewProps {
  /**
   * Credentials for the administrative user
   *
   * @default - A username of 'admin' and SecretsManager-generated password
   */
  readonly credentials?: Credentials;

  /**
   * The KMS key for storage encryption.
   *
   * TERRACONSTRUCTS DEVIATION: `encryption.IKey` instead of upstream's `kms.IKey` -- see
   * `DatabaseClusterBaseProps.storageEncryptionKey` in `./cluster.ts`.
   *
   * @default - the default master key will be used for storage encryption
   */
  readonly storageEncryptionKey?: encryption.IKey;
}

/**
 * Create an Aurora Serverless v1 Cluster
 *
 * @resource aws_rds_cluster
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above. Use `DatabaseCluster` with `ClusterInstance.serverlessV2()`
 * (Aurora Serverless v2) instead.
 */
export class ServerlessCluster extends ServerlessClusterNew {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.ServerlessCluster";

  /**
   * Import an existing DatabaseCluster from properties
   */
  public static fromServerlessClusterAttributes(
    scope: Construct,
    id: string,
    attrs: ServerlessClusterAttributes,
  ): IServerlessCluster {
    return new ImportedServerlessCluster(scope, id, attrs);
  }

  public readonly clusterIdentifier: string;
  public readonly clusterEndpoint: Endpoint;
  public readonly clusterReadEndpoint: Endpoint;
  public readonly connections: ec2.Connections;

  public readonly secret?: secretsmanager.ISecret;

  /**
   * The underlying `aws_rds_cluster` L1. NOTE: this construct owns `lifecycle.ignore_changes` on
   * it (see the `ignore_changes`/password-drift note in the constructor) -- code calling
   * `resource.addOverride("lifecycle.ignore_changes", ...)` directly will REPLACE that list rather
   * than merge with it. Mirrors `DatabaseCluster.resource` in `./cluster.ts`.
   */
  public readonly resource: rdsCluster.RdsCluster;

  private readonly vpc?: ec2.IVpc;
  private readonly vpcSubnets?: ec2.SubnetSelection;

  private readonly singleUserRotationApplication: secretsmanager.SecretRotationApplication;
  private readonly multiUserRotationApplication: secretsmanager.SecretRotationApplication;

  constructor(scope: Construct, id: string, props: ServerlessClusterProps) {
    super(scope, id, props);

    this.vpc = props.vpc;
    this.vpcSubnets = props.vpcSubnets;

    this.singleUserRotationApplication =
      props.engine.singleUserRotationApplication;
    this.multiUserRotationApplication =
      props.engine.multiUserRotationApplication;

    this.enableDataApi = props.enableDataApi;

    const rendered = renderServerlessClusterCredentials(
      this,
      props.engine,
      props.credentials,
    );
    const secret = rendered.secret;

    const cluster = new rdsCluster.RdsCluster(this, "Resource", {
      ...this.newClusterProps,
      masterUsername: rendered.username,
      masterPassword: rendered.password,
      kmsKeyId: props.storageEncryptionKey?.keyArn,
    } as rdsCluster.RdsClusterConfig);

    this.resource = cluster;
    this.clusterIdentifier = cluster.clusterIdentifier;

    // TERRACONSTRUCTS DEVIATION: mirrors the identical `ignore_changes` note on `DatabaseCluster` in
    // `./cluster.ts` -- `secret` is only set here when a new `DatabaseSecret` was just generated for
    // us (see `renderServerlessClusterCredentials`), in which case `masterPassword` above is the SAME
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

    if (secret) {
      this.secret = secret.attach(this);
    }
  }

  /**
   * Adds the single user rotation of the master password to this cluster.
   */
  public addRotationSingleUser(
    options: RotationSingleUserOptions = {},
  ): secretsmanager.SecretRotation {
    if (!this.secret) {
      throw new ValidationError(
        "Cannot add single user rotation for a cluster without secret.",
        this,
      );
    }

    if (this.vpc === undefined) {
      throw new ValidationError(
        "Cannot add single user rotation for a cluster without VPC.",
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
    if (!this.secret) {
      throw new ValidationError(
        "Cannot add multi user rotation for a cluster without secret.",
        this,
      );
    }

    if (this.vpc === undefined) {
      throw new ValidationError(
        "Cannot add multi user rotation for a cluster without VPC.",
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

  public get outputs(): Record<string, any> {
    return {
      ...super.outputs,
      ...(this.secret && { secretArn: this.secret.secretArn }),
    };
  }
}

/**
 * Represents an imported database cluster.
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
class ImportedServerlessCluster
  extends ServerlessClusterBase
  implements IServerlessCluster
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.ImportedServerlessCluster";
  public readonly clusterIdentifier: string;
  public readonly connections: ec2.Connections;

  public readonly secret?: secretsmanager.ISecret;

  protected readonly enableDataApi = true;

  private readonly _clusterEndpoint?: Endpoint;
  private readonly _clusterReadEndpoint?: Endpoint;

  constructor(
    scope: Construct,
    id: string,
    attrs: ServerlessClusterAttributes,
  ) {
    super(scope, id, {});

    this.clusterIdentifier = attrs.clusterIdentifier;

    const defaultPort = attrs.port ? ec2.Port.tcp(attrs.port) : undefined;
    this.connections = new ec2.Connections({
      securityGroups: attrs.securityGroups,
      defaultPort,
    });

    this.secret = attrs.secret;

    this._clusterEndpoint =
      attrs.clusterEndpointAddress && attrs.port
        ? new Endpoint(attrs.clusterEndpointAddress, attrs.port)
        : undefined;
    this._clusterReadEndpoint =
      attrs.readerEndpointAddress && attrs.port
        ? new Endpoint(attrs.readerEndpointAddress, attrs.port)
        : undefined;
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
   * TERRACONSTRUCTS DEVIATION: not present upstream -- see `ServerlessClusterBase.tryGetClusterEndpoint()`.
   * Returns `undefined` instead of throwing when this import was constructed without an endpoint
   * address/port.
   */
  protected tryGetClusterEndpoint(): Endpoint | undefined {
    return this._clusterEndpoint;
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream -- see `ServerlessClusterBase.tryGetClusterEndpoint()`.
   */
  protected tryGetClusterReadEndpoint(): Endpoint | undefined {
    return this._clusterReadEndpoint;
  }
}

/**
 * Properties for ``ServerlessClusterFromSnapshot``
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
export interface ServerlessClusterFromSnapshotProps
  extends ServerlessClusterNewProps {
  /**
   * The identifier for the DB instance snapshot or DB cluster snapshot to restore from.
   * You can use either the name or the Amazon Resource Name (ARN) to specify a DB cluster snapshot.
   * However, you can use only the ARN to specify a DB instance snapshot.
   */
  readonly snapshotIdentifier: string;

  /**
   * Master user credentials.
   *
   * Note - It is not possible to change the master username for a snapshot;
   * however, it is possible to provide (or generate) a new password.
   *
   * @default - The existing username and password from the snapshot will be used.
   */
  readonly credentials?: SnapshotCredentials;
}

/**
 * A Aurora Serverless v1 Cluster restored from a snapshot.
 *
 * @resource aws_rds_cluster
 *
 * @deprecated Aurora Serverless v1 has been retired by AWS -- see the module-level TERRACONSTRUCTS
 * note on `IServerlessCluster` above.
 */
export class ServerlessClusterFromSnapshot extends ServerlessClusterNew {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.ServerlessClusterFromSnapshot";

  public readonly clusterIdentifier: string;
  public readonly clusterEndpoint: Endpoint;
  public readonly clusterReadEndpoint: Endpoint;
  public readonly connections: ec2.Connections;
  public readonly secret?: secretsmanager.ISecret;

  /**
   * The underlying `aws_rds_cluster` L1. NOTE: see the identical `ignore_changes` ownership note on
   * `ServerlessCluster.resource` above.
   */
  public readonly resource: rdsCluster.RdsCluster;

  constructor(
    scope: Construct,
    id: string,
    props: ServerlessClusterFromSnapshotProps,
  ) {
    super(scope, id, props);

    this.enableDataApi = props.enableDataApi;

    const credentials = renderServerlessClusterSnapshotCredentials(
      this,
      props.credentials,
    );
    const secret = credentials?.secret;

    const cluster = new rdsCluster.RdsCluster(this, "Resource", {
      ...this.newClusterProps,
      snapshotIdentifier: props.snapshotIdentifier,
      masterPassword: credentials?.password,
    } as rdsCluster.RdsClusterConfig);

    this.resource = cluster;
    this.clusterIdentifier = cluster.clusterIdentifier;

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

    if (secret) {
      this.secret = secret.attach(this);
    }
  }

  public get outputs(): Record<string, any> {
    return {
      ...super.outputs,
      ...(this.secret && { secretArn: this.secret.secretArn }),
    };
  }
}

/**
 * TERRACONSTRUCTS DEVIATION: replaces upstream's `renderCredentials` (`./private/util.ts`), which is
 * commented out there because it depends on `Credentials.fromSecret` (itself commented out in
 * `./props.ts` -- needs `ISecret.secretValueFromJson`, not portable). This local equivalent produces
 * the same three pieces of information (username / password token / owned secret) directly, using
 * `Secret._generatedPassword` -- mirrors `renderClusterCredentials` in `./cluster.ts`.
 */
function renderServerlessClusterCredentials(
  scope: Construct,
  engine: IClusterEngine,
  credentials?: Credentials,
): {
  username: string;
  password?: string;
  secret?: secretsmanager.ISecret;
} {
  const rendered = credentials ?? {
    username: engine.defaultUsername ?? "admin",
  };

  if (rendered.secret) {
    // TERRACONSTRUCTS DEVIATION: see the identical note in `renderClusterCredentials` in
    // `./cluster.ts` -- `Credentials.fromSecret()` is not available in this repo.
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
 * TERRACONSTRUCTS DEVIATION: replaces upstream's inlined snapshot-secret handling in
 * `ServerlessClusterFromSnapshot`'s constructor (not the `renderSnapshotCredentials` helper
 * in `./private/util.ts`, which `DatabaseClusterFromSnapshot` uses) -- commented out here for
 * the identical reason as `renderCredentials` above (depends on `SnapshotCredentials.fromSecret`,
 * not portable). Shaped like `renderClusterSnapshotCredentials` in `./cluster.ts` for house-pattern
 * consistency, but the generated secret's construct id is "Secret" -- matching upstream
 * `ServerlessClusterFromSnapshot` (v2.263.0 serverless-cluster.ts#L806), NOT
 * `DatabaseClusterFromSnapshot`'s "SnapshotSecret" id (which `./cluster.ts`'s sibling helper
 * mirrors instead).
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/serverless-cluster.ts#L806
 */
function renderServerlessClusterSnapshotCredentials(
  scope: Construct,
  credentials?: SnapshotCredentials,
):
  | {
      password?: string;
      secret?: secretsmanager.ISecret;
    }
  | undefined {
  if (!credentials) {
    return undefined;
  }

  if (credentials.secret) {
    // TERRACONSTRUCTS DEVIATION: see `renderServerlessClusterCredentials` above -- an existing,
    // caller-supplied secret's password cannot be read back out portably
    // (`secretValueFromJson` not ported).
    throw new ValidationError(
      "SnapshotCredentials with an existing `secret` are not supported in TerraConstructs (depends on ISecret.secretValueFromJson, not ported). Use SnapshotCredentials.fromPassword(), SnapshotCredentials.fromGeneratedSecret()/fromGeneratedPassword(), or leave `credentials` unset to keep the snapshot's existing password.",
      scope,
    );
  }

  if (credentials.generatePassword) {
    if (!credentials.username) {
      throw new ValidationError(
        "`credentials` `username` must be specified when `generatePassword` is set to true",
        scope,
      );
    }

    const secret = new DatabaseSecret(scope, "Secret", {
      username: credentials.username,
      encryptionKey: credentials.encryptionKey,
      excludeCharacters: credentials.excludeCharacters,
      replaceOnPasswordCriteriaChanges:
        credentials.replaceOnPasswordCriteriaChanges,
      replicaRegions: credentials.replicaRegions,
    });

    return { password: secret._generatedPassword, secret };
  }

  return { password: credentials.password };
}
