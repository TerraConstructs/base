// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/core/lib/bundling.ts

// Re-export core bundling types from cdktn
export {
  type BundlingOptions,
  BundlingOutput,
  BundlingFileAccess,
  DockerImage,
  DockerVolumeConsistency,
} from "cdktn";
export type { ILocalBundling, DockerRunOptions, DockerVolume } from "cdktn";

import type { DockerBuildOptions as CdktnDockerBuildOptions } from "cdktn";
import { DockerImage } from "cdktn";
import { DockerCacheOption } from "./assets";

/**
 * Methods to build Docker CLI arguments for builds using secrets.
 *
 * Docker BuildKit must be enabled to use build secrets.
 *
 * @see https://docs.docker.com/build/buildkit/
 */
export class DockerBuildSecret {
  /**
   * A Docker build secret from a file source
   * @param src The path to the source file, relative to the build directory.
   * @returns The latter half required for `--secret`
   */
  public static fromSrc(src: string): string {
    return `src=${src}`;
  }
}

/**
 * A Docker image used for asset bundling
 *
 * @deprecated use DockerImage from cdktn
 */
export class BundlingDockerImage {
  /**
   * Reference an image on DockerHub or another online registry.
   *
   * @param image the image name
   */
  public static fromRegistry(image: string) {
    return DockerImage.fromRegistry(image);
  }

  /**
   * Reference an image that's built directly from sources on disk.
   *
   * @param path The path to the directory containing the Docker file
   * @param options Docker build options
   *
   * @deprecated use DockerImage.fromBuild()
   */
  public static fromAsset(
    path: string,
    options: DockerBuildOptions = {},
  ): DockerImage {
    return DockerImage.fromBuild(path, options);
  }
}

/**
 * Docker build options - extends cdktn's DockerBuildOptions with AWS-specific cache options
 */
export interface DockerBuildOptions extends CdktnDockerBuildOptions {
  /**
   * Cache from options to pass to the `docker build` command.
   *
   * @default - no cache from args are passed
   */
  readonly cacheFrom?: DockerCacheOption[];

  /**
   * Cache to options to pass to the `docker build` command.
   *
   * @default - no cache to args are passed
   */
  readonly cacheTo?: DockerCacheOption;
}
