import {
  vpc,
  natGateway,
  routeTable,
  internetGateway,
  defaultRouteTable,
  serviceDiscoveryPrivateDnsNamespace,
} from "@cdktf/provider-aws";
import { Fn, Lazy } from "cdktf";
import { Construct } from "constructs";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { INetwork, NetworkOutputs } from "./network";
import { PublicSubnet, PrivateSubnet, DataSubnet, ISubnet } from "./subnet";
import {
  ISubnetGroup,
  DbSubnetGroup,
  ElastiCacheSubnetGroup,
} from "./subnet-group";

export enum NatGatewayOption {
  SINGLE_NAT_GATEWAY = "single-nat-gateway",
  NAT_PER_AVAILABILITY_ZONE = "nat-per-availability-zone",
}

export interface SimpleIPv4Props extends AwsConstructProps {
  /**
   * The number of availability zones to use.
   *
   * @default 2
   */
  readonly azCount?: number;
  /**
   * The IPv4 CIDR block for the VPC.
   */
  readonly ipv4CidrBlock: string;
  /**
   * The NAT Gateway set up.
   *
   * @default NatGatewayOption.NAT_PER_AVAILABILITY_ZONE
   */
  readonly natGatewayOption?: NatGatewayOption;
  /**
   * Provisions a Service Discovery Private DNS Namespace resource.
   */
  readonly internalDomain: string;
}

/**
 * Define an AWS Virtual Private Cloud simple IPv4 network.
 *
 * See the package-level documentation of this package for an overview
 * of the various dimensions in which you can configure your VPC.
 *
 * For example:
 *
 * ```ts
 * const network = new network.SimpleIPv4(awsStack, "network", {
 *  ipv4CidrBlock: "10.0.0.0/16",
 *  internalDomain: "example.local",
 * });
 *
 * // Add a subnet group for RDS
 * network.enableDbSubnetGroup();
 * ```
 *
 * @resource aws_vpc
 * @beacon-class network.SimpleIPv4Vpc
 * @deprecated use compute/vpc instead
 */
export class SimpleIPv4Vpc extends AwsConstructBase implements INetwork {
  private readonly _props: SimpleIPv4Props;
  private readonly _outputs: NetworkOutputs;
  public get networkOutputs(): NetworkOutputs {
    return this._outputs;
  }
  public get outputs(): Record<string, any> {
    return this._outputs;
  }
  private readonly ipv4CidrBlock: string;
  private readonly natGatewayOption: NatGatewayOption;
  private readonly natGateways: natGateway.NatGateway[] = [];
  private readonly privateRouteTables: routeTable.RouteTable[] = [];
  private readonly azCount: number;
  private readonly availabilityZones: string[];
  private readonly vpc: vpc.Vpc;
  public get vpcId(): string {
    return this.vpc.id;
  }
  private readonly _publicSubnets: PublicSubnet[] = [];
  public get publicSubnets(): ISubnet[] {
    return this._publicSubnets;
  }
  private readonly _privateSubnets: PrivateSubnet[] = [];
  public get privateSubnets(): ISubnet[] {
    return this._privateSubnets;
  }
  private readonly _dataSubnets: DataSubnet[] = [];
  public get dataSubnets(): ISubnet[] {
    return this._dataSubnets;
  }

  private _dbSubnetGroup?: ISubnetGroup;
  public get dbSubnetGroup(): ISubnetGroup | undefined {
    return this._dbSubnetGroup;
  }

  private _elastiCacheSubnetGroup?: ISubnetGroup;
  public get elastiCacheSubnetGroup(): ISubnetGroup | undefined {
    return this._elastiCacheSubnetGroup;
  }

  private readonly serviceDiscoveryNamespace: serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace;
  public get serviceDiscoveryNamespaceArn(): string {
    return this.serviceDiscoveryNamespace.arn;
  }

  constructor(scope: Construct, id: string, props: SimpleIPv4Props) {
    super(scope, id, props);
    this._props = props;
    this.azCount = this._props.azCount ?? 2;
    if (this.azCount > 4) {
      throw new Error("azCount must be less than or equal to 4");
    }

    this.availabilityZones = this.stack.availabilityZones(this.azCount);
    this.ipv4CidrBlock = this._props.ipv4CidrBlock;
    this.vpc = new vpc.Vpc(this, "Resource", {
      cidrBlock: this.ipv4CidrBlock,
      enableDnsSupport: true,
      enableDnsHostnames: true,
    });

    const igw = new internetGateway.InternetGateway(this, "igw", {
      vpcId: this.vpc.id,
      tags: {
        Name: `${this.friendlyName}-igw`,
      },
    });

    // adopt default route table and add tags
    new defaultRouteTable.DefaultRouteTable(this, "DefaultRouteTable", {
      defaultRouteTableId: this.vpc.defaultRouteTableId,
      tags: {
        Name: `${this.friendlyName}-default-route-table`,
      },
      route: [
        {
          cidrBlock: "0.0.0.0/0",
          gatewayId: igw.id,
        },
      ],
    });

    this.natGatewayOption =
      this._props.natGatewayOption ??
      NatGatewayOption.NAT_PER_AVAILABILITY_ZONE;

    this.createPublicSubnets(Fn.cidrsubnet(this.ipv4CidrBlock, 2, 0));
    this.createPrivateSubnets(Fn.cidrsubnet(this.ipv4CidrBlock, 2, 1));
    this.createDataSubnets(Fn.cidrsubnet(this.ipv4CidrBlock, 2, 2));

    this.serviceDiscoveryNamespace =
      new serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace(
        this,
        "ServiceDiscoveryNamespace",
        {
          name: this._props.internalDomain,
          vpc: this.vpc.id,
          description: `Private DNS namespace for ${this.friendlyName}`,
          tags: {
            Name: `${this.friendlyName}-service-discovery-namespace`,
          },
        },
      );

    this._outputs = {
      vpcId: this.vpc.id,
      publicSubnetIds: this.publicSubnets.map((subnet) => subnet.subnetId),
      privateSubnetIds: this.privateSubnets.map((subnet) => subnet.subnetId),
      dataSubnetIds: this.dataSubnets.map((subnet) => subnet.subnetId),
      // only known at synth time
      // explicit `null` required to avoid syntax errors when using stringValue && "undefined"
      dbSubnetGroup: Lazy.anyValue({
        produce: () => this.dbSubnetGroup?.gridUUID ?? null,
      }),
      elastiCacheSubnetGroup: Lazy.anyValue({
        produce: () => this.elastiCacheSubnetGroup?.gridUUID ?? null,
      }),
      serviceDiscoveryNamespaceName: this.serviceDiscoveryNamespace.name,
    };
  }

