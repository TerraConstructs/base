// https://github.com/aws/aws-cdk/blob/6b9e47a1529319561bc1040739fe02bac15895bf/packages/aws-cdk-lib/aws-sns/lib/subscription.ts

import { snsTopicSubscription } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { DeliveryPolicy } from "./delivery-policy";
import { SubscriptionFilter } from "./subscription-filter";
import { ITopic } from "./topic-base";
import { ValidationError } from "../../errors";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import * as iam from "../iam";
import * as notify from "../notify";

/**
 * Outputs for the Subscription construct.
 */
export interface SubscriptionOutputs {
  /**
   * The ARN of the subscription.
   */
  readonly subscriptionArn: string;
}

/**
 * Options for creating a new subscription
 */
export interface SubscriptionOptions extends AwsConstructProps {
  /**
   * What type of subscription to add.
   */
  readonly protocol: SubscriptionProtocol;

  /**
   * The subscription endpoint.
   *
   * The meaning of this value depends on the value for 'protocol'.
   */
  readonly endpoint: string;

  /**
   * true if raw message delivery is enabled for the subscription. Raw messages are free of JSON formatting and can be
   * sent to HTTP/S and Amazon SQS endpoints. For more information, see GetSubscriptionAttributes in the Amazon Simple
   * Notification Service API Reference.
   *
   * @default false
   */
  readonly rawMessageDelivery?: boolean;

  /**
   * The filter policy.
   *
   * @default - all messages are delivered
   */
  readonly filterPolicy?: { [attribute: string]: SubscriptionFilter };

  /**
   * The filter policy that is applied on the message body.
   * To apply a filter policy to the message attributes, use `filterPolicy`. A maximum of one of `filterPolicyWithMessageBody` and `filterPolicy` may be used.
   *
   * @default - all messages are delivered
   */
  readonly filterPolicyWithMessageBody?: {
    [attribute: string]: FilterOrPolicy;
  };

  // TODO: Cross-region subscriptions might require provider aliases in CDKTF.
  // The sns_topic_subscription resource itself doesn't have a region parameter.
  // /**
  //  * The region where the topic resides, in the case of cross-region subscriptions
  //  * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-sns-subscription.html#cfn-sns-subscription-region
  //  * @default - the region where the stack is being deployed.
  //  */
  // readonly region?: string;

  /**
   * Queue to be used as dead letter queue.
   * If not passed no dead letter queue is enabled.
   *
   * @default - No dead letter queue enabled.
   */
  readonly deadLetterQueue?: notify.IQueue;

  /**
   * Arn of role allowing access to firehose delivery stream.
   * Required for a firehose subscription protocol.
   * @default - No subscription role is provided
   */
  readonly subscriptionRoleArn?: string;

  /**
   * The delivery policy.
   *
   * @default - if the initial delivery of the message fails, three retries with a delay between failed attempts set at 20 seconds
   */
  readonly deliveryPolicy?: DeliveryPolicy;
}
/**
 * Properties for creating a new subscription
 */
export interface SubscriptionProps extends SubscriptionOptions {
  /**
   * The topic to subscribe to.
   */
  readonly topic: ITopic;
}

/**
 * A new subscription.
 *
 * Prefer to use the `ITopic.addSubscription()` methods to create instances of
 * this class.
 *
 * @resource aws_sns_topic_subscription
 */
export class Subscription extends AwsConstructBase {
  /**
   * The DLQ associated with this subscription if present.
   */
  public readonly deadLetterQueue?: notify.IQueue;

  private readonly resource: snsTopicSubscription.SnsTopicSubscription;

  public readonly subscriptionOutputs: SubscriptionOutputs;
  public get outputs(): Record<string, any> {
    return this.subscriptionOutputs;
  }

