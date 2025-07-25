// https://github.com/aws/aws-cdk/blob/v2.168.0/packages/aws-cdk-lib/aws-ecr-assets/lib/image-asset.ts

import * as fs from "fs";
import * as path from "path";
import { Annotations, Token } from "cdktf";
import { Construct } from "constructs";
import * as ecr from "..";
import {
  AssetStaging,
  FileFingerprintOptions,
  IgnoreMode,
  // ValidationError,
  // UnscopedValidationError,
  IAsset,
} from "../../..";
import { AwsStack } from "../../aws-stack";

/**
 * networking mode on build time supported by docker
 */
export class NetworkMode {
  /**
   * The default networking mode if omitted, create a network stack on the default Docker bridge
   */
  public static readonly DEFAULT = new NetworkMode("default");

  /**
   * Use the Docker host network stack
   */
  public static readonly HOST = new NetworkMode("host");

  /**
   * Disable the network stack, only the loopback device will be created
   */
  public static readonly NONE = new NetworkMode("none");

  /**
   * Reuse another container's network stack
   *
   * @param containerId The target container's id or name
   */
  public static fromContainer(containerId: string) {
    return new NetworkMode(`container:${containerId}`);
  }

  /**
   * Used to specify a custom networking mode
   * Use this if the networking mode name is not yet supported by the CDK.
   *
   * @param mode The networking mode to use for docker build
   */
  public static custom(mode: string) {
    return new NetworkMode(mode);
  }

  /**
   * @param mode The networking mode to use for docker build
   */
  private constructor(public readonly mode: string) {}
}

/**
 * platform supported by docker
 */
export class Platform {
  /**
   * Build for linux/amd64
   */
  public static readonly LINUX_AMD64 = new Platform("linux/amd64");

  /**
   * Build for linux/arm64
   */
  public static readonly LINUX_ARM64 = new Platform("linux/arm64");

  /**
   * Used to specify a custom platform
   * Use this if the platform name is not yet supported by the CDK.
   *
   * @param platform The platform to use for docker build
   */
  public static custom(platform: string) {
    return new Platform(platform);
  }

  /**
   * @param platform The platform to use for docker build
   */
  private constructor(public readonly platform: string) {}
}

/**
 * Options to control invalidation of `DockerImageAsset` asset hashes
 */
export interface DockerImageAssetInvalidationOptions {
  /**
   * Use `extraHash` while calculating the asset hash
   *
   * @default true
   */
  readonly extraHash?: boolean;

  /**
   * Use `buildArgs` while calculating the asset hash
   *
   * @default true
   */
  readonly buildArgs?: boolean;

  /**
   * Use `buildSecrets` while calculating the asset hash
   *
   * @default true
   */
  readonly buildSecrets?: boolean;

  /**
   * Use `buildSsh` while calculating the asset hash
   *
   * @default true
   */
  readonly buildSsh?: boolean;

  /**
   * Use `target` while calculating the asset hash
   *
   * @default true
   */
  readonly target?: boolean;

  /**
   * Use `file` while calculating the asset hash
   *
   * @default true
   */
  readonly file?: boolean;

  /**
   * Use `repositoryName` while calculating the asset hash
   *
   * @default true
   */
  readonly repositoryName?: boolean;

  /**
   * Use `networkMode` while calculating the asset hash
   *
   * @default true
   */
  readonly networkMode?: boolean;

  /**
   * Use `platform` while calculating the asset hash
   *
   * @default true
   */
  readonly platform?: boolean;

  /**
   * Use `outputs` while calculating the asset hash
   *
   * @default true
   */
  readonly outputs?: boolean;
}

// TODO: Duplicate from core.DockerCacheOption?
/**
 * Options for configuring the Docker cache backend
 */
export interface DockerCacheOption {
  /**
   * The type of cache to use.
   * Refer to https://docs.docker.com/build/cache/backends/ for full list of backends.
   * @default - unspecified
   *
   * @example 'registry'
   */
  readonly type: string;
  /**
   * Any parameters to pass into the docker cache backend configuration.
   * Refer to https://docs.docker.com/build/cache/backends/ for cache backend configuration.
   * @default {} No options provided
   *
   * @example
   * declare const branch: string;
   *
   * const params = {
   *   ref: `12345678.dkr.ecr.us-west-2.amazonaws.com/cache:${branch}`,
   *   mode: "max",
   * };
   */
  readonly params?: { [key: string]: string };
}

