// TerraConstructs-specific SHA256 asset hashing, layered on top of cdktn's
// TerraformAsset/AssetStaging (which hash with MD5 by default) to maintain
// AWS CDK hash compatibility.
//
// cdktn's `AssetStaging` defers writing staged content to disk until the
// owning stack's synth-time `onSynthesize` pass, and no longer exposes an
// eagerly-available staged path -- only `TerraformAsset` (which owns and
// drives an internal `AssetStaging`) is a safe public integration point.
// TerraConstructs' `Asset`/`DockerImageAsset` constructs build directly on
// `TerraformAsset`, using `resolveSha256AssetHash` below to compute (and,
// for `OUTPUT` hashing, override after construction) a SHA256 `assetHash`
// instead of cdktn's own MD5 one.

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  AssetHashType,
  AssetPackaging,
  TerraformAsset,
  AssetType,
  BundleResult,
  BundleOutputType,
} from "cdktn";
import type {
  IAsset,
  IAssetBundler,
  BundleOptions,
  IAssetPackaging,
} from "cdktn";
import { FileSystem } from "./fs";

export { AssetPackaging, TerraformAsset, AssetType };
export type { IAssetPackaging };

/**
 * Cache for OUTPUT hash type bundling results, keyed by bundler identity +
 * source path + exclude + extraHash.
 *
 * Avoids re-running an identical bundle for every asset that references the
 * same source and bundler within a synth: a cache hit copies the
 * previously-produced output directory instead of re-invoking the bundler,
 * so the staged bytes always match what was actually hashed (unlike a
 * hash-only cache, which can leave a second instance staging unbundled
 * source under a hash computed from bundled output).
 */
const OUTPUT_BUNDLE_CACHE = new Map<
  string,
  {
    readonly sha256: string;
    readonly storedPath: string;
    readonly outputType: BundleOutputType;
  }
>();

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Wraps a user-supplied bundler for `OUTPUT` hashing: dedups identical
 * builds via `OUTPUT_BUNDLE_CACHE` and captures a SHA256 fingerprint of the
 * produced directory (AWS CDK compatibility; cdktn's own `assetHash` is
 * MD5-based) for the caller to read back once `bundle()` has run.
 */
class CapturingOutputBundler implements IAssetBundler {
  public readonly bundlerKey?: string;
  private hash?: string;

  constructor(
    private readonly inner: IAssetBundler,
    private readonly cacheKey: string,
  ) {
    this.bundlerKey = inner.bundlerKey;
  }

  public get capturedHash(): string | undefined {
    return this.hash;
  }

  public bundle(options: BundleOptions): BundleResult {
    const cached = OUTPUT_BUNDLE_CACHE.get(this.cacheKey);
    if (cached) {
      this.hash = cached.sha256;
      if (cached.outputType === BundleOutputType.FILE) {
        const dest = path.join(
          options.outputDir,
          path.basename(cached.storedPath),
        );
        fs.copyFileSync(cached.storedPath, dest);
        return BundleResult.file(dest);
      }
      FileSystem.copyDirectory(cached.storedPath, options.outputDir);
      return BundleResult.directory(options.outputDir);
    }

    const result = this.inner.bundle(options);
    if (result.isDeclined) {
      return result;
    }

    const produced = result.path!;
    const digest = FileSystem.fingerprint(produced);

    const scratch = fs.mkdtempSync(
      path.join(os.tmpdir(), "tcons-bundle-cache-"),
    );
    let storedPath: string;
    if (result.outputType === BundleOutputType.FILE) {
      storedPath = path.join(scratch, path.basename(produced));
      fs.copyFileSync(produced, storedPath);
    } else {
      storedPath = scratch;
      FileSystem.copyDirectory(produced, storedPath);
    }
    OUTPUT_BUNDLE_CACHE.set(this.cacheKey, {
      sha256: digest,
      storedPath,
      outputType: result.outputType!,
    });

    this.hash = digest;
    return result;
  }
}

