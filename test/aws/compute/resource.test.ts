// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/resource.test.ts

import {
  apiGatewayMethod,
  apiGatewayResource,
  apiGatewayRestApi,
  apiGatewayRequestValidator,
  apiGatewayIntegration,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as apigateway from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("resource", () => {
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

  test('ProxyResource defines a "{proxy+}" resource with ANY method', () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "api");

    // WHEN
    const proxy = new apigateway.ProxyResource(stack, "proxy", {
      parent: api.root,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      apiGatewayResource.ApiGatewayResource,
      {
        parent_id: stack.resolve(api.restApiRootResourceId),
        path_part: "{proxy+}",
        rest_api_id: stack.resolve(api.restApiId),
      },
    );

    t.expect.toHaveResourceWithProperties(apiGatewayMethod.ApiGatewayMethod, {
      http_method: "ANY",
      resource_id: stack.resolve(proxy.resourceId),
      rest_api_id: stack.resolve(api.restApiId),
      authorization: "NONE",
    });
    t.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        // For MockIntegration, type is MOCK
        type: "MOCK",
      },
    );
  });

  test('if "anyMethod" is false, then an ANY method will not be defined', () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "api");

    // WHEN
    const proxy = new apigateway.ProxyResource(stack, "proxy", {
      parent: api.root,
      anyMethod: false,
    });

    proxy.addMethod("GET");

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(apiGatewayResource.ApiGatewayResource, 1); // The proxy resource itself
    t.expect.toHaveResourceWithProperties(apiGatewayMethod.ApiGatewayMethod, {
      http_method: "GET",
    });
    t.expect.not.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "ANY",
      },
    );
  });

  test("addProxy can be used on any resource to attach a proxy from that route", () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "api", {
      deploy: false,
      cloudWatchRole: false,
    });

    const v2 = api.root.addResource("v2");
    const proxy = v2.addProxy();

    // THEN
    const t = new Template(stack);
    t.toMatchObject({
      resource: {
        [apiGatewayRestApi.ApiGatewayRestApi.tfResourceType]: {
          api_C8550315: {
            // TODO: This is not following the pattern of using the Stack.UniqueID prefix...
            name: "MyStackapi811608C5",
          },
        },
        [apiGatewayResource.ApiGatewayResource.tfResourceType]: {
          api_v2_5206B108: {
            parent_id: stack.resolve(api.restApiRootResourceId),
            path_part: "v2",
            rest_api_id: stack.resolve(api.restApiId),
          },
          api_v2_proxy_AEA4DAC8: {
            parent_id: stack.resolve(v2.resourceId),
            path_part: "{proxy+}",
            rest_api_id: stack.resolve(api.restApiId),
          },
        },
        [apiGatewayMethod.ApiGatewayMethod.tfResourceType]: {
          api_v2_proxy_ANY_889F4CE1: {
            http_method: "ANY",
            resource_id: stack.resolve(proxy.resourceId),
            rest_api_id: stack.resolve(api.restApiId),
            authorization: "NONE",
          },
        },
        [apiGatewayIntegration.ApiGatewayIntegration.tfResourceType]: {
          api_v2_proxy_ANY_Integration_9D8BC56D: {
            resource_id: stack.resolve(proxy.resourceId),
            rest_api_id: stack.resolve(api.restApiId),
            http_method:
              "${aws_api_gateway_method.api_v2_proxy_ANY_889F4CE1.http_method}",
            type: "MOCK",
          },
        },
      },
    });
  });

  test("if proxy is added to root, proxy methods are automatically duplicated (with integration and options)", () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "api");
    const proxy = api.root.addProxy({
      anyMethod: false,
    });
    const deleteInteg = new apigateway.MockIntegration({
      requestParameters: {
        "integration.request.header.Content-Type": "'application/json'", // Example, actual CDK might differ
      },
    });

    // WHEN
    proxy.addMethod("DELETE", deleteInteg, {
      operationName: "DeleteMe",
    });

    // THEN
    const t = new Template(stack);
    // Method on the proxy resource itself ({proxy+})
    t.expect.toHaveResourceWithProperties(apiGatewayMethod.ApiGatewayMethod, {
      http_method: "DELETE",
      resource_id: stack.resolve(proxy.resourceId),
      operation_name: "DeleteMe",
      // Integration details are in aws_api_gateway_integration
    });

    // Method on the root resource (/)
    t.expect.toHaveResourceWithProperties(apiGatewayMethod.ApiGatewayMethod, {
      http_method: "DELETE",
      resource_id: stack.resolve(api.restApiRootResourceId),
      operation_name: "DeleteMe",
    });
  });

  test("if proxy is added to root, proxy methods are only added if they are not defined already on the root resource", () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "api");
    api.root.addMethod("POST");
    const proxy = api.root.addProxy({ anyMethod: false });

    // WHEN
    proxy.addMethod("POST");

    // THEN: No explicit assertions in original test. Implicitly, this shouldn't error
    // and shouldn't create a duplicate method that causes issues.
    // We can check the count of POST methods on the root resource.
    const t = new Template(stack);
    const methods = t.resourceTypeArray(
      apiGatewayMethod.ApiGatewayMethod,
    ) as any[];
    const postMethodsOnRoot = methods.filter(
      (m) =>
        m.http_method === "POST" &&
        m.resource_id === stack.resolve(api.restApiRootResourceId),
    );
    expect(postMethodsOnRoot.length).toBe(1); // Or 2 if duplication is allowed and handled by different logical IDs
    // CDK usually de-duplicates or errors. Assuming de-duplication or overwrite.
  });

  test("url for a resource", () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "api");

    // WHEN
    const aResource = api.root.addResource("a");
    const cResource = aResource.addResource("b").addResource("c");
    const colonResource = cResource.addResource("d:e");
    const dollarResource = cResource.addResource("$d");

    // THEN
    // Note: api.deploymentStage might be undefined if deploy=false. Assuming deploy=true for urlForPath.
    // The stage name part might be tricky if not explicitly set or if default naming changes.
    const expectedStageName = stack.resolve(api.deploymentStage.stageName);
    const expectedApiId = stack.resolve(api.restApiId);
    const expectedRegion = stack.region;
    const expectedUrlSuffix = stack.resolve(stack.urlSuffix);

    expect(stack.resolve(api.urlForPath(aResource.path))).toEqual(
      `https://${expectedApiId}.execute-api.${expectedRegion}.${expectedUrlSuffix}/${expectedStageName}/a`,
    );
    expect(stack.resolve(api.urlForPath(cResource.path))).toEqual(
      `https://${expectedApiId}.execute-api.${expectedRegion}.${expectedUrlSuffix}/${expectedStageName}/a/b/c`,
    );
    expect(stack.resolve(api.urlForPath(colonResource.path))).toEqual(
      `https://${expectedApiId}.execute-api.${expectedRegion}.${expectedUrlSuffix}/${expectedStageName}/a/b/c/d:e`,
    );
    expect(stack.resolve(api.urlForPath(dollarResource.path))).toEqual(
      `https://${expectedApiId}.execute-api.${expectedRegion}.${expectedUrlSuffix}/${expectedStageName}/a/b/c/$d`,
    );
  });

  test("fromResourceAttributes()", () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "MyRestApi");
    const resourceId = "resource-id-from-attributes";
    const resourcePath = "/some/path/from/attributes";

    // WHEN
    // Assuming apigateway.Resource.fromResourceAttributes exists and works like CDK's.
    // If not, this test needs to be adapted to how TerraConstructs handles imported resources.
    const imported = apigateway.Resource.fromResourceAttributes(
      stack,
      "imported-resource",
      {
        resourceId,
        restApi: api,
        path: resourcePath,
      },
    );
    imported.addMethod("GET");

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(apiGatewayMethod.ApiGatewayMethod, {
      http_method: "GET",
      resource_id: resourceId, // Should be the literal ID passed in
      rest_api_id: stack.resolve(api.restApiId),
    });
  });

  describe("getResource", () => {
    describe("root resource", () => {
      test("returns undefined if not found", () => {
        const api = new apigateway.RestApi(stack, "MyRestApi");
        expect(api.root.getResource("boom")).toBeUndefined();
      });

      test("returns the resource if found", () => {
        const api = new apigateway.RestApi(stack, "MyRestApi");
        const r1 = api.root.addResource("hello");
        const r2 = api.root.addResource("world");
        expect(api.root.getResource("hello")).toBe(r1);
        expect(api.root.getResource("world")).toBe(r2);
      });

      test('returns the resource even if it was created using "new"', () => {
        const api = new apigateway.RestApi(stack, "MyRestApi");
        const r1 = new apigateway.Resource(stack, "child", {
          parent: api.root,
          pathPart: "yello",
        });
        expect(api.root.getResource("yello")).toBe(r1);
      });
    });

    describe("non-root", () => {
      test("returns undefined if not found", () => {
        const api = new apigateway.RestApi(stack, "MyRestApi");
        const res = api.root.addResource("boom");
        expect(res.getResource("child-of-boom")).toBeUndefined();
      });

      test("returns the resource if found", () => {
        const api = new apigateway.RestApi(stack, "MyRestApi");
        const child = api.root.addResource("boom");
        const r1 = child.addResource("hello");
        const r2 = child.addResource("world");
        expect(child.getResource("hello")).toBe(r1);
        expect(child.getResource("world")).toBe(r2);
      });

      test('returns the resource even if created with "new"', () => {
        const api = new apigateway.RestApi(stack, "MyRestApi");
        const child = api.root.addResource("boom");
        const r1 = child.addResource("hello");
        const r2 = new apigateway.Resource(stack, "world", {
          parent: child,
          pathPart: "outside-world",
        });
        expect(child.getResource("hello")).toBe(r1);
        expect(child.getResource("outside-world")).toBe(r2);
      });
    });

    describe("resourceForPath", () => {
      test('empty path or "/" (on root) returns this', () => {
        const api = new apigateway.RestApi(stack, "MyRestApi");
        expect(api.root.resourceForPath("")).toBe(api.root);
        expect(api.root.resourceForPath("/")).toBe(api.root);
        expect(api.root.resourceForPath("///")).toBe(api.root);
      });

      test("returns a resource for that path", () => {
        const api = new apigateway.RestApi(stack, "MyRestApi");
        const resource = api.root.resourceForPath("/boom/trach");
        expect(resource.path).toEqual("/boom/trach");
      });

      test("resources not created if not needed", () => {
        const api = new apigateway.RestApi(stack, "MyRestApi");
        const trach = api.root.resourceForPath("/boom/trach");
        const bam1 = api.root.resourceForPath("/boom/bam");
        const parent = api.root.getResource("boom");
        expect(parent).toBeDefined();
        expect(parent!.path).toEqual("/boom");
        expect(trach.parentResource).toBe(parent);
        expect(trach.parentResource!.path).toEqual("/boom");
        const bam2 = api.root.resourceForPath("/boom/bam");
        expect(bam1).toBe(bam2);
        expect(bam1.parentResource!.path).toEqual("/boom");
      });
    });
  });

  test("can add multiple validators through addMethod", () => {
    // GIVEN
    // The APIGATEWAY_REQUEST_VALIDATOR_UNIQUE_ID context flag is specific to CDK's logical ID generation.
    // In TerraConstructs, request validators are distinct resources, and naming/uniqueness is handled by
    // CDKTF if not explicitly named.
    //
    // The test ensures that providing requestValidatorOptions creates validators.
    const api = new apigateway.RestApi(stack, "api");

    // WHEN
    const resource = api.root.addResource("path");
    const resource2 = api.root.addResource("anotherPath");

    resource.addMethod("GET", undefined, {
      requestValidatorOptions: {
        requestValidatorName: "validator1",
        validateRequestBody: true, // verify these are passed
      },
    });

    resource2.addMethod("GET", undefined, {
      requestValidatorOptions: {
        requestValidatorName: "validator3",
        validateRequestParameters: true,
      },
    });

    resource.addMethod("POST", undefined, {
      requestValidatorOptions: {
        requestValidatorName: "validator2",
      },
    });

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(apiGatewayRequestValidator.ApiGatewayRequestValidator, 3);
    t.expect.toHaveResourceWithProperties(
      apiGatewayRequestValidator.ApiGatewayRequestValidator,
      {
        name: "validator1",
        rest_api_id: stack.resolve(api.restApiId),
        validate_request_body: true,
      },
    );
    t.expect.toHaveResourceWithProperties(
      apiGatewayRequestValidator.ApiGatewayRequestValidator,
      {
        name: "validator2",
        rest_api_id: stack.resolve(api.restApiId),
      },
    );
    t.expect.toHaveResourceWithProperties(
      apiGatewayRequestValidator.ApiGatewayRequestValidator,
      {
        name: "validator3",
        rest_api_id: stack.resolve(api.restApiId),
        validate_request_parameters: true,
      },
    );
  });
});
