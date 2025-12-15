// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/@aws-cdk-testing/framework-integ/test/aws-lambda/test/integ.runtime.inlinecode.ts

import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "lambda-runtime.inlinecode";

// This integration test is used to verify that the ones marked in the CDK are in fact
// supported by the terraform-provider-aws.
// aws-sdk-go-v2 does client side validation of runtime strings:
// https://github.com/aws/aws-sdk-go-v2/blob/service/lambda/v1.87.0/service/lambda/types/enums.go#L804
//
// The terratest validation treats every terraform output as a lambda function to invoke

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "12345678-222",
  environmentName,
  providerConfig: {
    region,
  },
});

const python38 = new aws.compute.LambdaFunction(stack, "PYTHON_3_8", {
  code: new aws.compute.InlineCode(
    'def handler(event, context):\n  return "success"',
  ),
  handler: "index.handler",
  runtime: aws.compute.Runtime.PYTHON_3_8,
});
new TerraformOutput(stack, "PYTHON_3_8-functionName", {
  value: python38.functionName,
});

const python39 = new aws.compute.LambdaFunction(stack, "PYTHON_3_9", {
  code: new aws.compute.InlineCode(
    'def handler(event, context):\n  return "success"',
  ),
  handler: "index.handler",
  runtime: aws.compute.Runtime.PYTHON_3_9,
});
new TerraformOutput(stack, "PYTHON_3_9-functionName", {
  value: python39.functionName,
});

const python310 = new aws.compute.LambdaFunction(stack, "PYTHON_3_10", {
  code: new aws.compute.InlineCode(
    'def handler(event, context):\n  return "success"',
  ),
  handler: "index.handler",
  runtime: aws.compute.Runtime.PYTHON_3_10,
});
new TerraformOutput(stack, "PYTHON_3_10-functionName", {
  value: python310.functionName,
});

const python312 = new aws.compute.LambdaFunction(stack, "PYTHON_3_12", {
  code: new aws.compute.InlineCode(
    'def handler(event, context):\n  return "success"',
  ),
  handler: "index.handler",
  runtime: aws.compute.Runtime.PYTHON_3_12,
});
new TerraformOutput(stack, "PYTHON_3_12-functionName", {
  value: python312.functionName,
});

const python313 = new aws.compute.LambdaFunction(stack, "PYTHON_3_13", {
  code: new aws.compute.InlineCode(
    'def handler(event, context):\n  return "success"',
  ),
  handler: "index.handler",
  runtime: aws.compute.Runtime.PYTHON_3_13,
});
new TerraformOutput(stack, "PYTHON_3_13-functionName", {
  value: python313.functionName,
});

const python314 = new aws.compute.LambdaFunction(stack, "PYTHON_3_14", {
  code: new aws.compute.InlineCode(
    'def handler(event, context):\n  return "success"',
  ),
  handler: "index.handler",
  runtime: aws.compute.Runtime.PYTHON_3_14,
});
new TerraformOutput(stack, "PYTHON_3_14-functionName", {
  value: python314.functionName,
});

const node20xfn = new aws.compute.LambdaFunction(stack, "NODEJS_20_X", {
  code: new aws.compute.InlineCode(
    'exports.handler = async function(event) { return "success" }',
  ),
  handler: "index.handler",
  runtime: aws.compute.Runtime.NODEJS_20_X,
});
new TerraformOutput(stack, "NODEJS_20_X-functionName", {
  value: node20xfn.functionName,
});

const node22xfn = new aws.compute.LambdaFunction(stack, "NODEJS_22_X", {
  code: new aws.compute.InlineCode(
    'exports.handler = async function(event) { return "success" }',
  ),
  handler: "index.handler",
  runtime: aws.compute.Runtime.NODEJS_22_X,
});
new TerraformOutput(stack, "NODEJS_22_X-functionName", {
  value: node22xfn.functionName,
});

const node24xfn = new aws.compute.LambdaFunction(stack, "NODEJS_24_X", {
  code: new aws.compute.InlineCode(
    'exports.handler = async function(event) { return "success" }',
  ),
  handler: "index.handler",
  runtime: aws.compute.Runtime.NODEJS_24_X,
});
new TerraformOutput(stack, "NODEJS_24_X-functionName", {
  value: node24xfn.functionName,
});

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
app.synth();
