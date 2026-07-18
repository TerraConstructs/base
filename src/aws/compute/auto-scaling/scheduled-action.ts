// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/lib/scheduled-action.ts

import { autoscalingSchedule } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { IAutoScalingGroup } from "./auto-scaling-group";
import { Schedule } from "./schedule";
import { ValidationError } from "../../../errors";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";

/**
 * Properties for a scheduled scaling action
 */
export interface BasicScheduledActionProps {
  /**
   * Specifies the time zone for a cron expression. If a time zone is not provided, UTC is used by default.
   *
   * Valid values are the canonical names of the IANA time zones, derived from the IANA Time Zone Database (such as Etc/GMT+9 or Pacific/Tahiti).
   *
   * For more information, see https://en.wikipedia.org/wiki/List_of_tz_database_time_zones.
   *
   * @default - UTC
   *
   */
  readonly timeZone?: string;
  /**
   * When to perform this action.
   *
   * Supports cron expressions.
   *
   * For more information about cron expressions, see https://en.wikipedia.org/wiki/Cron.
   */
  readonly schedule: Schedule;

  /**
   * When this scheduled action becomes active.
   *
   * @default - The rule is activate immediately.
   */
  readonly startTime?: Date;

  /**
   * When this scheduled action expires.
   *
   * @default - The rule never expires.
   */
  readonly endTime?: Date;

  /**
   * The new minimum capacity.
   *
   * At the scheduled time, set the minimum capacity to the given capacity.
   *
   * At least one of maxCapacity, minCapacity, or desiredCapacity must be supplied.
   *
   * @default - No new minimum capacity.
   */
  readonly minCapacity?: number;

  /**
   * The new maximum capacity.
   *
   * At the scheduled time, set the maximum capacity to the given capacity.
   *
   * At least one of maxCapacity, minCapacity, or desiredCapacity must be supplied.
   *
   * @default - No new maximum capacity.
   */
  readonly maxCapacity?: number;

  /**
   * The new desired capacity.
   *
   * At the scheduled time, set the desired capacity to the given capacity.
   *
   * At least one of maxCapacity, minCapacity, or desiredCapacity must be supplied.
   *
   * @default - No new desired capacity.
   */
  readonly desiredCapacity?: number;
}

/**
 * Properties for a scheduled action on an AutoScalingGroup
 */
export interface ScheduledActionProps
  extends BasicScheduledActionProps,
    AwsConstructProps {
  /**
   * The AutoScalingGroup to apply the scheduled actions to
   */
  readonly autoScalingGroup: IAutoScalingGroup;
}

/**
 * Define a scheduled scaling action
 *
 * Terraform note: `aws_autoscaling_schedule` has no CloudFormation-style
 * auto-generated logical-id-derived name, and (unlike most other resources
 * in this module) it does not support a `name_prefix` attribute either -
 * `scheduled_action_name` is a required, plain `name`. A unique physical
 * name is therefore always synthesized from the construct path (gridUUID
 * prefixed), mirroring the `uniqueResourceName` idiom used by the
 * appscaling twin (`compute/step-scaling-action.ts`).
 */
export class ScheduledAction extends AwsConstructBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.autoscaling.ScheduledAction";

  /**
   * The underlying Terraform `aws_autoscaling_schedule` resource.
   */
  public readonly resource: autoscalingSchedule.AutoscalingSchedule;

  /**
   * The ARN of the scheduled action.
   */
  public readonly scheduledActionArn: string;

  /**
   * The name of the scheduled action.
   */
  public readonly scheduledActionName: string;

  public get outputs(): Record<string, any> {
    return {
      scheduledActionArn: this.scheduledActionArn,
      scheduledActionName: this.scheduledActionName,
    };
  }

  constructor(scope: Construct, id: string, props: ScheduledActionProps) {
    super(scope, id, props);

    if (
      props.minCapacity === undefined &&
      props.maxCapacity === undefined &&
      props.desiredCapacity === undefined
    ) {
      throw new ValidationError(
        "At least one of minCapacity, maxCapacity, or desiredCapacity is required",
        this,
      );
    }

    // add a warning on synth when minute is not defined in a cron schedule
    props.schedule._bind(this);

    // AWS scheduled action names are 1-255 characters and must be unique per
    // Auto Scaling group; the Terraform resource has no `name_prefix`
    // equivalent, so synthesize a unique physical name up-front.
    const scheduledActionName = this.stack.uniqueResourceName(this, {
      prefix: this.gridUUID + "-",
      allowedSpecialCharacters: "_-",
      maxLength: 255,
    });

    this.resource = new autoscalingSchedule.AutoscalingSchedule(
      this,
      "Resource",
      {
        autoscalingGroupName: props.autoScalingGroup.autoScalingGroupName,
        scheduledActionName,
        startTime: formatISO(props.startTime),
        endTime: formatISO(props.endTime),
        minSize: props.minCapacity,
        maxSize: props.maxCapacity,
        desiredCapacity: props.desiredCapacity,
        recurrence: props.schedule.expressionString,
        timeZone: props.timeZone,
      },
    );

    this.scheduledActionArn = this.resource.arn;
    this.scheduledActionName = scheduledActionName;
  }
}

function formatISO(date?: Date) {
  if (!date) {
    return undefined;
  }

  return (
    date.getUTCFullYear() +
    "-" +
    pad(date.getUTCMonth() + 1) +
    "-" +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    ":" +
    pad(date.getUTCMinutes()) +
    ":" +
    pad(date.getUTCSeconds()) +
    "Z"
  );

  function pad(num: number) {
    if (num < 10) {
      return "0" + num;
    }
    return num;
  }
}
