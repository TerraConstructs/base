// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/lib/subnet-group.ts

import { neptuneSubnetGroup } from "@cdktn/provider-aws";
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
 *
 * TODO: omitted — upstream also extends a CloudFormation cross-stack "Reference" marker
 * interface generated from the CFN resource spec. TerraConstructs has no equivalent
 * generated-reference layer (identical omission to `ISubnetGroup` in `../rds/subnet-group.ts`),
 * so no such marker is added here —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/lib/subnet-group.ts#L10-L17
 */
export interface ISubnetGroup extends IAwsConstruct {
  /**
   * The name of the subnet group.
   */
  readonly subnetGroupName: string;
}

/**
 * Properties for creating a SubnetGroup.
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `SubnetGroupProps` does not — matching the base-idiom used throughout this
 * repo (e.g. `SubnetGroupProps` in `../rds/subnet-group.ts`) for cross-account/-region construct
 * placement.
 */
export interface SubnetGroupProps extends AwsConstructProps {
  /**
   * Description of the subnet group.
   *
   * @default - a default description is generated
   */
  readonly description?: string;

  /**
   * The VPC to place the subnet group in.
   */
  readonly vpc: ec2.IVpc;

  /**
   * The name of the subnet group.
   *
   * @default - a gridUUID-scoped generated name
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
  // is not ported in this repo (see the identical omission on `SubnetGroupProps` in
  // `../rds/subnet-group.ts`), and the `aws_neptune_subnet_group` Terraform resource has no
  // `skip_destroy` (or equivalent) argument to honestly map RETAIN onto, so it is dropped
  // entirely rather than partially wired up —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/lib/subnet-group.ts#L51-L56
  // readonly removalPolicy?: RemovalPolicy;
}

/**
 * Class for creating a Neptune subnet group
 *
 * @resource aws_neptune_subnet_group
 */
export class SubnetGroup extends AwsConstructBase implements ISubnetGroup {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.neptune.SubnetGroup";

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
      public get outputs(): Record<string, any> {
        return { name: this.subnetGroupName };
      }
    }
    return new Import(scope, id);
  }

  public readonly subnetGroupName: string;

  private readonly resource: neptuneSubnetGroup.NeptuneSubnetGroup;

  constructor(scope: Construct, id: string, props: SubnetGroupProps) {
    super(scope, id, props);

    const { subnetIds } = props.vpc.selectSubnets(
      props.vpcSubnets ?? { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    );

    this.resource = new neptuneSubnetGroup.NeptuneSubnetGroup(
      this,
      "Resource",
      {
        description: props.description || "Subnet group for Neptune",
        // names are actually stored by Neptune changed to lowercase on the server side, and not
        // lowercasing them means things like { Ref } do not work correctly.
        // TERRACONSTRUCTS DEVIATION: when unnamed, upstream lets CloudFormation generate a name
        // from the logical id; the repo invariant is a gridUUID-scoped `uniqueResourceName`
        // default instead (mirroring `SubnetGroup` in `../rds/subnet-group.ts`), lowercased to
        // match the Neptune/RDS-family server-side storage convention.
        name: Token.isUnresolved(props.subnetGroupName)
          ? props.subnetGroupName
          : (
              props.subnetGroupName ?? this.stack.uniqueResourceName(this)
            ).toLowerCase(),
        subnetIds,
      },
    );

    // TERRACONSTRUCTS DEVIATION: no `removalPolicy` to apply here — see `SubnetGroupProps` note
    // above.

    this.subnetGroupName = this.resource.name;
  }

  public get outputs(): Record<string, any> {
    return {
      name: this.subnetGroupName,
      arn: this.resource.arn,
    };
  }
}
