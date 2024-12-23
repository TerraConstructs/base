// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/aws-sdk/integ.call-aws-service-mediapackagevod.ts
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "call-aws-service-mediapackagevod";

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
// this is edge case with sfn and service names
// https://github.com/aws/aws-cdk/pull/28775
const task = new aws.compute.tasks.CallAwsService(
  stack,
  "ListMediaPackageVoDPackagingGroups",
  {
    service: "mediapackagevod",
    action: "listPackagingGroups",
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
