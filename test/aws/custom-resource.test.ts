// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/core/test/custom-resource.test.ts
import { s3Bucket } from "@cdktn/provider-aws";
import { customResource } from "@cdktn/provider-cfncompat";
import { App, TerraformVariable, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Duration } from "../../src/";
import { AwsStack } from "../../src/aws/aws-stack";
import { CustomResource } from "../../src/aws/custom-resource";
import { Annotations, Template } from "../assertions";

describe("custom resource", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack");
  });

  test("simple case provider identified by service token", () => {
    // WHEN
    new CustomResource(stack, "MyCustomResource", {
      serviceToken: "MyServiceToken",
      properties: {
        Prop1: "boo",
        Prop2: "bar",
      },
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        service_token: "MyServiceToken",
        resource_type: "AWS::CloudFormation::CustomResource",
        resource_properties: {
          Prop1: "boo",
          Prop2: "bar",
        },
      }),
    ]);
  });

  test("resource type can be specified", () => {
    // WHEN
    new CustomResource(stack, "MyCustomResource", {
      serviceToken: "MyServiceToken",
      resourceType: "Custom::MyResourceType",
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        service_token: "MyServiceToken",
        resource_type: "Custom::MyResourceType",
      }),
    ]);
  });

  test('resource type must begin with "Custom::"', () => {
    expect(
      () =>
        new CustomResource(stack, "MyCustomResource", {
          resourceType: "MyResourceType",
          serviceToken: "FooBar",
        }),
    ).toThrow(/Custom resource type must begin with "Custom::"/);
  });

  test("Custom resource type length must be less than 60 characters", () => {
    expect(
      () =>
        new CustomResource(stack, "MyCustomResource", {
          resourceType:
            "Custom::Adding_An_Additional_Fifty_Three_Characters_For_Error",
          serviceToken: "FooBar",
        }),
    ).toThrow(/Custom resource type length > 60/);
  });

  test("properties can be pascal-cased", () => {
    // WHEN
    new CustomResource(stack, "MyCustomResource", {
      serviceToken: "MyServiceToken",
      pascalCaseProperties: true,
      properties: {
        prop1: "boo",
        boom: {
          onlyFirstLevel: 1234,
        },
      },
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        resource_properties: {
          Prop1: "boo",
          Boom: {
            onlyFirstLevel: 1234,
          },
        },
      }),
    ]);
  });

  test("pascal-casing of props is disabled by default", () => {
    // WHEN
    new CustomResource(stack, "MyCustomResource", {
      serviceToken: "MyServiceToken",
      properties: {
        prop1: "boo",
        boom: {
          onlyFirstLevel: 1234,
        },
      },
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        resource_properties: {
          prop1: "boo",
          boom: {
            onlyFirstLevel: 1234,
          },
        },
      }),
    ]);
  });

  test("set serviceTimeout", () => {
    // WHEN
    new CustomResource(stack, "MyCustomResource", {
      serviceToken: "MyServiceToken",
      serviceTimeout: Duration.seconds(60),
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        service_token: "MyServiceToken",
        service_timeout: 60,
      }),
    ]);
  });

  test("set serviceTimeout with token as seconds", () => {
    // GIVEN
    const durToken = new TerraformVariable(stack, "MyParameter", {
      type: "Number",
      default: 60,
    });

    // WHEN
    new CustomResource(stack, "MyCustomResource", {
      serviceToken: "MyServiceToken",
      serviceTimeout: Duration.seconds(durToken.numberValue),
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        service_token: "MyServiceToken",
        service_timeout: stack.resolve(durToken.numberValue),
      }),
    ]);
  });

  test("throws error when serviceTimeout is set with token as units other than seconds", () => {
    // GIVEN
    const durToken = new TerraformVariable(stack, "MyParameter", {
      type: "Number",
      default: 60,
    });

    // WHEN
    expect(() => {
      new CustomResource(stack, "MyCustomResource", {
        serviceToken: "MyServiceToken",
        serviceTimeout: Duration.minutes(durToken.numberValue),
      });
    }).toThrow(
      "Duration must be specified as 'Duration.seconds()' here since its value comes from a token and cannot be converted (got Duration.minutes)",
    );
  });

  test.each([0, 4000])(
    "throw an error when serviceTimeout is set to %d seconds.",
    (invalidSeconds: number) => {
      expect(() => {
        new CustomResource(stack, "MyCustomResource", {
          serviceToken: "MyServiceToken",
          serviceTimeout: Duration.seconds(invalidSeconds),
        });
      }).toThrow(
        `serviceTimeout must either be between 1 and 3600 seconds, got ${invalidSeconds}`,
      );
    },
  );

  test("send warning if customResource construct property key is added to properties", () => {
    // WHEN
    new CustomResource(stack, "MyCustomResource", {
      serviceToken: "MyServiceToken",
      properties: {
        // this is repeated because serviceToken prop above will resolve as property ServiceToken
        ServiceToken: "RepeatedToken",
      },
    });

    // THEN
    Annotations.fromStack(stack).hasWarnings({
      constructPath: "TestStack/MyCustomResource",
      message:
        "The following keys will be overwritten as they exist in the 'properties' prop. Keys found: ServiceToken",
    });
  });

  // tcons-only addition
  test("stackId is the stack gridUUID", () => {
    // WHEN
    new CustomResource(stack, "MyCustomResource", {
      serviceToken: "MyServiceToken",
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        stack_id: stack.gridUUID,
      }),
    ]);
  });

  // tcons-only addition
  test("response bucket is created once per stack and skipped when the provider configures one", () => {
    // WHEN two custom resources share the stack's response bucket
    new CustomResource(stack, "First", { serviceToken: "MyServiceToken" });
    new CustomResource(stack, "Second", { serviceToken: "MyServiceToken" });

    // THEN only one bucket is synthesized, and both resources point at it
    const template = new Template(stack);
    const bucketName = stack.resolve(
      stack.customResourceResponseBucket!.bucketName,
    );
    template.resourceCountIs(s3Bucket.S3Bucket, 1);
    template
      .expectResources(customResource.CustomResource)
      .toEqual([
        expect.objectContaining({ response_bucket: bucketName }),
        expect.objectContaining({ response_bucket: bucketName }),
      ]);

    // AND WHEN the provider is configured with its own bucket
    const app2 = Testing.app();
    const stack2 = new AwsStack(app2, "TestStack2", {
      cfncompatProviderConfig: { customResourceBucket: "provider-bucket" },
    });
    new CustomResource(stack2, "MyCustomResource", {
      serviceToken: "MyServiceToken",
    });

    // THEN no per-stack response bucket is created, and response_bucket is unset
    expect(stack2.customResourceResponseBucket).toBeUndefined();
    const template2 = new Template(stack2);
    template2.resourceCountIs(s3Bucket.S3Bucket, 0);
    template2
      .expectResources(customResource.CustomResource)
      .toEqual([
        expect.not.objectContaining({ response_bucket: expect.anything() }),
      ]);
  });
});
