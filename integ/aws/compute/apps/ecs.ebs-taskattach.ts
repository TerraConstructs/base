// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/fargate/integ.ebs-taskattach.ts

import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Size } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "ecs.ebs-taskattach";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g33333333-3333",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Cheapest possible network for this fixture: 1 AZ, public subnets only, no
// NAT Gateways (upstream uses a full ec2.Vpc(maxAzs: 1) with default NAT
// gateways per AZ). FargateService falls back to PUBLIC subnets by default
// since no PRIVATE_WITH_EGRESS/ISOLATED subnets exist, but tasks still need
// `assignPublicIp: true` below to reach the internet (pull the
// "amazon/amazon-ecs-sample" image from Docker Hub) without a NAT Gateway.
const vpc = new aws.compute.Vpc(stack, "Vpc", {
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

const cluster = new aws.compute.ecs.Cluster(stack, "FargateCluster", {
  vpc,
  registerOutputs: true,
  outputName: "cluster",
});

const taskDefinition = new aws.compute.ecs.FargateTaskDefinition(
  stack,
  "TaskDef",
  {
    registerOutputs: true,
    outputName: "task-definition",
  },
);

const container = taskDefinition.addContainer("web", {
  image: aws.compute.ecs.ContainerImage.fromRegistry(
    "amazon/amazon-ecs-sample",
  ),
  portMappings: [
    {
      containerPort: 80,
      protocol: aws.compute.ecs.Protocol.TCP,
    },
  ],
});

// The THE POINT of this integ test: a `ServiceManagedVolume` backed by a
// managed EBS volume, deploy-validating the `volume_configuration` block
// BaseService's prepare-time `toTerraform()` emits on the `aws_ecs_service`
// Terraform resource (including the EBS role/IAM wiring).
const volume = new aws.compute.ecs.ServiceManagedVolume(stack, "EBSVolume", {
  name: "ebs1",
  managedEBSVolume: {
    encrypted: true,
    volumeType: aws.compute.EbsDeviceVolumeType.GP3,
    size: Size.gibibytes(15),
    iops: 4000,
    throughput: 500,
    fileSystemType: aws.compute.ecs.FileSystemType.EXT4,
    tagSpecifications: [
      {
        tags: {
          purpose: "production",
        },
        propagateTags: aws.compute.ecs.EbsPropagatedTagSource.SERVICE,
      },
      {
        tags: {
          purpose: "development",
        },
        propagateTags: aws.compute.ecs.EbsPropagatedTagSource.TASK_DEFINITION,
      },
    ],
  },
});

volume.mountIn(container, {
  containerPath: "/var/lib",
  readOnly: false,
});

taskDefinition.addVolume(volume);

const service = new aws.compute.ecs.FargateService(stack, "FargateService", {
  cluster,
  taskDefinition,
  desiredCount: 1,
  assignPublicIp: true,
  registerOutputs: true,
  outputName: "service",
});

service.addVolume(volume);

// `ServiceManagedVolume` is a plain `Construct` (not an `AwsConstructBase`),
// so it has no `outputs`/`registerOutputs` of its own - surface the
// auto-created EBS IAM role's ARN explicitly for validation/debugging.
new TerraformOutput(stack, "ebs-volume-role-arn", {
  value: volume.role.roleArn,
});

app.synth();
