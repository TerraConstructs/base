// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/ec2/integ.sd-awsvpc-nw.ts

import { CloudinitProvider } from "@cdktn/provider-cloudinit/lib/provider";
import { App, LocalBackend } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "ecs.sd-awsvpc-nw";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g44444444-4444",
  environmentName,
  providerConfig: {
    region,
  },
});
new CloudinitProvider(stack, "CloudInit");
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Unlike the other fixtures in this directory, this one CANNOT be NAT-free: the
// frontend task uses awsvpc networking on EC2 capacity, so both the ECS container
// instances (to reach the ECS/Docker Hub APIs) and the task's own ENI (which gets
// no public IP under awsvpc) need egress. Use a single NAT Gateway across 2 AZs with
// public + private-with-egress subnets - the ASG's default subnet selection
// (PRIVATE_WITH_EGRESS when available) puts container instances in the private tier.
const vpc = new aws.compute.Vpc(stack, "Vpc", {
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: [
    {
      name: "public",
      subnetType: aws.compute.SubnetType.PUBLIC,
      cidrMask: 24,
    },
    {
      name: "private",
      subnetType: aws.compute.SubnetType.PRIVATE_WITH_EGRESS,
      cidrMask: 24,
    },
  ],
});

const cluster = new aws.compute.ecs.Cluster(stack, "EcsCluster", {
  vpc,
  registerOutputs: true,
  outputName: "cluster",
});

cluster.addCapacity("DefaultAutoScalingGroup", {
  instanceType: aws.compute.InstanceType.of(
    aws.compute.InstanceClass.BURSTABLE2,
    aws.compute.InstanceSize.MICRO,
  ),
});

// Add Private DNS Namespace. `name` is honored verbatim (see
// PrivateDnsNamespace's naming-convention deviation note), so it is already known
// at synth time - no TerraformOutput needed to recover it in the Go test.
const domainName = "scorekeep.com";
cluster.addDefaultCloudMapNamespace({
  name: domainName,
});

// Create frontend service
const frontendTD = new aws.compute.ecs.Ec2TaskDefinition(stack, "TaskDef", {
  networkMode: aws.compute.ecs.NetworkMode.AWS_VPC,
  registerOutputs: true,
  outputName: "task-definition",
});

const frontend = frontendTD.addContainer("frontend", {
  image: aws.compute.ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
  memoryLimitMiB: 256,
});

frontend.addPortMappings({
  containerPort: 80,
  hostPort: 80,
  protocol: aws.compute.ecs.Protocol.TCP,
});

new aws.compute.ecs.Ec2Service(stack, "FrontendService", {
  cluster,
  taskDefinition: frontendTD,
  cloudMapOptions: {
    // `name` is honored verbatim by CloudMapOptions -> edge.cloudmap.Service, so
    // it is already known at synth time - no TerraformOutput needed to recover it.
    name: "frontend",
  },
  registerOutputs: true,
  outputName: "service",
});

app.synth();
