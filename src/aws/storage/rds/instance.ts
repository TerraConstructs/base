// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts

import { dbInstance, dbInstanceRoleAssociation } from "@cdktn/provider-aws";
import { Annotations, Lazy, Token, Tokenization } from "cdktn";
import { Construct } from "constructs";
import type { CaCertificate } from "./ca-certificate";
import { DatabaseInsightsMode } from "./database-insights-mode";
import { DatabaseSecret } from "./database-secret";
import { Endpoint } from "./endpoint";
import type { IInstanceEngine } from "./instance-engine";
import type { IOptionGroup } from "./option-group";
import type { IParameterGroup } from "./parameter-group";
import { ParameterGroup } from "./parameter-group";
import {
  applyDefaultRotationOptions,
  defaultDeletionProtection,
  engineDescription,
  setupS3ImportExport,
  validateManagedPasswordCredentials,
} from "./private/util";
import type {
  EngineLifecycleSupport,
  RotationMultiUserOptions,
  RotationSingleUserOptions,
  SnapshotCredentials,
} from "./props";
import { Credentials, PerformanceInsightRetention } from "./props";
import type { ISubnetGroup } from "./subnet-group";
import { SubnetGroup } from "./subnet-group";
import { validateDatabaseInstanceProps } from "./validate-database-insights";
import type { Duration } from "../../../duration";
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
import * as events from "../../notify";
import type { IBucket } from "../bucket";

/**
 * A database instance
 *
 * TODO: omitted — upstream also extends `aws_rds.IDBInstanceRef`, a CloudFormation cross-stack
 * "Reference" marker interface generated from the CFN resource spec. TerraConstructs has no
 * equivalent generated-reference layer (see the identical omission on `ISubnetGroup` in
 * `./subnet-group.ts`), so `dbInstanceRef` is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L41
 */
export interface IDatabaseInstance
  extends IAwsConstruct,
    ec2.IConnectable,
    secretsmanager.ISecretAttachmentTarget {
  /**
   * The instance identifier.
   */
  readonly instanceIdentifier: string;

  /**
   * The instance arn.
   */
  readonly instanceArn: string;

  /**
   * The instance endpoint address.
   */
  readonly dbInstanceEndpointAddress: string;

  /**
   * The instance endpoint port.
   */
  readonly dbInstanceEndpointPort: string;

  /**
   * The AWS Region-unique, immutable identifier for the DB instance.
   * This identifier is found in AWS CloudTrail log entries whenever the AWS KMS key for the DB instance is accessed.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-rds-dbinstance.html#aws-resource-rds-dbinstance-return-values
   */
  readonly instanceResourceId?: string;

  /**
   * The instance endpoint.
   */
  readonly instanceEndpoint: Endpoint;

  /**
   * The engine of this database Instance.
   * May be not known for imported Instances if it wasn't provided explicitly,
   * or for read replicas.
   */
  readonly engine?: IInstanceEngine;

  // TODO: omitted — upstream also declares `addProxy(id, options): DatabaseProxy` here. `DatabaseProxy`
  // (and the `./proxy` module it lives in) is not ported in this repo yet — it lands in a later PR
  // (RDS PR 2e), matching the existing barrel deferral in `./index.ts` —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L86-L89

  /**
   * Grant the given identity connection access to the database.
   *
   * @param grantee the Principal to grant the permissions to
   * @param dbUser the name of the database user to allow connecting as to the db instance
   */
  grantConnect(grantee: iam.IGrantable, dbUser?: string): iam.Grant;

  /**
   * Defines a CloudWatch event rule which triggers for instance events. Use
   * `rule.addEventPattern(pattern)` to specify a filter.
   */
  onEvent(id: string, options?: events.OnEventOptions): events.Rule;
}

/**
 * Properties that describe an existing instance
 */
export interface DatabaseInstanceAttributes {
  /**
   * The instance identifier.
   */
  readonly instanceIdentifier: string;

  /**
   * The endpoint address.
   */
  readonly instanceEndpointAddress: string;

  /**
   * The database port.
   */
  readonly port: number;

  /**
   * The AWS Region-unique, immutable identifier for the DB instance.
   * This identifier is found in AWS CloudTrail log entries whenever the AWS KMS key for the DB instance is accessed.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-rds-dbinstance.html#aws-resource-rds-dbinstance-return-values
   */
  readonly instanceResourceId?: string;

  /**
   * The security groups of the instance.
   */
  readonly securityGroups: ec2.ISecurityGroup[];

  /**
   * The engine of the existing database Instance.
   *
   * @default - the imported Instance's engine is unknown
   */
  readonly engine?: IInstanceEngine;
}

/**
 * Properties for looking up an existing DatabaseInstance.
 */
export interface DatabaseInstanceLookupOptions {
  /**
   * The instance identifier of the DatabaseInstance
   */
  readonly instanceIdentifier: string;
}

/**
 * A new or imported database instance.
 */
