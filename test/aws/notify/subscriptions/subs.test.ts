import * as path from "node:path";
import {
  dataAwsIamPolicyDocument,
  kmsKey,
  lambdaPermission,
  snsTopic,
  snsTopicSubscription,
  sqsQueue,
  sqsQueuePolicy,
} from "@cdktf/provider-aws";
import { App, TerraformVariable, Testing, Token, ref } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as compute from "../../../../src/aws/compute";
import * as encryption from "../../../../src/aws/encryption";
import * as notify from "../../../../src/aws/notify";
import * as subs from "../../../../src/aws/notify/subscriptions";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

let stack: AwsStack;
let topic: notify.Topic;

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridUUID2 = "123e4567-e89b-12d4"; // for cross-region tests
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000/foo",
};
const gridBackendConfig2 = {
  address: "http://localhost:3000/bar",
};

beforeEach(() => {
  const app = Testing.app();
  stack = new AwsStack(app);
  topic = new notify.Topic(stack, "MyTopic", {
    topicName: "topicName",
    displayName: "displayName",
  });
});

test("url subscription", () => {
  topic.addSubscription(new subs.UrlSubscription("https://foobar.com/"));

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(snsTopic.SnsTopic, {
    display_name: "displayName",
    name: "topicName",
  });
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "https://foobar.com/",
      protocol: "https",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("url subscription with user provided dlq", () => {
  const dlQueue = new notify.Queue(stack, "DeadLetterQueue", {
    queueName: "MySubscription_DLQ",
    retentionPeriod: Duration.days(14),
  });
  topic.addSubscription(
    new subs.UrlSubscription("https://foobar.com/", {
      deadLetterQueue: dlQueue,
    }),
  );

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "https://foobar.com/",
      protocol: "https",
      redrive_policy: JSON.stringify({
        deadLetterTargetArn: stack.resolve(dlQueue.queueArn),
      }),
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
  t.expect.toHaveResourceWithProperties(sqsQueue.SqsQueue, {
    message_retention_seconds: 1209600,
    // TODO: Fix namePrefix
    name_prefix: "MySubscription_DLQDeadLetterQueue",
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
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
              ],
              type: "Service",
            },
          ],
          resources: [stack.resolve(dlQueue.queueArn)],
        },
      ],
    },
  );
  t.expect.toHaveResourceWithProperties(sqsQueuePolicy.SqsQueuePolicy, {
    policy:
      "${data.aws_iam_policy_document.DeadLetterQueue_Policy_D01590FE.json}",
    queue_url: stack.resolve(dlQueue.queueUrl),
  });
});

test("url subscription (with raw delivery)", () => {
  topic.addSubscription(
    new subs.UrlSubscription("https://foobar.com/", {
      rawMessageDelivery: true,
    }),
  );

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "https://foobar.com/",
      protocol: "https",
      topic_arn: stack.resolve(topic.topicArn),
      raw_message_delivery: true,
    },
  );
});

test("url subscription (unresolved url with protocol)", () => {
  const urlToken = Token.asString(ref("my-url"));
  topic.addSubscription(
    new subs.UrlSubscription(urlToken, {
      protocol: notify.SubscriptionProtocol.HTTPS,
    }),
  );

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-url}",
      protocol: "https",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("url subscription (double unresolved url with protocol)", () => {
  const urlToken1 = Token.asString(ref("my-url-1"));
  const urlToken2 = Token.asString(ref("my-url-2"));

  topic.addSubscription(
    new subs.UrlSubscription(urlToken1, {
      protocol: notify.SubscriptionProtocol.HTTPS,
    }),
  );
  topic.addSubscription(
    new subs.UrlSubscription(urlToken2, {
      protocol: notify.SubscriptionProtocol.HTTPS,
    }),
  );

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-url-1}",
      protocol: "https",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-url-2}",
      protocol: "https",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("url subscription (unknown protocol)", () => {
  expect(() =>
    topic.addSubscription(
      new subs.UrlSubscription("some-protocol://foobar.com/"),
    ),
  ).toThrow(/URL must start with either http:\/\/ or https:\/\//);
});

test("url subscription (unresolved url without protocol)", () => {
  const urlToken = Token.asString(ref("my-url-1"));

  expect(() =>
    topic.addSubscription(new subs.UrlSubscription(urlToken)),
  ).toThrow(/Must provide protocol if url is unresolved/);
});

test("queue subscription", () => {
  const queue = new notify.Queue(stack, "MyQueue");

  topic.addSubscription(new subs.SqsSubscription(queue));

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: stack.resolve(queue.queueArn),
      protocol: "sqs",
      topic_arn: stack.resolve(topic.topicArn),
      depends_on: [
        "data.aws_iam_policy_document.MyQueue_Policy_B72AE551",
        "aws_sqs_queue_policy.MyQueue_Policy_6BBEDDAC",
      ],
    },
  );
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
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
              ],
              type: "Service",
            },
          ],
          resources: [stack.resolve(queue.queueArn)],
        },
      ],
    },
  );
  t.expect.toHaveResourceWithProperties(sqsQueuePolicy.SqsQueuePolicy, {
    policy: "${data.aws_iam_policy_document.MyQueue_Policy_B72AE551.json}",
    queue_url: stack.resolve(queue.queueUrl),
  });
});

