// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-ecr/lib/lifecycle.ts

import { Duration } from "../../duration";

/**
 * An ECR life cycle rule
 */
export interface LifecycleRule {
  /**
   * Controls the order in which rules are evaluated (low to high)
   *
   * All rules must have a unique priority, where lower numbers have
   * higher precedence. The first rule that matches is applied to an image.
   *
   * There can only be one rule with a tagStatus of Any, and it must have
   * the highest rulePriority.
   *
   * All rules without a specified priority will have incrementing priorities
   * automatically assigned to them, higher than any rules that DO have priorities.
   *
   * @default Automatically assigned
   */
  readonly rulePriority?: number;

  /**
   * Describes the purpose of the rule
   *
   * @default No description
   */
  readonly description?: string;

  /**
   * Select images based on tags
   *
   * Only one rule is allowed to select untagged images, and it must
   * have the highest rulePriority.
   *
   * @default TagStatus.Tagged if tagPrefixList or tagPatternList is
   * given, TagStatus.Any otherwise
   */
  readonly tagStatus?: TagStatus;

  /**
   * Select images that have ALL the given prefixes in their tag.
   *
   * Both tagPrefixList and tagPatternList cannot be specified
   * together in a rule.
   *
   * Only if tagStatus == TagStatus.Tagged
   */
  readonly tagPrefixList?: string[];

  /**
   * Select images that have ALL the given patterns in their tag.
   *
   * There is a maximum limit of four wildcards (*) per string.
   * For example, ["*test*1*2*3", "test*1*2*3*"] is valid but
   * ["test*1*2*3*4*5*6"] is invalid.
   *
   * Both tagPrefixList and tagPatternList cannot be specified
   * together in a rule.
   *
   * Only if tagStatus == TagStatus.Tagged
   */
  readonly tagPatternList?: string[];

  /**
   * The maximum number of images to retain
   *
   * Specify exactly one of maxImageCount and maxImageAge.
   */
  readonly maxImageCount?: number;

  /**
   * The maximum age of images to retain. The value must represent a number of days.
   *
   * Specify exactly one of maxImageCount and maxImageAge.
   */
  readonly maxImageAge?: Duration;
}

/**
 * Select images based on tags
 */
export enum TagStatus {
  /**
   * Rule applies to all images
   */
  ANY = "any",

  /**
   * Rule applies to tagged images
   */
  TAGGED = "tagged",

  /**
   * Rule applies to untagged images
   */
  UNTAGGED = "untagged",
}
