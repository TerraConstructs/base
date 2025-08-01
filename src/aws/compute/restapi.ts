import {
  apiGatewayAccount,
  apiGatewayRestApi,
  apiGatewayRestApiPolicy,
} from "@cdktf/provider-aws";
import { Lazy, Token } from "cdktf";
import { Construct } from "constructs";
import { ApiDefinition } from "./api-definition";
import { ApiKey, ApiKeyOptions, IApiKey } from "./api-key";
import { ApiGatewayMetrics } from "./apigateway-canned-metrics.generated";
import { CorsOptions } from "./cors";
import { Deployment } from "./deployment";
import { DomainName, DomainNameOptions } from "./domain-name";
import { GatewayResponse, GatewayResponseOptions } from "./gateway-response";
import { Integration } from "./integration";
import { Method, MethodOptions } from "./method";
import { Model, ModelOptions } from "./model";
import { RequestValidator, RequestValidatorOptions } from "./requestvalidator";
import { IResource, ResourceBase, ResourceOptions } from "./resource";
import { Stage, StageOptions } from "./stage";
import { Size } from "../../size";
import { ArnFormat } from "../arn";
import { UsagePlan, UsagePlanProps } from "./usage-plan";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as cloudwatch from "../cloudwatch";
import * as ec2 from "../compute";
import * as iam from "../iam";

const RESTAPI_SYMBOL = Symbol.for(
  "terraconstructs/lib/aws/compute.RestApiBase",
);
const APIGATEWAY_RESTAPI_SYMBOL = Symbol.for(
  "terraconstructs/lib/aws/compute.RestApi",
);

export interface IRestApi extends iam.IAwsConstructWithPolicy {
  /**
   * The ID of this API Gateway RestApi.
   * @attribute
   */
  readonly restApiId: string;

  /**
   * The name of this API Gateway RestApi.
   * @attribute
   */
  readonly restApiName: string;

  /**
   * The resource ID of the root resource.
   * @attribute
   */
  readonly restApiRootResourceId: string;

  /**
   * API Gateway deployment that represents the latest changes of the API.
   * This resource will be automatically updated every time the REST API model changes.
   * `undefined` when no deployment is configured.
   */
  readonly latestDeployment?: Deployment;

  /**
   * API Gateway stage that points to the latest deployment (if defined).
   */
  deploymentStage: Stage;

  /**
   * Represents the root resource ("/") of this API. Use it to define the API model:
   *
   *    api.root.addMethod('ANY', redirectToHomePage); // "ANY /"
   *    api.root.addResource('friends').addMethod('GET', getFriendsHandler); // "GET /friends"
   *
   */
  readonly root: IResource;

  /**
   * Gets the "execute-api" ARN
   * @returns The "execute-api" ARN.
   * @default "*" returns the execute API ARN for all methods/resources in
   * this API.
   * @param method The method (default `*`)
   * @param path The resource path. Must start with '/' (default `*`)
   * @param stage The stage (default `*`)
   */
  arnForExecuteApi(method?: string, path?: string, stage?: string): string;
}

/**
 * Represents the props that all Rest APIs share
 */
export interface RestApiBaseProps extends AwsConstructProps {
  /**
   * Indicates if a Deployment should be automatically created for this API,
   * and recreated when the API model (resources, methods) changes.
   *
   * Since API Gateway deployments are immutable, When this option is enabled
   * (by default), an AWS::ApiGateway::Deployment resource will automatically
   * created with a logical ID that hashes the API model (methods, resources
   * and options). This means that when the model changes, the logical ID of
   * this CloudFormation resource will change, and a new deployment will be
   * created.
   *
   * If this is set, `latestDeployment` will refer to the `Deployment` object
   * and `deploymentStage` will refer to a `Stage` that points to this
   * deployment. To customize the stage options, use the `deployOptions`
   * property.
   *
   * A CloudFormation Output will also be defined with the root URL endpoint
   * of this REST API.
   *
   * @default true
   */
  readonly deploy?: boolean;

  /**
   * Options for the API Gateway stage that will always point to the latest
   * deployment when `deploy` is enabled. If `deploy` is disabled,
   * this value cannot be set.
   *
   * @default - Based on defaults of `StageOptions`.
   */
  readonly deployOptions?: StageOptions;

