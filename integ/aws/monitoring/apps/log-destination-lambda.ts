// https://github.com/aws/aws-cdk/blob/dc4bbec03741eea5bb5b69caa22dbaf18f727262/packages/%40aws-cdk-testing/framework-integ/test/aws-logs-destinations/test/integ.lambda.ts

import * as path from "node:path";
import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "log-destination-lambda";

class LambdaStack extends aws.AwsStack {
  public readonly queue: aws.notify.Queue;

  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const handlerPath = path.join(
      __dirname,
      "handlers",
      "my-function",
      "index.ts",
    );
    this.queue = new aws.notify.Queue(this, "Queue", {
      registerOutputs: true,
      outputName: "queue",
    });

    const fn = new aws.compute.NodejsFunction(this, "MyFunction", {
      path: handlerPath,
      onSuccess: new aws.compute.destinations.SqsDestination(this.queue),
    });

    const logGroup = new aws.cloudwatch.LogGroup(this, "LogGroup");
    const lambdaDestination = new aws.cloudwatch.destinations.LambdaDestination(
      fn,
    );

    new aws.cloudwatch.SubscriptionFilter(this, "Subscription", {
      logGroup: logGroup,
      destination: lambdaDestination,
      filterPattern: aws.cloudwatch.FilterPattern.allEvents(),
    });

    const customRule = new aws.notify.Rule(this, "CustomRule", {
      eventPattern: {
        source: ["cdk-lambda-integ"],
        detailType: ["cdk-integ-custom-rule"],
      },
    });
    customRule.addTarget(
      new aws.notify.targets.CloudWatchLogGroup(logGroup, {
        logEvent: aws.notify.targets.LogGroupTargetInput.fromObject({
          message: "Howdy Ho!",
        }),
      }),
    );
  }
}

const app = new App({
  outdir,
});
const stack = new LambdaStack(app, stackName, {
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
