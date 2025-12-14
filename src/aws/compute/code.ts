import { spawnSync } from "child_process";
import { join as pathtJoin } from "path";
import { dataArchiveFile } from "@cdktf/provider-archive";
import * as cdktf from "cdktf";
import { Construct } from "constructs";
import { DockerImage, DockerBuildOptions } from "../../bundling";
import { UnscopedValidationError, ValidationError } from "../../errors";
import { md5hash } from "../../helpers-internal";
import { AwsStack } from "../aws-stack";
import { IKey } from "../encryption";
import * as iam from "../iam";
import * as storage from "../storage";
// import { IAwsConstruct } from "../aws-construct";
import { Runtime, RuntimeFamily } from "./runtime";
import * as ecr_assets from "../storage/assets/image-asset";
import * as s3_assets from "../storage/assets/s3";

/**
 * Represents the Lambda Handler Code.
 */
export abstract class Code {
  /**
   * Lambda handler code as an S3 object.
   * @param bucket The S3 bucket
   * @param key The object key
   * @param objectVersion Optional S3 object version
   */
  public static fromBucket(
    bucket: storage.IBucket,
    key: string,
    objectVersion?: string,
  ): S3Code {
    return new S3Code(bucket, key, objectVersion);
  }

  /**
   * Lambda handler code as an S3 object.
   * @param bucket The S3 bucket
   * @param key The object key
   * @param options Optional parameters for setting the code, current optional parameters to set here are
   * 1. `objectVersion` to set S3 object version
   * 2. `sourceKMSKey` to set KMS Key for encryption of code
   */
  public static fromBucketV2(
    bucket: storage.IBucket,
    key: string,
    options?: BucketOptions,
  ): S3CodeV2 {
    return new S3CodeV2(bucket, key, options);
  }

  /**
   * DEPRECATED
   * @deprecated use `fromBucket`
   */
  public static bucket(
    bucket: storage.IBucket,
    key: string,
    objectVersion?: string,
  ): S3Code {
    return this.fromBucket(bucket, key, objectVersion);
  }

  /**
   * Inline code for Lambda handler
   * @returns `LambdaInlineCode` with inline code.
   * @param code The actual handler code (the resulting zip file cannot exceed 4MB)
   */
  public static fromInline(code: string): InlineCode {
    return new InlineCode(code);
  }

  /**
   * DEPRECATED
   * @deprecated use `fromInline`
   */
  public static inline(code: string): InlineCode {
    return this.fromInline(code);
  }

  /**
   * Loads the function code from a local disk path.
   *
   * @param path Either a directory with the Lambda code bundle or a .zip file
   */
  public static fromAsset(
    path: string,
    options?: s3_assets.AssetOptions,
  ): AssetCode {
    return new AssetCode(path, options);
  }

  /**
   * Runs a command to build the code asset that will be used.
   *
   * @param output Where the output of the command will be directed, either a directory or a .zip file with the output Lambda code bundle
   * * For example, if you use the command to run a build script (e.g., [ 'node', 'bundle_code.js' ]), and the build script generates a directory `/my/lambda/code`
   * containing code that should be ran in a Lambda function, then output should be set to `/my/lambda/code`
   * @param command The command which will be executed to generate the output, for example, [ 'node', 'bundle_code.js' ]
   * @param options options for the custom command, and other asset options -- but bundling options are not allowed.
   */
  public static fromCustomCommand(
    output: string,
    command: string[],
    options?: CustomCommandOptions,
  ): AssetCode {
    if (command.length === 0) {
      throw new UnscopedValidationError(
        'command must contain at least one argument. For example, ["node", "buildFile.js"].',
      );
    }

    const cmd = command[0];
    const commandArguments = command.splice(1);

    const proc =
      options?.commandOptions === undefined
        ? spawnSync(cmd, commandArguments) // use the default spawnSyncOptions
        : spawnSync(cmd, commandArguments, options.commandOptions);

    if (proc.error) {
      throw new UnscopedValidationError(
        `Failed to execute custom command: ${proc.error}`,
      );
    }
    if (proc.status !== 0) {
      throw new UnscopedValidationError(
        `${command.join(" ")} exited with status: ${proc.status}\n\nstdout: ${proc.stdout?.toString().trim()}\n\nstderr: ${proc.stderr?.toString().trim()}`,
      );
    }

    return new AssetCode(output, options);
  }

