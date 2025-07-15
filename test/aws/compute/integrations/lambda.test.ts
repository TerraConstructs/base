// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/integrations/lambda.test.ts

import {
  apiGatewayMethod,
  apiGatewayIntegration,
  lambdaFunction,
  lambdaPermission,
  apiGatewayRestApi,
  apiGatewayDeployment,
  apiGatewayStage,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const region = "us-east-1";
const providerConfig = { region };
const gridBackendConfig = { address: "http://localhost:3000" };

const partitionRef = "${data.aws_partition.Partitition.partition}";
const accountRef = "${data.aws_caller_identity.CallerIdentity.account_id}";

describe("lambda integration", () => {
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

  test("minimal setup", () => {
    // GIVEN
    const api = new compute.RestApi(stack, "my-api");
    const handler = new compute.LambdaFunction(stack, "Handler", {
      runtime: compute.Runtime.PYTHON_3_9,
      handler: "boom",
      code: compute.Code.fromInline("foo"), // Assuming compute.Code.fromInline exists and works
    });

    // WHEN
    const integ = new compute.LambdaIntegration(handler);
    const method = api.root.addMethod("GET", integ);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "GET",
        resource_id: stack.resolve(api.root.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );

    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        rest_api_id: stack.resolve(api.restApiId),
        resource_id: stack.resolve(api.root.resourceId),
        // http_method: stack.resolve(method.httpMethod),
        http_method:
          "${aws_api_gateway_method.my-api_GET_F990CE3C.http_method}",
        integration_http_method: "POST",
        type: "AWS_PROXY",
        uri: `arn:${partitionRef}:apigateway:${region}:lambda:path/2015-03-31/functions/${stack.resolve(handler.functionArn)}/invocations`,
      },
    );
  });

  test('"allowTestInvoke" can be used to disallow calling the API from the test UI', () => {
    // GIVEN
    const fn = new compute.LambdaFunction(stack, "Handler", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
    });

    const api = new compute.RestApi(stack, "api");

    // WHEN
    const integ = new compute.LambdaIntegration(fn, { allowTestInvoke: false });
    api.root.addMethod("GET", integ);

    // THEN
    const template = new Template(stack);
    const deploymentStageName = stack.resolve(api.deploymentStage.stageName);
    const prodStageArn = `arn:${partitionRef}:execute-api:${region}:${accountRef}:${stack.resolve(api.restApiId)}/${deploymentStageName}/GET/`;

    template.expect.toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        source_arn: prodStageArn,
        // principal: "apigateway.amazonaws.com", // This is implicitly set by the construct
        // action: "lambda:InvokeFunction", // This is implicitly set by the construct
      },
    );

    const permissions = template.resourceTypeArray(
      lambdaPermission.LambdaPermission,
    );
    const testInvokeArn = `arn:${partitionRef}:execute-api:${region}:${accountRef}:${stack.resolve(api.restApiId)}/test-invoke-stage/GET/`;

    expect(permissions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_arn: testInvokeArn,
        }),
      ]),
    );
  });

  test('"allowTestInvoke" set to true allows calling the API from the test UI', () => {
    // GIVEN
    const fn = new compute.LambdaFunction(stack, "Handler", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
    });

    const api = new compute.RestApi(stack, "api");

    // WHEN
    const integ = new compute.LambdaIntegration(fn, { allowTestInvoke: true });
    api.root.addMethod("GET", integ);

    // THEN
    const template = new Template(stack);
    const testInvokeArn = `arn:${partitionRef}:execute-api:${region}:${accountRef}:${stack.resolve(api.restApiId)}/test-invoke-stage/GET/`;
    template.expect.toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        source_arn: testInvokeArn,
      },
    );
  });

  test('"proxy" can be used to disable proxy mode', () => {
    // GIVEN
    const fn = new compute.LambdaFunction(stack, "Handler", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
    });

    const api = new compute.RestApi(stack, "api");

    // WHEN
    const integ = new compute.LambdaIntegration(fn, { proxy: false });
    api.root.addMethod("GET", integ);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "AWS", // Non-proxy
      },
    );
  });

  test('when "ANY" is used, lambda permission will include "*" for method', () => {
    // GIVEN
    const api = new compute.RestApi(stack, "test-api");

    const handler = new compute.LambdaFunction(stack, "MyFunc", {
      runtime: compute.Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: compute.Code.fromInline("loo"),
    });

    const target = new compute.LambdaIntegration(handler);
    api.root.addMethod("ANY", target);

    // THEN
    const template = new Template(stack);
    const testInvokeArn = `arn:${partitionRef}:execute-api:${region}:${accountRef}:${stack.resolve(api.restApiId)}/test-invoke-stage/*/`;
    template.expect.toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        source_arn: testInvokeArn,
      },
    );

    const deploymentStageName = stack.resolve(api.deploymentStage.stageName);
    const prodStageArn = `arn:${partitionRef}:execute-api:${region}:${accountRef}:${stack.resolve(api.restApiId)}/${deploymentStageName}/*/`;
    template.expect.toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        source_arn: prodStageArn,
      },
    );
  });

  test("works for imported RestApi", () => {
    // GIVEN
    const api = compute.RestApi.fromRestApiAttributes(stack, "RestApi", {
      restApiId: "imported-rest-api-id",
      rootResourceId: "imported-root-resource-id",
    });

    const handler = new compute.LambdaFunction(stack, "MyFunc", {
      runtime: compute.Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: compute.Code.fromInline("loo"),
    });

    // WHEN
    api.root.addMethod("ANY", new compute.LambdaIntegration(handler));

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        rest_api_id: "imported-rest-api-id",
        resource_id: "imported-root-resource-id",
        http_method: "ANY",
      },
    );
  });

  test("fingerprint is computed when functionName is specified", () => {
    // GIVEN
    const restapi = new compute.RestApi(stack, "RestApi");
    const method = restapi.root.addMethod("ANY");
    const handler = new compute.LambdaFunction(stack, "MyFunc", {
      functionName: "ThisFunction",
      runtime: compute.Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: compute.Code.fromInline("loo"),
    });
    const integration = new compute.LambdaIntegration(handler);

    // WHEN
    const bindResult = integration.bind(method as compute.Method);

    // THEN
    expect(bindResult?.deploymentToken).toBeDefined();
    expect(bindResult!.deploymentToken).toEqual(
      '{"functionName":"ThisFunction"}',
    );
  });

  // TODO: Adopt "isGeneratedWhenNeededMarker"? For now fingerprint is always computed
  // skipped - functionName is always generated by TerraConstructs
  test.skip("fingerprint is not computed when functionName is not specified", () => {
    // GIVEN
    const restapi = new compute.RestApi(stack, "RestApi");
    const method = restapi.root.addMethod("ANY");
    const handler = new compute.LambdaFunction(stack, "MyFunc", {
      runtime: compute.Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: compute.Code.fromInline("loo"),
    });
    const integration = new compute.LambdaIntegration(handler);

    // WHEN
    const bindResult = integration.bind(method as compute.Method);

    // THEN
    expect(bindResult?.deploymentToken).toBeUndefined();
  });

  test("bind works for integration with imported functions", () => {
    // GIVEN
    const restapi = new compute.RestApi(stack, "RestApi");
    const method = restapi.root.addMethod("ANY");
    const handler = compute.LambdaFunction.fromFunctionArn(
      stack,
      "MyFunc",
      "arn:aws:lambda:us-east-1:123456789012:function:myfunc",
    );
    const integration = new compute.LambdaIntegration(handler);

    // WHEN
    const bindResult = integration.bind(method as compute.Method);

    // THEN
    // The deployment token should be defined since the function name
    // should be a literal string from the ARN.
    expect(bindResult?.deploymentToken).toEqual(
      JSON.stringify({ functionName: "myfunc" }),
    );
  });
});
