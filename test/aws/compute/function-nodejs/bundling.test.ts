// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-lambda-nodejs/test/bundling.test.ts

/* eslint-disable @typescript-eslint/unbound-method */
import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { version as delayVersion } from "delay/package.json";
import {
  AssetHashType,
  BundlingFileAccess,
  DockerImage,
} from "../../../../src";
import { AwsStack } from "../../../../src/aws/aws-stack";
import {
  Architecture,
  Code,
  Runtime,
  RuntimeFamily,
} from "../../../../src/aws/compute";
import { Bundling } from "../../../../src/aws/compute/function-nodejs/bundling";
import { PackageInstallation } from "../../../../src/aws/compute/function-nodejs/package-installation";
import {
  Charset,
  EsbuildLogLevel,
  OutputFormat,
  SourceMapMode,
} from "../../../../src/aws/compute/function-nodejs/types";
import * as util from "../../../../src/aws/compute/function-nodejs/util";
import * as storage from "../../../../src/aws/storage";
import { Annotations } from "../../../assertions";

jest.mock("child_process");

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const STANDARD_RUNTIME = Runtime.NODEJS_18_X;
const STANDARD_TARGET = "node18";
const STANDARD_EXTERNAL = "@aws-sdk/*";
const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const CDKTFJSON_PATH = path.join(TEST_APPDIR, "cdktf.json");

let detectPackageInstallationMock: jest.SpyInstance<
  PackageInstallation | undefined
>;

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

  jest.clearAllMocks();
  jest.resetAllMocks();
  jest.restoreAllMocks();
  Bundling.clearEsbuildInstallationCache();
  Bundling.clearTscInstallationCache();

  jest.spyOn(Code, "fromAsset");

  detectPackageInstallationMock = jest
    .spyOn(PackageInstallation, "detect")
    .mockReturnValue({
      isLocal: true,
      version: "0.8.8",
    });

  jest.spyOn(DockerImage, "fromBuild").mockReturnValue({
    image: "built-image",
    cp: () => "dest-path",
    run: () => {},
    toJSON: () => "built-image",
  });
});

let projectRoot = "/project";
let depsLockFilePath = "/project/yarn.lock";
let entry = "/project/lib/handler.ts";
let tsconfig = "/project/lib/custom-tsconfig.ts";

test("esbuild bundling in Docker", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    environment: {
      KEY: "value",
    },
    loader: {
      ".png": "dataurl",
    },
    forceDockerBundling: true,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      environment: {
        KEY: "value",
      },
      command: [
        "bash",
        "-c",
        `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js" --external:${STANDARD_EXTERNAL} --external:@smithy/* --loader:.png=dataurl`,
      ],
      workingDirectory: "/",
    }),
  });

  // TODO: should this point to lib folder?
  expect(DockerImage.fromBuild).toHaveBeenCalledWith(
    expect.stringMatching(/aws\/compute\/function-nodejs$/),
    expect.objectContaining({
      buildArgs: expect.objectContaining({
        IMAGE: expect.stringMatching(/build-nodejs/),
      }),
      platform: "linux/amd64",
    }),
  );
});

test("esbuild bundling with handler named index.ts", () => {
  Bundling.bundle(stack, {
    entry: "/project/lib/index.ts",
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        `esbuild --bundle "/asset-input/lib/index.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js" --external:${STANDARD_EXTERNAL} --external:@smithy/*`,
      ],
    }),
  });
});

test("esbuild bundling with verbose log level", () => {
  Bundling.bundle(stack, {
    entry: "/project/lib/index.ts",
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
    logLevel: EsbuildLogLevel.VERBOSE,
  });

  // Correctly bundles with esbuild with log level VERBOSE
  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        `esbuild --bundle "/asset-input/lib/index.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js" --external:${STANDARD_EXTERNAL} --external:@smithy/* --log-level=verbose`,
      ],
    }),
  });
});

test("esbuild bundling with tsx handler", () => {
  Bundling.bundle(stack, {
    entry: "/project/lib/handler.tsx",
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        `esbuild --bundle "/asset-input/lib/handler.tsx" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js" --external:${STANDARD_EXTERNAL} --external:@smithy/*`,
      ],
    }),
  });
});

