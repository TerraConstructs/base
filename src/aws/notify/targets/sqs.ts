import * as notify from "..";
import {
  addToDeadLetterQueueResourcePolicy,
  TargetBaseProps,
  bindBaseTargetConfig,
} from "./util";
import * as iam from "../../iam";

/**
 * Customize the SQS Queue Event Target
 */
export interface SqsQueueProps extends TargetBaseProps {
  /**
   * Message Group ID for messages sent to this queue
   *
   * Required for FIFO queues, leave empty for regular queues.
   *
   * @default - no message group ID (regular queue)
   */
  readonly messageGroupId?: string;

  /**
   * The message to send to the queue.
   *
   * Must be a valid JSON text passed to the target queue.
   *
   * @default the entire EventBridge event
   */
  readonly message?: notify.RuleTargetInput;
}

/**
 * Use an SQS Queue as a target for Amazon EventBridge rules.
 *
 * @example
 *   /// fixture=withRepoAndSqsQueue
 *   // publish to an SQS queue every time code is committed
 *   // to a CodeCommit repository
 *   repository.onCommit('onCommit', { target: new targets.SqsQueue(queue) });
 *
 */
export class SqsQueue implements notify.IRuleTarget {
  constructor(
    public readonly queue: notify.IQueue,
    private readonly props: SqsQueueProps = {},
  ) {
    if (props.messageGroupId !== undefined && !queue.fifo) {
      throw new Error("messageGroupId cannot be specified for non-FIFO queues");
    }
  }

  /**
   * Returns a RuleTarget that can be used to trigger this SQS queue as a
   * result from an EventBridge event.
   *
   * @see https://docs.aws.amazon.com/eventbridge/latest/userguide/resource-based-policies-eventbridge.html#sqs-permissions
   */
  public bind(rule: notify.IRule, _id?: string): notify.RuleTargetConfig {
    // restrict to same account
    let conditions: iam.Conditions = [
      // Add only the account id as a condition, to avoid circular dependency.
      // https://github.com/aws/aws-cdk/issues/11158
      {
        test: "StringEquals",
        variable: "aws:SourceAccount",
        values: [rule.env.account],
      },
    ];
    // //TODO: Re-add KMS support
    // //TODO: Update Tests as well
    // if (!this.queue.encryptionMasterKey) {
    // conditions = [
    //   {
    //     test: "ArnEquals",
    //     variable: "aws:SourceArn",
    //     values: [rule.ruleArn],
    //   },
    // ];
    // }

    // deduplicated automatically (by PolicyDocument PostProcessor)
    this.queue.grantSendMessages(
      new iam.ServicePrincipal("events.amazonaws.com", { conditions }),
    );

    if (this.props.deadLetterQueue) {
      addToDeadLetterQueueResourcePolicy(rule, this.props.deadLetterQueue);
    }

    return {
      ...bindBaseTargetConfig(this.props),
      arn: this.queue.queueArn,
      input: this.props.message,
      targetResource: this.queue,
      sqsParameters: this.props.messageGroupId
        ? { messageGroupId: this.props.messageGroupId }
        : undefined,
    };
  }
}
