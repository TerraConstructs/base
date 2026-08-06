// Deploy-validates the PR #136 follow-up review fixes (no upstream integ counterpart):
//  1. managed-compute-environment.ts createSpotFleetRole(): the default BEST_FIT spot
//     fleet role must carry the AmazonEC2SpotFleetTaggingRole managed policy
//     (https://docs.aws.amazon.com/batch/latest/userguide/spot_fleet_IAM_role.html) and
//     the compute environment must reach VALID with it.
//  2. multinode-job-definition.ts: AWS-supported NESTED node ranges (0:10 + 4:5 override,
//     https://docs.aws.amazon.com/batch/latest/APIReference/API_NodeRangeProperty.html)
//     must be accepted by AWS with numNodes derived from the covered topology (11).
//  3. the five-node-group AWS boundary
//     (https://docs.aws.amazon.com/batch/latest/userguide/mnp-node-groups.html) deploys.
// No jobs are submitted - the compute environment stays at 0 instances (minvCpus 0).

import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Size } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "batch.spot-mnp";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g88888888-8888",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Cheapest possible network: public-only, no NAT - the (empty) spot compute
// environment only needs to reach VALID, which requires no instances.
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

// (1) spot + BEST_FIT with NO explicit spotFleetRole: the construct must generate the
// role WITH the AmazonEC2SpotFleetTaggingRole managed policy attached.
const spotCE = new aws.compute.batch.ManagedEc2EcsComputeEnvironment(
  stack,
  "SpotCE",
  {
    vpc,
    vpcSubnets: { subnetType: aws.compute.SubnetType.PUBLIC },
    spot: true,
    allocationStrategy: aws.compute.batch.AllocationStrategy.BEST_FIT,
    maxvCpus: 4,
    registerOutputs: true,
    outputName: "spot-ce",
  },
);
new TerraformOutput(stack, "spot-fleet-role-name", {
  value: spotCE.spotFleetRole!.roleName,
  staticId: true,
});

function ec2Container(id: string) {
  return new aws.compute.batch.EcsEc2ContainerDefinition(stack, id, {
    cpu: 256,
    memory: Size.mebibytes(2048),
    image: aws.compute.ecs.ContainerImage.fromRegistry(
      "public.ecr.aws/amazonlinux/amazonlinux:latest",
    ),
  });
}

// (2) nested override topology: 0:10 outer + 4:5 nested => 11 nodes.
new aws.compute.batch.MultiNodeJobDefinition(stack, "NestedMnp", {
  containers: [
    { container: ec2Container("NestedOuter"), startNode: 0, endNode: 10 },
    { container: ec2Container("NestedInner"), startNode: 4, endNode: 5 },
  ],
  registerOutputs: true,
  outputName: "nested-mnp",
});

// (3) five node groups - the AWS boundary - => 5 nodes.
new aws.compute.batch.MultiNodeJobDefinition(stack, "FiveGroupMnp", {
  containers: Array.from({ length: 5 }, (_, i) => ({
    container: ec2Container(`FiveGroup${i}`),
    startNode: i,
    endNode: i,
  })),
  registerOutputs: true,
  outputName: "five-group-mnp",
});

app.synth();
