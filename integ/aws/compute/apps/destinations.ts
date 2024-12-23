// ref: https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-lambda-destinations/test/integ.destinations.ts
import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws, Duration } from "../../../../src";

/*
 * Stack verification steps:
 * * aws lambda invoke --function-name <deployed fn name> --invocation-type Event --payload '"OK"' response.json
 * * aws lambda invoke --function-name <deployed fn name> --invocation-type Event --payload '"NOT OK"' response.json
 */

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "destinations";

class SampleStack extends aws.AwsStack {
  public readonly fn: aws.compute.LambdaFunction;
  public readonly queue: aws.notify.Queue;
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    // const topic = new sns.Topic(this, "Topic");
    this.queue = new aws.notify.Queue(this, "Queue", {
      registerOutputs: true,
      outputName: "queue",
    });

    this.fn = new aws.compute.NodejsFunction(this, "SnsSqs", {
      path: path.join(__dirname, "handlers", "check-event", "index.ts"),
      // onFailure: new destinations.SnsDestination(topic),
      onSuccess: new aws.compute.destinations.SqsDestination(this.queue),
      maxEventAge: Duration.hours(3),
      retryAttempts: 1,
      registerOutputs: true,
      outputName: "function",
    });

    const onSuccessLambda = new aws.compute.NodejsFunction(this, "OnSucces", {
      path: path.join(__dirname, "handlers", "log-event", "index.ts"),
    });
    new aws.compute.NodejsFunction(this, "EventBusLambda", {
      path: path.join(__dirname, "handlers", "check-event", "index.ts"),
      onFailure: new aws.compute.destinations.EventBridgeDestination(),
      onSuccess: new aws.compute.destinations.FunctionDestination(
        onSuccessLambda,
      ),
    });

    new aws.compute.Alias(this, "MySpecialAlias", {
      aliasName: "MySpecialAlias",
      function: this.fn,
      version: this.fn.version,
      onSuccess: new aws.compute.destinations.SqsDestination(this.queue),
      // onFailure: new aws.compute.destinations.SnsDestination(topic),
      maxEventAge: Duration.hours(2),
      retryAttempts: 0,
    });
  }
}
// FIXME:
//  deleting Lambda Function Event Invoke Config (12345678-1234-destinationsSnsSqs:$LATEST):
//  operation error Lambda: DeleteFunctionEventInvokeConfig, https response error
//  ResourceConflictException: The EventInvokeConfig for function arn:aws:lambda:...:12345678-1234-destinationsSnsSqs:$LATEST
//  could not be updated due to a concurrent update operation.
const app = new App({
  outdir,
});

const stack = new SampleStack(app, stackName, {
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
