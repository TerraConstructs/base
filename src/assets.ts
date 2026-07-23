// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/core/lib/assets.ts

// Import common asset types from cdktn
// Export enums and types that need to be used as values
export { AssetHashType, FileAssetPackaging } from "cdktn";

// Export type-only imports
export type {
  IAsset,
  FileAssetSource,
  DockerImageAssetSource,
  DockerCacheOption,
  DockerImageAssetLocation,
} from "cdktn";

// Import for local use
import type {
  BundlingOptions,
  AssetOptions as CdktnAssetOptions,
  FileAssetLocation as CdktnFileAssetLocation,
} from "cdktn";

/**
 * Asset hash options
 */
export interface AssetOptions extends CdktnAssetOptions {
  /**
   * Bundle the asset by executing a command in a Docker container or a custom bundling provider.
   *
   * The asset path will be mounted at `/asset-input`. The Docker
   * container is responsible for putting content at `/asset-output`.
   * The content at `/asset-output` will be zipped and used as the
   * final asset.
   *
   * @default - uploaded as-is to S3 if the asset is a regular file or a .zip file,
   * archived into a .zip file and uploaded to S3 otherwise
   */
  readonly bundling?: BundlingOptions;
}

/**
 * AWS-specific extension of FileAssetLocation with S3-specific properties.
 * Extends the generic FileAssetLocation from cdktn with AWS S3 legacy properties.
 */
export interface FileAssetLocation extends CdktnFileAssetLocation {
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
