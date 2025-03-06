// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/user-data.ts

import { dataCloudinitConfig } from "@cdktf/provider-cloudinit";
import {
  // TerraformResource
  IResolvable,
  Lazy,
} from "cdktf";
// import { AwsConstructBase } from "../aws-construct";
// import { AwsStack } from "../aws-stack";
import { IConstruct } from "constructs";
// import { Fn } from "../../terra-func";
import { IBucket } from "../storage";
import { OperatingSystemType } from "./machine-image/common";

/**
 * Common UserData Options
 */
export interface UserDataCommon {
  /**
   * Specify whether or not to base64 encode the `rendered` output. Cannot be disabled if gzip is `true`.
   *
   * NOTE: Instance and LaunchTemplate expect base64 encoded user data
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/cloudinit/2.3.6/docs/data-sources/config#base64_encode DataCloudinitConfig#base64_encode}
   * @default true
   */
  readonly base64Encode?: boolean | IResolvable;
  /**
   * Specify whether or not to gzip the `rendered` output.
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/cloudinit/2.3.6/docs/data-sources/config#gzip DataCloudinitConfig#gzip}
   * @default true
   */
  readonly gzip?: boolean | IResolvable;
  /**
   * `Content-Type` header of this part.
   *
   * Some examples of content types:
   * * `text/x-shellscript; charset="utf-8"` (shell script)
   * * `text/cloud-boothook; charset="utf-8"` (shell script executed during boot phase)
   *
   * For Linux shell scripts use `text/x-shellscript`.
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/cloudinit/2.3.6/docs/data-sources/config#content_type DataCloudinitConfig#content_type}
   *
   * @defaults to `text/plain`
   */
  readonly contentType?: string;
  /**
   * A filename to report in the header for the part.
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/cloudinit/2.3.6/docs/data-sources/config#filename DataCloudinitConfig#filename}
   */
  readonly filename?: string;
}

/**
 * Options when constructing UserData for Linux
 */
export interface LinuxUserDataOptions extends UserDataCommon {
  /**
   * Shebang for the UserData script
   *
   * @default "#!/bin/bash"
   */
  readonly shebang?: string;
}

/**
 * Options when constructing UserData for Windows
 */
export interface WindowsUserDataOptions extends UserDataCommon {
  /**
   * Set to true to set this userdata to persist through an instance reboot; allowing
   * it to run on every instance start.
   * By default, UserData is run only once during the first instance launch.
   *
   * For more information, see:
   * https://aws.amazon.com/premiumsupport/knowledge-center/execute-user-data-ec2/
   * https://docs.aws.amazon.com/AWSEC2/latest/WindowsGuide/ec2-windows-user-data.html#user-data-scripts
   *
   * @default false
   */
  readonly persist?: boolean;
}

/**
 * Options when downloading files from S3
 */
export interface S3DownloadOptions {
  /**
   * Name of the S3 bucket to download from
   */
  readonly bucket: IBucket;

  /**
   * The key of the file to download
   */
  readonly bucketKey: string;

  /**
   * The name of the local file.
   *
   * @default Linux   - /tmp/bucketKey
   *          Windows - %TEMP%/bucketKey
   */
  readonly localFile?: string;

  /**
   * The region of the S3 Bucket (needed for access via VPC Gateway)
   * @default none
   */
  readonly region?: string;
}

/**
 * Options when executing a file.
 */
export interface ExecuteFileOptions {
  /**
   * The path to the file.
   */
  readonly filePath: string;

  /**
   * The arguments to be passed to the file.
   *
   * @default No arguments are passed to the file.
   */
  readonly arguments?: string;
}

/**
 * Instance User Data
 */
export abstract class UserData {
  /**
   * Create a userdata object for Linux hosts
   */
  public static forLinux(options: LinuxUserDataOptions = {}): UserData {
    return new LinuxUserData(options);
  }

  /**
   * Create a userdata object for Windows hosts
   */
  public static forWindows(options: WindowsUserDataOptions = {}): UserData {
    return new WindowsUserData(options);
  }

  /**
   * Create a userdata object with custom content
   */
  public static custom(content: string): UserData {
    const userData = new CustomUserData();
    userData.addCommands(content);
    return userData;
  }

  public static forOperatingSystem(os: OperatingSystemType): UserData {
    switch (os) {
      case OperatingSystemType.LINUX:
        return UserData.forLinux();
      case OperatingSystemType.WINDOWS:
        return UserData.forWindows();
      case OperatingSystemType.UNKNOWN:
        throw new Error(
          "Cannot determine UserData for unknown operating system type",
        );
    }
  }