// TODO: Fix Windows tests
test.skip("esbuild with Windows paths", () => {
  const osPlatformMock = jest.spyOn(os, "platform").mockReturnValue("win32");
  // Mock path.basename() because it cannot extract the basename of a Windows
  // path when running on Linux
  jest.spyOn(path, "basename").mockReturnValueOnce("package-lock.json");
  jest
    .spyOn(path, "relative")
    .mockReturnValueOnce("lib\\entry.ts")
    .mockReturnValueOnce("package-lock.json");

  Bundling.bundle(stack, {
    entry: "C:\\my-project\\lib\\entry.ts",
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    projectRoot: "C:\\my-project",
    depsLockFilePath: "C:\\my-project\\package-lock.json",
    forceDockerBundling: true,
  });

  expect(Code.fromAsset).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      bundling: expect.objectContaining({
        command: expect.arrayContaining([
          expect.stringContaining("/lib/entry.ts"),
        ]),
      }),
    }),
  );

  osPlatformMock.mockRestore();
});

test("esbuild bundling with externals and dependencies", () => {
  const packageLock = path.join(__dirname, "..", "package-lock.json");
  Bundling.bundle(stack, {
    entry: __filename,
    projectRoot: path.dirname(packageLock),
    depsLockFilePath: packageLock,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    externalModules: ["abc"],
    nodeModules: ["delay"],
    forceDockerBundling: true,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(packageLock), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        [
          `esbuild --bundle "/asset-input/function-nodejs/bundling.test.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js" --external:abc --external:delay`,
          `echo \'{\"dependencies\":{\"delay\":\"^${delayVersion}\"}}\' > "/asset-output/package.json"`,
          'cp "/asset-input/package-lock.json" "/asset-output/package-lock.json"',
          'cd "/asset-output"',
          "npm ci",
        ].join(" && "),
      ],
    }),
  });
});

test("esbuild bundling with esbuild options", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    minify: true,
    sourceMap: true,
    sourcesContent: false,
    target: "es2020",
    loader: {
      ".png": "dataurl",
    },
    logLevel: EsbuildLogLevel.SILENT,
    keepNames: true,
    tsconfig,
    metafile: true,
    banner: "/* comments */",
    footer: "/* comments */",
    charset: Charset.UTF8,
    forceDockerBundling: true,
    mainFields: ["module", "main"],
    define: {
      "process.env.KEY": JSON.stringify("VALUE"),
      "process.env.BOOL": "true",
      "process.env.NUMBER": "7777",
      "process.env.STRING": JSON.stringify('this is a "test"'),
    },
    format: OutputFormat.ESM,
    inject: ["./my-shim.js", "./path with space/second-shim.js"],
    esbuildArgs: {
      "--log-limit": "0",
      "--resolve-extensions": ".ts,.js",
      "--splitting": true,
      "--keep-names": "",
      "--out-extension": ".js=.mjs",
    },
  });

  // Correctly bundles with esbuild
  const defineInstructions =
    '--define:process.env.KEY="\\"VALUE\\"" --define:process.env.BOOL="true" --define:process.env.NUMBER="7777" --define:process.env.STRING="\\"this is a \\\\\\"test\\\\\\"\\""';
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        [
          'esbuild --bundle "/asset-input/lib/handler.ts"',
          '--target=es2020 --platform=node --format=esm --outfile="/asset-output/index.mjs"',
          `--minify --sourcemap --sources-content=false --external:${STANDARD_EXTERNAL} --external:@smithy/* --loader:.png=dataurl`,
          defineInstructions,
          '--log-level=silent --keep-names --tsconfig="/asset-input/lib/custom-tsconfig.ts"',
          '--metafile="/asset-output/index.meta.json" --banner:js="/* comments */" --footer:js="/* comments */"',
          '--main-fields=module,main --inject:"./my-shim.js" --inject:"./path with space/second-shim.js"',
          '--log-limit="0" --resolve-extensions=".ts,.js" --splitting --keep-names --out-extension:".js=.mjs"',
        ].join(" "),
      ],
    }),
  });

  const actualChildProcess =
    jest.requireActual<typeof child_process>("child_process");
  const spawnSyncSpy = jest
    .spyOn(child_process, "spawnSync")
    .mockImplementation(actualChildProcess.spawnSync);

  // Make sure that the define instructions are working as expected with the esbuild CLI
  const bundleProcess = util.exec("bash", [
    "-c",
    `npx esbuild --bundle ${`${__dirname}/handlers/define.ts`} ${defineInstructions}`,
  ]);
  expect(bundleProcess.stdout.toString()).toMatchSnapshot();
  spawnSyncSpy.mockRestore();
});

