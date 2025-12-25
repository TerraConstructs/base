// https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-events/lib/event-bus.ts

import {
  cloudwatchEventBus,
  cloudwatchEventBusPolicy,
  cloudwatchEventPermission,
} from "@cdktf/provider-aws";
import { Lazy, Token } from "cdktf";
import { Construct } from "constructs";
import { UnscopedValidationError, ValidationError } from "../../errors";
import { ArnFormat } from "../arn";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import { Archive, BaseArchiveProps } from "./archive";
import * as encryption from "../encryption";
import * as iam from "../iam";
import { IQueue } from "./queue-base";

/**
 * Outputs to register with the Grid
 */
export interface EventBusOutputs {
  /**
   * The physical ID of this event bus resource
   */
  readonly name: string;

  /**
   * The ARN of this event bus resource
   */
  readonly arn: string;

  /**
   * The partner event source to associate with this event bus resource
   */
  readonly eventSourceName?: string;
}

/**
 * Interface which all EventBus based classes MUST implement
 */
export interface IEventBus extends iam.IAwsConstructWithPolicy {
  /**
   * The physical ID of this event bus resource
   *
   * @attribute
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-name
   */
  readonly eventBusName: string;

  /**
   * The ARN of this event bus resource
   *
   * @attribute
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#Arn-fn::getatt
   */
  readonly eventBusArn: string;

  /**
   * The partner event source to associate with this event bus resource
   *
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-eventsourcename
   */
  readonly eventSourceName?: string;

  /**
   * Create an EventBridge archive to send events to.
   * When you create an archive, incoming events might not immediately start being sent to the archive.
   * Allow a short period of time for changes to take effect.
   *
   * @param props Properties of the archive
   */
  archive(id: string, props: BaseArchiveProps): Archive;

  /**
   * Grants an IAM Principal to send custom events to the eventBus
   * so that they can be matched to rules.
   *
   * @param grantee The principal (no-op if undefined)
   */
  grantPutEventsTo(grantee: iam.IGrantable): iam.Grant;
}

/**
 * Properties to define an event bus
 */
export interface EventBusProps extends AwsConstructProps {
  /**
   * The name of the event bus you are creating
   * Note: If 'eventSourceName' is passed in, you cannot set this
   *
   * NOTE: the names of custom event buses can't contain the '/' character
   *
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-name
   * @default - automatically generated name
   */
  readonly eventBusName?: string;

  /**
   * The partner event source to associate with this event bus resource
   * Note: If 'eventBusName' is passed in, you cannot set this
   *
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-eventsourcename
   * @default - no partner event source
   */
  readonly eventSourceName?: string;

  /**
   * Dead-letter queue for the event bus
   *
   * @see https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-event-delivery.html#eb-rule-dlq
   *
   * @default - no dead-letter queue
   */
  readonly deadLetterQueue?: IQueue;

  /**
   * The event bus description.
   *
   * The description can be up to 512 characters long.
   *
   * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-description
   *
   * @default - no description
   */
  readonly description?: string;

  /**
   * The customer managed key that encrypt events on this event bus.
   *
   * @default - Use an AWS managed key
   */
  readonly kmsKey?: encryption.IKey;
}

/**
 * Interface with properties necessary to import a reusable EventBus
 */
export interface EventBusAttributes {
  /**
   * The physical ID of this event bus resource
   *
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-name
   */
  readonly eventBusName: string;

  /**
   * The ARN of this event bus resource
   *
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#Arn-fn::getatt
   */
  readonly eventBusArn: string;

  /**
   * The partner event source to associate with this event bus resource
   *
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-events-eventbus.html#cfn-events-eventbus-eventsourcename
   * @default - no partner event source
   */
  readonly eventSourceName?: string;
}

abstract class EventBusBase extends AwsConstructBase implements IEventBus {
  /**
   * The physical ID of this event bus resource
   */
  public abstract readonly eventBusName: string;

  /**
   * The ARN of the event bus, such as:
   * arn:aws:events:us-east-2:123456789012:event-bus/aws.partner/PartnerName/acct1/repo1.
   */
  public abstract readonly eventBusArn: string;

  /**
   * The name of the partner event source
   */
  public abstract readonly eventSourceName?: string;

  public archive(id: string, props: BaseArchiveProps): Archive {
    return new Archive(this, id, {
      sourceEventBus: this,
      description:
        props.description || `Event Archive for ${this.eventBusName} Event Bus`,
      eventPattern: props.eventPattern,
      retention: props.retention,
      archiveName: props.archiveName,
    });
  }

