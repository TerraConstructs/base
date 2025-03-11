import { Testing } from "cdktf";
import { Topic } from "../../../src/aws/sns/topic";
import { Subscription, SubscriptionProtocol } from "../../../src/aws/sns/subscription";
import { Queue } from "../../../src/aws/notify";

describe("SNS Topic", () => {
  test("minimal configuration", () => {
    const synthed = Testing.synthScope((scope) => {
      new Topic(scope, "MyTopic");
    });

    expect(synthed).toContain("aws_sns_topic");
  });

  test("with name", () => {
    const synthed = Testing.synthScope((scope) => {
      new Topic(scope, "MyTopic", {
        topicName: "my-topic-name",
      });
    });

    expect(synthed).toContain("aws_sns_topic");
    expect(synthed).toContain("my-topic-name");
  });

  test("fifo topic", () => {
    const synthed = Testing.synthScope((scope) => {
      new Topic(scope, "MyTopic", {
        topicName: "my-topic",
        fifo: true,
      });
    });

    expect(synthed).toContain("aws_sns_topic");
    expect(synthed).toContain("fifo_topic");
    expect(synthed).toContain("my-topic.fifo");
  });

  test("with subscription", () => {
    const synthed = Testing.synthScope((scope) => {
      const topic = new Topic(scope, "MyTopic");
      topic.addSubscription({
        bind: () => ({
          protocol: SubscriptionProtocol.EMAIL,
          endpoint: "test@example.com",
        }),
      });
    });

    expect(synthed).toContain("aws_sns_topic");
    expect(synthed).toContain("aws_sns_topic_subscription");
    expect(synthed).toContain("email");
    expect(synthed).toContain("test@example.com");
  });

  test("with dead letter queue", () => {
    const synthed = Testing.synthScope((scope) => {
      const dlq = new Queue(scope, "DeadLetterQueue");
      const topic = new Topic(scope, "MyTopic");
      
      topic.addSubscription({
        bind: () => ({
          protocol: SubscriptionProtocol.EMAIL,
          endpoint: "test@example.com",
          deadLetterQueue: dlq,
        }),
      });
    });

    expect(synthed).toContain("aws_sqs_queue");
    expect(synthed).toContain("aws_sns_topic_subscription");
  });

  test("from imported topic", () => {
    const synthed = Testing.synthScope((scope) => {
      const importedTopic = Topic.fromTopicArn(
        scope,
        "ImportedTopic",
        "arn:aws:sns:us-east-1:123456789012:my-topic"
      );
      
      importedTopic.addSubscription({
        bind: () => ({
          protocol: SubscriptionProtocol.EMAIL,
          endpoint: "test@example.com",
        }),
      });
    });

    expect(synthed).toContain("aws_sns_topic_subscription");
    expect(synthed).not.toContain("ImportedTopic_Resource");
  });
});
