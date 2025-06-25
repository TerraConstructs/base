// https://github.com/aws/aws-cdk/blob/v2.168.0/packages/aws-cdk-lib/aws-applicationautoscaling/lib/scalable-target.ts

import {
  appautoscalingTarget,
  appautoscalingScheduledAction,
} from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { Schedule } from "./schedule";
import {
  BasicStepScalingPolicyProps,
  StepScalingPolicy,
} from "./step-scaling-policy";
import {
  BasicTargetTrackingScalingPolicyProps,
  TargetTrackingScalingPolicy,
} from "./target-tracking-scaling-policy";
import { TimeZone } from "../../time-zone";
import { withResolved } from "../../token";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../aws-construct";
import * as iam from "../iam";

/**
 * Represents a Application Auto Scaling Scalable Target
 */
export interface IScalableTarget extends IAwsConstruct {
  /**
   * The ID of the Scalable Target.
   * This is typically in the format: service-namespace/resource-id/scalable-dimension
   * @attribute
   */
  readonly scalableTargetId: string;

  /**
   * The IAM role that allows Application Auto Scaling to modify your scalable target.
   */
  readonly role?: iam.IRole;

  /**
   * The resource identifier to associate with this scalable target.
   */
  readonly resourceId: string;

  /**
   * The scalable dimension that's associated with the scalable target.
   */
  readonly scalableDimension: string;

  /**
   * The namespace of the AWS service that provides the resource.
   */
  readonly serviceNamespace: ServiceNamespace;

  /**
   * Add a policy statement to the role's policy document.
   * @param statement The policy statement to add
   */
  addToRolePolicy(statement: iam.PolicyStatement): void;

  /**
   * Scale out or in based on time.
   * @param id The ID of the scheduled action
   * @param action The scaling schedule
   */
  scaleOnSchedule(
    id: string,
    action: ScalingSchedule,
  ): appautoscalingScheduledAction.AppautoscalingScheduledAction;

  /**
   * Scale out or in, in response to a metric.
   * @param id The ID of the scaling policy
   * @param props The properties for the step scaling policy
   */
  scaleOnMetric(
    id: string,
    props: BasicStepScalingPolicyProps,
  ): StepScalingPolicy;

  /**
   * Scale out or in in order to keep a metric around a target value.
   * @param id The ID of the scaling policy
   * @param props The properties for the target tracking scaling policy
   */
  scaleToTrackMetric(
    id: string,
    props: BasicTargetTrackingScalingPolicyProps,
  ): TargetTrackingScalingPolicy;
}

/**
 * Properties for a scalable target
 */
export interface ScalableTargetProps extends AwsConstructProps {
  /**
   * The minimum value that Application Auto Scaling can use to scale a target during a scaling activity.
   */
  readonly minCapacity: number;

  /**
   * The maximum value that Application Auto Scaling can use to scale a target during a scaling activity.
   */
  readonly maxCapacity: number;

  /**
   * Role that allows Application Auto Scaling to modify your scalable target.
   *
   * @default A role is automatically created
   */
  readonly role?: iam.IRole;

  /**
   * The resource identifier to associate with this scalable target.
   *
   * This string consists of the resource type and unique identifier.
   *
   * Example value: `service/ecsStack-MyECSCluster-AB12CDE3F4GH/ecsStack-MyECSService-AB12CDE3F4GH`
   *
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_RegisterScalableTarget.html
   */
  readonly resourceId: string;

  /**
   * The scalable dimension that's associated with the scalable target.
   *
   * Specify the service namespace, resource type, and scaling property.
   *
   * Example value: `ecs:service:DesiredCount`
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_ScalingPolicy.html
   */
  readonly scalableDimension: string;

  /**
   * The namespace of the AWS service that provides the resource or
   * custom-resource for a resource provided by your own application or
   * service.
   *
   * For valid AWS service namespace values, see the RegisterScalableTarget
   * action in the Application Auto Scaling API Reference.
   *
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_RegisterScalableTarget.html
   */
  readonly serviceNamespace: ServiceNamespace;
}

/**
 * Define a scalable target
 *
 * @resource aws_appautoscaling_target
 */
