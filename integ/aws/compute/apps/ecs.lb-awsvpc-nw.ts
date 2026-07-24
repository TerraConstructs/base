// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/fargate/integ.lb-awsvpc-nw.ts

import { App, LocalBackend } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "ecs.lb-awsvpc-nw";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g22222222-2222",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Cheapest possible network for this fixture: 2 AZs, no NAT Gateways (upstream uses a
// full ec2.Vpc with default NAT gateways per AZ). Both the FargateService tasks
// (assignPublicIp: true below) and the internet-facing ApplicationLoadBalancer live in
// the same PUBLIC subnets, so tasks can pull the "amazon/amazon-ecs-sample" image from
// Docker Hub without paying for a NAT Gateway.
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

const cluster = new aws.compute.ecs.Cluster(stack, "FargateCluster", {
  vpc,
  registerOutputs: true,
  outputName: "cluster",
});

const taskDefinition = new aws.compute.ecs.FargateTaskDefinition(
  stack,
  "TaskDef",
  {
    memoryLimitMiB: 1024,
    cpu: 512,
    registerOutputs: true,
    outputName: "task-definition",
  },
);

taskDefinition.addContainer("web", {
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

const service = new aws.compute.ecs.FargateService(stack, "Service", {
  cluster,
  taskDefinition,
  assignPublicIp: true,
  registerOutputs: true,
  outputName: "service",
});

const scaling = service.autoScaleTaskCount({ maxCapacity: 10 });
// Quite low to try and force it to scale
scaling.scaleOnCpuUtilization("ReasonableCpu", {
  targetUtilizationPercent: 10,
});

const lb = new aws.compute.ApplicationLoadBalancer(stack, "LB", {
  vpc,
  internetFacing: true,
  registerOutputs: true,
  outputName: "lb",
});
const listener = lb.addListener("PublicListener", { port: 80, open: true });
listener.addTargets("Fargate", {
  port: 80,
  targets: [service],
});

app.synth();
