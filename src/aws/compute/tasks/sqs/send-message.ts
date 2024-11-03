import { Construct } from "constructs";
import * as compute from "../../";
import { Duration } from "../../../../duration";
import * as iam from "../../../iam";
import * as notify from "../../../notify";
import {
  integrationResourceArn,
  validatePatternSupported,
} from "../private/task-utils";

/**
 * Properties for sending a message to an SQS queue
 */
export interface SqsSendMessageProps extends compute.TaskStateBaseProps {
  /**
   * The SQS queue that messages will be sent to
   */
  readonly queue: notify.IQueue;

  /**
   * The text message to send to the queue.
   */
  readonly messageBody: compute.TaskInput;

  /**
   * The length of time, for which to delay a message.
   * Messages that you send to the queue remain invisible to consumers for the duration
   * of the delay period. The maximum allowed delay is 15 minutes.
   *
   * @default - delay set on the queue. If a delay is not set on the queue,
   *   messages are sent immediately (0 seconds).
   */
  readonly delay?: Duration;

  /**
   * The token used for deduplication of sent messages.
   * Any messages sent with the same deduplication ID are accepted successfully,
   * but aren't delivered during the 5-minute deduplication interval.
   *
   * @default - None
   */
  readonly messageDeduplicationId?: string;

  /**
   * The tag that specifies that a message belongs to a specific message group.
   *
   * Messages that belong to the same message group are processed in a FIFO manner.
   * Messages in different message groups might be processed out of order.
   *
   * @default - None
   */
  readonly messageGroupId?: string;
}

/**
 * A StepFunctions Task to send messages to SQS queue.
 *
 */
export class SqsSendMessage extends compute.TaskStateBase {
  private static readonly SUPPORTED_INTEGRATION_PATTERNS: compute.IntegrationPattern[] =
    [
      compute.IntegrationPattern.REQUEST_RESPONSE,
      compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    ];

  // protected readonly taskMetrics?: compute.TaskMetricsConfig;
  protected readonly taskPolicies?: iam.PolicyStatement[];

  private readonly integrationPattern: compute.IntegrationPattern;

  constructor(
    scope: Construct,
    id: string,
    private readonly props: SqsSendMessageProps,
  ) {
    super(scope, id, props);
    this.integrationPattern =
      props.integrationPattern ?? compute.IntegrationPattern.REQUEST_RESPONSE;

    validatePatternSupported(
      this.integrationPattern,
      SqsSendMessage.SUPPORTED_INTEGRATION_PATTERNS,
    );

    if (
      props.integrationPattern ===
      compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN
    ) {
      if (!compute.FieldUtils.containsTaskToken(props.messageBody)) {
        throw new Error(
          "Task Token is required in `messageBody` Use JsonPath.taskToken to set the token.",
        );
      }
    }

    this.taskPolicies = [
      new iam.PolicyStatement({
        actions: ["sqs:SendMessage"],
        resources: [this.props.queue.queueArn],
      }),
    ];

    // // TODO: Re-Add encryption support
    // // sending to an encrypted queue requires
    // // permissions on the associated kms key
    // if (this.props.queue.encryptionMasterKey) {
    //   this.taskPolicies.push(
    //     new iam.PolicyStatement({
    //       actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
    //       resources: [this.props.queue.encryptionMasterKey.keyArn],
    //     }),
    //   );
    // }
  }

  /**
   * Provides the SQS SendMessage service integration task configuration
   */
  /**
   * @internal
   */
  protected _renderTask(): any {
    return {
      Resource: integrationResourceArn(
        this,
        "sqs",
        "sendMessage",
        this.integrationPattern,
      ),
      Parameters: compute.FieldUtils.renderObject({
        QueueUrl: this.props.queue.queueUrl,
        MessageBody: this.props.messageBody.value,
        DelaySeconds: this.props.delay?.toSeconds(),
        MessageDeduplicationId: this.props.messageDeduplicationId,
        MessageGroupId: this.props.messageGroupId,
      }),
    };
  }
}