  public grantPutEventsTo(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["events:PutEvents"],
      resourceArns: [this.eventBusArn],
    });
  }

  public abstract addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult;
}

/**
 * Define an EventBridge EventBus
 *
 * @resource aws_cloudwatch_event_bus
 */
export class EventBus extends EventBusBase {
  /**
   * Import an existing event bus resource
   * @param scope Parent construct
   * @param id Construct ID
   * @param eventBusArn ARN of imported event bus
   */
  public static fromEventBusArn(
    scope: Construct,
    id: string,
    eventBusArn: string,
  ): IEventBus {
    const parts = AwsStack.ofAwsConstruct(scope).splitArn(
      eventBusArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    );

    return new ImportedEventBus(scope, id, {
      eventBusArn: eventBusArn,
      eventBusName: parts.resourceName || "",
    });
  }

  /**
   * Import an existing event bus resource
   * @param scope Parent construct
   * @param id Construct ID
   * @param eventBusName Name of imported event bus
   */
  public static fromEventBusName(
    scope: Construct,
    id: string,
    eventBusName: string,
  ): IEventBus {
    const eventBusArn = AwsStack.ofAwsConstruct(scope).formatArn({
      resource: "event-bus",
      service: "events",
      resourceName: eventBusName,
    });

    return EventBus.fromEventBusAttributes(scope, id, {
      eventBusName: eventBusName,
      eventBusArn: eventBusArn,
    });
  }

  /**
   * Import an existing event bus resource
   * @param scope Parent construct
   * @param id Construct ID
   * @param attrs Imported event bus properties
   */
  public static fromEventBusAttributes(
    scope: Construct,
    id: string,
    attrs: EventBusAttributes,
  ): IEventBus {
    return new ImportedEventBus(scope, id, attrs);
  }

