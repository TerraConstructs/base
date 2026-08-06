// Live test for the RDS foundations PR (storage.rds): SubnetGroup,
// ParameterGroup (BOTH bind paths -- aws_db_parameter_group AND
// aws_rds_cluster_parameter_group from one L2, mirroring upstream
// bindToInstance/bindToCluster), OptionGroup (with a real MariaDB audit-plugin
// option block), and DatabaseSecret. No database instances -- every resource
// here is free/instant, the point is the Terraform mapping round-trip.
//
// TERRACONSTRUCTS DEVIATION: upstream engines (rds.DatabaseInstanceEngine.*)
// live in instance-engine.ts/cluster-engine.ts which land in RDS PR 2b; the
// minimal IEngine literals below carry only the fields these constructs read
// (same stand-in idiom as test/aws/storage/rds/parameter-group.test.ts).
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "rds.groups";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g99999999-9999",
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

const subnetGroup = new aws.storage.rds.SubnetGroup(stack, "SubnetGroup", {
  vpc,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
  description: "RDS foundations integ subnet group",
});

// One ParameterGroup L2 exercised through BOTH provider resources.
const instanceParams = new aws.storage.rds.ParameterGroup(
  stack,
  "InstanceParams",
  {
    engine: {
      engineType: "postgres",
      parameterGroupFamily: "postgres16",
    },
    description: "instance-bound parameter group",
    parameters: {
      log_connections: "1",
    },
  },
);
instanceParams.bindToInstance({});

const clusterParams = new aws.storage.rds.ParameterGroup(
  stack,
  "ClusterParams",
  {
    engine: {
      engineType: "aurora-postgresql",
      parameterGroupFamily: "aurora-postgresql16",
    },
    description: "cluster-bound parameter group",
    parameters: {
      log_connections: "1",
    },
  },
);
clusterParams.bindToCluster({});

const optionGroup = new aws.storage.rds.OptionGroup(stack, "Options", {
  engine: {
    engineType: "mariadb",
    engineVersion: { majorVersion: "10.6", fullVersion: "10.6" },
    parameterGroupFamily: "mariadb10.6",
  },
  description: "mariadb audit plugin option group",
  configurations: [
    {
      name: "MARIADB_AUDIT_PLUGIN",
      settings: {
        SERVER_AUDIT_EVENTS: "CONNECT",
      },
    },
  ],
});

const secret = new aws.storage.rds.DatabaseSecret(stack, "Secret", {
  username: "dbadmin",
  // Force immediate deletion on destroy so the deterministic secret name can
  // be re-created across repeated integ runs (run 2 failed on the 30-day
  // recovery window from run 1's destroy).
  recoveryWindow: Duration.days(0),
});

new TerraformOutput(stack, "subnet_group_name", {
  value: subnetGroup.subnetGroupName,
  staticId: true,
});
new TerraformOutput(stack, "instance_parameter_group_name", {
  value: instanceParams.bindToInstance({}).parameterGroupName,
  staticId: true,
});
new TerraformOutput(stack, "cluster_parameter_group_name", {
  value: clusterParams.bindToCluster({}).parameterGroupName,
  staticId: true,
});
new TerraformOutput(stack, "option_group_name", {
  value: optionGroup.optionGroupName,
  staticId: true,
});
new TerraformOutput(stack, "secret_arn", {
  value: secret.secretArn,
  staticId: true,
});

app.synth();
