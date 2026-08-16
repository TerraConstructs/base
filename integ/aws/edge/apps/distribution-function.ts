// https://github.com/aws/aws-cdk/blob/7926560f0a150d8fd39d0775df5259621b8068ae/packages/@aws-cdk-testing/framework-integ/test/aws-cloudfront/test/integ.distribution-function.ts
import { cloudfrontDistribution } from "@cdktn/provider-aws";
import { App, LocalBackend } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "distribution-function";

// https://github.com/aws/aws-cdk/blob/17b12f2aa7a2b519a6e802bf79d3099f2fcd7851/packages/@aws-cdk-testing/framework-integ/test/aws-cloudfront/test/test-origin.ts
/** Used for testing common Origin functionality */
class TestOrigin extends aws.edge.OriginBase {
  constructor(domainName: string, props: aws.edge.OriginProps = {}) {
    super(domainName, props);
  }
  protected renderCustomOriginConfig():
    | cloudfrontDistribution.CloudfrontDistributionOriginCustomOriginConfig
    | undefined {
    return {
      httpPort: 80,
      httpsPort: 443,
      originProtocolPolicy: aws.edge.OriginProtocolPolicy.HTTPS_ONLY,
      originSslProtocols: [aws.edge.OriginSslPolicy.TLS_V1_2],
    };
  }
}

const app = new App({
  outdir,
});
const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Viewer-request function that stamps a marker header on the request so the
// association's effect is directly observable (via TestFunction and, once
// deployed, on the actual viewer response echoed back by the origin).
const cfFunction = new aws.edge.Function(stack, "Function", {
  nameSuffix: "distribution-function",
  code: aws.edge.FunctionCode.fromInline(
    `function handler(event) {
  var request = event.request;
  request.headers['x-distribution-function'] = { value: 'true' };
  return request;
}`,
  ),
  registerOutputs: true,
  outputName: "function",
});

new aws.edge.Distribution(stack, "Dist", {
  defaultBehavior: {
    origin: new TestOrigin("www.example.com"),
    cachePolicy: aws.edge.ManagedCachePolicy.CACHING_DISABLED,
    functionAssociations: [
      {
        function: cfFunction,
        eventType: aws.edge.FunctionEventType.VIEWER_REQUEST,
      },
    ],
  },
  registerOutputs: true,
  outputName: "distribution",
});

app.synth();