  // TODO: Implement RemovalPolicy.RETAIN through removed block in Terraform.
  // /**
  //  * Retains old deployment resources when the API changes. This allows
  //  * manually reverting stages to point to old deployments via the AWS
  //  * Console.
  //  *
  //  * @default false
  //  */
  // readonly retainDeployments?: boolean;

  /**
   * A name for the API Gateway RestApi resource.
   *
   * @default - ID of the RestApi construct.
   */
  readonly restApiName?: string;

  /**
   * Custom header parameters for the request.
   * @see https://docs.aws.amazon.com/cli/latest/reference/apigateway/import-rest-api.html
   *
   * @default - No parameters.
   */
  readonly parameters?: { [key: string]: string };

  /**
   * A policy document that contains the permissions for this RestApi
   *
   * @default - No policy.
   */
  readonly policy?: iam.PolicyDocument;

  /**
   * Indicates whether to roll back the resource if a warning occurs while API
   * Gateway is creating the RestApi resource.
   *
   * @default false
   */
  readonly failOnWarnings?: boolean;

  /**
   * Configure a custom domain name and map it to this API.
   *
   * @default - no domain name is defined, use `addDomainName` or directly define a `DomainName`.
   */
  readonly domainName?: DomainNameOptions;

  /**
   * Automatically configure an AWS CloudWatch role for API Gateway.
   *
   * @default true
   */
  readonly cloudWatchRole?: boolean;

  // cloudWatchRoleRemovalPolicy is not directly applicable in Terraform as it manages DeletionPolicy.
  // Terraform's `prevent_destroy` in `lifecycle` can be used for similar effect on the role.

  // Terraform outputs don't have direct exportName like CFN
  // /**
  //  * Export name for the TerraformOutput containing the API endpoint
  //  *
  //  * @default - when no export name is given, output will be created without export
  //  */
  // readonly endpointExportName?: string;

  /**
   * A list of the endpoint types of the API. Use this property when creating
   * an API.
   *
   * @default EndpointType.EDGE
   */
  readonly endpointTypes?: EndpointType[];

  /**
   * The EndpointConfiguration property type specifies the endpoint types of a REST API
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-apigateway-restapi-endpointconfiguration.html
   *
   * @default EndpointType.EDGE
   */
  readonly endpointConfiguration?: EndpointConfiguration;

  /**
   * Specifies whether clients can invoke the API using the default execute-api
   * endpoint. To require that clients use a custom domain name to invoke the
   * API, disable the default endpoint.
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-restapi.html
   *
   * @default false
   */
  readonly disableExecuteApiEndpoint?: boolean;

  /**
   * A description of the RestApi construct.
   *
   * @default - 'Automatically created by the RestApi construct'
   */
  readonly description?: string;
}

/**
 * Props to create a new instance of RestApi
 */
export interface RestApiProps extends RestApiBaseProps, ResourceOptions {
  /**
   * The list of binary media mime-types that are supported by the RestApi
   * resource, such as "image/png" or "application/octet-stream"
   *
   * @default - RestApi supports only UTF-8-encoded text payloads.
   */
  readonly binaryMediaTypes?: string[];

  /**
   * A Size(in bytes, kibibytes, mebibytes etc) that is used to enable compression (with non-negative
   * between 0 and 10485760 (10M) bytes, inclusive) or disable compression
   * (when undefined) on an API. When compression is enabled, compression or
   * decompression is not applied on the payload if the payload size is
   * smaller than this value. Setting it to zero allows compression for any
   * payload size.
   *
   * @default - Compression is disabled.
   */
  readonly minCompressionSize?: Size;

  // cloneFrom is not supported by aws_api_gateway_rest_api in Terraform.
  // readonly cloneFrom?: IRestApi;

  /**
   * The source of the API key for metering requests according to a usage
   * plan.
   *
   * @default - Metering is disabled.
   */
  readonly apiKeySourceType?: ApiKeySourceType;
}

/**
 * Props to instantiate a new SpecRestApi
 */
export interface SpecRestApiProps extends RestApiBaseProps {
  /**
   * An OpenAPI definition compatible with API Gateway.
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-import-api.html
   */
  readonly apiDefinition: ApiDefinition;