  constructor(scope: Construct, id: string, props: SubscriptionProps) {
    super(scope, id, props);

    if (
      props.rawMessageDelivery &&
      [
        SubscriptionProtocol.HTTP,
        SubscriptionProtocol.HTTPS,
        SubscriptionProtocol.SQS,
        SubscriptionProtocol.FIREHOSE,
      ].indexOf(props.protocol) < 0
    ) {
      throw new ValidationError(
        "Raw message delivery can only be enabled for HTTP, HTTPS, SQS, and Firehose subscriptions.",
        this,
      );
    }

    let filterPolicyJson: string | undefined;
    /** Whether the filter_policy applies to MessageAttributes (default) or MessageBody */
    let filterPolicyScope: "MessageAttributes" | "MessageBody" | undefined;

    if (props.filterPolicy && props.filterPolicyWithMessageBody) {
      throw new Error(
        "A maximum of one of `filterPolicyWithMessageBody` and `filterPolicy` may be used.",
      );
    }

    if (props.filterPolicy) {
      if (Object.keys(props.filterPolicy).length > 5) {
        throw new ValidationError(
          "A filter policy can have a maximum of 5 attribute names.",
          this,
        );
      }

      const filterPolicyConditions = Object.entries(props.filterPolicy).reduce(
        (acc, [k, v]) => ({ ...acc, [k]: v.conditions }),
        {},
      );

      let total = 1;
      Object.values(filterPolicyConditions).forEach((filter: any) => {
        total *= filter.length;
      });
      if (total > 150) {
        throw new ValidationError(
          `The total combination of values (${total}) must not exceed 150.`,
          this,
        );
      }
      filterPolicyJson = JSON.stringify(filterPolicyConditions);
      filterPolicyScope = "MessageAttributes"; // Default scope
    } else if (props.filterPolicyWithMessageBody) {
      if (Object.keys(props.filterPolicyWithMessageBody).length > 5) {
        throw new ValidationError(
          "A filter policy can have a maximum of 5 attribute names.",
          this,
        );
      }
      const builtPolicy = buildFilterPolicyWithMessageBody(
        this,
        props.filterPolicyWithMessageBody,
      );
      filterPolicyJson = JSON.stringify(builtPolicy);
      filterPolicyScope = "MessageBody";
    }

    if (
      props.protocol === SubscriptionProtocol.FIREHOSE &&
      !props.subscriptionRoleArn
    ) {
      throw new ValidationError(
        "Subscription role arn is required field for subscriptions with a firehose protocol.",
        this,
      );
    }

    this.deadLetterQueue = this.buildDeadLetterQueue(props);
    const redrivePolicyJson = this.buildDeadLetterConfig(this.deadLetterQueue);
    const deliveryPolicyJson = props.deliveryPolicy
      ? this.renderDeliveryPolicy(props.deliveryPolicy, props.protocol)
      : undefined;

    this.resource = new snsTopicSubscription.SnsTopicSubscription(
      this,
      "Resource",
      {
        endpoint: props.endpoint,
        protocol: props.protocol,
        topicArn: props.topic.topicArn,
        rawMessageDelivery: props.rawMessageDelivery,
        filterPolicy: filterPolicyJson,
        filterPolicyScope: filterPolicyScope,
        redrivePolicy: redrivePolicyJson,
        subscriptionRoleArn: props.subscriptionRoleArn,
        deliveryPolicy: deliveryPolicyJson,
        // TODO: Bump to newer provider-aws version to get 'region' property support
        // region: props.topic.stack.region,
        // confirmationTimeoutInMinutes: // Not directly available in CDK props
        // endpointAutoConfirms: // Not directly available in CDK props
        // replayPolicy: // Not directly available in CDK props (missing in AWS CDK)
      },
    );

    this.subscriptionOutputs = {
      subscriptionArn: this.resource.arn,
    };
  }

