// https://github.com/aws/aws-cdk/blob/da2ec75f6bc8f2e28b07cdf1307b22c83bb652d5/packages/aws-cdk-lib/aws-sns/test/sns.test.ts
import { Template } from "../../assertions";
import "cdktf/lib/testing/adapters/jest";
import * as notifications from "../../aws-codestarnotifications";
import * as iam from "../../aws-iam";
import * as kms from "../../aws-kms";
import { Testing, Duration } from "cdktf";
import { AwsStack } from "../../../src/aws/aws-stack";
import {
  Topic,
  TopicPolicy,
  LoggingProtocol,
  SubscriptionProtocol,
  TracingConfig,
} from "../../../src/aws/notify/sns-topic";

describe("Topic", () => {
  let app: ReturnType<typeof Testing.app>;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName: "Test",
      gridUUID: "test-uuid",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: { address: "http://localhost" },
    });
  });

  test("all defaults", () => {
    new Topic(stack, "MyTopic");
    Template.fromStack(stack).resourceCountIs("aws_sns_topic", 1);
  });

  test("specify topicName", () => {
    new Topic(stack, "MyTopic", {
      topicName: "topicName",
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      name: "topicName",
    });
  });

  test("specify displayName", () => {
    new Topic(stack, "MyTopic", {
      displayName: "displayName",
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      display_name: "displayName",
    });
  });

  test("specify kmsMasterKey", () => {
    const key = new kms.Key(stack, "CustomKey");
    new Topic(stack, "MyTopic", {
      masterKey: key,
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      kms_master_key_id: { "Fn::GetAtt": ["CustomKey", "Arn"] },
    });
  });

  test("specify displayName and topicName", () => {
    new Topic(stack, "MyTopic", {
      topicName: "topicName",
      displayName: "displayName",
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      name: "topicName",
      display_name: "displayName",
    });
  });

  test("Adds .fifo suffix when no topicName is passed", () => {
    new Topic(stack, "MyTopic", {
      fifo: true,
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      fifo_topic: true,
      name: "MyTopic.fifo",
    });
  });

  test("specify fifo without .fifo suffix in topicName", () => {
    new Topic(stack, "MyTopic", {
      fifo: true,
      topicName: "topicName",
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      fifo_topic: true,
      name: "topicName.fifo",
    });
  });

  test("specify fifo with .fifo suffix in topicName", () => {
    new Topic(stack, "MyTopic", {
      fifo: true,
      topicName: "topicName.fifo",
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      fifo_topic: true,
      name: "topicName.fifo",
    });
  });

  test("specify fifo without contentBasedDeduplication", () => {
    new Topic(stack, "MyTopic", {
      fifo: true,
      topicName: "topicName",
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      fifo_topic: true,
      name: "topicName.fifo",
      content_based_deduplication: false,
    });
  });

  test("specify fifo with contentBasedDeduplication", () => {
    new Topic(stack, "MyTopic", {
      fifo: true,
      topicName: "topicName",
      contentBasedDeduplication: true,
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      fifo_topic: true,
      name: "topicName.fifo",
      content_based_deduplication: true,
    });
  });

  test("throw with contentBasedDeduplication on non-fifo topic", () => {
    expect(
      () =>
        new Topic(stack, "MyTopic", {
          contentBasedDeduplication: true,
        }),
    ).toThrow(
      /Content based deduplication can only be enabled for FIFO SNS topics\./,
    );
  });

  test("specify signatureVersion", () => {
    new Topic(stack, "MyTopic", {
      signatureVersion: "2",
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      signature_version: "2",
    });
  });

  test("throw with incorrect signatureVersion", () => {
    expect(
      () =>
        new Topic(stack, "MyTopic", {
          signatureVersion: "3",
        }),
    ).toThrow(/signatureVersion must be "1" or "2", received: "3"/);
  });

  test("throw error when displayName is too long", () => {
    expect(
      () =>
        new Topic(stack, "MyTopic", {
          displayName: "a".repeat(101),
        }),
    ).toThrow(
      "displayName must be less than or equal to 100 characters, got 101",
    );
  });

  test("can add a policy to the topic", () => {
    const topic = new Topic(stack, "Topic");
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["sns:*"],
        resources: ["*"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );
    Template.fromStack(stack).hasResourceWithProperties(
      "aws_sns_topic_policy",
      {
        policy: {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "0",
              Action: "sns:*",
              Effect: "Allow",
              Principal: { AWS: "arn" },
              Resource: "*",
            },
          ],
        },
      },
    );
  });

  test("can enforce ssl when creating the topic", () => {
    const topic = new Topic(stack, "Topic", { enforceSSL: true });
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["sns:*"],
        resources: ["*"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );
    Template.fromStack(stack).hasResourceWithProperties(
      "aws_sns_topic_policy",
      {
        policy: {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "0",
              Action: "sns:*",
              Effect: "Allow",
              Principal: { AWS: "arn" },
              Resource: "*",
            },
            {
              Sid: "AllowPublishThroughSSLOnly",
              Action: "sns:Publish",
              Effect: "Deny",
              Resource: { Ref: "Topic" },
              Condition: {
                Bool: { "aws:SecureTransport": "false" },
              },
              Principal: "*",
            },
          ],
        },
      },
    );
  });

  test("give publishing permissions", () => {
    const topic = new Topic(stack, "Topic");
    const user = new iam.User(stack, "User");
    topic.grantPublish(user);
    Template.fromStack(stack).hasResourceWithProperties("aws_iam_policy", {
      PolicyDocument: {
        Statement: [
          {
            Action: "sns:Publish",
            Effect: "Allow",
            Resource: stack.resolve(topic.topicArn),
          },
        ],
      },
    });
  });

  test("give subscribing permissions", () => {
    const topic = new Topic(stack, "Topic");
    const user = new iam.User(stack, "User");
    topic.grantSubscribe(user);
    Template.fromStack(stack).hasResourceWithProperties("aws_iam_policy", {
      PolicyDocument: {
        Statement: [
          {
            Action: "sns:Subscribe",
            Effect: "Allow",
            Resource: stack.resolve(topic.topicArn),
          },
        ],
      },
    });
  });

  test("TopicPolicy passed document", () => {
    const topic = new Topic(stack, "MyTopic");
    const ps = new iam.PolicyStatement({
      actions: ["service:statement0"],
      principals: [new iam.ArnPrincipal("arn")],
    });
    new TopicPolicy(stack, "topicpolicy", {
      topics: [topic],
      policyDocument: new iam.PolicyDocument({
        assignSids: true,
        statements: [ps],
      }),
    });
    Template.fromStack(stack).hasResourceWithProperties(
      "aws_sns_topic_policy",
      {
        policy: {
          Statement: [
            {
              Action: "service:statement0",
              Effect: "Allow",
              Principal: { AWS: "arn" },
              Sid: "0",
            },
          ],
          Version: "2012-10-17",
        },
        topics: [{ Ref: "MyTopic" }],
      },
    );
  });

  test("Add statements to policy", () => {
    const topic = new Topic(stack, "MyTopic");
    const topicPolicy = new TopicPolicy(stack, "TopicPolicy", {
      topics: [topic],
    });
    topicPolicy.document.addStatements(
      new iam.PolicyStatement({
        actions: ["service:statement0"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );
    Template.fromStack(stack).hasResourceProperties("aws_sns_topic_policy", {
      policy: {
        Statement: [
          {
            Action: "service:statement0",
            Effect: "Allow",
            Principal: { AWS: "arn" },
            Sid: "0",
          },
        ],
        Version: "2012-10-17",
      },
      topics: [{ Ref: "MyTopic" }],
    });
  });

  test("Create topic policy and enforce ssl", () => {
    new TopicPolicy(stack, "TopicPolicy", {
      topics: [new Topic(stack, "MyTopic")],
      enforceSSL: true,
    });
    Template.fromStack(stack).hasResourceProperties("aws_sns_topic_policy", {
      policy: {
        Statement: [
          {
            Sid: "AllowPublishThroughSSLOnly",
            Action: "sns:Publish",
            Effect: "Deny",
            Resource: { Ref: "MyTopic" },
            Condition: { Bool: { "aws:SecureTransport": "false" } },
            Principal: "*",
          },
        ],
        Version: "2012-10-17",
      },
    });
  });

  test("topic resource policy includes unique SIDs", () => {
    const topic = new Topic(stack, "MyTopic");
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["service:statement0"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["service:statement1"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );
    Template.fromStack(stack).hasResourceProperties("aws_sns_topic_policy", {
      policy: {
        Statement: [
          {
            Action: "service:statement0",
            Effect: "Allow",
            Principal: { AWS: "arn" },
            Sid: "0",
          },
          {
            Action: "service:statement1",
            Effect: "Allow",
            Principal: { AWS: "arn" },
            Sid: "1",
          },
        ],
        Version: "2012-10-17",
      },
      topics: [{ Ref: "MyTopic" }],
    });
  });

  test("fromTopicArn", () => {
    const imported = Topic.fromTopicArn(
      stack,
      "Imported",
      "arn:aws:sns:*:123456789012:my_corporate_topic",
    );
    expect(imported.topicName).toEqual("my_corporate_topic");
    expect(imported.topicArn).toEqual(
      "arn:aws:sns:*:123456789012:my_corporate_topic",
    );
    expect(imported.fifo).toEqual(false);
  });

  test("fromTopicArn fifo", () => {
    const imported = Topic.fromTopicArn(
      stack,
      "Imported",
      "arn:aws:sns:*:123456789012:mytopic.fifo",
    );
    expect(imported.topicName).toEqual("mytopic.fifo");
    expect(imported.topicArn).toEqual(
      "arn:aws:sns:*:123456789012:mytopic.fifo",
    );
    expect(imported.fifo).toEqual(true);
  });

  test("fromTopicAttributes contentBasedDeduplication false", () => {
    const imported = Topic.fromTopicAttributes(stack, "Imported", {
      topicArn: "arn:aws:sns:*:123456789012:mytopic",
    });
    expect(imported.topicName).toEqual("mytopic");
    expect(imported.topicArn).toEqual("arn:aws:sns:*:123456789012:mytopic");
    expect(imported.contentBasedDeduplication).toEqual(false);
  });

  test("fromTopicAttributes contentBasedDeduplication true", () => {
    const imported = Topic.fromTopicAttributes(stack, "Imported", {
      topicArn: "arn:aws:sns:*:123456789012:mytopic.fifo",
      contentBasedDeduplication: true,
    });
    expect(imported.topicName).toEqual("mytopic.fifo");
    expect(imported.topicArn).toEqual(
      "arn:aws:sns:*:123456789012:mytopic.fifo",
    );
    expect(imported.contentBasedDeduplication).toEqual(true);
  });

  test("fromTopicAttributes throws with contentBasedDeduplication on non-fifo topic", () => {
    expect(() =>
      Topic.fromTopicAttributes(stack, "Imported", {
        topicArn: "arn:aws:sns:*:123456789012:mytopic",
        contentBasedDeduplication: true,
      }),
    ).toThrow(
      /Cannot import topic; contentBasedDeduplication is only available for FIFO SNS topics\./,
    );
  });

  test("sets account for imported topic env", () => {
    const imported = Topic.fromTopicArn(
      stack,
      "Imported",
      "arn:aws:sns:us-west-2:123456789012:my-topic",
    );
    expect(imported.env.account).toEqual("123456789012");
  });

  test("sets region for imported topic env", () => {
    const imported = Topic.fromTopicArn(
      stack,
      "Imported",
      "arn:aws:sns:us-west-2:123456789012:my-topic",
    );
    expect(imported.env.region).toEqual("us-west-2");
  });

  test("test metrics", () => {
    const topic = new Topic(stack, "Topic");
    expect(stack.resolve(topic.metricNumberOfMessagesPublished())).toEqual({
      dimensions: { TopicName: { "Fn::GetAtt": ["Topic", "TopicName"] } },
      namespace: "AWS/SNS",
      metricName: "NumberOfMessagesPublished",
      period: Duration.minutes(5),
      statistic: "Sum",
    });
    expect(stack.resolve(topic.metricPublishSize())).toEqual({
      dimensions: { TopicName: { "Fn::GetAtt": ["Topic", "TopicName"] } },
      namespace: "AWS/SNS",
      metricName: "PublishSize",
      period: Duration.minutes(5),
      statistic: "Average",
    });
  });

  test("subscription is created under the topic scope by default", () => {
    const topic = new Topic(stack, "Topic");
    topic.addSubscription({
      bind: () => ({
        protocol: SubscriptionProtocol.HTTP,
        endpoint: "http://foo/bar",
        subscriberId: "my-subscription",
      }),
    });
    Template.fromStack(stack).resourceCountIs("aws_sns_subscription", 1);
  });

  test("if 'scope' is defined, subscription will be created under that scope", () => {
    const appInstance = Testing.app();
    const stackA = new AwsStack(appInstance, "A", {
      environmentName: "Test",
      gridUUID: "uuid-A",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: { address: "http://localhost" },
    });
    const stackB = new AwsStack(appInstance, "B", {
      environmentName: "Test",
      gridUUID: "uuid-B",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: { address: "http://localhost" },
    });
    const topic = new Topic(stackA, "Topic");
    topic.addSubscription({
      bind: () => ({
        protocol: SubscriptionProtocol.HTTP,
        endpoint: "http://foo/bar",
        subscriberScope: stackB,
        subscriberId: "subscriberId",
      }),
    });
    Template.fromStack(stackA).resourceCountIs("aws_sns_subscription", 0);
    Template.fromStack(stackB).resourceCountIs("aws_sns_subscription", 1);
  });

  test("fails if topic policy has no actions", () => {
    const appInstance = Testing.app();
    const stackInstance = new AwsStack(appInstance, "my-stack", {
      environmentName: "Test",
      gridUUID: "uuid",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: { address: "http://localhost" },
    });
    const topic = new Topic(stackInstance, "Topic");
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );
    expect(() => appInstance.synth()).toThrow(
      /A PolicyStatement must specify at least one 'action' or 'notAction'/,
    );
  });

  test("fails if topic policy has no IAM principals", () => {
    const appInstance = Testing.app();
    const stackInstance = new AwsStack(appInstance, "my-stack", {
      environmentName: "Test",
      gridUUID: "uuid",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: { address: "http://localhost" },
    });
    const topic = new Topic(stackInstance, "Topic");
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["sns:*"],
      }),
    );
    expect(() => appInstance.synth()).toThrow(
      /A PolicyStatement used in a resource-based policy must specify at least one IAM principal/,
    );
  });

  test("topic policy should be set if topic as a notifications rule target", () => {
    const appInstance = Testing.app();
    const stackInstance = new AwsStack(appInstance, "my-stack", {
      environmentName: "Test",
      gridUUID: "uuid",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: { address: "http://localhost" },
    });
    const topic = new Topic(stackInstance, "Topic");
    const rule = new notifications.NotificationRule(
      stackInstance,
      "MyNotificationRule",
      {
        source: {
          bindAsNotificationRuleSource: () => ({ sourceArn: "ARN" }),
        },
        events: ["codebuild-project-build-state-succeeded"],
      },
    );
    rule.addTarget(topic);
    Template.fromStack(stackInstance).hasResourceWithProperties(
      "aws_sns_topic_policy",
      {
        policy: {
          Statement: [
            {
              Sid: "0",
              Action: "sns:Publish",
              Effect: "Allow",
              Principal: { Service: "codestar-notifications.amazonaws.com" },
              Resource: { Ref: "Topic" },
            },
          ],
          Version: "2012-10-17",
        },
        topics: [{ Ref: "Topic" }],
      },
    );
  });

  test("specify delivery status logging configuration through construct props", () => {
    const feedbackRole = new iam.Role(stack, "feedbackRole", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
    });
    new Topic(stack, "MyTopic", {
      loggingConfigs: [
        {
          protocol: LoggingProtocol.SQS,
          failureFeedbackRole: feedbackRole,
          successFeedbackRole: feedbackRole,
          successFeedbackSampleRate: 50,
        },
      ],
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      delivery_status_logging: [
        {
          protocol: "sqs",
          success_feedback_role_arn: { "Fn::GetAtt": ["feedbackRole", "Arn"] },
          failure_feedback_role_arn: { "Fn::GetAtt": ["feedbackRole", "Arn"] },
          success_feedback_sample_rate: "50",
        },
      ],
    });
  });

  test("add delivery status logging configuration to a topic", () => {
    const feedbackRole = new iam.Role(stack, "feedbackRole", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
    });
    const topic = new Topic(stack, "MyTopic");
    topic.addLoggingConfig({
      protocol: LoggingProtocol.HTTP,
      failureFeedbackRole: feedbackRole,
      successFeedbackRole: feedbackRole,
      successFeedbackSampleRate: 50,
    });
    Template.fromStack(stack).hasResourceWithProperties("aws_sns_topic", {
      delivery_status_logging: [
        {
          protocol: "http/s",
          success_feedback_role_arn: { "Fn::GetAtt": ["feedbackRole", "Arn"] },
          failure_feedback_role_arn: { "Fn::GetAtt": ["feedbackRole", "Arn"] },
          success_feedback_sample_rate: "50",
        },
      ],
    });
  });

  test("fails if success feedback sample rate is outside the appropriate range", () => {
    const appInstance = Testing.app();
    const stackInstance = new AwsStack(appInstance, "my-stack", {
      environmentName: "Test",
      gridUUID: "uuid",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: { address: "http://localhost" },
    });
    const feedbackRole = new iam.Role(stackInstance, "feedbackRole", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
    });
    new Topic(stackInstance, "MyTopic", {
      loggingConfigs: [
        {
          protocol: LoggingProtocol.SQS,
          failureFeedbackRole: feedbackRole,
          successFeedbackRole: feedbackRole,
          successFeedbackSampleRate: 110,
        },
      ],
    });
    expect(() => appInstance.synth()).toThrow(
      /Success feedback sample rate must be an integer between 0 and 100/,
    );
  });

  test("fails if success feedback sample rate is decimal", () => {
    const appInstance = Testing.app();
    const stackInstance = new AwsStack(appInstance, "my-stack", {
      environmentName: "Test",
      gridUUID: "uuid",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: { address: "http://localhost" },
    });
    const feedbackRole = new iam.Role(stackInstance, "feedbackRole", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
    });
    new Topic(stackInstance, "MyTopic", {
      loggingConfigs: [
        {
          protocol: LoggingProtocol.SQS,
          failureFeedbackRole: feedbackRole,
          successFeedbackRole: feedbackRole,
          successFeedbackSampleRate: 50.4,
        },
      ],
    });
    expect(() => appInstance.synth()).toThrow(
      /Success feedback sample rate must be an integer between 0 and 100/,
    );
  });
});
