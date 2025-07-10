import { apiGatewayStage, apiGatewayMethodSettings } from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct } from "constructs";
import { AccessLogFormat, IAccessLogDestination } from "./access-log";
import { IApiKey, ApiKeyOptions, ApiKey } from "./api-key";
import { ApiGatewayMetrics } from "./apigateway-canned-metrics.generated";
import { parseMethodOptionsPath } from "./apigateway-util";
import { Deployment } from "./deployment";
import { IRestApi, RestApiBase } from "./restapi";
import { Duration } from "../../duration";
import { ArnFormat } from "../arn";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as cloudwatch from "../cloudwatch";
// import { ValidationError } from "../../core/lib/errors"; // Use throw new Error()

/**
 * Represents an APIGateway Stage.
 */
export interface IStage extends IAwsConstruct {
  /**
   * Name of this stage.
   * @attribute
   */
  readonly stageName: string;

  /**
   * RestApi to which this stage is associated.
   */
  readonly restApi: IRestApi;

  /**
   * Returns the resource ARN for this stage.
   *
   * @attribute
   */
  readonly stageArn: string;

  /**
   * Add an ApiKey to this Stage
   */
  addApiKey(id: string, options?: ApiKeyOptions): IApiKey;

  /**
   * Returns the invoke URL for a certain path.
   * @param path The resource path
   */
  urlForPath(path?: string): string;

  /**
   * Returns the given named metric for this stage
   */
  metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;

