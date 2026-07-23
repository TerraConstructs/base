// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/images/asset-image.ts

import { Construct } from "constructs";
import {
  DockerImageAsset,
  DockerImageAssetOptions,
} from "../../../storage/assets/image-asset";
import { ContainerDefinition } from "../container-definition";
import { ContainerImage, ContainerImageConfig } from "../container-image";

/**
 * The properties for building an AssetImage.
 */
export interface AssetImageProps extends DockerImageAssetOptions {}

/**
 * An image that will be built from a local directory with a Dockerfile
 */
export class AssetImage extends ContainerImage {
  /**
   * Constructs a new instance of the AssetImage class.
   *
   * @param directory The directory containing the Dockerfile
   */
  constructor(
    private readonly directory: string,
    private readonly props: AssetImageProps = {},
  ) {
    super();
  }

  public bind(
    scope: Construct,
    containerDefinition: ContainerDefinition,
  ): ContainerImageConfig {
    containerDefinition._defaultDisableVersionConsistency?.();
    const asset = new DockerImageAsset(scope, "AssetImage", {
      directory: this.directory,
      ...this.props,
    });

    asset.repository.grantPull(
      containerDefinition.taskDefinition.obtainExecutionRole(),
    );

    return {
      imageName: asset.imageUri,
    };
  }
}
