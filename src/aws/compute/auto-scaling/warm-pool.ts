// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/lib/warm-pool.ts

import { autoscalingGroup } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import type { IAutoScalingGroup } from "./auto-scaling-group";
import { ValidationError } from "../../../errors";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";
import { filterUndefined } from "../../util";

/**
 * Options for a warm pool
 */
export interface WarmPoolOptions {
  /**
   * Indicates whether instances in the Auto Scaling group can be returned to the warm pool on scale in.
   *
   * If the value is not specified, instances in the Auto Scaling group will be terminated
   * when the group scales in.
   *
   * @default false
   */
  readonly reuseOnScaleIn?: boolean;

  /**
   * The maximum number of instances that are allowed to be in the warm pool
   * or in any state except Terminated for the Auto Scaling group.
   *
   * If the value is not specified, Amazon EC2 Auto Scaling launches and maintains
   * the difference between the group's maximum capacity and its desired capacity.
   *
   * @default - max size of the Auto Scaling group
   */
  readonly maxGroupPreparedCapacity?: number;
  /**
   * The minimum number of instances to maintain in the warm pool.
   *
   * @default 0
   */
  readonly minSize?: number;
  /**
   * The instance state to transition to after the lifecycle actions are complete.
   *
   * @default PoolState.STOPPED
   */
  readonly poolState?: PoolState;
}

/**
 * Properties for a warm pool
 */
export interface WarmPoolProps extends WarmPoolOptions, AwsConstructProps {
  /**
   * The Auto Scaling group to add the warm pool to.
   */
  readonly autoScalingGroup: IAutoScalingGroup;
}

/**
 * Define a warm pool
 *
 * Terraform-specific deviation from the CloudFormation model: CloudFormation
 * represents a warm pool as its own resource (`AWS::AutoScaling::WarmPool` /
 * `CfnWarmPool`) that references its Auto Scaling group by name. The
 * `aws_autoscaling_group` Terraform resource has no standalone warm-pool
 * counterpart - warm pool configuration is only available as an inline
 * `warm_pool` block on the `aws_autoscaling_group` resource itself. This
 * construct therefore does not create a resource of its own; instead it
 * late-binds the warm pool configuration onto the underlying
 * `autoscalingGroup.AutoscalingGroup` L1 resource of the `AutoScalingGroup`
 * construct passed in via `autoScalingGroup`. Because of this, `WarmPool`
 * only works with a concrete (in-scope) `AutoScalingGroup` construct - it
 * cannot attach a warm pool to an imported/external Auto Scaling group,
 * since there is no way in Terraform to merge a nested block into a resource
 * this stack does not manage.
 */
export class WarmPool extends AwsConstructBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.autoscaling.WarmPool";

  /**
   * The Auto Scaling group this warm pool is attached to.
   */
  public readonly autoScalingGroup: IAutoScalingGroup;

  constructor(scope: Construct, id: string, props: WarmPoolProps) {
    super(scope, id, props);

    if (props.maxGroupPreparedCapacity && props.maxGroupPreparedCapacity < -1) {
      throw new ValidationError(
        "'maxGroupPreparedCapacity' parameter should be greater than or equal to -1",
        this,
      );
    }

    if (props.minSize && props.minSize < 0) {
      throw new ValidationError(
        "'minSize' parameter should be greater than or equal to 0",
        this,
      );
    }

    this.autoScalingGroup = props.autoScalingGroup;

    // Terraform deviation: locate the underlying L1 resource of the parent
    // AutoScalingGroup construct and merge the warm_pool block into it,
    // rather than emitting a standalone AWS::AutoScaling::WarmPool-style
    // resource (see class-level doc comment).
    const asgResource = (
      props.autoScalingGroup as Partial<{
        resource: autoscalingGroup.AutoscalingGroup;
      }>
    ).resource;

    if (
      !asgResource ||
      !(asgResource instanceof autoscalingGroup.AutoscalingGroup)
    ) {
      throw new ValidationError(
        "WarmPool requires a concrete (in-scope) AutoScalingGroup - it cannot be attached to an imported/external Auto Scaling group because Terraform has no standalone warm pool resource to represent it with",
        this,
      );
    }

    // Terraform deviation: the generated L1 `warm_pool` complex object only
    // renders a block when the config object passed to `putWarmPool` has at
    // least one own key (an object of all-`undefined` values is treated as
    // "no values set" and the block is dropped entirely). Use
    // `filterUndefined` so that calling `addWarmPool()` with no options
    // still emits an (empty) `warm_pool {}` block - enabling a warm pool
    // with all-default settings, matching the CloudFormation behavior of
    // creating a bare `AWS::AutoScaling::WarmPool` resource.
    asgResource.putWarmPool(
      filterUndefined({
        instanceReusePolicy:
          props.reuseOnScaleIn !== undefined
            ? {
                reuseOnScaleIn: props.reuseOnScaleIn,
              }
            : undefined,
        maxGroupPreparedCapacity: props.maxGroupPreparedCapacity,
        minSize: props.minSize,
        poolState: props.poolState,
      }),
    );
  }

  public get outputs(): Record<string, any> {
    return {
      autoScalingGroupName: this.autoScalingGroup.autoScalingGroupName,
    };
  }
}

/**
 * The instance state in the warm pool
 */
export enum PoolState {
  /**
   * Hibernated
   *
   * To use this state, prerequisites must be in place.
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/hibernating-prerequisites.html
   */
  HIBERNATED = "Hibernated",

  /**
   * Running
   */
  RUNNING = "Running",

  /**
   * Stopped
   */
  STOPPED = "Stopped",
}
