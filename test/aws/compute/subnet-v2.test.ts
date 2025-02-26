// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/@aws-cdk/aws-ec2-alpha/test/subnet-v2.test.ts

import { networkAclAssociation as tfNetworkAclAssociation } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { createTestSubnet } from "./alpha-util";
import { AwsStack } from "../../../src/aws";
import {
  AddressFamily,
  Ipam,
  IpamPoolPublicIpSource,
  AwsServiceName,
} from "../../../src/aws/compute/ipam";
import { NetworkAcl } from "../../../src/aws/compute/network-acl";
import { IpCidr, SubnetV2 } from "../../../src/aws/compute/subnet-v2";
import { SubnetType } from "../../../src/aws/compute/vpc";
import { VpcV2, IpAddresses } from "../../../src/aws/compute/vpc-v2";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

/**
 * Test suite for the SubnetV2 class.
 * Verifies the correct behavior and functionality of creating and managing subnets within a VpcV2 instance.
 */
describe("Subnet V2 with custom IP and routing", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "IPAMTestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("should create a subnet with valid input parameters", () => {
    const testVpc = new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv4("10.2.0.0/16", {
          cidrBlockName: "Secondary1",
        }),
      ],
    });

    const subnetConfig = {
      vpcV2: testVpc,
      availabilityZone: "us-east-1a",
      cidrBlock: new IpCidr("10.1.0.0/24"),
      subnetType: SubnetType.PUBLIC,
    };

    createTestSubnet(stack, subnetConfig);

    Template.fromStack(stack, { snapshot: true }).toMatchObject({
      Resources: {
        TestVPCD26570D8: {
          Type: "AWS::EC2::VPC",
          Properties: {
            CidrBlock: "10.1.0.0/16",
          },
        },
        TestSubnet2A4BE4CA: {
          Type: "AWS::EC2::Subnet",
          Properties: {
            CidrBlock: "10.1.0.0/24",
            AvailabilityZone: "us-east-1a",
            VpcId: {
              "Fn::GetAtt": ["TestVPCD26570D8", "VpcId"],
            },
          },
        },
      },
    });
  });

  test("Should throw error if overlapping CIDR block(IPv4) for the subnet", () => {
    const testVPC = new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv4("10.2.0.0/16", {
          cidrBlockName: "Secondary1",
        }),
      ],
    });

    const subnetConfig = {
      vpcV2: testVPC,
      availabilityZone: "us-east-1a",
      cidrBlock: new IpCidr("10.1.0.0/24"),
      subnetType: SubnetType.PUBLIC,
    };

    createTestSubnet(stack, subnetConfig);

    // Define a second subnet with an overlapping CIDR range
    expect(
      () =>
        new SubnetV2(stack, "InvalidSubnet", {
          vpc: testVPC,
          ipv4CidrBlock: new IpCidr("10.1.0.0/24"),
          availabilityZone: "us-east-1a",
          subnetType: SubnetType.PUBLIC,
        }),
    ).toThrow("CIDR block should not overlap with existing subnet blocks");
  });

  test("Should throw error if invalid CIDR block", () => {
    const testVPC = new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv4("10.2.0.0/16", {
          cidrBlockName: "Secondary1",
        }),
      ],
    });

    expect(
      () =>
        new SubnetV2(stack, "TestSubnet", {
          vpc: testVPC,
          ipv4CidrBlock: new IpCidr("10.3.0.0/23"),
          availabilityZone: "us-east-1a",
          subnetType: SubnetType.PUBLIC,
        }),
    ).toThrow("CIDR block should be within the range of VPC");
  });

  test("Should throw error if VPC does not support IPv6", () => {
    const TestVPC = new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv4("10.2.0.0/16", {
          cidrBlockName: "Secondary1",
        }),
      ],
    });
    expect(
      () =>
        new SubnetV2(stack, "TestSubnet", {
          vpc: TestVPC,
          ipv4CidrBlock: new IpCidr("10.1.0.0/24"),
          ipv6CidrBlock: new IpCidr("2001:db8:1::/64"),
          availabilityZone: "us-east-1a",
          subnetType: SubnetType.PUBLIC,
        }),
    ).toThrow("To use IPv6, the VPC must enable IPv6 support.");
  });

  test("Create Subnet with IPv6 if it is Amazon Provided Ipv6 is enabled on VPC", () => {
    const testVPC = new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.amazonProvidedIpv6({
          cidrBlockName: "AmazonIpv6",
        }),
      ],
    });

    const subnetConfig = {
      vpcV2: testVPC,
      availabilityZone: "us-east-1a",
      cidrBlock: new IpCidr("10.1.0.0/24"),
      ipv6Cidr: new IpCidr("2001:db8:1::/64"),
      subnetType: SubnetType.PUBLIC,
    };
    createTestSubnet(stack, subnetConfig);
    Template.fromStack(stack, { snapshot: true }).toMatchObject({
      Resources: {
        TestVPCD26570D8: {
          Type: "AWS::EC2::VPC",
          Properties: {
            CidrBlock: "10.1.0.0/16",
          },
        },
        TestSubnet2A4BE4CA: {
          Type: "AWS::EC2::Subnet",
          Properties: {
            CidrBlock: "10.1.0.0/24",
            AvailabilityZone: "us-east-1a",
            VpcId: {
              "Fn::GetAtt": ["TestVPCD26570D8", "VpcId"],
            },
            Ipv6CidrBlock: "2001:db8:1::/64",
          },
        },
      },
    });
  });

  test("Create Subnet with IPv6 if it is Ipam Ipv6 is enabled on VPC", () => {
    const ipam = new Ipam(stack, "TestIpam", {
      operatingRegion: ["us-west-1"],
    });
    const pool = ipam.publicScope.addPool("PublicPool0", {
      addressFamily: AddressFamily.IP_V6,
      awsService: AwsServiceName.EC2,
      publicIpSource: IpamPoolPublicIpSource.AMAZON,
      locale: "us-west-1",
    });
    const TestVPC = new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv6Ipam({
          ipamPool: pool,
          netmaskLength: 60,
          cidrBlockName: "ipv6Ipam",
        }),
      ],
    });

    new SubnetV2(stack, "IpamSubnet", {
      vpc: TestVPC,
      ipv4CidrBlock: new IpCidr("10.1.0.0/24"),
      ipv6CidrBlock: new IpCidr("2001:db8:1::/64"),
      availabilityZone: "us-east-1a",
      subnetType: SubnetType.PUBLIC,
    });
    Template.fromStack(stack, { snapshot: true }).toMatchObject({
      Resources: {
        TestIpamDBF92BA8: { Type: "AWS::EC2::IPAM" },
        TestIpamPublicPool0588A338B: {
          Type: "AWS::EC2::IPAMPool",
          Properties: {
            AddressFamily: "ipv6",
            IpamScopeId: {
              "Fn::GetAtt": ["TestIpamDBF92BA8", "PublicDefaultScopeId"],
            },
          },
        },
        TestVPCD26570D8: { Type: "AWS::EC2::VPC" },
        TestVPCipv6IpamFF061725: { Type: "AWS::EC2::VPCCidrBlock" },
        IpamSubnet78671F8A: {
          Type: "AWS::EC2::Subnet",
          Properties: {
            CidrBlock: "10.1.0.0/24",
            AvailabilityZone: "us-east-1a",
            VpcId: { "Fn::GetAtt": ["TestVPCD26570D8", "VpcId"] },
            Ipv6CidrBlock: "2001:db8:1::/64",
          },
        },
      },
    });
  });

  test("Should throw error if overlapping CIDR block(IPv6) for the subnet", () => {
    const ipam = new Ipam(stack, "TestIpam", {
      operatingRegion: ["us-west-1"],
    });
    const pool = ipam.publicScope.addPool("PublicPool0", {
      addressFamily: AddressFamily.IP_V6,
      awsService: AwsServiceName.EC2,
      publicIpSource: IpamPoolPublicIpSource.AMAZON,
      locale: "us-west-1",
    });
    const testVPC = new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv6Ipam({
          ipamPool: pool,
          netmaskLength: 60,
          cidrBlockName: "ipv6Ipam",
        }),
      ],
    });

    const subnetConfig = {
      vpcV2: testVPC,
      availabilityZone: "us-east-1a",
      cidrBlock: new IpCidr("10.1.0.0/24"),
      ipv6CidrBlock: new IpCidr("2001:db8:1::/64"),
      subnetType: SubnetType.PUBLIC,
    };
    createTestSubnet(stack, subnetConfig);

    // Define a second subnet with an overlapping CIDR range
    expect(
      () =>
        new SubnetV2(stack, "OverlappingSubnet", {
          vpc: testVPC,
          ipv4CidrBlock: new IpCidr("10.1.0.0/24"),
          ipv6CidrBlock: new IpCidr("2001:db8:1:1::/64"),
          availabilityZone: "us-east-1a",
          subnetType: SubnetType.PUBLIC,
        }),
    ).toThrow("CIDR block should not overlap with existing subnet blocks");
  });

  test("should store the subnet to VPC by subnet type", () => {
    const testVPC = new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
    });

    const subnetConfig = {
      vpcV2: testVPC,
      availabilityZone: "us-east-1a",
      cidrBlock: new IpCidr("10.1.0.0/24"),
      subnetType: SubnetType.PUBLIC,
    };
    const testsubnet = createTestSubnet(stack, subnetConfig);

    /**
     * Test case: Verify that the subnet is correctly stored in the VPC's collection of public subnets.
     * Expected outcome: The testsubnet should be the only public subnet in the VPC.
     */
    expect(testVPC.publicSubnets.length).toEqual(1);
    expect(testVPC.publicSubnets[0]).toEqual(testsubnet);
  });

  test("should associate a NetworkAcl with the subnet", () => {
    const testVpc = new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
    });

    const subnetConfig = {
      vpcV2: testVpc,
      availabilityZone: "us-east-1a",
      cidrBlock: new IpCidr("10.1.0.0/24"),
      subnetType: SubnetType.PUBLIC,
    };
    const testsubnet = createTestSubnet(stack, subnetConfig);

    const networkAcl = new NetworkAcl(stack, "TestNetworkAcl", {
      vpc: testVpc,
    });

    testsubnet.associateNetworkAcl("TestAssociation", networkAcl);

    expect(
      Template.synth(stack).toHaveResource(
        tfNetworkAclAssociation.NetworkAclAssociation,
      ),
    );
  });
});
