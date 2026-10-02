// TerraConstructs-specific staging tests
// Most asset staging functionality is tested in cdktn at:
// /Users/admin/projects/public/cdk-terrain/packages/cdktn/test/asset-staging.test.ts
//
// This file only tests TerraConstructs-specific behavior:
// 1. SHA256 hashing (vs cdktn's MD5), via `resolveSha256AssetHash`
// 2. AWS CDK compatibility for custom hash handling
// 3. The OUTPUT-hash bundler dedup cache

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { App, BundleResult, Testing } from "cdktn";
import {
  AssetHashType,
  AssetType,
  FileSystem,
  StackBase,
  TerraformAsset,
  resolveSha256AssetHash,
} from "../src";

class MyStack extends StackBase {}

const TEST_OUTDIR = path.join(__dirname, "cdk.out");
const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const TEST_STAGING_DIR = path.join(TEST_APPDIR, "cdktf.out", "assets");

const FIXTURE_TEST1_DIR = path.join(__dirname, "fs", "fixtures", "test1");
// TerraConstructs uses SHA256 (64 chars) instead of cdktn's MD5 (32 chars uppercase)
const FIXTURE_TEST1_HASH_SHA256 =
  "2f37f937c51e2c191af66acf9b09f548926008ec68c575bd2ee54b6e997c0e00";