  /**
   * Permits an IAM Principal to send custom events to EventBridge
   * so that they can be matched to rules.
   *
   * @param grantee The principal (no-op if undefined)
   * @deprecated use grantAllPutEvents instead
   */
  public static grantPutEvents(grantee: iam.IGrantable): iam.Grant {
    // It's currently not possible to restrict PutEvents to specific resources.
    // See https://docs.aws.amazon.com/eventbridge/latest/userguide/permissions-reference-eventbridge.html
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["events:PutEvents"],
      resourceArns: ["*"],
    });
  }

  /**
   * Permits an IAM Principal to send custom events to EventBridge
   * so that they can be matched to rules.
   *
   * @param grantee The principal (no-op if undefined)
   */
  public static grantAllPutEvents(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["events:PutEvents"],
      resourceArns: ["*"],
    });
  }

  private static eventBusProps(
    defaultEventBusName: string,
    props: EventBusProps = {},
  ) {
    const { eventBusName, eventSourceName } = props;
    const eventBusNameRegex = /^[\/\.\-_A-Za-z0-9]{1,256}$/;

    if (eventBusName !== undefined && eventSourceName !== undefined) {
      throw new UnscopedValidationError(
        "'eventBusName' and 'eventSourceName' cannot both be provided",
      );
    }

    if (eventBusName !== undefined) {
      if (!Token.isUnresolved(eventBusName)) {
        if (eventBusName === "default") {
          throw new UnscopedValidationError(
            "'eventBusName' must not be 'default'",
          );
        } else if (eventBusName.indexOf("/") > -1) {
          throw new UnscopedValidationError(
            "'eventBusName' must not contain '/'",
          );
        } else if (!eventBusNameRegex.test(eventBusName)) {
          throw new UnscopedValidationError(
            `'eventBusName' must satisfy: ${eventBusNameRegex}`,
          );
        }
      }
      return { eventBusName };
    }

    if (eventSourceName !== undefined) {
      if (!Token.isUnresolved(eventSourceName)) {
        // Ex: aws.partner/PartnerName/acct1/repo1
        const eventSourceNameRegex = /^aws\.partner(\/[\.\-_A-Za-z0-9]+){2,}$/;
        if (!eventSourceNameRegex.test(eventSourceName)) {
          throw new UnscopedValidationError(
            `'eventSourceName' must satisfy: ${eventSourceNameRegex}`,
          );
        } else if (!eventBusNameRegex.test(eventSourceName)) {
          throw new UnscopedValidationError(
            `'eventSourceName' must satisfy: ${eventBusNameRegex}`,
          );
        }
      }
      return { eventBusName: eventSourceName, eventSourceName };
    }

    return { eventBusName: defaultEventBusName };
  }

  public readonly resource: cloudwatchEventBus.CloudwatchEventBus;

  public readonly eventBusOutputs: EventBusOutputs;
  public get outputs(): Record<string, any> {
    return this.eventBusOutputs;
  }

  private policy?: EventBusPolicy;

  /**
   * The physical ID of this event bus resource
   */
  public get eventBusName(): string {
    return this.resource.name;
  }

  /**
   * The ARN of the event bus, such as:
   * arn:aws:events:us-east-2:123456789012:event-bus/aws.partner/PartnerName/acct1/repo1.
   */
  public get eventBusArn(): string {
    return this.resource.arn;
  }

  /**
   * The name of the partner event source
   */
  public readonly eventSourceName?: string;

  constructor(scope: Construct, id: string, props?: EventBusProps) {
    const { eventBusName, eventSourceName } = EventBus.eventBusProps(
      // TODO(vincent): Figure out how this works...
      Lazy.stringValue({ produce: () => AwsStack.uniqueId(this) }),
      props,
    );

    super(scope, id, props);

    if (
      props?.description &&
      !Token.isUnresolved(props.description) &&
      props.description.length > 512
    ) {
      throw new ValidationError(
        `description must be less than or equal to 512 characters, got ${props.description.length}`,
        this,
      );
    }

    this.resource = new cloudwatchEventBus.CloudwatchEventBus(
      this,
      "Resource",
      {
        name: eventBusName,
        eventSourceName,
        kmsKeyIdentifier: props?.kmsKey?.keyArn,
        description: props?.description,
        deadLetterConfig: props?.deadLetterQueue
          ? {
              arn: props.deadLetterQueue.queueArn,
            }
          : undefined,
      },
    );

    /**
     * Allow EventBridge to use customer managed key
     *
     * @see https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-encryption-key-policy.html#eb-encryption-key-policy-bus
     */
    if (props?.kmsKey) {
      props?.kmsKey.addToResourcePolicy(
        new iam.PolicyStatement({
          resources: ["*"],
          actions: ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
          principals: [new iam.ServicePrincipal("events.amazonaws.com")],
          condition: [
            {
              test: "StringEquals",
              variable: "aws:SourceAccount",
              values: [this.stack.account],
            },
            {
              test: "StringEquals",
              variable: "aws:SourceArn",
              values: [
                AwsStack.ofAwsConstruct(this).formatArn({
                  service: "events",
                  resource: "event-bus",
                  resourceName: eventBusName,
                }),
              ],
            },
            {
              test: "StringEquals",
              variable: "kms:EncryptionContext:aws:events:event-bus:arn",
              values: [
                AwsStack.ofAwsConstruct(this).formatArn({
                  service: "events",
                  resource: "event-bus",
                  resourceName: eventBusName,
                }),
              ],
            },
          ],
        }),
      );
    }

    this.eventSourceName = this.resource.eventSourceName;
    this.eventBusOutputs = {
      name: this.eventBusName,
      arn: this.eventBusArn,
      eventSourceName: this.eventSourceName,
    };
  }

  /**
   * Adds a statement to the IAM resource policy associated with this event bus.
   */
  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.policy) {
      this.policy = new EventBusPolicy(this, "Policy", { eventBus: this });
    }

    if (this.policy) {
      this.policy.document.addStatements(statement);
      return { statementAdded: true, policyDependable: this.policy };
    }

    return { statementAdded: false };
  }
}

class ImportedEventBus extends EventBusBase {
  public readonly eventBusArn: string;
  public readonly eventBusName: string;
  public readonly eventSourceName?: string;
  public readonly eventBusOutputs: EventBusOutputs;
  public get outputs() {
    return this.eventBusOutputs;
  }

  constructor(scope: Construct, id: string, attrs: EventBusAttributes) {
    const arnParts = AwsStack.ofAwsConstruct(scope).splitArn(
      attrs.eventBusArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    );
    super(scope, id, {
      account: arnParts.account,
      region: arnParts.region,
    });

    this.eventBusArn = attrs.eventBusArn;
    this.eventBusName = attrs.eventBusName;
    this.eventSourceName = attrs.eventSourceName;
    this.eventBusOutputs = {
      name: this.eventBusName,
      arn: this.eventBusArn,
      eventSourceName: this.eventSourceName,
    };
  }

  public addToResourcePolicy(
    _statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    throw new Error(
      [
        "Cannot add a statement to an imported EventBus. You may use `EventBridgePermission` instead.",
        "If the EventBus already has a policy attached, the permissions will be overwritten.",
      ].join("\n"),
    );
  }
}

