package test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/gruntwork-io/terratest/modules/aws"
	loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/base/integ"
	util "github.com/terraconstructs/base/integ/aws"
	"github.com/terraconstructs/go-synth/executors"
)

var terratestLogger = loggers.Default

// Run the apps/key.ts integration test
func TestKey(t *testing.T) {
	app := "key"
	runEncryptionIntegrationTest(t, app, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			snapshotPath := filepath.Join("snapshots", app)
			// Load the Terraform Options saved by the earlier deploy_terraform stage
			terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)

			// validate addToResourcePolicy() call
			keyId := util.LoadOutputAttribute(t, terraformOptions, "key", "keyId")
			keyPolicy := util.GetKmsKeyPolicy(t, awsRegion, keyId)
			// require the policy document to be a valid JSON
			var policyDoc any
			err := json.Unmarshal([]byte(keyPolicy), &policyDoc)
			require.NoError(t, err)
			if os.Getenv("WRITE_SNAPSHOTS") == "true" {
				writeSnapshot(t, snapshotPath, policyDoc, "PolicyDocument")
			} else {
				integ.Assert(t, policyDoc, []integ.Assertion{
					// assert at least one statement grants kms:encrypt
					{
						Path:           "Statement[].Action[]",
						ExpectedRegexp: strPtr("^kms:encrypt$"),
					},
					// assert at least one statement has the root user as the principal
					{
						Path:           "Statement[].Principal.AWS",
						ExpectedRegexp: strPtr("^arn:aws:iam::\\d{12}:root$"),
					},
				})
			}

			// validate the alias exists and points to the right keyId
			aliasName := util.LoadOutputAttribute(t, terraformOptions, "alias", "aliasName")
			aliasEntry := util.GetKmsAlias(t, awsRegion, aliasName)
			require.Equal(t, *aliasEntry.TargetKeyId, keyId)
		})
}

// Run the apps/key-alias.ts integration test
func TestKeyAlias(t *testing.T) {
	runEncryptionIntegrationTest(t, "key-alias", "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			// Load the Terraform Options saved by the earlier deploy_terraform stage
			terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
			aliasOutputs := terraform.OutputMapOfObjects(t, terraformOptions, "alias")
			require.NotNil(t, aliasOutputs)
			aliasName := aliasOutputs["aliasName"].(string)
			targetKey := aliasOutputs["aliasTargetKey"].(map[string]interface{})
			targetKeyArn := targetKey["keyArn"].(string)

			keyArn := aws.GetCmkArn(t, awsRegion, aliasName)
			require.Equal(t, targetKeyArn, keyArn)
		})
}

// run encryption integration test
func runEncryptionIntegrationTest(t *testing.T, testApp, awsRegion string, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars := executors.EnvMap(os.Environ())
	envVars["AWS_REGION"] = awsRegion
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	test_structure.RunTestStage(t, "synth_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars)
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, nil)
	})
	test_structure.RunTestStage(t, "validate", func() {
		validate(t, tfWorkingDir, awsRegion)
	})
}

// writeSnapshot writes the full entity to a snapshot file
// this is useful in an initial run to capture the created resources in AWS.
func writeSnapshot(t *testing.T, snapshotDir string, entity any, entityName string) {
	fileName := filepath.Join(snapshotDir, "outputs", entityName+".json")
	roleString, err := json.MarshalIndent(entity, "", "  ")
	require.NoError(t, err)
	err = os.MkdirAll(filepath.Dir(fileName), 0755)
	require.NoError(t, err)
	terratestLogger.Logf(t, "Writing snapshot to %s", fileName)
	err = os.WriteFile(fileName, roleString, 0644)
	require.NoError(t, err)
}

func strPtr(s string) *string {
	return &s
}
