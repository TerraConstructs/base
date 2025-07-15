// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/stage.test.ts

import {
  apiGatewayApiKey,
  apiGatewayMethodSettings,
  apiGatewayStage,
  apiGatewayUsagePlan,
  apiGatewayUsagePlanKey,
  kinesisFirehoseDeliveryStream,
} from "@cdktf/provider-aws";
import { App, Lazy, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import { LogGroup } from "../../../src/aws/cloudwatch";
import {
  RestApi,
  Deployment,
  Stage,
  MethodLoggingLevel,
  SpecRestApi,
  ApiDefinition,
  LogGroupLogDestination,
  FirehoseLogDestination,
  AccessLogFormat,
  AccessLogField,
} from "../../../src/aws/compute";
import { Template } from "../../assertions";

const commonProps = {
  environmentName: "TestEnv",
  gridUUID: "test-uuid-123",
  providerConfig: { region: "us-east-1" },
  gridBackendConfig: { address: "http://localhost:3000" },
};

describe("stage", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", commonProps);
  });

  test("minimal setup", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    new Stage(stack, "my-stage", { deployment });

    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_api_gateway_rest_api: {
          "test-api_D6451F70": {
            name: "MyStacktestapi69F35EDE",
            // ignoring the tags...
          },
        },
        aws_api_gateway_method: {
          "test-api_GET_D8DE4ED1": {
            authorization: "NONE",
            http_method: "GET",
            resource_id:
              "${aws_api_gateway_rest_api.test-api_D6451F70.root_resource_id}",
            rest_api_id: "${aws_api_gateway_rest_api.test-api_D6451F70.id}",
          },
        },
        aws_api_gateway_deployment: {
          "my-deployment_71ED3B4B": {
            depends_on: ["aws_api_gateway_method.test-api_GET_D8DE4ED1"],
            lifecycle: {
              create_before_destroy: true,
            },
            rest_api_id: "${aws_api_gateway_rest_api.test-api_D6451F70.id}",
            triggers: {
              redeployment: "9692d40060fad99f5889cdc2e4c6ee12",
            },
          },
        },
        aws_api_gateway_integration: {
          "test-api_GET_Integration_BBB378EA": {
            http_method:
              "${aws_api_gateway_method.test-api_GET_D8DE4ED1.http_method}",
            resource_id:
              "${aws_api_gateway_rest_api.test-api_D6451F70.root_resource_id}",
            rest_api_id: "${aws_api_gateway_rest_api.test-api_D6451F70.id}",
            type: "MOCK",
          },
        },
        aws_api_gateway_stage: {
          "my-stage_7483BE9A": {
            deployment_id:
              "${aws_api_gateway_deployment.my-deployment_71ED3B4B.id}",
            rest_api_id: "${aws_api_gateway_rest_api.test-api_D6451F70.id}",
            stage_name: "prod",
          },
        },
      },
    });
  });

  test("RestApi - stage depends on the CloudWatch role when it exists", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: true,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    new Stage(stack, "my-stage", { deployment });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(apiGatewayStage.ApiGatewayStage, {
      depends_on: ["aws_api_gateway_account.test-api_Account_9B907665"],
    });
  });

  // TODO: Why are there 2 ApiGatewayStage resources in the snapshot?
  test("SpecRestApi - stage depends on the CloudWatch role when it exists", () => {
    // GIVEN
    const api = new SpecRestApi(stack, "test-api", {
      apiDefinition: ApiDefinition.fromInline({ foo: "bar" }),
      cloudWatchRole: true, // Ensure cloudWatchRole is explicitly set for SpecRestApi if needed
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    new Stage(stack, "my-stage", { deployment });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(apiGatewayStage.ApiGatewayStage, {
      depends_on: ["aws_api_gateway_account.test-api_Account_9B907665"],
    });
  });

  test("common method settings can be set at the stage level", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    const stage = new Stage(stack, "my-stage", {
      deployment,
      loggingLevel: MethodLoggingLevel.INFO,
      throttlingRateLimit: 12,
    });

    // THEN
    Template.resources(
      stack,
      apiGatewayMethodSettings.ApiGatewayMethodSettings,
    ).toEqual([
      {
        rest_api_id:
          // NOTE: stack.resolve(api.restApiId), but the stage `restApiId` attribute instead
          "${aws_api_gateway_stage.my-stage_7483BE9A.rest_api_id}",
        stage_name: stack.resolve(stage.stageName),
        method_path: "*/*",
        settings: {
          // data_trace_enabled: false, // Default is false if not specified
          logging_level: "INFO",
          throttling_rate_limit: 12,
        },
      },
    ]);
  });

  test('"stageResourceArn" returns the ARN for the stage', () => {
    // GIVEN
    const api = new RestApi(stack, "test-api");
    const deployment = new Deployment(stack, "test-deploymnet", {
      api,
    });
    api.root.addMethod("GET");

    // WHEN
    const stage = new Stage(stack, "test-stage", {
      deployment,
    });

    // THEN
    expect(stack.resolve(stage.stageArn)).toEqual(
      stack.resolve(
        `arn:${stack.partition}:apigateway:${stack.region}::/restapis/${stack.resolve(api.restApiId)}/stages/${stack.resolve(stage.stageName)}`,
      ),
    );
  });

  test("custom method settings can be set by their path", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET"); // Method on root
    api.root.addResource("goo").addResource("bar").addMethod("GET"); // Method on /goo/bar

    // WHEN
    const stage = new Stage(stack, "my-stage", {
      deployment,
      loggingLevel: MethodLoggingLevel.INFO,
      throttlingRateLimit: 12,
      methodOptions: {
        "/goo/bar/GET": {
          loggingLevel: MethodLoggingLevel.ERROR,
        },
      },
    });

    // THEN
    Template.resources(
      stack,
      apiGatewayMethodSettings.ApiGatewayMethodSettings,
    ).toEqual([
      {
        rest_api_id:
          // NOTE: stack.resolve(api.restApiId), but the stage `restApiId` attribute instead
          "${aws_api_gateway_stage.my-stage_7483BE9A.rest_api_id}",
        stage_name: stack.resolve(stage.stageName),
        method_path: "*/*",
        settings: {
          // data_trace_enabled: false, // Default is false if not specified
          logging_level: "INFO",
          throttling_rate_limit: 12,
        },
      },
      {
        rest_api_id:
          // NOTE: stack.resolve(api.restApiId), but the stage `restApiId` attribute instead
          "${aws_api_gateway_stage.my-stage_7483BE9A.rest_api_id}",
        stage_name: stack.resolve(stage.stageName),
        // NOTE: Must trim any leading forward slashes in the path
        method_path: "goo/bar/GET", // Terraform uses the actual resource path
        settings: {
          // data_trace_enabled: false, // Default is false if not specified
          logging_level: "ERROR",
        },
      },
    ]);
  });

  test('default "cacheClusterSize" is 0.5 (if cache cluster is enabled)', () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    new Stage(stack, "my-stage", {
      deployment,
      cacheClusterEnabled: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayStage.ApiGatewayStage,
      {
        cache_cluster_enabled: true,
        cache_cluster_size: "0.5",
      },
    );
  });

  test('setting "cacheClusterSize" implies "cacheClusterEnabled"', () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    new Stage(stack, "my-stage", {
      deployment,
      cacheClusterSize: "0.5",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayStage.ApiGatewayStage,
      {
        cache_cluster_enabled: true,
        cache_cluster_size: "0.5",
      },
    );
  });

  test('fails when "cacheClusterEnabled" is "false" and "cacheClusterSize" is set', () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // THEN
    expect(
      () =>
        new Stage(stack, "my-stage", {
          deployment,
          cacheClusterSize: "0.5",
          cacheClusterEnabled: false,
        }),
    ).toThrow(
      /Cannot set "cacheClusterSize" to 0.5 and "cacheClusterEnabled" to "false"/,
    );
  });

  test('if "cachingEnabled" in method settings, implicitly enable cache cluster', () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    const stage = new Stage(stack, "my-stage", {
      deployment,
      cachingEnabled: true,
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayStage.ApiGatewayStage,
      {
        cache_cluster_enabled: true,
        cache_cluster_size: "0.5",
        stage_name: "prod",
      },
    );
    template.expect.toHaveResourceWithProperties(
      apiGatewayMethodSettings.ApiGatewayMethodSettings,
      {
        rest_api_id:
          // NOTE: stack.resolve(api.restApiId), but the stage `restApiId` attribute instead
          "${aws_api_gateway_stage.my-stage_7483BE9A.rest_api_id}",
        stage_name: stack.resolve(stage.stageName),
        method_path: "*/*",
        settings: {
          caching_enabled: true,
          // data_trace_enabled: false, // Default is false if not specified
        },
      },
    );
  });

  test('if caching cluster is explicitly disabled, do not auto-enable cache cluster when "cachingEnabled" is set in method options', () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // THEN
    expect(
      () =>
        new Stage(stack, "my-stage", {
          cacheClusterEnabled: false,
          deployment,
          cachingEnabled: true,
        }),
    ).toThrow(
      /Cannot enable caching for common methods since cache cluster is disabled on stage/,
    );
  });

  test("if only the custom log destination log group is set", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    const testLogGroup = new LogGroup(stack, "LogGroup");
    new Stage(stack, "my-stage", {
      deployment,
      accessLogDestination: new LogGroupLogDestination(testLogGroup),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayStage.ApiGatewayStage,
      {
        access_log_settings: {
          destination_arn: stack.resolve(testLogGroup.logGroupArn),
          format:
            '$context.identity.sourceIp $context.identity.caller $context.identity.user [$context.requestTime] "$context.httpMethod $context.resourcePath $context.protocol" $context.status $context.responseLength $context.requestId',
        },
        stage_name: "prod",
      },
    );
  });

  test("if the custom log destination log group and format is set", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    const testLogGroup = new LogGroup(stack, "LogGroup");
    const testFormat = AccessLogFormat.jsonWithStandardFields();
    new Stage(stack, "my-stage", {
      deployment,
      accessLogDestination: new LogGroupLogDestination(testLogGroup),
      accessLogFormat: testFormat,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayStage.ApiGatewayStage,
      {
        access_log_settings: {
          destination_arn: stack.resolve(testLogGroup.logGroupArn),
          format:
            '{"requestId":"$context.requestId","ip":"$context.identity.sourceIp","user":"$context.identity.user","caller":"$context.identity.caller","requestTime":"$context.requestTime","httpMethod":"$context.httpMethod","resourcePath":"$context.resourcePath","status":"$context.status","protocol":"$context.protocol","responseLength":"$context.responseLength"}',
        },
        stage_name: "prod",
      },
    );
  });

  test("if only the custom log destination firehose delivery stream is set", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    // Using the provider resource directly as CfnDeliveryStream is a low-level construct
    const testDeliveryStream =
      new kinesisFirehoseDeliveryStream.KinesisFirehoseDeliveryStream(
        stack,
        "MyStream",
        {
          name: "amazon-apigateway-delivery-stream",
          destination: "extended_s3", // dummy destination for test
          extendedS3Configuration: {
            // dummy s3_configuration for test
            bucketArn: "arn:aws:s3:::dummy-bucket",
            roleArn: "arn:aws:iam::000000000000:role/DummyRoleForFirehose",
          },
        },
      );
    new Stage(stack, "my-stage", {
      deployment,
      accessLogDestination: new FirehoseLogDestination(testDeliveryStream),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayStage.ApiGatewayStage,
      {
        access_log_settings: {
          destination_arn: stack.resolve(testDeliveryStream.arn),
          format:
            '$context.identity.sourceIp $context.identity.caller $context.identity.user [$context.requestTime] "$context.httpMethod $context.resourcePath $context.protocol" $context.status $context.responseLength $context.requestId',
        },
        stage_name: "prod",
      },
    );
  });

  test("if the custom log destination firehose delivery stream and format is set", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", {
      cloudWatchRole: false,
      deploy: false,
    });
    const deployment = new Deployment(stack, "my-deployment", { api });
    api.root.addMethod("GET");

    // WHEN
    const testDeliveryStream =
      new kinesisFirehoseDeliveryStream.KinesisFirehoseDeliveryStream(
        stack,
        "MyStream",
        {
          name: "amazon-apigateway-delivery-stream",
          destination: "extended_s3", // dummy destination for test
          extendedS3Configuration: {
            // dummy s3_configuration for test
            bucketArn: "arn:aws:s3:::dummy-bucket",
            roleArn: "arn:aws:iam::000000000000:role/DummyRoleForFirehose",
          },
        },
      );
    const testFormat = AccessLogFormat.jsonWithStandardFields();
    new Stage(stack, "my-stage", {
      deployment,
      accessLogDestination: new FirehoseLogDestination(testDeliveryStream),
      accessLogFormat: testFormat,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayStage.ApiGatewayStage,
      {
        access_log_settings: {
          destination_arn: stack.resolve(testDeliveryStream.arn),
          format:
            '{"requestId":"$context.requestId","ip":"$context.identity.sourceIp","user":"$context.identity.user","caller":"$context.identity.caller","requestTime":"$context.requestTime","httpMethod":"$context.httpMethod","resourcePath":"$context.resourcePath","status":"$context.status","protocol":"$context.protocol","responseLength":"$context.responseLength"}',
        },
        stage_name: "prod",
      },
    );
  });

  describe("access log check", () => {
    test("fails when access log format does not contain `contextRequestId()` or `contextExtendedRequestId()`", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: false,
      });
      const deployment = new Deployment(stack, "my-deployment", { api });
      api.root.addMethod("GET");

      // WHEN
      const testLogGroup = new LogGroup(stack, "LogGroup");
      const testFormat = AccessLogFormat.custom("");

      // THEN
      expect(
        () =>
          new Stage(stack, "my-stage", {
            deployment,
            accessLogDestination: new LogGroupLogDestination(testLogGroup),
            accessLogFormat: testFormat,
          }),
      ).toThrow(
        "Access log must include either `AccessLogFormat.contextRequestId()` or `AccessLogFormat.contextExtendedRequestId()`",
      );
    });

    test("succeeds when access log format contains `contextRequestId()`", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: false,
      });
      const deployment = new Deployment(stack, "my-deployment", { api });
      api.root.addMethod("GET");

      // WHEN
      const testLogGroup = new LogGroup(stack, "LogGroup");
      const testFormat = AccessLogFormat.custom(
        JSON.stringify({
          requestId: AccessLogField.contextRequestId(),
        }),
      );

      // THEN
      expect(
        () =>
          new Stage(stack, "my-stage", {
            deployment,
            accessLogDestination: new LogGroupLogDestination(testLogGroup),
            accessLogFormat: testFormat,
          }),
      ).not.toThrow();
    });

    test("succeeds when access log format contains `contextExtendedRequestId()`", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: false,
      });
      const deployment = new Deployment(stack, "my-deployment", { api });
      api.root.addMethod("GET");

      // WHEN
      const testLogGroup = new LogGroup(stack, "LogGroup");
      const testFormat = AccessLogFormat.custom(
        JSON.stringify({
          extendedRequestId: AccessLogField.contextExtendedRequestId(),
        }),
      );

      // THEN
      expect(
        () =>
          new Stage(stack, "my-stage", {
            deployment,
            accessLogDestination: new LogGroupLogDestination(testLogGroup),
            accessLogFormat: testFormat,
          }),
      ).not.toThrow();
    });

    test("succeeds when access log format contains both `contextRequestId()` and `contextExtendedRequestId`", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: false,
      });
      const deployment = new Deployment(stack, "my-deployment", { api });
      api.root.addMethod("GET");

      // WHEN
      const testLogGroup = new LogGroup(stack, "LogGroup");
      const testFormat = AccessLogFormat.custom(
        JSON.stringify({
          requestId: AccessLogField.contextRequestId(),
          extendedRequestId: AccessLogField.contextExtendedRequestId(),
        }),
      );

      // THEN
      expect(
        () =>
          new Stage(stack, "my-stage", {
            deployment,
            accessLogDestination: new LogGroupLogDestination(testLogGroup),
            accessLogFormat: testFormat,
          }),
      ).not.toThrow();
    });

    test("fails when access log format contains `contextRequestIdXxx`", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: false,
      });
      const deployment = new Deployment(stack, "my-deployment", { api });
      api.root.addMethod("GET");

      // WHEN
      const testLogGroup = new LogGroup(stack, "LogGroup");
      const testFormat = AccessLogFormat.custom(
        JSON.stringify({
          requestIdXxx: "$context.requestIdXxx",
        }),
      );

      // THEN
      expect(
        () =>
          new Stage(stack, "my-stage", {
            deployment,
            accessLogDestination: new LogGroupLogDestination(testLogGroup),
            accessLogFormat: testFormat,
          }),
      ).toThrow(
        "Access log must include either `AccessLogFormat.contextRequestId()` or `AccessLogFormat.contextExtendedRequestId()`",
      );
    });

    test("does not fail when access log format is a token", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: false,
      });
      const deployment = new Deployment(stack, "my-deployment", { api });
      api.root.addMethod("GET");

      // WHEN
      const testLogGroup = new LogGroup(stack, "LogGroup");
      const testFormat = AccessLogFormat.custom(
        Lazy.stringValue({ produce: () => "$context.requestId" }),
      );

      // THEN
      expect(
        () =>
          new Stage(stack, "my-stage", {
            deployment,
            accessLogDestination: new LogGroupLogDestination(testLogGroup),
            accessLogFormat: testFormat,
          }),
      ).not.toThrow();
    });

    test("fails when access log destination is empty", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: false,
      });
      const deployment = new Deployment(stack, "my-deployment", { api });
      api.root.addMethod("GET");

      // WHEN
      const testFormat = AccessLogFormat.jsonWithStandardFields();

      // THEN
      expect(
        () =>
          new Stage(stack, "my-stage", {
            deployment,
            accessLogFormat: testFormat,
          }),
      ).toThrow(/Access log format is specified without a destination/);
    });

    test("fails if firehose delivery stream name does not start with amazon-apigateway-", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api", {
        cloudWatchRole: false,
        deploy: false,
      });
      const deployment = new Deployment(stack, "my-deployment", { api });
      api.root.addMethod("GET");

      // WHEN
      const testDeliveryStream =
        new kinesisFirehoseDeliveryStream.KinesisFirehoseDeliveryStream(
          stack,
          "MyStream",
          {
            name: "invalid",
            destination: "extended_s3", // dummy destination for test
            extendedS3Configuration: {
              // dummy s3_configuration for test
              bucketArn: "arn:aws:s3:::dummy-bucket",
              roleArn: "arn:aws:iam::000000000000:role/DummyRoleForFirehose",
            },
          },
        );
      expect(() => {
        new Stage(stack, "my-stage", {
          deployment,
          accessLogDestination: new FirehoseLogDestination(testDeliveryStream),
        });
      }).toThrow(
        /Firehose delivery stream name for access log destination must begin with 'amazon-apigateway-'.*got 'invalid'/,
      );
    });
  });

  test("default throttling settings", () => {
    // GIVEN
    const api = new SpecRestApi(stack, "testapi", {
      apiDefinition: ApiDefinition.fromInline({
        openapi: "3.0.2",
      }),
      deployOptions: {
        throttlingBurstLimit: 0,
        throttlingRateLimit: 0,
        metricsEnabled: false,
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayMethodSettings.ApiGatewayMethodSettings,
      {
        rest_api_id:
          // NOTE: stack.resolve(api.restApiId), but the deployment stage attribute instead
          "${aws_api_gateway_stage.testapi_DeploymentStageprod_53C72102.rest_api_id}",
        stage_name: stack.resolve(api.deploymentStage.stageName),
        method_path: "*/*",
        settings: {
          metrics_enabled: false,
          throttling_burst_limit: 0,
          throttling_rate_limit: 0,
          // data_trace_enabled: false, // Default is false if not specified
        },
      },
    );
  });

  // NOTE: Deprecated, API Keys should be handled through Usage Plans
  test("addApiKey is supported", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", { cloudWatchRole: false });
    api.root.addMethod("GET");
    const stage = new Stage(stack, "Stage", {
      deployment: api.latestDeployment!,
    });

    // WHEN
    const apiKey = stage.addApiKey("MyKey");

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResource(apiGatewayApiKey.ApiGatewayApiKey);
    // usage plan is auto created for Stage and associated with the API Key
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
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
        key_id: stack.resolve(apiKey.keyId),
        key_type: "API_KEY",
        usage_plan_id:
          "${aws_api_gateway_usage_plan.Stage_MyKey_UsagePlan_7F6954D9.id}",
      },
    );
  });

  // NOTE: Deprecated, API Keys should be handled through Usage Plans
  test("addApiKey is supported on an imported stage", () => {
    // GIVEN
    const api = new RestApi(stack, "test-api", { cloudWatchRole: false });
    api.root.addMethod("GET");
    const stage = Stage.fromStageAttributes(stack, "Stage", {
      restApi: api,
      stageName: "MyStage",
    });

    // WHEN
    const apiKey = stage.addApiKey("MyKey");

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResource(apiGatewayApiKey.ApiGatewayApiKey);
    // usage plan is auto created for Stage and associated with the API Key
    template.expect.toHaveResourceWithProperties(
      apiGatewayUsagePlan.ApiGatewayUsagePlan,
      {
        api_stages: [
          {
            api_id: stack.resolve(api.restApiId),
            // NOTE: stageName is not a token for imporated stages
            stage: "MyStage", // stack.resolve(api.deploymentStage!.stageName),
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
          "${aws_api_gateway_usage_plan.Stage_MyKey_UsagePlan_7F6954D9.id}",
      },
    );
  });

  describe("Metrics", () => {
    test("metric", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api");
      const metricName = "4XXError";
      const statistic = "Sum";

      // WHEN
      const metric = api.deploymentStage.metric(metricName, { statistic });

      // THEN
      expect(metric.namespace).toEqual("AWS/ApiGateway");
      expect(metric.metricName).toEqual(metricName);
      expect(metric.statistic).toEqual(statistic);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(api.restApiName),
        Stage: stack.resolve(api.deploymentStage.stageName),
      });
    });

    test("metricClientError", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api");
      const color = "#00ff00";

      // WHEN
      const metric = api.deploymentStage.metricClientError({ color });

      // THEN
      expect(metric.metricName).toEqual("4XXError");
      expect(metric.statistic).toEqual("Sum");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(api.restApiName),
        Stage: stack.resolve(api.deploymentStage.stageName),
      });
    });

    test("metricServerError", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api");
      const color = "#00ff00";

      // WHEN
      const metric = api.deploymentStage.metricServerError({ color });

      // THEN
      expect(metric.metricName).toEqual("5XXError");
      expect(metric.statistic).toEqual("Sum");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(api.restApiName),
        Stage: stack.resolve(api.deploymentStage.stageName),
      });
    });

    test("metricCacheHitCount", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api");
      const color = "#00ff00";

      // WHEN
      const metric = api.deploymentStage.metricCacheHitCount({ color });

      // THEN
      expect(metric.metricName).toEqual("CacheHitCount");
      expect(metric.statistic).toEqual("Sum");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(api.restApiName),
        Stage: stack.resolve(api.deploymentStage.stageName),
      });
    });

    test("metricCacheMissCount", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api");
      const color = "#00ff00";

      // WHEN
      const metric = api.deploymentStage.metricCacheMissCount({ color });

      // THEN
      expect(metric.metricName).toEqual("CacheMissCount");
      expect(metric.statistic).toEqual("Sum");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(api.restApiName),
        Stage: stack.resolve(api.deploymentStage.stageName),
      });
    });

    test("metricCount", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api");
      const color = "#00ff00";

      // WHEN
      const metric = api.deploymentStage.metricCount({ color });

      // THEN
      expect(metric.metricName).toEqual("Count");
      expect(metric.statistic).toEqual("SampleCount");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(api.restApiName),
        Stage: stack.resolve(api.deploymentStage.stageName),
      });
    });

    test("metricIntegrationLatency", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api");
      const color = "#00ff00";

      // WHEN
      const metric = api.deploymentStage.metricIntegrationLatency({ color });

      // THEN
      expect(metric.metricName).toEqual("IntegrationLatency");
      expect(metric.statistic).toEqual("Average");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(api.restApiName),
        Stage: stack.resolve(api.deploymentStage.stageName),
      });
    });

    test("metricLatency", () => {
      // GIVEN
      const api = new RestApi(stack, "test-api");
      const color = "#00ff00";

      // WHEN
      const metric = api.deploymentStage.metricLatency({ color });

      // THEN
      expect(metric.metricName).toEqual("Latency");
      expect(metric.statistic).toEqual("Average");
      expect(metric.color).toEqual(color);
      expect(stack.resolve(metric.dimensions)).toEqual({
        ApiName: stack.resolve(api.restApiName),
        Stage: stack.resolve(api.deploymentStage.stageName),
      });
    });
  });
});
