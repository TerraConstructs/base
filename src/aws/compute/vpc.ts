// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/vpc.ts

import {
  eip,
  egressOnlyInternetGateway,
  internetGateway,
  natGateway,
  route,
  routeTable,
  subnet,
  routeTableAssociation,
  vpc,
  // vpcIpv4CidrBlockAssociation,
  vpcIpv6CidrBlockAssociation,
  internetGatewayAttachment,
  vpnGatewayAttachment,
  vpnGatewayRoutePropagation,
  dataAwsSubnet,
} from "@cdktf/provider-aws";
import {
  // ContextProvider,
  // CustomResource,
  // FeatureFlags,
  Annotations,
  Lazy,
  Token,
} from "cdktf";
// import { RestrictDefaultSgProvider } from "../../custom-resource-handlers/dist/aws-ec2/restrict-default-sg-provider.generated";
import {
  Construct,
  Dependable,
  DependencyGroup,
  IConstruct,
  IDependable,
  Node,
} from "constructs";
import {
  ClientVpnEndpoint,
  ClientVpnEndpointOptions,
} from "./client-vpn-endpoint";
import {
  allRouteTableIds,
  defaultSubnetName,
  flatten,
  ImportSubnetGroup,
  subnetGroupNameFromConstructId,
  subnetId,
} from "./ec2-util";
import {
  AllocatedSubnet,
  IIpAddresses,
  RequestedSubnet,
  IpAddresses,
  IIpv6Addresses,
  Ipv6Addresses,
} from "./ip-addresses";
import { NatProvider } from "./nat";
import {
  INetworkAcl,
  // NetworkAcl,
  SubnetNetworkAclAssociation,
} from "./network-acl";
import { SubnetFilter } from "./subnet";
import {
  GatewayVpcEndpoint,
  GatewayVpcEndpointAwsService,
  GatewayVpcEndpointOptions,
  InterfaceVpcEndpoint,
  InterfaceVpcEndpointOptions,
} from "./vpc-endpoint";
import { FlowLog, FlowLogOptions, FlowLogResourceType } from "./vpc-flow-logs";
// import { VpcLookupOptions } from "./vpc-lookup";
import {
  EnableVpnGatewayOptions,
  VpnConnection,
  VpnConnectionOptions,
  VpnConnectionType,
  VpnGateway,
} from "./vpn";
import { Arn } from "../arn";
import { AwsConstructBase, IAwsConstruct } from "../aws-construct";
import { AwsStack } from "../aws-stack";
// TODO: Use TagManager and tag-aspect instead
import { Tags } from "../aws-tags";
// import { Tags } from "../tag-aspect";

const VPC_SUBNET_SYMBOL = Symbol.for(
  "terraconstructs/lib/aws/compute.VpcSubnet",
);
const FAKE_AZ_NAME = "fake-az";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface SubnetOutputs {
  /**
   * The subnetId for this particular subnet
   * @attribute
   */
  readonly subnetId: string;
  /**
   * The IPv4 CIDR block for this subnet
   */
  readonly ipv4CidrBlock: string;
  /**
   * The route table for this subnet
   * @attribute
   */
  readonly routeTableId: string;
}

export interface ISubnet extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly subnetOutputs: SubnetOutputs;

  /**
   * The Availability Zone the subnet is located in
   */
  readonly availabilityZone: string;

  /**
   * The subnetId for this particular subnet
   * @attribute
   */
  readonly subnetId: string;

  /**
   * Dependable that can be depended upon to force internet connectivity established on the VPC
   */
  readonly internetConnectivityEstablished: IDependable;

  /**
   * The IPv4 CIDR block for this subnet
   */
  readonly ipv4CidrBlock: string;

  /**
   * The route table for this subnet
   */
  readonly routeTable: IRouteTable;

  /**
   * Associate a Network ACL with this subnet
   *
   * @param acl The Network ACL to associate
   */
  associateNetworkAcl(id: string, acl: INetworkAcl): void;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface RouteTableOutputs {
  /**
   * The route table ID
   * @attribute
   */
  readonly routeTableId: string;
}

/**
 * An abstract route table
 */
export interface IRouteTable {
  /**
   * Route table ID
   */
  readonly routeTableId: string;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface VpcOutputs {
  /**
   * Identifier for this VPC
   * @attribute
   */
  readonly vpcId: string;

  /**
   * ARN for this VPC
   * @attribute
   */
  readonly vpcArn: string;

  /**
   * CIDR range for this VPC
   *
   * @attribute
   */
  readonly vpcCidrBlock: string;

  /**
   * List of public subnets in this VPC
   *
   * @attribute
   */
  readonly publicSubnetIds: string[];

  /**
   * List of private subnets in this VPC
   *
   * @attribute
   */
  readonly privateSubnetIds: string[];

  /**
   * List of isolated subnets in this VPC
   *
   * @attribute
   */
  readonly isolatedSubnetIds: string[];

  /**
   * AZs for this VPC
   *
   * @attribute
   */
  readonly availabilityZones: string[];

  /**
   * Identifier for the VPN gateway
   *
   * @attribute
   */
  readonly vpnGatewayId?: string;
}

export interface IVpc extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly vpcOutputs: VpcOutputs;

  /**
   * Identifier for this VPC
   * @attribute
   */
  readonly vpcId: string;

  /**
   * ARN for this VPC
   * @attribute
   */
  readonly vpcArn: string;

  /**
   * CIDR range for this VPC
   *
   * @attribute
   */
  readonly vpcCidrBlock: string;

  /**
   * List of public subnets in this VPC
   */
  readonly publicSubnets: ISubnet[];

  /**
   * List of private subnets in this VPC
   */
  readonly privateSubnets: ISubnet[];

  /**
   * List of isolated subnets in this VPC
   */
  readonly isolatedSubnets: ISubnet[];

  /**
   * AZs for this VPC
   */
  readonly availabilityZones: string[];

  /**
   * Identifier for the VPN gateway
   */
  readonly vpnGatewayId?: string;

  /**
   * Dependable that can be depended upon to force internet connectivity established on the VPC
   */
  readonly internetConnectivityEstablished: IDependable;

  /**
   * Return information on the subnets appropriate for the given selection strategy
   *
   * Requires that at least one subnet is matched, throws a descriptive
   * error message otherwise.
   */
  selectSubnets(selection?: SubnetSelection): SelectedSubnets;

  /**
   * Adds a VPN Gateway to this VPC
   */
  enableVpnGateway(options: EnableVpnGatewayOptions): void;

  /**
   * Adds a new VPN connection to this VPC
   */
  addVpnConnection(id: string, options: VpnConnectionOptions): VpnConnection;

  /**
   * Adds a new client VPN endpoint to this VPC
   */
  addClientVpnEndpoint(
    id: string,
    options: ClientVpnEndpointOptions,
  ): ClientVpnEndpoint;

  /**
   * Adds a new gateway endpoint to this VPC
   */
  addGatewayEndpoint(
    id: string,
    options: GatewayVpcEndpointOptions,
  ): GatewayVpcEndpoint;

  /**
   * Adds a new interface endpoint to this VPC
   */
  addInterfaceEndpoint(
    id: string,
    options: InterfaceVpcEndpointOptions,
  ): InterfaceVpcEndpoint;

  /**
   * Adds a new Flow Log to this VPC
   */
  addFlowLog(id: string, options?: FlowLogOptions): FlowLog;
}

/**
 * The types of IP addresses provisioned in the VPC.
 */
export enum IpProtocol {
  /**
   * The vpc will be configured with only IPv4 addresses.
   *
   * This is the default protocol if unset.
   */
  IPV4_ONLY = "Ipv4_Only",

  /**
   * The vpc will have both IPv4 and IPv6 addresses.
   *
   * Unless specified, public IPv4 addresses will not be auto assigned,
   * an egress only internet gateway (EIGW) will be created and configured,
   * and NATs and internet gateways (IGW) will be configured with IPv6 addresses.
   */
  DUAL_STACK = "Dual_Stack",
}

/**
 * The type of Subnet
 */
export enum SubnetType {
  /**
   * Isolated Subnets do not route traffic to the Internet (in this VPC),
   * and as such, do not require NAT gateways.
   *
   * Isolated subnets can only connect to or be connected to from other
   * instances in the same VPC. A default VPC configuration will not include
   * isolated subnets.
   *
   * This can be good for subnets with RDS or Elasticache instances,
   * or which route Internet traffic through a peer VPC.
   */
  PRIVATE_ISOLATED = "Isolated",

  /**
   * Isolated Subnets do not route traffic to the Internet (in this VPC),
   * and as such, do not require NAT gateways.
   *
   * Isolated subnets can only connect to or be connected to from other
   * instances in the same VPC. A default VPC configuration will not include
   * isolated subnets.
   *
   * This can be good for subnets with RDS or Elasticache instances,
   * or which route Internet traffic through a peer VPC.
   *
   * @deprecated use `SubnetType.PRIVATE_ISOLATED`
   */
  ISOLATED = "Deprecated_Isolated",

  /**
   * Subnet that routes to the internet, but not vice versa.
   *
   * Instances in a private subnet can connect to the Internet, but will not
   * allow connections to be initiated from the Internet. Egress to the internet will
   * need to be provided.
   * NAT Gateway(s) are the default solution to providing this subnet type the ability to route Internet traffic.
   * If a NAT Gateway is not required or desired, set `natGateways:0` or use
   * `SubnetType.PRIVATE_ISOLATED` instead.
   *
   * By default, a NAT gateway is created in every public subnet for maximum availability.
   * Be aware that you will be charged for NAT gateways.
   *
   * Normally a Private subnet will use a NAT gateway in the same AZ, but
   * if `natGateways` is used to reduce the number of NAT gateways, a NAT
   * gateway from another AZ will be used instead.
   */
  PRIVATE_WITH_EGRESS = "Private",

  /**
   * Subnet that routes to the internet (via a NAT gateway), but not vice versa.
   *
   * Instances in a private subnet can connect to the Internet, but will not
   * allow connections to be initiated from the Internet. NAT Gateway(s) are
   * required with this subnet type to route the Internet traffic through.
   * If a NAT Gateway is not required or desired, use `SubnetType.PRIVATE_ISOLATED` instead.
   *
   * By default, a NAT gateway is created in every public subnet for maximum availability.
   * Be aware that you will be charged for NAT gateways.
   *
   * Normally a Private subnet will use a NAT gateway in the same AZ, but
   * if `natGateways` is used to reduce the number of NAT gateways, a NAT
   * gateway from another AZ will be used instead.
   * @deprecated use `PRIVATE_WITH_EGRESS`
   */
  PRIVATE_WITH_NAT = "Deprecated_Private_NAT",

  /**
   * Subnet that routes to the internet, but not vice versa.
   *
   * Instances in a private subnet can connect to the Internet, but will not
   * allow connections to be initiated from the Internet. NAT Gateway(s) are
   * required with this subnet type to route the Internet traffic through.
   * If a NAT Gateway is not required or desired, use `SubnetType.PRIVATE_ISOLATED` instead.
   *
   * By default, a NAT gateway is created in every public subnet for maximum availability.
   * Be aware that you will be charged for NAT gateways.
   *
   * Normally a Private subnet will use a NAT gateway in the same AZ, but
   * if `natGateways` is used to reduce the number of NAT gateways, a NAT
   * gateway from another AZ will be used instead.
   *
   * @deprecated use `PRIVATE_WITH_EGRESS`
   */
  PRIVATE = "Deprecated_Private",

  /**
   * Subnet connected to the Internet
   *
   * Instances in a Public subnet can connect to the Internet and can be
   * connected to from the Internet as long as they are launched with public
   * IPs (controlled on the AutoScalingGroup or other constructs that launch
   * instances).
   *
   * Public subnets route outbound traffic via an Internet Gateway.
   */
  PUBLIC = "Public",
}

/**
 * Customize subnets that are selected for placement of ENIs
 *
 * Constructs that allow customization of VPC placement use parameters of this
 * type to provide placement settings.
 *
 * By default, the instances are placed in the private subnets.
 */
export interface SubnetSelection {
  /**
   * Select all subnets of the given type
   *
   * At most one of `subnetType` and `subnetGroupName` can be supplied.
   *
   * @default SubnetType.PRIVATE_WITH_EGRESS (or ISOLATED or PUBLIC if there are no PRIVATE_WITH_EGRESS subnets)
   */
  readonly subnetType?: SubnetType;

  /**
   * Select subnets only in the given AZs.
   *
   * @default no filtering on AZs is done
   */
  readonly availabilityZones?: string[];

  /**
   * Select the subnet group with the given name
   *
   * Select the subnet group with the given name. This only needs
   * to be used if you have multiple subnet groups of the same type
   * and you need to distinguish between them. Otherwise, prefer
   * `subnetType`.
   *
   * This field does not select individual subnets, it selects all subnets that
   * share the given subnet group name. This is the name supplied in
   * `subnetConfiguration`.
   *
   * At most one of `subnetType` and `subnetGroupName` can be supplied.
   *
   * @default - Selection by type instead of by name
   */
  readonly subnetGroupName?: string;

