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
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_vpc: {
          TestVpc_E77CE678: {
            cidr_block: "10.1.0.0/16",
            enable_dns_hostnames: true,
            enable_dns_support: true,
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
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_vpc: {
          TestVpc_E77CE678: {
            cidr_block: "10.1.0.0/16",
            enable_dns_hostnames: true,
            enable_dns_support: true,
          },
        },
        aws_vpc_ipv4_cidr_block_association: {
          TestVpc_SecondaryAddress_72BC831D: {
            cidr_block: "10.2.0.0/16",
            vpc_id: "${aws_vpc.TestVpc_E77CE678.id}",
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
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_vpc: {
          TestVpc_E77CE678: {
            cidr_block: "10.1.0.0/16",
            enable_dns_hostnames: true,
            enable_dns_support: true,
          },
        },
        aws_vpc_ipv6_cidr_block_association: {
          TestVpc_AmazonProvided_00BF109D: {
            assign_generated_ipv6_cidr_block: true, //Amazon Provided IPv6 address
            vpc_id: "${aws_vpc.TestVpc_E77CE678.id}",
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
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_vpc_ipam: {
          TestIpam_DBF92BA8: expect.anything(),
        },
        aws_vpc_ipam_pool: {
          TestIpam_PrivatePool0_AF92E01C: {
            address_family: "ipv4",
            ipam_scope_id:
              "${aws_vpc_ipam.TestIpam_DBF92BA8.private_default_scope_id}",
            // TF provider aws does not support inline cidr provisioning
            // provisioned_cidrs: [
            //   {
            //     cidr: "10.1.0.1/24",
            //   },
            // ],
            locale: "us-west-1",
          },
        },
        aws_vpc_ipam_pool_cidr: {
          TestIpam_PrivatePool0_ProvisionedCidr_B99F6E6F: {
            cidr: "10.1.0.1/24",
            ipam_pool_id:
              "${aws_vpc_ipam_pool.TestIpam_PrivatePool0_AF92E01C.id}",
          },
        },
        aws_vpc: {
          TestVpc_E77CE678: {
            enable_dns_hostnames: true,
            enable_dns_support: true,
            ipv4_ipam_pool_id:
              "${aws_vpc_ipam_pool.TestIpam_PrivatePool0_AF92E01C.id}",
            ipv4_netmask_length: 28, // not in AWS CDK vpc-v2 test
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
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_vpc_ipam: {
          TestIpam_DBF92BA8: expect.anything(),
        },
        aws_vpc_ipam_pool: {
          TestIpam_PublicPool0_696E1634: {
            address_family: "ipv6",
            aws_service: "ec2",
            ipam_scope_id:
              "${aws_vpc_ipam.TestIpam_DBF92BA8.public_default_scope_id}",
            // locale: "us-west-1", // not in AWS CDK test
            public_ip_source: "amazon",
          },
        },
        // Test Amazon Provided IPAM IPv6
        aws_vpc_ipam_pool_cidr: {
          TestIpam_PublicPool0_PublicPoolCidr_B0FF20F7: {
            ipam_pool_id:
              "${aws_vpc_ipam_pool.TestIpam_PublicPool0_696E1634.id}",
            netmask_length: 60,
          },
        },
        aws_vpc: {
          TestVpc_E77CE678: {
            cidr_block: "10.1.0.0/16",
            enable_dns_hostnames: true,
            enable_dns_support: true,
            // instance_tenancy: "default", // not in AWS CDK test
          },
        },
        aws_vpc_ipv6_cidr_block_association: {
          TestVpc_IPv6Ipam_402F1C75: {
            vpc_id: "${aws_vpc.TestVpc_E77CE678.id}",
            ipv6_ipam_pool_id:
              "${aws_vpc_ipam_pool.TestIpam_PublicPool0_696E1634.id}",
            ipv6_netmask_length: 64,
          },
        },
      },
    });
  });
});
