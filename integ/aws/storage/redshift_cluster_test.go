package test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/redshift"
	"github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
)

// Run the apps/redshift.cluster.ts integration test: a real single-node
// ra3.large Redshift cluster deployed through the storage.redshift Cluster L2
// (scope-reduced alpha port). Validates cluster read-back incl. the attached
// ClusterParameterGroup, IAM role association plus the native
// default_iam_role_arn deviation, the attach() protocol's merged secret,
// grid-scoped lowercased naming, and the post-apply drift oracle (the
// generated-secret master_password double-freeze).
func TestRedshiftCluster(t *testing.T) {
	runStorageIntegrationTest(t, "redshift.cluster", "us-east-1", validateRedshiftCluster)
}

func validateRedshiftCluster(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	clusterID := outputs["cluster_identifier"].(string)
	endpointAddress := outputs["cluster_endpoint_address"].(string)
	parameterGroupName := outputs["parameter_group_name"].(string)
	defaultRoleArn := outputs["default_role_arn"].(string)
	secretArn := outputs["secret_arn"].(string)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := redshift.NewFromConfig(cfg)

	// --- 1. Cluster read-back: status, node shape, encryption, endpoint, naming. ---
	dc, err := client.DescribeClusters(ctx, &redshift.DescribeClustersInput{
		ClusterIdentifier: &clusterID,
	})
	require.NoError(t, err)
	require.Len(t, dc.Clusters, 1)
	c := dc.Clusters[0]
	require.Equal(t, "available", *c.ClusterStatus)
	require.Equal(t, "ra3.large", *c.NodeType)
	require.Equal(t, int32(1), *c.NumberOfNodes)
	require.Equal(t, "admin", *c.MasterUsername)
	require.True(t, *c.Encrypted, "encryption defaults to true")
	require.False(t, *c.PubliclyAccessible)
	require.Equal(t, endpointAddress, *c.Endpoint.Address)
	t.Logf("redshift-cluster: %s available (%s x%d, encrypted, private)",
		clusterID, *c.NodeType, *c.NumberOfNodes)

	// --- 2. Parameter group attached and in-sync-able. ---
	foundParams := false
	for _, pg := range c.ClusterParameterGroups {
		if *pg.ParameterGroupName == parameterGroupName {
			foundParams = true
		}
	}
	require.True(t, foundParams,
		"cluster must be associated with the ported ClusterParameterGroup %s", parameterGroupName)
	t.Logf("redshift-cluster: parameter group %s attached", parameterGroupName)

	// --- 3. IAM role associated AND set as the cluster default (the native
	// default_iam_role_arn deviation -- upstream uses an AwsCustomResource). ---
	foundRole := false
	for _, r := range c.IamRoles {
		if *r.IamRoleArn == defaultRoleArn {
			foundRole = true
		}
	}
	require.True(t, foundRole, "role %s must be associated with the cluster", defaultRoleArn)
	require.NotNil(t, c.DefaultIamRoleArn)
	require.Equal(t, defaultRoleArn, *c.DefaultIamRoleArn,
		"default_iam_role_arn must reach AWS (native replacement for upstream's AwsCustomResource)")
	t.Logf("redshift-cluster: default IAM role %s set natively", defaultRoleArn)

	// --- 4. Attached secret carries merged connection fields (port is a JSON
	// NUMBER -- CFN SecretTargetAttachment parity). ---
	secretValue := aws.GetSecretValue(t, awsRegion, secretArn)
	var connection map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(secretValue), &connection))
	require.Equal(t, "admin", connection["username"])
	require.NotEmpty(t, connection["password"])
	require.Equal(t, "redshift", connection["engine"])
	require.Equal(t, endpointAddress, connection["host"])
	require.Equal(t, float64(*c.Endpoint.Port), connection["port"])
	require.Equal(t, clusterID, connection["dbClusterIdentifier"],
		"attach() must merge dbClusterIdentifier (CFN SecretTargetAttachment parity)")
	t.Logf("redshift-cluster: attached secret carries full connection details incl. dbClusterIdentifier=%s", clusterID)

	// --- Drift oracle: re-planning the already-applied stack must show zero
	// changes. Proves the generated-secret master_password ignore_changes
	// double-freeze reads back cleanly. ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}
