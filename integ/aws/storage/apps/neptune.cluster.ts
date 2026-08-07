// Live test for the storage.neptune DatabaseCluster L2 (alpha port): a real
// Neptune SERVERLESS cluster (db.serverless instance) deployed through the
// ported construct in an isolated VPC. Validates the aws_neptune_cluster /
// aws_neptune_cluster_instance mapping, the native serverless_v2 scaling
// block, and grid-scoped naming against live AWS.
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "neptune.cluster";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "gbbbbbbbb-bbbb",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const vpc = new aws.compute.Vpc(stack, "Vpc", {
  maxAzs: 2,
  natGateways: 0,
  subnetConfiguration: [
    {
      name: "isolated",
      subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED,
      cidrMask: 24,
    },
  ],
});

const cluster = new aws.storage.neptune.DatabaseCluster(stack, "Cluster", {
  vpc,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
  instanceType: aws.storage.neptune.InstanceType.SERVERLESS,
  serverlessScalingConfiguration: {
    minCapacity: 1,
    maxCapacity: 2.5,
  },
  // Terraform-native replacement for upstream removalPolicy: allow clean destroy.
  skipFinalSnapshot: true,
});

new TerraformOutput(stack, "cluster_identifier", {
  value: cluster.clusterIdentifier,
  staticId: true,
});
new TerraformOutput(stack, "cluster_endpoint_address", {
  value: cluster.clusterEndpoint.hostname,
  staticId: true,
});
new TerraformOutput(stack, "cluster_resource_identifier", {
  value: cluster.clusterResourceIdentifier,
  staticId: true,
});

app.synth();
