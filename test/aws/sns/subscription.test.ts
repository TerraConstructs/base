import { Testing } from "cdktf";
import { Topic } from "../../../src/aws/sns/topic";
import { Subscription, SubscriptionProtocol } from "../../../src/aws/sns/subscription";
import { Queue } from "../../../src/aws/notify";
import { SubscriptionFilter } from "../../../src/aws/sns/subscription-filter";
import { App } from "cdktf";
import { AwsStack } from "../../../src/aws";

describe("SNS Subscription", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = new App();
    stack = new AwsStack(app, "test-stack", {
      env: {
        account: "123456789012",
        region: "us-east-1",
      },
    });
  });

  test("basic subscription", () => {
    const topic = new Topic(stack, "MyTopic");
    new Subscription(stack, "MySubscription", {
      topic,
      protocol: SubscriptionProtocol.EMAIL,
      endpoint: "test@example.com",
    });
    
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sns_topic_subscription.MySubscription_Resource.endpoint).toEqual("test@example.com");
    expect(synthed.resource.aws_sns_topic_subscription.MySubscription_Resource.protocol).toEqual("email");
  });

  test("subscription with filter policy", () => {
    const topic = new Topic(stack, "MyTopic");
    new Subscription(stack, "MySubscription", {
      topic,
      protocol: SubscriptionProtocol.SQS,
      endpoint: "arn:aws:sqs:us-east-1:123456789012:my-queue",
      filterPolicy: {
        color: SubscriptionFilter.stringFilter({
          allowlist: ["red", "green", "blue"],
        }),
      },
    });
    
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sns_topic_subscription.MySubscription_Resource.filter_policy).toBeDefined();
    const filterPolicy = JSON.parse(synthed.resource.aws_sns_topic_subscription.MySubscription_Resource.filter_policy);
    expect(filterPolicy.color).toContain("red");
    expect(filterPolicy.color).toContain("green");
    expect(filterPolicy.color).toContain("blue");
  });

  test("subscription with raw message delivery", () => {
    const topic = new Topic(stack, "MyTopic");
    new Subscription(stack, "MySubscription", {
      topic,
      protocol: SubscriptionProtocol.SQS,
      endpoint: "arn:aws:sqs:us-east-1:123456789012:my-queue",
      rawMessageDelivery: true,
    });
    
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sns_topic_subscription.MySubscription_Resource.raw_message_delivery).toEqual(true);
  });

  test("subscription with dead letter queue", () => {
    const topic = new Topic(stack, "MyTopic");
    const dlq = new Queue(stack, "DeadLetterQueue");
    
    new Subscription(stack, "MySubscription", {
      topic,
      protocol: SubscriptionProtocol.EMAIL,
      endpoint: "test@example.com",
      deadLetterQueue: dlq,
    });
    
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sqs_queue).toBeDefined();
    expect(synthed.resource.aws_sns_topic_subscription.MySubscription_Resource.redrive_policy).toBeDefined();
  });

  test("throws error when raw message delivery is enabled for unsupported protocol", () => {
    expect(() => {
      const topic = new Topic(stack, "MyTopic");
      new Subscription(stack, "MySubscription", {
        topic,
        protocol: SubscriptionProtocol.EMAIL,
        endpoint: "test@example.com",
        rawMessageDelivery: true,
      });
    }).toThrow(/Raw message delivery can only be enabled for HTTP, HTTPS, SQS, and Firehose subscriptions/);
  });
});
