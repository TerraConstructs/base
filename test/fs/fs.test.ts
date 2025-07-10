// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/core/test/fs/fs.test.ts

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileSystem } from "../../src/fs";

jest.mock("os");

describe("fs", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test("tmpdir returns a real path and is cached", () => {
    // GIVEN
    // Invalidate the cache from previous tests to ensure test isolation
    (FileSystem as any)._tmpdir = undefined;

    const symlinkTmp = path.join(__dirname, "tmp-link");
    try {
      const realOs = jest.requireActual<typeof os>("os");
      fs.symlinkSync(realOs.tmpdir(), symlinkTmp);
      (os.tmpdir as jest.Mock).mockReturnValue(symlinkTmp);

      // WHEN
      // Access FileSystem.tmpdir twice to test the caching mechanism.
      const firstAccess = FileSystem.tmpdir;
      const secondAccess = FileSystem.tmpdir;

      // THEN
      expect(path.isAbsolute(firstAccess)).toEqual(true);

      const p = path.join(secondAccess, "tmpdir-test.txt");
      fs.writeFileSync(p, "tmpdir-test");

      // Assert that the path is real and the file was written correctly
      expect(p).toEqual(fs.realpathSync(p));
      expect(fs.readFileSync(p, "utf8")).toEqual("tmpdir-test");
      expect(os.tmpdir).toHaveBeenCalledTimes(1);

      fs.unlinkSync(p);
    } finally {
      // Clean up the symlink
      if (fs.existsSync(symlinkTmp)) {
        fs.unlinkSync(symlinkTmp);
      }
    }
  });

  test("mkdtemp creates a temporary directory in the system temp", () => {
    // GIVEN
    const mockTempDir = path.join(__dirname, "mock-temp");
    (os.tmpdir as jest.Mock).mockReturnValue(mockTempDir);
    (FileSystem as any)._tmpdir = undefined; // Clear cache to use our new mock value

    // Create the directory our mock points to, so fs.realpathSync doesn't fail.
    if (!fs.existsSync(mockTempDir)) fs.mkdirSync(mockTempDir);

    try {
      // WHEN
      const tmpdir = FileSystem.mkdtemp("cdk-mkdtemp-");

      // THEN
      expect(path.dirname(tmpdir)).toEqual(FileSystem.tmpdir);
      expect(fs.existsSync(tmpdir)).toEqual(true);

      // Cleanup the subdir created by the test
      fs.rmdirSync(tmpdir);
    } finally {
      // Cleanup the base dir we created for the mock
      if (fs.existsSync(mockTempDir)) {
        fs.rmdirSync(mockTempDir);
      }
    }
  });
});
