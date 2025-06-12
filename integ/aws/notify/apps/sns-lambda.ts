// https://github.com/aws/aws-cdk/blob/v2.176.0/packages/%40aws-cdk-testing/framework-integ/test/aws-sns-subscriptions/test/integ.sns-aws.compute.ts

import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sns-lambda";

// import { STANDARD_NODEJS_RUNTIME } from "../../config";

class SnsToLambda extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const handlerPath = path.join(
      __dirname,
      "handlers",
      "log-event",
      "index.ts",
    );

    const topic = new aws.notify.Topic(this, "MyTopic");

    const func = new aws.compute.NodejsFunction(this, "Echo", {
      runtime: "nodejs20.x",
      path: handlerPath,
      //   handler: "index.handler",
      //   runtime: STANDARD_NODEJS_RUNTIME,
      //   code: aws.compute.Code.fromInline(`exports.handler = ${handler.toString()}`),
    });

    topic.addSubscription(
      new aws.notify.subscriptions.LambdaSubscription(func, {
        deadLetterQueue: new aws.notify.Queue(this, "DeadLetterQueue"),
      }),
    );

    const funcFiltered = new aws.compute.NodejsFunction(this, "Filtered", {
      runtime: "nodejs20.x",
      path: handlerPath,
      //   handler: "index.handler",
      //   runtime: STANDARD_NODEJS_RUNTIME,
      //   code: aws.compute.Code.fromInline(
      //     `exports.handler = ${handler.toString()}`,
      //   ),
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

    const funcFilteredWithMessageBody = new aws.compute.NodejsFunction(
      this,
      "FilteredMessageBody",
      {
        runtime: "nodejs20.x",
        path: handlerPath,
        // handler: "index.handler",
        // runtime: STANDARD_NODEJS_RUNTIME,
        // code: aws.compute.Code.fromInline(
        //   `exports.handler = ${handler.toString()}`,
        // ),
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

// TODO: Support compute.Code.Inline
// function handler(event: any, _context: any, callback: any) {
//   /* eslint-disable no-console */
//   console.log('====================================================');
//   console.log(JSON.stringify(event, undefined, 2));
//   console.log('====================================================');
//   return callback(undefined, event);
// }
