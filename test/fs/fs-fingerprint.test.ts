import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileSystem } from "../../src/fs";

describe("fs fingerprint", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("files", () => {
    test("does not change with the file name", () => {
      // GIVEN
      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hash-tests"));
      const content = "Hello, world!";
      const input1 = path.join(workdir, "input1.txt");
      const input2 = path.join(workdir, "input2.txt");
      const input3 = path.join(workdir, "input3.txt");
      fs.writeFileSync(input1, content);
      fs.writeFileSync(input2, content);
      fs.writeFileSync(input3, content + "."); // add one character, hash should be different

      // WHEN
      const hash1 = FileSystem.fingerprint(input1);
      const hash2 = FileSystem.fingerprint(input2);
      const hash3 = FileSystem.fingerprint(input3);

      // THEN
      expect(hash1).toEqual(hash2);
      expect(hash3).not.toEqual(hash1);
    });

    test("works on empty files", () => {
      // GIVEN
      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hash-tests"));
      const input1 = path.join(workdir, "empty");
      const input2 = path.join(workdir, "empty");
      fs.writeFileSync(input1, "");
      fs.writeFileSync(input2, "");

      // WHEN
      const hash1 = FileSystem.fingerprint(input1);
      const hash2 = FileSystem.fingerprint(input2);

      // THEN
      expect(hash1).toEqual(hash2);
    });
  });

  // A plain, symlink-free fixture: copyDirectory's default EXTERNAL follow
  // mode materializes external symlinks on copy, which the new (cdktn-matching)
  // fingerprint algorithm never does for nested symlinks — so a fixture with
  // external symlinks legitimately hashes differently from its own copy. Use
  // a symlink-free tree here; symlink-specific behavior is covered below.
  function makePlainFixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fingerprint-plain-"));
    fs.writeFileSync(path.join(dir, "normal-file.txt"), "hello world");
    fs.mkdirSync(path.join(dir, "normal-dir"));
    fs.writeFileSync(
      path.join(dir, "normal-dir", "file-in-subdir.txt"),
      "nested",
    );
    return dir;
  }

  describe("directories", () => {
    test("works on directories", () => {
      // GIVEN
      const srcdir = makePlainFixture();
      const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-tests"));
      FileSystem.copyDirectory(srcdir, outdir);

      // WHEN
      const hashSrc = FileSystem.fingerprint(srcdir);
      const hashCopy = FileSystem.fingerprint(outdir);

      // THEN
      expect(hashSrc).toEqual(hashCopy);
    });

    test("ignores requested files", () => {
      // GIVEN
      const srcdir = makePlainFixture();
      const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-tests"));
      FileSystem.copyDirectory(srcdir, outdir);

      // WHEN
      const hashSrc = FileSystem.fingerprint(srcdir, {
        exclude: ["*.ignoreme"],
      });

      fs.writeFileSync(path.join(outdir, `${hashSrc}.ignoreme`), "Ignore me!");
      const hashCopy = FileSystem.fingerprint(outdir, {
        exclude: ["*.ignoreme"],
      });

      // THEN
      expect(hashSrc).toEqual(hashCopy);
    });

    // cdktn's legacy content hash streams raw file bytes in directory-walk
    // order; it does not fold file names into the digest at all (only
    // symlink metadata carries a path). So a rename that preserves both the
    // byte stream order and content leaves the hash unchanged.
    test("does not change when a rename preserves content order", () => {
      // GIVEN
      const srcdir = makePlainFixture();
      const cpydir = fs.mkdtempSync(
        path.join(os.tmpdir(), "fingerprint-tests"),
      );
      FileSystem.copyDirectory(srcdir, cpydir);

      fs.renameSync(
        path.join(cpydir, "normal-dir", "file-in-subdir.txt"),
        path.join(cpydir, "move-me.txt"),
      );

      // WHEN
      const hashSrc = FileSystem.fingerprint(srcdir);
      const hashCopy = FileSystem.fingerprint(cpydir);

      // THEN
      expect(hashCopy).toEqual(hashSrc);
    });

    test("changes when the tree shape changes", () => {
      // GIVEN
      const srcdir = makePlainFixture();
      const cpydir = fs.mkdtempSync(
        path.join(os.tmpdir(), "fingerprint-tests"),
      );
      FileSystem.copyDirectory(srcdir, cpydir);

      fs.writeFileSync(path.join(cpydir, "extra-file.txt"), "extra");

      // WHEN
      const hashSrc = FileSystem.fingerprint(srcdir);
      const hashCopy = FileSystem.fingerprint(cpydir);

      // THEN
      expect(hashCopy).not.toEqual(hashSrc);
    });
  });

  describe("symlinks", () => {
    // Matches cdktn's legacy hash scheme: nested symlinks are hashed by their
    // path+target metadata, never followed (only a root-level symlink is).
    test("does not change with the contents of a nested symlink's referent", () => {
      // GIVEN
      const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "fingerprint-tests"));
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fingerprint-tests"));
      const target = path.join(dir1, "boom.txt");
      const content = "boom";
      fs.writeFileSync(target, content);
      fs.symlinkSync(target, path.join(dir2, "link-to-boom.txt"));

      // now dir2 contains a symlink to a file in dir1

      // WHEN
      const original = FileSystem.fingerprint(dir2);

      // now change the contents of the target
      fs.writeFileSync(target, "changing you!");
      const afterChange = FileSystem.fingerprint(dir2);

      // THEN
      expect(afterChange).toEqual(original);
    });

    test("changes when a nested symlink's target changes", () => {
      // GIVEN
      const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "fingerprint-tests"));
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fingerprint-tests"));
      const targetA = path.join(dir1, "a.txt");
      const targetB = path.join(dir1, "b.txt");
      fs.writeFileSync(targetA, "a");
      fs.writeFileSync(targetB, "b");
      const link = path.join(dir2, "link.txt");
      fs.symlinkSync(targetA, link);

      // WHEN
      const original = FileSystem.fingerprint(dir2);
      fs.unlinkSync(link);
      fs.symlinkSync(targetB, link);
      const afterRelink = FileSystem.fingerprint(dir2);

      // THEN
      expect(afterRelink).not.toEqual(original);
    });
  });
});