  /**
   * Loads the function code from an asset created by a Docker build.
   *
   * By default, the asset is expected to be located at `/asset` in the
   * image.
   *
   * @param path The path to the directory containing the Docker file
   * @param options Docker build options
   */
  public static fromDockerBuild(
    path: string,
    options: DockerBuildAssetOptions = {},
  ): AssetCode {
    let imagePath = options.imagePath ?? "/asset/.";

    // ensure imagePath ends with /. to copy the **content** at this path
    if (imagePath.endsWith("/")) {
      imagePath = `${imagePath}.`;
    } else if (!imagePath.endsWith("/.")) {
      imagePath = `${imagePath}/.`;
    }

    const assetPath = DockerImage.fromBuild(path, options).cp(
      imagePath,
      options.outputPath,
    );

    return new AssetCode(assetPath);
  }

  /**
   * DEPRECATED
   * @deprecated use `fromAsset`
   */
  public static asset(path: string): AssetCode {
    return this.fromAsset(path);
  }

  /**
   * Creates a new Lambda source defined using Terraform variables.
   *
   * @returns a new instance of `TerraformVariablesCode`
   * @param props optional construction properties of `TerraformVariablesCode`
   */
  public static fromTerraformVariables(
    props?: TerraformVariablesCodeProps,
  ): TerraformVariablesCode {
    return new TerraformVariablesCode(props);
  }

  /**
   * DEPRECATED
   * @deprecated use `fromTerraformVariables`
   */
  public static terraformVariables(
    props?: TerraformVariablesCodeProps,
  ): TerraformVariablesCode {
    return this.fromTerraformVariables(props);
  }

  /**
   * Use an existing ECR image as the Lambda code.
   * @param repository the ECR repository that the image is in
   * @param props properties to further configure the selected image
   */
  public static fromEcrImage(
    repository: storage.IRepository,
    props?: EcrImageCodeProps,
  ) {
    return new EcrImageCode(repository, props);
  }

  /**
   * Create an ECR image from the specified asset and bind it as the Lambda code.
   * @param directory the directory from which the asset must be created
   * @param props properties to further configure the selected image
   */
  public static fromAssetImage(
    directory: string,
    props: AssetImageCodeProps = {},
  ) {
    return new AssetImageCode(directory, props);
  }

  /**
   * Determines whether this Code is inline code or not.
   *
   * @deprecated this value is ignored since inline is now determined based on the
   * the `inlineCode` field of `CodeConfig` returned from `bind()`.
   */
  public abstract readonly isInline: boolean;

  /**
   * Called when the lambda or layer is initialized to allow this object to bind
   * to the stack, add resources and have fun.
   *
   * @param scope The binding scope. Don't be smart about trying to down-cast or
   * assume it's initialized. You may just use it as a construct scope.
   */
  public abstract bind(scope: Construct): CodeConfig;

  // TODO: pending custom CLI to mock Lambda function invocations locally
  // /**
  //  * Called after the terraform provider function resource has been created to allow the code
  //  * class to bind to it. Specifically it's required to allow assets to add
  //  * metadata for tooling like SAM CLI to be able to find their origins.
  //  */
  // public bindToResource(
  //   _resource: IAwsConstruct,
  //   _options?: ResourceBindOptions,
  // ) {
  //   return;
  // }
}

/**
 * Result of binding `Code` into a `Function`.
 */
export interface CodeConfig {
  /**
   * The location of the code in S3 (mutually exclusive with `inlineCode` and `image`).
   * @default - code is not an s3 location
   */
  readonly s3Location?: storage.S3Location;

  /**
   * Inline code (mutually exclusive with `s3Location` and `image`).
   * @default - code is not inline code
   */
  readonly inlineCode?: string;

  /**
   * Docker image configuration (mutually exclusive with `s3Location` and `inlineCode`).
   * @default - code is not an ECR container image
   */
  readonly image?: CodeImageConfig;

  /**
   * The ARN of the KMS key used to encrypt the handler code.
   * @default - the default server-side encryption with Amazon S3 managed keys(SSE-S3) key will be used.
   */
  readonly sourceKMSKeyArn?: string;

  /**
   * A hash of the source code, used to determine if the code has changed.
   */
  readonly sourceCodeHash?: string;
}

/**
 * Result of the bind when an ECR image is used.
 */
export interface CodeImageConfig {
  /**
   * URI to the Docker image.
   */
  readonly imageUri: string;

  /**
   * Specify or override the CMD on the specified Docker image or Dockerfile.
   * This needs to be in the 'exec form', viz., `[ 'executable', 'param1', 'param2' ]`.
   * @see https://docs.docker.com/engine/reference/builder/#cmd
   * @default - use the CMD specified in the docker image or Dockerfile.
   */
  readonly cmd?: string[];

