// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-cloudwatch-actions/lib/sns.ts

import { Construct } from "constructs";
import * as cloudwatch from "..";
import * as sns from "../../notify";

/**
 * Use an SNS topic as an alarm action
 */
export class SnsAction implements cloudwatch.IAlarmAction {
  constructor(private readonly topic: sns.ITopic) {}

  /**
   * Returns an alarm action configuration to use an SNS topic as an alarm action
   */
  public bind(
    _scope: Construct,
    _alarm: cloudwatch.IAlarm,
  ): cloudwatch.AlarmActionConfig {
    return { alarmActionArn: this.topic.topicArn };
  }
}
