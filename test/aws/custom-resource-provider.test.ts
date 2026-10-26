// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/core/test/custom-resource-provider/custom-resource-provider.test.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  cloudwatchLogGroup,
  iamRole,
  iamRolePolicy,
  iamRolePolicyAttachment,
  lambdaFunction,
  s3Bucket,
  s3Object,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AssetStaging, Duration, Size } from "../../src";
import {
  AwsStack,
  AwsStackProps,
  CustomResource,
  CustomResourceProvider,
  CustomResourceProviderBase,
  CustomResourceProviderOptions,
  CustomResourceProviderRuntime,
} from "../../src/aws";
import { determineLatestNodeRuntimeName } from "../../src/aws/custom-resource-provider-runtime";
import { Template } from "../assertions";

const TEST_HANDLER = path.join(
  __dirname,
  "custom-resource-provider",
  "mock-provider",
);
// AssetStaging stages next to cdktf.json (tcons-staging/ is gitignored).
const CDKTFJSON_PATH = path.join(
  __dirname,
  "custom-resource-provider",
  "cdktf.json",
);
// current node runtime available in ALL AWS regions
const DEFAULT_PROVIDER_RUNTIME = CustomResourceProviderRuntime.NODEJS_20_X;
const PROVIDER_ID = "Custom:MyResourceTypeCustomResourceProvider";

function makeStack(props: AwsStackProps = {}): AwsStack {
  const app = Testing.stubVersion(
    new App({
      stackTraces: false,
      context: { cdktfJsonPath: CDKTFJSON_PATH },
    }),
  );
  return new AwsStack(app, "MyStack", {
    gridUUID: "g123e4567-e89b",
    ...props,
  });
}

function parsePolicy(policy: string): any {
  return JSON.parse(policy);
}