/**
 * Options for DockerImageAsset
 */
export interface DockerImageAssetOptions extends FileFingerprintOptions {
  /**
   * ECR repository name
   *
   * Specify this property if you need to statically address the image, e.g.
   * from a Kubernetes Pod. Note, this is only the repository name, without the
   * registry and the tag parts.
   *
   * @default - the default ECR repository for CDK assets
   * @deprecated to control the location of docker image assets, please override
   * `Stack.addDockerImageAsset`. this feature will be removed in future
   * releases.
   */
  readonly repositoryName?: string;

  /**
   * Build args to pass to the `docker build` command.
   *
   * Since Docker build arguments are resolved before deployment, keys and
   * values cannot refer to unresolved tokens (such as `lambda.functionArn` or
   * `queue.queueUrl`).
   *
   * @default - no build args are passed
   */
  readonly buildArgs?: { [key: string]: string };

  /**
   * Build secrets.
   *
   * Docker BuildKit must be enabled to use build secrets.
   *
   * @see https://docs.docker.com/build/buildkit/
   *
   * @default - no build secrets
   *
   * @example
   * import { DockerBuildSecret } from 'aws-cdk-lib';
   *
   * const buildSecrets = {
   *   'MY_SECRET': DockerBuildSecret.fromSrc('file.txt')
   * };
   */
  readonly buildSecrets?: { [key: string]: string };

  /**
   * SSH agent socket or keys to pass to the `docker build` command.
   *
   * Docker BuildKit must be enabled to use the ssh flag
   *
   * @see https://docs.docker.com/build/buildkit/
   *
   * @default - no --ssh flag
   */
  readonly buildSsh?: string;

  /**
   * Docker target to build to
   *
   * @default - no target
   */
  readonly target?: string;

  /**
   * Path to the Dockerfile (relative to the directory).
   *
   * @default 'Dockerfile'
   */
  readonly file?: string;

  /**
   * Networking mode for the RUN commands during build. Support docker API 1.25+.
   *
   * @default - no networking mode specified (the default networking mode `NetworkMode.DEFAULT` will be used)
   */
  readonly networkMode?: NetworkMode;

  /**
   * Platform to build for. _Requires Docker Buildx_.
   *
   * @default - no platform specified (the current machine architecture will be used)
   */
  readonly platform?: Platform;

  /**
   * Options to control which parameters are used to invalidate the asset hash.
   *
   * @default - hash all parameters
   */
  readonly invalidation?: DockerImageAssetInvalidationOptions;

  /**
   * Outputs to pass to the `docker build` command.
   *
   * @default - no outputs are passed to the build command (default outputs are used)
   * @see https://docs.docker.com/engine/reference/commandline/build/#custom-build-outputs
   */
  readonly outputs?: string[];

  /**
   * Unique identifier of the docker image asset and its potential revisions.
   * Required if using AppScopedStagingSynthesizer.
   *
   * @default - no asset name
   */
  readonly assetName?: string;

  /**
   * Cache from options to pass to the `docker build` command.
   *
   * @default - no cache from options are passed to the build command
   * @see https://docs.docker.com/build/cache/backends/
   */
  readonly cacheFrom?: DockerCacheOption[];

  /**
   * Cache to options to pass to the `docker build` command.
   *
   * @default - no cache to options are passed to the build command
   * @see https://docs.docker.com/build/cache/backends/
   */
  readonly cacheTo?: DockerCacheOption;

  /**
   * Disable the cache and pass `--no-cache` to the `docker build` command.
   *
   * @default - cache is used
   */
  readonly cacheDisabled?: boolean;
}

/**
 * Props for DockerImageAssets
 */
export interface DockerImageAssetProps extends DockerImageAssetOptions {
  /**
   * The directory where the Dockerfile is stored
   *
   * Any directory inside with a name that matches the CDK output folder (cdk.out by default) will be excluded from the asset
   */
  readonly directory: string;
}

/**
 * An asset that represents a Docker image.
 *
 * The image will be created in build time and uploaded to an ECR repository.
 *
 * WARNING: `DockerAsset[0-9]*` and `DockerAsset_Image[0-9]*` identifiers are
 * used internally by the Stack Asset Manager and will cause Id conflicts.
 */
export class DockerImageAsset extends Construct implements IAsset {
  /**
   * The full URI of the image (including a tag). Use this reference to pull
   * the asset.
   */
  public imageUri: string;

