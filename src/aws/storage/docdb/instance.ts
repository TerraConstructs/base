// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/instance.ts

import { docdbClusterInstance } from "@cdktn/provider-aws";
import { Token, Tokenization } from "cdktn";
import { Construct } from "constructs";
import type { IDatabaseCluster } from "./cluster-ref";
import { Endpoint } from "./endpoint";
import { ArnFormat } from "../../arn";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as ec2 from "../../compute";
import type { CaCertificate } from "../rds";

/**
 * A database instance
 *
 * TODO: omitted — upstream also extends `aws_docdb.IDBInstanceRef`, a CloudFormation cross-stack
 * "Reference" marker interface generated from the CFN resource spec. TerraConstructs has no
 * equivalent generated-reference layer (identical omission on `IDatabaseInstance` in
 * `../rds/instance.ts`), so `dbInstanceRef` is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/instance.ts#L12
 */
export interface IDatabaseInstance extends IAwsConstruct {
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
   *
   * @attribute Endpoint
   */
  readonly dbInstanceEndpointAddress: string;

  /**
   * The instance endpoint port.
   *
   * @attribute Port
   */
  readonly dbInstanceEndpointPort: string;

  /**
   * The instance endpoint.
   */
  readonly instanceEndpoint: Endpoint;
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
}

/**
 * A new or imported database instance.
 */
abstract class DatabaseInstanceBase
  extends AwsConstructBase
  implements IDatabaseInstance
{
  /**
   * Import an existing database instance.
   */
  public static fromDatabaseInstanceAttributes(
    scope: Construct,
    id: string,
    attrs: DatabaseInstanceAttributes,
  ): IDatabaseInstance {
    class Import extends DatabaseInstanceBase implements IDatabaseInstance {
      public readonly instanceIdentifier = attrs.instanceIdentifier;
      public readonly dbInstanceEndpointAddress = attrs.instanceEndpointAddress;
      public readonly dbInstanceEndpointPort = Tokenization.stringifyNumber(
        attrs.port,
      );
      public readonly instanceEndpoint = new Endpoint(
        attrs.instanceEndpointAddress,
        attrs.port,
      );
    }

    return new Import(scope, id, {});
  }

  /**
   * @inheritdoc
   */
  public abstract readonly instanceIdentifier: string;
  /**
   * @inheritdoc
   */
  public abstract readonly dbInstanceEndpointAddress: string;
  /**
   * @inheritdoc
   */
  public abstract readonly dbInstanceEndpointPort: string;
  /**
   * @inheritdoc
   */
  public abstract readonly instanceEndpoint: Endpoint;

  /**
   * The instance arn.
   *
   * TERRACONSTRUCTS DEVIATION: upstream resolves this via `Stack.formatArn`, which works for both
   * owned and imported instances because `this.instanceIdentifier` is already the final physical
   * name by the time this getter runs (not a two-phase CFN Ref/attribute). That is exactly this
   * repo's `this.instanceIdentifier` semantics too (always the real, final value -- either a
   * caller-supplied string or the underlying `aws_docdb_cluster_instance.identifier` attribute), so
   * the same single `formatArn` call carries over unchanged. DocumentDB instance ARNs live in the
   * `rds`/`db` ARN namespace (DocumentDB is RDS-family infrastructure), matching upstream exactly.
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
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/instance.ts#L116-L123
  // /**
  //  * A reference to this instance.
  //  */
  // public get dbInstanceRef(): DBInstanceReference {
  //   return {
  //     dbInstanceId: this.instanceIdentifier,
  //   };
  // }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — repo-wide construct-output convention (see
   * `ClusterParameterGroup` in `./parameter-group.ts` and `SubnetGroup`/`OptionGroup` in `../rds`)
   * for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      identifier: this.instanceIdentifier,
      arn: this.instanceArn,
      endpointAddress: this.dbInstanceEndpointAddress,
      endpointPort: this.dbInstanceEndpointPort,
    };
  }
}

/**
 * Construction properties for a DatabaseInstanceNew
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `DatabaseInstanceProps` does not — matching the base-idiom used throughout this
 * repo (e.g. `ClusterParameterGroupProps` in `./parameter-group.ts`, `SubnetGroupProps`/
 * `OptionGroupProps` in `../rds`) for cross-account/-region construct placement.
 */
export interface DatabaseInstanceProps extends AwsConstructProps {
  /**
   * The DocumentDB database cluster the instance should launch into.
   *
   * TERRACONSTRUCTS DEVIATION: typed as `IDatabaseCluster` (this module's own construct interface,
   * `./cluster-ref.ts`) rather than upstream's `aws_docdb.IDBClusterRef` — see the TODO on
   * `IDatabaseCluster` there. Because there is no looser generated cross-stack reference type to
   * accept here, the runtime `toIDatabaseCluster()` duck-typing cast upstream performs on this prop
   * (to recover an `IDatabaseCluster` for the public `cluster` getter) is unnecessary and dropped.
   */
  readonly cluster: IDatabaseCluster;

  /**
   * The name of the compute and memory capacity classes.
   */
  readonly instanceType: ec2.InstanceType;

