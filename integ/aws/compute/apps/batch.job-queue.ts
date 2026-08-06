// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-batch/test/integ.job-queue.ts

import { App, LocalBackend } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "batch.job-queue";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g66666666-6666",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Cheapest possible network for this fixture: 2 AZs, public subnets only, no
// NAT Gateways (upstream uses a full ec2.Vpc(stack, 'vpc', { restrictDefaultSecurityGroup:
// false }) with default NAT gateways per AZ). Both ManagedEc2EcsComputeEnvironments below
// use `minvCpus` default (0), so no instances are launched by this fixture - the compute
// environments only need to reach VALID/ENABLED state, which does not require outbound
// internet connectivity from the (empty) subnets.
const vpc = new aws.compute.Vpc(stack, "vpc", {
  maxAzs: 2,
  natGateways: 0,
  subnetConfiguration: [
    {
      name: "public",
      subnetType: aws.compute.SubnetType.PUBLIC,
      cidrMask: 24,
    },
  ],
});

const fairsharePolicy = new aws.compute.batch.FairshareSchedulingPolicy(
  stack,
  "fairshare",
  {
    computeReservation: 75,
    schedulingPolicyName: "joBBQFairsharePolicy",
    shareDecay: Duration.hours(1),
    shares: [
      {
        shareIdentifier: "shareA",
        weightFactor: 0.5,
      },
    ],
    registerOutputs: true,
    outputName: "fairshare-policy",
  },
);

const managedEc2CE = new aws.compute.batch.ManagedEc2EcsComputeEnvironment(
  stack,
  "managedEc2CE",
  {
    vpc,
    // public-only VPC (above) - select the public subnets explicitly rather
    // than relying on the no-private-subnets fallback of the default selection
    vpcSubnets: { subnetType: aws.compute.SubnetType.PUBLIC },
    registerOutputs: true,
    outputName: "managed-ec2-ce",
  },
);

const queue = new aws.compute.batch.JobQueue(stack, "joBBQ", {
  computeEnvironments: [
    {
      computeEnvironment: managedEc2CE,
      order: 1,
    },
  ],
  priority: 10,
  schedulingPolicy: fairsharePolicy,
  registerOutputs: true,
  outputName: "job-queue",
});

fairsharePolicy.addShare({
  shareIdentifier: "shareB",
  weightFactor: 7,
});

const newManagedEc2CE = new aws.compute.batch.ManagedEc2EcsComputeEnvironment(
  stack,
  "newManagedEc2CE",
  {
    vpc,
    vpcSubnets: { subnetType: aws.compute.SubnetType.PUBLIC },
    registerOutputs: true,
    outputName: "new-managed-ec2-ce",
  },
);

queue.addComputeEnvironment(newManagedEc2CE, 2);

app.synth();
