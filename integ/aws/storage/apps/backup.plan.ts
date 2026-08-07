// Live test for the storage.backup L2s: a real BackupVault + BackupPlan (daily
// rule via the static factory + a rule added AFTER construction — the
// block-typed-Lazy footgun proven live) + BackupSelection over a DynamoDB
// table and a tag condition. Validates the aws_backup_plan rule rendering,
// the standalone vault split-off resources, and the selection's IAM
// role/resource-ARN wiring against live AWS.
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "backup.plan";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "gdddddddd-dddd",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const table = new aws.storage.Table(stack, "Table", {
  partitionKey: { name: "pkey", type: aws.storage.AttributeType.STRING },
});

const vault = new aws.storage.backup.BackupVault(stack, "Vault", {
  // Terraform-native replacement for upstream removalPolicy: allow clean destroy.
  forceDestroy: true,
});

// Static factory (daily rule at construction) ...
const plan = aws.storage.backup.BackupPlan.daily35DayRetention(
  stack,
  "Plan",
  vault,
);
// ... plus a rule added AFTER construction: the live proof that the
// Lazy.anyValue rule-block design resolves post-construction accumulation.
plan.addRule(aws.storage.backup.BackupPlanRule.weekly());

const selection = plan.addSelection("Selection", {
  resources: [
    aws.storage.backup.BackupResource.fromDynamoDbTable(table),
    aws.storage.backup.BackupResource.fromTag("stage", "prod"),
  ],
});

new TerraformOutput(stack, "backup_plan_id", {
  value: plan.backupPlanId,
  staticId: true,
});
new TerraformOutput(stack, "backup_vault_name", {
  value: vault.backupVaultName,
  staticId: true,
});
new TerraformOutput(stack, "backup_vault_arn", {
  value: vault.backupVaultArn,
  staticId: true,
});
new TerraformOutput(stack, "selection_id", {
  value: selection.selectionId,
  staticId: true,
});
new TerraformOutput(stack, "table_arn", {
  value: table.tableArn,
  staticId: true,
});

app.synth();