  /**
   * Alias for `subnetGroupName`
   *
   * Select the subnet group with the given name. This only needs
   * to be used if you have multiple subnet groups of the same type
   * and you need to distinguish between them.
   *
   * @deprecated Use `subnetGroupName` instead
   */
  readonly subnetName?: string;

  /**
   * If true, return at most one subnet per AZ
   *
   * @default false
   */
  readonly onePerAz?: boolean;

  /**
   * List of provided subnet filters.
   *
   * @default - none
   */
  readonly subnetFilters?: SubnetFilter[];

  /**
   * Explicitly select individual subnets
   *
   * Use this if you don't want to automatically use all subnets in
   * a group, but have a need to control selection down to
   * individual subnets.
   *
   * Cannot be specified together with `subnetType` or `subnetGroupName`.
   *
   * @default - Use all subnets in a selected group (all private subnets by default)
   */
  readonly subnets?: ISubnet[];
}

/**
 * Result of selecting a subset of subnets from a VPC
 */
export interface SelectedSubnets {
  /**
   * The subnet IDs
   */
  readonly subnetIds: string[];

  /**
   * The respective AZs of each subnet
   */
  readonly availabilityZones: string[];

  /**
   * Dependency representing internet connectivity for these subnets
   */
  readonly internetConnectivityEstablished: IDependable;

  /**
   * Selected subnet objects
   */
  readonly subnets: ISubnet[];

  /**
   * Whether any of the given subnets are from the VPC's public subnets.
   */
  readonly hasPublic: boolean;

  /**
   * The subnet selection is not actually real yet
   *
   * If this value is true, don't validate anything about the subnets. The count
   * or identities are not known yet, and the validation will most likely fail
   * which will prevent a successful lookup.
   *
   * @default false
   */
  readonly isPendingLookup?: boolean;
}

/**
 * A new or imported VPC
 */
abstract class VpcBase extends AwsConstructBase implements IVpc {
  /**
   * Identifier for this VPC
   */
  public abstract readonly vpcId: string;

  /**
   * Arn of this VPC
   */
  public abstract readonly vpcArn: string;

  /**
   * CIDR range for this VPC
   */
  public abstract readonly vpcCidrBlock: string;

  /**
   * List of public subnets in this VPC
   */
  public abstract readonly publicSubnets: ISubnet[];

  /**
   * List of private subnets in this VPC
   */
  public abstract readonly privateSubnets: ISubnet[];

  /**
   * List of isolated subnets in this VPC
   */
  public abstract readonly isolatedSubnets: ISubnet[];

  /**
   * AZs for this VPC
   */
  public abstract readonly availabilityZones: string[];

  /**
   * Dependencies for internet connectivity
   */
  public abstract readonly internetConnectivityEstablished: IDependable;

  public get vpcOutputs(): VpcOutputs {
    return {
      availabilityZones: this.availabilityZones,
      isolatedSubnetIds: this.isolatedSubnets.map((s) => s.subnetId),
      privateSubnetIds: this.privateSubnets.map((s) => s.subnetId),
      publicSubnetIds: this.publicSubnets.map((s) => s.subnetId),
      vpcArn: this.vpcArn,
      vpcCidrBlock: this.vpcCidrBlock,
      vpcId: this.vpcId,
      vpnGatewayId: this.vpnGatewayId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.vpcOutputs;
  }
  /**
   * Dependencies for NAT connectivity
   *
   * @deprecated - This value is no longer used.
   */
  protected readonly natDependencies = new Array<IConstruct>();

  /**
   * If this is set to true, don't error out on trying to select subnets
   */
  protected incompleteSubnetDefinition: boolean = false;

  /**
   * Mutable private field for the vpnGatewayId
   *
   * @internal
   */
  protected _vpnGatewayId?: string;

  /**
   * Returns IDs of selected subnets
   */
  public selectSubnets(selection: SubnetSelection = {}): SelectedSubnets {
    const subnets = this.selectSubnetObjects(selection);
    const pubs = new Set(this.publicSubnets);

    return {
      subnetIds: subnets.map((s) => s.subnetId),
      get availabilityZones(): string[] {
        return subnets.map((s) => s.availabilityZone);
      },
      internetConnectivityEstablished: tap(new CompositeDependable(), (d) =>
        subnets.forEach((s) => d.add(s.internetConnectivityEstablished)),
      ),
      subnets,
      hasPublic: subnets.some((s) => pubs.has(s)),
      isPendingLookup: this.incompleteSubnetDefinition,
    };
  }

  /**
   * Adds a VPN Gateway to this VPC
   */
  public enableVpnGateway(options: EnableVpnGatewayOptions): void {
    if (this.vpnGatewayId) {
      throw new Error("The VPN Gateway has already been enabled.");
    }

    const vpnGateway = new VpnGateway(this, "VpnGateway", {
      amazonSideAsn: options.amazonSideAsn,
      type: VpnConnectionType.IPSEC_1,
    });

    this._vpnGatewayId = vpnGateway.gatewayId;

    const attachment = new vpnGatewayAttachment.VpnGatewayAttachment(
      this,
      "VPCVPNGW",
      {
        vpcId: this.vpcId,
        vpnGatewayId: this._vpnGatewayId,
      },
    );

    // Propagate routes on route tables associated with the right subnets
    const vpnRoutePropagation = options.vpnRoutePropagation ?? [{}];
    const routeTableIds = allRouteTableIds(
      flatten(vpnRoutePropagation.map((s) => this.selectSubnets(s).subnets)),
    );

    if (routeTableIds.length === 0) {
      Annotations.of(this).addError(
        `enableVpnGateway: no subnets matching selection: '${JSON.stringify(vpnRoutePropagation)}'. Select other subnets to add routes to.`,
      );
    }

    for (let i = 0; i < routeTableIds.length; i++) {
      const routePropagation =
        new vpnGatewayRoutePropagation.VpnGatewayRoutePropagation(
          this,
          `RoutePropagation${i}`,
          {
            routeTableId: routeTableIds[i],
            vpnGatewayId: this._vpnGatewayId,
          },
        );
      // The aws_vpn_gateway_route_propagation resource cannot use the VPN gateway
      // until it has successfully attached to the VPC.
      // See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-vpn-gatewayrouteprop.html
      routePropagation.node.addDependency(attachment);
    }
  }

  /**
   * Adds a new VPN connection to this VPC
   */
  public addVpnConnection(
    id: string,
    options: VpnConnectionOptions,
  ): VpnConnection {
    return new VpnConnection(this, id, {
      vpc: this,
      ...options,
    });
  }

  /**
   * Adds a new client VPN endpoint to this VPC
   */
  public addClientVpnEndpoint(
    id: string,
    options: ClientVpnEndpointOptions,
  ): ClientVpnEndpoint {
    return new ClientVpnEndpoint(this, id, {
      ...options,
      vpc: this,
    });
  }

  /**
   * Adds a new interface endpoint to this VPC
   */
  public addInterfaceEndpoint(
    id: string,
    options: InterfaceVpcEndpointOptions,
  ): InterfaceVpcEndpoint {
    return new InterfaceVpcEndpoint(this, id, {
      vpc: this,
      ...options,
    });
  }

  /**
   * Adds a new gateway endpoint to this VPC
   */
  public addGatewayEndpoint(
    id: string,
    options: GatewayVpcEndpointOptions,
  ): GatewayVpcEndpoint {
    return new GatewayVpcEndpoint(this, id, {
      vpc: this,
      ...options,
    });
  }

  /**
   * Adds a new flow log to this VPC
   */
  public addFlowLog(id: string, options?: FlowLogOptions): FlowLog {
    return new FlowLog(this, id, {
      resourceType: FlowLogResourceType.fromVpc(this),
      ...options,
    });
  }

  /**
   * Returns the id of the VPN Gateway (if enabled)
   */
  public get vpnGatewayId(): string | undefined {
    return this._vpnGatewayId;
  }

  /**
   * Return the subnets appropriate for the placement strategy
   */
  protected selectSubnetObjects(selection: SubnetSelection = {}): ISubnet[] {
    selection = this.reifySelectionDefaults(selection);

    if (selection.subnets !== undefined) {
      return selection.subnets;
    }

    let subnets;

    if (selection.subnetGroupName !== undefined) {
      // Select by name
      subnets = this.selectSubnetObjectsByName(selection.subnetGroupName);
    } else {
      // Or specify by type
      const type = selection.subnetType || SubnetType.PRIVATE_WITH_EGRESS;
      subnets = this.selectSubnetObjectsByType(type);
    }

    // Apply all the filters
    subnets = this.applySubnetFilters(subnets, selection.subnetFilters ?? []);

    return subnets;
  }

  private applySubnetFilters(
    subnets: ISubnet[],
    filters: SubnetFilter[],
  ): ISubnet[] {
    let filtered = subnets;
    // Apply each filter in sequence
    for (const filter of filters) {
      filtered = filter.selectSubnets(filtered);
    }
    return filtered;
  }

  private selectSubnetObjectsByName(groupName: string) {
    const allSubnets = [
      ...this.publicSubnets,
      ...this.privateSubnets,
      ...this.isolatedSubnets,
    ];
    const subnets = allSubnets.filter(
      (s) => subnetGroupNameFromConstructId(s) === groupName,
    );

    if (subnets.length === 0 && !this.incompleteSubnetDefinition) {
      const names = Array.from(
        new Set(allSubnets.map(subnetGroupNameFromConstructId)),
      );
      throw new Error(
        `There are no subnet groups with name '${groupName}' in this VPC. Available names: ${names}`,
      );
    }

    return subnets;
  }

  private selectSubnetObjectsByType(subnetType: SubnetType) {
    const allSubnets = {
      [SubnetType.PRIVATE_ISOLATED]: this.isolatedSubnets,
      [SubnetType.ISOLATED]: this.isolatedSubnets,
      [SubnetType.PRIVATE_WITH_NAT]: this.privateSubnets,
      [SubnetType.PRIVATE_WITH_EGRESS]: this.privateSubnets,
      [SubnetType.PRIVATE]: this.privateSubnets,
      [SubnetType.PUBLIC]: this.publicSubnets,
    };

    const subnets = allSubnets[subnetType];

    // Force merge conflict here with https://github.com/aws/aws-cdk/pull/4089
    // see ImportedVpc

    if (subnets.length === 0 && !this.incompleteSubnetDefinition) {
      const availableTypes = Object.entries(allSubnets)
        .filter(([_, subs]) => subs.length > 0)
        .map(([typeName, _]) => typeName);
      throw new Error(
        `There are no '${subnetType}' subnet groups in this VPC. Available types: ${availableTypes}`,
      );
    }

    return subnets;
  }

  /**
   * Validate the fields in a SubnetSelection object, and reify defaults if necessary
   *
   * In case of default selection, select the first type of PRIVATE, ISOLATED,
   * PUBLIC (in that order) that has any subnets.
   */
  private reifySelectionDefaults(placement: SubnetSelection): SubnetSelection {
    if (placement.subnetName !== undefined) {
      if (placement.subnetGroupName !== undefined) {
        throw new Error(
          "Please use only 'subnetGroupName' ('subnetName' is deprecated and has the same behavior)",
        );
      } else {
        // "@aws-cdk/aws-ec2:subnetNameDeprecated",
        Annotations.of(this).addWarning(
          "Usage of 'subnetName' in SubnetSelection is deprecated, use 'subnetGroupName' instead",
        );
      }
      placement = { ...placement, subnetGroupName: placement.subnetName };
    }

    const exclusiveSelections: Array<keyof SubnetSelection> = [
      "subnets",
      "subnetType",
      "subnetGroupName",
    ];
    const providedSelections = exclusiveSelections.filter(
      (key) => placement[key] !== undefined,
    );
    if (providedSelections.length > 1) {
      throw new Error(
        `Only one of '${providedSelections}' can be supplied to subnet selection.`,
      );
    }

    if (
      placement.subnetType === undefined &&
      placement.subnetGroupName === undefined &&
      placement.subnets === undefined
    ) {
      // Return default subnet type based on subnets that actually exist
      const subnetType = this.privateSubnets.length
        ? SubnetType.PRIVATE_WITH_EGRESS
        : this.isolatedSubnets.length
          ? SubnetType.PRIVATE_ISOLATED
          : SubnetType.PUBLIC;
      placement = { ...placement, subnetType: subnetType };
    }

    // Establish which subnet filters are going to be used
    const subnetFilters = placement.subnetFilters ?? [];

    // Backwards compatibility with existing `availabilityZones` and `onePerAz` functionality
    if (placement.availabilityZones !== undefined) {
      // Filter by AZs, if specified
      subnetFilters.push(
        SubnetFilter.availabilityZones(placement.availabilityZones),
      );
    }
    if (placement.onePerAz) {
      // Ensure one per AZ if specified
      subnetFilters.push(SubnetFilter.onePerAz());
    }

    // Overwrite the provided placement filters and remove the availabilityZones and onePerAz properties
    placement = {
      ...placement,
      subnetFilters: subnetFilters,
      availabilityZones: undefined,
      onePerAz: undefined,
    };
    const { availabilityZones, onePerAz, ...rest } = placement;

    return rest;
  }
}

/**
 * Properties that reference an external Vpc
 */
export interface VpcAttributes {
  /**
   * VPC's identifier
   */
  readonly vpcId: string;

