//https://github.com/aws/aws-cdk/blob/v2.176.0/packages/%40aws-cdk-testing/framework-integ/test/aws-sns-subscriptions/test/integ.sns-aws.notify.ts#L1

import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sns-sqs";

class SnsToSqsStack extends aws.AwsStack {
  topic: aws.notify.Topic;
  queue: aws.notify.Queue;
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);
    this.topic = new aws.notify.Topic(this, "MyTopic", {
      registerOutputs: true,
      outputName: "my_topic",
    });
    // TODO: cross stack integ test?
    // const queueStack = new aws.AwsStack(app, "QueueStack");
    // this.queue = new aws.notify.Queue(queueStack, "MyQueue");
    this.queue = new aws.notify.Queue(this, "MyQueue", {
      registerOutputs: true,
      outputName: "my_queue",
    });
    this.topic.addSubscription(
      new aws.notify.subscriptions.SqsSubscription(this.queue, {
        filterPolicyWithMessageBody: {
          background: aws.notify.Policy.policy({
            color: aws.notify.Filter.filter(
              aws.notify.SubscriptionFilter.stringFilter({
                allowlist: ["red", "green"],
                denylist: ["white", "orange"],
              }),
            ),
          }),
          price: aws.notify.Filter.filter(
            aws.notify.SubscriptionFilter.numericFilter({
              allowlist: [100, 200],
              between: { start: 300, stop: 350 },
              greaterThan: 500,
              lessThan: 1000,
              betweenStrict: { start: 2000, stop: 3000 },
            }),
          ),
        },
      }),
    );
  }
}

const app = new App({
  outdir,
});
const stack = new SnsToSqsStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
app.synth();

// TODO: Add validation of integ test
// import { IntegTest, ExpectedResult } from "@aws-cdk/integ-tests-alpha";
// const integTest = new IntegTest(app, "SNS Subscriptions", {
//   testCases: [stack],
// });
// integTest.assertions.awsApiCall("SNS", "publish", {
//   Message: "{ background: { color: 'green' }, price: 200 }",
//   TopicArn: stack.topic.topicArn,
// });
// const message = integTest.assertions.awsApiCall("SQS", "receiveMessage", {
//   QueueUrl: stack.queue.queueUrl,
//   WaitTimeSeconds: 20,
// });
// message.expect(
//   ExpectedResult.objectLike({
//     Messages: [{ Body: '{color: "green", price: 200}' }],
//   }),
// );
