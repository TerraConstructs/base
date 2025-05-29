import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { edge, AwsStack } from "../../../src/aws";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

const LB_ZONE_ID = "H6JUI97EXAMPL3";
const LB_DNS = "alb-1234567890.us-east-1.elb.amazonaws.com";

describe("Load-Balancers", () => {
  test("Synthesises and matches snapshot", () => {
    // GIVEN
    const stack = getAwsStack();

    // a public hosted zone
    const zone = new edge.DnsZone(stack, "Zone", {
      zoneName: "example.com",
    });

    // WHEN – create an A-record that aliases to the existing ALB/NLB
    new edge.ARecord(stack, "LoadBalancerAlias", {
      zone,
      recordName: "alb",
      target: edge.RecordTarget.fromAlias(
        edge.LoadBalancerTarget.fromAttributes(LB_ZONE_ID, LB_DNS),
      ),
    });

    // THEN – snapshot-test the synthesised Terraform
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
