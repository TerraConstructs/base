import { apiGatewayIntegration } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import { RestApi, HttpIntegration } from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3-a456-426614174000";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = { address: "http://localhost:3000" };

describe("http integration", () => {
  let stack: AwsStack;
  let api: RestApi;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    api = new RestApi(stack, "my-api");
  });

  test("minimal setup", () => {
    // GIVEN
    // api already created in beforeEach

    // WHEN
    const integ = new HttpIntegration("http://foo/bar");
    api.root.addMethod("GET", integ);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        integration_http_method: "GET",
        type: "HTTP_PROXY",
        uri: "http://foo/bar",
        // The http_method for the integration resource itself is the one from addMethod
        http_method:
          "${aws_api_gateway_method.my-api_GET_F990CE3C.http_method}",
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(api.restApiRootResourceId),
      },
    );
  });

  test("options can be passed via props", () => {
    // GIVEN
    // api already created in beforeEach

    // WHEN
    const integ = new HttpIntegration("http://foo/bar", {
      httpMethod: "POST", // This is for the backend integration
      proxy: false, // This means type: 'HTTP'
      options: {
        cacheNamespace: "hey",
      },
    });

    api.root.addMethod("GET", integ); // This 'GET' is for the API method

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        cache_namespace: "hey",
        integration_http_method: "POST",
        type: "HTTP",
        uri: "http://foo/bar",
        // The http_method for the integration resource itself is the one from addMethod
        http_method:
          "${aws_api_gateway_method.my-api_GET_F990CE3C.http_method}",
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(api.restApiRootResourceId),
      },
    );
  });
});
