import * as fs from "node:fs";
import * as path from "node:path";
import {
  s3Bucket,
  s3Object,
  ecrRepository,
  dataAwsEcrRepository,
  dataAwsS3Bucket,
} from "@cdktf/provider-aws";
import {
  provider as dockerProvider,
  image as dockerImage,
  registryImage as dockerRegistryImage,
} from "@cdktf/provider-docker";
import {
  AssetType,
  TerraformAsset,
  // ref,
} from "cdktf";
import { Construct } from "constructs";
import * as mime from "mime-types";
import { IAssetManager } from "../asset-manager";
import {
  DockerCacheOption,
  DockerImageAssetLocation,
  DockerImageAssetSource,
  FileAssetLocation,
  FileAssetPackaging,
  FileAssetSource,
} from "../assets";

export interface AwsAssetManagerOptions {
  /**
   * Existing bucket name to upload file assets to S3.
   *
   * @default - a bucket will be created on demand using the gridUUID
   */
  readonly bucketName?: string;
  /**
   * bucketPrefix to use while storing S3 Assets
   *
   * @default - "" (no prefix)
   */
  readonly bucketPrefix?: string;
  /**
   * Qualifier for asset resource names when creating them on demand
   *
   * @default - "${GridUUID}-assets"
   */
  readonly qualifier?: string;
  /**
   * Use existing ECR Repository for container image assets.
   *
   * @default - a repository will be created on demand using the provided qualifier
   */
  readonly repositoryName?: string; // TODO: Support URI + URI Parsing for cross Account usage?
  /**
   * A prefix to use while tagging and uploading Docker images to ECR.
   *
   * This does not add any separators - the source hash will be appended to
   * this string directly.
   *
   * @default - "" (no prefix)
   */
  readonly dockerTagPrefix?: string;
}

/**
 * Properties for the AWS Asset Manager implementation used by AWS stacks.
 */
export interface AwsAssetManagerProps extends AwsAssetManagerOptions {
  /**
   * The region for creating AWS resources
   */
  readonly region: string;

  /**
   * The account ID for creating AWS resources
   */
  readonly account: string;

  /**
   * The partition for creating AWS resources
   */
  readonly partition: string;

  /**
   * The URL suffix for the partition
   */
  readonly urlSuffix: string;
}

/**
 * AWS implementation of IAssetManager using raw Terraform provider resources.
 *
 * This implementation avoids circular dependencies by using raw Terraform resources
 * instead of L2 constructs like Bucket and Repository.
 */
export class AwsAssetManager implements IAssetManager {
  private bucket?: s3Bucket.S3Bucket | dataAwsS3Bucket.DataAwsS3Bucket;
  private repository?:
    | ecrRepository.EcrRepository
    | dataAwsEcrRepository.DataAwsEcrRepository;
  private dockerProvider?: dockerProvider.DockerProvider;
  /**
   * Map of Terraform assets registered by this manager.
   */
  private readonly fileAssetMap = new Map<string, FileAssetLocation>();
  private readonly dockerAssetMap = new Map<string, DockerImageAssetLocation>();
  constructor(
    private readonly scope: Construct,
    private readonly props: AwsAssetManagerProps,
  ) {}

  /**
   * Register a file asset and return its location details.
   */
  public addFileAsset(asset: FileAssetSource): FileAssetLocation {
    if (!this.bucket) {
      this.ensureBucket();
    }

    // TODO: Support executable asset props?
    // validateFileAssetSource(asset);
    // const extension = asset.fileName != undefined ? path.extname(asset.fileName) : "";
    const extension = path.extname(asset.fileName);
    const bucketPrefix = this.props.bucketPrefix ?? "";
    const objectKey =
      bucketPrefix +
      asset.sourceHash +
      (asset.packaging === FileAssetPackaging.ZIP_DIRECTORY
        ? ".zip"
        : extension);

    if (this.fileAssetMap.has(objectKey)) {
      return this.fileAssetMap.get(objectKey)!;
    }

    // NOTE: AWSCDK uses sourceHash as the Construct ID
    // Avoided here because TerraformAsset paths already includes sourceHash
    // Ensure unique ID for the asset in the scope
    let id = "FileAsset";
    for (let i = 0; this.scope.node.tryFindChild(id); i++) {
      id = `${id}_${i}`;
    }

    const assetStats = fs.statSync(asset.fileName);
    const tfAsset = new TerraformAsset(this.scope, id, {
      path: asset.fileName,
      assetHash: asset.sourceHash,
      type: assetStats.isDirectory() ? AssetType.ARCHIVE : AssetType.FILE,
    });

    const s3Asset = new s3Object.S3Object(this.scope, `${id}_S3`, {
      key: objectKey,
      bucket: this.bucket!.bucket,
      source: tfAsset.path,
      sourceHash: asset.sourceHash,
      contentType: mime.contentType(extension) || undefined,
    });

    const httpUrl = this.buildS3Url(s3Asset.key);
    // Store the asset location details
    const location: FileAssetLocation = {
      bucketName: this.bucket!.bucket,
      objectKey: s3Asset.key,
      httpUrl,
      s3Url: httpUrl,
      s3ObjectUrl: this.buildS3ObjectUrl(s3Asset.key),
    };
    // Store in the map for future lookups
    this.fileAssetMap.set(objectKey, location);
    // Return the asset location details
    return location;
  }

