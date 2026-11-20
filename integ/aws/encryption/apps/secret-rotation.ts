// Live end-to-end test for `encryption.SecretRotation` (the SAR-backed rotation
// construct re-enabled in this PR): a real Postgres `aws_db_instance` in an
// isolated VPC, a Secrets Manager interface endpoint (private DNS) so the
// rotation Lambda can reach the Secrets Manager API without NAT, and a
// `SecretRotation` with the AWS-published
// `SecretsManagerRDSPostgreSQLRotationSingleUser` SAR application. The app
// leaves `rotateImmediatelyOnUpdate` at its default (true), so a real rotation
// runs right after apply -- the Go test polls `DescribeSecret.LastRotatedDate`
// to prove the SAR stack's Lambda actually rotated the master credentials.
//
// `excludeCharacters` deliberately contains `${` and `%{` to live-test
// `escapeTerraformTemplateLiteral` end-to-end (the value crosses two Terraform
// string-template contexts: the secret value and the SAR stack parameter map).
//
// The `RdsDbInstanceAttachmentTarget` adapter is the same TEST-ONLY pattern as
// apps/secret-attach.ts -- see the notes there.
import {
  dataAwsSecretsmanagerRandomPassword,
  dbInstance,
  dbSubnetGroup,
} from "@cdktn/provider-aws";
import { App, Fn, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "secret-rotation";

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

// Isolated VPC (no NAT): the rotation Lambda reaches the Secrets Manager API
// through the interface endpoint below, and the database through the VPC.
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

// Private DNS (default) makes the standard secretsmanager.<region>.amazonaws.com
// hostname resolve to this endpoint, so SecretRotation needs no explicit
// `endpoint` prop. The endpoint's default security group is open to the VPC CIDR.
vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
  service: aws.compute.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
});

const dbSecurityGroup = new aws.compute.SecurityGroup(
  stack,
  "DatabaseSecurityGroup",
  {
    vpc,
    description: "Postgres instance under rotation test",
  },
);

const subnetGroup = new dbSubnetGroup.DbSubnetGroup(stack, "DbSubnets", {
  name: `rotation-${stack.gridUUID}`,
  subnetIds: vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
});

const masterUsername = "dbadmin";

// Initial master password, generated out-of-band (same pattern as
// apps/secret-attach.ts). The SAR rotation Lambda replaces it on first rotation.
const masterPassword =
  new dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword(
    stack,
    "MasterPassword",
    {
      passwordLength: 20,
      excludePunctuation: true,
    },
  );

const database = new dbInstance.DbInstance(stack, "Database", {
  identifier: `db-${stack.gridUUID}`,
  engine: "postgres",
  instanceClass: "db.t3.micro",
  allocatedStorage: 20,
  dbName: "appdb",
  username: masterUsername,
  password: masterPassword.randomPassword,
  dbSubnetGroupName: subnetGroup.name,
  vpcSecurityGroupIds: [dbSecurityGroup.securityGroupId],
  skipFinalSnapshot: true,
  applyImmediately: true,
  publiclyAccessible: false,
  backupRetentionPeriod: 0,
  // Two reasons, both drift-oracle-verified: (1) the random-password DATA
  // source re-generates on every plan, and (2) after the SAR Lambda rotates
  // the credentials, the Terraform-held password is stale by design. Ignoring
  // password changes is the correct real-world pattern for a rotated DB.
  lifecycle: {
    ignoreChanges: ["password"],
  },
});

/**
 * TEST-ONLY adapter, copied from apps/secret-attach.ts -- supplies the
 * connection details that `attach()` folds into the secret value (Terraform has
 * no server-side `AWS::SecretsManager::SecretTargetAttachment` merge).
 */
class RdsDbInstanceAttachmentTarget
  implements aws.encryption.ISecretAttachmentTarget
{
  constructor(private readonly instance: dbInstance.DbInstance) {}

  public asSecretAttachmentTarget(): aws.encryption.SecretAttachmentTargetProps {
    return {
      targetId: this.instance.id,
      targetType: aws.encryption.AttachmentTargetType.RDS_DB_INSTANCE,
      connectionFields: {
        engine: this.instance.engine,
        host: this.instance.address,
        port: Fn.tostring(this.instance.port),
        dbname: this.instance.dbName,
      },
    };
  }
}

const credentialsSecret = new aws.encryption.Secret(stack, "Credentials", {
  registerOutputs: true,
  outputName: "secret",
  description: "Master credentials under SAR single-user rotation",
  // Force immediate deletion on destroy (no recovery window) so the
  // deterministic secret name can be re-used across repeated integ runs.
  recoveryWindow: Duration.days(0),
  secretObjectValue: {
    username: masterUsername,
    password: masterPassword.randomPassword,
  },
});

// attach() folds engine/host/port/dbname into the secret value -- the SAR
// single-user rotation Lambda requires them to reach the database.
const attachment = credentialsSecret.attach(
  new RdsDbInstanceAttachmentTarget(database),
);

new aws.encryption.SecretRotation(stack, "Rotation", {
  application: aws.encryption.SecretRotationApplication.POSTGRES_ROTATION_SINGLE_USER,
  secret: attachment,
  target: new aws.compute.Connections({
    defaultPort: aws.compute.Port.tcp(5432),
    securityGroups: [dbSecurityGroup],
  }),
  vpc,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
  // Includes `${` and `%{` on purpose -- template-literal escaping under live test.
  excludeCharacters: " ;+%{}${}@'\"`/\\",
});

new TerraformOutput(stack, "db_instance_identifier", {
  value: database.identifier,
  staticId: true,
});

app.synth();
