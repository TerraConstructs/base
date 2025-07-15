// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/deployment.test.ts

import * as path from "path";
import { apiGatewayDeployment, apiGatewayStage } from "@cdktf/provider-aws";
import { App, Lazy, TerraformResource, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  Deployment,
  LambdaIntegration,
  RestApi,
  Stage,
} from "../../../src/aws/compute";
import * as lambda from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const terraformResourceType = "test_resource";

const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const CDKTFJSON_PATH = path.join(TEST_APPDIR, "cdktf.json");

describe("deployment", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.stubVersion(
      new App({
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, CDKTFJSON_PATH),
        },
      }),
    );
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("minimal setup", () => {
    // GIVEN
    const api = new RestApi(stack, "api", {
      deploy: false,
      cloudWatchRole: false,
    });
    const getMethod = api.root.addMethod("GET");

    // WHEN
    new Deployment(stack, "deployment", { api });

    // THEN
    const template = new Template(stack);
    template.toMatchObject({
      resource: {
        aws_api_gateway_method: {
          api_GET_ECF0BD67: {
            authorization: "NONE",
            http_method: "GET",
            resource_id:
              "${aws_api_gateway_rest_api.api_C8550315.root_resource_id}",
            rest_api_id: "${aws_api_gateway_rest_api.api_C8550315.id}",
          },
        },
        aws_api_gateway_rest_api: {
          api_C8550315: {
            name: "TestStackapiF0E8311D",
          },
        },
        aws_api_gateway_deployment: {
          deployment_33381975: {
            rest_api_id: stack.resolve(api.restApiId), //"${aws_api_gateway_rest_api.api_C8550315.id}",
            depends_on: ["aws_api_gateway_method.api_GET_ECF0BD67"],
            lifecycle: {
              create_before_destroy: true,
            },
            triggers: {
              redeployment: "a78788a5fc8f4e150c872a9074ed3802",
            },
          },
        },
        aws_api_gateway_integration: {
          api_GET_Integration_45D1407B: {
            rest_api_id: stack.resolve(api.restApiId),
            resource_id: stack.resolve(api.root.resourceId),
            // httpMethod is not a token, hardcoded attribute ref...
            // http_method: stack.resolve(getMethod.httpMethod),
            http_method:
              "${aws_api_gateway_method.api_GET_ECF0BD67.http_method}",
            type: "MOCK",
          },
        },
      },
    });
  });

  // Skipped: Implement RemovalPolicy.RETAIN through TCons orchestration and removed blocks?
  test.skip('"retainDeployments" can be used to control the deletion policy of the resource', () => {
    // GIVEN
    const api = new RestApi(stack, "api", {
      deploy: false,
      cloudWatchRole: false,
    });
    api.root.addMethod("GET");

    // WHEN
    new Deployment(stack, "deployment", { api }); //retainDeployments: true });

    // THEN
    const template = new Template(stack);
    const deployments = template.resourceTypeArray(
      apiGatewayDeployment.ApiGatewayDeployment,
    );
    expect(deployments.length).toBe(1);
    expect(deployments[0]).toMatchObject({
      rest_api_id: stack.resolve(api.restApiId),
      lifecycle: {
        create_before_destroy: true,
      },
      depends_on: expect.arrayContaining([
        expect.stringMatching(
          /^aws_api_gateway_method\.api_root_GET_[A-F0-9]+$/,
        ),
      ]),
    });
  });

  test('"description" can be set on the deployment', () => {
    // GIVEN
    const api = new RestApi(stack, "api", {
      deploy: false,
      cloudWatchRole: false,
    });
    api.root.addMethod("GET");

    // WHEN
    new Deployment(stack, "deployment", {
      api,
      description: "this is my deployment",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayDeployment.ApiGatewayDeployment,
      {
        description: "this is my deployment",
      },
    );
  });

  test('"stage" can be set on the deployment', () => {
    // GIVEN
    const api = new RestApi(stack, "api", {
      deploy: false,
      cloudWatchRole: false,
    });
    api.root.addMethod("GET");

    // WHEN
    const d = new Deployment(stack, "deployment", { api, stageName: "dev" });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResource(apiGatewayDeployment.ApiGatewayDeployment);
    t.expect.toHaveResourceWithProperties(apiGatewayStage.ApiGatewayStage, {
      stage_name: "dev",
      deployment_id: stack.resolve(d.deploymentId),
      rest_api_id: stack.resolve(api.restApiId),
      depends_on: ["aws_api_gateway_method.api_GET_ECF0BD67"],
    });
  });

  describe("force redeployment (using triggers)", () => {
    test("before changing triggers (no explicit triggers)", () => {
      // GIVEN
      const api = new RestApi(stack, "api", {
        deploy: false,
        cloudWatchRole: false,
      });
      new Deployment(stack, "deployment", { api });
      api.root.addMethod("GET");

      // THEN
      const template = new Template(stack);
      // A manually created Deployment triggers redeployment on
      // The RestApi properties only by default.
      template.expect.toHaveResourceWithProperties(
        apiGatewayDeployment.ApiGatewayDeployment,
        {
          triggers: {
            redeployment: "a78788a5fc8f4e150c872a9074ed3802",
            // "trigger-1": {
            //   api_C8550315: expect.objectContaining({
            //     name: "TestStackapiF0E8311D",
            //   }),
            // },
          },
        },
      );
    });

    test("after setting a resolved trigger value", () => {
      const api = new RestApi(stack, "api", {
        deploy: false,
        cloudWatchRole: false,
      });
      const deployment = new Deployment(stack, "deployment", {
        api,
      });
      deployment.addToTriggers({ foo: "123" }); // add some data to the triggers
      api.root.addMethod("GET");

      const template = new Template(stack);
      // Deployment triggers include the added object.
      template.expect.toHaveResourceWithProperties(
        apiGatewayDeployment.ApiGatewayDeployment,
        {
          triggers: {
            redeployment: "76ebc852a5a5dbc375482d2b2cc4e958",
            // "trigger-1": { foo: "123" },
            // "trigger-2": {
            //   api_C8550315: expect.objectContaining({
            //     name: "TestStackapiF0E8311D",
            //   }),
            // },
          },
        },
      );
    });

    test("after setting a resolved value and a token trigger", () => {
      const api = new RestApi(stack, "api", {
        deploy: false,
        cloudWatchRole: false,
      });
      const deployment = new Deployment(stack, "deployment", {
        api,
      });
      // adding triggers
      deployment.addToTriggers({ foo: 123 }); // add some data to the logical ID

      // tokens supported, and are resolved upon synthesis
      const value = "hello hello";
      deployment.addToTriggers({
        foo: Lazy.stringValue({ produce: () => value }),
      });
      api.root.addMethod("GET");

      const template = new Template(stack);
      // Deployment triggers include the added objects (and resolves the values).
      template.expect.toHaveResourceWithProperties(
        apiGatewayDeployment.ApiGatewayDeployment,
        {
          triggers: {
            redeployment: "f3ee519c31c58008f19e16c77227b87a",
            // "trigger-1": {
            //   foo: 123,
            // },
            // "trigger-2": {
            //   foo: "hello hello",
            // },
            // "trigger-3": {
            //   api_C8550315: expect.objectContaining({
            //     name: "TestStackapiF0E8311D",
            //   }),
            // },
          },
        },
      );
    });
  });

  test('"addDependency" can be used to add a resource as a dependency', () => {
    // GIVEN
    const api = new RestApi(stack, "api", {
      deploy: false,
      cloudWatchRole: false,
    });
    const deployment = new Deployment(stack, "deployment", { api });
    api.root.addMethod("GET");

    const dep = new TerraformResource(stack, "MyResource", {
      terraformResourceType,
    });

    // WHEN
    deployment.node.addDependency(dep);
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayDeployment.ApiGatewayDeployment,
      {
        depends_on: [
          "aws_api_gateway_method.api_GET_ECF0BD67",
          terraformResourceType + ".MyResource",
        ],
      },
    );
  });

  test("integration change invalidates deployment", () => {
    // Use same AwsStackId and Attributes under a new app
    const app2 = Testing.stubVersion(
      new App({
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, CDKTFJSON_PATH),
        },
      }),
    );
    const stack2 = new AwsStack(app2, "TestStack", {
      environmentName,
      gridUUID: "diff-uuid-for-stack2",
      providerConfig,
      gridBackendConfig,
    });
    // GIVEN
    const handler1 = new lambda.LambdaFunction(stack, "handler1", {
      code: lambda.Code.fromAsset(path.join(__dirname, "lambda")),
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: "index.handler",
    });
    const handler2 = new lambda.LambdaFunction(stack2, "handler2", {
      code: lambda.Code.fromAsset(path.join(__dirname, "lambda")),
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: "index.handler",
    });
    const api1 = new RestApi(stack, "myapi1", {
      defaultIntegration: new LambdaIntegration(handler1),
    });
    api1.root.addMethod("GET");

    const api2 = new RestApi(stack2, "myapi2", {
      defaultIntegration: new LambdaIntegration(handler2),
    });
    api2.root.addMethod("GET");

    // THEN
    const template1 = new Template(stack);
    const template2 = new Template(stack2);

    const deployments1 = template1
      .resourceTypeArray(apiGatewayDeployment.ApiGatewayDeployment)
      .filter(
        (d: any) => d.rest_api_id === stack.resolve(api1.restApiId),
      ) as apiGatewayDeployment.ApiGatewayDeployment[];
    expect(deployments1.length).toBe(1);
    const deployment1Triggers = deployments1[0].triggers;

    const deployments2 = template2
      .resourceTypeArray(apiGatewayDeployment.ApiGatewayDeployment)
      .filter(
        (d: any) => d.rest_api_id === stack2.resolve(api2.restApiId),
      ) as apiGatewayDeployment.ApiGatewayDeployment[];
    expect(deployments2.length).toBe(1);
    const deployment2Triggers = deployments2[0].triggers;

    expect(deployment1Triggers).toBeDefined();
    expect(deployment2Triggers).toBeDefined();
    expect(deployment1Triggers).not.toEqual(deployment2Triggers);
  });

  test("deployment resource depends on all restapi methods defined", () => {
    const restapi = new RestApi(stack, "myapi", {
      deploy: false,
    });
    restapi.root.addMethod("GET");

    const deployment = new Deployment(stack, "mydeployment", {
      api: restapi,
    });
    const stage = new Stage(stack, "mystage", {
      deployment,
      stageName: "dev",
    });
    restapi.deploymentStage = stage;

    restapi.root.addMethod("POST");
    restapi.root.addResource("myresource").addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayDeployment.ApiGatewayDeployment,
      {
        depends_on: [
          "aws_api_gateway_method.myapi_GET_9B7CD29E",
          "aws_api_gateway_method.myapi_POST_23417BD2",
          "aws_api_gateway_method.myapi_myresource_GET_732851A5",
        ],
      },
    );
  });
});
