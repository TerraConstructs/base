// source: https://github.com/cdktf-plus/cdktf-plus/blob/586aabad3ab2fb2a2e93e05ed33f94474ebe9397/packages/%40cdktf-plus/aws/lib/aws-lambda-function/index.ts\
// update to align with https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-lambda/lib/function-base.ts
import * as crypto from "crypto";
import { lambdaPermission } from "@cdktf/provider-aws";
import { IResolvable, Annotations, Token } from "cdktf";
import { Node } from "constructs";
import { ArnFormat } from "../arn";
import { AwsConstructBase, IAwsConstruct } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import { Architecture } from "./architecture";
import {
  EventInvokeConfig,
  EventInvokeConfigOptions,
} from "./event-invoke-config";
import {
  EventSourceMapping,
  EventSourceMappingOptions,
} from "./event-source-mapping";
import { Permission } from "./function-permission";
import {
  FunctionUrlOptions,
  FunctionUrl,
  FunctionUrlAuthType,
} from "./function-url";
import * as iam from "../iam";

// TODO: re-add ec2.IConnectable?

/**
 * Represents a Lambda function defined outside of this stack.
 */
export interface FunctionAttributes {
  /**
   * The ARN of the Lambda function.
   *
   * Format: arn:<partition>:lambda:<region>:<account-id>:function:<function-name>
   */
  readonly functionArn: string;

  /**
   * The IAM execution role associated with this function.
   *
   * If the role is not specified, any role-related operations will no-op.
   */
  readonly role?: iam.IRole;

  /**
   * The security group of this Lambda, if in a VPC.
   *
   * This needs to be given in order to support allowing connections
   * to this Lambda.
   */
  readonly securityGroup?: string | IResolvable; // TODO: Re-add support for EC2 security groups

  /**
   * Setting this property informs the CDK that the imported function is in the same environment as the stack.
   * This affects certain behaviours such as, whether this function's permission can be modified.
   * When not configured, the CDK attempts to auto-determine this. For environment agnostic stacks, i.e., stacks
   * where the account is not specified with the `env` property, this is determined to be false.
   *
   * Set this to property *ONLY IF* the imported function is in the same account as the stack
   * it's imported in.
   * @default - depends: true, if the Stack is configured with an explicit `env` (account and region) and the account is the same as this function.
   * For environment-agnostic stacks this will default to `false`.
   */
  readonly sameEnvironment?: boolean;

  /**
   * Setting this property informs the TerraConstruct that the imported function ALREADY HAS the necessary permissions
   * for what you are trying to do. When not configured, E.T, attempts to auto-determine whether or not
   * additional permissions are necessary on the function when grant APIs are used. If TerraConstruct tried to add
   * permissions on an imported lambda, it will fail.
   *
   * Set this property *ONLY IF* you are committing to manage the imported function's permissions outside of
   * this TerraConstruct stack. You are acknowledging that your TerraConstruct code alone will have insufficient permissions to access the
   * imported function.
   *
   * @default false
   */
  readonly skipPermissions?: boolean;

  /**
   * The architecture of this Lambda Function (this is an optional attribute and defaults to X86_64).
   * @default - Architecture.X86_64
   */
  readonly architecture?: Architecture;
}

/**
 * A Lambda function.
 */
export interface IFunction extends IAwsConstruct, iam.IGrantable {
  /**
   * The name of the function.
   *
   * @attribute
   */
  readonly functionName: string;

  /**
   * The ARN of the function.
   *
   * @attribute
   */
  readonly functionArn: string;

  /**
   * The IAM role associated with this function.
   */
  readonly role?: iam.IRole;

  /**
   * The construct node where permissions are attached.
   */
  readonly permissionsNode: Node;

  /**
   * The system architectures compatible with this lambda function.
   */
  readonly architecture: Architecture;

  /**
   * Adds an event source that maps to this AWS Lambda function.
   * @param id construct ID
   * @param options mapping options
   */
  addEventSourceMapping(
    id: string,
    options: EventSourceMappingOptions,
  ): EventSourceMapping;

