package test

import (
	"os"
	"path/filepath"
	"testing"

	loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/terraconstructs/base/integ"
	util "github.com/terraconstructs/base/integ/aws"
	"github.com/terraconstructs/go-synth/executors"

	"github.com/gruntwork-io/terratest/modules/aws"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
)

var terratestLogger = loggers.Default

// Test the simple-ipv4-vpc app
func TestSimpleIPv4Vpc(t *testing.T) {
	t.Parallel()
	testApp := "simple-ipv4-vpc"
	awsRegion := "us-east-1"

	envVars := executors.EnvMap(os.Environ())
	envVars["AWS_REGION"] = awsRegion
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	tfWorkingDir := filepath.Join("tf", testApp)
	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	test_structure.RunTestStage(t, "synth_app", func() {
		// synth app with handlers for connectivity testing
		util.SynthApp(t, testApp, tfWorkingDir, envVars, "handlers")
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, nil)
	})

	// Validate the network connectivity
	test_structure.RunTestStage(t, "validate", func() {
		validateWithLambdaInvocations(t, tfWorkingDir, awsRegion)
	})
}

// fetchFunctionPayload is the payload for the fetch function
type fetchFunctionPayload struct {
	URL string `json:"url"`
}

// Validates all fetch functions have NAT'ed internet connectivity
func validateWithLambdaInvocations(t *testing.T, workingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	echoUrl := util.LoadOutputAttribute(t, terraformOptions, "echo", "url")
	fetchFunctionNames := integ.TerraformOutputJMES[[]string](t, terraformOptions,
		"[fetch_ip_data0.name, fetch_ip_data1.name, fetch_ip_private0.name, fetch_ip_private1.name]",
	)

	for _, fetchFunction := range fetchFunctionNames {
		response := aws.InvokeFunction(t, awsRegion, fetchFunction, fetchFunctionPayload{
			URL: echoUrl,
		})
		// TODO: Validate the response IP matches the expected NAT IP
		terratestLogger.Logf(t, "Response from %s: %v", fetchFunction, string(response))
	}
}