  public enableDbSubnetGroup(): void {
    if (this._dbSubnetGroup) {
      return;
    }
    this._dbSubnetGroup = new DbSubnetGroup(this, "DbSubnetGroup", {
      subnets: this._dataSubnets,
      tags: {
        Name: `${this.friendlyName}-db-default-subnet-group`,
      },
    });
  }

  public enableElastiCacheSubnetGroup(): void {
    if (this._elastiCacheSubnetGroup) {
      return;
    }
    this._elastiCacheSubnetGroup = new ElastiCacheSubnetGroup(
      this,
      "ElastiCacheSubnetGroup",
      {
        subnets: this._dataSubnets,
        tags: {
          Name: `${this.friendlyName}-elasticache-default-subnet-group`,
        },
      },
    );
  }

  private createPublicSubnets(publicIpv4CidrBlock: string) {
    for (let i = 0; i < this.azCount; i++) {
      // if SingleNatGateway, only create NAT Gateway for first public subnet
      const createNatGateway =
        this.natGatewayOption !== NatGatewayOption.SINGLE_NAT_GATEWAY ||
        i === 0;
      const availabilityZone = this.availabilityZones[i];
      const publicSubnet = new PublicSubnet(this, `PublicSubnet${i}`, {
        vpc: this.vpc,
        availabilityZone,
        ipv4CidrBlock: Fn.cidrsubnet(publicIpv4CidrBlock, 2, i),
        defaultRouteTableId: this.vpc.defaultRouteTableId,
        tags: {
          Name: `${this.friendlyName}-public-subnet-${availabilityZone}`,
        },
        createNatGateway,
      });

      if (createNatGateway) {
        const gw = publicSubnet.natgateway!;
        // create route table per NAT gateway
        this.privateRouteTables.push(
          new routeTable.RouteTable(this, `PrivateRouteTable${i}`, {
            vpcId: this.vpc.id,
            route: [
              {
                cidrBlock: "0.0.0.0/0",
                natGatewayId: gw.id,
              },
            ],
            tags: {
              Name: `${this.friendlyName}-private-route-table-${availabilityZone}`,
              "aws-cdk:subnet-name": "Public",
              "aws-cdk:subnet-type": "Public",
              "kubernetes.io/role/elb": "1",
            },
          }),
        );
        this.natGateways.push(gw);
      }
      this._publicSubnets.push(publicSubnet);
    }
  }

  private createPrivateSubnets(privateIpv4CidrBlock: string) {
    for (let i = 0; i < this.azCount; i++) {
      const availabilityZone = this.availabilityZones[i];
      const rtbIdx = this.privateRouteTables.length >= this.azCount ? i : 0;
      const privateSubnet = new PrivateSubnet(this, `PrivateSubnet${i}`, {
        vpc: this.vpc,
        availabilityZone,
        ipv4CidrBlock: Fn.cidrsubnet(privateIpv4CidrBlock, 2, i),
        routeTable: this.privateRouteTables[rtbIdx],
        tags: {
          Name: `${this.friendlyName}-private-subnet-${availabilityZone}`,
          "aws-cdk:subnet-name": "Private",
          "aws-cdk:subnet-type": "Private",
          "kubernetes.io/role/internal-elb": "1",
        },
      });
      this._privateSubnets.push(privateSubnet);
    }
  }

  private createDataSubnets(dataIpv4CidrBlock: string) {
    for (let i = 0; i < this.azCount; i++) {
      const availabilityZone = this.availabilityZones[i];
      const rtbIdx = this.privateRouteTables.length >= this.azCount ? i : 0;
      const dataSubnet = new DataSubnet(this, `DataSubnet${i}`, {
        vpc: this.vpc,
        availabilityZone,
        ipv4CidrBlock: Fn.cidrsubnet(dataIpv4CidrBlock, 2, i),
        routeTable: this.privateRouteTables[rtbIdx],
        tags: {
          Name: `${this.friendlyName}-data-subnet-${availabilityZone}`,
          "aws-cdk:subnet-name": "Data",
          "aws-cdk:subnet-type": "Isolated",
        },
      });
      this._dataSubnets.push(dataSubnet);
    }
  }
}