  /**
   * A Size(in bytes, kibibytes, mebibytes etc) that is used to enable compression (with non-negative
   * between 0 and 10485760 (10M) bytes, inclusive) or disable compression
   * (when undefined) on an API. When compression is enabled, compression or
   * decompression is not applied on the payload if the payload size is
   * smaller than this value. Setting it to zero allows compression for any
   * payload size.
   *
   * @default - Compression is disabled.
   */
  readonly minCompressionSize?: Size;
}

/**
 * Base implementation that are common to various implementations of IRestApi
 */
export abstract class RestApiBase
  extends AwsConstructBase
  implements IRestApi, iam.IAwsConstructWithPolicy
{
  /**
   * Checks if the given object is an instance of RestApiBase.
   * @internal
   */
  public static _isRestApiBase(x: any): x is RestApiBase {
    return x !== null && typeof x === "object" && RESTAPI_SYMBOL in x;
  }

  /**
   * API Gateway deployment that represents the latest changes of the API.
   * This resource will be automatically updated every time the REST API model changes.
   * This will be undefined if `deploy` is false.
   */
  public get latestDeployment() {
    return this._latestDeployment;
  }

  /**
   * The first domain name mapped to this API, if defined through the `domainName`
   * configuration prop, or added via `addDomainName`
   */
  public get domainName() {
    return this._domainName;
  }

  /**
   * The deployed root URL of this REST API.
   */
  public get url() {
    return this.urlForPath();
  }

  /**
   * The ID of this API Gateway RestApi.
   */
  public abstract readonly restApiId: string;

  /**
   * The resource ID of the root resource.
   *
   * @attribute
   */
  public abstract readonly restApiRootResourceId: string;

  /**
   * Represents the root resource of this API endpoint ('/').
   * Resources and Methods are added to this resource.
   */
  public abstract readonly root: IResource;

  /**
   * API Gateway stage that points to the latest deployment (if defined).
   *
   * If `deploy` is disabled, you will need to explicitly assign this value in order to
   * set up integrations.
   */
  public deploymentStage!: Stage;

  /**
   * A human friendly name for this Rest API. Note that this is different from `restApiId`.
   * @attribute
   */
  public readonly restApiName: string;

  private _latestDeployment?: Deployment;
  private _domainName?: DomainName;
  private _allowedVpcEndpoints: Set<ec2.IVpcEndpoint> = new Set();

  protected cloudWatchAccount?: apiGatewayAccount.ApiGatewayAccount;
  protected internalPolicy?: iam.PolicyDocument;
  protected policyAttachment?: apiGatewayRestApiPolicy.ApiGatewayRestApiPolicy;

  constructor(scope: Construct, id: string, props: RestApiBaseProps = {}) {
    super(scope, id, props);
    this.restApiName = props.restApiName ?? this.stack.uniqueResourceName(this);

    Object.defineProperty(this, RESTAPI_SYMBOL, { value: true });
  }

  public abstract addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult;

  /**
   * Returns the URL for an HTTP path.
   *
   * Fails if `deploymentStage` is not set either by `deploy` or explicitly.
   */
  public urlForPath(path: string = "/"): string {
    if (!this.deploymentStage) {
      // TODO throw new ValidationError(
      throw new Error(
        'Cannot determine deployment stage for API from "deploymentStage". Use "deploy" or explicitly set "deploymentStage"',
      );
    }
    return this.deploymentStage.urlForPath(path);
  }

  /**
   * Defines an API Gateway domain name and maps it to this API.
   * @param id The construct id
   * @param options custom domain options
   */
  public addDomainName(id: string, options: DomainNameOptions): DomainName {
    const domainName = new DomainName(this, id, {
      ...options,
      mapping: this,
    });
    if (!this._domainName) {
      this._domainName = domainName;
    }
    return domainName;
  }

  /**
   * Adds a usage plan.
   */
  public addUsagePlan(id: string, props: UsagePlanProps = {}): UsagePlan {
    return new UsagePlan(this, id, props);
  }

  public arnForExecuteApi(
    method: string = "*",
    path: string = "/*",
    stage: string = "*",
  ) {
    if (!Token.isUnresolved(path) && !path.startsWith("/")) {
      throw new Error(`"path" must begin with a "/": '${path}'`);
    }

    if (method.toUpperCase() === "ANY") {
      method = "*";
    }

    return AwsStack.ofAwsConstruct(this).formatArn({
      service: "execute-api",
      resource: this.restApiId,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      resourceName: `${stage}/${method}${path}`,
    });
  }

  /**
   * Adds a new gateway response.
   */
  public addGatewayResponse(
    id: string,
    options: GatewayResponseOptions,
  ): GatewayResponse {
    return new GatewayResponse(this, id, {
      restApi: this,
      ...options,
    });
  }

  /**
   * Add an ApiKey to the deploymentStage
   */
  public addApiKey(id: string, options?: ApiKeyOptions): IApiKey {
    if (!this.deploymentStage) {
      throw new Error(
        "Cannot add API key without a deployment stage. Enable `deploy` or set `deploymentStage`",
      );
    }
    return new ApiKey(this, id, {
      stages: [this.deploymentStage],
      ...options,
    });
  }

  /**
   * Add a resource policy that only allows API execution from a VPC Endpoint to create a private API.
   *
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-resource-policies-examples.html#apigateway-resource-policies-source-vpc-example
   *
   * @param vpcEndpoints the interface VPC endpoints to grant access to
   */
  public grantInvokeFromVpcEndpointsOnly(
    vpcEndpoints: ec2.IVpcEndpoint[],
  ): void {
    vpcEndpoints.forEach((endpoint) => this._allowedVpcEndpoints.add(endpoint));

    const endpoints = Lazy.listValue({
      produce: () => {
        return Array.from(this._allowedVpcEndpoints).map(
          (endpoint) => endpoint.vpcEndpointId,
        );
      },
    });

    this.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.AnyPrincipal()],
        actions: ["execute-api:Invoke"],
        resources: ["execute-api:/*"],
        effect: iam.Effect.DENY,
        condition: [
          {
            test: "StringNotEquals",
            variable: "aws:SourceVpce",
            values: endpoints,
          },
        ],
      }),
    );
    this.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.AnyPrincipal()],
        actions: ["execute-api:Invoke"],
        resources: ["execute-api:/*"],
        effect: iam.Effect.ALLOW,
      }),
    );
  }

  /**
   * Returns the given named metric for this API
   */
  public metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/ApiGateway",
      metricName,
      dimensionsMap: { ApiName: this.restApiName },
      ...props,
    }).attachTo(this);
  }

  /**
   * Metric for the number of client-side errors captured in a given period.
   *
   * Default: sum over 5 minutes
   */
  public metricClientError(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics._4XxErrorSum, props);
  }

  /**
   * Metric for the number of server-side errors captured in a given period.
   *
   * Default: sum over 5 minutes
   */
  public metricServerError(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics._5XxErrorSum, props);
  }

  /**
   * Metric for the number of requests served from the API cache in a given period.
   *
   * Default: sum over 5 minutes
   */
  public metricCacheHitCount(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.cacheHitCountSum, props);
  }

  /**
   * Metric for the number of requests served from the backend in a given period,
   * when API caching is enabled.
   *
   * Default: sum over 5 minutes
   */
  public metricCacheMissCount(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.cacheMissCountSum, props);
  }

  /**
   * Metric for the total number API requests in a given period.
   *
   * Default: sample count over 5 minutes
   */
  public metricCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.countSum, {
      statistic: "SampleCount",
      ...props,
    });
  }

  /**
   * Metric for the time between when API Gateway relays a request to the backend
   * and when it receives a response from the backend.
   *
   * Default: average over 5 minutes.
   */
  public metricIntegrationLatency(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(
      ApiGatewayMetrics.integrationLatencyAverage,
      props,
    );
  }

  /**
   * The time between when API Gateway receives a request from a client
   * and when it returns a response to the client.
   * The latency includes the integration latency and other API Gateway overhead.
   *
   * Default: average over 5 minutes.
   */
  public metricLatency(props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.latencyAverage, props);
  }

  /**
   * Internal API used by `Method` to keep an inventory of methods at the API
   * level for validation purposes.
   *
   * @internal
   */
  public _attachMethod(_method: Method) {
    // This method is used in the CDK to manage dependencies for deployments.
    // In TerraConstructs, this might be handled differently, e.g., by passing method ARNs to deployment triggers.
  }

  /**
   * Associates a Deployment resource with this REST API.
   *
   * @internal
   */
  public _attachDeployment(_deployment: Deployment) {
    // Similar to _attachMethod, for managing deployment dependencies.
  }

  /**
   * Associates a Stage with this REST API
   *
   * @internal
   */
  public _attachStage(stage: Stage) {
    if (this.cloudWatchAccount) {
      stage.node.addDependency(this.cloudWatchAccount);
    }
  }

  /**
   * @internal
   */
  protected _configureCloudWatchRole(
    apiResource: apiGatewayRestApi.ApiGatewayRestApi,
    cloudWatchRoleEnabled?: boolean,
    // cloudWatchRoleRemovalPolicy?: RemovalPolicy, // RemovalPolicy is a CDK concept
  ) {
    // Default to true, as APIGATEWAY_DISABLE_CLOUDWATCH_ROLE feature flag is not available here.
    const shouldCreateRole = cloudWatchRoleEnabled ?? true;
    if (!shouldCreateRole) {
      return;
    }

    const role = new iam.Role(this, "CloudWatchRole", {
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          this,
          "AmazonAPIGatewayPushToCloudWatchLogs",
          "service-role/AmazonAPIGatewayPushToCloudWatchLogs",
        ),
      ],
    });
    // role.applyRemovalPolicy(cloudWatchRoleRemovalPolicy); // Handled by Terraform lifecycle if needed

    this.cloudWatchAccount = new apiGatewayAccount.ApiGatewayAccount(
      this,
      "Account",
      {
        cloudwatchRoleArn: role.roleArn,
      },
    );
    // this.cloudWatchAccount.applyRemovalPolicy(cloudWatchRoleRemovalPolicy); // Handled by Terraform lifecycle

    this.cloudWatchAccount.node.addDependency(apiResource);
  }

  /**
   * @internal
   */
  protected _configureDeployment(props: RestApiBaseProps) {
    const deploy = props.deploy ?? true;
    if (deploy) {
      this._latestDeployment = new Deployment(this, "Deployment", {
        description:
          props.deployOptions?.description ??
          props.description ??
          "Automatically created by the RestApi construct",
        api: this,
        // TODO: Implement RemovalPolicy.RETAIN through removed block in Terraform.
        // retainDeployments: props.retainDeployments,
        // In Terraform, triggers are used to manage redeployment.
        // A hash of the API definition or relevant parts would go here.
        // For simplicity, a placeholder or a dependency on the API resource itself might be used.
        // triggers: { redeploy = "" },
      });

      const stageName =
        (props.deployOptions && props.deployOptions.stageName) || "prod";

      this.deploymentStage = new Stage(this, `DeploymentStage.${stageName}`, {
        deployment: this._latestDeployment,
        ...props.deployOptions,
      });
    } else {
      if (props.deployOptions) {
        throw new Error("Cannot set 'deployOptions' if 'deploy' is disabled");
      }
    }
  }

  /**
   * @internal
   */
  protected _configureEndpoints(
    props: RestApiBaseProps,
  ): apiGatewayRestApi.ApiGatewayRestApiEndpointConfiguration | undefined {
    if (props.endpointTypes && props.endpointConfiguration) {
      // TODO: throw new ValidationError(
      throw new Error(
        "Only one of the RestApi props, endpointTypes or endpointConfiguration, is allowed",
      );
    }
    if (props.endpointConfiguration) {
      return {
        types: props.endpointConfiguration.types,
        vpcEndpointIds: props.endpointConfiguration?.vpcEndpoints?.map(
          (vpcEndpoint) => vpcEndpoint.vpcEndpointId,
        ),
      };
    }
    if (props.endpointTypes) {
      return { types: props.endpointTypes };
    }
    return undefined;
  }

  private cannedMetric(
    fn: (dims: { ApiName: string }) => cloudwatch.MetricProps,
    props?: cloudwatch.MetricOptions,
  ) {
    return new cloudwatch.Metric({
      ...fn({ ApiName: this.restApiName }),
      ...props,
    }).attachTo(this);
  }

  public get outputs(): Record<string, any> {
    return {
      restApiId: this.restApiId,
      restApiName: this.restApiName,
      restApiRootResourceId: this.restApiRootResourceId,
      // this is equal to AWSCDK's "Endpoint" output
      url: this.deploymentStage ? this.url : undefined,
    };
  }
}

