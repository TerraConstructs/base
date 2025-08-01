import { UtilizationScalingProps } from "./scalable-attribute-api";
import { BaseScalableAttribute } from "../compute/base-scalable-attribute";
import { ScalingSchedule } from "../compute/scalable-target";
import { PredefinedMetric } from "../compute/target-tracking-scaling-policy";

/**
 * A scalable table attribute
 */
export class ScalableTableAttribute extends BaseScalableAttribute {
  private scalingPolicyCreated = false;

  /**
   * Scale out or in based on time
   */
  public scaleOnSchedule(id: string, action: ScalingSchedule) {
    this.scalingPolicyCreated = true;
    super.doScaleOnSchedule(id, action);
  }

  /**
   * Scale out or in to keep utilization at a given level
   */
  public scaleOnUtilization(props: UtilizationScalingProps) {
    if (
      props.targetUtilizationPercent < 10 ||
      props.targetUtilizationPercent > 90
    ) {
      throw new RangeError(
        `targetUtilizationPercent for DynamoDB scaling must be between 10 and 90 percent, got: ${props.targetUtilizationPercent}`,
      );
    }
    this.scalingPolicyCreated = true;
    const predefinedMetric =
      this.props.dimension.indexOf("ReadCapacity") === -1
        ? PredefinedMetric.DYNAMODB_WRITE_CAPACITY_UTILIZATION
        : PredefinedMetric.DYNAMODB_READ_CAPACITY_UTILIZATION;

    super.doScaleToTrackMetric("Tracking", {
      policyName: props.policyName,
      disableScaleIn: props.disableScaleIn,
      scaleInCooldown: props.scaleInCooldown,
      scaleOutCooldown: props.scaleOutCooldown,
      targetValue: props.targetUtilizationPercent,
      predefinedMetric,
    });
  }

  /** @internal */
  public get _scalingPolicyCreated(): boolean {
    return this.scalingPolicyCreated;
  }
}

/**
 * Properties for enabling DynamoDB capacity scaling
 */
export interface EnableScalingProps {
  /**
   * Minimum capacity to scale to
   */
  minCapacity: number;

  /**
   * Maximum capacity to scale to
   */
  maxCapacity: number;
}
