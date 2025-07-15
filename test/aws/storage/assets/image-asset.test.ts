// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-ecr-assets/test/image-asset.test.ts

import * as fs from "fs";
import * as path from "path";
import { dataAwsEcrRepository, ecrRepository } from "@cdktf/provider-aws";
import {
  image as dockerImage,
  registryImage as dockerRegistryImage,
} from "@cdktf/provider-docker";
import { App, Testing, Lazy } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { DockerBuildSecret, IgnoreMode } from "../../../../src/";
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
const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const CDKTFJSON_PATH = path.join(TEST_APPDIR, "cdktf.json");

// this is hardcoded in the AssetStaging class:
const TEST_STAGINGDIR = path.join(TEST_APPDIR, "tcons-staging");
// const DEMO_IMAGE_ASSET_HASH =
//   "0a3355be12051c9984bf2b0b2bba4e6ea535968e5b6e7396449701732fe5ed14";

describe("image asset", () => {
  let app: App;
  let stack: AwsStack;
  beforeEach(() => {
    app = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR,
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, CDKTFJSON_PATH),
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
  test("fails if the directory does not exist", () => {
    // THEN
    expect(() => {
      new DockerImageAsset(stack, "MyAsset", {
        directory: `/does/not/exist/${Math.floor(Math.random() * 9999)}`,
      });
    }).toThrow(/Cannot find image directory at/);
  });

  test("fails if the directory does not contain a Dockerfile", () => {
    // THEN
    expect(() => {
      new DockerImageAsset(stack, "Asset", {
        directory: __dirname,
      });
    }).toThrow(/Cannot find file at/);
  });

  test("fails if the file does not exist", () => {
    // THEN
    expect(() => {
      new DockerImageAsset(stack, "Asset", {
        directory: __dirname,
        file: "doesnt-exist",
      });
    }).toThrow(/Cannot find file at/);
  });

  test("docker directory is staged if asset staging is enabled", () => {
    const image = new DockerImageAsset(stack, "MyAsset", {
      directory: path.join(__dirname, "demo-image"),
    });

    const template = new Template(stack);

    // ensure files are staged
    expect(
      fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "Dockerfile"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "index.py"),
      ),
    ).toBe(true);
    // TODO: ensure docker provider ECR Auth config
    // ensure asset repo is created on demand
    template.expect.toHaveResource(ecrRepository.EcrRepository);
    // ensure image is created referencing the staged directory
    template.expect.toHaveResourceWithProperties(dockerImage.Image, {
      name: `\${aws_ecr_repository.AssetRepository.repository_url}:${image.assetHash}`,
      build: {
        builder: "default", // enable buildx by default
        // context contains reference to staged directory
        context: expect.stringContaining(image.assetHash),
      },
      // trigger re-builds on changes to sourceHash
      triggers: {
        dir_sha1: image.assetHash,
      },
    });
    // ensure image is pushed to the ECR repository
    template.expect.toHaveResourceWithProperties(
      dockerRegistryImage.RegistryImage,
      {
        name: "${docker_image.DockerAsset_Image.name}",
      },
    );
  });

  // // Deprecated
  // describe("docker ignore option", () => {
  //   // The 'ignoreMode' property is both deprecated and not deprecated in DockerImageAssetProps interface.
  //   // The interface through a complex set of inheritance chain has a 'ignoreMode' prop that is deprecated
  //   // and another 'ignoreMode' prop that is not deprecated.
  //   // Using a 'describeDeprecated' block here since there's no way to work around this craziness.
  //   // When the deprecated property is removed source code, this block can be dropped.

  //   test("docker directory is staged without files specified in .dockerignore", () => {
  //     const app = new App();
  //     testDockerDirectoryIsStagedWithoutFilesSpecifiedInDockerignore(app);
  //   });

  //   test("docker directory is staged without files specified in .dockerignore with IgnoreMode.GLOB", () => {
  //     const app = new App();
  //     testDockerDirectoryIsStagedWithoutFilesSpecifiedInDockerignore(
  //       app,
  //       IgnoreMode.GLOB,
  //     );
  //   });
  // });

  test("docker directory is staged with allow-listed files specified in .dockerignore", () => {
    const image = new DockerImageAsset(stack, "MyAsset", {
      directory: path.join(__dirname, "allow-listed-image"),
    });

    Template.synth(stack).toBeDefined();

    // Only the files exempted above should be included.
    expect(
      fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, ".dockerignore"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "Dockerfile"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "index.py"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "foobar.txt"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "subdirectory"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          TEST_STAGINGDIR,
          `asset.${image.assetHash}`,
          "subdirectory",
          "baz.txt",
        ),
      ),
    ).toBe(true);
    expect(
      !fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "node_modules"),
      ),
    ).toBe(true);
    expect(
      !fs.existsSync(
        path.join(
          TEST_STAGINGDIR,
          `asset.${image.assetHash}`,
          "node_modules",
          "one",
        ),
      ),
    ).toBe(true);
    expect(
      !fs.existsSync(
        path.join(
          TEST_STAGINGDIR,
          `asset.${image.assetHash}`,
          "node_modules",
          "some_dep",
        ),
      ),
    ).toBe(true);
    expect(
      !fs.existsSync(
        path.join(
          TEST_STAGINGDIR,
          `asset.${image.assetHash}`,
          "node_modules",
          "some_dep",
          "file",
        ),
      ),
    ).toBe(true);
  });

  test("docker directory is staged without files specified in exclude option", () => {
    testDockerDirectoryIsStagedWithoutFilesSpecifiedInExcludeOption(app);
  });

  test("docker directory is staged without files specified in exclude option with IgnoreMode.GLOB", () => {
    testDockerDirectoryIsStagedWithoutFilesSpecifiedInExcludeOption(
      app,
      IgnoreMode.GLOB,
    );
  });

  test("fails if using tokens in build args keys or values", () => {
    // GIVEN
    const token = Lazy.stringValue({ produce: () => "foo" });
    const expected =
      /Cannot use tokens in keys or values of "buildArgs" since they are needed before deployment/;

    // THEN
    expect(
      () =>
        new DockerImageAsset(stack, "MyAsset1", {
          directory: path.join(__dirname, "demo-image"),
          buildArgs: { [token]: "value" },
        }),
    ).toThrow(expected);

    expect(
      () =>
        new DockerImageAsset(stack, "MyAsset2", {
          directory: path.join(__dirname, "demo-image"),
          buildArgs: { key: token },
        }),
    ).toThrow(expected);
  });

  // testDeprecated("fails if using token as repositoryName", () => {
  //   // GIVEN
  //   const token = Lazy.stringValue({ produce: () => "foo" });

  //   // THEN
  //   expect(
  //     () =>
  //       new DockerImageAsset(stack, "MyAsset1", {
  //         directory: path.join(__dirname, "demo-image"),
  //         repositoryName: token,
  //       }),
  //   ).toThrow(/Cannot use Token as value of 'repositoryName'/);
  // });

  test("docker build options are included in the asset id", () => {
    // GIVEN
    const directory = path.join(__dirname, "demo-image-custom-docker-file");

    const asset1 = new DockerImageAsset(stack, "Asset1", { directory });
    const asset2 = new DockerImageAsset(stack, "Asset2", {
      directory,
      file: "Dockerfile.Custom",
    });
    const asset3 = new DockerImageAsset(stack, "Asset3", {
      directory,
      target: "NonDefaultTarget",
    });
    const asset4 = new DockerImageAsset(stack, "Asset4", {
      directory,
      buildArgs: { opt1: "123", opt2: "boom" },
    });
    const asset5 = new DockerImageAsset(stack, "Asset5", {
      directory,
      file: "Dockerfile.Custom",
      target: "NonDefaultTarget",
    });
    const asset6 = new DockerImageAsset(stack, "Asset6", {
      directory,
      extraHash: "random-extra",
    });
    const asset7 = new DockerImageAsset(stack, "Asset7", {
      directory,
      outputs: ["123"],
    });
    const asset8 = new DockerImageAsset(stack, "Asset8", {
      directory,
      buildSecrets: { mySecret: DockerBuildSecret.fromSrc("abc.txt") },
    });
    const asset9 = new DockerImageAsset(stack, "Asset9", {
      directory,
      buildSsh: "default",
    });

    expect(asset1.assetHash).toEqual(
      "13248c55633f3b198a628bb2ea4663cb5226f8b2801051bd0c725950266fd590",
    );
    expect(asset2.assetHash).toEqual(
      "36bf205fb9adc5e45ba1c8d534158a0aed96d190eff433af1d90f3b94f96e751",
    );
    expect(asset3.assetHash).toEqual(
      "4c85bd70e73117b7129c2defbe6dc40a8a3872329f4ddca18d75afa671b38276",
    );
    expect(asset4.assetHash).toEqual(
      "8a91219a7bb0f58b3282dd84acbf4c03c49c765be54ffb7b125be6a50b6c5645",
    );
    expect(asset5.assetHash).toEqual(
      "c02bfba13b2e7e1ff5c778a76e10296b9e8d17f7f8252d097f4170ae04ce0eb4",
    );
    expect(asset6.assetHash).toEqual(
      "3528d6838647a5e9011b0f35aec514d03ad11af05a94653cdcf4dacdbb070a06",
    );
    expect(asset7.assetHash).toEqual(
      "ced0a3076efe217f9cbdff0943e543f36ecf77f70b9a6fe28b8633deb728a462",
    );
    expect(asset8.assetHash).toEqual(
      "ffc2718e616141d18c8f4623d13cdfd68cb8f010ca5db31c916c8b5f10c162be",
    );
    expect(asset9.assetHash).toEqual(
      "52617cbf463d1931a93da1357dfe99687f32e092619fc6d280cee8d9ee31b63b",
    );
  });

  // testDeprecated("repositoryName is included in the asset id", () => {
  //   const directory = path.join(__dirname, "demo-image-custom-docker-file");

  //   const asset1 = new DockerImageAsset(stack, "Asset1", { directory });
  //   const asset2 = new DockerImageAsset(stack, "Asset2", {
  //     directory,
  //     repositoryName: "foo",
  //   });

  //   expect(asset1.assetHash).toEqual(
  //     "13248c55633f3b198a628bb2ea4663cb5226f8b2801051bd0c725950266fd590",
  //   );
  //   expect(asset2.assetHash).toEqual(
  //     "b78978ca702a8eccd37804ce31d76cd83a695b557dbf95aeb109332ee8b1fd32",
  //   );
  // });

  //   describe("imageTag is correct for different stack synthesizers", () => {
  //     const stack2 = new AwsStack(app, "TestStack2", {
  //       synthesizer: new DefaultStackSynthesizer({
  //         dockerTagPrefix: "banana",
  //       }),
  //     });

  //     const directory = path.join(__dirname, "demo-image-custom-docker-file");

  //     const asset1 = new DockerImageAsset(stack, "Asset1", { directory });
  //     const asset2 = new DockerImageAsset(stack2, "Asset2", { directory });

  //     test("stack with default synthesizer", () => {
  //       expect(asset1.assetHash).toEqual(
  //         "13248c55633f3b198a628bb2ea4663cb5226f8b2801051bd0c725950266fd590",
  //       );
  //       expect(asset1.imageTag).toEqual(
  //         "13248c55633f3b198a628bb2ea4663cb5226f8b2801051bd0c725950266fd590",
  //       );
  //     });

  //     test("stack with overwritten synthesizer", () => {
  //       expect(asset2.assetHash).toEqual(
  //         "13248c55633f3b198a628bb2ea4663cb5226f8b2801051bd0c725950266fd590",
  //       );
  //       expect(asset2.imageTag).toEqual(
  //         "banana13248c55633f3b198a628bb2ea4663cb5226f8b2801051bd0c725950266fd590",
  //       );
  //     });
  //   });
});

