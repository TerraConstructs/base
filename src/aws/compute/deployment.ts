import {
  apiGatewayDeployment,
  apiGatewayMethod,
  apiGatewayRestApi,
  apiGatewayStage,
} from "@cdktf/provider-aws";
import { Lazy } from "cdktf";
import { Construct } from "constructs";
import { Method } from "./method";
import { IRestApi, RestApi, RestApiBase, SpecRestApi } from "./restapi";
// import { Fn } from "../../terra-func";
import { md5hash } from "../../helpers-internal";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";

export interface DeploymentProps extends AwsConstructProps {
  /**
   * The Rest API to deploy.
   */
  readonly api: IRestApi;

  /**
   * A description of the purpose of the API Gateway deployment.
   *
   * @default - No description.
   */
  readonly description?: string;

  // // TODO: Implement RemovalPolicy.RETAIN through removed block in Terraform.
  // // ref: https://github.com/hashicorp/terraform/issues/27035#issuecomment-2340348801
  // // ref: https://developer.hashicorp.com/terraform/language/resources/syntax#removing-resources
  // /**
  //  * When an API Gateway model is updated, a new deployment will automatically be created.
  //  * If this is true, the old API Gateway Deployment resource will not be deleted.
  //  * This will allow manually reverting back to a previous deployment in case for example
  //  *
  //  * @default false
  //  */
  // readonly retainDeployments?: boolean;

  /**
   * The name of the stage the API Gateway deployment deploys to.
   * If this property is set and a stage with the corresponding name does not exist,
   * a new stage resource will be created and associated with this deployment.
   *
   * @default - No stage is created or associated with this deployment.
   */
  readonly stageName?: string;
}

/**
 * A Deployment of a REST API.
 *
 * An immutable representation of a RestApi resource that can be called by users
 * using Stages. A deployment must be associated with a Stage for it to be
 * callable over the Internet.
 *
 * Normally, you don't need to define deployments manually. The RestApi
 * construct manages a Deployment resource that represents the latest model. It
 * can be accessed through `restApi.latestDeployment` (unless `deploy: false` is
 * set when defining the `RestApi`).
 *
 * If you manually define this resource, you will need to know that since
 * deployments are immutable, their properties will not change after creation.
 * To reflect API model changes, a new deployment must be created. This is typically
 * achieved by changing the `triggers` property of the `ApiGatewayDeployment` resource.
 *
 * The `addToTriggers` method can be used to augment the set of triggers for this
 * deployment. This ensures that if specific parts of the API model change (e.g., a Method's configuration),
 * a new deployment is triggered. This is done automatically for the `restApi.latestDeployment` deployment.
 *
 * Furthermore, a deployment should depend on all API Gateway resources (Methods, Resources, etc.)
 * that define the API. Use the `_addMethodDependency` or directly add dependencies to ensure correct
 * provisioning order. This is also handled for `restApi.latestDeployment`.
 */
export class Deployment extends AwsConstructBase {
  public readonly deploymentId: string;
  public readonly api: IRestApi;
  /**
   * The name of the stage created and associated with this deployment, if `stageName` was provided.
   */
  public readonly stageName?: string;

  private readonly deploymentResource: apiGatewayDeployment.ApiGatewayDeployment;
  private stageResource?: apiGatewayStage.ApiGatewayStage;

  private readonly triggerComponents = new Array<any>();

