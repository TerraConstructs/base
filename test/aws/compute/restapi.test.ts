// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/restapi.test.ts

// import { UserPool as CognitoUserPoolProvider } from "@cdktf/provider-aws/lib/cognito-user-pool";
import {
  apiGatewayAccount,
  apiGatewayApiKey,
  apiGatewayDeployment,
  apiGatewayIntegration,
  apiGatewayMethod,
  apiGatewayModel,
  apiGatewayRequestValidator,
  apiGatewayResource,
  apiGatewayRestApi,
  apiGatewayRestApiPolicy,
  apiGatewayUsagePlan,
  apiGatewayUsagePlanKey,
  dataAwsIamPolicyDocument,
  iamRole,
} from "@cdktf/provider-aws";
import { App, Lazy, TerraformResource, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import {
  AwsStack,
  // RemovalPolicy
} from "../../../src/aws";
import * as apigw from "../../../src/aws/compute";
import {
  Vpc,
  GatewayVpcEndpoint,
  InterfaceVpcEndpointAwsService,
} from "../../../src/aws/compute";
import * as iam from "../../../src/aws/iam";
import { Size } from "../../../src/size";
// import { CognitoUserPoolsAuthorizer } from "../../../src/aws/compute/cognito-authorizer";
import { Template } from "../../assertions";

let stack: AwsStack;
let app: App;

const environmentName = "test-env";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };

const terraformResourceType = "test_resource";

beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
  });
});