describe("with existing repository", () => {
  let app: App;
  let stack: AwsStack;
  beforeEach(() => {
    app = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR,
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, CDKTFJSON_PATH),
        },
      }),
    );
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      assetOptions: {
        repositoryName: "existing-repo",
        dockerTagPrefix: "existing-",
      },
    });
  });
  test("does not create ECR repository", () => {
    const image = new DockerImageAsset(stack, "MyAsset", {
      directory: path.join(__dirname, "demo-image"),
    });

    const template = new Template(stack);

    // ensure files are staged
    expect(
      fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "Dockerfile"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "index.py"),
      ),
    ).toBe(true);
    // ensure asset repo is not created by the stack
    template.expect.not.toHaveResource(ecrRepository.EcrRepository);
    template.expect.toHaveDataSourceWithProperties(
      dataAwsEcrRepository.DataAwsEcrRepository,
      {
        name: "existing-repo",
      },
    );
    // ensure image is created referencing the staged directory
    template.expect.toHaveResourceWithProperties(dockerImage.Image, {
      name: expect.stringMatching(/\$\{data.aws_ecr_repository.*:existing-/),
      build: expect.objectContaining({
        context: expect.stringContaining(image.assetHash),
      }),
    });
  });
});

// function testDockerDirectoryIsStagedWithoutFilesSpecifiedInDockerignore(
//   app: App,
//   ignoreMode?: IgnoreMode,
// ) {
//   const stack = new AwsStack(app, "TestStack", {
//     environmentName,
//     gridUUID,
//     providerConfig,
//     gridBackendConfig,
//   });
//   const image = new DockerImageAsset(stack, "MyAsset", {
//     ignoreMode,
//     directory: path.join(__dirname, "dockerignore-image"),
//   });