  /**
   * Register a Docker image asset and return its location details.
   */
  public addDockerImageAsset(
    asset: DockerImageAssetSource,
  ): DockerImageAssetLocation {
    // validateDockerImageAssetSource(asset);
    if (!this.dockerProvider) {
      this.ensureDockerProvider();
    }
    if (!this.repository) {
      this.ensureRepository();
    }
    // Ensure dependency on ecr repo by using token instead of this.buildRepositoryUri();
    const repositoryUri = this.repository!.repositoryUrl;

    const dockerTagPrefix = this.props.dockerTagPrefix ?? "";
    const imageTag = `${dockerTagPrefix}${asset.sourceHash}`;
    const imageUri = `${repositoryUri}:${imageTag}`;

    if (this.dockerAssetMap.has(imageUri)) {
      return this.dockerAssetMap.get(imageUri)!;
    }

    // NOTE: AWSCDK uses sourceHash as the Construct ID
    // const sourceHash = asset.assetName
    //   ? `${asset.assetName}-${asset.sourceHash}`
    //   : asset.sourceHash;

    // Ensure unique ID for the asset in the scope
    let id = "DockerAsset";
    for (let i = 0; this.scope.node.tryFindChild(id); i++) {
      id = `${id}_${i}`;
    }

    const tfAsset = new TerraformAsset(this.scope, id, {
      path: asset.directoryName,
      assetHash: asset.sourceHash,
      type: AssetType.DIRECTORY, // Error if not directory asset type?
      // auto infer type...
      // type: <auto-infer>,
    });

    const imageAsset = new dockerImage.Image(this.scope, `${id}_Image`, {
      // https://github.com/kreuzwerker/terraform-provider-docker/blob/v3.6.2/internal/provider/docker_buildx_build.go#L216
      name: imageUri,
      buildAttribute: {
        context: tfAsset.path, // asset.directoryName, // required
        // TODO: Verify if ${path.cwd} is needed given directoryName is relative?
        // path.join(
        //   Token.asString(ref("path.cwd")),
        //   asset.directoryName,
        // ),
        dockerfile: asset.dockerFile,
        buildArgs: asset.dockerBuildArgs,
        secrets: asset.dockerBuildSecrets
          ? Object.entries(asset.dockerBuildSecrets).map(([k, v]) => ({
              id: k,
              // TODO: env secrets?
              src: v,
            }))
          : undefined,
        networkMode: asset.networkMode,
        platform: asset.platform,
        target: asset.dockerBuildTarget,
        cacheFrom: asset.dockerCacheFrom
          ? parseDockerCacheEntries(...asset.dockerCacheFrom)
          : undefined,
        noCache: asset.dockerCacheDisabled,
        // Enable buildx (currently does not support ulimits)
        builder: "default",
        // TODO: no SSH Support?,
        // ssh: asset.dockerBuildSSH,
        // TODO: no cacheTo support?
        // cacheTo: asset.dockerCacheTo
        //   ? parseCacheEntries(asset.dockerCacheTo)
        //   : undefined,
        // TODO: no dockerOutputs support?
        // outputs: asset.dockerOutputs,
      },
      triggers: {
        dir_sha1: asset.sourceHash, // use sourceHash to trigger rebuilds
      },
      // executable: asset.executable, // TODO: Support executable assets
    });

    const registryImage = new dockerRegistryImage.RegistryImage(
      this.scope,
      `${id}_RegistryImage`,
      {
        name: imageAsset.name,
      },
    );

    const location: DockerImageAssetLocation = {
      imageUri: registryImage.name,
      repositoryName: this.repository!.name,
      imageTag,
    };
    // Store the asset location details
    this.dockerAssetMap.set(imageUri, location);
    // Return the asset location details
    return location;
  }