  /**
   * Metric for the number of client-side errors captured in a given period.
   *
   * @default - sum over 5 minutes
   */
  metricClientError(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * Metric for the number of server-side errors captured in a given period.
   *
   * @default - sum over 5 minutes
   */
  metricServerError(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * Metric for the number of requests served from the API cache in a given period.
   *
   * @default - sum over 5 minutes
   */
  metricCacheHitCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * Metric for the number of requests served from the backend in a given period,
   * when API caching is enabled.
   *
   * @default - sum over 5 minutes
   */
  metricCacheMissCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * Metric for the total number API requests in a given period.
   *
   * @default - sample count over 5 minutes
   */
  metricCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * Metric for the time between when API Gateway relays a request to the backend
   * and when it receives a response from the backend.
   *
   * @default - average over 5 minutes.
   */
  metricIntegrationLatency(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The time between when API Gateway receives a request from a client
   * and when it returns a response to the client.
   * The latency includes the integration latency and other API Gateway overhead.
   *
   * @default - average over 5 minutes.
   */
  metricLatency(props?: cloudwatch.MetricOptions): cloudwatch.Metric;
}

export interface StageOptions extends MethodDeploymentOptions {
  /**
   * The name of the stage, which API Gateway uses as the first path segment
   * in the invoked Uniform Resource Identifier (URI).
   *
   * @default - "prod"
   */
  readonly stageName?: string;

  /**
   * The CloudWatch Logs log group or Firehose delivery stream where to write access logs.
   *
   * @default - No destination
   */
  readonly accessLogDestination?: IAccessLogDestination;

  /**
   * A single line format of access logs of data, as specified by selected $content variables.
   * The format must include either `AccessLogFormat.contextRequestId()`
   * or `AccessLogFormat.contextExtendedRequestId()`.
   *
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-mapping-template-reference.html#context-variable-reference
   *
   * @default - Common Log Format
   */
  readonly accessLogFormat?: AccessLogFormat;

  /**
   * Specifies whether Amazon X-Ray tracing is enabled for this method.
   *
   * @default false
   */
  readonly tracingEnabled?: boolean;

  /**
   * Indicates whether cache clustering is enabled for the stage.
   *
   * @default - Disabled for the stage.
   */
  readonly cacheClusterEnabled?: boolean;

  /**
   * The stage's cache cluster size.
   * @default 0.5
   */
  readonly cacheClusterSize?: string;

  /**
   * The identifier of the client certificate that API Gateway uses to call
   * your integration endpoints in the stage.
   *
   * @default - None.
   */
  readonly clientCertificateId?: string;

  /**
   * A description of the purpose of the stage.
   *
   * @default - No description.
   */
  readonly description?: string;

  /**
   * The version identifier of the API documentation snapshot.
   *
   * @default - No documentation version.
   */
  readonly documentationVersion?: string;

  /**
   * A map that defines the stage variables. Variable names must consist of
   * alphanumeric characters, and the values must match the following regular
   * expression: [A-Za-z0-9-._~:/?#&=,]+.
   *
   * @default - No stage variables.
   */
  readonly variables?: { [key: string]: string };

  /**
   * Method deployment options for specific resources/methods. These will
   * override common options defined in `StageOptions#methodOptions`.
   *
   * @param path is {resource_path}/{http_method} (i.e. /api/toys/GET) for an
   * individual method override. You can use `*` for both {resource_path} and {http_method}
   * to define options for all methods/resources.
   *
   * @default - Common options will be used.
   */
  readonly methodOptions?: { [path: string]: MethodDeploymentOptions };
}

export interface StageProps extends StageOptions, AwsConstructProps {
  /**
   * The deployment that this stage points to.
   */
  readonly deployment: Deployment;
}

export enum MethodLoggingLevel {
  OFF = "OFF",
  ERROR = "ERROR",
  INFO = "INFO",
}

export interface MethodDeploymentOptions {
  /**
   * Specifies whether Amazon CloudWatch metrics are enabled for this method.
   *
   * @default false
   */
  readonly metricsEnabled?: boolean;

  /**
   * Specifies the logging level for this method, which effects the log
   * entries pushed to Amazon CloudWatch Logs.
   *
   * @default - Off
   */
  readonly loggingLevel?: MethodLoggingLevel;

  /**
   * Specifies whether data trace logging is enabled for this method.
   * When enabled, API gateway will log the full API requests and responses.
   * This can be useful to troubleshoot APIs, but can result in logging sensitive data.
   * We recommend that you don't enable this feature for production APIs.
   *
   * @default false
   */
  readonly dataTraceEnabled?: boolean;

  /**
   * Specifies the throttling burst limit.
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html
   *
   * @default - No additional restriction.
   */
  readonly throttlingBurstLimit?: number;

  /**
   * Specifies the throttling rate limit.
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html
   *
   * @default - No additional restriction.
   */
  readonly throttlingRateLimit?: number;

  /**
   * Specifies whether responses should be cached and returned for requests. A
   * cache cluster must be enabled on the stage for responses to be cached.
   *
   * @default - Caching is Disabled.
   */
  readonly cachingEnabled?: boolean;

  /**
   * Specifies the time to live (TTL), in seconds, for cached responses. The
   * higher the TTL, the longer the response will be cached.
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html
   *
   * @default Duration.minutes(5)
   */
  readonly cacheTtl?: Duration;

  /**
   * Indicates whether the cached responses are encrypted.
   *
   * @default false
   */
  readonly cacheDataEncrypted?: boolean;
}

/**
 * The attributes of an imported Stage
 */
export interface StageAttributes {
  /**
   * The name of the stage
   */
  readonly stageName: string;

  /**
   * The RestApi that the stage belongs to
   */
  readonly restApi: IRestApi;
}

/**
 * Base class for an ApiGateway Stage
 */
export abstract class StageBase extends AwsConstructBase implements IStage {
  public abstract readonly stageName: string;
  public abstract readonly restApi: IRestApi;

  public get outputs(): Record<string, any> {
    return {
      stageName: this.stageName,
      stageArn: this.stageArn,
      invokeUrl: this.urlForPath(),
    };
  }

  /**
   * Add an ApiKey to this stage
   *
   * Note: direct stage association is deprecated.
   * Stage association should be handled via Usage Plans.
   */
  public addApiKey(id: string, options?: ApiKeyOptions): IApiKey {
    return new ApiKey(this, id, {
      stages: [this],
      ...options,
    });
  }

  /**
   * Returns the invoke URL for a certain path.
   * @param path The resource path
   */
  public urlForPath(path: string = "/"): string {
    if (!path.startsWith("/")) {
      // TODO: Use ValidationError from core/lib/errors
      throw new Error(`Path must begin with \"/\": ${path}`);
    }
    const stack = AwsStack.ofAwsConstruct(this);
    // For imported APIs, restApiId might be a token. For new APIs, it's resolved.
    // The URL structure is https://{restapi-id}.execute-api.{region}.{dns-suffix}/{stageName}/{path}
    return `https://${this.restApi.restApiId}.execute-api.${stack.region}.${stack.urlSuffix}/${this.stageName}${path}`;
  }

  /**
   * Returns the resource ARN for this stage:
   *
   *   arn:aws:apigateway:{region}::/restapis/{restApiId}/stages/{stageName}
   *
   * Note that this is separate from the execute-api ARN for methods and resources
   * within this stage.
   *
   * @attribute
   */
  public get stageArn(): string {
    return AwsStack.ofAwsConstruct(this).formatArn({
      arnFormat: ArnFormat.SLASH_RESOURCE_SLASH_RESOURCE_NAME,
      service: "apigateway",
      account: "", // APIGateway ARNs for stages don't include account in this part
      resource: "restapis",
      resourceName: `${this.restApi.restApiId}/stages/${this.stageName}`,
    });
  }

  /**
   * Returns the given named metric for this stage
   */
  public metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/ApiGateway",
      metricName,
      dimensionsMap: {
        ApiName: this.restApi.restApiName,
        Stage: this.stageName,
      },
      ...props,
    }).attachTo(this);
  }