  /**
   * VPC's CIDR range
   *
   * @default - Retrieving the CIDR from the VPC will fail
   */
  readonly vpcCidrBlock?: string;

  /**
   * List of availability zones for the subnets in this VPC.
   */
  readonly availabilityZones: string[];

  /**
   * List of public subnet IDs
   *
   * Must be undefined or match the availability zones in length and order.
   *
   * @default - The VPC does not have any public subnets
   */
  readonly publicSubnetIds?: string[];

  /**
   * List of names for the public subnets
   *
   * Must be undefined or have a name for every public subnet group.
   *
   * @default - All public subnets will have the name `Public`
   */
  readonly publicSubnetNames?: string[];

  /**
   * List of IDs of route tables for the public subnets.
   *
   * Must be undefined or have a name for every public subnet group.
   *
   * @default - Retrieving the route table ID of any public subnet will fail
   */
  readonly publicSubnetRouteTableIds?: string[];

  /**
   * List of IPv4 CIDR blocks for the public subnets.
   *
   * Must be undefined or have an entry for every public subnet group.
   *
   * @default - Retrieving the IPv4 CIDR block of any public subnet will fail
   */
  readonly publicSubnetIpv4CidrBlocks?: string[];

  /**
   * List of private subnet IDs
   *
   * Must be undefined or match the availability zones in length and order.
   *
   * @default - The VPC does not have any private subnets
   */
  readonly privateSubnetIds?: string[];

  /**
   * List of names for the private subnets
   *
   * Must be undefined or have a name for every private subnet group.
   *
   * @default - All private subnets will have the name `Private`
   */
  readonly privateSubnetNames?: string[];

  /**
   * List of IDs of route tables for the private subnets.
   *
   * Must be undefined or have a name for every private subnet group.
   *
   * @default - Retrieving the route table ID of any private subnet will fail
   */
  readonly privateSubnetRouteTableIds?: string[];

  /**
   * List of IPv4 CIDR blocks for the private subnets.
   *
   * Must be undefined or have an entry for every private subnet group.
   *
   * @default - Retrieving the IPv4 CIDR block of any private subnet will fail
   */
  readonly privateSubnetIpv4CidrBlocks?: string[];

  /**
   * List of isolated subnet IDs
   *
   * Must be undefined or match the availability zones in length and order.
   *
   * @default - The VPC does not have any isolated subnets
   */
  readonly isolatedSubnetIds?: string[];

  /**
   * List of names for the isolated subnets
   *
   * Must be undefined or have a name for every isolated subnet group.
   *
   * @default - All isolated subnets will have the name `Isolated`
   */
  readonly isolatedSubnetNames?: string[];

  /**
   * List of IDs of route tables for the isolated subnets.
   *
   * Must be undefined or have a name for every isolated subnet group.
   *
   * @default - Retrieving the route table ID of any isolated subnet will fail
   */
  readonly isolatedSubnetRouteTableIds?: string[];

  /**
   * List of IPv4 CIDR blocks for the isolated subnets.
   *
   * Must be undefined or have an entry for every isolated subnet group.
   *
   * @default - Retrieving the IPv4 CIDR block of any isolated subnet will fail
   */
  readonly isolatedSubnetIpv4CidrBlocks?: string[];

  /**
   * VPN gateway's identifier
   */
  readonly vpnGatewayId?: string;

  /**
   * The region the VPC is in
   *
   * @default - The region of the stack where the VPC belongs to
   */
  readonly region?: string;
}

export interface SubnetAttributes {
  /**
   * The Availability Zone the subnet is located in
   *
   * @default - No AZ information, cannot use AZ selection features
   */
  readonly availabilityZone?: string;

  /**
   * The IPv4 CIDR block associated with the subnet
   *
   * @default - No CIDR information, cannot use CIDR filter features
   */
  readonly ipv4CidrBlock?: string;

  /**
   * The ID of the route table for this particular subnet
   *
   * @default - No route table information, cannot create VPC endpoints
   */
  readonly routeTableId?: string;

  /**
   * The subnetId for this particular subnet
   */
  readonly subnetId: string;

  /**
   * Whether to register Terraform outputs for this TerraConstruct
   *
   * @default false
   */
  readonly registerOutputs?: boolean;

  /**
   * Optional override for the outputs name
   *
   * @default id
   */
  readonly outputName?: string;
}

/**
 * Name tag constant
 */
const NAME_TAG: string = "Name";

/**
 * Configuration for Vpc
 */
export interface VpcProps {
  /**
   * The protocol of the vpc.
   *
   * Options are IPv4 only or dual stack.
   *
   * @default IpProtocol.IPV4_ONLY
   */
  readonly ipProtocol?: IpProtocol;

  /**
   * The Provider to use to allocate IPv4 Space to your VPC.
   *
   * Options include static allocation or from a pool.
   *
   * Note this is specific to IPv4 addresses.
   *
   * @default compute.IpAddresses.cidr
   */
  readonly ipAddresses?: IIpAddresses;

  /**
   * The CIDR range to use for the VPC, e.g. '10.0.0.0/16'.
   *
   * Should be a minimum of /28 and maximum size of /16. The range will be
   * split across all subnets per Availability Zone.
   *
   * @default Vpc.DEFAULT_CIDR_RANGE
   *
   * @deprecated Use ipAddresses instead
   */
  readonly cidr?: string;

  /**
   * Indicates whether the instances launched in the VPC get public DNS hostnames.
   *
   * If this attribute is true, instances in the VPC get public DNS hostnames,
   * but only if the enableDnsSupport attribute is also set to true.
   *
   * @default true
   */
  readonly enableDnsHostnames?: boolean;

  /**
   * Indicates whether the DNS resolution is supported for the VPC.
   *
   * If this attribute is false, the Amazon-provided DNS server in the VPC that
   * resolves public DNS hostnames to IP addresses is not enabled. If this
   * attribute is true, queries to the Amazon provided DNS server at the
   * 169.254.169.253 IP address, or the reserved IP address at the base of the
   * VPC IPv4 network range plus two will succeed.
   *
   * @default true
   */
  readonly enableDnsSupport?: boolean;

  /**
   * The default tenancy of instances launched into the VPC.
   *
   * By setting this to dedicated tenancy, instances will be launched on
   * hardware dedicated to a single AWS customer, unless specifically specified
   * at instance launch time. Please note, not all instance types are usable
   * with Dedicated tenancy.
   *
   * @default DefaultInstanceTenancy.Default (shared) tenancy
   */
  readonly defaultInstanceTenancy?: DefaultInstanceTenancy;

  /**
   * Define the maximum number of AZs to use in this region
   *
   * If the region has more AZs than you want to use (for example, because of
   * EIP limits), pick a lower number here. The AZs will be sorted and picked
   * from the start of the list.
   *
   * If you pick a higher number than the number of AZs in the region, all AZs
   * in the region will be selected. To use "all AZs" available to your
   * account, use a high number (such as 99).
   *
   * Be aware that environment-agnostic stacks will be created with access to
   * only 2 AZs, so to use more than 2 AZs, be sure to specify the account and
   * region on your stack.
   *
   * Specify this option only if you do not specify `availabilityZones`.
   *
   * @default 3
   */
  readonly maxAzs?: number;

  /**
   * Define the number of AZs to reserve.
   *
   * When specified, the IP space is reserved for the azs but no actual
   * resources are provisioned.
   *
   * @default 0
   */
  readonly reservedAzs?: number;

  /**
   * Availability zones this VPC spans.
   *
   * Specify this option only if you do not specify `maxAzs`.
   *
   * @default - a subset of AZs of the stack
   */
  readonly availabilityZones?: string[];

  /**
   * The number of NAT Gateways/Instances to create.
   *
   * The type of NAT gateway or instance will be determined by the
   * `natGatewayProvider` parameter.
   *
   * You can set this number lower than the number of Availability Zones in your
   * VPC in order to save on NAT cost. Be aware you may be charged for
   * cross-AZ data traffic instead.
   *
   * @default - One NAT gateway/instance per Availability Zone
   */
  readonly natGateways?: number;

  /**
   * Configures the subnets which will have NAT Gateways/Instances
   *
   * You can pick a specific group of subnets by specifying the group name;
   * the picked subnets must be public subnets.
   *
   * Only necessary if you have more than one public subnet group.
   *
   * @default - All public subnets.
   */
  readonly natGatewaySubnets?: SubnetSelection;

  /**
   * What type of NAT provider to use
   *
   * Select between NAT gateways or NAT instances. NAT gateways
   * may not be available in all AWS regions.
   *
   * @default NatProvider.gateway()
   *
   */
  readonly natGatewayProvider?: NatProvider;

  /**
   * Configure the subnets to build for each AZ
   *
   * Each entry in this list configures a Subnet Group; each group will contain a
   * subnet for each Availability Zone.
   *
   * For example, if you want 1 public subnet, 1 private subnet, and 1 isolated
   * subnet in each AZ provide the following:
   *
   * ```ts
   * new compute.Vpc(this, 'VPC', {
   *   subnetConfiguration: [
   *      {
   *        cidrMask: 24,
   *        name: 'ingress',
   *        subnetType: compute.SubnetType.PUBLIC,
   *      },
   *      {
   *        cidrMask: 24,
   *        name: 'application',
   *        subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS,
   *      },
   *      {
   *        cidrMask: 28,
   *        name: 'rds',
   *        subnetType: compute.SubnetType.PRIVATE_ISOLATED,
   *      }
   *   ]
   * });
   * ```
   *
   * @default - The VPC CIDR will be evenly divided between 1 public and 1
   * private subnet per AZ.
   */
  readonly subnetConfiguration?: SubnetConfiguration[];

  /**
   * Indicates whether a VPN gateway should be created and attached to this VPC.
   *
   * @default - true when vpnGatewayAsn or vpnConnections is specified
   */
  readonly vpnGateway?: boolean;

  /**
   * The private Autonomous System Number (ASN) for the VPN gateway.
   *
   * @default - Amazon default ASN.
   */
  readonly vpnGatewayAsn?: number;

  /**
   * VPN connections to this VPC.
   *
   * @default - No connections.
   */
  readonly vpnConnections?: { [id: string]: VpnConnectionOptions };

  /**
   * Where to propagate VPN routes.
   *
   * @default - On the route tables associated with private subnets. If no
   * private subnets exists, isolated subnets are used. If no isolated subnets
   * exists, public subnets are used.
   */
  readonly vpnRoutePropagation?: SubnetSelection[];

  /**
   * Gateway endpoints to add to this VPC.
   *
   * @default - None.
   */
  readonly gatewayEndpoints?: { [id: string]: GatewayVpcEndpointOptions };

  /**
   * Flow logs to add to this VPC.
   *
   * @default - No flow logs.
   */
  readonly flowLogs?: { [id: string]: FlowLogOptions };

  /**
   * The VPC name.
   *
   * Since the VPC resource doesn't support providing a physical name, the value provided here will be recorded in the `Name` tag
   *
   * @default this.node.path
   */
  readonly vpcName?: string;

  // /**
  //  * If set to true then the default inbound & outbound rules will be removed
  //  * from the default security group
  //  *
  //  * @default true if '@aws-cdk/aws-ec2:restrictDefaultSecurityGroup' is enabled, false otherwise
  //  */
  // readonly restrictDefaultSecurityGroup?: boolean;

  /**
   * If set to false then disable the creation of the default internet gateway
   *
   * @default true
   */
  readonly createInternetGateway?: boolean;

  /**
   * The Provider to use to allocate IPv6 Space to your VPC.
   *
   * Options include amazon provided CIDR block.
   *
   * Note this is specific to IPv6 addresses.
   *
   * @default Ipv6Addresses.amazonProvided
   */
  readonly ipv6Addresses?: IIpv6Addresses;
}

/**
 * The default tenancy of instances launched into the VPC.
 */
export enum DefaultInstanceTenancy {
  /**
   * Instances can be launched with any tenancy.
   */
  DEFAULT = "default",

