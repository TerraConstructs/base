// source: https://github.com/cdktf-plus/cdktf-plus/blob/586aabad3ab2fb2a2e93e05ed33f94474ebe9397/packages/%40cdktf-plus/aws/lib/aws-lambda-function/index.ts
// update to align closer with https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-lambda/lib/function.ts
import {
  lambdaFunction,
  cloudwatchLogGroup,
  securityGroup,
  lambdaEventSourceMapping,
  dataAwsLambdaFunction,
} from "@cdktf/provider-aws";
import { IResolveContext, Lazy, IResolvable, Token } from "cdktf";
import { Construct } from "constructs";
import { ArnFormat, Arn } from "../arn";
import { AwsStack } from "../aws-stack";
import { RetentionDays } from "../log-retention";
import { Architecture } from "./architecture";
import { Code, CodeConfig } from "./code";
import { EventInvokeConfigOptions } from "./event-invoke-config";
import { IEventSourceMapping } from "./event-source-mapping";
import { AliasOptions, Alias } from "./function-alias";
import {
  LambdaFunctionBase,
  IFunction,
  FunctionAttributes,
  IEventSource,
} from "./function-base";
import { FunctionUrl, FunctionUrlOptions } from "./function-url";
import { VpcConfig } from "./function-vpc-config.generated";
import { Handler } from "./handler";
import { addAlias } from "./util";
import { Duration } from "../../duration";
// import { Fn } from "../../terra-func";
import * as iam from "../iam";
import { IQueue, Queue } from "../notify";
import { Runtime } from "./runtime";

export interface FunctionOutputs {
  /**
   * AWS Lambda function name
   */
  readonly name: string;

  /**
   * AWS Lambda arn of the function
   */
  readonly arn: string;

  /**
   * The IAM Role associated with the Lambda function
   */
  readonly roleArn: string;

  /**
   * Function URL if enabled
   */
  readonly url?: string | IResolvable;

  /**
   * Security group of the function if created
   */
  readonly defaultSecurityGroup?: string | IResolvable;
}

export interface FunctionOptions extends EventInvokeConfigOptions {
  /**
   * Force function name (for adoption of existing resources).
   *
   * Prefer to use functionNamePrefix.
   *
   * Use [Terraform Resource Meta Arguments](https://developer.hashicorp.com/terraform/language/resources/syntax#meta-arguments)
   * to control lifecycle when replacing the function.
   *
   * @default - If omitted, Refer to `functionNamePrefix`.
   */
  readonly functionName?: string;

  /**
   * A name prefix for the function.
   *
   * @default - Grid generates a unique physical ID and uses that
   * ID for the function's name.
   */
  readonly functionNamePrefix?: string;

  /**
   * The environment variables to be passed to the Lambda function.
   *
   * Key-value pairs that Lambda caches and makes available for your Lambda
   * functions. Use environment variables to apply configuration changes, such
   * as test and production environment configurations, without changing your
   * Lambda function source code.
   */
  readonly environment?: { [key: string]: string };

  /**
   * Description of what your Lambda Function does.
   */
  readonly description?: string;

  /**
   * The system architectures compatible with this lambda function.
   * @default Architecture.X86_64
   */
  readonly architecture?: Architecture;

  /**
   * The tracing mode for the Lambda function.
   *
   * The Lambda function iam role will receive permission to
   * write to AWS X-Ray.
   *
   * @default Tracing.ACTIVE
   */
  readonly tracing?: Tracing;

  /**
   * The log retention period in days. Defaults to 7.
   */
  readonly logRetentionInDays?: RetentionDays;

  /**
   * The memory limit in MB.
   *
   * @default 128.
   */
  readonly memorySize?: number;

  /**
   * The function execution time (in seconds) after which Lambda terminates
   * the function. Because the execution time affects cost, set this value
   * based on the function's expected execution time.
   *
   * @default Duration.seconds(3)
   */
  readonly timeout?: Duration;

  /**
   * Layers for the Lambda.
   */
  readonly layers?: string[];

  /**
   * Initial policy statements to add to the created Lambda Role.
   *
   * You can call `addToRolePolicy` to the created lambda to add statements post creation.
   *
   * @default - No policy statements are added to the created Lambda role.
   */
  readonly initialPolicy?: iam.PolicyStatement[];

  /**
   * Lambda execution role.
   *
   * This is the role that will be assumed by the function upon execution.
   * It controls the permissions that the function will have. The Role must
   * be assumable by the 'lambda.amazonaws.com' service principal.
   *
   * The default Role automatically has permissions granted for Lambda execution. If you
   * provide a Role, you must add the relevant AWS managed policies yourself.
   *
   * The relevant managed policies are "service-role/AWSLambdaBasicExecutionRole" and
   * "service-role/AWSLambdaVPCAccessExecutionRole".
   *
   * @default - A unique role will be generated for this lambda function.
   * Both supplied and generated roles can always be changed by calling `addToRolePolicy`.
   */
  readonly role?: iam.IRole;

