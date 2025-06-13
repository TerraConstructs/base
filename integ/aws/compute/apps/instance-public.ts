// https://github.com/aws/aws-cdk/raw/refs/tags/v2.164.1/packages/@aws-cdk-testing/framework-integ/test/aws-ec2/test/integ.instance-public.ts

import { CloudinitProvider } from "@cdktf/provider-cloudinit/lib/provider";
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "instance-public";

const app = new App({
  outdir,
});

class TestStack extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);
    const vpc = new aws.compute.Vpc(this, "VPC", {
      cidr: "10.0.0.0/16",
      natGateways: 0,
      maxAzs: 3,
      subnetConfiguration: [
        {
          name: "public-subnet-1",
          subnetType: aws.compute.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const securityGroup = new aws.compute.SecurityGroup(this, "IntegSg", {
      vpc,
      allowAllIpv6Outbound: true,
    });

    const instance = new aws.compute.Instance(this, "Instance", {
      vpc,
      vpcSubnets: { subnetGroupName: "public-subnet-1" },
      securityGroup,
      instanceType: aws.compute.InstanceType.of(
        aws.compute.InstanceClass.T3,
        aws.compute.InstanceSize.NANO,
      ),
      machineImage: new aws.compute.AmazonLinuxImage({
        generation: aws.compute.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      detailedMonitoring: true,
      associatePublicIpAddress: true,
    });

    instance.addToRolePolicy(
      new aws.iam.PolicyStatement({
        actions: ["ssm:*"],
        resources: ["*"],
      }),
    );

    instance.connections.allowFromAnyIpv4(aws.compute.Port.icmpPing());

    instance.addUserData("yum install -y");
  }
}

const stack = new TestStack(app, stackName, {
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
app.synth();

// import { IntegTest } from "@aws-cdk/integ-tests-alpha";
// const testCase = new TestStack(app, stackName);
// new IntegTest(app, "instance-test", {
//   testCases: [testCase],
// });
