import path from "path";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { compute, AwsStack } from "../../../src/aws";
import { Bucket } from "../../../src/aws/storage/bucket";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const DEFAULT_CONFIG = {
  environmentName,
  gridUUID,
  gridBackendConfig,
};
const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const CDKTFJSON_PATH = path.join(TEST_APPDIR, "cdktf.json");

const providerConfig = { region: "us-east-1" };
describe("Function", () => {
  let app: App;
  let stack: AwsStack;
  beforeEach(() => {
    app = Testing.stubVersion(
      new App({
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, CDKTFJSON_PATH),
        },
      }),
    );
    stack = new AwsStack(app, "TestStack", {
      ...DEFAULT_CONFIG,
      providerConfig,
    });
  });
  test("Should synth and match SnapShot", () => {
    // WHEN
    new compute.LambdaFunction(stack, "HelloWorld", {
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
      runtime: compute.Runtime.PYTHON_3_14,
    });
    // THEN
    Template.synth(stack).toMatchSnapshot();
  });
  test("Should support adding vpc configuration", () => {
    // WHEN
    const bucket = new Bucket(stack, "CodeBucket");
    new compute.LambdaFunction(stack, "HelloWorld", {
      code: compute.Code.fromBucket(bucket, "mock_key"),
      handler: "index.handler",
      runtime: compute.Runtime.JAVA_21,
      networkConfig: {
        vpcId: "vpc-123",
        subnetIds: ["subnet-12345678"],
      },
    });
    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      {
        tfResourceType: "aws_security_group",
      },
      {
        vpc_id: "vpc-123",
      },
    );
    template.toHaveResourceWithProperties(
      {
        tfResourceType: "aws_iam_role",
      },
      {
        name_prefix: "123e4567-e89b-12d3-lloWorldServiceRole",
      },
    );
    template.toHaveResourceWithProperties(
      {
        tfResourceType: "aws_iam_role_policy_attachment",
      },
      {
        policy_arn:
          "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
        role: "${aws_iam_role.HelloWorld_ServiceRole_F3F7D8B0.name}",
      },
    );
    template.toHaveResourceWithProperties(
      {
        tfResourceType: "aws_lambda_function",
      },
      {
        vpc_config: {
          subnet_ids: ["subnet-12345678"],
          security_group_ids: expect.arrayContaining([
            expect.stringContaining("HelloWorld") &&
              expect.stringContaining("aws_security_group"),
          ]),
        },
      },
    );
  });
});

// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/aws-cdk-lib/aws-lambda/test/function.test.ts#L4703
describe("latest Lambda node runtime", () => {
  test("with region agnostic stack", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {
      ...DEFAULT_CONFIG,
    });

    // WHEN
    new compute.LambdaFunction(stack, "Lambda", {
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
      runtime: compute.determineLatestNodeRuntime(stack),
    });

    // THEN
    Template.synth(stack).toMatchSnapshot();
  });

  test("with stack in commercial region", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {
      ...DEFAULT_CONFIG,
      providerConfig,
    });

    // WHEN
    new compute.LambdaFunction(stack, "Lambda", {
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
      runtime: compute.determineLatestNodeRuntime(stack),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      {
        tfResourceType: "aws_lambda_function",
      },
      {
        runtime: "nodejs22.x",
      },
    );
  });

  test("with stack in china region", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {
      ...DEFAULT_CONFIG,
      providerConfig: {
        region: "cn-north-1",
      },
    });

    // WHEN
    new compute.LambdaFunction(stack, "Lambda", {
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
      runtime: compute.determineLatestNodeRuntime(stack),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      {
        tfResourceType: "aws_lambda_function",
      },
      {
        runtime: "nodejs22.x",
      },
    );
  });

  test("with stack in adc region", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {
      ...DEFAULT_CONFIG,
      providerConfig: {
        region: "us-iso-east-1",
      },
    });

    // WHEN
    new compute.LambdaFunction(stack, "Lambda", {
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
      runtime: compute.determineLatestNodeRuntime(stack),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      {
        tfResourceType: "aws_lambda_function",
      },
      {
        runtime: "nodejs22.x",
      },
    );
  });

  test("with stack in govcloud region", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {
      ...DEFAULT_CONFIG,
      providerConfig: {
        region: "us-gov-east-1",
      },
    });

    // WHEN
    new compute.LambdaFunction(stack, "Lambda", {
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
      runtime: compute.determineLatestNodeRuntime(stack),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      {
        tfResourceType: "aws_lambda_function",
      },
      {
        runtime: "nodejs22.x",
      },
    );
  });

  test("with stack in unsupported region", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {
      ...DEFAULT_CONFIG,
      providerConfig: {
        region: "us-fake-1",
      },
    });

    // WHEN
    new compute.LambdaFunction(stack, "Lambda", {
      code: compute.Code.fromInline("foo"),
      handler: "index.handler",
      runtime: compute.determineLatestNodeRuntime(stack),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      {
        tfResourceType: "aws_lambda_function",
      },
      {
        runtime: "nodejs22.x",
      },
    );
  });
});
