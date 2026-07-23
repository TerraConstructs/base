// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/container-image.ts

import { Construct } from "constructs";
import { ContainerDefinition } from "./container-definition";
import { UnscopedValidationError } from "../../../errors";
import * as ecr from "../../storage";
// TERRACONSTRUCTS DEVIATION: upstream also supports `ContainerImage.fromTarball()`, backed by
// `TarballImageAsset` from `aws-ecr-assets`. The terraconstructs equivalent
// (`storage/assets/tarball-asset.ts`) has not been ported yet -- see the TODO in
// `storage/assets/index.ts` ("Requires support for executable assets in the core library"). Keep
// the import commented out and the `bind()` throws below until that lands.
// import { TarballImageAsset } from "../../storage/assets/tarball-asset";

/**
 * Constructs for types of container images
 */
export abstract class ContainerImage {
  /**
   * Reference an image on DockerHub or another online registry
   */
  public static fromRegistry(name: string, props: RepositoryImageProps = {}) {
    return new RepositoryImage(name, props);
  }

  /**
   * Reference an image in an ECR repository
   *
   * @param tag If you don't specify this parameter, `latest` is used as default.
   */
  public static fromEcrRepository(
    repository: ecr.IRepository,
    tag: string = "latest",
  ) {
    return new EcrImage(repository, tag);
  }

  /**
   * Reference an image that's constructed directly from sources on disk.
   *
   * If you already have a `DockerImageAsset` instance, you can use the
   * `ContainerImage.fromDockerImageAsset` method instead.
   *
   * @param directory The directory containing the Dockerfile
   */
  public static fromAsset(directory: string, props: AssetImageProps = {}) {
    return new AssetImage(directory, props);
  }

  /**
   * Use an existing `DockerImageAsset` for this container image.
   *
   * @param asset The `DockerImageAsset` to use for this container definition.
   */
  public static fromDockerImageAsset(asset: DockerImageAsset): ContainerImage {
    return {
      bind(
        _scope: Construct,
        containerDefinition: ContainerDefinition,
      ): ContainerImageConfig {
        containerDefinition._defaultDisableVersionConsistency?.();
        asset.repository.grantPull(
          containerDefinition.taskDefinition.obtainExecutionRole(),
        );
        return {
          imageName: asset.imageUri,
        };
      },
    };
  }

  /**
   * Use an existing tarball for this container image.
   *
   * Use this method if the container image has already been created by another process (e.g. jib)
   * and you want to add it as a container image asset.
   *
   * @param tarballFile Absolute path to the tarball. You can use language-specific idioms (such as `__dirname` in Node.js)
   *                    to create an absolute path based on the current script running directory.
   */
  public static fromTarball(_tarballFile: string): ContainerImage {
    return {
      bind(
        _scope: Construct,
        _containerDefinition: ContainerDefinition,
      ): ContainerImageConfig {
        // TODO: `storage/assets/tarball-asset.ts` (the port of aws-ecr-assets' `TarballImageAsset`)
        // does not exist yet. Once it lands, replace this throw with:
        //   const asset = new TarballImageAsset(scope, "Tarball", { tarballFile });
        //   asset.repository.grantPull(containerDefinition.taskDefinition.obtainExecutionRole());
        //   return { imageName: asset.imageUri };
        throw new UnscopedValidationError(
          "ContainerImage.fromTarball is not yet supported in terraconstructs -- storage/assets/tarball-asset.ts has not been ported",
        );
      },
    };
  }

  /**
   * Called when the image is used by a ContainerDefinition
   */
  public abstract bind(
    scope: Construct,
    containerDefinition: ContainerDefinition,
  ): ContainerImageConfig;
}

/**
 * The configuration for creating a container image.
 */
export interface ContainerImageConfig {
  /**
   * Specifies the name of the container image.
   */
  readonly imageName: string;

  /**
   * Specifies the credentials used to access the image repository.
   */
  readonly repositoryCredentials?: RepositoryCredentialsConfig;
}

/**
 * The credentials used to access a private image repository, as embedded in a
 * `ContainerImageConfig`.
 *
 * // TERRACONSTRUCTS DEVIATION: upstream types this as `CfnTaskDefinition.RepositoryCredentialsProperty`,
 * a CloudFormation L1 property type. There is no CFN L1 backing this in TerraConstructs -- the
 * `aws_ecs_task_definition` resource takes `container_definitions` as a single jsonencode()'d
 * string, so this is the plain shape that feeds the `repositoryCredentials` key of that JSON blob.
 */
export interface RepositoryCredentialsConfig {
  /**
   * The Amazon Resource Name (ARN) of the secret containing the private repository credentials.
   */
  readonly credentialsParameter?: string;
}

// These imports have to be at the end to prevent circular imports
import { AssetImage, AssetImageProps } from "./images/asset-image";
import { EcrImage } from "./images/ecr";
import { RepositoryImage, RepositoryImageProps } from "./images/repository";
import { DockerImageAsset } from "../../storage/assets/image-asset";