  /**
   * Any instance launched into the VPC automatically has dedicated tenancy, unless you launch it with the default tenancy.
   */
  DEDICATED = "dedicated",
}

/**
 * Specify configuration parameters for a single subnet group in a VPC.
 */
export interface SubnetConfiguration {
  /**
   * The number of leading 1 bits in the routing mask.
   *
   * The number of available IP addresses in each subnet of this group
   * will be equal to `2^(32 - cidrMask) - 2`.
   *
   * Valid values are `16--28`.
   *
   * Note this is specific to IPv4 addresses.
   *
   * @default - Available IP space is evenly divided across subnets.
   */
  readonly cidrMask?: number;

  /**
   * The type of Subnet to configure.
   *
   * The Subnet type will control the ability to route and connect to the
   * Internet.
   */
  readonly subnetType: SubnetType;

  /**
   * Logical name for the subnet group.
   *
   * This name can be used when selecting VPC subnets to distinguish
   * between different subnet groups of the same type.
   */
  readonly name: string;

  /**
   * Controls if subnet IP space needs to be reserved.
   *
   * When true, the IP space for the subnet is reserved but no actual
   * resources are provisioned. This space is only dependent on the
   * number of availability zones and on `cidrMask` - all other subnet
   * properties are ignored.
   *
   * @default false
   */
  readonly reserved?: boolean;

  /**
   * Controls if a public IPv4 address is associated to an instance at launch
   *
   * Note this is specific to IPv4 addresses.
   *
   * @default true in Subnet.Public of IPV4_ONLY VPCs, false otherwise
   */
  readonly mapPublicIpOnLaunch?: boolean;

  /**
   * This property is specific to dual stack VPCs.
   *
   * If set to false, then an IPv6 address will not be automatically assigned.
   *
   * Note this is specific to IPv6 addresses.
   *
   * @default true
   */
  readonly ipv6AssignAddressOnCreation?: boolean;
}

/**
 * Define an AWS Virtual Private Cloud
 *
 * See the package-level documentation of this package for an overview
 * of the various dimensions in which you can configure your VPC.
 *
 * For example:
 *
 * ```ts
 * const vpc = new compute.Vpc(this, 'TheVPC', {
 *   ipAddresses: compute.IpAddresses.cidr('10.0.0.0/16'),
 * })
 *
 * // Iterate the private subnets
 * const selection = vpc.selectSubnets({
 *   subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS
 * });
 *
 * for (const subnet of selection.subnets) {
 *   // ...
 * }
 * ```
 *
 * @resource aws_vpc
 */
export class Vpc extends VpcBase {
  /**
   * The default CIDR range used when creating VPCs.
   * This can be overridden using VpcProps when creating a VPCNetwork resource.
   * e.g. new Vpc(this, { cidr: '192.168.0.0./16' })
   *
   * Note this is specific to the IPv4 CIDR.
   */
  public static readonly DEFAULT_CIDR_RANGE: string = "10.0.0.0/16";

  /**
   * The default subnet configuration
   *
   * 1 Public and 1 Private subnet per AZ evenly split
   */
  public static readonly DEFAULT_SUBNETS: SubnetConfiguration[] = [
    {
      subnetType: SubnetType.PUBLIC,
      name: defaultSubnetName(SubnetType.PUBLIC),
    },
    {
      subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      name: defaultSubnetName(SubnetType.PRIVATE_WITH_EGRESS),
    },
  ];

  /**
   * The default subnet configuration if natGateways specified to be 0
   *
   * 1 Public and 1 Isolated Subnet per AZ evenly split
   */
  public static readonly DEFAULT_SUBNETS_NO_NAT: SubnetConfiguration[] = [
    {
      subnetType: SubnetType.PUBLIC,
      name: defaultSubnetName(SubnetType.PUBLIC),
    },
    {
      subnetType: SubnetType.PRIVATE_ISOLATED,
      name: defaultSubnetName(SubnetType.PRIVATE_ISOLATED),
    },
  ];

  /**
   * Import a VPC by supplying all attributes directly
   *
   * NOTE: using `fromVpcAttributes()` with deploy-time parameters (like a `TerraformVariable`
   * to represent a list of subnet IDs) sometimes accidentally works. It happens to work for
   * constructs that need a list of subnets (like `AutoScalingGroup` and `eks.Cluster`)
   * but it does not work for constructs that need individual subnets (like`Instance`).
   * See https://github.com/aws/aws-cdk/issues/4118 for more information.
   */
  public static fromVpcAttributes(
    // TODO: Prefer to use `Vpc.fromLookup()` instead.
    scope: Construct,
    id: string,
    attrs: VpcAttributes,
  ): IVpc {
    return new ImportedVpc(scope, id, attrs, false);
  }

  // TODO: Add Grid Lookup support
  // /**
  //  * Import an existing VPC by querying the AWS environment this stack is deployed to.
  //  *
  //  * This function only needs to be used to use VPCs not defined in your CDK
  //  * application. If you are looking to share a VPC between stacks, you can
  //  * pass the `Vpc` object between stacks and use it as normal.
  //  *
  //  * Calling this method will lead to a lookup when the CDK CLI is executed.
  //  * You can therefore not use any values that will only be available at
  //  * CloudFormation execution time (i.e., Tokens).
  //  *
  //  * The VPC information will be cached in `cdk.context.json` and the same VPC
  //  * will be used on future runs. To refresh the lookup, you will have to
  //  * evict the value from the cache using the `cdk context` command. See
  //  * https://docs.aws.amazon.com/cdk/latest/guide/context.html for more information.
  //  */
  // public static fromLookup(
  //   scope: Construct,
  //   id: string,
  //   options: VpcLookupOptions,
  // ): IVpc {
  //   if (
  //     Token.isUnresolved(options.vpcId) ||
  //     Token.isUnresolved(options.vpcName) ||
  //     Object.values(options.tags || {}).some(Token.isUnresolved) ||
  //     Object.keys(options.tags || {}).some(Token.isUnresolved)
  //   ) {
  //     throw new Error(
  //       "All arguments to Vpc.fromLookup() must be concrete (no Tokens)",
  //     );
  //   }

  //   const filter: { [key: string]: string } = makeTagFilter(options.tags);

  //   // We give special treatment to some tags
  //   if (options.vpcId) {
  //     filter["vpc-id"] = options.vpcId;
  //   }
  //   if (options.vpcName) {
  //     filter["tag:Name"] = options.vpcName;
  //   }
  //   if (options.ownerAccountId) {
  //     filter["owner-id"] = options.ownerAccountId;
  //   }
  //   if (options.isDefault !== undefined) {
  //     filter.isDefault = options.isDefault ? "true" : "false";
  //   }

  //   const overrides: { [key: string]: string } = {};
  //   if (options.region) {
  //     overrides.region = options.region;
  //   }

  //   const attributes: cxapi.VpcContextResponse = ContextProvider.getValue(
  //     scope,
  //     {
  //       provider: cxschema.ContextProvider.VPC_PROVIDER,
  //       props: {
  //         ...overrides,
  //         filter,
  //         returnAsymmetricSubnets: true,
  //         returnVpnGateways: options.returnVpnGateways,
  //         subnetGroupNameTag: options.subnetGroupNameTag,
  //       } as cxschema.VpcContextQuery,
  //       dummyValue: undefined,
  //     },
  //   ).value;

  //   return new LookedUpVpc(
  //     scope,
  //     id,
  //     attributes ?? DUMMY_VPC_PROPS,
  //     attributes === undefined,
  //   );

  //   /**
  //    * Prefixes all keys in the argument with `tag:`.`
  //    */
  //   function makeTagFilter(tags: { [name: string]: string } | undefined): {
  //     [name: string]: string;
  //   } {
  //     const result: { [name: string]: string } = {};
  //     for (const [name, value] of Object.entries(tags || {})) {
  //       result[`tag:${name}`] = value;
  //     }
  //     return result;
  //   }
  // }

  /**
   * Identifier for this VPC
   */
  public readonly vpcId: string;

  /**
   * @attribute
   */
  public readonly vpcArn: string;

  /**
   * @attribute
   */
  public readonly vpcCidrBlock: string;

  /**
   * @attribute
   */
  public readonly vpcDefaultNetworkAcl: string;

  // TODO: use aws_vpc_ipv4_cidr_block_association sub resources?
  // provider-aws aws_vpc does not have vpcCidrBlockAssociations
  // /**
  //  * @attribute
  //  */
  // public readonly vpcCidrBlockAssociations: string[];

  /**
   * @attribute
   */
  public readonly vpcDefaultSecurityGroup: string;

  // TODO: use aws_vpc_ipv6_cidr_block_association sub resources?
  // provider-aws aws_vpc does not have vpcIpv6CidrBlocks
  // /**
  //  * @attribute
  //  */
  // public readonly vpcIpv6CidrBlocks: string[];

  /**
   * @attribute
   */
  public readonly vpcIpv6CidrBlock: string;

  /**
   * List of public subnets in this VPC
   */
  public readonly publicSubnets: ISubnet[] = [];

  /**
   * List of private subnets in this VPC
   */
  public readonly privateSubnets: ISubnet[] = [];

  /**
   * List of isolated subnets in this VPC
   */
  public readonly isolatedSubnets: ISubnet[] = [];

  /**
   * AZs for this VPC
   */
  public readonly availabilityZones: string[];

  /**
   * Internet Gateway for the VPC. Note that in case the VPC is configured only
   * with ISOLATED subnets, this attribute will be `undefined`.
   */
  public readonly internetGatewayId?: string;

  public readonly internetConnectivityEstablished: IDependable;

  /**
   * Indicates if instances launched in this VPC will have public DNS hostnames.
   */
  public readonly dnsHostnamesEnabled: boolean;

  /**
   * Indicates if DNS support is enabled for this VPC.
   */
  public readonly dnsSupportEnabled: boolean;

  /**
   * The VPC resource
   */
  private readonly resource: vpc.Vpc;

  /**
   * Indicates if IPv4 addresses will be used in the VPC.
   *
   * True for IPV4_ONLY and DUAL_STACK VPCs.
   */
  private readonly useIpv4: boolean;

  /**
   * Indicates if IPv6 addresses will be used in the VPC.
   *
   * True for DUAL_STACK VPCs. False for IPV4_ONLY VPCs.
   */
  private readonly useIpv6: boolean;

  /**
   * The provider of ipv4 addresses
   */
  private readonly ipAddresses: IIpAddresses;

  /**
   * The provider of IPv6 addresses.
   */
  private readonly ipv6Addresses?: IIpv6Addresses;

  /**
   * The IPv6 CIDR block CFN resource.
   *
   * Needed to create a dependency for the subnets.
   */
  private readonly ipv6CidrBlock?: vpcIpv6CidrBlockAssociation.VpcIpv6CidrBlockAssociation;

  /**
   * The IPv6 CIDR block string representation.
   */
  private readonly ipv6SelectedCidr?: string;

  /**
   * Subnet configurations for this VPC
   */
  private subnetConfiguration: SubnetConfiguration[] = [];

  private readonly _internetConnectivityEstablished = new DependencyGroup();

