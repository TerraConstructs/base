// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-sns/test/sns.test.ts

import {
  snsTopic,
  snsTopicPolicy,
  snsTopicSubscription,
  dataAwsIamPolicyDocument,
  iamUserPolicy,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as kms from "../../../src/aws/encryption";
import * as iam from "../../../src/aws/iam";
import * as sns from "../../../src/aws/notify";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

describe("Topic", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
  });

  describe("topic tests", () => {
    test("all defaults", () => {
      new sns.Topic(stack, "MyTopic");

      const t = new Template(stack);
      t.resourceCountIs(snsTopic.SnsTopic, 1);
    });

    test("specify topicName", () => {
      new sns.Topic(stack, "MyTopic", {
        topicName: "topicName",
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        name: "topicName",
      });
    });

    test("specify displayName", () => {
      new sns.Topic(stack, "MyTopic", {
        displayName: "displayName",
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        display_name: "displayName",
      });
    });

    test("specify kmsMasterKey", () => {
      const key = new kms.Key(stack, "CustomKey");

      new sns.Topic(stack, "MyTopic", {
        masterKey: key,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        kms_master_key_id: stack.resolve(key.keyArn),
      });
    });

    test("specify displayName and topicName", () => {
      new sns.Topic(stack, "MyTopic", {
        topicName: "topicName",
        displayName: "displayName",
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        display_name: "displayName",
        name: "topicName",
      });
    });

    test("Adds .fifo suffix when no topicName is passed", () => {
      new sns.Topic(stack, "MyTopic", {
        fifo: true,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        fifo_topic: true,
        name: "MyTopic.fifo",
      });
    });

    test("specify fifo without .fifo suffix in topicName", () => {
      new sns.Topic(stack, "MyTopic", {
        fifo: true,
        topicName: "topicName",
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        fifo_topic: true,
        name: "topicName.fifo",
      });
    });

    test("specify fifo with .fifo suffix in topicName", () => {
      new sns.Topic(stack, "MyTopic", {
        fifo: true,
        topicName: "topicName.fifo",
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        fifo_topic: true,
        name: "topicName.fifo",
      });
    });

    test("specify fifo without contentBasedDeduplication", () => {
      new sns.Topic(stack, "MyTopic", {
        fifo: true,
        topicName: "topicName",
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        fifo_topic: true,
        name: "topicName.fifo",
      });
    });

    test("specify fifo with contentBasedDeduplication", () => {
      new sns.Topic(stack, "MyTopic", {
        contentBasedDeduplication: true,
        fifo: true,
        topicName: "topicName",
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        content_based_deduplication: true,
        fifo_topic: true,
        name: "topicName.fifo",
      });
    });

    test("throw with contentBasedDeduplication on non-fifo topic", () => {
      expect(
        () =>
          new sns.Topic(stack, "MyTopic", {
            contentBasedDeduplication: true,
          }),
      ).toThrow(
        /Content based deduplication can only be enabled for FIFO SNS topics./,
      );
    });

    test("specify signatureVersion", () => {
      new sns.Topic(stack, "MyTopic", {
        signatureVersion: "2",
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        signature_version: 2,
      });
    });

    test("throw with incorrect signatureVersion", () => {
      expect(
        () =>
          new sns.Topic(stack, "MyTopic", {
            signatureVersion: "3",
          }),
      ).toThrow(/signatureVersion must be "1" or "2", received: "3"/);
    });

    test("throw error when displayName is too long", () => {
      expect(() => {
        new sns.Topic(stack, "MyTopic", {
          displayName: "a".repeat(101),
        });
      }).toThrow(
        "displayName must be less than or equal to 100 characters, got 101",
      );
    });
  });

  test("can add a policy to the topic", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "Topic");

    // WHEN
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["sns:*"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );

    // THEN
    const t = new Template(stack);
    // TerraConstructs Topic.addToResourcePolicy modifies the topic's policy attribute directly
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "0",
            actions: ["sns:*"],
            effect: "Allow",
            principals: [
              {
                type: "AWS",
                identifiers: ["arn"],
              },
            ],
            resources: ["*"],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(snsTopicPolicy.SnsTopicPolicy, {
      arn: stack.resolve(topic.topicArn),
      policy:
        "${data.aws_iam_policy_document.Topic_Policy_PolicyDocument_087CD732.json}",
    });
  });

  test("can enforce ssl when creating the topic", () => {
    // GIVEN
    new sns.Topic(stack, "Topic", {
      enforceSSL: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "AllowPublishThroughSSLOnly",
            actions: ["sns:Publish"],
            effect: "Deny",
            resources: ["${aws_sns_topic.Topic_BFC7AF6E.arn}"],
            condition: [
              {
                test: "Bool",
                variable: "aws:SecureTransport",
                values: ["false"],
              },
            ],
            principals: [
              {
                type: "*",
                identifiers: ["*"],
              },
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(snsTopicPolicy.SnsTopicPolicy, {
      policy:
        "${data.aws_iam_policy_document.Topic_Policy_PolicyDocument_087CD732.json}",
    });
  });

  test("can enforce ssl with addToResourcePolicy method", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "Topic", {
      enforceSSL: true,
    });

    // WHEN
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["sns:*"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "AllowPublishThroughSSLOnly",
            actions: ["sns:Publish"],
            effect: "Deny",
            resources: ["${aws_sns_topic.Topic_BFC7AF6E.arn}"],
            condition: [
              {
                test: "Bool",
                variable: "aws:SecureTransport",
                values: ["false"],
              },
            ],
            principals: [
              {
                type: "*",
                identifiers: ["*"],
              },
            ],
          },
          {
            sid: "1",
            actions: ["sns:*"],
            effect: "Allow",
            principals: [
              {
                type: "AWS",
                identifiers: ["arn"],
              },
            ],
            resources: ["*"],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(snsTopicPolicy.SnsTopicPolicy, {
      arn: stack.resolve(topic.topicArn),
      policy:
        "${data.aws_iam_policy_document.Topic_Policy_PolicyDocument_087CD732.json}",
    });
  });

  test("give publishing permissions", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "Topic");
    const user = new iam.User(stack, "User");

    // WHEN
    topic.grantPublish(user);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sns:Publish"],
            effect: "Allow",
            resources: [stack.resolve(topic.topicArn)],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      policy:
        "${data.aws_iam_policy_document.User_DefaultPolicy_C8121D31.json}",
      user: stack.resolve(user.userName),
    });
  });

  test("refer to masterKey", () => {
    // GIVEN
    const key = new kms.Key(stack, "CustomKey");
    const topic = new sns.Topic(stack, "Topic", { masterKey: key });

    // THEN
    expect(topic.masterKey).toBe(key);
  });

  test("give publishing permissions with masterKey", () => {
    // GIVEN
    stack = new AwsStack(undefined, undefined, {
      providerConfig: { region: "us-east-1" },
    });
    const key = new kms.Key(stack, "CustomKey");
    const topic = new sns.Topic(stack, "Topic", { masterKey: key });
    const user = new iam.User(stack, "User");

    // WHEN
    topic.grantPublish(user);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sns:Publish"],
            effect: "Allow",
            resources: [stack.resolve(topic.topicArn)],
          },
          {
            actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
            effect: "Allow",
            resources: [stack.resolve(key.keyArn)],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      policy:
        "${data.aws_iam_policy_document.User_DefaultPolicy_C8121D31.json}",
      user: stack.resolve(user.userName),
    });
  });

  test("give subscribing permissions", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "Topic");
    const user = new iam.User(stack, "User");

    // WHEN
    topic.grantSubscribe(user);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sns:Subscribe"],
            effect: "Allow",
            resources: [stack.resolve(topic.topicArn)],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      policy:
        "${data.aws_iam_policy_document.User_DefaultPolicy_C8121D31.json}",
      user: stack.resolve(user.userName),
    });
  });

  test("TopicPolicy passed document", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "MyTopic");
    const ps = new iam.PolicyStatement({
      actions: ["service:statement0"],
      principals: [new iam.ArnPrincipal("arn")],
    });

    // WHEN
    new sns.TopicPolicy(stack, "topicpolicy", {
      topics: [topic],
      policyDocument: new iam.PolicyDocument(stack, "PolicyDocument", {
        assignSids: true,
        statement: [ps],
      }),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "0",
            actions: ["service:statement0"],
            effect: "Allow",
            principals: [
              {
                type: "AWS",
                identifiers: ["arn"],
              },
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(snsTopicPolicy.SnsTopicPolicy, {
      arn: stack.resolve(topic.topicArn),
      policy: "${data.aws_iam_policy_document.PolicyDocument_5B97F349.json}",
    });
  });

  test("Add statements to policy", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "MyTopic");

    // WHEN
    const topicPolicy = new sns.TopicPolicy(stack, "TopicPolicy", {
      topics: [topic],
    });
    topicPolicy.document.addStatements(
      new iam.PolicyStatement({
        actions: ["service:statement0"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "0",
            actions: ["service:statement0"],
            effect: "Allow",
            principals: [
              {
                type: "AWS",
                identifiers: ["arn"],
              },
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(snsTopicPolicy.SnsTopicPolicy, {
      arn: stack.resolve(topic.topicArn),
      policy:
        "${data.aws_iam_policy_document.TopicPolicy_PolicyDocument_DE71E6AF.json}",
    });
  });

  test("Create topic policy and enforce ssl", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "MyTopic");

    // WHEN
    new sns.TopicPolicy(stack, "TopicPolicy", {
      topics: [topic],
      enforceSSL: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "AllowPublishThroughSSLOnly",
            actions: ["sns:Publish"],
            effect: "Deny",
            resources: [stack.resolve(topic.topicArn)],
            condition: [
              {
                test: "Bool",
                variable: "aws:SecureTransport",
                values: ["false"],
              },
            ],
            principals: [
              {
                type: "*",
                identifiers: ["*"],
              },
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(snsTopicPolicy.SnsTopicPolicy, {
      arn: stack.resolve(topic.topicArn),
      policy:
        "${data.aws_iam_policy_document.TopicPolicy_PolicyDocument_DE71E6AF.json}",
    });
  });

  test("topic resource policy includes unique SIDs", () => {
    const topic = new sns.Topic(stack, "MyTopic");

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

    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "0",
            actions: ["service:statement0"],
            effect: "Allow",
            principals: [
              {
                type: "AWS",
                identifiers: ["arn"],
              },
            ],
          },
          {
            sid: "1",
            actions: ["service:statement1"],
            effect: "Allow",
            principals: [
              {
                type: "AWS",
                identifiers: ["arn"],
              },
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(snsTopicPolicy.SnsTopicPolicy, {
      arn: stack.resolve(topic.topicArn),
      policy:
        "${data.aws_iam_policy_document.MyTopic_Policy_PolicyDocument_8F6F210B.json}",
    });
  });

  test("fromTopicArn", () => {
    // GIVEN
    const stack2 = new AwsStack();

    // WHEN
    const imported = sns.Topic.fromTopicArn(
      stack2,
      "Imported",
      "arn:aws:sns:*:123456789012:my_corporate_topic",
    );

    // THEN
    expect(imported.topicName).toEqual("my_corporate_topic");
    expect(imported.topicArn).toEqual(
      "arn:aws:sns:*:123456789012:my_corporate_topic",
    );
    expect(imported.fifo).toEqual(false);
  });

  test("fromTopicArn fifo", () => {
    // WHEN
    const imported = sns.Topic.fromTopicArn(
      stack,
      "Imported",
      "arn:aws:sns:*:123456789012:mytopic.fifo",
    );

    // THEN
    expect(imported.topicName).toEqual("mytopic.fifo");
    expect(imported.topicArn).toEqual(
      "arn:aws:sns:*:123456789012:mytopic.fifo",
    );
    expect(imported.fifo).toEqual(true);
  });

  test("fromTopicAttributes contentBasedDeduplication false", () => {
    // WHEN
    const imported = sns.Topic.fromTopicAttributes(stack, "Imported", {
      topicArn: "arn:aws:sns:*:123456789012:mytopic",
    });

    // THEN
    expect(imported.topicName).toEqual("mytopic");
    expect(imported.topicArn).toEqual("arn:aws:sns:*:123456789012:mytopic");
    expect(imported.contentBasedDeduplication).toEqual(false);
  });

  test("fromTopicAttributes contentBasedDeduplication true", () => {
    // WHEN
    const imported = sns.Topic.fromTopicAttributes(stack, "Imported", {
      topicArn: "arn:aws:sns:*:123456789012:mytopic.fifo",
      contentBasedDeduplication: true,
    });

    // THEN
    expect(imported.topicName).toEqual("mytopic.fifo");
    expect(imported.topicArn).toEqual(
      "arn:aws:sns:*:123456789012:mytopic.fifo",
    );
    expect(imported.contentBasedDeduplication).toEqual(true);
  });

  test("fromTopicAttributes throws with contentBasedDeduplication on non-fifo topic", () => {
    // WHEN
    expect(() =>
      sns.Topic.fromTopicAttributes(stack, "Imported", {
        topicArn: "arn:aws:sns:*:123456789012:mytopic",
        contentBasedDeduplication: true,
      }),
    ).toThrow(
      /Cannot import topic; contentBasedDeduplication is only available for FIFO SNS topics./,
    );
  });

  test("fromTopicAttributes keyArn", () => {
    // GIVEN
    const keyArn =
      "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";

    // WHEN
    const imported = sns.Topic.fromTopicAttributes(stack, "Imported", {
      topicArn: "arn:aws:sns:*:123456789012:mytopic",
      keyArn,
    });

    // THEN
    expect(imported.masterKey?.keyArn).toEqual(keyArn);
  });

  test("sets account for imported topic env", () => {
    // WHEN
    const imported = sns.Topic.fromTopicArn(
      stack,
      "Imported",
      "arn:aws:sns:us-west-2:123456789012:my-topic",
    );

    // THEN
    expect(imported.env.account).toEqual("123456789012");
  });

  test("sets region for imported topic env", () => {
    // WHEN
    const imported = sns.Topic.fromTopicArn(
      stack,
      "Imported",
      "arn:aws:sns:us-west-2:123456789012:my-topic",
    );

    // THEN
    expect(imported.env.region).toEqual("us-west-2");
  });

  test("test metrics", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "Topic");

    // THEN
    expect(stack.resolve(topic.metricNumberOfMessagesPublished())).toEqual({
      dimensions: { TopicName: "${aws_sns_topic.Topic_BFC7AF6E.name}" },
      namespace: "AWS/SNS",
      metricName: "NumberOfMessagesPublished",
      period: Duration.minutes(5),
      statistic: "Sum",
    });

    expect(stack.resolve(topic.metricPublishSize())).toEqual({
      dimensions: { TopicName: "${aws_sns_topic.Topic_BFC7AF6E.name}" },
      namespace: "AWS/SNS",
      metricName: "PublishSize",
      period: Duration.minutes(5),
      statistic: "Average",
    });
  });

  test("subscription is created under the topic scope by default", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "Topic");

    // WHEN
    topic.addSubscription({
      bind: () => ({
        protocol: sns.SubscriptionProtocol.HTTP,
        endpoint: "http://foo/bar",
        subscriberId: "my-subscription",
      }),
    });

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(snsTopicSubscription.SnsTopicSubscription, 1);
    t.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        topic_arn: stack.resolve(topic.topicArn),
        protocol: "http",
        endpoint: "http://foo/bar",
      },
    );
  });

  test('if "scope" is defined, subscription will be created under that scope', () => {
    // GIVEN
    stack = new AwsStack(app, "A");
    const stack2 = new AwsStack(app, "B");
    const topic = new sns.Topic(stack, "Topic");

    // WHEN
    topic.addSubscription({
      bind: () => ({
        protocol: sns.SubscriptionProtocol.HTTP,
        endpoint: "http://foo/bar",
        subscriberScope: stack2,
        subscriberId: "subscriberId",
      }),
    });

    // THEN
    const t1 = new Template(stack);
    t1.resourceCountIs(snsTopicSubscription.SnsTopicSubscription, 0);
    const t2 = new Template(stack2);
    t2.resourceCountIs(snsTopicSubscription.SnsTopicSubscription, 1);
    t2.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        // TODO: Figure out cross stack reference resolving?
        topic_arn:
          "${data.terraform_remote_state.cross-stack-reference-input-A.outputs.cross-stack-output-aws_sns_topicTopic_BFC7AF6Earn}", //stack.resolve(topic.topicArn),
        protocol: "http",
        endpoint: "http://foo/bar",
      },
    );
  });

  test("fails if topic policy has no actions", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "Topic");

    // WHEN
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );

    // THEN
    expect(() => Testing.synth(stack, true)).toThrow(
      /A PolicyStatement must specify at least one 'action' or 'notAction'/,
    );
  });

  test("fails if topic policy has no IAM principals", () => {
    // GIVEN
    const topic = new sns.Topic(stack, "Topic");

    // WHEN
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["sns:*"],
      }),
    );

    // THEN
    expect(() => Testing.synth(stack, true)).toThrow(
      /A PolicyStatement used in a resource-based policy must specify at least one IAM principal/,
    );
  });

  test("topic policy should be set if topic as a notifications rule target", () => {
    const topic = new sns.Topic(stack, "Topic");
    const rule = new sns.NotificationRule(stack, "MyNotificationRule", {
      source: {
        bindAsNotificationRuleSource: () => ({
          sourceArn: "ARN",
        }),
      },
      events: ["codebuild-project-build-state-succeeded"],
    });
    rule.addTarget(topic); // This might be needed depending on TerraConstructs implementation

    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "0",
            actions: ["sns:Publish"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_codestar-notifications.name}",
                ],
              },
            ],
            resources: [stack.resolve(topic.topicArn)],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(snsTopicPolicy.SnsTopicPolicy, {
      arn: stack.resolve(topic.topicArn),
      policy:
        "${data.aws_iam_policy_document.Topic_Policy_PolicyDocument_087CD732.json}",
    });
  });

  test("specify delivery status logging configuration through construct props", () => {
    // GIVEN
    const feedbackRole = new iam.Role(stack, "feedbackRole", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
    });

    // WHEN
    new sns.Topic(stack, "MyTopic", {
      loggingConfigs: [
        {
          protocol: sns.LoggingProtocol.SQS,
          failureFeedbackRole: feedbackRole,
          successFeedbackRole: feedbackRole,
          successFeedbackSampleRate: 50,
        },
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
      sqs_failure_feedback_role_arn: stack.resolve(feedbackRole.roleArn),
      sqs_success_feedback_role_arn: stack.resolve(feedbackRole.roleArn),
      sqs_success_feedback_sample_rate: 50,
    });
  });

  test("add delivery status logging configuration to a topic", () => {
    // GIVEN
    const feedbackRole = new iam.Role(stack, "feedbackRole", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
    });
    const topic = new sns.Topic(stack, "MyTopic");

    // WHEN
    topic.addLoggingConfig({
      protocol: sns.LoggingProtocol.HTTP,
      failureFeedbackRole: feedbackRole,
      successFeedbackRole: feedbackRole,
      successFeedbackSampleRate: 50,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
      http_failure_feedback_role_arn: stack.resolve(feedbackRole.roleArn),
      http_success_feedback_role_arn: stack.resolve(feedbackRole.roleArn),
      http_success_feedback_sample_rate: 50,
    });
  });

  test("fails if success feedback sample rate is outside the appropriate range", () => {
    // GIVEN
    const feedbackRole = new iam.Role(stack, "feedbackRole", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
    });

    // THEN
    expect(
      () =>
        new sns.Topic(stack, "MyTopic", {
          loggingConfigs: [
            {
              protocol: sns.LoggingProtocol.SQS,
              failureFeedbackRole: feedbackRole,
              successFeedbackRole: feedbackRole,
              successFeedbackSampleRate: 110,
            },
          ],
        }),
    ).toThrow(
      /Success feedback sample rate must be an integer between 0 and 100/,
    );
  });

  test("fails if success feedback sample rate is decimal", () => {
    // GIVEN
    const feedbackRole = new iam.Role(stack, "feedbackRole", {
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
    });

    // THEN
    expect(
      () =>
        new sns.Topic(stack, "MyTopic", {
          loggingConfigs: [
            {
              protocol: sns.LoggingProtocol.SQS,
              failureFeedbackRole: feedbackRole,
              successFeedbackRole: feedbackRole,
              successFeedbackSampleRate: 50.4,
            },
          ],
        }),
    ).toThrow(
      /Success feedback sample rate must be an integer between 0 and 100/,
    );
  });

  describe("message retention period", () => {
    test("specify message retention period in days", () => {
      // WHEN
      new sns.Topic(stack, "MyTopic", {
        fifo: true,
        messageRetentionPeriodInDays: 10,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        archive_policy: JSON.stringify({ MessageRetentionPeriod: 10 }),
        fifo_topic: true,
      });
    });

    test.each([0, 366, 12.3, NaN])(
      'throw error if message retention period is invalid value "%s"',
      (days) => {
        // THEN
        expect(
          () =>
            new sns.Topic(stack, "MyTopic", {
              fifo: true,
              messageRetentionPeriodInDays: days,
            }),
        ).toThrow(
          /`messageRetentionPeriodInDays` must be an integer between 1 and 365/,
        );
      },
    );

    test("throw error when specify messageRetentionPeriodInDays to standard topic", () => {
      expect(
        () =>
          new sns.Topic(stack, "MyTopic", {
            messageRetentionPeriodInDays: 12,
          }),
      ).toThrow(
        "`messageRetentionPeriodInDays` is only valid for FIFO SNS topics",
      );
    });
  });

  describe("tracingConfig", () => {
    test("specify tracingConfig", () => {
      // WHEN
      new sns.Topic(stack, "MyTopic", {
        tracingConfig: sns.TracingConfig.ACTIVE,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        tracing_config: "Active",
      });
    });
  });

  describe("fifoThroughputScope", () => {
    test.each([
      sns.FifoThroughputScope.MESSAGE_GROUP,
      sns.FifoThroughputScope.TOPIC,
    ])("set fifoThroughputScope to %s", (fifoThroughputScope) => {
      // WHEN
      new sns.Topic(stack, "MyTopic", {
        fifo: true,
        fifoThroughputScope,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
        fifo_topic: true,
        fifo_throughput_scope: fifoThroughputScope,
      });
    });

    test("throw error when specify fifoThroughputScope to standard topic", () => {
      expect(
        () =>
          new sns.Topic(stack, "MyTopic", {
            fifoThroughputScope: sns.FifoThroughputScope.MESSAGE_GROUP,
          }),
      ).toThrow("`fifoThroughputScope` can only be set for FIFO SNS topics.");
    });
  });
});
