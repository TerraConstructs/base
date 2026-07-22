// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-lambda-nodejs/test/package-installation.test.ts

import * as child_process from "child_process";
import { PackageInstallation } from "../../../../src/aws/compute/function-nodejs/package-installation";
import * as util from "../../../../src/aws/compute/function-nodejs/util";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawnSync: jest.fn(),
}));

test("detects local version", () => {
  const getModuleVersionMock = jest
    .spyOn(util, "tryGetModuleVersionFromRequire")
    .mockReturnValue("1.2.3");

  expect(PackageInstallation.detect("some-module")).toEqual({
    isLocal: true,
    version: "1.2.3",
  });

  getModuleVersionMock.mockRestore();
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

  expect(PackageInstallation.detect("some-module")).toEqual({
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

  expect(PackageInstallation.detect("some-module")).toBeUndefined();

  (child_process.spawnSync as jest.Mock).mockReset();
  getModuleVersionMock.mockRestore();
});
