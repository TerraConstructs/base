// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-cloudwatch-actions/lib/ssm.ts

import { Construct } from "constructs";
import * as cloudwatch from "..";
import { AwsStack } from "../../aws-stack";

/**
 * Types of OpsItem severity available
 */
export enum OpsItemSeverity {
  /**
   * Set the severity to critical
   */
  CRITICAL = "1",
  /**
   * Set the severity to high
   */
  HIGH = "2",
  /**
   * Set the severity to medium
   */
  MEDIUM = "3",
  /**
   * Set the severity to low
   */
  LOW = "4",
}

/**
 * Types of OpsItem category available
 */
export enum OpsItemCategory {
  /**
   * Set the category to availability
   */
  AVAILABILITY = "Availability",
  /**
   * Set the category to cost
   */
  COST = "Cost",
  /**
   * Set the category to performance
   */
  PERFORMANCE = "Performance",
  /**
   * Set the category to recovery
   */
  RECOVERY = "Recovery",
  /**
   * Set the category to security
   */
  SECURITY = "Security",
}

/**
 * Use an SSM OpsItem action as an Alarm action
 */
export class SsmAction implements cloudwatch.IAlarmAction {
  private severity: OpsItemSeverity;
  private category?: OpsItemCategory;

  constructor(severity: OpsItemSeverity, category?: OpsItemCategory) {
    this.severity = severity;
    this.category = category;
  }

  /**
   * Returns an alarm action configuration to use an SSM OpsItem action as an alarm action
   */
  bind(
    _scope: Construct,
    _alarm: cloudwatch.IAlarm,
  ): cloudwatch.AlarmActionConfig {
    const stack = AwsStack.ofAwsConstruct(_scope);
    if (this.category === undefined) {
      return {
        alarmActionArn: `arn:${stack.partition}:ssm:${stack.region}:${stack.account}:opsitem:${this.severity}`,
      };
    } else {
      return {
        alarmActionArn: `arn:${stack.partition}:ssm:${stack.region}:${stack.account}:opsitem:${this.severity}#CATEGORY=${this.category}`,
      };
    }
  }
}

/**
 * Use an SSM Incident Response Plan as an Alarm action
 */
export class SsmIncidentAction implements cloudwatch.IAlarmAction {
  constructor(private readonly responsePlanName: string) {}

  /**
   * Returns an alarm action configuration to use an SSM Incident as an alarm action
   * based on an Incident Manager Response Plan
   */
  bind(
    _scope: Construct,
    _alarm: cloudwatch.IAlarm,
  ): cloudwatch.AlarmActionConfig {
    const stack = AwsStack.ofAwsConstruct(_scope);
    return {
      alarmActionArn: `arn:${stack.partition}:ssm-incidents::${stack.account}:response-plan/${this.responsePlanName}`,
    };
  }
}
