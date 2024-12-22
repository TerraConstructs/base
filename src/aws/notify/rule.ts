import {
  cloudwatchEventRule,
  cloudwatchEventTarget,
  //schedulerScheduleGroup //TODO: support scheduler groups?
} from "@cdktf/provider-aws";
import { Lazy, Token } from "cdktf";
import { Construct } from "constructs";
import { ArnFormat } from "../arn";
import { AwsBeaconBase, IAwsBeacon, AwsBeaconProps } from "../beacon";
import { AwsSpec } from "../spec";
import {
  Schedule,
  EventPattern,
  IRuleTarget,
  IEventBus,
  EventCommonOptions,
} from "./";
import { mergeEventPattern, renderEventPattern } from "./util";

export interface RuleProps extends AwsBeaconProps, EventCommonOptions {
  /**
   * Indicates whether the rule is enabled.
   *
   * @default true
   */
  readonly enabled?: boolean;

  /**
   * Rule Name prefix to append to Grid UUID
   *
   * Rule names must be made up of only uppercase and lowercase ASCII letters,
   * numbers, underscores, and hyphens, and Due to the length of the tf generated
   * suffix, must be 64 characters or less long.
   *
   *
   * @default - GridUUID + Stack Unique Name
   */
  readonly namePrefix?: string;

  /**
   * The schedule or rate (frequency) that determines when EventBridge
   * runs the rule.
   *
   * You must specify this property, the `eventPattern` property, or both.
   *
   * For more information, see Schedule Expression Syntax for
   * Rules in the Amazon EventBridge User Guide.
   *
   * @see https://docs.aws.amazon.com/eventbridge/latest/userguide/scheduled-events.html
   *
   * @default - None.
   */
  readonly schedule?: Schedule;

  /**
   * Targets to invoke when this rule matches an event.
   *
   * Input will be the full matched event. If you wish to specify custom
   * target input, use `addTarget(target[, inputOptions])`.
   *
   * @default - No targets.
   */
  readonly targets?: IRuleTarget[];

  /**
   * The event bus to associate with this rule.
   *
   * @default - The default event bus.
   */
  readonly eventBus?: IEventBus;

  // /**
  //  * Additional restrictions for the event to route to the specified target
  //  *
  //  * The method that generates the rule probably imposes some type of event
  //  * filtering. The filtering implied by what you pass here is added
  //  * on top of that filtering.
  //  *
  //  * @default - No additional filtering based on an event pattern.
  //  *
  //  * @see
  //  * https://docs.aws.amazon.com/eventbridge/latest/userguide/eventbridge-and-event-patterns.html
  //  */
  // readonly eventPattern?: EventPattern;
}

export interface RuleOutputs {
  /**
   * Rule name
   */
  readonly name: string;

  /**
   * Rule arn
   */
  readonly arn: string;
}

export interface IRule extends IAwsBeacon {
  /** Strongly typed outputs */
  readonly ruleOutputs: RuleOutputs;
  /**
   * The value of the event rule Amazon Resource Name (ARN), such as
   * arn:aws:events:us-east-2:123456789012:rule/example.
   *
   * @attribute
   */
  readonly ruleArn: string;

  /**
   * The name event rule
   *
   * @attribute
   */
  readonly ruleName: string;
}

export class Rule extends AwsBeaconBase implements IRule {
  /**
   * Import an existing EventBridge Rule provided an ARN
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name.
   * @param eventRuleArn Event Rule ARN (i.e. arn:aws:events:<region>:<account-id>:rule/MyScheduledRule).
   */
  public static fromEventRuleArn(
    scope: Construct,
    id: string,
    eventRuleArn: string,
  ): IRule {
    const parts = AwsSpec.ofAwsBeacon(scope).splitArn(
      eventRuleArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    );

    class Import extends AwsBeaconBase implements IRule {
      public ruleArn = eventRuleArn;
      public ruleName = parts.resourceName || "";
      public ruleOutputs = {
        name: this.ruleName,
        arn: this.ruleArn,
      };
      public outputs = this.ruleOutputs;
    }
    return new Import(scope, id, {
      environmentFromArn: eventRuleArn,
    });
  }

  public readonly resource: cloudwatchEventRule.CloudwatchEventRule;
  public get ruleArn() {
    return this.resource.arn;
  }
  public get ruleName() {
    return this.resource.name;
  }
  public get ruleOutputs(): RuleOutputs {
    return {
      name: this.ruleName,
      arn: this.ruleArn,
    };
  }
  public get outputs(): Record<string, any> {
    return this.ruleOutputs;
  }

  private readonly targets =
    new Array<cloudwatchEventTarget.CloudwatchEventTargetConfig>();
  private readonly eventPattern: EventPattern = {};

