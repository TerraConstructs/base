import { lambdaFunctionUrl } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { IAwsConstruct, AwsConstructBase } from "../aws-construct";
import { IAlias } from "./function-alias";
import { IFunction } from "./function-base";
import { Duration } from "../../duration";
import * as iam from "../iam";

/**
 * The auth types for a function url
 */
export enum FunctionUrlAuthType {
  /**
   * Restrict access to authenticated IAM users only
   */
  AWS_IAM = "AWS_IAM",

  /**
   * Bypass IAM authentication to create a public endpoint
   */
  NONE = "NONE",
}

/**
 * The invoke modes for a Lambda function
 */
export enum InvokeMode {
  /**
   * Default option. Lambda invokes your function using the Invoke API operation.
   * Invocation results are available when the payload is complete.
   * The maximum payload size is 6 MB.
   */
  BUFFERED = "BUFFERED",

  /**
   * Your function streams payload results as they become available.
   * Lambda invokes your function using the InvokeWithResponseStream API operation.
   * The maximum response payload size is 20 MB, however, you can request a quota increase.
   */
  RESPONSE_STREAM = "RESPONSE_STREAM",
}

/**
 * All http request methods
 */
export enum HttpMethod {
  /**
   * The GET method requests a representation of the specified resource.
   */
  GET = "GET",
  /**
   * The PUT method replaces all current representations of the target resource with the request payload.
   */
  PUT = "PUT",
  /**
   * The HEAD method asks for a response identical to that of a GET request, but without the response body.
   */
  HEAD = "HEAD",
  /**
   * The POST method is used to submit an entity to the specified resource, often causing a change in state or side effects on the server.
   */
  POST = "POST",
  /**
   * The DELETE method deletes the specified resource.
   */
  DELETE = "DELETE",
  /**
   * The PATCH method applies partial modifications to a resource.
   */
  PATCH = "PATCH",
  /**
   * The OPTIONS method describes the communication options for the target resource.
   */
  OPTIONS = "OPTIONS",
  /**
   * The wildcard entry to allow all methods.
   */
  ALL = "*",
}

/**
 * Specifies a cross-origin access property for a function URL
 */
export interface FunctionUrlCorsOptions {
  /**
   * Whether to allow cookies or other credentials in requests to your function URL.
   *
   * @default false
   */
  readonly allowCredentials?: boolean;

  /**
   * Headers that are specified in the Access-Control-Request-Headers header.
   *
   * @default - No headers allowed.
   */
  readonly allowedHeaders?: string[];

  /**
   * An HTTP method that you allow the origin to execute.
   *
   * @default - [HttpMethod.ALL]
   */
  readonly allowedMethods?: HttpMethod[];

  /**
   * One or more origins you want customers to be able to access the bucket from.
   *
   * @default - No origins allowed.
   */
  readonly allowedOrigins?: string[];

  /**
   * One or more headers in the response that you want customers to be able to access from their applications.
   *
   * @default - No headers exposed.
   */
  readonly exposedHeaders?: string[];

  /**
   * The time in seconds that your browser is to cache the preflight response for the specified resource.
   *
   * @default - Browser default of 5 seconds.
   */
  readonly maxAge?: Duration;
}

/**
 * Outputs that can be exposed through the grid
 */
export interface FunctionUrlOutputs {
  /**
   * The url of the Lambda function.
   */
  readonly url: string;

  /**
   * The ARN of the function this URL refers to
   */
  readonly functionArn: string;
}

/**
 * A Lambda function Url
 */
export interface IFunctionUrl extends IAwsConstruct {
  /** strongly typed FunctionUrlOutputs */
  readonly functionUrlOutputs: FunctionUrlOutputs;

  /**
   * The url of the Lambda function.
   *
   * @attribute FunctionUrl
   */
  readonly url: string;

  /**
   * The ARN of the function this URL refers to
   *
   * @attribute FunctionArn
   */
  readonly functionArn: string;

  /**
   * Grant the given identity permissions to invoke this Lambda Function URL
   */
  grantInvokeUrl(identity: iam.IGrantable): iam.Grant;
}

/**
 * Options to add a url to a Lambda function
 */