/**
 * Represents a REST API in Amazon API Gateway, created with an OpenAPI specification.
 *
 * Some properties normally accessible on @see `RestApi` - such as the description -
 * must be declared in the specification. All Resources and Methods need to be defined as
 * part of the OpenAPI specification file, and cannot be added via the CDK.
 *
 * By default, the API will automatically be deployed and accessible from a
 * public endpoint.
 *
 *
 * @resource aws_api_gateway_rest_api
 */
export class SpecRestApi extends RestApiBase {
  public readonly restApiId: string;
  public readonly restApiRootResourceId: string;
  public readonly root: IResource;
  private readonly resource: apiGatewayRestApi.ApiGatewayRestApi;

  constructor(scope: Construct, id: string, props: SpecRestApiProps) {
    super(scope, id, props);

    const apiDefConfig = props.apiDefinition.bind(this);
    this.internalPolicy = props.policy;

    this.resource = new apiGatewayRestApi.ApiGatewayRestApi(this, "Resource", {
      name: this.restApiName,
      policy: Lazy.stringValue({
        produce: () => this.internalPolicy?.json,
      }),
      failOnWarnings: props.failOnWarnings,
      minimumCompressionSize: props.minCompressionSize?.toBytes()?.toString(),
      body: apiDefConfig.inlineDefinition, // ?? apiDefConfig.s3Location, // TF body can be inline or S3 URI
      endpointConfiguration: this._configureEndpoints(props),
      parameters: props.parameters,
      disableExecuteApiEndpoint: props.disableExecuteApiEndpoint,
      description: props.description, // Description can be set here if not in spec, or will be overridden by spec
    });

    // This CDK lifecycle hook is largely unused in Terraform, but can be used for custom logic after the API is created.
    props.apiDefinition.bindAfterCreate(this, this);

    this.node.defaultChild = this.resource;
    this.restApiId = this.resource.id;
    this.restApiRootResourceId = this.resource.rootResourceId;
    this.root = new RootResource(this, {}, this.restApiRootResourceId);

    this._configureCloudWatchRole(this.resource, props.cloudWatchRole);
    this._configureDeployment(props);

    if (props.domainName) {
      this.addDomainName("CustomDomain", props.domainName);
    }
  }

  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.internalPolicy) {
      this.internalPolicy = new iam.PolicyDocument(this, "PolicyDocument");
    }
    if (!this.policyAttachment) {
      this.policyAttachment =
        new apiGatewayRestApiPolicy.ApiGatewayRestApiPolicy(this, "Policy", {
          restApiId: this.restApiId,
          policy: this.internalPolicy.json,
        });
    }
    this.internalPolicy.addStatements(statement);
    // Note: The policy on apiGatewayRestApi will be updated due to Lazy evaluation.
    // If a separate ApiGatewayRestApiPolicy resource is preferred, this logic would change.
    return { statementAdded: true, policyDependable: this.resource }; // or this
  }
}

