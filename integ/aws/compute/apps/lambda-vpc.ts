// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/@aws-cdk-testing/framework-integ/test/aws-lambda/test/integ.vpc-lambda.ts

import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "lambda-vpc";

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
const vpc = new aws.compute.Vpc(stack, "VPC", {
  maxAzs: 2,
  // terraconstructs by default uses recommended setting
  // @aws-cdk/aws-ec2:restrictDefaultSecurityGroup: true
  // restrictDefaultSecurityGroup: false,
});

new aws.compute.LambdaFunction(stack, "MyLambda", {
  code: new aws.compute.InlineCode("def main(event, context): pass"),
  handler: "index.main",
  runtime: aws.compute.Runtime.PYTHON_3_9,
  vpc,
  outputName: "my_lambda",
  registerOutputs: true,
});

// TODO: use TerraConstruct e2e s3 backend?
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
app.synth();
