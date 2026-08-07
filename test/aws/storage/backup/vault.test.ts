// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/test/vault.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note -- see the identical notes in `../../../../src/aws/storage/backup/vault.ts`.

import {
  backupVault,
  backupVaultLockConfiguration,
  backupVaultNotifications,
  backupVaultPolicy,
  dataAwsIamPolicyDocument,
  iamRolePolicy,
} from "@cdktn/provider-aws";
import { App, Lazy, TerraformVariable, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import { ArnFormat } from "../../../../src/aws/arn";
import * as encryption from "../../../../src/aws/encryption";
import * as iam from "../../../../src/aws/iam";
import * as sns from "../../../../src/aws/notify";
import * as backup from "../../../../src/aws/storage/backup/vault";
import { Duration } from "../../../../src/duration";
import { Fn } from "../../../../src/terra-func";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

function testStack(app?: App, stackId?: string): AwsStack {
  return new AwsStack(app ?? Testing.app(), stackId ?? "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}

let stack: AwsStack;
beforeEach(() => {
  stack = testStack();
});

test("create a vault", () => {
  // WHEN
  new backup.BackupVault(stack, "Vault");

  // THEN
  // TERRACONSTRUCTS DEVIATION: upstream asserts the literal logical-id-derived name `'Vault'`
  // (CFN's default `BackupVaultName` fallback via `Names.uniqueId`). This repo's
  // `uniqueVaultName()` uses the gridUUID-scoped `uniqueResourceName` idiom instead (see the note
  // on that method), so an omitted `backupVaultName` synthesizes to a longer, stack-path-derived
  // name -- assert existence/shape rather than upstream's literal.
  const t = new Template(stack);
  t.resourceCountIs(backupVault.BackupVault, 1);
  const [vaultResource] = t.resourceTypeArray(backupVault.BackupVault) as {
    name: string;
  }[];
  expect(vaultResource.name).toMatch(/^[a-zA-Z0-9\-_]{2,50}$/);
  // TERRACONSTRUCTS DEVIATION: unlike upstream (which always renders an `AccessPolicy` property,
  // just an empty/undefined one), a vault created without `accessPolicy`/
  // `blockRecoveryPointDeletion` never synthesizes the standalone `aws_backup_vault_policy`
  // resource (nor its backing `data.aws_iam_policy_document`) at all -- see the note on
  // `BackupVaultProps.accessPolicy`.
  t.resourceCountIs(backupVaultPolicy.BackupVaultPolicy, 0);
  t.dataSourceCountIs(dataAwsIamPolicyDocument.DataAwsIamPolicyDocument, 0);
});

test("with access policy", () => {
  // GIVEN
  const accessPolicy = new iam.PolicyDocument(stack, "VaultAccessPolicy");
  accessPolicy.addStatements(
    new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      principals: [new iam.AnyPrincipal()],
      actions: ["backup:DeleteRecoveryPoint"],
      resources: ["*"],
      condition: [
        {
          test: "StringNotLike",
          variable: "aws:userId",
          values: ["user-arn"],
        },
      ],
    }),
  );

  // WHEN
  new backup.BackupVault(stack, "Vault", {
    accessPolicy,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          effect: "Deny",
          principals: [{ type: "AWS", identifiers: ["*"] }],
          actions: ["backup:DeleteRecoveryPoint"],
          resources: ["*"],
          condition: [
            {
              test: "StringNotLike",
              variable: "aws:userId",
              values: ["user-arn"],
            },
          ],
        },
      ],
    },
  );
  t.resourceCountIs(backupVaultPolicy.BackupVaultPolicy, 1);
});

test("with blockRecoveryPointDeletion", () => {
  // WHEN
  new backup.BackupVault(stack, "Vault", {
    blockRecoveryPointDeletion: true,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          effect: "Deny",
          principals: [{ type: "AWS", identifiers: ["*"] }],
          actions: [
            "backup:DeleteRecoveryPoint",
            "backup:UpdateRecoveryPointLifecycle",
          ],
          resources: ["*"],
        },
      ],
    },
  );
});

test("merges statements from accessPolicy and blockRecoveryPointDeletion", () => {
  // GIVEN
  const accessPolicy = new iam.PolicyDocument(stack, "VaultAccessPolicy");
  accessPolicy.addStatements(
    new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      principals: [
        new iam.ArnPrincipal("arn:aws:iam::123456789012:role/MyRole"),
      ],
      actions: ["backup:StartRestoreJob"],
    }),
  );

  // WHEN
  new backup.BackupVault(stack, "Vault", {
    accessPolicy,
    blockRecoveryPointDeletion: true,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["backup:StartRestoreJob"],
          effect: "Deny",
          principals: [
            {
              type: "AWS",
              identifiers: ["arn:aws:iam::123456789012:role/MyRole"],
            },
          ],
        },
        {
          effect: "Deny",
          principals: [{ type: "AWS", identifiers: ["*"] }],
          actions: [
            "backup:DeleteRecoveryPoint",
            "backup:UpdateRecoveryPointLifecycle",
          ],
          resources: ["*"],
        },
      ],
    },
  );
});

