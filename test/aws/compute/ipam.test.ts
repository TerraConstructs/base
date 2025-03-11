// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/@aws-cdk/aws-ec2-alpha/test/ipam.test.ts

import {
  vpcIpamPool as tfVpcIpamPool,
  vpcIpam as tfVpcIpam,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
// alpha resources
import {
  AddressFamily,
  Ipam,
  IpamPoolPublicIpSource,
  PoolOptions,
  AwsServiceName,
} from "../../../src/aws/compute/ipam";
import { IpAddresses, VpcV2 } from "../../../src/aws/compute/vpc-v2";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("IPAM Test", () => {
  let app: App;
  let stack: AwsStack;
  let ipam: Ipam;

  beforeEach(() => {
    app = Testing.app();
    const envUSA = { region: "us-east-1" };
    stack = new AwsStack(app, "IPAMTestStack", {
      environmentName,
      gridUUID,
      providerConfig: envUSA,
      gridBackendConfig,
    });
    ipam = new Ipam(stack, "Ipam", {
      operatingRegion: ["us-west-2"],
    });
  });

  test("Creates IP Pool under Public Scope", () => {
    const pool = ipam.publicScope.addPool("Public", {
      addressFamily: AddressFamily.IP_V6,
      awsService: AwsServiceName.EC2,
      locale: "us-west-2",
      publicIpSource: IpamPoolPublicIpSource.AMAZON,
    });

    new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.2.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv6Ipam({
          ipamPool: pool,
          netmaskLength: 52,
          cidrBlockName: "Ipv6Ipam",
        }),
      ],
    });
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcIpamPool.VpcIpamPool,
      {
        address_family: "ipv6",
        ipam_scope_id: stack.resolve(ipam.publicScope.scopeId),
        locale: "us-west-2",
      },
    ); //End Template
  }); // End Test

  test("Creates IP Pool under Private Scope", () => {
    const pool = ipam.privateScope.addPool("Private", {
      addressFamily: AddressFamily.IP_V4,
      ipv4ProvisionedCidrs: ["10.2.0.0/16"],
      locale: "us-west-2",
    });

    new VpcV2(stack, "TestVPC", {
      primaryAddressBlock: IpAddresses.ipv4("10.1.0.0/16"),
      secondaryAddressBlocks: [
        IpAddresses.ipv4Ipam({
          ipamPool: pool,
          netmaskLength: 20,
          cidrBlockName: "SecondaryIpv4",
        }),
      ],
    });
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcIpamPool.VpcIpamPool,
      {
        address_family: "ipv4",
        ipam_scope_id: stack.resolve(ipam.privateScope.scopeId),
        locale: "us-west-2",
      },
    ); //End Template
  });

  test("Creates IPAM CIDR pool under public scope for IPv6", () => {
    // Create IPAM resources
    const ipamIpv6 = new Ipam(stack, "TestIpam", {
      operatingRegion: ["us-west-2"],
    });
    const poolOptions: PoolOptions = {
      addressFamily: AddressFamily.IP_V6,
      awsService: AwsServiceName.EC2,
      publicIpSource: IpamPoolPublicIpSource.AMAZON,
      locale: "us-west-2",
    };
    ipamIpv6.publicScope.addPool("TestPool", poolOptions);

    // Assert that the generated template matches the expected template
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_vpc_ipam: {
          // Ipam50346F82: { Type: "AWS::EC2::IPAM" },
          Ipam_50346F82: {
            operating_regions: [
              {
                region_name: "us-west-2",
              },
            ],
          },
          // TestIpamDBF92BA8: { Type: "AWS::EC2::IPAM" },
          TestIpam_DBF92BA8: {
            operating_regions: [
              {
                region_name: "us-west-2",
              },
            ],
          },
        },
        aws_vpc_ipam_pool: {
          // TestIpamTestPool5D90F91B: {
          //   Type: "AWS::EC2::IPAMPool",
          //   Properties: {
          //     AddressFamily: "ipv6",
          //     IpamScopeId: {
          //       "Fn::GetAtt": ["TestIpamDBF92BA8", "PublicDefaultScopeId"],
          //     },
          //     Locale: "us-west-2",
          //   },
          // },
          TestIpam_TestPool_A1D45CCB: {
            address_family: "ipv6",
            aws_service: "ec2",
            ipam_scope_id:
              "${aws_vpc_ipam.TestIpam_DBF92BA8.public_default_scope_id}",
            locale: "us-west-2",
            public_ip_source: "amazon",
          },
        },
      },
    });
  });

  test("Get region from stack env", () => {
    // Create IPAM resources
    const ipamRegion = new Ipam(stack, "TestIpam", {
      operatingRegion: ["us-west-2"],
    });
    const poolOptions: PoolOptions = {
      addressFamily: AddressFamily.IP_V6,
      awsService: AwsServiceName.EC2,
      publicIpSource: IpamPoolPublicIpSource.AMAZON,
      locale: "us-west-2",
    };
    ipamRegion.publicScope.addPool("TestPool", poolOptions);

    // Assert that the generated template matches the expected template
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_vpc_ipam: {
          // Ipam50346F82: { Type: "AWS::EC2::IPAM" },
          Ipam_50346F82: {
            operating_regions: [
              {
                region_name: "us-west-2",
              },
            ],
          },
          // TestIpamDBF92BA8: { Type: "AWS::EC2::IPAM" },
          TestIpam_DBF92BA8: {
            operating_regions: [
              {
                region_name: "us-west-2",
              },
            ],
          },
        },
        // TestIpamTestPool5D90F91B: {
        //   Type: "AWS::EC2::IPAMPool",
        //   Properties: {
        //     AddressFamily: "ipv6",
        //     IpamScopeId: {
        //       "Fn::GetAtt": ["TestIpamDBF92BA8", "PublicDefaultScopeId"],
        //     },
        //     Locale: "us-west-2",
        //   },
        // },
        aws_vpc_ipam_pool: {
          TestIpam_TestPool_A1D45CCB: {
            address_family: "ipv6",
            aws_service: "ec2",
            ipam_scope_id:
              "${aws_vpc_ipam.TestIpam_DBF92BA8.public_default_scope_id}",
            locale: "us-west-2",
            public_ip_source: "amazon",
          },
        },
      },
    });
  });

  test("Creates IPAM with default scopes", () => {
    new Ipam(stack, "TestIpam", {});
    Template.synth(stack).toHaveResource(tfVpcIpam.VpcIpam);
  });
}); // End Test
