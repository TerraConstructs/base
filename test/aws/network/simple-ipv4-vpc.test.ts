import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { network, AwsStack } from "../../../src/aws";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
describe("Environment", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
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
    const stack = getAwsStack();
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

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
  });
}
