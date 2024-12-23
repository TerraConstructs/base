// https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-lambda-event-sources/test/integ.sqs-with-filter-criteria.ts
import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "event-source-sqs-filtered";

class SqsEventSourceTest extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const fn = new aws.compute.NodejsFunction(this, "F", {
      path: path.join(__dirname, "handlers", "log-event", "index.ts"),
      loggingFormat: aws.compute.LoggingFormat.JSON,
      registerOutputs: true,
      outputName: "function",
    });
    const queue = new aws.notify.Queue(this, "Q", {
      registerOutputs: true,
      outputName: "queue",
    });

    fn.addEventSource(
      new aws.compute.sources.SqsEventSource(queue, {
        batchSize: 5,
        filters: [
          // ref: https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html
          aws.compute.FilterCriteria.filter({
            body: {
              id: aws.compute.FilterRule.exists(),
            },
          }),
        ],
      }),
    );
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