  /**
   * Metric for the number of client-side errors captured in a given period.
   *
   * @default - sum over 5 minutes
   */
  public metricClientError(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics._4XxErrorSum, props);
  }

  /**
   * Metric for the number of server-side errors captured in a given period.
   *
   * @default - sum over 5 minutes
   */
  public metricServerError(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics._5XxErrorSum, props);
  }

  /**
   * Metric for the number of requests served from the API cache in a given period.
   *
   * @default - sum over 5 minutes
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
   * @default - sum over 5 minutes
   */
  public metricCacheMissCount(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.cacheMissCountSum, props);
  }

  /**
   * Metric for the total number API requests in a given period.
   *
   * @default - sample count over 5 minutes
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
   * @default - average over 5 minutes.
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
   * @default - average over 5 minutes.
   */
  public metricLatency(props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return this.cannedMetric(ApiGatewayMetrics.latencyAverage, props);
  }

  private cannedMetric(
    fn: (dims: { ApiName: string; Stage: string }) => cloudwatch.MetricProps,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      ...fn({ ApiName: this.restApi.restApiName, Stage: this.stageName }),
      ...props,
    }).attachTo(this);
  }
}

export class Stage extends StageBase {
  /**
   * Import a Stage by its attributes
   */
  public static fromStageAttributes(
    scope: Construct,
    id: string,
    attrs: StageAttributes,
  ): IStage {
    class Import extends StageBase {
      public readonly stageName = attrs.stageName;
      public readonly restApi = attrs.restApi;
    }
    return new Import(scope, id);
  }

  public readonly stageName: string;
  public readonly restApi: IRestApi;
  public readonly resource: apiGatewayStage.ApiGatewayStage;

  private enableCacheCluster?: boolean;

