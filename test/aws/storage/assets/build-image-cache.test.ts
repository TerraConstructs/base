// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-ecr-assets/test/build-image-cache.test.ts

// import * as fs from "fs";
import * as path from "path";
import { ecrRepository } from "@cdktf/provider-aws";
import { image as dockerImage } from "@cdktf/provider-docker";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import { DockerImageAsset } from "../../../../src/aws/storage/assets/image-asset";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const TEST_OUTDIR = path.join(__dirname, "cdk.out");
const demoImagePath = path.join(__dirname, "demo-image");

describe("build cache", () => {
  let stack: AwsStack;
  beforeEach(() => {
    const app = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR,
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, "fixtures/app/cdktf.json"),
        },
      }),
    );
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });
  test("manifest contains cache from options ", () => {
    // WHEN
    new DockerImageAsset(stack, "DockerImage6", {
      directory: demoImagePath,
      cacheFrom: [{ type: "registry", params: { image: "foo" } }],
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResource(ecrRepository.EcrRepository);
    // expect(Object.keys(manifest.dockerImages ?? {}).length).toBe(1);
    template.expect.toHaveResourceWithProperties(dockerImage.Image, {
      build: expect.objectContaining({
        // expect(
        //   manifest.dockerImages?.[asset.assetHash]?.source.cacheFrom?.length,
        // ).toBe(1);
        // expect(
        //   manifest.dockerImages?.[asset.assetHash]?.source.cacheFrom?.[0],
        // ).toStrictEqual({
        //   type: "registry",
        //   params: { image: "foo" },
        // });
        cache_from: ["type=registry,image=foo"],
      }),
    });
  });

  // TODO: cache_to is not supported by cdktf provider-docker
  // https://github.com/kreuzwerker/terraform-provider-docker/blob/v3.6.2/internal/provider/docker_buildx_build.go#L187-L191
  // exists in buildOptions but not in provider schema
  // https://github.com/kreuzwerker/terraform-provider-docker/blob/v3.6.2/internal/provider/resource_docker_registry_image_funcs.go#L199-L230
  test.skip("manifest contains cache to options ", () => {
    // WHEN
    new DockerImageAsset(stack, "DockerImage6", {
      directory: demoImagePath,
      cacheTo: { type: "inline" },
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(dockerImage.Image, {
      build: expect.objectContaining({
        // expect(
        //   manifest.dockerImages?.[asset.assetHash]?.source.cacheTo,
        // ).toStrictEqual({
        //   type: "inline",
        // });
        cache_to: ["type=inline"],
      }),
    });
  });

  test("manifest contains cache disabled", () => {
    // WHEN
    new DockerImageAsset(stack, "DockerImage6", {
      directory: demoImagePath,
      cacheDisabled: true,
    });

    // THEN

    const template = new Template(stack);
    // expect(Object.keys(manifest.dockerImages ?? {}).length).toBe(1);
    template.expect.toHaveResourceWithProperties(dockerImage.Image, {
      build: expect.objectContaining({
        // expect(
        //   manifest.dockerImages?.[asset.assetHash]?.source.cacheDisabled,
        // ).toBeTruthy();
        no_cache: true,
      }),
    });
  });

  test("manifest does not contain options when not specified", () => {
    // WHEN
    new DockerImageAsset(stack, "DockerImage6", {
      directory: demoImagePath,
    });

    // THEN
    const template = new Template(stack);
    // expect(Object.keys(manifest.dockerImages ?? {}).length).toBe(1);
    template.expect.toHaveResourceWithProperties(dockerImage.Image, {
      build: {
        builder: "default",
        context:
          "assets/DockerAsset/0a3355be12051c9984bf2b0b2bba4e6ea535968e5b6e7396449701732fe5ed14",
      },
      triggers: {
        dir_sha1:
          "0a3355be12051c9984bf2b0b2bba4e6ea535968e5b6e7396449701732fe5ed14",
      },
    });
    // expect(
    //   manifest.dockerImages?.[asset.assetHash]?.source.cacheFrom,
    // ).toBeUndefined();
    template.expect.not.toHaveResourceWithProperties(dockerImage.Image, {
      build: expect.objectContaining({
        cache_from: expect.anything(),
      }),
    });
    // expect(
    //   manifest.dockerImages?.[asset.assetHash]?.source.cacheTo,
    // ).toBeUndefined();
    template.expect.not.toHaveResourceWithProperties(dockerImage.Image, {
      build: expect.objectContaining({
        cache_to: expect.anything(),
      }),
    });
  });
});