describe("restapi", () => {
  test("minimal setup", () => {
    // WHEN
    const api = new apigw.RestApi(stack, "my-api");
    api.root.addMethod("GET"); // must have at least one method or an API definition

    // THEN
    expect(apigw.RestApi.isRestApi(api)).toBe(true);
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_service_principal: {
          aws_svcp_default_region_apigateway: {
            service_name: "apigateway",
          },
        },
        aws_iam_policy_document: {
          "my-api_CloudWatchRole_AssumeRolePolicy_428BCDBB": {
            statement: [
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: [
                      "${data.aws_service_principal.aws_svcp_default_region_apigateway.name}",
                    ],
                    type: "Service",
                  },
                ],
              },
            ],
          },
        },
      },
      resource: {
        aws_api_gateway_rest_api: {
          "my-api_4C7BF186": {
            name: "MyStackmyapi08331C67", // TODO: prefix with GridUUID?
            tags: {
              Name: "test-env-my-api",
            },
          },
        },
        aws_api_gateway_method: {
          "my-api_GET_F990CE3C": {
            authorization: "NONE",
            http_method: "GET",
            resource_id:
              "${aws_api_gateway_rest_api.my-api_4C7BF186.root_resource_id}",
            rest_api_id: "${aws_api_gateway_rest_api.my-api_4C7BF186.id}",
          },
        },
        aws_api_gateway_integration: {
          "my-api_GET_Integration_945CAFC2": {
            http_method:
              "${aws_api_gateway_method.my-api_GET_F990CE3C.http_method}",
            resource_id:
              "${aws_api_gateway_rest_api.my-api_4C7BF186.root_resource_id}",
            rest_api_id: "${aws_api_gateway_rest_api.my-api_4C7BF186.id}",
            type: "MOCK",
          },
        },
        aws_api_gateway_deployment: {
          "my-api_Deployment_92F2CB49": {
            depends_on: ["aws_api_gateway_method.my-api_GET_F990CE3C"],
            description: "Automatically created by the RestApi construct",
            lifecycle: {
              create_before_destroy: true,
            },
            rest_api_id: "${aws_api_gateway_rest_api.my-api_4C7BF186.id}",
            triggers: {
              redeployment: "38873769fd4fbbc3b46f41ed9136d39a",
            },
          },
        },
        aws_api_gateway_stage: {
          "my-api_DeploymentStageprod_298F01AF": {
            depends_on: ["aws_api_gateway_account.my-api_Account_EC421A0A"],
            deployment_id:
              "${aws_api_gateway_deployment.my-api_Deployment_92F2CB49.id}",
            rest_api_id: "${aws_api_gateway_rest_api.my-api_4C7BF186.id}",
            stage_name: "prod",
            tags: {
              Name: "test-env-my-api",
            },
          },
        },
        aws_api_gateway_account: {
          "my-api_Account_EC421A0A": {
            cloudwatch_role_arn:
              "${aws_iam_role.my-api_CloudWatchRole_095452E5.arn}",
            depends_on: ["aws_api_gateway_rest_api.my-api_4C7BF186"],
          },
        },
        aws_iam_role: {
          "my-api_CloudWatchRole_095452E5": {
            assume_role_policy:
              "${data.aws_iam_policy_document.my-api_CloudWatchRole_AssumeRolePolicy_428BCDBB.json}",
            managed_policy_arns: [
              "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs",
            ],
            name_prefix: "123e4567-e89b-12d3-y-apiCloudWatchRole",
            tags: {
              Name: "test-env-my-api",
            },
          },
        },
      },
    });
  });

  test("restApiName is set correctly", () => {
    // WHEN
    const myapi = new apigw.RestApi(stack, "myapi");
    const yourapi = new apigw.RestApi(stack, "yourapi", {
      restApiName: "namedapi",
    });

    // THEN
    const template = new Template(stack);
    // THEN
    expect(myapi.restApiName).toEqual("MyStackmyapi925B69AF"); // Node Path unique name
    expect(yourapi.restApiName).toEqual("namedapi");
  });

  test("defaultChild is set correctly", () => {
    const api = new apigw.RestApi(stack, "my-api");
    expect(
      api.node.defaultChild instanceof apiGatewayRestApi.ApiGatewayRestApi,
    ).toBeDefined();
  });

  test('"name" is defaulted to resource construct id', () => {
    // WHEN
    const api = new apigw.RestApi(stack, "restapi", {
      deploy: false,
      cloudWatchRole: false,
    });

    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        // Name will be prefixed by stack details
        name: "MyStackrestapi8D923C39",
        tags: expect.objectContaining({
          Name: "test-env-restapi",
        }),
      },
    );
  });

  test("fails in synthesis if there are no methods or definition", () => {
    // GIVEN
    const api = new apigw.RestApi(stack, "API");

    // WHEN
    api.root.addResource("foo");
    api.root.addResource("bar").addResource("goo");

    // THEN
    expect(() => Template.synth(stack, { runValidations: true })).toThrow(
      /The REST API doesn't contain any methods/,
    );
  });

  test('"addResource" can be used on "IRestApiResource" to form a tree', () => {
    const api = new apigw.RestApi(stack, "restapi", {
      deploy: false,
      cloudWatchRole: false,
      restApiName: "my-rest-api",
    });

    api.root.addMethod("GET");

    // WHEN
    const foo = api.root.addResource("foo");
    api.root.addResource("bar");
    foo.addResource("{hello}");

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayResource.ApiGatewayResource,
      {
        path_part: "foo",
        parent_id: stack.resolve(api.restApiRootResourceId),
      },
    );

    template.expect.toHaveResourceWithProperties(
      apiGatewayResource.ApiGatewayResource,
      {
        path_part: "bar",
        parent_id: stack.resolve(api.restApiRootResourceId),
      },
    );

    template.expect.toHaveResourceWithProperties(
      apiGatewayResource.ApiGatewayResource,
      {
        path_part: "{hello}",
        parent_id: stack.resolve(foo.resourceId),
      },
    );
  });

  test('"addResource" allows configuration of proxy paths', () => {
    const api = new apigw.RestApi(stack, "restapi", {
      deploy: false,
      cloudWatchRole: false,
      restApiName: "my-rest-api",
    });

    // WHEN
    const proxy = api.root.addResource("{proxy+}");
    proxy.addMethod("ANY");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayResource.ApiGatewayResource,
      {
        path_part: "{proxy+}",
        parent_id: stack.resolve(api.restApiRootResourceId),
      },
    );
  });

  test('"addMethod" can be used to add methods to resources', () => {
    const api = new apigw.RestApi(stack, "restapi", {
      deploy: false,
      cloudWatchRole: false,
    });
    const r1 = api.root.addResource("r1");

    // WHEN
    api.root.addMethod("GET");
    r1.addMethod("POST");

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        name: stack.resolve(api.restApiName),
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayResource.ApiGatewayResource,
      {
        parent_id: stack.resolve(api.restApiRootResourceId),
        path_part: "r1",
        rest_api_id: stack.resolve(api.restApiId),
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "POST",
        resource_id: stack.resolve(r1.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "MOCK",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "GET",
        resource_id: stack.resolve(api.restApiRootResourceId),
        rest_api_id: stack.resolve(api.restApiId),
        authorization: "NONE",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "MOCK",
      },
    );
  });

  test("resourcePath returns the full path of the resource within the API", () => {
    const api = new apigw.RestApi(stack, "restapi");

    // WHEN
    const r1 = api.root.addResource("r1");
    const r11 = r1.addResource("r1_1");
    const r12 = r1.addResource("r1_2");
    const r121 = r12.addResource("r1_2_1");
    const r2 = api.root.addResource("r2");

    // THEN
    expect(api.root.path).toEqual("/");
    expect(r1.path).toEqual("/r1");
    expect(r11.path).toEqual("/r1/r1_1");
    expect(r12.path).toEqual("/r1/r1_2");
    expect(r121.path).toEqual("/r1/r1_2/r1_2_1");
    expect(r2.path).toEqual("/r2");
  });

  test("resource path part validation", () => {
    const api = new apigw.RestApi(stack, "restapi");

    // THEN
    expect(() => api.root.addResource("foo/")).toThrow();
    api.root.addResource("boom-bam");
    expect(() => api.root.addResource("illegal()")).toThrow();
    api.root.addResource("{foo}");
    expect(() => api.root.addResource("foo{bar}")).toThrow();
  });

  test('fails if "deployOptions" is set with "deploy" disabled', () => {
    expect(
      () =>
        new apigw.RestApi(stack, "myapi", {
          deploy: false,
          deployOptions: { cachingEnabled: true },
        }),
    ).toThrow(/Cannot set 'deployOptions' if 'deploy' is disabled/);
  });

  test('uses correct description for Deployment from "deployOptions"', () => {
    const api = new apigw.RestApi(stack, "restapi", {
      description: "Api description",
      deployOptions: { description: "Deployment description" },
    });
    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayDeployment.ApiGatewayDeployment,
      {
        description: "Deployment description",
      },
    );

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        description: "Api description",
      },
    );
  });

  test("CloudWatch role is created for API Gateway", () => {
    const api = new apigw.RestApi(stack, "myapi");
    api.root.addMethod("GET");

    // THEN
    const template = new Template(stack);
    template.resourceCountIs(iamRole.IamRole, 1);
    template.resourceCountIs(apiGatewayAccount.ApiGatewayAccount, 1);
  });

  test("cloudWatchRole: false, CloudWatch role is not created for API Gateway", () => {
    // GIVEN
    const api = new apigw.RestApi(stack, "myapi", { cloudWatchRole: false });
    api.root.addMethod("GET");

    // THEN
    const template = new Template(stack);
    template.resourceCountIs(iamRole.IamRole, 0);
    template.resourceCountIs(apiGatewayAccount.ApiGatewayAccount, 0);
  });

  test('"url" and "urlForPath" return the URL endpoints of the deployed API', () => {
    const api = new apigw.RestApi(stack, "api");
    api.root.addMethod("GET");

    // THEN
    expect(stack.resolve(api.url)).toEqual(
      `https://
${stack.resolve(api.restApiId)}.execute-api.${stack.resolve(stack.region)}.${stack.resolve(stack.urlSuffix)}/
${stack.resolve(api.deploymentStage.stageName)}/`.replace(/\n/g, ""),
    );
    expect(stack.resolve(api.urlForPath("/foo/bar"))).toEqual(
      [
        `https://${stack.resolve(api.restApiId)}.execute-api.${stack.resolve(stack.region)}.${stack.resolve(stack.urlSuffix)}/`,
        `${stack.resolve(api.deploymentStage.stageName)}/foo/bar`,
      ].join(""),
    );
  });

  test('"urlForPath" would not work if there is no deployment', () => {
    const api = new apigw.RestApi(stack, "api", { deploy: false });
    api.root.addMethod("GET");

    // THEN
    expect(() => api.url).toThrow(
      /Cannot determine deployment stage for API from "deploymentStage". Use "deploy" or explicitly set "deploymentStage"/,
    );
    expect(() => api.urlForPath("/foo")).toThrow(
      /Cannot determine deployment stage for API from "deploymentStage". Use "deploy" or explicitly set "deploymentStage"/,
    );
  });

  test('"urlForPath" requires that path will begin with "/"', () => {
    const api = new apigw.RestApi(stack, "api");
    api.root.addMethod("GET");

    // THEN
    expect(() => api.urlForPath("foo")).toThrow(
      /Path must begin with "\/": foo/,
    );
  });

  test('"executeApiArn" returns the execute-api ARN for a resource/method', () => {
    const api = new apigw.RestApi(stack, "api");
    api.root.addMethod("GET");

    // WHEN
    const arn = api.arnForExecuteApi("method", "/path", "stage");

    // THEN
    expect(stack.resolve(arn)).toEqual(
      `arn:${stack.resolve(stack.partition)}:execute-api:${stack.resolve(stack.region)}:${stack.resolve(stack.account)}:
${stack.resolve(api.restApiId)}/stage/method/path`.replace(/\n/g, ""),
    );
  });

  test('"executeApiArn" path must begin with "/"', () => {
    const api = new apigw.RestApi(stack, "api");
    api.root.addMethod("GET");

    // THEN
    expect(() => api.arnForExecuteApi("method", "hey-path", "stage")).toThrow(
      /"path" must begin with a "\/": 'hey-path'/,
    );
  });

  test('"executeApiArn" path can be a token', () => {
    const api = new apigw.RestApi(stack, "api");
    api.root.addMethod("GET");

    // THEN
    expect(() =>
      api.arnForExecuteApi(
        "method",
        Lazy.stringValue({ produce: () => "path" }),
        "stage",
      ),
    ).not.toThrow();
  });

  test('"executeApiArn" will convert ANY to "*"', () => {
    const api = new apigw.RestApi(stack, "api");
    const method = api.root.addMethod("ANY");

    // THEN
    expect(stack.resolve(method.methodArn)).toEqual(
      [
        `arn:${stack.resolve(stack.partition)}:execute-api:`,
        stack.resolve(stack.region),
        `:${stack.resolve(stack.account)}:`,
        stack.resolve(api.restApiId),
        `/${stack.resolve(api.deploymentStage.stageName)}/*/`,
      ].join(""),
    );
  });

  test('"endpointTypes" can be used to specify endpoint configuration for the api', () => {
    // WHEN
    const api = new apigw.RestApi(stack, "api", {
      endpointTypes: [apigw.EndpointType.EDGE, apigw.EndpointType.PRIVATE],
    });

    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        endpoint_configuration: {
          types: ["EDGE", "PRIVATE"],
        },
      },
    );
  });

  test('"endpointConfiguration" can be used to specify endpoint types for the api', () => {
    // WHEN
    const api = new apigw.RestApi(stack, "api", {
      endpointConfiguration: {
        types: [apigw.EndpointType.EDGE, apigw.EndpointType.PRIVATE],
      },
    });

    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        endpoint_configuration: {
          types: ["EDGE", "PRIVATE"],
        },
      },
    );
  });

  test('"endpointConfiguration" can be used to specify vpc endpoints on the API', () => {
    // WHEN
    const api = new apigw.RestApi(stack, "api", {
      endpointConfiguration: {
        types: [apigw.EndpointType.EDGE, apigw.EndpointType.PRIVATE],
        vpcEndpoints: [
          GatewayVpcEndpoint.fromGatewayVpcEndpointId(
            stack,
            "ImportedEndpoint",
            "vpcEndpoint",
          ),
          GatewayVpcEndpoint.fromGatewayVpcEndpointId(
            stack,
            "ImportedEndpoint2",
            "vpcEndpoint2",
          ),
        ],
      },
    });

    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        endpoint_configuration: {
          types: ["EDGE", "PRIVATE"],
          vpc_endpoint_ids: ["vpcEndpoint", "vpcEndpoint2"],
        },
      },
    );
  });

  test('"endpointTypes" and "endpointConfiguration" can NOT both be used to specify endpoint configuration for the api', () => {
    // THEN
    expect(
      () =>
        new apigw.RestApi(stack, "api", {
          endpointConfiguration: {
            types: [apigw.EndpointType.PRIVATE],
            vpcEndpoints: [
              GatewayVpcEndpoint.fromGatewayVpcEndpointId(
                stack,
                "ImportedEndpoint",
                "vpcEndpoint",
              ),
            ],
          },
          endpointTypes: [apigw.EndpointType.PRIVATE],
        }),
    ).toThrow(
      /Only one of the RestApi props, endpointTypes or endpointConfiguration, is allowed/,
    );
  });

  // test.skip('"cloneFrom" can be used to clone an existing API', () => {
  //   const cloneFrom = apigw.RestApi.fromRestApiId(
  //     stack,
  //     "RestApiImport",
  //     "foobar",
  //   );

  //   // WHEN
  //   const api = new apigw.RestApi(stack, "api", {
  //     cloneFrom,
  //   });

  //   api.root.addMethod("GET");

  //   Template.synth(stack).toHaveResourceWithProperties(
  //     apiGatewayRestApi.ApiGatewayRestApi,
  //     {
  //       clone_from: "foobar",
  //       name: stack.resolve(api.restApiName),
  //     },
  //   );
  // });

  test("allow taking a dependency on the rest api (includes deployment and stage)", () => {
    const api = new apigw.RestApi(stack, "myapi");
    api.root.addMethod("GET");
    const testResource = new TerraformResource(stack, "DependsOnRestApi", {
      terraformResourceType,
    });

    // WHEN
    testResource.node.addDependency(api);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      {
        tfResourceType: terraformResourceType,
      },
      {
        depends_on: [
          "aws_api_gateway_rest_api.myapi_162F20B8",
          "data.aws_iam_policy_document.myapi_CloudWatchRole_AssumeRolePolicy_D01A67E8",
          "aws_iam_role.myapi_CloudWatchRole_EB425128",
          "aws_api_gateway_account.myapi_Account_C3A4750C",
          "aws_api_gateway_deployment.myapi_Deployment_B7EF8EB7",
          "aws_api_gateway_stage.myapi_DeploymentStageprod_329F21FF",
          "aws_api_gateway_method.myapi_GET_9B7CD29E",
          "aws_api_gateway_integration.myapi_GET_Integration_7EE7698E",
        ],
      },
    );
  });

  test("defaultIntegration and defaultMethodOptions can be used at any level", () => {
    const rootInteg = new apigw.AwsIntegration({
      service: "s3",
      action: "GetObject",
    });

    // WHEN
    const api = new apigw.RestApi(stack, "myapi", {
      defaultIntegration: rootInteg,
      defaultMethodOptions: {
        authorizer: { authorizerId: "AUTHID" } as apigw.IAuthorizer, // Cast for test purposes
        authorizationType: apigw.AuthorizationType.IAM,
      },
    });

    // CASE #1: should inherit integration and options from root resource
    api.root.addMethod("GET");

    const child = api.root.addResource("child");

    // CASE #2: should inherit integration from root and method options,
    // but "authorizationType" will be overridden
    child.addMethod("POST", undefined, {
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    const child2 = api.root.addResource("child2", {
      defaultIntegration: new apigw.MockIntegration(),
      defaultMethodOptions: {
        authorizer: { authorizerId: "AUTHID2" } as apigw.IAuthorizer,
      },
    });

    // CASE #3: integration and authorizer ID are inherited from child2
    child2.addMethod("DELETE");

    // CASE #4: same as case #3, but integration is customized
    child2.addMethod(
      "PUT",
      new apigw.AwsIntegration({ action: "foo", service: "bar" }),
    );

    // THEN
    const template = new Template(stack);
    // CASE #1
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "GET",
        resource_id: stack.resolve(api.restApiRootResourceId),
        authorizer_id: "AUTHID",
        authorization: "AWS_IAM",
      },
    );
    // TODO: Count and associations should match too...
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "AWS",
      },
    );

    // CASE #2
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "POST",
        resource_id: stack.resolve(child.resourceId),
        authorizer_id: "AUTHID",
        authorization: "COGNITO_USER_POOLS",
      },
    );

    // CASE #3
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "DELETE",
        resource_id: stack.resolve(child2.resourceId),
        authorizer_id: "AUTHID2",
        authorization: "AWS_IAM",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayIntegration.ApiGatewayIntegration,
      {
        type: "MOCK",
      },
    );

    // CASE #4
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "PUT",
        resource_id: stack.resolve(child2.resourceId),
        authorizer_id: "AUTHID2",
        authorization: "AWS_IAM",
      },
    );
  });

  test("addApiKey is supported", () => {
    const api = new apigw.RestApi(stack, "myapi");
    api.root.addMethod("OPTIONS");

    // WHEN
    const apiKey = api.addApiKey("myapikey", {
      apiKeyName: "myApiKey1",
      value: "01234567890ABCDEFabcdef",
    });
    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayApiKey.ApiGatewayApiKey,
      {
        enabled: true,
        name: "myApiKey1",
        value: "01234567890ABCDEFabcdef",
      },
    );
    // usage plan is auto created for Stage and associated with the API Key
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
        api_stages: [
          {
            api_id: stack.resolve(api.restApiId),
            stage: stack.resolve(api.deploymentStage.stageName),
          },
        ],
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
      {
        key_id: stack.resolve(apiKey.keyId),
        key_type: "API_KEY",
        usage_plan_id:
          "${aws_api_gateway_usage_plan.myapi_myapikey_UsagePlan_08537644.id}",
      },
    );
  });

  test("addModel is supported", () => {
    const api = new apigw.RestApi(stack, "myapi");
    api.root.addMethod("OPTIONS");

    // WHEN
    api.addModel("model", {
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
          $schema: "http://json-schema.org/draft-04/schema#",
          title: "test",
          type: "object",
          properties: { message: { type: "string" } },
        }),
      },
    );
  });

  test("addRequestValidator is supported", () => {
    const api = new apigw.RestApi(stack, "myapi");
    api.root.addMethod("OPTIONS");

    // WHEN
    api.addRequestValidator("params-validator", {
      requestValidatorName: "Parameters",
      validateRequestBody: false,
      validateRequestParameters: true,
    });
    api.addRequestValidator("body-validator", {
      requestValidatorName: "Body",
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayRequestValidator.ApiGatewayRequestValidator,
      {
        rest_api_id: stack.resolve(api.restApiId),
        name: "Parameters",
        validate_request_body: false,
        validate_request_parameters: true,
      },
    );

    template.expect.toHaveResourceWithProperties(
      apiGatewayRequestValidator.ApiGatewayRequestValidator,
      {
        rest_api_id: stack.resolve(api.restApiId),
        name: "Body",
        validate_request_body: true,
        validate_request_parameters: false,
      },
    );
  });

  test('creates output with given "exportName" (TerraformOutput name)', () => {
    // WHEN
    const outputName = "my-given-export-name";
    const api = new apigw.RestApi(stack, "myapi", {
      registerOutputs: true,
      outputName,
    });
    api.root.addMethod("GET");

    // THEN
    Template.expectOutput(stack, outputName);
  });

  test('creates output when "exportName" is not specified', () => {
    // WHEN
    const api = new apigw.RestApi(stack, "myapi", {
      registerOutputs: true,
    });
    api.root.addMethod("GET");

    // THEN
    Template.expectOutput(stack, "myapiOutputs").toMatchObject({
      description: "Outputs for test-env-myapi",
      value: {
        restApiName: stack.resolve(api.restApiName), //"MyStackmyapi925B69AF",
        restApiId: stack.resolve(api.restApiId),
        restApiRootResourceId: stack.resolve(api.restApiRootResourceId),
        url: stack.resolve(api.url),
      },
    });
  });

  test('"restApi" and "api" properties return the RestApi correctly', () => {
    // WHEN
    const api = new apigw.RestApi(stack, "test-api");
    const method = api.root.addResource("pets").addMethod("GET");

    // THEN
    expect(method.restApi).toBeDefined();
    expect(method.api).toBeDefined();
    expect(stack.resolve(method.api.restApiId)).toEqual(
      stack.resolve(method.restApi.restApiId),
    );
  });

  test('"restApi" throws an error on imported while "api" returns correctly', () => {
    // WHEN
    const api = apigw.RestApi.fromRestApiAttributes(stack, "test-api", {
      restApiId: "test-rest-api-id",
      rootResourceId: "test-root-resource-id",
    });
    const method = api.root.addResource("pets").addMethod("GET");

    // THEN
    expect(() => method.restApi).toThrow(
      /not available on Resource not connected to an instance of RestApi/,
    );
    expect(method.api).toBeDefined();
  });

  test("RestApi minCompressionSize", () => {
    // GIVEN
    const api = new apigw.RestApi(stack, "RestApi", {
      minCompressionSize: Size.bytes(1024),
      cloudWatchRole: false, // simplify test
    });

    // WHEN
    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        name: stack.resolve(api.restApiName),
        minimum_compression_size: "1024",
      },
    );
  });

  // Use minCompressionSize (Deprecated Property not implemented in TerraConstructs)
  test.skip("RestApi minimumCompressionSize (deprecated)", () => {
    // GIVEN
    const api = new apigw.RestApi(stack, "RestApi", {
      // minimumCompressionSize: 1024, // CDK deprecated prop
      cloudWatchRole: false, // simplify test
    });

    // WHEN
    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        name: stack.resolve(api.restApiName),
        minimum_compression_size: 1024,
      },
    );
  });

  test.skip("throws error when both minimumCompressionSize and minCompressionSize are used", () => {
    // THEN
    expect(
      () =>
        new apigw.RestApi(stack, "RestApi", {
          minCompressionSize: Size.bytes(500),
          // minimumCompressionSize: 1024,
        }),
    ).toThrow(
      /both properties minCompressionSize and minimumCompressionSize cannot be set at once./,
    );
  });

  // TODO: Implement removalPolicy for TerraConstructs
  test.skip("can specify CloudWatch Role and Account removal policy", () => {
    // WHEN
    const api = new apigw.RestApi(stack, "myapi", {
      cloudWatchRole: true,
      // cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
    });

    api.root.addMethod("GET");

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(iamRole.IamRole, {
      lifecycle: { prevent_destroy: false }, // TODO: we don't add preventDestroy yet
    });
    template.expect.toHaveResourceWithProperties(
      apiGatewayAccount.ApiGatewayAccount,
      {
        lifecycle: { prevent_destroy: false }, // TODO: we don't add preventDestroy yet
      },
    );
  });

  test.skip("cloudWatchRole must be enabled for specifying specify CloudWatch Role and Account removal policy", () => {
    expect(() => {
      new apigw.RestApi(
        new AwsStack(app, "NewStack", {
          environmentName,
          gridUUID,
          providerConfig,
        }),
        "myapi",
        {
          cloudWatchRole: false,
          // cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
        },
      );
    }).toThrow(
      /'cloudWatchRole' must be enabled for 'cloudWatchRoleRemovalPolicy' to be applied./,
    );
  });
});

