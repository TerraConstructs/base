// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/@aws-cdk-testing/framework-integ/test/aws-sqs/test/integ.sqs.ts

import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sqs";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});

const dlq = new aws.notify.Queue(stack, "DeadLetterQueue");
const queue = new aws.notify.Queue(stack, "Queue", {
  deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
  encryption: aws.notify.QueueEncryption.KMS_MANAGED,
});
const fifo = new aws.notify.Queue(stack, "FifoQueue", {
  fifo: true,
  encryptionMasterKey: new aws.encryption.Key(stack, "EncryptionKey", {
    // removalPolicy: RemovalPolicy.DESTROY,
  }),
});
const highThroughputFifo = new aws.notify.Queue(
  stack,
  "HighThroughputFifoQueue",
  {
    fifo: true,
    fifoThroughputLimit: aws.notify.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
    deduplicationScope: aws.notify.DeduplicationScope.MESSAGE_GROUP,
  },
);
const sqsManagedEncryptedQueue = new aws.notify.Queue(
  stack,
  "SqsManagedEncryptedQueue",
  {
    encryption: aws.notify.QueueEncryption.SQS_MANAGED,
  },
);
const unencryptedQueue = new aws.notify.Queue(stack, "UnencryptedQueue", {
  encryption: aws.notify.QueueEncryption.UNENCRYPTED,
});
const ssl = new aws.notify.Queue(stack, "SSLQueue", { enforceSSL: true });

const role = new aws.iam.Role(stack, "Role", {
  assumedBy: new aws.iam.AccountRootPrincipal(),
});

dlq.grantConsumeMessages(role);
queue.grantConsumeMessages(role);
fifo.grantConsumeMessages(role);
highThroughputFifo.grantConsumeMessages(role);
sqsManagedEncryptedQueue.grantConsumeMessages(role);
unencryptedQueue.grantConsumeMessages(role);
ssl.grantConsumeMessages(role);

new TerraformOutput(stack, "QueueUrl", { value: queue.queueUrl });
new TerraformOutput(stack, "DlqUrl", { value: dlq.queueUrl });
new TerraformOutput(stack, "FifoUrl", { value: fifo.queueUrl });
new TerraformOutput(stack, "HighThroughputFifoUrl", {
  value: highThroughputFifo.queueUrl,
});
new TerraformOutput(stack, "SqsManagedUrl", {
  value: sqsManagedEncryptedQueue.queueUrl,
});
new TerraformOutput(stack, "UnencryptedUrl", {
  value: unencryptedQueue.queueUrl,
});
new TerraformOutput(stack, "SslUrl", { value: ssl.queueUrl });
new TerraformOutput(stack, "RoleArn", { value: role.roleArn });

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
app.synth();
