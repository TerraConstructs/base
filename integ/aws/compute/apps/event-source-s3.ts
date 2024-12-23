// https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-lambda-event-sources/test/integ.s3.ts
import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "event-source-s3";

class S3EventSourceTest extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const fn = new aws.compute.NodejsFunction(this, "F", {
      path: path.join(__dirname, "handlers", "log-event", "index.ts"),
      loggingFormat: aws.compute.LoggingFormat.JSON,
      registerOutputs: true,
      outputName: "function",
    });
    const bucket = new aws.storage.Bucket(this, "B", {
      forceDestroy: true,
      registerOutputs: true,
      outputName: "bucket",
    });

    fn.addEventSource(
      new aws.compute.sources.S3EventSource(bucket, {
        events: [aws.storage.EventType.OBJECT_CREATED],
        filters: [{ prefix: "subdir/" }],
      }),
    );
  }
}

const app = new App({
  outdir,
});

const stack = new S3EventSourceTest(app, stackName, {
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
