// http://github.com/aws/aws-cdk/blob/v2.176.0/packages/%40aws-cdk-testing/framework-integ/test/aws-sns-subscriptions/test/integ.sns-lambda.ts

import { App, LocalBackend } from "cdktf";
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
const stackName = process.env.STACK_NAME ?? "sns-lambda";

class SnsToLambda extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const topic = new aws.notify.Topic(this, "MyTopic", {
      registerOutputs: true,
      outputName: "my_topic",
    });
    const func = new aws.compute.LambdaFunction(this, "Echo", {
      registerOutputs: true,
      outputName: "echo_function",
      handler: "index.handler",
      runtime: STANDARD_NODEJS_RUNTIME,
      code: aws.compute.Code.fromInline(
        `exports.handler = ${handler.toString()}`,
      ),
    });

    topic.addSubscription(
      new aws.notify.subscriptions.LambdaSubscription(func, {
        deadLetterQueue: new aws.notify.Queue(this, "DeadLetterQueue"),
      }),
    );

    const funcFiltered = new aws.compute.LambdaFunction(this, "Filtered", {
      registerOutputs: true,
      outputName: "filtered_function",
      handler: "index.handler",
      runtime: STANDARD_NODEJS_RUNTIME,
      code: aws.compute.Code.fromInline(
        `exports.handler = ${handler.toString()}`,
      ),
    });

    topic.addSubscription(
      new aws.notify.subscriptions.LambdaSubscription(funcFiltered, {
        filterPolicy: {
          color: aws.notify.SubscriptionFilter.stringFilter({
            allowlist: ["red"],
            matchPrefixes: ["bl", "ye"],
            matchSuffixes: ["ue", "ow"],
          }),
          size: aws.notify.SubscriptionFilter.stringFilter({
            denylist: ["small", "medium"],
          }),
          price: aws.notify.SubscriptionFilter.numericFilter({
            between: { start: 100, stop: 200 },
          }),
        },
      }),
    );

    const funcFilteredWithMessageBody = new aws.compute.LambdaFunction(
      this,
      "FilteredMessageBody",
      {
        handler: "index.handler",
        runtime: STANDARD_NODEJS_RUNTIME,
        code: aws.compute.Code.fromInline(
          `exports.handler = ${handler.toString()}`,
        ),
        registerOutputs: true,
        outputName: "filtered_message_body_function",
      },
    );

    topic.addSubscription(
      new aws.notify.subscriptions.LambdaSubscription(
        funcFilteredWithMessageBody,
        {
          filterPolicyWithMessageBody: {
            background: aws.notify.FilterOrPolicy.policy({
              color: aws.notify.FilterOrPolicy.filter(
                aws.notify.SubscriptionFilter.stringFilter({
                  allowlist: ["red"],
                  matchPrefixes: ["bl", "ye"],
                  matchSuffixes: ["ue", "ow"],
                }),
              ),
            }),
          },
        },
      ),
    );
  }
}

const app = new App({
  outdir,
});
const stack = new SnsToLambda(app, stackName, {
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

function handler(event: any, _context: any, callback: any) {
  /* eslint-disable no-console */
  console.log("====================================================");
  console.log(JSON.stringify(event, undefined, 2));
  console.log("====================================================");
  return callback(undefined, event);
}
