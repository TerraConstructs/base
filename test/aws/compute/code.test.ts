// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-lambda/test/code.test.ts

import * as child_process from "child_process";
import * as path from "path";
import {
  dataAwsIamPolicyDocument,
  ecrRepositoryPolicy,
  lambdaFunction,
  s3Object,
} from "@cdktf/provider-aws";
import { App, Testing, TerraformVariable } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as compute from "../../../src/aws/compute";
import * as storage from "../../../src/aws/storage";
import { DockerImage } from "../../../src/bundling";
import { Template } from "../../assertions";

jest.mock("child_process");

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const CDKTFJSON_PATH = path.join(TEST_APPDIR, "cdktf.json");

describe("code", () => {
  describe("lambda.Code.fromInline", () => {
    test("fails if used with unsupported runtimes", () => {
      expect(() =>
        defineFunction(compute.Code.fromInline("boom"), compute.Runtime.GO_1_X),
      ).toThrow(/Inline source not allowed for go1\.x/);
      expect(() =>
        defineFunction(compute.Code.fromInline("boom"), compute.Runtime.JAVA_8),
      ).toThrow(/Inline source not allowed for java8/);
    });
  });

  describe("lambda.Code.fromCustomCommand", () => {
    let spawnSyncMock: jest.SpyInstance;
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
      stack = new AwsStack(app, "MyStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
      spawnSyncMock = (child_process.spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stderr: Buffer.from("stderr"),
        stdout: Buffer.from("stdout"),
        pid: 123,
        output: ["stdout", "stderr"],
        signal: null,
      });
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("fails if command is empty", () => {
      // GIVEN
      const command = [];

      // THEN
      expect(() => compute.Code.fromCustomCommand("", command)).toThrow(
        'command must contain at least one argument. For example, ["node", "buildFile.js"].',
      );
    });
    test("properly splices arguments", () => {
      // GIVEN
      const command = "node is a great command, wow".split(" ");
      compute.Code.fromCustomCommand("", command);

      // THEN
      expect(spawnSyncMock).toHaveBeenCalledWith("node", [
        "is",
        "a",
        "great",
        "command,",
        "wow",
      ]);
    });
    test("command of length 1 does not cause crash", () => {
      // WHEN
      compute.Code.fromCustomCommand("", ["node"]);

      // THEN
      expect(spawnSyncMock).toHaveBeenCalledWith("node", []);
    });
    test("properly splices arguments when commandOptions are included", () => {
      // GIVEN
      const command = "node is a great command, wow".split(" ");
      const commandOptions = {
        commandOptions: { cwd: "/tmp", env: { SOME_KEY: "SOME_VALUE" } },
      };
      compute.Code.fromCustomCommand("", command, commandOptions);

      // THEN
      expect(spawnSyncMock).toHaveBeenCalledWith(
        "node",
        ["is", "a", "great", "command,", "wow"],
        commandOptions.commandOptions,
      );
    });
    test("throws custom error message when spawnSync errors", () => {
      // GIVEN
      // use the real spawnSync, which doesn't work in unit tests.
      const actualChildProcess =
        jest.requireActual<typeof child_process>("child_process");
      (child_process.spawnSync as jest.Mock).mockImplementation(
        actualChildProcess.spawnSync,
      );
      const command = ["whatever"];

      // THEN
      expect(() => compute.Code.fromCustomCommand("", command)).toThrow(
        /Failed to execute custom command: .*/,
      );
    });
    test("throws custom error message when spawnSync exits with non-zero status code", () => {
      // GIVEN
      const command = ["whatever"];
      spawnSyncMock = jest.spyOn(child_process, "spawnSync").mockReturnValue({
        status: 1,
        stderr: Buffer.from("stderr"),
        stdout: Buffer.from("stdout"),
        pid: 123,
        output: ["stdout", "stderr"],
        signal: null,
      });

      // THEN
      expect(() => compute.Code.fromCustomCommand("", command)).toThrow(
        "whatever exited with status: 1\n\nstdout: stdout\n\nstderr: stderr",
      );
    });
  });

  describe("lambda.Code.fromAsset", () => {
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
      stack = new AwsStack(app, "MyStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
    });

    test("fails if path is empty", () => {
      // GIVEN
      const fileAsset = compute.Code.fromAsset("");

      // THEN
      expect(() => defineFunction(fileAsset)).toThrow(
        /Asset path cannot be empty/,
      );
    });
    test("fails if path does not exist", () => {
      // GIVEN
      const fileAsset = compute.Code.fromAsset(
        "/path/not/found/" + Math.random() * 999999,
      );

      // THEN
      expect(() => defineFunction(fileAsset)).toThrow(/Cannot find asset/);
    });
    test("fails if a non-zip asset is used", () => {
      // GIVEN
      const fileAsset = compute.Code.fromAsset(
        path.join(__dirname, "fixtures", "my-lambda-handler", "index.py"),
      );

      // THEN
      expect(() => defineFunction(fileAsset)).toThrow(
        /Asset must be a \.zip file or a directory/,
      );
    });

    test("only one Asset object gets created even if multiple functions use the same AssetCode", () => {
      // GIVEN
      const directoryAsset = compute.Code.fromAsset(
        path.join(__dirname, "fixtures", "my-lambda-handler"),
      );

      // WHEN
      new compute.LambdaFunction(stack, "Func1", {
        handler: "foom",
        runtime: compute.Runtime.NODEJS_LATEST,
        code: directoryAsset,
      });

      new compute.LambdaFunction(stack, "Func2", {
        handler: "foom",
        runtime: compute.Runtime.NODEJS_LATEST,
        code: directoryAsset,
      });

      // THEN
      // Func1 has an asset, Func2 does not
      const template = new Template(stack);

      // Func1 has an asset, Func2 does not
      template.resourceCountIs(s3Object.S3Object, 1);
      template.expect.toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          s3_bucket: "${aws_s3_bucket.AssetBucket.bucket}",
          // both Functions point to the same FileAsset...
          s3_key: "${aws_s3_object.FileAsset_S3.key}",
        },
      );
    });

    // // TODO: TerraConstructs does not support asset metadata yet
    // test("adds code asset metadata", () => {
    //   // GIVEN
    //   const stack2 = new AwsStack(app, "MyStack", {
    //     environmentName,
    //     gridUUID,
    //     providerConfig,
    //     gridBackendConfig,
    //   });
    //   // stack2.node.setContext(
    //   //   cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT,
    //   //   true,
    //   // );

    //   const location = path.join(__dirname, "fixtures", "my-lambda-handler");

    //   // WHEN
    //   new compute.LambdaFunction(stack2, "Func1", {
    //     code: compute.Code.fromAsset({
    //       path: location,
    //       bucket,
    //     }),
    //     runtime: compute.Runtime.NODEJS_LATEST,
    //     handler: "foom",
    //   });

    //   // THEN
    //   Template.synth(stack2).toHaveResourceWithProperties(
    //     lambdaFunction.LambdaFunction,
    //     {
    //       Metadata: {
    //         [cxapi.ASSET_RESOURCE_METADATA_PATH_KEY]:
    //           "asset.9678c34eca93259d11f2d714177347afd66c50116e1e08996eff893d3ca81232",
    //         [cxapi.ASSET_RESOURCE_METADATA_IS_BUNDLED_KEY]: false,
    //         [cxapi.ASSET_RESOURCE_METADATA_PROPERTY_KEY]: "Code",
    //       },
    //     },
    //   );
    // });

    test("fails if asset is bound with a second stack", () => {
      // GIVEN
      const asset = compute.Code.fromAsset(
        path.join(__dirname, "fixtures", "my-lambda-handler"),
      );

      new compute.LambdaFunction(stack, "Func", {
        code: asset,
        runtime: compute.Runtime.NODEJS_LATEST,
        handler: "foom",
      });

      const stack2 = new AwsStack(app, "Stack2", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
      expect(
        () =>
          new compute.LambdaFunction(stack2, "Func", {
            code: asset,
            runtime: compute.Runtime.NODEJS_LATEST,
            handler: "foom",
          }),
      ).toThrow(/already associated/);
    });
  });

  describe("lambda.Code.fromTerraformVariables", () => {
    let app: App;
    let stack: AwsStack;
    let bucket: storage.IBucket;

    beforeEach(() => {
      app = Testing.app();
      stack = new AwsStack(app, "MyStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
      bucket = storage.Bucket.fromBucketName(stack, "Bucket", "test-bucket");
    });
    test("automatically creates the Bucket and Key parameters when it's used in a Function", () => {
      const code = new compute.TerraformVariablesCode();
      new compute.LambdaFunction(stack, "Function", {
        code,
        runtime: compute.Runtime.NODEJS_LATEST,
        handler: "index.handler",
      });

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          s3_bucket: "${var.Function_LambdaSourceBucketNameParameter_9E9E108F}",
          s3_key: "${var.Function_LambdaSourceObjectKeyParameter_1C7AED11}",
        },
      );

      expect(stack.resolve(code.bucketNameVar)).toEqual(
        "${var.Function_LambdaSourceBucketNameParameter_9E9E108F}",
      );
      expect(stack.resolve(code.objectKeyVar)).toEqual(
        "${var.Function_LambdaSourceObjectKeyParameter_1C7AED11}",
      );
    });

    test("does not allow accessing the Parameter properties before being used in a Function", () => {
      const code = new compute.TerraformVariablesCode();

      expect(() => code.bucketNameVar).toThrow(/bucketNameVar/);

      expect(() => code.objectKeyVar).toThrow(/objectKeyVar/);
    });

    test("allows passing custom Parameters when creating it", () => {
      const bucketNameVar = new TerraformVariable(stack, "bucketNameVar", {
        type: "String",
      });
      const bucketKeyVar = new TerraformVariable(stack, "objectKeyVar", {
        type: "String",
      });

      const code = compute.Code.fromTerraformVariables({
        bucketNameVar,
        objectKeyVar: bucketKeyVar,
      });

      expect(stack.resolve(code.bucketNameVar)).toEqual("${var.bucketNameVar}");
      expect(stack.resolve(code.objectKeyVar)).toEqual("${var.objectKeyVar}");

      new compute.LambdaFunction(stack, "Function", {
        code,
        runtime: compute.Runtime.NODEJS_LATEST,
        handler: "index.handler",
      });

      Template.synth(stack).toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          s3_bucket: "${var.bucketNameVar}",
          s3_key: "${var.objectKeyVar}",
        },
      );
    });

    // TODO: Figure out how to use TerraformVariablesCode.assign
    test.skip("can assign parameters", () => {
      // given
      const code = new compute.TerraformVariablesCode({
        bucketNameVar: new TerraformVariable(stack, "bucketNameVar", {
          type: "String",
        }),
        objectKeyVar: new TerraformVariable(stack, "ObjectKeyVar", {
          type: "String",
        }),
      });

      // when
      const overrides = stack.resolve(
        code.assign({
          bucketName: "SomeBucketName",
          objectKey: "SomeObjectKey",
        }),
      );

      // then
      expect(overrides.bucketNameVar).toEqual("SomeBucketName");
      expect(overrides.ObjectKeyVar).toEqual("SomeObjectKey");
    });
  });

  describe("lambda.Code.fromEcr", () => {
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

    test("repository uri is correctly identified", () => {
      // given
      const repo = new storage.Repository(stack, "Repo");

      // when
      new compute.LambdaFunction(stack, "Fn", {
        code: compute.Code.fromEcrImage(repo),
        handler: compute.Handler.FROM_IMAGE,
        runtime: compute.Runtime.FROM_IMAGE,
      });

      // then
      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          image_uri: stack.resolve(repo.repositoryUriForTag("latest")),
        },
      );
      template.expect.not.toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          image_config: expect.anything(),
        },
      );
    });

    test("props are correctly resolved", () => {
      // given
      const repo = new storage.Repository(stack, "Repo");

      // when
      new compute.LambdaFunction(stack, "Fn", {
        code: compute.Code.fromEcrImage(repo, {
          cmd: ["cmd", "param1"],
          entrypoint: ["entrypoint", "param2"],
          tagOrDigest: "mytag",
          workingDirectory: "/some/path",
        }),
        handler: compute.Handler.FROM_IMAGE,
        runtime: compute.Runtime.FROM_IMAGE,
      });

      // then
      Template.synth(stack).toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          image_uri: stack.resolve(repo.repositoryUriForTag("mytag")),
          image_config: {
            command: ["cmd", "param1"],
            entry_point: ["entrypoint", "param2"],
            working_directory: "/some/path",
          },
        },
      );
    });

    test("digests are interpreted correctly", () => {
      // given
      const repo = new storage.Repository(stack, "Repo");

      // when
      new compute.LambdaFunction(stack, "Fn", {
        code: compute.Code.fromEcrImage(repo, {
          tagOrDigest:
            "sha256:afc607424cc02c92d4d6af5184a4fef46a69548e465a320808c6ff358b6a3a8d",
        }),
        handler: compute.Handler.FROM_IMAGE,
        runtime: compute.Runtime.FROM_IMAGE,
      });

      // then
      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          image_uri: stack.resolve(
            repo.repositoryUriForDigest(
              "sha256:afc607424cc02c92d4d6af5184a4fef46a69548e465a320808c6ff358b6a3a8d",
            ),
          ),
        },
      );
      template.expect.not.toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          image_config: expect.anything(),
        },
      );
    });

    test("permission grants", () => {
      // given
      const repo = new storage.Repository(stack, "Repo");

      // when
      new compute.LambdaFunction(stack, "Fn", {
        code: compute.Code.fromEcrImage(repo),
        handler: compute.Handler.FROM_IMAGE,
        runtime: compute.Runtime.FROM_IMAGE,
      });

      // then
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_lambda.name}",
                  ],
                  type: "Service",
                },
              ],
              resources: [stack.resolve(repo.repositoryArn)],
            },
          ],
        },
      );
      template.expect.toHaveResourceWithProperties(
        ecrRepositoryPolicy.EcrRepositoryPolicy,
        {
          repository: stack.resolve(repo.repositoryName),
          policy:
            "${data.aws_iam_policy_document.Repo_PolicyDocument_F9E32824.json}",
        },
      );
    });
  });

  describe("lambda.Code.fromImageAsset", () => {
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
      stack = new AwsStack(app, "MyStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
    });

    test("props are correctly resolved", () => {
      // when
      new compute.LambdaFunction(stack, "Fn", {
        code: compute.Code.fromAssetImage(
          path.join(__dirname, "fixtures", "docker-lambda-handler"),
          {
            cmd: ["cmd", "param1"],
            entrypoint: ["entrypoint", "param2"],
            workingDirectory: "/some/path",
          },
        ),
        handler: compute.Handler.FROM_IMAGE,
        runtime: compute.Runtime.FROM_IMAGE,
      });

      // then
      Template.synth(stack).toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          image_config: {
            command: ["cmd", "param1"],
            entry_point: ["entrypoint", "param2"],
            working_directory: "/some/path",
          },
        },
      );
    });

    // TODO: TerraConstructs does not support asset metadata yet
    // test("adds code asset metadata", () => {
    //   // given
    //   const stack = new cdk.Stack();
    //   stack.node.setContext(
    //     cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT,
    //     true,
    //   );

    //   const dockerfilePath = "Dockerfile";
    //   const dockerBuildTarget = "stage";
    //   const dockerBuildArgs = { arg1: "val1", arg2: "val2" };
    //   const dockerBuildSsh = "default";

    //   // when
    //   new compute.LambdaFunction(stack, "Fn", {
    //     code: compute.Code.fromAssetImage(
    //       path.join(__dirname, "fixtures", "docker-lambda-handler"),
    //       {
    //         file: dockerfilePath,
    //         target: dockerBuildTarget,
    //         buildArgs: dockerBuildArgs,
    //         buildSsh: dockerBuildSsh,
    //       },
    //     ),
    //     handler: compute.Handler.FROM_IMAGE,
    //     runtime: compute.Runtime.FROM_IMAGE,
    //   });

    //   // then
    //   Template.fromStack(stack).hasResource(lambdaFunction.LambdaFunction,, {
    //     Metadata: {
    //       [cxapi.ASSET_RESOURCE_METADATA_PATH_KEY]:
    //         "asset.94589594a9968c9eeb447189c1c5b83b4f8b95f12c392a82749abcd36ecbbfb8",
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKERFILE_PATH_KEY]: dockerfilePath,
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKER_BUILD_ARGS_KEY]:
    //         dockerBuildArgs,
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKER_BUILD_SSH_KEY]: dockerBuildSsh,
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKER_BUILD_TARGET_KEY]:
    //         dockerBuildTarget,
    //       [cxapi.ASSET_RESOURCE_METADATA_PROPERTY_KEY]: "Code.ImageUri",
    //     },
    //   });
    // });

    // test("adds code asset metadata with default dockerfile path", () => {
    //   // given
    //   stack.node.setContext(
    //     cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT,
    //     true,
    //   );

    //   // when
    //   new compute.LambdaFunction(stack, "Fn", {
    //     code: compute.Code.fromAssetImage(
    //       path.join(__dirname, "fixtures", "docker-lambda-handler"),
    //     ),
    //     handler: compute.Handler.FROM_IMAGE,
    //     runtime: compute.Runtime.FROM_IMAGE,
    //   });

    //   // then
    //   Template.fromStack(stack).hasResource(lambdaFunction.LambdaFunction,, {
    //     Metadata: {
    //       [cxapi.ASSET_RESOURCE_METADATA_PATH_KEY]:
    //         "asset.1abd5e50b7a576ba32f8d038dfcd3665b4c34aa82ed17576969830142a99f254",
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKERFILE_PATH_KEY]: "Dockerfile",
    //       [cxapi.ASSET_RESOURCE_METADATA_PROPERTY_KEY]: "Code.ImageUri",
    //     },
    //   });
    // });

    // test("cache disabled", () => {
    //   // given
    //   const stack = new cdk.Stack();
    //   stack.node.setContext(
    //     cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT,
    //     true,
    //   );

    //   const dockerfilePath = "Dockerfile";
    //   const dockerBuildTarget = "stage";
    //   const dockerBuildArgs = { arg1: "val1", arg2: "val2" };
    //   const dockerBuildSsh = "default";

    //   // when
    //   new compute.LambdaFunction(stack, "Fn", {
    //     code: compute.Code.fromAssetImage(
    //       path.join(__dirname, "fixtures", "docker-lambda-handler"),
    //       {
    //         file: dockerfilePath,
    //         target: dockerBuildTarget,
    //         buildArgs: dockerBuildArgs,
    //         buildSsh: dockerBuildSsh,
    //         cacheDisabled: true,
    //       },
    //     ),
    //     handler: compute.Handler.FROM_IMAGE,
    //     runtime: compute.Runtime.FROM_IMAGE,
    //   });

    //   // then
    //   Template.fromStack(stack).hasResource(lambdaFunction.LambdaFunction,, {
    //     Metadata: {
    //       [cxapi.ASSET_RESOURCE_METADATA_PATH_KEY]:
    //         "asset.94589594a9968c9eeb447189c1c5b83b4f8b95f12c392a82749abcd36ecbbfb8",
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKERFILE_PATH_KEY]: dockerfilePath,
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKER_BUILD_ARGS_KEY]:
    //         dockerBuildArgs,
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKER_BUILD_SSH_KEY]: dockerBuildSsh,
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKER_BUILD_TARGET_KEY]:
    //         dockerBuildTarget,
    //       [cxapi.ASSET_RESOURCE_METADATA_PROPERTY_KEY]: "Code.ImageUri",
    //       [cxapi.ASSET_RESOURCE_METADATA_DOCKER_CACHE_DISABLED_KEY]: true,
    //     },
    //   });
    // });

    test("fails if asset is bound with a second stack", () => {
      // given
      const asset = compute.Code.fromAssetImage(
        path.join(__dirname, "fixtures", "docker-lambda-handler"),
      );

      // when
      new compute.LambdaFunction(stack, "Fn", {
        code: asset,
        handler: compute.Handler.FROM_IMAGE,
        runtime: compute.Runtime.FROM_IMAGE,
      });

      const stack2 = new AwsStack(app, "Stack2", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });

      // then
      expect(
        () =>
          new compute.LambdaFunction(stack2, "Fn", {
            code: asset,
            handler: compute.Handler.FROM_IMAGE,
            runtime: compute.Runtime.FROM_IMAGE,
          }),
      ).toThrow(/already associated/);
    });
  });

  describe("lambda.Code.fromDockerBuild", () => {
    let fromBuildMock: jest.SpyInstance<DockerImage>;
    let cpMock: jest.Mock<any, any>;
    let stack: AwsStack;
    let app: App;

    beforeEach(() => {
      cpMock = jest
        .fn()
        .mockReturnValue(
          path.join(__dirname, "fixtures", "docker-build-lambda"),
        );
      fromBuildMock = jest
        .spyOn(DockerImage, "fromBuild")
        .mockImplementation(() => ({
          cp: cpMock,
          image: "tag",
          run: jest.fn(),
          toJSON: jest.fn(),
        }));
      app = Testing.stubVersion(
        new App({
          stackTraces: false,
          context: {
            cdktfJsonPath: path.resolve(__dirname, CDKTFJSON_PATH),
          },
        }),
      );
      stack = new AwsStack(app, "MyStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
    });

    afterEach(() => {
      fromBuildMock.mockRestore();
    });

    test("can use the result of a Docker build as an asset", () => {
      // given
      // TerraConstructs does not support asset metadata yet
      // stack.node.setContext(
      //   cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT,
      //   true,
      // );

      // when
      new compute.LambdaFunction(stack, "Fn", {
        code: compute.Code.fromDockerBuild(
          path.join(__dirname, "fixtures", "docker-build-lambda"),
        ),
        handler: "index.handler",
        runtime: compute.Runtime.NODEJS_LATEST,
      });

      // then
      Template.synth(stack).toHaveResourceWithProperties(
        lambdaFunction.LambdaFunction,
        {
          s3_bucket: "${aws_s3_bucket.AssetBucket.bucket}",
          // Should this be the objectKey string (not TOKEN) and use depends_on?
          s3_key: "${aws_s3_object.FileAsset_S3.key}",
        },
      );

      expect(fromBuildMock).toHaveBeenCalledWith(
        path.join(__dirname, "fixtures", "docker-build-lambda"),
        {},
      );
      expect(cpMock).toHaveBeenCalledWith("/asset/.", undefined);
    });

    test("fromDockerBuild appends /. to an image path not ending with a /", () => {
      // when
      new compute.LambdaFunction(stack, "Fn", {
        code: compute.Code.fromDockerBuild(
          path.join(__dirname, "fixtures", "docker-build-lambda"),
          {
            imagePath: "/my/image/path",
          },
        ),
        handler: "index.handler",
        runtime: compute.Runtime.NODEJS_LATEST,
      });

      // then
      expect(cpMock).toHaveBeenCalledWith("/my/image/path/.", undefined);
    });

    test("fromDockerBuild appends . to an image path ending with a /", () => {
      // when
      new compute.LambdaFunction(stack, "Fn", {
        code: compute.Code.fromDockerBuild(
          path.join(__dirname, "fixtures", "docker-build-lambda"),
          {
            imagePath: "/my/image/path/",
          },
        ),
        handler: "index.handler",
        runtime: compute.Runtime.NODEJS_LATEST,
      });

      // then
      expect(cpMock).toHaveBeenCalledWith("/my/image/path/.", undefined);
    });
  });
});

function defineFunction(
  code: compute.Code,
  runtime: compute.Runtime = compute.Runtime.NODEJS_LATEST,
) {
  const app = Testing.stubVersion(
    new App({
      stackTraces: false,
      context: {
        cdktfJsonPath: path.resolve(__dirname, CDKTFJSON_PATH),
      },
    }),
  );
  const stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  return new compute.LambdaFunction(stack, "Func", {
    handler: "foom",
    code,
    runtime,
  });
}