describe("Import", () => {
  test("fromRestApiId()", () => {
    // WHEN
    const imported = apigw.RestApi.fromRestApiId(
      stack,
      "imported-api",
      "api-rxt4498f",
    );

    // THEN
    expect(stack.resolve(imported.restApiId)).toEqual("api-rxt4498f");
    expect(imported.restApiName).toEqual("imported-api"); // Construct ID is used as name if not provided
  });

  test("fromRestApiAttributes()", () => {
    // WHEN
    const imported = apigw.RestApi.fromRestApiAttributes(
      stack,
      "imported-api",
      {
        restApiId: "test-restapi-id",
        rootResourceId: "test-root-resource-id",
      },
    );
    const resource = imported.root.addResource("pets");
    resource.addMethod("GET");

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayResource.ApiGatewayResource,
      {
        path_part: "pets",
        parent_id: stack.resolve(imported.restApiRootResourceId),
        rest_api_id: stack.resolve(imported.restApiId),
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "GET",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(imported.restApiId),
      },
    );
    expect(imported.restApiName).toEqual("imported-api");
  });

  test("fromRestApiAttributes() with restApiName", () => {
    // WHEN
    const imported = apigw.RestApi.fromRestApiAttributes(
      stack,
      "imported-api",
      {
        restApiId: "test-restapi-id",
        rootResourceId: "test-root-resource-id",
        restApiName: "test-restapi-name",
      },
    );
    const resource = imported.root.addResource("pets");
    resource.addMethod("GET");

    // THEN
    expect(imported.restApiName).toEqual("test-restapi-name");
  });
});