test("queue subscription cross region", () => {
  const app = new App();
  const topicStack = new AwsStack(app, "TopicStack", {
    environmentName,
    gridBackendConfig,
    gridUUID,
    providerConfig: {
      region: "us-east-1",
      // account: "11111111111",
    },
    // env: {
    //   account: "11111111111",
    //   region: "us-east-1",
    // },
  });
  const queueStack = new AwsStack(app, "QueueStack", {
    environmentName,
    gridBackendConfig: gridBackendConfig2,
    gridUUID: gridUUID2,
    providerConfig: {
      region: "us-east-2",
      // account: "11111111111",
    },
    // env: {
    //   account: "11111111111",
    //   region: "us-east-2",
    // },
  });

  const topic1 = new notify.Topic(topicStack, "Topic", {
    topicName: "topicName",
    displayName: "displayName",
    registerOutputs: true,
    outputName: "topic",
  });

  const queue = new notify.Queue(queueStack, "MyQueue");

  topic1.addSubscription(new subs.SqsSubscription(queue));

  // THEN
  Template.synth(topicStack).toHaveResourceWithProperties(snsTopic.SnsTopic, {
    display_name: "displayName",
    name: "topicName",
  });

  // TOFIX: should be "topic" output when registerOutputs is true...
  const crossStackTopicRef =
    "${data.terraform_remote_state.cross-stack-reference-input-TopicStack.outputs.cross-stack-output-aws_sns_topicTopic_BFC7AF6Earn}";
  const t = new Template(queueStack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: stack.resolve(queue.queueArn),
      protocol: "sqs",
      topic_arn: crossStackTopicRef,
      depends_on: [
        "data.aws_iam_policy_document.MyQueue_Policy_B72AE551",
        "aws_sqs_queue_policy.MyQueue_Policy_6BBEDDAC",
      ],
    },
  );
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
              values: [crossStackTopicRef],
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
              ],
              type: "Service",
            },
          ],
          resources: [stack.resolve(queue.queueArn)],
        },
      ],
    },
  );
  t.expect.toHaveResourceWithProperties(sqsQueuePolicy.SqsQueuePolicy, {
    policy: "${data.aws_iam_policy_document.MyQueue_Policy_B72AE551.json}",
    queue_url: stack.resolve(queue.queueUrl),
  });
});

// // CDKTF uses cross stack references in all cases...
// test("queue subscription cross region, env agnostic", () => {
//   const app = new App();
//   const topicStack = new AwsStack(app, "TopicStack", {
//     gridBackendConfig,
//     environmentName,
//     gridUUID,
//     providerConfig,
//   });
//   const queueStack = new AwsStack(app, "QueueStack", {
//     gridBackendConfig,
//     environmentName,
//     gridUUID: gridUUID2,
//     providerConfig,
//   });

//   const topic1 = new notify.Topic(topicStack, "Topic", {
//     topicName: "topicName",
//     displayName: "displayName",
//     registerOutputs: true,
//     outputName: "topic",
//   });

//   const queue = new notify.Queue(queueStack, "MyQueue");

//   topic1.addSubscription(new subs.SqsSubscription(queue));

//   Template.fromStack(topicStack, { snapshot: true });
//   // .toMatchObject({
//   //   resource: {
//   //     TopicBFC7AF6E: {
//   //       Type: "AWS::SNS::Topic",
//   //       Properties: {
//   //         DisplayName: "displayName",
//   //         TopicName: "topicName",
//   //       },
//   //     },
//   //   },
//   //   Outputs: {
//   //     ExportsOutputRefTopicBFC7AF6ECB4A357A: {
//   //       Value: {
//   //         Ref: "TopicBFC7AF6E",
//   //       },
//   //       Export: {
//   //         Name: "TopicStack:ExportsOutputRefTopicBFC7AF6ECB4A357A",
//   //       },
//   //     },
//   //   },
//   // });

//   Template.fromStack(queueStack, { snapshot: true });
//   // .toMatchObject({
//   //   resource: {
//   //     MyQueueE6CA6235: {
//   //       Type: "AWS::SQS::Queue",
//   //       UpdateReplacePolicy: "Delete",
//   //       DeletionPolicy: "Delete",
//   //     },
//   //     MyQueuePolicy6BBEDDAC: {
//   //       Type: "AWS::SQS::QueuePolicy",
//   //       Properties: {
//   //         PolicyDocument: {
//   //           Statement: [
//   //             {
//   //               Action: "sqs:SendMessage",
//   //               Condition: {
//   //                 ArnEquals: {
//   //                   "aws:SourceArn": {
//   //                     "Fn::ImportValue":
//   //                       "TopicStack:ExportsOutputRefTopicBFC7AF6ECB4A357A",
//   //                   },
//   //                 },
//   //               },
//   //               Effect: "Allow",
//   //               Principal: {
//   //                 Service: "sns.amazonaws.com",
//   //               },
//   //               Resource: {
//   //                 "Fn::GetAtt": ["MyQueueE6CA6235", "Arn"],
//   //               },
//   //             },
//   //           ],
//   //           Version: "2012-10-17",
//   //         },
//   //         Queues: [
//   //           {
//   //             Ref: "MyQueueE6CA6235",
//   //           },
//   //         ],
//   //       },
//   //     },
//   //     MyQueueTopicStackTopicFBF76EB349BDFA94: {
//   //       Type: "AWS::SNS::Subscription",
//   //       Properties: {
//   //         Protocol: "sqs",
//   //         TopicArn: {
//   //           "Fn::ImportValue":
//   //             "TopicStack:ExportsOutputRefTopicBFC7AF6ECB4A357A",
//   //         },
//   //         Endpoint: {
//   //           "Fn::GetAtt": ["MyQueueE6CA6235", "Arn"],
//   //         },
//   //       },
//   //     },
//   //   },
//   // });
// });

