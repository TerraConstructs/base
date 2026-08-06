// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/proxy.ts

import {
  dbProxy,
  dbProxyDefaultTargetGroup,
  dbProxyTarget,
  rdsClusterInstance,
} from "@cdktn/provider-aws";
import { Lazy, TerraformResource, Token } from "cdktn";
import type { Construct } from "constructs";
import type { IDatabaseCluster } from "./cluster-ref";
import type { IEngine } from "./engine";
import type { IDatabaseInstance } from "./instance";
import { engineDescription } from "./private/util";
import type {
  DatabaseProxyEndpointOptions,
  IDatabaseProxyEndpoint,
} from "./proxy-endpoint";
import { DatabaseProxyEndpoint } from "./proxy-endpoint";
import type { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import { ArnFormat } from "../../arn";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as ec2 from "../../compute";
import * as secretsmanager from "../../encryption";
import * as iam from "../../iam";

/**
 * Client password authentication type used by a proxy to log in as a specific database user.
 */
export enum ClientPasswordAuthType {
  /**
   * MySQL Native Password client authentication type.
   */
  MYSQL_NATIVE_PASSWORD = "MYSQL_NATIVE_PASSWORD",
  /**
   * SCRAM SHA 256 client authentication type.
   */
  POSTGRES_SCRAM_SHA_256 = "POSTGRES_SCRAM_SHA_256",
  /**
   * PostgreSQL MD5 client authentication type.
   */
  POSTGRES_MD5 = "POSTGRES_MD5",
  /**
   * SQL Server Authentication client authentication type.
   */
  SQL_SERVER_AUTHENTICATION = "SQL_SERVER_AUTHENTICATION",
  /**
   * MySQL Caching SHA2 Password client authentication type.
   */
  MYSQL_CACHING_SHA2_PASSWORD = "MYSQL_CACHING_SHA2_PASSWORD",
}

/**
 * The default authentication scheme that the proxy uses for client connections to the proxy and connections from the proxy to the underlying database.
 */
export enum DefaultAuthScheme {
  /**
   * IAM authentication.
   */
  IAM_AUTH = "IAM_AUTH",

  /**
   * No default authentication.
   */
  NONE = "NONE",
}

/**
 * SessionPinningFilter
 *
 * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html#rds-proxy-pinning
 */
export class SessionPinningFilter {
  /**
   * You can opt out of session pinning for the following kinds of application statements:
   *
   * - Setting session variables and configuration settings.
   */
  public static readonly EXCLUDE_VARIABLE_SETS = new SessionPinningFilter(
    "EXCLUDE_VARIABLE_SETS",
  );

  /**
   * custom filter
   */
  public static of(filterName: string): SessionPinningFilter {
    return new SessionPinningFilter(filterName);
  }

  private constructor(
    /**
     * Filter name
     */
    public readonly filterName: string,
  ) {}
}

/**
 * Proxy target: Instance or Cluster
 *
 * A target group is a collection of databases that the proxy can connect to.
 * Currently, you can specify only one RDS DB instance or Aurora DB cluster.
 */
export class ProxyTarget {
  /**
   * From instance
   *
   * @param instance RDS database instance
   */
  public static fromInstance(instance: IDatabaseInstance): ProxyTarget {
    return new ProxyTarget(instance, undefined);
  }

  /**
   * From cluster
   *
   * @param cluster RDS database cluster
   */
  public static fromCluster(cluster: IDatabaseCluster): ProxyTarget {
    return new ProxyTarget(undefined, cluster);
  }

  private constructor(
    private readonly dbInstance: IDatabaseInstance | undefined,
    private readonly dbCluster: IDatabaseCluster | undefined,
  ) {}

  /**
   * Bind this target to the specified database proxy.
   */
  public bind(proxy: DatabaseProxy): ProxyTargetConfig {
    const engine: IEngine | undefined =
      this.dbInstance?.engine ?? this.dbCluster?.engine;

    if (!engine) {
      const errorResource = this.dbCluster ?? this.dbInstance;
      throw new ValidationError(
        `Could not determine engine for proxy target '${errorResource?.node.path}'. ` +
          "Please provide it explicitly when importing the resource",
        proxy,
      );
    }

    const engineFamily = engine.engineFamily;
    if (!engineFamily) {
      throw new ValidationError(
        "RDS proxies require an engine family to be specified on the database cluster or instance. " +
          `No family specified for engine '${engineDescription(engine)}'`,
        proxy,
      );
    }

    // allow connecting to the Cluster/Instance from the Proxy
    this.dbCluster?.connections.allowDefaultPortFrom(
      proxy,
      "Allow connections to the database Cluster from the Proxy",
    );
    this.dbInstance?.connections.allowDefaultPortFrom(
      proxy,
      "Allow connections to the database Instance from the Proxy",
    );

    return {
      engineFamily,
      dbClusters: this.dbCluster ? [this.dbCluster] : undefined,
      dbInstances: this.dbInstance ? [this.dbInstance] : undefined,
    };
  }
}

/**
 * The result of binding a `ProxyTarget` to a `DatabaseProxy`.
 */
export interface ProxyTargetConfig {
  /**
   * The engine family of the database instance or cluster this proxy connects with.
   */
  readonly engineFamily: string;

  /**
   * The database instances to which this proxy connects.
   * Either this or `dbClusters` will be set and the other `undefined`.
   * @default - `undefined` if `dbClusters` is set.
   */
  readonly dbInstances?: IDatabaseInstance[];

  /**
   * The database clusters to which this proxy connects.
   * Either this or `dbInstances` will be set and the other `undefined`.
   * @default - `undefined` if `dbInstances` is set.
   */
  readonly dbClusters?: IDatabaseCluster[];
}

/**
 * Options for a new DatabaseProxy
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn), which
 * upstream's `DatabaseProxyOptions` does not — matching the base-idiom used throughout this repo
 * (e.g. `DatabaseInstanceNewProps`, `DatabaseClusterBaseProps`) for cross-account/-region construct
 * placement.
 */
export interface DatabaseProxyOptions extends AwsConstructProps {
  /**
   * The identifier for the proxy.
   * This name must be unique for all proxies owned by your AWS account in the specified AWS Region.
   * An identifier must begin with a letter and must contain only ASCII letters, digits, and hyphens;
   * it can't end with a hyphen or contain two consecutive hyphens.
   *
   * @default - Generated by CloudFormation (recommended)
   */
  readonly dbProxyName?: string;

  /**
   * The duration for a proxy to wait for a connection to become available in the connection pool.
   * Only applies when the proxy has opened its maximum number of connections and all connections are busy with client
   * sessions.
   *
   * Value must be between 1 second and 1 hour, or `Duration.seconds(0)` to represent unlimited.
   *
   * @default cdk.Duration.seconds(120)
   */
  readonly borrowTimeout?: Duration;

  /**
   * One or more SQL statements for the proxy to run when opening each new database connection.
   * Typically used with SET statements to make sure that each connection has identical settings such as time zone
   * and character set.
   * For multiple statements, use semicolons as the separator.
   * You can also include multiple variables in a single SET statement, such as SET x=1, y=2.
   *
   * not currently supported for PostgreSQL.
   *
   * @default - no initialization query
   */
  readonly initQuery?: string;

  /**
   * The maximum size of the connection pool for each target in a target group.
   * For Aurora MySQL, it is expressed as a percentage of the max_connections setting for the RDS DB instance or Aurora DB
   * cluster used by the target group.
   *
   * 1-100
   *
   * @default 100
   */
  readonly maxConnectionsPercent?: number;

  /**
   * Controls how actively the proxy closes idle database connections in the connection pool.
   * A high value enables the proxy to leave a high percentage of idle connections open.
   * A low value causes the proxy to close idle client connections and return the underlying database connections
   * to the connection pool.
   * For Aurora MySQL, it is expressed as a percentage of the max_connections setting for the RDS DB instance
   * or Aurora DB cluster used by the target group.
   *
   * between 0 and MaxConnectionsPercent
   *
   * @default 50
   */
  readonly maxIdleConnectionsPercent?: number;

  /**
   * Each item in the list represents a class of SQL operations that normally cause all later statements in a session
   * using a proxy to be pinned to the same underlying database connection.
   * Including an item in the list exempts that class of SQL operations from the pinning behavior.
   *
   * @default - no session pinning filters
   */
  readonly sessionPinningFilters?: SessionPinningFilter[];

  /**
   * Whether the proxy includes detailed information about SQL statements in its logs.
   * This information helps you to debug issues involving SQL behavior or the performance and scalability of the proxy connections.
   * The debug information includes the text of SQL statements that you submit through the proxy.
   * Thus, only enable this setting when needed for debugging, and only when you have security measures in place to safeguard any sensitive
   * information that appears in the logs.
   *
   * @default false
   */
  readonly debugLogging?: boolean;

  /**
   * Whether to require or disallow AWS Identity and Access Management (IAM) authentication for connections to the proxy.
   *
   * @default false
   */
  readonly iamAuth?: boolean;

  /**
   * The number of seconds that a connection to the proxy can be inactive before the proxy disconnects it.
   * You can set this value higher or lower than the connection timeout limit for the associated database.
   *
   * @default cdk.Duration.minutes(30)
   */
  readonly idleClientTimeout?: Duration;

  /**
   * A Boolean parameter that specifies whether Transport Layer Security (TLS) encryption is required for connections to the proxy.
   * By enabling this setting, you can enforce encrypted TLS connections to the proxy.
   *
   * @default true
   */
  readonly requireTLS?: boolean;

  /**
   * IAM role that the proxy uses to access secrets in AWS Secrets Manager.
   *
   * @default - A role will automatically be created
   */
  readonly role?: iam.IRole;

  /**
   * The secret that the proxy uses to authenticate to the RDS DB instance or Aurora DB cluster.
   * These secrets are stored within Amazon Secrets Manager.
   * One or more secrets are required when defaultAuthScheme is `DefaultAuthScheme.NONE`.
   *
   * @default None
   */
  readonly secrets?: secretsmanager.ISecret[];

  /**
   * One or more VPC security groups to associate with the new proxy.
   *
   * @default - No security groups
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * The subnets used by the proxy.
   *
   * @default - the VPC default strategy if not specified.
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * The VPC to associate with the new proxy.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Specifies the details of authentication used by a proxy to log in as a specific database user.
   *
   * @default - CloudFormation defaults will apply given the specified database engine.
   */
  readonly clientPasswordAuthType?: ClientPasswordAuthType;

  /**
   * The default authentication scheme that the proxy uses for client connections to the proxy and connections from the proxy to the underlying database.
   * When set to `DefaultAuthScheme.IAM_AUTH`, the proxy uses end-to-end IAM authentication to connect to the database.
   *
   * @default DefaultAuthScheme.NONE
   */
  readonly defaultAuthScheme?: DefaultAuthScheme;
}

/**
 * Construction properties for a DatabaseProxy
 */
export interface DatabaseProxyProps extends DatabaseProxyOptions {
  /**
   * DB proxy target: Instance or Cluster
   */
  readonly proxyTarget: ProxyTarget;
}

/**
 * Properties that describe an existing DB Proxy
 */
export interface DatabaseProxyAttributes {
  /**
   * DB Proxy Name
   */
  readonly dbProxyName: string;

  /**
   * DB Proxy ARN
   */
  readonly dbProxyArn: string;

  /**
   * Endpoint
   */
  readonly endpoint: string;

  /**
   * The security groups of the instance.
   */
  readonly securityGroups: ec2.ISecurityGroup[];
}

/**
 * DB Proxy
 *
 * TODO: omitted — upstream also extends `aws_rds.IDBProxyRef`, a CloudFormation cross-stack
 * "Reference" marker interface generated from the CFN resource spec. TerraConstructs has no
 * equivalent generated-reference layer (identical omission to `dbInstanceRef`/`IDBInstanceRef` on
 * `IDatabaseInstance` in `./instance.ts` — see the TODO there), so `dbProxyRef` is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/proxy.ts#L369
 */
export interface IDatabaseProxy extends IAwsConstruct {
  /**
   * DB Proxy Name
   *
   * @attribute
   */
  readonly dbProxyName: string;

  /**
   * DB Proxy ARN
   *
   * @attribute
   */
  readonly dbProxyArn: string;

  /**
   * Endpoint
   *
   * @attribute
   */
  readonly endpoint: string;

  /**
   * Grant the given identity connection access to the proxy.
   *
   * @param grantee the Principal to grant the permissions to
   * @param dbUser the name of the database user to allow connecting as to the proxy
   *
   * @default - if the Proxy had been provided a single Secret value,
   *   the user will be taken from that Secret
   */
  grantConnect(grantee: iam.IGrantable, dbUser?: string): iam.Grant;
}

/**
 * Represents an RDS Database Proxy.
 *
 */
abstract class DatabaseProxyBase
  extends AwsConstructBase
  implements IDatabaseProxy
{
  public abstract readonly dbProxyName: string;
  public abstract readonly dbProxyArn: string;
  public abstract readonly endpoint: string;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `DatabaseInstanceBase`/`SubnetGroup`/`OptionGroup`/`ParameterGroup`) — bare, bound-per-construct
   * `outputs` for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      dbProxyName: this.dbProxyName,
      dbProxyArn: this.dbProxyArn,
      endpoint: this.endpoint,
    };
  }

  // TODO: omitted — see the TODO on `IDatabaseProxy` above; upstream's `dbProxyRef` getter
  // (returning `aws_rds.DBProxyReference`) has no equivalent generated-reference type in this repo.
  // public get dbProxyRef(): aws_rds.DBProxyReference {
  //   return {
  //     dbProxyName: this.dbProxyName,
  //     dbProxyArn: this.dbProxyArn,
  //   };
  // }

  public grantConnect(grantee: iam.IGrantable, dbUser?: string): iam.Grant {
    if (!dbUser) {
      throw new ValidationError(
        "For imported Database Proxies, the dbUser is required in grantConnect()",
        this,
      );
    }
    const proxyGeneratedId = this.stack.splitArn(
      this.dbProxyArn,
      ArnFormat.COLON_RESOURCE_NAME,
    ).resourceName;
    const userArn = this.stack.formatArn({
      service: "rds-db",
      resource: "dbuser",
      resourceName: `${proxyGeneratedId}/${dbUser}`,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["rds-db:connect"],
      resourceArns: [userArn],
    });
  }
}

