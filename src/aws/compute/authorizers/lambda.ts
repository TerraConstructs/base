import {
  apiGatewayAuthorizer,
  lambdaFunction,
  lambdaPermission,
} from "@cdktf/provider-aws";
import { Lazy } from "cdktf";
import { Construct } from "constructs";
import * as lambda from "..";
import { Duration } from "../../../duration";
// import { Fn } from "../../../terra-func";
import { ArnFormat } from "../../arn";
import { AwsConstructProps } from "../../aws-construct";
import * as iam from "../../iam";
import { Authorizer, IAuthorizer } from "../authorizer";
import { IRestApi } from "../restapi";

/**
 * Base properties for all lambda authorizers
 */
export interface LambdaAuthorizerProps extends AwsConstructProps {
  /**
   * An optional human friendly name for the authorizer. Note that, this is not the primary identifier of the authorizer.
   *
   * @default - the unique construct ID (friendlyName)
   */
  readonly authorizerName?: string;

  /**
   * The handler for the authorizer lambda function.
   */
  readonly handler: lambda.IFunction;

  /**
   * How long APIGateway should cache the results. Max 1 hour.
   * Disable caching by setting this to 0.
   *
   * @default - Duration.minutes(5)
   */
  readonly resultsCacheTtl?: Duration;

  /**
   * An optional IAM role for APIGateway to assume before calling the Lambda-based authorizer. The IAM role must be
   * assumable by 'apigateway.amazonaws.com'.
   *
   * @default - A resource policy is added to the Lambda function allowing apigateway.amazonaws.com to invoke the function.
   */
  readonly assumeRole?: iam.IRole;
}

abstract class LambdaAuthorizer extends Authorizer implements IAuthorizer {
  /**
   * The id of the authorizer.
   * @attribute
   */
  public abstract readonly authorizerId: string;

  /**
   * The ARN of the authorizer to be used in permission policies, such as IAM and resource-based grants.
   */
  public abstract readonly authorizerArn: string;

  /**
   * The Lambda function handler that this authorizer uses.
   */
  protected readonly handler: lambda.IFunction;

  /**
   * The IAM role that the API Gateway service assumes while invoking the Lambda function.
   */
  protected readonly role?: iam.IRole;

  protected restApiId?: string;
  protected abstract readonly authorizerProps: apiGatewayAuthorizer.ApiGatewayAuthorizerConfig;

  protected constructor(
    scope: Construct,
    id: string,
    props: LambdaAuthorizerProps,
  ) {
    super(scope, id, props);

    this.handler = props.handler;
    this.role = props.assumeRole;

    if (props.resultsCacheTtl && props.resultsCacheTtl.toSeconds() > 3600) {
      // TODO: Use ValidationError from core/lib/errors
      throw new Error(
        `Lambda authorizer property 'resultsCacheTtl' must not be greater than 3600 seconds (1 hour). (${scope.node.path})`,
      );
    }
  }

  /**
   * Attaches this authorizer to a specific REST API.
   * @internal
   */
  public _attachToApi(restApi: IRestApi) {
    if (this.restApiId && this.restApiId !== restApi.restApiId) {
      // TODO: Use ValidationError from core/lib/errors
      throw new Error(
        `Cannot attach authorizer to two different rest APIs. (${this.node.path})`,
      );
    }
    this.restApiId = restApi.restApiId;
    const deployment = restApi.latestDeployment;
    // const addToLogicalId = FeatureFlags.of(this).isEnabled(
    //   APIGATEWAY_AUTHORIZER_CHANGE_DEPLOYMENT_LOGICAL_ID,
    // );

    if (deployment) {
      // && addToLogicalId) {
      let functionName;

      if (this.handler instanceof lambda.LambdaFunction) {
        // if not imported, attempt to get the function name, which
        // may be a token
        functionName = (
          this.handler.node.defaultChild as lambdaFunction.LambdaFunction
        ).functionNameInput;
      } else {
        // if imported, the function name will be a token (TODO: Confirm)
        functionName = this.handler.functionName;
      }

      deployment.node.addDependency(this);
      // CDKTF handles deployment updates based on resource changes implicitly or via explicit triggers.
      deployment.addToTriggers({
        // TODO: Fn.sha1(Fn.jsonencode()) causes nested Tokens and Resolver errors?
        authorizer: this.authorizerProps,
        authorizerToken: functionName,
      });
      // The addToLogicalId part is CDK/CFN specific for logical ID stability.
      // deployment.addToLogicalId({
      //   authorizer: this.authorizerProps,
      //   authorizerToken: functionName,
      // });
    }
  }

