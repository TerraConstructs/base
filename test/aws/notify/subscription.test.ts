import { Testing } from "cdktf";
import { Topic } from "../../../src/aws/notify/topic";
import {
  Subscription,
  SubscriptionProtocol,
} from "../../../src/aws/notify/subscription";
import { Queue } from "../../../src/aws/notify";
import { SubscriptionFilter } from "../../../src/aws/notify/subscription-filter";

describe("SNS Subscription", () => {
  test("basic subscription", () => {
    const synthed = Testing.synthScope((scope) => {
      const topic = new Topic(scope, "MyTopic");
      new Subscription(scope, "MySubscription", {
        topic,
        protocol: SubscriptionProtocol.EMAIL,
        endpoint: "test@example.com",
      });
    });

    expect(synthed).toContain("aws_sns_topic_subscription");
    expect(synthed).toContain("email");
    expect(synthed).toContain("test@example.com");
  });

  test("subscription with filter policy", () => {
    const synthed = Testing.synthScope((scope) => {
      const topic = new Topic(scope, "MyTopic");
      new Subscription(scope, "MySubscription", {
        topic,
        protocol: SubscriptionProtocol.SQS,
        endpoint: "arn:aws:sqs:us-east-1:123456789012:my-queue",
        filterPolicy: {
          color: SubscriptionFilter.stringFilter({
            allowlist: ["red", "green", "blue"],
          }),
        },
      });
    });

    expect(synthed).toContain("filter_policy");
    expect(synthed).toContain("red");
    expect(synthed).toContain("green");
    expect(synthed).toContain("blue");
  });

  test("subscription with raw message delivery", () => {
    const synthed = Testing.synthScope((scope) => {
      const topic = new Topic(scope, "MyTopic");
      new Subscription(scope, "MySubscription", {
        topic,
        protocol: SubscriptionProtocol.SQS,
        endpoint: "arn:aws:sqs:us-east-1:123456789012:my-queue",
        rawMessageDelivery: true,
      });
    });

    expect(synthed).toContain("raw_message_delivery");
    expect(synthed).toContain("true");
  });

  test("subscription with dead letter queue", () => {
    const synthed = Testing.synthScope((scope) => {
      const topic = new Topic(scope, "MyTopic");
      const dlq = new Queue(scope, "DeadLetterQueue");

      new Subscription(scope, "MySubscription", {
        topic,
        protocol: SubscriptionProtocol.EMAIL,
        endpoint: "test@example.com",
        deadLetterQueue: dlq,
      });
    });

    expect(synthed).toContain("aws_sqs_queue");
    expect(synthed).toContain("redrive_policy");
  });

  test("throws error when raw message delivery is enabled for unsupported protocol", () => {
    expect(() => {
      Testing.synthScope((scope) => {
        const topic = new Topic(scope, "MyTopic");
        new Subscription(scope, "MySubscription", {
          topic,
          protocol: SubscriptionProtocol.EMAIL,
          endpoint: "test@example.com",
          rawMessageDelivery: true,
        });
      });
    }).toThrow(
      /Raw message delivery can only be enabled for HTTP, HTTPS, SQS, and Firehose subscriptions/,
    );
  });
});
