import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "public-website-bucket";

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

// add a public s3 bucket with website hosting enabled
new aws.storage.Bucket(stack, "WebSite", {
  namePrefix: "hello-world",
  sources: path.join(__dirname, "site"),
  websiteConfig: {
    enabled: true,
  },
  public: true, // no cdn
  registerOutputs: true,
  outputName: "website",
});

app.synth();