  /**
   * Sets up the permissions necessary for the API Gateway service to invoke the Lambda function.
   */
  protected setupPermissions() {
    if (!this.role) {
      this.addDefaultPermissionRole();
    } else if (this.role instanceof iam.Role) {
      // Check if it's a concrete Role instance that we can attach policies to
      this.addLambdaInvokePermission(this.role);
    }
  }

  private addDefaultPermissionRole(): void {
    new lambdaPermission.LambdaPermission(this, `Permissions`, {
      functionName: this.handler.functionName,
      action: "lambda:InvokeFunction",
      principal: "apigateway.amazonaws.com",
      sourceArn: this.authorizerArn,
    });
  }

  private addLambdaInvokePermission(role: iam.Role): void {
    role.attachInlinePolicy(
      new iam.Policy(this, "authorizerInvokePolicy", {
        statements: [
          new iam.PolicyStatement({
            resources: this.handler.resourceArnsForGrantInvoke,
            actions: ["lambda:InvokeFunction"],
          }),
        ],
      }),
    );
  }

  protected lazyRestApiId() {
    return Lazy.stringValue({
      produce: () => {
        if (!this.restApiId) {
          // TODO: Use UnscopedValidationError from core/lib/errors
          throw new Error(
            `Authorizer (${this.node.path}) must be attached to a RestApi`,
          );
        }
        return this.restApiId;
      },
    });
  }
}

/**
 * Properties for TokenAuthorizer
 */
export interface TokenAuthorizerProps extends LambdaAuthorizerProps {
  /**
   * An optional regex to be matched against the authorization token. When matched the authorizer lambda is invoked,
   * otherwise a 401 Unauthorized is returned to the client.
   *
   * @default - no regex filter will be applied.
   */
  readonly validationRegex?: string;

  /**
   * The request header mapping expression for the bearer token. This is typically passed as part of the header, in which case
   * this should be `method.request.header.Authorizer` where `Authorizer` is the header containing the bearer token.
   *
   * @see https://docs.aws.amazon.com/apigateway/latest/api/API_CreateAuthorizer.html#apigw-CreateAuthorizer-request-identitySource
   * @default `method.request.header.Authorization`
   */
  readonly identitySource?: string;
}

/**
 * Token based lambda authorizer that recognizes the caller's identity as a bearer token,
 * such as a JSON Web Token (JWT) or an OAuth token.
 * Based on the token, authorization is performed by a lambda function.
 *
 * @resource aws_api_gateway_authorizer
 */
export class TokenAuthorizer extends LambdaAuthorizer {
  public readonly authorizerId: string;
  public readonly authorizerArn: string;
  private readonly resource: apiGatewayAuthorizer.ApiGatewayAuthorizer;
  protected readonly authorizerProps: apiGatewayAuthorizer.ApiGatewayAuthorizerConfig;

  constructor(scope: Construct, id: string, props: TokenAuthorizerProps) {
    super(scope, id, props);

    const restApiId = this.lazyRestApiId();
    const authorizerName =
      props.authorizerName ?? this.stack.uniqueResourceName(this);
    this.authorizerProps = {
      name: authorizerName,
      restApiId: restApiId,
      type: "TOKEN",
      identityValidationExpression: props.validationRegex,
      authorizerUri: lambdaAuthorizerArn(props.handler),
      authorizerCredentials: props.assumeRole?.roleArn,
      authorizerResultTtlInSeconds:
        props.resultsCacheTtl?.toSeconds() ?? Duration.minutes(5).toSeconds(),
      identitySource:
        props.identitySource ?? "method.request.header.Authorization",
    };

    this.resource = new apiGatewayAuthorizer.ApiGatewayAuthorizer(
      this,
      "Resource",
      this.authorizerProps,
    );

    this.authorizerId = this.resource.id;
    this.authorizerArn = this.stack.formatArn({
      service: "execute-api",
      resource: restApiId,
      resourceName: `authorizers/${this.authorizerId}`,
    });

    this.setupPermissions();
  }

