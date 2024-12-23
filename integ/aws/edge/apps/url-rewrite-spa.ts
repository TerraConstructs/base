import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "url-rewrite-spa";

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
// https://github.com/aws-samples/amazon-cloudfront-functions/blob/main/url-rewrite-single-page-apps/README.md
new aws.edge.Function(stack, "UrlRewrite", {
  nameSuffix: "url-rewrite",
  code: aws.edge.FunctionCode.fromFile({
    filePath: path.join(__dirname, "handlers", "url-rewrite-spa", "/index.js"),
  }),
  registerOutputs: true,
  outputName: "url_rewrite_function",
});

app.synth();
