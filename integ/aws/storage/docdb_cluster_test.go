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

// Run the apps/docdb.cluster.ts integration test: a real DocumentDB cluster +
// db.t3.medium instance deployed through the storage.docdb DatabaseCluster L2.
// Validates cluster/instance read-back (DocDB shares the RDS API), the
// attach() protocol's merged secret (incl. the mongo/ssl fields the rotation
// Lambda requires), and the post-apply drift oracle.
func TestDocdbCluster(t *testing.T) {
	runStorageIntegrationTest(t, "docdb.cluster", "us-east-1", validateDocdbCluster)
}

func validateDocdbCluster(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	clusterID := outputs["cluster_identifier"].(string)
	endpointAddress := outputs["cluster_endpoint_address"].(string)
	secretArn := outputs["secret_arn"].(string)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := rds.NewFromConfig(cfg)

	// --- 1. Cluster read-back (DocDB answers on the RDS API). ---
	dc, err := client.DescribeDBClusters(ctx, &rds.DescribeDBClustersInput{
		DBClusterIdentifier: &clusterID,
	})
	require.NoError(t, err)
	require.Len(t, dc.DBClusters, 1)
	c := dc.DBClusters[0]
	require.Equal(t, "available", *c.Status)
	require.Equal(t, "docdb", *c.Engine)
	require.Equal(t, endpointAddress, *c.Endpoint)
	require.True(t, *c.StorageEncrypted, "storage encryption defaults to true")
	t.Logf("docdb-cluster: %s available (engine docdb %s, encrypted)", clusterID, *c.EngineVersion)

	// --- 2. The single instance is db.t3.medium. ---
	require.Len(t, c.DBClusterMembers, 1)
	instanceID := *c.DBClusterMembers[0].DBInstanceIdentifier
	di, err := client.DescribeDBInstances(ctx, &rds.DescribeDBInstancesInput{
		DBInstanceIdentifier: &instanceID,
	})
	require.NoError(t, err)
	require.Len(t, di.DBInstances, 1)
	require.Equal(t, "db.t3.medium", *di.DBInstances[0].DBInstanceClass)
	t.Logf("docdb-cluster: instance %s is db.t3.medium", instanceID)

	// --- 3. Attached secret carries the merged connection fields incl. the
	// mongo/ssl fields the MongoDB rotation Lambda requires (port is a JSON
	// NUMBER -- CFN SecretTargetAttachment parity). ---
	secretValue := aws.GetSecretValue(t, awsRegion, secretArn)
	var connection map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(secretValue), &connection))
	require.Equal(t, "docadmin", connection["username"])
	require.NotEmpty(t, connection["password"])
	require.Equal(t, "mongo", connection["engine"])
	require.Equal(t, "true", connection["ssl"])
	require.Equal(t, endpointAddress, connection["host"])
	require.Equal(t, float64(*c.Port), connection["port"])
	require.Equal(t, clusterID, connection["dbClusterIdentifier"])
	t.Logf("docdb-cluster: attached secret carries mongo connection details incl. dbClusterIdentifier=%s", clusterID)

	// --- Drift oracle: re-planning the already-applied stack must show zero changes. ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}