/**
 * Attributes that can be specified when importing a RestApi
 */
export interface RestApiAttributes {
  /**
   * The ID of the API Gateway RestApi.
   */
  readonly restApiId: string;

  /**
   * The name of the API Gateway RestApi.
   *
   * @default - ID of the RestApi construct.
   */
  readonly restApiName?: string;

  /**
   * The resource ID of the root resource.
   */
  readonly rootResourceId: string;
}

/**
 * Represents a REST API in Amazon API Gateway.
 *
 * Use `addResource` and `addMethod` to configure the API model.
 *
 * By default, the API will automatically be deployed and accessible from a
 * public endpoint.
 */
export class RestApi extends RestApiBase {
  /**
   * Return whether the given object is a `RestApi`
   */
  public static isRestApi(x: any): x is RestApi {
    return (
      x !== null && typeof x === "object" && APIGATEWAY_RESTAPI_SYMBOL in x
    );
  }

  /**
   * Import an existing RestApi.
   */
  public static fromRestApiId(
    scope: Construct,
    id: string,
    restApiId: string,
  ): IRestApi {
    class Import extends RestApiBase {
      public readonly restApiId = restApiId;
      public readonly restApiName = id; // Defaulting to construct ID for name
      public readonly restApiRootResourceId = Lazy.stringValue({
        produce: () => {
          // This would ideally come from a data source lookup if not provided
          throw new Error(
            "restApiRootResourceId is not available when importing with fromRestApiId. Use fromRestApiAttributes or provide it.",
          );
        },
      });
      public readonly root: IResource = new RootResource(
        this,
        {},
        this.restApiRootResourceId,
      );

      public addToResourcePolicy(
        _statement: iam.PolicyStatement,
      ): iam.AddToResourcePolicyResult {
        // Cannot add to policy of an imported RestApi through this interface
        return { statementAdded: false };
      }
    }

    return new Import(scope, id);
  }

