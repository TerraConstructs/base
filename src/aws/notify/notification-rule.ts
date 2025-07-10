// https://github.com/aws/aws-cdk/blob/bc96ee17a18c19b98e4ad052bed7c24da2371050/packages/aws-cdk-lib/aws-codestarnotifications/lib/notification-rule.ts

import { codestarnotificationsNotificationRule } from "@cdktf/provider-aws";
import { Annotations, Lazy, Token } from "cdktf";
import * as constructs from "constructs";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../aws-construct";
import { INotificationRuleSource } from "./notification-rule-source";
import {
  INotificationRuleTarget,
  NotificationRuleTargetConfig,
} from "./notification-rule-target";

/**
 * The level of detail to include in the notifications for this resource.
 */
export enum DetailType {
  /**
   * BASIC will include only the contents of the event as it would appear in AWS CloudWatch
   */
  BASIC = "BASIC",

  /**
   * FULL will include any supplemental information provided by AWS CodeStar Notifications and/or the service for the resource for which the notification is created.
   */
  FULL = "FULL",
}

/**
 * Standard set of options for `notifyOnXxx` codestar notification handler on construct
 */
export interface NotificationRuleOptions {
  /**
   * The name for the notification rule.
   * Notification rule names must be unique in your AWS account.
   *
   * @default - generated from the `id`
   */
  readonly notificationRuleName?: string;

  /**
   * The status of the notification rule.
   * If the enabled is set to DISABLED, notifications aren't sent for the notification rule.
   *
   * @default true
   */
  readonly enabled?: boolean;

  /**
   * The level of detail to include in the notifications for this resource.
   * BASIC will include only the contents of the event as it would appear in AWS CloudWatch.
   * FULL will include any supplemental information provided by AWS CodeStar Notifications and/or the service for the resource for which the notification is created.
   *
   * @default DetailType.FULL
   */
  readonly detailType?: DetailType;

  // createdBy is not supported by the Terraform resource
  // /**
  //  * The name or email alias of the person who created the notification rule.
  //  * If not specified, it means that the creator's alias is not provided.
  //  *
  //  * @default - No alias provided
  //  */
  // readonly createdBy?: string;
}

/**
 * Properties for a new notification rule
 */
export interface NotificationRuleProps
  extends AwsConstructProps,
    NotificationRuleOptions {
  /**
   * A list of event types associated with this notification rule.
   * For a complete list of event types and IDs, see Notification concepts in the Developer Tools Console User Guide.
   * @see https://docs.aws.amazon.com/dtconsole/latest/userguide/concepts.html#concepts-api
   */
  readonly events: string[];

  /**
   * The Amazon Resource Name (ARN) of the resource to associate with the notification rule.
   * Currently, Supported sources include pipelines in AWS CodePipeline, build projects in AWS CodeBuild, and repositories in AWS CodeCommit in this L2 constructor.
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codestarnotifications-notificationrule.html#cfn-codestarnotifications-notificationrule-resource
   */
  readonly source: INotificationRuleSource;

  /**
   * The targets to register for the notification destination.
   *
   * @default - No targets are added to the rule. Use `addTarget()` to add a target.
   */
  readonly targets?: INotificationRuleTarget[];
  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.88.0/docs/resources/codestarnotifications_notification_rule#tags CodestarnotificationsNotificationRule#tags}
   */
  readonly tags?: {
    [key: string]: string;
  };
}

/**
 * Represents a notification rule
 */
export interface INotificationRule extends IAwsConstruct {
  /**
   * The ARN of the notification rule (i.e. arn:aws:codestar-notifications:::notificationrule/01234abcde)
   *
   * @attribute
   */
  readonly notificationRuleArn: string;

  /**
   * Adds target to notification rule
   *
   * @param target The SNS topic or AWS Chatbot Slack target
   * @returns boolean - return true if it had any effect
   */
  addTarget(target: INotificationRuleTarget): boolean;
}

/**
 * A new notification rule
 *
 * @resource AWS::CodeStarNotifications::NotificationRule
 */