// // CDKTF uses cross stack references in all cases...
// test("queue subscription cross region, topic env agnostic", () => {
//   const app = new App();
//   const topicStack = new AwsStack(app, "TopicStack", {
//     gridBackendConfig,
//     environmentName,
//     gridUUID,
//     providerConfig,
//   });
//   const queueStack = new AwsStack(app, "QueueStack", {
//     gridBackendConfig,
//     environmentName,
//     gridUUID: gridUUID2,
//     providerConfig: {
//       region: "us-east-1",
//       // account: "11111111111",
//     },
//     // env: {
//     //   account: "11111111111",
//     //   region: "us-east-1",
//     // },
//   });

//   const topic1 = new notify.Topic(topicStack, "Topic", {
//     topicName: "topicName",
//     displayName: "displayName",
//   });

//   const queue = new notify.Queue(queueStack, "MyQueue");

//   topic1.addSubscription(new subs.SqsSubscription(queue));

//   Template.fromStack(topicStack, { snapshot: true });
//   // .toMatchObject({
//   //   resource: {
//   //     TopicBFC7AF6E: {
//   //       Type: "AWS::SNS::Topic",
//   //       Properties: {
//   //         DisplayName: "displayName",
//   //         TopicName: "topicName",
//   //       },
//   //     },
//   //   },
//   // });

//   Template.fromStack(queueStack, { snapshot: true });
//   // .toMatchObject({
//   //   resource: {
//   //     MyQueueE6CA6235: {
//   //       Type: "AWS::SQS::Queue",
//   //       UpdateReplacePolicy: "Delete",
//   //       DeletionPolicy: "Delete",
//   //     },
//   //     MyQueuePolicy6BBEDDAC: {
//   //       Type: "AWS::SQS::QueuePolicy",
//   //       Properties: {
//   //         PolicyDocument: {
//   //           Statement: [
//   //             {
//   //               Action: "sqs:SendMessage",
//   //               Condition: {
//   //                 ArnEquals: {
//   //                   "aws:SourceArn": {
//   //                     "Fn::Join": [
//   //                       "",
//   //                       [
//   //                         "arn:",
//   //                         {
//   //                           Ref: "AWS::Partition",
//   //                         },
//   //                         ":sns:",
//   //                         {
//   //                           Ref: "AWS::Region",
//   //                         },
//   //                         ":",
//   //                         {
//   //                           Ref: "AWS::AccountId",
//   //                         },
//   //                         ":topicName",
//   //                       ],
//   //                     ],
//   //                   },
//   //                 },
//   //               },
//   //               Effect: "Allow",
//   //               Principal: {
//   //                 Service: "sns.amazonaws.com",
//   //               },
//   //               Resource: {
//   //                 "Fn::GetAtt": ["MyQueueE6CA6235", "Arn"],
//   //               },
//   //             },
//   //           ],
//   //           Version: "2012-10-17",
//   //         },
//   //         Queues: [
//   //           {
//   //             Ref: "MyQueueE6CA6235",
//   //           },
//   //         ],
//   //       },
//   //     },
//   //     MyQueueTopicStackTopicFBF76EB349BDFA94: {
//   //       Type: "AWS::SNS::Subscription",
//   //       Properties: {
//   //         Protocol: "sqs",
//   //         TopicArn: {
//   //           "Fn::Join": [
//   //             "",
//   //             [
//   //               "arn:",
//   //               {
//   //                 Ref: "AWS::Partition",
//   //               },
//   //               ":sns:",
//   //               {
//   //                 Ref: "AWS::Region",
//   //               },
//   //               ":",
//   //               {
//   //                 Ref: "AWS::AccountId",
//   //               },
//   //               ":topicName",
//   //             ],
//   //           ],
//   //         },
//   //         Endpoint: {
//   //           "Fn::GetAtt": ["MyQueueE6CA6235", "Arn"],
//   //         },
//   //       },
//   //     },
//   //   },
//   // });
// });

// // CDKTF uses cross stack references in all cases...
// test("queue subscription cross region, queue env agnostic", () => {
//   const app = new App();
//   const topicStack = new AwsStack(app, "TopicStack", {
//     gridBackendConfig,
//     environmentName,
//     gridUUID,
//     providerConfig: {
//       region: "us-east-1",
//       // account: "11111111111",
//     },
//     // env: {
//     //   account: "11111111111",
//     //   region: "us-east-1",
//     // },
//   });
//   const queueStack = new AwsStack(app, "QueueStack", {
//     gridBackendConfig,
//     environmentName,
//     gridUUID: gridUUID2,
//     providerConfig,
//   });

//   const topic1 = new notify.Topic(topicStack, "Topic", {
//     topicName: "topicName",
//     displayName: "displayName",
//   });

//   const queue = new notify.Queue(queueStack, "MyQueue");

//   topic1.addSubscription(new subs.SqsSubscription(queue));

