// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/base/scalable-task-count.ts

import { Construct } from "constructs";
import * as cloudwatch from "../../../cloudwatch";
import { ApplicationTargetGroup } from "../../alb/application-target-group";
import {
  BaseScalableAttribute,
  BaseScalableAttributeProps,
} from "../../base-scalable-attribute";
import { ScalingSchedule } from "../../scalable-target";
import { BasicStepScalingPolicyProps } from "../../step-scaling-policy";
import {
  BaseTargetTrackingProps,
  PredefinedMetric,
} from "../../target-tracking-scaling-policy";

/**
 * The properties of a scalable attribute representing task count.
 */
export interface ScalableTaskCountProps extends BaseScalableAttributeProps {}

/**
 * The scalable attribute representing task count.
 */
export class ScalableTaskCount extends BaseScalableAttribute {
  /**
   * Constructs a new instance of the ScalableTaskCount class.
   */
  constructor(scope: Construct, id: string, props: ScalableTaskCountProps) {
    super(scope, id, props);
  }

  /**
   * Scales in or out based on a specified scheduled time.
   */
  public scaleOnSchedule(id: string, props: ScalingSchedule) {
    return super.doScaleOnSchedule(id, props);
  }

  /**
   * Scales in or out based on a specified metric value.
   */
  public scaleOnMetric(id: string, props: BasicStepScalingPolicyProps) {
    return super.doScaleOnMetric(id, props);
  }

  /**
   * Scales in or out to achieve a target CPU utilization.
   */
  public scaleOnCpuUtilization(id: string, props: CpuUtilizationScalingProps) {
    return super.doScaleToTrackMetric(id, {
      predefinedMetric: PredefinedMetric.ECS_SERVICE_AVERAGE_CPU_UTILIZATION,
      policyName: props.policyName,
      disableScaleIn: props.disableScaleIn,
      targetValue: props.targetUtilizationPercent,
      scaleInCooldown: props.scaleInCooldown,
      scaleOutCooldown: props.scaleOutCooldown,
    });
  }

  /**
   * Scales in or out to achieve a target memory utilization.
   */
  public scaleOnMemoryUtilization(
    id: string,
    props: MemoryUtilizationScalingProps,
  ) {
    return super.doScaleToTrackMetric(id, {
      predefinedMetric: PredefinedMetric.ECS_SERVICE_AVERAGE_MEMORY_UTILIZATION,
      targetValue: props.targetUtilizationPercent,
      policyName: props.policyName,
      disableScaleIn: props.disableScaleIn,
      scaleInCooldown: props.scaleInCooldown,
      scaleOutCooldown: props.scaleOutCooldown,
    });
  }

  /**
   * Scales in or out to achieve a target Application Load Balancer request count per target.
   */
  public scaleOnRequestCount(id: string, props: RequestCountScalingProps) {
    const resourceLabel =
      props.targetGroup.firstLoadBalancerFullName +
      "/" +
      props.targetGroup.targetGroupFullName;

    return super.doScaleToTrackMetric(id, {
      predefinedMetric: PredefinedMetric.ALB_REQUEST_COUNT_PER_TARGET,
      resourceLabel,
      targetValue: props.requestsPerTarget,
      policyName: props.policyName,
      disableScaleIn: props.disableScaleIn,
      scaleInCooldown: props.scaleInCooldown,
      scaleOutCooldown: props.scaleOutCooldown,
    });
  }

  /**
   * Scales in or out to achieve a target on a custom metric.
   */
  public scaleToTrackCustomMetric(id: string, props: TrackCustomMetricProps) {
    return super.doScaleToTrackMetric(id, {
      customMetric: props.metric,
      targetValue: props.targetValue,
      policyName: props.policyName,
      disableScaleIn: props.disableScaleIn,
      scaleInCooldown: props.scaleInCooldown,
      scaleOutCooldown: props.scaleOutCooldown,
    });
  }
}

/**
 * The properties for enabling scaling based on CPU utilization.
 */
export interface CpuUtilizationScalingProps extends BaseTargetTrackingProps {
  /**
   * The target value for CPU utilization across all tasks in the service.
   */
  readonly targetUtilizationPercent: number;
}

/**
 * The properties for enabling scaling based on memory utilization.
 */
export interface MemoryUtilizationScalingProps extends BaseTargetTrackingProps {
  /**
   * The target value for memory utilization across all tasks in the service.
   */
  readonly targetUtilizationPercent: number;
}

/**
 * The properties for enabling scaling based on Application Load Balancer (ALB) request counts.
 */
export interface RequestCountScalingProps extends BaseTargetTrackingProps {
  /**
   * The number of ALB requests per target.
   */
  readonly requestsPerTarget: number;

  /**
   * The ALB target group name.
   */
  readonly targetGroup: ApplicationTargetGroup;
}

/**
 * The properties for enabling target tracking scaling based on a custom CloudWatch metric.
 */
export interface TrackCustomMetricProps extends BaseTargetTrackingProps {
  /**
   * The custom CloudWatch metric to track.
   *
   * The metric must represent utilization; that is, you will always get the following behavior:
   *
   * - metric > targetValue => scale out
   * - metric < targetValue => scale in
   */
  readonly metric: cloudwatch.IMetric;

  /**
   * The target value for the custom CloudWatch metric.
   */
  readonly targetValue: number;
}