  /**
   * Config for network connectivity to AWS resources in a VPC, specify a list
   * of subnet, and optionally security groups, in the VPC.
   *
   * The Lambda function iam role will receive permission to
   * manage ENIs within the provided network.
   *
   * When you connect a function to a VPC, it can only access resources and the internet through that VPC.
   *
   * See [VPC Settings](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html).
   */
  readonly networkConfig?: VpcConfig;

  /**
   * The SQS DLQ.
   *
   * The Lambda function iam role will receive permission to
   * send messages on this queue.
   *
   * @default - no deadletter queue
   */
  readonly deadLetterQueue?: IQueue;

  /**
   * Enabled DLQ. If `deadLetterQueue` is undefined,
   * an SQS queue with default options will be defined for your Function.
   *
   * @default - false unless `deadLetterQueue` is set, which implies DLQ is enabled.
   */
  readonly deadLetterQueueEnabled?: boolean;

  // TODO: re-add SNS deadLetterTopic

  /**
   * Event sources for this function.
   *
   * You can also add event sources using `addEventSource`.
   *
   * @default - No event sources.
   */
  readonly events?: IEventSource[];

  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.60.0/docs/resources/lambda_function#reserved_concurrent_executions LambdaFunction#reserved_concurrent_executions}
   */
  readonly reservedConcurrentExecutions?: number;

  /**
   * Tags to apply to the Lambda function.
   */
  readonly tags?: { [key: string]: string };

  /**
   * Setting this property informs the CDK that the imported function ALREADY HAS the necessary permissions
   * for what you are trying to do. When not configured, the CDK attempts to auto-determine whether or not
   * additional permissions are necessary on the function when grant APIs are used. If the CDK tried to add
   * permissions on an imported lambda, it will fail.
   *
   * Set this property *ONLY IF* you are committing to manage the imported function's permissions outside of
   * CDK. You are acknowledging that your CDK code alone will have insufficient permissions to access the
   * imported function.
   *
   * @default false
   */
  readonly skipPermissions?: boolean;

  /**
   * Sets the loggingFormat for the function.
   * @default LoggingFormat.TEXT
   */
  readonly loggingFormat?: LoggingFormat;

  /**
   * Sets the application log level for the function.
   * @default ApplicationLogLevel.INFO
   */
  readonly applicationLogLevel?: ApplicationLogLevel;

  /**
   * Sets the system log level for the function.
   * @default SystemLogLevel.INFO
   */
  readonly systemLogLevel?: SystemLogLevel;
  /**
   * Whether to publish creation/change as new Lambda Function Version.
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_function#publish LambdaFunction#publish}
   * @default false
   */
  readonly publish?: boolean | IResolvable;
}

export interface FunctionProps extends FunctionOptions {
  /**
   * The runtime environment for the Lambda function that you are uploading.
   * For valid values, see the Runtime property in the AWS Lambda Developer
   * Guide.
   *
   * Use `Runtime.FROM_IMAGE` when defining a function from a Docker image.
   */
  readonly runtime: Runtime;

  /**
   * The source code of your Lambda function. You can point to a file in an
   * Amazon Simple Storage Service (Amazon S3) bucket or specify your source
   * code as inline text.
   */
  readonly code: Code;

  /**
   * The name of the method within your code that Lambda calls to execute
   * your function. The format includes the file name. It can also include
   * namespaces and other qualifiers, depending on the runtime.
   * For more information, see https://docs.aws.amazon.com/lambda/latest/dg/foundation-progmodel.html.
   *
   * Use `Handler.FROM_IMAGE` when defining a function from a Docker image.
   *
   * NOTE: If you specify your source code as inline text by specifying the
   * ZipFile property within the Code property, specify index.function_name as
   * the handler.
   */
  readonly handler: string;
}

// re-add ec2.IConnectable?

// /**
//  * A Lambda function.
//  */
// export interface IFunction extends IAwsConstruct, iam.IGrantable {

//   /**
//    * Add an environment variable to this function.
//    */
//   addEnvironment(key: string, value: string): IFunction;
// }

/**
 * Provides a Lambda Function resource. Lambda allows you to trigger execution
 * of code in response to events in AWS, enabling serverless backend solutions.
 *
 * The Lambda Function itself includes source code and runtime configuration.
 *
 * This Construct manages permissions as part of the function Principal iam policy.
 * This works for same account resources, but for cross-account resources,
 * you may need to manage access as part of the Resource iam policy.
 *
 * @resource aws_lambda_function
 * @beacon-class compute.IFunction
 */
export class LambdaFunction extends LambdaFunctionBase implements IFunction {
  // TODO: Terraform aws_lambda_function == CDK FunctionVersion

  /**
   * Latest published version of your Lambda Function.
   */
  public get version(): string {
    // TODO: What is this if publish is false??
    return this.resource.version;
  }