//   Template.fromStack(topicStack, { snapshot: true });
//   // .toMatchObject({
//   //   resource: {
//   //     TopicBFC7AF6E: {
//   //       Type: "AWS::SNS::Topic",
//   //       Properties: {
//   //         DisplayName: "displayName",
//   //         TopicName: "topicName",
//   //       },
//   //     },
//   //   },
//   // });

//   Template.fromStack(queueStack, { snapshot: true });
//   // .toMatchObject({
//   //   resource: {
//   //     MyQueueE6CA6235: {
//   //       Type: "AWS::SQS::Queue",
//   //       UpdateReplacePolicy: "Delete",
//   //       DeletionPolicy: "Delete",
//   //     },
//   //     MyQueuePolicy6BBEDDAC: {
//   //       Type: "AWS::SQS::QueuePolicy",
//   //       Properties: {
//   //         PolicyDocument: {
//   //           Statement: [
//   //             {
//   //               Action: "sqs:SendMessage",
//   //               Condition: {
//   //                 ArnEquals: {
//   //                   "aws:SourceArn": {
//   //                     "Fn::Join": [
//   //                       "",
//   //                       [
//   //                         "arn:",
//   //                         {
//   //                           Ref: "AWS::Partition",
//   //                         },
//   //                         ":sns:us-east-1:11111111111:topicName",
//   //                       ],
//   //                     ],
//   //                   },
//   //                 },
//   //               },
//   //               Effect: "Allow",
//   //               Principal: {
//   //                 Service: "sns.amazonaws.com",
//   //               },
//   //               Resource: {
//   //                 "Fn::GetAtt": ["MyQueueE6CA6235", "Arn"],
//   //               },
//   //             },
//   //           ],
//   //           Version: "2012-10-17",
//   //         },
//   //         Queues: [
//   //           {
//   //             Ref: "MyQueueE6CA6235",
//   //           },
//   //         ],
//   //       },
//   //     },
//   //     MyQueueTopicStackTopicFBF76EB349BDFA94: {
//   //       Type: "AWS::SNS::Subscription",
//   //       Properties: {
//   //         Protocol: "sqs",
//   //         TopicArn: {
//   //           "Fn::Join": [
//   //             "",
//   //             [
//   //               "arn:",
//   //               {
//   //                 Ref: "AWS::Partition",
//   //               },
//   //               ":sns:us-east-1:11111111111:topicName",
//   //             ],
//   //           ],
//   //         },
//   //         Endpoint: {
//   //           "Fn::GetAtt": ["MyQueueE6CA6235", "Arn"],
//   //         },
//   //         Region: "us-east-1",
//   //       },
//   //     },
//   //   },
//   // });
// });

test("queue subscription with user provided dlq", () => {
  const queue = new notify.Queue(stack, "MyQueue");
  const dlQueue = new notify.Queue(stack, "DeadLetterQueue", {
    queueName: "MySubscription_DLQ",
    retentionPeriod: Duration.days(14),
  });

  topic.addSubscription(
    new subs.SqsSubscription(queue, {
      deadLetterQueue: dlQueue,
    }),
  );

  // THEN
  const t = new Template(stack);
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
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
              ],
              type: "Service",
            },
          ],
          resources: [stack.resolve(dlQueue.queueArn)],
        },
      ],
    },
  );
  t.expect.toHaveResourceWithProperties(sqsQueuePolicy.SqsQueuePolicy, {
    policy:
      "${data.aws_iam_policy_document.DeadLetterQueue_Policy_D01590FE.json}",
    queue_url: stack.resolve(dlQueue.queueUrl),
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
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
              ],
              type: "Service",
            },
          ],
          resources: [stack.resolve(queue.queueArn)],
        },
      ],
    },
  );
  t.expect.toHaveResourceWithProperties(sqsQueuePolicy.SqsQueuePolicy, {
    policy: "${data.aws_iam_policy_document.MyQueue_Policy_B72AE551.json}",
    queue_url: stack.resolve(queue.queueUrl),
  });
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: stack.resolve(queue.queueArn),
      protocol: "sqs",
      topic_arn: stack.resolve(topic.topicArn),
      depends_on: [
        "data.aws_iam_policy_document.MyQueue_Policy_B72AE551",
        "aws_sqs_queue_policy.MyQueue_Policy_6BBEDDAC",
      ],
      redrive_policy: JSON.stringify({
        deadLetterTargetArn: stack.resolve(dlQueue.queueArn),
      }),
    },
  );
});

test("queue subscription (with raw delivery)", () => {
  const queue = new notify.Queue(stack, "MyQueue");

  topic.addSubscription(
    new subs.SqsSubscription(queue, { rawMessageDelivery: true }),
  );

  Template.synth(stack).toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      topic_arn: stack.resolve(topic.topicArn),
      endpoint: stack.resolve(queue.queueArn),
      protocol: "sqs",
      raw_message_delivery: true,
      depends_on: [
        "data.aws_iam_policy_document.MyQueue_Policy_B72AE551",
        "aws_sqs_queue_policy.MyQueue_Policy_6BBEDDAC",
      ],
    },
  );
});

