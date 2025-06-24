import { Annotations } from "cdktf";
import { Construct, IConstruct, Node } from "constructs";
import * as notify from "..";
import { Duration } from "../../../duration";
import { TokenComparison, tokenCompareStrings } from "../../../token";
import { AwsStack } from "../../aws-stack";
import * as compute from "../../compute";
import * as iam from "../../iam";

/**
 * The generic properties for an RuleTarget
 */
export interface TargetBaseProps {
  /**
   * The SQS queue to be used as deadLetterQueue.
   * Check out the [considerations for using a dead-letter queue](https://docs.aws.amazon.com/eventbridge/latest/userguide/rule-dlq.html#dlq-considerations).
   *
   * The events not successfully delivered are automatically retried for a specified period of time,
   * depending on the retry policy of the target.
   * If an event is not delivered before all retry attempts are exhausted, it will be sent to the dead letter queue.
   *
   * @default - no dead-letter queue
   */
  readonly deadLetterQueue?: notify.IQueue;
  /**
   * The maximum age of a request that Lambda sends to a function for
   * processing.
   *
   * Minimum value of 60.
   * Maximum value of 86400.
   *
   * @default Duration.hours(24)
   */
  readonly maxEventAge?: Duration;

  /**
   * The maximum number of times to retry when the function returns an error.
   *
   * Minimum value of 0.
   * Maximum value of 185.
   *
   * @default 185
   */
  readonly retryAttempts?: number;
}

/**
 * Bind props to base rule target config.
 * @internal
 */
export function bindBaseTargetConfig(props: TargetBaseProps) {
  const { deadLetterQueue, retryAttempts, maxEventAge } = props;

  return {
    deadLetterConfig: deadLetterQueue
      ? { arn: deadLetterQueue?.queueArn }
      : undefined,
    retryPolicy:
      (retryAttempts !== undefined && retryAttempts >= 0) || maxEventAge
        ? {
            maximumRetryAttempts: retryAttempts,
            maximumEventAgeInSeconds: maxEventAge?.toSeconds({
              integral: true,
            }),
          }
        : undefined,
  };
}

/**
 * Obtain the Role for the EventBridge event
 *
 * If a role already exists, it will be returned. This ensures that if multiple
 * events have the same target, they will share a role.
 * @internal
 */
export function singletonEventRole(scope: IConstruct): iam.IRole {
  const id = "EventsRole";
  const existing = scope.node.tryFindChild(id) as iam.IRole;
  if (existing) {
    return existing;
  }

  const role = new iam.Role(scope as Construct, id, {
    assumedBy: new iam.ServicePrincipal("events.amazonaws.com"), // TODO: Should be "events"?
  });

  return role;
}

/**
 * Allows a Lambda function to be called from a rule
 * @internal
 */
export function addLambdaPermission(
  rule: notify.IRule,
  handler: compute.IFunction,
): void {
  let scope: Construct | undefined;
  let node: Node = handler.permissionsNode;
  let permissionId = `AllowEventRule${AwsStack.uniqueId(rule.node)}`;
  if (rule instanceof Construct) {
    // Place the Permission resource in the same stack as Rule rather than the Function
    // This is to reduce circular dependency when the lambda handler and the rule are across stacks.
    scope = rule;
    node = rule.node;
    permissionId = `AllowEventRule${AwsStack.uniqueId(handler.node)}`;
  }
  if (!node.tryFindChild(permissionId)) {
    handler.addPermission(permissionId, {
      scope,
      action: "lambda:InvokeFunction",
      principal: new iam.ServicePrincipal("events.amazonaws.com"),
      sourceArn: rule.ruleArn,
    });
  }
}

/**
 * Allow a rule to send events with failed invocation to an Amazon SQS queue.
 * @internal
 */
export function addToDeadLetterQueueResourcePolicy(
  rule: notify.IRule,
  queue: notify.IQueue,
) {
  if (!sameEnvDimension(rule.env.region, queue.env.region)) {
    throw new Error(
      `Cannot assign Dead Letter Queue in region ${queue.env.region} to the rule ${AwsStack.uniqueId(rule.node)} in region ${rule.env.region}. Both the queue and the rule must be in the same region.`,
    );
  }

  // Skip Resource Policy creation if the Queue is not in the same account.
  // There is no way to add a target onto an imported rule, so we can assume we will run the following code only
  // in the account where the rule is created.
  if (sameEnvDimension(rule.env.account, queue.env.account)) {
    const policyStatementId = `AllowEventRule${AwsStack.uniqueId(rule.node)}`;

    queue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: policyStatementId,
        principals: [new iam.ServicePrincipal("events.amazonaws.com")],
        effect: iam.Effect.ALLOW,
        actions: ["sqs:SendMessage"],
        resources: [queue.queueArn],
        condition: [
          {
            test: "ArnEquals",
            variable: "aws:SourceArn",
            values: [rule.ruleArn],
          },
        ],
      }),
    );
  } else {
    // "@aws-cdk/aws-events-targets:manuallyAddDLQResourcePolicy",
    Annotations.of(rule).addWarning(
      `Cannot add a resource policy to your dead letter queue associated with rule ${rule.ruleName} because the queue is in a different account. You must add the resource policy manually to the dead letter queue in account ${queue.env.account}.`,
    );
  }
}

/**
 * Whether two string probably contain the same environment dimension (region or account)
 *
 * Used to compare either accounts or regions on a best effort basis. If we cannot tell definitively
 * that the dimensions are in different environments, we will pass.
 *
 * For example, returns true if both are unresolved (in which case both are expected to be
 * "current region" or "current account").
 *
 * Also returns true if one is unresolved (in which case we expect the unresolved dimension to match
 * the resolved dimension, but it is up to the user to ensure this). Returning true here makes sure
 * that we are not overly aggressive in producing a synth-time error.
 *
 * @internal
 */
function sameEnvDimension(dim1: string, dim2: string) {
  return [
    TokenComparison.SAME,
    TokenComparison.ONE_UNRESOLVED,
    TokenComparison.BOTH_UNRESOLVED,
  ].includes(tokenCompareStrings(dim1, dim2));
}
