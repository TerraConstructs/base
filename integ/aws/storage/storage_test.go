package test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/terraconstructs/go-synth/executors"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the bucket-notifications integration
func TestBucketNotifications(t *testing.T) {
	runStorageIntegrationTest(t, "bucket-notifications", "us-east-1", validateBucketNotifications)
}

// Validate bucket-notifications integration test
func validateBucketNotifications(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	bucketName := util.LoadOutputAttribute(t, terraformOptions, "bucket", "name")
	util.AssertS3BucketNotificationExists(t, awsRegion, bucketName)
}

// run integration test
func runStorageIntegrationTest(t *testing.T, testApp, awsRegion string, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
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
		util.DeployUsingTerraform(t, tfWorkingDir, map[string]string{
			// TODO: Fix Dependency tree to avoid this error :(
			".*The EventInvokeConfig for function .* could not be updated due to a concurrent update operation.*": "Failed due to concurrent update operation.",
		})
	})
	test_structure.RunTestStage(t, "validate", func() {
		validate(t, tfWorkingDir, awsRegion)
	})
}