export class ScalableTarget
  extends AwsConstructBase
  implements IScalableTarget
{
  public static fromScalableTargetId(
    scope: Construct,
    id: string,
    scalableTargetId: string,
  ): IScalableTarget {
    // Assuming scalableTargetId is in the format: serviceNamespace/resourceId/scalableDimension
    const parts = scalableTargetId.split("/");
    if (parts.length < 3) {
      throw new Error(
        "Invalid scalableTargetId format. Expected serviceNamespace/resourceId/scalableDimension",
      );
    }
    const serviceNamespace = parts[0] as ServiceNamespace;
    const scalableDimension = parts[parts.length - 1];
    const resourceId = parts.slice(1, -1).join("/");

    class Import extends AwsConstructBase implements IScalableTarget {
      public readonly scalableTargetId = scalableTargetId;
      public readonly role: iam.IRole;
      public readonly resourceId = resourceId;
      public readonly scalableDimension = scalableDimension;
      public readonly serviceNamespace = serviceNamespace;

      constructor(s: Construct, i: string) {
        super(s, i, {
          environmentFromArn: `arn:aws:application-autoscaling:${AwsConstructBase.isConstruct(s) ? (s as AwsConstructBase).env.region : "unknown"}:${AwsConstructBase.isConstruct(s) ? (s as AwsConstructBase).env.account : "unknown"}:scalable-target/${scalableTargetId}`,
        });
        // Role is not directly importable with just the target ID, it would need to be imported separately or ARN provided.
        // For simplicity, we'll represent it as an unmodifiable imported role placeholder.
        this.role = iam.Role.fromRoleArn(
          this,
          "ImportedRole",
          "arn:aws:iam::unknown:role/unknownapplicationautoscalingrole",
          { mutable: false },
        );
      }

      public get outputs(): Record<string, any> {
        return { scalableTargetId: this.scalableTargetId };
      }

      public addToRolePolicy(_statement: iam.PolicyStatement): void {
        throw new Error(
          "Cannot add to policy of an imported ScalableTarget role like this.",
        );
      }

      public scaleOnSchedule(
        _actionId: string,
        _action: ScalingSchedule,
      ): appautoscalingScheduledAction.AppautoscalingScheduledAction {
        throw new Error(
          "Cannot add scheduled action to an imported ScalableTarget.",
        );
      }

      public scaleOnMetric(
        _policyId: string,
        _props: BasicStepScalingPolicyProps,
      ): StepScalingPolicy {
        throw new Error(
          "Cannot add step scaling policy to an imported ScalableTarget.",
        );
      }

      public scaleToTrackMetric(
        _policyId: string,
        _props: BasicTargetTrackingScalingPolicyProps,
      ): TargetTrackingScalingPolicy {
        throw new Error(
          "Cannot add target tracking policy to an imported ScalableTarget.",
        );
      }
    }
    return new Import(scope, id);
  }

  public readonly scalableTargetId: string;
  public readonly role?: iam.IRole;
  public readonly resourceId: string;
  public readonly scalableDimension: string;
  public readonly serviceNamespace: ServiceNamespace;

  private readonly targetResource: appautoscalingTarget.AppautoscalingTarget;

  constructor(scope: Construct, id: string, props: ScalableTargetProps) {
    super(scope, id, props);

    withResolved(props.maxCapacity, (max) => {
      if (max < 0) {
        throw new Error(
          `maxCapacity cannot be negative, got: ${props.maxCapacity}`,
        );
      }
    });

    withResolved(props.minCapacity, (min) => {
      if (min < 0) {
        throw new Error(
          `minCapacity cannot be negative, got: ${props.minCapacity}`,
        );
      }
    });

    withResolved(props.minCapacity, props.maxCapacity, (min, max) => {
      if (max < min) {
        throw new Error(
          `minCapacity (${props.minCapacity}) should be lower than maxCapacity (${props.maxCapacity})`,
        );
      }
    });

    // For DynamoDB autoscaling, use service-linked roles when no explicit role is provided
    // This allows Terraform to automatically manage the appropriate service-linked role
    // rather than creating a custom IAM role that may have incorrect ARN format
    this.role = props.role;

    const targetConfig: any = {
      maxCapacity: props.maxCapacity,
      minCapacity: props.minCapacity,
      resourceId: props.resourceId,
      scalableDimension: props.scalableDimension,
      serviceNamespace: props.serviceNamespace,
    };

    // Only include roleArn if a role is explicitly provided
    // When omitted, Terraform will use appropriate service-linked roles
    if (this.role) {
      targetConfig.roleArn = this.role.roleArn;
    }

    this.targetResource = new appautoscalingTarget.AppautoscalingTarget(
      this,
      "Resource",
      targetConfig,
    );

    this.scalableTargetId = this.targetResource.id;
    this.resourceId = props.resourceId;
    this.scalableDimension = props.scalableDimension;
    this.serviceNamespace = props.serviceNamespace;
  }

  public get outputs(): Record<string, any> {
    return {
      scalableTargetId: this.scalableTargetId,
      roleArn: this.role?.roleArn,
    };
  }

  public addToRolePolicy(statement: iam.PolicyStatement) {
    if (!this.role) {
      throw new Error(
        "Cannot add policy to role when using service-linked roles. " +
          "Provide an explicit role in ScalableTargetProps if you need to add custom policies.",
      );
    }
    this.role.addToPrincipalPolicy(statement);
  }

  public scaleOnSchedule(
    scheduleId: string,
    action: ScalingSchedule,
  ): appautoscalingScheduledAction.AppautoscalingScheduledAction {
    if (action.minCapacity === undefined && action.maxCapacity === undefined) {
      throw new Error(
        `You must supply at least one of minCapacity or maxCapacity, got ${JSON.stringify(action)}`,
      );
    }

    action.schedule._bind(this);

    return new appautoscalingScheduledAction.AppautoscalingScheduledAction(
      this,
      scheduleId,
      {
        name: scheduleId,
        serviceNamespace: this.serviceNamespace,
        resourceId: this.resourceId,
        scalableDimension: this.scalableDimension,
        schedule: action.schedule.expressionString,
        startTime: action.startTime?.toISOString(),
        endTime: action.endTime?.toISOString(),
        scalableTargetAction: {
          maxCapacity: action.maxCapacity?.toString(),
          minCapacity: action.minCapacity?.toString(),
        },
        timezone: action.timeZone?.timezoneName,
      },
    );
  }

  public scaleOnMetric(
    policyId: string,
    props: BasicStepScalingPolicyProps,
  ): StepScalingPolicy {
    return new StepScalingPolicy(this, policyId, {
      ...props,
      scalingTarget: this,
    });
  }

  public scaleToTrackMetric(
    policyId: string,
    props: BasicTargetTrackingScalingPolicyProps,
  ): TargetTrackingScalingPolicy {
    return new TargetTrackingScalingPolicy(this, policyId, {
      ...props,
      scalingTarget: this,
    });
  }
}

