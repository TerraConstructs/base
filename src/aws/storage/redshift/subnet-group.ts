// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/subnet-group.ts

import { redshiftSubnetGroup } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as ec2 from "../../compute";

/**
 * Interface for a cluster subnet group.
 *
 * TODO: omitted — upstream also extends `aws_redshift.IClusterSubnetGroupRef`, a CloudFormation
 * cross-stack "Reference" marker interface generated from the CFN resource spec. TerraConstructs
 * has no equivalent generated-reference layer (identical omission to `ISubnetGroup` in
 * `../rds/subnet-group.ts`), so it is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/subnet-group.ts#L9-L16
 */
export interface IClusterSubnetGroup extends IAwsConstruct {
  /**
   * The name of the cluster subnet group.
   */
  readonly clusterSubnetGroupName: string;
}

/**
 * Properties for creating a ClusterSubnetGroup.
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `ClusterSubnetGroupProps` does not — matching the base-idiom used throughout
 * this repo (e.g. `SubnetGroupProps` in `../rds/subnet-group.ts`) for cross-account/-region
 * construct placement.
 */
export interface ClusterSubnetGroupProps extends AwsConstructProps {
  /**
   * Description of the subnet group.
   */
  readonly description: string;

  /**
   * The VPC to place the subnet group in.
   */
  readonly vpc: ec2.IVpc;

  /**
   * The name of the cluster subnet group.
   *
   * TERRACONSTRUCTS DEVIATION: not present upstream (CloudFormation always generates the
   * physical name from the logical id for `AWS::Redshift::ClusterSubnetGroup`). The underlying
   * `aws_redshift_subnet_group` Terraform resource requires a `name` argument, so this repo
   * exposes it as an optional prop (mirroring `SubnetGroup` in `../rds/subnet-group.ts` and
   * `../neptune/subnet-group.ts`) with a gridUUID-scoped generated default.
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly clusterSubnetGroupName?: string;

  /**
   * Which subnets within the VPC to associate with this group.
   *
   * @default - private subnets
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  // TERRACONSTRUCTS DEVIATION: upstream also exposes `removalPolicy` here (default
  // RemovalPolicy.RETAIN, mapped onto the CfnClusterSubnetGroup's DeletionPolicy/UpdateReplacePolicy).
  // `core.RemovalPolicy` is not ported in this repo (see the identical omission on
  // `SubnetGroupProps` in `../rds/subnet-group.ts` / `../neptune/subnet-group.ts`), and the
  // `aws_redshift_subnet_group` Terraform resource has no `skip_destroy` (or equivalent) argument
  // to honestly map RETAIN onto, so it is dropped entirely rather than partially wired up —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/subnet-group.ts#L35-L41
  // readonly removalPolicy?: RemovalPolicy;
}

/**
 * Class for creating a Redshift cluster subnet group
 *
 * @resource aws_redshift_subnet_group
 */
export class ClusterSubnetGroup
  extends AwsConstructBase
  implements IClusterSubnetGroup
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.redshift.ClusterSubnetGroup";

  /**
   * Imports an existing subnet group by name.
   */
  public static fromClusterSubnetGroupName(
    scope: Construct,
    id: string,
    clusterSubnetGroupName: string,
  ): IClusterSubnetGroup {
    class Import extends AwsConstructBase implements IClusterSubnetGroup {
      public readonly clusterSubnetGroupName = clusterSubnetGroupName;
      public get outputs(): Record<string, any> {
        return { name: this.clusterSubnetGroupName };
      }
    }
    return new Import(scope, id);
  }

  public readonly clusterSubnetGroupName: string;

  private readonly resource: redshiftSubnetGroup.RedshiftSubnetGroup;

  constructor(scope: Construct, id: string, props: ClusterSubnetGroupProps) {
    super(scope, id, props);

    const { subnetIds } = props.vpc.selectSubnets(
      props.vpcSubnets ?? { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    );

    this.resource = new redshiftSubnetGroup.RedshiftSubnetGroup(
      this,
      "Default",
      {
        description: props.description,
        // names are actually stored by Redshift changed to lowercase on the server side, and not
        // lowercasing them means things like { Ref } do not work correctly.
        // TERRACONSTRUCTS DEVIATION: when unnamed, upstream lets CloudFormation generate a name
        // from the logical id; the repo invariant is a gridUUID-scoped `uniqueResourceName`
        // default instead (mirroring `SubnetGroup` in `../rds/subnet-group.ts`), lowercased to
        // match the Redshift/RDS-family server-side storage convention.
        name: Token.isUnresolved(props.clusterSubnetGroupName)
          ? (props.clusterSubnetGroupName as string)
          : (
              props.clusterSubnetGroupName ??
              this.stack.uniqueResourceName(this)
            ).toLowerCase(),
        subnetIds,
      },
    );

    // TERRACONSTRUCTS DEVIATION: no `removalPolicy` to apply here — see
    // `ClusterSubnetGroupProps` note above.

    this.clusterSubnetGroupName = this.resource.name;
  }

  public get outputs(): Record<string, any> {
    return {
      name: this.clusterSubnetGroupName,
      arn: this.resource.arn,
    };
  }
}
