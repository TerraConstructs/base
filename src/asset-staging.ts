// TerraConstructs-specific AssetStaging that uses SHA256 hashing
// Uses cdktn's AssetStaging with custom hash calculation for AWS compatibility
// and proper Docker ignore pattern support including negation patterns

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AssetStaging as CdktnAssetStaging, AssetHashType } from "cdktn";
import type { AssetStagingProps } from "cdktn";
import { Construct } from "constructs";
import { FileSystem, IgnoreMode } from "./fs";

/**
 * Cache for OUTPUT hash type bundling results.
 * Key: source hash (hash of source + bundling options)
 * Value: { outputHash: string, stagedPath: string }
 */
const OUTPUT_HASH_CACHE = new Map<
  string,
  { outputHash: string; stagedPath: string }
>();

/**
 * TerraConstructs AssetStaging with SHA256 hashing for AWS compatibility.
 *
 * Uses cdktn's AssetStaging with custom SHA256 hashing (via customHash extension point)
 * instead of cdktn's default MD5 uppercase to maintain compatibility with AWS CDK.
 */
export class AssetStaging extends CdktnAssetStaging {
  /**
   * Validate props for AWS CDK compatibility
   */
  private static validateProps(props: AssetStagingProps): void {
    const hashType = props.assetHashType;
    const customHash = props.assetHash;
    const bundling = props.bundling;

    // Only validate if hashType is specified
    if (!hashType) {
      return;
    }

    // Validate that assetHash and assetHashType are compatible
    if (customHash && hashType !== AssetHashType.CUSTOM) {
      throw new Error(
        `Cannot specify \`${hashType}\` for \`assetHashType\` when \`assetHash\` is specified. Use \`AssetHashType.CUSTOM\` or leave undefined.`,
      );
    }

    // Validate OUTPUT hash type requires bundling
    if (hashType === AssetHashType.OUTPUT && !bundling) {
      throw new Error(
        "Cannot use `output` hash type when `bundling` is not specified.",
      );
    }

    // BUNDLE is deprecated alias for OUTPUT (check as string since it may not exist in enum)
    if ((hashType as string) === "bundle" && !bundling) {
      throw new Error(
        "Cannot use `bundle` hash type when `bundling` is not specified.",
      );
    }
  }

  /**
   * Calculate SHA256 hash for the asset (AWS CDK compatible).
   * This maintains the same hashing behavior as AWS CDK.
   */
  private static calculateSha256Hash(props: AssetStagingProps): string {
    const sourcePath = path.resolve(props.sourcePath);

    // Use FileSystem.fingerprint for SHA256 hashing
    const fingerprintOptions = {
      exclude: props.exclude,
      extraHash: props.extraHash,
    };

    return FileSystem.fingerprint(sourcePath, fingerprintOptions);
  }

