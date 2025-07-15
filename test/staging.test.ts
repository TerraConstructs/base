// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/core/test/staging.test.ts

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
// import * as sinon from "sinon";
import { App, Testing } from "cdktf";
import {
  AssetHashType,
  AssetStaging,
  DockerImage,
  BundlingOptions,
  BundlingOutput,
  FileSystem,
  StackBase,
  FileAssetPackaging,
  // Stage,
  BundlingFileAccess,
} from "../src";

class MyStack extends StackBase {}

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const STUB_INPUT_FILE = "/tmp/docker-stub.input";
const STUB_INPUT_CONCAT_FILE = "/tmp/docker-stub.input.concat";

const STUB_INPUT_CP_FILE = "/tmp/docker-stub-cp.input";
const STUB_INPUT_CP_CONCAT_FILE = "/tmp/docker-stub-cp.input.concat";

enum DockerStubCommand {
  SUCCESS = "DOCKER_STUB_SUCCESS",
  FAIL = "DOCKER_STUB_FAIL",
  SUCCESS_NO_OUTPUT = "DOCKER_STUB_SUCCESS_NO_OUTPUT",
  MULTIPLE_FILES = "DOCKER_STUB_MULTIPLE_FILES",
  SINGLE_ARCHIVE = "DOCKER_STUB_SINGLE_ARCHIVE",
  SINGLE_FILE = "DOCKER_STUB_SINGLE_FILE",
  SINGLE_FILE_WITHOUT_EXT = "DOCKER_STUB_SINGLE_FILE_WITHOUT_EXT",
  VOLUME_SINGLE_ARCHIVE = "DOCKER_STUB_VOLUME_SINGLE_ARCHIVE",
}

const FIXTURE_TEST1_DIR = path.join(__dirname, "fs", "fixtures", "test1");
const FIXTURE_TEST1_HASH =
  "2f37f937c51e2c191af66acf9b09f548926008ec68c575bd2ee54b6e997c0e00";
const FIXTURE_TARBALL = path.join(__dirname, "fs", "fixtures.tar.gz");
const NOT_ARCHIVED_ZIP_TXT_HASH =
  "95c924c84f5d023be4edee540cb2cb401a49f115d01ed403b288f6cb412771df";
const ARCHIVE_TARBALL_TEST_HASH =
  "3e948ff54a277d6001e2452fdbc4a9ef61f916ff662ba5e05ece1e2ec6dec9f5";

const userInfo = os.userInfo();
const USER_ARG = `-u ${userInfo.uid}:${userInfo.gid}`;

const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const CDKTFJSON_PATH = path.join(TEST_APPDIR, "cdktf.json");
const TEST_OUTDIR = path.join(__dirname, "cdk.out");
// this is hardcoded in the AssetStaging class:
const TEST_STAGING_DIR = path.join(TEST_APPDIR, "tcons-staging");

