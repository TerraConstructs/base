// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/core/lib/assets.ts

// Import common asset types from cdktn
// Export enums and types that need to be used as values
export { AssetHashType } from "cdktn";

// Export type-only imports
export type { IAsset } from "cdktn";

// Import for local use
import type { AssetOptions as CdktnAssetOptions, IAssetBundler } from "cdktn";

/**
 * Asset hash options
 */
export interface AssetOptions extends CdktnAssetOptions {
  /**
   * Bundle the asset by running an {@link IAssetBundler} (e.g. a
   * `DockerBundler` from `@cdktn/bundler-docker` or a `LocalBundler` from
   * `@cdktn/bundler-local`) before staging it.
   *
   * @default - the source is staged verbatim, with no build step
   */
  readonly bundler?: IAssetBundler;

  /**
   * Extra information to encode into the fingerprint (e.g. build
   * instructions and other inputs).
   *
   * @default - hash is only based on source content
   */
  readonly extraHash?: string;
}

/**
 * How a packaged file asset is produced.
 *
 * `cdktn` core no longer carries this AWS-CDK-style publishing vocabulary
 * (it only knows directory vs. archive staging via `AssetType`), so this is
 * TerraConstructs' own asset-publishing contract, consumed by
 * `AwsAssetManager`.
 */
export enum FileAssetPackaging {
  /**
   * Upload the asset file as-is.
   */
  FILE = "file",

  /**
   * The asset source path points to a directory, which should be
   * archived using zip and and then uploaded.
   */
  ZIP_DIRECTORY = "zip",
}

/**
 * Represents a file asset's location that was staged and is ready to be
 * published.
 */
export interface FileAssetLocation {
  /**
   * The name of the bucket.
   */
  readonly bucketName: string;

  /**
   * The S3 key.
   */
  readonly objectKey: string;

  /**
   * The HTTP URL of this asset.
   */
  readonly httpUrl: string;

  /**
   * The object URL, in `s3://bucket/key` form, suitable for Terraform
   * resource references and token resolution.
   */
  readonly objectUrl: string;

  /**
   * The ARN of the KMS key used to encrypt the file asset bucket, if any.
   *
   * The CDK bootstrap stack comes with a key policy that does not require
   * setting this property, so you only need to set this property if you
   * have customized the bootstrap stack to require it.
   *
   * @default - Asset bucket is not encrypted, or decryption permissions are
   * defined by a Key Policy.
   */
  readonly kmsKeyArn?: string;

  /**
   * The HTTP URL of this asset on Amazon S3.
   * @default - value specified in `httpUrl` is used.
   * @deprecated use `httpUrl`
   */
  readonly s3Url?: string;

  /**
   * The S3 URL of this asset on Amazon S3.
   *
   * This value suitable for inclusion in a Terraform configuration, and
   * may be an encoded token.
   *
   * Example value: `s3://mybucket/myobject`
   *
   * @deprecated use `objectUrl`
   */
  readonly s3ObjectUrl?: string;

  /**
   * Like `s3ObjectUrl`, but not suitable for Terraform consumption
   *
   * If there are placeholders in the S3 URL, they will be returned un-replaced
   * and un-evaluated.
   *
   * @default - This feature cannot be used
   * @deprecated use `objectUrlWithPlaceholders`
   */
  readonly s3ObjectUrlWithPlaceholders?: string;
}

/**
 * Represents the source for a file asset.
 */
export interface FileAssetSource {
  /**
   * A hash on the content source. This hash is used to uniquely identify
   * this asset throughout the system. If this value doesn't change, the
   * asset will not be rebuilt or republished.
   */
  readonly sourceHash: string;

  /**
   * The path, relative to the root of the terraform directory, in which
   * this asset source resides (e.g. a `TerraformAsset.path`). This can be a
   * path to a file or a directory, depending on the packaging type.
   */
  readonly fileName: string;

