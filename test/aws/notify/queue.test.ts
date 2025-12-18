import {
  sqsQueue,
  sqsQueuePolicy,
  dataAwsIamPolicyDocument,
  kmsKey,
} from "@cdktf/provider-aws";
import { TerraformVariable, Testing, Token } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as encryption from "../../../src/aws/encryption";
import * as iam from "../../../src/aws/iam";
import * as notify from "../../../src/aws/notify";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };
describe("Queue", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new notify.Queue(stack, "HelloWorld");
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should synth and match SnapShot with prefix", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new notify.Queue(stack, "HelloWorld", {
      queueName: "hello-world",
      encryption: notify.QueueEncryption.KMS_MANAGED,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(15),
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should synth with DLQ and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    const deadLetterQueue = new notify.Queue(stack, "DLQ", {
      encryption: notify.QueueEncryption.KMS_MANAGED,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(15),
    });
    new notify.Queue(stack, "Queue", {
      deadLetterQueue: {
        maxReceiveCount: 5,
        queue: deadLetterQueue,
      },
      encryption: notify.QueueEncryption.KMS_MANAGED,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(15),
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should synth with fifo suffix and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new notify.Queue(stack, "Queue", {
      queueName: "queue.fifo",
      encryption: notify.QueueEncryption.KMS_MANAGED,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(15),
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should synth with contentBasedDeduplication and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new notify.Queue(stack, "Queue", {
      encryption: notify.QueueEncryption.KMS_MANAGED,
      contentBasedDeduplication: true,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(15),
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

test("default properties", () => {
  const stack = getAwsStack();
  const q = new notify.Queue(stack, "Queue");

  expect(q.fifo).toEqual(false);

  Template.fromStack(stack).toMatchObject({
    resource: {
      [sqsQueue.SqsQueue.tfResourceType]: {
        Queue_4A7E3555: {
          name_prefix: "123e4567-e89b-12d3-TestStackQueue",
        },
      },
    },
  });
});

test("with a dead letter queue", () => {
  const stack = getAwsStack();
  const dlq = new notify.Queue(stack, "DLQ");
  const dlqProps = { queue: dlq, maxReceiveCount: 3 };
  const queue = new notify.Queue(stack, "Queue", { deadLetterQueue: dlqProps });

  Template.fromStack(stack).toMatchObject({
    resource: {
      [sqsQueue.SqsQueue.tfResourceType]: {
        DLQ_581697C4: {
          name_prefix: "123e4567-e89b-12d3-TestStackDLQ",
        },
        Queue_4A7E3555: {
          redrive_policy: JSON.stringify({
            deadLetterTargetArn: stack.resolve(dlq.queueArn),
            maxReceiveCount: 3,
          }),
        },
      },
    },
  });

  expect(queue.deadLetterQueue).toEqual(dlqProps);
});

test("multiple prop validation errors are presented to the user (out-of-range retentionPeriod and deliveryDelay)", () => {
  // GIVEN
  const stack = getAwsStack();

  // THEN
  expect(
    () =>
      new notify.Queue(stack, "MyQueue", {
        retentionPeriod: Duration.seconds(30),
        deliveryDelay: Duration.minutes(16),
      }),
  ).toThrow(
    "Queue initialization failed due to the following validation error(s):\n- delivery delay must be between 0 and 900 seconds, but 960 was provided\n- message retention period must be between 60 and 1,209,600 seconds, but 30 was provided",
  );
});

test("message retention period must be between 1 minute to 14 days", () => {
  // GIVEN
  const stack = getAwsStack();

  // THEN
  expect(
    () =>
      new notify.Queue(stack, "MyQueue", {
        retentionPeriod: Duration.seconds(30),
      }),
  ).toThrow(
    "Queue initialization failed due to the following validation error(s):\n- message retention period must be between 60 and 1,209,600 seconds, but 30 was provided",
  );

  expect(
    () =>
      new notify.Queue(stack, "AnotherQueue", {
        retentionPeriod: Duration.days(15),
      }),
  ).toThrow(
    "Queue initialization failed due to the following validation error(s):\n- message retention period must be between 60 and 1,209,600 seconds, but 1296000 was provided",
  );
});

test("message retention period can be provided as a parameter", () => {
  // GIVEN
  const stack = getAwsStack();
  const parameter = new TerraformVariable(stack, "my-retention-period", {
    type: "number",
    default: 30,
  });

  // WHEN
  new notify.Queue(stack, "MyQueue", {
    retentionPeriod: Duration.seconds(parameter.numberValue),
  });

  // THEN
  Template.fromStack(stack).toMatchObject({
    variable: {
      "my-retention-period": {
        type: "number",
        default: 30,
      },
    },
    resource: {
      [sqsQueue.SqsQueue.tfResourceType]: {
        MyQueue_E6CA6235: {
          message_retention_seconds: "${var.my-retention-period}",
        },
      },
    },
  });
});

test.each([
  { size: 1023, valid: false, description: "just below lower bound" },
  { size: 1024, valid: true, description: "at lower bound" },
  { size: 1048576, valid: true, description: "at upper bound" },
  { size: 1048577, valid: false, description: "just above upper bound" },
])(
  "maxMessageSizeBytes validation for $size bytes ($description)",
  ({ size, valid }) => {
    const stack = getAwsStack();
    const constructId = `QueueWithSize${size}`;
    const action = () =>
      new notify.Queue(stack, constructId, { maxMessageSizeBytes: size });

    if (valid) {
      expect(action).not.toThrow();
    } else {
      expect(action).toThrow(
        `Queue initialization failed due to the following validation error(s):\n- maximum message size must be between 1,024 and 1,048,576 bytes, but ${size} was provided`,
      );
    }
  },
);

test("maxMessageSizeBytes works with CDK tokens", () => {
  const stack = getAwsStack();
  const parameter = new TerraformVariable(stack, "MessageSize", {
    type: "number",
  });

  // Should not throw for tokens (validation skipped)
  expect(
    () =>
      new notify.Queue(stack, "TokenQueue", {
        maxMessageSizeBytes: parameter.numberValue,
      }),
  ).not.toThrow();
});

test("multiple validation errors include maxMessageSizeBytes", () => {
  const stack = getAwsStack();

  expect(
    () =>
      new notify.Queue(stack, "MultiError", {
        maxMessageSizeBytes: 2000000,
        retentionPeriod: Duration.seconds(30),
      }),
  ).toThrow(
    /maximum message size must be between 1,024 and 1,048,576 bytes.*message retention period must be between 60 and 1,209,600 seconds/s,
  );
});

test("maxMessageSizeBytes synthesizes correct CloudFormation", () => {
  const stack = getAwsStack();

  new notify.Queue(stack, "LargeMessageQueue", {
    maxMessageSizeBytes: 1048576,
  });

  const template = Template.synth(stack);
  template.toHaveResourceWithProperties(sqsQueue.SqsQueue, {
    max_message_size: 1048576,
  });
});

test("addToPolicy will automatically create a policy for this queue", () => {
  const stack = getAwsStack();
  const queue = new notify.Queue(stack, "MyQueue", {
    queueName: "TestQueue",
  });
  queue.addToResourcePolicy(
    new iam.PolicyStatement({
      resources: ["*"],
      actions: ["sqs:*"],
      principals: [new iam.ArnPrincipal("arn")],
    }),
  );

  Template.fromStack(stack).toMatchObject({
    data: {
      [dataAwsIamPolicyDocument.DataAwsIamPolicyDocument.tfResourceType]: {
        MyQueue_Policy_B72AE551: {
          statement: [
            {
              actions: ["sqs:*"],
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
      },
    },
    resource: {
      [sqsQueue.SqsQueue.tfResourceType]: {
        MyQueue_E6CA6235: {
          name_prefix: "TestQueueTestStackMyQueue",
        },
      },
      [sqsQueuePolicy.SqsQueuePolicy.tfResourceType]: {
        MyQueue_Policy_6BBEDDAC: {
          policy:
            "${data.aws_iam_policy_document.MyQueue_Policy_B72AE551.json}",
          queue_url: stack.resolve(queue.queueUrl),
        },
      },
    },
  });
});

describe("validateRedriveAllowPolicy", () => {
  test("does not throw for valid policy", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const redriveAllowPolicy = {
      redrivePermission: notify.RedrivePermission.ALLOW_ALL,
    };

    // THEN
    expect(() =>
      notify.validateRedriveAllowPolicy(stack, redriveAllowPolicy),
    ).not.toThrow();
  });

  test("throws when sourceQueues is provided with ALLOW_ALL permission", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const sourceQueue = new notify.Queue(stack, "SourceQueue");
    const redriveAllowPolicy = {
      redrivePermission: notify.RedrivePermission.ALLOW_ALL,
      sourceQueues: [sourceQueue],
    };

    // THEN
    expect(() =>
      notify.validateRedriveAllowPolicy(stack, redriveAllowPolicy),
    ).toThrow(
      "Queue initialization failed due to the following validation error(s):\n- sourceQueues cannot be configured when RedrivePermission is set to 'allowAll' or 'denyAll'",
    );
  });

  test("throws when sourceQueues is not provided with BY_QUEUE permission", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const redriveAllowPolicy = {
      redrivePermission: notify.RedrivePermission.BY_QUEUE,
    };

    // THEN
    expect(() =>
      notify.validateRedriveAllowPolicy(stack, redriveAllowPolicy),
    ).toThrow(
      "Queue initialization failed due to the following validation error(s):\n- At least one source queue must be specified when RedrivePermission is set to 'byQueue'",
    );
  });

  test("throws when more than 10 sourceQueues are provided", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const sourceQueues = Array(11)
      .fill(null)
      .map((_, i) => new notify.Queue(stack, `SourceQueue${i}`));
    const redriveAllowPolicy = {
      redrivePermission: notify.RedrivePermission.BY_QUEUE,
      sourceQueues,
    };

    // THEN
    expect(() =>
      notify.validateRedriveAllowPolicy(stack, redriveAllowPolicy),
    ).toThrow(
      "Queue initialization failed due to the following validation error(s):\n- Up to 10 sourceQueues can be specified. Set RedrivePermission to 'allowAll' to specify more",
    );
  });
});

describe("export and import", () => {
  test("importing works correctly", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const imports = notify.Queue.fromQueueArn(
      stack,
      "Imported",
      "arn:aws:sqs:us-east-1:123456789012:queue1",
    );

    // THEN

    // "import" returns an IQueue bound to `Fn::ImportValue`s.
    expect(stack.resolve(imports.queueArn)).toEqual(
      "arn:aws:sqs:us-east-1:123456789012:queue1",
    );
    expect(stack.resolve(imports.queueUrl)).toEqual(
      "https://sqs.us-east-1.${data.aws_partition.Partitition.dns_suffix}/123456789012/queue1",
    );
    expect(stack.resolve(imports.queueName)).toEqual("queue1");
  });

  test("importing fifo and standard queues are detected correctly", () => {
    const stack = getAwsStack();
    const stdQueue = notify.Queue.fromQueueArn(
      stack,
      "StdQueue",
      "arn:aws:sqs:us-east-1:123456789012:queue1",
    );
    const fifoQueue = notify.Queue.fromQueueArn(
      stack,
      "FifoQueue",
      "arn:aws:sqs:us-east-1:123456789012:queue2.fifo",
    );
    expect(stdQueue.fifo).toEqual(false);
    expect(fifoQueue.fifo).toEqual(true);
  });

  test("import queueArn from token, check attributes", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const stdQueue1 = notify.Queue.fromQueueArn(
      stack,
      "StdQueue",
      Token.asString({ Ref: "ARN" }),
    );

    // THEN
    expect(stack.resolve(stdQueue1.queueArn)).toEqual({
      Ref: "ARN",
    });
    expect(stack.resolve(stdQueue1.queueName)).toEqual(
      '${element(split(":", {"Ref" = "ARN"}), 5)}',
    );
    expect(stack.resolve(stdQueue1.queueUrl)).toEqual(
      'https://sqs.${element(split(":", {"Ref" = "ARN"}), 3)}.${data.aws_partition.Partitition.dns_suffix}/${element(split(":", {"Ref" = "ARN"}), 4)}/${element(split(":", {"Ref" = "ARN"}), 5)}',
    );
    expect(stdQueue1.fifo).toEqual(false);
  });

  test("importing works correctly for cross region queue", () => {
    // GIVEN
    const stack = new AwsStack(Testing.app(), "Stack", {
      environmentName,
      gridUUID,
      gridBackendConfig,
      providerConfig: {
        region: "us-east-1",
      },
    });

    // WHEN
    const imports = notify.Queue.fromQueueArn(
      stack,
      "Imported",
      "arn:aws:sqs:us-west-2:123456789012:queue1",
    );

    // THEN

    // "import" returns an IQueue bound to `Fn::ImportValue`s.
    expect(stack.resolve(imports.queueArn)).toEqual(
      "arn:aws:sqs:us-west-2:123456789012:queue1",
    );
    expect(stack.resolve(imports.queueUrl)).toEqual(
      "https://sqs.us-west-2.${data.aws_partition.Partitition.dns_suffix}/123456789012/queue1",
    );
    expect(stack.resolve(imports.queueName)).toEqual("queue1");
  });

  test("sets account for imported queue env by fromQueueArn", () => {
    const stack = getAwsStack();
    const imported = notify.Queue.fromQueueArn(
      stack,
      "Imported",
      "arn:aws:sqs:us-west-2:999999999999:queue",
    );

    expect(imported.env.account).toEqual("999999999999");
  });

  test("sets region for imported queue env by fromQueueArn", () => {
    const stack = getAwsStack();
    const imported = notify.Queue.fromQueueArn(
      stack,
      "Imported",
      "arn:aws:sqs:us-west-2:123456789012:queue",
    );

    expect(imported.env.region).toEqual("us-west-2");
  });
});

describe("grants", () => {
  test("grantConsumeMessages", () => {
    testGrant(
      (q, p) => q.grantConsumeMessages(p),
      "sqs:ReceiveMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueUrl",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    );
  });

  test("grantSendMessages", () => {
    testGrant(
      (q, p) => q.grantSendMessages(p),
      "sqs:SendMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
    );
  });

  test("grantPurge", () => {
    testGrant(
      (q, p) => q.grantPurge(p),
      "sqs:PurgeQueue",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
    );
  });

  test("grant() is general purpose", () => {
    testGrant(
      (q, p) => q.grant(p, "service:hello", "service:world"),
      "service:hello",
      "service:world",
    );
  });

  test("grants also work on imported queues", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    const queue = notify.Queue.fromQueueArn(
      stack,
      "Import",
      "arn:aws:sqs:us-east-1:123456789012:queue1",
    );

    const user = new iam.User(stack, "User");

    queue.grantPurge(user);

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "sqs:PurgeQueue",
              "sqs:GetQueueAttributes",
              "sqs:GetQueueUrl",
            ],
            effect: "Allow",
            resources: ["arn:aws:sqs:us-east-1:123456789012:queue1"],
          },
        ],
      },
    );
  });
});

