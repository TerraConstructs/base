// Live test for the storage.s3tables L2s (alpha port): a real S3 Tables
// TableBucket + Namespace + ICEBERG Table with a compaction-only maintenance
// configuration — the one-sided maintenance_configuration shape (absent
// snapshot_management member rendered null-filled) proven against live AWS,
// including the post-apply drift oracle.
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "s3tables.table";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "geeeeeeee-eeee",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const bucket = new aws.storage.s3tables.TableBucket(stack, "Bucket", {
  tableBucketName: "tcons-s3tables-integ",
  // Terraform-native destroy of a non-empty table bucket.
  forceDestroy: true,
});

const namespace = new aws.storage.s3tables.Namespace(stack, "Namespace", {
  namespaceName: "integ_ns",
  tableBucket: bucket,
});

const table = new aws.storage.s3tables.Table(stack, "Table", {
  tableName: "integ_table",
  namespace,
  openTableFormat: aws.storage.s3tables.OpenTableFormat.ICEBERG,
  // Compaction WITHOUT snapshotManagement: the one-sided maintenance shape
  // (absent side rendered with AWS's documented server-side defaults).
  compaction: {
    status: aws.storage.s3tables.Status.ENABLED,
    targetFileSizeMb: 128,
  },
});

// The mirror one-sided shape: snapshotManagement WITHOUT compaction, proving
// the AWS-defaults fill for the compaction side too.
const snapshotTable = new aws.storage.s3tables.Table(stack, "SnapshotTable", {
  tableName: "integ_snapshot_table",
  namespace,
  openTableFormat: aws.storage.s3tables.OpenTableFormat.ICEBERG,
  snapshotManagement: {
    status: aws.storage.s3tables.Status.ENABLED,
    maxSnapshotAgeHours: 48,
    minSnapshotsToKeep: 3,
  },
});

new TerraformOutput(stack, "table_bucket_arn", {
  value: bucket.tableBucketArn,
  staticId: true,
});
new TerraformOutput(stack, "table_bucket_name", {
  value: bucket.tableBucketName,
  staticId: true,
});
new TerraformOutput(stack, "namespace_name", {
  value: namespace.namespaceName,
  staticId: true,
});
new TerraformOutput(stack, "table_name", {
  value: table.tableName,
  staticId: true,
});
new TerraformOutput(stack, "table_arn", {
  value: table.tableArn,
  staticId: true,
});
new TerraformOutput(stack, "snapshot_table_name", {
  value: snapshotTable.tableName,
  staticId: true,
});

app.synth();
