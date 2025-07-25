// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/lib/method.ts

import {
  apiGatewayMethod,
  apiGatewayIntegration,
  apiGatewayMethodResponse,
  apiGatewayIntegrationResponse,
} from "@cdktf/provider-aws";
import { Annotations, TerraformElement } from "cdktf";
import { Construct } from "constructs";
import { ApiGatewayMetrics } from "./apigateway-canned-metrics.generated";
import { validateHttpMethod } from "./apigateway-util";
import { Authorizer, IAuthorizer } from "./authorizer";
import { Deployment } from "./deployment";
import {
  Integration,
  IntegrationConfig,
  IntegrationResponse,
} from "./integration";
import { MockIntegration } from "./integrations/mock";
import { MethodResponse } from "./methodresponse";
import { IModel } from "./model";
import { IRequestValidator, RequestValidatorOptions } from "./requestvalidator";
import { IResource } from "./resource";
import { IRestApi, RestApi, RestApiBase } from "./restapi";
import { IStage } from "./stage";
// import { Fn } from "../../terra-func";
import { ArnFormat } from "../arn";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as cloudwatch from "../cloudwatch";
import * as iam from "../iam";

export interface MethodOptions {
  /**
   * A friendly operation name for the method. For example, you can assign the
   * OperationName of ListPets for the GET /pets method.
   */
  readonly operationName?: string;

  /**
   * Method authorization.
   * If the value is set of `Custom`, an `authorizer` must also be specified.
   *
   * If you're using one of the authorizers that are available via the `Authorizer` class, such as `Authorizer#token()`,
   * it is recommended that this option not be specified. The authorizer will take care of setting the correct authorization type.
   * However, specifying an authorization type using this property that conflicts with what is expected by the `Authorizer`
   * will result in an error.
   *
   * @default - open access unless `authorizer` is specified
   */
  readonly authorizationType?: AuthorizationType;

  /**
   * If `authorizationType` is `Custom`, this specifies the ID of the method
   * authorizer resource.
   * If specified, the value of `authorizationType` must be set to `Custom`
   */
  readonly authorizer?: IAuthorizer;

  /**
   * Indicates whether the method requires clients to submit a valid API key.
   * @default false
   */
  readonly apiKeyRequired?: boolean;

  /**
   * The responses that can be sent to the client who calls the method.
   * @default None
   *
   * This property is not required, but if these are not supplied for a Lambda
   * proxy integration, the Lambda function must return a value of the correct format,
   * for the integration response to be correctly mapped to a response to the client.
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-method-settings-method-response.html
   */
  readonly methodResponses?: MethodResponse[];

  /**
   * The request parameters that API Gateway accepts. Specify request parameters
   * as key-value pairs (string-to-Boolean mapping), with a source as the key and
   * a Boolean as the value. The Boolean specifies whether a parameter is required.
   * A source must match the format method.request.location.name, where the location
   * is querystring, path, or header, and name is a valid, unique parameter name.
   * @default None
   */
  readonly requestParameters?: { [param: string]: boolean };

  /**
   * The models which describe data structure of request payload. When
   * combined with `requestValidator` or `requestValidatorOptions`, the service
   * will validate the API request payload before it reaches the API's Integration (including proxies).
   * Specify `requestModels` as key-value pairs, with a content type
   * (e.g. `'application/json'`) as the key and an API Gateway Model as the value.
   *
   * @example
   *
   *     declare const api: apigateway.RestApi;
   *     declare const userLambda: lambda.Function;
   *
   *     const userModel: apigateway.Model = api.addModel('UserModel', {
   *         schema: {
   *             type: apigateway.JsonSchemaType.OBJECT,
   *             properties: {
   *                 userId: {
   *                     type: apigateway.JsonSchemaType.STRING
   *                 },
   *                 name: {
   *                     type: apigateway.JsonSchemaType.STRING
   *                 }
   *             },
   *             required: ['userId']
   *         }
   *     });
   *     api.root.addResource('user').addMethod('POST',
   *         new apigateway.LambdaIntegration(userLambda), {
   *             requestModels: {
   *                 'application/json': userModel
   *             }
   *         }
   *     );
   *
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-method-settings-method-request.html#setup-method-request-model
   */
  readonly requestModels?: { [param: string]: IModel };

