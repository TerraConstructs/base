import { apiGatewayApiKey } from "@cdktf/provider-aws";
import { Annotations } from "cdktf";
import { Construct } from "constructs";
import {
  ArnFormat,
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "..";
import { IRestApi } from "./restapi";
import { IStage, Stage } from "./stage";
import {
  QuotaSettings,
  ThrottleSettings,
  UsagePlan,
  UsagePlanPerApiStage,
} from "./usage-plan";
import { ValidationError } from "../../errors";
import * as iam from "../iam";

/**
 * API keys are alphanumeric string values that you distribute to
 * app developer customers to grant access to your API
 */
export interface IApiKey extends IAwsConstruct {
  /**
   * The API key ID.
   * @attribute
   */
  readonly keyId: string;

  /**
   * The API key ARN.
   */
  readonly keyArn: string;
}

/**
 * The options for creating an API Key.
 */
export interface ApiKeyOptions extends AwsConstructProps {
  /**
   * A name for the API key. If you don't specify a name, AWS CloudFormation generates a unique physical ID and uses that ID for the API key name.
   * @link http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-apikey.html#cfn-apigateway-apikey-name
   * @default automically generated name
   */
  readonly apiKeyName?: string;

  /**
   * The value of the API key. Must be at least 20 characters long.
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-apikey.html#cfn-apigateway-apikey-value
   * @default none
   */
  readonly value?: string;

  /**
   * A description of the purpose of the API key.
   * @link http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-apikey.html#cfn-apigateway-apikey-description
   * @default none
   */
  readonly description?: string;
}

/**
 * ApiKey Properties.
 */
export interface ApiKeyProps extends ApiKeyOptions {
  /**
   * A list of resources this api key is associated with.
   * Note: This property is not used by the ApiKey construct itself as direct stage association is deprecated.
   * Stage association is handled via Usage Plans.
   * It is kept for compatibility with RateLimitedApiKeyProps.
   * @default none
   * @deprecated - use `stages` instead, and associate via a UsagePlan.
   */
  readonly resources?: IRestApi[];

  /**
   * A list of Stages this api key is associated with.
   * Note: This property is not used by the ApiKey construct itself as direct stage association is deprecated.
   * Stage association is handled via Usage Plans.
   * It is kept for compatibility with RateLimitedApiKeyProps.
   * @default - the api key is not associated with any stages
   */
  readonly stages?: IStage[];

  /**
   * An AWS Marketplace customer identifier to use when integrating with the AWS SaaS Marketplace.
   * @link http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-apikey.html#cfn-apigateway-apikey-customerid
   * @default none
   */
  readonly customerId?: string;

  /**
   * Indicates whether the API key can be used by clients.
   * @link http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-apikey.html#cfn-apigateway-apikey-enabled
   * @default true
   */
  readonly enabled?: boolean;

  /**
   * Specifies whether the key identifier is distinct from the created API key value.
   * This property is deprecated and not supported in the TerraConstruct.
   * @link http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-apikey.html#cfn-apigateway-apikey-generatedistinctid
   * @default false
   * @deprecated This property is deprecated and not used.
   */
  readonly generateDistinctId?: boolean;
}

/**
 * Base implementation that is common to the various implementations of IApiKey
 */
abstract class ApiKeyBase extends AwsConstructBase implements IApiKey {
  public abstract readonly keyId: string;
  public abstract readonly keyArn: string;

  public get outputs(): Record<string, any> {
    return {
      keyId: this.keyId,
      keyArn: this.keyArn,
    };
  }

  /**
   * Permits the IAM principal all read operations through this key
   *
   * @param grantee The principal to grant access to
   */
  public grantRead(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: readPermissions,
      resourceArns: [this.keyArn],
    });
  }

  /**
   * Permits the IAM principal all write operations through this key
   *
   * @param grantee The principal to grant access to
   */
  public grantWrite(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: writePermissions,
      resourceArns: [this.keyArn],
    });
  }

  /**
   * Permits the IAM principal all read and write operations through this key
   *
   * @param grantee The principal to grant access to
   */
  public grantReadWrite(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [...readPermissions, ...writePermissions],
      resourceArns: [this.keyArn],
    });
  }
}

/**
 * An API Gateway ApiKey.
 *
 * An ApiKey can be distributed to API clients that are executing requests
 * for Method resources that require an Api Key.
 *
 * @resource aws_api_gateway_api_key
 */
export class ApiKey extends ApiKeyBase {
  /**
   * Import an ApiKey by its Id
   */
  public static fromApiKeyId(
    scope: Construct,
    id: string,
    apiKeyId: string,
  ): IApiKey {
    class Import extends ApiKeyBase {
      public keyId = apiKeyId;
      public keyArn = this.stack.formatArn({
        service: "apigateway",
        account: "", // API Key ARNs typically don't include account ID in this segment
        resource: "/apikeys",
        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
        resourceName: apiKeyId,
      });
    }

    return new Import(scope, id);
  }

  public readonly keyId: string;
  public readonly keyArn: string;
  /**
   * Auto created Usage Plan for backwards compatibility.
   * Since August 11, 2016 usage plans are now required to associate an API key with an API stage.
   *
   * Note: This property may be udnefined as direct stage association is deprecated.
   * Stage association is handled via Usage Plans instead.
   * It is kept for compatibility with RateLimitedApiKeyProps.
   */
  public readonly usagePlan?: UsagePlan;
  private readonly resource: apiGatewayApiKey.ApiGatewayApiKey;

