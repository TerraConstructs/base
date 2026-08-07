// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/test/plan.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note.

import { backupPlan, backupVault } from "@cdktn/provider-aws";
import { App, Lazy, TerraformVariable, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as notify from "../../../../src/aws/notify";
import * as backup from "../../../../src/aws/storage/backup";
import { Duration } from "../../../../src/duration";
import { TimeZone } from "../../../../src/time-zone";
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

// TERRACONSTRUCTS DEVIATION: cross-references between sibling resources (e.g. a rule's
// `target_vault_name` pointing at its vault's `.name` attribute) render as CDKTF interpolation
// strings (`${aws_backup_vault.<logicalId>.name}`) whose `<logicalId>` includes a construct-path
// hash. Rather than hardcoding that hash (an implementation detail of `uniqueResourceName`/
// `Names`-equivalent hashing, not part of this port's behavior contract), assertions below match
// the interpolation shape with a regex -- mirrors the same adaptation in e.g.
// `../assets/image-asset.test.ts`.
const vaultNameRef = () =>
  expect.stringMatching(/^\$\{aws_backup_vault\.\w+\.name\}$/);
const vaultArnRef = () =>
  expect.stringMatching(/^\$\{aws_backup_vault\.\w+\.arn\}$/);

describe("BackupPlan", () => {
  test("create a plan and add rules", () => {
    // GIVEN
    const stack = testStack();
    const vault = new backup.BackupVault(stack, "Vault");
    const otherVault = new backup.BackupVault(stack, "OtherVault");

    // WHEN
    const plan = new backup.BackupPlan(stack, "Plan", {
      backupVault: vault,
      backupPlanRules: [
        new backup.BackupPlanRule({
          completionWindow: Duration.hours(2),
          startWindow: Duration.hours(1),
          scheduleExpression: notify.Schedule.cron({
            day: "15",
            hour: "3",
            minute: "30",
          }),
          scheduleExpressionTimezone: TimeZone.ETC_UTC,
          moveToColdStorageAfter: Duration.days(30),
        }),
      ],
    });
    plan.addRule(backup.BackupPlanRule.monthly5Year(otherVault));

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      name: "Plan",
      rule: [
        {
          completion_window: 120,
          lifecycle: {
            cold_storage_after: 30,
          },
          rule_name: "PlanRule0",
          schedule: "cron(30 3 15 * ? *)",
          schedule_expression_timezone: "Etc/UTC",
          start_window: 60,
          target_vault_name: vaultNameRef(),
        },
        {
          lifecycle: {
            delete_after: 1825,
            cold_storage_after: 90,
          },
          rule_name: "Monthly5Year",
          schedule: "cron(0 5 1 * ? *)",
          target_vault_name: vaultNameRef(),
        },
      ],
    });
  });

  test("create a plan with continuous backup option", () => {
    // GIVEN
    const stack = testStack();
    const vault = new backup.BackupVault(stack, "Vault");

    // WHEN
    new backup.BackupPlan(stack, "Plan", {
      backupVault: vault,
      backupPlanRules: [
        new backup.BackupPlanRule({
          enableContinuousBackup: true,
        }),
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      name: "Plan",
      rule: [
        {
          enable_continuous_backup: true,
          lifecycle: {
            delete_after: 35,
          },
          rule_name: "PlanRule0",
          target_vault_name: vaultNameRef(),
        },
      ],
    });
  });

  test("create a plan with continuous backup option and specify deleteAfter", () => {
    // GIVEN
    const stack = testStack();
    const vault = new backup.BackupVault(stack, "Vault");

    // WHEN
    new backup.BackupPlan(stack, "Plan", {
      backupVault: vault,
      backupPlanRules: [
        new backup.BackupPlanRule({
          enableContinuousBackup: true,
          deleteAfter: Duration.days(1),
        }),
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      name: "Plan",
      rule: [
        {
          enable_continuous_backup: true,
          lifecycle: {
            delete_after: 1,
          },
          rule_name: "PlanRule0",
          target_vault_name: vaultNameRef(),
        },
      ],
    });
  });

  test("create a plan and add rules - add BackupPlan.AdvancedBackupSettings.BackupOptions", () => {
    const stack = testStack();
    const vault = new backup.BackupVault(stack, "Vault");
    const otherVault = new backup.BackupVault(stack, "OtherVault");

    // WHEN
    const plan = new backup.BackupPlan(stack, "Plan", {
      windowsVss: true,
      backupVault: vault,
      backupPlanRules: [
        new backup.BackupPlanRule({
          completionWindow: Duration.hours(2),
          startWindow: Duration.hours(1),
          scheduleExpression: notify.Schedule.cron({
            day: "15",
            hour: "3",
            minute: "30",
          }),
          moveToColdStorageAfter: Duration.days(30),
        }),
      ],
    });
    plan.addRule(backup.BackupPlanRule.monthly5Year(otherVault));

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      advanced_backup_setting: [
        { backup_options: { WindowsVSS: "enabled" }, resource_type: "EC2" },
      ],
    });
  });

  test("daily35DayRetention", () => {
    // WHEN
    const stack = testStack();
    backup.BackupPlan.daily35DayRetention(stack, "D35");

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      name: "D35",
      rule: [
        {
          lifecycle: {
            delete_after: 35,
          },
          rule_name: "Daily",
          schedule: "cron(0 5 * * ? *)",
          target_vault_name: vaultNameRef(),
        },
      ],
    });
  });

  test("dailyWeeklyMonthly7YearRetention", () => {
    // WHEN
    const stack = testStack();
    backup.BackupPlan.dailyWeeklyMonthly7YearRetention(stack, "DWM7");

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      name: "DWM7",
      rule: [
        {
          lifecycle: { delete_after: 35 },
          rule_name: "Daily",
          schedule: "cron(0 5 * * ? *)",
          target_vault_name: vaultNameRef(),
        },
        {
          lifecycle: { delete_after: 90 },
          rule_name: "Weekly",
          schedule: "cron(0 5 ? * SAT *)",
          target_vault_name: vaultNameRef(),
        },
        {
          lifecycle: { delete_after: 2555, cold_storage_after: 90 },
          rule_name: "Monthly7Year",
          schedule: "cron(0 5 1 * ? *)",
          target_vault_name: vaultNameRef(),
        },
      ],
    });
    // all three rules share the same auto-created vault
    const t2 = new Template(stack);
    t2.resourceCountIs(backupVault.BackupVault, 1);
  });

  test("automatically creates a new vault", () => {
    // GIVEN
    const stack = testStack();
    const plan = new backup.BackupPlan(stack, "Plan");

    // WHEN
    plan.addRule(backup.BackupPlanRule.daily());

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      name: "Plan",
      rule: [
        {
          lifecycle: { delete_after: 35 },
          rule_name: "Daily",
          schedule: "cron(0 5 * * ? *)",
          target_vault_name: vaultNameRef(),
        },
      ],
    });
  });

  test("create a plan and add rule to copy to a different vault", () => {
    // GIVEN
    const stack = testStack();
    const primaryVault = new backup.BackupVault(stack, "PrimaryVault");
    const secondaryVault = new backup.BackupVault(stack, "SecondaryVault");

    // WHEN
    new backup.BackupPlan(stack, "Plan", {
      backupVault: primaryVault,
      backupPlanRules: [
        new backup.BackupPlanRule({
          copyActions: [
            {
              destinationBackupVault: secondaryVault,
              deleteAfter: Duration.days(120),
              moveToColdStorageAfter: Duration.days(30),
            },
          ],
        }),
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      name: "Plan",
      rule: [
        {
          rule_name: "PlanRule0",
          target_vault_name: vaultNameRef(),
          copy_action: [
            {
              destination_vault_arn: vaultArnRef(),
              lifecycle: {
                delete_after: 120,
                cold_storage_after: 30,
              },
            },
          ],
        },
      ],
    });
  });

  test("create a plan and add rule with recoveryPointTags", () => {
    // GIVEN
    const stack = testStack();
    const tags = {
      key: "value",
    };

    // WHEN
    new backup.BackupPlan(stack, "Plan", {
      backupPlanRules: [
        new backup.BackupPlanRule({
          recoveryPointTags: tags,
        }),
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      name: "Plan",
      rule: [
        {
          rule_name: "PlanRule0",
          target_vault_name: vaultNameRef(),
          recovery_point_tags: {
            key: "value",
          },
        },
      ],
    });
  });

  test("throws when deleteAfter is not greater than moveToColdStorageAfter", () => {
    expect(
      () =>
        new backup.BackupPlanRule({
          deleteAfter: Duration.days(5),
          moveToColdStorageAfter: Duration.days(6),
        }),
    ).toThrow(/`deleteAfter` must be greater than `moveToColdStorageAfter`/);
  });

  test("throws when scheduleExpression is not of type cron", () => {
    expect(
      () =>
        new backup.BackupPlanRule({
          scheduleExpression: notify.Schedule.rate(Duration.hours(5)),
        }),
    ).toThrow(/`scheduleExpression` must be of type `cron`/);
  });

  test("synth fails when plan has no rules", () => {
    // GIVEN
    const app = Testing.app();
    const myStack = testStack(app, "Stack");

    // WHEN
    new backup.BackupPlan(myStack, "Plan");

    expect(() => app.synth()).toThrow(
      /A backup plan must have at least 1 rule/,
    );
  });

  test("throws when moveToColdStorageAfter is used with enableContinuousBackup", () => {
    expect(
      () =>
        new backup.BackupPlanRule({
          enableContinuousBackup: true,
          deleteAfter: Duration.days(30),
          moveToColdStorageAfter: Duration.days(10),
        }),
    ).toThrow(
      /`moveToColdStorageAfter` must not be specified if `enableContinuousBackup` is enabled/,
    );
  });

  test("throws when deleteAfter is less than 1 in combination with enableContinuousBackup", () => {
    expect(
      () =>
        new backup.BackupPlanRule({
          enableContinuousBackup: true,
          deleteAfter: Duration.days(0),
        }),
    ).toThrow(
      /'deleteAfter' must be between 1 and 35 days if 'enableContinuousBackup' is enabled, but got 0 days/,
    );
  });

  test("throws when deleteAfter is greater than 35 in combination with enableContinuousBackup", () => {
    expect(
      () =>
        new backup.BackupPlanRule({
          enableContinuousBackup: true,
          deleteAfter: Duration.days(36),
        }),
    ).toThrow(
      /'deleteAfter' must be between 1 and 35 days if 'enableContinuousBackup' is enabled, but got 36 days/,
    );
  });

  test("throws when deleteAfter is not greater than moveToColdStorageAfter in a copy action", () => {
    const stack = testStack();
    expect(
      () =>
        new backup.BackupPlanRule({
          copyActions: [
            {
              destinationBackupVault: new backup.BackupVault(stack, "Vault"),
              deleteAfter: Duration.days(5),
              moveToColdStorageAfter: Duration.days(6),
            },
          ],
        }),
    ).toThrow(
      /deleteAfter' must at least 90 days later than corresponding 'moveToColdStorageAfter'\nreceived 'deleteAfter: 5' and 'moveToColdStorageAfter: 6'/,
    );
  });

  test("throws when deleteAfter is not greater than 90 days past moveToColdStorageAfter parameter in a copy action", () => {
    const stack = testStack();
    expect(
      () =>
        new backup.BackupPlanRule({
          copyActions: [
            {
              destinationBackupVault: new backup.BackupVault(stack, "Vault"),
              deleteAfter: Duration.days(45),
              moveToColdStorageAfter: Duration.days(30),
            },
          ],
        }),
    ).toThrow(
      /'deleteAfter' must at least 90 days later than corresponding 'moveToColdStorageAfter'\nreceived 'deleteAfter: 45' and 'moveToColdStorageAfter: 30'/,
    );
  });

  test("does not throw when deleteAfter is a token and moveToColdStorageAfter is set", () => {
    expect(
      () =>
        new backup.BackupPlanRule({
          deleteAfter: Duration.days(Lazy.numberValue({ produce: () => 365 })),
          moveToColdStorageAfter: Duration.days(30),
        }),
    ).not.toThrow();
  });

  test("does not throw when moveToColdStorageAfter is a token", () => {
    expect(
      () =>
        new backup.BackupPlanRule({
          deleteAfter: Duration.days(365),
          moveToColdStorageAfter: Duration.days(
            Lazy.numberValue({ produce: () => 30 }),
          ),
        }),
    ).not.toThrow();
  });

  test("does not throw when deleteAfter is a token in combination with enableContinuousBackup", () => {
    expect(
      () =>
        new backup.BackupPlanRule({
          enableContinuousBackup: true,
          deleteAfter: Duration.days(Lazy.numberValue({ produce: () => 14 })),
        }),
    ).not.toThrow();
  });

  test("does not throw when copy action durations are tokens, regardless of token creation order", () => {
    const stack = testStack();
    const moveToColdStorageAfter = Duration.days(
      Lazy.numberValue({ produce: () => 30 }),
    );
    const deleteAfter = Duration.days(Lazy.numberValue({ produce: () => 365 }));
    expect(
      () =>
        new backup.BackupPlanRule({
          copyActions: [
            {
              destinationBackupVault: new backup.BackupVault(stack, "Vault"),
              deleteAfter,
              moveToColdStorageAfter,
            },
          ],
        }),
    ).not.toThrow();
  });

  test("renders a lifecycle that references a Terraform variable", () => {
    // GIVEN
    // TERRACONSTRUCTS DEVIATION: upstream uses `CfnParameter` (a CloudFormation template
    // parameter, `Ref: 'RetentionDays'`); the Terraform analog exercised here is
    // `TerraformVariable`, whose value renders as an interpolation reference
    // (`${var.RetentionDays}`) instead of a CFN `{ Ref: ... }` object.
    const stack = testStack();
    const retentionDays = new TerraformVariable(stack, "RetentionDays", {
      type: "number",
      default: 365,
    });

    // WHEN
    new backup.BackupPlan(stack, "Plan", {
      backupPlanRules: [
        new backup.BackupPlanRule({
          deleteAfter: Duration.days(retentionDays.numberValue),
          moveToColdStorageAfter: Duration.days(30),
          scheduleExpression: notify.Schedule.cron({ hour: "5", minute: "0" }),
        }),
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      rule: [
        expect.objectContaining({
          lifecycle: {
            delete_after: "${var.RetentionDays}",
            cold_storage_after: 30,
          },
        }),
      ],
    });
  });

  // Required regression test for the block-typed-L1-arg-accumulated-after-construction footgun
  // documented at length in `../../../../src/aws/storage/backup/plan.ts` (`addRule()`).
  test("adding a rule after construction resolves Lazy tokens in the synthesized JSON", () => {
    // GIVEN
    const stack = testStack();
    const plan = new backup.BackupPlan(stack, "Plan", {
      backupPlanRules: [
        new backup.BackupPlanRule({
          deleteAfter: Duration.days(Lazy.numberValue({ produce: () => 7 })),
        }),
      ],
    });

    // WHEN -- addRule() called well after the constructor (and thus after the `aws_backup_plan`
    // L1 resource) returned, with a rule whose `deleteAfter` is itself an unresolved Lazy token.
    plan.addRule(
      new backup.BackupPlanRule({
        ruleName: "AddedAfterConstruction",
        deleteAfter: Duration.days(Lazy.numberValue({ produce: () => 42 })),
      }),
    );

    // THEN -- both rules (including the Lazy `deleteAfter` values) land in the synthesized JSON
    // as concrete numbers, not `[object Object]`/dropped/empty blocks.
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupPlan.BackupPlan, {
      rule: [
        expect.objectContaining({
          rule_name: "PlanRule0",
          lifecycle: { delete_after: 7 },
        }),
        expect.objectContaining({
          rule_name: "AddedAfterConstruction",
          lifecycle: { delete_after: 42 },
        }),
      ],
    });
  });

  test("fromBackupPlanId renders a colon-separated ARN", () => {
    // GIVEN
    const stack = testStack();

    // WHEN
    const imported = backup.BackupPlan.fromBackupPlanId(
      stack,
      "Imported",
      "id",
    );

    // THEN -- `backup-plan:<id>`, matching upstream v2.263.0 plan.ts's
    // `arnFormat: ArnFormat.COLON_RESOURCE_NAME`, not the default `backup-plan/<id>` slash format.
    expect(imported.backupPlanArn).toMatch(/:backup-plan:id$/);
  });
});