  /** The UserData Content */
  public abstract readonly content: string;
  public abstract readonly contentType?: string;
  public abstract readonly filename?: string;

  protected readonly base64Encode: boolean | IResolvable;
  protected readonly gzip: boolean | IResolvable;

  constructor(userdataOptions: UserDataCommon = {}) {
    if (
      userdataOptions.base64Encode === false &&
      userdataOptions.gzip === true
    ) {
      throw new Error("Cannot disable base64 encoding if gzip is enabled");
    }
    this.base64Encode = userdataOptions.base64Encode ?? true;
    this.gzip = userdataOptions.gzip ?? true;
  }

  /**
   * Add one or more commands to the user data
   */
  public abstract addCommands(...commands: string[]): void;

  /**
   * Add one or more commands to the user data that will run when the script exits.
   */
  public abstract addOnExitCommands(...commands: string[]): void;

  /**
   * Render the UserData for use in a construct
   */
  public abstract render(scope: IConstruct): string;

  /**
   * Adds commands to download a file from S3
   *
   * @returns: The local path that the file will be downloaded to
   */
  public abstract addS3DownloadCommand(params: S3DownloadOptions): string;

  /**
   * Adds commands to execute a file
   */
  public abstract addExecuteFileCommand(params: ExecuteFileOptions): void;

  // /**
  //  * Adds a command which will send a cfn-signal when the user data script ends
  //  */
  // public abstract addSignalOnExitCommand(resource: AwsConstructBase): void;
}

/**
 * Linux Instance User Data
 */
class LinuxUserData extends UserData {
  private readonly lines: string[] = [];
  private readonly onExitLines: string[] = [];
  private readonly shebang: string;
  public readonly contentType?: string;
  public readonly filename?: string;

  constructor(props: LinuxUserDataOptions = {}) {
    super();
    this.shebang = props.shebang ?? "#!/bin/bash";
    this.contentType = props.contentType;
    this.filename = props.filename;
  }

  public addCommands(...commands: string[]) {
    this.lines.push(...commands);
  }

  public addOnExitCommands(...commands: string[]) {
    this.onExitLines.push(...commands);
  }

  public get content(): string {
    return [this.shebang, ...this.renderOnExitLines(), ...this.lines].join(
      "\n",
    );
  }

  public render(scope: IConstruct): string {
    return new dataCloudinitConfig.DataCloudinitConfig(scope, "UserData", {
      base64Encode: this.base64Encode,
      gzip: this.gzip,
      // Pass our script as a single part with proper content type.
      part: [
        {
          content: Lazy.stringValue({
            produce: () => this.content,
          }),
          contentType: this.contentType,
          filename: this.filename,
        },
      ],
    }).rendered;
  }

  public addS3DownloadCommand(params: S3DownloadOptions): string {
    const s3Path = `s3://${params.bucket.bucketName}/${params.bucketKey}`;
    const localPath =
      params.localFile && params.localFile.length !== 0
        ? params.localFile
        : `/tmp/${params.bucketKey}`;
    this.addCommands(
      `mkdir -p $(dirname '${localPath}')`,
      `aws s3 cp '${s3Path}' '${localPath}'` +
        (params.region !== undefined ? ` --region ${params.region}` : ""),
    );

    return localPath;
  }

  public addExecuteFileCommand(params: ExecuteFileOptions): void {
    this.addCommands(
      "set -e",
      `chmod +x '${params.filePath}'`,
      `'${params.filePath}' ${params.arguments ?? ""}`.trim(),
    );
  }

  // // TODO: Add Grid Signals - copy grid-signal binary in provisioner
  // public addSignalOnExitCommand(resource: AwsConstructBase): void {
  //   const stack = AwsStack.ofAwsConstruct(resource);
  //   const resourceID = (resource.node.defaultChild as TerraformResource).fqn;
  //   this.addOnExitCommands(
  //     `/opt/aws/bin/grid-signal --stack ${stack.gridUUID} --resource ${resourceID} --region ${stack.region} -e $exitCode || echo 'Failed to send Cloudformation Signal'`,
  //   );
  // }

  private renderOnExitLines(): string[] {
    if (this.onExitLines.length > 0) {
      return [
        "function exitTrap(){",
        "exitCode=$?",
        ...this.onExitLines,
        "}",
        "trap exitTrap EXIT",
      ];
    }
    return [];
  }
}

