import {
  DockerImageAssetLocation,
  DockerImageAssetSource,
  FileAssetLocation,
  FileAssetSource,
} from "./assets";

/**
 * Interface for managing assets (files and Docker images) in infrastructure stacks.
 *
 * This interface abstracts asset management to avoid circular dependencies between
 * stack implementations and storage constructs.
 */
export interface IAssetManager {
  /**
   * Register a file asset and return its location details.
   *
   * @param asset The file asset source information
   * @returns Location details for the uploaded file asset
   */
  addFileAsset(asset: FileAssetSource): FileAssetLocation;

  /**
   * Register a Docker image asset and return its location details.
   *
   * @param asset The Docker image asset source information
   * @returns Location details for the built and pushed Docker image
   */
  addDockerImageAsset(asset: DockerImageAssetSource): DockerImageAssetLocation;
}
