package test

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/neptune"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
)

// Run the apps/neptune.cluster.ts integration test: a real Neptune SERVERLESS
// cluster + db.serverless instance through the storage.neptune alpha port.
// Validates cluster read-back incl. the serverless v2 scaling configuration,
// grid-scoped naming, and the post-apply drift oracle.
func TestNeptuneCluster(t *testing.T) {
	runStorageIntegrationTest(t, "neptune.cluster", "us-east-1", validateNeptuneCluster)
}

func validateNeptuneCluster(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	clusterID := outputs["cluster_identifier"].(string)
	endpointAddress := outputs["cluster_endpoint_address"].(string)
	resourceID := outputs["cluster_resource_identifier"].(string)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := neptune.NewFromConfig(cfg)

	// --- 1. Cluster read-back incl. serverless scaling. ---
	dc, err := client.DescribeDBClusters(ctx, &neptune.DescribeDBClustersInput{
		DBClusterIdentifier: &clusterID,
	})
	require.NoError(t, err)
	require.Len(t, dc.DBClusters, 1)
	c := dc.DBClusters[0]
	require.Equal(t, "available", *c.Status)
	require.Equal(t, "neptune", *c.Engine)
	require.Equal(t, endpointAddress, *c.Endpoint)
	require.Equal(t, resourceID, *c.DbClusterResourceId)
	require.True(t, *c.StorageEncrypted, "storage encryption defaults to true")
	require.NotNil(t, c.ServerlessV2ScalingConfiguration,
		"serverless scaling configuration must reach AWS")
	require.Equal(t, float64(1), *c.ServerlessV2ScalingConfiguration.MinCapacity)
	require.Equal(t, 2.5, *c.ServerlessV2ScalingConfiguration.MaxCapacity)
	t.Logf("neptune-cluster: %s available (neptune %s, serverless %.1f-%.1f NCU, encrypted)",
		clusterID, *c.EngineVersion, *c.ServerlessV2ScalingConfiguration.MinCapacity, *c.ServerlessV2ScalingConfiguration.MaxCapacity)

	// --- 2. The single instance is db.serverless with a grid-derived name. ---
	require.Len(t, c.DBClusterMembers, 1)
	instanceID := *c.DBClusterMembers[0].DBInstanceIdentifier
	di, err := client.DescribeDBInstances(ctx, &neptune.DescribeDBInstancesInput{
		DBInstanceIdentifier: &instanceID,
	})
	require.NoError(t, err)
	require.Len(t, di.DBInstances, 1)
	require.Equal(t, "db.serverless", *di.DBInstances[0].DBInstanceClass)
	require.Equal(t, clusterID+"instance1", instanceID,
		"instance identifier must derive from the grid-scoped cluster identifier")
	t.Logf("neptune-cluster: instance %s is db.serverless", instanceID)

	// --- Drift oracle: re-planning the already-applied stack must show zero changes. ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}
