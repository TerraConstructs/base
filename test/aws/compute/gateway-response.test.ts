import {
  apiGatewayDeployment,
  apiGatewayGatewayResponse,
  apiGatewayMethod,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { ResponseType, RestApi } from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = { address: "http://localhost:3000" };

describe("gateway response", () => {
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

  test("gateway response resource is created", () => {
    // GIVEN
    const api = new RestApi(stack, "restapi", {
      deploy: false,
      cloudWatchRole: false,
    });

    new apiGatewayMethod.ApiGatewayMethod(stack, "RootGet", {
      restApiId: api.restApiId,
      resourceId: api.root.resourceId,
      httpMethod: "GET",
      authorization: "NONE",
    });

    api.addGatewayResponse("test-response", {
      type: ResponseType.ACCESS_DENIED,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayGatewayResponse.ApiGatewayGatewayResponse,
      {
        response_type: ResponseType.ACCESS_DENIED.responseType,
        rest_api_id: stack.resolve(api.restApiId),
        // TODO: Explicit verify response_templates is missing
        // status_code: undefined, // Property will be absent in the synthesized output if undefined
        // response_parameters: undefined, // Property will be absent
        // response_templates: undefined, // Property will be absent
      },
    );
  });

  test("gateway response resource is created with parameters", () => {
    // GIVEN
    const api = new RestApi(stack, "restapi", {
      deploy: false,
      cloudWatchRole: false,
    });

    new apiGatewayMethod.ApiGatewayMethod(stack, "RootGet", {
      restApiId: api.restApiId,
      resourceId: api.root.resourceId,
      httpMethod: "GET",
      authorization: "NONE",
    });

    api.addGatewayResponse("test-response", {
      type: ResponseType.AUTHORIZER_FAILURE,
      statusCode: "500",
      responseHeaders: {
        "Access-Control-Allow-Origin": "test.com",
        "test-key": "test-value",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayGatewayResponse.ApiGatewayGatewayResponse,
      {
        response_type: ResponseType.AUTHORIZER_FAILURE.responseType,
        rest_api_id: stack.resolve(api.restApiId),
        status_code: "500",
        response_parameters: {
          "gatewayresponse.header.Access-Control-Allow-Origin": "test.com",
          "gatewayresponse.header.test-key": "test-value",
        },
        // TODO: Explicit verify response_templates is missing
        // response_templates: undefined,
      },
    );
  });

  test("gateway response resource is created with templates", () => {
    // GIVEN
    const api = new RestApi(stack, "restapi", {
      deploy: false,
      cloudWatchRole: false,
    });

    new apiGatewayMethod.ApiGatewayMethod(stack, "RootGet", {
      restApiId: api.restApiId,
      resourceId: api.root.resourceId,
      httpMethod: "GET",
      authorization: "NONE",
    });

    api.addGatewayResponse("test-response", {
      type: ResponseType.AUTHORIZER_FAILURE,
      statusCode: "500",
      templates: {
        "application/json":
          '{ "message": $context.error.messageString, "statusCode": "488" }',
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayGatewayResponse.ApiGatewayGatewayResponse,
      {
        response_type: ResponseType.AUTHORIZER_FAILURE.responseType,
        rest_api_id: stack.resolve(api.restApiId),
        status_code: "500",
        // TODO: Explicit verify response_templates is missing
        // response_parameters: undefined,
        response_templates: {
          "application/json":
            '{ "message": $context.error.messageString, "statusCode": "488" }',
        },
      },
    );
  });

  test("deployment changes when gateway response is updated", () => {
    // GIVEN
    const restApi = new RestApi(stack, "restapi", {
      deploy: true,
    });

    new apiGatewayMethod.ApiGatewayMethod(stack, "RootGetForDeploymentTest", {
      restApiId: restApi.restApiId,
      resourceId: restApi.root.resourceId,
      httpMethod: "GET",
      authorization: "NONE",
    });

    const latestDeployment = restApi.latestDeployment as any;
    let deploymentTriggers = latestDeployment.calculateTriggers();
    const oldDeploymentTriggers = JSON.stringify(deploymentTriggers);

    // WHEN
    restApi.addGatewayResponse("gatewayResponse", {
      type: ResponseType.AUTHORIZER_CONFIGURATION_ERROR,
    });
    deploymentTriggers = latestDeployment.calculateTriggers();
    const newDeploymentTriggers = JSON.stringify(deploymentTriggers);

    expect(newDeploymentTriggers).not.toEqual(oldDeploymentTriggers);
  });
});