/**
 * A scheduled scaling action
 */
export interface ScalingSchedule {
  /**
   * When to perform this action.
   */
  readonly schedule: Schedule;

  /**
   * When this scheduled action becomes active.
   *
   * @default The rule is activate immediately
   */
  readonly startTime?: Date;

  /**
   * When this scheduled action expires.
   *
   * @default The rule never expires.
   */
  readonly endTime?: Date;

  /**
   * The new minimum capacity.
   *
   * During the scheduled time, if the current capacity is below the minimum
   * capacity, Application Auto Scaling scales out to the minimum capacity.
   *
   * At least one of maxCapacity and minCapacity must be supplied.
   *
   * @default No new minimum capacity
   */
  readonly minCapacity?: number;

  /**
   * The new maximum capacity.
   *
   * During the scheduled time, the current capacity is above the maximum
   * capacity, Application Auto Scaling scales in to the maximum capacity.
   *
   * At least one of maxCapacity and minCapacity must be supplied.
   *
   * @default No new maximum capacity
   */
  readonly maxCapacity?: number;

  /**
   * The time zone used when referring to the date and time of a scheduled action,
   * when the scheduled action uses an at or cron expression.
   *
   * @default - UTC
   */
  readonly timeZone?: TimeZone;
}

/**
 * The service that supports Application AutoScaling
 */
export enum ServiceNamespace {
  ECS = "ecs",
  ELASTIC_MAP_REDUCE = "elasticmapreduce",
  EC2 = "ec2",
  APPSTREAM = "appstream",
  DYNAMODB = "dynamodb",
  RDS = "rds",
  SAGEMAKER = "sagemaker",
  CUSTOM_RESOURCE = "custom-resource",
  LAMBDA = "lambda",
  COMPREHEND = "comprehend",
  KAFKA = "kafka",
  ELASTICACHE = "elasticache",
  NEPTUNE = "neptune",
  CASSANDRA = "cassandra",
  WORKSPACES = "workspaces",
}