  /**
   * Specify or override the ENTRYPOINT on the specified Docker image or Dockerfile.
   * An ENTRYPOINT allows you to configure a container that will run as an executable.
   * This needs to be in the 'exec form', viz., `[ 'executable', 'param1', 'param2' ]`.
   * @see https://docs.docker.com/engine/reference/builder/#entrypoint
   * @default - use the ENTRYPOINT in the docker image or Dockerfile.
   */
  readonly entrypoint?: string[];

  /**
   * Specify or override the WORKDIR on the specified Docker image or Dockerfile.
   * A WORKDIR allows you to configure the working directory the container will use.
   * @see https://docs.docker.com/engine/reference/builder/#workdir
   * @default - use the WORKDIR in the docker image or Dockerfile.
   */
  readonly workingDirectory?: string;
}

/**
 * Lambda code from an S3 archive.
 */
export class S3Code extends Code {
  public readonly isInline = false;
  private bucketName: string;

  constructor(
    bucket: storage.IBucket,
    private key: string,
    private objectVersion?: string,
  ) {
    super();

    if (!bucket.bucketName) {
      throw new ValidationError(
        "bucketName is undefined for the provided bucket",
        bucket,
      );
    }

    this.bucketName = bucket.bucketName;
  }

  public bind(_scope: Construct): CodeConfig {
    return {
      s3Location: {
        bucketName: this.bucketName,
        objectKey: this.key,
        objectVersion: this.objectVersion,
      },
    };
  }
}

/**
 * Lambda code from an S3 archive. With option to set KMSKey for encryption.
 */
export class S3CodeV2 extends Code {
  public readonly isInline = false;
  private bucketName: string;

  constructor(
    bucket: storage.IBucket,
    private key: string,
    private options?: BucketOptions,
  ) {
    super();
    if (!bucket.bucketName) {
      throw new ValidationError(
        "bucketName is undefined for the provided bucket",
        bucket,
      );
    }

    this.bucketName = bucket.bucketName;
  }

  public bind(_scope: Construct): CodeConfig {
    return {
      s3Location: {
        bucketName: this.bucketName,
        objectKey: this.key,
        objectVersion: this.options?.objectVersion,
      },
      sourceKMSKeyArn: this.options?.sourceKMSKey?.keyArn,
    };
  }
}

/**
 * Get the file extension for inline code based on the runtime family
 */
function getInlineCodeFileExtension(runtime?: Runtime): string {
  if (!runtime) {
    // Default to .js for backwards compatibility
    return ".js";
  }

  switch (runtime.family) {
    case RuntimeFamily.NODEJS:
      return ".js";
    case RuntimeFamily.PYTHON:
      return ".py";
    case RuntimeFamily.JAVA:
      return ".java";
    case RuntimeFamily.DOTNET_CORE:
      return ".cs";
    case RuntimeFamily.GO:
      return ".go";
    case RuntimeFamily.RUBY:
      return ".rb";
    default:
      // Default to .js for unknown runtimes
      return ".js";
  }
}

/**
 * Lambda code from an inline string.
 */
export class InlineCode extends Code {
  public readonly isInline = true;
  private dataArchive?: dataArchiveFile.DataArchiveFile;

  constructor(private code: string) {
    super();

    if (code.length === 0) {
      throw new UnscopedValidationError("Lambda inline code cannot be empty");
    }
  }

  public bind(scope: Construct): CodeConfig {
    this.ensureDataArchive(scope);
    return {
      inlineCode: this.dataArchive!.outputPath,
      sourceCodeHash: this.dataArchive!.outputBase64Sha256,
    };
  }

