package test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/rds"
	"github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
)

// Run the apps/rds.cluster.ts integration test: a real Aurora PostgreSQL
// SERVERLESS V2 cluster deployed through the storage.rds DatabaseCluster L2
// with a serverlessV2 writer and the Data API enabled. Validates the
// serverlessv2_scaling_configuration read-back (the addOverride block-emission
// design), the db.serverless writer, the attach() protocol's merged secret,
// and the post-apply drift oracle.
func TestRdsCluster(t *testing.T) {
	runStorageIntegrationTest(t, "rds.cluster", "us-east-1", validateRdsCluster)
}

func validateRdsCluster(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	clusterID := outputs["cluster_identifier"].(string)
	endpointAddress := outputs["cluster_endpoint_address"].(string)
	secretArn := outputs["secret_arn"].(string)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := rds.NewFromConfig(cfg)

	// --- 1. Cluster read-back: engine, status, Data API, Serverless v2 scaling. ---
	dc, err := client.DescribeDBClusters(ctx, &rds.DescribeDBClustersInput{
		DBClusterIdentifier: &clusterID,
	})
	require.NoError(t, err)
	require.Len(t, dc.DBClusters, 1)
	c := dc.DBClusters[0]
	require.Equal(t, "available", *c.Status)
	require.Equal(t, "aurora-postgresql", *c.Engine)
	require.Equal(t, endpointAddress, *c.Endpoint)
	require.NotNil(t, c.HttpEndpointEnabled)
	require.True(t, *c.HttpEndpointEnabled, "enableDataApi must map to enable_http_endpoint")
	require.NotNil(t, c.ServerlessV2ScalingConfiguration,
		"serverlessv2_scaling_configuration must reach AWS (addOverride block-emission design)")
	require.Equal(t, 0.5, *c.ServerlessV2ScalingConfiguration.MinCapacity)
	require.Equal(t, float64(1), *c.ServerlessV2ScalingConfiguration.MaxCapacity)
	t.Logf("rds-cluster: %s available (aurora-postgresql, serverless v2 %.1f-%.1f ACU, Data API on)",
		clusterID, *c.ServerlessV2ScalingConfiguration.MinCapacity, *c.ServerlessV2ScalingConfiguration.MaxCapacity)

	// --- 2. Writer instance is db.serverless. ---
	require.NotEmpty(t, c.DBClusterMembers)
	writerID := ""
	for _, m := range c.DBClusterMembers {
		if m.IsClusterWriter != nil && *m.IsClusterWriter {
			writerID = *m.DBInstanceIdentifier
		}
	}
	require.NotEmpty(t, writerID, "cluster must have a writer member")
	di, err := client.DescribeDBInstances(ctx, &rds.DescribeDBInstancesInput{
		DBInstanceIdentifier: &writerID,
	})
	require.NoError(t, err)
	require.Len(t, di.DBInstances, 1)
	require.Equal(t, "db.serverless", *di.DBInstances[0].DBInstanceClass)
	t.Logf("rds-cluster: writer %s is db.serverless", writerID)

	// --- 3. Attached secret carries merged connection fields (port is a JSON
	// NUMBER -- CFN SecretTargetAttachment parity). ---
	secretValue := aws.GetSecretValue(t, awsRegion, secretArn)
	var connection map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(secretValue), &connection))
	require.Equal(t, "clusteradmin", connection["username"])
	require.NotEmpty(t, connection["password"])
	require.Equal(t, "aurora-postgresql", connection["engine"])
	require.Equal(t, endpointAddress, connection["host"])
	require.Equal(t, float64(*c.Port), connection["port"])
	require.Equal(t, "appdb", connection["dbname"])
	require.Equal(t, clusterID, connection["dbClusterIdentifier"],
		"attach() must merge dbClusterIdentifier (CFN SecretTargetAttachment parity)")
	t.Logf("rds-cluster: attached secret carries full connection details incl. dbClusterIdentifier=%s", clusterID)

	// --- Drift oracle: re-planning the already-applied stack must show zero
	// changes. Proves the serverlessv2 addOverride block and the
	// master_password ignore_changes design read back cleanly. ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}
