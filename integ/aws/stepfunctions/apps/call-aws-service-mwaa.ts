// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/aws-sdk/integ.call-aws-service-mwaa.ts
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "call-aws-service-mwaa";

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

const task = new aws.compute.tasks.CallAwsService(
  stack,
  "ListMWAAEnvironments",
  {
    service: "mwaa",
    action: "listEnvironments",
    resultPath: aws.compute.JsonPath.DISCARD,
    iamResources: ["*"],
  },
);

new aws.compute.StateMachine(stack, "StateMachine", {
  definitionBody: aws.compute.DefinitionBody.fromChainable(task),
  registerOutputs: true,
  outputName: "state_machine",
});

app.synth();