  /**
   * Import a lambda function into the TerraConstruct spec using its name
   */
  public static fromFunctionName(
    scope: Construct,
    id: string,
    functionName: string,
  ): IFunction {
    return LambdaFunction.fromFunctionAttributes(scope, id, {
      functionArn: AwsStack.ofAwsConstruct(scope).formatArn({
        service: "lambda",
        resource: "function",
        resourceName: functionName,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      }),
      sameEnvironment: true,
    });
  }

  /**
   * Import a lambda function into the TerraConstruct spec using its ARN.
   *
   * For `Function.addPermissions()` to work on this imported lambda, make sure that is
   * in the same account and region as the stack you are importing it into.
   */
  public static fromFunctionArn(
    scope: Construct,
    id: string,
    functionArn: string,
  ): IFunction {
    return LambdaFunction.fromFunctionAttributes(scope, id, { functionArn });
  }

  /**
   * Creates a Lambda function object which represents a function not defined
   * within this stack.
   *
   * For `Function.addPermissions()` to work on this imported lambda, set the sameEnvironment property to true
   * if this imported lambda is in the same account and region as the stack you are importing it into.
   *
   * @param scope The parent construct
   * @param id The name of the lambda construct
   * @param attrs the attributes of the function to import
   */
  public static fromFunctionAttributes(
    scope: Construct,
    id: string,
    attrs: FunctionAttributes,
  ): IFunction {
    const functionArn = attrs.functionArn;
    const functionName = extractNameFromArn(attrs.functionArn);
    const role = attrs.role;

    class Import extends LambdaFunctionBase {
      public readonly resource: dataAwsLambdaFunction.DataAwsLambdaFunction;
      public readonly functionName = functionName;
      public readonly functionArn = functionArn;
      public get functionQualifiedInvokeArn(): string {
        const { region, partition } = Arn.split(
          functionArn,
          ArnFormat.COLON_RESOURCE_NAME,
        );
        return `arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${functionArn}/invocations`;
      }
      public get functionInvokeArn(): string {
        const { region, partition } = Arn.split(
          functionArn,
          ArnFormat.COLON_RESOURCE_NAME,
        );
        return `arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${functionArn}/invocations`;
      }
      // TODO: Resolve role and principal resolve from TF data source?
      public readonly grantPrincipal: iam.IPrincipal;
      public readonly role = role;
      public readonly permissionsNode = this.node;
      /**
       * The version of the Lambda function returned.
       *
       * If qualifier is not set, this will resolve to the most recent published version.
       * If no published version of the function exists, version will resolve to `$LATEST`.
       */
      public get version(): string {
        return this.resource.version;
      }
      // Force user to provide arch or assume X86_64
      public readonly architecture = attrs.architecture ?? Architecture.X86_64;
      // public get architecture(): string {
      //   return Fn.element(this.resource.architectures, 0) as string;
      // }
      public readonly resourceArnsForGrantInvoke = [
        this.functionArn,
        `${this.functionArn}:*`,
      ];
      public get functionOutputs(): FunctionOutputs {
        return {
          name: this.functionName,
          arn: this.functionArn,
          roleArn: this.role?.roleArn ?? "",
        };
      }
      public get outputs() {
        return this.functionOutputs;
      }
      protected readonly canCreatePermissions =
        attrs.sameEnvironment ?? this._isStackAccount();
      protected readonly _skipPermissions = attrs.skipPermissions ?? false;

      constructor(s: Construct, i: string) {
        super(s, i, {
          environmentFromArn: functionArn,
        });

        this.grantPrincipal =
          role || new iam.UnknownPrincipal({ resource: this });
        this.resource = new dataAwsLambdaFunction.DataAwsLambdaFunction(
          this,
          "Resource",
          {
            functionName: this.functionName,
          },
        );

        // // TODO: re-add support for EC2 connections
        // if (attrs.securityGroup) {
        //   this._connections = new ec2.Connections({
        //     securityGroups: [attrs.securityGroup],
        //   });
        // }
      }
    }

    return new Import(scope, id);
  }

  protected readonly resource: lambdaFunction.LambdaFunction;

  private readonly _outputs: FunctionOutputs;

  /** Strongly Typed Function Outputs */
  public get functionOutputs(): FunctionOutputs {
    return this._outputs;
  }
  public get outputs(): Record<string, any> {
    return this.functionOutputs;
  }

  /**
   * The name of the function.
   */
  public readonly functionName: string;

  /**
   * The ARN fo the function.
   */
  public get functionArn(): string {
    return this.resource.arn;
  }

  /**
   * The ARN fo the function.
   * (if versioning is enabled via publish = true)
   */
  public get functionQualifiedArn(): string {
    return this.resource.qualifiedArn;
  }

  /**
   * The Fully Qualified Invoke ARN fo the function to be used from API Gateway.
   *
   * NOTE: This does not seem to work with Authorizers
   */
  public get functionQualifiedInvokeArn(): string {
    return this.resource.qualifiedInvokeArn;
  }

