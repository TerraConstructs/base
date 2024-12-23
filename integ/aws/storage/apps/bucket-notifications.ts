// https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-s3/test/integ.bucket.notifications.ts
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
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_notification#emit-events-to-eventbridge
new aws.storage.Bucket(stack, "MyEventBridgeBucket", {
  forceDestroy: true,
  eventBridgeEnabled: true,
  enforceSSL: true, // Adding dummy bucket policy for testing that bucket policy is created before bucket notification
  registerOutputs: true,
  outputName: "bucket",
});

app.synth();
