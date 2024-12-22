// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-cloudwatch/lib/alarm-base.ts

import { IAwsBeacon, AwsBeaconBase } from "../beacon";
import { IAlarmAction } from "./alarm-action";

/**
 * Interface for Alarm Rule.
 */
export interface IAlarmRule {
  /**
   * serialized representation of Alarm Rule to be used when building the Composite Alarm resource.
   */
  renderAlarmRule(): string;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface AlarmOutputs {
  /**
   * Alarm ARN (i.e. arn:aws:cloudwatch:<region>:<account-id>:alarm:Foo)
   *
   * @attribute
   */
  readonly alarmArn: string;

  /**
   * Name of the alarm
   *
   * @attribute
   */
  readonly alarmName: string;
}

/**
 * Represents a CloudWatch Alarm
 */
export interface IAlarm extends IAlarmRule, IAwsBeacon {
  /** Strongly typed outputs */
  readonly alarmOutputs: AlarmOutputs;

  /**
   * Alarm ARN (i.e. arn:aws:cloudwatch:<region>:<account-id>:alarm:Foo)
   *
   * @attribute
   */
  readonly alarmArn: string;

  /**
   * Name of the alarm
   *
   * @attribute
   */
  readonly alarmName: string;
}

/**
 * The base class for Alarm and CompositeAlarm resources.
 */
export abstract class AlarmBase extends AwsBeaconBase implements IAlarm {
  /**
   * @attribute
   */
  public abstract readonly alarmArn: string;
  public abstract readonly alarmName: string;
  public get alarmOutputs(): AlarmOutputs {
    return {
      alarmArn: this.alarmArn,
      alarmName: this.alarmName,
    };
  }
  public get outputs(): Record<string, any> {
    return this.alarmOutputs;
  }

  protected alarmActionArns?: string[];
  protected insufficientDataActionArns?: string[];
  protected okActionArns?: string[];

  /**
   * AlarmRule indicating ALARM state for Alarm.
   */
  public renderAlarmRule(): string {
    return `ALARM("${this.alarmArn}")`;
  }

  /**
   * Trigger this action if the alarm fires
   *
   * Typically SnsAction or AutoScalingAction.
   */
  public addAlarmAction(...actions: IAlarmAction[]) {
    if (this.alarmActionArns === undefined) {
      this.alarmActionArns = [];
    }

    this.alarmActionArns.push(
      ...actions.map((a) => a.bind(this, this).alarmActionArn),
    );
  }

  /**
   * Trigger this action if there is insufficient data to evaluate the alarm
   *
   * Typically SnsAction or AutoScalingAction.
   */
  public addInsufficientDataAction(...actions: IAlarmAction[]) {
    if (this.insufficientDataActionArns === undefined) {
      this.insufficientDataActionArns = [];
    }

    this.insufficientDataActionArns.push(
      ...actions.map((a) => a.bind(this, this).alarmActionArn),
    );
  }

  /**
   * Trigger this action if the alarm returns from breaching state into ok state
   *
   * Typically SnsAction or AutoScalingAction.
   */
  public addOkAction(...actions: IAlarmAction[]) {
    if (this.okActionArns === undefined) {
      this.okActionArns = [];
    }

    this.okActionArns.push(
      ...actions.map((a) => a.bind(this, this).alarmActionArn),
    );
  }
}
