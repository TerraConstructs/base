// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/cluster.ts
//
// TODO(alpha-tracker): ported from @aws-cdk/aws-redshift-alpha@2.263.0-alpha.0 (stability:
// experimental). Re-diff against upstream on every reference-tag bump — alpha surfaces churn
// without deprecation cycles.
//
// SCOPE REDUCTION (this PR): three upstream surfaces backed by Lambda-backed custom resources /
// CloudFormation-only mechanisms are reduced or replaced below -- see the TERRACONSTRUCTS
// DEVIATION / TODO notes at each call site:
//   - `addDefaultIamRole()`         -- REPLACED: upstream shells out to the Redshift API via an
//                                      `AwsCustomResource` (`modifyClusterIamRoles`); the provider
//                                      exposes the same capability natively as
//                                      `aws_redshift_cluster.default_iam_role_arn`.
//   - `enableRebootForParameterChanges()` -- OMITTED (commented out, not deleted): backed by a
//                                      `Custom::RedshiftClusterRebooter` Lambda-backed custom
//                                      resource; no Terraform-native equivalent.
//   - `loggingProperties`           -- REPLACED: provider 6.x moved Redshift audit logging off the
//                                      `aws_redshift_cluster` resource itself and onto a standalone
//                                      `aws_redshift_logging` resource.