test("throws with ESM and NODEJS_12_X", () => {
  expect(() =>
    Bundling.bundle(stack, {
      entry,
      projectRoot,
      depsLockFilePath,
      runtime: Runtime.NODEJS_12_X,
      architecture: Architecture.X86_64,
      format: OutputFormat.ESM,
    }),
  ).toThrow(
    /ECMAScript module output format is not supported by the nodejs12.x runtime/,
  );
});

test("esbuild bundling source map default", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    sourceMap: true,
    sourceMapMode: SourceMapMode.DEFAULT,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        [
          `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js"`,
          `--sourcemap --external:${STANDARD_EXTERNAL} --external:@smithy/*`,
        ].join(" "),
      ],
    }),
  });
});

test.each([
  [Runtime.NODEJS_18_X, "node18"],
  [Runtime.NODEJS_20_X, "node20"],
])(
  "esbuild bundling without aws-sdk v3 and smithy with feature flag enabled using Node 18+",
  (runtime, target) => {
    const cdkApp = new App({
      context: {
        "@aws-cdk/aws-lambda-nodejs:sdkV3ExcludeSmithyPackages": true,
      },
    });
    const cdkStack = new AwsStack(cdkApp, "MyTestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    Bundling.bundle(cdkStack, {
      entry,
      projectRoot,
      depsLockFilePath,
      runtime: runtime,
      architecture: Architecture.X86_64,
    });

    // Correctly bundles with esbuild
    expect(Code.fromAsset).toHaveBeenCalledWith(
      path.dirname(depsLockFilePath),
      {
        assetHashType: AssetHashType.OUTPUT,
        bundling: expect.objectContaining({
          command: [
            "bash",
            "-c",
            `esbuild --bundle "/asset-input/lib/handler.ts" --target=${target} --platform=node --outfile="/asset-output/index.js" --external:@aws-sdk/* --external:@smithy/*`,
          ],
        }),
      },
    );
  },
);

test("esbuild bundling with bundleAwsSdk true with feature flag enabled using Node 18+", () => {
  const cdkApp = new App({
    context: {
      "@aws-cdk/aws-lambda-nodejs:sdkV3ExcludeSmithyPackages": true,
    },
  });
  const cdkStack = new AwsStack(cdkApp, "MyTestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  Bundling.bundle(cdkStack, {
    entry,
    projectRoot,
    depsLockFilePath,
    bundleAwsSDK: true,
    runtime: Runtime.NODEJS_18_X,
    architecture: Architecture.X86_64,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js"`,
      ],
    }),
  });
});

test("esbuild bundling with feature flag enabled using Node Latest", () => {
  const cdkApp = new App({
    context: {
      "@aws-cdk/aws-lambda-nodejs:sdkV3ExcludeSmithyPackages": true,
    },
  });
  const cdkStack = new AwsStack(cdkApp, "MyTestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  Bundling.bundle(cdkStack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_LATEST,
    architecture: Architecture.X86_64,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js"`,
      ],
    }),
  });
});

test("esbuild bundling with feature flag enabled using Node 16", () => {
  const cdkApp = new App({
    context: {
      "@aws-cdk/aws-lambda-nodejs:sdkV3ExcludeSmithyPackages": true,
    },
  });
  const cdkStack = new AwsStack(cdkApp, "MyTestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  Bundling.bundle(cdkStack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_16_X,
    architecture: Architecture.X86_64,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        'esbuild --bundle "/asset-input/lib/handler.ts" --target=node16 --platform=node --outfile="/asset-output/index.js" --external:aws-sdk',
      ],
    }),
  });
});

test("esbuild bundling without aws-sdk v3 when use greater than or equal Runtime.NODEJS_18_X", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_18_X,
    architecture: Architecture.X86_64,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js" --external:@aws-sdk/* --external:@smithy/*`,
      ],
    }),
  });
});

test("esbuild bundling includes aws-sdk", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_18_X,
    architecture: Architecture.X86_64,
    bundleAwsSDK: true,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js"`,
      ],
    }),
  });
});

test("esbuild bundling source map inline", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    sourceMap: true,
    sourceMapMode: SourceMapMode.INLINE,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        [
          `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js"`,
          `--sourcemap=inline --external:${STANDARD_EXTERNAL} --external:@smithy/*`,
        ].join(" "),
      ],
    }),
  });
});

