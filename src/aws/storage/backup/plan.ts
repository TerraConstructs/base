// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/plan.ts

import { backupPlan } from "@cdktn/provider-aws";
import { Lazy } from "cdktn";
import { Construct } from "constructs";
import type { BackupPlanCopyActionProps } from "./rule";
import { BackupPlanRule } from "./rule";
import type { BackupSelectionOptions } from "./selection";
import { BackupSelection } from "./selection";
import type { IBackupVault } from "./vault";
import { BackupVault } from "./vault";
import { ValidationError } from "../../../errors";
import { ArnFormat } from "../../arn";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";

/**
 * A backup plan
 */
export interface IBackupPlan extends IAwsConstruct {
  /**
   * The identifier of the backup plan.
   *
   * @attribute
   */
  readonly backupPlanId: string;

  /**
   * The ARN of the backup plan
   *
   * @attribute
   */
  readonly backupPlanArn: string;
}

/**
 * Properties for a BackupPlan
 */
export interface BackupPlanProps extends AwsConstructProps {
  /**
   * The display name of the backup plan.
   *
   * @default - A CDK generated name
   */
  readonly backupPlanName?: string;

  /**
   * The backup vault where backups are stored
   *
   * @default - use the vault defined at the rule level. If not defined a new
   * common vault for the plan will be created
   */
  readonly backupVault?: IBackupVault;

  /**
   * Rules for the backup plan. Use `addRule()` to add rules after
   * instantiation.
   *
   * @default - use `addRule()` to add rules
   */
  readonly backupPlanRules?: BackupPlanRule[];

  /**
   * Enable Windows VSS backup.
   *
   * @see https://docs.aws.amazon.com/aws-backup/latest/devguide/windows-backups.html
   *
   * @default false
   */
  readonly windowsVss?: boolean;
}

/**
 * A backup plan
 */
export class BackupPlan extends AwsConstructBase implements IBackupPlan {
  /**
   * Import an existing backup plan
   */
  public static fromBackupPlanId(
    scope: Construct,
    id: string,
    backupPlanId: string,
  ): IBackupPlan {
    class Import extends AwsConstructBase implements IBackupPlan {
      public readonly backupPlanId = backupPlanId;
      public get backupPlanArn(): string {
        return this.stack.formatArn({
          service: "backup",
          resource: "backup-plan",
          resourceName: this.backupPlanId,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        });
      }
      public get outputs(): Record<string, any> {
        return {
          backupPlanId: this.backupPlanId,
          backupPlanArn: this.backupPlanArn,
        };
      }
    }
    return new Import(scope, id);
  }

  /**
   * Daily with 35 day retention
   */
  public static daily35DayRetention(
    scope: Construct,
    id: string,
    backupVault?: IBackupVault,
  ) {
    const plan = new BackupPlan(scope, id, { backupVault });
    plan.addRule(BackupPlanRule.daily());
    return plan;
  }

  /**
   * Daily and monthly with 1 year retention
   */
  public static dailyMonthly1YearRetention(
    scope: Construct,
    id: string,
    backupVault?: IBackupVault,
  ) {
    const plan = new BackupPlan(scope, id, { backupVault });
    plan.addRule(BackupPlanRule.daily());
    plan.addRule(BackupPlanRule.monthly1Year());
    return plan;
  }

  /**
   * Daily, weekly and monthly with 5 year retention
   */
  public static dailyWeeklyMonthly5YearRetention(
    scope: Construct,
    id: string,
    backupVault?: IBackupVault,
  ) {
    const plan = new BackupPlan(scope, id, { backupVault });
    plan.addRule(BackupPlanRule.daily());
    plan.addRule(BackupPlanRule.weekly());
    plan.addRule(BackupPlanRule.monthly5Year());
    return plan;
  }

  /**
   * Daily, weekly and monthly with 7 year retention
   */
  public static dailyWeeklyMonthly7YearRetention(
    scope: Construct,
    id: string,
    backupVault?: IBackupVault,
  ) {
    const plan = new BackupPlan(scope, id, { backupVault });
    plan.addRule(BackupPlanRule.daily());
    plan.addRule(BackupPlanRule.weekly());
    plan.addRule(BackupPlanRule.monthly7Year());
    return plan;
  }

  public readonly backupPlanId: string;

  /**
   * The ARN of the backup plan
   *
   * @attribute
   */
  public readonly backupPlanArn: string;

  /**
   * Version Id
   *
   * @attribute
   */
  public readonly versionId: string;

  public get outputs(): Record<string, any> {
    return {
      backupPlanId: this.backupPlanId,
      backupPlanArn: this.backupPlanArn,
      versionId: this.versionId,
    };
  }

  private readonly resource: backupPlan.BackupPlan;

  /**
   * Accumulator for rules added via `addRule()`, rendered into the `rule` block lazily at synth
   * time -- see the TERRACONSTRUCTS DEVIATION note below.
   */
  private readonly rules = new Array<backupPlan.BackupPlanRule>();

  private _backupVault?: IBackupVault;

