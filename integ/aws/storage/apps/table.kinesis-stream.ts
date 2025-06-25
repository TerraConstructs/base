// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-aws.storage/test/integ.dynamodb.kinesis-stream.ts

import { App, LocalBackend } from "cdktf";
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

const stream = new aws.notify.Stream(stack, "Stream");

new aws.storage.Table(stack, "Table", {
  partitionKey: { name: "hashKey", type: aws.storage.AttributeType.STRING },
  // TODO add support for removalPolicy
  // removalPolicy: cdk.RemovalPolicy.DESTROY,
  kinesisStream: stream,
  kinesisPrecisionTimestamp:
    aws.storage.ApproximateCreationDateTimePrecision.MILLISECOND,
});

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

app.synth();