test("esbuild bundling is correctly done with custom runtime matching predefined runtime", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: new Runtime(STANDARD_RUNTIME.name, RuntimeFamily.NODEJS, {
      supportsInlineCode: true,
    }),
    architecture: Architecture.X86_64,
    sourceMapMode: SourceMapMode.INLINE,
  });

  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        [
          `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js"`,
          `--sourcemap=inline --external:${STANDARD_EXTERNAL} --external:@smithy/*`,
        ].join(" "),
      ],
    }),
  });
});

test("esbuild bundling source map enabled when only source map mode exists", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    sourceMapMode: SourceMapMode.INLINE,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        [
          `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js"`,
          `--sourcemap=inline --external:${STANDARD_EXTERNAL} --external:@smithy/*`,
        ].join(" "),
      ],
    }),
  });
});

test("esbuild bundling throws when sourceMapMode used with false sourceMap", () => {
  expect(() => {
    Bundling.bundle(stack, {
      entry,
      projectRoot,
      depsLockFilePath,
      runtime: STANDARD_RUNTIME,
      architecture: Architecture.X86_64,
      sourceMap: false,
      sourceMapMode: SourceMapMode.INLINE,
    });
  }).toThrow("sourceMapMode cannot be used when sourceMap is false");
});

test("Detects yarn.lock", () => {
  const yarnLock = path.join(__dirname, "..", "yarn.lock");
  Bundling.bundle(stack, {
    entry: __filename,
    projectRoot: path.dirname(yarnLock),
    depsLockFilePath: yarnLock,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    nodeModules: ["delay"],
    forceDockerBundling: true,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(yarnLock), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: expect.arrayContaining([
        expect.stringMatching(/yarn\.lock.+yarn install --no-immutable/),
      ]),
    }),
  });
});

test("Detects pnpm-lock.yaml", () => {
  const pnpmLock = "/project/pnpm-lock.yaml";
  Bundling.bundle(stack, {
    entry: __filename,
    projectRoot,
    depsLockFilePath: pnpmLock,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    nodeModules: ["delay"],
    forceDockerBundling: true,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(pnpmLock), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: expect.arrayContaining([
        expect.stringMatching(
          /echo '' > "\/asset-output\/pnpm-workspace.yaml\".+pnpm-lock\.yaml.+pnpm install --config.node-linker=hoisted --config.package-import-method=clone-or-copy --no-prefer-frozen-lockfile && rm -f "\/asset-output\/node_modules\/.modules.yaml"/,
        ),
      ]),
    }),
  });
});

test("Detects bun.lockb", () => {
  const bunLock = path.join(__dirname, "..", "bun.lockb");
  Bundling.bundle(stack, {
    entry: __filename,
    projectRoot: path.dirname(bunLock),
    depsLockFilePath: bunLock,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    nodeModules: ["delay"],
    forceDockerBundling: true,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(bunLock), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: expect.arrayContaining([
        expect.stringMatching(/bun\.lockb.+bun install/),
      ]),
    }),
  });
});

test("with Docker build args", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    buildArgs: {
      HELLO: "WORLD",
    },
    forceDockerBundling: true,
  });

  expect(DockerImage.fromBuild).toHaveBeenCalledWith(
    expect.stringMatching(/function-nodejs$/),
    expect.objectContaining({
      buildArgs: expect.objectContaining({
        HELLO: "WORLD",
      }),
    }),
  );
});

test("Local bundling", () => {
  const spawnSyncMock = jest.spyOn(child_process, "spawnSync").mockReturnValue({
    status: 0,
    stderr: Buffer.from("stderr"),
    stdout: Buffer.from("stdout"),
    pid: 123,
    output: ["stdout", "stderr"],
    signal: null,
  });

  const bundler = new Bundling(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    environment: {
      KEY: "value",
    },
    logLevel: EsbuildLogLevel.ERROR,
  });

  expect(bundler.local).toBeDefined();

  const tryBundle = bundler.local?.tryBundle("/outdir", {
    image: STANDARD_RUNTIME.bundlingImage,
  });
  expect(tryBundle).toBe(true);

  expect(spawnSyncMock).toHaveBeenCalledWith(
    "bash",
    expect.arrayContaining(["-c", expect.stringContaining(entry)]),
    expect.objectContaining({
      env: expect.objectContaining({ KEY: "value" }),
      cwd: "/project",
    }),
  );

  // Docker image is not built
  expect(DockerImage.fromBuild).not.toHaveBeenCalled();

  spawnSyncMock.mockRestore();
});

