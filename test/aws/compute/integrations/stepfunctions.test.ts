// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/integrations/stepfunctions.test.ts

import {
  apiGatewayMethod,
  apiGatewayIntegration,
  // apiGatewayRestApi,
  // apiGatewayResource,
  apiGatewayMethodResponse,
  apiGatewayIntegrationResponse,
  apiGatewayDeployment,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import {
  Pass,
  StateMachine,
  DefinitionBody,
  StateMachineType,
  RestApi,
  StepFunctionsIntegration,
  MethodOptions,
  IntegrationOptions,
  StepFunctionsRestApi,
  Deployment,
  Stage,
} from "../../../../src/aws/compute";
import { Template } from "../../../assertions";

const environmentName = "TestEnv";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = { address: "http://localhost:3000" };

describe("StepFunctionsIntegration", () => {
  describe("startExecution", () => {
    test("minimal setup", () => {
      // GIVEN
      const { stack, api, stateMachine } = givenSetup();

      // WHEN
      const integ = StepFunctionsIntegration.startExecution(stateMachine);
      //const getMethod =
      api.root.addMethod("GET", integ);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        apiGatewayMethod.ApiGatewayMethod,
        {
          resource_id: stack.resolve(api.restApiRootResourceId),
          rest_api_id: stack.resolve(api.restApiId),
          authorization: "NONE",
          http_method: "GET",
        },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          // NOTE: httpMethod is not a token :( -> stack.resolve(getMethod.httpMethod) does not work,
          http_method:
            "${aws_api_gateway_method.my-rest-api_GET_3A49A218.http_method}",
          integration_http_method: "POST",
          type: "AWS",
          uri: `arn:\${data.aws_partition.Partitition.partition}:apigateway:us-east-1:states:action/StartSyncExecution`,
          passthrough_behavior: "NEVER",
          request_templates: {
            "application/json": expect.stringContaining(
              `"stateMachineArn": "${stack.resolve(stateMachine.stateMachineArn)}"`,
            ),
          },
        },
      );
      for (const integrationResponse of getIntegrationResponses({
        "200": "GET_MethodResponse200_9DDECEEE",
        "400": "GET_MethodResponse400_E2EA452A",
        "500": "GET_MethodResponse500_0C3AABB8",
      })) {
        template.expect.toHaveResourceWithProperties(
          apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
          {
            rest_api_id: stack.resolve(api.restApiId),
            resource_id: stack.resolve(api.restApiRootResourceId),
            // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
            http_method:
              "${aws_api_gateway_method.my-rest-api_GET_3A49A218.http_method}",
            ...integrationResponse,
            // ensures integration response depends on the integration
            // see NOTE on https://registry.terraform.io/providers/hashicorp/aws/5.100.0/docs/resources/api_gateway_integration_response
            depends_on: [
              "aws_api_gateway_integration.my-rest-api_GET_Integration_CC316BCF",
            ],
          },
        );
      }
    });

    test("headers are NOT included by default", () => {
      // GIVEN
      const { stack, api, stateMachine } = givenSetup();

      // WHEN
      const integ = StepFunctionsIntegration.startExecution(stateMachine);
      api.root.addMethod("GET", integ);

      new Template(stack).expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          request_templates: {
            "application/json": expect.stringMatching(
              /#set\(\$includeHeaders = false\)/,
            ),
          },
        },
      );
    });

    test("headers are included when specified by the integration", () => {
      // GIVEN
      const { stack, api, stateMachine } = givenSetup();

      // WHEN
      const integ = StepFunctionsIntegration.startExecution(stateMachine, {
        headers: true,
      });
      api.root.addMethod("GET", integ);

      new Template(stack).expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          request_templates: {
            "application/json": expect.stringMatching(
              /#set\(\$includeHeaders = true\)/,
            ),
          },
        },
      );
    });

    test("querystring and path are included by default", () => {
      // GIVEN
      const { stack, api, stateMachine } = givenSetup();

      // WHEN
      const integ = StepFunctionsIntegration.startExecution(stateMachine);
      api.root.addMethod("GET", integ);

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          request_templates: {
            "application/json": expect.stringMatching(
              /#set\(\$includeQueryString = true\)/,
            ),
          },
        },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          request_templates: {
            "application/json": expect.stringMatching(
              /#set\(\$includePath = true\)/,
            ),
          },
        },
      );
    });

    test("querystring and path are false when specified by the integration", () => {
      // GIVEN
      const { stack, api, stateMachine } = givenSetup();

      // WHEN
      const integ = StepFunctionsIntegration.startExecution(stateMachine, {
        querystring: false,
        path: false,
      });
      api.root.addMethod("GET", integ);

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          request_templates: {
            "application/json": expect.stringMatching(
              /#set\(\$includeQueryString = false\)/,
            ),
          },
        },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          request_templates: {
            "application/json": expect.stringMatching(
              /#set\(\$includePath = false\)/,
            ),
          },
        },
      );
    });

    test("request context is NOT included by default", () => {
      // GIVEN
      const { stack, api, stateMachine } = givenSetup();

      // WHEN
      const integ = StepFunctionsIntegration.startExecution(stateMachine, {});
      api.root.addMethod("GET", integ);

      new Template(stack).expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          request_templates: {
            "application/json": expect.stringMatching(
              /#set\(\$requestContext = ""\)/,
            ),
          },
        },
      );
    });

    test("request context is included when specified by the integration", () => {
      // GIVEN
      const { stack, api, stateMachine } = givenSetup();

      // WHEN
      const integ = StepFunctionsIntegration.startExecution(stateMachine, {
        requestContext: {
          accountId: true,
        },
      });
      api.root.addMethod("GET", integ);

      new Template(stack).expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          request_templates: {
            "application/json": expect.stringMatching(
              /#set\(\$requestContext = "{@@accountId@@:@@\$context.identity.accountId@@}"/,
            ),
          },
        },
      );
    });

    test("authorizer context is included when specified by the integration", () => {
      // GIVEN
      const { stack, api, stateMachine } = givenSetup();

      // WHEN
      const integ = StepFunctionsIntegration.startExecution(stateMachine, {
        authorizer: true,
      });
      api.root.addMethod("GET", integ);

      new Template(stack).expect.toHaveResourceWithProperties(
        apiGatewayIntegration.ApiGatewayIntegration,
        {
          request_templates: {
            "application/json": expect.stringMatching(
              /#set\(\$includeAuthorizer = true\)/,
            ),
          },
        },
      );
    });

    test("works for imported RestApi", () => {
      const app = Testing.app();
      const stack = new AwsStack(app, "MyStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
      const api = RestApi.fromRestApiAttributes(stack, "RestApi", {
        restApiId: "imported-rest-api-id",
        rootResourceId: "imported-root-resource-id",
      });

      const passTask = new Pass(stack, "passTask", {
        inputPath: "$.somekey",
      });

      const stateMachine = new StateMachine(stack, "StateMachine", {
        definitionBody: DefinitionBody.fromChainable(passTask),
        stateMachineType: StateMachineType.EXPRESS,
      });

      api.root.addMethod(
        "ANY",
        StepFunctionsIntegration.startExecution(stateMachine),
      );

      new Template(stack).expect.toHaveResourceWithProperties(
        apiGatewayMethod.ApiGatewayMethod,
        {
          resource_id: "imported-root-resource-id",
          rest_api_id: "imported-rest-api-id",
        },
      );
    });

    // NOTE: deploymentToken is a CDK-specific concept for managing deployment updates.
    // TerraConstructs/CDKTF handles deployments differently (e.g., via explicit triggers or resource changes).
    // These tests may not be directly applicable or may need to assert on deployment resource triggers if relevant.
    test.skip("fingerprint is not computed when stateMachineName is not specified", () => {
      // GIVEN
      const { stack, api, stateMachine } = givenSetup();
      const method = api.root.addMethod("ANY");
      const integ = StepFunctionsIntegration.startExecution(stateMachine);

      // WHEN
      const bindResult = integ.bind(method);

      // THEN
      expect(bindResult?.deploymentToken).toBeUndefined();
    });

    test.skip("bind works for integration with imported State Machine", () => {
      // GIVEN
      const { stack, api } = givenSetup();
      const method = api.root.addMethod("ANY");
      const stateMachine = StateMachine.fromStateMachineArn(
        stack,
        "MyStateMachine",
        "arn:aws:states:region:account:stateMachine:MyStateMachine",
      );
      const integration = StepFunctionsIntegration.startExecution(
        stateMachine,
        {},
      );

      // WHEN
      const bindResult = integration.bind(method);

      // THEN
      expect(bindResult?.deploymentToken).toEqual(
        '{"stateMachineName":"StateMachine-c8adc83b19e793491b1c6ea0fd8b46cd9f32e592fc"}',
      );
    });

    test("fails integration if State Machine is not of type EXPRESS", () => {
      // GIVEN
      const { stack, api } = givenSetup();
      const method = api.root.addMethod("ANY");
      const stateMachine = new StateMachine(stack, "StateMachineStandard", {
        definitionBody: DefinitionBody.fromChainable(
          new Pass(stack, "passTaskStandard"),
        ),
        stateMachineType: StateMachineType.STANDARD,
      });
      const integration = StepFunctionsIntegration.startExecution(stateMachine);

      // WHEN + THEN
      expect(() => integration.bind(method)).toThrow(
        /State Machine must be of type "EXPRESS". Please use StateMachineType.EXPRESS as the stateMachineType/,
      );
    });
  });

  // REF: https://github.com/aws/aws-cdk/pull/26636#issuecomment-1674470218
  // Skipped -> replaced by fix + unit test from https://github.com/aws/aws-cdk/pull/26718
  test.skip("addMethod is not susceptible to false sharing of arrays", () => {
    // GIVEN
    const { stack, api, stateMachine } = givenSetup();

    // WHEN
    const methodOptions: MethodOptions = {
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    };

    const integrationOptions: IntegrationOptions = {
      integrationResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": "'*'",
          },
        },
      ],
    };

    const integ = StepFunctionsIntegration.startExecution(
      stateMachine,
      integrationOptions,
    );
    const methodGet = api.root.addMethod("GET", integ, methodOptions);
    const methodPost = api.root.addMethod("POST", integ, methodOptions);

    // THEN - the MethodResponses arrays have 4 elements instead of 8
    // (This is still incorrect because 200 occurs multiple times, but that's a separate
    // issue with a non-straightforward solution)
    const template = new Template(stack, { snapshot: true });
    template.resourceCountIs(apiGatewayMethod.ApiGatewayMethod, 2);
    const tfMethodResponses = template.resourceTypeArray(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
    );
    // 2 x (3 Default + 1 Custom) = 8
    expect(tfMethodResponses).toHaveLength(8);
    expect(tfMethodResponses).toMatchObject(
      expect.arrayContaining([
        // GET  - 200 - custom response exist
        {
          status_code: "200",
          rest_api_id: stack.resolve(api.restApiId),
          resource_id: stack.resolve(api.restApiRootResourceId),
          http_method: stack.resolve(methodGet.httpMethod),
          response_models: {
            "application/json": "Empty",
          },
          response_parameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
        // GET  - 200 - default response <--- Causes inconsistent behavior and is incorrect
        {
          status_code: "200",
          rest_api_id: stack.resolve(api.restApiId),
          resource_id: stack.resolve(api.restApiRootResourceId),
          http_method: stack.resolve(methodGet.httpMethod),
          response_models: {
            "application/json": "Empty",
          },
        },
        // POST - 200 - custom response exist
        {
          status_code: "200",
          rest_api_id: stack.resolve(api.restApiId),
          resource_id: stack.resolve(api.restApiRootResourceId),
          http_method: stack.resolve(methodPost.httpMethod),
          response_models: {
            "application/json": "Empty",
          },
          response_parameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
        // POST - 200 - default response <--- Causes inconsistent behavior and is incorrect
        {
          status_code: "200",
          rest_api_id: stack.resolve(api.restApiId),
          resource_id: stack.resolve(api.restApiRootResourceId),
          http_method: stack.resolve(methodPost.httpMethod),
          response_models: {
            "application/json": "Empty",
          },
        },
      ]),
    );

    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(api.restApiRootResourceId),
        http_method: stack.resolve(methodGet.httpMethod),
        response_parameters: {
          "method.response.header.Access-Control-Allow-Origin": true,
        },
        status_code:
          "${aws_api_gateway_method_response.my-rest-api_GET_MethodResponse200_9DDECEEE.status_code}",
        depends_on: [
          "aws_api_gateway_integration.my-rest-api_GET_Integration_CC316BCF",
        ],
      },
    );

    // Each method gets its own integration resource
    template.resourceCountIs(apiGatewayIntegration.ApiGatewayIntegration, 2);
  });

  test("default method responses are not created when useDefaultMethodResponses is false", () => {
    // GIVEN
    const { stack, api, stateMachine } = givenSetup();

    // WHEN
    const methodOptions: MethodOptions = {
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    };

    const integrationOptions = {
      useDefaultMethodResponses: false,
    };

    const integ = StepFunctionsIntegration.startExecution(
      stateMachine,
      integrationOptions,
    );
    api.root.addMethod("GET", integ, methodOptions);

    // THEN
    const template = new Template(stack);
    template.resourceCountIs(apiGatewayMethod.ApiGatewayMethod, 1);
    // Only the explicitly provided method response should exist
    template.resourceCountIs(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      1,
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
      {
        http_method:
          "${aws_api_gateway_method.my-rest-api_GET_3A49A218.http_method}",
        status_code: "200",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Origin": true,
        },
      },
    );
  });

  // Test from https://github.com/aws/aws-cdk/pull/26718/files
  test("merging methodOptions.methodResponses, and not susceptible to false sharing of arrays", () => {
    //GIVEN
    const { stack, api, stateMachine } = givenSetup();

    //WHEN
    const methodOptions = {
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    };

    const integrationOptions = {
      integrationResponses: [
        {
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": "'*'",
          },
          statusCode: "200",
        },
      ],
    };

    const integ = StepFunctionsIntegration.startExecution(
      stateMachine,
      integrationOptions,
    );
    // const methodGet =
    api.root.addMethod("GET", integ, methodOptions);
    // const methodPost =
    api.root.addMethod("POST", integ, methodOptions);

    //THEN
    const template = new Template(stack);
    template.resourceCountIs(apiGatewayMethod.ApiGatewayMethod, 2);
    const tfMethodResponses = template.resourceTypeArray(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
    );
    // 2 x (1 (custom merged with default) + 2 default) = 6
    expect(tfMethodResponses).toHaveLength(6);
    expect(tfMethodResponses).toMatchObject(
      expect.arrayContaining([
        // GET - 200 - custom response + default response merged
        {
          status_code: "200",
          rest_api_id: stack.resolve(api.restApiId),
          resource_id: stack.resolve(api.restApiRootResourceId),
          // httpMethod is not a token :/ - stack.resolve(methodGet.httpMethod),
          http_method: expect.stringContaining("GET"),
          response_models: {
            "application/json": "Empty",
          },
          response_parameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
        // POST - 200 - custom response + default response merged
        {
          status_code: "200",
          rest_api_id: stack.resolve(api.restApiId),
          resource_id: stack.resolve(api.restApiRootResourceId),
          // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
          http_method: expect.stringContaining("POST"),
          response_models: {
            "application/json": "Empty",
          },
          response_parameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ]),
    );
    // Each method gets its own integration resource
    template.resourceCountIs(apiGatewayIntegration.ApiGatewayIntegration, 2);
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(api.restApiRootResourceId),
        // httpMethod is not a token :/ - stack.resolve(methodGet.httpMethod),
        http_method:
          "${aws_api_gateway_method.my-rest-api_GET_3A49A218.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Origin": "'*'",
        },
        status_code:
          "${aws_api_gateway_method_response.my-rest-api_GET_MethodResponse200_9DDECEEE.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.my-rest-api_GET_Integration_CC316BCF",
        ],
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(api.restApiRootResourceId),
        // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
        http_method:
          "${aws_api_gateway_method.my-rest-api_POST_155A9625.http_method}",
        response_parameters: {
          "method.response.header.Access-Control-Allow-Origin": "'*'",
        },
        status_code:
          "${aws_api_gateway_method_response.my-rest-api_POST_MethodResponse200_6A0AC3A7.status_code}",
        // integration response depends on the integration
        depends_on: [
          "aws_api_gateway_integration.my-rest-api_POST_Integration_AAC8CBCD",
        ],
      },
    );
  });

  test("deployments depend on integrations", () => {
    //GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    // Create the set up take reference from integ/aws/compute/apps/apigw.stepfunctions.ts
    const passTask = new Pass(stack, "PassTask", {
      result: { value: "Hello" },
    });

    const stateMachine = new StateMachine(stack, "StateMachine", {
      stateMachineName: "StepFunctionsApiTest",
      definitionBody: DefinitionBody.fromChainable(passTask),
      stateMachineType: StateMachineType.EXPRESS,
    });

    const api = new StepFunctionsRestApi(stack, "StepFunctionsRestApi", {
      restApiName: "step-functions-api-test",
      deploy: false,
      cloudWatchRole: true,
      stateMachine: stateMachine,
      headers: true,
      path: false,
      querystring: false,
      requestContext: {
        accountId: true,
        userArn: true,
      },
    });

    // THEN
    // ensure that deployments depend on integrations (even if they're added after apigw was created)
    api.deploymentStage = new Stage(stack, "stage", {
      deployment: new Deployment(stack, "deployment", {
        api: api,
      }),
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayDeployment.ApiGatewayDeployment,
      {
        depends_on: [
          "aws_api_gateway_method.StepFunctionsRestApi_ANY_7699CA92",
          "aws_api_gateway_integration.StepFunctionsRestApi_ANY_Integration_7A633F8C",
          "aws_api_gateway_integration_response.StepFunctionsRestApi_ANY_IntegrationResponse200_27690845",
          "aws_api_gateway_integration_response.StepFunctionsRestApi_ANY_IntegrationResponse400_3482DF99",
          "aws_api_gateway_integration_response.StepFunctionsRestApi_ANY_IntegrationResponse500_BCD6D106",
        ],
      },
    );
  });
});

