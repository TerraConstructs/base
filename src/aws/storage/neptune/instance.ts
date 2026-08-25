// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/lib/instance.ts

import { neptuneClusterInstance } from "@cdktn/provider-aws";
import { Annotations, Token, Tokenization } from "cdktn";
import { Construct } from "constructs";
import type { IDatabaseCluster } from "./cluster";
import { Endpoint } from "./endpoint";
import type { IParameterGroup } from "./parameter-group";
import { UnscopedValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as cloudwatch from "../../cloudwatch";

/**
 * Possible Instances Types to use in Neptune cluster
 * used for defining `DatabaseInstanceProps.instanceType`.
 */
export class InstanceType {
  /**
   * db.x2g.large
   */
  public static readonly X2G_LARGE = InstanceType.of("db.x2g.large");

  /**
   * db.x2g.xlarge
   */
  public static readonly X2G_XLARGE = InstanceType.of("db.x2g.xlarge");

  /**
   * db.x2g.2xlarge
   */
  public static readonly X2G_2XLARGE = InstanceType.of("db.x2g.2xlarge");

  /**
   * db.x2g.4xlarge
   */
  public static readonly X2G_4XLARGE = InstanceType.of("db.x2g.4xlarge");

  /**
   * db.x2g.8xlarge
   */
  public static readonly X2G_8XLARGE = InstanceType.of("db.x2g.8xlarge");

  /**
   * db.x2g.12xlarge
   */
  public static readonly X2G_12XLARGE = InstanceType.of("db.x2g.12xlarge");

  /**
   * db.x2g.16xlarge
   */
  public static readonly X2G_16XLARGE = InstanceType.of("db.x2g.16xlarge");

  /**
   * db.x2iedn.xlarge
   */
  public static readonly X2IEDN_XLARGE = InstanceType.of("db.x2iedn.xlarge");

  /**
   * db.x2iedn.2xlarge
   */
  public static readonly X2IEDN_2XLARGE = InstanceType.of("db.x2iedn.2xlarge");

  /**
   * db.x2iedn.4xlarge
   */
  public static readonly X2IEDN_4XLARGE = InstanceType.of("db.x2iedn.4xlarge");

  /**
   * db.x2iedn.8xlarge
   */
  public static readonly X2IEDN_8XLARGE = InstanceType.of("db.x2iedn.8xlarge");

  /**
   * db.x2iedn.16xlarge
   */
  public static readonly X2IEDN_16XLARGE =
    InstanceType.of("db.x2iedn.16xlarge");

  /**
   * db.x2iedn.24xlarge
   */
  public static readonly X2IEDN_24XLARGE =
    InstanceType.of("db.x2iedn.24xlarge");

  /**
   * db.x2iedn.32xlarge
   */
  public static readonly X2IEDN_32XLARGE =
    InstanceType.of("db.x2iedn.32xlarge");

  /**
   * db.r6g.large
   */
  public static readonly R6G_LARGE = InstanceType.of("db.r6g.large");

  /**
   * db.r6g.xlarge
   */
  public static readonly R6G_XLARGE = InstanceType.of("db.r6g.xlarge");

  /**
   * db.r6g.2xlarge
   */
  public static readonly R6G_2XLARGE = InstanceType.of("db.r6g.2xlarge");

  /**
   * db.r6g.4xlarge
   */
  public static readonly R6G_4XLARGE = InstanceType.of("db.r6g.4xlarge");

  /**
   * db.r6g.8xlarge
   */
  public static readonly R6G_8XLARGE = InstanceType.of("db.r6g.8xlarge");

  /**
   * db.r6g.12xlarge
   */
  public static readonly R6G_12XLARGE = InstanceType.of("db.r6g.12xlarge");

  /**
   * db.r6g.16xlarge
   */
  public static readonly R6G_16XLARGE = InstanceType.of("db.r6g.16xlarge");

  /**
   * db.r6i.large
   */
  public static readonly R6I_LARGE = InstanceType.of("db.r6i.large");

  /**
   * db.r6i.xlarge
   */
  public static readonly R6I_XLARGE = InstanceType.of("db.r6i.xlarge");

  /**
   * db.r6i.2xlarge
   */
  public static readonly R6I_2XLARGE = InstanceType.of("db.r6i.2xlarge");

  /**
   * db.r6i.4xlarge
   */
  public static readonly R6I_4XLARGE = InstanceType.of("db.r6i.4xlarge");

  /**
   * db.r6i.8xlarge
   */
  public static readonly R6I_8XLARGE = InstanceType.of("db.r6i.8xlarge");

  /**
   * db.r6i.12xlarge
   */
  public static readonly R6I_12XLARGE = InstanceType.of("db.r6i.12xlarge");

  /**
   * db.r6i.16xlarge
   */
  public static readonly R6I_16XLARGE = InstanceType.of("db.r6i.16xlarge");

  /**
   * db.r6i.24xlarge
   */
  public static readonly R6I_24XLARGE = InstanceType.of("db.r6i.24xlarge");

  /**
   * db.r6i.32xlarge
   */
  public static readonly R6I_32XLARGE = InstanceType.of("db.r6i.32xlarge");

  /**
   * db.r5.large
   */
  public static readonly R5_LARGE = InstanceType.of("db.r5.large");

  /**
   * db.r5.xlarge
   */
  public static readonly R5_XLARGE = InstanceType.of("db.r5.xlarge");

  /**
   * db.r5.2xlarge
   */
  public static readonly R5_2XLARGE = InstanceType.of("db.r5.2xlarge");

  /**
   * db.r5.4xlarge
   */
  public static readonly R5_4XLARGE = InstanceType.of("db.r5.4xlarge");

  /**
   * db.r5.8xlarge
   */
  public static readonly R5_8XLARGE = InstanceType.of("db.r5.8xlarge");

  /**
   * db.r5.12xlarge
   */
  public static readonly R5_12XLARGE = InstanceType.of("db.r5.12xlarge");

  /**
   * db.r5.16xlarge
   */
  public static readonly R5_16XLARGE = InstanceType.of("db.r5.16xlarge");

  /**
   * db.r5.24xlarge
   */
  public static readonly R5_24XLARGE = InstanceType.of("db.r5.24xlarge");

  /**
   * db.r5d.large
   */
  public static readonly R5D_LARGE = InstanceType.of("db.r5d.large");

  /**
   * db.r5d.xlarge
   */
  public static readonly R5D_XLARGE = InstanceType.of("db.r5d.xlarge");

  /**
   * db.r5d.2xlarge
   */
  public static readonly R5D_2XLARGE = InstanceType.of("db.r5d.2xlarge");

  /**
   * db.r5d.4xlarge
   */
  public static readonly R5D_4XLARGE = InstanceType.of("db.r5d.4xlarge");

  /**
   * db.r5d.8xlarge
   */
  public static readonly R5D_8XLARGE = InstanceType.of("db.r5d.8xlarge");

  /**
   * db.r5d.12xlarge
   */
  public static readonly R5D_12XLARGE = InstanceType.of("db.r5d.12xlarge");

  /**
   * db.r5d.16xlarge
   */
  public static readonly R5D_16XLARGE = InstanceType.of("db.r5d.16xlarge");

  /**
   * db.r5d.24xlarge
   */
  public static readonly R5D_24XLARGE = InstanceType.of("db.r5d.24xlarge");

  /**
   * db.r4.large
   */
  public static readonly R4_LARGE = InstanceType.of("db.r4.large");

  /**
   * db.r4.xlarge
   */
  public static readonly R4_XLARGE = InstanceType.of("db.r4.xlarge");

  /**
   * db.r4.2xlarge
   */
  public static readonly R4_2XLARGE = InstanceType.of("db.r4.2xlarge");

  /**
   * db.r4.4xlarge
   */
  public static readonly R4_4XLARGE = InstanceType.of("db.r4.4xlarge");

  /**
   * db.r4.8xlarge
   */
  public static readonly R4_8XLARGE = InstanceType.of("db.r4.8xlarge");

  /**
   * db.t4g.medium
   */
  public static readonly T4G_MEDIUM = InstanceType.of("db.t4g.medium");

  /**
   * db.t3.medium
   */
  public static readonly T3_MEDIUM = InstanceType.of("db.t3.medium");

  /**
   * db.serverless
   */
  public static readonly SERVERLESS = InstanceType.of("db.serverless");

  /**
   * Build an InstanceType from given string or token, such as CfnParameter.
   */
  public static of(instanceType: string): InstanceType {
    return new InstanceType(instanceType);
  }

  /**
   * @internal
   */
  readonly _instanceType: string;

  private constructor(instanceType: string) {
    if (Token.isUnresolved(instanceType) || instanceType.startsWith("db.")) {
      this._instanceType = instanceType;
    } else {
      throw new UnscopedValidationError(
        `instance type must start with 'db.'; (got ${instanceType})`,
      );
    }
  }
}

/**
 * A database instance
 *
 * TODO: omitted — upstream also extends `cdk.IResource`-equivalent generated-reference typing is
 * not applicable here; see the identical omission note on `IDatabaseInstance` in
 * `../docdb/instance.ts`.
 */
export interface IDatabaseInstance extends IAwsConstruct {
  /**
   * The instance identifier.
   */
  readonly instanceIdentifier: string;

  /**
   * The instance endpoint.
   */
  readonly instanceEndpoint: Endpoint;

  /**
   * The instance endpoint address.
   */
  readonly dbInstanceEndpointAddress: string;

  /**
   * The instance endpoint port.
   */
  readonly dbInstanceEndpointPort: string;

  /**
   * Return the given named metric associated with this database instance
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
   * @inheritdoc
   */
  public abstract readonly instanceIdentifier: string;

  /**
   * @inheritdoc
   */
  public metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/Neptune",
      dimensionsMap: {
        DBInstanceIdentifier: this.instanceIdentifier,
      },
      metricName,
      ...props,
    });
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — repo-wide construct-output convention (see
   * `DatabaseInstance` in `../docdb/instance.ts`) for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      identifier: this.instanceIdentifier,
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
 * repo (e.g. `DatabaseInstanceProps` in `../docdb/instance.ts`) for cross-account/-region
 * construct placement.
 */