test("Incorrect esbuild version", () => {
  detectPackageInstallationMock.mockReturnValueOnce({
    isLocal: true,
    version: "3.4.5",
  });

  const bundler = new Bundling(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
  });

  expect(() =>
    bundler.local?.tryBundle("/outdir", {
      image: STANDARD_RUNTIME.bundlingImage,
    }),
  ).toThrow(/Expected esbuild version 0.x but got 3.4.5/);
});

test("Custom bundling docker image", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    dockerImage: DockerImage.fromRegistry("my-custom-image"),
    forceDockerBundling: true,
  });

  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      image: { image: "my-custom-image" },
    }),
  });
});

test("with command hooks", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    commandHooks: {
      beforeBundling(inputDir: string, outputDir: string): string[] {
        return [
          `echo hello > ${inputDir}/a.txt`,
          `cp ${inputDir}/a.txt ${outputDir}`,
        ];
      },
      afterBundling(inputDir: string, outputDir: string): string[] {
        return [`cp ${inputDir}/b.txt ${outputDir}/txt`];
      },
      beforeInstall() {
        return [];
      },
    },
    forceDockerBundling: true,
  });

  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(depsLockFilePath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        expect.stringMatching(
          /^echo hello > \/asset-input\/a.txt && cp \/asset-input\/a.txt \/asset-output && .+ && cp \/asset-input\/b.txt \/asset-output\/txt$/,
        ),
      ],
    }),
  });
});

test("esbuild bundling with projectRoot", () => {
  Bundling.bundle(stack, {
    entry: "/project/lib/index.ts",
    projectRoot: "/project",
    depsLockFilePath,
    tsconfig,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        `esbuild --bundle "/asset-input/lib/index.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js" --external:${STANDARD_EXTERNAL} --external:@smithy/* --tsconfig="/asset-input/lib/custom-tsconfig.ts"`,
      ],
    }),
  });
});

test("esbuild bundling with projectRoot and externals and dependencies", () => {
  const repoRoot = path.join(__dirname, "..", "..", "..", "..");
  const packageLock = path.join(repoRoot, "pnpm-lock.yaml");
  Bundling.bundle(stack, {
    entry: __filename,
    projectRoot: repoRoot,
    depsLockFilePath: packageLock,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    externalModules: ["abc"],
    nodeModules: ["delay"],
    forceDockerBundling: true,
  });

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(repoRoot, {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        [
          `esbuild --bundle "/asset-input/test/aws/compute/function-nodejs/bundling.test.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js" --external:abc --external:delay`,
          `echo '' > "/asset-output/pnpm-workspace.yaml"`,
          `echo '{"dependencies":{"delay":"^${delayVersion}"}}' > "/asset-output/package.json"`,
          'cp "/asset-input/pnpm-lock.yaml" "/asset-output/pnpm-lock.yaml"',
          'cd "/asset-output"',
          "pnpm install --config.node-linker=hoisted --config.package-import-method=clone-or-copy --no-prefer-frozen-lockfile",
          'rm -f "/asset-output/node_modules/.modules.yaml"',
        ].join(" && "),
      ],
    }),
  });
});

// TODO: Fix test filesystem, this test fails trying to require non json file.
test.skip("esbuild bundling with pre compilations", () => {
  const packageLock = path.join(__dirname, "..", "package-lock.json");

  Bundling.bundle(stack, {
    entry: __filename.replace(".js", ".ts"),
    projectRoot: path.dirname(packageLock),
    depsLockFilePath: packageLock,
    runtime: STANDARD_RUNTIME,
    preCompilation: true,
    forceDockerBundling: true,
    architecture: Architecture.X86_64,
  });

  const compilerOptions = util.getTsconfigCompilerOptions(
    findParentTsConfigPath(__dirname),
  );

  // Correctly bundles with esbuild
  expect(Code.fromAsset).toHaveBeenCalledWith(path.dirname(packageLock), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      command: [
        "bash",
        "-c",
        [
          `tsc \"/asset-input/test/bundling.test.ts\" ${compilerOptions} &&`,
          `esbuild --bundle \"/asset-input/test/bundling.test.js\" --target=${STANDARD_TARGET} --platform=node --outfile=\"/asset-output/index.js\" --external:${STANDARD_EXTERNAL} --external:@smithy/*`,
        ].join(" "),
      ],
    }),
  });

  expect(detectPackageInstallationMock).toHaveBeenCalledWith("typescript");
});