  /**
   * Adds an event source to this function.
   *
   * The following example adds an SQS Queue as an event source:
   * ```
   * import { compute } from 'terraconstructs';
   * myFunction.addEventSource(new compute.SqsEventSource(myQueue));
   * ```
   */
  addEventSource(source: IEventSource): void;

  /**
   * Adds a permission to the Lambda resource policy.
   * @param id The id for the permission construct
   * @param permission The permission to grant to this Lambda function. @see Permission for details.
   */
  addPermission(id: string, permission: Permission): void;

  /**
   * Adds a statement to the IAM role assumed by the instance.
   */
  addToRolePolicy(statement: iam.PolicyStatement): void;

  /**
   * Grant the given identity permissions to invoke this Lambda
   */
  grantInvoke(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant the given identity permissions to invoke the $LATEST version or
   * unqualified version of this Lambda
   */
  grantInvokeLatestVersion(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant the given identity permissions to invoke the given (or latest) version of this Lambda
   */
  grantInvokeVersion(identity: iam.IGrantable, version: string): iam.Grant;

  /**
   * Grant the given identity permissions to invoke this Lambda Function URL
   */
  grantInvokeUrl(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant multiple principals the ability to invoke this Lambda via CompositePrincipal
   */
  grantInvokeCompositePrincipal(
    compositePrincipal: iam.CompositePrincipal,
  ): iam.Grant[];

  /**
   * Configures options for asynchronous invocation.
   */
  configureAsyncInvoke(options: EventInvokeConfigOptions): void;

  /**
   * Adds a url to this lambda function.
   */
  addFunctionUrl(options?: FunctionUrlOptions): FunctionUrl;
}

export abstract class LambdaFunctionBase
  extends AwsConstructBase
  implements IFunction
{
  /**
   * The name of the function.
   */
  public abstract readonly functionName: string;

  /**
   * The principal this Lambda Function is running as
   */
  public abstract readonly grantPrincipal: iam.IPrincipal;

  /**
   * The ARN fo the function.
   *
   * Should include version (if versioning is enabled via publish = true)
   */
  public abstract readonly functionArn: string;

  /**
   * Latest published version of your Lambda Function.
   *
   * Used as qualifier of the version or alias of this function.
   * A qualifier is the identifier that's appended to a version or alias ARN.
   * @see https://docs.aws.amazon.com/lambda/latest/dg/API_GetFunctionConfiguration.html#API_GetFunctionConfiguration_RequestParameters
   */
  public abstract readonly version: string;

  /**
   * The qualifier of the version or alias of this function.
   * A qualifier is the identifier that's appended to a version or alias ARN.
   * @see https://docs.aws.amazon.com/lambda/latest/dg/API_GetFunctionConfiguration.html#API_GetFunctionConfiguration_RequestParameters
   */

  /**
   * The IAM role associated with this function.
   *
   * Undefined if the function was imported without a role.
   */
  public abstract readonly role?: iam.IRole;

  /**
   * The construct node where permissions are attached.
   */
  public abstract readonly permissionsNode: Node;

  /**
   * The architecture of this Lambda Function.
   */
  public abstract readonly architecture: Architecture;

  /**
   * Whether the addPermission() call adds any permissions
   *
   * True for new Lambdas, false for version $LATEST and imported Lambdas
   * from different accounts.
   */
  protected abstract readonly canCreatePermissions: boolean;

  /**
   * The ARN(s) to put into the resource field of the generated IAM policy for grantInvoke()
   */
  public abstract readonly resourceArnsForGrantInvoke: string[];

  /**
   * Whether the user decides to skip adding permissions.
   * The only use case is for cross-account, imported lambdas
   * where the user commits to modifying the permisssions
   * on the imported lambda outside this TerraConstruct Spec.
   * @internal
   */
  protected readonly _skipPermissions?: boolean;

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

  /**
   * Adds a permission to the Lambda resource policy.
   * @param id The id for the permission construct
   * @param permission The permission to grant to this Lambda function. @see Permission for details.
   */
  public addPermission(id: string, permission: Permission) {
    if (!this.canCreatePermissions) {
      if (!this._skipPermissions) {
        // TODO: revise this annotation
        // Unclear Lambda Environment
        Annotations.of(this).addWarning(
          [
            `addPermission() has no effect on a Lambda Function with region=${this.env.region}, account=${this.env.account},`,
            `in a Stack with region=${AwsStack.ofAwsConstruct(this).region}, account=${AwsStack.ofAwsConstruct(this).account}.`,
            `Suppress this warning if this is is intentional, or pass sameEnvironment=true to fromFunctionAttributes()`,
            `if you would like to add the permissions.`,
          ].join(" "),
        );
      }
      return;
    }

    let principal = this.parsePermissionPrincipal(permission.principal);

    let { sourceArn, sourceAccount, principalOrgID } =
      this.validateConditionCombinations(permission.principal) ?? {};

    const action = permission.action ?? "lambda:InvokeFunction";
    const scope = permission.scope ?? this;

    /**
     * Do invokeFunction lambdas with unqualified function references apply to TF?
     * A warning should be added to functions under the following conditions:
     * - permissions that include `lambda:InvokeFunction` are added to the unqualified function.
     * - function.currentVersion is invoked before or after the permission is created.
     *
     * This applies only to permissions on Lambda functions, not versions or aliases.
     * This function is overridden as a noOp for QualifiedFunctionBase.
     * https://github.com/aws/aws-cdk/blob/v2.160.0/packages/aws-cdk-lib/aws-lambda/lib/function-base.ts#L332
     */
    // [
    //   "AWS Lambda has changed their authorization strategy, which may cause client invocations using the 'Qualifier' parameter of the lambda function to fail with Access Denied errors.",
    //   "If you are using a lambda Version or Alias, make sure to call 'grantInvoke' or 'addPermission' on the Version or Alias, not the underlying Function",
    //   'See: https://github.com/aws/aws-cdk/issues/19273',
    // ].join('\n'));

    new lambdaPermission.LambdaPermission(scope, id, {
      action,
      principal,
      // qualifier: permission.qualifier,
      functionName: this.functionArn,
      eventSourceToken: permission.eventSourceToken,
      sourceAccount: permission.sourceAccount ?? sourceAccount,
      sourceArn: permission.sourceArn ?? sourceArn,
      principalOrgId: permission.organizationId ?? principalOrgID,
      functionUrlAuthType: permission.functionUrlAuthType,
    });
  }

  /**
   * Adds a statement to the IAM role assumed by the instance.
   */
  public addToRolePolicy(statement: iam.PolicyStatement) {
    if (!this.role) {
      return;
    }

    this.role.addToPrincipalPolicy(statement);
  }

  public addEventSourceMapping(
    id: string,
    options: EventSourceMappingOptions,
  ): EventSourceMapping {
    return new EventSourceMapping(this, id, {
      target: this,
      ...options,
    });
  }

  /**
   * Grant the given identity permissions to invoke this Lambda
   */
  public grantInvoke(grantee: iam.IGrantable): iam.Grant {
    const hash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          principal: grantee.grantPrincipal.toString(),
          conditions: grantee.grantPrincipal.policyFragment.conditions,
        }),
        "utf8",
      )
      .digest("base64");
    const identifier = `Invoke${hash}`;

    // Memoize the result so subsequent grantInvoke() calls are idempotent
    let grant = this._invocationGrants[identifier];
    if (!grant) {
      grant = this.grant(
        grantee,
        identifier,
        "lambda:InvokeFunction",
        this.resourceArnsForGrantInvoke,
      );
      this._invocationGrants[identifier] = grant;
    }
    return grant;
  }

