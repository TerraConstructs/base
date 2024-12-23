// https://github.com/aws/aws-cdk/blob/81cde0e2e1f83f80273d14724d5518cc20dc5a80/packages/@aws-cdk-testing/framework-integ/test/aws-logs/test/integ.log-group-metrics.ts

import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "log-group-metrics";

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
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const logGroup = new aws.cloudwatch.LogGroup(stack, "MyLogGroup", {
  logGroupName: "my-log-group",
});

const alarm1 = logGroup
  .metricIncomingBytes()
  .createAlarm(stack, "IncomingBytesPerInstanceAlarm", {
    threshold: 1,
    evaluationPeriods: 1,
  });

const alarm2 = logGroup
  .metricIncomingLogEvents()
  .createAlarm(stack, "IncomingEventsPerInstanceAlarm", {
    threshold: 1,
    evaluationPeriods: 1,
  });

// HACK: This is a workaround for createAlarmOptions missing AwsConstructProps (registerOutputs)
new TerraformOutput(stack, "alarm1", {
  value: alarm1.alarmOutputs,
  staticId: true,
});
new TerraformOutput(stack, "alarm2", {
  value: alarm2.alarmOutputs,
  staticId: true,
});
app.synth();
