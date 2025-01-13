// https://github.com/aws/aws-cdk/blob/7926560f0a150d8fd39d0775df5259621b8068ae/packages/@aws-cdk-testing/framework-integ/test/aws-cloudfront/test/integ.distribution-policies.ts
import { cloudfrontDistribution } from "@cdktf/provider-aws";
import {
  App,
  LocalBackend,
  // TerraformVariable,
} from "cdktf";
// import { TestOrigin } from "./test-origin";
import { Duration, aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "distribution-policies";

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

// TODO: Re-add origin Group support
// export class TestOriginGroup implements aws.edge.IOrigin {
//   constructor(
//     private readonly primaryDomainName: string,
//     private readonly secondaryDomainName: string,
//   ) {}
//   public render(
//     originId: string,
//   ): cloudfrontDistribution.CloudfrontDistributionOrigin {
//     const primaryOrigin = new TestOrigin(this.primaryDomainName);
//     const secondaryOrigin = new TestOrigin(this.secondaryDomainName);

//     const primaryOriginConfig = primaryOrigin.render(originId);
//     return {
//       originId: primaryOriginConfig.originId,
//       // TODO
//     };
//   }
// }

// export function defaultOrigin(domainName?: string): aws.edge.IOrigin {
//   return new TestOrigin(domainName ?? "www.example.com");
// }

// export function defaultOriginGroup(): aws.edge.IOrigin {
//   return new TestOriginGroup("www.example.com", "foo.example.com");
// }

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

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// // TODO: Re-add custom Cache Policy support
// const cachePolicy = new aws.edge.CachePolicy(stack, "CachePolicy", {
//   cachePolicyName: "ACustomCachePolicy",
// });

// const paramMinTtl = new TerraformVariable(stack, "MinTtlParam", {
//   type: "Number",
//   default: "1000",
// });
// const paramDefaultTtl = new TerraformVariable(stack, "DefaultTtlParam", {
//   type: "Number",
//   default: "2000",
// });
// const paramMaxTtl = new TerraformVariable(stack, "MaxTtlParam", {
//   type: "Number",
//   default: "3000",
// });
// const cachePolicyWithRef = new aws.edge.CachePolicy(
//   stack,
//   "CachePolicyWithRef",
//   {
//     minTtl: Duration.seconds(paramMinTtl.numberValue),
//     defaultTtl: Duration.seconds(paramDefaultTtl.numberValue),
//     maxTtl: Duration.seconds(paramMaxTtl.numberValue),
//   },
// );

// // TODO: Re-add custom Origin Request Policy support
// const originRequestPolicy = new aws.edge.OriginRequestPolicy(
//   stack,
//   "OriginRequestPolicy",
//   {
//     originRequestPolicyName: "ACustomOriginRequestPolicy",
//     cookieBehavior: aws.edge.OriginRequestCookieBehavior.allowList("cookie1"),
//     headerBehavior: aws.edge.OriginRequestHeaderBehavior.all(
//       "CloudFront-Forwarded-Proto",
//     ),
//     queryStringBehavior:
//       aws.edge.OriginRequestQueryStringBehavior.denyList("querystringparam"),
//   },
// );

const responseHeadersPolicy = new aws.edge.ResponseHeadersPolicy(
  stack,
  "ResponseHeadersPolicy",
  {
    responseHeadersPolicyName: "ACustomResponseHeadersPolicy",
    corsBehavior: {
      accessControlAllowCredentials: false,
      accessControlAllowHeaders: ["X-Custom-Header-1", "X-Custom-Header-2"],
      accessControlAllowMethods: ["GET", "POST"],
      accessControlAllowOrigins: ["*"],
      accessControlExposeHeaders: ["X-Custom-Header-1", "X-Custom-Header-2"],
      accessControlMaxAge: Duration.seconds(600),
      originOverride: true,
    },
    removeHeaders: ["Server"],
    serverTimingSamplingRate: 50,
  },
);

new aws.edge.Distribution(stack, "Dist", {
  defaultBehavior: {
    origin: new TestOrigin("www.example.com"),
    // cachePolicy,
    // originRequestPolicy,
    responseHeadersPolicy,
  },
  registerOutputs: true,
  outputName: "distribution",
});

new aws.edge.Distribution(stack, "Dist-2", {
  defaultBehavior: {
    origin: new TestOrigin("www.example-2.com"),
    // cachePolicy: cachePolicyWithRef,
    originRequestPolicy:
      aws.edge.ManagedOriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    responseHeadersPolicy,
  },
});

app.synth();