  constructor(scope: Construct, id: string, props: StageProps) {
    super(scope, id, props);

    this.restApi = props.deployment.api;
    this.enableCacheCluster = props.cacheClusterEnabled;

    // Determine if cache cluster needs to be enabled based on method options
    const commonCachingEnabled = props.cachingEnabled;
    if (commonCachingEnabled) {
      if (this.enableCacheCluster === false) {
        throw new Error(
          "Cannot enable caching for common methods since cache cluster is disabled on stage",
        );
      }
      this.enableCacheCluster = true;
    }
    if (props.methodOptions) {
      for (const path of Object.keys(props.methodOptions)) {
        if (props.methodOptions[path].cachingEnabled) {
          if (this.enableCacheCluster === false) {
            throw new Error(
              `Cannot enable caching for method ${path} since cache cluster is disabled on stage`,
            );
          }
          this.enableCacheCluster = true;
        }
      }
    }

    // custom access logging
    let accessLogSettings:
      | apiGatewayStage.ApiGatewayStageAccessLogSettings
      | undefined;
    const accessLogDestination = props.accessLogDestination;
    const accessLogFormat = props.accessLogFormat;

    if (accessLogDestination || accessLogFormat) {
      if (
        accessLogFormat !== undefined &&
        !Token.isUnresolved(accessLogFormat.toString()) &&
        !/.*\$context.(requestId|extendedRequestId)\b.*/.test(
          accessLogFormat.toString(),
        )
      ) {
        // TODO: Use ValidationError from core/lib/errors
        throw new Error(
          "Access log must include either `AccessLogFormat.contextRequestId()` or `AccessLogFormat.contextExtendedRequestId()`",
        );
      }
      if (accessLogFormat !== undefined && accessLogDestination === undefined) {
        // TODO: Use ValidationError from core/lib/errors
        throw new Error("Access log format is specified without a destination");
      }

      accessLogSettings = {
        destinationArn: accessLogDestination!.bind(this).destinationArn, // accessLogDestination must be defined if format is
        format: accessLogFormat?.toString() ?? AccessLogFormat.clf().toString(),
      };
    }

    // enable cache cluster if cacheClusterSize is set
    if (props.cacheClusterSize !== undefined) {
      if (this.enableCacheCluster === undefined) {
        this.enableCacheCluster = true;
      } else if (this.enableCacheCluster === false) {
        // TODO: Use ValidationError from core/lib/errors
        throw new Error(
          `Cannot set "cacheClusterSize" to ${props.cacheClusterSize} and "cacheClusterEnabled" to "false". (${this.node.path})`,
        );
      }
    }

    const cacheClusterSize = this.enableCacheCluster
      ? props.cacheClusterSize || "0.5"
      : undefined;

    this.resource = new apiGatewayStage.ApiGatewayStage(this, "Resource", {
      stageName: props.stageName || "prod",
      accessLogSettings,
      cacheClusterEnabled: this.enableCacheCluster,
      cacheClusterSize,
      clientCertificateId: props.clientCertificateId,
      deploymentId: props.deployment.deploymentId,
      restApiId: props.deployment.api.restApiId,
      description: props.description,
      documentationVersion: props.documentationVersion,
      variables: props.variables,
      xrayTracingEnabled: props.tracingEnabled,
    });

    this.stageName = this.resource.stageName;

    this.applyMethodSettings(props, this.resource);

    if (RestApiBase._isRestApiBase(this.restApi)) {
      this.restApi._attachStage(this);
    }
  }

  private applyMethodSettings(
    props: StageProps,
    stageResource: apiGatewayStage.ApiGatewayStage,
  ): void {
    const commonMethodOptions: MethodDeploymentOptions = {
      metricsEnabled: props.metricsEnabled,
      loggingLevel: props.loggingLevel,
      dataTraceEnabled: props.dataTraceEnabled,
      throttlingBurstLimit: props.throttlingBurstLimit,
      throttlingRateLimit: props.throttlingRateLimit,
      cachingEnabled: props.cachingEnabled,
      cacheTtl: props.cacheTtl,
      cacheDataEncrypted: props.cacheDataEncrypted,
    };

    const hasCommonOptions = Object.values(commonMethodOptions).some(
      (v) => v !== undefined,
    );
    if (hasCommonOptions) {
      this.createMethodSettingsResource(
        "/*/*",
        commonMethodOptions,
        stageResource,
      );
    }

    if (props.methodOptions) {
      for (const path of Object.keys(props.methodOptions)) {
        this.createMethodSettingsResource(
          path,
          props.methodOptions[path],
          stageResource,
        );
      }
    }
  }

  private createMethodSettingsResource(
    path: string,
    options: MethodDeploymentOptions,
    stageRes: apiGatewayStage.ApiGatewayStage,
  ): void {
    // Validation for caching already happened in constructor before ApiGatewayStage creation

    const { httpMethod, resourcePath } = parseMethodOptionsPath(path);

    // Sanitize the ID for the method settings resource
    // Replace non-alphanumeric characters with hyphen, ensure it's a valid TF ID part
    const safePathForId = resourcePath
      .replace(/[^a-zA-Z0-9_]/g, "-")
      .replace(/^-+|-+$/g, "");
    const methodSettingsId = `MethodSettings-${safePathForId || "Root"}`;

    new apiGatewayMethodSettings.ApiGatewayMethodSettings(
      this,
      methodSettingsId,
      {
        restApiId: stageRes.restApiId,
        stageName: stageRes.stageName,
        methodPath: `${resourcePath}/${httpMethod}`,
        settings: {
          metricsEnabled: options.metricsEnabled,
          loggingLevel: options.loggingLevel,
          dataTraceEnabled: options.dataTraceEnabled,
          throttlingBurstLimit: options.throttlingBurstLimit,
          throttlingRateLimit: options.throttlingRateLimit,
          cachingEnabled: options.cachingEnabled,
          cacheTtlInSeconds: options.cacheTtl?.toSeconds(),
          cacheDataEncrypted: options.cacheDataEncrypted,
        },
      },
    );
  }
}
