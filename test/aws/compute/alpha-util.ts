// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/@aws-cdk/aws-ec2-alpha/test/util.ts

import { AwsStack } from "../../../src/aws";
import { SubnetType } from "../../../src/aws/compute";
import { AddressFamily } from "../../../src/aws/compute/ipam";
import { IpCidr, SubnetV2 } from "../../../src/aws/compute/subnet-v2";
import { VpcV2 } from "../../../src/aws/compute/vpc-v2";

export function createTestSubnet(
  stack: AwsStack,
  config: {
    vpcV2: VpcV2;
    availabilityZone: string;
    cidrBlock: IpCidr;
    subnetType: SubnetType;
    addressFamily?: AddressFamily;
    ipv6Cidr?: IpCidr;
  },
): SubnetV2 {
  const { vpcV2, availabilityZone, cidrBlock, subnetType, ipv6Cidr } = config;

  return new SubnetV2(stack, "TestSubnet", {
    vpc: vpcV2,
    availabilityZone,
    ipv4CidrBlock: cidrBlock,
    subnetType,
    ipv6CidrBlock: ipv6Cidr,
  });
}
