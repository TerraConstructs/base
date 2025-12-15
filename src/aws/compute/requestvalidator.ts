import { apiGatewayRequestValidator } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { IRestApi, RestApi } from "./restapi";
// import { Fn } from "../../terra-func";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../aws-construct";

export interface IRequestValidator extends IAwsConstruct {
  /**
   * ID of the request validator, such as abc123
   *
   * @attribute
   */
  readonly requestValidatorId: string;
}

export interface RequestValidatorOptions {
  /**
   * The name of this request validator.
   *
   * @default - The friendly name of the construct.
   */
  readonly requestValidatorName?: string;

  /**
   * Indicates whether to validate the request body according to
   * the configured schema for the targeted API and method.
   *
   * @default false
   */
  readonly validateRequestBody?: boolean;

  /**
   * Indicates whether to validate request parameters.
   *
   * @default false
   */
  readonly validateRequestParameters?: boolean;
}

export interface RequestValidatorProps
  extends RequestValidatorOptions, AwsConstructProps {
  /**
   * The rest API that this model is part of.
   */
  readonly restApi: IRestApi;
}

class ImportedRequestValidator
  extends AwsConstructBase
  implements IRequestValidator
{
  public readonly requestValidatorId: string;

  constructor(
    scope: Construct,
    id: string,
    requestValidatorId: string,
    props?: AwsConstructProps,
  ) {
    super(scope, id, props);
    this.requestValidatorId = requestValidatorId;
  }

  public get outputs(): Record<string, any> {
    return {
      requestValidatorId: this.requestValidatorId,
    };
  }
}

export class RequestValidator
  extends AwsConstructBase
  implements IRequestValidator
{
  public static fromRequestValidatorId(
    scope: Construct,
    id: string,
    requestValidatorId: string,
  ): IRequestValidator {
    // Note: For a full CDKTF import, restApiId would also be needed.
    // This mirrors the CDK's limited import functionality.
    return new ImportedRequestValidator(scope, id, requestValidatorId);
  }

  /**
   * ID of the request validator, such as abc123
   *
   * @attribute
   */
  public readonly requestValidatorId: string;

  private readonly resource: apiGatewayRequestValidator.ApiGatewayRequestValidator;

  constructor(scope: Construct, id: string, props: RequestValidatorProps) {
    super(scope, id, props);

    const validatorName =
      props.requestValidatorName ?? this.stack.uniqueResourceName(this);
    const validatorProps: apiGatewayRequestValidator.ApiGatewayRequestValidatorConfig =
      {
        name: validatorName,
        restApiId: props.restApi.restApiId,
        validateRequestBody: props.validateRequestBody,
        validateRequestParameters: props.validateRequestParameters,
      };

    this.resource = new apiGatewayRequestValidator.ApiGatewayRequestValidator(
      this,
      "Resource",
      validatorProps,
    );

    this.requestValidatorId = this.resource.id;

    // The CDK version of RequestValidator interacts with the RestApi's deployment
    // to ensure changes to the validator trigger a new deployment.
    const deployment =
      props.restApi instanceof RestApi
        ? props.restApi.latestDeployment
        : undefined;
    if (deployment) {
      deployment.node.addDependency(this.resource);
      // Fn.sha1(Fn.jsonencode()) causes nested Tokens and Resolver errors?
      deployment.addToTriggers({ validator: validatorProps });
      // deployment.addToLogicalId({ validator: validatorProps });
    }
  }

  public get outputs(): Record<string, any> {
    return {
      requestValidatorId: this.requestValidatorId,
    };
  }
}
