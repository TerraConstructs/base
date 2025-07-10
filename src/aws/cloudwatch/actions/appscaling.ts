// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-cloudwatch-actions/lib/appscaling.ts

import { Construct } from "constructs";
import * as cloudwatch from "..";
import * as appscaling from "../../compute";

/**
 * Use an ApplicationAutoScaling StepScalingAction as an Alarm Action
 */
export class ApplicationScalingAction implements cloudwatch.IAlarmAction {
  constructor(
    private readonly stepScalingAction: appscaling.StepScalingAction,
  ) {}

  /**
   * Returns an alarm action configuration to use an ApplicationScaling StepScalingAction
   * as an alarm action
   */
  public bind(
    _scope: Construct,
    _alarm: cloudwatch.IAlarm,
  ): cloudwatch.AlarmActionConfig {
    return { alarmActionArn: this.stepScalingAction.scalingPolicyArn };
  }
}