test("addToAccessPolicy()", () => {
  // GIVEN
  const vault = new backup.BackupVault(stack, "Vault");

  // WHEN
  vault.addToAccessPolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      principals: [
        new iam.ArnPrincipal("arn:aws:iam::123456789012:role/MyRole"),
      ],
      actions: ["backup:StartRestoreJob"],
    }),
  );

  // THEN
  const t = new Template(stack);
  t.expect.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["backup:StartRestoreJob"],
          effect: "Deny",
          principals: [
            {
              type: "AWS",
              identifiers: ["arn:aws:iam::123456789012:role/MyRole"],
            },
          ],
        },
      ],
    },
  );
  t.resourceCountIs(backupVaultPolicy.BackupVaultPolicy, 1);
});

test("blockRecoveryPointDeletion()", () => {
  // GIVEN
  const vault = new backup.BackupVault(stack, "Vault");

  // WHEN
  vault.blockRecoveryPointDeletion();

  // THEN
  const t = new Template(stack);
  t.expect.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          effect: "Deny",
          principals: [{ type: "AWS", identifiers: ["*"] }],
          actions: [
            "backup:DeleteRecoveryPoint",
            "backup:UpdateRecoveryPointLifecycle",
          ],
          resources: ["*"],
        },
      ],
    },
  );
});