test("encrypted queue subscription", () => {
  const key = new encryption.Key(stack, "MyKey", {
    // removalPolicy: RemovalPolicy.DESTROY,
  });

  const queue = new notify.Queue(stack, "MyQueue", {
    encryption: notify.QueueEncryption.KMS,
    encryptionMasterKey: key,
  });

  topic.addSubscription(new subs.SqsSubscription(queue));

  Template.fromStack(stack).toMatchObject({
    data: {
      [dataAwsIamPolicyDocument.DataAwsIamPolicyDocument.tfResourceType]: {
        MyKey_Policy_A23B479B: {
          statement: [
            {
              actions: ["kms:*"],
              effect: "Allow",
              principals: [
                {
                  type: "AWS",
                  identifiers: [
                    "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                  ],
                },
              ],
              resources: ["*"],
            },
            {
              actions: ["kms:Decrypt", "kms:GenerateDataKey"],
              effect: "Allow",
              principals: [
                {
                  type: "Service",
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
                  ],
                },
              ],
              resources: ["*"],
            },
          ],
        },
        MyQueue_Policy_B72AE551: {
          statement: [
            {
              actions: ["sqs:SendMessage"],
              condition: [
                {
                  test: "ArnEquals",
                  values: [stack.resolve(topic.topicArn)],
                  variable: "aws:SourceArn",
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
              resources: [stack.resolve(queue.queueArn)],
            },
          ],
        },
      },
    },
    resource: {
      [snsTopic.SnsTopic.tfResourceType]: {
        MyTopic_86869434: {
          display_name: "displayName",
          name: "topicName",
        },
      },
      [kmsKey.KmsKey.tfResourceType]: {
        MyKey_6AB29FA6: {
          policy: "${data.aws_iam_policy_document.MyKey_Policy_A23B479B.json}",
        },
      },
      [sqsQueue.SqsQueue.tfResourceType]: {
        MyQueue_E6CA6235: {
          kms_master_key_id: stack.resolve(key.keyArn),
        },
      },
      [sqsQueuePolicy.SqsQueuePolicy.tfResourceType]: {
        MyQueue_Policy_6BBEDDAC: {
          policy:
            "${data.aws_iam_policy_document.MyQueue_Policy_B72AE551.json}",
          queue_url: stack.resolve(queue.queueUrl),
        },
      },
      [snsTopicSubscription.SnsTopicSubscription.tfResourceType]: {
        MyQueue_MyTopic_9B00631B: {
          protocol: "sqs",
          topic_arn: stack.resolve(topic.topicArn),
          endpoint: stack.resolve(queue.queueArn),
          region: "${data.aws_region.Region.name}",
          depends_on: [
            "data.aws_iam_policy_document.MyQueue_Policy_B72AE551",
            "aws_sqs_queue_policy.MyQueue_Policy_6BBEDDAC",
          ],
        },
      },
    },
  });
});

// There will be no feature flag so we can always expect the condition in the policy statement
test("restrict decryption of sqs to sns topic", () => {
  const key = new encryption.Key(stack, "MyKey", {
    // removalPolicy: RemovalPolicy.DESTROY,
  });

  const queue = new notify.Queue(stack, "MyQueue", {
    encryptionMasterKey: key,
  });

  topic.addSubscription(new subs.SqsSubscription(queue));

  Template.fromStack(stack).toMatchObject({
    data: {
      [dataAwsIamPolicyDocument.DataAwsIamPolicyDocument.tfResourceType]: {
        MyKey_Policy_A23B479B: {
          statement: [
            {
              actions: ["kms:*"],
              effect: "Allow",
              principals: [
                {
                  type: "AWS",
                  identifiers: [
                    "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                  ],
                },
              ],
              resources: ["*"],
            },
            {
              actions: ["kms:Decrypt", "kms:GenerateDataKey"],
              effect: "Allow",
              principals: [
                {
                  type: "Service",
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
                  ],
                },
              ],
              resources: ["*"],
              condition: [
                {
                  test: "ArnEquals",
                  variable: "aws:SourceArn",
                  values: [stack.resolve(topic.topicArn)],
                },
              ],
            },
          ],
        },
      },
    },
    resource: {
      [kmsKey.KmsKey.tfResourceType]: {
        MyKey_6AB29FA6: {
          policy: "${data.aws_iam_policy_document.MyKey_Policy_A23B479B.json}",
        },
      },
    },
  });
});

test("throws an error when a queue is encrypted by AWS managed KMS kye for queue subscription", () => {
  // WHEN
  const queue = new notify.Queue(stack, "MyQueue", {
    encryption: notify.QueueEncryption.KMS_MANAGED,
  });

  // THEN
  expect(() => topic.addSubscription(new subs.SqsSubscription(queue))).toThrow(
    /SQS queue encrypted by AWS managed KMS key cannot be used as SNS subscription/,
  );
});

test("throws an error when a dead-letter queue is encrypted by AWS managed KMS kye for queue subscription", () => {
  // WHEN
  const queue = new notify.Queue(stack, "MyQueue");
  const dlq = new notify.Queue(stack, "MyDLQ", {
    encryption: notify.QueueEncryption.KMS_MANAGED,
  });

  // THEN
  expect(() =>
    topic.addSubscription(
      new subs.SqsSubscription(queue, {
        deadLetterQueue: dlq,
      }),
    ),
  ).toThrow(
    /SQS queue encrypted by AWS managed KMS key cannot be used as dead-letter queue/,
  );
});

test("importing SQS queue and specify this as subscription", () => {
  // WHEN
  const queue = notify.Queue.fromQueueArn(
    stack,
    "Queue",
    "arn:aws:sqs:us-east-1:123456789012:queue1",
  );
  topic.addSubscription(new subs.SqsSubscription(queue));

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      protocol: "sqs",
      topic_arn: stack.resolve(topic.topicArn),
      endpoint: stack.resolve(queue.queueArn),
    },
  );
});