  /**
   * Vpc creates a VPC that spans a whole region.
   * It will automatically divide the provided VPC CIDR range, and create public and private subnets per Availability Zone.
   * Network routing for the public subnets will be configured to allow outbound access directly via an Internet Gateway.
   * Network routing for the private subnets will be configured to allow outbound access via a set of resilient NAT Gateways (one per AZ).
   */
  constructor(scope: Construct, id: string, props: VpcProps = {}) {
    super(scope, id);

    const stack = this.stack;

    // Can't have enabledDnsHostnames without enableDnsSupport
    if (props.enableDnsHostnames && !props.enableDnsSupport) {
      throw new Error(
        "To use DNS Hostnames, DNS Support must be enabled, however, it was explicitly disabled.",
      );
    }

    if (props.availabilityZones && props.maxAzs) {
      throw new Error(
        "Vpc supports 'availabilityZones' or 'maxAzs', but not both.",
      );
    }

    const cidrBlock = ifUndefined(props.cidr, Vpc.DEFAULT_CIDR_RANGE);
    if (Token.isUnresolved(cidrBlock)) {
      throw new Error(
        "'cidr' property must be a concrete CIDR string, got a Token (we need to parse it for automatic subdivision)",
      );
    }

    if (props.ipAddresses && props.cidr) {
      throw new Error("supply at most one of ipAddresses or cidr");
    }

    const ipProtocol = props.ipProtocol ?? IpProtocol.IPV4_ONLY;
    // this property can be set to false if an IPv6_ONLY VPC is implemented in the future
    this.useIpv4 =
      ipProtocol === IpProtocol.IPV4_ONLY ||
      ipProtocol === IpProtocol.DUAL_STACK;

    this.useIpv6 = ipProtocol === IpProtocol.DUAL_STACK;

    const ipv6OnlyProps: Array<keyof VpcProps> = ["ipv6Addresses"];
    if (!this.useIpv6) {
      for (const prop of ipv6OnlyProps) {
        if (props[prop] !== undefined) {
          throw new Error(
            `${prop} can only be set if IPv6 is enabled. Set ipProtocol to DUAL_STACK`,
          );
        }
      }
    }

    this.ipAddresses = props.ipAddresses ?? IpAddresses.cidr(cidrBlock);

    this.dnsHostnamesEnabled =
      props.enableDnsHostnames == null ? true : props.enableDnsHostnames;
    this.dnsSupportEnabled =
      props.enableDnsSupport == null ? true : props.enableDnsSupport;
    const instanceTenancy = props.defaultInstanceTenancy || "default";
    this.internetConnectivityEstablished =
      this._internetConnectivityEstablished;

    const vpcIpAddressOptions = this.ipAddresses.allocateVpcCidr();

    // Define a VPC using the provided CIDR range
    this.resource = new vpc.Vpc(this, "Resource", {
      cidrBlock: vpcIpAddressOptions.cidrBlock,
      ipv4IpamPoolId: vpcIpAddressOptions.ipv4IpamPoolId,
      ipv4NetmaskLength: vpcIpAddressOptions.ipv4NetmaskLength,
      enableDnsHostnames: this.dnsHostnamesEnabled,
      enableDnsSupport: this.dnsSupportEnabled,
      instanceTenancy,
    });

    this.vpcDefaultNetworkAcl = this.resource.defaultNetworkAclId;
    this.vpcCidrBlock = this.resource.cidrBlock;
    this.vpcDefaultSecurityGroup = this.resource.defaultSecurityGroupId;
    this.vpcIpv6CidrBlock = this.resource.ipv6CidrBlock;
    // this.vpcCidrBlockAssociations = this.resource.cidrBlockAssociations;

    Tags.of(this).add(NAME_TAG, props.vpcName || this.node.path);

    if (props.availabilityZones) {
      // TODO: Implement ContextProvider to validate AZs
      // // If given AZs and stack AZs are both resolved, then validate their compatibility.
      // const resolvedStackAzs = this.resolveStackAvailabilityZones(
      //   stack.availabilityZones(props.maxAzs),
      // );
      // const areGivenAzsSubsetOfStack =
      //   resolvedStackAzs.length === 0 ||
      //   props.availabilityZones.every(
      //     (az) => Token.isUnresolved(az) || resolvedStackAzs.includes(az),
      //   );
      // if (!areGivenAzsSubsetOfStack) {
      //   throw new Error(
      //     `Given VPC 'availabilityZones' ${props.availabilityZones} must be a subset of the stack's availability zones ${resolvedStackAzs}`,
      //   );
      // }
      this.availabilityZones = props.availabilityZones;
    } else {
      const maxAZs = props.maxAzs ?? 3;
      this.availabilityZones = stack.availabilityZones(maxAZs);
    }
    for (let i = 0; props.reservedAzs && i < props.reservedAzs; i++) {
      this.availabilityZones.push(FAKE_AZ_NAME);
    }

    this.vpcId = this.resource.id;
    this.vpcArn = Arn.format(
      {
        service: "ec2",
        resource: "vpc",
        resourceName: this.vpcId,
      },
      stack,
    );

    const defaultSubnet =
      props.natGateways === 0
        ? Vpc.DEFAULT_SUBNETS_NO_NAT
        : Vpc.DEFAULT_SUBNETS;
    this.subnetConfiguration = ifUndefined(
      props.subnetConfiguration,
      defaultSubnet,
    );

    const natGatewayPlacement = props.natGatewaySubnets || {
      subnetType: SubnetType.PUBLIC,
    };
    const natGatewayCount = determineNatGatewayCount(
      props.natGateways,
      this.subnetConfiguration,
      this.availabilityZones.length,
    );

    if (this.useIpv6) {
      this.ipv6Addresses =
        props.ipv6Addresses ?? Ipv6Addresses.amazonProvided();

      this.ipv6CidrBlock = this.ipv6Addresses.allocateVpcIpv6Cidr({
        scope: this,
        vpcId: this.vpcId,
      });

      // TODO: how to allow ipv6 cidr block inputs?
      this.ipv6SelectedCidr = this.resource.ipv6CidrBlock;
    }

    // subnetConfiguration must be set before calling createSubnets
    this.createSubnets();

    const createInternetGateway = props.createInternetGateway ?? true;
    const allowOutbound =
      this.subnetConfiguration.filter(
        (sn) =>
          sn.subnetType !== SubnetType.PRIVATE_ISOLATED &&
          sn.subnetType !== SubnetType.ISOLATED &&
          !sn.reserved,
      ).length > 0;

    // Create an Internet Gateway and attach it if necessary
    if (allowOutbound && createInternetGateway) {
      const igw = new internetGateway.InternetGateway(this, "IGW", {});

      this.internetGatewayId = igw.id;

      this._internetConnectivityEstablished.add(igw);
      const att = new internetGatewayAttachment.InternetGatewayAttachment(
        this,
        "VPCGW",
        {
          internetGatewayId: igw.id,
          vpcId: this.resource.id,
        },
      );

      (this.publicSubnets as PublicSubnet[]).forEach((publicSubnet) => {
        // configure IPv4 route
        if (this.useIpv4) {
          publicSubnet.addDefaultInternetRoute(igw.id, att);
        }
        // configure IPv6 route if VPC is dual stack
        if (this.useIpv6) {
          publicSubnet.addIpv6DefaultInternetRoute(igw.id);
        }
      });

      // if gateways are needed create them
      if (natGatewayCount > 0) {
        const provider = props.natGatewayProvider || NatProvider.gateway();
        this.createNatGateways(provider, natGatewayCount, natGatewayPlacement);
      }
    }

    // Create an Egress Only Internet Gateway and attach it if necessary
    if (this.useIpv6 && this.privateSubnets) {
      const eigw = new egressOnlyInternetGateway.EgressOnlyInternetGateway(
        this,
        "EIGW6",
        {
          vpcId: this.vpcId,
        },
      );

      (this.privateSubnets as PrivateSubnet[]).forEach((privateSubnet) => {
        privateSubnet.addIpv6DefaultEgressOnlyInternetRoute(eigw.id);
      });
    }

    if (
      props.vpnGateway &&
      this.publicSubnets.length === 0 &&
      this.privateSubnets.length === 0 &&
      this.isolatedSubnets.length === 0
    ) {
      throw new Error(
        "Can not enable the VPN gateway while the VPC has no subnets at all",
      );
    }

    if (
      (props.vpnConnections || props.vpnGatewayAsn) &&
      props.vpnGateway === false
    ) {
      throw new Error(
        "Cannot specify `vpnConnections` or `vpnGatewayAsn` when `vpnGateway` is set to false.",
      );
    }

    if (props.vpnGateway || props.vpnConnections || props.vpnGatewayAsn) {
      this.enableVpnGateway({
        amazonSideAsn: props.vpnGatewayAsn,
        type: VpnConnectionType.IPSEC_1,
        vpnRoutePropagation: props.vpnRoutePropagation,
      });

      const vpnConnections = props.vpnConnections || {};
      for (const [connectionId, connection] of Object.entries(vpnConnections)) {
        this.addVpnConnection(connectionId, connection);
      }
    }

    // Allow creation of gateway endpoints on VPC instantiation as those can be
    // immediately functional without further configuration. This is not the case
    // for interface endpoints where the security group must be configured.
    if (props.gatewayEndpoints) {
      const gatewayEndpoints = props.gatewayEndpoints || {};
      for (const [endpointId, endpoint] of Object.entries(gatewayEndpoints)) {
        this.addGatewayEndpoint(endpointId, endpoint);
      }
    }

    // Add flow logs to the VPC
    if (props.flowLogs) {
      const flowLogs = props.flowLogs || {};
      for (const [flowLogId, flowLog] of Object.entries(flowLogs)) {
        this.addFlowLog(flowLogId, flowLog);
      }
    }

    /**
     * Enable this feature flag to remove the default ingress/egress rules from the
     * VPC default security group.
     *
     * When a VPC is created, a default security group is created as well and this cannot
     * be deleted. The default security group is created with ingress/egress rules that allow
     * _all_ traffic. [AWS Security best practices recommend](https://docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html#ec2-2)
     * removing these ingress/egress rules in order to restrict access to the default security group.
     */
    // const restrictFlag = FeatureFlags.of(this).isEnabled(
    //   EC2_RESTRICT_DEFAULT_SECURITY_GROUP,
    // );
    // if (
    //   (restrictFlag && props.restrictDefaultSecurityGroup !== false) ||
    //   props.restrictDefaultSecurityGroup
    // ) {
    //   this.restrictDefaultSecurityGroup();
    // }
  }

  /**
   * Adds a new S3 gateway endpoint to this VPC
   *
   * @deprecated use `addGatewayEndpoint()` instead
   */
  public addS3Endpoint(
    id: string,
    subnets?: SubnetSelection[],
  ): GatewayVpcEndpoint {
    return new GatewayVpcEndpoint(this, id, {
      service: GatewayVpcEndpointAwsService.S3,
      vpc: this,
      subnets,
    });
  }

  /**
   * Adds a new DynamoDB gateway endpoint to this VPC
   *
   * @deprecated use `addGatewayEndpoint()` instead
   */
  public addDynamoDbEndpoint(
    id: string,
    subnets?: SubnetSelection[],
  ): GatewayVpcEndpoint {
    return new GatewayVpcEndpoint(this, id, {
      service: GatewayVpcEndpointAwsService.DYNAMODB,
      vpc: this,
      subnets,
    });
  }

  private createNatGateways(
    provider: NatProvider,
    natCount: number,
    placement: SubnetSelection,
  ): void {
    const natSubnets: PublicSubnet[] = this.selectSubnetObjects(
      placement,
    ) as PublicSubnet[];
    for (const sub of natSubnets) {
      if (this.publicSubnets.indexOf(sub) === -1) {
        throw new Error(
          `natGatewayPlacement ${placement} contains non public subnet ${sub}`,
        );
      }
    }

    provider.configureNat({
      vpc: this,
      natSubnets: natSubnets.slice(0, natCount),
      privateSubnets: this.privateSubnets as PrivateSubnet[],
    });
  }

  /**
   * createSubnets creates the subnets specified by the subnet configuration
   * array or creates the `DEFAULT_SUBNETS` configuration
   */
  private createSubnets() {
    const requestedSubnets: RequestedSubnet[] = [];

    this.subnetConfiguration.forEach((configuration) =>
      this.availabilityZones.forEach((az, index) => {
        requestedSubnets.push({
          availabilityZone: az,
          subnetConstructId: subnetId(configuration.name, index),
          configuration,
        });
      }),
    );

    let { allocatedSubnets } = this.ipAddresses.allocateSubnetsCidr({
      vpcCidr: this.vpcCidrBlock,
      requestedSubnets,
    });

    if (allocatedSubnets.length != requestedSubnets.length) {
      throw new Error(
        "Incomplete Subnet Allocation; response array dose not equal input array",
      );
    }

    if (this.useIpv6) {
      if (this.ipv6SelectedCidr === undefined) {
        throw new Error(
          "No IPv6 CIDR block associated with this VPC could be found",
        );
      }
      if (this.ipv6Addresses === undefined) {
        throw new Error("No IPv6 IpAddresses were found");
      }
      // create the IPv6 CIDR blocks
      const subnetIpv6Cidrs = this.ipv6Addresses.createIpv6CidrBlocks({
        ipv6SelectedCidr: this.ipv6SelectedCidr,
        subnetCount: allocatedSubnets.length,
      });

      // copy the list of allocated subnets while assigning the IPv6 CIDR
      const allocatedSubnetsIpv6 = this.ipv6Addresses.allocateSubnetsIpv6Cidr({
        allocatedSubnets: allocatedSubnets,
        ipv6Cidrs: subnetIpv6Cidrs,
      });

      // assign allocated subnets to list with IPv6 addresses
      allocatedSubnets = allocatedSubnetsIpv6.allocatedSubnets;
    }

    this.createSubnetResources(requestedSubnets, allocatedSubnets);

    if (this.useIpv6) {
      // add dependencies
      (this.publicSubnets as PublicSubnet[]).forEach((publicSubnet) => {
        if (this.ipv6CidrBlock !== undefined) {
          publicSubnet.node.addDependency(this.ipv6CidrBlock);
        }
      });
      (this.privateSubnets as PrivateSubnet[]).forEach((privateSubnet) => {
        if (this.ipv6CidrBlock !== undefined) {
          privateSubnet.node.addDependency(this.ipv6CidrBlock);
        }
      });
      (this.isolatedSubnets as PrivateSubnet[]).forEach((isolatedSubnet) => {
        if (this.ipv6CidrBlock !== undefined) {
          isolatedSubnet.node.addDependency(this.ipv6CidrBlock);
        }
      });
    }
  }