export abstract class DatabaseInstanceBase
  extends AwsConstructBase
  implements IDatabaseInstance
{
  /**
   * Lookup an existing DatabaseInstance using instanceIdentifier.
   */
  public static fromLookup(
    scope: Construct,
    _id: string,
    _options: DatabaseInstanceLookupOptions,
  ): IDatabaseInstance {
    // TODO: omitted — upstream implements this via `ContextProvider.getValue(scope, { provider:
    // cxschema.ContextProvider.CC_API_PROVIDER, ... })`, a CDK-CLI-side "cdk synth" context lookup
    // against the CloudControl API (populated into `cdk.context.json` on a prior synth, then read
    // back here). CDKTF/TerraConstructs has no equivalent synth-time context-provider/lookup-cache
    // mechanism, so this cannot be ported — throwing here instead of silently returning nonsense.
    // Reinstate if/when a CDKTF-native lookup mechanism (e.g. a `data "aws_db_instance"` -backed
    // helper) is designed for this repo. The original implementation is left commented out below
    // for reference —
    // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L94-L147
    throw new ValidationError(
      "DatabaseInstanceBase.fromLookup() is not supported in TerraConstructs (it depends on the CDK CLI's context-provider lookup mechanism, which has no CDKTF equivalent). Use `fromDatabaseInstanceAttributes()` with explicitly known attributes instead.",
      scope,
    );

    // const response: {[key: string]: any}[] = ContextProvider.getValue(scope, {
    //   provider: cxschema.ContextProvider.CC_API_PROVIDER,
    //   props: {
    //     typeName: 'AWS::RDS::DBInstance',
    //     exactIdentifier: options.instanceIdentifier,
    //     propertiesToReturn: [
    //       'DBInstanceArn',
    //       'Endpoint.Address',
    //       'Endpoint.Port',
    //       'DbiResourceId',
    //       'DBSecurityGroups',
    //       'VPCSecurityGroups',
    //     ],
    //   } as cxschema.CcApiContextQuery,
    //   dummyValue: [
    //     {
    //       'Identifier': 'TEST',
    //       'DBInstanceArn': 'TESTARN',
    //       'Endpoint.Address': 'TESTADDRESS',
    //       'Endpoint.Port': '5432',
    //       'DbiResourceId': 'TESTID',
    //       'DBSecurityGroups': [],
    //       'VPCSecurityGroups': [],
    //     },
    //   ],
    // }).value;
    //
    // // getValue returns a list of result objects.  We are expecting 1 result or Error.
    // const instance = response[0];
    //
    // // Get ISecurityGroup from securityGroupId
    // let securityGroups: ec2.ISecurityGroup[] = [];
    // const sg: string[] =
    //   (instance.DBSecurityGroups && instance.DBSecurityGroups.length > 0) ? instance.DBSecurityGroups :
    //     (instance.VPCSecurityGroups && instance.VPCSecurityGroups.length > 0) ? instance.VPCSecurityGroups :
    //       [];
    // securityGroups = sg.map(securityGroupId => {
    //   return ec2.SecurityGroup.fromSecurityGroupId(
    //     scope,
    //     `LSG-${securityGroupId}`,
    //     securityGroupId,
    //   );
    // });
    //
    // return this.fromDatabaseInstanceAttributes(scope, id, {
    //   instanceEndpointAddress: instance['Endpoint.Address'],
    //   port: Number(instance['Endpoint.Port']),
    //   instanceIdentifier: options.instanceIdentifier,
    //   securityGroups: securityGroups,
    //   instanceResourceId: instance.DbiResourceId,
    // });
  }

  /**
   * Import an existing database instance.
   */
  public static fromDatabaseInstanceAttributes(
    scope: Construct,
    id: string,
    attrs: DatabaseInstanceAttributes,
  ): IDatabaseInstance {
    class Import extends DatabaseInstanceBase implements IDatabaseInstance {
      public readonly defaultPort = ec2.Port.tcp(attrs.port);
      public readonly connections = new ec2.Connections({
        securityGroups: attrs.securityGroups,
        defaultPort: this.defaultPort,
      });
      public readonly instanceIdentifier = attrs.instanceIdentifier;
      public readonly dbInstanceEndpointAddress = attrs.instanceEndpointAddress;
      public readonly dbInstanceEndpointPort = Tokenization.stringifyNumber(
        attrs.port,
      );
      public readonly instanceEndpoint = new Endpoint(
        attrs.instanceEndpointAddress,
        attrs.port,
      );
      public readonly engine = attrs.engine;
      protected enableIamAuthentication = true;
      public readonly instanceResourceId = attrs.instanceResourceId;
    }

    return new Import(scope, id, {});
  }

  public abstract readonly instanceIdentifier: string;
  public abstract readonly dbInstanceEndpointAddress: string;
  public abstract readonly dbInstanceEndpointPort: string;
  public abstract readonly instanceResourceId?: string;
  public abstract readonly instanceEndpoint: Endpoint;
  public abstract readonly engine?: IInstanceEngine;
  protected abstract enableIamAuthentication?: boolean;

  /**
   * Access to network connections.
   */
  public abstract readonly connections: ec2.Connections;

  // TODO: omitted — see the TODO on `IDatabaseInstance` above; `DatabaseProxy`/`./proxy` is not
  // ported yet (RDS PR 2e) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L246-L251
  // /**
  //  * Add a new db proxy to this instance.
  //  */
  // public addProxy(id: string, options: DatabaseProxyOptions): DatabaseProxy {
  //   return new DatabaseProxy(this, id, {
  //     proxyTarget: ProxyTarget.fromInstance(this),
  //     ...options,
  //   });
  // }

  /**
   * [disable-awslint:no-grants]
   */
  public grantConnect(grantee: iam.IGrantable, dbUser?: string): iam.Grant {
    if (this.enableIamAuthentication === false) {
      throw new ValidationError(
        "Cannot grant connect when IAM authentication is disabled",
        this,
      );
    }

    if (!this.instanceResourceId) {
      throw new ValidationError(
        "For imported Database Instances, instanceResourceId is required to grantConnect()",
        this,
      );
    }

    if (!dbUser) {
      throw new ValidationError(
        "For imported Database Instances, the dbUser is required to grantConnect()",
        this,
      );
    }

    this.enableIamAuthentication = true;
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["rds-db:connect"],
      resourceArns: [
        // The ARN of an IAM policy for IAM database access is not the same as the instance ARN, so we cannot use `this.instanceArn`.
        // See https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.IAMPolicy.html
        this.stack.formatArn({
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          service: "rds-db",
          resource: "dbuser",
          resourceName: [this.instanceResourceId, dbUser].join("/"),
        }),
      ],
    });
  }

  /**
   * Defines a CloudWatch event rule which triggers for instance events. Use
   * `rule.addEventPattern(pattern)` to specify a filter.
   */
  public onEvent(id: string, options: events.OnEventOptions = {}) {
    const rule = new events.Rule(this, id, options);
    rule.addEventPattern({
      source: ["aws.rds"],
      resources: [this.instanceArn],
    });
    rule.addTarget(options.target);
    return rule;
  }

  /**
   * The instance arn.
   *
   * TERRACONSTRUCTS DEVIATION: upstream resolves this via `Stack.formatArn` for the common case,
   * falling back to `getResourceArnAttribute` (a CFN two-phase Ref/attribute resolution helper —
   * the physical name may not be known until deploy time) for owned resources. TerraConstructs has
   * no equivalent two-phase resolution: `this.instanceIdentifier` is always the real, final value
   * (either a caller-supplied string or the underlying `aws_db_instance.identifier` attribute), so
   * a single `formatArn` call — which is exactly how CloudFormation derives this ARN too, since RDS
   * instance ARNs are deterministic from region/account/identifier — is sufficient for both owned
   * and imported instances.
   */
  public get instanceArn(): string {
    return this.stack.formatArn({
      service: "rds",
      resource: "db",
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      resourceName: this.instanceIdentifier,
    });
  }

  // TODO: omitted — see the TODO on `IDatabaseInstance` above (`dbInstanceRef`/`IDBInstanceRef`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L319-L327
  // /**
  //  * A reference to this database instance
  //  */
  // public get dbInstanceRef(): aws_rds.DBInstanceReference {
  //   return {
  //     dbInstanceIdentifier: this.instanceIdentifier,
  //     dbInstanceArn: this.instanceArn,
  //   };
  // }

  /**
   * Renders the secret attachment target specifications.
   *
   * TERRACONSTRUCTS DEVIATION: upstream returns only `{ targetId, targetType }` — CloudFormation's
   * `AWS::SecretsManager::SecretTargetAttachment` resolves the connection details (engine/host/port)
   * server-side from those two fields. The Terraform AWS provider has no such server-side merge (see
   * the AGREED DESIGN notes on `ISecretAttachmentTarget`/`SecretTargetAttachment` in
   * `../../encryption/secret.ts`), so this — the REAL, shipped `ISecretAttachmentTarget`
   * implementation for `DatabaseInstanceBase` (replacing the TEST-ONLY adapter in
   * `integ/aws/encryption/apps/secret-attach.ts`) — also supplies `connectionFields` that
   * `Secret.attach()` merges into the attached secret's JSON value. `dbname` is intentionally not
   * included here: it isn't known at this base-class level (only `DatabaseInstanceSource` and its
   * subclasses know the configured database name), and there is no abstract member for it on
   * `DatabaseInstanceBase`/`IDatabaseInstance` to read it from generically —
   * `DatabaseInstanceSource` overrides this method below to add `dbname` once it is known.
   */
  public asSecretAttachmentTarget(): secretsmanager.SecretAttachmentTargetProps {
    return {
      targetId: this.instanceIdentifier,
      targetType: secretsmanager.AttachmentTargetType.RDS_DB_INSTANCE,
      connectionFields: {
        // TERRACONSTRUCTS DEVIATION: mirrors CFN's `AWS::SecretsManager::SecretTargetAttachment`,
        // which injects `dbInstanceIdentifier` (in addition to `engine`/`host`/`port`/`dbname`) into
        // the attached secret's value for an RDS DB instance target — included here too so no
        // connection field CFN provides is silently dropped.
        dbInstanceIdentifier: this.instanceIdentifier,
        ...(this.engine?.engineType ? { engine: this.engine.engineType } : {}),
        host: this.instanceEndpoint.hostname,
        port: Tokenization.stringifyNumber(this.instanceEndpoint.port),
      },
    };
  }

  // TODO: omitted — `metricReadIOPS`/`metricWriteIOPS` (hand-written upstream) both call
  // `this.metric(...)`, and `metric()` itself is not hand-written anywhere in this codebase — for
  // every other service (see `QueueBase`/`sqs-augmentations.generated.ts`,
  // `VpnConnectionBase`/`ec2-augmentations.generated.ts`, ...) the generic `metric()` method AND all
  // named per-metric convenience methods (including the RDS equivalents of these two) are added via
  // a `declare module` prototype-augmentation file generated by struct-builder from
  // `rds-canned-metrics.generated.ts`. That `rds-augmentations.generated.ts` file lands in the NEXT
  // PR — do not hand-write `metric()`/`metricReadIOPS`/`metricWriteIOPS` here in the meantime —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L339-L356
  // /**
  //  * The average number of disk read I/O operations per second.
  //  *
  //  * @default - average over 5 minutes
  //  */
  // public metricReadIOPS(props?: cloudwatch.MetricOptions) {
  //   return this.metric('ReadIOPS', { statistic: 'Average', ...props });
  // }
  //
  // /**
  //  * The average number of disk write I/O operations per second.
  //  *
  //  * @default - average over 5 minutes
  //  */
  // public metricWriteIOPS(props?: cloudwatch.MetricOptions) {
  //   return this.metric('WriteIOPS', { statistic: 'Average', ...props });
  // }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `SubnetGroup`/`OptionGroup`/`ParameterGroup` in this module) — bare, bound-per-construct
   * `outputs` for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      identifier: this.instanceIdentifier,
      arn: this.instanceArn,
      endpointAddress: this.dbInstanceEndpointAddress,
      endpointPort: this.dbInstanceEndpointPort,
      ...(this.instanceResourceId && { resourceId: this.instanceResourceId }),
    };
  }
}

/**
 * The license model.
 */
export enum LicenseModel {
  /**
   * License included.
   */
  LICENSE_INCLUDED = "license-included",

  /**
   * Bring your own license.
   */
  BRING_YOUR_OWN_LICENSE = "bring-your-own-license",

  /**
   * General public license.
   */
  GENERAL_PUBLIC_LICENSE = "general-public-license",
}

// TODO: omitted — `ProcessorFeatures` (CPU core count / threads-per-core) has no corresponding
// argument on the Terraform `aws_db_instance` resource at all (not a CFN-vs-Terraform semantic
// difference — the provider simply doesn't expose it; verified against the full config shape in
// `node_modules/@cdktn/provider-aws/lib/db-instance/index.d.ts`). `DatabaseInstanceNewProps.processorFeatures`
// and the `renderProcessorFeatures()` helper below are dropped for the same reason —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L378-L395
// /**
//  * The processor features.
//  */
// export interface ProcessorFeatures {
//   /**
//    * The number of CPU core.
//    *
//    * @default - the default number of CPU cores for the chosen instance class.
//    */
//   readonly coreCount?: number;
//
//   /**
//    * The number of threads per core.
//    *
//    * @default - the default number of threads per core for the chosen instance class.
//    */
//   readonly threadsPerCore?: number;
// }

/**
 * The type of storage.
 *
 * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html
 */
export enum StorageType {
  /**
   * Standard.
   *
   * Amazon RDS supports magnetic storage for backward compatibility. It is recommended to use
   * General Purpose SSD or Provisioned IOPS SSD for any new storage needs.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html#CHAP_Storage.Magnetic
   */
  STANDARD = "standard",

  /**
   * General purpose SSD (gp2).
   *
   * Baseline performance determined by volume size
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html#Concepts.Storage.GeneralSSD
   */
  GP2 = "gp2",

