// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/core/lib/bundling.ts

import {
  DockerImage,
  DockerBuildSecret,
  BundlingFileAccess,
  DockerBundler,
} from "@cdktn/bundler-docker";
import type {
  DockerRunOptions,
  DockerVolume,
  DockerBundlerProps,
  DockerBuildOptions,
} from "@cdktn/bundler-docker";
import { LocalBundler, BundlingOutput } from "@cdktn/bundler-local";
import type { LocalBundlerProps } from "@cdktn/bundler-local";
import { BundlerKey, BundleResult } from "cdktn";
import type { IAssetBundler, BundleOptions } from "cdktn";

// Re-export the current cdktn bundling model -- `DockerImage`,
// `DockerBundler`, `LocalBundler` and friends now live in
// `@cdktn/bundler-docker`/`@cdktn/bundler-local` and already implement it
// (returning a `BundleResult` from `bundle()`), so TerraConstructs just
// forwards them rather than wrapping or reimplementing.
export {
  DockerImage,
  DockerBuildSecret,
  BundlingFileAccess,
  DockerBundler,
  LocalBundler,
  BundlingOutput,
  BundlerKey,
  BundleResult,
};
export type {
  DockerRunOptions,
  DockerVolume,
  DockerBundlerProps,
  DockerBuildOptions,
  LocalBundlerProps,
  IAssetBundler,
  BundleOptions,
};

/**
 * A Docker image used for asset bundling
 *
 * @deprecated use DockerImage from `@cdktn/bundler-docker`
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