  /**
   * Ugly hack to support inline code with Terraform.
   *
   * https://github.com/hashicorp/terraform-provider-aws/issues/9774#issuecomment-669356786
   * @param scope
   * @returns
   */
  private ensureDataArchive(scope: Construct) {
    if (this.dataArchive) {
      return;
    }
    // get the provider singleton
    const provider = AwsStack.ofAwsConstruct(scope).archiveProvider;
    // ensure the code is hashed for consistency
    const id = AwsStack.ofAwsConstruct(scope).uniqueResourceName(
      new cdktf.TerraformElement(scope, md5hash(this.code)),
      {
        maxLength: 64,
        allowedSpecialCharacters: "-_",
      },
    );
    // const id = md5hash(this.code);
    const existing = scope.node.tryFindChild(id);
    if (existing) {
      this.dataArchive = existing as dataArchiveFile.DataArchiveFile;
    } else {
      // Determine the file extension based on the runtime
      // The scope should be a LambdaFunction when bind is called
      let runtime: Runtime | undefined;
      if ("runtime" in scope && scope.runtime instanceof Runtime) {
        runtime = scope.runtime;
      }
      const extension = getInlineCodeFileExtension(runtime);

      this.dataArchive = new dataArchiveFile.DataArchiveFile(scope, id, {
        outputPath: pathtJoin(
          cdktf.Token.asString(cdktf.ref("path.root")),
          ".archive_files",
          `${id}.zip`,
        ),
        type: "zip",
        sourceContent: this.code,
        sourceContentFilename: `index${extension}`,
        provider,
      });
    }
  }
}

/**
 * Lambda code from a local directory.
 */
export class AssetCode extends Code {
  public readonly isInline = false;
  private asset?: s3_assets.Asset;

  /**
   * @param path The path to the asset file or directory.
   */
  constructor(
    public readonly path: string,
    private readonly options: s3_assets.AssetOptions = {},
  ) {
    super();
  }

  public bind(scope: Construct): CodeConfig {
    // If the same AssetCode is used multiple times, retain only the first instantiation.
    if (!this.asset) {
      this.asset = new s3_assets.Asset(scope, "Code", {
        path: this.path,
        deployTime: true,
        ...this.options,
      });
    } else if (
      AwsStack.ofAwsConstruct(this.asset) !== AwsStack.ofAwsConstruct(scope)
    ) {
      throw new ValidationError(
        `Asset is already associated with another stack '${AwsStack.ofAwsConstruct(this.asset).gridUUID}'. ` +
          "Create a new Code instance for every stack.",
        scope,
      );
    }

    if (!this.asset.isZipArchive) {
      throw new ValidationError(
        `Asset must be a .zip file or a directory (${this.path})`,
        scope,
      );
    }

    return {
      s3Location: {
        bucketName: this.asset.s3BucketName,
        objectKey: this.asset.s3ObjectKey,
      },
      sourceKMSKeyArn: this.options.sourceKMSKey?.keyArn,
    };
  }

  // public bindToResource(
  //   resource: IAwsConstruct,
  //   options: ResourceBindOptions = {},
  // ) {
  //   if (!this.asset) {
  //     throw new ValidationError(
  //       "bindToResource() must be called after bind()",
  //       resource,
  //     );
  //   }

  //   const resourceProperty = options.resourceProperty || "Code";
  //   // https://github.com/aws/aws-cdk/issues/1432
  //   this.asset.addResourceMetadata(resource, resourceProperty);
  // }
}

export interface ResourceBindOptions {
  /**
   * The name of the property to annotate with asset metadata.
   * @see https://github.com/aws/aws-cdk/issues/1432
   * @default Code
   */
  readonly resourceProperty?: string;
}

/**
 * Construction properties for `TerraformVariablesCode`.
 */
export interface TerraformVariablesCodeProps {
  /**
   * The Terraform variable that represents the name of the S3 Bucket
   * where the Lambda code will be located in.
   * Must be of type 'String'.
   *
   * @default a new variable will be created
   */
  readonly bucketNameVar?: cdktf.TerraformVariable;

  /**
   * The Terraform variable that represents the path inside the S3 Bucket
   * where the Lambda code will be located at.
   * Must be of type 'String'.
   *
   * @default a new variable will be created
   */
  readonly objectKeyVar?: cdktf.TerraformVariable;
  /**
   * The ARN of the KMS key used to encrypt the handler code.
   * @default - the default server-side encryption with Amazon S3 managed keys(SSE-S3) key will be used.
   */
  readonly sourceKMSKey?: IKey;
}

/**
 * Lambda code defined using 2 Terraform variables.
 * Useful when you don't have access to the code of your Lambda from your CDK code, so you can't use Assets,
 * and you want to deploy the Lambda in a pipeline, during Terraform execution.
 */
export class TerraformVariablesCode extends Code {
  public readonly isInline = false;
  private _bucketNameVar?: cdktf.TerraformVariable;
  private _objectKeyVar?: cdktf.TerraformVariable;
  private _sourceKMSKey?: IKey;

  constructor(props: TerraformVariablesCodeProps = {}) {
    super();

    this._bucketNameVar = props.bucketNameVar;
    this._objectKeyVar = props.objectKeyVar;
    this._sourceKMSKey = props.sourceKMSKey;
  }

