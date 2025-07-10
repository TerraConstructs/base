// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-lambda-nodejs/test/package-installation.test.ts

import * as child_process from "child_process";
import { PackageInstallation } from "../../../../src/aws/compute/function-nodejs/package-installation";
import * as util from "../../../../src/aws/compute/function-nodejs/util";

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-extraneous-dependencies
const version = require("esbuild-wasm/package.json").version;

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawnSync: jest.fn(),
}));

test("detects local version", () => {
  expect(PackageInstallation.detect("esbuild-wasm")).toEqual({
    isLocal: true,
    version,
  });
});

test("checks global version if local detection fails", () => {
  const getModuleVersionMock = jest
    .spyOn(util, "tryGetModuleVersionFromRequire")
    .mockReturnValue(undefined);
  (child_process.spawnSync as jest.Mock).mockReturnValue({
    status: 0,
    stderr: Buffer.from("stderr"),
    stdout: Buffer.from("global-version"),
    pid: 123,
    output: ["stdout", "stderr"],
    signal: null,
  });

  expect(PackageInstallation.detect("esbuild-wasm")).toEqual({
    isLocal: false,
    version: "global-version",
  });

  (child_process.spawnSync as jest.Mock).mockReset();
  getModuleVersionMock.mockRestore();
});

test("returns undefined on error", () => {
  const getModuleVersionMock = jest
    .spyOn(util, "tryGetModuleVersionFromRequire")
    .mockReturnValue(undefined);
  (child_process.spawnSync as jest.Mock).mockReturnValue({
    error: new Error("bad error"),
    status: 0,
    stderr: Buffer.from("stderr"),
    stdout: Buffer.from("stdout"),
    pid: 123,
    output: ["stdout", "stderr"],
    signal: null,
  });

  expect(PackageInstallation.detect("esbuild-wasm")).toBeUndefined();

  (child_process.spawnSync as jest.Mock).mockReset();
  getModuleVersionMock.mockRestore();
});