export interface DatabaseInstanceProps extends AwsConstructProps {
  /**
   * The Neptune database cluster the instance should launch into.
   */
  readonly cluster: IDatabaseCluster;

  /**
   * What type of instance to start for the replicas
   */
  readonly instanceType: InstanceType;

  /**
   * The name of the Availability Zone where the DB instance will be located.
   *
   * @default - no preference
   */
  readonly availabilityZone?: string;

  /**
   * A name for the DB instance. If you specify a name, it is lowercased at synth (Neptune stores
   * DB identifiers lowercase server-side, and emitting the original casing would report a
   * perpetual Terraform diff).
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly dbInstanceName?: string;

  /**
   * The DB parameter group to associate with the instance.
   *
   * @default no parameter group
   */
  readonly parameterGroup?: IParameterGroup;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.Retain`)
  // maps onto `CfnDBInstance`'s CloudFormation `DeletionPolicy`/`UpdateReplacePolicy`.
  // `core.RemovalPolicy` is not ported in this repo (see the identical omission throughout
  // `../docdb`/`../rds`, e.g. `SubnetGroupProps`). Unlike `aws_docdb_cluster_instance` (which has
  // no snapshot-related argument at all -- see `../docdb/instance.ts`), the Terraform
  // `aws_neptune_cluster_instance` resource DOES expose a native `skip_final_snapshot` argument,
  // the TERRACONSTRUCTS-native replacement ported below as `skipFinalSnapshot` —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/lib/instance.ts#L98-L103
  // readonly removalPolicy?: cdk.RemovalPolicy;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — native Terraform replacement for upstream's
   * `removalPolicy` (see the TODO above). Whether Terraform should take a final DB snapshot before
   * destroying this instance. The underlying Neptune `DeleteDBInstance` API requires a
   * `FinalDBSnapshotIdentifier` whenever `SkipFinalSnapshot` is `false`
   * (https://docs.aws.amazon.com/neptune/latest/apiref/API_DeleteDBInstance.html), but unlike
   * `aws_db_instance` (RDS, see `../rds/instance.ts`'s `skipFinalSnapshot`/
   * `finalSnapshotIdentifier`), the `aws_neptune_cluster_instance` Terraform resource has NO
   * `final_snapshot_identifier` (or equivalent) argument to supply one -- so leaving this `false`
   * (the provider default) will FAIL at `terraform destroy`/replace time with no way to work
   * around it from this resource. See the synth-time warning in the constructor below.
   *
   * @default false (matches the provider default; will FAIL at apply/destroy time unless set to
   * `true` -- see above)
   */
  readonly skipFinalSnapshot?: boolean;

  /**
   * Indicates that minor version patches are applied automatically.
   *
   * @default undefined
   */
  readonly autoMinorVersionUpgrade?: boolean;
}

/**
 * A database instance
 *
 * @resource aws_neptune_cluster_instance
 */
export class DatabaseInstance
  extends DatabaseInstanceBase
  implements IDatabaseInstance
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.neptune.DatabaseInstance";

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
  public readonly instanceEndpoint: Endpoint;

  /**
   * @inheritdoc
   */
  public readonly dbInstanceEndpointAddress: string;

  /**
   * @inheritdoc
   */
  public readonly dbInstanceEndpointPort: string;

  /**
   * The underlying `aws_neptune_cluster_instance` L1.
   */
  public readonly resource: neptuneClusterInstance.NeptuneClusterInstance;

  constructor(scope: Construct, id: string, props: DatabaseInstanceProps) {
    super(scope, id, props);

    // TERRACONSTRUCTS DEVIATION: repo invariant -- unnamed resources get a gridUUID-scoped
    // `uniqueResourceName` default (lowercased; Neptune always lowercases DB instance identifiers
    // server-side) instead of relying on CloudFormation's Ref-based logical-id naming (which this
    // repo has no equivalent of -- see `../docdb/instance.ts` for the same idiom) or the
    // provider's own generated `terraform-<hash>` fallback. `DBInstanceIdentifier` is capped at 63
    // characters (same limit as RDS/DocumentDB DB instance identifiers), so `maxLength` is passed
    // explicitly here.
    const instanceIdentifier = Token.isUnresolved(props.dbInstanceName)
      ? props.dbInstanceName
      : (
          props.dbInstanceName ??
          this.stack.uniqueResourceName(this, { maxLength: 63 })
        ).toLowerCase();

    this.resource = new neptuneClusterInstance.NeptuneClusterInstance(
      this,
      "Resource",
      {
        clusterIdentifier: props.cluster.clusterIdentifier,
        instanceClass: props.instanceType._instanceType,
        availabilityZone: props.availabilityZone,
        identifier: instanceIdentifier,
        neptuneParameterGroupName: props.parameterGroup?.parameterGroupName,
        autoMinorVersionUpgrade: props.autoMinorVersionUpgrade,
        skipFinalSnapshot: props.skipFinalSnapshot,
      },
    );

    // TERRACONSTRUCTS DEVIATION: mirrors the identical `skipFinalSnapshot` synth-time warning on
    // `DatabaseCluster` in `../docdb/cluster.ts` -- see the `skipFinalSnapshot` note on
    // `DatabaseInstanceProps` above for the full rationale (no `final_snapshot_identifier`
    // equivalent exists on `aws_neptune_cluster_instance` to honestly map RETAIN semantics onto).
    if (props.skipFinalSnapshot !== true) {
      Annotations.of(this).addWarning(
        "`skipFinalSnapshot` is not set to `true`: `terraform destroy` (or any change that replaces this instance) will FAIL at apply time because `aws_neptune_cluster_instance` has no `final_snapshot_identifier` (or equivalent) argument to take a final snapshot with. Set `skipFinalSnapshot: true` to acknowledge this.",
      );
    }

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
