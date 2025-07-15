// ref: https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-lambda-destinations/test/integ.lambda-chain.ts

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

    const lambdaProps: aws.compute.FunctionProps = {
      runtime: STANDARD_NODEJS_RUNTIME,
      handler: "index.handler",
      code: aws.compute.Code.fromInline(`exports.handler = async (event) => {
        console.log('Event: %j', event);
        if (event.status === 'error') throw new Error('UnkownError');
        return event;
      };`),
      registerOutputs: true,
    };

    const first = new aws.compute.LambdaFunction(this, "First", {
      ...lambdaProps,
      outputName: "first_function",
    });
    const second = new aws.compute.LambdaFunction(this, "Second", {
      ...lambdaProps,
    });
    const third = new aws.compute.LambdaFunction(this, "Third", {
      ...lambdaProps,
      outputName: "third_function",
    });
    const error = new aws.compute.LambdaFunction(this, "Error", {
      ...lambdaProps,
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
