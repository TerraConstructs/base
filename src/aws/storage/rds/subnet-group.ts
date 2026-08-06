// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/subnet-group.ts

import { dbSubnetGroup } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as ec2 from "../../compute";

/**
 * Interface for a subnet group.
 */
export interface ISubnetGroup extends IAwsConstruct {
  /**
   * The name of the subnet group.
   */
  readonly subnetGroupName: string;

  // TODO: omitted — upstream also extends `aws_rds.IDBSubnetGroupRef`, a CloudFormation
  // cross-stack "Reference" marker interface generated from the CFN resource spec. TerraConstructs
  // has no equivalent generated-reference layer (Terraform cross-stack refs work differently, via
  // remote state / outputs), so `dbSubnetGroupRef` is dropped —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/subnet-group.ts#L13
}

/**
 * Properties for creating a SubnetGroup.
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `SubnetGroupProps` does not — matching the base-idiom used throughout this
 * repo (e.g. `SecurityGroupProps`, `QueueProps`, `TableProps`) for cross-account/-region
 * construct placement.
 */
export interface SubnetGroupProps extends AwsConstructProps {
  /**
   * Description of the subnet group.
   */
  readonly description: string;

  /**
   * The VPC to place the subnet group in.
   */
  readonly vpc: ec2.IVpc;

  /**
   * The name of the subnet group.
   *
   * @default - a name is generated
   */
  readonly subnetGroupName?: string;

  /**
   * Which subnets within the VPC to associate with this group.
   *
   * @default - private subnets
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  // TERRACONSTRUCTS DEVIATION: upstream also exposes `removalPolicy` here (default
  // RemovalPolicy.DESTROY, mapped onto the CfnDBSubnetGroup's DeletionPolicy). `core.RemovalPolicy`
  // is not ported in this repo (see `notify/queue.ts` and `encryption/secret.ts` for the same
  // omission), and unlike `db_parameter_group`/`rds_cluster_parameter_group`/`db_option_group`,
  // the `aws_db_subnet_group` Terraform resource has no `skip_destroy` (or equivalent) argument to
  // honestly map RETAIN onto, so it is dropped entirely rather than partially wired up.
  // readonly removalPolicy?: RemovalPolicy;
}

/**
 * Class for creating a RDS DB subnet group
 *
 * @resource aws_db_subnet_group
 */
export class SubnetGroup extends AwsConstructBase implements ISubnetGroup {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.SubnetGroup";

  /**
   * Imports an existing subnet group by name.
   */
  public static fromSubnetGroupName(
    scope: Construct,
    id: string,
    subnetGroupName: string,
  ): ISubnetGroup {
    class Import extends AwsConstructBase implements ISubnetGroup {
      public readonly subnetGroupName = subnetGroupName;
      // TODO: omitted — see ISubnetGroup.dbSubnetGroupRef note above —
      // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/subnet-group.ts#L74-L78
      public get outputs(): Record<string, any> {
        return { name: this.subnetGroupName };
      }
    }
    return new Import(scope, id);
  }

  public readonly subnetGroupName: string;

  private readonly resource: dbSubnetGroup.DbSubnetGroup;

  constructor(scope: Construct, id: string, props: SubnetGroupProps) {
    super(scope, id, props);

    const { subnetIds } = props.vpc.selectSubnets(
      props.vpcSubnets ?? { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    );

    // Using 'Default' as the resource id for historical reasons (usage from `Instance` and `Cluster`).
    this.resource = new dbSubnetGroup.DbSubnetGroup(this, "Default", {
      description: props.description,
      // names are actually stored by RDS changed to lowercase on the server side,
      // and not lowercasing them in CloudFormation means things like { Ref }
      // do not work correctly
      // TERRACONSTRUCTS DEVIATION: when unnamed, upstream lets CFN generate a
      // name from the logical id; the repo invariant is a gridUUID-scoped
      // uniqueResourceName default (table.ts/job-queue.ts idiom), lowercased
      // to match RDS server-side storage.
      name: Token.isUnresolved(props.subnetGroupName)
        ? props.subnetGroupName
        : (
            props.subnetGroupName ?? this.stack.uniqueResourceName(this)
          ).toLowerCase(),
      subnetIds,
    });

    // TERRACONSTRUCTS DEVIATION: no `removalPolicy` to apply here — see SubnetGroupProps note above.
    // if (props.removalPolicy) {
    //   subnetGroup.applyRemovalPolicy(props.removalPolicy);
    // }

    this.subnetGroupName = this.resource.name;
  }

  public get outputs(): Record<string, any> {
    return {
      name: this.subnetGroupName,
      arn: this.resource.arn,
    };
  }
}
