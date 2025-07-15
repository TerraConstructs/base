import { apiGatewayModel } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import * as util from "./apigateway-util";
import * as jsonSchema from "./json-schema";
import { IRestApi, RestApi } from "./restapi";
// import { Fn } from "../../terra-func";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";

export interface IModel {
  /**
   * Returns the model name, such as 'myModel'
   *
   * @attribute
   */
  readonly modelId: string;
}

/**
 * Represents a reference to a REST API's Empty model, which is available
 * as part of the model collection by default. This can be used for mapping
 * JSON responses from an integration to what is returned to a client,
 * where strong typing is not required. In the absence of any defined
 * model, the Empty model will be used to return the response payload
 * unmapped.
 *
 * Definition
 * {
 *   "$schema" : "http://json-schema.org/draft-04/schema#",
 *   "title" : "Empty Schema",
 *   "type" : "object"
 * }
 *
 * @see https://docs.amazonaws.cn/en_us/apigateway/latest/developerguide/models-mappings.html#models-mappings-models
 */
export class EmptyModel implements IModel {
  public readonly modelId = "Empty";
}

/**
 * Represents a reference to a REST API's Error model, which is available
 * as part of the model collection by default. This can be used for mapping
 * error JSON responses from an integration to a client, where a simple
 * generic message field is sufficient to map and return an error payload.
 *
 * Definition
 * {
 *   "$schema" : "http://json-schema.org/draft-04/schema#",
 *   "title" : "Error Schema",
 *   "type" : "object",
 *   "properties" : {
 *     "message" : { "type" : "string" }
 *   }
 * }
 */
export class ErrorModel implements IModel {
  public readonly modelId = "Error";
}

export interface ModelOptions {
  /**
   * The content type for the model. You can also force a
   * content type in the request or response model mapping.
   *
   * @default 'application/json'
   */
  readonly contentType?: string;

  /**
   * A description that identifies this model.
   * @default None
   */
  readonly description?: string;

  /**
   * A name for the model.
   *
   * Important
   *  If you specify a name, you cannot perform updates that
   *  require replacement of this resource. You can perform
   *  updates that require no or some interruption. If you
   *  must replace the resource, specify a new name.
   *
   * @default <auto> If you don't specify a name,
   *  AWS CloudFormation generates a unique physical ID and
   *  uses that ID for the model name. For more information,
   *  see Name Type.
   */
  readonly modelName?: string;

  /**
   * The schema to use to transform data to one or more output formats.
   * Specify null ({}) if you don't want to specify a schema.
   */
  readonly schema: jsonSchema.JsonSchema;
}

export interface ModelProps extends ModelOptions, AwsConstructProps {
  /**
   * The rest API that this model is part of.
   *
   * The reason we need the RestApi object itself and not just the ID is because the model
   * is being tracked by the top-level RestApi object for the purpose of calculating it's
   * hash to determine the ID of the deployment. This allows us to automatically update
   * the deployment when the model of the REST API changes.
   */
  readonly restApi: IRestApi;
}

export class Model extends AwsConstructBase implements IModel {
  /**
   * Represents a reference to a REST API's Error model, which is available
   * as part of the model collection by default. This can be used for mapping
   * error JSON responses from an integration to a client, where a simple
   * generic message field is sufficient to map and return an error payload.
   *
   * Definition
   * {
   *   "$schema" : "http://json-schema.org/draft-04/schema#",
   *   "title" : "Error Schema",
   *   "type" : "object",
   *   "properties" : {
   *     "message" : { "type" : "string" }
   *   }
   * }
   */
  public static readonly ERROR_MODEL: IModel = new ErrorModel();

  /**
   * Represents a reference to a REST API's Empty model, which is available
   * as part of the model collection by default. This can be used for mapping
   * JSON responses from an integration to what is returned to a client,
   * where strong typing is not required. In the absence of any defined
   * model, the Empty model will be used to return the response payload
   * unmapped.
   *
   * Definition
   * {
   *   "$schema" : "http://json-schema.org/draft-04/schema#",
   *   "title" : "Empty Schema",
   *   "type" : "object"
   * }
   *
   * @see https://docs.amazonaws.cn/en_us/apigateway/latest/developerguide/models-mappings.html#models-mappings-models
   */
  public static readonly EMPTY_MODEL: IModel = new EmptyModel();

  public static fromModelName(
    scope: Construct,
    id: string,
    modelName: string,
  ): IModel {
    class ImportModel extends AwsConstructBase implements IModel {
      public readonly modelId = modelName;
      public get outputs(): Record<string, any> {
        return { modelId: this.modelId };
      }
      constructor(s: Construct, i: string) {
        super(s, i);
      }
    }
    return new ImportModel(scope, id);
  }

  /**
   * Returns the model name, such as 'myModel'
   *
   * @attribute
   */
  public readonly modelId: string;

  private readonly resource: apiGatewayModel.ApiGatewayModel;

  public get outputs(): Record<string, any> {
    return {
      modelId: this.modelId,
    };
  }

  constructor(scope: Construct, id: string, props: ModelProps) {
    super(scope, id, props);

    const modelName = props.modelName ?? this.stack.uniqueResourceName(this);

    // Enhanced CDK Analytics Telemetry - Not applicable in TerraConstructs
    // addConstructMetadata(this, props);

    const apiGatewayModelConfig: apiGatewayModel.ApiGatewayModelConfig = {
      name: modelName,
      restApiId: props.restApi.restApiId,
      contentType: props.contentType ?? "application/json",
      description: props.description,
      schema: JSON.stringify(
        util.JsonSchemaMapper.toTFJsonSchema(props.schema),
      ),
    };

    this.resource = new apiGatewayModel.ApiGatewayModel(
      this,
      "Resource",
      apiGatewayModelConfig,
    );

    this.modelId = this.resource.name;

    const deployment =
      props.restApi instanceof RestApi
        ? props.restApi.latestDeployment
        : undefined;
    if (deployment) {
      deployment.node.addDependency(this.resource);
      // Fn.sha1(Fn.jsonencode()) causes nested Tokens and Resolver errors?
      deployment.addToTriggers({ model: apiGatewayModelConfig });
      // deployment.addToLogicalId({ model: apiGatewayModelConfig });
    }
  }
}
