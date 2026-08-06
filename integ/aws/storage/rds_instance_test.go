package test

import (
	"encoding/json"
	"testing"

	"github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
)

// Run the apps/rds.instance.ts integration test: a real Postgres db.t3.micro
// deployed through the storage.rds DatabaseInstance L2 with auto-generated
// credentials. Validates the instance read-back, the attach() protocol's
// merged secret value (engine/host/port/dbname/dbInstanceIdentifier), and the
// post-apply drift oracle.
func TestRdsInstance(t *testing.T) {
	runStorageIntegrationTest(t, "rds.instance", "us-east-1", validateRdsInstance)
}

func validateRdsInstance(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	instanceID := outputs["instance_identifier"].(string)
	endpointAddress := outputs["instance_endpoint_address"].(string)
	secretArn := outputs["secret_arn"].(string)

	// --- 1. Instance read-back. ---
	details, err := aws.GetRdsInstanceDetailsE(t, instanceID, awsRegion)
	require.NoError(t, err)
	require.Equal(t, "available", *details.DBInstanceStatus)
	require.Equal(t, "postgres", *details.Engine)
	require.Equal(t, "db.t3.micro", *details.DBInstanceClass)
	require.False(t, *details.MultiAZ)
	require.NotNil(t, details.Endpoint)
	require.Equal(t, endpointAddress, *details.Endpoint.Address)
	t.Logf("rds-instance: %s available (%s %s at %s:%d)", instanceID,
		*details.Engine, *details.DBInstanceClass, *details.Endpoint.Address, *details.Endpoint.Port)

	// --- 2. The attached DatabaseSecret carries the merged connection fields
	// from DatabaseInstanceBase.asSecretAttachmentTarget() (the shipped
	// reference ISecretAttachmentTarget implementation). ---
	// NOTE: `port` is a JSON NUMBER (not a string) -- CloudFormation's
	// SecretTargetAttachment writes it as a number too, and the construct
	// preserves that parity, so the map must be mixed-type.
	secretValue := aws.GetSecretValue(t, awsRegion, secretArn)
	var connection map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(secretValue), &connection))
	require.Equal(t, "dbadmin", connection["username"])
	require.NotEmpty(t, connection["password"])
	require.Equal(t, "postgres", connection["engine"])
	require.Equal(t, endpointAddress, connection["host"])
	require.Equal(t, float64(*details.Endpoint.Port), connection["port"],
		"port must be a JSON number (CFN SecretTargetAttachment parity)")
	require.Equal(t, "appdb", connection["dbname"])
	require.Equal(t, instanceID, connection["dbInstanceIdentifier"],
		"attach() must merge dbInstanceIdentifier (CFN SecretTargetAttachment parity)")
	t.Logf("rds-instance: attached secret carries full connection details incl. dbInstanceIdentifier=%s", instanceID)

	// --- Drift oracle: re-planning the already-applied stack must show zero
	// changes. Catches sentinel-default and read-back mismatches invisible at
	// synth time (password ignore_changes, storage/iops normalization, etc.). ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}
