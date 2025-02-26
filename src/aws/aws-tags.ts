import { IAspect, Aspects } from "cdktf";
import { IConstruct } from "constructs";
import { isTaggableConstruct, TaggableConstruct } from "../construct-base";

// TODO: Implement TagsManager?
// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/core/lib/tag-aspect.ts
// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/core/lib/tag-manager.ts

/**
 * Properties for a tag
 */
export interface TagProps {
  /**
   * An array of Resource Types that will not receive this tag
   *
   * An empty array will allow this tag to be applied to all resources. A
   * non-empty array will apply this tag only if the Resource type is not in
   * this array.
   * @default []
   */
  readonly excludeResourceTypes?: string[];

  /**
   * An array of Resource Types that will receive this tag
   *
   * An empty array will match any Resource. A non-empty array will apply this
   * tag only to Resource types that are included in this array.
   * @default []
   */
  readonly includeResourceTypes?: string[];
}

/**
 * CDKTF Aspect adding a single Key/Value Tag to all resources within a construct scope
 *
 * Add tags using `Tags.of(scope).add(key, value)`
 */
export class AwsTag implements IAspect {
  private value: string;
  private readonly props: TagProps;

  constructor(
    private key: string,
    value: string,
    props: TagProps = {},
  ) {
    this.props = props;
    if (value === undefined) {
      throw new Error("Tag must have a value");
    }
    this.value = value;
  }
  visit(node: IConstruct) {
    if (
      isTaggableConstruct(node) &&
      this.applyTagAspectHere(
        node,
        this.props.includeResourceTypes,
        this.props.excludeResourceTypes,
      )
    ) {
      // https://developer.hashicorp.com/terraform/cdktf/concepts/aspects
      const currentTags = node.tagsInput || {};
      node.tags = { [this.key]: this.value, ...currentTags };
    }
  }

  private applyTagAspectHere(
    node: TaggableConstruct,
    include?: string[],
    exclude?: string[],
  ) {
    if (
      exclude &&
      exclude.length > 0 &&
      exclude.indexOf(node.terraformResourceType) !== -1
    ) {
      return false;
    }
    if (
      include &&
      include.length > 0 &&
      include.indexOf(node.terraformResourceType) === -1
    ) {
      return false;
    }

    return true;
  }
}

/**
 * Manages AWS tags for all resources within a construct scope.
 */
export class Tags {
  /**
   * Returns the tags API for this scope.
   * @param scope The scope
   */
  public static of(scope: IConstruct): Tags {
    return new Tags(scope);
  }

  private constructor(private readonly scope: IConstruct) {}

  /**
   * add tags to the node of a construct and all its the taggable children
   */
  public add(key: string, value: string, props: TagProps = {}) {
    Aspects.of(this.scope).add(new AwsTag(key, value, props));
  }
}