  /**
   * Defaults to true in Subnet.Public for IPV4_ONLY VPCs.
   *
   * Defaults to false in Subnet.Public for DUAL_STACK VPCs.
   *
   * Always defaults to false in non-public subnets and will error if set.
   */
  private calculateMapPublicIpOnLaunch(subnetConfig: SubnetConfiguration) {
    if (subnetConfig.subnetType === SubnetType.PUBLIC) {
      return subnetConfig.mapPublicIpOnLaunch !== undefined
        ? subnetConfig.mapPublicIpOnLaunch
        : !this.useIpv6; // changes default based on protocol of vpc
    } else {
      if (subnetConfig.mapPublicIpOnLaunch !== undefined) {
        throw new Error(
          `${subnetConfig.subnetType} subnet cannot include mapPublicIpOnLaunch parameter`,
        );
      }
      return false;
    }
  }

  private createSubnetResources(
    requestedSubnets: RequestedSubnet[],
    allocatedSubnets: AllocatedSubnet[],
  ) {
    allocatedSubnets.forEach((allocated, i) => {
      const {
        configuration: subnetConfig,
        subnetConstructId,
        availabilityZone,
      } = requestedSubnets[i];

      if (subnetConfig.reserved === true) {
        // For reserved subnets, do not create any resources
        return;
      }
      if (availabilityZone === FAKE_AZ_NAME) {
        // For reserved azs, do not create any resources
        return;
      }

      const ipv6OnlyProps: Array<keyof SubnetConfiguration> = [
        "ipv6AssignAddressOnCreation",
      ];
      if (!this.useIpv6) {
        for (const prop of ipv6OnlyProps) {
          if (subnetConfig[prop] !== undefined) {
            throw new Error(
              `${prop} can only be set if IPv6 is enabled. Set ipProtocol to DUAL_STACK`,
            );
          }
        }
      }

      const subnetProps = {
        availabilityZone,
        vpcId: this.vpcId,
        cidrBlock: allocated.cidr,
        mapPublicIpOnLaunch: this.calculateMapPublicIpOnLaunch(subnetConfig),
        ipv6CidrBlock: allocated.ipv6Cidr,
        assignIpv6AddressOnCreation: this.useIpv6
          ? (subnetConfig.ipv6AssignAddressOnCreation ?? true)
          : undefined,
      } satisfies SubnetProps;

      let sn: Subnet;
      switch (subnetConfig.subnetType) {
        case SubnetType.PUBLIC:
          const publicSubnet = new PublicSubnet(
            this,
            subnetConstructId,
            subnetProps,
          );
          this.publicSubnets.push(publicSubnet);
          sn = publicSubnet;
          break;
        case SubnetType.PRIVATE_WITH_EGRESS:
        case SubnetType.PRIVATE_WITH_NAT:
        case SubnetType.PRIVATE:
          const privateSubnet = new PrivateSubnet(
            this,
            subnetConstructId,
            subnetProps,
          );
          this.privateSubnets.push(privateSubnet);
          sn = privateSubnet;
          break;
        case SubnetType.PRIVATE_ISOLATED:
        case SubnetType.ISOLATED:
          const isolatedSubnet = new PrivateSubnet(
            this,
            subnetConstructId,
            subnetProps,
          );
          this.isolatedSubnets.push(isolatedSubnet);
          sn = isolatedSubnet;
          break;
        default:
          throw new Error(
            `Unrecognized subnet type: ${subnetConfig.subnetType}`,
          );
      }

      // These values will be used to recover the config upon provider import
      const includeResourceTypes = [subnet.Subnet.tfResourceType];
      Tags.of(sn).add(SUBNETNAME_TAG, subnetConfig.name, {
        includeResourceTypes,
      });
      Tags.of(sn).add(
        SUBNETTYPE_TAG,
        subnetTypeTagValue(subnetConfig.subnetType),
        { includeResourceTypes },
      );
    });
  }

  // // TODO: Add custom resources support
  // private restrictDefaultSecurityGroup(): void {
  //   const id = "Custom::VpcRestrictDefaultSG";
  //   const provider = RestrictDefaultSgProvider.getOrCreateProvider(this, id, {
  //     description:
  //       "Lambda function for removing all inbound/outbound rules from the VPC default security group",
  //   });
  //   provider.addToRolePolicy({
  //     Effect: "Allow",
  //     Action: [
  //       "ec2:AuthorizeSecurityGroupIngress",
  //       "ec2:AuthorizeSecurityGroupEgress",
  //       "ec2:RevokeSecurityGroupIngress",
  //       "ec2:RevokeSecurityGroupEgress",
  //     ],
  //     Resource: [
  //       AwsStack.ofAwsConstruct(this).formatArn({
  //         resource: "security-group",
  //         service: "ec2",
  //         resourceName: this.vpcDefaultSecurityGroup,
  //       }),
  //     ],
  //   });
  //   new CustomResource(this, "RestrictDefaultSecurityGroupCustomResource", {
  //     resourceType: id,
  //     serviceToken: provider.serviceToken,
  //     properties: {
  //       DefaultSecurityGroupId: this.vpcDefaultSecurityGroup,
  //       Account: AwsStack.ofAwsConstruct(this).account,
  //     },
  //   });
  // }

  // /**
  //  * Returns the list of resolved availability zones found in the provided stack availability
  //  * zones.
  //  *
  //  * Note: A resolved availability zone refers to an availability zone that is not a token
  //  * and is also not a dummy value.
  //  */
  // private resolveStackAvailabilityZones(
  //   stackAvailabilityZones: string[],
  // ): string[] {
  //   const dummyValues = ["dummy1a", "dummy1b", "dummy1c"];
  //   // if an az is resolved and it is not a 'dummy' value, then add it to array as a resolved az
  //   return stackAvailabilityZones.filter(
  //     (az) => !Token.isUnresolved(az) && !dummyValues.includes(az),
  //   );
  // }
}

const SUBNETTYPE_TAG = "aws-cdk:subnet-type";
const SUBNETNAME_TAG = "aws-cdk:subnet-name";

function subnetTypeTagValue(type: SubnetType) {
  switch (type) {
    case SubnetType.PUBLIC:
      return "Public";
    case SubnetType.PRIVATE_WITH_EGRESS:
    case SubnetType.PRIVATE_WITH_NAT:
    case SubnetType.PRIVATE:
      return "Private";
    case SubnetType.PRIVATE_ISOLATED:
    case SubnetType.ISOLATED:
      return "Isolated";
  }
}

/**
 * Specify configuration parameters for a VPC subnet
 */
export interface SubnetProps {
  /**
   * The availability zone for the subnet
   */
  readonly availabilityZone: string;

  /**
   * The VPC which this subnet is part of
   */
  readonly vpcId: string;

  /**
   * The CIDR notation for this subnet
   */
  readonly cidrBlock: string;

  /**
   * Controls if a public IP is associated to an instance at launch
   *
   * @default true in Subnet.Public, false in Subnet.Private or Subnet.Isolated.
   */
  readonly mapPublicIpOnLaunch?: boolean;

  /**
   * The IPv6 CIDR block.
   *
   * If you specify AssignIpv6AddressOnCreation, you must also specify Ipv6CidrBlock.
   *
   * @default - no IPv6 CIDR block.
   */
  readonly ipv6CidrBlock?: string;

  /**
   * Indicates whether a network interface created in this subnet receives an IPv6 address.
   *
   * If you specify AssignIpv6AddressOnCreation, you must also specify Ipv6CidrBlock.
   *
   * @default false
   */
  readonly assignIpv6AddressOnCreation?: boolean;
}

/**
 * Represents a new VPC subnet resource
 *
 * @resource aws_subnet
 */
export class Subnet extends AwsConstructBase implements ISubnet {
  public static isVpcSubnet(x: any): x is Subnet {
    return VPC_SUBNET_SYMBOL in x;
  }

  public static fromSubnetAttributes(
    scope: Construct,
    id: string,
    attrs: SubnetAttributes,
  ): ISubnet {
    return new ImportedSubnet(scope, id, attrs);
  }

  /**
   * Import existing subnet from id.
   */
  public static fromSubnetId(
    scope: Construct,
    id: string,
    snetId: string,
  ): ISubnet {
    return this.fromSubnetAttributes(scope, id, { subnetId: snetId });
  }

  public readonly subnetOutputs: SubnetOutputs;
  public get outputs(): Record<string, any> {
    return this.subnetOutputs;
  }

  /**
   * The Availability Zone the subnet is located in
   */
  public readonly availabilityZone: string;

  /**
   * @attribute
   */
  public readonly ipv4CidrBlock: string;

  /**
   * The subnetId for this particular subnet
   */
  public readonly subnetId: string;

  /**
   * @attribute
   */
  public readonly subnetVpcId: string;

  /**
   * @attribute
   */
  public readonly subnetAvailabilityZone: string;

  // TODO: use aws_subnet_ipv6_cidr_block_association sub resources?
  // /**
  //  * @attribute
  //  */
  // public readonly subnetIpv6CidrBlocks: string[];

  /**
   * @attribute
   */
  public readonly subnetIpv6CidrBlock: string;

  /**
   * The Amazon Resource Name (ARN) of the Outpost for this subnet (if one exists).
   * @attribute
   */
  public readonly subnetOutpostArn: string;

  /**
   * @attribute
   */
  public readonly subnetNetworkAclAssociationId: string | undefined;

  /**
   * Parts of this VPC subnet
   */
  public readonly dependencyElements: IDependable[] = [];

  /**
   * The routeTableId attached to this subnet.
   */
  public readonly routeTable: IRouteTable;

  public readonly internetConnectivityEstablished: IDependable;

  private readonly _internetConnectivityEstablished = new DependencyGroup();

  private _networkAcl?: INetworkAcl;
  public resource: subnet.Subnet;

  constructor(scope: Construct, id: string, props: SubnetProps) {
    super(scope, id);

    Object.defineProperty(this, VPC_SUBNET_SYMBOL, { value: true });

    Tags.of(this).add(NAME_TAG, this.node.path);

    this.availabilityZone = props.availabilityZone;
    this.ipv4CidrBlock = props.cidrBlock;
    this.resource = new subnet.Subnet(this, "Resource", {
      vpcId: props.vpcId,
      cidrBlock: props.cidrBlock,
      availabilityZone: props.availabilityZone,
      mapPublicIpOnLaunch: props.mapPublicIpOnLaunch,
      ipv6CidrBlock: props.ipv6CidrBlock,
      assignIpv6AddressOnCreation: props.assignIpv6AddressOnCreation,
    });
    this.subnetId = this.resource.id;
    this.subnetVpcId = this.resource.vpcId;
    this.subnetAvailabilityZone = this.resource.availabilityZone;
    // TODO: Support IPv6 Association blocks
    this.subnetIpv6CidrBlock = this.resource.ipv6CidrBlock;
    this.subnetOutpostArn = this.resource.outpostArn;

    // Terraform subnet does not provide the default ACL NetworkAclAssociationId attribute
    // // subnet.NetworkAclAssociationId is the default ACL after the subnet
    // // was just created. However, the ACL can be replaced at a later time.
    // this._networkAcl = NetworkAcl.fromNetworkAclId(
    //   this,
    //   "Acl",
    //   this.resource.NetworkAclAssociationId,
    // );
    this.subnetNetworkAclAssociationId = Lazy.stringValue({
      produce: () => this._networkAcl?.networkAclId ?? Token.asString(null),
    });

    const table = new routeTable.RouteTable(this, "RouteTable", {
      vpcId: props.vpcId,
    });
    this.routeTable = { routeTableId: table.id };

    // Associate the public route table for this subnet, to this subnet
    const routeAssoc = new routeTableAssociation.RouteTableAssociation(
      this,
      "RouteTableAssociation",
      {
        subnetId: this.subnetId,
        routeTableId: table.id,
      },
    );
    this._internetConnectivityEstablished.add(routeAssoc);

    this.internetConnectivityEstablished =
      this._internetConnectivityEstablished;
    this.subnetOutputs = {
      subnetId: this.subnetId,
      ipv4CidrBlock: this.ipv4CidrBlock,
      routeTableId: this.routeTable.routeTableId,
    };
  }

  /**
   * Create a default route that points to a passed IGW, with a dependency
   * on the IGW's attachment to the VPC.
   *
   * @param gatewayId the logical ID (ref) of the gateway attached to your VPC
   * @param gatewayAttachment the gateway attachment construct to be added as a dependency
   */
  public addDefaultInternetRoute(
    gatewayId: string,
    gatewayAttachment: IDependable,
  ) {
    const r = new route.Route(this, "DefaultRoute", {
      routeTableId: this.routeTable.routeTableId,
      destinationCidrBlock: "0.0.0.0/0",
      gatewayId,
    });
    r.node.addDependency(gatewayAttachment);

    // Since the 'r' depends on the gateway attachment, just
    // depending on the route is enough.
    this._internetConnectivityEstablished.add(r);
  }

