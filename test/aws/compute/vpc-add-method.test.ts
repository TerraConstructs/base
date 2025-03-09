// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/@aws-cdk/aws-ec2-alpha/test/vpc-add-method.test.ts

import {
  eip as tfEip,
  egressOnlyInternetGateway,
  route as tfRoute,
  vpnGateway as tfVpnGateway,
  vpnGatewayAttachment as tfVpnGatewayAttachment,
  internetGateway as tfInternetGateway,
  internetGatewayAttachment as tfInternetGatewayAttachment,
  natGateway as tfNatGateway,
  vpcPeeringConnection as tfVpcPeeringConnection,
  vpnGatewayRoutePropagation,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import { NatConnectivityType } from "../../../src/aws/compute/route";
import { IpCidr, SubnetV2 } from "../../../src/aws/compute/subnet-v2";
import { SubnetType } from "../../../src/aws/compute/vpc";
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

describe("Vpc V2 with full control", () => {
  let stack: AwsStack;
  let myVpc: VpcV2;
  let mySubnet: SubnetV2;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    myVpc = new VpcV2(stack, "TestVpc", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.amazonProvidedIpv6({ cidrBlockName: "AmazonProvided" }),
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    mySubnet = new SubnetV2(stack, "TestSubnet", {
      vpc: myVpc,
      ipv4CidrBlock: new IpCidr("10.1.0.0/24"),
      availabilityZone: "ap-south-1b",
      subnetType: SubnetType.PUBLIC,
      ipv6CidrBlock: new IpCidr("2001:db8::/48"),
    });
  });
  test("Method to add a new Egress-Only IGW", () => {
    myVpc.addEgressOnlyInternetGateway({});
    Template.synth(stack).toHaveResource(
      egressOnlyInternetGateway.EgressOnlyInternetGateway,
    );
  });

  test("addEIGW throws error if VPC does not have IPv6", () => {
    const vpc1 = new VpcV2(stack, "TestIpv4Vpc", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
    });
    expect(() => {
      vpc1.addEgressOnlyInternetGateway({});
    }).toThrow("Egress only IGW can only be added to Ipv6 enabled VPC");
  });

  test("addEIGW defines a route under subnet to default destination", () => {
    myVpc.addEgressOnlyInternetGateway({
      subnets: [{ subnetType: SubnetType.PUBLIC }],
    });
    Template.synth(stack).toHaveResourceWithProperties(tfRoute.Route, {
      destination_ipv6_cidr_block: "::/0",
    });
  });

  test("addEIGW defines a route under subnet to given destination", () => {
    myVpc.addEgressOnlyInternetGateway({
      subnets: [{ subnetType: SubnetType.PUBLIC }],
      destination: "::/48",
    });
    Template.synth(stack).toHaveResourceWithProperties(tfRoute.Route, {
      destination_ipv6_cidr_block: "::/48",
    });
  });

  test("addEIGW should not associate a route to an incorrect subnet", () => {
    const vpc1 = new VpcV2(stack, "TestPrivateVpc", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.amazonProvidedIpv6({ cidrBlockName: "AmazonProvided" }),
      ],
    });
    new SubnetV2(stack, "validateIpv6", {
      vpc: vpc1,
      ipv4CidrBlock: new IpCidr("10.1.0.0/24"),
      availabilityZone: "ap-south-1b",
      //Test secondary ipv6 address after IPAM pool creation
      ipv6CidrBlock: new IpCidr("2001:db8::/48"),
      subnetType: SubnetType.PRIVATE_ISOLATED,
    });
    expect(() => {
      vpc1.addEgressOnlyInternetGateway({
        subnets: [{ subnetType: SubnetType.PUBLIC }],
        destination: "::/48",
      });
    }).toThrow(
      "There are no 'Public' subnet groups in this VPC. Available types: Isolated,Deprecated_Isolated",
    );
  });

  test("addNatGateway defines a private gateway", () => {
    myVpc.addNatGateway({
      subnet: mySubnet,
      connectivityType: NatConnectivityType.PRIVATE,
      privateIpAddress: "10.0.0.42",
    });
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      connectivity_type: "private",
      private_ip: "10.0.0.42",
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: [
        "aws_route_table_association.TestSubnet_RouteTableAssociation_FE267B30",
      ],
    });
  });

  test("addNatGateway defines private gateway with secondary IP addresses", () => {
    myVpc.addNatGateway({
      subnet: mySubnet,
      connectivityType: NatConnectivityType.PRIVATE,
      privateIpAddress: "10.0.0.42",
      secondaryPrivateIpAddresses: ["10.0.1.0/28", "10.0.2.0/28"],
    });
    const template = Template.synth(stack);
    // NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      connectivity_type: "private",
      private_ip: "10.0.0.42",
      secondary_private_ip_addresses: ["10.0.1.0/28", "10.0.2.0/28"],
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: [
        "aws_route_table_association.TestSubnet_RouteTableAssociation_FE267B30",
      ],
    });
  });

  test("addNatGateway defines private gateway with secondary IP address count", () => {
    myVpc.addNatGateway({
      subnet: mySubnet,
      connectivityType: NatConnectivityType.PRIVATE,
      privateIpAddress: "10.0.0.42",
      secondaryPrivateIpAddressCount: 2,
    });
    const template = Template.synth(stack);
    // NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      connectivity_type: "private",
      private_ip: "10.0.0.42",
      secondary_private_ip_address_count: 2,
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: [
        "aws_route_table_association.TestSubnet_RouteTableAssociation_FE267B30",
      ],
    });
  });

  test("addNatGateway defines public gateway", () => {
    myVpc.addNatGateway({
      subnet: mySubnet,
    });
    const template = Template.synth(stack);
    // NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: [
        "aws_route_table_association.TestSubnet_RouteTableAssociation_FE267B30",
      ],
    });
    // EIP should be created when not provided
    template.toHaveResourceWithProperties(tfEip.Eip, {
      depends_on: [
        "aws_route_table_association.TestSubnet_RouteTableAssociation_FE267B30",
      ],
    });
  });

  test("addNatGateway defines public gateway with provided EIP", () => {
    const eip = new tfEip.Eip(stack, "MyEIP", {
      domain: myVpc.vpcId,
    });
    myVpc.addNatGateway({
      subnet: mySubnet,
      allocationId: eip.allocationId,
    });
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: [
        "aws_route_table_association.TestSubnet_RouteTableAssociation_FE267B30",
      ],
    });
    // EIP should be in stack
    template.toHaveResourceWithProperties(tfEip.Eip, {
      domain: stack.resolve(myVpc.vpcId),
    });
  });

  test("addNatGateway defines public gateway with many parameters", () => {
    myVpc.addInternetGateway();
    myVpc.addNatGateway({
      subnet: mySubnet,
      connectivityType: NatConnectivityType.PUBLIC,
      maxDrainDuration: Duration.seconds(2001),
    });
    const template = Template.synth(stack);
    // NAT Gateway should be in stack
    template.toHaveResourceWithProperties(tfNatGateway.NatGateway, {
      allocation_id: "${aws_eip.TestVpc_NATGateway_EIP_718631E7.allocation_id}",
      connectivity_type: "public",
      timeouts: {
        // max_drain_duration_seconds: 2001,
        delete: "2001",
      },
      subnet_id: stack.resolve(mySubnet.subnetId),
      depends_on: [
        "aws_route_table_association.TestSubnet_RouteTableAssociation_FE267B30",
      ],
    });
    // EIP should be created when not provided
    template.toHaveResourceWithProperties(tfEip.Eip, {
      depends_on: [
        "aws_route_table_association.TestSubnet_RouteTableAssociation_FE267B30",
      ],
    });
  });

  test("addNatGateway fails for public gateway without IGW attached", () => {
    expect(() => {
      myVpc.addNatGateway({
        subnet: mySubnet,
        connectivityType: NatConnectivityType.PUBLIC,
        maxDrainDuration: Duration.seconds(2001),
      });
    }).toThrow(
      "Cannot add a Public NAT Gateway without an Internet Gateway enabled on VPC",
    );
  });

  test("addinternetGateway defines a new internet gateway with attachment and no route", () => {
    const vpc2 = new VpcV2(stack, "TestVpcNoSubnet", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.amazonProvidedIpv6({ cidrBlockName: "AmazonProvided" }),
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    vpc2.addInternetGateway();
    const template = Template.synth(stack);
    // Internet Gateway should be in stack
    template.toHaveResource(tfInternetGateway.InternetGateway);
    template.toHaveResourceWithProperties(
      tfInternetGatewayAttachment.InternetGatewayAttachment,
      {
        internet_gateway_id:
          "${aws_internet_gateway.TestVpcNoSubnet_InternetGateway_IGW_C957CF52.id}",
        vpc_id: stack.resolve(vpc2.vpcId),
      },
    );
    Template.resources(stack, tfRoute.Route).toHaveLength(0);
  });

  test("addinternetGateway defines a new internet gateway with new route in case of public subnet", () => {
    myVpc.addInternetGateway();
    const template = Template.synth(stack);
    // Internet Gateway should be in stack
    template.toHaveResource(tfInternetGateway.InternetGateway);
    template.toHaveResourceWithProperties(tfRoute.Route, {
      gateway_id:
        "${aws_internet_gateway.TestVpc_InternetGateway_IGW_4C825874.id}",
      route_table_id: "${aws_route_table.TestSubnet_RouteTable_5AF4379E.id}",
      destination_cidr_block: "0.0.0.0/0",
    });
  });

  test("addinternetGateway defines a new internet gateway with Ipv6 route in case of ipv6 enabled subnet", () => {
    myVpc.addInternetGateway();
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfRoute.Route, {
      gateway_id:
        "${aws_internet_gateway.TestVpc_InternetGateway_IGW_4C825874.id}",
      route_table_id: "${aws_route_table.TestSubnet_RouteTable_5AF4379E.id}",
      destination_ipv6_cidr_block: "::/0",
    });
    // both ipv4 and ipv6 routes should be present
    template.toHaveResourceWithProperties(tfRoute.Route, {
      gateway_id:
        "${aws_internet_gateway.TestVpc_InternetGateway_IGW_4C825874.id}",
      route_table_id: "${aws_route_table.TestSubnet_RouteTable_5AF4379E.id}",
      destination_cidr_block: "0.0.0.0/0",
    });
  });

  test("Throws error if there is already an IGW attached", () => {
    myVpc.addInternetGateway();
    expect(() => {
      myVpc.addInternetGateway();
    }).toThrow("The Internet Gateway has already been enabled.");
  });

  test("addinternetGateway defines a new route in case of input destination", () => {
    myVpc.addInternetGateway({
      ipv4Destination: "203.0.113.25",
      ipv6Destination: "2001:db8::/48",
    });
    const template = Template.synth(stack);
    //Route for custom IPv4 destination
    template.toHaveResourceWithProperties(tfRoute.Route, {
      gateway_id:
        "${aws_internet_gateway.TestVpc_InternetGateway_IGW_4C825874.id}",
      route_table_id: "${aws_route_table.TestSubnet_RouteTable_5AF4379E.id}",
      destination_cidr_block: "203.0.113.25",
    });
    //Route for custom IPv6 destination
    template.toHaveResourceWithProperties(tfRoute.Route, {
      gateway_id:
        "${aws_internet_gateway.TestVpc_InternetGateway_IGW_4C825874.id}",
      route_table_id: "${aws_route_table.TestSubnet_RouteTable_5AF4379E.id}",
      destination_ipv6_cidr_block: "2001:db8::/48",
    });
  });

  //Tests for VPNGatewayV2
  test("enableVpnGatewayV2 defines a new VPNGateway with attachment", () => {
    const vpnGw = myVpc.enableVpnGatewayV2({
      type: VpnConnectionType.IPSEC_1,
    });
    const t = new Template(stack);
    t.expect.toHaveResource(tfVpnGateway.VpnGateway);
    t.expect.toHaveResourceWithProperties(
      tfVpnGatewayAttachment.VpnGatewayAttachment,
      {
        vpn_gateway_id: stack.resolve(vpnGw.routerTargetId),
        vpc_id: stack.resolve(myVpc.vpcId),
      },
    );
  });

  test("check vpngateway has correct connection type", () => {
    myVpc.enableVpnGatewayV2({
      type: VpnConnectionType.IPSEC_1,
    });
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpnGatewayAttachment.VpnGatewayAttachment,
      {
        // Type: "ipsec.1",
        vpc_id: stack.resolve(myVpc.vpcId),
      },
    );
  });

  test("Check vpngateway has route Propagation for input subnets", () => {
    const vpnGw = myVpc.enableVpnGatewayV2({
      type: VpnConnectionType.IPSEC_1,
      vpnRoutePropagation: [{ subnetType: SubnetType.PUBLIC }],
    });
    Template.synth(stack).toHaveResourceWithProperties(
      vpnGatewayRoutePropagation.VpnGatewayRoutePropagation,
      {
        vpn_gateway_id: stack.resolve(vpnGw.routerTargetId),
        route_table_id: "${aws_route_table.TestSubnet_RouteTable_5AF4379E.id}",
      },
    );
  });

  test("Throws error when no subnet identified for route propagation", () => {
    expect(() => {
      myVpc.enableVpnGatewayV2({
        type: VpnConnectionType.IPSEC_1,
        vpnRoutePropagation: [{ subnetType: SubnetType.PRIVATE_ISOLATED }],
      });
    }).toThrow(
      "There are no 'Isolated' subnet groups in this VPC. Available types: Public",
    );
  });

  test("Throws error when VPN GW is already enabled", () => {
    myVpc.enableVpnGatewayV2({ type: VpnConnectionType.IPSEC_1 });
    expect(() => {
      myVpc.enableVpnGatewayV2({ type: VpnConnectionType.IPSEC_1 });
    }).toThrow("The VPN Gateway has already been enabled.");
  });

  test("createAcceptorVpcRole creates a restricted role", () => {
    myVpc.createAcceptorVpcRole("123456789012");
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "arn:${data.aws_partition.Partitition.partition}:iam::123456789012:root",
                ],
                type: "AWS",
              },
            ],
            // principals: {
            //   AWS: {
            //     "Fn::Join": [
            //       "",
            //       [
            //         "arn:",
            //         { Ref: "AWS::Partition" },
            //         ":iam::123456789012:root",
            //       ],
            //     ],
            //   },
            // },
          },
        ],
      },
    );
  });

  test("createPeeringConnection establishes connection between 2 VPCs", () => {
    const acceptorVpc = new VpcV2(stack, "TestAcceptorVpc", {
      primaryAddressBlock: IpAddresses.ipv4("10.0.0.0/16"),
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    myVpc.createPeeringConnection("testPeeringConnection", {
      acceptorVpc: acceptorVpc,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcPeeringConnection.VpcPeeringConnection,
      {
        vpc_id: stack.resolve(myVpc.vpcId),
        peer_vpc_id: stack.resolve(acceptorVpc.vpcId),
        peer_owner_id: "${data.aws_caller_identity.CallerIdentity.account_id}",
        peer_region: providerConfig.region,
      },
    );
  });
});
