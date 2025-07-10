// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/integration.test.ts

import { apiGatewayIntegration, apiGatewayMethod } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import { AwsStack } from "../../../src/aws";
import {
  Vpc,
  NetworkLoadBalancer,
  Integration,
  IntegrationType,
  ConnectionType,
  VpcLink,
  RestApi,
  // Method as ApiGatewayMethodResource, // Alias to avoid conflict with test 'Method' type
} from "../../../src/aws/compute";
import { Role, ServicePrincipal } from "../../../src/aws/iam";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

const environmentName = "TestEnv";
const gridUUID = "test-uuid";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = { address: "http://localhost:4000" };

describe("integration", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test('integration "credentialsRole" and "credentialsPassthrough" are mutually exclusive', () => {
    // GIVEN
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("foo"),
    });

    // THEN
    expect(
      () =>
        new Integration({
          type: IntegrationType.AWS_PROXY,
          integrationHttpMethod: "ANY",
          options: {
            credentialsPassthrough: true,
            credentialsRole: role,
          },
        }),
    ).toThrow(
      /'credentialsPassthrough' and 'credentialsRole' are mutually exclusive/,
    );
  });

  test("integration connectionType VpcLink requires vpcLink to be set", () => {
    expect(
      () =>
        new Integration({
          type: IntegrationType.HTTP_PROXY,
          integrationHttpMethod: "ANY",
          options: {
            connectionType: ConnectionType.VPC_LINK,
          },
        }),
    ).toThrow(/'connectionType' of VPC_LINK requires 'vpcLink' prop to be set/);
  });

  test("uri is self determined from the NLB", () => {
    const vpc = new Vpc(stack, "VPC");
    const nlb = new NetworkLoadBalancer(stack, "NLB", { vpc });
    const link = new VpcLink(stack, "link", {
      targets: [nlb],
    });
    const api = new RestApi(stack, "restapi");
    const integration = new Integration({
      type: IntegrationType.HTTP_PROXY,
      integrationHttpMethod: "ANY",
      options: {
        connectionType: ConnectionType.VPC_LINK,
        vpcLink: link,
      },
    });
    api.root.addMethod("GET", integration);

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        uri: `http://${stack.resolve(nlb.loadBalancerDnsName)}`,
      },
    );
  });

  test("uri must be set for VpcLink with multiple NLBs", () => {
    const vpc = new Vpc(stack, "VPC");
    const nlb1 = new NetworkLoadBalancer(stack, "NLB1", { vpc });
    const nlb2 = new NetworkLoadBalancer(stack, "NLB2", { vpc });
    const link = new VpcLink(stack, "link", {
      targets: [nlb1, nlb2],
    });
    const api = new RestApi(stack, "restapi");
    const integration = new Integration({
      type: IntegrationType.HTTP_PROXY,
      integrationHttpMethod: "ANY",
      options: {
        connectionType: ConnectionType.VPC_LINK,
        vpcLink: link,
      },
    });
    api.root.addMethod("GET", integration);
    expect(() => Template.synth(stack)).toThrow(
      /'uri' is required when there are more than one NLBs in the VPC Link/,
    );
  });

  test("uri must be set when using an imported VpcLink", () => {
    const link = VpcLink.fromVpcLinkId(stack, "link", "vpclinkid");
    const api = new RestApi(stack, "restapi");
    const integration = new Integration({
      type: IntegrationType.HTTP_PROXY,
      integrationHttpMethod: "ANY",
      options: {
        connectionType: ConnectionType.VPC_LINK,
        vpcLink: link,
      },
    });
    api.root.addMethod("GET", integration);
    expect(() => Template.synth(stack)).toThrow(
      /'uri' is required when the 'connectionType' is VPC_LINK/,
    );
  });

  test("connectionType of INTERNET and vpcLink are mutually exclusive", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");
    const nlb = new NetworkLoadBalancer(stack, "NLB", {
      vpc,
    });
    const link = new VpcLink(stack, "link", {
      targets: [nlb],
    });

    // THEN
    expect(
      () =>
        new Integration({
          type: IntegrationType.HTTP_PROXY,
          integrationHttpMethod: "ANY",
          options: {
            connectionType: ConnectionType.INTERNET,
            vpcLink: link,
          },
        }),
    ).toThrow(/cannot set 'vpcLink' where 'connectionType' is INTERNET/);
  });

  test("connectionType is absent when vpcLink is not specified", () => {
    // GIVEN
    const api = new RestApi(stack, "restapi");

    // WHEN
    const integration = new Integration({
      type: IntegrationType.HTTP_PROXY,
      integrationHttpMethod: "ANY",
    });
    api.root.addMethod("ANY", integration);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "HTTP_PROXY",
        integration_http_method: "ANY",
        http_method:
          "${aws_api_gateway_method.restapi_ANY_457AF35A.http_method}",
      },
    );
    template.expect.not.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        connectin_type: expect.anything(), // connection_type should not be present
      },
    );
  });

  test("connectionType defaults to VPC_LINK if vpcLink is configured", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");
    const nlb = new NetworkLoadBalancer(stack, "NLB", {
      vpc,
    });
    const link = new VpcLink(stack, "link", {
      targets: [nlb],
    });
    const api = new RestApi(stack, "restapi");

    // WHEN
    const integration = new Integration({
      type: IntegrationType.HTTP_PROXY,
      integrationHttpMethod: "ANY",
      options: {
        vpcLink: link,
      },
    });
    api.root.addMethod("ANY", integration);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        connection_type: "VPC_LINK",
      },
    );
  });

  test("validates timeout is valid", () => {
    expect(
      () =>
        new Integration({
          type: IntegrationType.HTTP_PROXY,
          integrationHttpMethod: "ANY",
          options: {
            timeout: Duration.millis(2),
          },
        }),
    ).toThrow(/Integration timeout must be greater than 50 milliseconds/); // Adjusted regex for timeout limits

    // TODO: AWSCDK Does not validate the upper limit of 30 seconds, so we cannot test it here
    // expect(
    //   () =>
    //     new Integration({
    //       type: IntegrationType.HTTP_PROXY,
    //       integrationHttpMethod: "ANY",
    //       options: {
    //         timeout: Duration.seconds(50),
    //       },
    //     }),
    // ).toThrow(/Integration timeout must be between 50 and .*/); // Adjusted regex for timeout limits, 30000 for default max

    expect(
      () =>
        new Integration({
          type: IntegrationType.HTTP_PROXY,
          integrationHttpMethod: "ANY",
          options: {
            timeout: Duration.seconds(15),
          },
        }),
    ).not.toThrow();
  });

  test("sets timeout", () => {
    // GIVEN
    const api = new RestApi(stack, "restapi");

    // WHEN
    const integration = new Integration({
      type: IntegrationType.HTTP_PROXY,
      integrationHttpMethod: "ANY",
      options: {
        timeout: Duration.seconds(1),
      },
    });
    api.root.addMethod("ANY", integration);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        timeout_milliseconds: 1000,
      },
    );
  });

  test("validates integrationHttpMethod is required for non-MOCK integration types", () => {
    expect(
      () =>
        new Integration({
          type: IntegrationType.HTTP_PROXY,
          options: {
            timeout: Duration.seconds(15),
          },
        }),
    ).toThrow(
      /integrationHttpMethod is required for non-mock integration types/,
    );
  });

  test("integrationHttpMethod can be omitted for MOCK integration type", () => {
    expect(
      () =>
        new Integration({
          type: IntegrationType.MOCK,
          options: {
            timeout: Duration.seconds(15),
          },
        }),
    ).not.toThrow();
  });
});
