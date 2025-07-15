// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/vpc-link.test.ts

import { apiGatewayVpcLink } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import { Vpc, NetworkLoadBalancer, VpcLink } from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("vpc link", () => {
  let app: App;
  let stack: AwsStack;
  let vpc: Vpc;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    vpc = new Vpc(stack, "VPC");
  });

  test("default setup", () => {
    // GIVEN
    const nlb = new NetworkLoadBalancer(stack, "NLB", {
      vpc,
    });

    // WHEN
    new VpcLink(stack, "VpcLink", {
      vpcLinkName: "MyLink",
      targets: [nlb],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayVpcLink.ApiGatewayVpcLink,
      {
        name: "MyLink",
        target_arns: [stack.resolve(nlb.loadBalancerArn)],
      },
    );
  });

  test("targets can be added using addTargets", () => {
    // GIVEN
    const nlb0 = new NetworkLoadBalancer(stack, "NLB0", { vpc });
    const nlb1 = new NetworkLoadBalancer(stack, "NLB1", { vpc });
    const nlb2 = new NetworkLoadBalancer(stack, "NLB2", { vpc });
    const nlb3 = new NetworkLoadBalancer(stack, "NLB3", { vpc });

    // WHEN
    const link = new VpcLink(stack, "VpcLink", {
      targets: [nlb0],
    });
    link.addTargets(nlb1, nlb2);
    link.addTargets(nlb3);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayVpcLink.ApiGatewayVpcLink,
      {
        // TODO: Not following the GridUUID Prefix pattern...
        name: "MyStackVpcLink94DC54D3",
        target_arns: [
          stack.resolve(nlb0.loadBalancerArn),
          stack.resolve(nlb1.loadBalancerArn),
          stack.resolve(nlb2.loadBalancerArn),
          stack.resolve(nlb3.loadBalancerArn),
        ],
      },
    );
  });

  test("import", () => {
    // GIVEN
    // stack is created in beforeEach

    // WHEN
    VpcLink.fromVpcLinkId(stack, "ImportedVpcLink", "vpclink-id");

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(apiGatewayVpcLink.ApiGatewayVpcLink, 0);
  });

  test("validation error if vpc link is created and no targets are added", () => {
    // GIVEN
    // app and stack are created in beforeEach

    // WHEN
    new VpcLink(stack, "vpclink");

    // TEST
    // Expecting a similar validation error. The exact message might differ if it's a CDKTF core error vs. custom construct error.
    expect(() => Testing.synth(stack, true)).toThrow(
      /No targets added to vpc link|target_arns is a required property|targetArns must not be empty/i,
    );
  });
});
