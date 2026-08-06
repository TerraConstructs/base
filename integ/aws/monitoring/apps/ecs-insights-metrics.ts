// Adapted from
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/%40aws-cdk-testing/framework-integ/test/aws-ecs/test/integ.cluster-enhanced-container-insights.ts
//
// Extended beyond the upstream test (which only asserts the cluster setting): each
// `ECS/ContainerInsights` canned metric on BaseService creates a CloudWatch alarm, so
// the Go validation can read the deployed monitors back and verify their configured
// namespace, metric name, dimensions, statistic, and period. It validates the deployed
// cluster setting and alarm configuration, not runtime metric publication — CloudWatch
// accepts alarms on metric/dimension combinations that have not emitted data yet.

import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "ecs-insights-metrics";

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

// Cheapest possible network for this fixture: 2 AZs, no NAT Gateways. Tasks get
// `assignPublicIp: true` below so they can pull the "nginx" image and ship
// Container Insights telemetry without a NAT Gateway.
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

const cluster = new aws.compute.ecs.Cluster(stack, "Cluster", {
  vpc,
  containerInsightsV2: aws.compute.ecs.ContainerInsights.ENHANCED,
  registerOutputs: true,
  outputName: "cluster",
});

const taskDefinition = new aws.compute.ecs.FargateTaskDefinition(
  stack,
  "TaskDef",
  {
    memoryLimitMiB: 512,
    cpu: 256,
  },
);

taskDefinition.addContainer("nginx", {
  image: aws.compute.ecs.ContainerImage.fromRegistry("nginx"),
});

const service = new aws.compute.ecs.FargateService(stack, "Service", {
  cluster,
  taskDefinition,
  assignPublicIp: true,
  registerOutputs: true,
  outputName: "service",
});

// Monitors on the ECS/ContainerInsights canned metrics. Thresholds are absolute
// (MiB / CPU units), unlike the AWS/ECS percentage metrics.
const memoryUtilizedAlarm = service
  .metricMemoryUtilized()
  .createAlarm(stack, "MemoryUtilizedAlarm", {
    threshold: 512,
    evaluationPeriods: 1,
  });

const memoryReservedAlarm = service
  .metricMemoryReserved()
  .createAlarm(stack, "MemoryReservedAlarm", {
    threshold: 512,
    evaluationPeriods: 1,
  });

const cpuUtilizedAlarm = service
  .metricCpuUtilized()
  .createAlarm(stack, "CpuUtilizedAlarm", {
    threshold: 256,
    evaluationPeriods: 1,
  });

const cpuReservedAlarm = service
  .metricCpuReserved()
  .createAlarm(stack, "CpuReservedAlarm", {
    threshold: 256,
    evaluationPeriods: 1,
  });

// Escape hatch for Container Insights metrics without a canned helper.
const ephemeralStorageAlarm = service
  .metricContainerInsights("EphemeralStorageUtilized")
  .createAlarm(stack, "EphemeralStorageAlarm", {
    threshold: 20, // GB — EphemeralStorageUtilized is reported in GB; Fargate's default capacity is 20 GB
    evaluationPeriods: 1,
  });

// HACK: This is a workaround for createAlarmOptions missing AwsConstructProps (registerOutputs)
new TerraformOutput(stack, "memory_utilized_alarm", {
  value: memoryUtilizedAlarm.alarmOutputs,
  staticId: true,
});
new TerraformOutput(stack, "memory_reserved_alarm", {
  value: memoryReservedAlarm.alarmOutputs,
  staticId: true,
});
new TerraformOutput(stack, "cpu_utilized_alarm", {
  value: cpuUtilizedAlarm.alarmOutputs,
  staticId: true,
});
new TerraformOutput(stack, "cpu_reserved_alarm", {
  value: cpuReservedAlarm.alarmOutputs,
  staticId: true,
});
new TerraformOutput(stack, "ephemeral_storage_alarm", {
  value: ephemeralStorageAlarm.alarmOutputs,
  staticId: true,
});
app.synth();
