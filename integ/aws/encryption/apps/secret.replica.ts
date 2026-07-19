// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-secretsmanager/test/integ.replica.ts

import { App, LocalBackend } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "secret.replica";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const secret = new aws.encryption.Secret(stack, "Secret", {
  registerOutputs: true,
  outputName: "secret",
});
secret.addReplicaRegion("eu-central-1");

app.synth();