test("throws with pre compilation and not found tsconfig", () => {
  expect(() => {
    Bundling.bundle(stack, {
      entry,
      projectRoot,
      depsLockFilePath,
      runtime: STANDARD_RUNTIME,
      forceDockerBundling: true,
      preCompilation: true,
      architecture: Architecture.X86_64,
    });
  }).toThrow(
    "Cannot find a `tsconfig.json` but `preCompilation` is set to `true`, please specify it via `tsconfig`",
  );
});

// // TODO: Support custom hash?
// test("with custom hash", () => {
//   Bundling.bundle(stack, {
//     entry,
//     projectRoot,
//     depsLockFilePath,
//     runtime: STANDARD_RUNTIME,
//     forceDockerBundling: true,
//     assetHash: "custom",
//     architecture: Architecture.X86_64,
//   });

//   // Correctly passes asset hash options
//   expect(Code.fromAsset).toHaveBeenCalledWith(
//     path.dirname(depsLockFilePath),
//     {
//       // assetHash: "custom",
//       // assetHashType: AssetHashType.CUSTOM,
//     },
//   );
// });

test("Custom bundling entrypoint", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
    entrypoint: ["/cool/entrypoint", "--cool-entrypoint-arg"],
  });

  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      entrypoint: ["/cool/entrypoint", "--cool-entrypoint-arg"],
    }),
  });
});

test("Custom bundling volumes", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
    volumes: [{ hostPath: "/host-path", containerPath: "/container-path" }],
  });

  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      volumes: [{ hostPath: "/host-path", containerPath: "/container-path" }],
    }),
  });
});

test("Custom bundling volumesFrom", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
    volumesFrom: ["777f7dc92da7"],
  });

  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      volumesFrom: ["777f7dc92da7"],
    }),
  });
});

test("Custom bundling workingDirectory", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
    workingDirectory: "/working-directory",
  });

  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      workingDirectory: "/working-directory",
    }),
  });
});

test("Custom bundling user", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
    user: "user:group",
  });

  expect(Code.fromAsset).toHaveBeenCalledWith("/project", {
    assetHashType: AssetHashType.OUTPUT,
    bundling: expect.objectContaining({
      user: "user:group",
    }),
  });
});

test("Custom bundling securityOpt", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
    securityOpt: "no-new-privileges",
  });

  expect(Code.fromAsset).toHaveBeenCalledWith(
    "/project",
    expect.objectContaining({
      // assetHashType: AssetHashType.OUTPUT,
      bundling: expect.objectContaining({
        securityOpt: "no-new-privileges",
      }),
    }),
  );
});

test("Custom bundling network", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
    network: "host",
  });

  expect(Code.fromAsset).toHaveBeenCalledWith(
    "/project",
    expect.objectContaining({
      // assetHashType: AssetHashType.OUTPUT,
      bundling: expect.objectContaining({
        network: "host",
      }),
    }),
  );
});

test("Custom bundling file copy variant", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: STANDARD_RUNTIME,
    architecture: Architecture.X86_64,
    forceDockerBundling: true,
    bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
  });

  expect(Code.fromAsset).toHaveBeenCalledWith(
    "/project",
    expect.objectContaining({
      // assetHashType: AssetHashType.OUTPUT,
      bundling: expect.objectContaining({
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      }),
    }),
  );
});

test("bundling using NODEJS_LATEST doesn't externalize anything by default", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_LATEST,
    architecture: Architecture.X86_64,
  });

  expect(Code.fromAsset).toHaveBeenCalledWith(
    "/project",
    expect.objectContaining({
      // assetHashType: AssetHashType.OUTPUT,
      bundling: expect.objectContaining({
        command: [
          "bash",
          "-c",
          `esbuild --bundle "/asset-input/lib/handler.ts" --target=${STANDARD_TARGET} --platform=node --outfile="/asset-output/index.js"`,
        ],
      }),
    }),
  );
});

