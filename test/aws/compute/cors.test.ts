// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/cors.test.ts

import {
  apiGatewayIntegration,
  apiGatewayIntegrationResponse,
  apiGatewayMethod,
  apiGatewayMethodResponse,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as lambda from "../../../src/aws/compute";
import { Cors, LambdaRestApi, RestApi } from "../../../src/aws/compute";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("cors", () => {
  let stack: AwsStack;
  let api: RestApi;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    api = new RestApi(stack, "api");
  });

  test("adds an OPTIONS method to a resource", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    resource.addCorsPreflight({
      allowOrigins: ["https://amazon.com"],
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
        api_key_required: false,
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        status_code: "204",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
          "method.response.header.Access-Control-Allow-Methods": true,
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://amazon.com'",
          "method.response.header.Vary": "'Origin'",
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse204_313243EB.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("allowCredentials", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    resource.addCorsPreflight({
      allowOrigins: ["https://amazon.com"],
      allowCredentials: true,
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        status_code: "204",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
          "method.response.header.Access-Control-Allow-Methods": true,
          "method.response.header.Access-Control-Allow-Credentials": true,
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://amazon.com'",
          "method.response.header.Vary": "'Origin'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
          "method.response.header.Access-Control-Allow-Credentials": "'true'",
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse204_313243EB.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("allowMethods", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    resource.addCorsPreflight({
      allowOrigins: ["https://aws.amazon.com"],
      allowMethods: ["GET", "PUT"],
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        status_code: "204",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
          "method.response.header.Access-Control-Allow-Methods": true,
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://aws.amazon.com'",
          "method.response.header.Vary": "'Origin'",
          "method.response.header.Access-Control-Allow-Methods": "'GET,PUT'",
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse204_313243EB.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("allowMethods ANY will expand to all supported methods", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    resource.addCorsPreflight({
      allowOrigins: ["https://aws.amazon.com"],
      allowMethods: ["ANY"],
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        status_code: "204",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
          "method.response.header.Access-Control-Allow-Methods": true,
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://aws.amazon.com'",
          "method.response.header.Vary": "'Origin'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse204_313243EB.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("allowMethods ANY cannot be used with any other method", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // THEN
    expect(() =>
      resource.addCorsPreflight({
        allowOrigins: ["https://aws.amazon.com"],
        allowMethods: ["ANY", "PUT"],
      }),
    ).toThrow(/ANY cannot be used with any other method. Received: ANY,PUT/);
  });

  test("statusCode can be used to set the response status code", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    resource.addCorsPreflight({
      allowOrigins: ["https://aws.amazon.com"],
      statusCode: 200,
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        status_code: "200",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
          "method.response.header.Access-Control-Allow-Methods": true,
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://aws.amazon.com'",
          "method.response.header.Vary": "'Origin'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse200_F10EDD87.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("allowOrigins must contain at least one origin", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    expect(() =>
      resource.addCorsPreflight({
        allowOrigins: [],
      }),
    ).toThrow(/allowOrigins must contain at least one origin/);
  });

  test("allowOrigins can be used to specify multiple origins", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    resource.addCorsPreflight({
      allowOrigins: [
        "https://twitch.tv",
        "https://amazon.com",
        "https://aws.amazon.com",
      ],
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        status_code: "204",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
          "method.response.header.Access-Control-Allow-Methods": true,
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://twitch.tv'",
          "method.response.header.Vary": "'Origin'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
        },
        response_templates: {
          "application/json": [
            '#set($origin = $input.params().header.get("Origin"))',
            '#if($origin == "")',
            '  #set($origin = $input.params().header.get("origin"))',
            "#end",
            '#if($origin == "https://amazon.com" || $origin == "https://aws.amazon.com")',
            "  #set($context.responseOverride.header.Access-Control-Allow-Origin = $origin)",
            "#end",
          ].join("\n"),
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse204_313243EB.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("maxAge can be used to specify Access-Control-Max-Age", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    resource.addCorsPreflight({
      allowOrigins: ["https://amazon.com"],
      maxAge: Duration.minutes(60),
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        status_code: "204",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
          "method.response.header.Access-Control-Allow-Methods": true,
          "method.response.header.Access-Control-Max-Age": true,
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://amazon.com'",
          "method.response.header.Vary": "'Origin'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
          "method.response.header.Access-Control-Max-Age": `'${60 * 60}'`,
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse204_313243EB.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("disableCache will set Max-Age to -1", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    resource.addCorsPreflight({
      allowOrigins: ["https://amazon.com"],
      disableCache: true,
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        status_code: "204",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
          "method.response.header.Access-Control-Allow-Methods": true,
          "method.response.header.Access-Control-Max-Age": true,
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://amazon.com'",
          "method.response.header.Vary": "'Origin'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
          "method.response.header.Access-Control-Max-Age": "'-1'",
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse204_313243EB.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("maxAge and disableCache are mutually exclusive", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // THEN
    expect(() =>
      resource.addCorsPreflight({
        allowOrigins: ["https://amazon.com"],
        disableCache: true,
        maxAge: Duration.seconds(10),
      }),
    ).toThrow(/The options "maxAge" and "disableCache" are mutually exclusive/);
  });

  test("exposeHeaders can be used to specify Access-Control-Expose-Headers", () => {
    // GIVEN
    const resource = api.root.addResource("MyResource");

    // WHEN
    resource.addCorsPreflight({
      allowOrigins: ["https://amazon.com"],
      exposeHeaders: ["Authorization", "Foo"],
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        status_code: "204",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
          "method.response.header.Access-Control-Allow-Methods": true,
          "method.response.header.Access-Control-Expose-Headers": true,
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://amazon.com'",
          "method.response.header.Vary": "'Origin'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
          "method.response.header.Access-Control-Expose-Headers":
            "'Authorization,Foo'",
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse204_313243EB.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("defaultCorsPreflightOptions can be used to specify CORS for all resource tree", () => {
    // GIVEN
    // api is already created in beforeEach

    // WHEN
    const resource = api.root.addResource("MyResource", {
      defaultCorsPreflightOptions: {
        allowOrigins: ["https://amazon.com"],
      },
    });
    const childResource = resource.addResource("MyChildResource");

    // THEN
    const template = new Template(stack);
    template.resourceCountIs(apiGatewayMethod.ApiGatewayMethod, 2); // on both resources
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(resource.resourceId),
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(childResource.resourceId),
      },
    );
  });

  test("defaultCorsPreflightOptions can be specified at the API level to apply to all resources", () => {
    // GIVEN
    const newStack = new AwsStack(Testing.app(), "NewStack", {
      environmentName,
      gridUUID: "new-uuid",
      providerConfig,
      gridBackendConfig,
    });

    // WHEN
    const newApi = new RestApi(newStack, "api", {
      defaultCorsPreflightOptions: {
        allowOrigins: ["https://amazon.com"],
      },
    });

    const child1 = newApi.root.addResource("child1");
    const child2 = child1.addResource("child2");

    // THEN
    const template = new Template(newStack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(newApi.root.resourceId),
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(child1.resourceId),
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
        resource_id: stack.resolve(child2.resourceId),
      },
    );
  });

  test('Vary: Origin is sent back if Allow-Origin is not "*"', () => {
    // GIVEN
    // api is already created in beforeEach

    // WHEN
    const allowAllResource = api.root.addResource("AllowAll", {
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
      },
    });

    const allowSpecificResource = api.root.addResource("AllowSpecific", {
      defaultCorsPreflightOptions: {
        allowOrigins: ["http://specific.com"],
      },
    });

    // THEN
    const template = new Template(stack);
    // Integration Response for AllowAll
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        resource_id: stack.resolve(allowAllResource.resourceId),
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
          "method.response.header.Access-Control-Allow-Origin": "'*'",
        },
      },
    );
    // Method Response for AllowAll
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(allowAllResource.resourceId),
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Methods": true,
          "method.response.header.Access-Control-Allow-Origin": true,
        },
      },
    );
    // Integration Response for AllowSpecific
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        resource_id: stack.resolve(allowSpecificResource.resourceId),
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
          "method.response.header.Access-Control-Allow-Origin":
            "'http://specific.com'",
          "method.response.header.Vary": "'Origin'",
        },
      },
    );
    // Method Response for AllowSpecific
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        resource_id: stack.resolve(allowSpecificResource.resourceId),
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Methods": true,
          "method.response.header.Access-Control-Allow-Origin": true,
          "method.response.header.Vary": true,
        },
      },
    );
  });

  test('If "*" is specified in allow-origin, it cannot be mixed with specific origins', () => {
    // GIVEN
    // api is already created in beforeEach

    // WHEN
    expect(() =>
      api.root.addResource("AllowAll", {
        defaultCorsPreflightOptions: {
          allowOrigins: ["https://bla.com", "*", "https://specific"],
        },
      }),
    ).toThrow(
      /Invalid "allowOrigins" - cannot mix "\*" with specific origins: https:\/\/bla.com,\*,https:\/\/specific/,
    );
  });

  test("defaultCorsPreflightOptions can be used to specify CORS for all resource tree [LambdaRestApi]", () => {
    // GIVEN
    const newStack = new AwsStack(Testing.app(), "NewStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const handler = new lambda.LambdaFunction(newStack, "handler", {
      code: lambda.Code.fromInline("boom"),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_LATEST,
    });

    // WHEN
    const lambdaApi = new LambdaRestApi(newStack, "lambda-rest-api", {
      handler,
      defaultCorsPreflightOptions: {
        allowOrigins: ["https://amazon.com"],
      },
    });

    // THEN
    const template = new Template(newStack);
    template.resourceCountIs(apiGatewayMethod.ApiGatewayMethod, 4); // two ANY and two OPTIONS resources
    // the root resource
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        rest_api_id: stack.resolve(lambdaApi.restApiId),
        resource_id: stack.resolve(lambdaApi.root.resourceId),
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        rest_api_id: stack.resolve(lambdaApi.restApiId),
        // and the Lambda Proxy resource
        resource_id:
          "${aws_api_gateway_resource.lambda-rest-api_proxy_E3AE07E3.id}",
      },
    );
  });

  test("defaultCorsPreflightOptions can be used to specify multiple origins", () => {
    // WHEN
    const resource = api.root.addResource("MyResource", {
      defaultCorsPreflightOptions: {
        allowOrigins: ["https://amazon.com", "https://twitch.tv"],
      },
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "MOCK",
        request_templates: {
          "application/json": "{ statusCode: 200 }",
        },
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(resource.resourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.api_MyResource_OPTIONS_7DD3822D.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
          "method.response.header.Access-Control-Allow-Origin":
            "'https://amazon.com'",
          "method.response.header.Vary": "'Origin'",
          "method.response.header.Access-Control-Allow-Methods":
            "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
        },
        response_templates: {
          "application/json": [
            '#set($origin = $input.params().header.get("Origin"))',
            '#if($origin == "")',
            '  #set($origin = $input.params().header.get("origin"))',
            "#end",
            '#if($origin == "https://twitch.tv")',
            "  #set($context.responseOverride.header.Access-Control-Allow-Origin = $origin)",
            "#end",
          ].join("\n"),
        },
        status_code:
          "${aws_api_gateway_method_response.api_MyResource_OPTIONS_MethodResponse204_313243EB.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.api_MyResource_OPTIONS_Integration_922817BF",
        ],
      },
    );
  });

  test("CORS and proxy resources", () => {
    // WHEN
    const proxyApi = new RestApi(stack, "API", {
      defaultCorsPreflightOptions: { allowOrigins: ["*"] },
    });

    proxyApi.root.addProxy();

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "OPTIONS",
      },
    );
  });
});
