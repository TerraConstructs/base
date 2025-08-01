import * as cdk from "cdktf";
import { IConstruct } from "constructs";
import { ArnFormat } from "../../arn";
import { AwsStack } from "../../aws-stack";
import { parseAwsApiCall } from "../apigateway-util";
import {
  Integration,
  IntegrationConfig,
  IntegrationOptions,
  IntegrationType,
} from "../integration";
import { Method } from "../method";
// TODO: Adopt UnscopedValidationError
// - https://github.com/aws/aws-cdk/pull/33382/
// - https://github.com/aws/aws-cdk/pull/33045
// import { UnscopedValidationError } from "../../../core/lib/errors";

export interface AwsIntegrationProps {
  /**
   * Use AWS_PROXY integration.
   *
   * @default false
   */
  readonly proxy?: boolean;

  /**
   * The name of the integrated AWS service (e.g. `s3`)
   */
  readonly service: string;

  /**
   * A designated subdomain supported by certain AWS service for fast
   * host-name lookup.
   */
  readonly subdomain?: string;

  /**
   * The path to use for path-base APIs.
   *
   * For example, for S3 GET, you can set path to `bucket/key`.
   * For lambda, you can set path to `2015-03-31/functions/${function-arn}/invocations`
   *
   * Mutually exclusive with the `action` options.
   */
  readonly path?: string;

  /**
   * The AWS action to perform in the integration.
   *
   * Use `actionParams` to specify key-value params for the action.
   *
   * Mutually exclusive with `path`.
   */
  readonly action?: string;

  /**
   * Parameters for the action.
   *
   * `action` must be set, and `path` must be undefined.
   * The action params will be URL encoded.
   */
  readonly actionParameters?: { [key: string]: string };

  /**
   * The integration's HTTP method type.
   *
   * @default POST
   */
  readonly integrationHttpMethod?: string;

  /**
   * Integration options, such as content handling, request/response mapping, etc.
   */
  readonly options?: IntegrationOptions;

  /**
   * The region of the integrated AWS service.
   *
   * @default - same region as the stack
   */
  readonly region?: string;
}

/**
 * This type of integration lets an API expose AWS service actions. It is
 * intended for calling all AWS service actions, but is not recommended for
 * calling a Lambda function, because the Lambda custom integration is a legacy
 * technology.
 */
export class AwsIntegration extends Integration {
  private scope?: IConstruct;

  constructor(props: AwsIntegrationProps) {
    const backend = props.subdomain
      ? `${props.subdomain}.${props.service}`
      : props.service;
    const type = props.proxy ? IntegrationType.AWS_PROXY : IntegrationType.AWS;
    const { apiType, apiValue } = parseAwsApiCall(
      props.path,
      props.action,
      props.actionParameters,
    );
    super({
      type,
      integrationHttpMethod: props.integrationHttpMethod || "POST",
      uri: cdk.Lazy.stringValue({
        produce: () => {
          if (!this.scope) {
            // throw new UnscopedValidationError(
            throw new Error("AwsIntegration must be used in API");
          }
          return AwsStack.ofAwsConstruct(this.scope).formatArn({
            service: "apigateway",
            account: backend,
            resource: apiType,
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            resourceName: apiValue,
            region: props.region,
          });
        },
      }),
      options: props.options,
    });
  }

  public bind(method: Method): IntegrationConfig {
    const bindResult = super.bind(method);
    this.scope = method;
    return bindResult;
  }
}
