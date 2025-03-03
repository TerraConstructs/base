import {
  vpc,
  subnet,
  natGateway,
  eip,
  dataAwsEip,
  routeTable,
  routeTableAssociation,
} from "@cdktf/provider-aws";
import { Construct } from "constructs";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../aws-construct";

export enum SubnetType {
  PUBLIC = "PUBLIC",
  PRIVATE = "PRIVATE",
  DATA = "DATA",
}

export interface BaseSubnetProps extends AwsConstructProps {
  /**
   * The VPC to create the subnet into
   */
  readonly vpc: vpc.Vpc;
  /**
   * The IPv4 CIDR block for the subnet.
   */
  readonly ipv4CidrBlock: string;
  /**
   * The availability zone for the subnet.
   */
  readonly availabilityZone: string;
  /**
   * Additional tags for the subnet.
   *
   * @default - No additional tags
   */
  readonly tags?: Record<string, string>;
}

export interface ISubnet extends IAwsConstruct {
  /**
   * The VPC ID of the subnet.
   */
  readonly vpcId: string;
  /**
   * The IPv4 CIDR block for the subnet.
   */
  readonly ipv4CidrBlock: string;
  /**
   * The availability zone for the subnet.
   */
  readonly availabilityZone: string;
  /**
   * The subnet ID of the subnet.
   */
  readonly subnetId: string;
}

export abstract class BaseSubnet extends AwsConstructBase implements ISubnet {
  private readonly type: SubnetType;
  private readonly _availabilityZone: string;
  public get availabilityZone(): string {
    return this._availabilityZone;
  }
  private readonly _subnetId: string;
  public get subnetId(): string {
    return this._subnetId;
  }
  protected readonly vpc: vpc.Vpc;
  public get vpcId(): string {
    return this.vpc.id;
  }
  protected readonly cidr: string;
  public get ipv4CidrBlock(): string {
    return this.cidr;
  }

  public get outputs(): Record<string, any> {
    return {
      subnetId: this.subnetId,
      availabilityZone: this.availabilityZone,
      ipv4CidrBlock: this.ipv4CidrBlock,
    };
  }

  public readonly resource: subnet.Subnet;
  constructor(
    scope: Construct,
    id: string,
    type: SubnetType,
    props: BaseSubnetProps,
  ) {
    super(scope, id, props);
    this.vpc = props.vpc;
    this.cidr = props.ipv4CidrBlock;
    this._availabilityZone = props.availabilityZone;
    this.type = type;
    this.resource = new subnet.Subnet(this, "Resource", {
      vpcId: this.vpc.id,
      cidrBlock: this.cidr,
      availabilityZone: this._availabilityZone,
      mapPublicIpOnLaunch: this.type === SubnetType.PUBLIC,
      tags: props.tags,
    });
    this._subnetId = this.resource.id;
  }
}

export interface PublicSubnetProps extends BaseSubnetProps {
  /**
   * Whether to create a NAT gateway in the subnet.
   */
  readonly createNatGateway?: boolean;
  /**
   * The EIP allocation ID to use for the NAT gateway.
   *
   * @default - A new EIP is created
   */
  readonly eipAllocationId?: string;
  /**
   * The Route Table ID to associate with the subnet.
   */
  readonly defaultRouteTableId: string;
}

export class PublicSubnet extends BaseSubnet {
  private readonly natGateway?: natGateway.NatGateway;
  private readonly eip?: eip.Eip | dataAwsEip.DataAwsEip;

  constructor(scope: Construct, id: string, props: PublicSubnetProps) {
    super(scope, id, SubnetType.PUBLIC, props);

    if (props.createNatGateway) {
      if (props.eipAllocationId && props.eipAllocationId.length > 0) {
        this.eip = new dataAwsEip.DataAwsEip(this, "Eip", {
          id: props.eipAllocationId,
        });
      } else {
        const name = props.tags?.Name ?? this.friendlyName;
        this.eip = new eip.Eip(this, "Eip", {
          domain: "vpc",
          tags: {
            Name: `${name}-nat-gateway`,
          },
        });
      }

      this.natGateway = new natGateway.NatGateway(this, "NatGateway", {
        allocationId: this.eip.id,
        subnetId: this.subnetId,
        tags: {
          Name: `${props.tags?.Name ?? this.friendlyName}-nat-gateway`,
        },
      });
    }
  }
  public get natgateway(): natGateway.NatGateway | undefined {
    return this.natGateway;
  }
}

export interface PrivateSubnetProps extends BaseSubnetProps {
  readonly routeTable: routeTable.RouteTable;
}

export class PrivateSubnet extends BaseSubnet {
  private readonly routeTable: routeTable.RouteTable;

  constructor(scope: Construct, id: string, props: PrivateSubnetProps) {
    super(scope, id, SubnetType.PRIVATE, {
      ...props,
    });
    this.routeTable = props.routeTable;
    new routeTableAssociation.RouteTableAssociation(
      this,
      "RouteTableAssociation",
      {
        routeTableId: props.routeTable.id,
        subnetId: this.subnetId,
      },
    );
  }
  public get routeTableId(): string {
    return this.routeTable.id;
  }
}

export class DataSubnet extends BaseSubnet {
  private readonly routeTable: routeTable.RouteTable;

  constructor(scope: Construct, id: string, props: PrivateSubnetProps) {
    super(scope, id, SubnetType.DATA, {
      ...props,
    });
    this.routeTable = props.routeTable;
    new routeTableAssociation.RouteTableAssociation(
      this,
      "RouteTableAssociation",
      {
        routeTableId: props.routeTable.id,
        subnetId: this.subnetId,
      },
    );
  }
  public get routeTableId(): string {
    return this.routeTable.id;
  }
}