  public bind(scope: Construct): CodeConfig {
    if (!this._bucketNameVar) {
      this._bucketNameVar = new cdktf.TerraformVariable(
        scope,
        "LambdaSourceBucketNameParameter",
        {
          type: "String",
        },
      );
    }

    if (!this._objectKeyVar) {
      this._objectKeyVar = new cdktf.TerraformVariable(
        scope,
        "LambdaSourceObjectKeyParameter",
        {
          type: "String",
        },
      );
    }

    return {
      s3Location: {
        bucketName: this._bucketNameVar.stringValue,
        objectKey: this._objectKeyVar.stringValue,
      },
      sourceKMSKeyArn: this._sourceKMSKey?.keyArn,
    };
  }

  /**
   * Create a parameters map from this instance's Terraform variables.
   *
   * It returns a map with 2 keys that correspond to the names of the parameters defined in this Lambda code,
   * and as values it contains the appropriate expressions pointing at the provided S3 location
   * (most likely, obtained from a CodePipeline Artifact by calling the `artifact.s3Location` method).
   * The result should be provided to the CloudFormation Action
   * that is deploying the Stack that the Lambda with this code is part of,
   * in the `parameterOverrides` property.
   *
   * @param location the location of the object in S3 that represents the Lambda code
   */
  public assign(location: storage.S3Location): { [name: string]: any } {
    const ret: { [name: string]: any } = {};
    ret[this.bucketNameVar] = location.bucketName;
    ret[this.objectKeyVar] = location.objectKey;
    return ret;
  }

  public get bucketNameVar(): string {
    if (this._bucketNameVar) {
      return this._bucketNameVar.fqn;
    } else {
      throw new UnscopedValidationError(
        "Pass TerraformVariablesCode to a Lambda Function before accessing the bucketNameVar property",
      );
    }
  }

  public get objectKeyVar(): string {
    if (this._objectKeyVar) {
      return this._objectKeyVar.fqn;
    } else {
      throw new UnscopedValidationError(
        "Pass TerraformVariablesCode to a Lambda Function before accessing the objectKeyVar property",
      );
    }
  }
}

/**
 * Properties to initialize a new EcrImageCode
 */
export interface EcrImageCodeProps {
  /**
   * Specify or override the CMD on the specified Docker image or Dockerfile.
   * This needs to be in the 'exec form', viz., `[ 'executable', 'param1', 'param2' ]`.
   * @see https://docs.docker.com/engine/reference/builder/#cmd
   * @default - use the CMD specified in the docker image or Dockerfile.
   */
  readonly cmd?: string[];

  /**
   * Specify or override the ENTRYPOINT on the specified Docker image or Dockerfile.
   * An ENTRYPOINT allows you to configure a container that will run as an executable.
   * This needs to be in the 'exec form', viz., `[ 'executable', 'param1', 'param2' ]`.
   * @see https://docs.docker.com/engine/reference/builder/#entrypoint
   * @default - use the ENTRYPOINT in the docker image or Dockerfile.
   */
  readonly entrypoint?: string[];

  /**
   * Specify or override the WORKDIR on the specified Docker image or Dockerfile.
   * A WORKDIR allows you to configure the working directory the container will use.
   * @see https://docs.docker.com/engine/reference/builder/#workdir
   * @default - use the WORKDIR in the docker image or Dockerfile.
   */
  readonly workingDirectory?: string;

  /**
   * The image tag to use when pulling the image from ECR.
   * @default 'latest'
   * @deprecated use `tagOrDigest`
   */
  readonly tag?: string;

  /**
   * The image tag or digest to use when pulling the image from ECR (digests must start with `sha256:`).
   * @default 'latest'
   */
  readonly tagOrDigest?: string;
}

/**
 * Represents a Docker image in ECR that can be bound as Lambda Code.
 */
export class EcrImageCode extends Code {
  public readonly isInline: boolean = false;

  constructor(
    private readonly repository: storage.IRepository,
    private readonly props: EcrImageCodeProps = {},
  ) {
    super();
  }

  public bind(_scope: Construct): CodeConfig {
    this.repository.grantPull(new iam.ServicePrincipal("lambda.amazonaws.com"));

    return {
      image: {
        imageUri: this.repository.repositoryUriForTagOrDigest(
          this.props?.tagOrDigest ?? this.props?.tag ?? "latest",
        ),
        cmd: this.props.cmd,
        entrypoint: this.props.entrypoint,
        workingDirectory: this.props.workingDirectory,
      },
    };
  }
}