  /**
   * General purpose SSD (gp3).
   *
   * Performance scales independently from storage
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html#Concepts.Storage.GeneralSSD
   */
  GP3 = "gp3",

  /**
   * Provisioned IOPS SSD (io1).
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html#USER_PIOPS
   */
  IO1 = "io1",

  /**
   * Provisioned IOPS SSD (io2).
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html#USER_PIOPS
   */
  IO2 = "io2",
}

/**
 * The network type of the DB instance.
 */
export enum NetworkType {
  /**
   * IPv4 only network type.
   */
  IPV4 = "IPV4",

  /**
   * Dual-stack network type.
   */
  DUAL = "DUAL",

  /**
   * IPv6 only network type.
   */
  IPV6 = "IPV6",
}

/**
 * Construction properties for a DatabaseInstanceNew
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn), which
 * upstream's `DatabaseInstanceNewProps` does not — matching the base-idiom used throughout this
 * repo (e.g. `SubnetGroupProps`, `ParameterGroupProps`, `OptionGroupProps`) for cross-account/-region
 * construct placement.
 */
export interface DatabaseInstanceNewProps extends AwsConstructProps {
  /**
   * Specifies if the database instance is a multiple Availability Zone deployment.
   *
   * @default false
   */
  readonly multiAz?: boolean;

  /**
   * The name of the Availability Zone where the DB instance will be located.
   *
   * @default - no preference
   */
  readonly availabilityZone?: string;

  /**
   * The storage type to associate with the DB instance.
   * Storage types supported are gp2, gp3, io1, io2, and standard.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html#Concepts.Storage.GeneralSSD
   *
   * @default StorageType.GP2
   */
  readonly storageType?: StorageType;

  /**
   * The storage throughput, specified in mebibytes per second (MiBps).
   *
   * Only applicable for GP3.
   *
   * @see https://docs.aws.amazon.com//AmazonRDS/latest/UserGuide/CHAP_Storage.html#gp3-storage
   *
   * @default - 125 MiBps if allocated storage is less than 400 GiB for MariaDB, MySQL, and PostgreSQL,
   * less than 200 GiB for Oracle and less than 20 GiB for SQL Server. 500 MiBps otherwise (except for
   * SQL Server where the default is always 125 MiBps).
   */
  readonly storageThroughput?: number;

  /**
   * The number of I/O operations per second (IOPS) that the database provisions.
   * The value must be equal to or greater than 1000.
   *
   * @default - no provisioned iops if storage type is not specified. For GP3: 3,000 IOPS if allocated
   * storage is less than 400 GiB for MariaDB, MySQL, and PostgreSQL, less than 200 GiB for Oracle and
   * less than 20 GiB for SQL Server. 12,000 IOPS otherwise (except for SQL Server where the default is
   * always 3,000 IOPS).
   */
  readonly iops?: number;

  // TODO: omitted — see the TODO on `ProcessorFeatures` above; the provider has no argument for it —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L518-L526
  // readonly processorFeatures?: ProcessorFeatures;

  /**
   * A name for the DB instance. If you specify a name, it is lowercased (RDS always lowercases DB
   * instance identifiers server-side).
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly instanceIdentifier?: string;

  /**
   * The VPC network where the DB subnet group should be created.
   */
  readonly vpc: ec2.IVpc;

  /**
   * The type of subnets to add to the created DB subnet group.
   *
   * @deprecated use `vpcSubnets`
   * @default - private subnets
   */
  readonly vpcPlacement?: ec2.SubnetSelection;

  /**
   * The type of subnets to add to the created DB subnet group.
   *
   * @default - private subnets
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * The security groups to assign to the DB instance.
   *
   * @default - a new security group is created
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * The port for the instance.
   *
   * @default - the default port for the chosen engine.
   */
  readonly port?: number;

  /**
   * The DB parameter group to associate with the instance.
   *
   * @default - no parameter group
   */
  readonly parameterGroup?: IParameterGroup;

  /**
   * The option group to associate with the instance.
   *
   * @default - no option group
   */
  readonly optionGroup?: IOptionGroup;

  /**
   * Whether to enable mapping of AWS Identity and Access Management (IAM) accounts
   * to database accounts.
   *
   * @default false
   */
  readonly iamAuthentication?: boolean;

  /**
   * The number of days during which automatic DB snapshots are retained.
   * Set to zero to disable backups.
   * When creating a read replica, you must enable automatic backups on the source
   * database instance by setting the backup retention to a value other than zero.
   *
   * @default - Duration.days(1) for source instances, disabled for read replicas
   */
  readonly backupRetention?: Duration;

  /**
   * The daily time range during which automated backups are performed.
   *
   * Constraints:
   * - Must be in the format `hh24:mi-hh24:mi`.
   * - Must be in Universal Coordinated Time (UTC).
   * - Must not conflict with the preferred maintenance window.
   * - Must be at least 30 minutes.
   *
   * @default - a 30-minute window selected at random from an 8-hour block of
   * time for each AWS Region. To see the time blocks available, see
   * https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html#USER_WorkingWithAutomatedBackups.BackupWindow
   */
  readonly preferredBackupWindow?: string;

  /**
   * Indicates whether to copy all of the user-defined tags from the
   * DB instance to snapshots of the DB instance.
   *
   * @default true
   */
  readonly copyTagsToSnapshot?: boolean;

  /**
   * Indicates whether automated backups should be deleted or retained when
   * you delete a DB instance.
   *
   * @default true
   */
  readonly deleteAutomatedBackups?: boolean;

  /**
   * The interval, in seconds, between points when Amazon RDS collects enhanced
   * monitoring metrics for the DB instance.
   *
   * @default - no enhanced monitoring
   */
  readonly monitoringInterval?: Duration;

  /**
   * Role that will be used to manage DB instance monitoring.
   *
   * TERRACONSTRUCTS DEVIATION: upstream types this as `iam.IRoleRef` (the newer, minimal
   * ARN-bearing supertype of `IRole`). `IRoleRef` is not ported here (same deviation as
   * `InstanceEngineBindOptions.s3ImportRole` in `./instance-engine.ts`), so `iam.IRole` is used
   * instead.
   *
   * @default - A role is automatically created for you
   */
  readonly monitoringRole?: iam.IRole;

  /**
   * Whether to enable Performance Insights for the DB instance.
   *
   * @default - false, unless ``performanceInsightRetention`` or ``performanceInsightEncryptionKey`` is set.
   */
  readonly enablePerformanceInsights?: boolean;

  /**
   * The amount of time, in days, to retain Performance Insights data.
   *
   * If you set `databaseInsightsMode` to `DatabaseInsightsMode.ADVANCED`, you must set this property to `PerformanceInsightRetention.MONTHS_15`.
   *
   * @default 7 this is the free tier
   */
  readonly performanceInsightRetention?: PerformanceInsightRetention;

  /**
   * The AWS KMS key for encryption of Performance Insights data.
   *
   * TERRACONSTRUCTS DEVIATION: upstream types this as `kms.IKeyRef`. `IKeyRef` is not ported here;
   * `encryption.IKey` is used instead (matches the base-idiom in `./props.ts`).
   *
   * @default - default master key
   */
  readonly performanceInsightEncryptionKey?: encryption.IKey;

  /**
   * The database insights mode.
   *
   * @default - DatabaseInsightsMode.STANDARD when performance insights are enabled, otherwise not set.
   */
  readonly databaseInsightsMode?: DatabaseInsightsMode;

  /**
   * The list of log types that need to be enabled for exporting to
   * CloudWatch Logs.
   *
   * @default - no log exports
   */
  readonly cloudwatchLogsExports?: string[];

  // TODO: omitted — `cloudwatchLogsRetention`/`cloudwatchLogsRetentionRole` (and the
  // `setLogRetention()`/`cloudwatchLogGroups` machinery below that consumes them) implement log
  // retention via upstream's `logs.LogRetention`, a Lambda-backed CloudFormation custom resource
  // that calls `PutRetentionPolicy`/`DeleteRetentionPolicy` on each exported log group. There is no
  // Terraform-native equivalent (the `aws_db_instance` resource only controls WHICH logs are
  // exported via `enabled_cloudwatch_logs_exports`, ported below as `cloudwatchLogsExports`; log
  // group retention is a separate `aws_cloudwatch_log_group` concern the CDKTF caller must manage
  // themselves, e.g. via `cloudwatch.LogGroup`). Same rule applied to the Neptune port plan —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L686-L701
  // readonly cloudwatchLogsRetention?: logs.RetentionDays;
  // readonly cloudwatchLogsRetentionRole?: iam.IRole;

  /**
   * Indicates that minor engine upgrades are applied automatically to the
   * DB instance during the maintenance window.
   *
   * @default true
   */
  readonly autoMinorVersionUpgrade?: boolean;

  /**
   * The weekly time range (in UTC) during which system maintenance can occur.
   *
   * Format: `ddd:hh24:mi-ddd:hh24:mi`
   * Constraint: Minimum 30-minute window
   *
   * @default - a 30-minute window selected at random from an 8-hour block of
   * time for each AWS Region, occurring on a random day of the week. To see
   * the time blocks available, see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Maintenance.html#Concepts.DBMaintenance
   */
  readonly preferredMaintenanceWindow?: string;

