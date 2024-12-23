// https://github.com/aws/aws-cdk/blob/18fbd6d5a1a3069b0fc1356d87e534a75239e668/packages/@aws-cdk-testing/framework-integ/test/aws-kinesis/test/integ.resource-policy.ts

import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "stream-resource-policy";

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

const stream = new aws.notify.Stream(stack, "MyStream", {
  registerOutputs: true,
  outputName: "stream",
});

stream.addToResourcePolicy(
  new aws.iam.PolicyStatement({
    resources: [stream.streamArn],
    actions: ["kinesis:DescribeStreamSummary", "kinesis:GetRecords"],
    principals: [new aws.iam.AccountPrincipal(stack.account)],
  }),
);

app.synth();