import { redshiftCluster, redshiftLogging } from "@cdktn/provider-aws";
import { Annotations, Lazy, Token, Tokenization } from "cdktn";
import { Construct } from "constructs";
import { DatabaseSecret } from "./database-secret";
import { Endpoint } from "./endpoint";
import type { IClusterParameterGroup } from "./parameter-group";
import { ClusterParameterGroup } from "./parameter-group";
import type { IClusterSubnetGroup } from "./subnet-group";
import { ClusterSubnetGroup } from "./subnet-group";
import type { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as ec2 from "../../compute";
import * as secretsmanager from "../../encryption";
import type * as encryption from "../../encryption";
import * as iam from "../../iam";
import type { IBucket } from "../bucket";

/**
 * Possible Node Types to use in the cluster
 * used for defining `ClusterProps.nodeType`.
 */
export enum NodeType {
  /**
   * ds2.xlarge
   */
  DS2_XLARGE = "ds2.xlarge",

  /**
   * ds2.8xlarge
   */
  DS2_8XLARGE = "ds2.8xlarge",

  /**
   * dc1.large
   */
  DC1_LARGE = "dc1.large",

  /**
   * dc1.8xlarge
   */
  DC1_8XLARGE = "dc1.8xlarge",

  /**
   * dc2.large
   */
  DC2_LARGE = "dc2.large",

  /**
   * dc2.8xlarge
   */
  DC2_8XLARGE = "dc2.8xlarge",

  /**
   * ra3.large
   */
  RA3_LARGE = "ra3.large",

  /**
   * ra3.xlplus
   */
  RA3_XLPLUS = "ra3.xlplus",

  /**
   * ra3.4xlarge
   */
  RA3_4XLARGE = "ra3.4xlarge",

  /**
   * ra3.16xlarge
   */
  RA3_16XLARGE = "ra3.16xlarge",
}

/**
 * What cluster type to use.
 * Used by `ClusterProps.clusterType`
 */
export enum ClusterType {
  /**
   * single-node cluster, the `ClusterProps.numberOfNodes` parameter is not required
   */
  SINGLE_NODE = "single-node",
  /**
   * multi-node cluster, set the amount of nodes using `ClusterProps.numberOfNodes` parameter
   */
  MULTI_NODE = "multi-node",
}

// TODO: omitted — upstream's `ResourceAction` enum and the `ClusterProps.resourceAction` prop that
// consumes it (`pause-cluster` / `resume-cluster` / `failover-primary-compute`) map onto
// `AWS::Redshift::Cluster.ResourceAction`, a CloudFormation-only mechanism: CloudFormation issues
// the corresponding Redshift API action (`PauseCluster`/`ResumeCluster`/`FailoverPrimaryCompute`)
// as a side effect of a stack update, rather than persisting the value as cluster state. The
// `aws_redshift_cluster` Terraform resource has no equivalent argument at all (verified against the
// full config shape in `node_modules/@cdktn/provider-aws/lib/redshift-cluster/index.d.ts` — there is
// no `resource_action`/`pause_cluster`/`resume_cluster` argument), so there is nothing to assign it
// to -- unlike the `addDefaultIamRole()`/`enableRebootForParameterChanges()` omissions above, this
// is not a Lambda-custom-resource gap that could theoretically be closed with a framework; it is a
// capability CloudFormation has that Terraform's Redshift resource simply does not expose —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/cluster.ts#L95-L115
// export enum ResourceAction {
//   PAUSE_CLUSTER = 'pause-cluster',
//   RESUME_CLUSTER = 'resume-cluster',
//   FAILOVER_PRIMARY_COMPUTE = 'failover-primary-compute',
// }

/**
 * Username and password combination
 *
 * TERRACONSTRUCTS DEVIATION: `masterPassword` is typed as a plain `string` instead of upstream's
 * `core.SecretValue` (a CloudFormation dynamic-reference wrapper), which is not ported in this repo
 * -- identical deviation to `Login.password` in `../docdb/props.ts` and `Credentials.password` in
 * `../rds/props.ts`. The value may itself be an unresolved Token.
 */
export interface Login {
  /**
   * Username
   */
  readonly masterUsername: string;

  /**
   * Password
   *
   * Do not put passwords in your CDK code directly.
   *
   * @default - a Secrets Manager generated password
   */
  readonly masterPassword?: string;

  /**
   * KMS encryption key to encrypt the generated secret.
   *
   * @default - default master key
   */
  readonly encryptionKey?: encryption.IKey;

  /**
   * Characters to not include in the generated password.
   *
   * @default '"@/\\\ \''
   */
  readonly excludeCharacters?: string;
}

/**
 * Logging bucket and S3 prefix combination
 */
export interface LoggingProperties {
  /**
   * Bucket to send logs to.
   * Logging information includes queries and connection attempts, for the specified Amazon Redshift cluster.
   */
  readonly loggingBucket: IBucket;

  /**
   * Prefix used for logging.
   */
  readonly loggingKeyPrefix: string;
}

/**
 * Options to add the multi user rotation
 */
export interface RotationMultiUserOptions {
  /**
   * The secret to rotate. It must be a JSON string with the following format:
   * ```
   * {
   *   "engine": <required: database engine>,
   *   "host": <required: instance host name>,
   *   "username": <required: username>,
   *   "password": <required: password>,
   *   "dbname": <optional: database name>,
   *   "port": <optional: if not specified, default port will be used>,
   *   "masterarn": <required: the arn of the master secret which will be used to create users/change passwords>
   * }
   * ```
   */
  readonly secret: secretsmanager.ISecret;

  /**
   * Specifies the number of days after the previous rotation before
   * Secrets Manager triggers the next automatic rotation.
   *
   * @default Duration.days(30)
   */
  readonly automaticallyAfter?: Duration;
}

/**
 * The maintenance track for the cluster.
 *
 * @see https://docs.aws.amazon.com/redshift/latest/mgmt/managing-cluster-considerations.html#rs-mgmt-maintenance-tracks
 */
export enum MaintenanceTrackName {
  /**
   * Updated to the most recently certified maintenance release.
   */
  CURRENT = "current",

  /**
   * Update to the previously certified maintenance release.
   */
  TRAILING = "trailing",
}

/**
 * Create a Redshift Cluster with a given number of nodes.
 * Implemented by `Cluster` via `ClusterBase`.
 *
 * TODO: omitted — upstream also extends `aws_redshift.IClusterRef`, a CloudFormation cross-stack
 * "Reference" marker interface generated from the CFN resource spec. TerraConstructs has no
 * equivalent generated-reference layer (identical omission to `IClusterParameterGroup` in
 * `./parameter-group.ts` / `IClusterSubnetGroup` in `./subnet-group.ts`), so it is dropped.
 */
export interface ICluster
  extends IAwsConstruct,
    ec2.IConnectable,
    secretsmanager.ISecretAttachmentTarget {
  /**
   * Name of the cluster
   */
  readonly clusterName: string;

  /**
   * The endpoint to use for read/write operations
   */
  readonly clusterEndpoint: Endpoint;
}

/**
 * Properties that describe an existing cluster instance
 */
export interface ClusterAttributes {
  /**
   * The security groups of the redshift cluster
   *
   * @default no security groups will be attached to the import
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * Identifier for the cluster
   */
  readonly clusterName: string;

  /**
   * Cluster endpoint address
   */
  readonly clusterEndpointAddress: string;

  /**
   * Cluster endpoint port
   */
  readonly clusterEndpointPort: number;
}

/**
 * Properties for a new database cluster
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `ClusterProps` does not — matching the base-idiom used throughout this repo
 * (e.g. `DatabaseClusterProps` in `../docdb/cluster.ts` / `../neptune/cluster.ts`) for
 * cross-account/-region construct placement.
 */
export interface ClusterProps extends AwsConstructProps {
  /**
   * An optional identifier for the cluster
   *
   * TERRACONSTRUCTS DEVIATION: when unnamed, upstream lets CloudFormation generate a name from the
   * logical id; the repo invariant is a gridUUID-scoped `uniqueResourceName` default instead
   * (mirroring `ClusterSubnetGroupProps.clusterSubnetGroupName` in `./subnet-group.ts`), lowercased
   * to match Redshift's server-side storage convention (`ClusterIdentifier` is stored lowercase).
   *
   * @default - A gridUUID-scoped generated name is used.
   */
  readonly clusterName?: string;

  /**
   * Additional parameters to pass to the database engine
   * https://docs.aws.amazon.com/redshift/latest/mgmt/working-with-parameter-groups.html
   *
   * @default - No parameter group.
   */
  readonly parameterGroup?: IClusterParameterGroup;

  /**
   * Number of compute nodes in the cluster. Only specify this property for multi-node clusters.
   *
   * Value must be at least 2 and no more than 100.
   *
   * @default - 2 if `clusterType` is ClusterType.MULTI_NODE, undefined otherwise
   */
  readonly numberOfNodes?: number;

  /**
   * The node type to be provisioned for the cluster.
   *
   * @default `NodeType.RA3_LARGE`
   */
  readonly nodeType?: NodeType;

  /**
   * Settings for the individual instances that are launched
   *
   * @default `ClusterType.MULTI_NODE`
   */
  readonly clusterType?: ClusterType;

  /**
   * What port to listen on
   *
   * @default - The default for the engine is used.
   */
  readonly port?: number;

  /**
   * Whether to enable encryption of data at rest in the cluster.
   *
   * @default true
   */
  readonly encrypted?: boolean;

  /**
   * The KMS key to use for encryption of data at rest.
   *
   * TERRACONSTRUCTS DEVIATION: `encryption.IKey` instead of upstream's `kms.IKeyRef` (CDK's newer
   * decoupled cross-region/-account KMS reference type, not ported here) -- mirrors `Login`'s own
   * `encryptionKey` above and every other KMS-key prop across this repo's storage ports.
   *
   * @default - AWS-managed key, if encryption at rest is enabled
   */
  readonly encryptionKey?: encryption.IKey;

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
   * The VPC to place the cluster in.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Where to place the instances within the VPC
   *
   * @default - private subnets
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Security group.
   *
   * @default - a new security group is created.
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * A cluster subnet group to use with this cluster.
   *
   * @default - a new subnet group will be created.
   */
  readonly subnetGroup?: IClusterSubnetGroup;

  /**
   * Username and password for the administrative user
   */
  readonly masterUser: Login;

  /**
   * A list of AWS Identity and Access Management (IAM) role that can be used by the cluster to access other AWS services.
   * The maximum number of roles to attach to a cluster is subject to a quota.
   *
   * @default - No role is attached to the cluster.
   */
  readonly roles?: iam.IRole[];

  /**
   * A single AWS Identity and Access Management (IAM) role to be used as the default role for the cluster.
   * The default role must be included in the roles list.
   *
   * @default - No default role is specified for the cluster.
   */
  readonly defaultRole?: iam.IRole;

  /**
   * Name of a database which is automatically created inside the cluster
   *
   * @default - default_db
   */
  readonly defaultDatabaseName?: string;

  /**
   * Bucket details for log files to be sent to, including prefix.
   *
   * TERRACONSTRUCTS DEVIATION: synthesizes a standalone `aws_redshift_logging` resource (see the
   * file-header SCOPE REDUCTION note) instead of the CFN `AWS::Redshift::Cluster.LoggingProperties`
   * nested property -- provider 6.x moved Redshift audit logging off the cluster resource itself.
   *
   * @default - No logging bucket is used
   */
  readonly loggingProperties?: LoggingProperties;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.RETAIN`,
  // applied to the cluster, its auto-created subnet group, and its auto-created security group via
  // `applyRemovalPolicy`) is CloudFormation's DeletionPolicy concept. `core.RemovalPolicy` is not
  // ported anywhere in this repo (see the identical omission on `DatabaseClusterProps` in
  // `../docdb/cluster.ts` / `../neptune/cluster.ts`). Terraform's `aws_redshift_cluster` exposes the
  // cluster-level equivalent natively via `skipFinalSnapshot`/`finalSnapshotIdentifier` below -- the
  // TERRACONSTRUCTS-native replacement --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/cluster.ts#L399-L403
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — native Terraform replacement for upstream's
   * `removalPolicy` (see the TODO above). Whether Terraform should take a final DB snapshot before
   * destroying this cluster. When `false` (the default) and `finalSnapshotIdentifier` is not set,
   * `terraform destroy`/replace will FAIL at apply-time with an AWS API error (native
   * `aws_redshift_cluster` behavior, not enforced here at synth time). Mirrors the identical
   * `skipFinalSnapshot` prop on `../docdb/cluster.ts` / `../neptune/cluster.ts`.
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
   * Whether to make cluster publicly accessible.
   *
   * @default false
   */
  readonly publiclyAccessible?: boolean;

  // TODO: omitted — upstream's `classicResizing?: boolean` (mapped onto
  // `AWS::Redshift::Cluster.Classic`) has no Terraform-provider equivalent: the
  // `aws_redshift_cluster` resource has no `classic`/`classic_resizing` argument at all (verified
  // against the full config shape in
  // `node_modules/@cdktn/provider-aws/lib/redshift-cluster/index.d.ts`). Classic vs. elastic resize
  // is a one-time choice made by the Redshift `ModifyCluster`/`ResizeCluster` API call at resize
  // time, not a persisted cluster attribute the Terraform AWS provider's `aws_redshift_cluster`
  // resource models -- same root cause as the `resourceAction`/`ResourceAction` omission above —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/cluster.ts#L410-L421
  // readonly classicResizing?: boolean;

  /**
   * The Elastic IP (EIP) address for the cluster.
   *
   * @see https://docs.aws.amazon.com/redshift/latest/mgmt/managing-clusters-vpc.html
   *
   * @default - No Elastic IP
   */
  readonly elasticIp?: string;

  // TODO(scope-reduction): omitted — upstream's `rebootForParameterChanges?: boolean` triggers
  // `enableRebootForParameterChanges()` (see the omission note on that method further down this
  // file) from the constructor. Since the method it drives is fully commented out, the prop that
  // triggers it is dropped alongside it —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/cluster.ts#L432-L436
  // readonly rebootForParameterChanges?: boolean;

  /**
   * If this flag is set, Amazon Redshift forces all COPY and UNLOAD traffic between your cluster and your data repositories through your virtual private cloud (VPC).
   *
   * @see https://docs.aws.amazon.com/redshift/latest/mgmt/enhanced-vpc-routing.html
   *
   * @default - false
   */
  readonly enhancedVpcRouting?: boolean;

  /**
   * Indicating whether Amazon Redshift should deploy the cluster in two Availability Zones.
   *
   * @default - false
   */
  readonly multiAz?: boolean;

  // TODO: omitted — upstream's `resourceAction?: ResourceAction`. See the `ResourceAction` enum
  // omission note above for the full rationale.
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/cluster.ts#L454-L459
  // readonly resourceAction?: ResourceAction;

  /**
   * Whether to enable relocation for an Amazon Redshift cluster between Availability Zones after the cluster is created.
   *
   * @see https://docs.aws.amazon.com/redshift/latest/mgmt/managing-cluster-recovery.html
   *
   * @default - false
   */
  readonly availabilityZoneRelocation?: boolean;

  /**
   * The maintenance track name for the cluster.
   *
   * @see https://docs.aws.amazon.com/redshift/latest/mgmt/managing-cluster-considerations.html#rs-mgmt-maintenance-tracks
   *
   * @default undefined - Redshift default is current
   */
  readonly maintenanceTrackName?: MaintenanceTrackName;
}

/**
 * A new or imported clustered database.
 */
abstract class ClusterBase extends AwsConstructBase implements ICluster {
  /**
   * Name of the cluster
   */
  public abstract readonly clusterName: string;

  /**
   * The endpoint to use for read/write operations
   */
  public abstract readonly clusterEndpoint: Endpoint;

  /**
   * Access to the network connections
   */
  public abstract readonly connections: ec2.Connections;

  /**
   * Renders the secret attachment target specifications.
   *
   * TERRACONSTRUCTS DEVIATION: mirrors `DatabaseClusterBase.asSecretAttachmentTarget()` in
   * `../docdb/cluster.ts` — upstream returns only `{ targetId, targetType }` because
   * CloudFormation's `AWS::SecretsManager::SecretTargetAttachment` resolves engine/host/port
   * server-side from those fields. The Terraform AWS provider has no such server-side merge, so
   * `connectionFields` is supplied here too, using `dbClusterIdentifier`/`engine: "redshift"` as
   * documented for the Secrets Manager Redshift rotation templates —
   * https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_secret_json_structure.html#reference_secret_json_structure_RS
   */
  public asSecretAttachmentTarget(): secretsmanager.SecretAttachmentTargetProps {
    return {
      targetId: this.clusterName,
      targetType: secretsmanager.AttachmentTargetType.REDSHIFT_CLUSTER,
      connectionFields: {
        dbClusterIdentifier: this.clusterName,
        engine: "redshift",
        host: this.clusterEndpoint.hostname,
        // NUMBER-typed port token, stringified for embedding in the connection fields map.
        port: Tokenization.stringifyNumber(this.clusterEndpoint.port),
      },
    };
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `DatabaseClusterBase.outputs` in `../docdb/cluster.ts`) — bare, bound-per-construct `outputs`
   * for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      identifier: this.clusterName,
      endpointAddress: this.clusterEndpoint.hostname,
      endpointPort: Tokenization.stringifyNumber(this.clusterEndpoint.port),
    };
  }
}

/**
 * Create a Redshift cluster a given number of nodes.
 *
 * @resource aws_redshift_cluster
 */
export class Cluster extends ClusterBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.redshift.Cluster";

  /**
   * Import an existing DatabaseCluster from properties
   */
  public static fromClusterAttributes(
    scope: Construct,
    id: string,
    attrs: ClusterAttributes,
  ): ICluster {
    class Import extends ClusterBase {
      public readonly connections = new ec2.Connections({
        securityGroups: attrs.securityGroups,
        defaultPort: ec2.Port.tcp(attrs.clusterEndpointPort),
      });
      public readonly clusterName = attrs.clusterName;
      public readonly clusterEndpoint = new Endpoint(
        attrs.clusterEndpointAddress,
        attrs.clusterEndpointPort,
      );
    }
    return new Import(scope, id, {});
  }

  /**
   * Identifier of the cluster
   */
  public readonly clusterName: string;

  /**
   * The endpoint to use for read/write operations
   */
  public readonly clusterEndpoint: Endpoint;

  /**
   * Access to the network connections
   */
  public readonly connections: ec2.Connections;

  /**
   * The secret attached to this cluster
   */
  public readonly secret?: secretsmanager.ISecret;

  /**
   * The VPC where the DB subnet group is created.
   */
  private readonly vpc: ec2.IVpc;

  /**
   * The subnets used by the DB subnet group.
   */
  private readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * The underlying `aws_redshift_cluster` L1.
   */
  private readonly resource: redshiftCluster.RedshiftCluster;

  /**
   * The `clusterIdentifier` argument this construct passed to the underlying L1 (the literal
   * name, or an unresolved Token for a cross-stack/parameterized name).
   *
   * TERRACONSTRUCTS DEVIATION: not present upstream. Upstream's `addToParameterGroup()` reads the
   * identifier back via `this.cluster.clusterIdentifier` (a CFN L1 property getter, which simply
   * echoes back the literal input value). The `aws_redshift_cluster` L1's `clusterIdentifier`
   * GETTER instead always returns the synth-time-unresolved `cluster_identifier` COMPUTED
   * attribute reference (`this.getStringAttribute('cluster_identifier')`), not the raw input --
   * embedding that reference inside a human-readable description string (see
   * `addToParameterGroup()` below) would produce an opaque token marker instead of the literal
   * name. This field captures the value actually passed in instead.
   */
  private readonly clusterIdentifierInput: string;

  /**
   * The cluster's parameter group
   */
  protected parameterGroup?: IClusterParameterGroup;

  /**
   * The IAM roles attached to the cluster.
   *
   * TERRACONSTRUCTS DEVIATION: upstream defers `iamRoles` to synth time via a lazy, mutable
   * `IArrayBox` (`aws-cdk-lib/core/lib/helpers-internal`, CDK-internal and not ported here) so that
   * roles added later via `addIamRole()`/`addDefaultIamRole()` are still reflected when the
   * underlying `CfnCluster.iamRoles` token resolves. A plain mutable array plus `Lazy.listValue()`
   * (public cdktn API) gives the same synth-time-deferred behavior: `this.roles` is captured by
   * reference in the closure below, so mutations from `addIamRole()` before synth are picked up
   * identically -- mirrors `UserGroup._users`/`Lazy.listValue()` in `../elasticache/user-group.ts`.
   *
   * **NOTE** Please do not push directly to this array; use `addIamRole()` instead.
   */
  private readonly roles: iam.IRole[];

  constructor(scope: Construct, id: string, props: ClusterProps) {
    super(scope, id, props);

    this.vpc = props.vpc;
    this.vpcSubnets = props.vpcSubnets ?? {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };
    this.parameterGroup = props.parameterGroup;
    this.roles = [...(props.roles ?? [])];

    const subnetGroup =
      props.subnetGroup ??
      new ClusterSubnetGroup(this, "Subnets", {
        description: `Subnets for ${id} Redshift cluster`,
        vpc: this.vpc,
        vpcSubnets: this.vpcSubnets,
      });

    const securityGroups = props.securityGroups ?? [
      new ec2.SecurityGroup(this, "SecurityGroup", {
        description: "Redshift security group",
        vpc: this.vpc,
      }),
    ];

    const securityGroupIds = securityGroups.map((sg) => sg.securityGroupId);

    // Create the secret manager secret if no password is specified
    let secret: DatabaseSecret | undefined;
    if (!props.masterUser.masterPassword) {
      secret = new DatabaseSecret(this, "Secret", {
        username: props.masterUser.masterUsername,
        encryptionKey: props.masterUser.encryptionKey,
        excludeCharacters: props.masterUser.excludeCharacters,
      });
    }

    const clusterType = props.clusterType || ClusterType.MULTI_NODE;
    const nodeCount = this.validateNodeCount(clusterType, props.numberOfNodes);

    if (props.encrypted === false && props.encryptionKey !== undefined) {
      throw new ValidationError(
        "Cannot set property encryptionKey without enabling encryption!",
        this,
      );
    }

    const nodeType = props.nodeType || NodeType.RA3_LARGE;

    if (props.multiAz) {
      if (!nodeType.startsWith("ra3")) {
        throw new ValidationError(
          `Multi-AZ cluster is only supported for RA3 node types, got: ${props.nodeType}`,
          this,
        );
      }
      if (clusterType === ClusterType.SINGLE_NODE) {
        throw new ValidationError(
          "Multi-AZ cluster is not supported for `clusterType` single-node",
          this,
        );
      }
    }

    if (props.availabilityZoneRelocation && !nodeType.startsWith("ra3")) {
      throw new ValidationError(
        `Availability zone relocation is supported for only RA3 node types, got: ${props.nodeType}`,
        this,
      );
    }

    // TERRACONSTRUCTS DEVIATION: hoisted so it can be reused for both the cluster's
    // `clusterIdentifier` argument and the `outputs`/logging-resource references below -- mirrors
    // the identical `derivedClusterIdentifier` idiom in `../docdb/cluster.ts` /
    // `../neptune/cluster.ts`. `ClusterIdentifier` allows up to 63 characters.
    const clusterIdentifier = Token.isUnresolved(props.clusterName)
      ? (props.clusterName as string)
      : (
          props.clusterName ??
          this.stack.uniqueResourceName(this, { maxLength: 63 })
        ).toLowerCase();
    this.clusterIdentifierInput = clusterIdentifier;

    this.resource = new redshiftCluster.RedshiftCluster(this, "Resource", {
      // Basic
      allowVersionUpgrade: true,
      maintenanceTrackName: props.maintenanceTrackName,
      automatedSnapshotRetentionPeriod: 1,
      clusterType,
      clusterIdentifier,
      clusterSubnetGroupName: subnetGroup.clusterSubnetGroupName,
      vpcSecurityGroupIds: securityGroupIds,
      port: props.port,
      clusterParameterGroupName:
        props.parameterGroup && props.parameterGroup.clusterParameterGroupName,
      // Admin
      masterUsername: props.masterUser.masterUsername,
      masterPassword: secret
        ? secret._generatedPassword
        : props.masterUser.masterPassword,
      preferredMaintenanceWindow: props.preferredMaintenanceWindow,
      nodeType,
      numberOfNodes: nodeCount,
      iamRoles: Lazy.listValue({
        produce: () => this.roles.map((role) => role.roleArn),
      }),
      databaseName: props.defaultDatabaseName || "default_db",
      publiclyAccessible: props.publiclyAccessible || false,
      // Encryption
      // ID-vs-ARN AUDIT: fed the KMS key ARN (not a bare key id) despite the Terraform argument's
      // `kmsKeyId` name -- AWS always reports the ARN back on read for this field, so supplying the
      // ARN up front avoids a perpetual "inconsistent result after apply" diff (the #151 kms
      // lesson), mirrors `kmsKeyId: props.kmsKey?.keyArn` in `../docdb/cluster.ts`.
      kmsKeyId: props.encryptionKey?.keyArn,
      // TERRACONSTRUCTS DEVIATION: the `aws_redshift_cluster.encrypted` argument is typed `string`
      // (not `bool`) in this provider binding (verified against
      // `node_modules/@cdktn/provider-aws/lib/redshift-cluster/index.d.ts` and its
      // `cdktn.stringToTerraform(this._encrypted)` synth path) -- unlike CloudFormation's boolean
      // `Encrypted` property. The boolean is stringified before assignment.
      encrypted: String(props.encrypted ?? true),
      elasticIp: props.elasticIp,
      enhancedVpcRouting: props.enhancedVpcRouting,
      multiAz: props.multiAz,
      availabilityZoneRelocationEnabled: props.availabilityZoneRelocation,
      skipFinalSnapshot: props.skipFinalSnapshot,
      finalSnapshotIdentifier: props.finalSnapshotIdentifier,
    });

    // TERRACONSTRUCTS DEVIATION: generated-password `ignore_changes` house pattern (see
    // `DatabaseCluster`'s identical note in `../docdb/cluster.ts`) -- `secret` is only set here when
    // a new `DatabaseSecret` was just generated for us, in which case `masterPassword` above is the
    // SAME regenerating-on-every-plan `aws_secretsmanager_random_password` token stored in that
    // secret. Without `ignore_changes`, every apply after the first would drift and REPLACE the live
    // master password.
    const ignoreChanges: string[] = [];
    if (secret) {
      ignoreChanges.push("master_password");
    }
    if (ignoreChanges.length > 0) {
      this.resource.addOverride("lifecycle.ignore_changes", ignoreChanges);
    }

    // TERRACONSTRUCTS DEVIATION: mirrors the identical `skipFinalSnapshot`/`finalSnapshotIdentifier`
    // synth-time warning on `DatabaseCluster` in `../docdb/cluster.ts` / `../neptune/cluster.ts` —
    // see that note for the full rationale.
    if (props.skipFinalSnapshot !== true && !props.finalSnapshotIdentifier) {
      Annotations.of(this).addWarning(
        "Neither `skipFinalSnapshot` nor `finalSnapshotIdentifier` is set: `terraform destroy` (or any change that replaces this cluster) will FAIL at apply time because the AWS provider requires `finalSnapshotIdentifier` when `skipFinalSnapshot` is not `true`. Set `skipFinalSnapshot: true` to skip the final snapshot, or set `finalSnapshotIdentifier` to a snapshot name.",
      );
    }

    this.clusterName = this.resource.clusterIdentifier;

    // TERRACONSTRUCTS DEVIATION: upstream converts `cluster.attrEndpointAddress`/
    // `cluster.attrEndpointPort` (separate CFN `Fn::GetAtt` attributes) into an `Endpoint` via
    // `cdk.Token.asNumber(...)` for the port. The `aws_redshift_cluster` L1 has no split
    // address/port endpoint attribute pair -- only a combined `endpoint` string (`host:port`) and a
    // separate hostname-only `dns_name` attribute -- so `dnsName` (paired with the already
    // number-typed `port` getter) is used here instead, mirroring the identical
    // `cluster.endpoint`/`cluster.port` idiom in `../docdb/cluster.ts`.
    this.clusterEndpoint = new Endpoint(
      this.resource.dnsName,
      this.resource.port,
    );

    if (secret) {
      this.secret = secret.attach(this);
    }

    const defaultPort = ec2.Port.tcp(this.clusterEndpoint.port);
    this.connections = new ec2.Connections({ securityGroups, defaultPort });

    // TERRACONSTRUCTS DEVIATION: see the file-header SCOPE REDUCTION note -- provider 6.x moved
    // Redshift audit logging off the `aws_redshift_cluster` resource itself and onto a standalone
    // `aws_redshift_logging` resource, which requires the cluster's `clusterIdentifier` and is
    // therefore created after `this.resource` above.
    if (props.loggingProperties) {
      props.loggingProperties.loggingBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["s3:GetBucketAcl", "s3:PutObject"],
          resources: [
            props.loggingProperties.loggingBucket.arnForObjects("*"),
            props.loggingProperties.loggingBucket.bucketArn,
          ],
          principals: [new iam.ServicePrincipal("redshift.amazonaws.com")],
        }),
      );

      new redshiftLogging.RedshiftLogging(this, "Logging", {
        clusterIdentifier: this.clusterName,
        logDestinationType: "s3",
        bucketName: props.loggingProperties.loggingBucket.bucketName,
        s3KeyPrefix: props.loggingProperties.loggingKeyPrefix,
      });
    }

    // TODO(scope-reduction): omitted — upstream calls `this.enableRebootForParameterChanges()` here
    // when `props.rebootForParameterChanges` is set. See the method's own omission note further
    // down this file and the omission note on `ClusterProps.rebootForParameterChanges` above —
    // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/cluster.ts#L727-L729
    // if (props.rebootForParameterChanges) {
    //   this.enableRebootForParameterChanges();
    // }

    // Add default role if specified and also available in the roles list
    if (props.defaultRole) {
      if (props.roles?.some((x) => x === props.defaultRole)) {
        this.addDefaultIamRole(props.defaultRole);
      } else {
        throw new ValidationError(
          "Default role must be included in role list.",
          this,
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
      application:
        secretsmanager.SecretRotationApplication.REDSHIFT_ROTATION_SINGLE_USER,
      // TERRACONSTRUCTS DEVIATION: upstream redshift-alpha does NOT pass `excludeCharacters` here
      // (it relies on the rotation Lambda's default exclusion set). Carried over from the
      // `../docdb/cluster.ts` house pattern so rotated passwords honour the same exclusion set as
      // the originally generated one.
      excludeCharacters: (this.node.tryFindChild("Secret") as DatabaseSecret)
        .excludeCharacters,
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
      application:
        secretsmanager.SecretRotationApplication.REDSHIFT_ROTATION_MULTI_USER,
      // TERRACONSTRUCTS DEVIATION: upstream redshift-alpha does NOT pass `excludeCharacters` here
      // — see the identical note in `addRotationSingleUser` above.
      excludeCharacters: (this.node.tryFindChild("Secret") as DatabaseSecret)
        .excludeCharacters,
      vpc: this.vpc,
      vpcSubnets: this.vpcSubnets,
      target: this,
    });
  }

  private validateNodeCount(
    clusterType: ClusterType,
    numberOfNodes?: number,
  ): number | undefined {
    if (clusterType === ClusterType.SINGLE_NODE) {
      // This property must not be set for single-node clusters; be generous and treat a value of 1 node as undefined.
      if (numberOfNodes !== undefined && numberOfNodes !== 1) {
        throw new ValidationError(
          "Number of nodes must be not be supplied or be 1 for cluster type single-node",
          this,
        );
      }
      return undefined;
    } else {
      if (Token.isUnresolved(numberOfNodes)) {
        return numberOfNodes;
      }
      const nodeCount = numberOfNodes ?? 2;
      if (nodeCount < 2 || nodeCount > 100) {
        throw new ValidationError(
          "Number of nodes for cluster type multi-node must be at least 2 and no more than 100",
          this,
        );
      }
      return nodeCount;
    }
  }

  /**
   * Adds a parameter to the Clusters' parameter group
   *
   * @param name the parameter name
   * @param value the parameter name
   */
  public addToParameterGroup(name: string, value: string): void {
    if (!this.parameterGroup) {
      const param: { [name: string]: string } = {};
      param[name] = value;
      this.parameterGroup = new ClusterParameterGroup(this, "ParameterGroup", {
        description: this.clusterIdentifierInput
          ? `Parameter Group for the ${this.clusterIdentifierInput} Redshift cluster`
          : "Cluster parameter group for family redshift-1.0",
        parameters: param,
      });
      this.resource.clusterParameterGroupName =
        this.parameterGroup.clusterParameterGroupName;
    } else if (this.parameterGroup instanceof ClusterParameterGroup) {
      this.parameterGroup.addParameter(name, value);
    } else {
      throw new ValidationError(
        "Cannot add a parameter to an imported parameter group.",
        this,
      );
    }
  }

  // TODO(scope-reduction): omitted in this port. Upstream's `enableRebootForParameterChanges()` is
  // backed entirely by a `Custom::RedshiftClusterRebooter` CloudFormation custom resource: a
  // `lambda.SingletonFunction` (asset-bundled handler) invoked via a `cr.Provider`/`CustomResource`
  // pair that calls the Redshift `RebootCluster` API whenever the cluster's parameter group content
  // changes. TerraConstructs has no framework equivalent to CDK's `Provider`/`CustomResource` L2s
  // (Lambda-backed custom-resource lifecycle management with CREATE/UPDATE/DELETE event routing) in
  // this repo yet, so this method is ported here verbatim but fully commented out, per the
  // scope-reduction directive for this PR -- see the file-header SCOPE REDUCTION note and the
  // `addDefaultIamRole()` TERRACONSTRUCTS DEVIATION below for the sibling omission of the same root
  // cause. Re-enabling this method is a de-commenting exercise once a custom-resource Lambda
  // framework lands in this repo —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/cluster.ts#L829-L893
  //
  // public enableRebootForParameterChanges(): void {
  //   if (this.node.tryFindChild('RedshiftClusterRebooterCustomResource')) {
  //     return;
  //   }
  //   const rebootFunction = new lambda.SingletonFunction(this, 'RedshiftClusterRebooterFunction', {
  //     uuid: '511e207f-13df-4b8b-b632-c32b30b65ac2',
  //     runtime: lambda.determineLatestNodeRuntime(this),
  //     code: lambda.Code.fromAsset(path.join(__dirname, '..', 'custom-resource-handlers', 'dist', 'aws-redshift-alpha', 'cluster-parameter-change-reboot-handler')),
  //     handler: 'index.handler',
  //     timeout: Duration.seconds(900),
  //   });
  //   rebootFunction.addToRolePolicy(new iam.PolicyStatement({
  //     actions: ['redshift:DescribeClusters'],
  //     resources: ['*'],
  //   }));
  //   rebootFunction.addToRolePolicy(new iam.PolicyStatement({
  //     actions: ['redshift:RebootCluster'],
  //     resources: [
  //       Stack.of(this).formatArn({
  //         service: 'redshift',
  //         resource: 'cluster',
  //         resourceName: this.clusterName,
  //         arnFormat: ArnFormat.COLON_RESOURCE_NAME,
  //       }),
  //     ],
  //   }));
  //   const provider = new Provider(this, 'ResourceProvider', {
  //     onEventHandler: rebootFunction,
  //   });
  //   const customResource = new CustomResource(this, 'RedshiftClusterRebooterCustomResource', {
  //     resourceType: 'Custom::RedshiftClusterRebooter',
  //     serviceToken: provider.serviceToken,
  //     properties: {
  //       ClusterId: this.clusterName,
  //       ParameterGroupName: Lazy.string({
  //         produce: () => {
  //           if (!this.parameterGroup) {
  //             throw new ValidationError('Cannot enable reboot for parameter changes when there is no associated ClusterParameterGroup.', this);
  //           }
  //           return this.parameterGroup.clusterParameterGroupName;
  //         },
  //       }),
  //       ParametersString: Lazy.string({
  //         produce: () => {
  //           if (!(this.parameterGroup instanceof ClusterParameterGroup)) {
  //             throw new ValidationError('Cannot enable reboot for parameter changes when using an imported parameter group.', this);
  //           }
  //           return JSON.stringify(this.parameterGroup.parameters);
  //         },
  //       }),
  //     },
  //   });
  //   Lazy.any({
  //     produce: () => {
  //       if (!this.parameterGroup) {
  //         throw new ValidationError('Cannot enable reboot for parameter changes when there is no associated ClusterParameterGroup.', this);
  //       }
  //       customResource.node.addDependency(this, this.parameterGroup);
  //     },
  //   });
  // }

  /**
   * Adds default IAM role to cluster. The default IAM role must be already associated to the cluster to be added as the default role.
   *
   * TERRACONSTRUCTS DEVIATION: upstream shells out to the Redshift API via an `AwsCustomResource`
   * (`modifyClusterIamRoles`, on both CREATE/UPDATE and DELETE) to set the cluster's default IAM
   * role -- there is no CloudFormation property for it. The `aws_redshift_cluster` Terraform
   * resource exposes the identical capability NATIVELY as the `default_iam_role_arn` argument (a
   * strict improvement: no Lambda-backed custom resource, no extra `grantPassRole` IAM wiring, and
   * `terraform destroy` naturally clears it along with the cluster). This method keeps upstream's
   * public API (including the "must already be in the roles list" validation) but implements it by
   * mutating the L1 resource's `defaultIamRoleArn` property directly instead.
   *
   * @param defaultIamRole the IAM role to be set as the default role
   */
  public addDefaultIamRole(defaultIamRole: iam.IRole): void {
    // Check to see if default role is included in list of cluster IAM roles
    if (!this.roles.includes(defaultIamRole)) {
      throw new ValidationError(
        "Default role must be associated to the Redshift cluster to be set as the default role.",
        this,
      );
    }

    this.resource.defaultIamRoleArn = defaultIamRole.roleArn;
  }

  /**
   * Adds a role to the cluster
   *
   * @param role the role to add
   */
  public addIamRole(role: iam.IRole): void {
    if (this.roles.includes(role)) {
      throw new ValidationError(
        `Role '${role.roleArn}' is already attached to the cluster`,
        this,
      );
    }

    this.roles.push(role);
  }
}
