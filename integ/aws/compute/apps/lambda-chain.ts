// ref: https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-lambda-destinations/test/integ.lambda-chain.ts
import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

// Test success case with:
// 1. Invoke first function in the chain
//   aws lambda invoke --function-name <first function name> --invocation-type Event --payload '"OK"' response.json
// 2. Check logs of third function (should show 'Event: "OK"')
//   aws logs filter-log-events --log-group-name /aws/lambda/<third function name>
//
// Test failure case with:
// 1. Invoke first function in the chain
//   aws lambda invoke --function-name <first function name> --invocation-type Event --payload '"error"' response.json
// 2. Check logs of error function (should show 'Event: {"errorType": "Error", "errorMessage": "UnkownError", "trace":"..."}')
//   aws logs filter-log-events --log-group-name /aws/lambda/<error function name>

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "lambda-chain";

class SampleStack extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const handlerPath = path.join(
      __dirname,
      "handlers",
      "log-event-err",
      "index.ts",
    );
    const first = new aws.compute.NodejsFunction(this, "First", {
      path: handlerPath,
      registerOutputs: true,
      outputName: "first_function",
    });
    const second = new aws.compute.NodejsFunction(this, "Second", {
      path: handlerPath,
    });
    const third = new aws.compute.NodejsFunction(this, "Third", {
      path: handlerPath,
      registerOutputs: true,
      outputName: "third_function",
    });
    const error = new aws.compute.NodejsFunction(this, "Error", {
      path: handlerPath,
      registerOutputs: true,
      outputName: "error_function",
    });

    first.configureAsyncInvoke({
      onSuccess: new aws.compute.destinations.FunctionDestination(second, {
        responseOnly: true,
      }),
      onFailure: new aws.compute.destinations.FunctionDestination(error, {
        responseOnly: true,
      }),
      retryAttempts: 0,
    });

    second.configureAsyncInvoke({
      onSuccess: new aws.compute.destinations.FunctionDestination(third, {
        responseOnly: true,
      }),
    });
  }
}

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
