// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/client-vpn-route.test.ts

import {
  vpc as tfVpc,
  ec2ClientVpnEndpoint,
  ec2ClientVpnRoute,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as ec2 from "../../../src/aws/compute";
import { ClientVpnUserBasedAuthentication } from "../../../src/aws/compute/client-vpn-endpoint";
import {
  ClientVpnRoute,
  ClientVpnRouteTarget,
} from "../../../src/aws/compute/client-vpn-route";
import { SamlMetadataDocument, SamlProvider } from "../../../src/aws/iam";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

let app: App;
let stack: AwsStack;
let vpc: ec2.IVpc;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  vpc = new ec2.Vpc(stack, "Vpc");
});

describe("ClientVpnRoute constructor", () => {
  test("normal usage", () => {
    const samlProvider = new SamlProvider(stack, "Provider", {
      metadataDocument: SamlMetadataDocument.fromXml("xml"),
    });
    const clientVpnEndpoint = vpc.addClientVpnEndpoint("Endpoint", {
      cidr: "10.100.0.0/16",
      serverCertificateArn: "server-certificate-arn",
      clientCertificateArn: "client-certificate-arn",
      clientConnectionHandler: {
        functionArn: "function-arn",
        functionName: "AWSClientVPN-function-name",
      },
      dnsServers: ["8.8.8.8", "8.8.4.4"],
      userBasedAuthentication:
        ClientVpnUserBasedAuthentication.federated(samlProvider),
    });
    new ClientVpnRoute(stack, "NormalRoute", {
      clientVpnEndpoint,
      cidr: "0.0.0.0/0",
      target: ClientVpnRouteTarget.local(),
    });
    Template.resources(stack, tfVpc.Vpc).toHaveLength(1);
    Template.resources(
      stack,
      ec2ClientVpnEndpoint.Ec2ClientVpnEndpoint,
    ).toHaveLength(1);
    Template.resources(stack, ec2ClientVpnRoute.Ec2ClientVpnRoute).toHaveLength(
      1,
    );
    // expect(stack.node.children.length).toBe(3);
  });
});
