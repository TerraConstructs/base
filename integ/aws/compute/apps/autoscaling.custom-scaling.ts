// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-autoscaling/test/integ.custom-scaling.ts

import { CloudinitProvider } from "@cdktn/provider-cloudinit/lib/provider";
import { App, LocalBackend } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "autoscaling.custom-scaling";

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
new CloudinitProvider(stack, "CloudInit");
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Cheapest possible network for this fixture: single AZ, public-subnet-only
// (no NAT Gateway). The AutoScalingGroup's default subnet selection falls
// back to PUBLIC subnets when no PRIVATE_WITH_EGRESS subnets exist, so no
// explicit `vpcSubnets` is required below.
const vpc = new aws.compute.Vpc(stack, "VPC", {
  maxAzs: 1,
  natGateways: 0,
  subnetConfiguration: [
    {
      name: "public",
      subnetType: aws.compute.SubnetType.PUBLIC,
      cidrMask: 24,
    },
  ],
});

// instanceType + machineImage (no `launchTemplate` prop) always synths an
// `aws_launch_template` + `aws_autoscaling_group` pair - no deprecated
// launch configuration.
const asg = new aws.compute.autoscaling.AutoScalingGroup(stack, "Fleet", {
  vpc,
  instanceType: aws.compute.InstanceType.of(
    aws.compute.InstanceClass.BURSTABLE2,
    aws.compute.InstanceSize.MICRO,
  ),
  machineImage: new aws.compute.AmazonLinuxImage({
    generation: aws.compute.AmazonLinuxGeneration.AMAZON_LINUX_2,
  }),
  registerOutputs: true,
  outputName: "fleet",
});

asg.scaleOnSchedule("ScaleUpInTheMorning", {
  schedule: aws.compute.autoscaling.Schedule.cron({ hour: "8", minute: "0" }),
  minCapacity: 5,
});

asg.scaleOnSchedule("ScaleDownAtNight", {
  schedule: aws.compute.autoscaling.Schedule.cron({
    hour: "20",
    minute: "0",
  }),
  maxCapacity: 2,
});

asg.scaleOnSchedule("ScaleUpInTheDay", {
  schedule: aws.compute.autoscaling.Schedule.cron({
    minute: "0/10",
    day: "1",
  }),
  minCapacity: 5,
});

asg.scaleOnSchedule("ScaleUpInTheWeekDay", {
  schedule: aws.compute.autoscaling.Schedule.cron({
    minute: "0/10",
    weekDay: "MON-SUN",
  }),
  minCapacity: 5,
});

asg.scaleOnCpuUtilization("KeepCPUReasonable", {
  targetUtilizationPercent: 50,
});

app.synth();

// import { IntegTest } from '@aws-cdk/integ-tests-alpha';
// const testCase = new TestStack(app, 'integ-ec2-instance');
// new IntegTest(app, 'instance-test', {
//   testCases: [testCase],
// });
