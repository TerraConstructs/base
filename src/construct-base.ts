import {
  Lazy,
  TerraformResource,
  TerraformElement,
  TerraformOutput,
  TerraformMetaArguments,
  Aspects,
  IAspect,
} from "cdktf";
import { Construct, IConstruct } from "constructs";
import { StackBase } from "./stack-base";

export interface TerraConstructProps extends TerraformMetaArguments {
  /**
   * The friendly name for TerraConstruct resources
   *
   * @default - `environmentName-id`
   */
  readonly friendlyName?: string;

  /**
   * Whether to register Terraform outputs for this TerraConstruct
   *
   * @default false
   */
  readonly registerOutputs?: boolean;

  /**
   * Optional override for the outputs name
   *
   * @default id
   */
  readonly outputName?: string;
}

export interface ITerraConstruct extends IConstruct {
  /**
   * Environment Name passed in from the CLI
   */
  readonly environmentName: string;
  readonly gridUUID: string;
  readonly outputs: Record<string, any>;
}

// TODO: this is aws specific, should be moved to aws module
export type TaggableConstruct = TerraformResource & {
  tags?: { [key: string]: string };
  tagsInput?: { [key: string]: string };
};

// TODO: this is aws specific, should be moved to aws module
export function isTaggableTerraformResource(
  x: IConstruct,
): x is TaggableConstruct {
  return (
    TerraformResource.isTerraformResource(x) && "tags" in x && "tagsInput" in x
  );
}

const GRID_TAG_PREFIX = "grid";

// Add Grid Tags to all TerraConstruct resources
export class GridTags implements IAspect {
  constructor(private tagsToAdd: Record<string, string>) {}
  visit(node: IConstruct) {
    if (isTaggableTerraformResource(node)) {
      // https://developer.hashicorp.com/terraform/cdktf/concepts/aspects
      const currentTags = node.tagsInput || {};
      // TODO: Bug - tagsToAdd are overwritten by currenTags
      node.tags = { ...this.tagsToAdd, ...currentTags };
    }
  }
}

/**
 * Base class for all TerraConstructs
 *
 * Allows a TerraConstruct to lazily register its outputs with its parent Stack
 */
export abstract class TerraConstructBase
  extends TerraformElement
  implements ITerraConstruct
{
  /**
   * Returns true if the construct was created by CDKTF, and false otherwise
   */
  public static isOwnedResource(construct: IConstruct): boolean {
    return construct.node.defaultChild
      ? TerraformResource.isTerraformResource(construct.node.defaultChild)
      : false;
  }

  /**
   * The name under which the outputs are registered in the parent Scope
   */
  public readonly outputName: string;

  /**
   * TerraConstruct friendly name
   */
  public readonly friendlyName: string;

  /**
   * TerraConstruct unique grid identifier
   */
  public get gridUUID(): string {
    return StackBase.ofTerraConstruct(this).gridUUID;
  }

  /**
   * Environment Name passed in from the CLI
   */
  public get environmentName(): string {
    return StackBase.ofTerraConstruct(this).environmentName;
  }

  /**
   * Outputs to register with the parent Scope or undefined if there are no outputs
   */
  public abstract get outputs(): Record<string, any>; // TODO: should be allowed to be undefined?

  constructor(
    scope: Construct,
    private readonly constructId: string,
    props: TerraConstructProps = {},
  ) {
    super(scope, constructId);
    this.outputName = props.outputName || `${constructId}Outputs`;
    this.friendlyName =
      props.friendlyName || `${this.environmentName}-${constructId}`;

    Aspects.of(this) // Add Grid tags to every resource defined within.
      .add(
        new GridTags({
          [`${GRID_TAG_PREFIX}:EnvironmentName`]: this.environmentName,
          [`${GRID_TAG_PREFIX}:UUID`]: this.gridUUID,
          Name: this.friendlyName,
        }),
      );
    const registerOutputs = props.registerOutputs || false;
    if (registerOutputs) {
      new TerraformOutput(scope, this.outputName, {
        staticId: true,
        description: `Outputs for ${this.friendlyName}`,
        value: Lazy.anyValue({ produce: () => this.outputs || null }),
      });
    }
  }

  // force usage of node.addDependency instead of passing TerraConstructs via dependsOn
  // Referring a TerraConstruct by fqn always triggers an error?
  public get fqn(): string {
    // try {
    //   return super.fqn;
    // } catch (e) {
    // ref: https://github.com/aws/constructs/blob/10.x/src/construct.ts#L345
    throw new Error(
      `Use Construct node.addDependency instead of passing TerraConstruct fqn ${this.constructor.name} ${this.constructId}`,
    );
    // }
  }
}