  /**
   * Indicates whether the DB instance should have deletion protection enabled.
   *
   * TERRACONSTRUCTS DEVIATION: upstream defaults this to `true` when `removalPolicy` is `RETAIN`.
   * `core.RemovalPolicy` is not ported in this repo (see `skipFinalSnapshot`/`finalSnapshotIdentifier`
   * below, and the identical omission throughout this module, e.g. `SubnetGroupProps`), so only the
   * explicit flag is honored (see `defaultDeletionProtection` in `./private/util.ts`).
   *
   * @default false
   */
  readonly deletionProtection?: boolean;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.SNAPSHOT`)
  // is CloudFormation's DeletionPolicy concept: `RETAIN` orphans the resource, `SNAPSHOT` takes a
  // CFN-auto-named final snapshot before deleting, `DESTROY` skips the snapshot entirely. `core.RemovalPolicy`
  // is not ported anywhere in this repo (see `SubnetGroupProps`/`SecretProps`/`QueueProps` for the
  // same omission). Terraform's `aws_db_instance` exposes the equivalent semantics natively via two
  // separate arguments instead of one enum — `skipFinalSnapshot`/`finalSnapshotIdentifier` below are
  // the TERRACONSTRUCTS-native replacement (deletion protection itself was already a native,
  // independent argument both upstream and here — see `deletionProtection` above) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L723-L736
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — native Terraform replacement for upstream's
   * `removalPolicy` (see the TODO above). Whether Terraform should take a final DB snapshot before
   * destroying this instance. When `false` (the default — matching upstream's `RemovalPolicy.SNAPSHOT`
   * default) and `finalSnapshotIdentifier` is not set, `terraform destroy`/replace will FAIL at
   * apply-time with an AWS API error (this is native `aws_db_instance` behavior, not enforced here at
   * synth time, since whether the instance will ever be destroyed isn't known at synth time).
   *
   * @default false (a final snapshot is taken on delete/replace, so `finalSnapshotIdentifier` should
   * also be set)
   */
  readonly skipFinalSnapshot?: boolean;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — see `skipFinalSnapshot` above. The identifier
   * for the final DB snapshot Terraform takes before destroying this instance. Unlike CloudFormation
   * (which auto-generates a snapshot name), Terraform requires this to be supplied explicitly; there
   * is no synth-time-safe way to auto-generate a unique one here.
   *
   * @default - no final snapshot identifier; required unless `skipFinalSnapshot` is `true`
   */
  readonly finalSnapshotIdentifier?: string;

  /**
   * Upper limit to which RDS can scale the storage in GiB(Gibibyte).
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIOPS.StorageTypes.html#USER_PIOPS.Autoscaling
   * @default - No autoscaling of RDS instance
   */
  readonly maxAllocatedStorage?: number;

  /**
   * The Active Directory directory ID to create the DB instance in.
   *
   * @default - Do not join domain
   */
  readonly domain?: string;

  /**
   * The IAM role to be used when making API calls to the Directory Service. The role needs the AWS-managed policy
   * AmazonRDSDirectoryServiceAccess or equivalent.
   *
   * TERRACONSTRUCTS DEVIATION: `iam.IRole` instead of upstream's `iam.IRoleRef` — see `monitoringRole` above.
   *
   * @default - The role will be created for you if `DatabaseInstanceNewProps#domain` is specified
   */
  readonly domainRole?: iam.IRole;

  /**
   * Existing subnet group for the instance.
   *
   * TERRACONSTRUCTS DEVIATION: `ISubnetGroup` instead of upstream's `aws_rds.IDBSubnetGroupRef` —
   * see the identical omission on `ISubnetGroup` in `./subnet-group.ts`.
   *
   * @default - a new subnet group will be created.
   */
  readonly subnetGroup?: ISubnetGroup;

  /**
   * Role that will be associated with this DB instance to enable S3 import.
   * This feature is only supported by the Microsoft SQL Server, Oracle, and PostgreSQL engines.
   *
   * This property must not be used if `s3ImportBuckets` is used.
   *
   * For Microsoft SQL Server:
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/SQLServer.Procedural.Importing.html
   * For Oracle:
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/oracle-s3-integration.html
   * For PostgreSQL:
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Procedural.Importing.html
   *
   * @default - New role is created if `s3ImportBuckets` is set, no role is defined otherwise
   */
  readonly s3ImportRole?: iam.IRole;

  /**
   * S3 buckets that you want to load data from.
   * This feature is only supported by the Microsoft SQL Server, Oracle, and PostgreSQL engines.
   *
   * This property must not be used if `s3ImportRole` is used.
   *
   * @default - None
   */
  readonly s3ImportBuckets?: IBucket[];

  /**
   * Role that will be associated with this DB instance to enable S3 export.
   *
   * This property must not be used if `s3ExportBuckets` is used.
   *
   * @default - New role is created if `s3ExportBuckets` is set, no role is defined otherwise
   */
  readonly s3ExportRole?: iam.IRole;

  /**
   * S3 buckets that you want to load data into.
   *
   * This property must not be used if `s3ExportRole` is used.
   *
   * @default - None
   */
  readonly s3ExportBuckets?: IBucket[];

  /**
   * Indicates whether the DB instance is an internet-facing instance. If not specified,
   * the instance's vpcSubnets will be used to determine if the instance is internet-facing
   * or not.
   *
   * @default - `true` if the instance's `vpcSubnets` is `subnetType: SubnetType.PUBLIC`, `false` otherwise
   */
  readonly publiclyAccessible?: boolean;

  /**
   * The network type of the DB instance.
   *
   * @default - IPV4
   */
  readonly networkType?: NetworkType;

  /**
   * The identifier of the CA certificate for this DB instance.
   *
   * Specifying or updating this property triggers a reboot.
   *
   * @default - RDS will choose a certificate authority
   */
  readonly caCertificate?: CaCertificate;

  /**
   * Specifies whether changes to the DB instance and any pending modifications are applied immediately, regardless of the `preferredMaintenanceWindow` setting.
   * If set to `false`, changes are applied during the next maintenance window.
   *
   * TERRACONSTRUCTS DEVIATION: upstream's `@default` is "Changes will be applied immediately" because
   * CloudFormation's `AWS::RDS::DBInstance` `ApplyImmediately` defaults to `true`. The Terraform
   * `aws_db_instance` resource's `apply_immediately` argument defaults to `false` instead (see
   * `node_modules/@cdktn/provider-aws/lib/db-instance/index.d.ts`), so leaving this prop unset — as
   * this port does — renders no `apply_immediately` argument and changes are applied during the next
   * maintenance window, not immediately.
   *
   * @default false - changes are applied during the next maintenance window (the `aws_db_instance`
   * provider default)
   */
  readonly applyImmediately?: boolean;

  /**
   * The life cycle type for this DB instance.
   * This setting applies only to RDS for MySQL and RDS for PostgreSQL.
   *
   * @see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/extended-support.html
   *
   * @default undefined - AWS RDS default setting is `EngineLifecycleSupport.OPEN_SOURCE_RDS_EXTENDED_SUPPORT`
   */
  readonly engineLifecycleSupport?: EngineLifecycleSupport;
}

/**
 * A role associated with a DB instance, to be materialized as an
 * `aws_db_instance_role_association` resource.
 *
 * TERRACONSTRUCTS DEVIATION: not present upstream (see `createInstanceRoleAssociations` below) --
 * a named interface (rather than an inline object type) is required here because jsii only
 * supports string-indexed map types for inline object-literal types
 * (`JSII1003: Only string-indexed map types are supported`).
 */
export interface InstanceAssociatedRole {
  /** The ARN of the role to associate with the DB instance. */
  readonly roleArn: string;

  /** The name of the feature for the DB instance that the role is to be associated with. */
  readonly featureName: string;
}

/**
 * A new database instance.
 */
