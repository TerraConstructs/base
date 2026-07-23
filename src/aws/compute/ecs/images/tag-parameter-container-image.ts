// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/images/tag-parameter-container-image.ts

import { TerraformVariable, VariableType } from "cdktn";
import { Construct } from "constructs";
import { UnscopedValidationError } from "../../../../errors";
import * as ecr from "../../../storage";
import { ContainerDefinition } from "../container-definition";
import { ContainerImage, ContainerImageConfig } from "../container-image";

/**
 * A special type of `ContainerImage` that uses an ECR repository for the image,
 * but a deploy-time Terraform variable for the tag of the image in that repository.
 * This allows providing this tag through the variable at deploy time,
 * for example in a CodePipeline that pushes a new tag of the image to the repository during a build step,
 * and then provides that new tag through the Terraform variable in the deploy step.
 *
 * // TERRACONSTRUCTS DEVIATION: upstream parameterizes the tag via a CloudFormation `CfnParameter`
 * (rendered into the template's `Parameters:` section). There is no terraform-provider-aws resource
 * backing a template-input parameter -- the closest Terraform equivalent is a root-module `variable`
 * block, modeled here with cdktn's `TerraformVariable`. `imageTagParameter.valueAsString` becomes
 * `imageTagParameter.stringValue`, and `imageTagParameter.logicalId` becomes
 * `imageTagParameter.friendlyUniqueId` (the nearest cdktn analog for a stable, human-readable
 * identifier for the variable).
 *
 * @see #tagParameterName
 */
export class TagParameterContainerImage extends ContainerImage {
  private readonly repository: ecr.IRepository;
  private imageTagParameter?: TerraformVariable;

  public constructor(repository: ecr.IRepository) {
    super();
    this.repository = repository;
  }

  public bind(
    scope: Construct,
    containerDefinition: ContainerDefinition,
  ): ContainerImageConfig {
    this.repository.grantPull(
      containerDefinition.taskDefinition.obtainExecutionRole(),
    );
    const imageTagParameter = new TerraformVariable(scope, "ImageTagParam", {
      type: VariableType.STRING,
    });
    this.imageTagParameter = imageTagParameter;
    return {
      imageName: this.repository.repositoryUriForTag(
        imageTagParameter.stringValue,
      ),
    };
  }

  /**
   * Returns the name of the Terraform variable that represents the tag of the image
   * in the ECR repository.
   */
  public get tagParameterName(): string {
    if (!this.imageTagParameter) {
      throw new UnscopedValidationError(
        "TagParameterContainerImage must be used in a container definition when using tagParameterName",
      );
    }
    return this.imageTagParameter.friendlyUniqueId;
  }

  /**
   * Returns the value of the Terraform variable that represents the tag of the image
   * in the ECR repository.
   */
  public get tagParameterValue(): string {
    if (!this.imageTagParameter) {
      throw new UnscopedValidationError(
        "TagParameterContainerImage must be used in a container definition when using tagParameterValue",
      );
    }
    return this.imageTagParameter.stringValue;
  }
}
