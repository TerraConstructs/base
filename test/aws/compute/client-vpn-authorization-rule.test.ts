// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/client-vpn-authorization-rule.test.ts

import { ec2ClientVpnAuthorizationRule } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import { Connections, IClientVpnEndpoint } from "../../../src/aws/compute";
import { ClientVpnAuthorizationRule } from "../../../src/aws/compute/client-vpn-authorization-rule";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

let app: App;
let stack: AwsStack;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
});

describe("ClientVpnAuthorizationRule constructor", () => {
  test("normal usage", () => {
    const clientVpnEndpoint: IClientVpnEndpoint = {
      env: {
        account: "myAccount",
        region: "us-east-1",
        partition: "aws",
      },
      environmentName,
      gridUUID,
      clientVpnOutputs: {
        clientVpnEndpointId: "myClientVpnEndpoint",
      },
      outputs: {
        clientVpnEndpointId: "myClientVpnEndpoint",
      },
      endpointId: "myClientVpnEndpoint",
      targetNetworksAssociated: [],
      stack,
      connections: new Connections(),
      node: stack.node,
    };
    new ClientVpnAuthorizationRule(stack, "NormalRule", {
      cidr: "10.0.10.0/32",
      clientVpnEndpoint,
    });
    Template.resources(
      stack,
      ec2ClientVpnAuthorizationRule.Ec2ClientVpnAuthorizationRule,
    ).toHaveLength(1);
    // expect(stack.node.children.length).toBe(1);
  });
});
