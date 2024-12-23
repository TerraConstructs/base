// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/@aws-cdk-testing/framework-integ/test/aws-kms/test/integ.key-alias.ts

import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "key-alias";

class TestStack extends aws.AwsStack {
  constructor(scope: App, props: aws.AwsStackProps) {
    super(scope, stackName, props);
    const aliasedKey = new aws.encryption.Key(this, "MyKey", {
      alias: `MyKey${this.account}`,
      // TODO: Find a way to register Alias outputs...
      // registerOutputs: true,
      // outputName: "key",
    });

    // HACK: This is a workaround to get the Alias object from the Key object
    const alias = aliasedKey.node.findChild("Alias") as aws.encryption.Alias;
    new TerraformOutput(this, "alias", {
      value: alias.aliasOutputs,
      staticId: true,
    });
  }
}

const app = new App({
  outdir,
});

const stack = new TestStack(app, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
app.synth();
