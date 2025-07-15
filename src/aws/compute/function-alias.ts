import { lambdaAlias, dataAwsLambdaAlias } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { Architecture } from "./architecture";
import { EventInvokeConfigOptions } from "./event-invoke-config";
import { IFunction, QualifiedFunctionBase } from "./function-base";
// import { ScalableFunctionAttribute } from "./private/scalable-function-attribute";
// import {
//   AutoScalingOptions,
//   IScalableFunctionAttribute,
// } from "./scalable-attribute-api";
// import { ArnFormat } from "../";

/**
 * Outputs that can be exposed through the grid
 */
export interface AliasOutputs {
  /**
   * The Amazon Resource Name (ARN) identifying your Lambda function alias.
   */
  readonly name: string;

  /**
   * The ARN to be used for invoking Lambda Function from API Gateway - to be used in `aws_api_gateway_integration`'s uri
   */
  readonly invokeArn: string;
}

export interface IAlias extends IFunction {
  /** strongly typed aliasOutputs */
  readonly aliasOutputs: AliasOutputs;

  /**
   * Name of this alias.
   *
   * @attribute
   */
  readonly aliasName: string;

  /**
   * The underlying Lambda function
   */
  readonly lambda: IFunction;

  /**
   * The underlying Lambda function version.
   */
  readonly version: string;
}

/**
 * Options for `lambda.Alias`.
 */
export interface AliasOptions extends EventInvokeConfigOptions {
  /**
   * Description for the alias
   *
   * @default No description
   */
  readonly description?: string;

  /**
   * Additional versions with individual weights this alias points to
   *
   * Individual additional version weights specified here should add up to
   * (less than) one. All remaining weight is routed to the default
   * version.
   *
   * For example, the config is
   *
   *    version: "1"
   *    additionalVersions: [{ version: "2", weight: 0.05 }]
   *
   * Then 5% of traffic will be routed to function version 2, while
   * the remaining 95% of traffic will be routed to function version 1.
   *
   * @default No additional versions
   */
  readonly additionalVersions?: VersionWeight[];

  // TODO: re-add support for provisioned concurrency
  // /**
  //  * Specifies a provisioned concurrency configuration for a function's alias.
  //  *
  //  * @default No provisioned concurrency
  //  */
  // readonly provisionedConcurrentExecutions?: number;
}

/**
 * Properties for a new Lambda alias
 */
export interface AliasProps extends AliasOptions {
  /**
   * Name of this alias
   *
   * Minimum length of 1. Maximum length of 128.
   * Pattern: (?!^[0-9]+$)([a-zA-Z0-9-_]+)
   *
   */
  readonly aliasName: string;

  /**
   * Function this alias refers to
   */
  readonly function: IFunction;

  /**
   * Function version this alias refers to
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/lambda_alias#function_version LambdaAlias#function_version}
   * pattern (\$LATEST|[0-9]+)
   */
  readonly version: string;
}

export interface AliasAttributes {
  readonly aliasName: string;
  readonly function: IFunction;
}

/**
 * A new alias to a particular version of a Lambda function.
 */
export class Alias extends QualifiedFunctionBase implements IAlias {
  public static fromAliasAttributes(
    scope: Construct,
    id: string,
    attrs: AliasAttributes,
  ): IAlias {
    class Imported extends QualifiedFunctionBase implements IAlias {
      public readonly resource: dataAwsLambdaAlias.DataAwsLambdaAlias;
      public readonly aliasName = attrs.aliasName;
      /**
       * Lambda function version which the alias uses.
       */
      public get version() {
        return this.resource.functionVersion;
      }
      public get functionQualifiedInvokeArn() {
        return this.resource.invokeArn;
      }
      public readonly lambda = attrs.function;
      public readonly functionArn = `${attrs.function.functionArn}:${attrs.aliasName}`;
      public readonly functionName = `${attrs.function.functionName}:${attrs.aliasName}`;
      public readonly grantPrincipal = attrs.function.grantPrincipal;
      public readonly role = attrs.function.role;
      public readonly architecture = attrs.function.architecture;

      public get aliasOutputs(): AliasOutputs {
        return {
          name: attrs.aliasName,
          invokeArn: this.resource.invokeArn,
        };
      }
      public get outputs() {
        return this.aliasOutputs;
      }
      protected readonly canCreatePermissions = this._isStackAccount();
      protected readonly qualifier = attrs.aliasName;
      constructor(s: Construct, i: string) {
        super(s, i);
        this.resource = new dataAwsLambdaAlias.DataAwsLambdaAlias(
          this,
          "Resource",
          {
            name: this.aliasName,
            functionName: attrs.function.functionName,
          },
        );
      }
    }

    return new Imported(scope, id);
  }

  public readonly resource: lambdaAlias.LambdaAlias;
  private readonly _aliasOutputs: AliasOutputs;
  public get aliasOutputs(): AliasOutputs {
    return this._aliasOutputs;
  }
  public get outputs(): Record<string, any> {
    return this._aliasOutputs;
  }

  /**
   * Name of this alias.
   *
   * @attribute
   */
  public readonly aliasName: string;

  /**
   * Name of this alias
   *
   * Used to be able to use Alias in place of a regular Lambda. Lambda accepts
   * ARNs everywhere it accepts function names.
   */
  public readonly functionName: string;

  public readonly lambda: IFunction;

  public readonly architecture: Architecture;

  public readonly version: string;

  /**
   * ARN of this alias
   *
   * Used to be able to use Alias in place of a regular Lambda. Lambda accepts
   * ARNs everywhere it accepts function names.
   */
  public readonly functionArn: string;

