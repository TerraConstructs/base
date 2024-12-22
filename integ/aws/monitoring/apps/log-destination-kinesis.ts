// https://github.com/aws/aws-cdk/blob/dc4bbec03741eea5bb5b69caa22dbaf18f727262/packages/@aws-cdk-testing/framework-integ/test/aws-logs-destinations/test/integ.kinesis.ts

import { App, LocalBackend } from "cdktf";
import * as constructs from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "log-destination-kinesis";

class KinesisEnv extends aws.AwsSpec {
  constructor(
    scope: constructs.Construct,
    id: string,
    props: aws.AwsSpecProps,
  ) {
    super(scope, id, props);

    const stream = new aws.notify.Stream(this, "MyStream", {
      registerOutputs: true,
      outputName: "stream",
    });
    const logGroup = new aws.cloudwatch.LogGroup(this, "LogGroup");
    const kinesisDestination =
      new aws.cloudwatch.destinations.KinesisDestination(stream);

    new aws.cloudwatch.SubscriptionFilter(this, "Subscription", {
      logGroup: logGroup,
      destination: kinesisDestination,
      filterPattern: aws.cloudwatch.FilterPattern.allEvents(),
    });
  }
}

const app = new App({
  outdir,
});
const stack = new KinesisEnv(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// If the proper dependency is not set, then the deployment fails with:
// Resource handler returned message: "Could not deliver test message to specified
// Kinesis stream. Check if the given kinesis stream is in ACTIVE state.
// (Service: CloudWatchLogs, Status Code: 400, Request ID: [...])"

app.synth();
