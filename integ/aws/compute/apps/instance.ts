// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-ec2/test/integ.instance.ts

import { CloudinitProvider } from "@cdktf/provider-cloudinit/lib/provider";
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "instance";

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
new CloudinitProvider(stack, "CloudInit");
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const vpc = new aws.compute.Vpc(stack, "VPC");
const securityGroup = new aws.compute.SecurityGroup(stack, "IntegSg", {
  vpc,
  allowAllIpv6Outbound: true,
});
const instance = new aws.compute.Instance(stack, "Instance", {
  vpc,
  securityGroup,
  instanceType: aws.compute.InstanceType.of(
    aws.compute.InstanceClass.T3,
    aws.compute.InstanceSize.NANO,
  ),
  machineImage: new aws.compute.AmazonLinuxImage({
    generation: aws.compute.AmazonLinuxGeneration.AMAZON_LINUX_2,
  }),
  detailedMonitoring: true,
  instanceInitiatedShutdownBehavior:
    aws.compute.InstanceInitiatedShutdownBehavior.TERMINATE,
});

instance.addToRolePolicy(
  new aws.iam.PolicyStatement({
    actions: ["ssm:*"],
    resources: ["*"],
  }),
);

instance.connections.allowFromAnyIpv4(aws.compute.Port.icmpPing());

instance.addUserData("yum install -y");

app.synth();

// import { IntegTest } from '@aws-cdk/integ-tests-alpha';
// const testCase = new TestStack(app, 'integ-ec2-instance');
// new IntegTest(app, 'instance-test', {
//   testCases: [testCase],
// });