function givenSetup() {
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  const api = new RestApi(stack, "my-rest-api");
  const passTask = new Pass(stack, "passTask", {
    inputPath: "$.somekey",
  });

  const stateMachine = new StateMachine(stack, "StateMachine", {
    definitionBody: DefinitionBody.fromChainable(passTask),
    stateMachineType: StateMachineType.EXPRESS,
  });

  return { stack, api, stateMachine };
}

interface IntegrationResponseIds {
  "200": string;
  "400": string;
  "500": string;
}

/** Return the full ApiGatewayIntegrationResponse for each status code */
function getIntegrationResponses(
  methodResponseIds: IntegrationResponseIds,
): any[] {
  const errorResponse = [
    {
      selection_pattern: "4\\d{2}", // Escaped for JSON string, then for regex
      status_code: `\${aws_api_gateway_method_response.my-rest-api_${methodResponseIds["400"]}.status_code}`,
      response_templates: {
        "application/json": `{
            "error": "Bad request!"
          }`,
      },
    },
    {
      selection_pattern: "5\\d{2}", // Escaped for JSON string, then for regex
      status_code: `\${aws_api_gateway_method_response.my-rest-api_${methodResponseIds["500"]}.status_code}`,
      response_templates: {
        "application/json": "\"error\": $input.path('$.error')",
      },
    },
  ];

  const integResponse = [
    {
      status_code: `\${aws_api_gateway_method_response.my-rest-api_${methodResponseIds["200"]}.status_code}`,
      response_templates: {
        "application/json": [
          "#set($inputRoot = $input.path('$'))",
          "#if($input.path('$.status').toString().equals(\"FAILED\"))",
          "#set($context.responseOverride.status = 500)",
          "{",
          '"error": "$input.path(\'$.error\')",',
          '"cause": "$input.path(\'$.cause\')"',
          "}",
          "#else",
          "$input.path('$.output')",
          "#end",
        ].join("\n"),
      },
    },
    ...errorResponse,
  ];

  return integResponse;
}