abstract class DatabaseInstanceNew
  extends DatabaseInstanceBase
  implements IDatabaseInstance
{
  /**
   * The VPC where this database instance is deployed.
   */
  public readonly vpc: ec2.IVpc;

  public readonly connections: ec2.Connections;

  protected abstract readonly instanceType: ec2.InstanceType;

  protected readonly vpcPlacement?: ec2.SubnetSelection;
  /**
   * TERRACONSTRUCTS DEVIATION: typed loosely (`Record<string, any>`, mirroring upstream's
   * `CfnDBInstanceProps` grab-bag) rather than `Partial<dbInstance.DbInstanceConfig>` — the L1
   * config's `instanceClass` argument is required (non-optional), which a `Partial<>` intermediate
   * would fight with across the multi-step construction upstream uses (`newCfnProps` ->
   * `sourceCfnProps` -> final `CfnDBInstanceProps` spread, mirrored here as `newInstanceProps` ->
   * `sourceInstanceProps` -> final `DbInstanceConfig` spread in each leaf class).
   */
  protected readonly newInstanceProps: Record<string, any>;

  private readonly cloudwatchLogsExports?: string[];

  private readonly domainId?: string;
  private readonly domainRole?: iam.IRole;

  protected enableIamAuthentication?: boolean;

  constructor(scope: Construct, id: string, props: DatabaseInstanceNewProps) {
    super(scope, id, props);

    this.vpc = props.vpc;
    if (props.vpcSubnets && props.vpcPlacement) {
      throw new ValidationError(
        "Only one of `vpcSubnets` or `vpcPlacement` can be specified",
        this,
      );
    }
    this.vpcPlacement = props.vpcSubnets ?? props.vpcPlacement;

    if (props.multiAz === true && props.availabilityZone) {
      throw new ValidationError(
        "Requesting a specific availability zone is not valid for Multi-AZ instances",
        this,
      );
    }

    const subnetGroup =
      props.subnetGroup ??
      new SubnetGroup(this, "SubnetGroup", {
        description: `Subnet group for ${this.node.id} database`,
        vpc: this.vpc,
        vpcSubnets: this.vpcPlacement,
        // TERRACONSTRUCTS DEVIATION: no `removalPolicy` to pass — see the omission note on
        // `SubnetGroupProps.removalPolicy` in `./subnet-group.ts`.
      });

    const securityGroups = props.securityGroups || [
      new ec2.SecurityGroup(this, "SecurityGroup", {
        description: `Security group for ${this.node.id} database`,
        vpc: props.vpc,
      }),
    ];

    this.connections = new ec2.Connections({
      securityGroups,
      defaultPort: ec2.Port.tcp(
        Lazy.numberValue({ produce: () => this.instanceEndpoint.port }),
      ),
    });

    let monitoringRole: iam.IRole | undefined;
    if (props.monitoringInterval && props.monitoringInterval.toSeconds()) {
      monitoringRole =
        props.monitoringRole ||
        new iam.Role(this, "MonitoringRole", {
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

    const storageType = props.storageType ?? StorageType.GP2;
    const iops = defaultIops(storageType, props.iops);
    if (props.storageThroughput && storageType !== StorageType.GP3) {
      throw new ValidationError(
        `The storage throughput can only be specified with GP3 storage type. Got ${storageType}.`,
        this,
      );
    }
    if (
      storageType === StorageType.GP3 &&
      props.storageThroughput &&
      iops &&
      !Token.isUnresolved(props.storageThroughput) &&
      !Token.isUnresolved(iops) &&
      props.storageThroughput / iops > 0.25
    ) {
      throw new ValidationError(
        `The maximum ratio of storage throughput to IOPS is 0.25. Got ${props.storageThroughput / iops}.`,
        this,
      );
    }

    this.cloudwatchLogsExports = props.cloudwatchLogsExports;
    this.enableIamAuthentication = props.iamAuthentication;

    const enablePerformanceInsights =
      props.enablePerformanceInsights ??
      (props.performanceInsightRetention !== undefined ||
        props.performanceInsightEncryptionKey !== undefined ||
        props.databaseInsightsMode === DatabaseInsightsMode.ADVANCED ||
        undefined);

    if (props.domain) {
      this.domainId = props.domain;
      this.domainRole =
        props.domainRole ||
        new iam.Role(this, "RDSDirectoryServiceRole", {
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

    // TERRACONSTRUCTS DEVIATION: repo invariant -- unnamed resources get a gridUUID-scoped
    // `uniqueResourceName` default (lowercased; RDS always lowercases DB instance identifiers
    // server-side) instead of relying on CloudFormation's Ref-based logical-id naming (which this
    // repo has no equivalent of — see `SubnetGroup`/`OptionGroup`/`ParameterGroup` for the same
    // idiom) or the provider's own generated `terraform-<hash>` fallback. Also drops the
    // `RDS_LOWERCASE_DB_IDENTIFIER` feature-flag branch upstream guards this with: that flag exists
    // purely to preserve pre-existing (non-lowercased) CloudFormation template output for already
    // deployed stacks; there is no legacy template to stay compatible with here, so the corrected
    // (always-lowercase) behavior is simply the only behavior. Unlike the sibling `SubnetGroup` /
    // `OptionGroup` / `ParameterGroup` (255-char AWS limits, close enough to the 256-char
    // `uniqueResourceName` fallback to leave unbounded), `DBInstanceIdentifier` is capped at 63
    // characters, so `maxLength` is passed explicitly here.
    const instanceIdentifier = Token.isUnresolved(props.instanceIdentifier)
      ? props.instanceIdentifier
      : (
          props.instanceIdentifier ??
          this.stack.uniqueResourceName(this, { maxLength: 63 })
        ).toLowerCase();

    const instanceParameterGroupConfig = props.parameterGroup?.bindToInstance(
      {},
    );
    const isInPublicSubnet =
      this.vpcPlacement &&
      this.vpcPlacement.subnetType === ec2.SubnetType.PUBLIC;
    this.newInstanceProps = {
      autoMinorVersionUpgrade: props.autoMinorVersionUpgrade,
      availabilityZone: props.multiAz ? undefined : props.availabilityZone,
      backupRetentionPeriod: props.backupRetention?.toDays(),
      copyTagsToSnapshot: props.copyTagsToSnapshot ?? true,
      instanceClass: Lazy.stringValue({
        produce: () => `db.${this.instanceType}`,
      }),
      identifier: instanceIdentifier,
      dbSubnetGroupName: subnetGroup.subnetGroupName,
      deleteAutomatedBackups: props.deleteAutomatedBackups,
      deletionProtection: defaultDeletionProtection(props.deletionProtection),
      enabledCloudwatchLogsExports: this.cloudwatchLogsExports,
      iamDatabaseAuthenticationEnabled: Lazy.anyValue({
        produce: () => this.enableIamAuthentication,
      }),
      performanceInsightsEnabled: enablePerformanceInsights,
      iops,
      monitoringInterval: props.monitoringInterval?.toSeconds(),
      monitoringRoleArn: monitoringRole?.roleArn,
      multiAz: props.multiAz,
      parameterGroupName: instanceParameterGroupConfig?.parameterGroupName,
      optionGroupName: props.optionGroup?.optionGroupName,
      performanceInsightsKmsKeyId:
        props.performanceInsightEncryptionKey?.keyArn,
      performanceInsightsRetentionPeriod: enablePerformanceInsights
        ? props.performanceInsightRetention ||
          PerformanceInsightRetention.DEFAULT
        : undefined,
      databaseInsightsMode: props.databaseInsightsMode,
      port: props.port,
      backupWindow: props.preferredBackupWindow,
      maintenanceWindow: props.preferredMaintenanceWindow,
      publiclyAccessible: props.publiclyAccessible ?? isInPublicSubnet,
      storageType,
      storageThroughput: props.storageThroughput,
      vpcSecurityGroupIds: securityGroups.map((s) => s.securityGroupId),
      maxAllocatedStorage: props.maxAllocatedStorage,
      domain: this.domainId,
      domainIamRoleName: this.domainRole?.roleName,
      networkType: props.networkType,
      caCertIdentifier: props.caCertificate
        ? props.caCertificate.toString()
        : undefined,
      applyImmediately: props.applyImmediately,
      engineLifecycleSupport: props.engineLifecycleSupport,
      skipFinalSnapshot: props.skipFinalSnapshot,
      finalSnapshotIdentifier: props.finalSnapshotIdentifier,
    };

    // TERRACONSTRUCTS DEVIATION: upstream's `RemovalPolicy.SNAPSHOT` (the effective default) never
    // fails at delete/replace time because CloudFormation auto-generates the final snapshot name.
    // Here, with neither `skipFinalSnapshot: true` nor an explicit `finalSnapshotIdentifier`, the
    // provider's own default (`skip_final_snapshot: false` with no `final_snapshot_identifier`)
    // causes `terraform destroy`/replace to fail at apply time with an AWS API error. That can't be
    // caught at synth time (whether the instance will ever be destroyed isn't known here), so surface
    // it as a synth-time warning instead — see `skipFinalSnapshot`/`finalSnapshotIdentifier` above.
    if (props.skipFinalSnapshot !== true && !props.finalSnapshotIdentifier) {
      Annotations.of(this).addWarning(
        "Neither `skipFinalSnapshot` nor `finalSnapshotIdentifier` is set: `terraform destroy` (or any change that replaces this instance) will FAIL at apply time because the AWS provider requires `finalSnapshotIdentifier` when `skipFinalSnapshot` is not `true`. Set `skipFinalSnapshot: true` to skip the final snapshot, or set `finalSnapshotIdentifier` to a snapshot name.",
      );
    }
  }

  // TODO: omitted — `setLogRetention()`/`cloudwatchLogGroups` implement upstream's Lambda-backed
  // `logs.LogRetention` custom resource per exported log; see the TODO on
  // `DatabaseInstanceNewProps.cloudwatchLogsRetention` above for why this isn't portable —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L1053-L1065
  // public readonly cloudwatchLogGroups: {[engine: string]: logs.ILogGroup};
  // protected setLogRetention() {
  //   if (this.cloudwatchLogsExports && this.cloudwatchLogsRetention) {
  //     for (const log of this.cloudwatchLogsExports) {
  //       const logGroupName = `/aws/rds/instance/${this.instanceIdentifier}/${log}`;
  //       new logs.LogRetention(this, `LogRetention${log}`, {
  //         logGroupName,
  //         retention: this.cloudwatchLogsRetention,
  //         role: this.cloudwatchLogsRetentionRole,
  //       });
  //       this.cloudwatchLogGroups[log] = logs.LogGroup.fromLogGroupName(this, `LogGroup${this.instanceIdentifier}${log}`, logGroupName);
  //     }
  //   }
  // }

  /**
   * Creates `aws_db_instance_role_association` resources for the given roles.
   *
   * TERRACONSTRUCTS DEVIATION: not present upstream. Upstream's `AssociatedRoles` is an inline
   * array property on `AWS::RDS::DBInstance` itself (`CfnDBInstance.DBInstanceRoleProperty[]`); the
   * Terraform `aws_db_instance` resource has no equivalent inline argument — role/feature-name
   * associations are a SEPARATE `aws_db_instance_role_association` resource per role instead (see
   * `node_modules/@cdktn/provider-aws/lib/db-instance-role-association/index.d.ts`). Called by
   * `DatabaseInstanceSource` subclasses after the `aws_db_instance` resource exists.
   */
  protected createInstanceRoleAssociations(
    instanceIdentifier: string,
    roles: InstanceAssociatedRole[],
  ): void {
    roles.forEach((role, index) => {
      new dbInstanceRoleAssociation.DbInstanceRoleAssociation(
        this,
        `RoleAssociation${index}`,
        {
          dbInstanceIdentifier: instanceIdentifier,
          featureName: role.featureName,
          roleArn: role.roleArn,
        },
      );
    });
  }
}

/**
 * Construction properties for a DatabaseInstanceSource
 */
export interface DatabaseInstanceSourceProps extends DatabaseInstanceNewProps {
  /**
   * The database engine.
   */
  readonly engine: IInstanceEngine;

  /**
   * The name of the compute and memory capacity for the instance.
   *
   * @default - m5.large (or, more specifically, db.m5.large)
   */
  readonly instanceType?: ec2.InstanceType;

  /**
   * The license model.
   *
   * @default - RDS default license model
   */
  readonly licenseModel?: LicenseModel;

  /**
   * Whether to allow major version upgrades.
   *
   * @default false
   */
  readonly allowMajorVersionUpgrade?: boolean;

  /**
   * The time zone of the instance. This is currently supported only by Microsoft Sql Server.
   *
   * @default - RDS default timezone
   */
  readonly timezone?: string;

  /**
   * The allocated storage size, specified in gibibytes (GiB).
   *
   * @default 100
   */
  readonly allocatedStorage?: number;

  /**
   * The name of the database.
   *
   * @default - no name
   */
  readonly databaseName?: string;

  /**
   * The parameters in the DBParameterGroup to create automatically
   *
   * You can only specify parameterGroup or parameters but not both.
   * You need to use a versioned engine to auto-generate a DBParameterGroup.
   *
   * @default - None
   */
  readonly parameters?: { [key: string]: string };
}

/**
 * A new source database instance (not a read replica)
 */
abstract class DatabaseInstanceSource
  extends DatabaseInstanceNew
  implements IDatabaseInstance
{
  public readonly engine?: IInstanceEngine;
  /**
   * The AWS Secrets Manager secret attached to the instance.
   */
  public abstract readonly secret?: secretsmanager.ISecret;

  protected readonly sourceInstanceProps: Record<string, any>;
  protected readonly instanceType: ec2.InstanceType;
  protected readonly instanceAssociatedRoles: InstanceAssociatedRole[];

  protected manageMasterUserPassword?: boolean;
  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Upstream's `grantConnect()` override (below)
   * defaults `dbUser` by reading it back out of the attached secret's JSON value via
   * `secret.secretValueFromJson('username').unsafeUnwrap()` — a CloudFormation dynamic reference,
   * not portable here (see the `ISecret` deviation note in `../../encryption/secret.ts`). The
   * master username is always known as a plain string at construction time in this port (see
   * `renderInstanceCredentials` below), so leaf classes stash it here instead and `grantConnect()`
   * reads it back directly.
   */
  protected masterUsername?: string;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Stashed so `asSecretAttachmentTarget()`
   * (overridden below) can contribute `dbname` to the attached secret's connection fields — see the
   * deviation note there.
   */
  protected readonly databaseName?: string;

  private readonly singleUserRotationApplication: secretsmanager.SecretRotationApplication;
  private readonly multiUserRotationApplication: secretsmanager.SecretRotationApplication;

  constructor(
    scope: Construct,
    id: string,
    props: DatabaseInstanceSourceProps,
  ) {
    super(scope, id, props);

    this.singleUserRotationApplication =
      props.engine.singleUserRotationApplication;
    this.multiUserRotationApplication =
      props.engine.multiUserRotationApplication;
    this.engine = props.engine;
    this.databaseName = props.databaseName;

    const engineType = props.engine.engineType;

    if (
      props.engineLifecycleSupport &&
      !["mysql", "postgres"].includes(engineType)
    ) {
      throw new ValidationError(
        `'engineLifecycleSupport' can only be specified for RDS for MySQL and RDS for PostgreSQL, got: '${engineType}'`,
        this,
      );
    }

    // only Oracle and SQL Server require the import and export Roles to be the same
    const combineRoles =
      engineType.startsWith("oracle-") || engineType.startsWith("sqlserver-");
    const { s3ImportRole, s3ExportRole } = setupS3ImportExport(
      this,
      props,
      combineRoles,
    );
    const engineConfig = props.engine.bindToInstance(this, {
      ...props,
      s3ImportRole,
      s3ExportRole,
    });

    const instanceAssociatedRoles: InstanceAssociatedRole[] = [];
    const engineFeatures = engineConfig.features;
    if (s3ImportRole) {
      if (!engineFeatures?.s3Import) {
        throw new ValidationError(
          `Engine '${engineDescription(props.engine)}' does not support S3 import`,
          this,
        );
      }
      instanceAssociatedRoles.push({
        roleArn: s3ImportRole.roleArn,
        featureName: engineFeatures.s3Import,
      });
    }
    if (s3ExportRole) {
      if (!engineFeatures?.s3Export) {
        throw new ValidationError(
          `Engine '${engineDescription(props.engine)}' does not support S3 export`,
          this,
        );
      }
      // only add the export feature if it's different from the import feature
      if (engineFeatures.s3Import !== engineFeatures?.s3Export) {
        instanceAssociatedRoles.push({
          roleArn: s3ExportRole.roleArn,
          featureName: engineFeatures.s3Export,
        });
      }
    }
    this.instanceAssociatedRoles = instanceAssociatedRoles;

    this.instanceType =
      props.instanceType ??
      ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.LARGE);

    if (props.parameterGroup && props.parameters) {
      throw new ValidationError(
        "You cannot specify both parameterGroup and parameters",
        this,
      );
    }

    const parameterGroupName = props.parameters
      ? new ParameterGroup(this, "ParameterGroup", {
          engine: props.engine,
          parameters: props.parameters,
        }).bindToInstance({}).parameterGroupName
      : this.newInstanceProps.parameterGroupName;

    this.sourceInstanceProps = {
      ...this.newInstanceProps,
      optionGroupName: engineConfig.optionGroup?.optionGroupName,
      allocatedStorage: props.allocatedStorage ?? 100,
      allowMajorVersionUpgrade: props.allowMajorVersionUpgrade,
      dbName: props.databaseName,
      engine: engineType,
      engineVersion: props.engine.engineVersion?.fullVersion,
      licenseModel: props.licenseModel,
      timezone: props.timezone,
      parameterGroupName,
    };
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Overrides `DatabaseInstanceBase`'s
   * `asSecretAttachmentTarget()` to also contribute `dbname` to the attached secret's connection
   * fields, now that a configured database name is available at this level (`this.databaseName`,
   * stashed above from `DatabaseInstanceSourceProps.databaseName`).
   */
  public asSecretAttachmentTarget(): secretsmanager.SecretAttachmentTargetProps {
    const target = super.asSecretAttachmentTarget();
    return {
      ...target,
      connectionFields: {
        ...target.connectionFields,
        ...(this.databaseName ? { dbname: this.databaseName } : {}),
      },
    };
  }

  /**
   * Adds the single user rotation of the master password to this instance.
   *
   * @param options the options for the rotation,
   *                if you want to override the defaults
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
        "Cannot add single user rotation for an instance without secret.",
        this,
      );
    }

    const id = "RotationSingleUser";
    const existing = this.node.tryFindChild(id);
    if (existing) {
      throw new ValidationError(
        "A single user rotation was already added to this instance.",
        this,
      );
    }

    return new secretsmanager.SecretRotation(this, id, {
      ...applyDefaultRotationOptions(options, this.vpcPlacement),
      secret: this.secret,
      application: this.singleUserRotationApplication,
      vpc: this.vpc,
      target: this,
    });
  }

  /**
   * Adds the multi user rotation to this instance.
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
        "Cannot add multi user rotation for an instance without secret.",
        this,
      );
    }

    return new secretsmanager.SecretRotation(this, id, {
      ...applyDefaultRotationOptions(options, this.vpcPlacement),
      secret: options.secret,
      masterSecret: this.secret,
      application: this.multiUserRotationApplication,
      vpc: this.vpc,
      target: this,
    });
  }

  /**
   * Grant the given identity connection access to the database.
   *
   * [disable-awslint:no-grants]
   *
   * @param grantee the Principal to grant the permissions to
   * @param dbUser the name of the database user to allow connecting as to the db instance,
   * or the default database user, obtained from the Secret, if not specified
   */
  public grantConnect(grantee: iam.IGrantable, dbUser?: string): iam.Grant {
    if (!dbUser) {
      // TERRACONSTRUCTS DEVIATION: see the deviation note on `masterUsername` above — reads the
      // plain-string username stashed at construction time instead of
      // `secret.secretValueFromJson('username').unsafeUnwrap()`.
      if (!this.secret && !this.masterUsername) {
        throw new ValidationError(
          "A secret or dbUser is required to grantConnect()",
          this,
        );
      }

      dbUser = this.masterUsername;
      if (!dbUser) {
        throw new ValidationError(
          "A secret or dbUser is required to grantConnect()",
          this,
        );
      }
    }

    return super.grantConnect(grantee, dbUser);
  }
}

/**
 * Construction properties for a DatabaseInstance.
 */
export interface DatabaseInstanceProps extends DatabaseInstanceSourceProps {
  /**
   * Credentials for the administrative user
   *
   * @default - A username of 'admin' (or 'postgres' for PostgreSQL) and SecretsManager-generated password
   */
  readonly credentials?: Credentials;

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

  /**
   * For supported engines, specifies the character set to associate with the
   * DB instance.
   *
   * @default - RDS default character set name
   */
  readonly characterSetName?: string;

  /**
   * Indicates whether the DB instance is encrypted.
   *
   * @default - true if storageEncryptionKey has been provided, false otherwise
   */
  readonly storageEncrypted?: boolean;

  /**
   * The KMS key that's used to encrypt the DB instance.
   *
   * TERRACONSTRUCTS DEVIATION: `encryption.IKey` instead of upstream's `kms.IKeyRef` — see
   * `DatabaseInstanceNewProps.performanceInsightEncryptionKey` above.
   *
   * @default - default master key if storageEncrypted is true, no key otherwise
   */
  readonly storageEncryptionKey?: encryption.IKey;
}

/**
 * A database instance
 *
 * @resource aws_db_instance
 */
export class DatabaseInstance
  extends DatabaseInstanceSource
  implements IDatabaseInstance
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.DatabaseInstance";

  public readonly instanceIdentifier: string;
  public readonly dbInstanceEndpointAddress: string;
  public readonly dbInstanceEndpointPort: string;
  public readonly instanceResourceId?: string;
  public readonly instanceEndpoint: Endpoint;
  public readonly secret?: secretsmanager.ISecret;

  /**
   * The underlying `aws_db_instance` L1. NOTE: this construct owns
   * `lifecycle.ignore_changes` on it (see the `ignore_changes`/password-drift note in the
   * constructor) -- code calling `resource.addOverride("lifecycle.ignore_changes", ...)` directly
   * will REPLACE that list rather than merge with it.
   */
  public readonly resource: dbInstance.DbInstance;

  constructor(scope: Construct, id: string, props: DatabaseInstanceProps) {
    super(scope, id, props);

    // Validate database instance props
    validateDatabaseInstanceProps(this, props);

    // Validate manageMasterUserPassword conflicts with unsupported credential properties
    if (props.manageMasterUserPassword) {
      validateManagedPasswordCredentials(this, props.credentials);
    }

    this.manageMasterUserPassword = props.manageMasterUserPassword;

    // Prepare credential-specific configuration
    let secret: secretsmanager.ISecret | undefined;
    let masterUsername: string | undefined;
    let masterUserPassword: string | undefined;
    let manageMasterUserPassword: boolean | undefined;
    let masterUserSecretKmsKeyId: string | undefined;

    if (props.manageMasterUserPassword) {
      // RDS-managed approach: RDS creates and manages the Secret automatically
      masterUsername =
        props.credentials?.username ?? props.engine.defaultUsername ?? "admin";
      manageMasterUserPassword = props.manageMasterUserPassword;
      masterUserSecretKmsKeyId = props.credentials?.encryptionKey?.keyArn;
    } else {
      // Standard approach: CDK creates and manages the Secret via DatabaseSecret
      const rendered = renderInstanceCredentials(
        this,
        props.engine,
        props.credentials,
      );
      secret = rendered.secret;
      masterUsername = rendered.username;
      masterUserPassword = rendered.password;
    }
    this.masterUsername = masterUsername;

    const instance = new dbInstance.DbInstance(this, "Resource", {
      ...this.sourceInstanceProps,
      characterSetName: props.characterSetName,
      kmsKeyId: props.storageEncryptionKey?.keyArn,
      username: masterUsername,
      password: masterUserPassword,
      manageMasterUserPassword,
      masterUserSecretKmsKeyId,
      storageEncrypted: props.storageEncryptionKey
        ? true
        : props.storageEncrypted,
    } as dbInstance.DbInstanceConfig);

    this.resource = instance;
    this.instanceIdentifier = instance.identifier;
    this.dbInstanceEndpointAddress = instance.address;
    this.dbInstanceEndpointPort = Tokenization.stringifyNumber(instance.port);
    this.instanceResourceId = instance.resourceId;
    // NOTE: must be set before `secret.attach(this)` below -- `attach()` calls
    // `asSecretAttachmentTarget()` synchronously, which reads `this.instanceEndpoint`.
    this.instanceEndpoint = new Endpoint(instance.address, instance.port);

    // TERRACONSTRUCTS DEVIATION: `secret` is only set here when a
    // `DatabaseSecret` was just generated for us (see `renderInstanceCredentials`),
    // in which case `masterUserPassword` above is the SAME
    // `aws_secretsmanager_random_password` data-source token stored in that
    // secret (`Secret._generatedPassword`). That data source regenerates a new
    // value on every plan/refresh; without `ignore_changes` every apply after
    // the first would drift `aws_db_instance.password` and REPLACE the live
    // master password, permanently diverging it from the value frozen in the
    // secret (mirrors `Secret.toTerraform()`'s `ignore_changes: ["secret_string"]`
    // in `../../encryption/secret.ts`). Caller-supplied literal passwords
    // (`credentials.password`) are NOT affected -- `secret` is undefined for
    // those, so normal diffing/replacement semantics apply.
    //
    // Accumulated into a single array + single `addOverride()` call (mirroring
    // `Secret.toTerraform()`'s `ignoreChanges` accumulation) rather than one `addOverride()` per
    // entry -- `addOverride("lifecycle.ignore_changes", ...)` REPLACES the whole list, so multiple
    // calls would clobber each other instead of merging. See `resource`'s doc comment.
    const ignoreChanges: string[] = [];
    if (secret) {
      ignoreChanges.push("password");
    }
    if (ignoreChanges.length > 0) {
      instance.addOverride("lifecycle.ignore_changes", ignoreChanges);
    }

    // Set up the secret reference
    if (props.manageMasterUserPassword) {
      this.secret = secretsmanager.Secret.fromSecretAttributes(
        this,
        "ManagedSecret",
        {
          secretCompleteArn: instance.masterUserSecret.get(0).secretArn,
          encryptionKey: props.credentials?.encryptionKey,
        },
      );
    } else if (secret) {
      this.secret = secret.attach(this);
    }

    this.createInstanceRoleAssociations(
      instance.identifier,
      this.instanceAssociatedRoles,
    );
  }

  public get outputs(): Record<string, any> {
    return {
      ...super.outputs,
      ...(this.secret && { secretArn: this.secret.secretArn }),
    };
  }
}

/**
 * Construction properties for a DatabaseInstanceFromSnapshot.
 */
export interface DatabaseInstanceFromSnapshotProps
  extends DatabaseInstanceSourceProps {
  /**
   * The name or Amazon Resource Name (ARN) of the DB snapshot that's used to
   * restore the DB instance. If you're restoring from a shared manual DB
   * snapshot, you must specify the ARN of the snapshot.
   *
   * @default - None
   */
  readonly snapshotIdentifier?: string;

  // TODO: omitted — the Terraform `aws_db_instance` resource has no argument for restoring from a
  // Multi-AZ DB CLUSTER snapshot (only `snapshotIdentifier`, ported below, for a single-instance
  // snapshot — verified against the full config shape in
  // `node_modules/@cdktn/provider-aws/lib/db-instance/index.d.ts`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L1458-L1473
  // readonly clusterSnapshotIdentifier?: string;

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
 * A database instance restored from a snapshot.
 *
 * @resource aws_db_instance
 */
export class DatabaseInstanceFromSnapshot
  extends DatabaseInstanceSource
  implements IDatabaseInstance
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.DatabaseInstanceFromSnapshot";

  public readonly instanceIdentifier: string;
  public readonly dbInstanceEndpointAddress: string;
  public readonly dbInstanceEndpointPort: string;
  public readonly instanceResourceId?: string;
  public readonly instanceEndpoint: Endpoint;
  public readonly secret?: secretsmanager.ISecret;

  /**
   * The underlying `aws_db_instance` L1. NOTE: this construct owns
   * `lifecycle.ignore_changes` on it (see the `ignore_changes`/password-drift note in the
   * constructor) -- code calling `resource.addOverride("lifecycle.ignore_changes", ...)` directly
   * will REPLACE that list rather than merge with it.
   */
  public readonly resource: dbInstance.DbInstance;

  constructor(
    scope: Construct,
    id: string,
    props: DatabaseInstanceFromSnapshotProps,
  ) {
    super(scope, id, props);

    // TERRACONSTRUCTS DEVIATION: upstream also accepts `clusterSnapshotIdentifier` as an
    // alternative to `snapshotIdentifier` — dropped, see the TODO on
    // `DatabaseInstanceFromSnapshotProps.clusterSnapshotIdentifier` above.
    if (!props.snapshotIdentifier) {
      throw new ValidationError("You must specify `snapshotIdentifier`", this);
    }

    const credentials = props.credentials;
    if (credentials?.secret) {
      // TERRACONSTRUCTS DEVIATION: see `renderInstanceCredentials` below — an existing, caller-supplied
      // secret's password cannot be read back out portably (`secretValueFromJson` not ported).
      throw new ValidationError(
        "SnapshotCredentials with an existing `secret` are not supported in TerraConstructs (depends on ISecret.secretValueFromJson, not ported). Use SnapshotCredentials.fromPassword(), SnapshotCredentials.fromGeneratedSecret()/fromGeneratedPassword(), or leave `credentials` unset to keep the snapshot's existing password.",
        this,
      );
    }

    let secret: DatabaseSecret | undefined;
    let generatedPassword: string | undefined;
    if (credentials?.generatePassword) {
      if (!credentials.username) {
        throw new ValidationError(
          "`credentials` `username` must be specified when `generatePassword` is set to true",
          this,
        );
      }

      secret = new DatabaseSecret(this, "Secret", {
        username: credentials.username,
        encryptionKey: credentials.encryptionKey,
        excludeCharacters: credentials.excludeCharacters,
        replaceOnPasswordCriteriaChanges:
          credentials.replaceOnPasswordCriteriaChanges,
        replicaRegions: credentials.replicaRegions,
      });
      generatedPassword = secret._generatedPassword;
    }
    this.masterUsername = credentials?.username;

    const instance = new dbInstance.DbInstance(this, "Resource", {
      ...this.sourceInstanceProps,
      snapshotIdentifier: props.snapshotIdentifier,
      password: generatedPassword ?? credentials?.password,
    } as dbInstance.DbInstanceConfig);

    this.resource = instance;
    this.instanceIdentifier = instance.identifier;
    this.dbInstanceEndpointAddress = instance.address;
    this.dbInstanceEndpointPort = Tokenization.stringifyNumber(instance.port);
    this.instanceResourceId = instance.resourceId;

    this.instanceEndpoint = new Endpoint(instance.address, instance.port);

    // TERRACONSTRUCTS DEVIATION: see the identical `ignore_changes` note in
    // `DatabaseInstance` above -- `secret` is only set here when a new
    // `DatabaseSecret` was just generated (`credentials.generatePassword`), in
    // which case `password` above is the SAME regenerating-on-every-plan
    // `aws_secretsmanager_random_password` token stored in that secret.
    // Without `ignore_changes`, every apply after the first would drift and
    // REPLACE the live master password. A caller-supplied literal
    // `credentials.password` (no `secret` created) keeps normal diffing.
    //
    // Accumulated into a single array + single `addOverride()` call -- see the identical note in
    // `DatabaseInstance` above and `resource`'s doc comment.
    const ignoreChanges: string[] = [];
    if (secret) {
      ignoreChanges.push("password");
      this.secret = secret.attach(this);
    }
    if (ignoreChanges.length > 0) {
      instance.addOverride("lifecycle.ignore_changes", ignoreChanges);
    }

    this.createInstanceRoleAssociations(
      instance.identifier,
      this.instanceAssociatedRoles,
    );
  }

  public get outputs(): Record<string, any> {
    return {
      ...super.outputs,
      ...(this.secret && { secretArn: this.secret.secretArn }),
    };
  }
}

/**
 * Construction properties for a DatabaseInstanceReadReplica.
 */
export interface DatabaseInstanceReadReplicaProps
  extends DatabaseInstanceNewProps {
  /**
   * The name of the compute and memory capacity classes.
   */
  readonly instanceType: ec2.InstanceType;

  /**
   * The source database instance.
   *
   * Each DB instance can have a limited number of read replicas. For more
   * information, see https://docs.aws.amazon.com/AmazonRDS/latest/DeveloperGuide/USER_ReadRepl.html.
   */
  readonly sourceDatabaseInstance: IDatabaseInstance;

  /**
   * Indicates whether the DB instance is encrypted.
   *
   * @default - true if storageEncryptionKey has been provided, false otherwise
   */
  readonly storageEncrypted?: boolean;

  /**
   * The KMS key that's used to encrypt the DB instance.
   *
   * TERRACONSTRUCTS DEVIATION: `encryption.IKey` instead of upstream's `kms.IKeyRef` — see
   * `DatabaseInstanceNewProps.performanceInsightEncryptionKey` above.
   *
   * @default - default master key if storageEncrypted is true, no key otherwise
   */
  readonly storageEncryptionKey?: encryption.IKey;

  /**
   * The allocated storage size, specified in gibibytes (GiB).
   *
   * @default - The replica will inherit the allocated storage of the source database instance
   */
  readonly allocatedStorage?: number;
}

/**
 * A read replica database instance.
 *
 * @resource aws_db_instance
 */
export class DatabaseInstanceReadReplica
  extends DatabaseInstanceNew
  implements IDatabaseInstance
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.DatabaseInstanceReadReplica";

  public readonly instanceIdentifier: string;
  public readonly dbInstanceEndpointAddress: string;
  public readonly dbInstanceEndpointPort: string;

  /**
   * The AWS Region-unique, immutable identifier for the DB instance.
   * This identifier is found in AWS CloudTrail log entries whenever the AWS KMS key for the DB instance is accessed.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-rds-dbinstance.html#aws-resource-rds-dbinstance-return-values
   */
  public readonly instanceResourceId?: string;
  public readonly instanceEndpoint: Endpoint;
  public readonly engine?: IInstanceEngine = undefined;
  protected readonly instanceType: ec2.InstanceType;

  public readonly resource: dbInstance.DbInstance;

  constructor(
    scope: Construct,
    id: string,
    props: DatabaseInstanceReadReplicaProps,
  ) {
    super(scope, id, props);

    if (
      props.sourceDatabaseInstance.engine &&
      !props.sourceDatabaseInstance.engine.supportsReadReplicaBackups &&
      props.backupRetention
    ) {
      throw new ValidationError(
        `Cannot set 'backupRetention', as engine '${engineDescription(props.sourceDatabaseInstance.engine)}' does not support automatic backups for read replicas`,
        this,
      );
    }

    const engineType = props.sourceDatabaseInstance.engine?.engineType;
    if (
      engineType &&
      props.engineLifecycleSupport &&
      !["mysql", "postgres"].includes(engineType)
    ) {
      throw new ValidationError(
        `'engineLifecycleSupport' can only be specified for RDS for MySQL and RDS for PostgreSQL, got: '${engineType}'`,
        this,
      );
    }

    // The read replica instance always uses the same engine as the source instance
    // but some CF validations require the engine to be explicitly passed when some
    // properties are specified.
    const shouldPassEngine = props.domain != null;

    const instance = new dbInstance.DbInstance(this, "Resource", {
      ...this.newInstanceProps,
      // this must be ARN, not ID, because of https://github.com/terraform-providers/terraform-provider-aws/issues/528#issuecomment-391169012
      replicateSourceDb: props.sourceDatabaseInstance.instanceArn,
      kmsKeyId: props.storageEncryptionKey?.keyArn,
      storageEncrypted: props.storageEncryptionKey
        ? true
        : props.storageEncrypted,
      engine: shouldPassEngine ? engineType : undefined,
      allocatedStorage: props.allocatedStorage,
    } as dbInstance.DbInstanceConfig);

    this.resource = instance;
    this.instanceType = props.instanceType;
    this.instanceIdentifier = instance.identifier;
    this.dbInstanceEndpointAddress = instance.address;
    this.dbInstanceEndpointPort = Tokenization.stringifyNumber(instance.port);

    // TERRACONSTRUCTS DEVIATION: upstream branches on the
    // `USE_CORRECT_VALUE_FOR_INSTANCE_RESOURCE_ID_PROPERTY` feature flag between
    // `attrDbiResourceId` (correct) and `attrDbInstanceArn` (legacy/incorrect, kept only for
    // backward compatibility with already-deployed CFN stacks predating the fix). There is no
    // legacy template to stay compatible with here, so only the correct value is used.
    this.instanceResourceId = instance.resourceId;

    this.instanceEndpoint = new Endpoint(instance.address, instance.port);
  }
}

/**
 * TERRACONSTRUCTS DEVIATION: replaces upstream's `renderCredentials` (`./private/util.ts`), which
 * is commented out there because it depends on `Credentials.fromSecret` (itself commented out in
 * `./props.ts` — needs `ISecret.secretValueFromJson`, not portable). This local equivalent produces
 * the same three pieces of information (username / password token / owned secret) directly, using
 * `Secret._generatedPassword` (see the TERRACONSTRUCTS DEVIATION on that getter in
 * `../../encryption/secret.ts`) instead of a dynamic-reference `SecretValue`.
 */
function renderInstanceCredentials(
  scope: Construct,
  engine: IInstanceEngine,
  credentials?: Credentials,
): {
  username: string;
  password?: string;
  secret?: secretsmanager.ISecret;
} {
  const rendered =
    credentials ?? Credentials.fromUsername(engine.defaultUsername ?? "admin");

  if (rendered.secret) {
    // TERRACONSTRUCTS DEVIATION: upstream also supports `Credentials.fromSecret(existingSecret)`
    // here (an *existing*, caller-supplied secret). That factory is commented out in `./props.ts`
    // (needs `secretValueFromJson`), so `rendered.secret` can only be non-undefined here if a
    // caller hand-builds a `Credentials`-shaped object literal (TS structural typing permits this
    // even with the factory unavailable). There's no portable way to pull a plaintext password out
    // of an arbitrary existing secret, so this is rejected explicitly instead of silently producing
    // a DB instance with an unset password.
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

function defaultIops(
  storageType: StorageType,
  iops?: number,
): number | undefined {
  switch (storageType) {
    case StorageType.STANDARD:
    case StorageType.GP2:
      return undefined;
    case StorageType.GP3:
      return iops;
    case StorageType.IO1:
    case StorageType.IO2:
      return iops ?? 1000;
  }
}

// TODO: omitted — see the TODO on `ProcessorFeatures` above; the provider has no argument to render
// these into —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts#L1686-L1695
// /**
//  * Renders the processor features specifications
//  *
//  * @param features the processor features
//  */
// function renderProcessorFeatures(features: ProcessorFeatures): CfnDBInstance.ProcessorFeatureProperty[] | undefined {
//   const featuresList = Object.entries(features).map(([name, value]) => ({ name, value: value.toString() }));
//
//   return featuresList.length === 0 ? undefined : featuresList;
// }
