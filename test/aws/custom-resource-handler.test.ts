// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/core/test/custom-resource-provider/custom-resource-provider.test.ts
import {
  dataAwsIamPolicyDocument,
  iamRole,
  iamRolePolicy,
  lambdaFunction,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Duration } from "../../src/";
import { AwsStack } from "../../src/aws/aws-stack";
import * as compute from "../../src/aws/compute";
import { CustomResourceHandler } from "../../src/aws/custom-resource-handler";
import * as iam from "../../src/aws/iam";
import { Template } from "../assertions";

const UNIQUE_ID = "TestCustomResourceHandler";

describe("custom resource handler", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack");
  });

  test("minimal configuration", () => {
    // WHEN
    CustomResourceHandler.getOrCreate(stack, UNIQUE_ID, {
      code: compute.Code.fromInline("exports.handler = async () => {};"),
      runtime: compute.Runtime.NODEJS_20_X,
    });

    // THEN
    const template = new Template(stack);
    template.resourceCountIs(lambdaFunction.LambdaFunction, 1);
    template.resourceCountIs(iamRole.IamRole, 1);
    template.expectResources(lambdaFunction.LambdaFunction).toEqual([
      expect.objectContaining({
        handler: "index.handler",
        runtime: "nodejs20.x",
        timeout: 300,
      }),
    ]);
  });

  test("addToRolePolicy() can be used to add statements to the inline policy", () => {
    // WHEN
    const handler = CustomResourceHandler.getOrCreate(stack, UNIQUE_ID, {
      code: compute.Code.fromInline("exports.handler = async () => {};"),
      runtime: compute.Runtime.NODEJS_20_X,
    });
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetBucket"],
        resources: ["*"],
      }),
    );

    // THEN
    const template = new Template(stack);
    template.resourceCountIs(iamRolePolicy.IamRolePolicy, 1);
    template
      .expectDataSources(dataAwsIamPolicyDocument.DataAwsIamPolicyDocument)
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            statement: expect.arrayContaining([
              expect.objectContaining({
                actions: ["s3:GetBucket"],
                effect: "Allow",
                resources: ["*"],
              }),
            ]),
          }),
        ]),
      );
  });

  test("timeout and description", () => {
    // WHEN
    CustomResourceHandler.getOrCreate(stack, UNIQUE_ID, {
      code: compute.Code.fromInline("exports.handler = async () => {};"),
      runtime: compute.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(1),
      description: "veni vidi vici",
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(lambdaFunction.LambdaFunction).toEqual([
      expect.objectContaining({
        timeout: 60,
        description: "veni vidi vici",
      }),
    ]);
  });

  test("environment variables", () => {
    // WHEN
    CustomResourceHandler.getOrCreate(stack, UNIQUE_ID, {
      code: compute.Code.fromInline("exports.handler = async () => {};"),
      runtime: compute.Runtime.NODEJS_20_X,
      environment: {
        B: "b",
        A: "a",
      },
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(lambdaFunction.LambdaFunction).toEqual([
      expect.objectContaining({
        environment: {
          variables: expect.objectContaining({
            A: "a",
            B: "b",
          }),
        },
      }),
    ]);
  });

  test("roleArn", () => {
    // GIVEN
    const role = new iam.Role(stack, "MyRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    const handler = CustomResourceHandler.getOrCreate(stack, UNIQUE_ID, {
      code: compute.Code.fromInline("exports.handler = async () => {};"),
      runtime: compute.Runtime.NODEJS_20_X,
      role,
    });

    // THEN
    expect(handler.role).toBe(role);
    const template = new Template(stack);
    // only the explicitly-created role exists - no default role is created
    template.resourceCountIs(iamRole.IamRole, 1);
  });

  // tcons-only addition
  test("getOrCreate returns the same handler for the same unique id", () => {
    // WHEN
    const first = CustomResourceHandler.getOrCreate(stack, UNIQUE_ID, {
      code: compute.Code.fromInline("exports.handler = async () => {};"),
      runtime: compute.Runtime.NODEJS_20_X,
    });
    const second = CustomResourceHandler.getOrCreate(stack, UNIQUE_ID, {
      code: compute.Code.fromInline("exports.handler = async () => {};"),
      runtime: compute.Runtime.NODEJS_20_X,
    });

    // THEN
    expect(second).toBe(first);
    const template = new Template(stack);
    template.resourceCountIs(lambdaFunction.LambdaFunction, 1);
  });
});