test("lambda subscription", () => {
  const func = new compute.LambdaFunction(stack, "MyFunc", {
    // path: path.join(__dirname, "fixtures", "noop.ts"),
    runtime: compute.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: compute.Code.fromInline(
      "exports.handler = function(e, c, cb) { return cb() }",
    ),
  });

  topic.addSubscription(new subs.LambdaSubscription(func));

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: stack.resolve(func.functionArn),
      protocol: "lambda",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
  t.expect.toHaveResourceWithProperties(lambdaPermission.LambdaPermission, {
    action: "lambda:InvokeFunction",
    function_name: stack.resolve(func.functionArn),
    principal: "sns.amazonaws.com",
    source_arn: stack.resolve(topic.topicArn),
  });
});

test("lambda subscription, cross region env agnostic", () => {
  const app = new App();
  const topicStack = new AwsStack(app, "TopicStack", {
    gridBackendConfig,
    environmentName,
    gridUUID,
    providerConfig,
  });
  const lambdaStack = new AwsStack(app, "LambdaStack", {
    gridBackendConfig,
    environmentName,
    gridUUID: gridUUID2,
    providerConfig,
  });

  const topic1 = new notify.Topic(topicStack, "Topic", {
    topicName: "topicName",
    displayName: "displayName",
  });
  const func = new compute.LambdaFunction(lambdaStack, "MyFunc", {
    // path: path.join(__dirname, "fixtures", "noop.ts"),
    runtime: compute.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: compute.Code.fromInline(
      "exports.handler = function(e, c, cb) { return cb() }",
    ),
  });

  topic1.addSubscription(new subs.LambdaSubscription(func));

  // THEN
  const crossStackTopicRef =
    "${data.terraform_remote_state.cross-stack-reference-input-TopicStack.outputs.cross-stack-output-aws_sns_topicTopic_BFC7AF6Earn}";

  const t = new Template(lambdaStack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: stack.resolve(func.functionArn),
      protocol: "lambda",
      topic_arn: crossStackTopicRef,
    },
  );
  t.expect.toHaveResourceWithProperties(lambdaPermission.LambdaPermission, {
    action: "lambda:InvokeFunction",
    function_name: stack.resolve(func.functionArn),
    principal: "sns.amazonaws.com",
    source_arn: crossStackTopicRef,
  });
});

// CDKTF uses cross stack references in all cases...
// test("lambda subscription, cross region", () => {
//   const app = new App();
//   const topicStack = new AwsStack(app, "TopicStack", {
//     gridBackendConfig,
//     environmentName,
//     gridUUID,
//     providerConfig: {
//       region: "us-east-1",
//       // account: "11111111111",
//     },
//     // env: {
//     //   account: "11111111111",
//     //   region: "us-east-1",
//     // },
//   });
//   const lambdaStack = new AwsStack(app, "LambdaStack", {
//     gridBackendConfig,
//     environmentName,
//     gridUUID: gridUUID2,
//     providerConfig: {
//       region: "us-east-2",
//       // account: "11111111111",
//     },
//     // env: {
//     //   account: "11111111111",
//     //   region: "us-east-2",
//     // },
//   });

//   const topic1 = new notify.Topic(topicStack, "Topic", {
//     topicName: "topicName",
//     displayName: "displayName",
//   });
//   const func = new compute.LambdaFunction(lambdaStack, "MyFunc", {
//     // path: path.join(__dirname, "fixtures", "noop.ts"),
//     runtime: compute.Runtime.NODEJS_LATEST,
//     handler: "index.handler",
//     code: compute.Code.fromInline(
//       "exports.handler = function(e, c, cb) { return cb() }",
//     ),
//   });

//   topic1.addSubscription(new subs.LambdaSubscription(func));

