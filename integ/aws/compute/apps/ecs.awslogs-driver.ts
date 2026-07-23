// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/fargate/integ.awslogs-driver.ts

import { App, LocalBackend } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "ecs.awslogs-driver";

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
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Cheapest possible network for this fixture: 2 AZs, no NAT Gateways (upstream
// uses a full ec2.Vpc with default NAT gateways per AZ). FargateService falls
// back to PUBLIC subnets by default since no PRIVATE_WITH_EGRESS/ISOLATED
// subnets exist, but tasks still need `assignPublicIp: true` below to reach
// the internet (pull the "nginx" image, ship logs to CloudWatch) without a
// NAT Gateway.
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

const logGroup = new aws.cloudwatch.LogGroup(stack, "LogGroup", {
  registerOutputs: true,
  outputName: "log-group",
});

taskDefinition.addContainer("nginx", {
  image: aws.compute.ecs.ContainerImage.fromRegistry("nginx"),
  logging: aws.compute.ecs.LogDrivers.awsLogs({
    streamPrefix: "test",
    logGroup,
  }),
});

new aws.compute.ecs.FargateService(stack, "Service", {
  cluster,
  taskDefinition,
  assignPublicIp: true,
  registerOutputs: true,
  outputName: "service",
});

app.synth();
