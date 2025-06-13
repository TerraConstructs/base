// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-ec2/test/integ.launch-template.ts

import { CloudinitProvider } from "@cdktf/provider-cloudinit/lib/provider";
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "launch-template";

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

const vpc = new aws.compute.Vpc(stack, "MyVpc", {
  vpcName: "MyVpc",
  subnetConfiguration: [],
});

const sg1 = new aws.compute.SecurityGroup(stack, "sg1", {
  vpc: vpc,
});

const lt = new aws.compute.LaunchTemplate(stack, "LT", {
  versionDescription: "test template v1",
  httpEndpoint: true,
  httpProtocolIpv6: true,
  httpPutResponseHopLimit: 2,
  httpTokens: aws.compute.LaunchTemplateHttpTokens.REQUIRED,
  instanceMetadataTags: true,
  securityGroup: sg1,
  blockDevices: [
    {
      deviceName: "/dev/xvda",
      volume: aws.compute.BlockDeviceVolume.ebs(15, {
        volumeType: aws.compute.EbsDeviceVolumeType.GP3,
        throughput: 250,
      }),
    },
  ],
});

const sg2 = new aws.compute.SecurityGroup(stack, "sg2", {
  vpc: vpc,
});

lt.addSecurityGroup(sg2);

new aws.compute.LaunchTemplate(stack, "LTWithMachineImage", {
  machineImage: aws.compute.MachineImage.latestAmazonLinux({
    generation: aws.compute.AmazonLinuxGeneration.AMAZON_LINUX_2,
  }),
});

app.synth();

// import * as integ from "@aws-cdk/integ-tests-alpha";
// new integ.IntegTest(app, "LambdaTest", {
//   testCases: [stack],
//   diffAssets: true,
// });