/**
 * Windows Instance User Data
 */
class WindowsUserData extends UserData {
  private readonly lines: string[] = [];
  private readonly onExitLines: string[] = [];
  public readonly contentType?: string;
  public readonly filename?: string;
  private readonly persist: boolean;

  constructor(props: WindowsUserDataOptions = {}) {
    super();
    this.persist = props.persist ?? false;
    this.contentType = props.contentType;
    this.filename = props.filename;
  }

  public addCommands(...commands: string[]) {
    this.lines.push(...commands);
  }

  public addOnExitCommands(...commands: string[]) {
    this.onExitLines.push(...commands);
  }

  public get content(): string {
    return `<powershell>${[
      ...this.renderOnExitLines(),
      ...this.lines,
      ...(this.onExitLines.length > 0 ? ['throw "Success"'] : []),
    ].join(
      "\n",
    )}</powershell>${(this.persist ?? false) ? "<persist>true</persist>" : ""}`;
  }

  public render(scope: IConstruct): string {
    return new dataCloudinitConfig.DataCloudinitConfig(scope, "UserData", {
      base64Encode: this.base64Encode,
      gzip: this.gzip,
      // Pass our script as a single part with proper content type.
      part: [
        {
          content: Lazy.stringValue({
            produce: () => this.content,
          }),
          contentType: this.contentType,
          filename: this.filename,
        },
      ],
    }).rendered;
  }

  public addS3DownloadCommand(params: S3DownloadOptions): string {
    const localPath =
      params.localFile && params.localFile.length !== 0
        ? params.localFile
        : `C:/temp/${params.bucketKey}`;
    this.addCommands(
      `mkdir (Split-Path -Path '${localPath}' ) -ea 0`,
      `Read-S3Object -BucketName '${params.bucket.bucketName}' -key '${params.bucketKey}' -file '${localPath}' -ErrorAction Stop` +
        (params.region !== undefined ? ` -Region ${params.region}` : ""),
    );
    return localPath;
  }

  public addExecuteFileCommand(params: ExecuteFileOptions): void {
    this.addCommands(
      `&'${params.filePath}' ${params.arguments ?? ""}`.trim(),
      `if (!$?) { Write-Error 'Failed to execute the file "${params.filePath}"' -ErrorAction Stop }`,
    );
  }

  // // TODO: Add Grid Signals
  // public addSignalOnExitCommand(resource: AwsConstructBase): void {
  //   const stack = AwsStack.ofAwsConstruct(resource);
  //   const resourceID = (resource.node.defaultChild as TerraformResource).fqn;

  //   this.addOnExitCommands(
  //     `grid-signal --stack ${stack.gridUUID} --resource ${resourceID} --region ${stack.region} --success ($success.ToString().ToLower())`,
  //   );
  // }

  private renderOnExitLines(): string[] {
    if (this.onExitLines.length > 0) {
      return [
        "trap {",
        '$success=($PSItem.Exception.Message -eq "Success")',
        ...this.onExitLines,
        "break",
        "}",
      ];
    }
    return [];
  }
}

/**
 * Custom Instance User Data
 */
class CustomUserData extends UserData {
  private readonly lines: string[] = [];
  public readonly contentType?: string;
  public readonly filename?: string;

  constructor() {
    super();
  }

  public addCommands(...commands: string[]) {
    this.lines.push(...commands);
  }

  public addOnExitCommands(): void {
    throw new Error(
      "CustomUserData does not support addOnExitCommands, use UserData.forLinux() or UserData.forWindows() instead.",
    );
  }

  public get content(): string {
    return this.lines.join("\n");
  }

  public render(scope: IConstruct): string {
    return new dataCloudinitConfig.DataCloudinitConfig(scope, "UserData", {
      base64Encode: this.base64Encode,
      gzip: this.gzip,
      // Pass our script as a single part with proper content type.
      part: [
        {
          content: Lazy.stringValue({
            produce: () => this.content,
          }),
          contentType: this.contentType,
          filename: this.filename,
        },
      ],
    }).rendered;
  }

  public addS3DownloadCommand(): string {
    throw new Error(
      "CustomUserData does not support addS3DownloadCommand, use UserData.forLinux() or UserData.forWindows() instead.",
    );
  }

  public addExecuteFileCommand(): void {
    throw new Error(
      "CustomUserData does not support addExecuteFileCommand, use UserData.forLinux() or UserData.forWindows() instead.",
    );
  }