  /**
   * Grant the given identity permissions to invoke the $LATEST version or
   * unqualified version of this Lambda
   */
  public grantInvokeLatestVersion(grantee: iam.IGrantable): iam.Grant {
    return this.grantInvokeVersion(grantee, this.version);
  }

  /**
   * Grant the given identity permissions to invoke the given version of this Lambda
   */
  public grantInvokeVersion(
    grantee: iam.IGrantable,
    version: string,
  ): iam.Grant {
    let grant: iam.Grant;
    if (Token.isUnresolved(version)) {
      // Identifier is set to "InvokeLatest"??
      return this.grantInvoke(grantee);
    }
    // else, use version string in hash?
    const hash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          principal: grantee.grantPrincipal.toString(),
          conditions: grantee.grantPrincipal.policyFragment.conditions,
          version: version,
        }),
        "utf8",
      )
      .digest("base64");
    const identifier = `Invoke${hash}`;

    // Memoize the result so subsequent grantInvoke() calls are idempotent
    grant = this._invocationGrants[identifier];
    if (!grant) {
      let resouceArns = [`${this.functionArn}:${version}`];
      if (version == this.version) {
        resouceArns.push(this.functionArn);
      }
      grant = this.grant(
        grantee,
        identifier,
        "lambda:InvokeFunction",
        resouceArns,
      );
      this._invocationGrants[identifier] = grant;
    }
    return grant;
  }

  /**
   * Grant the given identity permissions to invoke this Lambda Function URL
   */
  public grantInvokeUrl(grantee: iam.IGrantable): iam.Grant {
    const identifier = `InvokeFunctionUrl${grantee.grantPrincipal}`; // calls the .toString() of the principal

    // Memoize the result so subsequent grantInvoke() calls are idempotent
    let grant = this._functionUrlInvocationGrants[identifier];
    if (!grant) {
      grant = this.grant(
        grantee,
        identifier,
        "lambda:InvokeFunctionUrl",
        [this.functionArn],
        {
          functionUrlAuthType: FunctionUrlAuthType.AWS_IAM,
        },
      );
      this._functionUrlInvocationGrants[identifier] = grant;
    }
    return grant;
  }

  /**
   * Grant multiple principals the ability to invoke this Lambda via CompositePrincipal
   */
  public grantInvokeCompositePrincipal(
    compositePrincipal: iam.CompositePrincipal,
  ): iam.Grant[] {
    return compositePrincipal.principals.map((principal) =>
      this.grantInvoke(principal),
    );
  }

  public addEventSource(source: IEventSource) {
    source.bind(this);
  }

  public configureAsyncInvoke(options: EventInvokeConfigOptions): void {
    if (this.node.tryFindChild("EventInvokeConfig") !== undefined) {
      throw new Error(
        `An EventInvokeConfig has already been configured for the function at ${this.node.path}`,
      );
    }

    new EventInvokeConfig(this, "EventInvokeConfig", {
      function: this,
      ...options,
    });
  }

  /**
   * A function URL is a dedicated HTTP(S) endpoint for a Lambda function.
   */
  public addFunctionUrl(options?: FunctionUrlOptions): FunctionUrl {
    if (this.node.tryFindChild("FunctionUrl") !== undefined) {
      throw new Error(
        `A FunctionUrl has already been configured for the function at ${this.node.path}`,
      );
    }
    return new FunctionUrl(this, "FunctionUrl", {
      function: this,
      ...options,
    });
  }

  /**
   * Returns the construct tree node that corresponds to the lambda function.
   * For use internally for constructs, when the tree is set up in non-standard ways. Ex: SingletonFunction.
   * @internal
   */
  protected _functionNode(): Node {
    return this.node;
  }

  /**
   * Given the function arn, check if the account id matches this account
   *
   * Function ARNs look like this:
   *
   *   arn:aws:lambda:region:account-id:function:function-name
   *
   * ..which means that in order to extract the `account-id` component from the ARN, we can
   * split the ARN using ":" and select the component in index 4.
   *
   * @returns true if account id of function matches the account specified on the stack, false otherwise.
   *
   * @internal
   */
  protected _isStackAccount(): boolean {
    if (
      Token.isUnresolved(this.stack.account) ||
      Token.isUnresolved(this.functionArn)
    ) {
      return false;
    }
    return (
      this.stack.splitArn(this.functionArn, ArnFormat.SLASH_RESOURCE_NAME)
        .account === this.stack.account
    );
  }

  private grant(
    grantee: iam.IGrantable,
    identifier: string,
    action: string,
    resourceArns: string[],
    permissionOverrides?: Partial<Permission>,
  ): iam.Grant {
    const grant = iam.Grant.addToPrincipalOrResource({
      grantee,
      actions: [action],
      resourceArns,

      // Fake resource-like object on which to call addToResourcePolicy(), which actually
      // calls addPermission()
      resource: {
        addToResourcePolicy: (_statement) => {
          // Couldn't add permissions to the principal, so add them locally.
          this.addPermission(identifier, {
            principal: grantee.grantPrincipal!,
            action: action,
            ...permissionOverrides,
          });

          const permissionNode = this._functionNode().tryFindChild(identifier);
          if (!permissionNode && !this._skipPermissions) {
            throw new Error(
              "Cannot modify permission to lambda function. Function is either imported or $LATEST version.\n" +
                "If the function is imported from the same account use `fromFunctionAttributes()` API with the `sameEnvironment` flag.\n" +
                "If the function is imported from a different account and already has the correct permissions use `fromFunctionAttributes()` API with the `skipPermissions` flag.",
            );
          }
          return { statementAdded: true, policyDependable: permissionNode };
        },
        node: this.node,
        stack: this.stack,
        env: this.env,
        environmentName: this.environmentName,
        gridUUID: this.gridUUID,
        outputs: {},
      },
    });

    return grant;
  }

  /**
   * Translate IPrincipal to something we can pass to aws_lambda_permission
   * https://docs.aws.amazon.com/lambda/latest/api/API_AddPermission.html#lambda-AddPermission-request-Principal
   * https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/lambda_permission#principal
   *
   * Do some nasty things because `Permission` supports a subset of what the
   * full IAM principal language supports, and we may not be able to parse strings
   * outright because they may be tokens.
   *
   * Try to recognize some specific Principal classes first, then try a generic
   * fallback.
   */
  private parsePermissionPrincipal(
    principal: iam.IPrincipal | { readonly wrapped: iam.IPrincipal },
  ) {
    // Try some specific common classes first.
    // use duck-typing, not instance of
    if ("wrapped" in principal) {
      // eslint-disable-next-line dot-notation
      principal = principal["wrapped"];
    }

    if ("accountId" in principal) {
      return (principal as iam.AccountPrincipal).accountId;
    }

    if ("service" in principal) {
      return (principal as iam.ServicePrincipal).service;
    }

    if ("arn" in principal) {
      return (principal as iam.ArnPrincipal).arn;
    }

    const stringEquals = matchSingleCondition(
      "StringEquals",
      principal.policyFragment.conditions,
    );
    if (
      stringEquals &&
      stringEquals.length === 1 &&
      stringEquals[0].variable === "aws:PrincipalOrgID"
    ) {
      // we will move the organization id to the `principalOrgId` property of `Permissions`.
      return "*";
    }

    // Try a best-effort approach to support simple principals that are not any of the predefined
    // classes, but are simple enough that they will fit into the Lambda Permission model.
    // Main target here: imported Roles, Users, Groups.
    //
    // The principal cannot have conditions and must have a single { AWS: [arn] } entry.
    const principals = principal.policyFragment.principals.filter(
      (p) => p.type === "AWS",
    );
    if (
      principal.policyFragment.conditions.length === 0 &&
      principals.length === 1
    ) {
      if (principals[0].identifiers.length === 1) {
        return principals[0].identifiers[0];
      }
    }

    throw new Error(
      `Invalid principal type for Lambda permission statement: ${principal.constructor.name}. ` +
        "Supported: AccountPrincipal, ArnPrincipal, ServicePrincipal, OrganizationPrincipal",
    );

    /**
     * Returns the conditions for a certain test if it exists and if there are no other conditions. Otherwise,
     * returns undefined.
     */
    function matchSingleCondition(
      test: string,
      obj: iam.Conditions,
    ): iam.Conditions | undefined {
      if (obj.length !== 1) {
        return undefined;
      }

      return obj.filter((c) => c.test === test);
    }
  }

  private validateConditionCombinations(principal: iam.IPrincipal):
    | {
        sourceArn: string | undefined;
        sourceAccount: string | undefined;
        principalOrgID: string | undefined;
      }
    | undefined {
    const conditions = this.validateConditions(principal);

    if (!conditions) {
      return undefined;
    }

    // TODO: what if more than 1 identifier? Should any of these throw?
    const sourcArnConditions = conditions.filter(
      (c) => c.test === "ArnLike" && c.variable === "aws:SourceArn",
    );
    const sourceArn =
      sourcArnConditions.length > 0
        ? sourcArnConditions[0].values[0]
        : undefined;
    // requireString(
    //   requireObject(conditions.ArnLike)?.["aws:SourceArn"],
    // );
    const sourceAccountConditions = conditions.filter(
      (c) => c.test === "StringEquals" && c.variable === "aws:SourceAccount",
    );
    const sourceAccount =
      sourceAccountConditions.length > 0
        ? sourceAccountConditions[0].values[0]
        : undefined;
    // requireString(
    //   requireObject(conditions.StringEquals)?.["aws:SourceAccount"],
    // );
    const principalOrgIDConditions = conditions.filter(
      (c) => c.test === "StringEquals" && c.variable === "aws:PrincipalOrgID",
    );
    const principalOrgID =
      principalOrgIDConditions.length > 0
        ? principalOrgIDConditions[0].values[0]
        : undefined;
    // requireString(
    //   requireObject(conditions.StringEquals)?.["aws:PrincipalOrgID"],
    // );

    // PrincipalOrgID cannot be combined with any other conditions
    if (principalOrgID && (sourceArn || sourceAccount)) {
      throw new Error(
        "PrincipalWithConditions had unsupported condition combinations for Lambda permission statement: principalOrgID cannot be set with other conditions.",
      );
    }

    return {
      sourceArn,
      sourceAccount,
      principalOrgID,
    };
  }

  private validateConditions(
    principal: iam.IPrincipal,
  ): iam.Conditions | undefined {
    if (this.isPrincipalWithConditions(principal)) {
      const conditions = principal.policyFragment.conditions;
      // These are all the supported conditions. Some combinations are not supported,
      // like only 'aws:SourceArn' or 'aws:PrincipalOrgID' and 'aws:SourceAccount'.
      // These will be validated through `this.validateConditionCombinations`.
      const supportedPrincipalConditions = [
        {
          test: "ArnLike",
          variable: "aws:SourceArn",
        },
        {
          test: "StringEquals",
          variable: "aws:SourceAccount",
        },
        {
          test: "StringEquals",
          variable: "aws:PrincipalOrgID",
        },
      ];

      const unsupportedConditions = conditions.filter(
        (condition) =>
          !supportedPrincipalConditions.some(
            (supportedCondition) =>
              supportedCondition.test === condition.test &&
              supportedCondition.variable === condition.variable,
          ),
      );

      if (unsupportedConditions.length == 0) {
        return conditions;
      } else {
        throw new Error(
          `PrincipalWithConditions had unsupported conditions for Lambda permission statement: ${JSON.stringify(unsupportedConditions)}. ` +
            `Supported operator/condition pairs: ${JSON.stringify(supportedPrincipalConditions)}`,
        );
      }
    }

    return undefined;
  }

  private isPrincipalWithConditions(principal: iam.IPrincipal): boolean {
    return principal.policyFragment.conditions.length > 0;
  }
}

export abstract class QualifiedFunctionBase extends LambdaFunctionBase {
  /** The underlying `IFunction` */
  public abstract readonly lambda: IFunction; // TODO: Verify publish is set to true?

  public readonly permissionsNode = this.node;

  public get resourceArnsForGrantInvoke() {
    return [this.functionArn];
  }

  public configureAsyncInvoke(options: EventInvokeConfigOptions): void {
    if (this.node.tryFindChild("EventInvokeConfig") !== undefined) {
      throw new Error(
        `An EventInvokeConfig has already been configured for the qualified function at ${this.node.path}`,
      );
    }

    new EventInvokeConfig(this, "EventInvokeConfig", {
      function: this.lambda,
      qualifier: this.version,
      ...options,
    });
  }
}

/**
 * An abstract class which represents an AWS Lambda event source.
 */
export interface IEventSource {
  /**
   * Called by `lambda.addEventSource` to allow the event source to bind to this
   * function.
   *
   * @param target That lambda function to bind to.
   */
  bind(target: IFunction): void;
}