  private renderDeliveryPolicy(
    deliveryPolicy: DeliveryPolicy,
    protocol: SubscriptionProtocol,
  ): string {
    if (
      ![SubscriptionProtocol.HTTP, SubscriptionProtocol.HTTPS].includes(
        protocol,
      )
    ) {
      throw new ValidationError(
        `Delivery policy is only supported for HTTP and HTTPS subscriptions, got: ${protocol}`,
        this,
      );
    }
    const { healthyRetryPolicy, throttlePolicy, requestPolicy } =
      deliveryPolicy;
    const renderedPolicy: any = {};

    if (healthyRetryPolicy) {
      const delayTargetLimitSecs = 3600;
      const minDelayTarget = healthyRetryPolicy.minDelayTarget;
      const maxDelayTarget = healthyRetryPolicy.maxDelayTarget;
      if (minDelayTarget !== undefined) {
        if (minDelayTarget.toMilliseconds() % 1000 !== 0) {
          throw new ValidationError(
            `minDelayTarget must be a whole number of seconds, got: ${minDelayTarget}`,
            this,
          );
        }
        const minDelayTargetSecs = minDelayTarget.toSeconds();
        if (
          minDelayTargetSecs < 1 ||
          minDelayTargetSecs > delayTargetLimitSecs
        ) {
          throw new ValidationError(
            `minDelayTarget must be between 1 and ${delayTargetLimitSecs} seconds inclusive, got: ${minDelayTargetSecs}s`,
            this,
          );
        }
      }
      if (maxDelayTarget !== undefined) {
        if (maxDelayTarget.toMilliseconds() % 1000 !== 0) {
          throw new ValidationError(
            `maxDelayTarget must be a whole number of seconds, got: ${maxDelayTarget}`,
            this,
          );
        }
        const maxDelayTargetSecs = maxDelayTarget.toSeconds();
        if (
          maxDelayTargetSecs < 1 ||
          maxDelayTargetSecs > delayTargetLimitSecs
        ) {
          throw new ValidationError(
            `maxDelayTarget must be between 1 and ${delayTargetLimitSecs} seconds inclusive, got: ${maxDelayTargetSecs}s`,
            this,
          );
        }
        if (
          minDelayTarget !== undefined &&
          minDelayTarget.toSeconds() > maxDelayTargetSecs
        ) {
          throw new ValidationError(
            "minDelayTarget must not exceed maxDelayTarget",
            this,
          );
        }
      }

      const numRetriesLimit = 100;
      if (
        healthyRetryPolicy.numRetries &&
        (healthyRetryPolicy.numRetries < 0 ||
          healthyRetryPolicy.numRetries > numRetriesLimit)
      ) {
        throw new ValidationError(
          `numRetries must be between 0 and ${numRetriesLimit} inclusive, got: ${healthyRetryPolicy.numRetries}`,
          this,
        );
      }
      const { numNoDelayRetries, numMinDelayRetries, numMaxDelayRetries } =
        healthyRetryPolicy;
      if (
        numNoDelayRetries &&
        (numNoDelayRetries < 0 || !Number.isInteger(numNoDelayRetries))
      ) {
        throw new ValidationError(
          `numNoDelayRetries must be an integer zero or greater, got: ${numNoDelayRetries}`,
          this,
        );
      }
      if (
        numMinDelayRetries &&
        (numMinDelayRetries < 0 || !Number.isInteger(numMinDelayRetries))
      ) {
        throw new ValidationError(
          `numMinDelayRetries must be an integer zero or greater, got: ${numMinDelayRetries}`,
          this,
        );
      }
      if (
        numMaxDelayRetries &&
        (numMaxDelayRetries < 0 || !Number.isInteger(numMaxDelayRetries))
      ) {
        throw new ValidationError(
          `numMaxDelayRetries must be an integer zero or greater, got: ${numMaxDelayRetries}`,
          this,
        );
      }

      renderedPolicy.healthyRetryPolicy = {
        minDelayTarget:
          healthyRetryPolicy.minDelayTarget === undefined
            ? 20
            : healthyRetryPolicy.minDelayTarget.toSeconds(),
        maxDelayTarget:
          healthyRetryPolicy.maxDelayTarget === undefined
            ? 20
            : healthyRetryPolicy.maxDelayTarget.toSeconds(),
        numRetries:
          healthyRetryPolicy.numRetries === undefined
            ? 3
            : healthyRetryPolicy.numRetries,
        numNoDelayRetries: healthyRetryPolicy.numNoDelayRetries,
        numMinDelayRetries: healthyRetryPolicy.numMinDelayRetries,
        numMaxDelayRetries: healthyRetryPolicy.numMaxDelayRetries,
        backoffFunction: healthyRetryPolicy.backoffFunction,
      };
    }

    if (throttlePolicy) {
      const maxReceivesPerSecond = throttlePolicy.maxReceivesPerSecond;
      if (
        maxReceivesPerSecond !== undefined &&
        (maxReceivesPerSecond < 1 || !Number.isInteger(maxReceivesPerSecond))
      ) {
        throw new ValidationError(
          `maxReceivesPerSecond must be an integer greater than zero, got: ${maxReceivesPerSecond}`,
          this,
        );
      }
      renderedPolicy.throttlePolicy = {
        maxReceivesPerSecond: throttlePolicy.maxReceivesPerSecond,
      };
    }

    if (requestPolicy) {
      renderedPolicy.requestPolicy = {
        headerContentType: requestPolicy.headerContentType,
      };
    }

    return JSON.stringify(renderedPolicy);
  }

  private buildDeadLetterQueue(
    props: SubscriptionProps,
  ): notify.IQueue | undefined {
    if (!props.deadLetterQueue) {
      return undefined;
    }

    const deadLetterQueue = props.deadLetterQueue;

    deadLetterQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: [deadLetterQueue.queueArn],
        actions: ["sqs:SendMessage"],
        principals: [new iam.ServicePrincipal("sns.amazonaws.com")],
        condition: [
          {
            test: "ArnEquals",
            variable: "aws:SourceArn",
            values: [props.topic.topicArn],
          },
        ],
      }),
    );

    return deadLetterQueue;
  }

  private buildDeadLetterConfig(
    deadLetterQueue?: notify.IQueue,
  ): string | undefined {
    if (deadLetterQueue) {
      return JSON.stringify({
        deadLetterTargetArn: deadLetterQueue.queueArn,
      });
    } else {
      return undefined;
    }
  }
}