/**
 * Inputs needed to resolve an AWS-CDK-compatible SHA256 `assetHash` for a
 * `TerraformAsset`.
 */
export interface Sha256AssetHashOptions {
  readonly sourcePath: string;
  readonly exclude?: string[];
  readonly extraHash?: string;
  readonly assetHash?: string;
  readonly assetHashType?: AssetHashType;
  readonly bundler?: IAssetBundler;
}

/**
 * The `assetHash`/`assetHashType`/`bundler` to pass into a `TerraformAsset`,
 * plus a `finalize` hook to call with the constructed asset once it exists
 * (only does anything for `OUTPUT` hashing, where the real SHA256 hash isn't
 * known until the bundler has actually run inside the `TerraformAsset`
 * constructor).
 */
export interface ISha256AssetHashResolution {
  readonly assetHash?: string;
  readonly assetHashType: AssetHashType;
  readonly bundler?: IAssetBundler;
  finalize(asset: IAsset): void;
}

/**
 * Validate props for AWS CDK compatibility.
 */
function validateProps(props: Sha256AssetHashOptions): void {
  const hashType = props.assetHashType;
  if (!hashType) {
    return;
  }
  if (props.assetHash && hashType !== AssetHashType.CUSTOM) {
    throw new Error(
      `Cannot specify \`${hashType}\` for \`assetHashType\` when \`assetHash\` is specified. Use \`AssetHashType.CUSTOM\` or leave undefined.`,
    );
  }
  if (hashType === AssetHashType.OUTPUT && !props.bundler) {
    throw new Error(
      "Cannot use `output` hash type when `bundler` is not specified.",
    );
  }
}

/**
 * Resolve an AWS-CDK-compatible SHA256 `assetHash` (cdktn hashes with MD5 by
 * default) for a `TerraformAsset`, ahead of constructing it.
 */
export function resolveSha256AssetHash(
  props: Sha256AssetHashOptions,
): ISha256AssetHashResolution {
  validateProps(props);

  const hashType =
    props.assetHashType ??
    (props.assetHash ? AssetHashType.CUSTOM : AssetHashType.SOURCE);

  if (hashType === AssetHashType.OUTPUT && props.bundler) {
    const sourcePath = path.resolve(props.sourcePath);
    const cacheKey = sha256(
      JSON.stringify({
        sourcePath,
        exclude: props.exclude,
        extraHash: props.extraHash,
        bundlerKey: props.bundler.bundlerKey,
      }),
    );
    const capturing = new CapturingOutputBundler(props.bundler, cacheKey);
    return {
      assetHashType: AssetHashType.OUTPUT,
      bundler: capturing,
      finalize: (asset) => {
        if (capturing.capturedHash) {
          Object.defineProperty(asset, "assetHash", {
            value: capturing.capturedHash,
            writable: false,
            enumerable: true,
            configurable: true,
          });
        }
      },
    };
  }

  if (hashType === AssetHashType.CUSTOM) {
    if (!props.assetHash) {
      throw new Error(
        "`assetHash` must be specified when `assetHashType` is set to `AssetHashType.CUSTOM`.",
      );
    }
    return {
      assetHash: sha256(props.assetHash),
      assetHashType: AssetHashType.CUSTOM,
      bundler: props.bundler,
      finalize: () => {},
    };
  }

  // SOURCE (default): hash the source for AWS CDK compatibility. The
  // bundler (if any) still runs, deferred, when the asset stages.
  const sourcePath = path.resolve(props.sourcePath);
  const sha256Hash = FileSystem.fingerprint(sourcePath, {
    exclude: props.exclude,
    extraHash: props.extraHash,
  });
  return {
    assetHash: sha256Hash,
    assetHashType: AssetHashType.CUSTOM,
    bundler: props.bundler,
    finalize: () => {},
  };
}
