// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/lib/lifecycle-hook.ts

import { autoscalingLifecycleHook } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import type { IAutoScalingGroup } from "./auto-scaling-group";
import { ILifecycleHookTarget } from "./lifecycle-hook-target";
import { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as iam from "../../iam";

/**
 * Basic properties for a lifecycle hook
 */
export interface BasicLifecycleHookProps {
  /**
   * Name of the lifecycle hook
   *
   * @default - Automatically generated name.
   */
  readonly lifecycleHookName?: string;

  /**
   * The action the Auto Scaling group takes when the lifecycle hook timeout elapses or if an unexpected failure occurs.
   *
   * @default Continue
   */
  readonly defaultResult?: DefaultResult;

  /**
   * Maximum time between calls to RecordLifecycleActionHeartbeat for the hook
   *
   * If the lifecycle hook times out, perform the action in DefaultResult.
   *
   * @default - No heartbeat timeout.
   */
  readonly heartbeatTimeout?: Duration;

  /**
   * The state of the Amazon EC2 instance to which you want to attach the lifecycle hook.
   */
  readonly lifecycleTransition: LifecycleTransition;

  /**
   * Additional data to pass to the lifecycle hook target
   *
   * @default - No metadata.
   */
  readonly notificationMetadata?: string;

  /**
   * The target of the lifecycle hook
   *
   * @default - No target.
   */
  readonly notificationTarget?: ILifecycleHookTarget;

  /**
   * The role that allows publishing to the notification target
   *
   * @default - A role will be created if a target is provided. Otherwise, no role is created.
   */
  readonly role?: iam.IRole;
}

/**
 * Properties for a Lifecycle hook
 */
export interface LifecycleHookProps
  extends BasicLifecycleHookProps,
    AwsConstructProps {
  /**
   * The AutoScalingGroup to add the lifecycle hook to
   */
  readonly autoScalingGroup: IAutoScalingGroup;
}

/**
 * A basic lifecycle hook object
 */
export interface ILifecycleHook extends IAwsConstruct {
  /**
   * The role for the lifecycle hook to execute
   *
   * @default - A default role is created if 'notificationTarget' is specified.
   * Otherwise, no role is created.
   */
  readonly role: iam.IRole;
}

/**
 * Define a life cycle hook
 *
 * Terraform note: `aws_autoscaling_lifecycle_hook` has no CloudFormation-style
 * auto-generated logical-id-derived name, and (unlike most other resources in
 * this module) it does not support a `name_prefix` attribute either - `name`
 * is a required, plain string. A unique physical name is therefore always
 * synthesized from the construct path (gridUUID prefixed) when
 * `lifecycleHookName` is not supplied, mirroring the `uniqueResourceName`
 * idiom used by the sibling `ScheduledAction`/`StepScalingAction` constructs.
 */
export class LifecycleHook extends AwsConstructBase implements ILifecycleHook {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.autoscaling.LifecycleHook";

  /**
   * The underlying `aws_autoscaling_lifecycle_hook` resource (maps CfnLifecycleHook).
   */
  public readonly resource: autoscalingLifecycleHook.AutoscalingLifecycleHook;

  private _role?: iam.IRole;

  /**
   * The role that allows the ASG to publish to the notification target
   *
   * @default - A default role is created if 'notificationTarget' is specified.
   * Otherwise, no role is created.
   */
  public get role() {
    if (!this._role) {
      throw new ValidationError(
        "'role' is undefined. Please specify a 'role' or specify a 'notificationTarget' to have a role provided for you.",
        this,
      );
    }

    return this._role;
  }

  /**
   * The name of this lifecycle hook
   * @attribute
   */
  public readonly lifecycleHookName: string;

  public get outputs(): Record<string, any> {
    return {
      lifecycleHookName: this.lifecycleHookName,
    };
  }

  constructor(scope: Construct, id: string, props: LifecycleHookProps) {
    super(scope, id, props);

    const targetProps = props.notificationTarget
      ? props.notificationTarget.bind(this, {
          lifecycleHook: this,
          role: props.role,
        })
      : undefined;

    if (props.role) {
      this._role = props.role;

      if (!props.notificationTarget) {
        throw new ValidationError(
          "'notificationTarget' parameter required when 'role' parameter is specified",
          this,
        );
      }
    } else {
      this._role = targetProps ? targetProps.createdRole : undefined;
    }

    const l1NotificationTargetArn = targetProps
      ? targetProps.notificationTargetArn
      : undefined;
    const l1RoleArn = this._role ? this.role.roleArn : undefined;

    // CFN auto-generates the lifecycle hook name and only requires it as an
    // optional input; the Terraform aws_autoscaling_lifecycle_hook resource
    // has no name_prefix knob and requires `name` as an input, so synthesize
    // a deterministic unique name from the construct path when not supplied.
    const lifecycleHookName =
      props.lifecycleHookName ??
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID + "-",
        allowedSpecialCharacters: "_-",
        maxLength: 255,
      });

    this.resource = new autoscalingLifecycleHook.AutoscalingLifecycleHook(
      this,
      "Resource",
      {
        autoscalingGroupName: props.autoScalingGroup.autoScalingGroupName,
        defaultResult: props.defaultResult,
        heartbeatTimeout: props.heartbeatTimeout?.toSeconds(),
        name: lifecycleHookName,
        lifecycleTransition: props.lifecycleTransition,
        notificationMetadata: props.notificationMetadata,
        notificationTargetArn: l1NotificationTargetArn,
        roleArn: l1RoleArn,
      },
    );

    // A LifecycleHook resource is going to do a permissions test upon creation,
    // so we have to make sure the role has full permissions before creating the
    // lifecycle hook.
    if (this._role) {
      this.resource.node.addDependency(this.role);
    }

    this.lifecycleHookName = lifecycleHookName;
  }
}

export enum DefaultResult {
  CONTINUE = "CONTINUE",
  ABANDON = "ABANDON",
}

/**
 * What instance transition to attach the hook to
 */
export enum LifecycleTransition {
  /**
   * Execute the hook when an instance is about to be added
   */
  INSTANCE_LAUNCHING = "autoscaling:EC2_INSTANCE_LAUNCHING",

  /**
   * Execute the hook when an instance is about to be terminated
   */
  INSTANCE_TERMINATING = "autoscaling:EC2_INSTANCE_TERMINATING",
}