  get outputs(): Record<string, any> {
    return {
      authorizerId: this.authorizerId,
      authorizerArn: this.authorizerArn,
    };
  }
}

/**
 * Properties for RequestAuthorizer
 */
export interface RequestAuthorizerProps extends LambdaAuthorizerProps {
  /**
   * An array of request header mapping expressions for identities. Supported parameter types are
   * Header, Query String, Stage Variable, and Context. For instance, extracting an authorization
   * token from a header would use the identity source `method.request.header.Authorization`.
   *
   * Note: API Gateway uses the specified identity sources as the request authorizer caching key. When caching is
   * enabled, API Gateway calls the authorizer's Lambda function only after successfully verifying that all the
   * specified identity sources are present at runtime. If a specified identify source is missing, null, or empty,
   * API Gateway returns a 401 Unauthorized response without calling the authorizer Lambda function.
   *
   * @see https://docs.aws.amazon.com/apigateway/latest/api/API_CreateAuthorizer.html#apigw-CreateAuthorizer-request-identitySource
   */
  readonly identitySources: string[];
}

/**
 * Request-based lambda authorizer that recognizes the caller's identity via request parameters,
 * such as headers, paths, query strings, stage variables, or context variables.
 * Based on the request, authorization is performed by a lambda function.
 *
 * @resource aws_api_gateway_authorizer
 */
export class RequestAuthorizer extends LambdaAuthorizer {
  public readonly authorizerId: string;
  public readonly authorizerArn: string;
  private readonly resource: apiGatewayAuthorizer.ApiGatewayAuthorizer;
  protected readonly authorizerProps: apiGatewayAuthorizer.ApiGatewayAuthorizerConfig;

  constructor(scope: Construct, id: string, props: RequestAuthorizerProps) {
    super(scope, id, props);

    if (
      (props.resultsCacheTtl === undefined ||
        props.resultsCacheTtl.toSeconds() !== 0) &&
      props.identitySources.length === 0
    ) {
      // TODO: Use ValidationError from core/lib/errors
      throw new Error(
        "At least one Identity Source is required for a REQUEST-based Lambda authorizer if caching is enabled.",
      );
    }

    const restApiId = this.lazyRestApiId();
    const authorizerName =
      props.authorizerName ?? this.stack.uniqueResourceName(this);
    this.authorizerProps = {
      name: authorizerName,
      restApiId: restApiId,
      type: "REQUEST",
      authorizerUri: lambdaAuthorizerArn(props.handler),
      authorizerCredentials: props.assumeRole?.roleArn,
      authorizerResultTtlInSeconds:
        props.resultsCacheTtl?.toSeconds() ?? Duration.minutes(5).toSeconds(),
      identitySource:
        props.identitySources.length !== 0
          ? props.identitySources.map((is) => is.toString()).join(",")
          : undefined,
    };

    this.resource = new apiGatewayAuthorizer.ApiGatewayAuthorizer(
      this,
      "Resource",
      this.authorizerProps,
    );

    this.authorizerId = this.resource.id;
    this.authorizerArn = this.stack.formatArn({
      service: "execute-api",
      resource: restApiId, // This will be a token
      resourceName: `authorizers/${this.authorizerId}`,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });

    this.setupPermissions();
  }
  get outputs(): Record<string, any> {
    return {
      authorizerId: this.authorizerId,
      authorizerArn: this.authorizerArn,
    };
  }
}

/**
 * constructs the authorizerURIArn.
 */
function lambdaAuthorizerArn(handler: lambda.IFunction): string {
  return handler.functionInvokeArn;

  // The following code is commented out because it was moved to the imported LambdaFunction class.
  // const { region, partition } = Arn.split(
  //   handler.functionArn,
  //   ArnFormat.COLON_RESOURCE_NAME,
  // );
  // return `arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${handler.functionArn}/invocations`;
}
