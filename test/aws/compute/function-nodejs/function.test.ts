// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-lambda-nodejs/test/function.test.ts

/* eslint-disable @typescript-eslint/unbound-method */
import * as child_process from "child_process";
import * as path from "path";
import { lambdaFunction } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import bockfs from "./bockfs";
import { AwsStack } from "../../../../src/aws/aws-stack";
import { Vpc, Code, CodeConfig, Runtime } from "../../../../src/aws/compute";
// import { LAMBDA_NODEJS_USE_LATEST_RUNTIME } from "../../cx-api";
import { NodejsFunction } from "../../../../src/aws/compute/function-nodejs";
import { Bundling } from "../../../../src/aws/compute/function-nodejs/bundling";
import { Annotations, Template } from "../../../assertions";

jest.mock("child_process");

jest.mock("../../../../src/aws/compute/function-nodejs/bundling", () => {
  return {
    Bundling: {
      bundle: jest.fn().mockReturnValue({
        bind: (): CodeConfig => {
          return {
            s3Location: {
              bucketName: "my-bucket",
              objectKey: "my-key",
            },
          };
        },
        // TODO: Implement CLI for local lambda invocation mocking
        // bindToResource: () => {
        //   return;
        // },
      }),
    },
  };
});

const mockCallsites = jest.fn();
jest.mock("../../../../src/aws/compute/function-nodejs/util", () => ({
  ...jest.requireActual("../../../../src/aws/compute/function-nodejs/util"),
  callsites: () => mockCallsites(),
}));

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const CDKTFJSON_PATH = path.join(TEST_APPDIR, "cdktf.json");

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
});

// We MUST use a fake file system here.
// Using the real filesystem causes the tests to be flaky and fail at random.
// This way we are guaranteed to have the fake files setup on each test run.
bockfs({
  "/home/project/package.json": "{}",
  "/home/project/package-lock.json": "{}",
  "/home/project/handler.tsx": "// nothing",
  "/home/project/function.test.handler1.ts": "// nothing",
  "/home/project/function.test.handler2.js": "// nothing",
  "/home/project/function.test.handler3.mjs": "// nothing",
  "/home/project/function.test.handler4.mts": "// nothing",
  "/home/project/function.test.handler5.cts": "// nothing",
  "/home/project/function.test.handler6.cjs": "// nothing",
  "/home/project/function.test.handler7.zip": "// nothing",
  "/home/project/aws-lambda-nodejs/lib/index.ts": "// nothing",
});
const bockPath = bockfs.workingDirectory("/home/project");

// pretend the calling file is in a fake file path
mockCallsites.mockImplementation(() => [
  { getFunctionName: () => "NodejsFunction" },
  { getFileName: () => bockPath`function.test.ts` },
]);

afterAll(() => {
  bockfs.restore();
});

test("NodejsFunction with .ts handler", () => {
  // WHEN
  new NodejsFunction(stack, "handler1");

  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      entry: expect.stringContaining("function.test.handler1.ts"), // Automatically finds .ts handler file
    }),
  );

  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      handler: "index.handler",
      runtime: expect.stringMatching("nodejs"),
    },
  );
});

describe("lambda.Code.fromCustomCommand", () => {
  // GIVEN
  beforeEach(() => {
    jest.spyOn(child_process, "spawnSync").mockReturnValue({
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

  test("if code property is included without handler property, then error is thrown", () => {
    // WHEN
    const handlerName = undefined;

    // THEN
    expect(
      () =>
        new NodejsFunction(stack, "handler1", {
          handler: handlerName,
          code: Code.fromCustomCommand(
            "function.test.handler7.zip",
            ["node"],
            undefined,
          ),
        }),
    ).toThrow(
      "Cannot determine handler when `code` property is specified. Use `handler` property to specify a handler.\n" +
        "The handler should be the name of the exported function to be invoked and the file containing that function.\n" +
        "For example, handler should be specified in the form `myFile.myFunction`",
    );
  });

  test("if code and handler properties are included, the template can be synthesized", () => {
    // WHEN
    new NodejsFunction(stack, "handler1", {
      handler: "Random.Name",
      runtime: Runtime.NODEJS_18_X,
      code: Code.fromCustomCommand(
        // TODO: Investigate why bockPath is required here, but not in AWSCDK tests.
        bockPath`function.test.handler7.zip`,
        ["node"],
        undefined,
      ),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaFunction.LambdaFunction,
      {
        handler: "Random.Name",
        runtime: "nodejs18.x",
      },
    );
  });
});

test("NodejsFunction with overridden handler - no dots", () => {
  // WHEN
  new NodejsFunction(stack, "handler1", {
    handler: "myHandler",
  });

  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      entry: expect.stringContaining("function.test.handler1.ts"), // Automatically finds .ts handler file
    }),
  );

  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      handler: "index.myHandler", // automatic index. prefix
      runtime: expect.stringMatching("nodejs"),
    },
  );
});