//   app.synth();

//   // .dockerignore itself should be included in output to be processed during docker build
//   expect(
//     fs.existsSync(
//       path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, ".dockerignore"),
//     ),
//   ).toBe(true);
//   expect(
//     fs.existsSync(
//       path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "Dockerfile"),
//     ),
//   ).toBe(true);
//   expect(
//     fs.existsSync(
//       path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "index.py"),
//     ),
//   ).toBe(true);
//   expect(
//     !fs.existsSync(
//       path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "foobar.txt"),
//     ),
//   ).toBe(true);
//   expect(
//     fs.existsSync(
//       path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "subdirectory"),
//     ),
//   ).toBe(true);
//   expect(
//     fs.existsSync(
//       path.join(
//         TEST_STAGINGDIR,
//         `asset.${image.assetHash}`,
//         "subdirectory",
//         "baz.txt",
//       ),
//     ),
//   ).toBe(true);
// }

function testDockerDirectoryIsStagedWithoutFilesSpecifiedInExcludeOption(
  app: App,
  ignoreMode?: IgnoreMode,
) {
  const stack = new AwsStack(app, "TestStack2", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  const image = new DockerImageAsset(stack, "MyAsset", {
    directory: path.join(__dirname, "dockerignore-image"),
    exclude: ["subdirectory"],
    ignoreMode,
  });

  app.synth();

  expect(
    fs.existsSync(
      path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, ".dockerignore"),
    ),
  ).toBe(true);
  expect(
    fs.existsSync(
      path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "Dockerfile"),
    ),
  ).toBe(true);
  expect(
    fs.existsSync(
      path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "index.py"),
    ),
  ).toBe(true);
  expect(
    !fs.existsSync(
      path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "foobar.txt"),
    ),
  ).toBe(true);
  expect(
    !fs.existsSync(
      path.join(TEST_STAGINGDIR, `asset.${image.assetHash}`, "subdirectory"),
    ),
  ).toBe(true);
  expect(
    !fs.existsSync(
      path.join(
        TEST_STAGINGDIR,
        `asset.${image.assetHash}`,
        "subdirectory",
        "baz.txt",
      ),
    ),
  ).toBe(true);
}