  /**
   * Which type of packaging to perform.
   */
  readonly packaging: FileAssetPackaging;

  /**
   * Whether or not the asset needs to exist beyond deployment time; i.e.
   * are copied over to a different location and not needed afterwards.
   *
   * @default false
   */
  readonly deployTime?: boolean;
}

/**
 * A Docker cache option.
 */
export interface DockerCacheOption {
  /**
   * The type of cache to use.
   *
   * Refer to https://docs.docker.com/build/cache/backends/ for full list of backends.
   *
   * @default - `registry`
   */
  readonly type: string;

  /**
   * Any parameters to pass into the docker cache backend configuration.
   *
   * Refer to https://docs.docker.com/build/cache/backends/ for cache backend configuration.
   *
   * @default {} No options provided
   */
  readonly params?: { [key: string]: string };
}

/**
 * Represents the source for a Docker image asset.
 */
export interface DockerImageAssetSource {
  /**
   * A hash on the content source. This hash is used to uniquely identify
   * this asset throughout the system. If this value doesn't change, the
   * asset will not be rebuilt or republished.
   */
  readonly sourceHash: string;

  /**
   * The directory where the Dockerfile is stored, relative to the root of
   * the terraform directory (e.g. a `TerraformAsset.path`).
   */
  readonly directoryName: string;

  /**
   * A unique identifier for the asset, used to disambiguate assets built
   * from the same source but configured differently (e.g. different build
   * args).
   *
   * @default - no asset name is specified
   */
  readonly assetName?: string;

  /**
   * Build args to pass to the `docker build` command.
   *
   * Since Docker build arguments are resolved before deployment, keys and
   * values cannot refer to unresolved tokens (such as `lambda.functionArn`
   * or `queue.queueUrl`).
   *
   * @default - no build args are passed
   */
  readonly dockerBuildArgs?: { [key: string]: string };

  /**
   * Build secrets to pass to the `docker build` command.
   *
   * @default - no build secrets are passed
   */
  readonly dockerBuildSecrets?: { [key: string]: string };

  /**
   * SSH agent socket or keys to pass to the `docker build` command.
   *
   * @default - no ssh arg is passed
   */
  readonly dockerBuildSsh?: string;

  /**
   * Docker target to build to.
   *
   * @default - no target
   */
  readonly dockerBuildTarget?: string;

  /**
   * Path to the Dockerfile (relative to the directory).
   *
   * @default "Dockerfile"
   */
  readonly dockerFile?: string;

  /**
   * ECR repository name, if different from the default.
   *
   * @default - the default ECR repository for CDK/CDKTN assets
   */
  readonly repositoryName?: string;

  /**
   * Outputs to pass to the `docker build` command.
   *
   * @default - no outputs are passed to the build command (default outputs are used)
   */
  readonly dockerOutputs?: string[];

  /**
   * Networking mode for the RUN commands during build.
   *
   * @default - no networking mode specified
   */
  readonly networkMode?: string;

  /**
   * Platform to build for. Requires Docker Buildx.
   *
   * @default - current machine platform
   */
  readonly platform?: string;

  /**
   * Cache from options to pass to the `docker build` command.
   *
   * @default - no cache from args are passed
   */
  readonly dockerCacheFrom?: DockerCacheOption[];

  /**
   * Cache to options to pass to the `docker build` command.
   *
   * @default - no cache to args are passed
   */
  readonly dockerCacheTo?: DockerCacheOption;

  /**
   * Disable the cache and pass `--no-cache` to the `docker build` command.
   *
   * @default - cache is used
   */
  readonly dockerCacheDisabled?: boolean;
}

/**
 * The location of the published Docker image.
 */
export interface DockerImageAssetLocation {
  /**
   * The URI of the image in Amazon ECR.
   */
  readonly imageUri: string;

  /**
   * The name of the ECR repository.
   */
  readonly repositoryName: string;

  /**
   * The tag of the image in Amazon ECR.
   */
  readonly imageTag: string;
}
