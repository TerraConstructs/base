import * as fs from "fs";
import * as path from "path";
import { s3Object } from "@cdktf/provider-aws";
import { TerraformAsset, AssetType, Fn, ITerraformDependable } from "cdktf";
import { Construct } from "constructs";
import * as mime from "mime-types";
import { normalPath, IBucket, AddSourceOptions } from ".";
import {
  AwsConstructBase,
  IAwsConstruct,
  AwsConstructProps,
} from "../aws-construct";

export interface BucketSourceProps extends AddSourceOptions, AwsConstructProps {
  /**
   * Target bucket to upload to
   */
  readonly bucket: IBucket;
}

export interface BucketObjectOutput {
  /**
   * The object source Hash
   */
  readonly sourceHash: string;
}

export interface BucketSourceOutputs {
  /**
   * The objects uploaded to the bucket indexed by key
   */
  readonly objects: Record<string, BucketObjectOutput>;
}

export interface IBucketSource extends IAwsConstruct {
  readonly bucketSourceOutputs: BucketSourceOutputs;
}

/**
 * A Bucket Source which reads files from disk and creates uploads to s3.
 */
export class BucketSource extends AwsConstructBase implements IBucketSource {
  public readonly objects: s3Object.S3Object[] = [];

  private readonly _bucketSourceOutputs: BucketSourceOutputs;
  public get bucketSourceOutputs(): BucketSourceOutputs {
    return this._bucketSourceOutputs;
  }

  public get outputs(): Record<string, any> {
    return this.bucketSourceOutputs;
  }

  private readonly dependsOn: ITerraformDependable[] = [];
  private readonly resolvedPath: string;
  private readonly prefix: string;
  private _bucket: IBucket;

  constructor(scope: Construct, id: string, props: BucketSourceProps) {
    super(scope, id, props);

    const { bucket, path: sourcePath, prefix } = props;

    this._bucket = bucket;
    this.dependsOn = props.dependsOn ?? [];
    // should we support absolute paths? path.isAbsolute(props.path)?

    this.resolvedPath = path.resolve(sourcePath);
    this.prefix = prefix ?? "";

    const asset = new TerraformAsset(this, "PathAsset", {
      path: this.resolvedPath,
      type: AssetType.DIRECTORY,
    });
    this.uploadAssetDir(sourcePath, asset.path);

    this._bucketSourceOutputs = {
      objects: this.objects.reduce(
        (acc, obj) => {
          acc[obj.key] = {
            sourceHash: obj.sourceHash,
          };
          return acc;
        },
        {} as Record<string, BucketObjectOutput>,
      ),
    };
  }

  // TODO: Handle deployments with custom lambdas instead?
  // https://github.com/aws/aws-cdk/blob/9946ab03672bf6664e8ec95a81ddb67c3bb2f63b/packages/%40aws-cdk/custom-resource-handlers/lib/aws-s3-deployment/bucket-deployment-handler/index.py
  private uploadAssetDir(basePath: string, assetPath: string): void {
    const files = fs.readdirSync(basePath, { withFileTypes: true });
    for (const file of files) {
      const baseFilename = path.join(basePath, file.name);
      const assetFilename = path.join(assetPath, file.name);
      if (file.isDirectory()) {
        this.uploadAssetDir(baseFilename, assetFilename);
      } else {
        this.uploadAssetFile(baseFilename, assetFilename);
      }
    }
  }

  private uploadAssetFile(basePath: string, assetPath: string) {
    const relativePath = path.join(
      this.prefix,
      basePath.replace(this.resolvedPath, ""),
    );
    const fileKey = normalPath(relativePath);

    // copy from asset directory
    this.objects.push(
      new s3Object.S3Object(this, `File${fileKey.replace(/\//g, "--")}`, {
        key: fileKey,
        bucket: this._bucket.bucketOutputs.name,
        source: assetPath,
        sourceHash: Fn.filemd5(assetPath),
        contentType: mime.contentType(path.extname(assetPath)) || undefined,
        dependsOn: this.dependsOn.length > 0 ? this.dependsOn : undefined,
      }),
    );
  }
}