describe("queue encryption", () => {
  test("encryptionMasterKey can be set to a custom KMS key", () => {
    const stack = new AwsStack(undefined, "Stack", {});

    const key = new encryption.Key(stack, "CustomKey");
    const queue = new notify.Queue(stack, "Queue", {
      encryptionMasterKey: key,
    });

    expect(queue.encryptionMasterKey).toEqual(key);
    expect(queue.encryptionType).toEqual(notify.QueueEncryption.KMS);
    Template.synth(stack).toHaveResourceWithProperties(sqsQueue.SqsQueue, {
      kms_master_key_id: stack.resolve(key.keyArn),
    });
  });

  test("a kms key will be allocated if encryption = kms but a master key is not specified", () => {
    const stack = new AwsStack(undefined, "Stack", {});

    const queue = new notify.Queue(stack, "Queue", {
      encryption: notify.QueueEncryption.KMS,
    });

    Template.synth(stack).toHaveResourceWithProperties(kmsKey.KmsKey, {
      description: "Created by Stack/Queue",
    });
    Template.synth(stack).toHaveResourceWithProperties(sqsQueue.SqsQueue, {
      kms_master_key_id: stack.resolve(queue.encryptionMasterKey?.keyArn),
    });
    expect(queue.encryptionType).toEqual(notify.QueueEncryption.KMS);
  });

  test("it is possible to use a managed kms key", () => {
    const stack = new AwsStack(undefined, "Stack", {});

    const queue = new notify.Queue(stack, "Queue", {
      encryption: notify.QueueEncryption.KMS_MANAGED,
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        [sqsQueue.SqsQueue.tfResourceType]: {
          Queue_4A7E3555: {
            kms_master_key_id: "alias/aws/sqs",
          },
        },
      },
    });
    expect(queue.encryptionType).toEqual(notify.QueueEncryption.KMS_MANAGED);
  });

  test("grant also affects key on encrypted queue", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {});
    const queue = new notify.Queue(stack, "Queue", {
      encryption: notify.QueueEncryption.KMS,
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("someone"),
    });

    // WHEN
    queue.grantSendMessages(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "sqs:SendMessage",
              "sqs:GetQueueAttributes",
              "sqs:GetQueueUrl",
            ],
            effect: "Allow",
            resources: [stack.resolve(queue.queueArn)],
          },
          {
            actions: [
              "kms:Decrypt",
              "kms:Encrypt",
              "kms:ReEncrypt*",
              "kms:GenerateDataKey*",
            ],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
  });

  test("it is possible to use sqs managed server side encryption", () => {
    const stack = new AwsStack(undefined, "Stack", {});

    const queue = new notify.Queue(stack, "Queue", {
      encryption: notify.QueueEncryption.SQS_MANAGED,
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        [sqsQueue.SqsQueue.tfResourceType]: {
          Queue_4A7E3555: {
            sqs_managed_sse_enabled: true,
          },
        },
      },
    });
    expect(queue.encryptionType).toEqual(notify.QueueEncryption.SQS_MANAGED);
  });

  test("it is possible to disable encryption (unencrypted)", () => {
    const stack = new AwsStack(undefined, "Stack", {});

    const queue = new notify.Queue(stack, "Queue", {
      encryption: notify.QueueEncryption.UNENCRYPTED,
    });
    Template.fromStack(stack).toMatchObject({
      resource: {
        [sqsQueue.SqsQueue.tfResourceType]: {
          Queue_4A7E3555: {
            sqs_managed_sse_enabled: false,
          },
        },
      },
    });
    expect(queue.encryptionType).toEqual(notify.QueueEncryption.UNENCRYPTED);
  });

  test("encryptionMasterKey is not supported if encryption type SQS_MANAGED is used", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {});
    const key = new encryption.Key(stack, "CustomKey");

    // THEN
    expect(
      () =>
        new notify.Queue(stack, "Queue", {
          encryption: notify.QueueEncryption.SQS_MANAGED,
          encryptionMasterKey: key,
        }),
    ).toThrow(
      /'encryptionMasterKey' is not supported if encryption type 'SQS_MANAGED' is used/,
    );
  });

  test("encryptionType is always KMS, when an encryptionMasterKey is provided", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {});
    const key = new encryption.Key(stack, "CustomKey");
    const queue = new notify.Queue(stack, "Queue", {
      encryption: notify.QueueEncryption.KMS_MANAGED,
      encryptionMasterKey: key,
    });

    // THEN
    expect(queue.encryptionType).toBe(notify.QueueEncryption.KMS);
  });
});

