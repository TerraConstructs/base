import * as path from "path";
import {
  image as dockerImage,
  registryImage as dockerRegistryImage,
} from "@cdktn/provider-docker";
import { App, TerraformOutput, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { DockerBuildSecret } from "../../../../src/";
import { DockerAssetBuilder } from "../../../../src/aws/aws-asset-manager";
import { AwsStack } from "../../../../src/aws/aws-stack";
import {
  DockerImageAsset,
  NetworkMode,
  Platform,
} from "../../../../src/aws/storage/assets/image-asset";
import { Template } from "../../../assertions";

const TEST_OUTDIR = path.join(__dirname, "cdk.out");
const CDKTFJSON_PATH = path.join(__dirname, "fixtures", "app", "cdktf.json");
const REPO = "data.aws_ecr_repository.ExistingAssetRepository";

describe("image asset with DockerAssetBuilder.BUILDKIT", () => {
  let stack: AwsStack;
  beforeEach(() => {
    const app = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR,
        stackTraces: false,
        context: { cdktfJsonPath: CDKTFJSON_PATH },
      }),
    );
    stack = new AwsStack(app, "MyStack", {
      providerConfig: { region: "us-east-1" },
      assetOptions: {
        repositoryName: "existing-repo",
        dockerBuilder: DockerAssetBuilder.BUILDKIT,
      },
    });
  });

  test("synthesizes buildkit_image + pinned provider, no docker resources", () => {
    const image = new DockerImageAsset(stack, "Image", {
      directory: path.join(__dirname, "demo-image-custom-docker-file"),
      file: "Dockerfile.Custom",
      platform: Platform.LINUX_ARM64,
      buildArgs: { A: "b" },
      buildSecrets: { TOKEN: DockerBuildSecret.fromSrc("/run/token") },
      target: "final",
      cacheFrom: [{ type: "registry", params: { ref: "repo/cache" } }],
    });
    new TerraformOutput(stack, "ImageUri", { value: image.imageUri });

    const template = new Template(stack);
    template.resourceCountIs(dockerImage.Image, 0);
    template.resourceCountIs(dockerRegistryImage.RegistryImage, 0);
    template.toMatchObject({
      terraform: {
        required_providers: {
          buildkit: { source: "cruxstack/buildkit", version: "0.0.1" },
        },
      },
      provider: {
        buildkit: [
          {
            buildkit_address: "unix:///run/buildkit/buildkitd.sock",
            buildkit_autodiscover: false,
            embedded_buildkitd: false,
          },
        ],
      },
      resource: {
        buildkit_image: {
          DockerAsset_Buildkit: {
            provider: "buildkit",
            context: `assets/DockerAsset/${image.assetHash}`,
            dockerfile: "Dockerfile.Custom",
            platforms: ["linux/arm64"],
            args: { A: "b" },
            secrets: { TOKEN: '${file("/run/token")}' },
            target: "final",
            publish: [
              {
                registry: `\${element(split("/", ${REPO}.repository_url), 0)}`,
                repository: `\${${REPO}.name}`,
                tags: [image.assetHash],
              },
            ],
            cache_from: [{ type: "registry", attrs: { ref: "repo/cache" } }],
            triggers: { source_hash: image.assetHash },
          },
        },
      },
    });
    expect(template.outputByName("ImageUri")).toEqual({
      value: "${buildkit_image.DockerAsset_Buildkit.published.0.tag_url}",
    });
  });

  test("requires an explicit platform", () => {
    expect(() => {
      new DockerImageAsset(stack, "Image", {
        directory: path.join(__dirname, "demo-image"),
      });
    }).toThrow(/requires an explicit platform/);
  });

  test("rejects options buildkit_image cannot express", () => {
    expect(() => {
      new DockerImageAsset(stack, "Image", {
        directory: path.join(__dirname, "demo-image"),
        platform: Platform.LINUX_ARM64,
        networkMode: NetworkMode.HOST,
      });
    }).toThrow(/does not support buildSsh, outputs or networkMode/);
  });
});