test("NodejsFunction with overridden handler - with dots", () => {
  // WHEN
  new NodejsFunction(stack, "handler1", {
    handler: "run.sh",
  });

  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      entry: expect.stringContaining("function.test.handler1.ts"), // Automatically finds .ts handler file
    }),
  );

  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      handler: "run.sh", // No index. prefix
      runtime: expect.stringMatching("nodejs"),
    },
  );
});

test("NodejsFunction with .js handler", () => {
  // WHEN
  new NodejsFunction(stack, "handler2");

  // THEN
  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      entry: expect.stringContaining("function.test.handler2.js"), // Automatically finds .ts handler file
    }),
  );
});

test("NodejsFunction with .mjs handler", () => {
  // WHEN
  new NodejsFunction(stack, "handler3");

  // THEN
  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      entry: expect.stringContaining("function.test.handler3.mjs"), // Automatically finds .mjs handler file
    }),
  );
});

test("NodejsFunction with .mts handler", () => {
  // WHEN
  new NodejsFunction(stack, "handler4");

  // THEN
  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      entry: expect.stringContaining("function.test.handler4.mts"), // Automatically finds .mts handler file
    }),
  );
});

test("NodejsFunction with .cts handler", () => {
  // WHEN
  new NodejsFunction(stack, "handler5");

  // THEN
  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      entry: expect.stringContaining("function.test.handler5.cts"), // Automatically finds .cts handler file
    }),
  );
});

test("NodejsFunction with .cjs handler", () => {
  // WHEN
  new NodejsFunction(stack, "handler6");

  // THEN
  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      entry: expect.stringContaining("function.test.handler6.cjs"), // Automatically finds .cjs handler file
    }),
  );
});

test("NodejsFunction with container env vars", () => {
  // WHEN
  new NodejsFunction(stack, "handler1", {
    bundling: {
      environment: {
        KEY: "VALUE",
      },
    },
  });

  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      environment: {
        KEY: "VALUE",
      },
    }),
  );
});

test("throws when entry is not js/ts", () => {
  expect(
    () =>
      new NodejsFunction(stack, "Fn", {
        entry: "handler.py",
      }),
  ).toThrow(/Only JavaScript or TypeScript entry files are supported/);
});

test("accepts tsx", () => {
  const entry = bockPath`handler.tsx`;

  expect(
    () =>
      new NodejsFunction(stack, "Fn", {
        entry,
      }),
  ).not.toThrow();
});

test("throws when entry does not exist", () => {
  expect(
    () =>
      new NodejsFunction(stack, "Fn", {
        entry: "notfound.ts",
      }),
  ).toThrow(/Cannot find entry file at/);
});

test("throws when entry cannot be automatically found", () => {
  expect(() => new NodejsFunction(stack, "Fn")).toThrow(
    /Cannot find handler file .*function\.test\.Fn\.ts.*function\.test\.Fn\.js.*function\.test\.Fn\.mjs/,
  );
});

test("throws with the wrong runtime family", () => {
  expect(
    () =>
      new NodejsFunction(stack, "handler1", {
        runtime: Runtime.PYTHON_3_8,
      }),
  ).toThrow(/Only `NODEJS` runtimes are supported/);
});