  public get functionQualifiedInvokeArn() {
    return this.resource.invokeArn;
  }

  protected readonly qualifier: string;

  protected readonly canCreatePermissions: boolean = true;

  // // TODO: Re-Add scalable functions
  // private scalableAlias?: ScalableFunctionAttribute;
  // private readonly scalingRole: iam.IRole;

  constructor(scope: Construct, id: string, props: AliasProps) {
    super(scope, id, props);

    this.lambda = props.function;
    // TODO: Does it make sense to just prefix aliasName with GridUUID?
    // should use this.stack.uniqueResourceName instead?
    this.aliasName = `${this.gridUUID}-${props.aliasName}`;
    this.version = props.version;
    this.architecture = this.lambda.architecture;

    this.resource = new lambdaAlias.LambdaAlias(this, "Resource", {
      name: this.aliasName,
      description: props.description,
      functionName: this.lambda.functionName,
      functionVersion: props.version,
      routingConfig: this.determineRoutingConfig(props),
    });

    // TODO: Add aws_lambda_provisioned_concurrency_config

    // // Use a Service Linked Role
    // // https://docs.aws.amazon.com/autoscaling/application/userguide/application-auto-scaling-service-linked-roles.html
    // this.scalingRole = iam.Role.fromRoleArn(
    //   this,
    //   "ScalingRole",
    //   this.stack.formatArn({
    //     service: "iam",
    //     region: "",
    //     resource:
    //       "role/aws-service-role/lambda.application-autoscaling.amazonaws.com",
    //     resourceName:
    //       "AWSServiceRoleForApplicationAutoScaling_LambdaConcurrency",
    //   }),
    // );

    // includes qualifier
    this.functionArn = this.resource.invokeArn;

    // this.getResourceArnAttribute(alias.ref, {
    //   service: "lambda",
    //   resource: "function",
    //   resourceName: `${this.lambda.functionName}:${this.aliasName}`,
    //   arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    // });

    this.qualifier = this.aliasName;

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

    // ARN parsing splits on `:`, so we can only get the function's name from the ARN as resourceName...
    // And we're parsing it out (instead of using the underlying function directly) in order to have use of it incur
    // an implicit dependency on the resource.

    //`${this.stack.splitArn(this.functionArn, ArnFormat.COLON_RESOURCE_NAME).resourceName!}:${this.aliasName}`;
    this.functionName = this.resource.functionName;
    this._aliasOutputs = {
      invokeArn: this.resource.invokeArn,
      name: this.aliasName,
    };
  }

  public get grantPrincipal() {
    return this.lambda.grantPrincipal;
  }

  public get role() {
    return this.lambda.role;
  }

  // /**
  //  * Configure provisioned concurrency autoscaling on a function alias. Returns a scalable attribute that can call
  //  * `scaleOnUtilization()` and `scaleOnSchedule()`.
  //  *
  //  * @param options Autoscaling options
  //  */
  // public addAutoScaling(
  //   options: AutoScalingOptions,
  // ): IScalableFunctionAttribute {
  //   if (this.scalableAlias) {
  //     throw new Error("AutoScaling already enabled for this alias");
  //   }
  //   return (this.scalableAlias = new ScalableFunctionAttribute(
  //     this,
  //     "AliasScaling",
  //     {
  //       minCapacity: options.minCapacity ?? 1,
  //       maxCapacity: options.maxCapacity,
  //       resourceId: `function:${this.functionName}`,
  //       dimension: "lambda:function:ProvisionedConcurrency",
  //       serviceNamespace: appscaling.ServiceNamespace.LAMBDA,
  //       role: this.scalingRole,
  //     },
  //   ));
  // }

  /**
   * Calculate the routingConfig parameter from the input props
   */
  private determineRoutingConfig(
    props: AliasProps,
  ): lambdaAlias.LambdaAliasRoutingConfig | undefined {
    if (!props.additionalVersions || props.additionalVersions.length === 0) {
      return undefined;
    }

    let total = 0;
    const additionalVersionWeights: { [key: string]: number } = {};
    for (const vw of props.additionalVersions) {
      if (vw.weight < 0 || vw.weight > 1) {
        throw new Error(
          `Additional version weight must be between 0 and 1, got: ${vw.weight}`,
        );
      }
      total += vw.weight;
      additionalVersionWeights[vw.version] = vw.weight;
    }
    if (total > 1) {
      throw new Error(
        `Sum of additional version weights must not exceed 1, got: ${total}`,
      );
    }

    return {
      additionalVersionWeights,
    };
  }

  // /**
  //  * Validate that the provisionedConcurrentExecutions makes sense
  //  *
  //  * Member must have value greater than or equal to 1
  //  */
  // private determineProvisionedConcurrency(
  //   props: AliasProps,
  // ):
  //   | lambdaAlias.LambdaAlias.ProvisionedConcurrencyConfigurationProperty
  //   | undefined {
  //   if (!props.provisionedConcurrentExecutions) {
  //     return undefined;
  //   }

  //   if (props.provisionedConcurrentExecutions <= 0) {
  //     throw new Error(
  //       "provisionedConcurrentExecutions must have value greater than or equal to 1",
  //     );
  //   }

  //   return {
  //     provisionedConcurrentExecutions: props.provisionedConcurrentExecutions,
  //   };
  // }
}

/**
 * A version/weight pair for routing traffic to Lambda functions
 */
export interface VersionWeight {
  /**
   * The version to route traffic to
   */
  readonly version: string;

  /**
   * How much weight to assign to this version (0..1)
   */
  readonly weight: number;
}
