// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/vault.ts

import {
  backupVault,
  backupVaultLockConfiguration,
  backupVaultNotifications,
  backupVaultPolicy,
} from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import type { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import { ArnFormat } from "../../arn";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import { AwsStack } from "../../aws-stack";
import type * as encryption from "../../encryption";
import * as iam from "../../iam";
import type * as sns from "../../notify";

/**
 * A backup vault
 *
 * TODO: omitted — upstream also extends `aws_backup.IBackupVaultRef`, a CloudFormation
 * cross-stack "Reference" marker interface generated from the CFN resource spec.
 * TerraConstructs has no equivalent generated-reference layer (identical omission to
 * `dbClusterRef` on `IDatabaseCluster` in `../docdb/cluster-ref.ts`), so `backupVaultRef` is
 * dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/vault.ts#L14-L19
 */
export interface IBackupVault extends IAwsConstruct {
  /**
   * The name of a logical container where backups are stored.
   *
   * @attribute
   */
  readonly backupVaultName: string;

  /**
   * The ARN of the backup vault.
   *
   * @attribute
   */
  readonly backupVaultArn: string;

  /**
   * Grant the actions defined in actions to the given grantee
   * on this backup vault.
   */
  grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant;
}

/**
 * Properties for a BackupVault
 */
export interface BackupVaultProps extends AwsConstructProps {
  /**
   * The name of a logical container where backups are stored. Backup vaults
   * are identified by names that are unique to the account used to create
   * them and the AWS Region where they are created.
   *
   * @default - A CDK generated name
   */
  readonly backupVaultName?: string;

  /**
   * A resource-based policy that is used to manage access permissions on the
   * backup vault.
   *
   * TERRACONSTRUCTS DEVIATION: unlike upstream's CFN `AWS::Backup::BackupVault.AccessPolicy`
   * (an inline property always rendered, even as an empty document), the Terraform provider
   * splits vault access policy off into a standalone `aws_backup_vault_policy` resource — see
   * `node_modules/@cdktn/provider-aws/lib/backup-vault-policy/index.d.ts`. This port creates
   * that resource lazily: the first of `accessPolicy`, `blockRecoveryPointDeletion: true`, or a
   * later `addToAccessPolicy()`/`blockRecoveryPointDeletion()` call materializes it. A vault that
   * never needs an access policy has no access policy resource at all (matching the "access is
   * not restricted" default).
   *
   * @default - access is not restricted
   */
  readonly accessPolicy?: iam.PolicyDocument;

  /**
   * The server-side encryption key to use to protect your backups.
   *
   * ID-vs-ARN AUDIT: `kms_key_arn` on `aws_backup_vault` takes an ARN, so this feeds
   * `encryptionKey.keyArn` (not `keyId`).
   *
   * @default - an Amazon managed KMS key
   */
  readonly encryptionKey?: encryption.IKey;

  /**
   * A SNS topic to send vault events to.
   *
   * TERRACONSTRUCTS DEVIATION: unlike upstream's CFN `AWS::Backup::BackupVault.Notifications`
   * (an inline property), the Terraform provider splits vault notifications off into a standalone
   * `aws_backup_vault_notifications` resource -- see
   * `node_modules/@cdktn/provider-aws/lib/backup-vault-notifications/index.d.ts`. This port creates
   * that resource only when `notificationTopic` is set; a vault without `notificationTopic`
   * synthesizes no notifications resource at all (matching the "no notifications" default).
   *
   * @see https://docs.aws.amazon.com/aws-backup/latest/devguide/sns-notifications.html
   *
   * @default - no notifications
   */
  readonly notificationTopic?: sns.ITopic;

  /**
   * The vault events to send.
   *
   * TERRACONSTRUCTS DEVIATION: rendered onto the same standalone `aws_backup_vault_notifications`
   * resource as `notificationTopic` above -- see that prop's deviation note. Ignored (no resource
   * synthesized) unless `notificationTopic` is also set.
   *
   * @see https://docs.aws.amazon.com/aws-backup/latest/devguide/sns-notifications.html
   *
   * @default - all vault events if `notificationTopic` is defined
   */
  readonly notificationEvents?: BackupVaultEvents[];

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.RETAIN`).
  // `core.RemovalPolicy` is not ported in this repo (identical omission to every other ported
  // module's `removalPolicy` props, e.g. `storage.rds`'s `DatabaseInstanceNewProps.removalPolicy`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/vault.ts#L90
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — native Terraform replacement for upstream's
   * `removalPolicy` (see the TODO above). `aws_backup_vault` has no CFN-DeletionPolicy analog;
   * instead it exposes `force_destroy`, which controls whether Terraform is allowed to delete all
   * recovery points still stored in the vault so the vault itself can be destroyed. When `false`
   * (the default -- mirrors upstream's `RemovalPolicy.RETAIN` default), `terraform destroy`/replace
   * on a vault that still contains recovery points FAILS at apply-time with an AWS API error
   * (native `aws_backup_vault` behavior, not enforced here at synth time). Mirrors
   * `DatabaseClusterProps.skipFinalSnapshot` in `../rds/cluster.ts` and `../docdb/cluster.ts`.
   *
   * @default false (a non-empty vault cannot be destroyed unless this is `true`)
   */
  readonly forceDestroy?: boolean;

  /**
   * Whether to add statements to the vault access policy that prevents anyone
   * from deleting a recovery point.
   *
   * @default false
   */
  readonly blockRecoveryPointDeletion?: boolean;

  /**
   * Configuration for AWS Backup Vault Lock
   *
   * TERRACONSTRUCTS DEVIATION: unlike upstream's CFN `AWS::Backup::BackupVault.LockConfiguration`
   * (an inline property), the Terraform provider splits vault lock configuration off into a
   * standalone `aws_backup_vault_lock_configuration` resource -- see
   * `node_modules/@cdktn/provider-aws/lib/backup-vault-lock-configuration/index.d.ts`. This port
   * creates that resource only when `lockConfiguration` is set; a vault without `lockConfiguration`
   * synthesizes no lock-configuration resource at all (matching the "Vault Lock is disabled"
   * default).
   *
   * @see https://docs.aws.amazon.com/aws-backup/latest/devguide/vault-lock.html
   *
   * @default - AWS Backup Vault Lock is disabled
   */
  readonly lockConfiguration?: LockConfiguration;
}

/**
 * Backup vault events. Some events are no longer supported and will not return
 * statuses or notifications.
 *
 * @see https://docs.aws.amazon.com/aws-backup/latest/devguide/API_PutBackupVaultNotifications.html#API_PutBackupVaultNotifications_RequestBody
 */
export enum BackupVaultEvents {
  /** BACKUP_JOB_STARTED */
  BACKUP_JOB_STARTED = "BACKUP_JOB_STARTED",
  /** BACKUP_JOB_COMPLETED */
  BACKUP_JOB_COMPLETED = "BACKUP_JOB_COMPLETED",
  /** BACKUP_JOB_SUCCESSFUL */
  BACKUP_JOB_SUCCESSFUL = "BACKUP_JOB_SUCCESSFUL",
  /** BACKUP_JOB_FAILED */
  BACKUP_JOB_FAILED = "BACKUP_JOB_FAILED",
  /** BACKUP_JOB_EXPIRED */
  BACKUP_JOB_EXPIRED = "BACKUP_JOB_EXPIRED",
  /** RESTORE_JOB_STARTED */
  RESTORE_JOB_STARTED = "RESTORE_JOB_STARTED",
  /** RESTORE_JOB_COMPLETED */
  RESTORE_JOB_COMPLETED = "RESTORE_JOB_COMPLETED",
  /** RESTORE_JOB_SUCCESSFUL */
  RESTORE_JOB_SUCCESSFUL = "RESTORE_JOB_SUCCESSFUL",
  /** RESTORE_JOB_FAILED */
  RESTORE_JOB_FAILED = "RESTORE_JOB_FAILED",
  /** COPY_JOB_STARTED */
  COPY_JOB_STARTED = "COPY_JOB_STARTED",
  /** COPY_JOB_SUCCESSFUL */
  COPY_JOB_SUCCESSFUL = "COPY_JOB_SUCCESSFUL",
  /** COPY_JOB_FAILED */
  COPY_JOB_FAILED = "COPY_JOB_FAILED",
  /** RECOVERY_POINT_MODIFIED */
  RECOVERY_POINT_MODIFIED = "RECOVERY_POINT_MODIFIED",
  /** BACKUP_PLAN_CREATED */
  BACKUP_PLAN_CREATED = "BACKUP_PLAN_CREATED",
  /** BACKUP_PLAN_MODIFIED */
  BACKUP_PLAN_MODIFIED = "BACKUP_PLAN_MODIFIED",
  /** S3_BACKUP_OBJECT_FAILED */
  S3_BACKUP_OBJECT_FAILED = "S3_BACKUP_OBJECT_FAILED",
  /** S3_RESTORE_OBJECT_FAILED */
  S3_RESTORE_OBJECT_FAILED = "S3_RESTORE_OBJECT_FAILED",
}

/**
 * Configuration for AWS Backup Vault Lock
 *
 * @see https://docs.aws.amazon.com/aws-backup/latest/devguide/vault-lock.html
 */
export interface LockConfiguration {
  /**
   * The minimum retention period that the vault retains its recovery points.
   *
   * If this parameter is specified, any backup or copy job to the vault must
   * have a lifecycle policy with a retention period equal to or longer than
   * the minimum retention period. If the job's retention period is shorter than
   * that minimum retention period, then the vault fails that backup or copy job,
   * and you should either modify your lifecycle settings or use a different
   * vault. Recovery points already saved in the vault prior to Vault Lock are
   * not affected.
   */
  readonly minRetention: Duration;

  /**
   * The maximum retention period that the vault retains its recovery points.
   *
   * If this parameter is specified, any backup or copy job to the vault must
   * have a lifecycle policy with a retention period equal to or shorter than
   * the maximum retention period. If the job's retention period is longer than
   * that maximum retention period, then the vault fails the backup or copy job,
   * and you should either modify your lifecycle settings or use a different
   * vault. Recovery points already saved in the vault prior to Vault Lock are
   * not affected.
   *
   * @default - Vault Lock does not enforce a maximum retention period
   */
  readonly maxRetention?: Duration;

  /**
   * The duration before the lock date.
   *
   * AWS Backup enforces a 72-hour cooling-off period before Vault Lock takes
   * effect and becomes immutable.
   *
   * Before the lock date, you can delete Vault Lock from the vault or change
   * the Vault Lock configuration. On and after the lock date, the Vault Lock
   * becomes immutable and cannot be changed or deleted.
   *
   * @default - Vault Lock can be deleted or changed at any time
   */
  readonly changeableFor?: Duration;
}

abstract class BackupVaultBase
  extends AwsConstructBase
  implements IBackupVault
{
  public abstract readonly backupVaultName: string;
  public abstract readonly backupVaultArn: string;

  public get outputs(): Record<string, any> {
    return {
      backupVaultName: this.backupVaultName,
      backupVaultArn: this.backupVaultArn,
    };
  }

  /**
   * Grant the actions defined in actions to the given grantee
   * on this Backup Vault resource.
   *
   * @param grantee Principal to grant right to
   * @param actions The actions to grant
   */
  public grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    for (const action of actions) {
      if (action.indexOf("*") >= 0) {
        throw new ValidationError(
          "AWS Backup access policies don't support a wildcard in the Action key.",
          this,
        );
      }
    }

    return iam.Grant.addToPrincipal({
      grantee: grantee,
      actions: actions,
      resourceArns: [this.backupVaultArn],
    });
  }
}

/**
 * A backup vault
 */
export class BackupVault extends BackupVaultBase {
  /**
   * Import an existing backup vault by name
   */
  public static fromBackupVaultName(
    scope: Construct,
    id: string,
    backupVaultName: string,
  ): IBackupVault {
    const backupVaultArn = AwsStack.ofAwsConstruct(scope).formatArn({
      service: "backup",
      resource: "backup-vault",
      resourceName: backupVaultName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });

    return BackupVault.fromBackupVaultArn(scope, id, backupVaultArn);
  }

  /**
   * Import an existing backup vault by arn
   */
  public static fromBackupVaultArn(
    scope: Construct,
    id: string,
    backupVaultArn: string,
  ): IBackupVault {
    const stack = AwsStack.ofAwsConstruct(scope);
    const parsedArn = stack.splitArn(
      backupVaultArn,
      ArnFormat.COLON_RESOURCE_NAME,
    );

    if (parsedArn.arnFormat !== ArnFormat.COLON_RESOURCE_NAME) {
      throw new ValidationError(
        `Backup Vault Arn ${backupVaultArn} has the wrong format, expected ${ArnFormat.COLON_RESOURCE_NAME}.`,
        scope,
      );
    }
    if (!parsedArn.resourceName) {
      throw new ValidationError(
        `Backup Vault Arn ${backupVaultArn} does not have a resource name.`,
        scope,
      );
    }

    class Import extends BackupVaultBase {
      public readonly backupVaultName = parsedArn.resourceName!;
      public readonly backupVaultArn = backupVaultArn;
    }

    return new Import(scope, id, {
      account: parsedArn.account,
      region: parsedArn.region,
    });
  }

  public readonly backupVaultName: string;
  public readonly backupVaultArn: string;

  private readonly resource: backupVault.BackupVault;

  /**
   * The access policy document for this vault. Lazily created (alongside the standalone
   * `aws_backup_vault_policy` resource in `ensureAccessPolicyDocument()` below) on first use --
   * either from `accessPolicy`/`blockRecoveryPointDeletion` at construction time, or from a
   * later `addToAccessPolicy()`/`blockRecoveryPointDeletion()` call. A vault that never needs an
   * access policy therefore never synthesizes an `aws_backup_vault_policy` resource (nor its
   * backing `data.aws_iam_policy_document`) at all -- see the TERRACONSTRUCTS DEVIATION note on
   * `BackupVaultProps.accessPolicy`. Mirrors the identical lazy-`defaultPolicy` idiom on
   * `Role.addToPrincipalPolicy` in `../../iam/role.ts`.
   */
  private _accessPolicyDocument?: iam.PolicyDocument;

  /** The standalone `aws_backup_vault_policy` resource, created lazily alongside the document above. */
  private _accessPolicyResource?: backupVaultPolicy.BackupVaultPolicy;

  constructor(scope: Construct, id: string, props: BackupVaultProps = {}) {
    super(scope, id, props);

    if (
      props.backupVaultName &&
      !Token.isUnresolved(props.backupVaultName) &&
      !/^[a-zA-Z0-9\-_]{2,50}$/.test(props.backupVaultName)
    ) {
      throw new ValidationError(
        "Expected vault name to match pattern `^[a-zA-Z0-9\\-_]{2,50}$`",
        this,
      );
    }

    this.resource = new backupVault.BackupVault(this, "Resource", {
      name: props.backupVaultName || this.uniqueVaultName(),
      kmsKeyArn: props.encryptionKey?.keyArn,
      forceDestroy: props.forceDestroy,
    });

    this.backupVaultName = this.resource.name;
    this.backupVaultArn = this.resource.arn;

    if (props.accessPolicy) {
      this._accessPolicyDocument = props.accessPolicy;
      this.ensureAccessPolicyDocument();
    }
    if (props.blockRecoveryPointDeletion) {
      this.blockRecoveryPointDeletion();
    }

    if (props.notificationTopic) {
      new backupVaultNotifications.BackupVaultNotifications(
        this,
        "Notifications",
        {
          backupVaultName: this.backupVaultName,
          backupVaultEvents:
            props.notificationEvents || Object.values(BackupVaultEvents),
          snsTopicArn: props.notificationTopic.topicArn,
        },
      );
      props.notificationTopic.grantPublish(
        new iam.ServicePrincipal("backup.amazonaws.com"),
      );
    }

    if (props.lockConfiguration) {
      const rendered = renderLockConfiguration(this, props.lockConfiguration);
      new backupVaultLockConfiguration.BackupVaultLockConfiguration(
        this,
        "LockConfiguration",
        {
          backupVaultName: this.backupVaultName,
          minRetentionDays: rendered.minRetentionDays,
          maxRetentionDays: rendered.maxRetentionDays,
          changeableForDays: rendered.changeableForDays,
        },
      );
    }
  }

  /**
   * Adds a statement to the vault access policy
   */
  public addToAccessPolicy(statement: iam.PolicyStatement) {
    this.ensureAccessPolicyDocument().addStatements(statement);
  }

  /**
   * Adds a statement to the vault access policy that prevents anyone
   * from deleting a recovery point.
   */
  public blockRecoveryPointDeletion() {
    this.addToAccessPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: [
          "backup:DeleteRecoveryPoint",
          "backup:UpdateRecoveryPointLifecycle",
        ],
        principals: [new iam.AnyPrincipal()],
        resources: ["*"],
      }),
    );
  }

  /**
   * Returns the access policy document, creating it (and the standalone
   * `aws_backup_vault_policy` resource that renders it) on first use -- see the
   * TERRACONSTRUCTS DEVIATION note on `BackupVaultProps.accessPolicy`.
   */
  private ensureAccessPolicyDocument(): iam.PolicyDocument {
    if (!this._accessPolicyDocument) {
      this._accessPolicyDocument = new iam.PolicyDocument(
        this,
        "AccessPolicyDocument",
      );
    }
    if (!this._accessPolicyResource) {
      this._accessPolicyResource = new backupVaultPolicy.BackupVaultPolicy(
        this,
        "AccessPolicy",
        {
          backupVaultName: this.backupVaultName,
          policy: this._accessPolicyDocument.json,
        },
      );
    }
    return this._accessPolicyDocument;
  }

  private uniqueVaultName() {
    // TERRACONSTRUCTS DEVIATION: upstream lowercases nothing here either -- `aws_backup_vault`
    // names allow mixed case (`^[a-zA-Z0-9\-_]{2,50}$`, validated above), unlike e.g.
    // `docdb`/`rds` identifiers which the provider forces to lowercase. Max length of 50 chars,
    // matching upstream's `Names.uniqueId(this)` truncation.
    return this.stack.uniqueResourceName(this, { maxLength: 50 });
  }
}

function renderLockConfiguration(
  scope: Construct,
  config: LockConfiguration,
): {
  minRetentionDays: number;
  maxRetentionDays?: number;
  changeableForDays?: number;
} {
  if (
    config.changeableFor &&
    !config.changeableFor.isUnresolved() &&
    config.changeableFor.toHours() < 72
  ) {
    throw new ValidationError(
      `AWS Backup enforces a 72-hour cooling-off period before Vault Lock takes effect and becomes immutable, got ${config.changeableFor.toHours()} hours`,
      scope,
    );
  }

  if (config.maxRetention && !config.maxRetention.isUnresolved()) {
    if (config.maxRetention.toDays() > 36500) {
      throw new ValidationError(
        `The longest maximum retention period you can specify is 36500 days, got ${config.maxRetention.toDays()} days`,
        scope,
      );
    }
    if (
      !config.minRetention.isUnresolved() &&
      config.maxRetention.toDays() <= config.minRetention.toDays()
    ) {
      throw new ValidationError(
        `The maximum retention period (${config.maxRetention.toDays()} days) must be greater than the minimum retention period (${config.minRetention.toDays()} days)`,
        scope,
      );
    }
  }

  if (
    !config.minRetention.isUnresolved() &&
    config.minRetention.toHours() < 24
  ) {
    throw new ValidationError(
      `The shortest minimum retention period you can specify is 1 day, got ${config.minRetention.toHours()} hours`,
      scope,
    );
  }

  return {
    minRetentionDays: config.minRetention.toDays(),
    maxRetentionDays: config.maxRetention?.toDays(),
    changeableForDays: config.changeableFor?.toDays(),
  };
}
