import { App, LocalBackend } from "cdktf";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "fifo-queue";

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

new aws.notify.Queue(stack, "Queue", {
  namePrefix: "queue.fifo",
  messageRetentionSeconds: Duration.days(14).toSeconds(),
  visibilityTimeoutSeconds: Duration.minutes(15).toSeconds(),
  outputName: "fifo_queue",
  registerOutputs: true,
});

app.synth();