  /**
   * Helper to create a SHA256 hash from a string
   */
  private static sha256(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  constructor(scope: Construct, id: string, props: AssetStagingProps) {
    // Validate hash type and bundling combinations
    AssetStaging.validateProps(props);

    // Determine the hash type to use
    const hashType =
      props.assetHashType ??
      (props.assetHash ? AssetHashType.CUSTOM : AssetHashType.SOURCE);

    // For OUTPUT hash type, we need special handling:
    // 1. Create a cache key from source path + bundling options (no fingerprinting)
    // 2. Check if we've already bundled this exact combination
    // 3. If yes, reuse the cached output hash without bundling again
    // 4. If no, bundle and cache the result
    if (hashType === AssetHashType.OUTPUT && props.bundling) {
      // Calculate a cache key: source path + bundling options (no fingerprinting for cache key)
      const sourcePath = path.resolve(props.sourcePath);

      // Create a stable key from source path + bundling options + excludes + extraHash
      const cacheKey = AssetStaging.sha256(
        JSON.stringify({
          sourcePath,
          exclude: props.exclude,
          extraHash: props.extraHash,
          bundling: {
            image: props.bundling.image.toJSON(),
            command: props.bundling.command,
            entrypoint: props.bundling.entrypoint,
            environment: props.bundling.environment,
            workingDirectory: props.bundling.workingDirectory,
            user: props.bundling.user,
            network: props.bundling.network,
            platform: props.bundling.platform,
            securityOpt: props.bundling.securityOpt,
            outputType: props.bundling.outputType,
          },
        }),
      );

      // Check cache
      const cached = OUTPUT_HASH_CACHE.get(cacheKey);
      if (cached) {
        // Use cached result - pass the already-hashed output directly to cdktn
        // We use SOURCE hash type here to prevent cdktn from re-hashing,
        // but provide our pre-calculated hash
        super(scope, id, {
          ...props,
          assetHash: cached.outputHash,
          assetHashType: AssetHashType.CUSTOM,
          bundling: undefined, // Skip bundling since we have cached result
        });
        return;
      }

      // Not in cache - let cdktn bundle and then calculate SHA256 of output
      super(scope, id, {
        ...props,
        assetHashType: AssetHashType.OUTPUT,
      });

      // Calculate SHA256 of the bundled output
      const sha256Hash = FileSystem.fingerprint(this.absoluteStagedPath, {
        exclude: props.exclude,
        extraHash: props.extraHash,
      });

      // Cache the result for future use
      OUTPUT_HASH_CACHE.set(cacheKey, {
        outputHash: sha256Hash,
        stagedPath: this.absoluteStagedPath,
      });

      // Update the hash to SHA256
      Object.defineProperty(this, "assetHash", {
        value: sha256Hash,
        writable: false,
        enumerable: true,
        configurable: true,
      });

      return;
    }

    // Handle CUSTOM hash type - AWS CDK hashes the custom value with SHA256
    if (hashType === AssetHashType.CUSTOM) {
      if (!props.assetHash) {
        throw new Error(
          "`assetHash` must be specified when `assetHashType` is set to `AssetHashType.CUSTOM`.",
        );
      }
      // AWS CDK hashes the custom value with SHA256
      const hashedCustom = AssetStaging.sha256(props.assetHash);
      super(scope, id, {
        ...props,
        assetHash: hashedCustom,
        assetHashType: AssetHashType.CUSTOM,
      });
      return;
    }

    // For SOURCE hash type (default), calculate SHA256 hash for AWS compatibility
    const sha256Hash = AssetStaging.calculateSha256Hash(props);

    // Pass to cdktn with custom hash
    super(scope, id, {
      ...props,
      assetHash: sha256Hash,
      assetHashType: AssetHashType.CUSTOM,
    });

    // Re-stage with proper Docker ignore pattern support if needed
    this.stageWithDockerIgnore(
      path.resolve(props.sourcePath),
      this.absoluteStagedPath,
      props,
    );
  }

  /**
   * Stage files with proper Docker ignore pattern support.
   * This is called after CDKTN's staging to ensure proper file filtering with negation patterns.
   */
  private stageWithDockerIgnore(
    sourcePath: string,
    stagedPath: string,
    props: AssetStagingProps,
  ): void {
    // Check if we need to re-stage with proper Docker ignore handling
    const needsDockerIgnore =
      props.exclude && props.exclude.some((pattern) => pattern.startsWith("!"));

    if (!needsDockerIgnore) {
      // No negation patterns, CDKTN's staging is fine
      return;
    }

    // CDKTN already created the directory and may have copied some files
    // We need to re-copy with proper ignore handling
    // Clear the staged directory first
    if (fs.existsSync(stagedPath)) {
      fs.rmSync(stagedPath, { recursive: true, force: true });
    }

    // Copy with proper Docker ignore mode
    FileSystem.copyDirectory(sourcePath, stagedPath, {
      exclude: props.exclude,
      ignoreMode: IgnoreMode.DOCKER,
    });
  }

  /**
   * Return the path to the staged asset, relative to the stack's outdir.
   * This is AWS CDK compatibility method.
   *
   * @param stack The stack
   * @returns The relative path of the staged asset
   */
  public relativeStagedPath(stack: any): string {
    // Get outdir from the stack's root (App)
    const outdir = stack.node?.root?.outdir || stack.outdir;
    return path.relative(outdir, this.absoluteStagedPath);
  }

  /**
   * Deprecated alias for absoluteStagedPath
   * @deprecated Use `absoluteStagedPath` instead
   */
  public get stagedPath(): string {
    return this.absoluteStagedPath;
  }
}

// Re-export AssetStagingProps from cdktn
export type { AssetStagingProps } from "cdktn";
