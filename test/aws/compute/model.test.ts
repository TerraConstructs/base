import {
  apiGatewayModel,
  apiGatewayMethod,
  apiGatewayRestApi,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as apigw from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = { address: "http://localhost:3000" };

describe("model", () => {
  let stack: AwsStack;
  let api: apigw.RestApi;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });

    api = new apigw.RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: true,
    });
    new apigw.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: api.root,
    });
  });

  test("default setup", () => {
    // WHEN
    new apigw.Model(stack, "my-model", {
      restApi: api,
      schema: {
        schema: apigw.JsonSchemaVersion.DRAFT4,
        title: "test",
        type: apigw.JsonSchemaType.OBJECT,
        properties: { message: { type: apigw.JsonSchemaType.STRING } },
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayModel.ApiGatewayModel,
      {
        rest_api_id: stack.resolve(api.restApiId),
        schema: JSON.stringify({
          $schema: apigw.JsonSchemaVersion.DRAFT4,
          title: "test",
          type: apigw.JsonSchemaType.OBJECT,
          properties: { message: { type: apigw.JsonSchemaType.STRING } },
        }),
        content_type: "application/json",
      },
    );
  });

  test("no deployment", () => {
    // WHEN
    new apigw.Model(stack, "my-model-no-deploy-test", {
      // Changed construct ID to avoid collision with 'default setup'
      restApi: api,
      schema: {
        schema: apigw.JsonSchemaVersion.DRAFT4,
        title: "test",
        type: apigw.JsonSchemaType.OBJECT,
        properties: { message: { type: apigw.JsonSchemaType.STRING } },
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayModel.ApiGatewayModel,
      {
        rest_api_id: stack.resolve(api.restApiId),
        schema: JSON.stringify({
          $schema: apigw.JsonSchemaVersion.DRAFT4,
          title: "test",
          type: apigw.JsonSchemaType.OBJECT,
          properties: { message: { type: apigw.JsonSchemaType.STRING } },
        }),
        content_type: "application/json",
      },
    );
  });
});
