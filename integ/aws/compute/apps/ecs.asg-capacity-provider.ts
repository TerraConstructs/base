// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/ec2/integ.capacity-provider.ts

import { CloudinitProvider } from "@cdktn/provider-cloudinit/lib/provider";
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "ecs.asg-capacity-provider";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g55555555-5555",
  environmentName,
  providerConfig: {
    region,
  },
});
new CloudinitProvider(stack, "CloudInit");
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Cheapest possible network for this fixture: 2 AZs, public subnets only, no
// NAT Gateways (upstream uses a full ec2.Vpc(maxAzs: 2) with default NAT
// gateways per AZ). The AutoScalingGroup's container instances need
// `associatePublicIpAddress: true` below to reach the internet (ECS agent
// registration + pulling "amazon/amazon-ecs-sample" from Docker Hub) without
// a NAT Gateway. Unlike the awsvpc-networking EC2 fixtures in this directory,
// this one CAN be NAT-free: the task uses the default "bridge" network mode,
// so the task shares the host ENI/public IP - there is no separate task ENI
// that needs its own route to the internet.
const vpc = new aws.compute.Vpc(stack, "Vpc", {
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

const cluster = new aws.compute.ecs.Cluster(stack, "EC2CPCluster", {
  vpc,
  registerOutputs: true,
  outputName: "cluster",
});

// networkMode defaults to "bridge" for Ec2TaskDefinition.
const taskDefinition = new aws.compute.ecs.Ec2TaskDefinition(
  stack,
  "TaskDef",
);

// Port mapping (containerPort 80 -> fixed hostPort 8080) borrowed from
// ec2/integ.lb-bridge-nw.ts - the upstream capacity-provider fixture itself
// registers no ports since it has no load balancer. Grid addition: bridges
// this fixture to an ALB target below so the capacity-provider -> cluster
// connections -> ALB security-group wiring (finding 2) can be observed live.
taskDefinition.addContainer("web", {
  image: aws.compute.ecs.ContainerImage.fromRegistry(
    "amazon/amazon-ecs-sample",
  ),
  memoryReservationMiB: 256,
  portMappings: [
    {
      containerPort: 80,
      hostPort: 8080,
      protocol: aws.compute.ecs.Protocol.TCP,
    },
  ],
});

const autoScalingGroup = new aws.compute.autoscaling.AutoScalingGroup(
  stack,
  "ASG",
  {
    vpc,
    instanceType: new aws.compute.InstanceType("t2.micro"),
    machineImage: aws.compute.ecs.EcsOptimizedImage.amazonLinux2(),
    vpcSubnets: { subnetType: aws.compute.SubnetType.PUBLIC },
    associatePublicIpAddress: true,
    minCapacity: 1,
    maxCapacity: 1,
    desiredCapacity: 1,
  },
);

const cp = new aws.compute.ecs.AsgCapacityProvider(
  stack,
  "EC2CapacityProvider",
  {
    autoScalingGroup,
    // This is to allow `terraform destroy` to work; otherwise deletion will
    // hang bc the ASG cannot be deleted while managed termination protection
    // is enabled (mandatory here, or the integ test's cleanup stage hangs).
    enableManagedTerminationProtection: false,
  },
);

cluster.addAsgCapacityProvider(cp);

const service = new aws.compute.ecs.Ec2Service(stack, "EC2Service", {
  cluster,
  taskDefinition,
  capacityProviderStrategies: [
    {
      capacityProvider: cp.capacityProviderName,
      weight: 1,
    },
  ],
  registerOutputs: true,
  outputName: "service",
});

// Grid addition (not in the upstream fixture): an internet-facing ALB target
// (borrowed from ec2/integ.lb-bridge-nw.ts) so the ASG-connections ->
// cluster.connections -> ALB security-group propagation fixed by
// `addAsgCapacityProvider()` (finding 2) is observable via the EC2 SDK on
// live security-group rules.
const lb = new aws.compute.ApplicationLoadBalancer(stack, "LB", {
  vpc,
  internetFacing: true,
  registerOutputs: true,
  outputName: "lb",
});
const listener = lb.addListener("PublicListener", { port: 80, open: true });
listener.addTargets("ECS", {
  port: 80,
  targets: [service],
});

// `AsgCapacityProvider` is a plain `Construct` (not an `AwsConstructBase`),
// so it has no `outputs`/`registerOutputs` of its own - surface its name
// explicitly for validation (finding 1's ARN/no-drift check, finding 3's
// singleton-merge check).
new TerraformOutput(stack, "capacity-provider-name", {
  value: cp.capacityProviderName,
});

// `AutoScalingGroup`'s `outputs` getter uses legacy prefixed keys
// (`autoScalingGroupName`/`autoScalingGroupArn`) and isn't registered here -
// surface the name explicitly instead (finding 1's ARN cross-check against
// autoscaling.DescribeAutoScalingGroups).
new TerraformOutput(stack, "asg-name", {
  value: cp.autoScalingGroup.autoScalingGroupName,
});

// The ALB's auto-created security group id - needed to identify (rather than
// heuristically guess) which SG must appear in the container-instance SG's
// ingress `UserIdGroupPairs` for finding 2.
new TerraformOutput(stack, "lb-security-group-id", {
  value: lb.connections.securityGroups[0].securityGroupId,
});

app.synth();