describe("encryption in transit", () => {
  test("enforceSSL can be enabled", () => {
    const stack = getAwsStack();
    const queue = new notify.Queue(stack, "Queue", { enforceSSL: true });

    Template.fromStack(stack).toMatchObject({
      data: {
        [dataAwsIamPolicyDocument.DataAwsIamPolicyDocument.tfResourceType]: {
          Queue_Policy_E851DAAC: {
            statement: [
              {
                actions: ["sqs:*"],
                condition: [
                  {
                    test: "Bool",
                    values: ["false"],
                    variable: "aws:SecureTransport",
                  },
                ],
                effect: "Deny",
                principals: [
                  {
                    identifiers: ["*"],
                    type: "AWS",
                  },
                ],
                resources: [stack.resolve(queue.queueArn)],
              },
            ],
          },
        },
      },
      resource: {
        [sqsQueue.SqsQueue.tfResourceType]: {
          Queue_4A7E3555: {
            name_prefix: "123e4567-e89b-12d3-TestStackQueue",
          },
        },
        [sqsQueuePolicy.SqsQueuePolicy.tfResourceType]: {
          Queue_Policy_25439813: {
            policy:
              "${data.aws_iam_policy_document.Queue_Policy_E851DAAC.json}",
            queue_url: stack.resolve(queue.queueUrl),
          },
        },
      },
    });
  });
});

