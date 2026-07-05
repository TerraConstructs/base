// https://github.com/aws/aws-cdk/blob/main/packages/@aws-cdk-testing/framework-integ/test/aws-ec2/test/integ.vpc-lookup.ts

import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const lookupRegion = process.env.LOOKUP_REGION ?? region;
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "vpc-lookup";

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

const vpcFromLookup = aws.compute.Vpc.fromLookup(stack, "VpcFromLookup", {
  isDefault: true,
  region: lookupRegion,
});

new TerraformOutput(stack, "OutputFromLookup", {
  value: `Region fromLookup: ${vpcFromLookup.env.region}`,
  staticId: true,
});

new TerraformOutput(stack, "AvailabilityZonesFromLookup", {
  value: vpcFromLookup.availabilityZones.join(","),
  staticId: true,
});

new TerraformOutput(stack, "VpcIdFromLookup", {
  value: vpcFromLookup.vpcId,
  staticId: true,
});

app.synth();
