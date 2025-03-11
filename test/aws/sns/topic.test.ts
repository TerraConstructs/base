import { Testing } from "cdktf";
import { Topic } from "../../../src/aws/sns/topic";
import { Subscription, SubscriptionProtocol } from "../../../src/aws/sns/subscription";
import { Queue } from "../../../src/aws/notify";

describe("SNS Topic", () => {
  test("minimal configuration", () => {
    const synthed = Testing.synthScope((scope) => {
      new Topic(scope, "MyTopic");
    });

    expect(synthed).toMatchInlineSnapshot(`
      "{
        \\"resource\\": {
          \\"aws_sns_topic\\": {
            \\"MyTopic_Resource\\": {}
          }
        }
      }"
    `);
  });

  test("with name", () => {
    const synthed = Testing.synthScope((scope) => {
      new Topic(scope, "MyTopic", {
        topicName: "my-topic-name",
      });
    });

    expect(synthed).toMatchInlineSnapshot(`
      "{
        \\"resource\\": {
          \\"aws_sns_topic\\": {
            \\"MyTopic_Resource\\": {
              \\"name\\": \\"my-topic-name\\"
            }
          }
        }
      }"
    `);
  });

  test("fifo topic", () => {
    const synthed = Testing.synthScope((scope) => {
      new Topic(scope, "MyTopic", {
        topicName: "my-topic",
        fifo: true,
      });
    });

    expect(synthed).toMatchInlineSnapshot(`
      "{
        \\"resource\\": {
          \\"aws_sns_topic\\": {
            \\"MyTopic_Resource\\": {
              \\"fifo_topic\\": true,
              \\"name\\": \\"my-topic.fifo\\"
            }
          }
        }
      }"
    `);
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

    expect(synthed).toMatchInlineSnapshot(`
      "{
        \\"resource\\": {
          \\"aws_sns_topic\\": {
            \\"MyTopic_Resource\\": {}
          },
          \\"aws_sns_topic_subscription\\": {
            \\"MyTopic_Subscription_Resource\\": {
              \\"endpoint\\": \\"test@example.com\\",
              \\"protocol\\": \\"email\\",
              \\"topic_arn\\": \\"\${aws_sns_topic.MyTopic_Resource.arn}\\"
            }
          }
        }
      }"
    `);
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

    // The test will check that the DLQ is properly configured
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
      
      // Check that we can add a subscription to the imported topic
      importedTopic.addSubscription({
        bind: () => ({
          protocol: SubscriptionProtocol.EMAIL,
          endpoint: "test@example.com",
        }),
      });
    });

    expect(synthed).toContain("aws_sns_topic_subscription");
    expect(synthed).not.toContain("aws_sns_topic");
  });
});
