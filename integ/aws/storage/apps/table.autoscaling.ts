// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-dynamodb/test/integ.autoscaling.lit.ts

import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "bucket-notifications";

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

const table = new aws.storage.Table(stack, "Table", {
  partitionKey: { name: "hashKey", type: aws.storage.AttributeType.STRING },
  //    TODO: add support for removalPolicy
  //    removalPolicy: aws.cdk.RemovalPolicy.DESTROY,
});

const readScaling = table.autoScaleReadCapacity({
  minCapacity: 1,
  maxCapacity: 10,
});

readScaling.scaleOnUtilization({
  targetUtilizationPercent: 30,
});

readScaling.scaleOnSchedule("ScaleUpInTheMorning", {
  schedule: aws.compute.Schedule.cron({ hour: "8", minute: "0" }),
  minCapacity: 5,
});

readScaling.scaleOnSchedule("ScaleDownAtNight", {
  schedule: aws.compute.Schedule.cron({ hour: "20", minute: "0" }),
  maxCapacity: 3,
});

// TODO: Add registerOutputs functionality to Table constructs to avoid manual TerraformOutput creation
new TerraformOutput(stack, "TableName", {
  value: table.tableName,
  staticId: true,
});

new TerraformOutput(stack, "TableArn", {
  value: table.tableArn,
  staticId: true,
});

app.synth();