describe("custom resource provider", () => {
  // NOTE: upstream "customize roles" tests (pre-created roles via
  // `@aws-cdk/core:customizeRoles`) are not ported: TerraConstructs has no
  // pre-created role support.

  test("minimal configuration", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    const serviceToken = CustomResourceProvider.getOrCreate(
      stack,
      "Custom:MyResourceType",
      {
        codeDirectory: TEST_HANDLER,
        runtime: DEFAULT_PROVIDER_RUNTIME,
      },
    );

    // THEN
    const template = new Template(stack);
    const provider = stack.node.tryFindChild(
      PROVIDER_ID,
    ) as CustomResourceProvider;
    expect(provider).toBeInstanceOf(CustomResourceProvider);
    expect(stack.resolve(serviceToken)).toEqual(
      stack.resolve(provider.serviceToken),
    );

    template.resourceCountIs(iamRole.IamRole, 1);
    template.expectResources(iamRole.IamRole).toEqual([
      expect.objectContaining({
        name_prefix: expect.stringMatching(/^g123e4567-e89b-/),
      }),
    ]);
    const [role] = template.resourceTypeArray(iamRole.IamRole) as any[];
    expect(JSON.parse(role.assume_role_policy)).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
        },
      ],
    });
    // TerraConstructs deviation: no AWSLambdaBasicExecutionRole
    expect(role.managed_policy_arns).toBeUndefined();
    template.resourceCountIs(
      iamRolePolicyAttachment.IamRolePolicyAttachment,
      0,
    );
    // no "Inline" policy without statements, only the scoped logs policy
    template
      .expectResources(iamRolePolicy.IamRolePolicy)
      .toEqual([expect.objectContaining({ name: "Logs" })]);

    template.expectResources(lambdaFunction.LambdaFunction).toEqual([
      expect.objectContaining({
        function_name: expect.stringMatching(/^g123e4567-e89b-/),
        handler: "__entrypoint__.handler",
        runtime: DEFAULT_PROVIDER_RUNTIME,
        timeout: 900,
        memory_size: 128,
        role: stack.resolve(provider.roleArn),
        s3_bucket: expect.stringMatching(/^\$\{aws_s3_bucket\.AssetBucket\./),
        s3_key: expect.stringMatching(
          /^\$\{aws_s3_object\.FileAsset_S3\.key\}$/,
        ),
      }),
    ]);
    const [fn] = template.resourceTypeArray(
      lambdaFunction.LambdaFunction,
    ) as any[];
    expect(fn.function_name.length).toBeLessThanOrEqual(64);
    // aws_iam_role name_prefix is limited to 64 - 26 (unique suffix) chars
    expect(role.name_prefix.length).toBeLessThanOrEqual(38);
    expect(fn.environment).toBeUndefined();
    expect(fn.description).toBeUndefined();
  });

  test("asset is staged with the entrypoint wrapper and the handler code", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    const provider = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:MyResourceType",
      {
        codeDirectory: TEST_HANDLER,
        runtime: DEFAULT_PROVIDER_RUNTIME,
      },
    );

    // THEN
    const staging = provider.node.tryFindChild("Staging") as AssetStaging;
    expect(staging).toBeInstanceOf(AssetStaging);
    expect(provider.codeHash).toEqual(staging.assetHash);
    const files = fs.readdirSync(staging.absoluteStagedPath).sort();
    expect(files).toEqual(["__entrypoint__.js", "index.js"]);
    const entrypoint = fs.readFileSync(
      path.join(staging.absoluteStagedPath, "__entrypoint__.js"),
      "utf-8",
    );
    expect(entrypoint).toContain(
      "AWSCDK::CustomResourceProviderFramework::CREATE_FAILED",
    );
    // uploaded once, as a zip file asset
    const template = new Template(stack);
    template.resourceCountIs(s3Object.S3Object, 1);
    template.expectResources(s3Object.S3Object).toEqual([
      expect.objectContaining({
        key: `${staging.assetHash}.zip`,
      }),
    ]);
  });

  test("useCfnResponseWrapper: false uses index.handler and skips the entrypoint", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    const provider = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:MyResourceType",
      {
        codeDirectory: TEST_HANDLER,
        runtime: DEFAULT_PROVIDER_RUNTIME,
        useCfnResponseWrapper: false,
      },
    );

    // THEN
    const staging = provider.node.tryFindChild("Staging") as AssetStaging;
    expect(fs.readdirSync(staging.absoluteStagedPath)).toEqual(["index.js"]);
    new Template(stack)
      .expectResources(lambdaFunction.LambdaFunction)
      .toEqual([expect.objectContaining({ handler: "index.handler" })]);
  });

  test(".ts files in the code directory are not staged", () => {
    // GIVEN
    const stack = makeStack();
    const codeDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tc-custom-resource-provider-test-"),
    );
    fs.writeFileSync(
      path.join(codeDirectory, "index.js"),
      "exports.handler = async () => {};",
    );
    fs.writeFileSync(path.join(codeDirectory, "index.ts"), "export {};");
    fs.writeFileSync(path.join(codeDirectory, "index.d.ts"), "export {};");

    // WHEN
    const provider = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:MyResourceType",
      { codeDirectory, runtime: DEFAULT_PROVIDER_RUNTIME },
    );

    // THEN
    const staging = provider.node.tryFindChild("Staging") as AssetStaging;
    expect(fs.readdirSync(staging.absoluteStagedPath).sort()).toEqual([
      "__entrypoint__.js",
      "index.js",
    ]);
    fs.rmSync(codeDirectory, { recursive: true, force: true });
  });

  test("throws if the code directory has no index.js", () => {
    // GIVEN
    const stack = makeStack();

    // THEN
    expect(() =>
      CustomResourceProvider.getOrCreateProvider(
        stack,
        "Custom:MyResourceType",
        {
          codeDirectory: __dirname,
          runtime: DEFAULT_PROVIDER_RUNTIME,
        },
      ),
    ).toThrow(/cannot find .*\/index\.js/);
  });

  test("policyStatements can be used to add statements to the inline policy", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    CustomResourceProvider.getOrCreate(stack, "Custom:MyResourceType", {
      codeDirectory: TEST_HANDLER,
      runtime: DEFAULT_PROVIDER_RUNTIME,
      policyStatements: [{ statement1: 123 }, { statement2: { foo: 111 } }],
    });

    // THEN
    const template = new Template(stack);
    const inline = (
      template.resourceTypeArray(iamRolePolicy.IamRolePolicy) as any[]
    ).find((p) => p.name === "Inline");
    expect(parsePolicy(inline.policy)).toEqual({
      Version: "2012-10-17",
      Statement: [{ statement1: 123 }, { statement2: { foo: 111 } }],
    });
    // the handler waits for its permissions
    const [fn] = template.resourceTypeArray(
      lambdaFunction.LambdaFunction,
    ) as any[];
    expect(fn.depends_on).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^aws_iam_role_policy\..*InlinePolicy/),
      ]),
    );
  });

  test("addToRolePolicy() can be used to add statements to the inline policy", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    const provider = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:MyResourceType",
      {
        codeDirectory: TEST_HANDLER,
        runtime: DEFAULT_PROVIDER_RUNTIME,
        policyStatements: [{ statement1: 123 }, { statement2: { foo: 111 } }],
      },
    );
    provider.addToRolePolicy({ statement3: 456 });

    // THEN
    const template = new Template(stack);
    const policies = template.resourceTypeArray(
      iamRolePolicy.IamRolePolicy,
    ) as any[];
    const inline = policies.filter((p) => p.name === "Inline");
    expect(inline).toHaveLength(1);
    expect(parsePolicy(inline[0].policy)).toEqual({
      Version: "2012-10-17",
      Statement: [
        { statement1: 123 },
        { statement2: { foo: 111 } },
        { statement3: 456 },
      ],
    });
  });

  test("addToRolePolicy() after construction creates the inline policy and a handler dependency", () => {
    // GIVEN
    const stack = makeStack();
    const bucket = new s3Bucket.S3Bucket(stack, "Bucket");

    // WHEN
    const provider = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:MyResourceType",
      {
        codeDirectory: TEST_HANDLER,
        runtime: DEFAULT_PROVIDER_RUNTIME,
      },
    );
    provider.addToRolePolicy({
      Effect: "Allow",
      Action: "s3:GetObject",
      Resource: `${bucket.arn}/*`,
    });

    // THEN
    const template = new Template(stack);
    const inline = (
      template.resourceTypeArray(iamRolePolicy.IamRolePolicy) as any[]
    ).find((p) => p.name === "Inline");
    expect(inline.role).toEqual(
      expect.stringMatching(/^\$\{aws_iam_role\..*\.name\}$/),
    );
    expect(parsePolicy(inline.policy)).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "s3:GetObject",
          Resource: "${aws_s3_bucket.Bucket.arn}/*",
        },
      ],
    });
    const [fn] = template.resourceTypeArray(
      lambdaFunction.LambdaFunction,
    ) as any[];
    expect(fn.depends_on).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^aws_iam_role_policy\..*InlinePolicy/),
      ]),
    );
  });

  test("log group is created explicitly and the role may only write to it", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    CustomResourceProvider.getOrCreate(stack, "Custom:MyResourceType", {
      codeDirectory: TEST_HANDLER,
      runtime: DEFAULT_PROVIDER_RUNTIME,
    });

    // THEN
    const template = new Template(stack);
    const [fn] = template.resourceTypeArray(
      lambdaFunction.LambdaFunction,
    ) as any[];
    template
      .expectResources(cloudwatchLogGroup.CloudwatchLogGroup)
      .toEqual([{ name: `/aws/lambda/${fn.function_name}` }]);
    expect(fn.logging_config).toEqual({
      log_format: "Text",
      log_group: expect.stringMatching(
        /^\$\{aws_cloudwatch_log_group\..*LogGroup.*\.name\}$/,
      ),
    });
    const logs = (
      template.resourceTypeArray(iamRolePolicy.IamRolePolicy) as any[]
    ).find((p) => p.name === "Logs");
    const doc = parsePolicy(logs.policy);
    expect(doc).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
          Resource: expect.stringMatching(
            /^\$\{aws_cloudwatch_log_group\..*\.arn\}:\*$/,
          ),
        },
      ],
    });
    // the logs policy is attached to the provider's own role (the one the
    // function assumes)
    const roleRef = /^\$\{(aws_iam_role\.[^.]+)\.arn\}$/.exec(fn.role)![1];
    expect(logs.role).toEqual(`\${${roleRef}.name}`);
    const synthesized = Testing.synth(stack);
    expect(synthesized).not.toContain("logs:CreateLogGroup");
    expect(synthesized).not.toContain("AWSLambdaBasicExecutionRole");
    expect(fn.depends_on).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^aws_iam_role\./),
        expect.stringMatching(/^aws_cloudwatch_log_group\./),
        expect.stringMatching(/^aws_iam_role_policy\..*LogsPolicy/),
      ]),
    );
  });

  test("memorySize, timeout and description", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    CustomResourceProvider.getOrCreate(stack, "Custom:MyResourceType", {
      codeDirectory: TEST_HANDLER,
      runtime: DEFAULT_PROVIDER_RUNTIME,
      memorySize: Size.gibibytes(2),
      timeout: Duration.minutes(5),
      description: "veni vidi vici",
    });

    // THEN
    new Template(stack).expectResources(lambdaFunction.LambdaFunction).toEqual([
      expect.objectContaining({
        memory_size: 2048,
        timeout: 300,
        description: "veni vidi vici",
      }),
    ]);
  });

  test("environment variables", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    CustomResourceProvider.getOrCreate(stack, "Custom:MyResourceType", {
      codeDirectory: TEST_HANDLER,
      runtime: DEFAULT_PROVIDER_RUNTIME,
      environment: {
        B: "b",
        A: "a",
      },
    });

    // THEN
    const [fn] = new Template(stack).resourceTypeArray(
      lambdaFunction.LambdaFunction,
    ) as any[];
    expect(fn.environment).toEqual({
      variables: {
        A: "a",
        AWS_STS_REGIONAL_ENDPOINTS: "regional",
        B: "b",
      },
    });
    // sorted keys
    expect(Object.keys(fn.environment.variables)).toEqual([
      "A",
      "AWS_STS_REGIONAL_ENDPOINTS",
      "B",
    ]);
  });

  test("empty environment renders no environment block", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    CustomResourceProvider.getOrCreate(stack, "Custom:MyResourceType", {
      codeDirectory: TEST_HANDLER,
      runtime: DEFAULT_PROVIDER_RUNTIME,
      environment: {},
    });

    // THEN
    const [fn] = new Template(stack).resourceTypeArray(
      lambdaFunction.LambdaFunction,
    ) as any[];
    expect(fn.environment).toBeUndefined();
  });

  test("codeHash changes with the provider code", () => {
    // GIVEN
    const stack = makeStack();
    const codeDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tc-custom-resource-provider-test-"),
    );
    fs.writeFileSync(
      path.join(codeDirectory, "index.js"),
      "exports.handler = async () => ({ PhysicalResourceId: 'other' });",
    );

    // WHEN
    const p1 = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:MyResourceType",
      { codeDirectory: TEST_HANDLER, runtime: DEFAULT_PROVIDER_RUNTIME },
    );
    const p2 = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:OtherResourceType",
      { codeDirectory, runtime: DEFAULT_PROVIDER_RUNTIME },
    );
    const p3 = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:NoWrapperResourceType",
      {
        codeDirectory: TEST_HANDLER,
        runtime: DEFAULT_PROVIDER_RUNTIME,
        useCfnResponseWrapper: false,
      },
    );

    // THEN
    expect(p1.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([p1.codeHash, p2.codeHash, p3.codeHash]).size).toEqual(3);
    const template = new Template(stack);
    template.resourceCountIs(s3Object.S3Object, 3);
    const fns = template.resourceTypeArray(
      lambdaFunction.LambdaFunction,
    ) as any[];
    expect(new Set(fns.map((f) => f.s3_key)).size).toEqual(3);
    fs.rmSync(codeDirectory, { recursive: true, force: true });
  });

  test("roleArn", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    const cr = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:MyResourceType",
      {
        codeDirectory: TEST_HANDLER,
        runtime: DEFAULT_PROVIDER_RUNTIME,
      },
    );

    // THEN
    expect(stack.resolve(cr.roleArn)).toMatch(
      /^\$\{aws_iam_role\..*Role.*\.arn\}$/,
    );
    expect(stack.resolve(cr.serviceToken)).toMatch(
      /^\$\{aws_lambda_function\..*Handler.*\.arn\}$/,
    );
  });

  test("getOrCreateProvider returns a stack-level singleton per uniqueid", () => {
    // GIVEN
    const stack = makeStack();
    const nested = new Construct(stack, "Nested");

    // WHEN
    const p1 = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:MyResourceType",
      { codeDirectory: TEST_HANDLER, runtime: DEFAULT_PROVIDER_RUNTIME },
    );
    const p2 = CustomResourceProvider.getOrCreateProvider(
      nested,
      "Custom:MyResourceType",
      {
        codeDirectory: TEST_HANDLER,
        runtime: CustomResourceProviderRuntime.NODEJS_22_X,
        description: "ignored, the provider already exists",
      },
    );
    const token = CustomResourceProvider.getOrCreate(
      nested,
      "Custom:MyResourceType",
      { codeDirectory: TEST_HANDLER, runtime: DEFAULT_PROVIDER_RUNTIME },
    );
    const other = CustomResourceProvider.getOrCreateProvider(
      stack,
      "Custom:OtherResourceType",
      { codeDirectory: TEST_HANDLER, runtime: DEFAULT_PROVIDER_RUNTIME },
    );

    // THEN
    expect(p2).toBe(p1);
    expect(p1.node.id).toEqual(PROVIDER_ID);
    expect(p1.node.scope).toBe(stack);
    expect(stack.resolve(token)).toEqual(stack.resolve(p1.serviceToken));
    expect(other).not.toBe(p1);
    expect(other.node.id).toEqual(
      "Custom:OtherResourceTypeCustomResourceProvider",
    );

    const template = new Template(stack);
    template.resourceCountIs(lambdaFunction.LambdaFunction, 2);
    template.resourceCountIs(iamRole.IamRole, 2);
    template.resourceCountIs(cloudwatchLogGroup.CloudwatchLogGroup, 2);
    // same code => the asset is uploaded once
    template.resourceCountIs(s3Object.S3Object, 1);
    const fns = template.resourceTypeArray(
      lambdaFunction.LambdaFunction,
    ) as any[];
    expect(fns.map((f) => f.runtime)).toEqual([
      DEFAULT_PROVIDER_RUNTIME,
      DEFAULT_PROVIDER_RUNTIME,
    ]);
    expect(fns.map((f) => f.description)).toEqual([undefined, undefined]);
    expect(new Set(fns.map((f) => f.function_name)).size).toEqual(2);
  });

  test("service token can be used with CustomResource", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    const serviceToken = CustomResourceProvider.getOrCreate(
      stack,
      "Custom:MyResourceType",
      { codeDirectory: TEST_HANDLER, runtime: DEFAULT_PROVIDER_RUNTIME },
    );
    new CustomResource(stack, "MyResource", {
      serviceToken,
      resourceType: "Custom::MyResourceType",
    });

    // THEN
    const synthesized = JSON.parse(Testing.synth(stack));
    const resources = Object.values(
      synthesized.resource.cfncompat_custom_resource,
    ) as any[];
    expect(resources).toHaveLength(1);
    expect(resources[0].service_token).toMatch(
      /^\$\{aws_lambda_function\..*\.arn\}$/,
    );
  });

  test.each([
    [CustomResourceProviderRuntime.NODEJS_12, "nodejs12.x"],
    [CustomResourceProviderRuntime.NODEJS_12_X, "nodejs12.x"],
    [CustomResourceProviderRuntime.NODEJS_18_X, "nodejs18.x"],
    [CustomResourceProviderRuntime.NODEJS_22_X, "nodejs22.x"],
    [CustomResourceProviderRuntime.NODEJS_24_X, "nodejs24.x"],
  ])("runtime %s maps to %s", (runtime, expected) => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    CustomResourceProvider.getOrCreate(stack, "Custom:MyResourceType", {
      codeDirectory: TEST_HANDLER,
      runtime,
    });

    // THEN
    new Template(stack)
      .expectResources(lambdaFunction.LambdaFunction)
      .toEqual([expect.objectContaining({ runtime: expected })]);
  });
});

