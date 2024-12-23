// ref: https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-iam/test/integ.composite-principal.ts
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "composite-principal";

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

new aws.iam.Role(stack, "RoleWithCompositePrincipal", {
  assumedBy: new aws.iam.CompositePrincipal(
    new aws.iam.ServicePrincipal("ec2"),
    new aws.iam.AnyPrincipal(),
  ),
  registerOutputs: true,
});

app.synth();
