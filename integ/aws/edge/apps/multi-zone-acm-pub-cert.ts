import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "multi-zone-acm-pub-cert";
const zoneId1 = process.env.DNS_ZONE_ID1;
const domainName1 = process.env.DNS_DOMAIN_NAME1;
const zoneId2 = process.env.DNS_ZONE_ID2;
const domainName2 = process.env.DNS_DOMAIN_NAME2;

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

if (!zoneId1 || !zoneId2 || !domainName1 || !domainName2) {
  throw new Error(
    "Missing some or all required environment variables: " +
      "DNS_ZONE_ID1, DNS_ZONE_ID2, DNS_DOMAIN_NAME1, DNS_DOMAIN_NAME2",
  );
}

const zone1 = aws.edge.DnsZone.fromZoneId(stack, "Zone1", zoneId1);
const zone2 = aws.edge.DnsZone.fromZoneId(stack, "Zone2", zoneId2);

// create an ACM certificate with DNS Multi Zone Validation
// ref: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager-readme.html#dns-validation
// ref: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager-readme.html#cross-region-certificates
new aws.edge.PublicCertificate(stack, "Certificate", {
  domainName: domainName1,
  subjectAlternativeNames: [
    `*.${domainName1}`,
    domainName2,
    `*.${domainName2}`,
  ],
  validation: {
    method: aws.edge.ValidationMethod.DNS,
    hostedZones: {
      [domainName1]: zone1,
      [domainName2]: zone2,
    },
  },
  lifecycle: {
    createBeforeDestroy: true,
  },
  registerOutputs: true,
  outputName: "certificate",
});

app.synth();
