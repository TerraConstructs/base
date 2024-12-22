import * as fs from "fs";
import { cloudfrontFunction } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { IKeyValueStore } from ".";
import { AwsBeaconBase, IAwsBeacon, AwsBeaconProps } from "../beacon";

// ref: https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-cloudfront/lib/function.ts

/**
 * Represents the function's source code
 */
export abstract class FunctionCode {
  /**
   * Inline code for function
   * @returns code object with inline code.
   * @param code The actual function code
   */
  public static fromInline(code: string): FunctionCode {
    return new InlineCode(code);
  }

  /**
   * Code from external file for function
   * @returns code object with contents from file.
   * @param options the options for the external file
   */
  public static fromFile(options: FileCodeOptions): FunctionCode {
    return new FileCode(options);
  }

  /**
   * renders the function code
   */
  public abstract render(): string;
}

/**
 * Options when reading the function's code from an external file
 */
export interface FileCodeOptions {
  /**
   * The path of the file to read the code from
   */
  readonly filePath: string;
}

/**
 * Represents the function's source code as inline code
 */
class InlineCode extends FunctionCode {
  constructor(private code: string) {
    super();
  }

  public render(): string {
    return this.code;
  }
}

/**
 * Represents the function's source code loaded from an external file
 */
class FileCode extends FunctionCode {
  constructor(private options: FileCodeOptions) {
    super();
  }

  public render(): string {
    return fs
      .readFileSync(this.options.filePath, { encoding: "utf-8" })
      .replace(/\${/g, "$$${"); // escape ${ to $${ but don't escape newlines (unlike Fn.rawString)
  }
}

/**
 * Represents a CloudFront Function
 *
 * @resource aws_cloudfront_function
 */
export interface IFunction extends IAwsBeacon {
  /** Strongly typed outputs
   *
   * @attribute
   */
  readonly functionOutputs: FunctionOutputs;

  /**
   * The name of the function.
   * @attribute
   */
  readonly functionName: string;

  /**
   * The ARN of the function.
   * @attribute
   */
  readonly functionArn: string;
}

/**
 * Outputs of an existing CloudFront Function to import it
 */
export interface FunctionOutputs {
  /**
   * The name of the function.
   */
  readonly name: string;

  /**
   * The ARN of the function.
   */
  readonly arn: string;

  /**
   * The Runtime of the function.
   * @default FunctionRuntime.JS_1_0
   */
  readonly functionRuntime?: string;
}

/**
 * Properties for creating a CloudFront Function
 */
export interface FunctionProps extends AwsBeaconProps {
  /**
   * A name to identify the function.
   */
  readonly nameSuffix: string;

  /**
   * A comment to describe the function.
   * @default - same as `functionName`
   */
  readonly comment?: string;

  /**
   * The source code of the function.
   */
  readonly code: FunctionCode;

  /**
   * The runtime environment for the function.
   * @default FunctionRuntime.JS_1_0 (unless `keyValueStore` is specified, then `FunctionRuntime.JS_2_0`)
   */
  readonly runtime?: FunctionRuntime;

  /**
   * The Key Value Store to associate with this function.
   *
   * In order to associate a Key Value Store, the `runtime` must be
   * `cloudfront-js-2.0` or newer.
   *
   * Note: AWS limits associations to one key value store per function.
   *
   * @default - no key value store is associated
   */
  readonly keyValueStore?: IKeyValueStore;

  /**
   * A flag that determines whether to automatically publish the function to the LIVE stage when it’s created.
   *
   * @default - true
   */
  readonly autoPublish?: boolean;
}

/**
 * A CloudFront Function
 *
 * @resource aws_cloudfront_function
 */
export class Function extends AwsBeaconBase implements IFunction {
  // TODO: Add static fromLookup?
  public readonly resource: cloudfrontFunction.CloudfrontFunction;

  private readonly _outputs: FunctionOutputs;
  public get functionOutputs(): FunctionOutputs {
    return this._outputs;
  }
  public get outputs(): Record<string, any> {
    return this.functionOutputs;
  }
  /**
   * the name of the CloudFront function
   * @attribute
   */
  public readonly functionName: string;
  /**
   * the ARN of the CloudFront function
   * @attribute
   */
  public readonly functionArn: string;
  /**
   * the deployment stage of the CloudFront function
   * @attribute
   */
  public readonly functionStage: string;
  /**
   * the runtime of the CloudFront function
   * @attribute
   */
  public readonly functionRuntime: string;

  constructor(scope: Construct, id: string, props: FunctionProps) {
    super(scope, id, props);

    // TODO: consider using the `this.stack.makeUniqueResourceName` function?
    this.functionName = `${this.gridUUID}-${props.nameSuffix}`;
    if (this.functionName.length < 1 || this.functionName.length > 40) {
      throw new Error(
        `Function name must be between 1 and 40 characters long. Received: ${this.functionName}`,
      );
    }
    if (!/^[\.\-_A-Za-z0-9]+$/.test(this.functionName)) {
      throw new Error(
        `Function name ${this.functionName} can contain only letters, numbers, periods, hyphens, or underscores with no spaces.`,
      );
    }

    const defaultFunctionRuntime = props.keyValueStore
      ? FunctionRuntime.JS_2_0
      : FunctionRuntime.JS_1_0;
    this.functionRuntime = props.runtime ?? defaultFunctionRuntime;

    if (
      props.keyValueStore &&
      this.functionRuntime === FunctionRuntime.JS_1_0
    ) {
      throw new Error(
        `Key Value Stores cannot be associated to functions using the ${this.functionRuntime} runtime`,
      );
    }

    this.resource = new cloudfrontFunction.CloudfrontFunction(
      this,
      "Resource",
      {
        publish: props.autoPublish ?? true,
        code: props.code.render(),
        comment: props.comment ?? this.functionName,
        runtime: this.functionRuntime,
        keyValueStoreAssociations: props.keyValueStore
          ? [props.keyValueStore.arn]
          : undefined,
        name: this.functionName,
      },
    );

    this.functionArn = this.resource.arn;
    this.functionStage = this.resource.etag;
    this._outputs = {
      name: this.resource.name,
      arn: this.resource.arn,
      functionRuntime: this.resource.runtime,
    };
  }
}

/**
 * The type of events that a CloudFront function can be invoked in response to.
 */
export enum FunctionEventType {
  /**
   * The viewer-request specifies the incoming request
   */
  VIEWER_REQUEST = "viewer-request",

  /**
   * The viewer-response specifies the outgoing response
   */
  VIEWER_RESPONSE = "viewer-response",
}

/**
 * Represents a CloudFront function and event type when using CF Functions.
 * The type of the `AddBehaviorOptions.functionAssociations` property.
 */
export interface FunctionAssociation {
  /**
   * The CloudFront function that will be invoked.
   */
  readonly function: IFunction;

  /** The type of event which should invoke the function. */
  readonly eventType: FunctionEventType;
}

/**
 * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-features.html
 * https://registry.terraform.io/providers/hashicorp/aws/5.60.0/docs/resources/cloudfront_function#runtime
 */
export enum FunctionRuntime {
  /**
   * cloudfront-js-1.0
   */
  JS_1_0 = "cloudfront-js-1.0",

  /**
   * cloudfront-js-2.0
   */
  JS_2_0 = "cloudfront-js-2.0",
}