describe("fifo", () => {
  test('test ".fifo" suffixed queues register as fifo', () => {
    const stack = new AwsStack(undefined, "Stack", {});
    const queue = new notify.Queue(stack, "Queue", {
      queueName: "MyQueue.fifo",
    });

    expect(queue.fifo).toEqual(true);

    Template.synth(stack).toHaveResourceWithProperties(sqsQueue.SqsQueue, {
      fifo_queue: true,
      name_prefix: "MyQueueStackQueue",
    });
  });

  test('test a fifo queue is observed when the "fifo" property is specified', () => {
    const stack = new AwsStack(undefined, "Stack", {});
    const queue = new notify.Queue(stack, "Queue", {
      fifo: true,
    });

    expect(queue.fifo).toEqual(true);

    Template.synth(stack).toHaveResourceWithProperties(sqsQueue.SqsQueue, {
      fifo_queue: true,
    });
  });

  test("test a fifo queue is observed when high throughput properties are specified", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    const queue = new notify.Queue(stack, "Queue", {
      fifo: true,
      fifoThroughputLimit: notify.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
      deduplicationScope: notify.DeduplicationScope.MESSAGE_GROUP,
    });

    expect(queue.fifo).toEqual(true);
    Template.synth(stack).toHaveResourceWithProperties(sqsQueue.SqsQueue, {
      deduplication_scope: "messageGroup",
      fifo_queue: true,
      fifo_throughput_limit: "perMessageGroupId",
    });
  });

  test("test a queue throws when fifoThroughputLimit specified on non fifo queue", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    expect(() => {
      new notify.Queue(stack, "Queue", {
        fifo: false,
        fifoThroughputLimit: notify.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
      });
    }).toThrow();
  });

  test("test a queue throws when deduplicationScope specified on non fifo queue", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    expect(() => {
      new notify.Queue(stack, "Queue", {
        fifo: false,
        deduplicationScope: notify.DeduplicationScope.MESSAGE_GROUP,
      });
    }).toThrow();
  });

  test("fifo: false is dropped from properties", () => {
    // GIVEN
    const stack = new AwsStack(undefined, "Stack", {});

    // WHEN
    new notify.Queue(stack, "Queue", {
      fifo: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(sqsQueue.SqsQueue, {
      fifo_queue: false,
    });
  });
});

