import { apiGatewayBasePathMapping } from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct } from "constructs";
import { IDomainName } from "./domain-name";
import { IRestApi } from "./restapi";
import { Stage } from "./stage";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";

export interface BasePathMappingOptions {
  /**
   * The base path name that callers of the API must provide in the URL after
   * the domain name (e.g. `example.com/base-path`). If you specify this
   * property, it can't be an empty string.
   *
   * @default - map requests from the domain root (e.g. `example.com`). If this
   * is undefined, no additional mappings will be allowed on this domain name.
   */
  readonly basePath?: string;

  /**
   * The Deployment stage of API
   * @default - map to deploymentStage of restApi otherwise stage needs to pass in URL
   */
  readonly stage?: Stage;

  /**
   * Whether to attach the base path mapping to a stage.
   * Use this property to create a base path mapping without attaching it to the Rest API default stage.
   * This property is ignored if `stage` is provided.
   * @default - true
   */
  readonly attachToStage?: boolean;
}

export interface BasePathMappingProps
  extends BasePathMappingOptions, AwsConstructProps {
  /**
   * The DomainName to associate with this base path mapping.
   */
  readonly domainName: IDomainName;

  /**
   * The RestApi resource to target.
   */
  readonly restApi: IRestApi;
}

/**
 * This resource creates a base path that clients who call your API must use in
 * the invocation URL.
 *
 * Unless you're importing a domain with `DomainName.fromDomainNameAttributes()`,
 * you can use `DomainName.addBasePathMapping()` to define mappings.
 */
export class BasePathMapping extends AwsConstructBase {
  public get outputs(): Record<string, any> {
    return {};
  }

  constructor(scope: Construct, id: string, props: BasePathMappingProps) {
    super(scope, id, props);

    if (props.basePath && !Token.isUnresolved(props.basePath)) {
      if (props.basePath.startsWith("/") || props.basePath.endsWith("/")) {
        // TODO: UnscopedValidationError
        throw new Error(
          `A base path cannot start or end with /", received: ${props.basePath}`,
        );
      }
      if (props.basePath.match(/\/{2,}/)) {
        // TODO: UnscopedValidationError
        throw new Error(
          `A base path cannot have more than one consecutive /", received: ${props.basePath}`,
        );
      }
      if (!props.basePath.match(/^[a-zA-Z0-9$_.+!*'()-/]+$/)) {
        // TODO: UnscopedValidationError
        throw new Error(
          `A base path may only contain letters, numbers, and one of "$-_.+!*'()", received: ${props.basePath}`,
        );
      }
    }

    const attachToStage = props.attachToStage ?? true;

    let stageForMapping: Stage | undefined = props.stage;
    if (!stageForMapping && attachToStage && props.restApi.deploymentStage) {
      stageForMapping = props.restApi.deploymentStage;
    }

    new apiGatewayBasePathMapping.ApiGatewayBasePathMapping(this, "Resource", {
      basePath: props.basePath,
      domainName: props.domainName.domainName,
      apiId: props.restApi.restApiId,
      stageName: stageForMapping?.stageName,
    });
  }
}