// test("nested assemblies share assets: legacy synth edition", () => {
//   // GIVEN
//   const app = new App();
//   const stack1 = new AwsStack(new Stage(app, "Stage1"), "Stack", {
//     synthesizer: new LegacyStackSynthesizer(),
//   });
//   const stack2 = new AwsStack(new Stage(app, "Stage2"), "Stack", {
//     synthesizer: new LegacyStackSynthesizer(),
//   });

//   // WHEN
//   new DockerImageAsset(stack1, "Image", {
//     directory: path.join(__dirname, "demo-image"),
//   });
//   new DockerImageAsset(stack2, "Image", {
//     directory: path.join(__dirname, "demo-image"),
//   });

//   // THEN
//   const assembly = app.synth();

//   // Read the assets from the stack metadata
//   for (const stageName of ["Stage1", "Stage2"]) {
//     const stackArtifact = assembly
//       .getNestedAssembly(`assembly-${stageName}`)
//       .artifacts.filter(isStackArtifact)[0];
//     const assetMeta = stackArtifact.findMetadataByType(
//       cxschema.ArtifactMetadataEntryType.ASSET,
//     );
//     expect(assetMeta[0]).toEqual(
//       expect.objectContaining({
//         data: expect.objectContaining({
//           path: `../asset.${DEMO_IMAGE_ASSET_HASH}`,
//         }),
//       }),
//     );
//   }
// });

// test("nested assemblies share assets: default synth edition", () => {
//   // GIVEN
//   const app = new App();
//   const stack1 = new AwsStack(new Stage(app, "Stage1"), "Stack", {
//     synthesizer: new DefaultStackSynthesizer(),
//   });
//   const stack2 = new AwsStack(new Stage(app, "Stage2"), "Stack", {
//     synthesizer: new DefaultStackSynthesizer(),
//   });

//   // WHEN
//   new DockerImageAsset(stack1, "Image", {
//     directory: path.join(__dirname, "demo-image"),
//   });
//   new DockerImageAsset(stack2, "Image", {
//     directory: path.join(__dirname, "demo-image"),
//   });

//   // THEN
//   const assembly = app.synth();

//   // Read the asset manifests to verify the file paths
//   for (const stageName of ["Stage1", "Stage2"]) {
//     const manifestArtifact = assembly
//       .getNestedAssembly(`assembly-${stageName}`)
//       .artifacts.filter(cxapi.AssetManifestArtifact.isAssetManifestArtifact)[0];
//     const manifest = JSON.parse(
//       fs.readFileSync(manifestArtifact.file, { encoding: "utf-8" }),
//     );

//     expect(manifest.dockerImages[DEMO_IMAGE_ASSET_HASH].source).toEqual({
//       directory: `../asset.${DEMO_IMAGE_ASSET_HASH}`,
//     });
//   }
// });

// function isStackArtifact(x: any): x is cxapi.CloudFormationStackArtifact {
//   return x instanceof cxapi.CloudFormationStackArtifact;
// }
