// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/base-path-mapping.test.ts

import { apiGatewayBasePathMapping } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  RestApi,
  DomainName,
  EndpointType,
  BasePathMapping,
  Stage,
  Deployment,
} from "../../../src/aws/compute";
import * as certificatemanager from "../../../src/aws/edge";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("BasePathMapping", () => {
  let app: App;
  let stack: AwsStack;
  let api: RestApi;
  let domain: DomainName;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });

    api = new RestApi(stack, "MyApi");
    api.root.addMethod("GET"); // api must have at least one method for deployment/stage.

    domain = new DomainName(stack, "MyDomain", {
      domainName: "example.com",
      certificate: certificatemanager.PublicCertificate.fromCertificateArn(
        stack,
        "cert",
        "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
      ),
      endpointType: EndpointType.REGIONAL,
    });
  });

  test("default setup", () => {
    // WHEN
    new BasePathMapping(stack, "MyBasePath", {
      restApi: api,
      domainName: domain,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name: stack.resolve(domain.domainName),
        api_id: stack.resolve(api.restApiId),
        stage_name: stack.resolve(api.deploymentStage.stageName),
      },
    );
  });

  test("specify basePath property", () => {
    // WHEN
    new BasePathMapping(stack, "MyBasePath", {
      restApi: api,
      domainName: domain,
      basePath: "My_B45E-P4th",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        base_path: "My_B45E-P4th",
      },
    );
  });

  test("specify multi-level basePath property", () => {
    // WHEN
    new BasePathMapping(stack, "MyBasePath", {
      restApi: api,
      domainName: domain,
      basePath: "api/v1/example",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        base_path: "api/v1/example",
      },
    );
  });

  test("throws when basePath contains an invalid character", () => {
    // WHEN
    const invalidBasePath = "invalid-/base-path?";

    // THEN
    expect(() => {
      new BasePathMapping(stack, "MyBasePath", {
        restApi: api,
        domainName: domain,
        basePath: invalidBasePath,
      });
    }).toThrow(/base path may only contain/);
  });

  test("throw error for basePath starting with /", () => {
    // WHEN
    const invalidBasePath = "/invalid-base-path";

    // THEN
    expect(() => {
      new BasePathMapping(stack, "MyBasePath", {
        restApi: api,
        domainName: domain,
        basePath: invalidBasePath,
      });
    }).toThrow(/A base path cannot start or end with/);
  });

  test("throw error for basePath ending with /", () => {
    // WHEN
    const invalidBasePath = "invalid-base-path/";

    // THEN
    expect(() => {
      new BasePathMapping(stack, "MyBasePath", {
        restApi: api,
        domainName: domain,
        basePath: invalidBasePath,
      });
    }).toThrow(/A base path cannot start or end with/);
  });

  test("throw error for basePath containing more than one consecutive /", () => {
    // WHEN
    const invalidBasePath = "in//valid-base-path";

    // THEN
    expect(() => {
      new BasePathMapping(stack, "MyBasePath", {
        restApi: api,
        domainName: domain,
        basePath: invalidBasePath,
      });
    }).toThrow(/A base path cannot have more than one consecutive \//);
  });

  test("specify stage property", () => {
    // GIVEN
    const deployment = new Deployment(stack, "MyDeployment", {
      api,
    });
    const stage = new Stage(stack, "MyStage", {
      deployment,
      stageName: "customstage",
    });

    // WHEN
    new BasePathMapping(stack, "MyBasePathMapping", {
      restApi: api,
      domainName: domain,
      stage,
      attachToStage: true, // This is default, but explicit for clarity
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        stage_name: stack.resolve(stage.stageName),
      },
    );
  });

  test("specify attachToStage property false", () => {
    // WHEN
    new BasePathMapping(stack, "MyBasePath", {
      restApi: api,
      domainName: domain,
      attachToStage: false,
    });

    // THEN
    const template = new Template(stack);
    const mappings = template.resourceTypeArray(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
    );
    expect(mappings.length).toBe(1);
    expect(mappings[0]).not.toHaveProperty("stage_name");
  });
});