  /**
   * The ID of the associated request validator.
   * Only one of `requestValidator` or `requestValidatorOptions` must be specified.
   * Works together with `requestModels` or `requestParameters` to validate
   * the request before it reaches integration like Lambda Proxy Integration.
   * @default - No default validator
   */
  readonly requestValidator?: IRequestValidator;

  /**
   * A list of authorization scopes configured on the method. The scopes are used with
   * a COGNITO_USER_POOLS authorizer to authorize the method invocation.
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-method.html#cfn-apigateway-method-authorizationscopes
   * @default - no authorization scopes
   */
  readonly authorizationScopes?: string[];

  /**
   * Request validator options to create new validator
   * Only one of `requestValidator` or `requestValidatorOptions` must be specified.
   * Works together with `requestModels` or `requestParameters` to validate
   * the request before it reaches integration like Lambda Proxy Integration.
   * @default - No default validator
   */
  readonly requestValidatorOptions?: RequestValidatorOptions;
}

export interface MethodProps extends AwsConstructProps {
  /**
   * The resource this method is associated with. For root resource methods,
   * specify the `RestApi` object.
   */
  readonly resource: IResource;

  /**
   * The HTTP method ("GET", "POST", "PUT", ...) that clients use to call this method.
   */
  readonly httpMethod: string;

  /**
   * The backend system that the method calls when it receives a request.
   *
   * @default - a new `MockIntegration`.
   */
  readonly integration?: Integration;

  /**
   * Method options.
   *
   * @default - No options.
   */
  readonly options?: MethodOptions;
}

export class Method extends AwsConstructBase {
  public readonly methodId: string;
  public readonly httpMethod: string;
  public readonly resource: IResource;
  /**
   * The API Gateway RestApi associated with this method.
   */
  public readonly api: IRestApi;

  private readonly _deployments = new Array<Deployment>();

  private readonly _methodResponses: MethodResponse[] = [];
  private readonly methodResource: apiGatewayMethod.ApiGatewayMethod;
  private readonly bindResult?: IntegrationConfig;

  public get outputs(): Record<string, any> {
    return {
      methodId: this.methodId,
      httpMethod: this.httpMethod,
      methodArn: this.methodArn,
    };
  }