test("throws with non existing lock file", () => {
  expect(
    () =>
      new NodejsFunction(stack, "handler1", {
        depsLockFilePath: "/does/not/exist.lock",
      }),
  ).toThrow(/Lock file at \/does\/not\/exist.lock doesn't exist/);
});

test("throws when depsLockFilePath is not a file", () => {
  expect(
    () =>
      new NodejsFunction(stack, "handler1", {
        depsLockFilePath: __dirname,
      }),
  ).toThrow(/\`depsLockFilePath\` should point to a file/);
});

test("resolves depsLockFilePath to an absolute path", () => {
  new NodejsFunction(stack, "handler1", {
    depsLockFilePath: bockPath`./package.json`,
  });

  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      depsLockFilePath: bockPath`/home/project/package.json`,
    }),
  );
});

test("resolves entry to an absolute path", () => {
  // WHEN
  new NodejsFunction(stack, "fn", {
    entry: bockPath`aws-lambda-nodejs/lib/index.ts`,
  });

  expect(Bundling.bundle).toHaveBeenCalledWith(
    stack,
    expect.objectContaining({
      entry: bockPath`/home/project/aws-lambda-nodejs/lib/index.ts`,
    }),
  );
});

test("configures connection reuse for aws sdk", () => {
  // WHEN
  new NodejsFunction(stack, "handler1", {
    runtime: Runtime.NODEJS_16_X, // tcons requires explicit runtime NodeJS 16
  });

  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      environment: {
        variables: {
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
        },
      },
    },
  );
});

test("can opt-out of connection reuse for aws sdk", () => {
  // WHEN
  new NodejsFunction(stack, "handler1", {
    awsSdkConnectionReuse: false,
  });

  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      environment: { variables: {} }, // TODO: should not be set at all
    },
  );
});

test("NodejsFunction in a VPC", () => {
  // GIVEN
  const vpc = new Vpc(stack, "Vpc");

  // WHEN
  new NodejsFunction(stack, "handler1", { vpc });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      vpc_config: {
        security_group_ids: [
          "${aws_security_group.handler1_SecurityGroup_30688A62.id}",
        ],
        subnet_ids: [
          "${aws_subnet.Vpc_PrivateSubnet1_F6513F49.id}",
          "${aws_subnet.Vpc_PrivateSubnet2_53755717.id}",
          "${aws_subnet.Vpc_PrivateSubnet3_FD86EE1D.id}",
        ],
      },
    },
  );
});

// TerraConstructs has no feature flag -> enabled by default
test.skip("defaults to NODEJS_16_X with feature flag disabled", () => {
  // WHEN
  new NodejsFunction(stack, "handler1");

  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      runtime: "nodejs16.x",
    },
  );
});

describe("Node 22+ runtimes", () => {
  test("defaults to NODEJS_LATEST with feature flag enabled", () => {
    // GIVEN
    // const appFF = new App({
    //   context: {
    //     [LAMBDA_NODEJS_USE_LATEST_RUNTIME]: true,
    //   },
    // });

    // const stackFF = new AwsStack(appFF, "TestStackFF");

    // WHEN
    new NodejsFunction(stack, "handler1");

    Template.synth(stack).toHaveResourceWithProperties(
      lambdaFunction.LambdaFunction,
      {
        runtime: "nodejs22.x",
      },
    );
  });

  test("connection reuse for aws sdk v2 not set by default", () => {
    // WHEN
    new NodejsFunction(stack, "handler1", {
      runtime: Runtime.NODEJS_18_X,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaFunction.LambdaFunction,
      {
        environment: { variables: {} }, // TODO: should not be set at all
      },
    );
  });

  test("connection reuse for aws sdk v2 can be explicitly not set", () => {
    // WHEN
    new NodejsFunction(stack, "handler1", {
      runtime: Runtime.NODEJS_18_X,
      awsSdkConnectionReuse: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaFunction.LambdaFunction,
      {
        environment: { variables: {} }, // TODO: should not be set at all
      },
    );
  });

  test("setting connection reuse for aws sdk v2 has warning", () => {
    // WHEN
    new NodejsFunction(stack, "handler1", {
      runtime: Runtime.NODEJS_18_X,
      awsSdkConnectionReuse: true,
    });

    // THEN
    // [ack: aws-cdk-lib/aws-lambda-nodejs:unusedSdkEvironmentVariable]
    Annotations.fromStack(stack).hasWarnings({
      message:
        "The AWS_NODEJS_CONNECTION_REUSE_ENABLED environment variable does not exist in SDK v3. You have explicitly set `awsSdkConnectionReuse`; please make sure this is intentional.",
    });
    // AND
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaFunction.LambdaFunction,
      {
        environment: {
          variables: {
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          },
        },
      },
    );
  });
});
