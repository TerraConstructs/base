// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/core/test/fs/utils.test.ts

import * as fs from "fs";
import * as path from "path";
import { SymlinkFollowMode } from "../../src/fs";
import * as util from "../../src/fs/utils";

jest.mock("fs");

describe("utils", () => {
  const mockedFsExistsSync = fs.existsSync as jest.Mock;

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("shouldFollow", () => {
    describe("always", () => {
      test("follows internal", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join(sourceRoot, "referent");
        mockedFsExistsSync.mockReturnValue(true);

        const result = util.shouldFollow(
          SymlinkFollowMode.ALWAYS,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(true);
        expect(mockedFsExistsSync).toHaveBeenCalledTimes(1);
        expect(mockedFsExistsSync).toHaveBeenCalledWith(linkTarget);
      });

      test("follows external", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join("alternate", "referent");
        mockedFsExistsSync.mockReturnValue(true);

        const result = util.shouldFollow(
          SymlinkFollowMode.ALWAYS,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(true);
        expect(mockedFsExistsSync).toHaveBeenCalledTimes(1);
        expect(mockedFsExistsSync).toHaveBeenCalledWith(linkTarget);
      });

      test("does not follow internal when the referent does not exist", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join(sourceRoot, "referent");
        mockedFsExistsSync.mockReturnValue(false);

        const result = util.shouldFollow(
          SymlinkFollowMode.ALWAYS,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(false);
        expect(mockedFsExistsSync).toHaveBeenCalledTimes(1);
        expect(mockedFsExistsSync).toHaveBeenCalledWith(linkTarget);
      });

      test("does not follow external when the referent does not exist", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join("alternate", "referent");
        mockedFsExistsSync.mockReturnValue(false);

        const result = util.shouldFollow(
          SymlinkFollowMode.ALWAYS,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(false);
        expect(mockedFsExistsSync).toHaveBeenCalledTimes(1);
        expect(mockedFsExistsSync).toHaveBeenCalledWith(linkTarget);
      });
    });

    describe("external", () => {
      test("does not follow internal", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join(sourceRoot, "referent");

        const result = util.shouldFollow(
          SymlinkFollowMode.EXTERNAL,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(false);
        expect(mockedFsExistsSync).not.toHaveBeenCalled();
      });

      test("follows external", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join("alternate", "referent");
        mockedFsExistsSync.mockReturnValue(true);

        const result = util.shouldFollow(
          SymlinkFollowMode.EXTERNAL,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(true);
        expect(mockedFsExistsSync).toHaveBeenCalledTimes(1);
        expect(mockedFsExistsSync).toHaveBeenCalledWith(linkTarget);
      });

      test("does not follow external when referent does not exist", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join("alternate", "referent");
        mockedFsExistsSync.mockReturnValue(false);

        const result = util.shouldFollow(
          SymlinkFollowMode.EXTERNAL,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(false);
        expect(mockedFsExistsSync).toHaveBeenCalledTimes(1);
        expect(mockedFsExistsSync).toHaveBeenCalledWith(linkTarget);
      });
    });

    describe("blockExternal", () => {
      test("follows internal", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join(sourceRoot, "referent");
        mockedFsExistsSync.mockReturnValue(true);

        const result = util.shouldFollow(
          SymlinkFollowMode.BLOCK_EXTERNAL,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(true);
        expect(mockedFsExistsSync).toHaveBeenCalledTimes(1);
        expect(mockedFsExistsSync).toHaveBeenCalledWith(linkTarget);
      });

      test("does not follow internal when referent does not exist", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join(sourceRoot, "referent");
        mockedFsExistsSync.mockReturnValue(false);

        const result = util.shouldFollow(
          SymlinkFollowMode.BLOCK_EXTERNAL,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(false);
        expect(mockedFsExistsSync).toHaveBeenCalledTimes(1);
        expect(mockedFsExistsSync).toHaveBeenCalledWith(linkTarget);
      });

      test("does not follow external", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join("alternate", "referent");

        const result = util.shouldFollow(
          SymlinkFollowMode.BLOCK_EXTERNAL,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(false);
        expect(mockedFsExistsSync).not.toHaveBeenCalled();
      });
    });

    describe("never", () => {
      test("does not follow internal", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join(sourceRoot, "referent");

        const result = util.shouldFollow(
          SymlinkFollowMode.NEVER,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(false);
        expect(mockedFsExistsSync).not.toHaveBeenCalled();
      });

      test("does not follow external", () => {
        const sourceRoot = path.join("source", "root");
        const linkTarget = path.join("alternate", "referent");

        const result = util.shouldFollow(
          SymlinkFollowMode.NEVER,
          sourceRoot,
          linkTarget,
        );

        expect(result).toBe(false);
        expect(mockedFsExistsSync).not.toHaveBeenCalled();
      });
    });
  });
});
