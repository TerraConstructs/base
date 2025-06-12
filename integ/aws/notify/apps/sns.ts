// https://github.com/aws/aws-cdk/blob/v2.176.0/packages/%40aws-cdk-testing/framework-integ/test/aws-sns/test/integ.sns.ts

import { App, LocalBackend } from "cdktf";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sns";

class SNSInteg extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const key = new aws.encryption.Key(this, "CustomKey", {
      pendingWindow: Duration.days(7),
      //   removalPolicy: RemovalPolicy.DESTROY, // not supported by TerraConstructs
    });

    const topic = new aws.notify.Topic(this, "MyTopic", {
      topicName: "fooTopic",
      displayName: "fooDisplayName",
      masterKey: key,
    });

    const feedbackRole = new aws.iam.Role(this, "FeedbackRole", {
      assumedBy: new aws.iam.ServicePrincipal("sns.amazonaws.com"),
    });
    const deliveryLoggingPolicy = new aws.iam.ManagedPolicy(this, "Policy", {
      document: new aws.iam.PolicyDocument(this, "DeliveryPolicyDocument", {
        statement: [
          new aws.iam.PolicyStatement({
            actions: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "logs:PutMetricFilter",
              "logs:PutRetentionPolicy",
            ],
            resources: ["*"],
          }),
        ],
      }),
    });
    deliveryLoggingPolicy.attachToRole(feedbackRole);

    topic.addLoggingConfig({
      protocol: aws.notify.LoggingProtocol.HTTP,
      failureFeedbackRole: feedbackRole,
      successFeedbackRole: feedbackRole,
      successFeedbackSampleRate: 50,
    });

    // Topic with signatureVersion
    new aws.notify.Topic(this, "MyTopicSignatureVersion", {
      topicName: "fooTopicSignatureVersion",
      displayName: "fooDisplayNameSignatureVersion",
      signatureVersion: "2",
    });

    // Topic with tracingConfig
    new aws.notify.Topic(this, "MyTopicTracingConfig", {
      topicName: "fooTopicTracingConfig",
      displayName: "fooDisplayNameTracingConfig",
      tracingConfig: aws.notify.TracingConfig.ACTIVE,
    });

    // Can import topic
    const topic2 = new aws.notify.Topic(this, "MyTopic2", {
      topicName: "fooTopic2",
      displayName: "fooDisplayName2",
      masterKey: key,
    });
    const importedTopic = aws.notify.Topic.fromTopicArn(
      this,
      "ImportedTopic",
      topic2.topicArn,
    );

    const publishRole = new aws.iam.Role(this, "PublishRole", {
      assumedBy: new aws.iam.ServicePrincipal("s3.amazonaws.com"),
    });
    importedTopic.grantPublish(publishRole);
  }
}

const app = new App({
  outdir,
});
const stack = new SNSInteg(app, stackName, {
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