  constructor(scope: Construct, id: string, props: MethodProps) {
    super(scope, id, props);

    this.resource = props.resource;
    this.api = props.resource.api;
    this.httpMethod = props.httpMethod.toUpperCase();

    validateHttpMethod(this.httpMethod);

    const options = props.options || {};
    const defaultMethodOptions = props.resource.defaultMethodOptions || {};

    const authorizer =
      options.authorizationType === AuthorizationType.NONE &&
      options.authorizer == undefined
        ? undefined
        : options.authorizer || defaultMethodOptions.authorizer;
    const authorizerId = authorizer?.authorizerId
      ? authorizer.authorizerId
      : undefined;

    /**
     * Get and validate authorization type from the values set by API resource and method.
     *
     * REST API Resource
     * └── defaultMethodOptions: Method options to use as a default for all methods created within this API unless custom options are specified.
     *    ├── authorizationType: Specifies the default authorization type unless custom options are specified, recommended to not be specified.
     *    └── authorizer: Specifies the default authorizer for all methods created within this API unless custom options are specified.
     *        └── authorizerType: The default authorization type of this authorizer.
     *
     * REST API Method
     * └── options: Method options.
     *    ├── authorizationType: Specifies the authorization type, recommended to not be specified.
     *    └── authorizer: Specifies an authorizer to use for this method.
     *        └── authorizerType: The authorization type of this authorizer.
     *
     * Authorization type is first set to "authorizer.authorizerType", falling back to method's "authorizationType",
     * falling back to API resource's default "authorizationType", and lastly "Authorizer.NONE".
     *
     * Note that "authorizer.authorizerType" should match method or resource's "authorizationType" if exists.
     */
    const authorizationType = this.getMethodAuthorizationType(
      options,
      defaultMethodOptions,
      authorizer,
    );

    // AuthorizationScope should only be applied to COGNITO_USER_POOLS AuthorizationType.
    const defaultScopes =
      options.authorizationScopes ?? defaultMethodOptions.authorizationScopes;
    const authorizationScopes =
      authorizationType === AuthorizationType.COGNITO
        ? defaultScopes
        : undefined;
    if (authorizationType !== AuthorizationType.COGNITO && defaultScopes) {
      // '@aws-cdk/aws-apigateway:invalidAuthScope'
      Annotations.of(this).addWarning(
        "'AuthorizationScopes' can only be set when 'AuthorizationType' sets 'COGNITO_USER_POOLS'. Default to ignore the values set in 'AuthorizationScopes'.",
      );
    }

    if (Authorizer.isAuthorizer(authorizer)) {
      authorizer._attachToApi(this.api);
    }

    for (const mr of options.methodResponses ??
      defaultMethodOptions.methodResponses ??
      []) {
      this.addMethodResponse(mr);
    }

    const requestValidatorIdValue = this.resolveRequestValidatorId(options);

    const integration =
      props.integration ??
      this.resource.defaultIntegration ??
      new MockIntegration();
    this.bindResult = integration.bind(this);

    const methodProps: apiGatewayMethod.ApiGatewayMethodConfig = {
      restApiId: this.api.restApiId,
      resourceId: props.resource.resourceId,
      httpMethod: this.httpMethod,
      authorization: authorizationType,
      authorizerId,
      apiKeyRequired:
        options.apiKeyRequired ?? defaultMethodOptions.apiKeyRequired,
      operationName:
        options.operationName || defaultMethodOptions.operationName,
      requestParameters:
        options.requestParameters || defaultMethodOptions.requestParameters,
      requestModels: this.renderRequestModels(
        options.requestModels || defaultMethodOptions.requestModels,
      ),
      requestValidatorId: requestValidatorIdValue,
      authorizationScopes: authorizationScopes,
    };

    this.methodResource = new apiGatewayMethod.ApiGatewayMethod(
      this,
      "Resource",
      methodProps,
    );

    this.methodId = this.methodResource.id;
    if (RestApiBase._isRestApiBase(this.api)) {
      this.api._attachMethod(this);
    }

    const deployment = this.api.latestDeployment;
    if (deployment) {
      // for CDKTF we need to track deployments as well for integration dependencies
      this._attachDeployment(deployment);
      deployment.node.addDependency(this.methodResource);
      // Fn.sha1(Fn.jsonencode()) causes nested Tokens and Resolver errors?
      deployment.addToTriggers({
        method: {
          ...methodProps,
          integrationToken: this.bindResult?.deploymentToken,
        },
      });
      // addToLogicalId is CDK specific removalPolicy.RETAIN functionality
      // deployment.addToLogicalId({
      //   method: {
      //     ...methodProps,
      //     integrationToken: bindResult?.deploymentToken,
      //   },
      // });
    }
  }

  /** @internal */
  public _attachDeployment(deployment: Deployment) {
    // these deployments are used in the toTerraform() method
    // to ensure generated integration resources are defined
    // as dependencies on the deployments.
    this._deployments.push(deployment);
  }

