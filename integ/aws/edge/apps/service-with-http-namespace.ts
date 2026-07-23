// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-servicediscovery/test/integ.service-with-http-namespace.lit.ts

import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "service-with-http-namespace";

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
// TODO: use TerraConstruct e2e s3 backend?
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const namespace = new aws.edge.cloudmap.HttpNamespace(stack, "MyNamespace", {
  name: "MyHTTPNamespace",
  registerOutputs: true,
  outputName: "namespace",
});

const service1 = namespace.createService("NonIpService", {
  description: "service registering non-ip instances",
});

new TerraformOutput(stack, "non_ip_service", {
  staticId: true,
  value: service1.outputs,
});

const nonIpInstance = service1.registerNonIpInstance("NonIpInstance", {
  customAttributes: { arn: "arn:aws:s3:::amzn-s3-demo-bucket" },
});

new TerraformOutput(stack, "non_ip_instance", {
  staticId: true,
  value: nonIpInstance.outputs,
});

const service2 = namespace.createService("IpService", {
  description: "service registering ip instances",
  healthCheck: {
    type: aws.edge.cloudmap.HealthCheckType.HTTP,
    resourcePath: "/check",
  },
});

new TerraformOutput(stack, "ip_service", {
  staticId: true,
  value: service2.outputs,
});

const ipInstance = service2.registerIpInstance("IpInstance", {
  ipv4: "54.239.25.192",
});

new TerraformOutput(stack, "ip_instance", {
  staticId: true,
  value: ipInstance.outputs,
});

app.synth();
