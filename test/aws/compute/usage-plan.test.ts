// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/usage-plan.test.ts

import {
  apiGatewayApiKey,
  apiGatewayUsagePlan,
  apiGatewayUsagePlanKey,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  ApiKey,
  Method,
  Period,
  RestApi,
  UsagePlan,
} from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "TestEnv";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = { address: "http://localhost:4566" };

describe("usage plan", () => {
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

  test("default setup", () => {
    // GIVEN
    const api = new RestApi(stack, "my-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    api.root.addMethod("GET"); // Need at least one method on the api
    const usagePlanName = "Pro";
    const usagePlanDescription = "Pro Usage Plan with no throttling limits";

    // WHEN
    new UsagePlan(stack, "my-usage-plan", {
      name: usagePlanName,
      description: usagePlanDescription,
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
        name: usagePlanName,
        description: usagePlanDescription,
      },
    );
  });

  test("usage plan with integer throttling limits", () => {
    // GIVEN
    const api = new RestApi(stack, "my-api", {
      cloudWatchRole: false,
      deploy: true,
      deployOptions: { stageName: "test" },
    });
    const method: Method = api.root.addMethod("GET"); // Need at least one method on the api
    const usagePlanName = "Basic";
    const usagePlanDescription =
      "Basic Usage Plan with integer throttling limits";

    // WHEN
    new UsagePlan(stack, "my-usage-plan", {
      name: usagePlanName,
      description: usagePlanDescription,
      apiStages: [
        {
          api: api,
          stage: api.deploymentStage!,
          throttle: [
            {
              method,
              throttle: {
                burstLimit: 20,
                rateLimit: 10,
              },
            },
          ],
        },
      ],
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
        name: usagePlanName,
        description: usagePlanDescription,
        api_stages: [
          {
            api_id: stack.resolve(api.restApiId),
            stage: stack.resolve(api.deploymentStage!.stageName),
            throttle: [
              {
                path: "//GET", // Root path '/' and method 'GET'
                burst_limit: 20,
                rate_limit: 10,
              },
            ],
          },
        ],
      },
    );
  });

  test("usage plan with integer and float throttling limits", () => {
    // GIVEN
    const api = new RestApi(stack, "my-api", {
      cloudWatchRole: false,
      deploy: true,
      deployOptions: { stageName: "test" },
    });
    const method: Method = api.root.addMethod("GET");
    const usagePlanName = "Basic";
    const usagePlanDescription =
      "Basic Usage Plan with integer and float throttling limits";

    // WHEN
    new UsagePlan(stack, "my-usage-plan", {
      name: usagePlanName,
      description: usagePlanDescription,
      apiStages: [
        {
          api: api,
          stage: api.deploymentStage!,
          throttle: [
            {
              method,
              throttle: {
                burstLimit: 20,
                rateLimit: 10.5,
              },
            },
          ],
        },
      ],
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
        name: usagePlanName,
        description: usagePlanDescription,
        api_stages: [
          {
            api_id: stack.resolve(api.restApiId),
            stage: stack.resolve(api.deploymentStage!.stageName),
            throttle: [
              {
                path: "//GET",
                burst_limit: 20,
                rate_limit: 10.5,
              },
            ],
          },
        ],
      },
    );
  });

  test("usage plan with blocked methods", () => {
    // GIVEN
    const api = new RestApi(stack, "my-api", {
      cloudWatchRole: false,
      deploy: true,
      deployOptions: { stageName: "test" },
    });
    const method: Method = api.root.addMethod("GET");
    const usagePlanName = "Basic";
    const usagePlanDescription = "Basic Usage Plan with throttling limits";

    // WHEN
    new UsagePlan(stack, "my-usage-plan", {
      name: usagePlanName,
      description: usagePlanDescription,
      apiStages: [
        {
          api: api,
          stage: api.deploymentStage!,
          throttle: [
            {
              method,
              throttle: {
                burstLimit: 0,
                rateLimit: 0,
              },
            },
          ],
        },
      ],
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
        name: usagePlanName,
        description: usagePlanDescription,
        api_stages: [
          {
            api_id: stack.resolve(api.restApiId),
            stage: stack.resolve(api.deploymentStage!.stageName),
            throttle: [
              {
                path: "//GET",
                burst_limit: 0,
                rate_limit: 0,
              },
            ],
          },
        ],
      },
    );
  });

  test("usage plan with quota limits", () => {
    // GIVEN

    // WHEN
    new UsagePlan(stack, "my-usage-plan", {
      quota: {
        limit: 10000,
        period: Period.MONTH,
      },
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
        quota_settings: {
          limit: 10000,
          period: "MONTH",
        },
      },
    );
  });

  describe("UsagePlanKey", () => {
    test("default", () => {
      // GIVEN
      const usagePlan = new UsagePlan(stack, "my-usage-plan", {
        name: "Basic",
      });
      const apiKey = new ApiKey(stack, "my-api-key");

      // WHEN
      usagePlan.addApiKey(apiKey);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
        {
          key_id: stack.resolve(apiKey.keyId),
          key_type: "API_KEY",
          usage_plan_id: stack.resolve(usagePlan.usagePlanId),
        },
      );
    });

    test("imported", () => {
      // GIVEN
      const importedUsagePlanId = "imported-id";
      const usagePlan = UsagePlan.fromUsagePlanId(
        stack,
        "my-imported-usage-plan",
        importedUsagePlanId,
      );
      const apiKey = new ApiKey(stack, "my-api-key");

      // WHEN
      // For imported UsagePlan, addApiKey might not create a UsagePlanKey resource in this stack.
      // This test might need to be adapted based on how fromUsagePlanId and addApiKey behave for imported resources.
      // Assuming addApiKey on an imported UsagePlan is a conceptual operation or managed elsewhere if it implies cross-stack resource creation.
      // If it's expected to create a UsagePlanKey in *this* stack for an imported UsagePlan, the assertion below is fine.
      usagePlan.addApiKey(apiKey);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
        {
          key_id: stack.resolve(apiKey.keyId),
          key_type: "API_KEY",
          usage_plan_id: importedUsagePlanId, // Should use the imported ID directly
        },
      );
    });

    test("multiple keys", () => {
      // GIVEN
      const usagePlan = new UsagePlan(stack, "my-usage-plan");
      const apiKey1 = new ApiKey(stack, "my-api-key-1", {
        apiKeyName: "my-api-key-1",
      });
      const apiKey2 = new ApiKey(stack, "my-api-key-2", {
        apiKeyName: "my-api-key-2",
      });

      // WHEN
      usagePlan.addApiKey(apiKey1);
      usagePlan.addApiKey(apiKey2);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        apiGatewayApiKey.ApiGatewayApiKey,
        { name: "my-api-key-1" },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayApiKey.ApiGatewayApiKey,
        { name: "my-api-key-2" },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
        {
          key_id: stack.resolve(apiKey1.keyId),
          usage_plan_id: stack.resolve(usagePlan.usagePlanId),
        },
      );
      template.expect.toHaveResourceWithProperties(
        apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
        {
          key_id: stack.resolve(apiKey2.keyId),
          usage_plan_id: stack.resolve(usagePlan.usagePlanId),
        },
      );
    });

    test("overrideLogicalId for UsagePlanKey construct ID", () => {
      // GIVEN
      const usagePlan = new UsagePlan(stack, "my-usage-plan", {
        name: "Basic",
      });
      const apiKey = new ApiKey(stack, "my-api-key");

      // WHEN
      usagePlan.addApiKey(apiKey, { overrideLogicalId: "mylogicalid" });

      // THEN
      const template = new Template(stack);
      const usatePlanKeys = template.resourcesByType(
        apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
      );
      expect(usatePlanKeys).toHaveProperty("mylogicalid");
    });

    test("UsagePlanKeys have unique logcal Ids", () => {
      // GIVEN
      const usagePlan = new UsagePlan(stack, "my-usage-plan");
      const apiKey1 = new ApiKey(stack, "my-api-key-1", {
        apiKeyName: "my-api-key-1",
      });
      const apiKey2 = new ApiKey(stack, "my-api-key-2", {
        apiKeyName: "my-api-key-2",
      });

      // WHEN
      // Assuming addApiKey uses the ApiKey's ID (or a derivative) to form the UsagePlanKey construct ID by default
      usagePlan.addApiKey(apiKey1);
      usagePlan.addApiKey(apiKey2);

      // THEN
      const template = new Template(stack);
      const usatePlanKeys = template.resourcesByType(
        apiGatewayUsagePlanKey.ApiGatewayUsagePlanKey,
      );
      expect(Object.keys(usatePlanKeys)).toEqual([
        "my-usage-plan_UsagePlanKeyResourceMyStackmy-api-key-28B2EFD5C_05FE9F79",
        "my-usage-plan_UsagePlanKeyResource_CE792E0E",
      ]);
    });
  });
});
