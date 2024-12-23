import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "kvs-jwt-verify";
const secretKey = process.env.SECRET_KEY ?? "change-me";
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

// test aws sample
// https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example-function-validate-token.html
// https://github.com/aws-samples/amazon-cloudfront-functions/blob/main/kvs-jwt-verify/README.md
const kvStore = new aws.edge.KeyValueStore(stack, "JwtKey", {
  nameSuffix: "jwt-key",
  data: aws.edge.KeyValuePairs.fromInline({
    "jwt.secret": secretKey, // WARNING: This secret is plain text in TF State :(
  }),
});
new aws.edge.Function(stack, "JwtVerify", {
  nameSuffix: "jwt-verify",
  code: aws.edge.FunctionCode.fromFile({
    filePath: path.join(__dirname, "handlers", "kvs-jwt-verify", "/index.js"),
  }),
  keyValueStore: kvStore,
  registerOutputs: true,
  outputName: "jwt_verify_function",
});

app.synth();