  private readonly scheduleExpression?: string;
  private readonly description?: string;
  constructor(scope: Construct, name: string, props: RuleProps = {}) {
    super(scope, name, props);

    if (props.eventBus && props.schedule) {
      throw new Error(
        "Cannot associate rule with 'eventBus' when using 'schedule'",
      );
    }

    let namePrefix: string | undefined;
    if (!props.ruleName) {
      namePrefix = this.stack.uniqueResourceNamePrefix(this, {
        prefix: props.namePrefix ?? this.gridUUID + "-",
        allowedSpecialCharacters: ".-_",
        maxLength: 64,
      });
    }
    this.description = props.description;
    this.scheduleExpression = props.schedule?.expressionString;

    // add a warning on synth when minute is not defined in a cron schedule
    props.schedule?._bind(this);

    this.resource = new cloudwatchEventRule.CloudwatchEventRule(
      this,
      "Resource",
      {
        name: props.ruleName,
        namePrefix,
        description: this.description,
        state:
          props.enabled == null
            ? "ENABLED"
            : props.enabled
              ? "ENABLED"
              : "DISABLED", //TODO: support ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS?
        scheduleExpression: this.scheduleExpression,
        eventPattern: Lazy.stringValue({
          produce: () => this.stack.toJsonString(this._renderEventPattern()),
        }),
        // terraform-provider-aws separates targets to different resources.
        // targets: Lazy.anyValue({ produce: () => this.renderTargets() }),
        eventBusName: props.eventBus?.eventBusName,
        dependsOn: props.dependsOn,
      },
    );

    this.addEventPattern(props.eventPattern);

    for (const target of props.targets || []) {
      this.addTarget(target);
    }

    this.node.addValidation({
      validate: () => this.validateRule(props.ruleName),
    });
  }

  /**
   * Adds an event pattern filter to this rule. If a pattern was already specified,
   * these values are merged into the existing pattern.
   *
   * For example, if the rule already contains the pattern:
   *
   *    {
   *      "resources": [ "r1" ],
   *      "detail": {
   *        "hello": [ 1 ]
   *      }
   *    }
   *
   * And `addEventPattern` is called with the pattern:
   *
   *    {
   *      "resources": [ "r2" ],
   *      "detail": {
   *        "foo": [ "bar" ]
   *      }
   *    }
   *
   * The resulting event pattern will be:
   *
   *    {
   *      "resources": [ "r1", "r2" ],
   *      "detail": {
   *        "hello": [ 1 ],
   *        "foo": [ "bar" ]
   *      }
   *    }
   *
   */
  public addEventPattern(eventPattern?: EventPattern) {
    if (!eventPattern) {
      return;
    }
    mergeEventPattern(this.eventPattern, eventPattern);
  }

  /**
   * Not private only to be overrideen in CopyRule.
   *
   * @internal
   */
  public _renderEventPattern(): any {
    return renderEventPattern(this.eventPattern);
  }

  protected validateRule(ruleName?: string) {
    if (ruleName !== undefined && !Token.isUnresolved(ruleName)) {
      if (ruleName.length < 1 || ruleName.length > 64) {
        throw new Error(
          `Event rule name must be between 1 and 64 characters. Received: ${ruleName}`,
        );
      }
      if (!/^[\.\-_A-Za-z0-9]+$/.test(ruleName)) {
        throw new Error(
          `Event rule name ${ruleName} can contain only letters, numbers, periods, hyphens, or underscores with no spaces.`,
        );
      }
    }

    const errors: string[] = [];
    if (
      Object.keys(this.eventPattern).length === 0 &&
      !this.scheduleExpression
    ) {
      errors.push("Either 'eventPattern' or 'schedule' must be defined");
    }

    if (this.targets.length > 5) {
      errors.push("Event rule cannot have more than 5 targets.");
    }

    return errors;
  }

  /**
   * Adds a target to the rule. The abstract class RuleTarget can be extended to define new
   * targets.
   *
   * No-op if target is undefined.
   */
  public addTarget(target?: IRuleTarget): void {
    if (!target) {
      return;
    }
    // Simply increment id for each `addTarget` call. This is guaranteed to be unique.
    const targetId = `Target${this.targets.length}`;
    const targetProps = target.bind(this, targetId);
    const inputProps = targetProps.input && targetProps.input.bind(this);
    this.targets.push({
      targetId,
      roleArn: targetProps.role?.roleArn,
      rule: this.resource.name,
      arn: targetProps.arn,
      ecsTarget: targetProps.ecsParameters,
      httpTarget: targetProps.httpParameters,
      kinesisTarget: targetProps.kinesisParameters,
      runCommandTargets: targetProps.runCommandParameters,
      batchTarget: targetProps.batchParameters,
      deadLetterConfig: targetProps.deadLetterConfig,
      retryPolicy: targetProps.retryPolicy,
      sqsTarget: targetProps.sqsParameters,
      redshiftTarget: targetProps.redshiftDataParameters,
      // TODO: not available in terraform-provider-aws
      // appSyncParameters: targetProps.appSyncParameters,
      input: inputProps && inputProps.input,
      inputPath: inputProps && inputProps.inputPath,
      inputTransformer:
        inputProps?.inputTemplate !== undefined
          ? {
              inputTemplate: inputProps.inputTemplate,
              inputPaths: inputProps.inputPathsMap,
            }
          : undefined,
    });
  }

  /**
   * Adds resource to the Terraform JSON output at Synth time.
   *
   * called by TerraformStack.prepareStack()
   */
  public toTerraform(): any {
    /**
     * A preparing resolve might add new resources to the stack
     */
    for (const target of this.targets) {
      // note: targetId is calculated in addTarget()
      // TODO: Ideally we should have used IResolvable.resolve and use the IResolveContext.preparing flag
      // ref: https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-iam/lib/policy-document.ts#L48
      if (this.node.tryFindChild(target.targetId!)) continue; // ignore if already generated
      new cloudwatchEventTarget.CloudwatchEventTarget(
        this,
        target.targetId!,
        target,
      );
    }
    return {};
  }
}
