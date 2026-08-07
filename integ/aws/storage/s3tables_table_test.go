package test

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3tables"
	s3tablestypes "github.com/aws/aws-sdk-go-v2/service/s3tables/types"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
)

// Run the apps/s3tables.table.ts integration test: a real S3 Tables
// TableBucket + Namespace + ICEBERG Table through the storage.s3tables L2s
// (alpha port). Validates bucket/namespace/table read-back, the compaction-only
// maintenance_configuration shape (null-filled absent member), and the
// post-apply drift oracle.
func TestS3TablesTable(t *testing.T) {
	runStorageIntegrationTest(t, "s3tables.table", "us-east-1", validateS3TablesTable)
}

func validateS3TablesTable(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	bucketArn := outputs["table_bucket_arn"].(string)
	bucketName := outputs["table_bucket_name"].(string)
	namespaceName := outputs["namespace_name"].(string)
	tableName := outputs["table_name"].(string)
	tableArn := outputs["table_arn"].(string)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := s3tables.NewFromConfig(cfg)

	// --- 1. Table bucket read-back. ---
	gb, err := client.GetTableBucket(ctx, &s3tables.GetTableBucketInput{
		TableBucketARN: &bucketArn,
	})
	require.NoError(t, err)
	require.Equal(t, bucketName, *gb.Name)
	t.Logf("s3tables: table bucket %s exists (%s)", bucketName, bucketArn)

	// --- 2. Namespace read-back. ---
	gn, err := client.GetNamespace(ctx, &s3tables.GetNamespaceInput{
		TableBucketARN: &bucketArn,
		Namespace:      &namespaceName,
	})
	require.NoError(t, err)
	require.Contains(t, gn.Namespace, namespaceName)
	t.Logf("s3tables: namespace %s exists", namespaceName)

	// --- 3. Table read-back: ICEBERG format + ARN. ---
	gt, err := client.GetTable(ctx, &s3tables.GetTableInput{
		TableBucketARN: &bucketArn,
		Namespace:      &namespaceName,
		Name:           &tableName,
	})
	require.NoError(t, err)
	require.Equal(t, tableArn, *gt.TableARN)
	require.Equal(t, s3tablestypes.OpenTableFormatIceberg, gt.Format)
	t.Logf("s3tables: table %s exists (ICEBERG, %s)", tableName, tableArn)

	// --- 4. Maintenance read-back: compaction enabled at 128MB (the one-sided
	// maintenance_configuration shape with a null-filled absent member). ---
	gm, err := client.GetTableMaintenanceConfiguration(ctx, &s3tables.GetTableMaintenanceConfigurationInput{
		TableBucketARN: &bucketArn,
		Namespace:      &namespaceName,
		Name:           &tableName,
	})
	require.NoError(t, err)
	compaction, ok := gm.Configuration[string(s3tablestypes.TableMaintenanceTypeIcebergCompaction)]
	require.True(t, ok, "compaction maintenance configuration must exist")
	require.Equal(t, s3tablestypes.MaintenanceStatusEnabled, compaction.Status)
	settings, ok := compaction.Settings.(*s3tablestypes.TableMaintenanceSettingsMemberIcebergCompaction)
	require.True(t, ok, "compaction settings must be the iceberg compaction member")
	require.Equal(t, int32(128), *settings.Value.TargetFileSizeMB)
	t.Logf("s3tables: compaction enabled at %dMB target file size", *settings.Value.TargetFileSizeMB)

	// --- Drift oracle: re-planning the already-applied stack must show zero
	// changes. Proves the null-filled absent maintenance member reads back
	// without perpetual diff. ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}
