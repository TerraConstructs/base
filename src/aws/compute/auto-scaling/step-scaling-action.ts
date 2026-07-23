// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/lib/step-scaling-action.ts

import { autoscalingPolicy } from "@cdktn/provider-aws";
import { Annotations, Lazy } from "cdktn";
import { Construct } from "constructs";
import type { IAutoScalingGroup } from "./auto-scaling-group";
import { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";

/**
 * Properties for a scaling policy
 */
export interface StepScalingActionProps extends AwsConstructProps {
  /**
   * The auto scaling group
   */
  readonly autoScalingGroup: IAutoScalingGroup;

  /**
   * Period after a scaling completes before another scaling activity can start.
   *
   * @default The default cooldown configured on the AutoScalingGroup
   * @deprecated cooldown is not valid with step scaling action
   */
  readonly cooldown?: Duration;

  /**
   * Estimated time until a newly launched instance can send metrics to CloudWatch.
   *
   * @default Same as the cooldown
   */
  readonly estimatedInstanceWarmup?: Duration;

  /**
   * How the adjustment numbers are interpreted
   *
   * @default ChangeInCapacity
   */
  readonly adjustmentType?: AdjustmentType;

  /**
   * Minimum absolute number to adjust capacity with as result of percentage scaling.
   *
   * Only when using AdjustmentType = PercentChangeInCapacity, this number controls
   * the minimum absolute effect size.
   *
   * @default No minimum scaling effect
   */
  readonly minAdjustmentMagnitude?: number;

  /**
   * The aggregation type for the CloudWatch metrics.
   *
   * @default Average
   */
  readonly metricAggregationType?: MetricAggregationType;
}

/**
 * Define a step scaling action
 *
 * This kind of scaling policy adjusts the target capacity in configurable
 * steps. The size of the step is configurable based on the metric's distance
 * to its alarm threshold.
 *
 * This Action must be used as the target of a CloudWatch alarm to take effect.
 */
export class StepScalingAction extends AwsConstructBase {
  /**
   * ARN of the scaling policy
   */
  public readonly scalingPolicyArn: string;

  /**
   * The underlying aws_autoscaling_policy resource (maps CfnScalingPolicy).
   */
  public readonly resource: autoscalingPolicy.AutoscalingPolicy;

  private readonly adjustments =
    new Array<autoscalingPolicy.AutoscalingPolicyStepAdjustment>();

  public get outputs(): Record<string, any> {
    return {
      scalingPolicyArn: this.scalingPolicyArn,
    };
  }

  constructor(scope: Construct, id: string, props: StepScalingActionProps) {
    super(scope, id, props);

    // Specify cooldown property in StepScaling policy type is ineffective and may cause deployment failure
    // in certain regions. We can't simply remove the property since it break existing users. Since setting
    // this value is ineffective, we can safely ignore the value of this property with a warning.
    if (props.cooldown) {
      // "@aws-cdk/aws-autoscaling:cooldownOnStepScaling"
      Annotations.of(this).addWarning(
        "'Cooldown' is valid only if the policy type is SimpleScaling. Default to ignore the values set.",
      );
    }

    // CFN auto-generates the policy name and only exposes it via Fn::GetAtt; the
    // Terraform aws_autoscaling_policy resource has no name_prefix knob and requires
    // `name` as an input, so synthesize a deterministic name from the construct id.
    const policyName = this.stack.uniqueResourceName(this, {
      prefix: this.gridUUID,
      maxLength: 255,
    });

    this.resource = new autoscalingPolicy.AutoscalingPolicy(this, "Resource", {
      name: policyName,
      policyType: "StepScaling",
      autoscalingGroupName: props.autoScalingGroup.autoScalingGroupName,
      estimatedInstanceWarmup:
        props.estimatedInstanceWarmup &&
        props.estimatedInstanceWarmup.toSeconds(),
      adjustmentType: props.adjustmentType,
      minAdjustmentMagnitude: props.minAdjustmentMagnitude,
      metricAggregationType: props.metricAggregationType,
      stepAdjustment: Lazy.anyValue({ produce: () => this.adjustments }),
    });

    this.scalingPolicyArn = this.resource.arn;
  }

  /**
   * Add an adjustment interval to the ScalingAction
   */
  public addAdjustment(adjustment: AdjustmentTier) {
    if (
      adjustment.lowerBound === undefined &&
      adjustment.upperBound === undefined
    ) {
      throw new ValidationError(
        "At least one of lowerBound or upperBound is required",
        this,
      );
    }
    this.adjustments.push({
      metricIntervalLowerBound: adjustment.lowerBound?.toString(),
      metricIntervalUpperBound: adjustment.upperBound?.toString(),
      scalingAdjustment: adjustment.adjustment,
    });
  }
}

/**
 * How adjustment numbers are interpreted
 */
export enum AdjustmentType {
  /**
   * Add the adjustment number to the current capacity.
   *
   * A positive number increases capacity, a negative number decreases capacity.
   */
  CHANGE_IN_CAPACITY = "ChangeInCapacity",

  /**
   * Add this percentage of the current capacity to itself.
   *
   * The number must be between -100 and 100; a positive number increases
   * capacity and a negative number decreases it.
   */
  PERCENT_CHANGE_IN_CAPACITY = "PercentChangeInCapacity",

  /**
   * Make the capacity equal to the exact number given.
   */
  EXACT_CAPACITY = "ExactCapacity",
}

/**
 * How the scaling metric is going to be aggregated
 */
export enum MetricAggregationType {
  /**
   * Average
   */
  AVERAGE = "Average",

  /**
   * Minimum
   */
  MINIMUM = "Minimum",

  /**
   * Maximum
   */
  MAXIMUM = "Maximum",
}

/**
 * An adjustment
 */
export interface AdjustmentTier {
  /**
   * What number to adjust the capacity with
   *
   * The number is interpreted as an added capacity, a new fixed capacity or an
   * added percentage depending on the AdjustmentType value of the
   * StepScalingPolicy.
   *
   * Can be positive or negative.
   */
  readonly adjustment: number;

  /**
   * Lower bound where this scaling tier applies.
   *
   * The scaling tier applies if the difference between the metric
   * value and its alarm threshold is higher than this value.
   *
   * @default -Infinity if this is the first tier, otherwise the upperBound of the previous tier
   */
  readonly lowerBound?: number;

  /**
   * Upper bound where this scaling tier applies
   *
   * The scaling tier applies if the difference between the metric
   * value and its alarm threshold is lower than this value.
   *
   * @default +Infinity
   */
  readonly upperBound?: number;
}
