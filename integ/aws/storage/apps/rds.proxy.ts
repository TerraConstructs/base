// Live test for the storage.rds DatabaseProxy L2 (RDS PR 2e): a real RDS
// Proxy fronting a MySQL db.t3.micro deployed through the DatabaseInstance L2,
// authenticating via the instance's generated DatabaseSecret. Exercises the
// CfnDBProxyTargetGroup -> aws_db_proxy_default_target_group + aws_db_proxy_target
// resource split and the proxy role's secret grants.
//
// ServerlessCluster v1 (also in this PR) is deliberately NOT live-tested: AWS
// retired Aurora Serverless v1 (engine_mode "serverless" is no longer
// creatable) -- the L2 ships deprecation-marked for API/migration parity with
// unit-level validation only (see serverless-cluster.ts class docs).
//
// NOTE: the auto-generated DatabaseSecret has a deterministic name and no
// recovery-window override -- a re-run within 30 days of destroy needs
// `aws secretsmanager delete-secret --force-delete-without-recovery` first.
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "rds.proxy";

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

const instance = new aws.storage.rds.DatabaseInstance(stack, "Database", {
  // Major-only version: AWS picks the latest available minor, sidestepping
  // the retired-minor-version trap the rds.cluster fixture hit.
  engine: aws.storage.rds.DatabaseInstanceEngine.mysql({
    version: aws.storage.rds.MysqlEngineVersion.VER_8_0,
  }),
  instanceType: aws.compute.InstanceType.of(
    aws.compute.InstanceClass.BURSTABLE3,
    aws.compute.InstanceSize.MICRO,
  ),
  vpc,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
  credentials: aws.storage.rds.Credentials.fromGeneratedSecret("dbadmin"),
  allocatedStorage: 20,
  backupRetention: Duration.days(0),
  multiAz: false,
  skipFinalSnapshot: true,
});

const proxy = new aws.storage.rds.DatabaseProxy(stack, "Proxy", {
  proxyTarget: aws.storage.rds.ProxyTarget.fromInstance(instance),
  secrets: [instance.secret!],
  vpc,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
});

new TerraformOutput(stack, "proxy_name", {
  value: proxy.dbProxyName,
  staticId: true,
});
new TerraformOutput(stack, "proxy_arn", {
  value: proxy.dbProxyArn,
  staticId: true,
});
new TerraformOutput(stack, "instance_identifier", {
  value: instance.instanceIdentifier,
  staticId: true,
});

app.synth();