  /**
   * Create a default IPv6 route that points to a passed IGW.
   *
   * @param gatewayId the logical ID (ref) of the gateway attached to your VPC
   */
  public addIpv6DefaultInternetRoute(gatewayId: string) {
    this.addRoute("DefaultRoute6", {
      routerType: RouterType.GATEWAY,
      routerId: gatewayId,
      destinationIpv6CidrBlock: "::/0",
      enablesInternetConnectivity: true,
    });
  }

  /**
   * Create a default IPv6 route that points to a passed EIGW.
   *
   * @param gatewayId the logical ID (ref) of the gateway attached to your VPC
   */
  public addIpv6DefaultEgressOnlyInternetRoute(gatewayId: string) {
    this.addRoute("DefaultRoute6", {
      routerType: RouterType.EGRESS_ONLY_INTERNET_GATEWAY,
      routerId: gatewayId,
      destinationIpv6CidrBlock: "::/0",
      enablesInternetConnectivity: true,
    });
  }

  /**
   * Network ACL associated with this Subnet
   *
   * Upon creation, this is undefined pointing to
   * the default ACL which allows all traffic, except
   * explicit DENY entries that you add.
   *
   * You can replace it with a custom ACL which denies all traffic except
   * the explicit ALLOW entries that you add by creating a `NetworkAcl`
   * object and calling `associateNetworkAcl()`.
   */
  public get networkAcl(): INetworkAcl | undefined {
    return this._networkAcl;
  }

  /**
   * Adds an entry to this subnets route table that points to the passed NATGatewayId
   * @param natGatewayId The ID of the NAT gateway
   */
  public addDefaultNatRoute(natGatewayId: string) {
    this.addRoute("DefaultRoute", {
      routerType: RouterType.NAT_GATEWAY,
      routerId: natGatewayId,
      enablesInternetConnectivity: true,
    });
  }

  /**
   * Adds an entry to this subnets route table that points to the passed NATGatewayId.
   * Uses the known 64:ff9b::/96 prefix.
   * @param natGatewayId The ID of the NAT gateway
   */
  public addIpv6Nat64Route(natGatewayId: string) {
    this.addRoute("Nat64", {
      routerType: RouterType.NAT_GATEWAY,
      routerId: natGatewayId,
      enablesInternetConnectivity: true,
      destinationIpv6CidrBlock: "64:ff9b::/96",
    });
  }

  /**
   * Adds an entry to this subnets route table
   */
  public addRoute(id: string, options: AddRouteOptions) {
    if (options.destinationCidrBlock && options.destinationIpv6CidrBlock) {
      throw new Error(
        "Cannot specify both 'destinationCidrBlock' and 'destinationIpv6CidrBlock'",
      );
    }

    const r = new route.Route(this, id, {
      routeTableId: this.routeTable.routeTableId,
      destinationCidrBlock:
        options.destinationCidrBlock ||
        (options.destinationIpv6CidrBlock === undefined
          ? "0.0.0.0/0"
          : undefined),
      destinationIpv6CidrBlock: options.destinationIpv6CidrBlock,
      [routerTypeToPropName(options.routerType)]: options.routerId,
    });

    if (options.enablesInternetConnectivity) {
      this._internetConnectivityEstablished.add(r);
    }
  }

  public associateNetworkAcl(id: string, networkAcl: INetworkAcl) {
    this._networkAcl = networkAcl;

    const scope = networkAcl instanceof Construct ? networkAcl : this;
    const other = networkAcl instanceof Construct ? this : networkAcl;
    new SubnetNetworkAclAssociation(scope, id + AwsStack.uniqueId(other.node), {
      networkAcl,
      subnet: this,
    });
  }
}

/**
 * Options for adding a new route to a subnet
 */
export interface AddRouteOptions {
  /**
   * IPv4 range this route applies to
   *
   * @default '0.0.0.0/0'
   */
  readonly destinationCidrBlock?: string;

  /**
   * IPv6 range this route applies to
   *
   * @default - Uses IPv6
   */
  readonly destinationIpv6CidrBlock?: string;

  /**
   * What type of router to route this traffic to
   */
  readonly routerType: RouterType;

  /**
   * The ID of the router
   *
   * Can be an instance ID, gateway ID, etc, depending on the router type.
   */
  readonly routerId: string;

  /**
   * Whether this route will enable internet connectivity
   *
   * If true, this route will be added before any AWS resources that depend
   * on internet connectivity in the VPC will be created.
   *
   * @default false
   */
  readonly enablesInternetConnectivity?: boolean;
}

/**
 * Type of router used in route
 */
export enum RouterType {
  /**
   * Carrier gateway
   */
  CARRIER_GATEWAY = "CarrierGateway",

  /**
   * Egress-only Internet Gateway
   */
  EGRESS_ONLY_INTERNET_GATEWAY = "EgressOnlyInternetGateway",

  /**
   * Internet Gateway
   */
  GATEWAY = "Gateway",

  // /**
  //  * Instance
  //  */
  // INSTANCE = "Instance",

  /**
   * Local Gateway
   */
  LOCAL_GATEWAY = "LocalGateway",

  /**
   * NAT Gateway
   */
  NAT_GATEWAY = "NatGateway",

  /**
   * Network Interface
   */
  NETWORK_INTERFACE = "NetworkInterface",

  /**
   * Transit Gateway
   */
  TRANSIT_GATEWAY = "TransitGateway",

  /**
   * VPC peering connection
   */
  VPC_PEERING_CONNECTION = "VpcPeeringConnection",

  /**
   * VPC Endpoint for gateway load balancers
   */
  VPC_ENDPOINT = "VpcEndpoint",
}

/**
 * inverse of
 * https://github.com/hashicorp/terraform-provider-aws/blob/v5.87.0/internal/service/ec2/vpc_route.go#L219-L239
 */
function routerTypeToPropName(routerType: RouterType) {
  const lookupMap: Record<RouterType, keyof route.RouteConfig> = {
    [RouterType.CARRIER_GATEWAY]: "carrierGatewayId",
    [RouterType.EGRESS_ONLY_INTERNET_GATEWAY]: "egressOnlyGatewayId",
    [RouterType.GATEWAY]: "gatewayId",
    // terraform-provider-aws is missing switch case for InstanceId
    // https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateRoute.html
    // [RouterType.INSTANCE]: "instanceId",
    [RouterType.LOCAL_GATEWAY]: "localGatewayId",
    [RouterType.NAT_GATEWAY]: "natGatewayId",
    [RouterType.NETWORK_INTERFACE]: "networkInterfaceId",
    [RouterType.TRANSIT_GATEWAY]: "transitGatewayId",
    [RouterType.VPC_PEERING_CONNECTION]: "vpcPeeringConnectionId",
    [RouterType.VPC_ENDPOINT]: "vpcEndpointId",
  };
  return lookupMap[routerType];
}

export interface PublicSubnetProps extends SubnetProps {}

export interface IPublicSubnet extends ISubnet {}

export interface PublicSubnetAttributes extends SubnetAttributes {}

/**
 * Represents a public VPC subnet resource
 */
export class PublicSubnet extends Subnet implements IPublicSubnet {
  public static fromPublicSubnetAttributes(
    scope: Construct,
    id: string,
    attrs: PublicSubnetAttributes,
  ): IPublicSubnet {
    return new ImportedSubnet(scope, id, attrs);
  }

  constructor(scope: Construct, id: string, props: PublicSubnetProps) {
    super(scope, id, props);
  }

  /**
   * Creates a new managed NAT gateway attached to this public subnet.
   * Also adds the EIP for the managed NAT.
   * @returns A ref to the the NAT Gateway ID
   */
  public addNatGateway(eipAllocationId?: string) {
    // Create a NAT Gateway in this public subnet
    const ngw = new natGateway.NatGateway(this, "NATGateway", {
      subnetId: this.subnetId,
      allocationId:
        eipAllocationId ??
        new eip.Eip(this, "EIP", {
          domain: "vpc",
        }).allocationId,
    });
    ngw.node.addDependency(this.internetConnectivityEstablished);
    return ngw;
  }
}

export interface PrivateSubnetProps extends SubnetProps {}

export interface IPrivateSubnet extends ISubnet {}

export interface PrivateSubnetAttributes extends SubnetAttributes {}

/**
 * Represents a private VPC subnet resource
 */
export class PrivateSubnet extends Subnet implements IPrivateSubnet {
  public static fromPrivateSubnetAttributes(
    scope: Construct,
    id: string,
    attrs: PrivateSubnetAttributes,
  ): IPrivateSubnet {
    return new ImportedSubnet(scope, id, attrs);
  }

  constructor(scope: Construct, id: string, props: PrivateSubnetProps) {
    super(scope, id, props);
  }
}

function ifUndefined<T>(value: T | undefined, defaultValue: T): T {
  return value ?? defaultValue;
}

class ImportedVpc extends VpcBase {
  public readonly vpcId: string;
  public readonly vpcArn: string;
  public readonly publicSubnets: ISubnet[];
  public readonly privateSubnets: ISubnet[];
  public readonly isolatedSubnets: ISubnet[];
  public readonly availabilityZones: string[];
  public readonly internetConnectivityEstablished: IDependable =
    new DependencyGroup();
  private readonly cidr?: string | undefined;

  constructor(
    scope: Construct,
    id: string,
    props: VpcAttributes,
    isIncomplete: boolean,
  ) {
    super(scope, id, {
      region: props.region,
    });

    this.vpcId = props.vpcId;
    this.vpcArn = Arn.format(
      {
        service: "ec2",
        resource: "vpc",
        resourceName: this.vpcId,
      },
      AwsStack.ofAwsConstruct(this),
    );
    this.cidr = props.vpcCidrBlock;
    this.availabilityZones = props.availabilityZones;
    this._vpnGatewayId = props.vpnGatewayId;
    this.incompleteSubnetDefinition = isIncomplete;

    // None of the values may be unresolved list tokens
    for (const k of Object.keys(props) as Array<keyof VpcAttributes>) {
      if (Array.isArray(props[k]) && Token.isUnresolved(props[k])) {
        // `@aws-cdk/aws-ec2:vpcAttributeIsListToken${k}`,
        Annotations.of(this).addWarning(
          `fromVpcAttributes: '${k}' is a list token: the imported VPC will not work with constructs that require a list of subnets at synthesis time. Use 'Vpc.fromLookup()' or 'Fn.importListValue' instead.`,
        );
      }
    }

    const pub = new ImportSubnetGroup(
      props.publicSubnetIds,
      props.publicSubnetNames,
      props.publicSubnetRouteTableIds,
      props.publicSubnetIpv4CidrBlocks,
      SubnetType.PUBLIC,
      this.availabilityZones,
      "publicSubnetIds",
      "publicSubnetNames",
      "publicSubnetRouteTableIds",
      "publicSubnetIpv4CidrBlocks",
    );
    const priv = new ImportSubnetGroup(
      props.privateSubnetIds,
      props.privateSubnetNames,
      props.privateSubnetRouteTableIds,
      props.privateSubnetIpv4CidrBlocks,
      SubnetType.PRIVATE_WITH_EGRESS,
      this.availabilityZones,
      "privateSubnetIds",
      "privateSubnetNames",
      "privateSubnetRouteTableIds",
      "privateSubnetIpv4CidrBlocks",
    );
    const iso = new ImportSubnetGroup(
      props.isolatedSubnetIds,
      props.isolatedSubnetNames,
      props.isolatedSubnetRouteTableIds,
      props.isolatedSubnetIpv4CidrBlocks,
      SubnetType.PRIVATE_ISOLATED,
      this.availabilityZones,
      "isolatedSubnetIds",
      "isolatedSubnetNames",
      "isolatedSubnetRouteTableIds",
      "isolatedSubnetIpv4CidrBlocks",
    );

    this.publicSubnets = pub.import(this);
    this.privateSubnets = priv.import(this);
    this.isolatedSubnets = iso.import(this);
  }