  /**
   * Repository where the image is stored
   */
  public repository: ecr.IRepository;

  /**
   * A hash of the source of this asset, which is available at construction time. As this is a plain
   * string, it can be used in construct IDs in order to enforce creation of a new resource when
   * the content hash has changed.
   * @deprecated use assetHash
   */
  public readonly sourceHash: string;

  /**
   * A hash of this asset, which is available at construction time. As this is a plain string, it
   * can be used in construct IDs in order to enforce creation of a new resource when the content
   * hash has changed.
   */
  public readonly assetHash: string;

  /**
   * The tag of this asset when it is uploaded to ECR. The tag may differ from the assetHash if a stack synthesizer adds a dockerTagPrefix.
   */
  public readonly imageTag: string;

  /**
   * The path to the asset, relative to the current Cloud Assembly
   *
   * If asset staging is disabled, this will just be the original path.
   *
   * If asset staging is enabled it will be the staged path.
   */
  private readonly assetPath: string;

  /**
   * The path to the Dockerfile, relative to the assetPath
   */
  private readonly dockerfilePath?: string;

  /**
   * Build args to pass to the `docker build` command.
   */
  private readonly dockerBuildArgs?: { [key: string]: string };

  /**
   * Build secrets to pass to the `docker build` command.
   */
  private readonly dockerBuildSecrets?: { [key: string]: string };

  /**
   * SSH agent socket or keys to pass to the `docker build` command.
   */
  private readonly dockerBuildSsh?: string;
  /**
   * Outputs to pass to the `docker build` command.
   */
  private readonly dockerOutputs?: string[];

  /**
   * Unique identifier of the docker image asset and its potential revisions.
   * Required if using AppScopedStagingSynthesizer.
   *
   * @default - no asset name
   */
  private readonly assetName?: string;

  /**
   * Cache from options to pass to the `docker build` command.
   */
  private readonly dockerCacheFrom?: DockerCacheOption[];

  /**
   * Cache to options to pass to the `docker build` command.
   */
  private readonly dockerCacheTo?: DockerCacheOption;

  /**
   * Disable the cache and pass `--no-cache` to the `docker build` command.
   */
  private readonly dockerCacheDisabled?: boolean;

  /**
   * Docker target to build to
   */
  private readonly dockerBuildTarget?: string;

