// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/stepfunctions-api.test.ts

import {
  apiGatewayMethod,
  apiGatewayRestApi,
  apiGatewayIntegration,
  apiGatewayModel,
  iamRole,
  dataAwsIamPolicyDocument,
  sfnStateMachine,
  apiGatewayResource,
  apiGatewayIntegrationResponse,
  apiGatewayMethodResponse,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import {
  StateMachine,
  DefinitionBody,
  StepFunctionsIntegration,
} from "../../../src/aws/compute";
import * as compute from "../../../src/aws/compute";
import * as iam from "../../../src/aws/iam";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("Step Functions api", () => {
  test("StepFunctionsRestApi defines correct REST API resources", () => {
    // GIVEN
    const { stack, stateMachine } = givenSetup();

    // WHEN
    const api = whenCondition(stack, stateMachine);
    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        resource_id: stack.resolve(api.restApiRootResourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
        http_method: "ANY",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        credentials:
          "${aws_iam_role.StepFunctionsRestApi_ANY_StartSyncExecutionRole_425C03BB.arn}",
        http_method:
          "${aws_api_gateway_method.StepFunctionsRestApi_ANY_7699CA92.http_method}",
        integration_http_method: "POST",
        passthrough_behavior: "NEVER",
        request_templates: {
          "application/json": expect.stringContaining(
            `"stateMachineArn": "${stack.resolve(stateMachine.stateMachineArn)}"`,
          ),
        },
        resource_id:
          "${aws_api_gateway_rest_api.StepFunctionsRestApi_C6E3E883.root_resource_id}",
        rest_api_id:
          "${aws_api_gateway_rest_api.StepFunctionsRestApi_C6E3E883.id}",
        type: "AWS",
        uri: stack.resolve(
          `arn:${stack.partition}:apigateway:${stack.region}:states:action/StartSyncExecution`,
        ),
      },
    );
    for (const integrationResponse of getIntegrationResponses({
      "200": "StepFunctionsRestApi_ANY_MethodResponse200_8DAD8FBD",
      "400": "StepFunctionsRestApi_ANY_MethodResponse400_A308904E",
      "500": "StepFunctionsRestApi_ANY_MethodResponse500_92C80F46",
    })) {
      template.expect.toHaveResourceWithProperties(
        apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
        {
          rest_api_id: stack.resolve(api.restApiId),
          resource_id: stack.resolve(api.restApiRootResourceId),
          // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
          http_method:
            "${aws_api_gateway_method.StepFunctionsRestApi_ANY_7699CA92.http_method}",
          ...integrationResponse,
          // ensures integration response depends on the integration
          // see NOTE on https://registry.terraform.io/providers/hashicorp/aws/5.100.0/docs/resources/api_gateway_integration_response
          depends_on: [
            "aws_api_gateway_integration.StepFunctionsRestApi_ANY_Integration_7A633F8C",
          ],
        },
      );
    }
    for (const methodResponse of getMethodResponse()) {
      template.expect.toHaveResourceWithProperties(
        apiGatewayMethodResponse.ApiGatewayMethodResponse,
        methodResponse,
      );
    }
  });

  test("StepFunctionsExecutionIntegration on a method", () => {
    // GIVEN
    const stack = new AwsStack(Testing.app(), "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const api = new compute.RestApi(stack, "Api");
    const stateMachine = new compute.StateMachine(stack, "StateMachine", {
      stateMachineType: compute.StateMachineType.EXPRESS,
      definitionBody: DefinitionBody.fromChainable(
        new compute.Pass(stack, "Pass"),
      ),
    });

    // WHEN
    const sfnResource = api.root.addResource("sfn");
    const postMethod = sfnResource.addMethod(
      "POST",
      StepFunctionsIntegration.startExecution(stateMachine),
    );

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        resource_id: stack.resolve(sfnResource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
        http_method: "POST",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        resource_id: stack.resolve(sfnResource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        type: "AWS",
        credentials:
          "${aws_iam_role.Api_sfn_POST_StartSyncExecutionRole_8E8879B0.arn}",
        http_method:
          "${aws_api_gateway_method.Api_sfn_POST_D9273C5C.http_method}", // must use string, resolve does not work here
        integration_http_method: "POST",
        passthrough_behavior: "NEVER",
        request_templates: {
          "application/json": expect.stringContaining(
            `"stateMachineArn": "${stack.resolve(stateMachine.stateMachineArn)}"`,
          ),
        },
        uri: stack.resolve(
          `arn:${stack.partition}:apigateway:${stack.region}:states:action/StartSyncExecution`,
        ),
      },
    );
    for (const integrationResponse of getIntegrationResponses({
      "200": "Api_sfn_POST_MethodResponse200_05B96E89",
      "400": "Api_sfn_POST_MethodResponse400_F03F3D11",
      "500": "Api_sfn_POST_MethodResponse500_E2AA35F1",
    })) {
      template.expect.toHaveResourceWithProperties(
        apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse,
        {
          rest_api_id: stack.resolve(api.restApiId),
          resource_id: stack.resolve(sfnResource.resourceId),
          // httpMethod is not a token :/ - stack.resolve(methodPost.httpMethod),
          http_method:
            "${aws_api_gateway_method.Api_sfn_POST_D9273C5C.http_method}",
          ...integrationResponse,
          // ensures integration response depends on the integration
          // see NOTE on https://registry.terraform.io/providers/hashicorp/aws/5.100.0/docs/resources/api_gateway_integration_response
          depends_on: [
            "aws_api_gateway_integration.Api_sfn_POST_Integration_8A32F13C",
          ],
        },
      );
    }
    for (const methodResponse of getMethodResponse()) {
      template.expect.toHaveResourceWithProperties(
        apiGatewayMethodResponse.ApiGatewayMethodResponse,
        methodResponse,
      );
    }
    template.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["states:StartSyncExecution"],
            effect: "Allow",
            resources: [stack.resolve(stateMachine.stateMachineArn)],
          },
        ],
      },
    );
  });

  test("default method responses are not created when useDefaultMethodResponses is false", () => {
    // GIVEN
    const { stack, stateMachine } = givenSetup();

    // WHEN
    new compute.StepFunctionsRestApi(stack, "StepFunctionsRestApi", {
      stateMachine: stateMachine,
      useDefaultMethodResponses: false,
    });

    // THEN
    Template.synth(stack).not.toHaveResource(
      apiGatewayMethodResponse.ApiGatewayMethodResponse,
    );
  });

  test("fails if options.defaultIntegration is set - This test validates CDK construct behavior, not directly translatable to TerraConstructs resource validation in the same way", () => {
    // GIVEN
    const { stack, stateMachine } = givenSetup();

    const httpURL: string = "https://foo/bar";

    // WHEN & THEN
    expect(
      () =>
        new compute.StepFunctionsRestApi(stack, "StepFunctionsRestApi", {
          stateMachine: stateMachine,
          defaultIntegration: new compute.HttpIntegration(httpURL),
        }),
    ).toThrow(
      /Cannot specify \"defaultIntegration\" since Step Functions integration is automatically defined/,
    );
  });

  test("fails if State Machine is not of type EXPRESS - This test validates CDK construct behavior, AWS/Terraform provider handles runtime validation", () => {
    // GIVEN
    const stack = new AwsStack(Testing.app(), "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });

    const passTask = new compute.Pass(stack, "passTask", {
      inputPath: "$.somekey",
    });

    const stateMachine: compute.IStateMachine = new StateMachine(
      stack,
      "StateMachine",
      {
        definitionBody: DefinitionBody.fromChainable(passTask),
        stateMachineType: compute.StateMachineType.STANDARD,
      },
    );

    // WHEN & THEN
    expect(
      () =>
        new compute.StepFunctionsRestApi(stack, "StepFunctionsRestApi", {
          stateMachine: stateMachine,
        }),
    ).toThrow(
      /State Machine must be of type "EXPRESS". Please use StateMachineType.EXPRESS as the stateMachineType/,
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

  const passTask = new compute.Pass(stack, "passTask", {
    inputPath: "$.somekey",
  });

  const stateMachine: compute.IStateMachine = new StateMachine(
    stack,
    "StateMachine",
    {
      definitionBody: DefinitionBody.fromChainable(passTask),
      stateMachineType: compute.StateMachineType.EXPRESS,
    },
  );

  return { stack, stateMachine };
}

function whenCondition(stack: AwsStack, stateMachine: compute.IStateMachine) {
  const api = new compute.StepFunctionsRestApi(stack, "StepFunctionsRestApi", {
    stateMachine: stateMachine,
  });
  return api;
}

function getMethodResponse() {
  return [
    {
      status_code: "200",
      response_models: {
        "application/json": "Empty",
      },
    },
    {
      status_code: "400",
      response_models: {
        "application/json": "Error",
      },
    },
    {
      status_code: "500",
      response_models: {
        "application/json": "Error",
      },
    },
  ];
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
      status_code: `\${aws_api_gateway_method_response.${methodResponseIds["400"]}.status_code}`,
      response_templates: {
        "application/json": `{
            "error": "Bad request!"
          }`,
      },
    },
    {
      selection_pattern: "5\\d{2}", // Escaped for JSON string, then for regex
      status_code: `\${aws_api_gateway_method_response.${methodResponseIds["500"]}.status_code}`,
      response_templates: {
        "application/json": "\"error\": $input.path('$.error')",
      },
    },
  ];

  const integResponse = [
    {
      status_code: `\${aws_api_gateway_method_response.${methodResponseIds["200"]}.status_code}`,
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

// interface RequestTemplateOptions {
//   headers: boolean;
//   querystring: boolean;
//   path: boolean;
//   authorizer: boolean;
//   requestContext?: compute.RequestContext;
// }

// function buildRequestTemplate(
//   stateMachineArn: string,
//   options: RequestTemplateOptions,
// ): string {
//   const { headers, querystring, path, authorizer, requestContext } = options;

//   let requestContextString = "";
//   if (requestContext) {
//     const contextFields: string[] = [];
//     if (requestContext.accountId)
//       contextFields.push(`@@accountId@@: @@$context.identity.accountId@@`);
//     if (requestContext.apiId)
//       contextFields.push(`@@apiId@@: @@$context.apiId@@`);
//     if (requestContext.apiKey)
//       contextFields.push(`@@apiKey@@: @@$context.identity.apiKey@@`);
//     if (requestContext.authorizerPrincipalId)
//       contextFields.push(
//         `@@authorizerPrincipalId@@: @@$context.authorizer.principalId@@`,
//       );
//     if (requestContext.caller)
//       contextFields.push(`@@caller@@: @@$context.identity.caller@@`);
//     if (requestContext.cognitoAuthenticationProvider)
//       contextFields.push(
//         `@@cognitoAuthenticationProvider@@: @@$context.identity.cognitoAuthenticationProvider@@`,
//       );
//     if (requestContext.cognitoAuthenticationType)
//       contextFields.push(
//         `@@cognitoAuthenticationType@@: @@$context.identity.cognitoAuthenticationType@@`,
//       );
//     if (requestContext.cognitoIdentityId)
//       contextFields.push(
//         `@@cognitoIdentityId@@: @@$context.identity.cognitoIdentityId@@`,
//       );
//     if (requestContext.cognitoIdentityPoolId)
//       contextFields.push(
//         `@@cognitoIdentityPoolId@@: @@$context.identity.cognitoIdentityPoolId@@`,
//       );
//     if (requestContext.httpMethod)
//       contextFields.push(`@@httpMethod@@: @@$context.httpMethod@@`);
//     if (requestContext.stage)
//       contextFields.push(`@@stage@@: @@$context.stage@@`);
//     if (requestContext.sourceIp)
//       contextFields.push(`@@sourceIp@@: @@$context.identity.sourceIp@@`);
//     if (requestContext.user)
//       contextFields.push(`@@user@@: @@$context.identity.user@@`);
//     if (requestContext.userAgent)
//       contextFields.push(`@@userAgent@@: @@$context.identity.userAgent@@`);
//     if (requestContext.userArn)
//       contextFields.push(`@@userArn@@: @@$context.identity.userArn@@`);
//     if (requestContext.requestId)
//       contextFields.push(`@@requestId@@: @@$context.requestId@@`);
//     if (requestContext.resourceId)
//       contextFields.push(`@@resourceId@@: @@$context.resourceId@@`);
//     if (requestContext.resourcePath)
//       contextFields.push(`@@resourcePath@@: @@$context.resourcePath@@`);

//     if (contextFields.length > 0) {
//       requestContextString = contextFields.join(", ");
//     }
//   }

//   return `## Velocity Template used for API Gateway request mapping template
// ##
// ## This template forwards the request body, header, path, and querystring
// ## to the execution input of the state machine.
// ##
// ## "@@" is used here as a placeholder for '"' to avoid using escape characters.

// #set($inputString = '')
// #set($includeHeaders = ${headers})
// #set($includeQueryString = ${querystring})
// #set($includePath = ${path})
// #set($includeAuthorizer = ${authorizer})
// #set($allParams = $input.params())
// {
//     "stateMachineArn": "${stateMachineArn}",

//     #set($inputString = "$inputString,@@body@@: $input.body")

//     #if ($includeHeaders)
//         #set($inputString = "$inputString, @@header@@:{")
//         #foreach($paramName in $allParams.header.keySet())
//             #set($inputString = "$inputString @@$paramName@@: @@$util.escapeJavaScript($allParams.header.get($paramName))@@")
//             #if($foreach.hasNext)
//                 #set($inputString = "$inputString,")
//             #end
//         #end
//         #set($inputString = "$inputString }")
//     #end

//     #if ($includeQueryString)
//         #set($inputString = "$inputString, @@querystring@@:{")
//         #foreach($paramName in $allParams.querystring.keySet())
//             #set($inputString = "$inputString @@$paramName@@: @@$util.escapeJavaScript($allParams.querystring.get($paramName))@@")
//             #if($foreach.hasNext)
//                 #set($inputString = "$inputString,")
//             #end
//         #end
//         #set($inputString = "$inputString }")
//     #end

//     #if ($includePath)
//         #set($inputString = "$inputString, @@path@@:{")
//         #foreach($paramName in $allParams.path.keySet())
//             #set($inputString = "$inputString @@$paramName@@: @@$util.escapeJavaScript($allParams.path.get($paramName))@@")
//             #if($foreach.hasNext)
//                 #set($inputString = "$inputString,")
//             #end
//         #end
//         #set($inputString = "$inputString }")
//     #end

//     #if ($includeAuthorizer)
//         #set($inputString = "$inputString, @@authorizer@@:{")
//         #foreach($paramName in $context.authorizer.keySet())
//             #set($inputString = "$inputString @@$paramName@@: @@$util.escapeJavaScript($context.authorizer.get($paramName))@@")
//             #if($foreach.hasNext)
//                 #set($inputString = "$inputString,")
//             #end
//         #end
//         #set($inputString = "$inputString }")
//     #end

//     #set($requestContext = "${requestContextString}")
//     ## Check if the request context should be included as part of the execution input
//     #if($requestContext && !$requestContext.empty)
//         #set($inputString = "$inputString,")
//         #set($inputString = "$inputString @@requestContext@@: {$requestContext}")
//     #end

//     #set($inputString = "$inputString}")
//     #set($inputString = $inputString.replaceAll("@@",'"'))
//     #set($len = $inputString.length() - 1)
//     "input": "{$util.escapeJavaScript($inputString.substring(1,$len)).replaceAll("\\\'","'")}"
// }
// `;
// }

// function getTerraformMethodResponse() {
//   return [
//     {
//       status_code: "200",
//       response_models: {
//         "application/json": "Empty",
//       },
//     },
//     {
//       status_code: "400",
//       response_models: {
//         "application/json": "Error",
//       },
//     },
//     {
//       status_code: "500",
//       response_models: {
//         "application/json": "Error",
//       },
//     },
//   ];
// }

// function getTerraformIntegrationResponse() {
//   const errorResponse = [
//     {
//       selection_pattern: "4\\d{2}", // Escaped for Terraform JSON string
//       status_code: "400",
//       response_templates: {
//         "application/json": `{
//             "error": "Bad request!"
//           }`,
//       },
//     },
//     {
//       selection_pattern: "5\\d{2}", // Escaped for Terraform JSON string
//       status_code: "500",
//       response_templates: {
//         "application/json": "\"error\": $input.path('$.error')",
//       },
//     },
//   ];

//   const integResponse = [
//     {
//       status_code: "200",
//       response_templates: {
//         "application/json": [
//           "#set($inputRoot = $input.path('$'))",
//           "#if($input.path('$.status').toString().equals(\"FAILED\"))",
//           "#set($context.responseOverride.status = 500)",
//           "{",
//           '"error": "$input.path(\'$.error\')",',
//           '"cause": "$input.path(\'$.cause\')"',
//           "}",
//           "#else",
//           "$input.path('$.output')",
//           "#end",
//         ].join("\n"),
//       },
//     },
//     ...errorResponse,
//   ];

//   return integResponse;
// }
