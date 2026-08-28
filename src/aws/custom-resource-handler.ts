// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-s3/lib/notifications-resource/notifications-resource-handler.ts
import { Construct } from "constructs";
import { AwsConstructBase, AwsConstructProps } from "./aws-construct";
import { AwsStack } from "./aws-stack";
import * as compute from "./compute";
import * as iam from "./iam";
import { Duration } from "../duration";

/**
 * Construction properties for `CustomResourceHandler`.
 */
export interface CustomResourceHandlerProps extends AwsConstructProps {
  /**
   * The source code of the handler Lambda function.
   */
  readonly code: compute.Code;

  /**
   * The runtime environment for the handler Lambda function.
   */
  readonly runtime: compute.Runtime;

  /**
   * The name of the method within the handler code that is called.
   *
   * @default "index.handler"
   */
  readonly handler?: string;

  /**
   * The function execution time after which the handler is terminated.
   *
   * @default Duration.minutes(5)
   */
  readonly timeout?: Duration;

  /**
   * The IAM role assumed by the handler Lambda function.
   *
   * @default - a new role is created with the basic Lambda execution
   * managed policy attached.
   */
  readonly role?: iam.IRole;

  /**
   * A description of the handler Lambda function.
   *
   * @default - no description
   */
  readonly description?: string;

  /**
   * Environment variables passed to the handler Lambda function.
   *
   * @default - no environment variables
   */
  readonly environment?: { [key: string]: string };
}

/**
 * A stack-singleton Lambda function backing one or more `CustomResource`s.
 *
 * Construct library authors that need a custom-resource handler should call
 * `CustomResourceHandler.getOrCreate` under a well-known construct id so that
 * every custom resource in the stack that needs the same handler shares one
 * Lambda function, instead of each provisioning its own.
 *
 * Unlike AWS CDK's `CustomResourceProviderBase`/`custom-resources` provider
 * framework, this does not implement an `onEvent`/`isComplete` async state
 * machine: Terraform applies are synchronous, so a plain Lambda function
 * invoked by `cfncompat_custom_resource` is sufficient.
 */
export class CustomResourceHandler extends AwsConstructBase {
  /**
   * Returns the singleton Lambda function used by a custom resource type in
   * the given stack, creating it under `uniqueId` on first use.
   *
   * @param scope the construct requesting the handler
   * @param uniqueId well-known construct id shared by every caller that
   * wants to reuse the same handler
   * @param props handler configuration, used only if the handler does not
   * already exist in this stack
   */
  public static getOrCreate(
    scope: Construct,
    uniqueId: string,
    props: CustomResourceHandlerProps,
  ): CustomResourceHandler {
    const stack = AwsStack.ofAwsConstruct(scope);
    const existing = stack.node.tryFindChild(uniqueId);
    if (existing) {
      return existing as CustomResourceHandler;
    }
    return new CustomResourceHandler(stack, uniqueId, props);
  }

  /**
   * The IAM role assumed by the handler Lambda function.
   */
  public readonly role: iam.IRole;

  /**
   * The underlying Lambda function.
   */
  public readonly lambdaFunction: compute.LambdaFunction;

  /**
   * The ARN of the handler Lambda function. Use as
   * `CustomResourceProps.serviceToken`.
   */
  public get functionArn(): string {
    return this.lambdaFunction.functionArn;
  }

  constructor(scope: Construct, id: string, props: CustomResourceHandlerProps) {
    super(scope, id, props);

    this.lambdaFunction = new compute.LambdaFunction(this, "Handler", {
      code: props.code,
      runtime: props.runtime,
      handler: props.handler ?? "index.handler",
      timeout: props.timeout ?? Duration.minutes(5),
      role: props.role,
      description: props.description,
      environment: props.environment,
    });
    // LambdaFunction always assigns a role, either the one supplied in props
    // or a newly created one with the basic Lambda execution managed policy.
    this.role = this.lambdaFunction.role!;
  }

  public get outputs(): Record<string, any> {
    return this.lambdaFunction.outputs;
  }

  /**
   * Adds a statement to the IAM role assumed by the handler.
   */
  public addToRolePolicy(statement: iam.PolicyStatement): void {
    this.lambdaFunction.addToRolePolicy(statement);
  }
}