  /**
   * The Invoke ARN fo the function to be used from API Gateway.
   *
   * NOTE: Use this for Authorizers
   */
  public get functionInvokeArn(): string {
    return this.resource.invokeArn;
  }

  /**
   * The architecture of this Lambda Function.
   */
  public readonly architecture: Architecture;

  /**
   * The principal this Lambda Function is running as
   */
  public readonly grantPrincipal: iam.IPrincipal;

  /**
   * The IAM role associated with this function.
   *
   * Undefined if the function was imported without a role.
   */
  public readonly role?: iam.IRole;

  /**
   * The DLQ (as queue) associated with this Lambda Function (this is an optional attribute).
   */
  public readonly deadLetterQueue?: IQueue;

  /**
   * The timeout configured for this lambda.
   */
  public readonly timeout?: Duration;

  /**
   * The construct node where permissions are attached.
   */
  public readonly permissionsNode = this.node;

  protected readonly canCreatePermissions = true;

  /**
   * Mapping of invocation principals to grants. Used to de-dupe `grantInvoke()` calls.
   * @internal
   */
  protected _invocationGrants: Record<string, iam.Grant> = {};

  /**
   * Mapping of fucntion URL invocation principals to grants. Used to de-dupe `grantInvokeUrl()` calls.
   * @internal
   */
  protected _functionUrlInvocationGrants: Record<string, iam.Grant> = {};

  // // Teraform provider for AWS Automatically manages Function Versioning through code hash..
  // // need to drop most of this version logic..

  // private readonly currentVersionOptions?: VersionOptions;
  // private _currentVersion?: Version;
  // /**
  //  * Returns a `lambda.Version` which represents the current version of this
  //  * Lambda function. A new version will be created every time the function's
  //  * configuration changes.
  //  *
  //  * You can specify options for this version using the `currentVersionOptions`
  //  * prop when initializing the `lambda.Function`.
  //  */
  // public get currentVersion(): Version {
  //   if (this._currentVersion) {
  //     return this._currentVersion;
  //   }

  //   // if (this._warnIfCurrentVersionCalled) {
  //   //   this.warnInvokeFunctionPermissions(this);
  //   // }

  //   this._currentVersion = new Version(this, "CurrentVersion", {
  //     lambda: this,
  //     ...this.currentVersionOptions,
  //   });

  //   // override the version's logical ID with a lazy string which includes the
  //   // hash of the function itself, so a new version resource is created when
  //   // the function configuration changes.
  //   const cfn = this._currentVersion.node.defaultChild as TerraformResource;
  //   const originalLogicalId = this.stack.resolve(cfn.logicalId) as string;

  //   cfn.overrideLogicalId(
  //     Lazy.stringValue({
  //       produce: () => {
  //         const hash = calculateFunctionHash(this, this.hashMixins.join(""));
  //         const logicalId = trimFromStart(originalLogicalId, 255 - 32);
  //         return `${logicalId}${hash}`;
  //       },
  //     }),
  //   );

  //   return this._currentVersion;
  // }

  /**
   * The ARN(s) to put into the resource field of the generated IAM policy for grantInvoke()
   */
  public get resourceArnsForGrantInvoke() {
    // TODO: should this be qualifiedArn or qualifiedInvokeArn?
    // https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/lambda_function#qualified_arn
    return [this.functionArn, this.functionQualifiedInvokeArn];
  }

  /** @internal */
  public readonly _logGroup: cloudwatchLogGroup.CloudwatchLogGroup;

  /**
   * Environment variables for this function
   */
  public readonly environment: { [key: string]: string } = {};

  private _url?: string;
  /**
   * HTTP Endpoint for this function if defined.
   *
   * use `addFunctionUrl` to enable Endpoint.
   */
  public get url(): string | undefined {
    return this._url;
  }

  private _eventSources: {
    [id: string]: lambdaEventSourceMapping.LambdaEventSourceMapping;
  } = {};
  public get eventSources(): lambdaEventSourceMapping.LambdaEventSourceMapping[] {
    return Object.values(this._eventSources);
  }

  private _securityGroup?: securityGroup.SecurityGroup;
  public get securityGroup(): securityGroup.SecurityGroup | undefined {
    return this._securityGroup;
  }

