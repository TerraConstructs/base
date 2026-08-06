// Live test for the storage.rds DatabaseCluster L2 (RDS PR 2d): a real Aurora
// PostgreSQL SERVERLESS V2 cluster (the user-priority feature) with a
// serverlessV2 writer, Data API enabled, credentials auto-generated into a
// DatabaseSecret and merged via the attach() protocol
// (dbClusterIdentifier/engine/host/port/dbname).
//
// NOTE: the auto-generated DatabaseSecret has a deterministic name and no
// recovery-window override -- a re-run within 30 days of destroy needs
// `aws secretsmanager delete-secret --force-delete-without-recovery` first.
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "rds.cluster";

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

const cluster = new aws.storage.rds.DatabaseCluster(stack, "Cluster", {
  engine: aws.storage.rds.DatabaseClusterEngine.auroraPostgres({
    version: aws.storage.rds.AuroraPostgresEngineVersion.VER_16_4,
  }),
  vpc,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
  writer: aws.storage.rds.ClusterInstance.serverlessV2("writer"),
  serverlessV2MinCapacity: 0.5,
  serverlessV2MaxCapacity: 1,
  credentials: aws.storage.rds.Credentials.fromGeneratedSecret("clusteradmin"),
  defaultDatabaseName: "appdb",
  enableDataApi: true,
  backup: {
    retention: Duration.days(1),
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
new TerraformOutput(stack, "secret_arn", {
  value: cluster.secret!.secretArn,
  staticId: true,
});

app.synth();