  public addSignalOnExitCommand(): void {
    throw new Error(
      "CustomUserData does not support addSignalOnExitCommand, use UserData.forLinux() or UserData.forWindows() instead.",
    );
  }
}

// /**
//  * Options when creating `MultipartBody`.
//  */
// export interface MultipartBodyOptions {
//   /**
//    * `Content-Type` header of this part.
//    *
//    * Some examples of content types:
//    * * `text/x-shellscript; charset="utf-8"` (shell script)
//    * * `text/cloud-boothook; charset="utf-8"` (shell script executed during boot phase)
//    *
//    * For Linux shell scripts use `text/x-shellscript`.
//    */
//   readonly contentType: string;

//   // terraform provider has this hardcoded
//   // https://github.com/hashicorp/terraform-provider-cloudinit/blob/v2.3.6/internal/provider/cloudinit_config.go#L180

//   // /**
//   //  * `Content-Transfer-Encoding` header specifying part encoding.
//   //  *
//   //  * @default undefined - body is not encoded
//   //  */
//   // readonly transferEncoding?: string;

//   /**
//    * The body of message.
//    *
//    * @default undefined - body will not be added to part
//    */
//   readonly body?: string;
// }

/**
 * The base class for all classes which can be used as `MultipartUserData`.
 */
export abstract class MultipartBody {
  /**
   * Content type for shell scripts
   */
  public static readonly SHELL_SCRIPT = 'text/x-shellscript; charset="utf-8"';

  /**
   * Content type for boot hooks
   */
  public static readonly CLOUD_BOOTHOOK =
    'text/cloud-boothook; charset="utf-8"';

  /**
   * Constructs the new `MultipartBody` wrapping existing `UserData`. Modification to `UserData` are reflected
   * in subsequent renders of the part.
   *
   * For more information about content types see `MultipartBodyOptions.contentType`.
   *
   * @param userData user data to wrap into body part
   * @param contentType optional content type, if default one should not be used
   */
  public static fromUserData(
    userData: UserData,
    contentType?: string,
  ): MultipartBody {
    return new MultipartBodyUserDataWrapper(userData, contentType);
  }

  /**
  * When transfer encoding is specified (typically as Base64), it's caller responsibility to convert body to
  * Base64 either by wrapping with `Fn.base64` or by converting it by other converters.
  * /

  /**
   * Constructs the raw `MultipartBody` using specified body, content type, filename and merge type
   */
  public static fromRawBody(
    opts: dataCloudinitConfig.DataCloudinitConfigPart,
  ): MultipartBody {
    return new MultipartBodyRaw(opts);
  }

  public constructor() {}

  /**
   * Render body part
   */
  public abstract renderBodyPart(): dataCloudinitConfig.DataCloudinitConfigPart;
}

/**
 * The raw part of multi-part user data, which can be added to `MultipartUserData`.
 */
class MultipartBodyRaw extends MultipartBody {
  public constructor(
    private readonly props: dataCloudinitConfig.DataCloudinitConfigPart,
  ) {
    super();
  }

  /**
   * Raw return part
   */
  public renderBodyPart(): dataCloudinitConfig.DataCloudinitConfigPart {
    return this.props;
  }
}

/**
 * Wrapper for `UserData`.
 */
class MultipartBodyUserDataWrapper extends MultipartBody {
  private readonly contentType: string;

  public constructor(
    private readonly userData: UserData,
    contentType?: string,
  ) {
    super();

    this.contentType = contentType || MultipartBody.SHELL_SCRIPT;
  }

  /**
   * Render body parts
   */
  public renderBodyPart(): dataCloudinitConfig.DataCloudinitConfigPart {
    return {
      content: this.userData.content,
      contentType: this.contentType ?? this.userData.contentType,
      filename: this.userData.filename,
    };
  }
}

/**
 * Options for creating `MultipartUserData`
 */
export interface MultipartUserDataOptions extends UserDataCommon {
  /**
   * The string used to separate parts in multipart user data archive (it's like MIME boundary).
   *
   * This string should contain [a-zA-Z0-9()+,-./:=?] characters only, and should not be present in any part, or in text content of archive.
   *
   * @default `+AWS+CDK+User+Data+Separator==`
   */
  readonly partsSeparator?: string;
}

/**
 * Mime multipart user data.
 *
 * This class represents MIME multipart user data, as described in.
 * [Specifying Multiple User Data Blocks Using a MIME Multi Part Archive](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bootstrap_container_instance.html#multi-part_user_data)
 *
 */
