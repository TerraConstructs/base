import { Testing } from "cdktf";
import { Topic } from "../../../src/aws/sns/topic";
import { Subscription, SubscriptionProtocol } from "../../../src/aws/sns/subscription";
import { Queue } from "../../../src/aws/notify";
import { App } from "cdktf";
import { AwsStack } from "../../../src/aws";

describe("SNS Topic", () => {
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

  test("minimal configuration", () => {
    new Topic(stack, "MyTopic");
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sns_topic).toBeDefined();
  });

  test("with name", () => {
    new Topic(stack, "MyTopic", {
      topicName: "my-topic-name",
    });
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sns_topic.MyTopic_Resource.name).toEqual("my-topic-name");
  });

  test("fifo topic", () => {
    new Topic(stack, "MyTopic", {
      topicName: "my-topic",
      fifo: true,
    });
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sns_topic.MyTopic_Resource.fifo_topic).toEqual(true);
    expect(synthed.resource.aws_sns_topic.MyTopic_Resource.name).toEqual("my-topic.fifo");
  });

  test("with subscription", () => {
    const topic = new Topic(stack, "MyTopic");
    topic.addSubscription({
      bind: () => ({
        protocol: SubscriptionProtocol.EMAIL,
        endpoint: "test@example.com",
      }),
    });
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sns_topic_subscription).toBeDefined();
    expect(synthed.resource.aws_sns_topic_subscription.MyTopic_Subscription_Resource.protocol).toEqual("email");
    expect(synthed.resource.aws_sns_topic_subscription.MyTopic_Subscription_Resource.endpoint).toEqual("test@example.com");
  });

  test("with dead letter queue", () => {
    const dlq = new Queue(stack, "DeadLetterQueue");
    const topic = new Topic(stack, "MyTopic");
    
    topic.addSubscription({
      bind: () => ({
        protocol: SubscriptionProtocol.EMAIL,
        endpoint: "test@example.com",
        deadLetterQueue: dlq,
      }),
    });
    
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sqs_queue).toBeDefined();
    expect(synthed.resource.aws_sns_topic_subscription).toBeDefined();
  });

  test("from imported topic", () => {
    const importedTopic = Topic.fromTopicArn(
      stack,
      "ImportedTopic",
      "arn:aws:sns:us-east-1:123456789012:my-topic"
    );
    
    importedTopic.addSubscription({
      bind: () => ({
        protocol: SubscriptionProtocol.EMAIL,
        endpoint: "test@example.com",
      }),
    });
    
    const synthed = Testing.synth(stack);
    expect(synthed.resource.aws_sns_topic_subscription).toBeDefined();
    // The imported topic doesn't create a new topic resource
    expect(synthed.resource.aws_sns_topic?.ImportedTopic_Resource).toBeUndefined();
  });
});