/**
 * Properties to initialize a new AssetImage
 */
export interface AssetImageCodeProps
  extends ecr_assets.DockerImageAssetOptions {
  /**
   * Specify or override the CMD on the specified Docker image or Dockerfile.
   * This needs to be in the 'exec form', viz., `[ 'executable', 'param1', 'param2' ]`.
   * @see https://docs.docker.com/engine/reference/builder/#cmd
   * @default - use the CMD specified in the docker image or Dockerfile.
   */
  readonly cmd?: string[];

  /**
   * Specify or override the ENTRYPOINT on the specified Docker image or Dockerfile.
   * An ENTRYPOINT allows you to configure a container that will run as an executable.
   * This needs to be in the 'exec form', viz., `[ 'executable', 'param1', 'param2' ]`.
   * @see https://docs.docker.com/engine/reference/builder/#entrypoint
   * @default - use the ENTRYPOINT in the docker image or Dockerfile.
   */
  readonly entrypoint?: string[];

  /**
   * Specify or override the WORKDIR on the specified Docker image or Dockerfile.
   * A WORKDIR allows you to configure the working directory the container will use.
   * @see https://docs.docker.com/engine/reference/builder/#workdir
   * @default - use the WORKDIR in the docker image or Dockerfile.
   */
  readonly workingDirectory?: string;
}

/**
 * Represents an ECR image that will be constructed from the specified asset and can be bound as Lambda code.
 */
export class AssetImageCode extends Code {
  public readonly isInline: boolean = false;
  private asset?: ecr_assets.DockerImageAsset;

  constructor(
    private readonly directory: string,
    private readonly props: AssetImageCodeProps,
  ) {
    super();
  }

  public bind(scope: Construct): CodeConfig {
    // If the same AssetImageCode is used multiple times, retain only the first instantiation.
    if (!this.asset) {
      this.asset = new ecr_assets.DockerImageAsset(scope, "AssetImage", {
        directory: this.directory,
        ...this.props,
      });
      this.asset.repository.grantPull(
        new iam.ServicePrincipal("lambda.amazonaws.com"),
      );
    } else if (
      AwsStack.ofAwsConstruct(this.asset) !== AwsStack.ofAwsConstruct(scope)
    ) {
      throw new ValidationError(
        `Asset is already associated with another stack '${AwsStack.ofAwsConstruct(this.asset).gridUUID}'. ` +
          "Create a new Code instance for every stack.",
        scope,
      );
    }

    return {
      image: {
        imageUri: this.asset.imageUri,
        entrypoint: this.props.entrypoint,
        cmd: this.props.cmd,
        workingDirectory: this.props.workingDirectory,
      },
    };
  }

  // // TODO: pending custom CLI to mock Lambda function invocations locally
  // public bindToResource(
  //   resource: IAwsConstruct,
  //   options: ResourceBindOptions = {},
  // ) {
  //   if (!this.asset) {
  //     throw new ValidationError("bindToResource() must be called after bind()", resource);
  //   }

  //   // const resourceProperty = _options.resourceProperty || "Code.ImageUri";

  //   // // https://github.com/aws/aws-cdk/issues/14593
  //   // this.asset.addResourceMetadata(_resource, resourceProperty);
  // }
}

/**
 * Options when creating an asset from a Docker build.
 */
export interface DockerBuildAssetOptions extends DockerBuildOptions {
  /**
   * The path in the Docker image where the asset is located after the build
   * operation.
   *
   * @default /asset
   */
  readonly imagePath?: string;

  /**
   * The path on the local filesystem where the asset will be copied
   * using `docker cp`.
   *
   * @default - a unique temporary directory in the system temp directory
   */
  readonly outputPath?: string;
}

/**
 * Options for creating `AssetCode` with a custom command, such as running a buildfile.
 */
export interface CustomCommandOptions extends s3_assets.AssetOptions {
  /**
   * options that are passed to the spawned process, which determine the characteristics of the spawned process.
   *
   * @default: see `child_process.SpawnSyncOptions` (https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options).
   */
  readonly commandOptions?: { [options: string]: any };
}

/**
 * Optional parameters for creating code using bucket
 */
export interface BucketOptions {
  /**
   * Optional S3 object version
   */
  readonly objectVersion?: string;
  /**
   * The ARN of the KMS key used to encrypt the handler code.
   * @default - the default server-side encryption with Amazon S3 managed keys(SSE-S3) key will be used.
   */
  readonly sourceKMSKey?: IKey;
}
