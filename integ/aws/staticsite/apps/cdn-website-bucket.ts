import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "cdn-website-bucket";
const domainName = process.env.DNS_DOMAIN_NAME ?? "e2e.terraconstructs.dev";
const zoneId = process.env.DNS_ZONE_ID;

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

let zone: aws.edge.IDnsZone | undefined = undefined;
let certificate: aws.edge.ICertificate | undefined = undefined;
if (zoneId) {
  zone = aws.edge.DnsZone.fromZoneId(stack, "Zone", zoneId);
  certificate = new aws.edge.PublicCertificate(stack, "Certificate", {
    domainName,
    subjectAlternativeNames: [`*.${domainName}`],
    validation: {
      method: aws.edge.ValidationMethod.DNS,
      hostedZone: zone,
    },
    lifecycle: {
      createBeforeDestroy: true,
    },
  });
}

// add s3 bucket with origin access identity enabled
const sourceBucket = new aws.storage.Bucket(stack, "Source", {
  sources: path.join(__dirname, "site"),
  cloudfrontAccess: {
    enabled: true,
  },
});
// TODO: fix permanent diff on viewer certificate (min protocol TSLv1 and ssl_support_method SNI-only)
const distribution = new aws.edge.Distribution(stack, "Cdn", {
  ...(certificate ? { aliases: [domainName], certificate } : {}),
  priceClass: aws.edge.PriceClass.PRICE_CLASS_100,
  defaultBehavior: {
    origin: new aws.edge.S3Origin(sourceBucket),
    viewerProtocolPolicy: aws.edge.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
  defaultRootObject: "index.html",
  errorResponses: [404, 403].map((httpStatus) => ({
    httpStatus,
    responseHttpStatus: 200,
    responsePagePath: "/index.html",
  })),
  registerOutputs: true,
  outputName: "cdn",
});
if (zone) {
  // create apex record for CDN
  new aws.edge.ARecord(stack, "CdnAlias", {
    zone,
    target: aws.edge.RecordTarget.fromAlias(
      new aws.edge.DistributionTarget(distribution),
    ),
  });
}

app.synth();
