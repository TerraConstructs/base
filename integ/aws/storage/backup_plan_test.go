package test

import (
	"context"
	"testing"

	awsbackup "github.com/aws/aws-sdk-go-v2/service/backup"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
)

// Run the apps/backup.plan.ts integration test: a real BackupVault +
// BackupPlan + BackupSelection over a DynamoDB table through the
// storage.backup L2s. Validates the plan's rules read-back (incl. the rule
// added AFTER construction — the block-typed-Lazy design), the vault, the
// selection's resources/tag conditions, and the post-apply drift oracle.
func TestBackupPlan(t *testing.T) {
	runStorageIntegrationTest(t, "backup.plan", "us-east-1", validateBackupPlan)
}

func validateBackupPlan(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	planID := outputs["backup_plan_id"].(string)
	vaultName := outputs["backup_vault_name"].(string)
	vaultArn := outputs["backup_vault_arn"].(string)
	selectionID := outputs["selection_id"].(string)
	tableArn := outputs["table_arn"].(string)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := awsbackup.NewFromConfig(cfg)

	// --- 1. Plan read-back: BOTH rules land (daily from the static factory,
	// weekly from post-construction addRule() — the Lazy rule-block proof). ---
	gp, err := client.GetBackupPlan(ctx, &awsbackup.GetBackupPlanInput{
		BackupPlanId: &planID,
	})
	require.NoError(t, err)
	require.Equal(t, "Plan", *gp.BackupPlan.BackupPlanName)
	require.Len(t, gp.BackupPlan.Rules, 2)
	retentionByRule := map[string]int64{}
	for _, r := range gp.BackupPlan.Rules {
		require.Equal(t, vaultName, *r.TargetBackupVaultName,
			"every rule must target the fixture vault")
		require.NotNil(t, r.Lifecycle)
		retentionByRule[*r.RuleName] = *r.Lifecycle.DeleteAfterDays
	}
	require.Equal(t, int64(35), retentionByRule["Daily"], "constructor-path rule must reach AWS")
	require.Equal(t, int64(90), retentionByRule["Weekly"], "post-construction addRule() rule must reach AWS (Lazy rule-block design)")
	t.Logf("backup-plan: %s has rules Daily(35d)+Weekly(90d) targeting vault %s", planID, vaultName)

	// --- 2. Vault read-back. ---
	dv, err := client.DescribeBackupVault(ctx, &awsbackup.DescribeBackupVaultInput{
		BackupVaultName: &vaultName,
	})
	require.NoError(t, err)
	require.Equal(t, vaultArn, *dv.BackupVaultArn)
	t.Logf("backup-plan: vault %s exists (%s)", vaultName, vaultArn)

	// --- 3. Selection read-back: table ARN + tag condition + IAM role. ---
	gs, err := client.GetBackupSelection(ctx, &awsbackup.GetBackupSelectionInput{
		BackupPlanId: &planID,
		SelectionId:  &selectionID,
	})
	require.NoError(t, err)
	require.Contains(t, gs.BackupSelection.Resources, tableArn,
		"fromDynamoDbTable must render the table ARN into the selection")
	require.Len(t, gs.BackupSelection.ListOfTags, 1)
	require.Equal(t, "stage", *gs.BackupSelection.ListOfTags[0].ConditionKey)
	require.Equal(t, "prod", *gs.BackupSelection.ListOfTags[0].ConditionValue)
	require.NotEmpty(t, *gs.BackupSelection.IamRoleArn)
	t.Logf("backup-plan: selection %s covers table %s + tag stage=prod via role %s",
		selectionID, tableArn, *gs.BackupSelection.IamRoleArn)

	// --- Drift oracle: re-planning the already-applied stack must show zero changes. ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}