//   Template.fromStack(lambdaStack, { snapshot: true });
//   // .toMatchObject({
//   //   resource: {
//   //     MyFuncServiceRole54065130: {
//   //       Type: "AWS::IAM::Role",
//   //       Properties: {
//   //         AssumeRolePolicyDocument: {
//   //           Statement: [
//   //             {
//   //               Action: "sts:AssumeRole",
//   //               Effect: "Allow",
//   //               Principal: {
//   //                 Service: "lambda.amazonaws.com",
//   //               },
//   //             },
//   //           ],
//   //           Version: "2012-10-17",
//   //         },
//   //         ManagedPolicyArns: [
//   //           {
//   //             "Fn::Join": [
//   //               "",
//   //               [
//   //                 "arn:",
//   //                 {
//   //                   Ref: "AWS::Partition",
//   //                 },
//   //                 ":iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
//   //               ],
//   //             ],
//   //           },
//   //         ],
//   //       },
//   //     },
//   //     MyFunc8A243A2C: {
//   //       Type: "AWS::Lambda::Function",
//   //       Properties: {
//   //         Code: {
//   //           ZipFile: "exports.handler = function(e, c, cb) { return cb() }",
//   //         },
//   //         Role: {
//   //           "Fn::GetAtt": ["MyFuncServiceRole54065130", "Arn"],
//   //         },
//   //         Handler: "index.handler",
//   //         Runtime: compute.Runtime.NODEJS_LATEST.name,
//   //       },
//   //       DependsOn: ["MyFuncServiceRole54065130"],
//   //     },
//   //     MyFuncAllowInvokeTopicStackTopicFBF76EB3D4A699EF: {
//   //       Type: "AWS::Lambda::Permission",
//   //       Properties: {
//   //         Action: "lambda:InvokeFunction",
//   //         FunctionName: {
//   //           "Fn::GetAtt": ["MyFunc8A243A2C", "Arn"],
//   //         },
//   //         Principal: "sns.amazonaws.com",
//   //         SourceArn: {
//   //           "Fn::Join": [
//   //             "",
//   //             [
//   //               "arn:",
//   //               {
//   //                 Ref: "AWS::Partition",
//   //               },
//   //               ":sns:us-east-1:11111111111:topicName",
//   //             ],
//   //           ],
//   //         },
//   //       },
//   //     },
//   //     MyFuncTopic3B7C24C5: {
//   //       Type: "AWS::SNS::Subscription",
//   //       Properties: {
//   //         Protocol: "lambda",
//   //         TopicArn: {
//   //           "Fn::Join": [
//   //             "",
//   //             [
//   //               "arn:",
//   //               {
//   //                 Ref: "AWS::Partition",
//   //               },
//   //               ":sns:us-east-1:11111111111:topicName",
//   //             ],
//   //           ],
//   //         },
//   //         Endpoint: {
//   //           "Fn::GetAtt": ["MyFunc8A243A2C", "Arn"],
//   //         },
//   //         Region: "us-east-1",
//   //       },
//   //     },
//   //   },
//   // });
// });

test("email subscription", () => {
  topic.addSubscription(new subs.EmailSubscription("foo@bar.com"));
  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "foo@bar.com",
      protocol: "email",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("email subscription with unresolved", () => {
  const emailToken = Token.asString(ref("my-email-1"));
  topic.addSubscription(new subs.EmailSubscription(emailToken));
  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-email-1}",
      protocol: "email",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("email and url subscriptions with unresolved", () => {
  const emailToken = Token.asString(ref("my-email-1"));
  const urlToken = Token.asString(ref("my-url-1"));
  topic.addSubscription(new subs.EmailSubscription(emailToken));
  topic.addSubscription(
    new subs.UrlSubscription(urlToken, {
      protocol: notify.SubscriptionProtocol.HTTPS,
    }),
  );
  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-email-1}",
      protocol: "email",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-url-1}",
      protocol: "https",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("email and url subscriptions with unresolved - four subscriptions", () => {
  const emailToken1 = Token.asString(ref("my-email-1"));
  const emailToken2 = Token.asString(ref("my-email-2"));
  const emailToken3 = Token.asString(ref("my-email-3"));
  const emailToken4 = Token.asString(ref("my-email-4"));

  topic.addSubscription(new subs.EmailSubscription(emailToken1));
  topic.addSubscription(new subs.EmailSubscription(emailToken2));
  topic.addSubscription(new subs.EmailSubscription(emailToken3));
  topic.addSubscription(new subs.EmailSubscription(emailToken4));

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-email-1}",
      protocol: "email",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-email-2}",
      protocol: "email",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-email-3}",
      protocol: "email",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-email-4}",
      protocol: "email",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("multiple subscriptions", () => {
  const queue = new notify.Queue(stack, "MyQueue");
  const func = new compute.LambdaFunction(stack, "MyFunc", {
    // path: path.join(__dirname, "fixtures", "noop.ts"),
    runtime: compute.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: compute.Code.fromInline(
      "exports.handler = function(e, c, cb) { return cb() }",
    ),
  });

  topic.addSubscription(new subs.SqsSubscription(queue));
  topic.addSubscription(new subs.LambdaSubscription(func));

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: stack.resolve(func.functionArn),
      protocol: "lambda",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
  // Assert Lambda Permission
  t.expect.toHaveResourceWithProperties(lambdaPermission.LambdaPermission, {
    action: "lambda:InvokeFunction",
    function_name: stack.resolve(func.functionArn),
    principal: "sns.amazonaws.com",
    source_arn: stack.resolve(topic.topicArn),
  });
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: stack.resolve(queue.queueArn),
      protocol: "sqs",
      topic_arn: stack.resolve(topic.topicArn),
      depends_on: [
        "data.aws_iam_policy_document.MyQueue_Policy_B72AE551",
        "aws_sqs_queue_policy.MyQueue_Policy_6BBEDDAC",
      ],
    },
  );
  // Assert Queue Policy
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
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
              ],
              type: "Service",
            },
          ],
          resources: [stack.resolve(queue.queueArn)],
        },
      ],
    },
  );
  t.expect.toHaveResourceWithProperties(sqsQueuePolicy.SqsQueuePolicy, {
    policy: "${data.aws_iam_policy_document.MyQueue_Policy_B72AE551.json}",
    queue_url: stack.resolve(queue.queueUrl),
  });
});

test("throws with multiple subscriptions of the same subscriber", () => {
  const queue = new notify.Queue(stack, "MyQueue");

  topic.addSubscription(new subs.SqsSubscription(queue));

  expect(() => topic.addSubscription(new subs.SqsSubscription(queue))).toThrow(
    /A subscription with id \".*\" already exists under the scope Default\/MyQueue/,
  );
});