  /**
   * The name of the Availability Zone where the DB instance will be located.
   *
   * @default - no preference
   */
  readonly availabilityZone?: string;

  /**
   * A name for the DB instance. If you specify a name, it is lowercased (DocumentDB always
   * lowercases DB instance identifiers server-side).
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly dbInstanceName?: string;

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
   * the time blocks available, see https://docs.aws.amazon.com/documentdb/latest/developerguide/db-instance-maintain.html#maintenance-window
   */
  readonly preferredMaintenanceWindow?: string;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.RETAIN`) maps
  // onto `CfnDBInstance`'s CloudFormation `DeletionPolicy`/`UpdateReplacePolicy`. `core.RemovalPolicy`
  // is not ported in this repo (see the identical omission throughout `../rds`, e.g.
  // `SubnetGroupProps`). Unlike `aws_db_instance` (RDS, see `../rds/instance.ts`'s
  // `skipFinalSnapshot`/`finalSnapshotIdentifier`), the Terraform `aws_docdb_cluster_instance`
  // resource has NO `skip_final_snapshot`/`final_snapshot_identifier`/`deletion_protection`
  // arguments at all to honestly map any part of this onto -- individual DocumentDB cluster
  // instances are stateless compute nodes (storage lives on the cluster, the same compute/storage
  // separation as Aurora), so there is no Terraform-native replacement to offer here. It is dropped
  // entirely rather than partially wired up —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/instance.ts#L176-L182
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * A value that indicates whether to enable Performance Insights for the DB Instance.
   *
   * @default - false
   */
  readonly enablePerformanceInsights?: boolean;

  /**
   * The identifier of the CA certificate for this DB instance.
   *
   * Specifying or updating this property triggers a reboot.
   *
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/ca_cert_rotation.html
   *
   * @default - DocumentDB will choose a certificate authority
   */
  readonly caCertificate?: CaCertificate;
}

/**
 * A database instance
 *
 * @resource aws_docdb_cluster_instance
 */
export class DatabaseInstance
  extends DatabaseInstanceBase
  implements IDatabaseInstance
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.docdb.DatabaseInstance";

  /**
   * The instance's database cluster
   */
  public readonly cluster: IDatabaseCluster;

  /**
   * @inheritdoc
   */
  public readonly instanceIdentifier: string;

  /**
   * @inheritdoc
   */
  public readonly dbInstanceEndpointAddress: string;

  /**
   * @inheritdoc
   */
  public readonly dbInstanceEndpointPort: string;

  /**
   * @inheritdoc
   */
  public readonly instanceEndpoint: Endpoint;

  /**
   * The underlying `aws_docdb_cluster_instance` L1.
   */
  public readonly resource: docdbClusterInstance.DocdbClusterInstance;

  constructor(scope: Construct, id: string, props: DatabaseInstanceProps) {
    super(scope, id, props);

    // TERRACONSTRUCTS DEVIATION: repo invariant -- unnamed resources get a gridUUID-scoped
    // `uniqueResourceName` default (lowercased; DocumentDB always lowercases DB instance
    // identifiers server-side) instead of relying on CloudFormation's Ref-based logical-id naming
    // (which this repo has no equivalent of -- see `ClusterParameterGroup`/`../rds/SubnetGroup` for
    // the same idiom) or the provider's own generated `terraform-<hash>` fallback.
    // `DBInstanceIdentifier` is capped at 63 characters (same limit as RDS DB instance
    // identifiers), so `maxLength` is passed explicitly here.
    const instanceIdentifier = Token.isUnresolved(props.dbInstanceName)
      ? props.dbInstanceName
      : (
          props.dbInstanceName ??
          this.stack.uniqueResourceName(this, { maxLength: 63 })
        ).toLowerCase();

    this.resource = new docdbClusterInstance.DocdbClusterInstance(
      this,
      "Resource",
      {
        clusterIdentifier: props.cluster.clusterIdentifier,
        instanceClass: `db.${props.instanceType}`,
        autoMinorVersionUpgrade: props.autoMinorVersionUpgrade ?? true,
        availabilityZone: props.availabilityZone,
        caCertIdentifier: props.caCertificate
          ? props.caCertificate.toString()
          : undefined,
        identifier: instanceIdentifier,
        preferredMaintenanceWindow: props.preferredMaintenanceWindow,
        enablePerformanceInsights: props.enablePerformanceInsights,
      },
    );

    this.cluster = props.cluster;
    this.instanceIdentifier = this.resource.identifier;
    this.dbInstanceEndpointAddress = this.resource.endpoint;
    this.dbInstanceEndpointPort = Tokenization.stringifyNumber(
      this.resource.port,
    );

    // TERRACONSTRUCTS DEVIATION: upstream converts `instance.attrPort` (a CFN `Fn::GetAtt` string
    // attribute) into a number token via `cdk.Token.asNumber(...)`. The CDKTF L1 `port` getter
    // already returns a native `number`-typed (Token-backed) attribute, so no string-to-number
    // conversion is needed here.
    this.instanceEndpoint = new Endpoint(
      this.resource.endpoint,
      this.resource.port,
    );
  }
}
