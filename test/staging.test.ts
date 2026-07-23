// TerraConstructs-specific staging tests
// Most asset staging functionality is tested in cdktn at:
// /Users/admin/projects/public/cdk-terrain/packages/cdktn/test/asset-staging.test.ts
//
// This file only tests TerraConstructs-specific behavior:
// 1. SHA256 hashing (vs cdktn's MD5)
// 2. AWS CDK compatibility for custom hash handling

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { App, Testing } from "cdktn";
import { AssetHashType, AssetStaging, FileSystem, StackBase } from "../src";

class MyStack extends StackBase {}

const TEST_OUTDIR = path.join(__dirname, "cdk.out");
const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const TEST_STAGING_DIR = path.join(TEST_APPDIR, "cdktf.out", "assets");

const FIXTURE_TEST1_DIR = path.join(__dirname, "fs", "fixtures", "test1");
// TerraConstructs uses SHA256 (64 chars) instead of cdktn's MD5 (32 chars uppercase)
const FIXTURE_TEST1_HASH_SHA256 =
  "2f37f937c51e2c191af66acf9b09f548926008ec68c575bd2ee54b6e997c0e00";

describe("TerraConstructs AssetStaging", () => {
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
      const staging = new AssetStaging(stack, "Asset", {
        sourcePath: FIXTURE_TEST1_DIR,
      });

      // THEN - TerraConstructs uses SHA256 (64 chars lowercase)
      expect(staging.assetHash).toHaveLength(64);
      expect(staging.assetHash).toEqual(FIXTURE_TEST1_HASH_SHA256);
      expect(staging.assetHash).toMatch(/^[a-f0-9]{64}$/);
    });

    test("SHA256 hash is consistent across runs", () => {
      // WHEN
      const staging1 = new AssetStaging(stack, "Asset1", {
        sourcePath: FIXTURE_TEST1_DIR,
      });
      const staging2 = new AssetStaging(stack, "Asset2", {
        sourcePath: FIXTURE_TEST1_DIR,
      });

      // THEN
      expect(staging1.assetHash).toEqual(staging2.assetHash);
      expect(staging1.assetHash).toEqual(FIXTURE_TEST1_HASH_SHA256);
    });

    test("CUSTOM hash type hashes the provided value with SHA256", () => {
      // AWS CDK behavior: custom hash values are themselves hashed with SHA256
      const customValue = "my-custom-hash";
      const expectedHash = crypto
        .createHash("sha256")
        .update(customValue)
        .digest("hex");

      // WHEN
      const staging = new AssetStaging(stack, "Asset", {
        sourcePath: FIXTURE_TEST1_DIR,
        assetHash: customValue,
        assetHashType: AssetHashType.CUSTOM,
      });

      // THEN
      expect(staging.assetHash).toEqual(expectedHash);
      expect(staging.assetHash).toHaveLength(64);
    });

    test("extraHash is included in SHA256 calculation", () => {
      // WHEN
      const withoutExtra = new AssetStaging(stack, "withoutExtra", {
        sourcePath: FIXTURE_TEST1_DIR,
      });
      const withExtra = new AssetStaging(stack, "withExtra", {
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
    test("uses cache key to avoid redundant fingerprinting", () => {
      const fingerPrintSpy = jest.spyOn(FileSystem, "fingerprint");

      // Use local bundling to avoid docker complexity in unit tests
      const localBundler = {
        tryBundle: jest.fn((outputDir: string) => {
          // Simulate successful local bundling
          fs.writeFileSync(
            path.join(outputDir, "bundle.js"),
            "bundled content",
          );
          return true;
        }),
      };

      // WHEN - create two identical bundling assets with OUTPUT hash type
      new AssetStaging(stack, "Asset1", {
        sourcePath: FIXTURE_TEST1_DIR,
        assetHashType: AssetHashType.OUTPUT,
        bundling: {
          image: {
            image: "alpine",
            toJSON: () => "alpine",
            run: () => {},
          } as any,
          command: ["echo", "test"],
          local: localBundler,
        },
      });

      const firstCallCount = fingerPrintSpy.mock.calls.length;

      new AssetStaging(stack, "Asset2", {
        sourcePath: FIXTURE_TEST1_DIR,
        assetHashType: AssetHashType.OUTPUT,
        bundling: {
          image: {
            image: "alpine",
            toJSON: () => "alpine",
            run: () => {},
          } as any,
          command: ["echo", "test"],
          local: localBundler,
        },
      });

      // THEN - local bundler should only be called once (second call uses cache)
      expect(localBundler.tryBundle).toHaveBeenCalledTimes(1);
      // Fingerprint is still called for cache key and output hash calculation
      expect(fingerPrintSpy.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("relativeStagedPath AWS CDK compatibility", () => {
    test("returns path relative to stack outdir", () => {
      // WHEN
      const staging = new AssetStaging(stack, "Asset", {
        sourcePath: FIXTURE_TEST1_DIR,
      });

      // THEN
      const relativePath = staging.relativeStagedPath(stack);
      expect(relativePath).toContain("assets");
      expect(relativePath).toContain(`asset.${FIXTURE_TEST1_HASH_SHA256}`);
      expect(path.isAbsolute(relativePath)).toBe(false);
    });
  });

  describe("validation", () => {
    test("throws with assetHash and non-CUSTOM hash type", () => {
      expect(() => {
        new AssetStaging(stack, "Asset", {
          sourcePath: FIXTURE_TEST1_DIR,
          assetHash: "custom",
          assetHashType: AssetHashType.SOURCE,
        });
      }).toThrow(/Cannot specify.*source.*when.*assetHash.*specified/);
    });

    test("throws with CUSTOM hash type but no assetHash", () => {
      expect(() => {
        new AssetStaging(stack, "Asset", {
          sourcePath: FIXTURE_TEST1_DIR,
          assetHashType: AssetHashType.CUSTOM,
        });
      }).toThrow(/assetHash.*must be specified/);
    });

    test("throws with OUTPUT hash type and no bundling", () => {
      expect(() => {
        new AssetStaging(stack, "Asset", {
          sourcePath: FIXTURE_TEST1_DIR,
          assetHashType: AssetHashType.OUTPUT,
        });
      }).toThrow(/Cannot use.*output.*when.*bundling.*not specified/);
    });
  });
});
