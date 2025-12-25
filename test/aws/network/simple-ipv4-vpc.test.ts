import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as network from "../../../src/aws/network";

describe("Environment", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    // WHEN
    new network.SimpleIPv4Vpc(stack, "network", {
      ipv4CidrBlock: "10.0.0.0/16",
      internalDomain: "example.local",
    });
    // THEN
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should support adding subnet groups", () => {
    // GIVEN
    const stack = new AwsStack();
    // WHEN
    const vpc = new network.SimpleIPv4Vpc(stack, "network", {
      ipv4CidrBlock: "10.0.0.0/16",
      internalDomain: "example.local",
    });
    vpc.enableDbSubnetGroup();
    vpc.enableElastiCacheSubnetGroup();
    // THEN
    const result = Testing.synth(stack);
    expect(result).toHaveResource({
      tfResourceType: "aws_db_subnet_group",
    });
    expect(result).toHaveResource({
      tfResourceType: "aws_elasticache_subnet_group",
    });
  });
});
