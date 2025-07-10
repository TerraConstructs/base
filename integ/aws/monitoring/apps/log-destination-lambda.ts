// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-logs-destinations/test/integ.lambda.ts

import * as path from "node:path";
import { App, LocalBackend } from "cdktf";
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
const stackName = process.env.STACK_NAME ?? "log-destination-lambda";

class LambdaStack extends aws.AwsStack {
  public readonly queue: aws.notify.Queue;

  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    // const handlerPath = path.join(
    //   __dirname,
    //   "handlers",
    //   "my-function",
    //   "index.ts",
    // );
    this.queue = new aws.notify.Queue(this, "Queue", {
      registerOutputs: true,
      outputName: "queue",
    });

    const fn = new aws.compute.LambdaFunction(this, "MyFunction", {
      runtime: STANDARD_NODEJS_RUNTIME,
      handler: "index.handler",
      code: aws.compute.Code.fromInline(`exports.handler = async (event) => {
        return 'success';
      };`),
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