  constructor(scope: Construct, name: string, props: FunctionProps) {
    super(scope, name, props);

    const {
      description,
      environment: variables,
      logRetentionInDays = RetentionDays.ONE_WEEK,
      memorySize = 128,
      timeout = Duration.seconds(3),
      layers,
      reservedConcurrentExecutions,
    } = props;

    /**
     * The name or ARN of the Lambda function.
     * is limited to 64 characters in length.
     *
     * ARN Pattern: ([a-zA-Z0-9-_]+)(:(\$LATEST|[a-zA-Z0-9-_]+))?
     */
    const functionName =
      props.functionName ??
      this.stack.uniqueResourceNamePrefix(this, {
        prefix: props.functionNamePrefix ?? this.gridUUID + "-",
        allowedSpecialCharacters: "+",
        maxLength: 64,
      });

    if (functionName && !Token.isUnresolved(functionName)) {
      if (functionName.length > 64) {
        throw new Error(
          `Function name can not be longer than 64 characters but has ${functionName.length} characters.`,
        );
      }
      if (!/^[a-zA-Z0-9-_]+$/.test(functionName)) {
        throw new Error(
          `Function name ${functionName} can contain only letters, numbers, hyphens, or underscores with no spaces.`,
        );
      }
    }

    if (description && !Token.isUnresolved(description)) {
      if (description.length > 256) {
        throw new Error(
          `Function description can not be longer than 256 characters but has ${description.length} characters.`,
        );
      }
    }

    const managedPolicies = new Array<iam.IManagedPolicy>();
    // the arn is in the form of - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    managedPolicies.push(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        this,
        "AWSLambdaBasicExecutionRole",
        "service-role/AWSLambdaBasicExecutionRole",
      ),
    );
    if (props.networkConfig) {
      // Policy that will have ENI creation permissions
      // not sure if time.sleep is necessary?
      // ref:
      //  - https://github.com/pulumi/pulumi-aws/issues/2260#issuecomment-1977606509
      //  - https://github.com/hashicorp/terraform-provider-aws/issues/29828#issuecomment-1693307500
      managedPolicies.push(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          this,
          "AWSLambdaVPCAccessExecutionRole",
          "service-role/AWSLambdaVPCAccessExecutionRole",
        ),
      );
    }

    // TODO: Any concern not scoping the logGroup IAM Permissions?
    // .allow()
    // .toCreateLogStream()
    // .toPutLogEvents()
    // .on(logGroup.arn, `${logGroup.arn}:log-stream:*`),

    this.role =
      props.role ||
      new iam.Role(this, "ServiceRole", {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies,
      });
    this.grantPrincipal = this.role;
    // TODO: Re-add filesystem / localMountPath support
    // ref: filesystem.config.policies to be added to principal
    // https://github.com/aws/aws-cdk/blob/v2.160.0/packages/aws-cdk-lib/aws-lambda/lib/function.ts#L949-L965

    for (const statement of props.initialPolicy || []) {
      this.role.addToPrincipalPolicy(statement);
    }

    const code = props.code.bind(this);
    verifyCodeConfig(code, props);

    // add support for AWS_CODEGURU Profile env variables...
    const env = variables || {};
    for (const [key, value] of Object.entries(env)) {
      this.addEnvironment(key, value);
    }

    // DLQ can be either sns.ITopic or sqs.IQueue
    const dlqTopicOrQueue = this.buildDeadLetterQueue(props);
    if (dlqTopicOrQueue !== undefined) {
      if (this.isQueue(dlqTopicOrQueue)) {
        this.deadLetterQueue = dlqTopicOrQueue;
      } else {
        throw new Error("DeadLetterTopic is not supported yet");
        // this.deadLetterTopic = dlqTopicOrQueue;
      }
    }

    const logGroup = new cloudwatchLogGroup.CloudwatchLogGroup(
      this,
      "LogGroup",
      {
        name: `/aws/lambda/${functionName}`,
        retentionInDays: logRetentionInDays,
      },
    );
    this._logGroup = logGroup;
    this.resource = new lambdaFunction.LambdaFunction(this, "Resource", {
      functionName,
      description,
      // NOTE: for the underlaying resource, Exactly one of filename, image_uri, or s3_bucket must be specified
      s3Bucket: code.s3Location && code.s3Location.bucketName,
      s3Key: code.s3Location && code.s3Location.objectKey,
      s3ObjectVersion: code.s3Location && code.s3Location.objectVersion,
      filename: code.inlineCode,
      sourceCodeHash: code.sourceCodeHash,
      imageUri: code.image?.imageUri,
      layers, // TODO: Support ILayer with Lazy list of arns
      handler: props.handler === Handler.FROM_IMAGE ? undefined : props.handler,
      timeout: timeout.toSeconds(),
      packageType: props.runtime === Runtime.FROM_IMAGE ? "Image" : undefined,
      runtime:
        props.runtime === Runtime.FROM_IMAGE ? undefined : props.runtime.name,
      // // Source Code KMS not supported by Terraform provider?
      // // see: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-function-code.html#cfn-lambda-function-code-sourcekmskeyarn
      // sourceKmsKeyArn: code.sourceKMSKeyArn,
      role: this.role.roleArn,
      // TODO: CDK Sorts environment to match Lambda Hash behaviour
      // TODO: Do not set this at all if no environment variables are set (ComplexList can't be IResolvable)
      // ref: https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-lambda/lib/function.ts#L1467
      environment: {
        variables: Lazy.anyValue({
          produce: (_context: IResolveContext) => {
            return this.environment;
          },
        }) as any,
      },
      memorySize,
      // TODO: re-add ephemeralStorage
      vpcConfig: this.parseVpcConfig(props.networkConfig),
      deadLetterConfig: this.parseDeadLetterConfig(dlqTopicOrQueue),
      reservedConcurrentExecutions,
      imageConfig: undefinedIfNoKeys({
        command: code.image?.cmd,
        entryPoint: code.image?.entrypoint,
        workingDirectory: code.image?.workingDirectory,
      }),
      // TODO: re-add kmsKeyArn for environment encryption
      // TODO: re-add fileSystemConfigs for EFS support,
      // TODO: re-add codeSigningConfigArn
      architectures: [
        // This is an array, but maximum length is 1!
        // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-architectures
        props.architecture?.toString() ?? Architecture.X86_64.toString(),
      ],
      // TODO: re-add runtimeManagementConfig
      // TODO: re-add snapStart
      loggingConfig: this.getLoggingConfig(this._logGroup.name, props),
      // TODO: re-add recursiveLoop detection
      tracingConfig: this.parseTracingConfig(props.tracing ?? Tracing.ACTIVE),
      publish: props.publish,
      // TODO: use logGroup.node.addDependency when logGroup is implemented
      dependsOn: [logGroup],
    });
    // NOTE: Should this be functionName input instead of TOKEN?
    this.functionName = this.resource.functionName;

    // make sure any role attachments are added as dependencies for this lambda
    // this achieved by the CDKTF Aspect on the parent StackBase
    this.resource.node.addDependency(this.role);

    this.timeout = props.timeout;
    this.architecture = props.architecture ?? Architecture.X86_64;

    // TODO: Add aws_lambda_provisioned_concurrency_config

    for (const event of props.events || []) {
      this.addEventSource(event);
    }

    // // TODO: pending custom CLI to mock Lambda function invocations locally
    // props.code.bindToResource(this);

    // Event Invoke Config
    if (
      props.onFailure ||
      props.onSuccess ||
      props.maxEventAge ||
      props.retryAttempts !== undefined
    ) {
      this.configureAsyncInvoke({
        onFailure: props.onFailure,
        onSuccess: props.onSuccess,
        maxEventAge: props.maxEventAge,
        retryAttempts: props.retryAttempts,
      });
    }

    this._outputs = {
      name: this.functionName,
      arn: this.resource.arn,
      roleArn: this.role.roleArn,
      // only known at synth time
      // explicit `null` required to avoid syntax errors when using stringValue && "undefined"
      url: Lazy.anyValue({
        produce: () => this._url ?? null,
      }),
      defaultSecurityGroup: Lazy.anyValue({
        produce: () => this._securityGroup?.id ?? null,
      }),
    };
  }

  /**
   * Adds an environment variable to this Lambda function.
   * If this is a ref to a Lambda function, this operation results in a no-op.
   * @param key The environment variable key.
   * @param value The environment variable's value.
   */
  public addEnvironment(key: string, value: string): IFunction {
    // Reserved environment variables will fail during cloudformation deploy if they're set.
    // This check is just to allow CDK to fail faster when these are specified.
    const reservedEnvironmentVariables = [
      "_HANDLER",
      "_X_AMZN_TRACE_ID",
      "AWS_DEFAULT_REGION",
      "AWS_REGION",
      "AWS_EXECUTION_ENV",
      "AWS_LAMBDA_FUNCTION_NAME",
      "AWS_LAMBDA_FUNCTION_MEMORY_SIZE",
      "AWS_LAMBDA_FUNCTION_VERSION",
      "AWS_LAMBDA_INITIALIZATION_TYPE",
      "AWS_LAMBDA_LOG_GROUP_NAME",
      "AWS_LAMBDA_LOG_STREAM_NAME",
      "AWS_ACCESS_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_LAMBDA_RUNTIME_API",
      "LAMBDA_TASK_ROOT",
      "LAMBDA_RUNTIME_DIR",
    ];
    if (reservedEnvironmentVariables.includes(key)) {
      throw new Error(
        `${key} environment variable is reserved by the lambda runtime and can not be set manually. See https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html`,
      );
    }
    this.environment[key] = value;
    return this;
  }

  public addFunctionUrl(options?: FunctionUrlOptions): FunctionUrl {
    const endpoint = super.addFunctionUrl(options);
    this._url = endpoint.url;
    return endpoint;
  }

  /**
   * Get Logging Config propety for the function.
   * This method returns the function LoggingConfig Property if the property is set on the
   * function and undefined if not.
   */
  private getLoggingConfig(
    logGroupName: string,
    props: FunctionProps,
  ): lambdaFunction.LambdaFunctionLoggingConfig | undefined {
    if (props.applicationLogLevel || props.systemLogLevel) {
      if (props.loggingFormat !== LoggingFormat.JSON) {
        throw new Error(
          `To use ApplicationLogLevel and/or SystemLogLevel you must set LoggingFormat to '${LoggingFormat.JSON}', got '${props.loggingFormat}'.`,
        );
      }
    }

    let loggingConfig: lambdaFunction.LambdaFunctionLoggingConfig;
    if (props.loggingFormat) {
      loggingConfig = {
        logFormat: props.loggingFormat,
        systemLogLevel: props.systemLogLevel,
        applicationLogLevel: props.applicationLogLevel,
        logGroup: logGroupName,
      };
      return loggingConfig;
    }
    return undefined;
  }

  /**
   * Defines an alias for this function.
   *
   * The alias will automatically be updated to point to the latest version of
   * the function as it is being updated during a deployment.
   *
   * ```ts
   * declare const fn: compute.LambdaFunction;
   *
   * fn.addAlias('Live');
   *
   * // Is equivalent to
   *
   * new compute.Alias(this, 'AliasLive', {
   *   aliasName: 'Live',
   *   version: fn.version,
   * });
   * ```
   *
   * @param aliasName The name of the alias
   * @param options Alias options
   */
  public addAlias(aliasName: string, options?: AliasOptions): Alias {
    return addAlias(this, this, this.version, aliasName, options);
  }

  /**
   * Optionally create LambdaFunctionVpcConfig
   */
  private parseVpcConfig(
    config?: VpcConfig,
  ): lambdaFunction.LambdaFunctionVpcConfig | undefined {
    if (!config) {
      return undefined;
    }
    let securityGroupIds = config.securityGroupIds;
    if (!securityGroupIds) {
      this._securityGroup = new securityGroup.SecurityGroup(
        this,
        "SecurityGroup",
        {
          name: this.functionName,
          description: this.functionName,
          vpcId: config.vpcId,

          egress: config.egress ?? [
            {
              fromPort: 0,
              toPort: 0,
              protocol: "-1",
              cidrBlocks: ["0.0.0.0/0"],
              ipv6CidrBlocks: ["::/0"],
            },
          ],
        },
      );
      securityGroupIds = [this._securityGroup.id];
    }
    return {
      subnetIds: config.subnetIds,
      ipv6AllowedForDualStack: config.ipv6AllowedForDualStack,
      securityGroupIds,
    };
  }

  private isQueue(deadLetterQueue: IQueue): deadLetterQueue is IQueue {
    return (<IQueue>deadLetterQueue).queueArn !== undefined;
  }

  private buildDeadLetterQueue(props: FunctionProps): IQueue | undefined {
    // | sns.ITopic
    if (
      !props.deadLetterQueue &&
      !props.deadLetterQueueEnabled
      // && !props.deadLetterTopic
    ) {
      return undefined;
    }
    if (props.deadLetterQueue && props.deadLetterQueueEnabled === false) {
      throw Error(
        "deadLetterQueue defined but deadLetterQueueEnabled explicitly set to false",
      );
    }
    // if (
    //   props.deadLetterTopic &&
    //   (props.deadLetterQueue || props.deadLetterQueueEnabled !== undefined)
    // ) {
    //   throw new Error(
    //     "deadLetterQueue and deadLetterTopic cannot be specified together at the same time",
    //   );
    // }

    let deadLetterQueue: IQueue; // | ITopic;
    // if (props.deadLetterTopic) {
    //   deadLetterQueue = props.deadLetterTopic;
    //   this.addToRolePolicy(
    //     new iam.PolicyStatement({
    //       actions: ["sns:Publish"],
    //       resources: [deadLetterQueue.topicArn],
    //     }),
    //   );
    // } else {
    deadLetterQueue =
      props.deadLetterQueue ||
      new Queue(this, "DeadLetterQueue", {
        messageRetentionSeconds: Duration.days(14).toSeconds(),
      });
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sqs:SendMessage"],
        resources: [deadLetterQueue.queueArn],
      }),
    );
    // }

    return deadLetterQueue;
  }

  // TODO: Support sns.ITopic + sns:Publish topicArn
  /**
   * Optionally create LambdaFunctionDeadLetterConfig
   */
  private parseDeadLetterConfig(
    deadLetterQueue?: IQueue, // | sns.ITopic
  ): lambdaFunction.LambdaFunctionDeadLetterConfig | undefined {
    if (deadLetterQueue) {
      // this.isQueue(deadLetterQueue) ? deadLetterQueue.queueArn : ...
      return {
        targetArn: deadLetterQueue.queueArn,
      };
    } else {
      return undefined;
    }
  }

  private parseTracingConfig(
    tracing: Tracing,
  ): lambdaFunction.LambdaFunctionTracingConfig | undefined {
    if (tracing === undefined || tracing === Tracing.DISABLED) {
      return undefined;
    }

    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
        resources: ["*"],
      }),
    );

    return {
      mode: tracing,
    };
  }
}

