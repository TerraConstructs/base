// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/@aws-cdk-testing/framework-integ/test/aws-kms/test/integ.key.ts

import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "key";

const app = new App({
  outdir,
});

const stack = new aws.AwsSpec(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const key = new aws.encryption.Key(stack, "MyKey", {
  registerOutputs: true,
  outputName: "key",
});

key.addToResourcePolicy(
  new aws.iam.PolicyStatement({
    resources: ["*"],
    actions: ["kms:encrypt"],
    principals: [new aws.iam.ArnPrincipal(stack.account)],
  }),
);

const alias = key.addAlias("alias/bar");
// TODO: Add "registerOutputs" option to addAlias method?
new TerraformOutput(stack, "alias", {
  value: alias.aliasOutputs,
  staticId: true,
});

new aws.encryption.Key(stack, "AsymmetricKey", {
  keySpec: aws.encryption.KeySpec.ECC_NIST_P256,
  keyUsage: aws.encryption.KeyUsage.SIGN_VERIFY,
  registerOutputs: true,
  outputName: "asymmetric_key",
});

app.synth();
