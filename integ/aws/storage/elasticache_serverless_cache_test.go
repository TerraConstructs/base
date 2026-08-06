package test

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/elasticache"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
)

// Run the apps/elasticache.serverless-cache.ts integration test: a real
// Valkey 8 serverless cache with IamUser + UserGroup through the
// storage.elasticache alpha port. Mirrors upstream's integ assertions
// (describeServerlessCaches engine/version/status) plus user/user-group
// read-backs and the post-apply drift oracle.
func TestElasticacheServerlessCache(t *testing.T) {
	runStorageIntegrationTest(t, "elasticache.serverless-cache", "us-east-1", validateElasticacheServerlessCache)
}

func validateElasticacheServerlessCache(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	cacheName := outputs["cache_name"].(string)
	userID := outputs["user_id"].(string)
	userGroupID := outputs["user_group_id"].(string)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := elasticache.NewFromConfig(cfg)

	// --- 1. Serverless cache read-back (upstream integ asserts the same fields). ---
	sc, err := client.DescribeServerlessCaches(ctx, &elasticache.DescribeServerlessCachesInput{
		ServerlessCacheName: &cacheName,
	})
	require.NoError(t, err)
	require.Len(t, sc.ServerlessCaches, 1)
	c := sc.ServerlessCaches[0]
	require.Equal(t, "available", *c.Status)
	require.Equal(t, "valkey", *c.Engine)
	require.Equal(t, "8", *c.MajorEngineVersion)
	require.NotNil(t, c.CacheUsageLimits)
	require.Equal(t, int32(1), *c.CacheUsageLimits.DataStorage.Minimum)
	require.Equal(t, int32(1), *c.CacheUsageLimits.DataStorage.Maximum)
	require.Equal(t, int32(1000), *c.CacheUsageLimits.ECPUPerSecond.Minimum)
	require.Equal(t, int32(2000), *c.CacheUsageLimits.ECPUPerSecond.Maximum)
	require.NotNil(t, c.Endpoint)
	t.Logf("elasticache-serverless: %s available (valkey %s at %s:%d, limits applied)",
		cacheName, *c.MajorEngineVersion, *c.Endpoint.Address, *c.Endpoint.Port)

	// --- 2. IAM user read-back. ---
	du, err := client.DescribeUsers(ctx, &elasticache.DescribeUsersInput{
		UserId: &userID,
	})
	require.NoError(t, err)
	require.Len(t, du.Users, 1)
	require.Equal(t, "active", *du.Users[0].Status)
	require.Equal(t, "iam", string(du.Users[0].Authentication.Type))
	t.Logf("elasticache-serverless: user %s active (iam auth)", userID)

	// --- 3. User group contains the user and is attached. ---
	dg, err := client.DescribeUserGroups(ctx, &elasticache.DescribeUserGroupsInput{
		UserGroupId: &userGroupID,
	})
	require.NoError(t, err)
	require.Len(t, dg.UserGroups, 1)
	require.Contains(t, dg.UserGroups[0].UserIds, userID)
	t.Logf("elasticache-serverless: user group %s contains %s", userGroupID, userID)

	// --- Drift oracle: re-planning the already-applied stack must show zero changes. ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}
