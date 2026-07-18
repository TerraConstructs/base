// Demonstrates `encryption.Secret.attach()` against a real target (an RDS
// `aws_db_instance`), composing the provider-aws RDS L1 the same way an
// upstream aws-rds `DatabaseInstance` would (see AGREED DESIGN in
// src/aws/encryption/secret.ts).
//
// IMPORTANT: `RdsDbInstanceAttachmentTarget` below is a TEST-ONLY adapter.
// TerraConstructs does not ship any concrete `ISecretAttachmentTarget`
// implementation in `src/` -- consumers of the library must provide their
// own (e.g. once aws-rds is ported) or copy a pattern like this one.
//
// Because the Terraform AWS provider has no equivalent of CloudFormation's
// `AWS::SecretsManager::SecretTargetAttachment` (no server-side merge of
// connection details into the secret value -- see the class doc on
// `SecretTargetAttachment`), the TARGET supplies the connection details via
// `asSecretAttachmentTarget().connectionFields`, and `attach()` merges them
// into the secret's single version. The `ConnectionsSecret` below is created
// with ONLY the base credentials (username + password); `attach()` folds in
// the DbInstance's engine/host/port/dbname -- so the deployed secret ends up
// with the full connection details WITHOUT this app pre-building the merge.
import {
  dataAwsSecretsmanagerRandomPassword,
  dbInstance,
} from "@cdktn/provider-aws";
import { App, Fn, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "secret-attach";

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

const masterUsername = "dbadmin";

// Generate the RDS master password out-of-band (no server-side merge is
// available in Terraform, so the DB's own credentials are not sourced from
// the "connections" secret below -- see module doc comment above).
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
  skipFinalSnapshot: true,
  applyImmediately: true,
  publiclyAccessible: false,
  backupRetentionPeriod: 0,
});

/**
 * TEST-ONLY adapter demonstrating how a concrete `ISecretAttachmentTarget`
 * would be implemented on top of the RDS L1 (`dbInstance.DbInstance`). This
 * pattern intentionally lives in the integ app, not in `src/` -- see the
 * "HARD CONSTRAINT" note on `ISecretAttachmentTarget` in
 * src/aws/encryption/secret.ts.
 */
class RdsDbInstanceAttachmentTarget
  implements aws.encryption.ISecretAttachmentTarget
{
  constructor(private readonly instance: dbInstance.DbInstance) {}

  public asSecretAttachmentTarget(): aws.encryption.SecretAttachmentTargetProps {
    return {
      targetId: this.instance.id,
      targetType: aws.encryption.AttachmentTargetType.RDS_DB_INSTANCE,
      // Terraform has no server-side merge, so the target supplies the
      // connection details that attach() folds into the secret value.
      connectionFields: {
        engine: this.instance.engine,
        host: this.instance.address,
        // `port` is a number attribute; force a Terraform `tostring()` so the
        // merged JSON value is a string (connectionFields is a string map).
        port: Fn.tostring(this.instance.port),
        dbname: this.instance.dbName,
      },
    };
  }
}

// Created with ONLY the base credentials (username + password); attach() below
// folds in the target's engine/host/port/dbname -- this app does NOT pre-build
// the merged connection value.
const connectionsSecret = new aws.encryption.Secret(stack, "Connections", {
  registerOutputs: true,
  outputName: "secret",
  description: "RDS connection details for the attached database instance",
  // Force immediate deletion on destroy (no 7-30 day recovery window) so the
  // deterministic secret name can be re-used across repeated integ runs.
  recoveryWindow: Duration.days(0),
  secretObjectValue: {
    username: masterUsername,
    password: masterPassword.randomPassword,
  },
});

// attach() links the secret to the target, merges the target's connectionFields
// into the secret's single version, and forwards addToResourcePolicy() calls so
// only a single aws_secretsmanager_secret_policy is ever created.
const attachment = connectionsSecret.attach(
  new RdsDbInstanceAttachmentTarget(database),
);

new TerraformOutput(stack, "attachment_secret_arn", {
  value: attachment.secretArn,
  staticId: true,
});

new TerraformOutput(stack, "db_instance_identifier", {
  value: database.identifier,
  staticId: true,
});

app.synth();
