import { App, LocalBackend } from "cdktf";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "dlq-queue";

// force high chance of failure
const maxReceiveCount = parseInt(process.env.MAX_RECEIVE_COUNT ?? "1");
const visibilityTimeout = Duration.seconds(parseInt(
  process.env.VISIBILITY_TIMEOUT_SECONDS ?? "5",
));
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
// TODO: use TerraConstruct e2e s3 backend?
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
const retentionPeriod = Duration.days(14);

const dlq = new aws.notify.Queue(stack, "DLQ", {
  queueName: "dlq",
  retentionPeriod,
  visibilityTimeout,
  registerOutputs: true,
  outputName: "dlq_queue",
});
new aws.notify.Queue(stack, "Queue", {
  queueName: "source",
  deadLetterQueue: {
    maxReceiveCount,
    queue: dlq,
  },
  retentionPeriod,
  visibilityTimeout,
  registerOutputs: true,
  outputName: "queue",
});

app.synth();
