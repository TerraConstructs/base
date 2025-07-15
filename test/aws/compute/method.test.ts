// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/method.test.ts

import {
  apiGatewayRestApi,
  apiGatewayResource,
  apiGatewayMethod,
  apiGatewayIntegration,
  apiGatewayModel,
  apiGatewayAuthorizer,
  apiGatewayRequestValidator,
  apiGatewayMethodResponse,
  apiGatewayIntegrationResponse,
  apiGatewayDeployment,
  apiGatewayStage,
  iamRole,
  iamUser,
  iamPolicy,
  lambdaFunction,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as compute from "../../../src/aws/compute";
import * as iam from "../../../src/aws/iam";
import { Duration } from "../../../src/duration";
// import { RemovalPolicy } from "../../../src/removal-policy";
import { Template } from "../../assertions";

const DUMMY_AUTHORIZER: compute.IAuthorizer = {
  authorizerId: "dummyauthorizer",
  authorizationType: compute.AuthorizationType.CUSTOM,
};

const environmentName = "TestEnv";
const gridUUID = "test-grid-uuid";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = { address: "http://localhost:4000" };

describe("method", () => {
  let app: App;
  let stack: AwsStack;
  let api: compute.RestApi;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    api = new compute.RestApi(stack, "test-api");
  });

  test("default setup", () => {
    // WHEN
    new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: api.root,
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(apiGatewayMethod.ApiGatewayMethod, {
      http_method: "POST",
      authorization: "NONE",
      rest_api_id: stack.resolve(api.restApiId),
      resource_id: stack.resolve(api.root.resourceId),
    });
    template.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "MOCK",
        http_method: "${aws_api_gateway_method.my-method_A0A925E5.http_method}", //"POST",
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(api.root.resourceId),
      },
    );
  });

  test("method options can be specified", () => {
    // WHEN
    new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: api.root,
      options: {
        apiKeyRequired: true,
        operationName: "MyOperation",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        api_key_required: true,
        operation_name: "MyOperation",
      },
    );
  });

  test("integration can be set via a property", () => {
    // WHEN
    new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: api.root,
      integration: new compute.AwsIntegration({
        service: "s3",
        path: "bucket/key",
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "AWS",
        http_method: "${aws_api_gateway_method.my-method_A0A925E5.http_method}",
        integration_http_method: "POST",
        uri: stack.resolve(
          `arn:${stack.partition}:apigateway:${stack.region}:s3:path/bucket/key`,
        ),
      },
    );
  });

  test("integration can be set for a service in the provided region", () => {
    // WHEN
    new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: api.root,
      integration: new compute.AwsIntegration({
        service: "sqs",
        path: "queueName",
        region: "eu-west-1",
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "AWS",
        http_method: "${aws_api_gateway_method.my-method_A0A925E5.http_method}",
        integration_http_method: "POST",
        uri: stack.resolve(
          `arn:${stack.partition}:apigateway:eu-west-1:sqs:path/queueName`,
        ),
      },
    );
  });

  test("integration with a custom http method can be set via a property", () => {
    // WHEN
    new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: api.root,
      integration: new compute.AwsIntegration({
        service: "s3",
        path: "bucket/key",
        integrationHttpMethod: "GET",
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        http_method: "${aws_api_gateway_method.my-method_A0A925E5.http_method}", // "GET",
        integration_http_method: "GET",
      },
    );
  });

  test("use default integration from api", () => {
    // GIVEN
    const defaultIntegration = new compute.Integration({
      type: compute.IntegrationType.HTTP_PROXY,
      integrationHttpMethod: "POST",
      uri: "https://amazon.com",
    });
    const newApi = new compute.RestApi(stack, "another-api", {
      defaultIntegration,
    });

    // WHEN
    new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: newApi.root,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "HTTP_PROXY",
        uri: "https://amazon.com",
        http_method: "${aws_api_gateway_method.my-method_A0A925E5.http_method}", // "POST",
        integration_http_method: "POST",
        rest_api_id: stack.resolve(newApi.restApiId),
      },
    );
  });

  test('"methodArn" returns the ARN execute-api ARN for this method in the current stage', () => {
    // WHEN
    const method = new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: api.root,
    });

    // THEN
    // Note: api.deploymentStage.stageName might be a token
    const expectedArn = stack.resolve(
      `arn:${stack.partition}:execute-api:${stack.region}:${stack.account}:${api.restApiId}/${api.deploymentStage.stageName}/POST/`,
    );
    expect(stack.resolve(method.methodArn)).toBe(expectedArn);
  });

  test('"testMethodArn" returns the ARN of the "test-invoke-stage" stage (console UI)', () => {
    // WHEN
    const method = new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: api.root,
    });

    // THEN
    const expectedArn = stack.resolve(
      `arn:${stack.partition}:execute-api:${stack.region}:${stack.account}:${api.restApiId}/test-invoke-stage/POST/`,
    );
    expect(stack.resolve(method.testMethodArn)).toBe(expectedArn);
  });

  test('"methodArn" returns an arn with "*" as its stage when deploymentStage is not set', () => {
    // GIVEN
    const apiNoDeploy = new compute.RestApi(stack, "api-no-deploy", {
      deploy: false,
    });

    // WHEN
    const method = new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: apiNoDeploy.root,
    });

    // THEN
    const expectedArn = stack.resolve(
      `arn:${stack.partition}:execute-api:${stack.region}:${stack.account}:${apiNoDeploy.restApiId}/*/POST/`,
    );
    expect(stack.resolve(method.methodArn)).toBe(expectedArn);
  });

  test('"methodArn" and "testMethodArn" replace path parameters with asterisks', () => {
    const petId = api.root.addResource("pets").addResource("{petId}");
    const commentId = petId.addResource("comments").addResource("{commentId}");
    const method = commentId.addMethod("GET");

    const expectedMethodArn = stack.resolve(
      `arn:${stack.partition}:execute-api:${stack.region}:${stack.account}:${api.restApiId}/${api.deploymentStage.stageName}/GET/pets/*/comments/*`,
    );
    expect(stack.resolve(method.methodArn)).toBe(expectedMethodArn);

    const expectedTestArn = stack.resolve(
      `arn:${stack.partition}:execute-api:${stack.region}:${stack.account}:${api.restApiId}/test-invoke-stage/GET/pets/*/comments/*`,
    );
    expect(stack.resolve(method.testMethodArn)).toBe(expectedTestArn);
  });

  test('integration "credentialsRole" can be used to assume a role when calling backend', () => {
    // GIVEN
    const role = new iam.Role(stack, "MyRole", {
      assumedBy: new iam.ServicePrincipal("foo.amazonaws.com"),
    });

    // WHEN
    api.root.addMethod(
      "GET",
      new compute.Integration({
        type: compute.IntegrationType.AWS_PROXY,
        integrationHttpMethod: "GET",
        options: {
          credentialsRole: role,
        },
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        credentials: stack.resolve(role.roleArn),
      },
    );
  });

  test('integration "credentialsPassthrough" can be used to passthrough user credentials to backend', () => {
    // WHEN
    api.root.addMethod(
      "GET",
      new compute.Integration({
        type: compute.IntegrationType.AWS_PROXY,
        integrationHttpMethod: "GET",
        options: {
          credentialsPassthrough: true,
        },
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        credentials: `arn:${stack.resolve(stack.partition)}:iam::*:user/*`,
      },
    );
  });

  test("methodResponse set one or more method responses via options", () => {
    // WHEN
    new compute.Method(stack, "method-man", {
      httpMethod: "GET",
      resource: api.root,
      options: {
        methodResponses: [
          {
            statusCode: "200",
          },
          {
            statusCode: "400",
            responseParameters: {
              "method.response.header.killerbees": false,
            },
          },
          {
            statusCode: "500",
            responseParameters: {
              "method.response.header.errthing": true,
            },
            responseModels: {
              "application/json": compute.Model.EMPTY_MODEL,
              "text/plain": compute.Model.ERROR_MODEL,
            },
          },
        ],
      },
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(api.root.resourceId),
        http_method:
          "${aws_api_gateway_method.method-man_A4031FD7.http_method}", //"GET",
        status_code: "200",
      },
    );
    template.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        status_code: "400",
        response_parameters: {
          "method.response.header.killerbees": false,
        },
      },
    );
    template.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        status_code: "500",
        response_parameters: {
          "method.response.header.errthing": true,
        },
        response_models: {
          "application/json": "Empty",
          "text/plain": "Error",
        },
      },
    );
  });

  test("multiple integration responses can be used", () => {
    // WHEN
    api.root.addMethod(
      "GET",
      new compute.AwsIntegration({
        service: "foo-service",
        action: "BarAction",
        options: {
          integrationResponses: [
            {
              statusCode: "200",
              responseTemplates: {
                "application/json": JSON.stringify({ success: true }),
              },
            },
            {
              selectionPattern: "Invalid",
              statusCode: "503",
              responseTemplates: {
                "application/json": JSON.stringify({
                  success: false,
                  message: "Invalid Request",
                }),
              },
            },
          ],
        },
      }),
    );

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        status_code: "200",
        response_templates: { "application/json": '{"success":true}' },
      },
    );
    template.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        status_code: "503",
        selection_pattern: "Invalid",
        response_templates: {
          "application/json": '{"success":false,"message":"Invalid Request"}',
        },
      },
    );
  });

  test("method is always set as uppercase", () => {
    // WHEN
    api.root.addMethod("get");
    api.root.addMethod("PoSt");
    api.root.addMethod("PUT");

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(apiGatewayMethod.ApiGatewayMethod, {
      http_method: "GET",
    });
    template.toHaveResourceWithProperties(apiGatewayMethod.ApiGatewayMethod, {
      http_method: "POST",
    });
    template.toHaveResourceWithProperties(apiGatewayMethod.ApiGatewayMethod, {
      http_method: "PUT",
    });
  });

  test("requestModel can be set", () => {
    // GIVEN
    const model = api.addModel("test-model", {
      contentType: "application/json",
      modelName: "test-model-name", // Explicit model name for easier assertion
      schema: {
        title: "test",
        type: compute.JsonSchemaType.OBJECT,
        properties: { message: { type: compute.JsonSchemaType.STRING } },
      },
    });

    // WHEN
    new compute.Method(stack, "method-man", {
      httpMethod: "GET",
      resource: api.root,
      options: {
        requestModels: {
          "application/json": model,
        },
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "GET",
        request_models: {
          "application/json": stack.resolve(model.modelId), // model.name should be 'test-model-name'
        },
      },
    );
  });

  test("methodResponse has a mix of response modes", () => {
    // GIVEN
    const htmlModel = api.addModel("my-model", {
      modelName: "my-html-model",
      schema: {
        schema: compute.JsonSchemaVersion.DRAFT4,
        title: "test",
        type: compute.JsonSchemaType.OBJECT,
        properties: { message: { type: compute.JsonSchemaType.STRING } },
      },
    });

    // WHEN
    new compute.Method(stack, "method-man", {
      httpMethod: "GET",
      resource: api.root,
      options: {
        methodResponses: [
          {
            statusCode: "200",
          },
          {
            statusCode: "400",
            responseParameters: {
              "method.response.header.killerbees": false,
            },
          },
          {
            statusCode: "500",
            responseParameters: {
              "method.response.header.errthing": true,
            },
            responseModels: {
              "application/json": compute.Model.EMPTY_MODEL,
              "text/plain": compute.Model.ERROR_MODEL,
              "text/html": htmlModel,
            },
          },
        ],
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        status_code: "500",
        response_models: {
          "application/json": "Empty",
          "text/plain": "Error",
          "text/html": stack.resolve(htmlModel.modelId),
        },
      },
    );
  });

  test("method has a request validator", () => {
    // GIVEN
    const validator = api.addRequestValidator("validator", {
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    // WHEN
    new compute.Method(stack, "method-man", {
      httpMethod: "GET",
      resource: api.root,
      options: {
        requestValidator: validator,
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        request_validator_id: stack.resolve(validator.requestValidatorId),
      },
    );
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRequestValidator.ApiGatewayRequestValidator,
      {
        rest_api_id: stack.resolve(api.restApiId),
        validate_request_body: true,
        validate_request_parameters: false,
      },
    );
  });

  test("use default requestParameters", () => {
    // GIVEN
    const newApi = new compute.RestApi(stack, "another-api-req-params", {
      defaultMethodOptions: {
        requestParameters: { "method.request.path.proxy": true },
      },
    });

    // WHEN
    new compute.Method(stack, "defaultRequestParameters", {
      httpMethod: "POST",
      resource: newApi.root,
      options: {
        operationName: "defaultRequestParametersOp",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        operation_name: "defaultRequestParametersOp",
        request_parameters: {
          "method.request.path.proxy": true,
        },
      },
    );
  });

  test("authorizer is bound correctly", () => {
    api.root.addMethod("ANY", undefined, {
      authorizer: DUMMY_AUTHORIZER,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "ANY",
        authorization: "CUSTOM",
        authorizer_id: DUMMY_AUTHORIZER.authorizerId,
      },
    );
  });

  test("authorizer via default method options", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });

    const auth = new compute.TokenAuthorizer(stack, "myauthorizer1", {
      authorizerName: "myauthorizer1name",
      handler: func,
    });

    const newApi = new compute.RestApi(stack, "another-api-auth", {
      defaultMethodOptions: {
        authorizer: auth,
      },
    });
    newApi.root.addMethod("ANY");

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayAuthorizer.ApiGatewayAuthorizer,
      {
        name: "myauthorizer1name",
        type: "TOKEN",
        rest_api_id: stack.resolve(newApi.restApiId),
      },
    );
  });

  test("fails when authorization type does not match the authorizer", () => {
    expect(() => {
      api.root.addMethod("ANY", undefined, {
        authorizationType: compute.AuthorizationType.IAM,
        authorizer: DUMMY_AUTHORIZER,
      });
    }).toThrow(
      /Authorization type is set to AWS_IAM which is different from what is required by the authorizer/,
    );
  });

  test("fails when authorization type does not match the authorizer in default method options", () => {
    const newApi = new compute.RestApi(stack, "another-api-fail", {
      defaultMethodOptions: {
        authorizer: DUMMY_AUTHORIZER,
      },
    });

    expect(() => {
      newApi.root.addMethod("ANY", undefined, {
        authorizationType: compute.AuthorizationType.IAM,
      });
    }).toThrow(
      /Authorization type is set to AWS_IAM which is different from what is required by the authorizer/,
    );
  });

  test("method has Auth Scopes", () => {
    new compute.Method(stack, "my-method", {
      httpMethod: "POST",
      resource: api.root,
      options: {
        apiKeyRequired: true,
        authorizationType: compute.AuthorizationType.COGNITO,
        authorizationScopes: ["AuthScope1", "AuthScope2"],
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        api_key_required: true,
        authorization_scopes: ["AuthScope1", "AuthScope2"],
        authorization: "COGNITO_USER_POOLS",
      },
    );
  });

  test("use default Auth Scopes", () => {
    const newApi = new compute.RestApi(stack, "another-api-scopes", {
      defaultMethodOptions: {
        authorizationType: compute.AuthorizationType.COGNITO,
        authorizationScopes: ["DefaultAuth"],
      },
    });

    new compute.Method(stack, "defaultAuthScopes", {
      httpMethod: "POST",
      resource: newApi.root,
      options: {
        operationName: "defaultAuthScopesOp",
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        operation_name: "defaultAuthScopesOp",
        authorization_scopes: ["DefaultAuth"],
        authorization: "COGNITO_USER_POOLS",
      },
    );
  });

  test("Override Authorization Type config in the default method config to None", () => {
    const newApi = new compute.RestApi(stack, "another-api-override", {
      defaultMethodOptions: {
        authorizationType: compute.AuthorizationType.COGNITO,
        authorizer: DUMMY_AUTHORIZER,
        authorizationScopes: ["DefaultAuth"],
      },
    });

    new compute.Method(stack, "OverrideDefaultAuthScopes", {
      httpMethod: "POST",
      resource: newApi.root,
      options: {
        operationName: "overrideDefaultAuthScopesOp",
        authorizationType: compute.AuthorizationType.NONE,
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        operation_name: "overrideDefaultAuthScopesOp",
        authorization: compute.AuthorizationType.NONE,
        // authorizer_id: undefined, // Check that authorizer_id is not set
        // authorization_scopes: undefined, // Check that authorization_scopes is not set
      },
    );
    Template.synth(stack).not.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        authorizer_id: expect.anything(), // Check that authorizer_id is not set
        authorization_scopes: expect.anything(), // Check that authorization_scopes is not set
      },
    );
  });

  test("Add Method that override the default method config authorization type to None do not fail", () => {
    const newApi = new compute.RestApi(stack, "another-api-override-ok", {
      defaultMethodOptions: {
        authorizationType: compute.AuthorizationType.COGNITO,
        authorizer: DUMMY_AUTHORIZER,
        authorizationScopes: ["DefaultAuth"],
      },
    });
    expect(() => {
      newApi.root.addMethod("ANY", undefined, {
        authorizationType: compute.AuthorizationType.NONE,
      });
    }).not.toThrow();
  });

  test("No options authorization type set but expect auth scope set", () => {
    const newApi = new compute.RestApi(stack, "another-api-no-opt-auth", {
      defaultMethodOptions: {
        authorizationType: compute.AuthorizationType.COGNITO,
      },
    });

    newApi.root.resourceForPath("/user/profile").addMethod("GET", undefined, {
      authorizationScopes: ["profile"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        authorization_scopes: ["profile"],
        authorization: "COGNITO_USER_POOLS",
      },
    );
  });

  test("Set auth scope in the rest api and expect scope is in method", () => {
    const newApi = new compute.RestApi(stack, "another-api-default-scope", {
      defaultMethodOptions: {
        authorizationType: compute.AuthorizationType.COGNITO,
        authorizationScopes: ["profile"],
      },
    });

    newApi.root.resourceForPath("/user/profile").addMethod("GET", undefined);

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        authorization_scopes: ["profile"],
        authorization: "COGNITO_USER_POOLS",
      },
    );
  });

  test("Override auth scope in the method over rest api", () => {
    const newApi = new compute.RestApi(stack, "another-api-override-scope", {
      defaultMethodOptions: {
        authorizationType: compute.AuthorizationType.COGNITO,
        authorizationScopes: ["profile"],
      },
    });

    newApi.root.resourceForPath("/user/profile").addMethod("GET", undefined, {
      authorizationScopes: ["hello"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        authorization_scopes: ["hello"],
        authorization: "COGNITO_USER_POOLS",
      },
    );
  });

  test("Expect auth scope to be none when auth type is not Cognito", () => {
    const newApi = new compute.RestApi(stack, "another-api-non-cognito", {
      defaultMethodOptions: {
        authorizationType: compute.AuthorizationType.COGNITO,
        authorizationScopes: ["profile"],
      },
    });

    newApi.root.resourceForPath("/user/profile").addMethod("GET", undefined, {
      authorizationScopes: ["hello"],
      authorizationType: compute.AuthorizationType.IAM,
    });

    Template.synth(stack).not.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        authorization_scopes: expect.anything(),
        authorization: "AWS_IAM",
      },
    );
  });

  test.each([
    [compute.AuthorizationType.IAM, undefined],
    [compute.AuthorizationType.NONE, undefined],
    [compute.AuthorizationType.CUSTOM, undefined],
    [compute.AuthorizationType.COGNITO, ["MethodAuthScope"]],
  ])(
    "Test combination of authType %s and expected authScopes %p",
    (authType, scopes) => {
      new compute.Method(stack, `MethodAuthScopeUsed-${authType}`, {
        httpMethod: "OPTIONS",
        resource: api.root,
        options: {
          apiKeyRequired: true,
          authorizationType: authType,
          authorizationScopes: ["MethodAuthScope"],
        },
      });

      Template.synth(stack).toHaveResourceWithProperties(
        apiGatewayMethod.ApiGatewayMethod,
        {
          ...(scopes ? { authorization_scopes: scopes } : {}),
          authorization: authType,
          http_method: "OPTIONS",
        },
      );
    },
  );

  test("Auth Scopes absent", () => {
    new compute.Method(stack, "authScopesAbsent", {
      httpMethod: "POST",
      resource: api.root,
      options: {
        operationName: "authScopesAbsentOp",
      },
    });

    Template.synth(stack).not.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        operation_name: "authScopesAbsentOp",
        authorization_scopes: expect.anything(),
      },
    );
  });

  test("method has a request validator with provided properties", () => {
    new compute.Method(stack, "method-man", {
      httpMethod: "GET",
      resource: api.root,
      options: {
        requestValidatorOptions: {
          requestValidatorName: "test-validator-name",
          validateRequestBody: true,
          validateRequestParameters: false,
        },
      },
    });

    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayRequestValidator.ApiGatewayRequestValidator,
      {
        rest_api_id: stack.resolve(api.restApiId),
        validate_request_body: true,
        validate_request_parameters: false,
        name: "test-validator-name",
      },
    );
  });

  test("method does not have a request validator", () => {
    new compute.Method(stack, "method-man", {
      httpMethod: "GET",
      resource: api.root,
    });

    Template.synth(stack).not.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        request_validator_id: expect.anything(),
      },
    );
  });

  test("method does not support both request validator and request validator options", () => {
    const validator = api.addRequestValidator("test-validator1", {
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    const methodProps = {
      httpMethod: "GET",
      resource: api.root,
      options: {
        requestValidatorOptions: {
          requestValidatorName: "test-validator2",
          validateRequestBody: true,
          validateRequestParameters: false,
        },
        requestValidator: validator,
      },
    };

    expect(() => new compute.Method(stack, "method", methodProps)).toThrow(
      /Only one of 'requestValidator' or 'requestValidatorOptions' must be specified./,
    );
  });

  test('"api" property returns the RestApi correctly', () => {
    const method = api.root.addResource("pets").addMethod("GET");
    expect(method.api).toBeDefined();
    expect(method.api.restApiId).toEqual(api.restApiId);
  });

  test('"api" returns correctly on imported RestApi', () => {
    const importedApi = compute.RestApi.fromRestApiAttributes(
      stack,
      "imported-api",
      {
        restApiId: "test-rest-api-id",
        rootResourceId: "test-root-resource-id",
      },
    );
    const method = importedApi.root.addResource("pets").addMethod("GET");
    expect(method.api).toBeDefined();
    expect(method.api.restApiId).toEqual("test-rest-api-id");
  });

  test("methodResponse should be passed from defaultMethodOptions", () => {
    const newApi = new compute.RestApi(stack, "another-api-method-resp", {
      defaultMethodOptions: {
        requestParameters: { "method.request.path.proxy": true },
        methodResponses: [
          {
            statusCode: "200",
          },
        ],
      },
    });

    new compute.Method(stack, "method-man", {
      httpMethod: "GET",
      resource: newApi.root,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        http_method:
          "${aws_api_gateway_method.method-man_A4031FD7.http_method}", //"GET",
        status_code: "200",
        rest_api_id: stack.resolve(newApi.restApiId),
      },
    );
  });

  describe("Metrics", () => {
    let method: compute.Method;
    let stage: compute.Stage;
    let metricApi: compute.RestApi;

    beforeEach(() => {
      // A new API and method for each metric test to ensure isolation
      metricApi = new compute.RestApi(stack, "metric-api");
      method = metricApi.root.addResource("pets").addMethod("GET");
      stage = metricApi.deploymentStage; // Relies on default deployment
    });

    test("metric", () => {
      const metricName = "4XXError";
      const statistic = "Sum";
      const metric = method.metric(metricName, stage, { statistic });

      expect(metric.namespace).toEqual("AWS/ApiGateway");
      expect(metric.metricName).toEqual(metricName);
      expect(metric.statistic).toEqual(statistic);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(metricApi.restApiName),
        Method: "GET",
        Resource: "/pets",
        Stage: stack.resolve(stage.stageName),
      });
    });

    test("metricClientError", () => {
      const color = "#00ff00";
      const metric = method.metricClientError(stage, { color });

      expect(metric.metricName).toEqual("4XXError");
      expect(metric.statistic).toEqual("Sum");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(metricApi.restApiName),
        Method: "GET",
        Resource: "/pets",
        Stage: stack.resolve(stage.stageName),
      });
    });

    test("metricServerError", () => {
      const color = "#00ff00";
      const metric = method.metricServerError(stage, { color });

      expect(metric.metricName).toEqual("5XXError");
      expect(metric.statistic).toEqual("Sum");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(metricApi.restApiName),
        Method: "GET",
        Resource: "/pets",
        Stage: stack.resolve(stage.stageName),
      });
    });

    test("metricCacheHitCount", () => {
      const color = "#00ff00";
      const metric = method.metricCacheHitCount(stage, { color });

      expect(metric.metricName).toEqual("CacheHitCount");
      expect(metric.statistic).toEqual("Sum");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(metricApi.restApiName),
        Method: "GET",
        Resource: "/pets",
        Stage: stack.resolve(stage.stageName),
      });
    });

    test("metricCacheMissCount", () => {
      const color = "#00ff00";
      const metric = method.metricCacheMissCount(stage, { color });

      expect(metric.metricName).toEqual("CacheMissCount");
      expect(metric.statistic).toEqual("Sum");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(metricApi.restApiName),
        Method: "GET",
        Resource: "/pets",
        Stage: stack.resolve(stage.stageName),
      });
    });

    test("metricCount", () => {
      const color = "#00ff00";
      const metric = method.metricCount(stage, { color });

      expect(metric.metricName).toEqual("Count");
      expect(metric.statistic).toEqual("SampleCount");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(metricApi.restApiName),
        Method: "GET",
        Resource: "/pets",
        Stage: stack.resolve(stage.stageName),
      });
    });

    test("metricIntegrationLatency", () => {
      const color = "#00ff00";
      const metric = method.metricIntegrationLatency(stage, { color });

      expect(metric.metricName).toEqual("IntegrationLatency");
      expect(metric.statistic).toEqual("Average");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(metricApi.restApiName),
        Method: "GET",
        Resource: "/pets",
        Stage: stack.resolve(stage.stageName),
      });
    });

    test("metricLatency", () => {
      const color = "#00ff00";
      const metric = method.metricLatency(stage, { color });

      expect(metric.metricName).toEqual("Latency");
      expect(metric.statistic).toEqual("Average");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(metricApi.restApiName),
        Method: "GET",
        Resource: "/pets",
        Stage: stack.resolve(stage.stageName),
      });
    });

    test("grantExecute", () => {
      const user = new iam.User(stack, "user");
      method.grantExecute(user);

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["execute-api:Invoke"],
              effect: iam.Effect.ALLOW,
              resources: [stack.resolve(method.methodArn)],
            },
          ],
        },
      );
    });
  });
});
