// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-autoscaling/test/integ.asg-update-policy.ts

import { CloudinitProvider } from "@cdktn/provider-cloudinit/lib/provider";
import { App, LocalBackend } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "autoscaling.update-policy";

// Stands in for the baked AMI of https://github.com/TerraConstructs/base/issues/129.
// `TestAutoscalingUpdatePolicy` deploys once with the default marker, then re-synths
// with a different one and applies again. Either way the change lands in the launch
// template, which is what an instance refresh triggers on - baking a second AMI just
// to move `image_id` would cost the test an EC2 Image Builder run for the same signal.
const launchTemplateRevision = process.env.LAUNCH_TEMPLATE_REVISION ?? "v1";

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

// Terraform deviation: upstream uses `maxAzs: 2` with the default subnet layout,
// which provisions a NAT Gateway per AZ. Instance refresh doesn't care about the
// network, so this uses the cheapest network that still lets an instance reach
// the EC2 Auto Scaling endpoint: single AZ, public subnets only.
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

const asg = new aws.compute.autoscaling.AutoScalingGroup(stack, "ASG", {
  vpc,
  instanceType: aws.compute.InstanceType.of(
    aws.compute.InstanceClass.BURSTABLE3,
    aws.compute.InstanceSize.MICRO,
  ),
  machineImage: new aws.compute.AmazonLinuxImage({
    generation: aws.compute.AmazonLinuxGeneration.AMAZON_LINUX_2023,
  }),
  // Terraform deviation: upstream configures `UpdatePolicy.rollingUpdate()`, which
  // is CloudFormation replacing the instances itself. The provider has no such
  // mechanism - `instance_refresh` hands the rollout to EC2 Auto Scaling instead -
  // so the equivalent policy here is `instanceRefresh()`.
  updatePolicy: aws.compute.autoscaling.UpdatePolicy.instanceRefresh({
    strategy: aws.compute.autoscaling.InstanceRefreshStrategy.ROLLING,
    // The group runs a single instance, so it has to go out of service for the
    // replacement to happen at all. `instanceWarmup: 0` keeps the refresh from
    // idling once the replacement reports InService.
    minHealthyPercentage: 0,
    maxHealthyPercentage: 100,
    instanceWarmup: Duration.seconds(0),
  }),
  registerOutputs: true,
  outputName: "asg",
});

asg.addUserData(`echo "launch template revision: ${launchTemplateRevision}"`);

app.synth();
