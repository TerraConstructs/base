// https://github.com/aws/aws-cdk/blob/a2c633f1e698249496f11338312ab42bd7b1e4f0/packages/@aws-cdk-testing/framework-integ/test/aws-kinesis/test/integ.stream.ts

import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "stream";

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

const role = new aws.iam.Role(stack, "UserRole", {
  assumedBy: new aws.iam.AccountRootPrincipal(),
  registerOutputs: true,
  outputName: "role",
});

const stream = new aws.notify.Stream(stack, "myStream", {
  registerOutputs: true,
  outputName: "stream",
});

stream.grantReadWrite(role);

app.synth();