export interface FunctionUrlOptions {
  /**
   * The type of authentication that your function URL uses.
   *
   * @default FunctionUrlAuthType.AWS_IAM
   */
  readonly authType?: FunctionUrlAuthType;

  /**
   * The cross-origin resource sharing (CORS) settings for your function URL.
   *
   * @default - No CORS configuration.
   */
  readonly cors?: FunctionUrlCorsOptions;

  /**
   * The type of invocation mode that your Lambda function uses.
   *
   * @default InvokeMode.BUFFERED
   */
  readonly invokeMode?: InvokeMode;
}

/**
 * Properties for a FunctionUrl
 */
export interface FunctionUrlProps extends FunctionUrlOptions {
  /**
   * The function to which this url refers.
   * It can also be an `Alias` but not a `Version`.
   */
  readonly function: IFunction;
}

/**
 * Defines a Lambda function url
 *
 * @resource aws_lambda_function_url
 */
export class FunctionUrl extends AwsConstructBase implements IFunctionUrl {
  public readonly functionUrlOutputs: FunctionUrlOutputs;
  public get outputs(): Record<string, any> {
    return this.functionUrlOutputs;
  }
  public readonly resource: lambdaFunctionUrl.LambdaFunctionUrl;
  /**
   * The url of the Lambda function.
   */
  public readonly url: string;

  /**
   * The ARN of the function this URL refers to
   */
  public readonly functionArn: string;

  /**
   * The authentication type used for this Function URL
   */
  public readonly authType: FunctionUrlAuthType;

  private readonly function: IFunction;

  constructor(scope: Construct, id: string, props: FunctionUrlProps) {
    super(scope, id);

    // If the target function is an alias, then it must be configured using the underlying function
    // ARN, and the alias name as a qualifier.
    const { targetFunction, alias } = this.instanceOfAlias(props.function)
      ? { targetFunction: props.function.lambda, alias: props.function }
      : { targetFunction: props.function, alias: undefined };

    this.authType = props.authType ?? FunctionUrlAuthType.AWS_IAM;

    this.resource = new lambdaFunctionUrl.LambdaFunctionUrl(this, "Resource", {
      authorizationType: this.authType,
      cors: props.cors ? this.renderCors(props.cors) : undefined,
      invokeMode: props.invokeMode,
      functionName: targetFunction.functionArn, // The name (or ARN) of the Lambda function.
      qualifier: alias?.aliasName,
    });
    // The aliasName is a required physical name, so using it does not imply a dependency, so we
    // must "manually" register the dependency, or else TF may attempt to use before it exists.
    if (alias?.node.defaultChild != null) {
      this.resource.node.addDependency(alias.node.defaultChild);
    }

    this.url = this.resource.functionUrl;
    this.functionArn = this.resource.functionArn;
    this.function = props.function;

    if (props.authType === FunctionUrlAuthType.NONE) {
      props.function.addPermission("invoke-function-url", {
        principal: new iam.AnyPrincipal(),
        action: "lambda:InvokeFunctionUrl",
        functionUrlAuthType: props.authType,
      });
    }
    this.functionUrlOutputs = {
      url: this.url,
      functionArn: this.functionArn,
    };
  }

  public grantInvokeUrl(grantee: iam.IGrantable): iam.Grant {
    return this.function.grantInvokeUrl(grantee);
  }

  private instanceOfAlias(fn: IFunction): fn is IAlias {
    return "aliasName" in fn;
  }

  private renderCors(
    cors: FunctionUrlCorsOptions,
  ): lambdaFunctionUrl.LambdaFunctionUrlCors {
    if (
      cors.maxAge &&
      !cors.maxAge.isUnresolved() &&
      cors.maxAge.toSeconds() > 86400
    ) {
      throw new Error(
        `FunctionUrl CORS maxAge should be less than or equal to 86400 secs (got ${cors.maxAge.toSeconds()})`,
      );
    }

    return {
      allowCredentials: cors.allowCredentials,
      allowHeaders: cors.allowedHeaders,
      allowMethods: cors.allowedMethods ?? [HttpMethod.ALL],
      allowOrigins: cors.allowedOrigins,
      exposeHeaders: cors.exposedHeaders,
      maxAge: cors.maxAge?.toSeconds(),
    };
  }
}
