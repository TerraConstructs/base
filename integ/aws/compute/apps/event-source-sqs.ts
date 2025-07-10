// https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-lambda-event-sources/test/integ.sqs.ts
import { App, LocalBackend, TerraformOutput } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

/**
 * The standard nodejs runtime used for integration tests.
 * Use this, unless specifically testing a certain runtime.
 *
 * The runtime should be the lowest runtime currently supported by the AWS CDK.
 * Updating this value will require you to run a lot of integration tests.
 */
export const STANDARD_NODEJS_RUNTIME = aws.compute.Runtime.NODEJS_18_X;

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "event-source-sqs";

class SqsEventSourceTest extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const fn = new aws.compute.LambdaFunction(this, "F", {
      // path: path.join(__dirname, "handlers", "log-event", "index.ts"),
      handler: "index.handler",
      code: aws.compute.Code.fromInline(
        `exports.handler = ${handler.toString()}`,
      ),
      runtime: STANDARD_NODEJS_RUNTIME,
      loggingFormat: aws.compute.LoggingFormat.JSON,
      registerOutputs: true,
      outputName: "function",
    });
    const queue = new aws.notify.Queue(this, "Q", {
      registerOutputs: true,
      outputName: "queue",
    });
    const eventSource = new aws.compute.sources.SqsEventSource(queue, {
      batchSize: 5,
    });

    fn.addEventSource(eventSource);

    new TerraformOutput(this, "OutputEventSourceMappingArn", {
      value: eventSource.eventSourceMappingArn,
      staticId: true,
    });
  }
}

const app = new App({
  outdir,
});

const stack = new SqsEventSourceTest(app, stackName, {
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

/* eslint-disable no-console */
async function handler(event: any) {
  console.log("event:", JSON.stringify(event, undefined, 2));
  return { event };
}
