import { IAspect, Aspects, IResolvable, TerraformResource } from "cdktn";
import { IConstruct } from "constructs";
import { TaggableConstruct } from "../construct-base";

/**
 * TaggableConstruct is a Construct that can have tags
 */
export function isTaggableConstruct(x: IConstruct): x is TaggableConstruct {
  return "tags" in x && "tagsInput" in x;
}

// TODO: Implement TagsManager?
// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/core/lib/tag-aspect.ts
// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/core/lib/tag-manager.ts

/**
 * Terraform resource type of the Auto Scaling group.
 */
const AUTO_SCALING_GROUP_RESOURCE_TYPE = "aws_autoscaling_group";

/**
 * A single `tag` block of an `aws_autoscaling_group`.
 *
 * Structurally compatible with the generated
 * `autoscalingGroup.AutoscalingGroupTag` binding.
 */
interface AutoScalingGroupTag {
  readonly key: string;
  readonly value: string;
  readonly propagateAtLaunch: boolean | IResolvable;
}

/**
 * An L1 resource rendering tags as repeated `tag { key, value, propagate_at_launch }`
 * blocks instead of a flat `tags` map.
 */
type AutoScalingGroupTaggable = TerraformResource & {
  readonly tagInput?: AutoScalingGroupTag[] | IResolvable;
  putTag(value: AutoScalingGroupTag[] | IResolvable): void;
};

/**
 * Whether the node is an `aws_autoscaling_group` L1 using the structured tag schema.
 *
 * Detection is intentionally keyed off the Terraform resource type rather than the
 * presence of a singular `tag` property: several provider resources expose a `tag`
 * attribute with an entirely different schema.
 */
function isAutoScalingGroupTaggable(
  x: IConstruct,
): x is AutoScalingGroupTaggable {
  return (
    TerraformResource.isTerraformResource(x) &&
    x.terraformResourceType === AUTO_SCALING_GROUP_RESOURCE_TYPE &&
    "tagInput" in x &&
    typeof (x as AutoScalingGroupTaggable).putTag === "function"
  );
}

/**
 * A construct whose tags also reach the instances it launches.
 *
 * The launch template mirrors its tag map into `tag_specifications` for the
 * `instance` and `volume` resource types, so those tags land on every instance
 * an Auto Scaling group launches from it - independently of the group's own
 * `propagate_at_launch`.
 */
function appliesTagsToLaunchedInstances(x: IConstruct): boolean {
  return (
    (x as unknown as { appliesTagsToLaunchedInstances?: boolean })
      .appliesTagsToLaunchedInstances === true
  );
}

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

  /**
   * Whether the tag should be applied to instances launched from this scope.
   *
   * Setting this to `false` renders `propagate_at_launch: false` on the
   * `aws_autoscaling_group` `tag` block, and keeps the tag out of any
   * `LaunchTemplate`'s `instance` and `volume` tag specifications, which would
   * otherwise put it back on every launched instance. The launch template
   * resource itself is still tagged.
   *
   * Resources using the flat `tags` map are unaffected by this option.
   *
   * @default true
   */
  readonly applyToLaunchedInstances?: boolean;
}

/**
 * CDKTF Aspect adding a single Key/Value Tag to all resources within a construct scope
 *
 * Add tags using `Tags.of(scope).add(key, value)`
 *
 * Two tag schemas are supported:
 *
 * - resources exposing a flat `tags`/`tagsInput` map (the vast majority), and
 * - `aws_autoscaling_group`, which renders repeated
 *   `tag { key, value, propagate_at_launch }` blocks.
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
    // Deviation from AWS CDK v2.233.0: upstream's `applyToLaunchedInstances`
    // only drives the Auto Scaling group's own `PropagateAtLaunch`, so a tag
    // opted out there still reaches launched instances through the launch
    // template's `TagSpecifications`. Skipping that sink here makes the option
    // hold end to end. The launch template's L1 resource is a separate node, so
    // it keeps the tag.
    if (
      this.props.applyToLaunchedInstances === false &&
      appliesTagsToLaunchedInstances(node)
    ) {
      return;
    }
    if (isAutoScalingGroupTaggable(node)) {
      if (
        this.applyTagAspectHere(
          node,
          this.props.includeResourceTypes,
          this.props.excludeResourceTypes,
        )
      ) {
        this.visitAutoScalingGroup(node);
      }
      return;
    }
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
      node.tags = { ...currentTags, [this.key]: this.value };
    }
  }

  /**
   * Merge this tag into the structured `tag` blocks of an `aws_autoscaling_group`.
   *
   * Unrelated entries are preserved in place. An entry already carrying this key -
   * whether it came from the L1 escape hatch or from an earlier aspect - is replaced,
   * so exactly one block per key is synthesized and a `Tags.of()` write always wins.
   */
  private visitAutoScalingGroup(node: AutoScalingGroupTaggable) {
    const currentTags = node.tagInput;
    if (currentTags !== undefined && !Array.isArray(currentTags)) {
      // A whole-list token cannot be merged without silently discarding it.
      throw new Error(
        `Cannot add tag "${this.key}" to ${node.node.path}: the ${AUTO_SCALING_GROUP_RESOURCE_TYPE} ` +
          "'tag' input is an unresolved value (IResolvable) which this aspect cannot merge into. " +
          "Provide the tags as a concrete list of tag blocks instead.",
      );
    }

    const newTag: AutoScalingGroupTag = {
      key: this.key,
      value: this.value,
      propagateAtLaunch: this.props.applyToLaunchedInstances !== false,
    };

    let replaced = false;
    const tags: AutoScalingGroupTag[] = [];
    for (const tag of currentTags ?? []) {
      // Entries with an unresolved key cannot be compared - keep them as-is.
      if (tag?.key !== this.key) {
        tags.push(tag);
        continue;
      }
      if (!replaced) {
        tags.push(newTag);
        replaced = true;
      }
    }
    if (!replaced) {
      tags.push(newTag);
    }

    node.putTag(tags);
  }

  private applyTagAspectHere(
    node: TerraformResource,
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
   *
   * A tag written here always wins over an entry for the same key already
   * present on the underlying L1 resource.
   */
  public add(key: string, value: string, props: TagProps = {}) {
    Aspects.of(this.scope).add(new AwsTag(key, value, props));
  }
}
