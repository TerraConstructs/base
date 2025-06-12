// https://github.com/aws/aws-cdk/blob/v2.176.0/packages/%40aws-cdk-testing/framework-integ/test/aws-sns-subscriptions/test/integ.sns-url.ts

import { App, LocalBackend } from "cdktf";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sns-url";

class SnsToUrlStack extends aws.AwsStack {
  topic: aws.notify.Topic;
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);
    this.topic = new aws.notify.Topic(this, "MyTopic");

    this.topic.addSubscription(
      new aws.notify.subscriptions.UrlSubscription("https://foobar.com/", {
        deliveryPolicy: {
          healthyRetryPolicy: {
            minDelayTarget: Duration.seconds(20),
            maxDelayTarget: Duration.seconds(21),
            numRetries: 10,
          },
          throttlePolicy: {
            maxReceivesPerSecond: 10,
          },
          requestPolicy: {
            headerContentType: "application/json",
          },
        },
      }),
    );
  }
}

const app = new App({
  outdir,
});

const stack = new SnsToUrlStack(app, stackName, {
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
