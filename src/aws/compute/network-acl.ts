// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/network-acl.ts

import {
  networkAcl as tfNetworkAcl,
  networkAclRule as tfNetworkAclRule,
  networkAclAssociation as tfNetworkAclAssociation,
} from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { AclCidr, AclTraffic } from "./network-acl-types";
import { ISubnet, IVpc, SubnetSelection } from "./vpc";
import {
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../aws-construct";
// TODO: Use TagManager and tag-aspect instead
import { Tags } from "../aws-tags";
// import { Tags } from "../tag-aspect";

/**
 * Name tag constant
 */
const NAME_TAG: string = "Name";

export interface NetworkAclOutputs {
  /**
   * The ID of the NetworkACL
   */
  readonly networkAclId: string;
}

/**
 * A NetworkAcl
 *
 *
 */
export interface INetworkAcl extends IAwsConstruct {
  readonly networkAclOutputs: NetworkAclOutputs;
  /**
   * ID for the current Network ACL
   * @attribute
   */
  readonly networkAclId: string;

  /**
   * Add a new entry to the ACL
   */
  addEntry(id: string, options: CommonNetworkAclEntryOptions): NetworkAclEntry;
}

/**
 * A NetworkAclBase that is not created in this template
 *
 *
 */
abstract class NetworkAclBase extends AwsConstructBase implements INetworkAcl {
  public get networkAclOutputs(): NetworkAclOutputs {
    return {
      networkAclId: this.networkAclId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.networkAclOutputs;
  }
  public abstract readonly networkAclId: string;

  /**
   * Add a new entry to the ACL
   */
  public addEntry(
    id: string,
    options: CommonNetworkAclEntryOptions,
  ): NetworkAclEntry {
    return new NetworkAclEntry(this, id, {
      networkAcl: this,
      ...options,
    });
  }
}

/**
 * Properties to create NetworkAcl
 *
 *
 */
export interface NetworkAclProps {
  /**
   * The name of the NetworkAcl.
   *
   * Since the NetworkAcl resource doesn't support providing a physical name, the value provided here will be recorded in the `Name` tag.
   *
   * @default CDK generated name
   */
  readonly networkAclName?: string;

  /**
   * The VPC in which to create the NetworkACL.
   */
  readonly vpc: IVpc;

  /**
   * Subnets in the given VPC to associate the ACL with
   *
   * More subnets can always be added later by calling
   * `associateWithSubnets()`.
   *
   * @default - No subnets associated
   */
  readonly subnetSelection?: SubnetSelection;
}

/**
 * Define a new custom network ACL
 *
 * By default, will deny all inbound and outbound traffic unless entries are
 * added explicitly allowing it.
 *
 *
 */
export class NetworkAcl extends NetworkAclBase {
  /**
   * Import an existing NetworkAcl into this app.
   */
  public static fromNetworkAclId(
    scope: Construct,
    id: string,
    networkAclId: string,
  ): INetworkAcl {
    class Import extends NetworkAclBase {
      public readonly networkAclId = networkAclId;
    }

    return new Import(scope, id);
  }

  /**
   * The ID of the NetworkACL
   *
   * @attribute
   */
  public readonly networkAclId: string;

  /**
   * The VPC ID for this NetworkACL
   *
   * @attribute
   */
  public readonly networkAclVpcId: string;

  private readonly networkAcl: tfNetworkAcl.NetworkAcl;
  private readonly vpc: IVpc;

  constructor(scope: Construct, id: string, props: NetworkAclProps) {
    super(scope, id);

    this.vpc = props.vpc;

    Tags.of(this).add(NAME_TAG, props.networkAclName || this.node.path);

    this.networkAcl = new tfNetworkAcl.NetworkAcl(this, "Resource", {
      vpcId: props.vpc.vpcId,
    });

    this.networkAclId = this.networkAcl.id;
    this.networkAclVpcId = this.networkAcl.vpcId;

    if (props.subnetSelection !== undefined) {
      this.associateWithSubnet("DefaultAssociation", props.subnetSelection);
    }
  }

  /**
   * Associate the ACL with a given set of subnets
   */
  public associateWithSubnet(id: string, selection: SubnetSelection) {
    const subnets = this.vpc.selectSubnets(selection);
    for (const subnet of subnets.subnets) {
      subnet.associateNetworkAcl(id, this);
    }
  }
}

/**
 * What action to apply to traffic matching the ACL
 *
 *
 */
export enum Action {
  /**
   * Allow the traffic
   */
  ALLOW = "allow",

  /**
   * Deny the traffic
   */
  DENY = "deny",
}

export interface NetworkAclEntryOutputs {
  /**
   * The ID of the NetworkACL
   */
  readonly networkAclId: string;
}

/**
 * A NetworkAclEntry
 *
 *
 */
export interface INetworkAclEntry extends IAwsConstruct {
  readonly networkAclEntryOutputs: NetworkAclEntryOutputs;
  /**
   * The network ACL.
   */
  readonly networkAcl: INetworkAcl;
}

/**
 * Base class for NetworkAclEntries
 *
 *
 */
abstract class NetworkAclEntryBase
  extends AwsConstructBase
  implements INetworkAclEntry
{
  public get networkAclEntryOutputs(): NetworkAclEntryOutputs {
    return {
      networkAclId: this.networkAcl.networkAclId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.networkAclEntryOutputs;
  }
  public abstract readonly networkAcl: INetworkAcl;
}

/**
 * Direction of traffic the AclEntry applies to
 *
 *
 */
export enum TrafficDirection {
  /**
   * Traffic leaving the subnet
   */
  EGRESS,

  /**
   * Traffic entering the subnet
   */
  INGRESS,
}

/**
 * Basic NetworkACL entry props
 *
 *
 */
export interface CommonNetworkAclEntryOptions {
  // /**
  //  * The name of the NetworkAclEntry.
  //  *
  //  * It is not recommended to use an explicit group name.
  //  *
  //  * @default If you don't specify a NetworkAclName, AWS CloudFormation generates a
  //  * unique physical ID and uses that ID for the group name.
  //  */
  // readonly networkAclEntryName?: string;

  /**
   * The CIDR range to allow or deny.
   */
  readonly cidr: AclCidr;

  /**
   * What kind of traffic this ACL rule applies to
   */
  readonly traffic: AclTraffic;

  /**
   * Traffic direction, with respect to the subnet, this rule applies to
   *
   * @default TrafficDirection.INGRESS
   */
  readonly direction?: TrafficDirection;

  /**
   * Whether to allow or deny traffic that matches the rule; valid values are "allow" or "deny".
   *
   * Any traffic that is not explicitly allowed is automatically denied in a custom
   * ACL, all traffic is automatically allowed in a default ACL.
   *
   * @default ALLOW
   */
  readonly ruleAction?: Action;

  /**
   * Rule number to assign to the entry, such as 100. ACL entries are processed in ascending order by rule number.
   * Entries can't use the same rule number unless one is an egress rule and the other is an ingress rule.
   */
  readonly ruleNumber: number;
}

/**
 * Properties to create NetworkAclEntry
 *
 *
 */
export interface NetworkAclEntryProps
  extends CommonNetworkAclEntryOptions,
    AwsConstructProps {
  /**
   * The network ACL this entry applies to.
   */
  readonly networkAcl: INetworkAcl;
}

/**
 * Define an entry in a Network ACL table
 *
 *
 */
export class NetworkAclEntry extends NetworkAclEntryBase {
  public readonly networkAcl: INetworkAcl;
  public resource: tfNetworkAclRule.NetworkAclRule;

  constructor(scope: Construct, id: string, props: NetworkAclEntryProps) {
    super(scope, id, props);
    // const networkAclEntryName =
    //   props.networkAclEntryName ||
    //   this.stack.uniqueResourceName(this, {
    //     prefix: this.gridUUID,
    //   });

    this.networkAcl = props.networkAcl;

    this.resource = new tfNetworkAclRule.NetworkAclRule(this, "Resource", {
      networkAclId: this.networkAcl.networkAclId,
      ruleNumber: props.ruleNumber,
      ruleAction: props.ruleAction ?? Action.ALLOW,
      egress:
        props.direction !== undefined
          ? props.direction === TrafficDirection.EGRESS
          : undefined,
      ...props.traffic.toTfTrafficConfig(),
      ...props.cidr.toCidrConfig(),
    });
  }
}

export interface SubnetNetworkAclAssociationOutputs {
  /**
   * The ID of the SubnetNetworkAclAssociation
   */
  readonly subnetNetworkAclAssociationAssociationId: string;
}

/**
 * A SubnetNetworkAclAssociation
 *
 *
 */
export interface ISubnetNetworkAclAssociation extends IAwsConstruct {
  readonly subnetNetworkAclAssociationOutputs: SubnetNetworkAclAssociationOutputs;
  /**
   * ID for the current SubnetNetworkAclAssociation
   * @attribute
   */
  readonly subnetNetworkAclAssociationAssociationId: string;
}

/**
 * Properties to create a SubnetNetworkAclAssociation
 *
 *
 */
export interface SubnetNetworkAclAssociationProps extends AwsConstructProps {
  // /**
  //  * The name of the SubnetNetworkAclAssociation.
  //  *
  //  * It is not recommended to use an explicit name.
  //  *
  //  * @default If you don't specify a SubnetNetworkAclAssociationName, AWS CloudFormation generates a
  //  * unique physical ID and uses that ID for the group name.
  //  */
  // readonly subnetNetworkAclAssociationName?: string;

  /**
   * The Network ACL this association is defined for
   *
   * @attribute
   */
  readonly networkAcl: INetworkAcl;

  /**
   * ID of the Subnet
   * @attribute
   */
  readonly subnet: ISubnet;
}

/**
 * Associate a network ACL with a subnet
 *
 *
 */
abstract class SubnetNetworkAclAssociationBase
  extends AwsConstructBase
  implements ISubnetNetworkAclAssociation
{
  public get subnetNetworkAclAssociationOutputs(): SubnetNetworkAclAssociationOutputs {
    return {
      subnetNetworkAclAssociationAssociationId:
        this.subnetNetworkAclAssociationAssociationId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.subnetNetworkAclAssociationOutputs;
  }
  public abstract readonly subnetNetworkAclAssociationAssociationId: string;
}
export class SubnetNetworkAclAssociation extends SubnetNetworkAclAssociationBase {
  public static fromSubnetNetworkAclAssociationAssociationId(
    scope: Construct,
    id: string,
    subnetNetworkAclAssociationAssociationId: string,
  ): ISubnetNetworkAclAssociation {
    class Import extends SubnetNetworkAclAssociationBase {
      public readonly subnetNetworkAclAssociationAssociationId =
        subnetNetworkAclAssociationAssociationId;
    }

    return new Import(scope, id);
  }
  /**
   * ID for the current SubnetNetworkAclAssociation
   * @attribute
   */
  public readonly subnetNetworkAclAssociationAssociationId: string;

  /**
   * ID for the current Network ACL
   * @attribute
   */
  public readonly networkAcl: INetworkAcl;

  /**
   * ID of the Subnet
   * @attribute
   */
  public readonly subnet: ISubnet;

  private association: tfNetworkAclAssociation.NetworkAclAssociation;

  constructor(
    scope: Construct,
    id: string,
    props: SubnetNetworkAclAssociationProps,
  ) {
    super(scope, id, props);
    // const subnetNetworkAclAssociationName =
    //   props.subnetNetworkAclAssociationName ||
    //   this.stack.uniqueResourceName(this, {
    //     prefix: this.gridUUID,
    //   });

    this.association = new tfNetworkAclAssociation.NetworkAclAssociation(
      this,
      "Resource",
      {
        networkAclId: props.networkAcl.networkAclId,
        subnetId: props.subnet.subnetId,
      },
    );

    this.networkAcl = props.networkAcl;
    this.subnet = props.subnet;
    this.subnetNetworkAclAssociationAssociationId = this.association.id;
  }
}
