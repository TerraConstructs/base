import {
  apiGatewayApiKey,
  apiGatewayUsagePlan,
  apiGatewayUsagePlanKey,
  iamUserPolicy,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as apigateway from "../../../src/aws/compute";
import * as iam from "../../../src/aws/iam";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("api key", () => {
  let stack: AwsStack;
  let app: App;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("default setup", () => {
    // WHEN
    new apigateway.ApiKey(stack, "my-api-key");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayApiKey.ApiGatewayApiKey,
      {
        enabled: true,
      },
    );
  });

  // TODO: Deprecated
  test("throws if deploymentStage is not set for associated RestApi", () => {
    // GIVEN
    const restApi = apigateway.RestApi.fromRestApiId(
      stack,
      "importedApi",
      "api-id-123",
    );

    // THEN
    expect(() => {
      new apigateway.ApiKey(stack, "my-api-key", {
        resources: [restApi],
      });
    }).toThrow(
      /Cannot add an ApiKey to a RestApi that does not contain a "deploymentStage"/i,
    );
  });

  test("enabled flag is respected", () => {
    // WHEN
    new apigateway.ApiKey(stack, "my-api-key", {
      enabled: false,
      value: "arandomstringwithmorethantwentycharacters",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayApiKey.ApiGatewayApiKey,
      {
        enabled: false,
        value: "arandomstringwithmorethantwentycharacters",
      },
    );
  });

  // TODO: Deprecated
  test("specify props for apiKey", () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "test-api", {
      deploy: true,
      deployOptions: { stageName: "test" },
    });
    api.root.addMethod("GET"); // api must have atleast one method.

    // WHEN
    const apiKey = new apigateway.ApiKey(stack, "test-api-key", {
      customerId: "test-customer",
      stages: [api.deploymentStage!], // api.deploymentStage should be defined due to deploy:true
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayApiKey.ApiGatewayApiKey,
      {
        customer_id: "test-customer",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
        // name: "TestStacktestapikeyUsagePlan93EEFA51",
        api_stages: [
          {
            api_id: stack.resolve(api.restApiId),
            stage: stack.resolve(api.deploymentStage!.stageName),
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
          "${aws_api_gateway_usage_plan.test-api-key_UsagePlan_0EECD16A.id}",
      },
    );
  });

  test("add description to apiKey", () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "test-api", {
      deploy: true,
      deployOptions: { stageName: "prod" },
    });
    api.root.addMethod("GET"); // api must have atleast one method.

    // WHEN
    // Simulating api.addApiKey by creating ApiKey directly and associating with deploymentStage
    new apigateway.ApiKey(stack, "my-api-key", {
      description: "The most secret api key",
      stages: [api.deploymentStage!],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayApiKey.ApiGatewayApiKey,
      {
        description: "The most secret api key",
      },
    );
  });

  test("add description to apiKey added to a stage", () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "test-api");
    api.root.addMethod("GET"); // api must have atleast one method.

    const stage = apigateway.Stage.fromStageAttributes(stack, "Stage", {
      restApi: api,
      stageName: "MyStage",
    });
    // WHEN
    stage.addApiKey("my-api-key", {
      description: "The most secret api key",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayApiKey.ApiGatewayApiKey,
      {
        description: "The most secret api key",
      },
    );
  });

  test("use an imported api key", () => {
    // GIVEN
    const api = new apigateway.RestApi(stack, "test-api", {
      deploy: true,
      deployOptions: { stageName: "test" },
    });
    api.root.addMethod("GET"); // api must have atleast one method.

    // WHEN
    const importedKey = apigateway.ApiKey.fromApiKeyId(
      stack,
      "imported",
      "KeyIdabc",
    );
    const usagePlan = new apigateway.UsagePlan(stack, "plan");
    usagePlan.addApiKey(importedKey);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
      {
        key_id: "KeyIdabc",
        key_type: "API_KEY",
        usage_plan_id: stack.resolve(usagePlan.usagePlanId),
      },
    );
  });

  test("grantRead", () => {
    // GIVEN
    const user = new iam.User(stack, "User");
    const api = new apigateway.RestApi(stack, "test-api", {
      deploy: true,
      deployOptions: { stageName: "test" },
    });
    api.root.addMethod("GET");
    const deployment = api.latestDeployment!;
    const stage = new apigateway.Stage(stack, "MyStage", {
      deployment,
      stageName: "MyStageName",
    });

    // WHEN
    const apiKey = new apigateway.ApiKey(stack, "test-api-key", {
      customerId: "test-customer",
      stages: [stage],
    });
    apiKey.grantRead(user);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["apigateway:GET"],
            effect: "Allow",
            resources: [
              stack.resolve(apiKey.keyArn),
              // stack.resolve(`arn:${stack.partition}:apigateway:${stack.region}::/apikeys/${stack.resolve(apiKey.keyId)}`),
              ,
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      user: stack.resolve(user.userName),
    });
  });

  test("grantWrite", () => {
    // GIVEN
    const user = new iam.User(stack, "User");
    const api = new apigateway.RestApi(stack, "test-api", {
      deploy: true,
      deployOptions: { stageName: "test" },
    });
    api.root.addMethod("GET");
    const deployment = api.latestDeployment!;
    const stage = new apigateway.Stage(stack, "MyStage", {
      deployment,
      stageName: "MyStageName",
    });

    // WHEN
    const apiKey = new apigateway.ApiKey(stack, "test-api-key", {
      customerId: "test-customer",
      stages: [stage],
    });
    apiKey.grantWrite(user);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "apigateway:POST",
              "apigateway:PUT",
              "apigateway:PATCH",
              "apigateway:DELETE",
            ],
            effect: "Allow",
            resources: [
              stack.resolve(apiKey.keyArn),
              // stack.resolve(`arn:${stack.partition}:apigateway:${stack.region}::/apikeys/${stack.resolve(apiKey.keyId)}`),
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      user: stack.resolve(user.userName),
    });
  });

  test("grantReadWrite", () => {
    // GIVEN
    const user = new iam.User(stack, "User");
    const api = new apigateway.RestApi(stack, "test-api", {
      deploy: true,
      deployOptions: { stageName: "test" },
    });
    api.root.addMethod("GET");
    const deployment = api.latestDeployment!;
    const stage = new apigateway.Stage(stack, "MyStage", {
      deployment,
      stageName: "MyStageName",
    });

    // WHEN
    const apiKey = new apigateway.ApiKey(stack, "test-api-key", {
      customerId: "test-customer",
      stages: [stage],
    });
    apiKey.grantReadWrite(user);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "apigateway:GET",
              "apigateway:POST",
              "apigateway:PUT",
              "apigateway:PATCH",
              "apigateway:DELETE",
            ],
            effect: "Allow",
            resources: [
              stack.resolve(apiKey.keyArn),
              // stack.resolve(
              //   `arn:${stack.partition}:apigateway:${stack.region}::/apikeys/${stack.resolve(apiKey.keyId)}`,
              // ),
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      user: stack.resolve(user.userName),
    });
  });

  describe("rate limited", () => {
    test("default setup", () => {
      // GIVEN
      new apigateway.RestApi(stack, "my-api", { deploy: false });
      // api.root.addMethod('GET'); // Method not strictly needed for ApiKey itself

      // WHEN
      new apigateway.RateLimitedApiKey(stack, "my-api-key");

      // THEN
      const t = new Template(stack);
      t.resourceCountIs(apiGatewayApiKey.ApiGatewayApiKey, 1);
      t.resourceCountIs(apiGatewayUsagePlan.ApiGatewayUsagePlan, 0);
      t.resourceCountIs(apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey, 0);
    });

    // NOTE: The core ApiKey always creates UsagePlan as soon as stages are passed in...
    test("only api key is created when rate limiting properties are not provided", () => {
      // GIVEN
      const api = new apigateway.RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: true,
        deployOptions: { stageName: "test" },
      });
      api.root.addMethod("GET"); // api must have atleast one method.
      const stage = apigateway.Stage.fromStageAttributes(stack, "Stage", {
        restApi: api,
        stageName: "MyStage",
      });

      // WHEN
      new apigateway.RateLimitedApiKey(stack, "test-api-key", {
        customerId: "test-customer",
        stages: [stage],
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(apiGatewayApiKey.ApiGatewayApiKey, {
        customer_id: "test-customer",
      });

      // // Commented out because Terraform Provider enforces Usage Plan creation ...
      // t.resourceCountIs(apiGatewayUsagePlan.ApiGatewayUsagePlan, 0);
      // t.resourceCountIs(apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey, 0);

      // Confirm no Rate Limiting is enabled in the Usage Plan associated with the ApiKey
      t.expect.not.toHaveResourceWithProperties(
        apiGatewayUsagePlan.ApiGatewayUsagePlan,
        {
          quota_settings: expect.anything(),
        },
      );
      t.expect.not.toHaveResourceWithProperties(
        apiGatewayUsagePlan.ApiGatewayUsagePlan,
        {
          throttle_settings: expect.anything(),
        },
      );
    });

    test("api key and usage plan are created and linked when rate limiting properties are provided", () => {
      // GIVEN
      const api = new apigateway.RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: true,
        deployOptions: { stageName: "test" },
      });
      api.root.addMethod("GET");
      const stage = apigateway.Stage.fromStageAttributes(stack, "Stage", {
        restApi: api,
        stageName: "MyStage",
      });

      // WHEN
      const rateLimitedApiKey = new apigateway.RateLimitedApiKey(
        stack,
        "test-api-key",
        {
          customerId: "test-customer",
          // TODO: Is this bug in AWSCDK api-key.test.ts?
          // stages: [stage],
          apiStages: [
            {
              api,
              // NOTE: Known issue in AWSCDK requiring Stage instead of IStage T_T
              stage: stage as apigateway.Stage,
            },
          ],
          quota: {
            limit: 10000,
            period: apigateway.Period.MONTH,
          },
        },
      );

      // THEN
      const template = new Template(stack);
      // Check ApiKey properties
      template.expect.toHaveResourceWithProperties(
        apiGatewayApiKey.ApiGatewayApiKey,
        {
          customer_id: "test-customer",
        },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayUsagePlan.ApiGatewayUsagePlan,
        {
          quota_settings: {
            limit: 10000,
            period: "MONTH",
          },
          api_stages: [
            {
              api_id: stack.resolve(api.restApiId),
              stage: stack.resolve(stage.stageName),
            },
          ],
        },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
        {
          key_id: stack.resolve(rateLimitedApiKey.apiKey.keyId),
          key_type: "API_KEY",
          // usage_plan_id: stack.resolve(usagePlanCreatedByRateLimitedApiKey.id) // This needs a way to reference it
          usage_plan_id:
            "${aws_api_gateway_usage_plan.test-api-key_RateLimitedUsagePlan_FEBF6A23.id}",
        },
      );
      // A more robust check would be if RateLimitedApiKey exposes its usagePlan
      // expect(Testing.synth(stack)).toHaveResourceWithProperties(apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey, {
      //   key_id: stack.resolve(rateLimitedApiKey.id),
      //   key_type: 'API_KEY',
      //   usage_plan_id: stack.resolve((rateLimitedApiKey as any).usagePlan.id), // Assuming usagePlan is exposed
      // });
    });
  });
});
