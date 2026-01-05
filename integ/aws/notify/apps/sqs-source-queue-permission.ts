// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/@aws-cdk-testing/framework-integ/test/aws-sqs/test/integ.sqs-source-queue-permission.ts
import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sqs-source-queue-permission";

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

const sourceQueue1 = new aws.notify.Queue(stack, "SourceQueue1", {
  redriveAllowPolicy: {
    redrivePermission: aws.notify.RedrivePermission.ALLOW_ALL,
  },
});
const sourceQueue2 = new aws.notify.Queue(stack, "SourceQueue2", {
  redriveAllowPolicy: {
    redrivePermission: aws.notify.RedrivePermission.DENY_ALL,
  },
});

const deadLetterQueue = new aws.notify.Queue(stack, "DeadLetterQueue", {
  redriveAllowPolicy: {
    sourceQueues: [sourceQueue1, sourceQueue2],
    redrivePermission: aws.notify.RedrivePermission.BY_QUEUE,
  },
});

new TerraformOutput(stack, "SourceQueue1Url", { value: sourceQueue1.queueUrl });
new TerraformOutput(stack, "SourceQueue1Arn", { value: sourceQueue1.queueArn });
new TerraformOutput(stack, "SourceQueue2Url", { value: sourceQueue2.queueUrl });
new TerraformOutput(stack, "SourceQueue2Arn", { value: sourceQueue2.queueArn });
new TerraformOutput(stack, "DeadLetterQueueUrl", {
  value: deadLetterQueue.queueUrl,
});
new TerraformOutput(stack, "DeadLetterQueueArn", {
  value: deadLetterQueue.queueArn,
});

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
app.synth();
