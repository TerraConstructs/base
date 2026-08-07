// Live test for the storage.redshift Cluster L2 (scope-reduced alpha port): a real
// single-node ra3.large Redshift cluster deployed through the ported construct in an
// isolated VPC. Validates the aws_redshift_cluster mapping, the generated-secret
// master-password double-freeze (drift oracle), the ClusterParameterGroup attachment,
// IAM role association plus the native default_iam_role_arn deviation
// (upstream: AwsCustomResource), and grid-scoped lowercased naming against live AWS.
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "redshift.cluster";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "gcccccccc-cccc",
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

const role = new aws.iam.Role(stack, "ClusterRole", {
  assumedBy: new aws.iam.ServicePrincipal("redshift.amazonaws.com"),
});

const parameterGroup = new aws.storage.redshift.ClusterParameterGroup(
  stack,
  "Params",
  {
    description: "Redshift integ cluster parameter group",
    parameters: {
      require_ssl: "true",
    },
  },
);

const cluster = new aws.storage.redshift.Cluster(stack, "Cluster", {
  // No masterPassword: exercises the generated DatabaseSecret + the
  // master_password ignore_changes double-freeze (validated by the drift oracle).
  masterUser: {
    masterUsername: "admin",
  },
  vpc,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
  clusterType: aws.storage.redshift.ClusterType.SINGLE_NODE,
  nodeType: aws.storage.redshift.NodeType.RA3_LARGE,
  parameterGroup,
  roles: [role],
  // Exercises the native default_iam_role_arn deviation (upstream shells out to
  // modifyClusterIamRoles via an AwsCustomResource).
  defaultRole: role,
  // Terraform-native replacement for upstream removalPolicy: allow clean destroy.
  skipFinalSnapshot: true,
});

new TerraformOutput(stack, "cluster_identifier", {
  value: cluster.clusterName,
  staticId: true,
});
new TerraformOutput(stack, "cluster_endpoint_address", {
  value: cluster.clusterEndpoint.hostname,
  staticId: true,
});
new TerraformOutput(stack, "parameter_group_name", {
  value: parameterGroup.clusterParameterGroupName,
  staticId: true,
});
new TerraformOutput(stack, "default_role_arn", {
  value: role.roleArn,
  staticId: true,
});
new TerraformOutput(stack, "secret_arn", {
  value: cluster.secret!.secretArn,
  staticId: true,
});

app.synth();
