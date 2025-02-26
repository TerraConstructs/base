import {
  eip as tfEip,
  egressOnlyInternetGateway,
  route as tfRoute,
  vpnGateway as tfVpnGateway,
  vpnGatewayAttachment as tfVpnGatewayAttachment,
  internetGateway as tfInternetGateway,
  internetGatewayAttachment as tfInternetGatewayAttachment,
  natGateway as tfNatGateway,
  vpcEndpoint as tfVpcEndpoint,
  vpcPeeringConnection as tfVpcPeeringConnection,
} from "@cdktf/provider-aws";
import { Testing, Fn } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  RouteTable,
  EgressOnlyInternetGateway,
  VPNGatewayV2,
  InternetGateway,
  NatGateway,
  NatConnectivityType,
  VPCPeeringConnection,
} from "../../../src/aws/compute/route";
import { SubnetV2, IpCidr } from "../../../src/aws/compute/subnet-v2";
import { SubnetType } from "../../../src/aws/compute/vpc";
import {
  GatewayVpcEndpoint,
  GatewayVpcEndpointAwsService,
} from "../../../src/aws/compute/vpc-endpoint";
import { VpcV2, IpAddresses } from "../../../src/aws/compute/vpc-v2";
import { VpnConnectionType } from "../../../src/aws/compute/vpn";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("EC2 Routing", () => {
  let stack: AwsStack;
  let myVpc: VpcV2;
  let mySubnet: SubnetV2;
  let routeTable: RouteTable;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    myVpc = new VpcV2(stack, "TestVpc", {
      primaryAddressBlock: IpAddresses.ipv4("10.0.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.amazonProvidedIpv6({
          cidrBlockName: "AmazonIpv6",
        }),
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    routeTable = new RouteTable(stack, "TestRouteTable", {
      vpc: myVpc,
    });
    mySubnet = new SubnetV2(stack, "TestSubnet", {
      vpc: myVpc,
      availabilityZone: "us-east-1a",
      ipv4CidrBlock: new IpCidr("10.0.0.0/24"),
      ipv6CidrBlock: new IpCidr(Fn.element(myVpc.ipv6CidrBlocks, 0)),
      subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      routeTable: routeTable,
    });
  });

  test("Route to EIGW [IPv6 only]", () => {
    const eigw = new EgressOnlyInternetGateway(stack, "TestEIGW", {
      vpc: myVpc,
    });
    routeTable.addRoute("Route", "::/0", { gateway: eigw });

    const template = Template.synth(stack);
    // EIGW should be in stack
    template.toHaveResourceWithProperties(
      egressOnlyInternetGateway.EgressOnlyInternetGateway,
      {
        vpc_id: stack.resolve(myVpc.vpcId),
      },
    );
    // Route linking IP to EIGW should be in stack
    template.toHaveResourceWithProperties(tfRoute.Route, {
      destination_ipv6_cidr_block: "::/0",
      egress_only_gateway_id: stack.resolve(eigw.routerTargetId),
      route_table_id: stack.resolve(routeTable.routeTableId),
    });
  });

  test("Route to VPN Gateway", () => {
    const vpngw = new VPNGatewayV2(stack, "TestVpnGw", {
      type: VpnConnectionType.IPSEC_1,
      vpc: myVpc,
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { gateway: vpngw });
    const template = Template.synth(stack);
    // VPN Gateway should be in stack
    template.toHaveResourceWithProperties(tfVpnGateway.VpnGateway, {
      vpc_id: stack.resolve(myVpc.vpcId),
      // NOTE: TF Provider does not expose type, only "ipsec.1" is valid anyway...
      // type: "ipsec.1",
    });
    // Route linking IP to VPN GW should be in stack
    template.toHaveResourceWithProperties(tfRoute.Route, {
      destination_cidr_block: "0.0.0.0/0",
      gateway_id: stack.resolve(vpngw.routerTargetId),
      route_table_id: stack.resolve(routeTable.routeTableId),
    });
    // Route Gateway attachment should be in stack
    template.toHaveResourceWithProperties(
      tfVpnGatewayAttachment.VpnGatewayAttachment,
      {
        vpc_id: stack.resolve(myVpc.vpcId),
        vpn_gateway_id: stack.resolve(vpngw.routerTargetId),
      },
    );
  }),
    test("Route to VPN Gateway with optional properties", () => {
      new VPNGatewayV2(stack, "TestVpnGw", {
        type: VpnConnectionType.IPSEC_1,
        vpc: myVpc,
        amazonSideAsn: 12345678,
      });
      // VPN Gateway should be in stack
      Template.synth(stack).toHaveResourceWithProperties(
        tfVpnGatewayAttachment.VpnGatewayAttachment,
        {
          // type: "ipsec.1",
          amazon_side_asn: 12345678,
        },
      );
    }),
    test("Route to Internet Gateway", () => {
      const igw = new InternetGateway(stack, "TestIGW", {
        vpc: myVpc,
      });
      routeTable.addRoute("Route", "0.0.0.0/0", { gateway: igw });
      const template = Template.fromStack(stack);
      // Internet Gateway should be in stack
      template.toHaveResource(tfInternetGateway.InternetGateway);
      // Route linking IP to IGW should be in stack
      template.toHaveResourceWithProperties(tfRoute.Route, {
        destination_cidr_block: "0.0.0.0/0",
        gateway_id: stack.resolve(igw.routerTargetId),
        route_table_id: stack.resolve(routeTable.routeTableId),
      });
      // Route Gateway attachment should be in stack
      template.toHaveResourceWithProperties(
        tfInternetGatewayAttachment.InternetGatewayAttachment,
        {
          vpc_id: stack.resolve(myVpc.vpcId),
          internet_gateway_id: stack.resolve(igw.routerTargetId),
        },
      );
    });

  test("Route to private NAT Gateway", () => {
    const natgw = new NatGateway(stack, "TestNATGW", {
      subnet: mySubnet,
      connectivityType: NatConnectivityType.PRIVATE,
      privateIpAddress: "10.0.0.42",
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { gateway: natgw });
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      connectivity_type: "private",
      private_ip_address: "10.0.0.42",
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: ["TestSubnetRouteTableAssociationFE267B30"],
    });
    // Route linking private IP to NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfRoute.Route, {
      destination_cidr_block: "0.0.0.0/0",
      nat_gatewa_id: stack.resolve(natgw.routerTargetId),
      route_table_id: stack.resolve(routeTable.routeTableId),
    });
  });

  test("Route to private NAT Gateway with secondary IP addresses", () => {
    const natgw = new NatGateway(stack, "TestNATGW", {
      subnet: mySubnet,
      connectivityType: NatConnectivityType.PRIVATE,
      privateIpAddress: "10.0.0.42",
      secondaryPrivateIpAddresses: ["10.0.1.0/28", "10.0.2.0/28"],
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { gateway: natgw });
    const template = Template.synth(stack);
    // NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      connectivity_type: "private",
      private_ip_address: "10.0.0.42",
      secondary_private_ip_addresses: ["10.0.1.0/28", "10.0.2.0/28"],
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: ["TestSubnetRouteTableAssociationFE267B30"],
    });
  });

  test("Route to private NAT Gateway with secondary IP count", () => {
    const natgw = new NatGateway(stack, "TestNATGW", {
      subnet: mySubnet,
      connectivityType: NatConnectivityType.PRIVATE,
      privateIpAddress: "10.0.0.42",
      secondaryPrivateIpAddressCount: 2,
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { gateway: natgw });
    const template = Template.synth(stack);
    // NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      connectivity_type: "private",
      private_ip_address: "10.0.0.42",
      secondary_private_ip_address_count: 2,
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: ["TestSubnetRouteTableAssociationFE267B30"],
    });
    // Route linking private IP to NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfRoute.Route, {
      destination_cidr_block: "0.0.0.0/0",
      nat_gatewa_id: stack.resolve(natgw.routerTargetId),
      route_table_id: stack.resolve(routeTable.routeTableId),
    });
  });

  test("Route to public NAT Gateway", () => {
    const natgw = new NatGateway(stack, "TestNATGW", {
      subnet: mySubnet,
      vpc: myVpc,
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { gateway: natgw });
    const template = Template.synth(stack);
    // NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: ["TestSubnetRouteTableAssociationFE267B30"],
    });
    // Route linking private IP to NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfRoute.Route, {
      destination_cidr_block: "0.0.0.0/0",
      nat_gatewa_id: stack.resolve(natgw.routerTargetId),
      route_table_id: stack.resolve(routeTable.routeTableId),
    });
    // EIP should be created when not provided
    template.toHaveResourceWithProperties(tfEip.Eip, {
      depends_on: ["TestSubnetRouteTableAssociationFE267B30"],
    });
  });

  test("Route to public NAT Gateway with provided EIP", () => {
    const eip = new tfEip.Eip(stack, "MyEIP", {
      domain: myVpc.vpcId,
    });
    const natgw = new NatGateway(stack, "TestNATGW", {
      subnet: mySubnet,
      allocationId: eip.allocationId,
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { gateway: natgw });
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: ["TestSubnetRouteTableAssociationFE267B30"],
    });
    // Route linking private IP to NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfRoute.Route, {
      destination_cidr_block: "0.0.0.0/0",
      nat_gatewa_id: stack.resolve(natgw.routerTargetId),
      route_table_id: stack.resolve(routeTable.routeTableId),
    });
    // EIP should be in stack
    template.toHaveResourceWithProperties(tfEip.Eip, {
      domain: stack.resolve(myVpc.vpcId),
    });
  });

  test("Route to public NAT Gateway with many parameters", () => {
    const natgw = new NatGateway(stack, "TestNATGW", {
      subnet: mySubnet,
      connectivityType: NatConnectivityType.PUBLIC,
      maxDrainDuration: Duration.seconds(2001),
      vpc: myVpc,
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { gateway: natgw });
    const template = Template.synth(stack);
    // NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      subnet_id: stack.resolve(mySubnet.subnetId),
      connectivity_type: "public",
      // MaxDrainDurationSeconds: 2001,
      depends_on: ["TestSubnetRouteTableAssociationFE267B30"],
      timeouts: {
        delete: 2001,
      },
    });
    // Route linking private IP to NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfRoute.Route, {
      destination_cidr_block: "0.0.0.0/0",
      nat_gatewa_id: stack.resolve(natgw.routerTargetId),
      route_table_id: stack.resolve(routeTable.routeTableId),
    });
    // EIP should be created when not provided
    template.toHaveResourceWithProperties(tfEip.Eip, {
      depends_on: ["TestSubnetRouteTableAssociationFE267B30"],
    });
  });

  test("Route to DynamoDB Endpoint", () => {
    const dynamodb = new GatewayVpcEndpoint(stack, "TestDB", {
      vpc: myVpc,
      service: GatewayVpcEndpointAwsService.DYNAMODB,
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { endpoint: dynamodb });
    // DynamoDB endpoint should be in stack
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcEndpoint.VpcEndpoint,
      {
        route_table_ids: [stack.resolve(routeTable.routeTableId)],
        service_name: "com.amazonaws.${AWS::Region}.dynamodb",
        vpc_endpoint_type: "Gateway",
        vpc_id: stack.resolve(myVpc.vpcId),
      },
    );
  });

  test("Route to S3 Endpoint", () => {
    const dynamodb = new GatewayVpcEndpoint(stack, "TestS3", {
      vpc: myVpc,
      service: GatewayVpcEndpointAwsService.S3,
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { endpoint: dynamodb });
    // S3 endpoint should be in stack
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcEndpoint.VpcEndpoint,
      {
        route_table_ids: [stack.resolve(routeTable.routeTableId)],
        service_name: "com.amazonaws.${AWS::Region}.s3",
        vpc_endpoint_type: "Gateway",
        vpc_id: stack.resolve(myVpc.vpcId),
      },
    );
  });

  test("Route to S3 Express Endpoint", () => {
    const dynamodb = new GatewayVpcEndpoint(stack, "TestS3E", {
      vpc: myVpc,
      service: GatewayVpcEndpointAwsService.S3_EXPRESS,
    });
    routeTable.addRoute("Route", "0.0.0.0/0", { endpoint: dynamodb });
    // S3 endpoint should be in stack
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcEndpoint.VpcEndpoint,
      {
        route_table_ids: [stack.resolve(routeTable.routeTableId)],
        service_name: "com.amazonaws.${AWS::Region}.s3express",
        vpc_endpoint_type: "Gateway",
        vpc_id: stack.resolve(myVpc.vpcId),
      },
    );
  });
});