/**
 * Given an opaque (token) ARN, returns a TF expression that extracts the function
 * name from the ARN.
 *
 * Function ARNs look like this:
 *
 *   arn:aws:lambda:region:account-id:function:function-name
 *
 * ..which means that in order to extract the `function-name` component from the ARN, we can
 * split the ARN using ":" and select the component in index 6.
 *
 * @returns `element(split(':', arn), 6)`
 */
function extractNameFromArn(arn: string) {
  const { resourceName } = Arn.split(arn, ArnFormat.COLON_RESOURCE_NAME);
  if (!resourceName) {
    throw new Error(`Invalid Lambda function ARN: ${arn}`);
  }
  // if (resourceName.includes(":")) split off the version
  if (resourceName.includes(":")) {
    return resourceName.split(":")[0];
  }
  return resourceName;
}

/**
 * X-Ray Tracing Modes (https://docs.aws.amazon.com/lambda/latest/dg/API_TracingConfig.html)
 */
export enum Tracing {
  /**
   * Lambda will respect any tracing header it receives from an upstream service.
   * If no tracing header is received, Lambda will sample the request based on a fixed rate. Please see the [Using AWS Lambda with AWS X-Ray](https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html) documentation for details on this sampling behavior.
   */
  ACTIVE = "Active",
  /**
   * Lambda will only trace the request from an upstream service
   * if it contains a tracing header with "sampled=1"
   */
  PASS_THROUGH = "PassThrough",
  /**
   * Lambda will not trace any request.
   */
  DISABLED = "Disabled",
}

