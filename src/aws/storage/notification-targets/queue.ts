import { Annotations } from "cdktf";
import { Construct } from "constructs";
import * as storage from "..";
import * as iam from "../../iam";
import { IQueue } from "../../notify";

/**
 * Use an SQS queue as a bucket notification destination
 */
export class QueueDestination
  implements storage.IBucketNotificationDestination
{
  constructor(private readonly queue: IQueue) {}

  /**
   * Allows using SQS queues as destinations for bucket notifications.
   * Use `bucket.onEvent(event, queue)` to subscribe.
   */
  public bind(
    _scope: Construct,
    bucket: storage.IBucket,
  ): storage.BucketNotificationDestinationConfig {
    this.queue.grantSendMessages(
      new iam.ServicePrincipal("s3.amazonaws.com", {
        conditions: [
          {
            test: "ArnLike",
            variable: "aws:SourceArn",
            values: [bucket.bucketArn],
          },
        ],
      }),
    );

    // if this queue is encrypted, we need to allow S3 to read messages since that's how
    // it verifies that the notification destination configuration is valid.
    if (this.queue.encryptionMasterKey) {
      const statement = new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("s3.amazonaws.com")],
        actions: ["kms:GenerateDataKey*", "kms:Decrypt"],
        resources: ["*"],
      });
      const addResult = this.queue.encryptionMasterKey.addToResourcePolicy(
        statement,
        /* allowNoOp */ true,
      );
      if (!addResult.statementAdded) {
        Annotations.of(this.queue.encryptionMasterKey).addWarning(
          `Can not change key policy of imported kms key. Ensure that your key policy contains the following permissions: \n${JSON.stringify(statement.toJSON(), null, 2)}`,
        );
      }
    }

    return {
      arn: this.queue.queueArn,
      type: storage.BucketNotificationDestinationType.QUEUE,
      dependencies: [this.queue],
    };
  }
}