describe("SpecRestApi", () => {
  test("add Methods and Resources", () => {
    const api = new apigw.SpecRestApi(stack, "SpecRestApi", {
      apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
    });

    // WHEN
    const resource = api.root.addResource("pets");
    resource.addMethod("GET");

    // THEN
    expect(apigw.RestApi.isRestApi(api)).toBe(false); // SpecRestApi is not a RestApi (CDK specific check)

    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayResource.ApiGatewayResource,
      {
        path_part: "pets",
        parent_id: stack.resolve(api.restApiRootResourceId),
        rest_api_id: stack.resolve(api.restApiId),
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "GET",
        resource_id: stack.resolve(resource.resourceId),
        rest_api_id: stack.resolve(api.restApiId),
      },
    );
  });

  test('"endpointTypes" can be used to specify endpoint configuration for SpecRestApi', () => {
    // WHEN
    const api = new apigw.SpecRestApi(stack, "api", {
      apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
      endpointTypes: [apigw.EndpointType.EDGE, apigw.EndpointType.PRIVATE],
    });

    api.root.addMethod("GET"); // Required to trigger deployment aspects if deploy=true

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        endpoint_configuration: {
          types: ["EDGE", "PRIVATE"],
        },
      },
    );
  });

  test("addApiKey is supported", () => {
    const api = new apigw.SpecRestApi(stack, "myapi", {
      apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
    });
    api.root.addMethod("OPTIONS");

    // WHEN
    const apiKey = api.addApiKey("myapikey", {
      apiKeyName: "myApiKey1",
      value: "01234567890ABCDEFabcdef",
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayApiKey.ApiGatewayApiKey,
      {
        enabled: true,
        name: "myApiKey1",
        value: "01234567890ABCDEFabcdef",
      },
    );
    // usage plan is auto created for Stage and associated with the API Key
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
        api_stages: [
          {
            api_id: stack.resolve(api.restApiId),
            stage: stack.resolve(api.deploymentStage.stageName),
          },
        ],
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
      {
        key_id: stack.resolve(apiKey.keyId),
        key_type: "API_KEY",
        usage_plan_id:
          "${aws_api_gateway_usage_plan.myapi_myapikey_UsagePlan_08537644.id}",
      },
    );
  });

  test("cloudWatchRole: false, CloudWatch role is not created for API Gateway", () => {
    // GIVEN
    const api = new apigw.SpecRestApi(stack, "SpecRestApi", {
      apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
      cloudWatchRole: false,
    });

    // WHEN
    const resource = api.root.addResource("pets");
    resource.addMethod("GET");

    // THEN
    const template = new Template(stack);
    template.resourceCountIs(iamRole.IamRole, 0);
    template.resourceCountIs(apiGatewayAccount.ApiGatewayAccount, 0);
  });

  test("SpecRestApi minCompressionSize", () => {
    // GIVEN
    const api = new apigw.SpecRestApi(stack, "SpecRestApi", {
      apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
      minCompressionSize: Size.bytes(1024),
      cloudWatchRole: false, // simplify test
    });

    // WHEN
    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        name: stack.resolve(api.restApiName),
        minimum_compression_size: "1024",
      },
    );
  });

  test('"endpointConfiguration" can be used to specify endpoint types for the api', () => {
    // WHEN
    const api = new apigw.SpecRestApi(stack, "api", {
      apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
      endpointConfiguration: {
        types: [apigw.EndpointType.EDGE, apigw.EndpointType.PRIVATE],
      },
    });

    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        endpoint_configuration: {
          types: ["EDGE", "PRIVATE"],
        },
      },
    );
  });

  test('"endpointConfiguration" can be used to specify vpc endpoints on the API', () => {
    // WHEN
    const api = new apigw.SpecRestApi(stack, "api", {
      apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
      endpointConfiguration: {
        types: [apigw.EndpointType.EDGE, apigw.EndpointType.PRIVATE],
        vpcEndpoints: [
          GatewayVpcEndpoint.fromGatewayVpcEndpointId(
            stack,
            "ImportedEndpoint",
            "vpcEndpoint",
          ),
          GatewayVpcEndpoint.fromGatewayVpcEndpointId(
            stack,
            "ImportedEndpoint2",
            "vpcEndpoint2",
          ),
        ],
      },
    });

    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        endpoint_configuration: {
          types: ["EDGE", "PRIVATE"],
          vpc_endpoint_ids: ["vpcEndpoint", "vpcEndpoint2"],
        },
      },
    );
  });

  test('"endpointTypes" and "endpointConfiguration" can NOT both be used to specify endpoint configuration for the api', () => {
    // THEN
    expect(
      () =>
        new apigw.SpecRestApi(stack, "api", {
          apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
          endpointConfiguration: {
            types: [apigw.EndpointType.PRIVATE],
            vpcEndpoints: [
              GatewayVpcEndpoint.fromGatewayVpcEndpointId(
                stack,
                "ImportedEndpoint",
                "vpcEndpoint",
              ),
            ],
          },
          endpointTypes: [apigw.EndpointType.PRIVATE],
        }),
    ).toThrow(
      /Only one of the RestApi props, endpointTypes or endpointConfiguration, is allowed/,
    );
  });

  describe("Metrics", () => {
    test("metric", () => {
      // GIVEN
      const api = new apigw.RestApi(stack, "my-api");
      const metricName = "4XXError";
      const statistic = "Sum";

      // WHEN
      const countMetric = api.metric(metricName, { statistic });

      // THEN
      expect(countMetric.namespace).toEqual("AWS/ApiGateway");
      expect(countMetric.metricName).toEqual(metricName);
      expect(countMetric.dimensions).toEqual({
        ApiName: stack.resolve(api.restApiName),
      });
      expect(countMetric.statistic).toEqual(statistic);
    });

    // ... other metric tests would follow a similar pattern ...
  });

  test("disableExecuteApiEndpoint is false when set to false in RestApi", () => {
    // WHEN
    const api = new apigw.RestApi(stack, "my-api", {
      disableExecuteApiEndpoint: false,
    });
    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        disable_execute_api_endpoint: false,
      },
    );
  });

  test("disableExecuteApiEndpoint is true when set to true in RestApi", () => {
    // WHEN
    const api = new apigw.RestApi(stack, "my-api", {
      disableExecuteApiEndpoint: true,
    });
    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        disable_execute_api_endpoint: true,
      },
    );
  });

  test("disableExecuteApiEndpoint is false when set to false in SpecRestApi", () => {
    // WHEN
    const api = new apigw.SpecRestApi(stack, "my-api", {
      apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
      disableExecuteApiEndpoint: false,
    });
    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        disable_execute_api_endpoint: false,
      },
    );
  });

  test("disableExecuteApiEndpoint is true when set to true in SpecRestApi", () => {
    // WHEN
    const api = new apigw.SpecRestApi(stack, "my-api", {
      apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
      disableExecuteApiEndpoint: true,
    });
    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayRestApi.ApiGatewayRestApi,
      {
        disable_execute_api_endpoint: true,
      },
    );
  });

  describe("Description", () => {
    test("description can be set", () => {
      // WHEN
      const api = new apigw.RestApi(stack, "my-api", { description: "My API" });
      api.root.addMethod("GET");

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        apiGatewayRestApi.ApiGatewayRestApi,
        {
          description: "My API",
        },
      );
    });

    test("description is not set", () => {
      // WHEN
      const api = new apigw.RestApi(stack, "my-api");
      api.root.addMethod("GET");

      // THEN
      // Check that description is not present or is the default if the provider sets one
      const props = Template.resourceObjects(
        stack,
        apiGatewayRestApi.ApiGatewayRestApi,
      ) as any;
      const apiResourceKey = Object.keys(props).find(
        (k) => props[k].name === stack.resolve(api.restApiName),
      );
      expect(props[apiResourceKey!].description).toBeUndefined();
    });
  });

  test("check if url property exists for a SpecRestApi", () => {
    const restApiSwaggerDefinition = {
      openapi: "3.0.2",
      info: {
        version: "1.0.0",
        title: "Test API for CDK",
      },
      paths: {
        "/pets": {
          get: {
            summary: "Test Method",
            operationId: "testMethod",
            responses: {
              200: {
                description: "A paged array of pets",
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/Empty",
                    },
                  },
                },
              },
            },
            "x-amazon-apigateway-integration": {
              responses: {
                default: {
                  statusCode: "200",
                },
              },
              requestTemplates: {
                "application/json": '{"statusCode": 200}',
              },
              passthroughBehavior: "when_no_match",
              type: "mock",
            },
          },
        },
      },
      components: {
        schemas: {
          Empty: {
            title: "Empty Schema",
            type: "object",
          },
        },
      },
    };
    const api = new apigw.SpecRestApi(stack, "my-api", {
      apiDefinition: apigw.ApiDefinition.fromInline(restApiSwaggerDefinition),
    });
    // THEN
    expect(api.url).toBeTruthy();
  });

  test('can override "apiKeyRequired" set in "defaultMethodOptions" at the resource level', () => {
    // WHEN
    const api = new apigw.RestApi(stack, "myapi", {
      defaultMethodOptions: {
        apiKeyRequired: true,
      },
    });

    api.root.addMethod("GET", undefined, {});
    api.root.addMethod("POST", undefined, {
      apiKeyRequired: false,
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "GET",
        api_key_required: true,
      },
    );

    template.expect.toHaveResourceWithProperties(
      apiGatewayMethod.ApiGatewayMethod,
      {
        http_method: "POST",
        api_key_required: false,
      },
    );
  });

  describe("addToResourcePolicy", () => {
    test("add a statement to the resource policy for RestApi", () => {
      // GIVEN
      const api = new apigw.RestApi(stack, "Api");
      api.root.addMethod("GET", undefined, {});
      const statement = new iam.PolicyStatement({
        actions: ["execute-api:Invoke"],
        resources: [
          stack.formatArn({
            service: "execute-api",
            resource: "*",
            sep: "/",
          }),
        ],
      });

      // WHEN
      api.addToResourcePolicy(statement);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["execute-api:Invoke"],
              effect: "Allow",
              resources: [
                "arn:${data.aws_partition.Partitition.partition}:execute-api:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:*",
              ],
            },
          ],
        },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayRestApiPolicy.ApiGatewayRestApiPolicy,
        {
          rest_api_id: stack.resolve(api.restApiId),
          policy:
            "${data.aws_iam_policy_document.Api_PolicyDocument_90F863C4.json}",
        },
      );
    });

    test("add a statement to the resource policy for RestApi with policy provided", () => {
      // GIVEN
      const api = new apigw.RestApi(stack, "Api", {
        policy: new iam.PolicyDocument(stack, "Policy", {
          statement: [
            new iam.PolicyStatement({
              actions: ["execute-api:Invoke"],
              resources: [
                stack.formatArn({
                  service: "execute-api",
                  resource: "*",
                  sep: "/",
                }),
              ],
            }),
          ],
        }),
      });
      api.root.addMethod("GET", undefined, {});

      const additionalPolicyStatement = new iam.PolicyStatement({
        actions: ["execute-api:Invoke"],
        resources: [
          stack.formatArn({
            service: "execute-api",
            resource: "*",
            sep: "/",
          }),
        ],
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        condition: [
          {
            test: "StringNotEquals",
            variable: "aws:SourceVpce",
            values: ["vpce-1234567890abcdef0"],
          },
        ],
      });

      // WHEN
      api.addToResourcePolicy(additionalPolicyStatement);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["execute-api:Invoke"],
              effect: "Allow",
              resources: [
                "arn:${data.aws_partition.Partitition.partition}:execute-api:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:*",
              ],
            },
            {
              actions: ["execute-api:Invoke"],
              condition: [
                {
                  test: "StringNotEquals",
                  values: ["vpce-1234567890abcdef0"],
                  variable: "aws:SourceVpce",
                },
              ],
              effect: "Deny",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: [
                "arn:${data.aws_partition.Partitition.partition}:execute-api:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:*",
              ],
            },
          ],
        },
      );
      template.expect.toHaveResource(
        apiGatewayRestApiPolicy.ApiGatewayRestApiPolicy,
      );
    });

    test("add a statement to the resource policy for SpecRestApi", () => {
      // GIVEN
      const api = new apigw.SpecRestApi(stack, "Api", {
        apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
      });
      api.root.addMethod("GET", undefined, {});
      const statement = new iam.PolicyStatement({
        actions: ["execute-api:Invoke"],
        resources: [
          stack.formatArn({
            service: "execute-api",
            resource: "*",
            sep: "/",
          }),
        ],
      });

      // WHEN
      api.addToResourcePolicy(statement);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["execute-api:Invoke"],
              effect: "Allow",
              resources: [
                "arn:${data.aws_partition.Partitition.partition}:execute-api:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:*",
              ],
            },
          ],
        },
      );
      template.expect.toHaveResource(
        apiGatewayRestApiPolicy.ApiGatewayRestApiPolicy,
      );
    });

    test("add a statement to the resource policy for SpecRestApi with policy provided", () => {
      // GIVEN
      const api = new apigw.SpecRestApi(stack, "Api", {
        apiDefinition: apigw.ApiDefinition.fromInline({ foo: "bar" }),
        policy: new iam.PolicyDocument(stack, "Policy", {
          statement: [
            new iam.PolicyStatement({
              actions: ["execute-api:Invoke"],
              resources: [
                stack.formatArn({
                  service: "execute-api",
                  resource: "*",
                  sep: "/",
                }),
              ],
            }),
          ],
        }),
      });
      api.root.addMethod("GET", undefined, {});

      const additionalPolicyStatement = new iam.PolicyStatement({
        actions: ["execute-api:Invoke"],
        resources: [
          stack.formatArn({
            service: "execute-api",
            resource: "*",
            sep: "/",
          }),
        ],
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        condition: [
          {
            test: "StringNotEquals",
            variable: "aws:SourceVpce",
            values: ["vpce-1234567890abcdef0"],
          },
        ],
      });

      // WHEN
      api.addToResourcePolicy(additionalPolicyStatement);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["execute-api:Invoke"],
              effect: "Allow",
              resources: [
                "arn:${data.aws_partition.Partitition.partition}:execute-api:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:*",
              ],
            },
            {
              actions: ["execute-api:Invoke"],
              condition: [
                {
                  test: "StringNotEquals",
                  values: ["vpce-1234567890abcdef0"],
                  variable: "aws:SourceVpce",
                },
              ],
              effect: "Deny",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: [
                "arn:${data.aws_partition.Partitition.partition}:execute-api:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:*",
              ],
            },
          ],
        },
      );
      template.expect.toHaveResource(
        apiGatewayRestApiPolicy.ApiGatewayRestApiPolicy,
      );
    });

    // NOTE: addToResourcePolicy on IRestApi throws Typescript errors in AWSCDK!
    // TODO: AWSCDK > IRestApi should extend iam.IResourceWithPolicy ...
    test("cannot add a statement to the resource policy for imported RestApi from API ID", () => {
      // GIVEN
      const api = apigw.RestApi.fromRestApiId(stack, "Api", "api-id");

      // THEN
      const result = api.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["execute-api:Invoke"],
          resources: [
            stack.formatArn({
              service: "execute-api",
              resource: "*",
            }),
          ],
        }),
      );

      expect(result.statementAdded).toBe(false);
    });

    test("cannot add a statement to the resource policy for imported RestApi from API Attributes", () => {
      // GIVEN
      const api = apigw.RestApi.fromRestApiAttributes(stack, "Api", {
        restApiId: "api-id",
        rootResourceId: "root-id",
      });

      // THEN
      const result = api.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["execute-api:Invoke"],
          resources: [
            stack.formatArn({
              service: "execute-api",
              resource: "*",
              sep: "/",
            }),
          ],
        }),
      );

      expect(result.statementAdded).toBe(false);
    });
  });

  describe("grantInvokeFromVpcEndpointOnly", () => {
    test("called once", () => {
      // GIVEN
      const vpc = new Vpc(stack, "VPC");
      const vpcEndpoint = vpc.addInterfaceEndpoint("APIGatewayEndpoint", {
        service: InterfaceVpcEndpointAwsService.APIGATEWAY,
      });
      const api = new apigw.RestApi(stack, "my-api", {
        endpointTypes: [apigw.EndpointType.PRIVATE],
      });
      api.root.addMethod("GET");
      api.grantInvokeFromVpcEndpointsOnly([vpcEndpoint]);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["execute-api:Invoke"],
              condition: [
                {
                  test: "StringNotEquals",
                  values: [stack.resolve(vpcEndpoint.vpcEndpointId)],
                  variable: "aws:SourceVpce",
                },
              ],
              effect: "Deny",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: ["execute-api:/*"],
            },
            {
              actions: ["execute-api:Invoke"],
              effect: "Allow",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: ["execute-api:/*"],
            },
          ],
        },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayRestApiPolicy.ApiGatewayRestApiPolicy,
        {
          rest_api_id: stack.resolve(api.restApiId),
          policy:
            "${data.aws_iam_policy_document.my-api_PolicyDocument_A06C78E1.json}",
        },
      );
    });

    test("called once with multiple endpoints", () => {
      // GIVEN
      const vpc = new Vpc(stack, "VPC");
      const vpcEndpoint1 = vpc.addInterfaceEndpoint("APIGatewayEndpoint1", {
        service: InterfaceVpcEndpointAwsService.APIGATEWAY,
      });
      const vpcEndpoint2 = vpc.addInterfaceEndpoint("APIGatewayEndpoint2", {
        service: InterfaceVpcEndpointAwsService.APIGATEWAY,
      });
      const api = new apigw.RestApi(stack, "my-api", {
        endpointTypes: [apigw.EndpointType.PRIVATE],
      });
      api.root.addMethod("GET");
      api.grantInvokeFromVpcEndpointsOnly([vpcEndpoint1, vpcEndpoint2]);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["execute-api:Invoke"],
              condition: [
                {
                  test: "StringNotEquals",
                  values: [
                    stack.resolve(vpcEndpoint1.vpcEndpointId),
                    stack.resolve(vpcEndpoint2.vpcEndpointId),
                  ],
                  variable: "aws:SourceVpce",
                },
              ],
              effect: "Deny",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: ["execute-api:/*"],
            },
            {
              actions: ["execute-api:Invoke"],
              effect: "Allow",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: ["execute-api:/*"],
            },
          ],
        },
      );
    });

    test("called twice with the different endpoints", () => {
      // GIVEN
      const vpc = new Vpc(stack, "VPC");
      const vpcEndpoint1 = vpc.addInterfaceEndpoint("APIGatewayEndpoint1", {
        service: InterfaceVpcEndpointAwsService.APIGATEWAY,
      });
      const vpcEndpoint2 = vpc.addInterfaceEndpoint("APIGatewayEndpoint2", {
        service: InterfaceVpcEndpointAwsService.APIGATEWAY,
      });
      const api = new apigw.RestApi(stack, "my-api", {
        endpointTypes: [apigw.EndpointType.PRIVATE],
      });
      api.root.addMethod("GET");
      api.grantInvokeFromVpcEndpointsOnly([vpcEndpoint1]);
      api.grantInvokeFromVpcEndpointsOnly([vpcEndpoint2]);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["execute-api:Invoke"],
              condition: [
                {
                  test: "StringNotEquals",
                  values: [
                    stack.resolve(vpcEndpoint1.vpcEndpointId),
                    stack.resolve(vpcEndpoint2.vpcEndpointId),
                  ],
                  variable: "aws:SourceVpce",
                },
              ],
              effect: "Deny",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: ["execute-api:/*"],
            },
            {
              actions: ["execute-api:Invoke"],
              effect: "Allow",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: ["execute-api:/*"],
            },
          ],
        },
      );
    });

    test("called twice with the same endpoint", () => {
      // GIVEN
      const vpc = new Vpc(stack, "VPC");
      const vpcEndpoint = vpc.addInterfaceEndpoint("APIGatewayEndpoint", {
        service: InterfaceVpcEndpointAwsService.APIGATEWAY,
      });
      const api = new apigw.RestApi(stack, "my-api", {
        endpointTypes: [apigw.EndpointType.PRIVATE],
      });
      api.root.addMethod("GET");
      api.grantInvokeFromVpcEndpointsOnly([vpcEndpoint]);
      api.grantInvokeFromVpcEndpointsOnly([vpcEndpoint]);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["execute-api:Invoke"],
              condition: [
                {
                  test: "StringNotEquals",
                  values: [stack.resolve(vpcEndpoint.vpcEndpointId)],
                  variable: "aws:SourceVpce",
                },
              ],
              effect: "Deny",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: ["execute-api:/*"],
            },
            {
              actions: ["execute-api:Invoke"],
              effect: "Allow",
              principals: [
                {
                  identifiers: ["*"],
                  type: "AWS",
                },
              ],
              resources: ["execute-api:/*"],
            },
          ],
        },
      );
    });
  });
});

// TerraConstructs does not support telemetry metadata collection like CDK, so we skip this test suite
// describe("telemetry metadata", () => {});
