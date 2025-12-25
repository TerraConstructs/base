// https://github.com/aws/aws-cdk/blob/v2.176.0/packages/aws-cdk-lib/aws-sns-subscriptions/test/sqs.test.ts
import { snsTopicSubscription } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as encryption from "../../../../src/aws/encryption";
import * as notify from "../../../../src/aws/notify";
import * as subscriptions from "../../../../src/aws/notify/subscriptions";
import { Template } from "../../../assertions";

describe("SNS Subscriptions", () => {
  test("can add subscription to queue that has encryptionType auto changed", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);
    const key = new encryption.Key(stack, "CustomKey");
    const queue = new notify.Queue(stack, "Queue", {
      encryption: notify.QueueEncryption.KMS_MANAGED,
      encryptionMasterKey: key,
    });

    const someTopic = new notify.Topic(stack, "Topic");
    someTopic.addSubscription(
      new subscriptions.SqsSubscription(queue, {
        rawMessageDelivery: true,
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        endpoint: stack.resolve(queue.queueArn),
        protocol: "sqs",
      },
    );
  });
});
