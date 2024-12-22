import { Construct } from "constructs";
import { AwsSpec } from "../../spec";
import { IAlarmAction, AlarmActionConfig } from "../alarm-action";
import { IAlarm } from "../alarm-base";

/**
 * Types of EC2 actions available
 */
export enum Ec2InstanceAction {
  /**
   * Stop the instance
   */
  STOP = "stop",
  /**
   * Terminatethe instance
   */
  TERMINATE = "terminate",
  /**
   * Recover the instance
   */
  RECOVER = "recover",
  /**
   * Reboot the instance
   */
  REBOOT = "reboot",
}

/**
 * Use an EC2 action as an Alarm action
 */
export class Ec2Action implements IAlarmAction {
  private ec2Action: Ec2InstanceAction;

  constructor(instanceAction: Ec2InstanceAction) {
    this.ec2Action = instanceAction;
  }

  /**
   * Returns an alarm action configuration to use an EC2 action as an alarm action
   */
  bind(_scope: Construct, _alarm: IAlarm): AlarmActionConfig {
    return {
      alarmActionArn: `arn:${AwsSpec.ofAwsBeacon(_scope).partition}:automate:${AwsSpec.ofAwsBeacon(_scope).region}:ec2:${this.ec2Action}`,
    };
  }
}