test("with encryption key", () => {
  // GIVEN
  const encryptionKey = new encryption.Key(stack, "Key");

  // WHEN
  new backup.BackupVault(stack, "Vault", {
    encryptionKey,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(backupVault.BackupVault, {
    kms_key_arn: stack.resolve(encryptionKey.keyArn),
  });
});

test("with forceDestroy", () => {
  // TERRACONSTRUCTS DEVIATION: `forceDestroy` is the native `aws_backup_vault` replacement for
  // upstream's dropped `removalPolicy` -- see the note on `BackupVaultProps.forceDestroy`.
  // WHEN
  new backup.BackupVault(stack, "Vault", {
    forceDestroy: true,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(backupVault.BackupVault, {
    force_destroy: true,
  });
});

test("with notifications", () => {
  // GIVEN
  const topic = new sns.Topic(stack, "Topic");

  // WHEN
  new backup.BackupVault(stack, "Vault", {
    notificationTopic: topic,
    notificationEvents: [
      backup.BackupVaultEvents.BACKUP_JOB_COMPLETED,
      backup.BackupVaultEvents.COPY_JOB_FAILED,
    ],
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    backupVaultNotifications.BackupVaultNotifications,
    {
      backup_vault_events: ["BACKUP_JOB_COMPLETED", "COPY_JOB_FAILED"],
      sns_topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("defaults to all notifications", () => {
  // GIVEN
  const topic = new sns.Topic(stack, "Topic");

  // WHEN
  new backup.BackupVault(stack, "Vault", {
    notificationTopic: topic,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    backupVaultNotifications.BackupVaultNotifications,
    {
      backup_vault_events: Object.values(backup.BackupVaultEvents),
      sns_topic_arn: stack.resolve(topic.topicArn),
    },
  );
});

test("import from arn", () => {
  // WHEN
  const vaultArn = stack.formatArn({
    service: "backup",
    resource: "backup-vault",
    resourceName: "myVaultName",
    arnFormat: ArnFormat.COLON_RESOURCE_NAME,
  });
  const vault = backup.BackupVault.fromBackupVaultArn(stack, "Vault", vaultArn);

  // THEN
  expect(vault.backupVaultName).toEqual("myVaultName");
  expect(vault.backupVaultArn).toEqual(vaultArn);
});

test("import from arn should throw if arn format is incorrect", () => {
  // WHEN
  const vaultArn = stack.formatArn({
    service: "backup",
    resource: "backup-vault",
    resourceName: "myVaultName",
    arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
  });

  expect(() =>
    backup.BackupVault.fromBackupVaultArn(stack, "Vault", vaultArn),
  ).toThrow(
    /has the wrong format, expected arn:aws:service:region:account:resource:resourceName/,
  );
});

test("import from name", () => {
  // WHEN
  const vaultName = "myVaultName";
  const vault = backup.BackupVault.fromBackupVaultName(
    stack,
    "Vault",
    vaultName,
  );

  // THEN
  expect(vault.backupVaultName).toEqual(vaultName);
  expect(vault.backupVaultArn).toEqual(
    stack.formatArn({
      service: "backup",
      resource: "backup-vault",
      resourceName: "myVaultName",
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    }),
  );
});

test("specify imported value as vault name", () => {
  // WHEN
  const vaultName = Fn.importValue(stack, "VaultName");
  new backup.BackupVault(stack, "Vault", {
    backupVaultName: vaultName,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(backupVault.BackupVault, {
    name: "${var.VaultName}",
  });
});

test("grant action", () => {
  // GIVEN
  const vaultName = "myVaultName";
  const vault = backup.BackupVault.fromBackupVaultName(
    stack,
    "Vault",
    vaultName,
  );
  const role = new iam.Role(stack, "role", {
    assumedBy: new iam.ServicePrincipal("lambda"),
  });

  // WHEN
  vault.grant(role, "backup:StartBackupJob");

  // THEN
  const t = new Template(stack);
  t.resourceCountIs(iamRolePolicy.IamRolePolicy, 1);
  t.expect.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["backup:StartBackupJob"],
          effect: "Allow",
          resources: [stack.resolve(vault.backupVaultArn)],
        },
      ],
    },
  );
});

test("throw when grant action includes wildcard", () => {
  // GIVEN
  const vaultName = "myVaultName";
  const vault = backup.BackupVault.fromBackupVaultName(
    stack,
    "Vault",
    vaultName,
  );
  const role = new iam.Role(stack, "role", {
    assumedBy: new iam.ServicePrincipal("lambda"),
  });

  // WHEN / THEN
  expect(() => vault.grant(role, "backup:*")).toThrow(
    /AWS Backup access policies don't support a wildcard in the Action key\./,
  );
});

test("throws with invalid name", () => {
  expect(
    () =>
      new backup.BackupVault(stack, "Vault", {
        backupVaultName: "Hello!Inv@lid",
      }),
  ).toThrow(/Expected vault name to match pattern/);
});

test("throws with whitespace in name", () => {
  expect(
    () =>
      new backup.BackupVault(stack, "Vault", {
        backupVaultName: "Hello Invalid",
      }),
  ).toThrow(/Expected vault name to match pattern/);
});

test("throws with too short name", () => {
  expect(
    () =>
      new backup.BackupVault(stack, "Vault", {
        backupVaultName: "x",
      }),
  ).toThrow(/Expected vault name to match pattern/);
});

test("with lock configuration", () => {
  // WHEN
  new backup.BackupVault(stack, "Vault", {
    lockConfiguration: {
      minRetention: Duration.days(30),
      maxRetention: Duration.days(365),
      changeableFor: Duration.days(7),
    },
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    backupVaultLockConfiguration.BackupVaultLockConfiguration,
    {
      changeable_for_days: 7,
      max_retention_days: 365,
      min_retention_days: 30,
    },
  );
});

test("throws with incorrect lock configuration - min retention", () => {
  expect(
    () =>
      new backup.BackupVault(stack, "Vault", {
        lockConfiguration: {
          minRetention: Duration.hours(12),
        },
      }),
  ).toThrow(/The shortest minimum retention period you can specify is 1 day/);
});

test("throws with incorrect lock configuration - max retention", () => {
  expect(
    () =>
      new backup.BackupVault(stack, "Vault", {
        lockConfiguration: {
          minRetention: Duration.days(7),
          maxRetention: Duration.days(40000),
        },
      }),
  ).toThrow(
    /The longest maximum retention period you can specify is 36500 days/,
  );
});

test("throws with incorrect lock configuration - max and min retention", () => {
  expect(
    () =>
      new backup.BackupVault(stack, "Vault", {
        lockConfiguration: {
          minRetention: Duration.days(7),
          maxRetention: Duration.days(4),
        },
      }),
  ).toThrow(
    /The maximum retention period \(4 days\) must be greater than the minimum retention period \(7 days\)/,
  );
});

test("throws with incorrect lock configuration - changeable for", () => {
  expect(
    () =>
      new backup.BackupVault(stack, "Vault", {
        lockConfiguration: {
          minRetention: Duration.days(7),
          changeableFor: Duration.days(1),
        },
      }),
  ).toThrow(
    /AWS Backup enforces a 72-hour cooling-off period before Vault Lock takes effect and becomes immutable/,
  );
});

test("lock configuration with tokenized minRetention renders a reference", () => {
  // GIVEN
  // TERRACONSTRUCTS DEVIATION: upstream uses `CfnParameter`, this repo's `TerraformVariable`
  // (used the same way -- an unresolved Token at synth time) is the TerraConstructs-native
  // stand-in (mirrors `../docdb/cluster.test.ts`'s equivalent adaptation).
  const minRetentionDays = new TerraformVariable(stack, "MinRetentionDays", {
    type: "number",
    default: 30,
  });

  // WHEN
  new backup.BackupVault(stack, "Vault", {
    lockConfiguration: {
      minRetention: Duration.days(minRetentionDays.numberValue),
      maxRetention: Duration.days(365),
      changeableFor: Duration.days(7),
    },
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    backupVaultLockConfiguration.BackupVaultLockConfiguration,
    {
      changeable_for_days: 7,
      max_retention_days: 365,
      min_retention_days: "${var.MinRetentionDays}",
    },
  );
});

test("does not throw when maxRetention and changeableFor are tokens", () => {
  expect(
    () =>
      new backup.BackupVault(stack, "Vault", {
        lockConfiguration: {
          minRetention: Duration.days(7),
          maxRetention: Duration.days(Lazy.numberValue({ produce: () => 365 })),
          changeableFor: Duration.days(Lazy.numberValue({ produce: () => 7 })),
        },
      }),
  ).not.toThrow();
});
