// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/aws-sdk/integ.call-aws-service-efs.ts
import { efsFileSystem, efsAccessPoint } from "@cdktf/provider-aws";
import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "call-aws-service-efs";

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

const fs = new efsFileSystem.EfsFileSystem(stack, "EfsFileSystem", {
  creationToken: `${stackName}-test-efs`,
});
const efs = new efsAccessPoint.EfsAccessPoint(stack, "EfsAccessPoint", {
  fileSystemId: fs.id,
});
new TerraformOutput(stack, "efs_accesspoint_arn", {
  value: efs.arn,
  staticId: true,
});

// this is edge case with sfn and service names
// https://github.com/aws/aws-cdk/pull/30896
const task = new aws.compute.tasks.CallAwsService(stack, "TagEfsAccessPoint", {
  service: "efs",
  action: "tagResource",
  iamResources: ["*"],
  // without servicemapping fix workaround:
  // iamAction: 'elasticfilesystem:TagResource',
  parameters: {
    ResourceId: aws.compute.JsonPath.stringAt("$.pathToArn"),
    Tags: [
      {
        Key: "MYTAGNAME",
        Value: aws.compute.JsonPath.stringAt("$.pathToId"),
      },
    ],
  },
  resultPath: aws.compute.JsonPath.DISCARD,
});

new aws.compute.StateMachine(stack, "StateMachine", {
  definitionBody: aws.compute.DefinitionBody.fromChainable(task),
  registerOutputs: true,
  outputName: "state_machine",
});

app.synth();