  /**
   * Import an existing RestApi that can be configured with additional Methods and Resources.
   */
  public static fromRestApiAttributes(
    scope: Construct,
    id: string,
    attrs: RestApiAttributes,
  ): IRestApi {
    class Import extends RestApiBase {
      public readonly restApiId = attrs.restApiId;
      public readonly restApiName = attrs.restApiName ?? id;
      public readonly restApiRootResourceId = attrs.rootResourceId;
      public readonly root: IResource = new RootResource(
        this,
        {},
        this.restApiRootResourceId,
      );

      public addToResourcePolicy(
        _statement: iam.PolicyStatement,
      ): iam.AddToResourcePolicyResult {
        return { statementAdded: false };
      }
    }

    return new Import(scope, id);
  }

  public readonly restApiId: string;
  public readonly root: IResource;
  public readonly restApiRootResourceId: string;
  private readonly resource: apiGatewayRestApi.ApiGatewayRestApi;

  /**
   * The list of methods bound to this RestApi
   */
  public readonly methods = new Array<Method>();

  /**
   * This list of deployments bound to this RestApi
   */
  private readonly deployments = new Array<Deployment>();

  constructor(scope: Construct, id: string, props: RestApiProps = {}) {
    super(scope, id, props);

    if (props.minCompressionSize === undefined) {
      // No equivalent for minimumCompressionSize being deprecated in favor of minCompressionSize
    }

    this.internalPolicy = props.policy;

    this.resource = new apiGatewayRestApi.ApiGatewayRestApi(this, "Resource", {
      name: this.restApiName,
      description: props.description,
      policy: Lazy.stringValue({
        produce: () => this.internalPolicy?.json,
      }),
      failOnWarnings: props.failOnWarnings,
      minimumCompressionSize: props.minCompressionSize?.toBytes()?.toString(),
      binaryMediaTypes: props.binaryMediaTypes,
      endpointConfiguration: this._configureEndpoints(props),
      apiKeySource: props.apiKeySourceType,
      // cloneFrom: props.cloneFrom?.restApiId, // Not supported in TF aws_api_gateway_rest_api
      parameters: props.parameters,
      disableExecuteApiEndpoint: props.disableExecuteApiEndpoint,
    });
    this.node.defaultChild = this.resource;
    this.restApiId = this.resource.id;
    this.restApiRootResourceId = this.resource.rootResourceId;

    // ensure the iam policy is associated with the resource.
    if (this.internalPolicy) {
      this.policyAttachment =
        new apiGatewayRestApiPolicy.ApiGatewayRestApiPolicy(this, "Policy", {
          restApiId: this.restApiId,
          policy: this.internalPolicy.json,
        });
    }

    this._configureCloudWatchRole(this.resource, props.cloudWatchRole);
    this._configureDeployment(props);

    if (props.domainName) {
      this.addDomainName("CustomDomain", props.domainName);
    }

    this.root = new RootResource(this, props, this.restApiRootResourceId);

    this.node.addValidation({ validate: () => this.validateRestApi() });

    Object.defineProperty(this, APIGATEWAY_RESTAPI_SYMBOL, { value: true });
  }

  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.internalPolicy) {
      this.internalPolicy = new iam.PolicyDocument(this, "PolicyDocument");
    }
    if (!this.policyAttachment) {
      this.policyAttachment =
        new apiGatewayRestApiPolicy.ApiGatewayRestApiPolicy(this, "Policy", {
          restApiId: this.restApiId,
          policy: this.internalPolicy.json,
        });
    }
    this.internalPolicy.addStatements(statement);
    return { statementAdded: true, policyDependable: this.resource };
  }

  public addModel(id: string, props: ModelOptions): Model {
    return new Model(this, id, {
      ...props,
      restApi: this,
    });
  }

  public addRequestValidator(
    id: string,
    props: RequestValidatorOptions,
  ): RequestValidator {
    return new RequestValidator(this, id, {
      ...props,
      restApi: this,
    });
  }

  /**
   * Internal API used by `Method` to keep an inventory of methods at the API
   * level for validation purposes.
   *
   * @internal
   */
  public _attachMethod(method: Method) {
    // In TF, deployment triggers would handle this implicitly or explicitly
    this.methods.push(method);
    // add this method as a dependency to all deployments defined for this api
    // when additional deployments are added, _attachDeployment is called and
    // this method will be added there.
    for (const dep of this.deployments) {
      dep._addMethodDependency(method);
      // ensure the method has a reference for any pre-synth activities
      method._attachDeployment(dep);
    }
  }

  /** @internal */
  public _attachDeployment(deployment: Deployment) {
    // In TF, deployment triggers would handle this implicitly or explicitly
    this.deployments.push(deployment);
    for (const method of this.methods) {
      deployment._addMethodDependency(method);
      // ensure the method has a reference for any pre-synth activities
      method._attachDeployment(deployment);
    }
  }

  private validateRestApi(): string[] {
    if (this.methods.length === 0) {
      return ["The REST API doesn't contain any methods"];
    }
    return [];
  }
}

