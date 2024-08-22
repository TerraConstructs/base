import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "nodejs-function-url";

const app = new App({
  outdir,
});
const stack = new aws.AwsSpec(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
// TODO: use E.T. e2e s3 backend?
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// add a public echo endpoint for network connectivity tests
const echoLambda = new aws.compute.NodejsFunction(stack, "Echo", {
  path: path.join(__dirname, "handlers", "echo", "index.ts"),
  environment: {
    NAME: stackName,
  },
  registerOutputs: true,
  outputName: "echo",
});
echoLambda.addUrl({
  authorizationType: "NONE",
  cors: {
    allowCredentials: true,
    allowOrigins: ["*"],
    allowMethods: ["*"],
    allowHeaders: ["date", "keep-alive"],
    exposeHeaders: ["keep-alive", "date"],
    maxAge: 86400,
  },
});

app.synth();