  /**
   * The RestApi associated with this Method
   * @deprecated - Throws an error if this Resource is not associated with an instance of `RestApi`. Use `api` instead.
   */
  public get restApi(): RestApi {
    if (!(this.api instanceof RestApi)) {
      throw new Error(
        "not available on Resource not connected to an instance of RestApi",
      );
    }
    return this.api;
  }

  /**
   * Returns an execute-api ARN for this method:
   *
   *   arn:aws:execute-api:{region}:{account}:{restApiId}/{stage}/{method}/{path}
   *
   * NOTE: {stage} will refer to the `restApi.deploymentStage`, which will
   * automatically set if auto-deploy is enabled, or can be explicitly assigned.
   * When not configured, {stage} will be set to '*', as a shorthand for 'all stages'.
   *
   * @attribute
   */
  public get methodArn(): string {
    const stage = this.api.deploymentStage?.stageName;
    return this.api.arnForExecuteApi(
      this.httpMethod,
      pathForArn(this.resource.path),
      stage,
    );
  }

  /**
   * Returns an execute-api ARN for this method's "test-invoke-stage" stage.
   * This stage is used by the AWS Console UI when testing the method.
   */
  public get testMethodArn(): string {
    return this.api.arnForExecuteApi(
      this.httpMethod,
      pathForArn(this.resource.path),
      "test-invoke-stage",
    );
  }

  /**
   * Add a method response to this method
   *
   * If a method response for the same status code already exists, the `responseModels`
   * and `responseParameters` maps will be merged.
   */
  public addMethodResponse(methodResponse: MethodResponse): void {
    // https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/lib/method.ts#L316
    // + fix from https://github.com/aws/aws-cdk/pull/26718/files
    const i = this._methodResponses.findIndex(
      (mr) => mr.statusCode === methodResponse.statusCode,
    );
    if (i >= 0) {
      // Need to do a splice because MethodResponses are immutable
      const existing = this._methodResponses[i];
      this._methodResponses.splice(i, 1, {
        statusCode: methodResponse.statusCode,
        responseModels: mergeDicts(
          existing.responseModels,
          methodResponse.responseModels,
        ),
        responseParameters: mergeDicts(
          existing.responseParameters,
          methodResponse.responseParameters,
        ),
      });
    } else {
      this._methodResponses.push(methodResponse);
    }
  }

  private getMethodAuthorizationType(
    options: MethodOptions,
    defaultMethodOptions: MethodOptions,
    authorizer?: IAuthorizer,
  ): string {
    const authorizerAuthType = authorizer?.authorizationType;
    const optionsAuthType =
      options.authorizationType || defaultMethodOptions.authorizationType;
    const finalAuthType =
      authorizerAuthType || optionsAuthType || AuthorizationType.NONE;

    if (
      authorizerAuthType &&
      optionsAuthType &&
      authorizerAuthType !== optionsAuthType
    ) {
      throw new Error(
        `${this.resource}/${this.httpMethod} - Authorization type is set to ${optionsAuthType} ` +
          `which is different from what is required by the authorizer [${authorizerAuthType}]`,
      );
    }

    return finalAuthType;
  }

  private renderRequestModels(
    requestModels: { [param: string]: IModel } | undefined,
  ): { [param: string]: string } | undefined {
    if (!requestModels) {
      return undefined;
    }

    const models: { [param: string]: string } = {};
    for (const contentType in requestModels) {
      if (requestModels.hasOwnProperty(contentType)) {
        models[contentType] = requestModels[contentType].modelId;
      }
    }
    return models;
  }

  private resolveRequestValidatorId(
    options: MethodOptions,
  ): string | undefined {
    if (options.requestValidator && options.requestValidatorOptions) {
      throw new Error(
        "Only one of 'requestValidator' or 'requestValidatorOptions' must be specified.",
      );
    }

    if (options.requestValidatorOptions) {
      // Assuming APIGATEWAY_REQUEST_VALIDATOR_UNIQUE_ID is effectively true for TerraConstructs
      const id = AwsStack.ofAwsConstruct(this).uniqueResourceName(
        new TerraformElement(this, "Validator"),
        {
          maxLength: 64,
          allowedSpecialCharacters: "-_",
        },
      );
      const validator = (this.api as RestApi).addRequestValidator(
        id,
        options.requestValidatorOptions,
      );
      return validator.requestValidatorId;
    }

    return options.requestValidator?.requestValidatorId;
  }