  constructor(scope: Construct, id: string, props: ApiKeyProps = {}) {
    super(scope, id, props);

    const name = props.apiKeyName ?? this.stack.uniqueResourceName(this);

    this.resource = new apiGatewayApiKey.ApiGatewayApiKey(this, "Resource", {
      name,
      customerId: props.customerId,
      description: props.description,
      enabled: props.enabled ?? true,
      value: props.value,
    });
    this.keyId = this.resource.id;
    this.keyArn = this.resource.arn;

    // copy legacy renderStageKeys logic from AWSCDK for ease of migration.
    this.usagePlan = this.renderStageKeys(props.resources, props.stages);
  }

  /**
   * Render the stage keys for the ApiKey.
   * This method handles the association of the ApiKey with either
   * RestApi resources or Stages, depending on the provided parameters.
   *
   * @param resources - Optional list of RestApi resources to associate with the ApiKey.
   * @param stages - Optional list of Stages to associate with the ApiKey.
   */
  private renderStageKeys(
    resources?: IRestApi[],
    stages?: IStage[],
  ): UsagePlan | undefined {
    if (!resources && !stages) {
      return undefined;
    }

    if (resources && stages) {
      throw new ValidationError(
        `Only one of "resources" or "stages" should be provided. (${this.node.path})`,
        this,
      );
    }

    if (resources) {
      // Handle Deprecated case of associating ApiKey with RestApi resources
      // This creates a single Usage Plan for all stages, but is deprecated.
      const apiStages: UsagePlanPerApiStage[] = [];
      resources.forEach((resource: IRestApi) => {
        const restApi = resource;
        if (!restApi.deploymentStage) {
          throw new ValidationError(
            'Cannot add an ApiKey to a RestApi that does not contain a "deploymentStage".\n' +
              "Either set the RestApi.deploymentStage or create an ApiKey from a Stage",
            this,
          );
        }
        apiStages.push({
          api: restApi,
          stage: restApi.deploymentStage,
        });
      });

      const usagePlan = new UsagePlan(this, "UsagePlan", {
        apiStages,
        name: `${this.resource.nameInput}-usage-plan`,
        description: `Usage Plan for ${this.friendlyName}`,
      });
      usagePlan.addApiKey(this);
      return usagePlan;
    }

    if (stages && stages.length > 0) {
      // Handle Deprecated case of associating ApiKey with multiple Stages
      // This creates a single Usage Plan for all stages, but is also deprecated.
      const usagePlan = new UsagePlan(this, `UsagePlan`, {
        apiStages: stages.map((stage) => ({
          api: stage.restApi,
          // NOTE: UsagePlanPerApiStage expects Stage instead of IStage
          // https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/lib/usage-plan.ts#L97-L102
          stage: stage as Stage,
        })),
      });
      usagePlan.addApiKey(this);
      return usagePlan;
    }
    return undefined;
  }
}

/**
 * RateLimitedApiKey properties.
 */
export interface RateLimitedApiKeyProps extends ApiKeyProps {
  /**
   * API Stages to be associated with the RateLimitedApiKey.
   * If you already prepared UsagePlan resource explicitly, you should use `stages` property.
   * If you prefer to prepare UsagePlan resource implicitly via RateLimitedApiKey,
   * or you should specify throttle settings at each stage individually, you should use `apiStages` property.
   *
   * @default none
   */
  readonly apiStages?: UsagePlanPerApiStage[];

  /**
   * Number of requests clients can make in a given time period.
   * @default none
   */
  readonly quota?: QuotaSettings;

  /**
   * Overall throttle settings for the API.
   * @default none
   */
  readonly throttle?: ThrottleSettings;
}

/**
 * An API Gateway ApiKey, for which a rate limiting configuration can be specified.
 *
 * @resource aws_api_gateway_api_key
 */
export class RateLimitedApiKey extends ApiKeyBase {
  public readonly keyId: string;
  public readonly keyArn: string;
  public readonly apiKey: ApiKey;

  constructor(
    scope: Construct,
    id: string,
    props: RateLimitedApiKeyProps = {},
  ) {
    super(scope, id, props);

    this.apiKey = new ApiKey(this, "Resource", props);

    if (props.apiStages || props.quota || props.throttle) {
      if (this.apiKey.usagePlan) {
        // NOTE: Creating an additional usage plan is default AWSCDK behavior.
        // https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/lib/api-key.ts#L268-L275
        Annotations.of(this.apiKey).addWarning(
          "UsagePlan is already created for this ApiKey. A separate UsagePlan with rate limiting will be created separately",
        );
      }
      const usagePlan = new UsagePlan(this, "RateLimitedUsagePlan", {
        apiStages: props.apiStages,
        quota: props.quota,
        throttle: props.throttle,
      });
      usagePlan.addApiKey(this.apiKey);
    }

    this.keyId = this.apiKey.keyId;
    this.keyArn = this.apiKey.keyArn;
  }
}

const readPermissions = ["apigateway:GET"];

const writePermissions = [
  "apigateway:POST",
  "apigateway:PUT",
  "apigateway:PATCH",
  "apigateway:DELETE",
];