describe("staging", () => {
  let stack: MyStack;
  let app: App;

  beforeAll(() => {
    // this is a way to provide a custom "docker" command for staging.
    process.env.CDK_DOCKER = `${__dirname}/docker-stub.sh`;
  });

  afterAll(() => {
    delete process.env.CDK_DOCKER;
    // clear the tcons staging directory
    fs.rmSync(TEST_STAGING_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_OUTDIR)) {
      fs.rmSync(TEST_OUTDIR, { recursive: true, force: true });
    }
    app = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR,
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, CDKTFJSON_PATH),
        },
      }),
    );
    stack = new MyStack(app, "TestStack", {
      environmentName,
      gridUUID,
      gridBackendConfig,
    });
  });

  afterEach(() => {
    AssetStaging.clearAssetHashCache();
    if (fs.existsSync(STUB_INPUT_FILE)) {
      fs.unlinkSync(STUB_INPUT_FILE);
    }
    if (fs.existsSync(STUB_INPUT_CONCAT_FILE)) {
      fs.unlinkSync(STUB_INPUT_CONCAT_FILE);
    }
    jest.restoreAllMocks();
  });

  test("base case", () => {
    // GIVEN
    const sourcePath = FIXTURE_TEST1_DIR;

    // WHEN
    const staging = new AssetStaging(stack, "s1", { sourcePath });

    expect(staging.assetHash).toEqual(FIXTURE_TEST1_HASH);
    expect(staging.sourcePath).toEqual(sourcePath);
    expect(path.basename(staging.absoluteStagedPath)).toEqual(
      `asset.${FIXTURE_TEST1_HASH}`,
    );
    expect(path.basename(staging.relativeStagedPath(stack))).toEqual(
      `asset.${FIXTURE_TEST1_HASH}`,
    );
    expect(staging.packaging).toEqual(FileAssetPackaging.ZIP_DIRECTORY);
    expect(staging.isArchive).toEqual(true);
  });

  test("base case if source directory is a symlink", () => {
    // GIVEN
    const sourcePath = path.join(os.tmpdir(), "asset-symlink");
    if (fs.existsSync(sourcePath)) {
      fs.unlinkSync(sourcePath);
    }
    fs.symlinkSync(FIXTURE_TEST1_DIR, sourcePath);

    try {
      const staging = new AssetStaging(stack, "s1", { sourcePath });

      // Should be the same asset hash as in the previous test
      expect(staging.assetHash).toEqual(FIXTURE_TEST1_HASH);
    } finally {
      if (fs.existsSync(sourcePath)) {
        fs.unlinkSync(sourcePath);
      }
    }
  });

  test("staging of an archive file correctly sets packaging and isArchive", () => {
    // GIVEN
    const sourcePath = path.join(__dirname, "archive", "archive.zip");

    // WHEN
    const staging = new AssetStaging(stack, "s1", { sourcePath });

    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(true);
  });

  test("staging of an archive with multiple extension name correctly sets packaging and isArchive", () => {
    // GIVEN
    const sourcePathTarGz1 = path.join(__dirname, "archive", "artifact.tar.gz");
    const sourcePathTarGz2 = path.join(
      __dirname,
      "archive",
      "artifact.da.vinci.monalisa.tar.gz",
    );
    const sourcePathTgz = path.join(__dirname, "archive", "artifact.tgz");
    const sourcePathTar = path.join(__dirname, "archive", "artifact.tar");
    const sourcePathNotArchive = path.join(
      __dirname,
      "archive",
      "artifact.zip.txt",
    );
    const sourcePathDockerFile = path.join(__dirname, "archive", "DockerFile");

    // WHEN
    const stagingTarGz1 = new AssetStaging(stack, "s1", {
      sourcePath: sourcePathTarGz1,
    });
    const stagingTarGz2 = new AssetStaging(stack, "s2", {
      sourcePath: sourcePathTarGz2,
    });
    const stagingTgz = new AssetStaging(stack, "s3", {
      sourcePath: sourcePathTgz,
    });
    const stagingTar = new AssetStaging(stack, "s4", {
      sourcePath: sourcePathTar,
    });
    const stagingNotArchive = new AssetStaging(stack, "s5", {
      sourcePath: sourcePathNotArchive,
    });
    const stagingDockerFile = new AssetStaging(stack, "s6", {
      sourcePath: sourcePathDockerFile,
    });

    expect(stagingTarGz1.packaging).toEqual(FileAssetPackaging.FILE);
    expect(stagingTarGz1.isArchive).toEqual(true);
    expect(stagingTarGz2.packaging).toEqual(FileAssetPackaging.FILE);
    expect(path.basename(stagingTarGz2.absoluteStagedPath)).toEqual(
      `asset.${ARCHIVE_TARBALL_TEST_HASH}.tar.gz`,
    );
    expect(path.basename(stagingTarGz2.relativeStagedPath(stack))).toEqual(
      `asset.${ARCHIVE_TARBALL_TEST_HASH}.tar.gz`,
    );
    expect(stagingTarGz2.isArchive).toEqual(true);
    expect(stagingTgz.packaging).toEqual(FileAssetPackaging.FILE);
    expect(stagingTgz.isArchive).toEqual(true);
    expect(stagingTar.packaging).toEqual(FileAssetPackaging.FILE);
    expect(stagingTar.isArchive).toEqual(true);
    expect(stagingNotArchive.packaging).toEqual(FileAssetPackaging.FILE);
    expect(path.basename(stagingNotArchive.absoluteStagedPath)).toEqual(
      `asset.${NOT_ARCHIVED_ZIP_TXT_HASH}.txt`,
    );
    expect(path.basename(stagingNotArchive.relativeStagedPath(stack))).toEqual(
      `asset.${NOT_ARCHIVED_ZIP_TXT_HASH}.txt`,
    );
    expect(stagingNotArchive.isArchive).toEqual(false);
    expect(stagingDockerFile.packaging).toEqual(FileAssetPackaging.FILE);
    expect(stagingDockerFile.isArchive).toEqual(false);
  });

  test("asset packaging type is correct when staging is skipped because of memory cache", () => {
    // GIVEN
    const sourcePath = path.join(__dirname, "archive", "archive.zip");

    // WHEN
    const staging1 = new AssetStaging(stack, "s1", { sourcePath });
    const staging2 = new AssetStaging(stack, "s2", { sourcePath });

    expect(staging1.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging1.isArchive).toEqual(true);
    expect(staging2.packaging).toEqual(staging1.packaging);
    expect(staging2.isArchive).toEqual(staging1.isArchive);
  });

  test("asset packaging type is correct when staging is skipped because of disk cache", () => {
    // GIVEN
    const sourcePath = path.join(__dirname, "archive", "archive.zip");

    const app2 = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR,
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, "fixtures/app/cdktf.json"),
        },
      }),
    );
    const stack2 = new MyStack(app2, "stack", {
      environmentName,
      gridUUID,
      gridBackendConfig,
    });

    // WHEN
    const staging1 = new AssetStaging(stack, "Asset", { sourcePath });

    // Now clear asset hash cache to show that during the second staging
    // even though the asset is already available on disk it will correctly
    // be considered as a FileAssetPackaging.FILE.
    AssetStaging.clearAssetHashCache();

    const staging2 = new AssetStaging(stack2, "Asset", { sourcePath });

    // THEN
    expect(staging1.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging1.isArchive).toEqual(true);
    expect(staging2.packaging).toEqual(staging1.packaging);
    expect(staging2.isArchive).toEqual(staging1.isArchive);
  });

  test("staging of a non-archive file correctly sets packaging and isArchive", () => {
    // GIVEN
    const sourcePath = __filename;

    // WHEN
    const staging = new AssetStaging(stack, "s1", { sourcePath });

    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });

  // test("staging can be disabled through context", () => {
  //   // GIVEN
  //   // stack.node.setContext(cxapi.DISABLE_ASSET_STAGING_CONTEXT, true);
  //   const sourcePath = path.join(__dirname, "fs", "fixtures", "test1");

  //   // WHEN
  //   const staging = new AssetStaging(stack, "s1", { sourcePath });

  //   expect(staging.assetHash).toEqual(FIXTURE_TEST1_HASH);
  //   expect(staging.sourcePath).toEqual(sourcePath);
  //   expect(staging.absoluteStagedPath).toEqual(sourcePath);
  //   expect(staging.relativeStagedPath(stack)).toEqual(sourcePath);
  // });

  test("files are copied to the output directory during synth", () => {
    // WHEN
    new AssetStaging(stack, "s1", { sourcePath: FIXTURE_TEST1_DIR });
    new AssetStaging(stack, "file", { sourcePath: FIXTURE_TARBALL });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        `asset.${FIXTURE_TEST1_HASH}`,
        "asset.af10ac04b3b607b0f8659c8f0cee8c343025ee75baf0b146f10f0e5311d2c46b.tar.gz",
      ]),
    );
  });

  // test("assets in nested assemblies get staged into assembly root directory", () => {
  //   // GIVEN
  //   const app = new App();
  //   const stack1 = new MyStack(new Stage(app, "Stage1"), "Stack");
  //   const stack2 = new MyStack(new Stage(app, "Stage2"), "Stack");

  //   // WHEN
  //   new AssetStaging(stack1, "s1", { sourcePath: FIXTURE_TEST1_DIR });
  //   new AssetStaging(stack2, "s1", { sourcePath: FIXTURE_TEST1_DIR });

  //   // THEN
  //   const assembly = app.synth();

  //   // One asset directory at the top
  //   expect(fs.readdirSync(assembly.directory)).toEqual([
  //     "assembly-Stage1",
  //     "assembly-Stage2",
  //     `asset.${FIXTURE_TEST1_HASH}`,
  //     "cdk.out",
  //     "manifest.json",
  //     "tree.json",
  //   ]);
  // });

  test("allow specifying extra data to include in the source hash", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const withoutExtra = new AssetStaging(stack, "withoutExtra", {
      sourcePath: directory,
    });
    const withExtra = new AssetStaging(stack, "withExtra", {
      sourcePath: directory,
      extraHash: "boom",
    });

    // THEN
    expect(withoutExtra.assetHash).not.toEqual(withExtra.assetHash);
    expect(withoutExtra.assetHash).toEqual(FIXTURE_TEST1_HASH);
    expect(withExtra.assetHash).toEqual(
      "c95c915a5722bb9019e2c725d11868e5a619b55f36172f76bcbcaa8bb2d10c5f",
    );
  });

  //TODO: Fix assetHashSalt
  test.skip("can specify extra asset salt via context key", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    const saltedApp = Testing.stubVersion(
      new App({
        outdir: path.join(__dirname, "cdk.out"),
        stackTraces: false,
        context: {
          "terraconstructs/core:assetHashSalt": "magic",
          cdktfJsonPath: path.resolve(__dirname, "fixtures/app/cdktf.json"),
        },
      }),
    );
    const saltedStack = new MyStack(saltedApp, "stack", {
      environmentName,
      gridUUID,
      gridBackendConfig,
    });

    // WHEN
    const asset = new AssetStaging(stack, "X", { sourcePath: directory });
    const saltedAsset = new AssetStaging(saltedStack, "X", {
      sourcePath: directory,
    });

    // THEN
    expect(asset.assetHash).not.toEqual(saltedAsset.assetHash);
  });

  test("with bundling", () => {
    // GIVEN
    // const app = new App({
    //   context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
    // });
    // const stack = new StackBase(app, "stack");
    const directory = path.join(__dirname, "fs", "fixtures", "test1");
    const processStdErrWriteSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    // const processStdErrWriteSpy = sinon.spy(process.stderr, "write");

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
    });

    // THEN
    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );
    // const stackDir = getSynthDir(app, stack);
    expect(
      fs.readdirSync(TEST_STAGING_DIR, {
        // recursive: true
      }),
    ).toEqual(
      expect.arrayContaining([
        "asset.b1e32e86b3523f2fa512eb99180ee2975a50a4439e63e8badd153f2a68d61aa4",
      ]),
    );

    // shows a message before bundling
    expect(processStdErrWriteSpy).toHaveBeenCalledWith(
      "Bundling asset TestStack/Asset...\n",
    );
  });

  // test("bundled resources have absolute path when staging is disabled", () => {
  //   // GIVEN
  //   // const app = new App({
  //   //   context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
  //   // });
  //   // const stack = new StackBase(app, "stack");
  //   stack.node.setContext(cxapi.DISABLE_ASSET_STAGING_CONTEXT, true);
  //   const directory = path.join(__dirname, "fs", "fixtures", "test1");

  //   // WHEN
  //   const asset = new AssetStaging(stack, "Asset", {
  //     sourcePath: directory,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //     },
  //   });

  //   // THEN
  //   const assembly = app.synth();

  //   expect(fs.readdirSync(assembly.directory)).toEqual([
  //     "asset.b1e32e86b3523f2fa512eb99180ee2975a50a4439e63e8badd153f2a68d61aa4",
  //     "cdk.out",
  //     "manifest.json",
  //     "stack.template.json",
  //     "tree.json",
  //   ]);

  //   expect(asset.assetHash).toEqual(
  //     "b1e32e86b3523f2fa512eb99180ee2975a50a4439e63e8badd153f2a68d61aa4",
  //   );
  //   expect(asset.sourcePath).toEqual(directory);

  //   const resolvedStagePath = asset.relativeStagedPath(stack);
  //   // absolute path ending with bundling dir
  //   expect(path.isAbsolute(resolvedStagePath)).toEqual(true);
  //   expect(
  //     new RegExp(
  //       "asset.b1e32e86b3523f2fa512eb99180ee2975a50a4439e63e8badd153f2a68d61aa4$",
  //     ).test(resolvedStagePath),
  //   ).toEqual(true);
  // });

  // TODO: Fix no such file or directory, open '/tmp/docker-stub.input.concat'
  test.skip("bundler reuses its output when it can", () => {
    // GIVEN
    // const app = new App({
    //   context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
    // });
    // const stack = new StackBase(app, "stack");
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
    });

    new AssetStaging(stack, "AssetDuplicate", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);

    // We're testing that docker was run exactly once even though there are two bundling assets.
    expect(readDockerStubInputConcat()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );

    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual([
      "asset.b1e32e86b3523f2fa512eb99180ee2975a50a4439e63e8badd153f2a68d61aa4",
      "cdk.out",
      "manifest.json",
      "stack.template.json",
      "tree.json",
    ]);
  });

  test("uses asset hash cache with AssetHashType.OUTPUT", () => {
    // GIVEN
    // const app = new App({
    //   context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
    // });
    // const stack = new StackBase(app, "stack");
    const directory = path.join(__dirname, "fs", "fixtures", "test1");
    const fingerPrintSpy = jest.spyOn(FileSystem, "fingerprint");

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      assetHashType: AssetHashType.OUTPUT,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
    });

    new AssetStaging(stack, "AssetDuplicate", {
      sourcePath: directory,
      assetHashType: AssetHashType.OUTPUT,
      bundling: {
        // Same bundling but with keys ordered differently
        command: [DockerStubCommand.SUCCESS],
        image: DockerImage.fromRegistry("alpine"),
      },
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);

    // We're testing that docker was run exactly once even though there are two bundling assets
    // and that the hash is based on the output
    expect(readDockerStubInputConcat()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );

    expect(
      fs.readdirSync(
        TEST_STAGING_DIR, //{ recursive: true }
      ),
    ).toEqual(
      expect.arrayContaining([
        "asset.33cbf2cae5432438e0f046bc45ba8c3cef7b6afcf47b59d1c183775c1918fb1f",
      ]),
    );

    // Only one fingerprinting
    expect(fingerPrintSpy).toHaveBeenCalledTimes(1);
  });

  // TODO: Fix '/tmp/docker-stub.input.concat' seems to be wiped and only records the last run
  test.skip("bundler considers its options when reusing bundle output", () => {
    // GIVEN
    // const app = new App({
    //   context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
    // });
    // const stack = new StackBase(app, "stack");
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
    });

    new AssetStaging(stack, "AssetWithDifferentBundlingOptions", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        environment: {
          UNIQUE_ENV_VAR: "SOMEVALUE",
        },
      },
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);

    // We're testing that docker was run twice - once for each set of bundler options
    // operating on the same source asset.
    expect(readDockerStubInputConcat()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS\n` +
        `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated --env UNIQUE_ENV_VAR=SOMEVALUE -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );

    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual([
      "asset.b1e32e86b3523f2fa512eb99180ee2975a50a4439e63e8badd153f2a68d61aa4", // 'Asset'
      "asset.e80bb8f931b87e84975de193f5a7ecddd7558d3caf3d35d3a536d9ae6539234f", // 'AssetWithDifferentBundlingOptions'
      "cdk.out",
      "manifest.json",
      "stack.template.json",
      "tree.json",
    ]);
  });

  test("bundler ignores secret tokens in code artifact URLs", () => {
    // GIVEN
    // const app = new App({
    //   context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
    // });
    // const stack = new StackBase(app, "stack");
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        environment: {
          PIP_INDEX_URL:
            "https://aws:MY_SECRET_TOKEN@your-code-repo.d.codeartifact.us-west-2.amazonaws.com/pypi/python/simple/",
        },
      },
    });

    new AssetStaging(stack, "AssetWithDifferentBundlingOptions", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        environment: {
          PIP_INDEX_URL:
            "https://aws:MY_OTHER_SECRET_TOKEN@your-code-repo.d.codeartifact.us-west-2.amazonaws.com/pypi/python/simple/",
        },
      },
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);

    // We're testing that docker was run once, only for the first Asset, since the only difference is the token.
    expect(readDockerStubInputConcat()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated --env PIP_INDEX_URL=https://aws:MY_SECRET_TOKEN@your-code-repo.d.codeartifact.us-west-2.amazonaws.com/pypi/python/simple/ -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );

    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        "asset.2de2347dd01e3f43a463652635acaae09539cdf32769d9a60ac0ad4622b1e943", // 'Asset'
      ]),
    );
  });

  test("bundler throws n error when the PIP url is not a valid url", () => {
    // GIVEN
    // const app = new App({
    //   context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
    // });
    // const stack = new StackBase(app, "stack");
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          bundling: {
            image: DockerImage.fromRegistry("alpine"),
            command: [DockerStubCommand.SUCCESS],
            environment: {
              PIP_INDEX_URL: "NOT_A_URL",
            },
          },
        }),
    ).toThrow("PIP_INDEX_URL must be a valid URL, got NOT_A_URL.");
  });

  // // TODO: Replace sinon mocks with jest mocks
  // test.skip("bundler outputs to intermediate dir and renames to asset", () => {
  //   // GIVEN
  //   // const app = new App({
  //   //   context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
  //   // });
  //   // const stack = new StackBase(app, "stack");
  //   const directory = path.join(__dirname, "fs", "fixtures", "test1");
  //   const ensureDirSync = jest.spyOn(fs, "mkdirSync");
  //   const chmodSyncSpy = jest.spyOn(fs, "chmodSync");
  //   const renameSyncSpy = jest.spyOn(fs, "renameSync");

  //   // WHEN
  //   new AssetStaging(stack, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //     },
  //   });

  //   // THEN
  //   // const stackDir = getSynthDir(app, stack);

  //   expect(
  //     ensureDirSync.calledWith(
  //       sinon.match(path.join(assembly.directory, "bundling-temp-")),
  //     ),
  //   ).toEqual(true);
  //   expect(
  //     chmodSyncSpy.calledWith(
  //       sinon.match(path.join(assembly.directory, "bundling-temp-")),
  //       0o777,
  //     ),
  //   ).toEqual(true);
  //   expect(
  //     renameSyncSpy.calledWith(
  //       sinon.match(path.join(assembly.directory, "bundling-temp-")),
  //       sinon.match(path.join(assembly.directory, "asset.")),
  //     ),
  //   ).toEqual(true);

  //   expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual([
  //     "asset.33cbf2cae5432438e0f046bc45ba8c3cef7b6afcf47b59d1c183775c1918fb1f", // 'Asset'
  //     "cdk.out",
  //     "manifest.json",
  //     "stack.template.json",
  //     "tree.json",
  //   ]);
  // });

  test("bundling failure preserves the bundleDir for diagnosability", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          bundling: {
            image: DockerImage.fromRegistry("alpine"),
            command: [DockerStubCommand.FAIL],
          },
        }),
    ).toThrow(/Failed.*bundl.*asset.*-building/);

    // THEN
    const stagingDir = path.join(__dirname, "fixtures", "app", "tcons-staging");

    const dir = fs.readdirSync(stagingDir);
    expect(dir.some((entry) => entry.match(/asset.*-building/))).toEqual(true);
  });

  // test("bundler re-uses assets from previous synths", () => {
  //   // GIVEN
  //   const directory = path.join(__dirname, "fs", "fixtures", "test1");

  //   // WHEN
  //   new AssetStaging(stack, "Asset", {
  //     sourcePath: directory,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //     },
  //   });

  //   // Clear asset hash cache to show that during the second synth bundling
  //   // will consider the existing bundling dir (file system cache).
  //   AssetStaging.clearAssetHashCache();

  //   // GIVEN
  //   const app2 = Testing.stubVersion(
  //     new App({
  //       outdir: TEST_OUTDIR,
  //       stackTraces: false,
  //       context: {
  //         cdktfJsonPath: path.resolve(__dirname, "fixtures/app/cdktf.json"),
  //       },
  //     }),
  //   );
  //   const stack2 = new MyStack(app2, "stack", {
  //     environmentName,
  //     gridUUID,
  //     gridBackendConfig,
  //   });

  //   // WHEN
  //   new AssetStaging(stack2, "Asset", {
  //     sourcePath: directory,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //     },
  //   });

  //   // THEN
  //   // Staging no longer copies assets to stackDir (only staging directory)
  //   // const stackDir1 = getSynthDir(app, stack);
  //   // const stackDir2 = getSynthDir(app2, stack2);

  //   expect(readDockerStubInputConcat()).toEqual(
  //     `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
  //   );

  //   expect(appAssembly.directory).toEqual(app2Assembly.directory);
  //   expect(fs.readdirSync(appAssembly.directory)).toEqual([
  //     "asset.b1e32e86b3523f2fa512eb99180ee2975a50a4439e63e8badd153f2a68d61aa4",
  //     "cdk.out",
  //     "manifest.json",
  //     "stack.template.json",
  //     "tree.json",
  //   ]);
  // });

  test.skip("if bundling is interrupted, target asset directory is not produced", () => {
    // WHEN
    try {
      execSync(
        `npx ts-node ${__dirname}/app-that-is-interrupted-during-staging.ts`,
        {
          env: {
            ...process.env,
            CDK_OUTDIR: TEST_OUTDIR,
          },
        },
      );
      throw new Error("We expected the above command to fail");
    } catch (e) {
      // We expect the command to be terminated with a signal, which sometimes shows
      // as 'signal' is set to SIGTERM, and on some Linuxes as exitCode = 128 + 15 = 143
      if (e.signal === "SIGTERM" || e.status === 143) {
        // pass
      } else {
        throw e;
      }
    }

    // THEN
    const generatedFiles = fs.readdirSync(TEST_OUTDIR);
    // We expect a 'building' asset directory...
    expect(generatedFiles).toContainEqual(
      expect.stringMatching(/^asset\.[0-9a-f]+-building$/),
    );
    // ...not a complete asset directory
    expect(generatedFiles).not.toContainEqual(
      expect.stringMatching(/^asset\.[0-9a-f]+$/),
    );
  });

  // test("bundler re-uses assets from previous synths, ignoring tokens", () => {
  //   const directory = path.join(__dirname, "fs", "fixtures", "test1");

  //   // WHEN
  //   new AssetStaging(stack, "Asset", {
  //     sourcePath: directory,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //       environment: {
  //         PIP_EXTRA_INDEX_URL:
  //           "https://aws:MY_SECRET_TOKEN@your-code-repo.d.codeartifact.us-west-2.amazonaws.com/pypi/python/simple/",
  //       },
  //     },
  //   });

  //   // Clear asset hash cache to show that during the second synth bundling
  //   // will consider the existing bundling dir (file system cache).
  //   AssetStaging.clearAssetHashCache();

  //   // GIVEN
  //   const app2 = Testing.stubVersion(
  //     new App({
  //       outdir: TEST_OUTDIR,
  //       stackTraces: false,
  //       context: {
  //         cdktfJsonPath: path.resolve(__dirname, "fixtures/app/cdktf.json"),
  //       },
  //     }),
  //   );
  //   const stack2 = new MyStack(app2, "stack", {
  //     environmentName,
  //     gridUUID,
  //     gridBackendConfig,
  //   });

  //   // WHEN
  //   new AssetStaging(stack2, "Asset", {
  //     sourcePath: directory,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //       environment: {
  //         PIP_EXTRA_INDEX_URL:
  //           "https://aws:MY_OTHER_SECRET_TOKEN@your-code-repo.d.codeartifact.us-west-2.amazonaws.com/pypi/python/simple/",
  //       },
  //     },
  //   });

  //   // THEN
  //   const appAssembly = app.synth();
  //   const app2Assembly = app2.synth();

  //   expect(readDockerStubInputConcat()).toEqual(
  //     `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated --env PIP_EXTRA_INDEX_URL=https://aws:MY_SECRET_TOKEN@your-code-repo.d.codeartifact.us-west-2.amazonaws.com/pypi/python/simple/ -w /asset-input alpine DOCKER_STUB_SUCCESS`,
  //   );

  //   expect(appAssembly.directory).toEqual(app2Assembly.directory);
  //   expect(fs.readdirSync(appAssembly.directory)).toEqual([
  //     "asset.ec1d4062c578dacd630d64166a7d1efcd472e570e085a63f8857f6c674491bac",
  //     "cdk.out",
  //     "manifest.json",
  //     "stack.template.json",
  //     "tree.json",
  //   ]);
  // });

  test("bundling throws when /asset-output is empty", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // THEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          bundling: {
            image: DockerImage.fromRegistry("alpine"),
            command: [DockerStubCommand.SUCCESS_NO_OUTPUT],
          },
        }),
    ).toThrow(/Bundling did not produce any output/);

    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS_NO_OUTPUT`,
    );
  });

  // Deprecated
  test("bundling with BUNDLE asset hash type", () => {
    // GIVEN
    // const app = new App();
    // const stack = new StackBase(app, "stack");
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const asset = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
      assetHashType: AssetHashType.BUNDLE,
    });

    // THEN
    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );
    expect(asset.assetHash).toEqual(
      "33cbf2cae5432438e0f046bc45ba8c3cef7b6afcf47b59d1c183775c1918fb1f",
    );
  });

  test("bundling with docker security option", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const asset = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        securityOpt: "no-new-privileges",
      },
      assetHashType: AssetHashType.BUNDLE,
    });

    // THEN
    expect(readDockerStubInput()).toEqual(
      `run --rm --security-opt no-new-privileges ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );
    expect(asset.assetHash).toEqual(
      "33cbf2cae5432438e0f046bc45ba8c3cef7b6afcf47b59d1c183775c1918fb1f",
    );
  });

  test("bundling with docker entrypoint", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const asset = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        entrypoint: [DockerStubCommand.SUCCESS],
        command: [DockerStubCommand.SUCCESS],
      },
      assetHashType: AssetHashType.OUTPUT,
    });

    // THEN
    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input --entrypoint DOCKER_STUB_SUCCESS alpine DOCKER_STUB_SUCCESS`,
    );
    expect(asset.assetHash).toEqual(
      "33cbf2cae5432438e0f046bc45ba8c3cef7b6afcf47b59d1c183775c1918fb1f",
    );
  });

  test("bundling with OUTPUT asset hash type", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const asset = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
      assetHashType: AssetHashType.OUTPUT,
    });

    // THEN
    expect(asset.assetHash).toEqual(
      "33cbf2cae5432438e0f046bc45ba8c3cef7b6afcf47b59d1c183775c1918fb1f",
    );
  });

  test("custom hash", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const asset = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      assetHash: "my-custom-hash",
    });

    // THEN
    expect(fs.existsSync(STUB_INPUT_FILE)).toEqual(false);
    expect(asset.assetHash).toEqual(
      "b9c77053f5b83bbe5ba343bc18e92db939a49017010813225fea91fa892c4823",
    ); // hash of 'my-custom-hash'
  });

  test("throws with assetHash and not CUSTOM hash type", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // THEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          bundling: {
            image: DockerImage.fromRegistry("alpine"),
            command: [DockerStubCommand.SUCCESS],
          },
          assetHash: "my-custom-hash",
          assetHashType: AssetHashType.OUTPUT,
        }),
    ).toThrow(/Cannot specify `output` for `assetHashType`/);
  });

  // Deprecated
  test("throws with BUNDLE hash type and no bundling", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // THEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          assetHashType: AssetHashType.BUNDLE,
        }),
    ).toThrow(/Cannot use `bundle` hash type when `bundling` is not specified/);
    expect(fs.existsSync(STUB_INPUT_FILE)).toEqual(false);
  });

  test("throws with OUTPUT hash type and no bundling", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // THEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          assetHashType: AssetHashType.OUTPUT,
        }),
    ).toThrow(/Cannot use `output` hash type when `bundling` is not specified/);
    expect(fs.existsSync(STUB_INPUT_FILE)).toEqual(false);
  });

  test("throws with CUSTOM and no hash", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // THEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          assetHashType: AssetHashType.CUSTOM,
        }),
    ).toThrow(
      /`assetHash` must be specified when `assetHashType` is set to `AssetHashType.CUSTOM`/,
    );
    expect(fs.existsSync(STUB_INPUT_FILE)).toEqual(false); // "docker" not executed
  });

  test("throws when bundling fails", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // THEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          bundling: {
            image: DockerImage.fromRegistry("this-is-an-invalid-docker-image"),
            command: [DockerStubCommand.FAIL],
          },
        }),
    ).toThrow(/Failed to bundle asset TestStack\/Asset/);
    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input this-is-an-invalid-docker-image DOCKER_STUB_FAIL`,
    );
  });

  test("with local bundling", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    let dir: string | undefined;
    let opts: BundlingOptions | undefined;
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        local: {
          tryBundle(outputDir: string, options: BundlingOptions): boolean {
            dir = outputDir;
            opts = options;
            fs.writeFileSync(path.join(outputDir, "hello.txt"), "hello"); // output cannot be empty
            return true;
          },
        },
      },
    });

    // THEN
    expect(dir && /asset.[0-9a-f]{16,}/.test(dir)).toEqual(true);
    expect(opts?.command?.[0]).toEqual(DockerStubCommand.SUCCESS);
    expect(() => readDockerStubInput()).toThrow();

    if (dir) {
      fs.rmSync(path.join(dir, "hello.txt"), { recursive: true, force: true });
    }
  });

  // TODO: Fix ENOENT: no such file or directory, open '/tmp/docker-stub.input'
  test.skip("with local bundling returning false", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        local: {
          tryBundle(_bundleDir: string): boolean {
            return false;
          },
        },
      },
    });

    // THEN
    expect(readDockerStubInput()).toBeDefined();
  });

  // TODO: Fix ENOENT: no such file or directory, open '/tmp/docker-stub.input'
  test.skip("bundling can be skipped by setting context", () => {
    // GIVEN
    // stack.node.setContext(cxapi.BUNDLING_STACKS, ["OtherStack"]);
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const asset = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      assetHashType: AssetHashType.OUTPUT,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
    });

    expect(() => readDockerStubInput()).toThrow(); // Bundling did not run
    expect(asset.sourcePath).toEqual(directory);
    expect(asset.stagedPath).toEqual(directory);
    expect(asset.relativeStagedPath(stack)).toEqual(directory);
    expect(asset.assetHash).toEqual(
      "f66d7421aa2d044a6c1f60ddfc76dc78571fcd8bd228eb48eb394e2dbad94a5c",
    );
  });

  // test("correctly skips bundling with stack under stage", () => {
  //   // GIVEN
  //   const app = new App();

  //   const stage = new Stage(app, "Stage");
  //   stage.node.setContext(cxapi.BUNDLING_STACKS, ["Stage/Stack1"]);

  //   const stack1 = new StackBase(stage, "Stack1");
  //   const stack2 = new StackBase(stage, "Stack2");
  //   const directory = path.join(__dirname, "fs", "fixtures", "test1");

  //   new AssetStaging(stack1, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //     },
  //   });

  //   new AssetStaging(stack2, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.MULTIPLE_FILES],
  //     },
  //   });

  //   const dockerStubInput = readDockerStubInputConcat();
  //   // Docker ran for the asset in Stack1
  //   expect(dockerStubInput).toMatch(DockerStubCommand.SUCCESS);
  //   // DOcker did not run for the asset in Stack2
  //   expect(dockerStubInput).not.toMatch(DockerStubCommand.MULTIPLE_FILES);
  // });

  // test("correctly skips bundling with stack under stage and custom stack name", () => {
  //   // GIVEN
  //   const app = new App();

  //   const stage = new Stage(app, "Stage");
  //   stage.node.setContext(cxapi.BUNDLING_STACKS, ["Stage/Stack1"]);

  //   const stack1 = new StackBase(stage, "Stack1", {
  //     stackName: "unrelated-stack1-name",
  //   });
  //   const stack2 = new StackBase(stage, "Stack2", {
  //     stackName: "unrelated-stack2-name",
  //   });
  //   const directory = path.join(__dirname, "fs", "fixtures", "test1");

  //   // WHEN
  //   new AssetStaging(stack1, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //     },
  //   });

  //   new AssetStaging(stack2, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.MULTIPLE_FILES],
  //     },
  //   });

  //   // THEN
  //   const dockerStubInput = readDockerStubInputConcat();
  //   // Docker ran for the asset in Stack1
  //   expect(dockerStubInput).toMatch(DockerStubCommand.SUCCESS);
  //   // Docker did not run for the asset in Stack2
  //   expect(dockerStubInput).not.toMatch(DockerStubCommand.MULTIPLE_FILES);
  // });

  // test("correctly bundles with stack under stage and the default stack pattern", () => {
  //   // GIVEN
  //   const app = new App();

  //   const stage = new Stage(app, "Stage");

  //   const stack1 = new StackBase(stage, "Stack1");
  //   const stack2 = new StackBase(stage, "Stack2");
  //   const directory = path.join(__dirname, "fs", "fixtures", "test1");

  //   // WHEN
  //   new AssetStaging(stack1, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //     },
  //   });

  //   new AssetStaging(stack2, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.MULTIPLE_FILES],
  //     },
  //   });

  //   // THEN
  //   const dockerStubInput = readDockerStubInputConcat();
  //   // Docker ran for the asset in Stack1
  //   expect(dockerStubInput).toMatch(DockerStubCommand.SUCCESS);
  //   // Docker ran for the asset in Stack2
  //   expect(dockerStubInput).toMatch(DockerStubCommand.MULTIPLE_FILES);
  // });

  // test("correctly bundles with stack under stage and partial globstar wildcard", () => {
  //   // GIVEN
  //   const app = new App();

  //   const stage = new Stage(app, "Stage");
  //   stage.node.setContext(cxapi.BUNDLING_STACKS, ["**/Stack1"]); // a single wildcard prefix ('*Stack1') won't match

  //   const stack1 = new StackBase(stage, "Stack1");
  //   const stack2 = new StackBase(stage, "Stack2");
  //   const directory = path.join(__dirname, "fs", "fixtures", "test1");

  //   // WHEN
  //   new AssetStaging(stack1, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //     },
  //   });

  //   new AssetStaging(stack2, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.MULTIPLE_FILES],
  //     },
  //   });

  //   // THEN
  //   const dockerStubInput = readDockerStubInputConcat();
  //   // Docker ran for the asset in Stack1
  //   expect(dockerStubInput).toMatch(DockerStubCommand.SUCCESS);
  //   // Docker did not run for the asset in Stack2
  //   expect(dockerStubInput).not.toMatch(DockerStubCommand.MULTIPLE_FILES);
  // });

  // test("correctly bundles selected stacks nested in Stack/Stage/Stack", () => {
  //   // GIVEN
  //   const app = new App();

  //   const topStack = new StackBase(app, "TopStack");
  //   topStack.node.setContext(cxapi.BUNDLING_STACKS, [
  //     "TopStack/MiddleStage/BottomStack",
  //   ]);

  //   const middleStage = new Stage(topStack, "MiddleStage");
  //   const bottomStack = new StackBase(middleStage, "BottomStack");
  //   const directory = path.join(__dirname, "fs", "fixtures", "test1");

  //   // WHEN
  //   new AssetStaging(bottomStack, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.SUCCESS],
  //     },
  //   });
  //   new AssetStaging(topStack, "Asset", {
  //     sourcePath: directory,
  //     assetHashType: AssetHashType.OUTPUT,
  //     bundling: {
  //       image: DockerImage.fromRegistry("alpine"),
  //       command: [DockerStubCommand.MULTIPLE_FILES],
  //     },
  //   });

  //   const dockerStubInput = readDockerStubInputConcat();
  //   // Docker ran for the asset in BottomStack
  //   expect(dockerStubInput).toMatch(DockerStubCommand.SUCCESS);
  //   // Docker did not run for the asset in TopStack
  //   expect(dockerStubInput).not.toMatch(DockerStubCommand.MULTIPLE_FILES);
  // });

  test.skip("bundling still occurs with partial wildcard", () => {
    // GIVEN
    // stack.node.setContext(cxapi.BUNDLING_STACKS, ["*Stack"]);
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const asset = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      assetHashType: AssetHashType.OUTPUT,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
    });

    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );
    expect(asset.assetHash).toEqual(
      "33cbf2cae5432438e0f046bc45ba8c3cef7b6afcf47b59d1c183775c1918fb1f",
    ); // hash of MyStack/Asset
  });

  test.skip("bundling still occurs with a single wildcard", () => {
    // GIVEN
    // stack.node.setContext(cxapi.BUNDLING_STACKS, ["*"]);
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const asset = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      assetHashType: AssetHashType.OUTPUT,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
    });

    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );
    expect(asset.assetHash).toEqual(
      "33cbf2cae5432438e0f046bc45ba8c3cef7b6afcf47b59d1c183775c1918fb1f",
    ); // hash of MyStack/Asset
  });

  test("bundling that produces a single archive file is autodiscovered", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_ARCHIVE],
      },
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        "asset.f43148c61174f444925231b5849b468f21e93b5d1469cd07c53625ffd039ef48.zip",
        "asset.f43148c61174f444925231b5849b468f21e93b5d1469cd07c53625ffd039ef48", // this is the bundle dir
      ]),
    );
    expect(
      fs.readdirSync(
        path.join(
          TEST_STAGING_DIR,
          "asset.f43148c61174f444925231b5849b468f21e93b5d1469cd07c53625ffd039ef48",
        ),
      ),
    ).toEqual([
      "test.zip", // bundle dir with "touched" bundled output file
    ]);
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(true);
  });

  test("bundling that produces a single archive file with disk cache", () => {
    // GIVEN

    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    const app2 = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR, // same OUTDIR
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, "fixtures/app/cdktf.json"),
        },
      }),
    );
    const stack2 = new MyStack(app2, "stack", {
      environmentName,
      gridUUID,
      gridBackendConfig,
    });

    // WHEN
    const staging1 = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_ARCHIVE],
        outputType: BundlingOutput.ARCHIVED,
      },
    });

    // Now clear asset hash cache to show that during the second staging
    // even though bundling is skipped it will correctly be considered
    // as a FileAssetPackaging.FILE.
    AssetStaging.clearAssetHashCache();

    const staging2 = new AssetStaging(stack2, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_ARCHIVE],
        outputType: BundlingOutput.ARCHIVED,
      },
    });

    // THEN
    expect(staging1.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging1.isArchive).toEqual(true);
    expect(staging2.packaging).toEqual(staging1.packaging);
    expect(staging2.isArchive).toEqual(staging1.isArchive);
  });

  test("bundling that produces a single archive file with NOT_ARCHIVED", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_ARCHIVE],
        outputType: BundlingOutput.NOT_ARCHIVED,
      },
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        "asset.86ec07746e1d859290cfd8b9c648e581555649c75f51f741f11e22cab6775abc",
      ]),
    );
    expect(staging.packaging).toEqual(FileAssetPackaging.ZIP_DIRECTORY);
    expect(staging.isArchive).toEqual(true);
  });

  test("throws with ARCHIVED and bundling that does not produce a single archive file", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          bundling: {
            image: DockerImage.fromRegistry("alpine"),
            command: [DockerStubCommand.MULTIPLE_FILES],
            outputType: BundlingOutput.ARCHIVED,
          },
        }),
    ).toThrow(
      /Bundling output directory is expected to include only a single file when `output` is set to `ARCHIVED` or `SINGLE_FILE`/,
    );
  });

  test("bundling that produces a single file with SINGLE_FILE", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1", "subdir");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE],
        outputType: BundlingOutput.SINGLE_FILE,
      },
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        "asset.adb7bb3f9419564842d16f48e6b90468f63ec759d2775e8e40d6a87e6b8e3469",
        "asset.adb7bb3f9419564842d16f48e6b90468f63ec759d2775e8e40d6a87e6b8e3469.txt",
      ]),
    );
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });

  test("bundling that produces a single file with SINGLE_FILE and hash type OUTPUT", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1", "subdir");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      assetHashType: AssetHashType.OUTPUT,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE],
        outputType: BundlingOutput.SINGLE_FILE,
      },
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        // 'bundling-temp-0e346bd27baa32f4f2d15d1d73c8972db3293080f6c2836328b7bf77747683db', this directory gets removed and does no longer exist
        "asset.95c924c84f5d023be4edee540cb2cb401a49f115d01ed403b288f6cb412771df.txt",
      ]),
    );
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });

  test("bundling that produces a single file with SINGLE_FILE_WITHOUT_EXT and hash type SOURCE", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE_WITHOUT_EXT],
        outputType: BundlingOutput.SINGLE_FILE,
      },
      assetHashType: AssetHashType.SOURCE, // default
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        "asset.ef734136dc22840a94140575a2f98cbc061074e09535589d1cd2c11a4ac2fd75",
        "asset.ef734136dc22840a94140575a2f98cbc061074e09535589d1cd2c11a4ac2fd75_noext",
      ]),
    );
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });

  test("bundling that produces a single file with SINGLE_FILE_WITHOUT_EXT and hash type CUSTOM", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE_WITHOUT_EXT],
        outputType: BundlingOutput.SINGLE_FILE,
      },
      assetHashType: AssetHashType.CUSTOM,
      assetHash: "custom",
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        "asset.f81c5ba9e81eebb202881a8e61a83ab4b69f6bee261989eb93625c9cf5d35335",
        "asset.f81c5ba9e81eebb202881a8e61a83ab4b69f6bee261989eb93625c9cf5d35335_noext",
      ]),
    );
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });
});