describe("latest Lambda node runtime", () => {
  test("with region agnostic stack", () => {
    // GIVEN
    const stack = makeStack();

    // WHEN
    TestCustomResourceProvider.getOrCreateProvider(stack, "TestCrProvider");

    // THEN
    // Since all regions now have the same latest Node.js runtime (nodejs22.x),
    // the literal value is used instead of creating a lookup map
    new Template(stack)
      .expectResources(lambdaFunction.LambdaFunction)
      .toEqual([expect.objectContaining({ runtime: "nodejs22.x" })]);
  });

  test.each([
    ["commercial", "us-east-1", "nodejs22.x"],
    ["china", "cn-north-1", "nodejs22.x"],
    ["govcloud", "us-gov-east-1", "nodejs22.x"],
    ["adc", "us-iso-east-1", "nodejs22.x"],
    // TerraConstructs uses the v2.263.0 fallback (upstream v2.233.0: nodejs18.x)
    ["unsupported", "us-fake-1", "nodejs24.x"],
  ])("with stack in %s region", (_name, region, expected) => {
    // GIVEN
    const stack = makeStack({ providerConfig: { region } });

    // WHEN
    TestCustomResourceProvider.getOrCreateProvider(stack, "TestCrProvider");

    // THEN
    expect(determineLatestNodeRuntimeName(stack)).toEqual(expected);
    new Template(stack)
      .expectResources(lambdaFunction.LambdaFunction)
      .toEqual([expect.objectContaining({ runtime: expected })]);
  });
});

/**
 * A class used to simulate and test a code generated custom resource provider.
 */
class TestCustomResourceProvider extends CustomResourceProviderBase {
  public static getOrCreateProvider(
    scope: Construct,
    uniqueid: string,
    props?: CustomResourceProviderOptions,
  ) {
    const id = `${uniqueid}CustomResourceProvider`;
    const stack = AwsStack.ofAwsConstruct(scope);
    const provider =
      (stack.node.tryFindChild(id) as TestCustomResourceProvider) ??
      new TestCustomResourceProvider(stack, id, props);
    return provider;
  }

  private constructor(
    scope: Construct,
    id: string,
    props?: CustomResourceProviderOptions,
  ) {
    super(scope, id, {
      ...props,
      runtimeName: determineLatestNodeRuntimeName(scope),
      codeDirectory: TEST_HANDLER,
    });
  }
}