export class MultipartUserData extends UserData {
  private static readonly USE_PART_ERROR =
    "MultipartUserData only supports this operation if it has a default UserData. Call addUserDataPart with makeDefault=true.";
  private static readonly BOUNDRY_PATTERN = "[^a-zA-Z0-9()+,-./:=?]";

  private parts: MultipartBody[] = [];

  private opts: MultipartUserDataOptions;

  private defaultUserData?: UserData;

  public readonly contentType?: string;

  public readonly filename?: string;

  constructor(opts?: MultipartUserDataOptions) {
    super(opts);
    this.contentType = opts?.contentType;
    this.filename = opts?.filename;

    let partsSeparator: string;

    // Validate separator
    if (opts?.partsSeparator != null) {
      if (
        new RegExp(MultipartUserData.BOUNDRY_PATTERN).test(opts!.partsSeparator)
      ) {
        throw new Error(
          `Invalid characters in separator. Separator has to match pattern ${MultipartUserData.BOUNDRY_PATTERN}`,
        );
      } else {
        partsSeparator = opts!.partsSeparator;
      }
    } else {
      partsSeparator = "+AWS+CDK+User+Data+Separator==";
    }

    this.opts = {
      partsSeparator: partsSeparator,
    };
  }

  /**
   * Adds a part to the list of parts.
   */
  public addPart(part: MultipartBody) {
    this.parts.push(part);
  }

  /**
   * Adds a multipart part based on a UserData object.
   *
   * If `makeDefault` is true, then the UserData added by this method
   * will also be the target of calls to the `add*Command` methods on
   * this MultipartUserData object.
   *
   * If `makeDefault` is false, then this is the same as calling:
   *
   * ```ts
   * declare const multiPart: compute.MultipartUserData;
   * declare const userData: compute.UserData;
   * declare const contentType: string;
   *
   * multiPart.addPart(compute.MultipartBody.fromUserData(userData, contentType));
   * ```
   *
   * An undefined `makeDefault` defaults to either:
   * - `true` if no default UserData has been set yet; or
   * - `false` if there is no default UserData set.
   */
  public addUserDataPart(
    userData: UserData,
    contentType?: string,
    makeDefault?: boolean,
  ) {
    this.addPart(MultipartBody.fromUserData(userData, contentType));
    makeDefault =
      makeDefault ?? (this.defaultUserData === undefined ? true : false);
    if (makeDefault) {
      this.defaultUserData = userData;
    }
  }

  /**
   * The content of the default UserData.
   */
  public get content(): string {
    if (this.defaultUserData) {
      return this.defaultUserData.content;
    } else {
      throw new Error(MultipartUserData.USE_PART_ERROR);
    }
  }

  public render(scope: IConstruct): string {
    return new dataCloudinitConfig.DataCloudinitConfig(scope, "UserData", {
      boundary: this.opts.partsSeparator,
      base64Encode: this.base64Encode,
      gzip: this.gzip,
      part: Lazy.anyValue({
        produce: () => this.parts.map((p) => p.renderBodyPart()),
      }),
    }).rendered;
  }

  public addS3DownloadCommand(params: S3DownloadOptions): string {
    if (this.defaultUserData) {
      return this.defaultUserData.addS3DownloadCommand(params);
    } else {
      throw new Error(MultipartUserData.USE_PART_ERROR);
    }
  }

  public addExecuteFileCommand(params: ExecuteFileOptions): void {
    if (this.defaultUserData) {
      this.defaultUserData.addExecuteFileCommand(params);
    } else {
      throw new Error(MultipartUserData.USE_PART_ERROR);
    }
  }

  // // TODO: Add Grid Signals
  // public addSignalOnExitCommand(resource: AwsConstructBase): void {
  //   if (this.defaultUserData) {
  //     this.defaultUserData.addSignalOnExitCommand(resource);
  //   } else {
  //     throw new Error(MultipartUserData.USE_PART_ERROR);
  //   }
  // }

  public addCommands(...commands: string[]): void {
    if (this.defaultUserData) {
      this.defaultUserData.addCommands(...commands);
    } else {
      throw new Error(MultipartUserData.USE_PART_ERROR);
    }
  }

  public addOnExitCommands(...commands: string[]): void {
    if (this.defaultUserData) {
      this.defaultUserData.addOnExitCommands(...commands);
    } else {
      throw new Error(MultipartUserData.USE_PART_ERROR);
    }
  }
}