  private ensureBucket(): void {
    if (this.bucket) return;

    if (this.props.bucketName) {
      // Use existing bucket if provided
      this.bucket = new dataAwsS3Bucket.DataAwsS3Bucket(
        this.scope,
        "ExistingAssetBucket",
        {
          bucket: this.props.bucketName,
        },
      );
      return;
    }

    const bucketName = `${this.props.qualifier ?? "assets"}-${this.props.account}-${this.props.region}`;

    this.bucket = new s3Bucket.S3Bucket(this.scope, "AssetBucket", {
      bucket: bucketName,
    });
  }

  private ensureRepository(): void {
    if (this.repository) return;

    if (this.props.repositoryName) {
      // Use existing repository if provided
      this.repository = new dataAwsEcrRepository.DataAwsEcrRepository(
        this.scope,
        "ExistingAssetRepository",
        {
          name: this.props.repositoryName,
        },
      );
      return;
    }
    this.repository = new ecrRepository.EcrRepository(
      this.scope,
      "AssetRepository",
      {
        name: this.props.qualifier
          ? `${this.props.qualifier}-assets`
          : "assets",
      },
    );
  }

  private ensureDockerProvider(): void {
    if (this.dockerProvider) return;

    this.dockerProvider = new dockerProvider.DockerProvider(
      this.scope,
      "Docker",
      // TODO: Support custom Docker host?
      {},
    );
  }

  private buildS3Url(objectKey: string): string {
    const bucketName = this.bucket!.bucket;
    return `https://${bucketName}.s3.${this.props.region}.${this.props.urlSuffix}/${objectKey}`;
  }

  private buildS3ObjectUrl(objectKey: string): string {
    const bucketName = this.bucket!.bucket;
    return `s3://${bucketName}/${objectKey}`;
  }

  // private buildRepositoryUri(): string {
  //   const repositoryName = this.repository!.name;
  //   return `${this.props.account}.dkr.ecr.${this.props.region}.${this.props.urlSuffix}/${repositoryName}`;
  // }
}

/**
 * Convert the Docker cache options to a format suitable for the buildx cacheFrom flag.
 */
function parseDockerCacheEntries(
  ...cacheOption: DockerCacheOption[]
): string[] | undefined {
  if (cacheOption.length === 0) {
    return undefined;
  }
  let cacheFrom: string[] = [];
  // https://github.com/docker/buildx/blob/v0.25.0/util/buildflags/cache.go#L140
  for (const c of cacheOption) {
    let cacheFromEntry = `type=${c.type}`;
    if (c.params) {
      const params = Object.entries(c.params)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
      cacheFromEntry += `,${params}`;
    }
    cacheFrom.push(cacheFromEntry);
  }
  return cacheFrom;
}

// /**
//  * Throw an error message about binding() if we don't have a value for x.
//  *
//  * This replaces the ! assertions we would need everywhere otherwise.
//  */
// export function assertBound<A>(x: A | undefined): asserts x is NonNullable<A> {
//   if (x === null && x === undefined) {
//     throw new Error("You must call bindStack() first");
//   }
// }

// TODO: Support executable array producing location of zip file on stdout
// function validateFileAssetSource(asset: FileAssetSource) {
//   if (!!asset.executable === !!asset.fileName) {
//     throw new Error(
//       `Exactly one of 'fileName' or 'executable' is required, got: ${JSON.stringify(asset)}`,
//     );
//   }

//   if (!!asset.packaging !== !!asset.fileName) {
//     throw new Error(
//       `'packaging' is expected in combination with 'fileName', got: ${JSON.stringify(asset)}`,
//     );
//   }
// }

// TODO: Support executable array producing the name of a local Docker image on `stdout`
// function validateDockerImageAssetSource(asset: DockerImageAssetSource) {
//   if (!!asset.executable === !!asset.directoryName) {
//     throw new Error(
//       `Exactly one of 'directoryName' or 'executable' is required, got: ${JSON.stringify(asset)}`,
//     );
//   }

//   check("dockerBuildArgs");
//   check("dockerBuildTarget");
//   check("dockerOutputs");
//   check("dockerFile");

//   function check<K extends keyof DockerImageAssetSource>(key: K) {
//     if (asset[key] && !asset.directoryName) {
//       throw new Error(
//         `'${key}' is only allowed in combination with 'directoryName', got: ${JSON.stringify(asset)}`,
//       );
//     }
//   }
// }