export class NotificationRule
  extends AwsConstructBase
  implements INotificationRule
{
  /**
   * Import an existing notification rule provided an ARN
   * @param scope The parent creating construct
   * @param id The construct's name
   * @param notificationRuleArn Notification rule ARN (i.e. arn:aws:codestar-notifications:::notificationrule/01234abcde)
   */
  public static fromNotificationRuleArn(
    scope: constructs.Construct,
    id: string,
    notificationRuleArn: string,
  ): INotificationRule {
    class Import extends AwsConstructBase implements INotificationRule {
      readonly notificationRuleArn = notificationRuleArn;
      public get outputs(): Record<string, any> {
        return { notificationRuleArn: this.notificationRuleArn };
      }

      public addTarget(_target: INotificationRuleTarget): boolean {
        Annotations.of(this).addWarning(
          `Cannot add targets to imported NotificationRule '${this.node.id}'. Define targets directly on the source or manage permissions separately.`,
        );
        return false;
      }
    }

    return new Import(scope, id, {
      environmentFromArn: notificationRuleArn,
    });
  }

  /**
   * @attribute
   */
  public readonly notificationRuleArn: string;

  private readonly targetList: NotificationRuleTargetConfig[] = [];
  private readonly events: string[] = [];
  private readonly resource: codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule;

  public get outputs(): Record<string, any> {
    return { notificationRuleArn: this.notificationRuleArn };
  }

  constructor(
    scope: constructs.Construct,
    id: string,
    props: NotificationRuleProps,
  ) {
    super(scope, id, props);

    const source = props.source.bindAsNotificationRuleSource(this);

    this.addEvents(props.events);

    // Process initial targets from props
    props.targets?.forEach((target) => {
      this.addTarget(target);
    });

    const ruleName = props.notificationRuleName
      ? props.notificationRuleName.slice(-64) // Ensure 64 char limit
      : this.stack.uniqueResourceName(this, { maxLength: 64 });

    this.resource =
      new codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule(
        this,
        "Resource",
        {
          name: ruleName,
          detailType: props.detailType ?? DetailType.FULL,
          eventTypeIds: Lazy.listValue({
            produce: () => {
              if (Token.isUnresolved(props.events)) {
                return props.events;
              }
              return this.events;
            },
          }),
          resource: source.sourceArn,
          status:
            props.enabled === false
              ? "DISABLED"
              : props.enabled === true || props.enabled === undefined
                ? "ENABLED"
                : undefined, // Let Terraform handle default if undefined
          // Use Lazy producer to handle the potentially dynamic list of targets
          target: Lazy.anyValue({
            produce: () =>
              this.targetList.map((t) =>
                codestarnotificationsNotificationRule.codestarnotificationsNotificationRuleTargetToTerraform(
                  {
                    address: t.targetAddress,
                    type: t.targetType,
                  },
                ),
              ),
          }),
          tags: props.tags,
        },
      );

    this.notificationRuleArn = this.resource.arn;
  }

  public addTarget(target: INotificationRuleTarget): boolean {
    const boundTarget = target.bindAsNotificationRuleTarget(this);
    // Check if target already exists to avoid duplicates if this method were to update the resource
    const exists = this.targetList.some(
      (t) =>
        t.targetAddress === boundTarget.targetAddress &&
        t.targetType === boundTarget.targetType,
    );
    if (!exists) {
      this.targetList.push(boundTarget);
      return true;
    }
    return false;
  }
  /**
   * Adds events to notification rule
   *
   * @see https://docs.aws.amazon.com/dtconsole/latest/userguide/concepts.html#events-ref-pipeline
   * @see https://docs.aws.amazon.com/dtconsole/latest/userguide/concepts.html#events-ref-buildproject
   * @param events The list of event types for AWS Codebuild and AWS CodePipeline
   */
  private addEvents(events: string[]): void {
    events.forEach((event) => {
      if (this.events.includes(event)) {
        return;
      }

      this.events.push(event);
    });
  }
}