  constructor(scope: Construct, id: string, props: DockerImageAssetProps) {
    super(scope, id);

    // none of the properties use tokens
    validateProps(props);

    // resolve full path
    const dir = path.resolve(props.directory);
    if (!fs.existsSync(dir)) {
      // throw new ValidationError(`Cannot find image directory at ${dir}`, this);
      throw new Error(`Cannot find image directory at ${dir}`);
    }

    // validate the docker file exists
    this.dockerfilePath = props.file || "Dockerfile";
    const file = path.join(dir, this.dockerfilePath);
    if (!fs.existsSync(file)) {
      // throw new ValidationError(`Cannot find file at ${file}`, this);
      throw new Error(`Cannot find file at ${file}`);
    }

    let ignoreMode = props.ignoreMode ?? IgnoreMode.DOCKER;

    let exclude: string[] = props.exclude || [];

    const ignore = path.join(dir, ".dockerignore");

    if (fs.existsSync(ignore)) {
      const dockerIgnorePatterns = fs
        .readFileSync(ignore)
        .toString()
        .split("\n")
        .filter((e) => !!e);

      exclude = [
        ...dockerIgnorePatterns,
        ...exclude,

        // Ensure .dockerignore is included no matter what.
        "!.dockerignore",
      ];
    }

    // Ensure the Dockerfile is included no matter what.
    exclude.push("!" + path.basename(file));
    // Ensure the cdk.out folder is not included to avoid infinite loops.
    // const cdkout = Stage.of(this)?.outdir ?? "cdk.out";
    // exclude.push(cdkout);
    exclude.push("cdk.out");

    if (props.repositoryName) {
      // "@aws-cdk/aws-ecr-assets:repositoryNameDeprecated",
      Annotations.of(this).addWarning(
        'DockerImageAsset.repositoryName is deprecated. Override "core.Stack.addDockerImageAsset" to control asset locations',
      );
    }

    // include build context in "extra" so it will impact the hash
    const extraHash: { [field: string]: any } = {};
    if (props.invalidation?.extraHash !== false && props.extraHash) {
      extraHash.user = props.extraHash;
    }
    if (props.invalidation?.buildArgs !== false && props.buildArgs) {
      extraHash.buildArgs = props.buildArgs;
    }
    if (props.invalidation?.buildSecrets !== false && props.buildSecrets) {
      extraHash.buildSecrets = props.buildSecrets;
    }
    if (props.invalidation?.buildSsh !== false && props.buildSsh) {
      extraHash.buildSsh = props.buildSsh;
    }
    if (props.invalidation?.target !== false && props.target) {
      extraHash.target = props.target;
    }
    if (props.invalidation?.file !== false && props.file) {
      extraHash.file = props.file;
    }
    if (props.invalidation?.repositoryName !== false && props.repositoryName) {
      extraHash.repositoryName = props.repositoryName;
    }
    if (props.invalidation?.networkMode !== false && props.networkMode) {
      extraHash.networkMode = props.networkMode;
    }
    if (props.invalidation?.platform !== false && props.platform) {
      extraHash.platform = props.platform;
    }
    if (props.invalidation?.outputs !== false && props.outputs) {
      extraHash.outputs = props.outputs;
    }

    // add "salt" to the hash in order to invalidate the image in the upgrade to
    // 1.21.0 which removes the AdoptedRepository resource (and will cause the
    // deletion of the ECR repository the app used).
    extraHash.version = "1.21.0";

    const staging = new AssetStaging(this, "Staging", {
      ...props,
      follow: props.followSymlinks,
      exclude,
      ignoreMode,
      sourcePath: dir,
      extraHash:
        Object.keys(extraHash).length === 0
          ? undefined
          : JSON.stringify(extraHash),
    });

    this.assetHash = staging.assetHash;
    this.sourceHash = this.assetHash;

    const stack = AwsStack.ofAwsConstruct(this);
    this.assetPath = staging.relativeStagedPath(stack);
    this.assetName = props.assetName;
    this.dockerBuildArgs = props.buildArgs;
    this.dockerBuildSecrets = props.buildSecrets;
    this.dockerBuildSsh = props.buildSsh;
    this.dockerBuildTarget = props.target;
    this.dockerOutputs = props.outputs;
    this.dockerCacheFrom = props.cacheFrom;
    this.dockerCacheTo = props.cacheTo;
    this.dockerCacheDisabled = props.cacheDisabled;

    const location = stack.addDockerImageAsset({
      directoryName: this.assetPath,
      assetName: this.assetName,
      dockerBuildArgs: this.dockerBuildArgs,
      dockerBuildSecrets: this.dockerBuildSecrets,
      dockerBuildSsh: this.dockerBuildSsh,
      dockerBuildTarget: this.dockerBuildTarget,
      dockerFile: props.file,
      sourceHash: staging.assetHash,
      networkMode: props.networkMode?.mode,
      platform: props.platform?.platform,
      dockerOutputs: this.dockerOutputs,
      dockerCacheFrom: this.dockerCacheFrom,
      dockerCacheTo: this.dockerCacheTo,
      dockerCacheDisabled: this.dockerCacheDisabled,
    });

    this.repository = ecr.Repository.fromRepositoryName(
      this,
      "Repository",
      location.repositoryName,
    );
    this.imageUri = location.imageUri;
    this.imageTag = location.imageTag ?? this.assetHash;
  }
}

function validateProps(props: DockerImageAssetProps) {
  for (const [key, value] of Object.entries(props)) {
    if (Token.isUnresolved(value)) {
      // throw new UnscopedValidationError(
      throw new Error(
        `Cannot use Token as value of '${key}': this value is used before deployment starts`,
      );
    }
  }

  validateBuildArgs(props.buildArgs);
  validateBuildSecrets(props.buildSecrets);
}

function validateBuildProps(
  buildPropName: string,
  buildProps?: { [key: string]: string },
) {
  for (const [key, value] of Object.entries(buildProps || {})) {
    if (Token.isUnresolved(key) || Token.isUnresolved(value)) {
      // throw new UnscopedValidationError(
      throw new Error(
        `Cannot use tokens in keys or values of "${buildPropName}" since they are needed before deployment`,
      );
    }
  }
}

function validateBuildArgs(buildArgs?: { [key: string]: string }) {
  validateBuildProps("buildArgs", buildArgs);
}

function validateBuildSecrets(buildSecrets?: { [key: string]: string }) {
  validateBuildProps("buildSecrets", buildSecrets);
}
