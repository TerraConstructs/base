// Live test for the storage.docdb DatabaseCluster L2: a real DocumentDB
// cluster + one db.t3.medium instance deployed through the ported construct,
// with a generated master password attached via the attach() protocol
// (dbClusterIdentifier/engine "mongo"/ssl "true"/host/number-port merged into
// the DatabaseSecret -- the fields the MongoDB rotation Lambda requires).
//
// NOTE: the auto-generated DatabaseSecret has a deterministic name and no
// recovery-window override -- a re-run within 30 days of destroy needs
// `aws secretsmanager delete-secret --force-delete-without-recovery` first.
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "docdb.cluster";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g11111111-1111",
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

const cluster = new aws.storage.docdb.DatabaseCluster(stack, "Cluster", {
  masterUser: {
    username: "docadmin",
  },
  vpc,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
  instanceType: aws.compute.InstanceType.of(
    aws.compute.InstanceClass.T3,
    aws.compute.InstanceSize.MEDIUM,
  ),
  instances: 1,
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