test("test metrics", () => {
  // GIVEN
  const stack = new AwsStack(undefined, "Stack", {});
  const queue = new notify.Queue(stack, "Queue");

  // THEN
  expect(stack.resolve(queue.metricNumberOfMessagesSent())).toEqual({
    dimensions: { QueueName: "${aws_sqs_queue.Queue_4A7E3555.name}" },
    namespace: "AWS/SQS",
    metricName: "NumberOfMessagesSent",
    period: Duration.minutes(5),
    statistic: "Sum",
  });

  expect(stack.resolve(queue.metricSentMessageSize())).toEqual({
    dimensions: { QueueName: "${aws_sqs_queue.Queue_4A7E3555.name}" },
    namespace: "AWS/SQS",
    metricName: "SentMessageSize",
    period: Duration.minutes(5),
    statistic: "Average",
  });
});

test("fails if queue policy has no actions", () => {
  // GIVEN
  const app = Testing.app();
  const stack = new AwsStack(app, "my-stack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  const queue = new notify.Queue(stack, "Queue");

  // WHEN
  queue.addToResourcePolicy(
    new iam.PolicyStatement({
      resources: ["*"],
      principals: [new iam.ArnPrincipal("arn")],
    }),
  );

  // THEN
  expect(() => app.synth()).toThrow(
    /A PolicyStatement must specify at least one \'action\' or \'notAction\'/,
  );
});

test("fails if queue policy has no IAM principals", () => {
  // GIVEN
  const app = Testing.app();
  const stack = new AwsStack(app, "my-stack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  const queue = new notify.Queue(stack, "Queue");

  // WHEN
  queue.addToResourcePolicy(
    new iam.PolicyStatement({
      resources: ["*"],
      actions: ["sqs:*"],
    }),
  );

  // THEN
  expect(() => app.synth()).toThrow(
    /A PolicyStatement used in a resource-based policy must specify at least one IAM principal/,
  );
});

describe("redriveAllowPolicy", () => {
  test("Default settings for the dead letter source queue permission", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    new notify.Queue(stack, "Queue", {
      redriveAllowPolicy: {},
    });

    Template.synth(stack).toHaveResourceWithProperties(sqsQueue.SqsQueue, {
      redrive_allow_policy: '{"redrivePermission":"allowAll"}',
    });
  });

  test.each([
    [notify.RedrivePermission.ALLOW_ALL, "allowAll"],
    [notify.RedrivePermission.DENY_ALL, "denyAll"],
  ])("redrive permission can be set to %s", (permission, expected) => {
    const stack = new AwsStack(undefined, "Stack", {});
    new notify.Queue(stack, "Queue", {
      redriveAllowPolicy: {
        redrivePermission: permission,
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(sqsQueue.SqsQueue, {
      redrive_allow_policy: JSON.stringify({ redrivePermission: expected }),
    });
  });

  test("explicit specification of dead letter source queues", () => {
    const stack = new AwsStack(Testing.app(), "Stack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const sourceQueue1 = new notify.Queue(stack, "SourceQueue1");
    const sourceQueue2 = new notify.Queue(stack, "SourceQueue2");
    new notify.Queue(stack, "Queue", {
      redriveAllowPolicy: { sourceQueues: [sourceQueue1, sourceQueue2] },
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        [sqsQueue.SqsQueue.tfResourceType]: {
          SourceQueue1_F4BBA4BB: {
            name_prefix: "123e4567-e89b-12d3-StackSourceQueue1",
          },
          SourceQueue2_2481CB5A: {
            name_prefix: "123e4567-e89b-12d3-StackSourceQueue2",
          },
          Queue_4A7E3555: {
            redrive_allow_policy: JSON.stringify({
              redrivePermission: "byQueue",
              sourceQueueArns: [
                stack.resolve(sourceQueue1.queueArn),
                stack.resolve(sourceQueue2.queueArn),
              ],
            }),
          },
        },
      },
    });
  });

  test("throw if sourceQueues is not specified when redrivePermission is byQueue", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    expect(() => {
      new notify.Queue(stack, "Queue", {
        redriveAllowPolicy: {
          redrivePermission: notify.RedrivePermission.BY_QUEUE,
        },
      });
    }).toThrow(
      /At least one source queue must be specified when RedrivePermission is set to 'byQueue'/,
    );
  });

  test("throw if dead letter source queues are specified with allowAll permission", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    const sourceQueue1 = new notify.Queue(stack, "SourceQueue1");
    expect(() => {
      new notify.Queue(stack, "Queue", {
        redriveAllowPolicy: {
          sourceQueues: [sourceQueue1],
          redrivePermission: notify.RedrivePermission.ALLOW_ALL,
        },
      });
    }).toThrow(
      /sourceQueues cannot be configured when RedrivePermission is set to 'allowAll' or 'denyAll'/,
    );
  });

  test("throw if souceQueues length is greater than 10", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    const sourceQueues: notify.IQueue[] = [];
    for (let i = 0; i < 11; i++) {
      sourceQueues.push(new notify.Queue(stack, `SourceQueue${i}`));
    }
    expect(() => {
      new notify.Queue(stack, "Queue", {
        redriveAllowPolicy: {
          sourceQueues,
          redrivePermission: notify.RedrivePermission.BY_QUEUE,
        },
      });
    }).toThrow(
      /Up to 10 sourceQueues can be specified. Set RedrivePermission to 'allowAll' to specify more/,
    );
  });

  test("throw if sourceQueues is blank array when redrivePermission is byQueue", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    expect(() => {
      new notify.Queue(stack, "Queue", {
        redriveAllowPolicy: {
          sourceQueues: [],
          redrivePermission: notify.RedrivePermission.BY_QUEUE,
        },
      });
    }).toThrow(
      /At least one source queue must be specified when RedrivePermission is set to 'byQueue'/,
    );
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}

function testGrant(
  action: (q: notify.Queue, principal: iam.IPrincipal) => void,
  ...expectedActions: string[]
) {
  const stack = new AwsStack(undefined, "Stack", {});
  const queue = new notify.Queue(stack, "MyQueue");
  const principal = new iam.User(stack, "User");

  action(queue, principal);

  Template.synth(stack).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: expectedActions,
          effect: "Allow",
          resources: [stack.resolve(queue.queueArn)],
        },
      ],
    },
  );
}