describe("TerraConstructs asset hashing", () => {
  let stack: MyStack;
  let app: App;

  beforeEach(() => {
    if (fs.existsSync(TEST_OUTDIR)) {
      fs.rmSync(TEST_OUTDIR, { recursive: true, force: true });
    }
    app = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR,
        stackTraces: false,
      }),
    );
    stack = new MyStack(app, "TestStack");
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(TEST_STAGING_DIR)) {
      fs.rmSync(TEST_STAGING_DIR, { recursive: true, force: true });
    }
  });

  describe("SHA256 hashing (AWS CDK compatibility)", () => {
    test("uses SHA256 hash instead of MD5", () => {
      // WHEN
      const resolved = resolveSha256AssetHash({
        sourcePath: FIXTURE_TEST1_DIR,
      });

      // THEN - TerraConstructs uses SHA256 (64 chars lowercase)
      expect(resolved.assetHash).toHaveLength(64);
      expect(resolved.assetHash).toEqual(FIXTURE_TEST1_HASH_SHA256);
      expect(resolved.assetHash).toMatch(/^[a-f0-9]{64}$/);
      expect(resolved.assetHashType).toEqual(AssetHashType.CUSTOM);
    });

    test("SHA256 hash is consistent across runs", () => {
      // WHEN
      const resolved1 = resolveSha256AssetHash({
        sourcePath: FIXTURE_TEST1_DIR,
      });
      const resolved2 = resolveSha256AssetHash({
        sourcePath: FIXTURE_TEST1_DIR,
      });

      // THEN
      expect(resolved1.assetHash).toEqual(resolved2.assetHash);
      expect(resolved1.assetHash).toEqual(FIXTURE_TEST1_HASH_SHA256);
    });

    test("CUSTOM hash type hashes the provided value with SHA256", () => {
      // AWS CDK behavior: custom hash values are themselves hashed with SHA256
      const customValue = "my-custom-hash";
      const expectedHash = crypto
        .createHash("sha256")
        .update(customValue)
        .digest("hex");

      // WHEN
      const resolved = resolveSha256AssetHash({
        sourcePath: FIXTURE_TEST1_DIR,
        assetHash: customValue,
        assetHashType: AssetHashType.CUSTOM,
      });

      // THEN
      expect(resolved.assetHash).toEqual(expectedHash);
      expect(resolved.assetHash).toHaveLength(64);
    });

    test("extraHash is included in SHA256 calculation", () => {
      // WHEN
      const withoutExtra = resolveSha256AssetHash({
        sourcePath: FIXTURE_TEST1_DIR,
      });
      const withExtra = resolveSha256AssetHash({
        sourcePath: FIXTURE_TEST1_DIR,
        extraHash: "extra-data",
      });

      // THEN
      expect(withoutExtra.assetHash).not.toEqual(withExtra.assetHash);
      expect(withoutExtra.assetHash).toEqual(FIXTURE_TEST1_HASH_SHA256);
      expect(withExtra.assetHash).toHaveLength(64);
    });
  });

  describe("OUTPUT hash type caching", () => {
    test("dedups an identical bundle and still produces a SHA256 hash", () => {
      const fingerPrintSpy = jest.spyOn(FileSystem, "fingerprint");

      const bundle = jest.fn((options: { outputDir: string }) => {
        fs.writeFileSync(
          path.join(options.outputDir, "bundle.js"),
          "bundled content",
        );
        return BundleResult.directory(options.outputDir);
      });
      const fakeBundler = { bundlerKey: "test-bundler", bundle };

      // WHEN - resolve the hash (and wrap the bundler) for two identical
      // assets, then let each eagerly bundle via its own TerraformAsset.
      const resolved1 = resolveSha256AssetHash({
        sourcePath: FIXTURE_TEST1_DIR,
        assetHashType: AssetHashType.OUTPUT,
        bundler: fakeBundler,
      });
      const asset1 = new TerraformAsset(stack, "Asset1", {
        path: FIXTURE_TEST1_DIR,
        type: AssetType.DIRECTORY,
        assetHashType: resolved1.assetHashType,
        bundler: resolved1.bundler,
      });
      resolved1.finalize(asset1);

      const resolved2 = resolveSha256AssetHash({
        sourcePath: FIXTURE_TEST1_DIR,
        assetHashType: AssetHashType.OUTPUT,
        bundler: fakeBundler,
      });
      const asset2 = new TerraformAsset(stack, "Asset2", {
        path: FIXTURE_TEST1_DIR,
        type: AssetType.DIRECTORY,
        assetHashType: resolved2.assetHashType,
        bundler: resolved2.bundler,
      });
      resolved2.finalize(asset2);

      // THEN - the real bundler only ran once (second instance hit the
      // cache), but both ended up with the same SHA256-hashed assetHash.
      expect(bundle).toHaveBeenCalledTimes(1);
      expect(asset1.assetHash).toEqual(asset2.assetHash);
      expect(asset1.assetHash).toMatch(/^[a-f0-9]{64}$/);
      expect(fingerPrintSpy.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("TerraformAsset.path AWS CDK compatibility", () => {
    test("path is relative and includes the SHA256 hash", () => {
      // WHEN
      const resolved = resolveSha256AssetHash({
        sourcePath: FIXTURE_TEST1_DIR,
      });
      const asset = new TerraformAsset(stack, "Asset", {
        path: FIXTURE_TEST1_DIR,
        type: AssetType.DIRECTORY,
        assetHash: resolved.assetHash,
        assetHashType: resolved.assetHashType,
      });

      // THEN
      expect(asset.path).toContain("assets");
      expect(asset.path).toContain(FIXTURE_TEST1_HASH_SHA256);
      expect(path.isAbsolute(asset.path)).toBe(false);
    });
  });

  describe("validation", () => {
    test("throws with assetHash and non-CUSTOM hash type", () => {
      expect(() => {
        resolveSha256AssetHash({
          sourcePath: FIXTURE_TEST1_DIR,
          assetHash: "custom",
          assetHashType: AssetHashType.SOURCE,
        });
      }).toThrow(/Cannot specify.*source.*when.*assetHash.*specified/);
    });

    test("throws with CUSTOM hash type but no assetHash", () => {
      expect(() => {
        resolveSha256AssetHash({
          sourcePath: FIXTURE_TEST1_DIR,
          assetHashType: AssetHashType.CUSTOM,
        });
      }).toThrow(/assetHash.*must be specified/);
    });

    test("throws with OUTPUT hash type and no bundler", () => {
      expect(() => {
        resolveSha256AssetHash({
          sourcePath: FIXTURE_TEST1_DIR,
          assetHashType: AssetHashType.OUTPUT,
        });
      }).toThrow(/Cannot use.*output.*when.*bundler.*not specified/);
    });
  });
});
