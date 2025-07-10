import * as path from "path";
import { apiGatewayRestApi, s3Bucket } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
// import * as storage from "../../../src/aws/storage";
import {
  ApiDefinition,
  SpecRestApi,
  ApiDefinitionConfig,
} from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

function defineRestApi(
  stack: AwsStack,
  definition: ApiDefinition,
): SpecRestApi {
  return new SpecRestApi(stack, "API", {
    apiDefinition: definition,
  });
}

describe("api definition", () => {
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

  describe("ApiDefinition.fromInline", () => {
    test("happy case", () => {
      const definition = {
        key1: "val1",
      };
      const apiDef = ApiDefinition.fromInline(definition);
      const config: ApiDefinitionConfig = apiDef.bind(stack);
      expect(config.inlineDefinition).toEqual(definition);
      // expect(config.s3Location).toBeUndefined();
    });

    test("fails if Json definition is empty", () => {
      // This test assumes that SpecRestApi or ApiDefinition.bind will throw the error
      // when an empty inline definition is processed.
      expect(() => defineRestApi(stack, ApiDefinition.fromInline({}))).toThrow(
        /cannot be empty/,
      );
    });

    test("fails if definition is not an object", () => {
      // This test assumes that SpecRestApi or ApiDefinition.bind will throw the error.
      expect(() =>
        defineRestApi(stack, ApiDefinition.fromInline("not-json" as any)),
      ).toThrow(/should be of type object/);
    });
  });

  describe("ApiDefinition.fromAsset", () => {
    test("happy case", () => {
      const apiDef = ApiDefinition.fromAsset(
        path.join(__dirname, "fixtures", "sample-restapi-definition.yaml"),
      );
      const config = apiDef.bind(stack);
      defineRestApi(stack, apiDef); // Instantiate the RestApi to synthesize the asset

      expect(config.inlineDefinition).toBeDefined();
      // expect(config.s3Location).toBeDefined();

      const template = new Template(stack);
      // Assuming SpecRestApi sets the body to an S3 URI if s3Location is provided.
      // The exact format `s3://...` depends on how SpecRestApi implements this.
      template.expect.toHaveResourceWithProperties(
        apiGatewayRestApi.ApiGatewayRestApi,
        {
          body: '${file("assets/APIDefinition/696823B294E9370C32D2718139EAD358/sample-restapi-definition.yaml")}',
        },
      );
      // Verify that inlineDefinition references the CDKTF Asset
      expect(stack.resolve(config.inlineDefinition)).toMatch(
        /\${file\("assets\/APIDefinition\/.*sample-restapi-definition\.yaml"\)}/,
      );
    });

    test("fails if a directory is given for an asset", () => {
      const fileAsset = ApiDefinition.fromAsset(
        path.join(__dirname, "fixtures"),
      );
      // The error is likely thrown when the asset is processed by SpecRestApi or during bind
      expect(() => defineRestApi(stack, fileAsset)).toThrow(
        /Asset cannot be a \.zip file or a directory/,
      );
    });

    test("only one Asset object gets created even if multiple functions use the same AssetApiDefinition", () => {
      const sharedAssetDefinition = ApiDefinition.fromAsset(
        path.join(__dirname, "fixtures", "sample-restapi-definition.yaml"),
      );

      const api1 = new SpecRestApi(stack, "API1", {
        apiDefinition: sharedAssetDefinition,
      });

      const api2 = new SpecRestApi(stack, "API2", {
        apiDefinition: sharedAssetDefinition,
      });

      // Bind to get the config. The scope of bind might influence asset instantiation if not handled carefully.
      // Ideally, the AssetApiDefinition itself ensures a single asset is created.
      const config1 = sharedAssetDefinition.bind(api1); // or stack
      const config2 = sharedAssetDefinition.bind(api2); // or stack

      const resolvedAssetLocation1 = stack.resolve(config1.inlineDefinition);
      const resolvedAssetLocation2 = stack.resolve(config2.inlineDefinition);

      // If the asset is truly shared and AssetApiDefinition handles this correctly,
      // these resolved S3 paths should point to the same underlying S3 object (same tokens).
      expect(resolvedAssetLocation1).toEqual(resolvedAssetLocation2);

      const template = new Template(stack);
      // Check that both APIs use this S3 location for their body
      template.expect.toHaveResourceWithProperties(
        apiGatewayRestApi.ApiGatewayRestApi,
        {
          // Name will be auto-generated, check for the body
          body: resolvedAssetLocation1,
        },
      );
    });

    test("asset usage in RestApi body - check body from asset", () => {
      // This test replaces the CDK's CFN Metadata check with a check on how the asset is used.
      const assetApiDefinition = ApiDefinition.fromAsset(
        path.join(__dirname, "fixtures", "sample-restapi-definition.yaml"),
      );
      const api = new SpecRestApi(stack, "API", {
        apiDefinition: assetApiDefinition,
      });

      const config = assetApiDefinition.bind(api); // Bind to the API scope
      const expectedBody = stack.resolve(config.inlineDefinition);

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        apiGatewayRestApi.ApiGatewayRestApi,
        {
          body: expectedBody,
        },
      );
      // Note: The original CDK test for `Metadata: { 'aws:asset:path': ..., 'aws:asset:property': ... }`
      // is specific to CDK's CloudFormation asset metadata for SAM CLI and other tools.
      // Terraform's `aws_api_gateway_rest_api` resource does not have a direct equivalent `Metadata` field.
      // If `bindAfterCreate` in `AssetApiDefinition` were to add tags, we would check for those.
      // Since `bindAfterCreate` is empty in the provided declaration, we focus on the `body` being set from the asset.
    });
  });

  // Not supported by Terraform Provider
  // describe("ApiDefinition.fromBucket", () => {
  //   test("happy case", () => {
  //     const bucket = new storage.Bucket(stack, "my-bucket");
  //     const apiDef = ApiDefinition.fromBucket(bucket, "my-key", "my-version");
  //     const config = apiDef.bind(stack);

  //     expect(config.inlineDefinition).toBeUndefined();
  //     expect(config.s3Location).toBeDefined();
  //     expect(stack.resolve(config.s3Location!.bucket)).toEqual(
  //       stack.resolve(bucket.bucketName),
  //     );
  //     expect(config.s3Location!.key).toEqual("my-key");
  //     expect(config.s3Location!.version).toEqual("my-version");

  //     defineRestApi(stack, apiDef);
  //     const template = new Template(stack);
  //     // The aws_api_gateway_rest_api provider's `body` argument expects the OpenAPI spec string.
  //     // If it supports S3 URIs directly, this would be `s3://...`.
  //     // Otherwise, SpecRestApi would need to fetch the content or use a data source.
  //     // Assuming it sets body to S3 URI for now, and versioning is handled by S3 itself or the way SpecRestApi uses the version.
  //     template.expect.toHaveResourceWithProperties(
  //       apiGatewayRestApi.ApiGatewayRestApi,
  //       {
  //         body: `s3://${stack.resolve(bucket.bucketName)}/my-key`,
  //         // Note: Terraform provider for aws_api_gateway_rest_api might not directly support version in s3 URI for body.
  //         // The `objectVersion` from `fromBucket` would be used by the underlying S3 client when fetching the object if needed.
  //       },
  //     );
  //   });
  // });
});
