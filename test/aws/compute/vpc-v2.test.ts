// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/@aws-cdk/aws-ec2-alpha/test/vpc-v2.test.ts

import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  AddressFamily,
  Ipam,
  IpamPoolPublicIpSource,
  AwsServiceName,
} from "../../../src/aws/compute/ipam";
import { VpcV2, IpAddresses } from "../../../src/aws/compute/vpc-v2";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("Vpc V2 with full control", () => {
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

  test("VPC with primary address", () => {
    new VpcV2(stack, "TestVpc", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    Template.fromStack(stack, { snapshot: true }).toMatchObject({
      Resources: {
        TestVpcE77CE678: {
          Type: "AWS::EC2::VPC",
          Properties: {
            CidrBlock: "10.1.0.0/16",
            EnableDnsHostnames: true,
            EnableDnsSupport: true,
          },
        },
      },
    });
  });

  test("VPC with secondary IPv4 address", () => {
    new VpcV2(stack, "TestVpc", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv4("10.2.0.0/16", {
          cidrBlockName: "SecondaryAddress",
        }),
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    Template.fromStack(stack, { snapshot: true }).toMatchObject({
      Resources: {
        TestVpcE77CE678: {
          Type: "AWS::EC2::VPC",
          Properties: {
            CidrBlock: "10.1.0.0/16",
            EnableDnsHostnames: true,
            EnableDnsSupport: true,
          },
        },
        TestVpcSecondaryAddress72BC831D: {
          Type: "AWS::EC2::VPCCidrBlock",
          Properties: {
            VpcId: {
              "Fn::GetAtt": ["TestVpcE77CE678", "VpcId"],
            },
          },
        },
      },
    });
  });

  test("VPC throws error with incorrect cidr range (IPv4)", () => {
    expect(() => {
      new VpcV2(stack, "TestVpc", {
        primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
        secondaryAddressBlocks: [
          IpAddresses.ipv4("192.168.0.0/16", {
            cidrBlockName: "SecondaryIpv4",
          }),
        ],
        enableDnsHostnames: true,
        enableDnsSupport: true,
      });
    }).toThrow("CIDR block should be in the same RFC 1918 range in the VPC");
  });

  test("VPC supports secondary Amazon Provided IPv6 address", () => {
    new VpcV2(stack, "TestVpc", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.amazonProvidedIpv6({ cidrBlockName: "AmazonProvided" }),
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    Template.fromStack(stack, { snapshot: true }).toMatchObject({
      Resources: {
        TestVpcE77CE678: {
          Type: "AWS::EC2::VPC",
          Properties: {
            CidrBlock: "10.1.0.0/16",
            EnableDnsHostnames: true,
            EnableDnsSupport: true,
          },
        },
        TestVpcAmazonProvided00BF109D: {
          Type: "AWS::EC2::VPCCidrBlock",
          Properties: {
            AmazonProvidedIpv6CidrBlock: true, //Amazon Provided IPv6 address
            VpcId: {
              "Fn::GetAtt": ["TestVpcE77CE678", "VpcId"],
            },
          },
        },
      },
    });
  });

  test("VPC Primary IP from Ipv4 Ipam", () => {
    const ipam = new Ipam(stack, "TestIpam", {
      operatingRegion: ["us-west-1"],
    });

    const pool = ipam.privateScope.addPool("PrivatePool0", {
      addressFamily: AddressFamily.IP_V4,
      ipv4ProvisionedCidrs: ["10.1.0.1/24"],
      locale: "us-west-1",
    });

    new VpcV2(stack, "TestVpc", {
      primaryAddressBlock: IpAddresses.ipv4Ipam({
        ipamPool: pool,
        netmaskLength: 28,
        cidrBlockName: "IPv4Ipam",
      }),
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    Template.fromStack(stack, { snapshot: true }).toMatchObject({
      Resources: {
        TestIpamDBF92BA8: { Type: "AWS::EC2::IPAM" },
        TestIpamPrivatePool0E8589980: {
          Type: "AWS::EC2::IPAMPool",
          Properties: {
            AddressFamily: "ipv4",
            IpamScopeId: {
              "Fn::GetAtt": ["TestIpamDBF92BA8", "PrivateDefaultScopeId"],
            },
            Locale: "us-west-1",
            ProvisionedCidrs: [
              {
                Cidr: "10.1.0.1/24",
              },
            ],
          },
        },
        TestVpcE77CE678: {
          Type: "AWS::EC2::VPC",
          Properties: {
            Ipv4IpamPoolId: {
              "Fn::GetAtt": ["TestIpamPrivatePool0E8589980", "IpamPoolId"],
            },
            EnableDnsHostnames: true,
            EnableDnsSupport: true,
          },
        },
      },
    });
  });

  test("VPC Secondary IP from Ipv6 Ipam", () => {
    const ipam = new Ipam(stack, "TestIpam", {
      operatingRegion: ["us-west-1"],
    });

    const pool = ipam.publicScope.addPool("PublicPool0", {
      addressFamily: AddressFamily.IP_V6,
      awsService: AwsServiceName.EC2,
      publicIpSource: IpamPoolPublicIpSource.AMAZON,
      locale: "us-west-1",
    });
    pool.provisionCidr("PublicPoolCidr", {
      netmaskLength: 60,
    });

    new VpcV2(stack, "TestVpc", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv6Ipam({
          ipamPool: pool,
          netmaskLength: 64,
          cidrBlockName: "IPv6Ipam",
        }),
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });
    Template.fromStack(stack, { snapshot: true }).toMatchObject({
      Resources: {
        TestIpamDBF92BA8: { Type: "AWS::EC2::IPAM" },
        TestIpamPublicPool0588A338B: {
          Type: "AWS::EC2::IPAMPool",
          Properties: {
            AddressFamily: "ipv6",
            AwsService: "ec2",
            IpamScopeId: {
              "Fn::GetAtt": ["TestIpamDBF92BA8", "PublicDefaultScopeId"],
            },
            PublicIpSource: "amazon",
          },
        },
        // Test Amazon Provided IPAM IPv6
        TestIpamPublicPool0PublicPoolCidrB0FF20F7: {
          Type: "AWS::EC2::IPAMPoolCidr",
          Properties: {
            IpamPoolId: {
              "Fn::GetAtt": ["TestIpamPublicPool0588A338B", "IpamPoolId"],
            },
            NetmaskLength: 60,
          },
        },
        TestVpcE77CE678: {
          Type: "AWS::EC2::VPC",
          Properties: {
            CidrBlock: "10.1.0.0/16",
            EnableDnsHostnames: true,
            EnableDnsSupport: true,
          },
        },
        TestVpcIPv6Ipam402F1C75: {
          Type: "AWS::EC2::VPCCidrBlock",
          Properties: {
            VpcId: {
              "Fn::GetAtt": ["TestVpcE77CE678", "VpcId"],
            },
            Ipv6IpamPoolId: {
              "Fn::GetAtt": ["TestIpamPublicPool0588A338B", "IpamPoolId"],
            },
            Ipv6NetmaskLength: 64,
          },
        },
      },
    });
  });
});
