package test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/go-synth/executors"

	http_helper "github.com/gruntwork-io/terratest/modules/http-helper"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

var terratestLogger = loggers.Default

// Test the Public Website bucket
func TestPublicWebsiteBucket(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	runStorageIntegrationTestWithRename(t, "public-website-bucket", "us-east-1", envVars, testWebsiteUrl)
}

// Test the Website Bucket with CDN
func TestCdnWebsiteBucket(t *testing.T) {
	testApp := "cdn-website-bucket"
	hostname := "e2e.terraconstructs.dev"

	envVars := executors.EnvMap(os.Environ())
	envVars["DNS_DOMAIN_NAME"] = hostname
	// TODO: Test Curl with the domain name
	envVars["DNS_ZONE_ID"] = "Z000441110FP43NILLF2D"

	// save hostname for future stages
	tfWorkingDir := filepath.Join("tf", testApp)
	test_structure.SaveString(t, tfWorkingDir, "hostname", hostname)
	runStorageIntegrationTestWithRename(t, testApp, "us-east-1", envVars, testCdnUrl)
}

// Ensure Website Bucket works
func testWebsiteUrl(t *testing.T, tfWorkingDir string, _awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	websiteUrl := util.LoadOutputAttribute(t, terraformOptions, "website", "websiteUrl")
	responseCode, _ := http_helper.HttpGet(t, fmt.Sprintf("http://%s", websiteUrl), nil)
	assert.Equal(t, 200, responseCode)
}

// Ensure Cdn works (either through hostname from Certificate or CloudFront DomainName)
func testCdnUrl(t *testing.T, tfWorkingDir string, _awsRegion string) {
	hostname := test_structure.LoadString(t, tfWorkingDir, "hostname")
	if hostname == "" {
		terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
		hostname = util.LoadOutputAttribute(t, terraformOptions, "cdn", "domainName")
	}
	responseCode, _ := http_helper.HttpGet(t, fmt.Sprintf("https://%s", hostname), nil)
	assert.Equal(t, 200, responseCode)
}

// run integration test and validate renaming the environment works without replacing any resources
func runStorageIntegrationTestWithRename(t *testing.T, testApp, awsRegion string, envVars map[string]string, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars["AWS_REGION"] = awsRegion
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	test_structure.RunTestStage(t, "synth_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars, "site")
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, nil)
	})
	test_structure.RunTestStage(t, "validate", func() {
		validate(t, tfWorkingDir, awsRegion)
	})

	// rename the environment name
	envVars["ENVIRONMENT_NAME"] = "renamed"
	test_structure.RunTestStage(t, "rename_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars, "site")
	})

	// confirm no changes in plan
	test_structure.RunTestStage(t, "validate_rename", func() {
		replanUsingTerraform(t, tfWorkingDir)
	})
}

func replanUsingTerraform(t *testing.T, workingDir string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	plan := terraform.InitAndPlanAndShowWithStructNoLogTempPlanFile(t, terraformOptions)
	// validate no replace in plan struct
	summarizePlan(t, plan)
	require.Equal(t, 0, countReplaceActions(plan))
}

func summarizePlan(t *testing.T, plan *terraform.PlanStruct) int {
	count := 0
	for _, change := range plan.ResourceChangesMap {
		addres := change.Address
		if change.Change.Actions.Create() {
			terratestLogger.Logf(t, "Create Action: %v", addres)
		} else if change.Change.Actions.Delete() {
			terratestLogger.Logf(t, "Delete Action: %v", addres)
		} else if change.Change.Actions.Replace() {
			prettyDiff, err := util.PrettyPrintResourceChange(change)
			require.NoError(t, err)
			terratestLogger.Logf(t, "Replace Action:  %v - %v", addres, prettyDiff)
		} else if change.Change.Actions.Update() {
			prettyDiff, err := util.PrettyPrintResourceChange(change)
			require.NoError(t, err)
			terratestLogger.Logf(t, "Update Action: %v - %v", addres, prettyDiff)
		}
	}
	return count
}

func countReplaceActions(plan *terraform.PlanStruct) int {
	count := 0
	for _, change := range plan.ResourceChangesMap {
		if change.Change.Actions.Replace() {
			count++
		}
	}
	return count
}