/**
 * RDS Database Proxy
 *
 * @resource aws_db_proxy
 */
export class DatabaseProxy
  extends DatabaseProxyBase
  implements ec2.IConnectable, secretsmanager.ISecretAttachmentTarget
{
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.DatabaseProxy";

  /**
   * Import an existing database proxy.
   */
  public static fromDatabaseProxyAttributes(
    scope: Construct,
    id: string,
    attrs: DatabaseProxyAttributes,
  ): IDatabaseProxy {
    // NOTE: mirrors upstream exactly -- `attrs.securityGroups` is accepted for API-shape parity
    // but, just like upstream's `Import` class, is not actually wired to anything below: an
    // imported `DatabaseProxy` (via `DatabaseProxyBase`) never gained a `connections`/
    // `ec2.IConnectable` member on its base interface upstream either, so there is nothing here to
    // attach the security groups to.
    class Import extends DatabaseProxyBase {
      public readonly dbProxyName = attrs.dbProxyName;
      public readonly dbProxyArn = attrs.dbProxyArn;
      public readonly endpoint = attrs.endpoint;
    }
    return new Import(scope, id);
  }

  /**
   * DB Proxy Name
   *
   * @attribute
   */
  public readonly dbProxyName: string;

  /**
   * DB Proxy ARN
   *
   * @attribute
   */
  public readonly dbProxyArn: string;

  /**
   * Endpoint
   *
   * @attribute
   */
  public readonly endpoint: string;

  /**
   * Access to network connections.
   */
  public readonly connections: ec2.Connections;

  /**
   * The underlying `aws_db_proxy` L1.
   */
  public readonly resource: dbProxy.DbProxy;

  private readonly secrets?: secretsmanager.ISecret[];
  private readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: DatabaseProxyProps) {
    super(scope, id, props);

    // TERRACONSTRUCTS DEVIATION: repo invariant -- unnamed resources get a gridUUID-scoped
    // `uniqueResourceName` default instead of relying on CloudFormation's Ref-based logical-id
    // naming (which this repo has no equivalent of) or the provider's own generated
    // `terraform-<hash>` fallback -- same idiom as `DatabaseInstanceNew`/`DatabaseClusterNew` in
    // `./instance.ts`/`./cluster.ts`. This also drops upstream's
    // `DATABASE_PROXY_UNIQUE_RESOURCE_NAME` feature-flag branch (which toggles between the
    // construct id and a unique name) -- `name` is a REQUIRED, non-computed argument on the
    // Terraform `aws_db_proxy` resource (see `node_modules/@cdktn/provider-aws/lib/db-proxy/index.d.ts`),
    // unlike CloudFormation's `AWS::RDS::DBProxy` (which auto-generates a name when `DBProxyName`
    // is omitted), so a synth-time default must always be computed -- there is no "let
    // CloudFormation/the flag decide" branch to preserve. Unlike `DatabaseInstanceNew`'s
    // `instanceIdentifier` default, the generated default IS lowercased: the Terraform AWS
    // provider validates `aws_db_proxy.name` as lowercase-alphanumeric-and-hyphens at plan time
    // ("only lowercase alphanumeric characters and hyphens allowed in \"name\"") — live-caught by
    // integ/aws/storage TestRdsProxy. Caller-supplied names are passed through untouched (the
    // provider rejects uppercase with a clear error).
    const physicalName =
      props.dbProxyName ??
      this.stack.uniqueResourceName(this, { maxLength: 60 }).toLowerCase();

    const role =
      props.role ||
      new iam.Role(this, "IAMRole", {
        assumedBy: new iam.ServicePrincipal("rds.amazonaws.com"),
      });

    if (props.secrets) {
      for (const secret of props.secrets) {
        secret.grantRead(role);
        if (secret.encryptionKey) {
          secret.encryptionKey.grantDecrypt(role);
        }
      }
    }

    const securityGroups = props.securityGroups ?? [
      new ec2.SecurityGroup(this, "ProxySecurityGroup", {
        description: "SecurityGroup for Database Proxy",
        vpc: props.vpc,
      }),
    ];
    this.connections = new ec2.Connections({ securityGroups });

    const bindResult = props.proxyTarget.bind(this);

    const requiresSecrets =
      !props.defaultAuthScheme ||
      props.defaultAuthScheme === DefaultAuthScheme.NONE;
    if (requiresSecrets && !props.secrets?.length) {
      throw new ValidationError(
        "One or more secrets are required when defaultAuthScheme is not specified or is NONE.",
        this,
      );
    }
    this.secrets = props.secrets;

    this.validateClientPasswordAuthType(
      bindResult.engineFamily,
      props.clientPasswordAuthType,
    );

    this.resource = new dbProxy.DbProxy(this, "Resource", {
      // NOTE: `clientPasswordAuthType` stays omitted when unset -- AWS applies an
      // engine-family default server-side and the provider does NOT report drift on
      // the omission (live-verified by integ/aws/storage TestRdsProxy's drift oracle,
      // PASS with a clean post-apply plan).
      auth: props.secrets?.map((_) => {
        return {
          authScheme: "SECRETS",
          clientPasswordAuthType: props.clientPasswordAuthType,
          iamAuth: props.iamAuth ? "REQUIRED" : "DISABLED",
          secretArn: _.secretArn,
        };
      }),
      name: physicalName,
      debugLogging: props.debugLogging,
      engineFamily: bindResult.engineFamily,
      idleClientTimeout: props.idleClientTimeout?.toSeconds(),
      requireTls: props.requireTLS ?? true,
      roleArn: role.roleArn,
      vpcSecurityGroupIds: Lazy.listValue({
        produce: () =>
          this.connections.securityGroups.map((_) => _.securityGroupId),
      }),
      vpcSubnetIds: props.vpc.selectSubnets(props.vpcSubnets).subnetIds,
      defaultAuthScheme: props.defaultAuthScheme,
    });

    this.dbProxyName = this.resource.name;
    this.dbProxyArn = this.resource.arn;
    this.endpoint = this.resource.endpoint;
    this.vpc = props.vpc;

    // TERRACONSTRUCTS DEVIATION: upstream's single `CfnDBProxyTargetGroup` (`AWS::RDS::DBProxyTargetGroup`)
    // has NO equivalent single Terraform resource -- the AWS provider splits target-GROUP
    // configuration (connection pool settings) from target-MEMBERSHIP (which instance/cluster
    // belongs to the group) into two distinct resource types: `aws_db_proxy_default_target_group`
    // (this repo's `dbProxyDefaultTargetGroup.DbProxyDefaultTargetGroup`) and `aws_db_proxy_target`
    // (`dbProxyTarget.DbProxyTarget`). Both are created below. See
    // `node_modules/@cdktn/provider-aws/lib/db-proxy-default-target-group/index.d.ts` and
    // `.../db-proxy-target/index.d.ts`.
    const defaultTargetGroup =
      new dbProxyDefaultTargetGroup.DbProxyDefaultTargetGroup(
        this,
        "ProxyTargetGroup",
        {
          dbProxyName: this.dbProxyName,
          connectionPoolConfig: toConnectionPoolConfigurationInfo(props),
        },
      );
    // The default target group is implicitly created by RDS alongside the proxy itself; depending
    // on the proxy resource keeps ordering explicit (mirrors the implicit CFN `DBProxyName` `Ref`
    // dependency upstream gets "for free" from `CfnDBProxyTargetGroup.dbProxyName: this.dbProxyName`).
    defaultTargetGroup.node.addDependency(this.resource);

    let dbInstanceIdentifier: string | undefined;
    if (bindResult.dbInstances) {
      // support for only single instance
      dbInstanceIdentifier = bindResult.dbInstances[0].instanceIdentifier;
    }

    let dbClusterIdentifier: string | undefined;
    if (bindResult.dbClusters) {
      // TERRACONSTRUCTS DEVIATION: `ProxyTarget` only ever binds a single instance OR a single
      // cluster (see `ProxyTarget.bind()` above -- `dbInstances`/`dbClusters` are always
      // `undefined` or a 1-element array), and the Terraform `aws_db_proxy_target` resource takes a
      // single `dbClusterIdentifier`/`dbInstanceIdentifier` string (not the array upstream's CFN
      // `DBClusterIdentifiers`/`DBInstanceIdentifiers` properties accept), so only the first (only)
      // element is ever used.
      dbClusterIdentifier = bindResult.dbClusters[0].clusterIdentifier;
    }

    if (!!dbInstanceIdentifier && !!dbClusterIdentifier) {
      throw new ValidationError(
        "Cannot specify both dbInstanceIdentifiers and dbClusterIdentifiers",
        this,
      );
    }

    const proxyTarget = new dbProxyTarget.DbProxyTarget(this, "ProxyTarget", {
      dbProxyName: this.dbProxyName,
      targetGroupName: "default",
      dbInstanceIdentifier,
      dbClusterIdentifier,
    });
    proxyTarget.node.addDependency(defaultTargetGroup);

    // When a `DatabaseProxy` is created by `DatabaseCluster.addProxy`,
    // the `DatabaseProxy` and `DBProxyTarget` are created as a child of the `DatabaseCluster`,
    // so if multiple `DatabaseProxy` are created by `DatabaseCluster.addProxy`,
    // using `node.addDependency` will cause circular dependencies.
    // To avoid this, dependencies are added directly on the synthesized `aws_db_proxy_target`
    // resource (mirrors upstream's `CfnResource.addResourceDependency` on `proxyTargetGroup`,
    // adapted to this repo's split target-group/target resources -- see the deviation note above).
    bindResult.dbClusters?.forEach((cluster) => {
      cluster.node.children.forEach((child) => {
        // Legacy case using the `instanceProps` property of `DatabaseCluster` -- the child IS the
        // `aws_rds_cluster_instance` L1 directly (see `legacyCreateInstances` in `./cluster.ts`,
        // which is this repo's Terraform-native replacement for upstream's `CfnDBInstance`-based
        // cluster members -- see the deviation note there).
        if (child instanceof rdsClusterInstance.RdsClusterInstance) {
          proxyTarget.node.addDependency(child);
        }
        // The case of `AuroraClusterInstance` constructs passed via the `writer` and `readers`
        // properties of `DatabaseCluster`. We can't use the `AuroraClusterInstance` class to check
        // the type with `instanceof` because the class is not exported. The `defaultChild` that the
        // construct has should be a `rdsClusterInstance.RdsClusterInstance`, so check it (see
        // `AuroraClusterInstance`'s constructor in `./aurora-cluster-instance.ts`, which always
        // creates its L1 with construct id `"Resource"`, the id `constructs`' `Node.defaultChild`
        // resolves to automatically).
        const resource = child.node.defaultChild;
        if (resource instanceof rdsClusterInstance.RdsClusterInstance) {
          proxyTarget.node.addDependency(resource);
        }
      });
      const clusterResource = cluster.node.defaultChild;
      if (
        clusterResource &&
        TerraformResource.isTerraformResource(clusterResource)
      ) {
        proxyTarget.node.addDependency(clusterResource);
      }
    });
  }

  /**
   * Add an Endpoint to this DB Proxy
   */
  public addEndpoint(
    id: string,
    options?: DatabaseProxyEndpointOptions,
  ): IDatabaseProxyEndpoint {
    return new DatabaseProxyEndpoint(this, id, {
      dbProxy: this,
      vpc: this.vpc,
      ...options,
    });
  }

  /**
   * Renders the secret attachment target specifications.
   *
   * TERRACONSTRUCTS DEVIATION (AWS REALITY NOTE): unlike `DatabaseInstanceBase`/
   * `DatabaseClusterNew` (which populate `connectionFields` because the Terraform provider has no
   * server-side merge -- see `ISecretAttachmentTarget` in `../../encryption/secret.ts`), no
   * `connectionFields` are supplied here. CloudFormation's own
   * `AWS::SecretsManager::SecretTargetAttachment` `TargetType` property does NOT actually document
   * `AWS::RDS::DBProxy` as a supported value -- only `AWS::RDS::DBInstance` | `AWS::RDS::DBCluster` |
   * `AWS::Redshift::Cluster` | `AWS::RedshiftServerless::Namespace` | `AWS::DocDB::DBInstance` |
   * `AWS::DocDB::DBCluster` | `AWS::DocDBElastic::Cluster` are listed --
   * https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-secretsmanager-secrettargetattachment.html.
   * Upstream's `RDS_DB_PROXY` target type (and this class implementing `ISecretAttachmentTarget` at
   * all) is therefore itself API-shape-only parity, never server-side-verified by AWS -- this port
   * mirrors that shape (`targetId`/`targetType` only, no connection fields) for the same reason.
   * `secret.attach(proxy)` is accepted here for interface compatibility, but is not expected to
   * behave meaningfully -- which is moot in practice, since the underlying `aws_secretsmanager_secret`
   * resource (see `Secret.attach()`) never calls any CloudFormation-only API to begin with.
   */
  public asSecretAttachmentTarget(): secretsmanager.SecretAttachmentTargetProps {
    return {
      targetId: this.dbProxyName,
      targetType: secretsmanager.AttachmentTargetType.RDS_DB_PROXY,
    };
  }

  /**
   * [disable-awslint:no-grants]
   */
  public grantConnect(grantee: iam.IGrantable, dbUser?: string): iam.Grant {
    if (!dbUser) {
      if (!this.secrets?.length) {
        throw new ValidationError(
          "When using IAM authentication without secrets, you must specify a dbUser parameter in grantConnect().",
          this,
        );
      }
      if (this.secrets.length > 1) {
        throw new ValidationError(
          "When the Proxy contains multiple Secrets, you must pass a dbUser explicitly to grantConnect()",
          this,
        );
      }
      // TERRACONSTRUCTS DEVIATION: upstream defaults `dbUser` here by reading it back out of the
      // secret's JSON value via `secret.secretValueFromJson('username').unsafeUnwrap()` -- a
      // CloudFormation dynamic reference, not portable (see the `ISecret` deviation note in
      // `../../encryption/secret.ts`, and the identical adaptation for `DatabaseInstanceSource`'s
      // `masterUsername` stash in `./instance.ts`). Unlike `DatabaseInstanceSource`, `DatabaseProxy`
      // does not create its own secret -- `secrets` is an arbitrary caller-supplied
      // `secretsmanager.ISecret[]` -- so there is no plain-string username known at construction
      // time to stash the way `DatabaseInstanceSource` does. Callers must pass `dbUser` explicitly.
      throw new ValidationError(
        "grantConnect() without a dbUser is not supported in TerraConstructs when the Proxy has a single secret (depends on ISecret.secretValueFromJson, not ported). Pass dbUser explicitly.",
        this,
      );
    }
    return super.grantConnect(grantee, dbUser);
  }

  private validateClientPasswordAuthType(
    engineFamily: string,
    clientPasswordAuthType?: ClientPasswordAuthType,
  ) {
    if (!clientPasswordAuthType || Token.isUnresolved(clientPasswordAuthType))
      return;
    if (
      clientPasswordAuthType === ClientPasswordAuthType.MYSQL_NATIVE_PASSWORD &&
      engineFamily !== "MYSQL"
    ) {
      throw new ValidationError(
        `${ClientPasswordAuthType.MYSQL_NATIVE_PASSWORD} client password authentication type requires MYSQL engineFamily, got ${engineFamily}`,
        this,
      );
    }
    if (
      clientPasswordAuthType ===
        ClientPasswordAuthType.POSTGRES_SCRAM_SHA_256 &&
      engineFamily !== "POSTGRESQL"
    ) {
      throw new ValidationError(
        `${ClientPasswordAuthType.POSTGRES_SCRAM_SHA_256} client password authentication type requires POSTGRESQL engineFamily, got ${engineFamily}`,
        this,
      );
    }
    if (
      clientPasswordAuthType === ClientPasswordAuthType.POSTGRES_MD5 &&
      engineFamily !== "POSTGRESQL"
    ) {
      throw new ValidationError(
        `${ClientPasswordAuthType.POSTGRES_MD5} client password authentication type requires POSTGRESQL engineFamily, got ${engineFamily}`,
        this,
      );
    }
    if (
      clientPasswordAuthType ===
        ClientPasswordAuthType.SQL_SERVER_AUTHENTICATION &&
      engineFamily !== "SQLSERVER"
    ) {
      throw new ValidationError(
        `${ClientPasswordAuthType.SQL_SERVER_AUTHENTICATION} client password authentication type requires SQLSERVER engineFamily, got ${engineFamily}`,
        this,
      );
    }
  }
}

/**
 * ConnectionPoolConfiguration (L2 => L1)
 */
function toConnectionPoolConfigurationInfo(
  props: DatabaseProxyProps,
): dbProxyDefaultTargetGroup.DbProxyDefaultTargetGroupConnectionPoolConfig {
  return {
    connectionBorrowTimeout: props.borrowTimeout?.toSeconds(),
    initQuery: props.initQuery,
    maxConnectionsPercent: props.maxConnectionsPercent,
    maxIdleConnectionsPercent: props.maxIdleConnectionsPercent,
    sessionPinningFilters: props.sessionPinningFilters?.map(
      (_) => _.filterName,
    ),
  };
}
