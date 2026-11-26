// https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/aws-lambda/test/nodejs-latest-runtime.test.ts
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { compute, AwsStack } from "../../../src/aws";
import { Template } from "../../assertions";

const gridBackendConfig = {
  address: "http://localhost:3000",
};

function newStack(id: string, region?: string): AwsStack {
  const app = Testing.stubVersion(new App({ stackTraces: false }));
  return new AwsStack(app, id, {
    gridBackendConfig,
    providerConfig: region ? { region } : undefined,
  });
}

describe("NODEJS_LATEST runtime resolution", () => {
  test("uses determineLatestNodeRuntime when runtime is NODEJS_LATEST", () => {
    // GIVEN
    const stack = newStack("TestStack", "us-east-1");

    // WHEN
    const fn = new compute.LambdaFunction(stack, "MyFunction", {
      runtime: compute.Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: compute.Code.fromInline("exports.handler = function() {}"),
    });

    // THEN
    // With a specific region, runtime resolves to concrete value
    expect(fn.runtime.name).toBe("nodejs24.x");
    expect(fn.runtime.family).toBe(compute.RuntimeFamily.NODEJS);
  });

  test("uses provided runtime when not NODEJS_LATEST", () => {
    // GIVEN
    const stack = newStack("TestStack", "us-east-1");

    // WHEN
    const fn = new compute.LambdaFunction(stack, "MyFunction", {
      runtime: compute.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: compute.Code.fromInline("exports.handler = function() {}"),
    });

    // THEN
    expect(fn.runtime).toBe(compute.Runtime.NODEJS_20_X);
    expect(fn.runtime.name).toBe("nodejs20.x");
  });

  test("runtime property returns determined runtime for NODEJS_LATEST", () => {
    // GIVEN
    const stack = newStack("TestStack", "us-east-1");

    // WHEN
    const fn = new compute.LambdaFunction(stack, "MyFunction", {
      runtime: compute.Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: compute.Code.fromInline("exports.handler = function() {}"),
    });

    // THEN
    expect(fn.runtime.name).toBe("nodejs24.x");
    expect(fn.runtime.family).toBe(compute.RuntimeFamily.NODEJS);
  });

  test("runtime property returns original runtime for non-NODEJS_LATEST", () => {
    // GIVEN
    const stack = newStack("TestStack", "us-east-1");

    // WHEN
    const fn = new compute.LambdaFunction(stack, "MyFunction", {
      runtime: compute.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: compute.Code.fromInline("exports.handler = function() {}"),
    });

    // THEN
    expect(fn.runtime).toBe(compute.Runtime.NODEJS_20_X);
    expect(fn.runtime.name).toBe("nodejs20.x");
  });

  test("NODEJS_LATEST resolution works in different regions", () => {
    // GIVEN
    const usEast1Stack = newStack("USEast1Stack", "us-east-1");
    const euWest1Stack = newStack("EUWest1Stack", "eu-west-1");

    // WHEN
    const usFunction = new compute.LambdaFunction(usEast1Stack, "MyFunction", {
      runtime: compute.Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: compute.Code.fromInline("exports.handler = function() {}"),
    });

    const euFunction = new compute.LambdaFunction(euWest1Stack, "MyFunction", {
      runtime: compute.Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: compute.Code.fromInline("exports.handler = function() {}"),
    });

    // THEN
    // Both should resolve to the same concrete runtime
    expect(usFunction.runtime.name).toBe("nodejs24.x");
    expect(euFunction.runtime.name).toBe("nodejs24.x");
    expect(usFunction.runtime.family).toBe(compute.RuntimeFamily.NODEJS);
    expect(euFunction.runtime.family).toBe(compute.RuntimeFamily.NODEJS);
  });

  test("NODEJS_LATEST uses correct version in environment-agnostic stack", () => {
    // GIVEN
    const stack = newStack("TestStack"); // No region specified

    // WHEN
    new compute.LambdaFunction(stack, "MyFunction", {
      runtime: compute.Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: compute.Code.fromInline("exports.handler = function() {}"),
    });

    // THEN
    // Verify the Terraform config uses a literal runtime version (nodejs24.x),
    // not a deploy-time region lookup map
    Template.synth(stack).toHaveResourceWithProperties(
      { tfResourceType: "aws_lambda_function" },
      { runtime: "nodejs24.x" },
    );
    // no deploy-time region lookup map (TerraformLocal) should be generated
    Template.fromStack(stack).not.toHaveProperty("locals");
  });
});