/**
 * Lambda service will automatically captures system logs about function invocation
 * generated by the Lambda service (known as system logs) and sends these logs to a
 * default CloudWatch log group named after the Lambda function.
 */
export enum SystemLogLevel {
  /**
   * Lambda will capture only logs at info level.
   */
  INFO = "INFO",
  /**
   * Lambda will capture only logs at debug level.
   */
  DEBUG = "DEBUG",
  /**
   * Lambda will capture only logs at warn level.
   */
  WARN = "WARN",
}

/**
 * Lambda service automatically captures logs generated by the function code
 * (known as application logs) and sends these logs to a default CloudWatch
 * log group named after the Lambda function.
 */
export enum ApplicationLogLevel {
  /**
   * Lambda will capture only logs at info level.
   */
  INFO = "INFO",
  /**
   * Lambda will capture only logs at debug level.
   */
  DEBUG = "DEBUG",
  /**
   * Lambda will capture only logs at warn level.
   */
  WARN = "WARN",
  /**
   * Lambda will capture only logs at trace level.
   */
  TRACE = "TRACE",
  /**
   * Lambda will capture only logs at error level.
   */
  ERROR = "ERROR",
  /**
   * Lambda will capture only logs at fatal level.
   */
  FATAL = "FATAL",
}

/**
 * This field takes in 2 values either Text or JSON. By setting this value to Text,
 * will result in the current structure of logs format, whereas, by setting this value to JSON,
 * Lambda will print the logs as Structured JSON Logs, with the corresponding timestamp and log level
 * of each event. Selecting ‘JSON’ format will only allow customer’s to have different log level
 * Application log level and the System log level.
 */
