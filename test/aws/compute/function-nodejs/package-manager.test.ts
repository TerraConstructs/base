// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-lambda-nodejs/test/package-manager.test.ts

import * as os from "os";
import { EsbuildLogLevel } from "../../../../src/aws/compute/function-nodejs/";
import {
  LockFile,
  PackageManager,
} from "../../../../src/aws/compute/function-nodejs/package-manager";

jest.mock("os", () => ({
  ...jest.requireActual("os"),
  platform: jest.fn(),
}));

test("from a package-lock.json", () => {
  const packageManager = PackageManager.fromLockFile(
    "/path/to/package-lock.json",
  );
  expect(packageManager.lockFile).toEqual(LockFile.NPM);
  expect(packageManager.argsSeparator).toBeUndefined();
  expect(packageManager.installCommand).toEqual(["npm", "ci"]);
  expect(packageManager.runCommand).toEqual(["npx", "--no-install"]);

  expect(packageManager.runBinCommand("my-bin")).toBe(
    "npx --no-install my-bin",
  );
});

test("from a package-lock.json with LogLevel.ERROR", () => {
  const logLevel = EsbuildLogLevel.ERROR;
  const packageManager = PackageManager.fromLockFile(
    "/path/to/package-lock.json",
    logLevel,
  );
  expect(packageManager.installCommand).toEqual([
    "npm",
    "ci",
    "--loglevel",
    logLevel,
  ]);
});

test("from a yarn.lock", () => {
  const packageManager = PackageManager.fromLockFile("/path/to/yarn.lock");
  expect(packageManager.lockFile).toEqual(LockFile.YARN);
  expect(packageManager.argsSeparator).toBeUndefined();
  expect(packageManager.installCommand).toEqual([
    "yarn",
    "install",
    "--no-immutable",
  ]);
  expect(packageManager.runCommand).toEqual(["yarn", "run"]);

  expect(packageManager.runBinCommand("my-bin")).toBe("yarn run my-bin");
});

test("from a yarn.lock with LogLevel.ERROR", () => {
  const packageManager = PackageManager.fromLockFile(
    "/path/to/yarn.lock",
    EsbuildLogLevel.ERROR,
  );
  expect(packageManager.installCommand).toEqual([
    "yarn",
    "install",
    "--no-immutable",
    "--silent",
  ]);
});

test("from a pnpm-lock.yaml", () => {
  const packageManager = PackageManager.fromLockFile("/path/to/pnpm-lock.yaml");
  expect(packageManager.lockFile).toEqual(LockFile.PNPM);
  expect(packageManager.argsSeparator).toEqual("--");
  expect(packageManager.installCommand).toEqual([
    "pnpm",
    "install",
    "--config.node-linker=hoisted",
    "--config.package-import-method=clone-or-copy",
    "--no-prefer-frozen-lockfile",
  ]);
  expect(packageManager.runCommand).toEqual(["pnpm", "exec"]);

  expect(packageManager.runBinCommand("my-bin")).toBe("pnpm exec -- my-bin");
});

test("from a pnpm-lock.yaml with LogLevel.ERROR", () => {
  const packageManager = PackageManager.fromLockFile(
    "/path/to/pnpm-lock.yaml",
    EsbuildLogLevel.ERROR,
  );
  expect(packageManager.installCommand).toEqual([
    "pnpm",
    "install",
    "--reporter",
    "silent",
    "--config.node-linker=hoisted",
    "--config.package-import-method=clone-or-copy",
    "--no-prefer-frozen-lockfile",
  ]);
});

test("from a bun.lockb", () => {
  const packageManager = PackageManager.fromLockFile("/path/to/bun.lockb");
  expect(packageManager.lockFile).toEqual(LockFile.BUN);
  expect(packageManager.argsSeparator).toBeUndefined();
  expect(packageManager.installCommand).toEqual([
    "bun",
    "install",
    "--backend",
    "copyfile",
  ]);
  expect(packageManager.runCommand).toEqual(["bun", "run"]);

  expect(packageManager.runBinCommand("my-bin")).toBe("bun run my-bin");
});

test("from a bun.lockb with LogLevel.ERROR", () => {
  const packageManager = PackageManager.fromLockFile(
    "/path/to/bun.lockb",
    EsbuildLogLevel.ERROR,
  );
  expect(packageManager.installCommand).toEqual([
    "bun",
    "install",
    "--backend",
    "copyfile",
    "--silent",
  ]);
});

test("defaults to NPM", () => {
  const packageManager = PackageManager.fromLockFile("/path/to/other.lock");
  expect(packageManager.lockFile).toEqual(LockFile.NPM);
});

test("Windows", () => {
  // Cast platform to a mock function
  (os.platform as jest.Mock).mockReturnValue("win32");
  // const osPlatformMock = jest.spyOn(os, "platform").mockReturnValue("win32");

  const packageManager = PackageManager.fromLockFile("/path/to/whatever");
  expect(packageManager.runBinCommand("my-bin")).toEqual(
    "npx.cmd --no-install my-bin",
  );

  // osPlatformMock.mockRestore();

  // Clean up
  (os.platform as jest.Mock).mockReset();
});
