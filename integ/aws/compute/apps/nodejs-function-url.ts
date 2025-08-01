import { App, LocalBackend } from "cdktf";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "nodejs-function-url";

const app = new App({
  outdir,
});
const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
// TODO: use TerraConstruct e2e s3 backend?
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// add a public echo endpoint for network connectivity tests
const echoLambda = new aws.compute.LambdaFunction(stack, "Echo", {
  // entry: path.join(__dirname, "handlers", "echo", "index.ts"),
  runtime: aws.compute.Runtime.NODEJS_18_X,
  handler: "index.handler",
  code: aws.compute.Code.fromInline(`exports.handler = async (event) => {
    return {
      statusCode: 200,
      body: JSON.stringify({
        host: process.env.NAME || "unnamed",
        ip: event.requestContext.http.sourceIp,
      }),
    };
  };`),
  environment: {
    NAME: stackName,
  },
  registerOutputs: true,
  outputName: "echo",
});
echoLambda.addFunctionUrl({
  authType: aws.compute.FunctionUrlAuthType.NONE,
  cors: {
    allowCredentials: true,
    allowedOrigins: ["*"],
    allowedMethods: [aws.compute.HttpMethod.ALL],
    allowedHeaders: ["date", "keep-alive"],
    exposedHeaders: ["keep-alive", "date"],
    maxAge: Duration.days(1),
  },
});

app.synth();
