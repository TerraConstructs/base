// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/@aws-cdk-testing/framework-integ/test/aws-apigateway/test/integ.lambda.lit.ts

import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "apigw.lambda";

/**
 * The standard nodejs runtime used for integration tests.
 * Use this, unless specifically testing a certain runtime.
 *
 * The runtime should be the lowest runtime currently supported by the AWS CDK.
 * Updating this value will require you to run a lot of integration tests.
 */
export const STANDARD_NODEJS_RUNTIME = aws.compute.Runtime.NODEJS_18_X;

class SampleStack extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const fn = new aws.compute.LambdaFunction(this, "myfn", {
      code: aws.compute.Code.fromInline(
        `exports.handler = async function(event) {
        return {
          body: JSON.stringify({
            message: 'Hello',
          }),
          statusCode: 200,
          headers: { 'Content-Type': '*/*' }
        };
      }`,
      ),
      runtime: STANDARD_NODEJS_RUNTIME,
      handler: "index.handler",
    });

    new aws.compute.LambdaRestApi(this, "lambdarestapi", {
      handler: fn,
      cloudWatchRole: true,
      registerOutputs: true,
      outputName: "api",
      integrationOptions: {
        timeout: Duration.seconds(1),
      },
    });
  }
}

const app = new App({
  outdir,
});

// Against the LambdaRestApi endpoint from the stack output, run
// `curl <url>` should return 200 with JSON body { "message": "Hello" }
const stack = new SampleStack(app, stackName, {
  gridUUID: "12345678-444",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

app.synth();