export enum LoggingFormat {
  /**
   * Lambda Logs text format.
   */
  TEXT = "Text",
  /**
   * Lambda structured logging in Json format.
   */
  JSON = "JSON",
}

/**
 * A destination configuration
 */
export interface DlqDestinationConfig {
  /**
   * The Amazon Resource Name (ARN) of the destination resource
   */
  readonly destination: string;
}

/**
 * A DLQ for an event source
 */
export interface IEventSourceDlq {
  /**
   * Returns the DLQ destination config of the DLQ
   */
  bind(
    target: IEventSourceMapping,
    targetHandler: IFunction,
  ): DlqDestinationConfig;
}

export function verifyCodeConfig(code: CodeConfig, props: FunctionProps) {
  // mutually exclusive
  const codeType = [code.inlineCode, code.s3Location, code.image];

  if (codeType.filter((x) => !!x).length !== 1) {
    // throw new UnscopedValidationError(
    throw new Error(
      'lambda.Code must specify exactly one of: "inlineCode", "s3Location", or "image"',
    );
  }

  if (!!code.image === (props.handler !== Handler.FROM_IMAGE)) {
    // throw new UnscopedValidationError(
    throw new Error(
      "handler must be `Handler.FROM_IMAGE` when using image asset for Lambda function",
    );
  }

  if (!!code.image === (props.runtime !== Runtime.FROM_IMAGE)) {
    // throw new UnscopedValidationError(
    throw new Error(
      "runtime must be `Runtime.FROM_IMAGE` when using image asset for Lambda function",
    );
  }

  // if this is inline code, check that the runtime supports
  if (code.inlineCode && !props.runtime.supportsInlineCode) {
    // throw new UnscopedValidationError(
    throw new Error(`Inline source not allowed for ${props.runtime!.name}`);
  }
}

function undefinedIfNoKeys<A extends { [key: string]: unknown }>(
  struct: A,
): A | undefined {
  const allUndefined = Object.values(struct).every((val) => val === undefined);
  return allUndefined ? undefined : struct;
}