/**
 * Properties to associate Event Buses with a policy
 */
export interface EventBusPolicyProps extends AwsConstructProps {
  /**
   * The event bus to which the policy applies
   */
  readonly eventBus: IEventBus;
}

/**
 * The policy for an Event Bus
 *
 * Policies define the operations that are allowed on this resource.
 *
 * You almost never need to define this construct directly.
 *
 * The EventBusPolicy resource (`aws_cloudwatch_event_bus_policy`)
 * is incompatible with the EventBridgePermission resource (`aws_cloudwatch_event_permission`)
 * and will overwrite permissions.
 *
 * All AWS resources that support resource policies have a method called
 * `addToResourcePolicy()`, which will automatically create a new resource
 * policy if one doesn't exist yet, otherwise it will add to the existing
 * policy.
 *
 * Prefer to use `addToResourcePolicy()` instead.
 *
 * @resource aws_cloudwatch_event_bus_policy
 */
export class EventBusPolicy extends AwsConstructBase {
  /**
   * The IAM policy document for this policy.
   */
  public readonly document: iam.PolicyDocument;
  public get outputs(): Record<string, any> {
    return this.document.outputs;
  }
  constructor(scope: Construct, id: string, props: EventBusPolicyProps) {
    super(scope, id, props);
    this.document = new iam.PolicyDocument(this, "Document");

    new cloudwatchEventBusPolicy.CloudwatchEventBusPolicy(this, "Resource", {
      // https://github.com/hashicorp/terraform-provider-aws/pull/16874#discussion_r656024830
      policy: this.document.json,
      eventBusName: props.eventBus.eventBusName,
    });
  }
}

/**
 * Properties to add permissions to an Event Bus
 */
export interface EventBridgePermissionProps extends AwsConstructProps {
  // TODO: Auto generate this using struct builder to keep docs updated?
  /**
   * The event bus to which the policy applies
   */
  readonly eventBus: IEventBus;
  /**
   * An identifier string for the external account that
   * you are granting permissions to.
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/cloudwatch_event_permission#statement_id CloudwatchEventPermission#statement_id}
   */
  readonly statementId: string;
  /**
   * The action that you are enabling the other account to perform. Defaults to events:PutEvents
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/cloudwatch_event_permission#action CloudwatchEventPermission#action}
   * @default "events:PutEvents"
   */
  readonly action?: string;
  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/cloudwatch_event_permission#event_bus_name CloudwatchEventPermission#event_bus_name}
   */
  readonly eventBusName?: string;
  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/cloudwatch_event_permission#id CloudwatchEventPermission#id}
   *
   * Please be aware that the id field is automatically added to all resources in Terraform providers using a Terraform provider SDK version below 2.
   * If you experience problems setting this value it might not be settable. Please take a look at the provider documentation to ensure it should be settable.
   */
  readonly id?: string;
  /**
   * The 12-digit AWS account ID that you are permitting to put events to your default event bus.
   * Specify * to permit any account to put events to your default event bus, optionally limited
   * by condition.
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/cloudwatch_event_permission#principal CloudwatchEventPermission#principal}
   */
  readonly principal: string;
  /**
   * Configuration block to limit the event bus permissions you are granting to only accounts that
   * fulfill the condition.condition block
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/cloudwatch_event_permission#condition CloudwatchEventPermission#condition}
   */
  readonly condition?: cloudwatchEventPermission.CloudwatchEventPermissionCondition;
}

/**
 * A single permission for an Event Bus
 *
 * All AWS resources that support resource policies have a method called
 * `addToResourcePolicy()`, which will automatically create a new resource
 * policy if one doesn't exist yet, otherwise it will add to the existing
 * policy.
 *
 * If `addToResourcePolicy()` was used on the event bus, The EventBusPolicy resource
 * (`aws_cloudwatch_event_bus_policy`) is incompatible with this resource and
 * will overwrite permissions.
 *
 * @resource aws_cloudwatch_event_permission
 */
export class EventBridgePermission extends AwsConstructBase {
  public get outputs(): Record<string, any> {
    return {};
  }
  constructor(scope: Construct, id: string, props: EventBridgePermissionProps) {
    super(scope, id, props);

    new cloudwatchEventPermission.CloudwatchEventPermission(this, "Resource", {
      // https://github.com/hashicorp/terraform-provider-aws/pull/16874#discussion_r656024830
      ...props,
      eventBusName: props.eventBus.eventBusName,
    });
  }
}
