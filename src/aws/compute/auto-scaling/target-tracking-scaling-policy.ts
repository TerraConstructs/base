// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/lib/target-tracking-scaling-policy.ts

import { autoscalingPolicy } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { IAutoScalingGroup } from "./auto-scaling-group";
import { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";
import * as cloudwatch from "../../cloudwatch";

/**
 * Base interface for target tracking props
 *
 * Contains the attributes that are common to target tracking policies,
 * except the ones relating to the metric and to the scalable target.
 *
 * This interface is reused by more specific target tracking props objects.
 */
export interface BaseTargetTrackingProps {
  /**
   * Indicates whether scale in by the target tracking policy is disabled.
   *
   * If the value is true, scale in is disabled and the target tracking policy
   * won't remove capacity from the autoscaling group. Otherwise, scale in is
   * enabled and the target tracking policy can remove capacity from the
   * group.
   *
   * @default false
   */
  readonly disableScaleIn?: boolean;

  /**
   * Period after a scaling completes before another scaling activity can start.
   *
   * @default - The default cooldown configured on the AutoScalingGroup.
   */
  readonly cooldown?: Duration;

  /**
   * Estimated time until a newly launched instance can send metrics to CloudWatch.
   *
   * @default - Same as the cooldown.
   */
  readonly estimatedInstanceWarmup?: Duration;
}

/**
 * Properties for a Target Tracking policy that include the metric but exclude the target
 */
export interface BasicTargetTrackingScalingPolicyProps
  extends BaseTargetTrackingProps {
  /**
   * The target value for the metric.
   */
  readonly targetValue: number;

  /**
   * A predefined metric for application autoscaling
   *
   * The metric must track utilization. Scaling out will happen if the metric is higher than
   * the target value, scaling in will happen in the metric is lower than the target value.
   *
   * Exactly one of customMetric or predefinedMetric must be specified.
   *
   * @default - No predefined metric.
   */
  readonly predefinedMetric?: PredefinedMetric;

  /**
   * A custom metric for application autoscaling
   *
   * The metric must track utilization. Scaling out will happen if the metric is higher than
   * the target value, scaling in will happen in the metric is lower than the target value.
   *
   * Exactly one of customMetric or predefinedMetric must be specified.
   *
   * @default - No custom metric.
   */
  readonly customMetric?: cloudwatch.IMetric;

  /**
   * The resource label associated with the predefined metric
   *
   * Should be supplied if the predefined metric is ALBRequestCountPerTarget, and the
   * format should be:
   *
   * app/<load-balancer-name>/<load-balancer-id>/targetgroup/<target-group-name>/<target-group-id>
   *
   * @default - No resource label.
   */
  readonly resourceLabel?: string;
}

/**
 * Properties for a concrete TargetTrackingPolicy
 *
 * Adds the scalingTarget.
 */
export interface TargetTrackingScalingPolicyProps
  extends BasicTargetTrackingScalingPolicyProps,
    AwsConstructProps {
  /*
   * The auto scaling group
   */
  readonly autoScalingGroup: IAutoScalingGroup;
}

export class TargetTrackingScalingPolicy extends AwsConstructBase {
  /**
   * ARN of the scaling policy
   */
  public readonly scalingPolicyArn: string;

  /**
   * The resource object
   */
  public readonly resource: autoscalingPolicy.AutoscalingPolicy;

  public get outputs(): Record<string, any> {
    return {
      scalingPolicyArn: this.scalingPolicyArn,
    };
  }

  constructor(
    scope: Construct,
    id: string,
    props: TargetTrackingScalingPolicyProps,
  ) {
    super(scope, id, props);

    if (
      (props.customMetric === undefined) ===
      (props.predefinedMetric === undefined)
    ) {
      throw new ValidationError(
        "Exactly one of 'customMetric' or 'predefinedMetric' must be specified.",
        this,
      );
    }

    if (
      props.predefinedMetric === PredefinedMetric.ALB_REQUEST_COUNT_PER_TARGET &&
      !props.resourceLabel
    ) {
      throw new ValidationError(
        "When tracking the ALBRequestCountPerTarget metric, the ALB identifier must be supplied in resourceLabel",
        this,
      );
    }

    if (props.customMetric && !props.customMetric.toMetricConfig().metricStat) {
      throw new ValidationError(
        "Only direct metrics are supported for Target Tracking. Use Step Scaling or supply a Metric object.",
        this,
      );
    }

    // CFN's ScalingPolicy auto-generates its PolicyName and only exposes it via
    // Fn::GetAtt; the Terraform aws_autoscaling_policy resource instead requires
    // `name` as an input, so synthesize a deterministic one from the construct id.
    const policyName = this.friendlyName;

    this.resource = new autoscalingPolicy.AutoscalingPolicy(this, "Resource", {
      name: policyName,
      policyType: "TargetTrackingScaling",
      autoscalingGroupName: props.autoScalingGroup.autoScalingGroupName,
      // CFN cooldown/estimatedInstanceWarmup are seconds (cooldown as a string,
      // estimatedInstanceWarmup as a number); the TF resource takes both as
      // numbers, so no `.toString()` coercion is needed here for cooldown.
      cooldown: props.cooldown?.toSeconds(),
      estimatedInstanceWarmup: props.estimatedInstanceWarmup?.toSeconds(),
      targetTrackingConfiguration: {
        customizedMetricSpecification: renderCustomMetric(
          this,
          props.customMetric,
        ),
        disableScaleIn: props.disableScaleIn,
        predefinedMetricSpecification:
          props.predefinedMetric !== undefined
            ? {
                predefinedMetricType: props.predefinedMetric,
                resourceLabel: props.resourceLabel,
              }
            : undefined,
        targetValue: props.targetValue,
      },
    });

    this.scalingPolicyArn = this.resource.arn;
  }
}

function renderCustomMetric(
  scope: Construct,
  metric?: cloudwatch.IMetric,
):
  | autoscalingPolicy.AutoscalingPolicyTargetTrackingConfigurationCustomizedMetricSpecification
  | undefined {
  if (!metric) {
    return undefined;
  }
  const c = metric.toMetricConfig().metricStat;
  if (!c) {
    throw new ValidationError(
      "Only direct metrics are supported for Target Tracking. Use Step Scaling or supply a Metric object.",
      scope,
    );
  }

  // CFN's CustomizedMetricSpecificationProperty.dimensions is a Dimension[];
  // the terraconstructs cloudwatch metric config exposes dimensions as a
  // Record<string, string>, so re-shape into the TF `metric_dimension` block
  // list (AutoscalingPolicyTargetTrackingConfigurationCustomizedMetricSpecificationMetricDimension).
  const metricDimension: autoscalingPolicy.AutoscalingPolicyTargetTrackingConfigurationCustomizedMetricSpecificationMetricDimension[] =
    Object.entries(c.dimensions ?? {}).map(([name, value]) => ({
      name,
      value,
    }));

  return {
    metricDimension,
    metricName: c.metricName,
    namespace: c.namespace,
    statistic: c.statistic,
    unit: c.unitFilter,
  };
}

/**
 * One of the predefined autoscaling metrics
 */
export enum PredefinedMetric {
  /**
   * Average CPU utilization of the Auto Scaling group
   */
  ASG_AVERAGE_CPU_UTILIZATION = "ASGAverageCPUUtilization",

  /**
   * Average number of bytes received on all network interfaces by the Auto Scaling group
   */
  ASG_AVERAGE_NETWORK_IN = "ASGAverageNetworkIn",

  /**
   * Average number of bytes sent out on all network interfaces by the Auto Scaling group
   */
  ASG_AVERAGE_NETWORK_OUT = "ASGAverageNetworkOut",

  /**
   * Number of requests completed per target in an Application Load Balancer target group
   *
   * Specify the ALB to look at in the `resourceLabel` field.
   */
  ALB_REQUEST_COUNT_PER_TARGET = "ALBRequestCountPerTarget",
}