/**
 * The type of subscription, controlling the type of the endpoint parameter.
 */
export enum SubscriptionProtocol {
  /**
   * JSON-encoded message is POSTED to an HTTP url.
   */
  HTTP = "http",

  /**
   * JSON-encoded message is POSTed to an HTTPS url.
   */
  HTTPS = "https",

  /**
   * Notifications are sent via email.
   */
  EMAIL = "email",

  /**
   * Notifications are JSON-encoded and sent via mail.
   */
  EMAIL_JSON = "email-json",

  /**
   * Notification is delivered by SMS
   */
  SMS = "sms",

  /**
   * Notifications are enqueued into an SQS queue.
   */
  SQS = "sqs",

  /**
   * JSON-encoded notifications are sent to a mobile app endpoint.
   */
  APPLICATION = "application",

  /**
   * Notifications trigger a Lambda function.
   */
  LAMBDA = "lambda",

  /**
   * Notifications put records into a firehose delivery stream.
   */
  FIREHOSE = "firehose",
}

function buildFilterPolicyWithMessageBody(
  scope: Construct,
  inputObject: { [key: string]: FilterOrPolicy },
  depth = 1,
  totalCombinationValues = [1],
): { [key: string]: any } {
  const result: { [key: string]: any } = {};

  for (const [key, filterOrPolicy] of Object.entries(inputObject)) {
    if (filterOrPolicy.isPolicy()) {
      result[key] = buildFilterPolicyWithMessageBody(
        scope,
        filterOrPolicy.policyDoc,
        depth + 1,
        totalCombinationValues,
      );
    } else if (filterOrPolicy.isFilter()) {
      const filter = filterOrPolicy.filterDoc.conditions;
      result[key] = filter;
      totalCombinationValues[0] *= filter.length * depth;
    }
  }

  // https://docs.aws.amazon.com/sns/latest/dg/subscription-filter-policy-constraints.html
  if (totalCombinationValues[0] > 150) {
    throw new ValidationError(
      `The total combination of values (${totalCombinationValues}) must not exceed 150.`,
      scope,
    );
  }

  return result;
}

/**
 * The type of the MessageBody at a given key value pair
 */
export enum FilterOrPolicyType {
  /**
   * The filter of the MessageBody
   */
  FILTER,
  /**
   * A nested key of the MessageBody
   */
  POLICY,
}

/**
 * Class for building the FilterPolicy by avoiding union types
 */
export abstract class FilterOrPolicy {
  /**
   * Filter of MessageBody
   */
  public static filter(filter: SubscriptionFilter) {
    return new Filter(filter);
  }

  /**
   * Policy of MessageBody
   */
  public static policy(policy: { [attribute: string]: FilterOrPolicy }) {
    return new Policy(policy);
  }

  /**
   * Type switch for disambiguating between subclasses
   */
  abstract readonly type: FilterOrPolicyType;

  /**
   * Check if instance is `Policy` type
   */
  public isPolicy(): this is Policy {
    return this.type === FilterOrPolicyType.POLICY;
  }

  /**
   * Check if instance is `Filter` type
   */
  public isFilter(): this is Filter {
    return this.type === FilterOrPolicyType.FILTER;
  }
}

/**
 * Filter implementation of FilterOrPolicy
 */
export class Filter extends FilterOrPolicy {
  /**
   * Type used in DFS buildFilterPolicyWithMessageBody to determine json value type
   */
  public readonly type = FilterOrPolicyType.FILTER;
  /**
   * Policy constructor
   * @param filterDoc filter argument to construct
   */
  public constructor(public readonly filterDoc: SubscriptionFilter) {
    super();
  }
}

/**
 * Policy Implementation of FilterOrPolicy
 */
export class Policy extends FilterOrPolicy {
  /**
   * Type used in DFS buildFilterPolicyWithMessageBody to determine json value type
   */
  public readonly type = FilterOrPolicyType.POLICY;
  /**
   * Policy constructor
   * @param policyDoc policy argument to construct
   */
  public constructor(
    public readonly policyDoc: { [attribute: string]: FilterOrPolicy },
  ) {
    super();
  }
}