  constructor(scope: Construct, id: string, props: DeploymentProps) {
    super(scope, id, props);

    this.api = props.api;

    this.deploymentResource = new apiGatewayDeployment.ApiGatewayDeployment(
      this,
      "Resource",
      {
        restApiId: props.api.restApiId,
        description: props.description,
        // ensure lifecycle create before destroy is enabled unless explicitly set to false
        lifecycle: {
          createBeforeDestroy: props.lifecycle?.createBeforeDestroy ?? true, // default to true
          ...props.lifecycle,
        },
      },
    );

    // Add triggers for redployment on checksum changes.
    this.deploymentResource.addOverride(
      "triggers",
      Lazy.anyValue({
        produce: () => this.calculateTriggers(),
      }),
    );

    // TODO: Implement RemovalPolicy.RETAIN through removed block in Terraform.
    // if (props.retainDeployments) {
    //   this.deploymentResource.addOverride("lifecycle", {
    //     prevent_destroy: true,
    //   });
    // }

    this.deploymentId = this.deploymentResource.id;

    if (props.stageName) {
      this.stageName = props.stageName;
      this.stageResource = new apiGatewayStage.ApiGatewayStage(this, "Stage", {
        restApiId: props.api.restApiId,
        deploymentId: this.deploymentResource.id,
        stageName: props.stageName,
        description: props.description
          ? `${props.description} Stage`
          : undefined,
      });
      // Dependencies on methods should be added to the deploymentResource itself.
      // The stageResource implicitly depends on deploymentResource via deploymentId.
    }

    if (props.api instanceof RestApiBase) {
      // The method _attachDeployment might need to be adapted or might not exist in TerraConstructs RestApiBase
      // This is specific to how `latestDeployment` is managed by the RestApi construct.
      (props.api as any)._attachDeployment?.(this);
    }
  }

  private calculateTriggers(): { [key: string]: string } | undefined {
    const triggers = [...this.triggerComponents];

    // Ignore IRestApi that are imported
    if (this.api instanceof RestApi || this.api instanceof SpecRestApi) {
      const apiInternal = this.api.node
        .defaultChild as apiGatewayRestApi.ApiGatewayRestApi;
      // TODO: AWSCDK Triggers redeployment on any changes (not just the body property).
      const tfRestAPI = apiInternal.toTerraform();
      triggers.push(tfRestAPI.resource.aws_api_gateway_rest_api);
    }

    // NOTE: AWSCDK calculates checksum against function properties.
    // Terraform allows use to include the entire object, so we use that for clarity.
    const checksum = md5hash(
      triggers
        .map((x) => this.stack.resolve(x))
        .map((c) => JSON.stringify(c))
        .join(""),
    );
    // triggers has to be Record<string, string> for Terraform to accept it.
    return { redeployment: checksum };

    // // NOTE: consider checksum too confusing and use full trigger objects instead?
    // // TODO: This causes "missing attributer separator" errors
    // return triggers.length !== 0
    //   ? { redeployment: Fn.sha1(Fn.jsonencode(this.stack.resolve(triggers))) }
    //   : // TODO: Wrap each trigger in sha instead? { redeployment: Fn.sha1(Fn.jsonencode()) }
    //     // triggers.reduce(
    //     //   (acc, curr) => {
    //     //     const key = `trigger-${Object.keys(acc).length + 1}`;
    //     //     acc[key] = this.stack.resolve(curr);
    //     //     return acc;
    //     //   },
    //     //   {} as { [key: string]: string },
    //     // )
    //     undefined;
  }

  /**
   * Adds a component to the set of triggers that determine if a new deployment should be created.
   *
   * Triggers should be preferred over Dependencies, since Dependencies can only capture dependency
   * ordering and will not cause the resource to recreate (redeploy the REST API) with upstream
   * configuration changes.
   *
   * This should be called by constructs of the API Gateway model that want to
   * invalidate the deployment when their settings change. The component will
   * be resolved during synthesis so tokens are welcome.
   */
  public addToTriggers(data: any) {
    if (this.node.locked) {
      throw new Error(
        "Cannot modify deployment triggers when the construct is locked.",
      );
    }
    this.triggerComponents.push(data);
  }

  /**
   * Adds a dependency from this Deployment to an API Gateway Method.
   * This ensures that the method is created before the deployment.
   *
   * @param method The Method construct to add as a dependency.
   * @internal
   */
  public _addMethodDependency(method: Method) {
    // adding a dependency between the constructs using `node.addDependency()`
    // will create additional dependencies between `aws_api_gateway_deployment`
    // and the `aws_lambda_permission` resources (children under Method),
    // causing cyclic dependency errors. Hence, falling back to declaring
    // dependencies between the underlying TerraformElements.
    this.node.addDependency(
      method.node.defaultChild as apiGatewayMethod.ApiGatewayMethod,
    );

    // TODO: Triggers are recommended instead of dependencies?
  }

  public get outputs(): Record<string, any> {
    return {
      deploymentId: this.deploymentId,
      stageName: this.stageName,
      stageInvokeUrl: this.stageResource?.invokeUrl,
    };
  }
}