test("with filter policy", () => {
  const func = new compute.LambdaFunction(stack, "MyFunc", {
    // path: path.join(__dirname, "fixtures", "noop.ts"),
    runtime: compute.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: compute.Code.fromInline(
      "exports.handler = function(e, c, cb) { return cb() }",
    ),
  });

  topic.addSubscription(
    new subs.LambdaSubscription(func, {
      filterPolicy: {
        color: notify.SubscriptionFilter.stringFilter({
          allowlist: ["red"],
          matchPrefixes: ["bl", "ye"],
          matchSuffixes: ["ue", "ow"],
        }),
        size: notify.SubscriptionFilter.stringFilter({
          denylist: ["small", "medium"],
        }),
        price: notify.SubscriptionFilter.numericFilter({
          between: { start: 100, stop: 200 },
        }),
      },
    }),
  );

  Template.synth(stack).toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      filter_policy: JSON.stringify({
        color: [
          "red",
          {
            prefix: "bl",
          },
          {
            prefix: "ye",
          },
          {
            suffix: "ue",
          },
          {
            suffix: "ow",
          },
        ],
        size: [
          {
            "anything-but": ["small", "medium"],
          },
        ],
        price: [
          {
            numeric: [">=", 100, "<=", 200],
          },
        ],
      }),
    },
  );
});

test("with filter policy scope MessageBody", () => {
  const func = new compute.LambdaFunction(stack, "MyFunc", {
    // path: path.join(__dirname, "fixtures", "noop.ts"),
    runtime: compute.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: compute.Code.fromInline(
      "exports.handler = function(e, c, cb) { return cb() }",
    ),
  });

  topic.addSubscription(
    new subs.LambdaSubscription(func, {
      filterPolicyWithMessageBody: {
        color: notify.FilterOrPolicy.policy({
          background: notify.FilterOrPolicy.filter(
            notify.SubscriptionFilter.stringFilter({
              allowlist: ["red"],
              matchPrefixes: ["bl", "ye"],
              matchSuffixes: ["ue", "ow"],
            }),
          ),
        }),
        size: notify.FilterOrPolicy.filter(
          notify.SubscriptionFilter.stringFilter({
            denylist: ["small", "medium"],
          }),
        ),
      },
    }),
  );

  Template.synth(stack).toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      filter_policy: JSON.stringify({
        color: {
          background: [
            "red",
            {
              prefix: "bl",
            },
            {
              prefix: "ye",
            },
            {
              suffix: "ue",
            },
            {
              suffix: "ow",
            },
          ],
        },
        size: [
          {
            "anything-but": ["small", "medium"],
          },
        ],
      }),
      filter_policy_scope: "MessageBody",
    },
  );
});

test("region property is present on an imported topic - sqs", () => {
  const imported = notify.Topic.fromTopicArn(
    stack,
    "mytopic",
    "arn:aws:sns:us-east-1:1234567890:mytopic",
  );
  const queue = new notify.Queue(stack, "myqueue");
  imported.addSubscription(new subs.SqsSubscription(queue));

  Template.synth(stack).toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      region: "us-east-1",
    },
  );
});

test("region property on an imported topic as a parameter - sqs", () => {
  const topicArn = new TerraformVariable(stack, "topicArn", {});
  const imported = notify.Topic.fromTopicArn(
    stack,
    "mytopic",
    topicArn.stringValue,
  );
  const queue = new notify.Queue(stack, "myqueue");
  imported.addSubscription(new subs.SqsSubscription(queue));

  Template.synth(stack).toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      region: '${element(split(":", var.topicArn), 3)}',
    },
  );
});

test("region property is present on an imported topic - lambda", () => {
  const imported = notify.Topic.fromTopicArn(
    stack,
    "mytopic",
    "arn:aws:sns:us-east-1:1234567890:mytopic",
  );
  const func = new compute.LambdaFunction(stack, "MyFunc", {
    // path: path.join(__dirname, "fixtures", "noop.ts"),
    runtime: compute.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: compute.Code.fromInline(
      "exports.handler = function(e, c, cb) { return cb() }",
    ),
  });
  imported.addSubscription(new subs.LambdaSubscription(func));

  Template.synth(stack).toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      region: "us-east-1",
    },
  );
});

test("region property on an imported topic as a parameter - lambda", () => {
  const topicArn = new TerraformVariable(stack, "topicArn", {});
  const imported = notify.Topic.fromTopicArn(
    stack,
    "mytopic",
    topicArn.stringValue,
  );
  const func = new compute.LambdaFunction(stack, "MyFunc", {
    // path: path.join(__dirname, "fixtures", "noop.ts"),
    runtime: compute.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: compute.Code.fromInline(
      "exports.handler = function(e, c, cb) { return cb() }",
    ),
  });
  imported.addSubscription(new subs.LambdaSubscription(func));

  Template.synth(stack).toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      region: '${element(split(":", var.topicArn), 3)}',
    },
  );
});

test("sms subscription", () => {
  topic.addSubscription(new subs.SmsSubscription("+15551231234"));
  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "+15551231234",
      protocol: "sms",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("sms subscription with unresolved", () => {
  const smsToken = Token.asString(ref("my-sms-1"));
  topic.addSubscription(new subs.SmsSubscription(smsToken));
  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    snsTopicSubscription.SnsTopicSubscription,
    {
      endpoint: "${my-sms-1}",
      protocol: "sms",
      topic_arn: stack.resolve(topic.topicArn),
    },
  );
});