  public get vpcCidrBlock(): string {
    if (this.cidr === undefined) {
      throw new Error(
        "Cannot perform this operation: 'vpcCidrBlock' was not supplied when creating this VPC",
      );
    }
    return this.cidr;
  }
}

// class LookedUpVpc extends VpcBase {
//   public readonly vpcId: string;
//   public readonly vpcArn: string;
//   public readonly internetConnectivityEstablished: IDependable =
//     new DependencyGroup();
//   public readonly availabilityZones: string[];
//   public readonly publicSubnets: ISubnet[];
//   public readonly privateSubnets: ISubnet[];
//   public readonly isolatedSubnets: ISubnet[];
//   private readonly cidr?: string | undefined;

//   constructor(
//     scope: Construct,
//     id: string,
//     props: cxapi.VpcContextResponse,
//     isIncomplete: boolean,
//   ) {
//     super(scope, id, {
//       region: props.region,
//       account: props.ownerAccountId,
//     });

//     this.vpcId = props.vpcId;
//     this.vpcArn = Arn.format(
//       {
//         service: "ec2",
//         resource: "vpc",
//         resourceName: this.vpcId,
//         region: this.env.region,
//         account: this.env.account,
//       },
//       AwsStack.ofAwsConstruct(this),
//     );
//     this.cidr = props.vpcCidrBlock;
//     this._vpnGatewayId = props.vpnGatewayId;
//     this.incompleteSubnetDefinition = isIncomplete;

//     const subnetGroups = props.subnetGroups || [];
//     const availabilityZones = Array.from(
//       new Set<string>(
//         flatMap(subnetGroups, (subnetGroup) => {
//           return subnetGroup.subnets.map((subnet) => subnet.availabilityZone);
//         }),
//       ),
//     );
//     availabilityZones.sort((az1, az2) => az1.localeCompare(az2));
//     this.availabilityZones = availabilityZones;

//     this.publicSubnets = this.extractSubnetsOfType(
//       subnetGroups,
//       cxapi.VpcSubnetGroupType.PUBLIC,
//     );
//     this.privateSubnets = this.extractSubnetsOfType(
//       subnetGroups,
//       cxapi.VpcSubnetGroupType.PRIVATE,
//     );
//     this.isolatedSubnets = this.extractSubnetsOfType(
//       subnetGroups,
//       cxapi.VpcSubnetGroupType.ISOLATED,
//     );
//   }

//   public get vpcCidrBlock(): string {
//     if (this.cidr === undefined) {
//       // Value might be cached from an old CLI version, so bumping the CX API protocol to
//       // force the value to exist would not have helped.
//       throw new Error(
//         "Cannot perform this operation: 'vpcCidrBlock' was not found when looking up this VPC. Use a newer version of the CDK CLI and clear the old context value.",
//       );
//     }
//     return this.cidr;
//   }

//   private extractSubnetsOfType(
//     subnetGroups: cxapi.VpcSubnetGroup[],
//     subnetGroupType: cxapi.VpcSubnetGroupType,
//   ): ISubnet[] {
//     return flatMap(
//       subnetGroups.filter(
//         (subnetGroup) => subnetGroup.type === subnetGroupType,
//       ),
//       (subnetGroup) => this.subnetGroupToSubnets(subnetGroup),
//     );
//   }

//   private subnetGroupToSubnets(subnetGroup: cxapi.VpcSubnetGroup): ISubnet[] {
//     const ret = new Array<ISubnet>();
//     for (let i = 0; i < subnetGroup.subnets.length; i++) {
//       const vpcSubnet = subnetGroup.subnets[i];
//       ret.push(
//         Subnet.fromSubnetAttributes(this, `${subnetGroup.name}Subnet${i + 1}`, {
//           availabilityZone: vpcSubnet.availabilityZone,
//           subnetId: vpcSubnet.subnetId,
//           routeTableId: vpcSubnet.routeTableId,
//           ipv4CidrBlock: vpcSubnet.cidr,
//         }),
//       );
//     }
//     return ret;
//   }
// }

// function flatMap<T, U>(xs: T[], fn: (x: T) => U[]): U[] {
//   const ret = new Array<U>();
//   for (const x of xs) {
//     ret.push(...fn(x));
//   }
//   return ret;
// }

class CompositeDependable implements IDependable {
  private readonly dependables = new Array<IDependable>();

  constructor() {
    const self = this;
    Dependable.implement(this, {
      get dependencyRoots() {
        const ret = new Array<IConstruct>();
        for (const dep of self.dependables) {
          ret.push(...Dependable.of(dep).dependencyRoots);
        }
        return ret;
      },
    });
  }

  /**
   * Add a construct to the dependency roots
   */
  public add(dep: IDependable) {
    this.dependables.push(dep);
  }
}

/**
 * Invoke a function on a value (for its side effect) and return the value
 */
function tap<T>(x: T, fn: (x: T) => void): T {
  fn(x);
  return x;
}

class ImportedSubnet
  extends AwsConstructBase
  implements ISubnet, IPublicSubnet, IPrivateSubnet
{
  public readonly subnetOutputs: SubnetOutputs;
  public get outputs(): Record<string, any> {
    return this.subnetOutputs;
  }
  public readonly internetConnectivityEstablished: IDependable =
    new DependencyGroup();
  public readonly subnetId: string;
  public readonly routeTable: IRouteTable;
  private readonly _availabilityZone?: string;
  private readonly _ipv4CidrBlock?: string;

  constructor(scope: Construct, id: string, attrs: SubnetAttributes) {
    super(scope, id, {
      outputName: attrs.outputName,
      registerOutputs: attrs.registerOutputs,
    });

    if (!attrs.routeTableId) {
      // The following looks a little weird, but comes down to:
      //
      // * Is the subnetId itself unresolved ({ Ref: Subnet }); or
      // * Was it the accidentally extracted first element of a list-encoded
      //   token? ({ Fn::ImportValue: Subnets } => ['#{Token[1234]}'] =>
      //   '#{Token[1234]}'
      //
      // There's no other API to test for the second case than to the string back into
      // a list and see if the combination is Unresolved.
      //
      // In both cases we can't output the subnetId literally into the metadata (because it'll
      // be useless). In the 2nd case even, if we output it to metadata, the `resolve()` call
      // that gets done on the metadata will even `throw`, because the '#{Token}' value will
      // occur in an illegal position (not in a list context).
      const ref =
        Token.isUnresolved(attrs.subnetId) ||
        Token.isUnresolved([attrs.subnetId])
          ? `at '${Node.of(scope).path}/${id}'`
          : `'${attrs.subnetId}'`;

      // "@aws-cdk/aws-ec2:noSubnetRouteTableId",
      Annotations.of(this).addWarning(
        `No routeTableId was provided to the subnet ${ref}. Attempting to read its .routeTable.routeTableId will return null/undefined. (More info: https://github.com/aws/aws-cdk/pull/3171)`,
      );
    }
    const lookup = new dataAwsSubnet.DataAwsSubnet(this, "Resource", {
      id: attrs.subnetId,
    });

    this._ipv4CidrBlock = attrs.ipv4CidrBlock; // ?? lookup.cidrBlock;
    this._availabilityZone = attrs.availabilityZone; // ?? lookup.availabilityZone;
    this.subnetId = attrs.subnetId;
    this.routeTable = {
      // Forcing routeTableId to pretend non-null to maintain backwards-compatibility. See https://github.com/aws/aws-cdk/pull/3171
      routeTableId: attrs.routeTableId!,
    };
    this.subnetOutputs = {
      subnetId: this.subnetId,
      routeTableId: this.routeTable.routeTableId,
      ipv4CidrBlock: lookup.cidrBlock,
    };
  }

  public get availabilityZone(): string {
    if (!this._availabilityZone) {
      throw new Error(
        "You cannot reference a Subnet's availability zone if it was not supplied. Add the availabilityZone when importing using Subnet.fromSubnetAttributes()",
      );
    }
    return this._availabilityZone;
  }

  public get ipv4CidrBlock(): string {
    if (!this._ipv4CidrBlock) {
      // tslint:disable-next-line: max-line-length
      throw new Error(
        "You cannot reference an imported Subnet's IPv4 CIDR if it was not supplied. Add the ipv4CidrBlock when importing using Subnet.fromSubnetAttributes()",
      );
    }
    return this._ipv4CidrBlock;
  }

  public associateNetworkAcl(id: string, networkAcl: INetworkAcl): void {
    const scope = networkAcl instanceof Construct ? networkAcl : this;
    const other = networkAcl instanceof Construct ? this : networkAcl;
    new SubnetNetworkAclAssociation(scope, id + AwsStack.uniqueId(other.node), {
      networkAcl,
      subnet: this,
    });
  }
}

/**
 * Determine (and validate) the NAT gateway count w.r.t. the rest of the subnet configuration
 *
 * We have the following requirements:
 *
 * - NatGatewayCount = 0 ==> there are no private subnets
 * - NatGatewayCount > 0 ==> there must be public subnets
 *
 * Do we want to require that there are private subnets if there are NatGateways?
 * They seem pointless but I see no reason to prevent it.
 */
function determineNatGatewayCount(
  requestedCount: number | undefined,
  subnetConfig: SubnetConfiguration[],
  azCount: number,
) {
  const hasPrivateSubnets = subnetConfig.some(
    (c) =>
      (c.subnetType === SubnetType.PRIVATE_WITH_EGRESS ||
        c.subnetType === SubnetType.PRIVATE ||
        c.subnetType === SubnetType.PRIVATE_WITH_NAT) &&
      !c.reserved,
  );
  const hasPublicSubnets = subnetConfig.some(
    (c) => c.subnetType === SubnetType.PUBLIC && !c.reserved,
  );
  const hasCustomEgress = subnetConfig.some(
    (c) => c.subnetType === SubnetType.PRIVATE_WITH_EGRESS,
  );

  const count =
    requestedCount !== undefined
      ? Math.min(requestedCount, azCount)
      : hasPrivateSubnets
        ? azCount
        : 0;

  if (count === 0 && hasPrivateSubnets && !hasCustomEgress) {
    throw new Error(
      "If you do not want NAT gateways (natGateways=0), make sure you don't configure any PRIVATE(_WITH_NAT) subnets in 'subnetConfiguration' (make them PUBLIC or ISOLATED instead)",
    );
  }

  if (count > 0 && !hasPublicSubnets) {
    throw new Error(
      `If you configure PRIVATE subnets in 'subnetConfiguration', you must also configure PUBLIC subnets to put the NAT gateways into (got ${JSON.stringify(subnetConfig)}.`,
    );
  }

  return count;
}

// /**
//  * There are returned when the provider has not supplied props yet
//  *
//  * It's only used for testing and on the first run-through.
//  */
// const DUMMY_VPC_PROPS: cxapi.VpcContextResponse = {
//   availabilityZones: [],
//   vpcCidrBlock: "1.2.3.4/5",
//   isolatedSubnetIds: undefined,
//   isolatedSubnetNames: undefined,
//   isolatedSubnetRouteTableIds: undefined,
//   privateSubnetIds: undefined,
//   privateSubnetNames: undefined,
//   privateSubnetRouteTableIds: undefined,
//   publicSubnetIds: undefined,
//   publicSubnetNames: undefined,
//   publicSubnetRouteTableIds: undefined,
//   subnetGroups: [
//     {
//       name: "Public",
//       type: cxapi.VpcSubnetGroupType.PUBLIC,
//       subnets: [
//         {
//           availabilityZone: "dummy1a",
//           subnetId: "s-12345",
//           routeTableId: "rtb-12345s",
//           cidr: "1.2.3.4/5",
//         },
//         {
//           availabilityZone: "dummy1b",
//           subnetId: "s-67890",
//           routeTableId: "rtb-67890s",
//           cidr: "1.2.3.4/5",
//         },
//       ],
//     },
//     {
//       name: "Private",
//       type: cxapi.VpcSubnetGroupType.PRIVATE,
//       subnets: [
//         {
//           availabilityZone: "dummy1a",
//           subnetId: "p-12345",
//           routeTableId: "rtb-12345p",
//           cidr: "1.2.3.4/5",
//         },
//         {
//           availabilityZone: "dummy1b",
//           subnetId: "p-67890",
//           routeTableId: "rtb-57890p",
//           cidr: "1.2.3.4/5",
//         },
//       ],
//     },
//     {
//       name: "Isolated",
//       type: cxapi.VpcSubnetGroupType.ISOLATED,
//       subnets: [
//         {
//           availabilityZone: "dummy1a",
//           subnetId: "p-12345",
//           routeTableId: "rtb-12345p",
//           cidr: "1.2.3.4/5",
//         },
//         {
//           availabilityZone: "dummy1b",
//           subnetId: "p-67890",
//           routeTableId: "rtb-57890p",
//           cidr: "1.2.3.4/5",
//         },
//       ],
//     },
//   ],
//   vpcId: "vpc-12345",
// };

// moved due to cycles
// ref: https://github.com/aws/aws-cdk/blob/a2c633f1e698249496f11338312ab42bd7b1e4f0/packages/aws-cdk-lib/aws-ec2/lib/util.ts

// /**
//  * The default names for every subnet type
//  */
// export function defaultSubnetName(type: SubnetType) {
//   switch (type) {
//     case SubnetType.PUBLIC:
//       return "Public";
//     case SubnetType.PRIVATE_WITH_NAT:
//     case SubnetType.PRIVATE_WITH_EGRESS:
//     case SubnetType.PRIVATE:
//       return "Private";
//     case SubnetType.PRIVATE_ISOLATED:
//     case SubnetType.ISOLATED:
//       return "Isolated";
//   }
// }