describe("VPCPeeringConnection", () => {
  let stackA: AwsStack;
  let stackB: AwsStack;
  let stackC: AwsStack;

  let vpcA: VpcV2;
  let vpcB: VpcV2;
  let vpcC: VpcV2;

  beforeEach(() => {
    const app = Testing.app();

    // TODO: Support cross Account Apps
    // stackA = new AwsStack(app, "VpcStackA", {
    //   env: { account: "234567890123", region: "us-east-1" },
    // });
    const providerConfigB = { region: "us-east-1" };
    stackB = new AwsStack(app, "VpcStackB", {
      environmentName,
      gridUUID,
      providerConfig: providerConfigB,
      gridBackendConfig,
      // env: { account: "123456789012", region: "us-east-1" },
    });
    const providerConfigC = { region: "us-west-2" };
    stackC = new AwsStack(app, "VpcStackC", {
      environmentName,
      gridUUID,
      providerConfig: providerConfigC,
      gridBackendConfig,
      // env: { account: "123456789012", region: "us-west-2" },
      // crossRegionReferences: true,
    });

    // vpcA = new VpcV2(stackA, "VpcA", {
    //   primaryAddressBlock: IpAddresses.ipv4("10.0.0.0/16"),
    //   secondaryAddressBlocks: [
    //     IpAddresses.ipv4("10.1.0.0/16", {
    //       cidrBlockName: "TempSecondaryBlock",
    //     }),
    //   ],
    // });
    vpcB = new VpcV2(stackB, "VpcB", {
      primaryAddressBlock: IpAddresses.ipv4("10.2.0.0/16"),
    });
    vpcC = new VpcV2(stackC, "VpcC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
    });
  });

  // test("Creates a cross account VPC peering connection", () => {
  //   const importedVpcB = VpcV2.fromVpcV2Attributes(stackA, "VpcB", {
  //     vpcId: "mockVpcBId", //cross account stack references are not supported
  //     vpcCidrBlock: "10.2.0.0/16",
  //     region: vpcB.env.region,
  //     ownerAccountId: "123456789012",
  //   });

  //   new VPCPeeringConnection(stackA, "TestPeeringConnection", {
  //     requestorVpc: vpcA,
  //     acceptorVpc: importedVpcB,
  //     peerRoleArn: "arn:aws:iam::012345678910:role/VpcPeeringRole",
  //   });
  //   const template = Template.fromStack(stackA);
  //   template.hasResourceProperties("AWS::EC2::VPCPeeringConnection", {
  //     PeerRoleArn: "arn:aws:iam::012345678910:role/VpcPeeringRole",
  //     VpcId: {
  //       "Fn::GetAtt": ["VpcAAD85CA4C", "VpcId"],
  //     },
  //     PeerVpcId: "mockVpcBId",
  //     PeerOwnerId: "123456789012",
  //     PeerRegion: "us-east-1",
  //   });
  // });

  test("Creates a cross region VPC peering connection", () => {
    const importedVpcC = VpcV2.fromVpcV2Attributes(stackB, "VpcB", {
      vpcId: "mockVpcCId", //cross account stack references are not supported
      vpcCidrBlock: "10.3.0.0/16",
      region: vpcC.env.region,
      ownerAccountId: "123456789012",
    });

    new VPCPeeringConnection(stackB, "TestCrossRegionPeeringConnection", {
      requestorVpc: vpcB,
      acceptorVpc: importedVpcC,
    });

    // TODO: Add aws_vpc_peering_connection_accepter to manage Accepter Side?
    Template.synth(stackB).toHaveResourceWithProperties(
      tfVpcPeeringConnection.VpcPeeringConnection,
      {
        vpc_id: stackB.resolve(vpcB.vpcId),
        peer_vpc_id: "mockVpcCId",
        peer_owner_id: "123456789012",
        peer_region: "us-west-2",
      },
    );
  });

  // test("Throws error when peerRoleArn is not provided for cross-account peering", () => {
  //   expect(() => {
  //     new VPCPeeringConnection(stackA, "TestCrossAccountPeeringConnection", {
  //       requestorVpc: vpcA,
  //       acceptorVpc: vpcB,
  //     });
  //   }).toThrow(/Cross account VPC peering requires peerRoleArn/);
  // });

  // test("Throws error when peerRoleArn is provided for same account peering", () => {
  //   expect(() => {
  //     new VPCPeeringConnection(stackB, "TestPeeringConnection", {
  //       requestorVpc: vpcB,
  //       acceptorVpc: vpcC,
  //       peerRoleArn: "arn:aws:iam::123456789012:role/unnecessary-role",
  //     });
  //   }).toThrow(/peerRoleArn is not needed for same account peering/);
  // });

  // test("CIDR block overlap with secondary CIDR block should throw error", () => {
  //   expect(() => {
  //     new VPCPeeringConnection(stackA, "TestPeering", {
  //       requestorVpc: vpcA,
  //       acceptorVpc: vpcC,
  //       peerRoleArn: "arn:aws:iam::012345678910:role/VpcPeeringRole",
  //     });
  //   }).toThrow(
  //     /CIDR block should not overlap with each other for establishing a peering connection/,
  //   );
  // });

  // test("CIDR block overlap with primary CIDR block should throw error", () => {
  //   const vpcD = new VpcV2(stackA, "VpcD", {
  //     primaryAddressBlock: IpAddresses.ipv4("10.0.0.0/16"),
  //   });

  //   expect(() => {
  //     new VPCPeeringConnection(stackA, "TestPeering", {
  //       requestorVpc: vpcA,
  //       acceptorVpc: vpcD,
  //     });
  //   }).toThrow(
  //     /CIDR block should not overlap with each other for establishing a peering connection/,
  //   );
  // });
});
