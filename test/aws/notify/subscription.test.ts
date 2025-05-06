// https://github.com/aws/aws-cdk/blob/0c53765fba7ef0945c97106d2613c9dae665873f/packages/aws-cdk-lib/aws-sns/test/subscription.test.ts

import {
  snsTopic,
  snsTopicSubscription,
  sqsQueue,
  sqsQueuePolicy,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { Queue } from "../../../src/aws/notify";
import { Duration } from "../../../src/duration";
import * as sns from "../../../src/aws/notify";
import { SubscriptionProtocol } from "../../../src/aws/notify";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("Subscription", () => {
  let stack: AwsStack;
  let topic: sns.Topic;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    topic = new sns.Topic(stack, "Topic");
  });

  test("create a subscription", () => {
    // WHEN
    new sns.Subscription(stack, "Subscription", {
      endpoint: "endpoint",
      protocol: sns.SubscriptionProtocol.LAMBDA,
      topic,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        endpoint: "endpoint",
        protocol: "lambda",
        topic_arn: stack.resolve(topic.topicArn),
      },
    );
  });

  test("create a subscription with DLQ when client provides DLQ", () => {
    // GIVEN
    const dlQueue = new Queue(stack, "DeadLetterQueue", {
      // TODO: Fix terraconstructs QueueProps to match AWS CDK ...
      namePrefix: "MySubscription_DLQ",
      messageRetentionSeconds: Duration.days(14).toSeconds(),
    });

    // WHEN
    new sns.Subscription(stack, "Subscription", {
      endpoint: "endpoint",
      protocol: sns.SubscriptionProtocol.LAMBDA,
      topic,
      deadLetterQueue: dlQueue,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        endpoint: "endpoint",
        protocol: "lambda",
        topic_arn: stack.resolve(topic.topicArn),
        redrive_policy: `{"deadLetterTargetArn":"${stack.resolve(dlQueue.queueArn)}"}`, // Terraform expects a JSON string
      },
    );
    t.expect.toHaveResourceWithProperties(sqsQueue.SqsQueue, {
      name_prefix: "MySubscription_DLQMyStackDeadLetterQueue",
      message_retention_seconds: 1209600,
    });
    t.expect.toHaveResourceWithProperties(sqsQueuePolicy.SqsQueuePolicy, {
      queue_url: stack.resolve(dlQueue.queueUrl),
      policy:
        "${data.aws_iam_policy_document.DeadLetterQueue_Policy_D01590FE.json}",
    });
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sqs:SendMessage"],
            condition: [
              {
                test: "ArnEquals",
                variable: "aws:SourceArn",
                values: [stack.resolve(topic.topicArn)],
              },
            ],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
                ],
              },
            ],
            resources: [stack.resolve(dlQueue.queueArn)],
          },
        ],
      },
    );
  });

  test("with filter policy", () => {
    // WHEN
    new sns.Subscription(stack, "Subscription", {
      endpoint: "endpoint",
      filterPolicy: {
        color: sns.SubscriptionFilter.stringFilter({
          allowlist: ["red", "green"],
          denylist: ["white", "orange"],
          matchPrefixes: ["bl", "ye"],
          matchSuffixes: ["ue", "ow"],
        }),
        price: sns.SubscriptionFilter.numericFilter({
          allowlist: [100, 200],
          between: { start: 300, stop: 350 },
          greaterThan: 500,
          lessThan: 1000,
          betweenStrict: { start: 2000, stop: 3000 },
          greaterThanOrEqualTo: 1000,
          lessThanOrEqualTo: -2,
        }),
      },
      protocol: sns.SubscriptionProtocol.LAMBDA,
      topic,
    });

    // THEN
    const expectedFilterPolicy = JSON.stringify({
      color: [
        "red",
        "green",
        { "anything-but": ["white", "orange"] },
        { prefix: "bl" },
        { prefix: "ye" },
        { suffix: "ue" },
        { suffix: "ow" },
      ],
      price: [
        { numeric: ["=", 100] },
        { numeric: ["=", 200] },
        { numeric: [">", 500] },
        { numeric: [">=", 1000] },
        { numeric: ["<", 1000] },
        { numeric: ["<=", -2] },
        { numeric: [">=", 300, "<=", 350] },
        { numeric: [">", 2000, "<", 3000] },
      ],
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        filter_policy: expectedFilterPolicy,
      },
    );
  });

  test("with filter policy and filter policy scope MessageBody", () => {
    // WHEN
    new sns.Subscription(stack, "Subscription", {
      endpoint: "endpoint",
      filterPolicyWithMessageBody: {
        background: sns.Policy.policy({
          color: sns.Filter.filter(
            sns.SubscriptionFilter.stringFilter({
              allowlist: ["red", "green"],
              denylist: ["white", "orange"],
            }),
          ),
        }),
        price: sns.Filter.filter(
          sns.SubscriptionFilter.numericFilter({
            allowlist: [100, 200],
            between: { start: 300, stop: 350 },
            greaterThan: 500,
            lessThan: 1000,
            betweenStrict: { start: 2000, stop: 3000 },
          }),
        ),
      },
      protocol: sns.SubscriptionProtocol.LAMBDA,
      topic,
    });

    // THEN
    const expectedFilterPolicy = JSON.stringify({
      background: {
        color: ["red", "green", { "anything-but": ["white", "orange"] }],
      },
      price: [
        { numeric: ["=", 100] },
        { numeric: ["=", 200] },
        { numeric: [">", 500] },
        { numeric: ["<", 1000] },
        { numeric: [">=", 300, "<=", 350] },
        { numeric: [">", 2000, "<", 3000] },
      ],
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        filter_policy: expectedFilterPolicy,
        filter_policy_scope: "MessageBody",
      },
    );
  });

  test("with numeric filter and 0 values", () => {
    // WHEN
    new sns.Subscription(stack, "Subscription", {
      endpoint: "endpoint",
      filterPolicy: {
        price: sns.SubscriptionFilter.numericFilter({
          greaterThan: 0,
          greaterThanOrEqualTo: 0,
          lessThan: 0,
          lessThanOrEqualTo: 0,
        }),
      },
      protocol: sns.SubscriptionProtocol.LAMBDA,
      topic,
    });

    // THEN
    const expectedFilterPolicy = JSON.stringify({
      price: [
        { numeric: [">", 0] },
        { numeric: [">=", 0] },
        { numeric: ["<", 0] },
        { numeric: ["<=", 0] },
      ],
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        filter_policy: expectedFilterPolicy,
      },
    );
  });

  test("with existsFilter", () => {
    // WHEN
    new sns.Subscription(stack, "Subscription", {
      endpoint: "endpoint",
      filterPolicy: {
        size: sns.SubscriptionFilter.existsFilter(),
      },
      protocol: sns.SubscriptionProtocol.LAMBDA,
      topic,
    });

    // THEN
    const expectedFilterPolicy = JSON.stringify({
      size: [{ exists: true }],
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        filter_policy: expectedFilterPolicy,
      },
    );
  });

  test("with delivery policy", () => {
    // WHEN
    new sns.Subscription(stack, "Subscription", {
      endpoint: "endpoint",
      deliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(5),
          maxDelayTarget: Duration.seconds(10),
          numRetries: 6,
          backoffFunction: sns.BackoffFunction.EXPONENTIAL,
        },
        throttlePolicy: {
          maxReceivesPerSecond: 10,
        },
        requestPolicy: {
          headerContentType: "application/json",
        },
      },
      protocol: sns.SubscriptionProtocol.HTTPS,
      topic,
    });

    // THEN
    const expectedDeliveryPolicy = JSON.stringify({
      healthyRetryPolicy: {
        minDelayTarget: 5,
        maxDelayTarget: 10,
        numRetries: 6,
        // numMaxDelayRetries: 0,
        // numNoDelayRetries: 0,
        // numMinDelayRetries: 0,
        backoffFunction: sns.BackoffFunction.EXPONENTIAL,
      },
      throttlePolicy: {
        maxReceivesPerSecond: 10,
      },
      requestPolicy: {
        headerContentType: "application/json",
      },
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        delivery_policy: expectedDeliveryPolicy,
      },
    );
  });

  test("sets correct healthyRetryPolicy defaults for attributes required by Cloudformation", () => {
    // WHEN
    new sns.Subscription(stack, "Subscription", {
      endpoint: "endpoint",
      deliveryPolicy: {
        healthyRetryPolicy: {
          backoffFunction: sns.BackoffFunction.EXPONENTIAL,
        },
      },
      protocol: sns.SubscriptionProtocol.HTTPS,
      topic,
    });

    // THEN
    const expectedDeliveryPolicy = JSON.stringify({
      healthyRetryPolicy: {
        minDelayTarget: 20,
        maxDelayTarget: 20,
        numRetries: 3,
        // numMaxDelayRetries: 0,
        // numNoDelayRetries: 0,
        // numMinDelayRetries: 0,
        backoffFunction: sns.BackoffFunction.EXPONENTIAL,
      },
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      snsTopicSubscription.SnsTopicSubscription,
      {
        delivery_policy: expectedDeliveryPolicy,
      },
    );
  });

  test.each([
    SubscriptionProtocol.LAMBDA,
    SubscriptionProtocol.EMAIL,
    SubscriptionProtocol.EMAIL_JSON,
    SubscriptionProtocol.SMS,
    SubscriptionProtocol.APPLICATION,
  ])(
    "throws with raw delivery for %s protocol",
    (protocol: SubscriptionProtocol) => {
      // THEN
      expect(
        () =>
          new sns.Subscription(stack, "Subscription", {
            endpoint: "endpoint",
            protocol: protocol,
            topic,
            rawMessageDelivery: true,
          }),
      ).toThrow(/Raw message delivery/);
    },
  );

  test("throws with more than 5 attributes in a filter policy", () => {
    // GIVEN
    const cond = sns.SubscriptionFilter.existsFilter();

    // THEN
    expect(
      () =>
        new sns.Subscription(stack, "Subscription", {
          endpoint: "endpoint",
          protocol: sns.SubscriptionProtocol.LAMBDA,
          topic,
          filterPolicy: {
            a: cond,
            b: cond,
            c: cond,
            d: cond,
            e: cond,
            f: cond,
          },
        }),
    ).toThrow(/5 attribute names/);
  });

  test("throws with more than 150 conditions in a filter policy", () => {
    // THEN
    expect(
      () =>
        new sns.Subscription(stack, "Subscription", {
          endpoint: "endpoint",
          protocol: sns.SubscriptionProtocol.LAMBDA,
          topic,
          filterPolicy: {
            a: new sns.SubscriptionFilter([...Array.from(Array(2).keys())]),
            b: new sns.SubscriptionFilter([...Array.from(Array(10).keys())]),
            c: new sns.SubscriptionFilter([...Array.from(Array(8).keys())]),
          },
        }),
    ).toThrow(/\(160\) must not exceed 150/);
  });

  test("throws with more than 150 conditions in a filter policy with filter policy scope set to MessageBody", () => {
    // THEN
    expect(
      () =>
        new sns.Subscription(stack, "Subscription", {
          endpoint: "endpoint",
          protocol: sns.SubscriptionProtocol.LAMBDA,
          topic,
          filterPolicyWithMessageBody: {
            a: sns.Policy.policy({
              b: sns.Filter.filter(
                new sns.SubscriptionFilter([...Array.from(Array(10).keys())]),
              ),
            }),
            c: sns.Policy.policy({
              d: sns.Filter.filter(
                new sns.SubscriptionFilter([...Array.from(Array(5).keys())]),
              ),
            }),
          },
        }),
    ).toThrow(/\(200\) must not exceed 150/);
  });

  test("throws an error when subscription role arn is not entered with firehose subscription protocol", () => {
    // THEN
    expect(
      () =>
        new sns.Subscription(stack, "Subscription", {
          endpoint: "endpoint",
          protocol: sns.SubscriptionProtocol.FIREHOSE,
          topic,
        }),
    ).toThrow(
      /Subscription role arn is required field for subscriptions with a firehose protocol./,
    );
  });

  test.each([
    sns.SubscriptionProtocol.APPLICATION,
    sns.SubscriptionProtocol.EMAIL,
    sns.SubscriptionProtocol.EMAIL_JSON,
    sns.SubscriptionProtocol.FIREHOSE,
    sns.SubscriptionProtocol.LAMBDA,
    sns.SubscriptionProtocol.SMS,
    sns.SubscriptionProtocol.SQS,
  ])(
    "throws an error when deliveryPolicy is specified with protocol %s",
    (protocol) => {
      // THEN
      expect(
        () =>
          new sns.Subscription(stack, "Subscription", {
            endpoint: "endpoint",
            deliveryPolicy: {
              healthyRetryPolicy: {
                minDelayTarget: Duration.seconds(11),
                maxDelayTarget: Duration.seconds(10),
                numRetries: 6,
              },
            },
            protocol: protocol,
            subscriptionRoleArn: "???", // Required for firehose, but irrelevant to the test
            topic,
          }),
      ).toThrow(
        new RegExp(
          `Delivery policy is only supported for HTTP and HTTPS subscriptions, got: ${protocol}`,
        ),
      );
    },
  );

  test("throws an error when deliveryPolicy minDelayTarget exceeds maxDelayTarget", () => {
    // THEN
    expect(
      () =>
        new sns.Subscription(stack, "Subscription", {
          endpoint: "endpoint",
          deliveryPolicy: {
            healthyRetryPolicy: {
              minDelayTarget: Duration.seconds(11),
              maxDelayTarget: Duration.seconds(10),
              numRetries: 6,
            },
          },
          protocol: sns.SubscriptionProtocol.HTTPS,
          topic,
        }),
    ).toThrow(/minDelayTarget must not exceed maxDelayTarget/);
  });

  const delayTestCases = [
    {
      prop: "minDelayTarget",
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(0),
          maxDelayTarget: Duration.seconds(10),
          numRetries: 6,
        },
      },
    },
    {
      prop: "maxDelayTarget",
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(10),
          maxDelayTarget: Duration.seconds(0),
          numRetries: 6,
        },
      },
    },
    {
      prop: "minDelayTarget",
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(3601),
          maxDelayTarget: Duration.seconds(10),
          numRetries: 6,
        },
      },
    },
    {
      prop: "maxDelayTarget",
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(10),
          maxDelayTarget: Duration.seconds(3601),
          numRetries: 6,
        },
      },
    },
  ];

  delayTestCases.forEach(({ prop, invalidDeliveryPolicy }) => {
    const invalidValue =
      invalidDeliveryPolicy.healthyRetryPolicy[
        prop as keyof sns.HealthyRetryPolicy
      ];
    test(`throws an error when ${prop} is ${invalidValue}`, () => {
      // THEN
      expect(
        () =>
          new sns.Subscription(stack, "Subscription", {
            endpoint: "endpoint",
            deliveryPolicy: invalidDeliveryPolicy,
            protocol: sns.SubscriptionProtocol.HTTPS,
            topic,
          }),
      ).toThrow(
        new RegExp(`${prop} must be between 1 and 3600 seconds inclusive`),
      );
    });
  });

  test.each([-1, 101])(
    "throws an error when deliveryPolicy numRetries is %d",
    (invalidValue: number) => {
      // THEN
      expect(
        () =>
          new sns.Subscription(stack, "Subscription", {
            endpoint: "endpoint",
            deliveryPolicy: {
              healthyRetryPolicy: {
                minDelayTarget: Duration.seconds(10),
                maxDelayTarget: Duration.seconds(10),
                numRetries: invalidValue,
              },
            },
            protocol: sns.SubscriptionProtocol.HTTPS,
            topic,
          }),
      ).toThrow(/numRetries must be between 0 and 100 inclusive/);
    },
  );

  test.each([
    {
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(1),
          maxDelayTarget: Duration.seconds(10),
          numRetries: 6,
          numNoDelayRetries: -1,
        },
      },
      prop: "numNoDelayRetries",
      value: -1,
    },
    {
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(1),
          maxDelayTarget: Duration.seconds(10),
          numRetries: 6,
          numMinDelayRetries: -1,
        },
      },
      prop: "numMinDelayRetries",
      value: -1,
    },
    {
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(1),
          maxDelayTarget: Duration.seconds(10),
          numRetries: 6,
          numMaxDelayRetries: -1,
        },
      },
      prop: "numMaxDelayRetries",
      value: -1,
    },
    {
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(1),
          maxDelayTarget: Duration.seconds(10),
          numRetries: 6,
          numNoDelayRetries: 1.5,
        },
      },
      prop: "numNoDelayRetries",
      value: 1.5,
    },
    {
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(1),
          maxDelayTarget: Duration.seconds(10),
          numRetries: 6,
          numMinDelayRetries: 1.5,
        },
      },
      prop: "numMinDelayRetries",
      value: 1.5,
    },
    {
      invalidDeliveryPolicy: {
        healthyRetryPolicy: {
          minDelayTarget: Duration.seconds(1),
          maxDelayTarget: Duration.seconds(10),
          numRetries: 6,
          numMaxDelayRetries: 1.5,
        },
      },
      prop: "numMaxDelayRetries",
      value: 1.5,
    },
  ])(
    "throws an error when $prop = $value",
    ({ invalidDeliveryPolicy, prop }) => {
      // THEN
      expect(
        () =>
          new sns.Subscription(stack, "Subscription", {
            endpoint: "endpoint",
            deliveryPolicy: invalidDeliveryPolicy,
            protocol: sns.SubscriptionProtocol.HTTPS,
            topic,
          }),
      ).toThrow(new RegExp(`${prop} must be an integer zero or greater`));
    },
  );

  test("throws an error when throttlePolicy < 1", () => {
    // THEN
    expect(
      () =>
        new sns.Subscription(stack, "Subscription", {
          endpoint: "endpoint",
          deliveryPolicy: {
            throttlePolicy: {
              maxReceivesPerSecond: 0,
            },
          },
          protocol: sns.SubscriptionProtocol.HTTPS,
          topic,
        }),
    ).toThrow(/maxReceivesPerSecond must be an integer greater than zero/);
  });
});