  public metric(
    metricName: string,
    stage: IStage,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/ApiGateway",
      metricName,
      dimensionsMap: {
        ApiName: this.api.restApiName,
        Method: this.httpMethod,
        Resource: this.resource.path,
        Stage: stage.stageName,
      },
      ...props,
    }).attachTo(this);
  }

  public metricClientError(
    stage: IStage,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics._4XxErrorSum, stage, props);
  }

  public metricServerError(
    stage: IStage,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics._5XxErrorSum, stage, props);
  }

  public metricCacheHitCount(
    stage: IStage,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.cacheHitCountSum, stage, props);
  }

  public metricCacheMissCount(
    stage: IStage,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.cacheMissCountSum, stage, props);
  }

  public metricCount(
    stage: IStage,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.countSum, stage, {
      statistic: "SampleCount",
      ...props,
    });
  }

  public metricIntegrationLatency(
    stage: IStage,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(
      ApiGatewayMetrics.integrationLatencyAverage,
      stage,
      props,
    );
  }

  public metricLatency(
    stage: IStage,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.latencyAverage, stage, props);
  }

  public grantExecute(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["execute-api:Invoke"],
      resourceArns: [this.methodArn],
    });
  }

  private cannedMetric(
    fn: (dims: {
      ApiName: string;
      Method: string;
      Resource: string;
      Stage: string;
    }) => cloudwatch.MetricProps,
    stage: IStage,
    props?: cloudwatch.MetricOptions,
  ) {
    return new cloudwatch.Metric({
      ...fn({
        ApiName: this.api.restApiName,
        Method: this.httpMethod,
        Resource: this.resource.path,
        Stage: stage.stageName,
      }),
      ...props,
    }).attachTo(this);
  }

  /**
   * Adds resource to the terraform JSON output.
   *
   * called by TerraformStack.prepareStack()
   */
  public toTerraform(): any {
    if (this._methodResponses.length === 0 && !this.bindResult) {
      return {};
    }

    // NOTE: The TerraformDependendableAspect will propgate construct tree dependencies
    const methodResponses: Record<
      string,
      apiGatewayMethodResponse.ApiGatewayMethodResponse
    > = {};
    for (let i = 0; i < this._methodResponses.length; i++) {
      const mrProps = this._methodResponses[i];
      // unique id by status code
      const id = `MethodResponse${mrProps.statusCode}`;
      // no re-create if already generated
      const methodResponse = this.node.tryFindChild(id);
      if (methodResponse) {
        methodResponses[mrProps.statusCode] =
          methodResponse as apiGatewayMethodResponse.ApiGatewayMethodResponse;
        continue;
      }

      // generate new ApiGatewayMethodResponse
      methodResponses[mrProps.statusCode] =
        new apiGatewayMethodResponse.ApiGatewayMethodResponse(this, id, {
          restApiId: this.api.restApiId,
          resourceId: this.resource.resourceId,
          httpMethod: this.methodResource.httpMethod,
          statusCode: mrProps.statusCode,
          responseParameters: mrProps.responseParameters,
          responseModels: this.renderResponseModels(mrProps.responseModels),
        });
    }

    // add integration resources
    const integrationId = "Integration";
    if (this.bindResult && !this.node.tryFindChild(integrationId)) {
      const integrationResource =
        new apiGatewayIntegration.ApiGatewayIntegration(
          this,
          integrationId,
          this.renderIntegration(this.bindResult),
        );
      // call node.addDependency on every deployment tracked
      for (const deployment of this._deployments) {
        deployment.node.addDependency(integrationResource);
      }
      // add integration responses (with dependencies on integration)
      this.bindResult.options?.integrationResponses?.forEach((ir) => {
        const irId = `IntegrationResponse${ir.statusCode}`;
        if (this.node.tryFindChild(irId)) return;
        const integrationResponse =
          new apiGatewayIntegrationResponse.ApiGatewayIntegrationResponse(
            this,
            irId,
            this.renderIntegrationResponse(
              integrationResource,
              ir,
              methodResponses,
            ),
          );

        // call node.addDependency on every deployment tracked
        for (const deployment of this._deployments) {
          deployment.node.addDependency(integrationResponse);
        }
      });
    }

    return {};
  }

  private renderResponseModels(
    responseModels: { [contentType: string]: IModel } | undefined,
  ): { [contentType: string]: string } | undefined {
    if (!responseModels) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(responseModels).map(([contentType, rm]) => [
        contentType,
        rm.modelId,
      ]),
    );
  }

  private renderIntegration(
    bindResult: IntegrationConfig,
  ): apiGatewayIntegration.ApiGatewayIntegrationConfig {
    const options = bindResult.options ?? {};
    let credentials: string | undefined;
    if (options.credentialsRole) {
      credentials = options.credentialsRole.roleArn;
    } else if (options.credentialsPassthrough) {
      credentials = AwsStack.ofAwsConstruct(this).formatArn({
        service: "iam",
        region: "",
        account: "*",
        resource: "user",
        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
        resourceName: "*",
      });
    }

    return {
      restApiId: this.api.restApiId,
      resourceId: this.resource.resourceId,
      httpMethod: this.methodResource.httpMethod, // Frontend method's HTTP verb
      type: bindResult.type,
      uri: bindResult.uri,
      integrationHttpMethod: bindResult.integrationHttpMethod, // Backend method's HTTP verb
      cacheKeyParameters: options.cacheKeyParameters,
      cacheNamespace: options.cacheNamespace,
      contentHandling: options.contentHandling,
      requestParameters: options.requestParameters,
      requestTemplates: options.requestTemplates,
      passthroughBehavior: options.passthroughBehavior,
      connectionType: options.connectionType,
      connectionId: options.vpcLink ? options.vpcLink.vpcLinkId : undefined,
      credentials,
      timeoutMilliseconds: options.timeout?.toMilliseconds(),
    };
  }

  private renderIntegrationResponse(
    integration: apiGatewayIntegration.ApiGatewayIntegration,
    ir: IntegrationResponse,
    mr: Record<string, apiGatewayMethodResponse.ApiGatewayMethodResponse>,
  ): apiGatewayIntegrationResponse.ApiGatewayIntegrationResponseConfig {
    const methodResponse = mr[ir.statusCode];
    return {
      restApiId: this.api.restApiId,
      resourceId: this.resource.resourceId,
      httpMethod: this.methodResource.httpMethod,
      // TODO: Is this correct to not create a methodResponse?
      statusCode: methodResponse ? methodResponse.statusCode : ir.statusCode,
      contentHandling: ir.contentHandling,
      responseParameters: ir.responseParameters,
      responseTemplates: ir.responseTemplates,
      selectionPattern: ir.selectionPattern,
      dependsOn: [integration],
    };
  }
}

export enum AuthorizationType {
  NONE = "NONE",
  IAM = "AWS_IAM",
  CUSTOM = "CUSTOM",
  COGNITO = "COGNITO_USER_POOLS",
}

function pathForArn(path: string): string {
  return path.replace(/\{[^\}]*\}/g, "*");
}

function mergeDicts<T>(
  xs?: Record<string, T>,
  ys?: Record<string, T>,
): Record<string, T> | undefined {
  return xs || ys ? Object.assign(xs ?? {}, ys) : undefined;
}