/**
 * The endpoint configuration of a REST API, including VPCs and endpoint types.
 *
 * EndpointConfiguration is a property of the AWS::ApiGateway::RestApi resource.
 */
export interface EndpointConfiguration {
  /**
   * A list of endpoint types of an API or its custom domain name.
   *
   * @default EndpointType.EDGE
   */
  readonly types: EndpointType[];

  /**
   * A list of VPC Endpoints against which to create Route53 ALIASes
   *
   * @default - no ALIASes are created for the endpoint.
   */
  readonly vpcEndpoints?: ec2.IVpcEndpoint[];
}

export enum ApiKeySourceType {
  HEADER = "HEADER",
  AUTHORIZER = "AUTHORIZER",
}

export enum EndpointType {
  EDGE = "EDGE",
  REGIONAL = "REGIONAL",
  PRIVATE = "PRIVATE",
}

class RootResource extends ResourceBase {
  public readonly parentResource?: IResource;
  public readonly api: RestApiBase;
  public readonly resourceId: string;
  public readonly path: string;
  public readonly defaultIntegration?: Integration | undefined;
  public readonly defaultMethodOptions?: MethodOptions | undefined;
  public readonly defaultCorsPreflightOptions?: CorsOptions | undefined;

  private readonly _restApi?: RestApi;

  constructor(api: RestApiBase, props: ResourceOptions, resourceId: string) {
    super(api, "Default"); // ID 'Default' for the root resource wrapper

    this.parentResource = undefined;
    this.defaultIntegration = props.defaultIntegration;
    this.defaultMethodOptions = props.defaultMethodOptions;
    this.defaultCorsPreflightOptions = props.defaultCorsPreflightOptions;
    this.api = api;
    this.resourceId = resourceId;
    this.path = "/";

    if (RestApi.isRestApi(api)) {
      // Check if it's the non-spec RestApi to avoid type errors if api is SpecRestApi
      this._restApi = api as RestApi;
    }

    if (this.defaultCorsPreflightOptions) {
      this.addCorsPreflight(this.defaultCorsPreflightOptions);
    }
  }

  /**
   * Get the RestApi associated with this Resource.
   * @deprecated - Throws an error if this Resource is not associated with an instance of `RestApi`. Use `api` instead.
   */
  public get restApi(): RestApi {
    if (!this._restApi) {
      throw new Error(
        "RestApi is not available on Resource not connected to an instance of RestApi. Use `api` instead",
      );
    }
    return this._restApi;
  }
}
