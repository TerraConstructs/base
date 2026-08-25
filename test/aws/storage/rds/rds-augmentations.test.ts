// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/rds.test.ts
//
// Small, targeted check that the `declare module`/prototype-augmentation wiring in
// `rds-augmentations.generated.ts` actually attaches working `metric*()` methods to
// `DatabaseInstanceBase` and `DatabaseClusterBase` (mirrors the equivalent coverage for other
// generated-augmentation modules, e.g. `ec2-augmentations.generated.ts`).

import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as rds from "../../../../src/aws/storage/rds";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

let app: App;
let stack: AwsStack;
let vpc: compute.IVpc;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });
});

describe("rds-augmentations", () => {
  test("DatabaseInstance.metricCPUUtilization() returns a namespaced Metric on the right dimension", () => {
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
      }),
      vpc,
    });

    const metric = instance.metricCPUUtilization();

    expect(metric.namespace).toEqual("AWS/RDS");
    expect(metric.metricName).toEqual("CPUUtilization");
    expect(metric.statistic).toEqual("Average");
    expect(stack.resolve(metric.dimensions)).toEqual({
      DBInstanceIdentifier: stack.resolve(instance.instanceIdentifier),
    });
  });

  test("DatabaseCluster.metric('X') returns a namespaced Metric on the right dimension", () => {
    const cluster = new rds.DatabaseCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      writer: rds.ClusterInstance.serverlessV2("writer"),
    });

    const metric = cluster.metric("SomeMetric");

    expect(metric.namespace).toEqual("AWS/RDS");
    expect(metric.metricName).toEqual("SomeMetric");
    expect(stack.resolve(metric.dimensions)).toEqual({
      DBClusterIdentifier: stack.resolve(cluster.clusterIdentifier),
    });
  });
});