describe("staging with docker cp", () => {
  let stack: MyStack;
  let app: App;
  beforeAll(() => {
    // this is a way to provide a custom "docker" command for staging.
    process.env.CDK_DOCKER = `${__dirname}/docker-stub-cp.sh`;
  });

  afterAll(() => {
    delete process.env.CDK_DOCKER;
    // clear the tcons staging directory
    fs.rmSync(TEST_STAGING_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_OUTDIR)) {
      fs.rmSync(TEST_OUTDIR, { recursive: true, force: true });
    }
    app = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR,
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, "fixtures/app/cdktf.json"),
        },
      }),
    );
    stack = new MyStack(app, "TestStack", {
      environmentName,
      gridUUID,
      gridBackendConfig,
    });
  });

  afterEach(() => {
    AssetStaging.clearAssetHashCache();
    if (fs.existsSync(STUB_INPUT_CP_FILE)) {
      fs.unlinkSync(STUB_INPUT_CP_FILE);
    }
    if (fs.existsSync(STUB_INPUT_CP_CONCAT_FILE)) {
      fs.unlinkSync(STUB_INPUT_CP_CONCAT_FILE);
    }
    jest.restoreAllMocks();
  });

  test("bundling with docker image copy variant", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        "asset.0ec371a2022d29dfd83f5df104e0f01b34233a4e3e839c3c4ec62008f0b9a0e8", // this is the bundle dir
        "asset.0ec371a2022d29dfd83f5df104e0f01b34233a4e3e839c3c4ec62008f0b9a0e8.zip",
      ]),
    );
    expect(
      fs.readdirSync(
        path.join(
          TEST_STAGING_DIR,
          "asset.0ec371a2022d29dfd83f5df104e0f01b34233a4e3e839c3c4ec62008f0b9a0e8",
        ),
      ),
    ).toEqual([
      "test.zip", // bundle dir with "touched" bundled output file
    ]);
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(true);
    const dockerCalls: string[] = readDockerStubInputConcat(
      STUB_INPUT_CP_CONCAT_FILE,
    ).split(/\r?\n/);
    expect(dockerCalls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("volume create assetInput"),
        expect.stringContaining("volume create assetOutput"),
        expect.stringMatching(
          "run --name copyContainer.* -v /input:/asset-input -v /output:/asset-output public.ecr.aws/docker/library/alpine sh -c mkdir -p /asset-input && chown -R .* /asset-output && chown -R .* /asset-input",
        ),
        expect.stringMatching(
          "cp .*fs/fixtures/test1/. copyContainer.*:/asset-input",
        ),
        expect.stringMatching(
          "run --rm -u .* --volumes-from copyContainer.* -w /asset-input alpine DOCKER_STUB_VOLUME_SINGLE_ARCHIVE",
        ),
        expect.stringMatching("cp copyContainer.*:/asset-output/. .*"),
        expect.stringContaining("rm copyContainer"),
        expect.stringContaining("volume rm assetInput"),
        expect.stringContaining("volume rm assetOutput"),
      ]),
    );
  });

  test("bundling that produces a single file with docker image copy variant and hash type SOURCE", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE_WITHOUT_EXT],
        outputType: BundlingOutput.SINGLE_FILE,
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
      assetHashType: AssetHashType.SOURCE, // default
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        "asset.93bd4079bff7440a725991ecf249416ae9ad73cb639f4a8d9e8f3ad8d491e89f",
        "asset.93bd4079bff7440a725991ecf249416ae9ad73cb639f4a8d9e8f3ad8d491e89f_noext",
      ]),
    );
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });

  test("bundling that produces a single file with docker image copy variant and hash type CUSTOM", () => {
    // GIVEN
    const directory = path.join(__dirname, "fs", "fixtures", "test1");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE_WITHOUT_EXT],
        outputType: BundlingOutput.SINGLE_FILE,
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
      assetHashType: AssetHashType.CUSTOM,
      assetHash: "custom",
    });

    // THEN
    // const stackDir = getSynthDir(app, stack);
    expect(fs.readdirSync(TEST_STAGING_DIR)).toEqual(
      expect.arrayContaining([
        "asset.53a51b4c68874a8e831e24e8982120be2a608f50b2e05edb8501143b3305baa8",
        "asset.53a51b4c68874a8e831e24e8982120be2a608f50b2e05edb8501143b3305baa8_noext",
      ]),
    );
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });
});

// function getSynthDir(app: App, stack: MyStack) {
//   app.synth();
//   const assembly = app.manifest.forStack(stack);
//   const stackDir = path.join(app.outdir, assembly.workingDirectory);
//   return stackDir;
// }

// Reads a docker stub and cleans the volume paths out of the stub.
function readAndCleanDockerStubInput(file: string) {
  return fs
    .readFileSync(file, "utf-8")
    .trim()
    .replace(/-v ([^:]+):\/asset-input/g, "-v /input:/asset-input")
    .replace(/-v ([^:]+):\/asset-output/g, "-v /output:/asset-output");
}

// Last docker input since last teardown
function readDockerStubInput(file?: string) {
  return readAndCleanDockerStubInput(file ?? STUB_INPUT_FILE);
}
// Concatenated docker inputs since last teardown
function readDockerStubInputConcat(file?: string) {
  return readAndCleanDockerStubInput(file ?? STUB_INPUT_CONCAT_FILE);
}