test("bundling with <= Node16 warns when sdk v3 is external", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_16_X,
    architecture: Architecture.X86_64,
    externalModules: ["@aws-sdk/client-s3"],
  });

  // [ack: @aws-cdk/aws-lambda-nodejs:sdkV3NotInRuntime]
  Annotations.fromStack(stack).hasWarnings({
    message:
      "If you are relying on AWS SDK v3 to be present in the Lambda environment already, please explicitly configure a NodeJS runtime of Node 18 or higher.",
  });
});

test("bundling with <= Node16 does not warn with default externalModules", () => {
  const myStack = new AwsStack(app, "MyTestStack2", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  Bundling.bundle(myStack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_16_X,
    architecture: Architecture.X86_64,
  });

  // [ack: @aws-cdk/aws-lambda-nodejs:sdkV3NotInRuntime]
  Annotations.fromStack(myStack).hasNoWarnings({
    message:
      "If you are relying on AWS SDK v3 to be present in the Lambda environment already, please explicitly configure a NodeJS runtime of Node 18 or higher.",
  });
  // [ack: @aws-cdk/aws-lambda-nodejs:sdkV2NotInRuntime]
  Annotations.fromStack(myStack).hasNoWarnings({
    message:
      "If you are relying on AWS SDK v2 to be present in the Lambda environment already, please explicitly configure a NodeJS runtime of Node 16 or lower.",
  });
});

test("bundling with >= Node18 warns when sdk v2 is external", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_18_X,
    architecture: Architecture.X86_64,
    externalModules: ["aws-sdk"],
  });

  // [ack: @aws-cdk/aws-lambda-nodejs:sdkV2NotInRuntime]
  Annotations.fromStack(stack).hasWarnings({
    message:
      "If you are relying on AWS SDK v2 to be present in the Lambda environment already, please explicitly configure a NodeJS runtime of Node 16 or lower.",
  });
});

test("bundling with >= Node18 does not warn with default externalModules", () => {
  const myStack = new AwsStack(app, "MyTestStack3", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  Bundling.bundle(myStack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_18_X,
    architecture: Architecture.X86_64,
  });

  // [ack: @aws-cdk/aws-lambda-nodejs:sdkV3NotInRuntime]
  Annotations.fromStack(myStack).hasNoWarnings({
    message:
      "If you are relying on AWS SDK v3 to be present in the Lambda environment already, please explicitly configure a NodeJS runtime of Node 18 or higher.",
  });
  // [ack: @aws-cdk/aws-lambda-nodejs:sdkV2NotInRuntime]
  Annotations.fromStack(myStack).hasNoWarnings({
    message:
      "If you are relying on AWS SDK v2 to be present in the Lambda environment already, please explicitly configure a NodeJS runtime of Node 16 or lower.",
  });
});

test("bundling with NODEJS_LATEST warns when any dependencies are external", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_LATEST,
    architecture: Architecture.X86_64,
    externalModules: ["my-external-dep"],
  });

  // [ack: @aws-cdk/aws-lambda-nodejs:variableRuntimeExternals]
  Annotations.fromStack(stack).hasWarnings({
    message:
      "When using NODEJS_LATEST the runtime version may change as new runtimes are released, this may affect the availability of packages shipped with the environment. Ensure that any external dependencies are available through layers or specify a specific runtime version.",
  });
});

test("Node 16 runtimes warn about sdk v2 upgrades", () => {
  Bundling.bundle(stack, {
    entry,
    projectRoot,
    depsLockFilePath,
    runtime: Runtime.NODEJS_16_X,
    architecture: Architecture.X86_64,
  });

  // [ack: aws-cdk-lib/aws-lambda-nodejs:runtimeUpdateSdkV2Breakage]
  Annotations.fromStack(stack).hasWarnings({
    message:
      "Be aware that the NodeJS runtime of Node 16 will be deprecated by Lambda on June 12, 2024. Lambda runtimes Node 18 and higher include SDKv3 and not SDKv2. Updating your Lambda runtime will require bundling the SDK, or updating all SDK calls in your handler code to use SDKv3 (which is not a trivial update). Please account for this added complexity and update as soon as possible.",
  });
});

function findParentTsConfigPath(
  dir: string,
  depth: number = 1,
  limit: number = 5,
): string {
  const target = path.join(dir, "tsconfig.json");
  if (fs.existsSync(target)) {
    return target;
  } else if (depth < limit) {
    return findParentTsConfigPath(path.join(dir, ".."), depth + 1, limit);
  }

  throw new Error(
    `No \`package.json\` file found within ${depth} parent directories`,
  );
}