  constructor(scope: Construct, id: string, props: BackupPlanProps = {}) {
    super(scope, id, props);

    // TERRACONSTRUCTS DEVIATION (4th instance in this repo -- see e.g.
    // `applyServerlessV2ScalingConfigurationOverride` in `../rds/cluster.ts`): `aws_backup_plan`'s
    // `rule` config is block-typed (`BackupPlanRule[] | cdktn.IResolvable` in
    // `@cdktn/provider-aws`'s `backup-plan/index.d.ts`), and `addRule()` below accumulates rules
    // *after* this constructor returns. Passing a typed `BackupPlanRule[]` here would freeze the
    // rule list at construction time; routing individual rules through the L1's own
    // `.putRule()`/`ComplexList` machinery afterwards would silently drop any unresolved `Lazy`
    // tokens nested in a rule (`internalValue` on `ComplexObject` never re-resolves). Instead,
    // `rule` is fed a `Lazy.anyValue` that maps the accumulator through the L1's own
    // `backupPlanRuleToTerraform` renderer at synth time -- this *does* run every nested value
    // through the resolver. This mirrors the identical `globalSecondaryIndex`/
    // `addGlobalSecondaryIndex()` pattern already used by `../table.ts` for the same
    // "block-typed L1 arg, accumulated after construction" shape; see
    // `PlanTest > adding a rule after construction resolves Lazy tokens` for the regression test.
    this.resource = new backupPlan.BackupPlan(this, "Resource", {
      name: props.backupPlanName || id,
      advancedBackupSetting: this.advancedBackupSettings(props),
      rule: Lazy.anyValue(
        {
          produce: () =>
            this.rules.map((rule) =>
              backupPlan.backupPlanRuleToTerraform(rule),
            ),
        },
        // Matches the `../table.ts` idiom; only reachable on Testing.synth paths since
        // `validatePlan()` rejects an empty rule list on real synth.
        { omitEmptyArray: true },
      ),
    });

    this.backupPlanId = this.resource.id;
    this.backupPlanArn = this.resource.arn;
    this.versionId = this.resource.version;

    this._backupVault = props.backupVault;

    for (const rule of props.backupPlanRules || []) {
      this.addRule(rule);
    }

    this.node.addValidation({ validate: () => this.validatePlan() });
  }

  private advancedBackupSettings(
    props: BackupPlanProps,
  ): backupPlan.BackupPlanAdvancedBackupSetting[] | undefined {
    if (!props.windowsVss) {
      return undefined;
    }
    return [
      {
        backupOptions: {
          WindowsVSS: "enabled",
        },
        resourceType: "EC2",
      },
    ];
  }

  /**
   * Adds a rule to a plan
   *
   * @param rule the rule to add
   */
  public addRule(rule: BackupPlanRule) {
    let vault: IBackupVault;
    if (rule.props.backupVault) {
      vault = rule.props.backupVault;
    } else if (this._backupVault) {
      vault = this._backupVault;
    } else {
      this._backupVault = new BackupVault(this, "Vault");
      vault = this._backupVault;
    }

    this.rules.push({
      completionWindow: rule.props.completionWindow?.toMinutes(),
      lifecycle: (rule.props.deleteAfter ||
        rule.props.moveToColdStorageAfter) && {
        deleteAfter: rule.props.deleteAfter?.toDays(),
        coldStorageAfter: rule.props.moveToColdStorageAfter?.toDays(),
      },
      ruleName:
        rule.props.ruleName ?? `${this.node.id}Rule${this.rules.length}`,
      schedule: rule.props.scheduleExpression?.expressionString,
      scheduleExpressionTimezone:
        rule.props.scheduleExpressionTimezone?.timezoneName,
      startWindow: rule.props.startWindow?.toMinutes(),
      enableContinuousBackup: rule.props.enableContinuousBackup,
      targetVaultName: vault.backupVaultName,
      copyAction: rule.props.copyActions?.map(this.planCopyActions),
      recoveryPointTags: rule.props.recoveryPointTags,
    });
  }

  private planCopyActions(
    this: void,
    props: BackupPlanCopyActionProps,
  ): backupPlan.BackupPlanRuleCopyAction {
    return {
      destinationVaultArn: props.destinationBackupVault.backupVaultArn,
      lifecycle: (props.deleteAfter || props.moveToColdStorageAfter) && {
        deleteAfter: props.deleteAfter?.toDays(),
        coldStorageAfter: props.moveToColdStorageAfter?.toDays(),
      },
    };
  }

  /**
   * The backup vault where backups are stored if not defined at
   * the rule level
   */
  public get backupVault(): IBackupVault {
    if (!this._backupVault) {
      // This cannot happen but is here to make TypeScript happy
      throw new ValidationError("No backup vault!", this);
    }

    return this._backupVault;
  }

  /**
   * Adds a selection to this plan
   */
  public addSelection(
    id: string,
    options: BackupSelectionOptions,
  ): BackupSelection {
    return new BackupSelection(this, id, {
      backupPlan: this,
      ...options,
    });
  }

  private validatePlan(): string[] {
    if (this.rules.length === 0) {
      return ["A backup plan must have at least 1 rule."];
    }

    return [];
  }
}
