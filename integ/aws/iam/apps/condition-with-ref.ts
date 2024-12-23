// ref: https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-iam/test/integ.condition-with-ref.ts
import { App, LocalBackend, Lazy, TerraformVariable } from "cdktf";
// when bun run fails on        /src   <<< use /lib
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "condition-with-ref";

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

const tagName = new TerraformVariable(stack, "PrincipalTag", {
  default: "developer",
});

const principal = new aws.iam.AccountRootPrincipal().withConditions({
  test: "StringEquals",
  variable: Lazy.stringValue({
    produce: () => `aws:PrincipalTag/${tagName.value}`,
  }),
  values: ["true"],
});

new aws.iam.Role(stack, "MyRole", {
  assumedBy: principal,
  registerOutputs: true,
});

app.synth();
