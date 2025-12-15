package test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gruntwork-io/terratest/modules/aws"
	loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/go-synth/executors"

	http_helper "github.com/gruntwork-io/terratest/modules/http-helper"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/terraconstructs/base/integ"
	util "github.com/terraconstructs/base/integ/aws"
)

var (
	terratestLogger                               = loggers.Default
	invocationTypeEvent util.InvocationTypeOption = util.InvocationTypeEvent
	region                                        = "us-east-1"
)

// Test the simple-ipv4-vpc app
func TestNodeJsFunctionUrl(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTestWithRename(t, "nodejs-function-url", options, testFunctionUrl)
}

// Test the destinations integrations
func TestDestinations(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "destinations", options, validateDestinations)
}

// Test the lambda-chain integration
func TestLambdaChain(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "lambda-chain", options, func(t *testing.T, tfWorkingDir, awsRegion string) {
		// sleep for event bridge rules to be ready
		time.Sleep(10 * time.Second)
		validateLambdaChainSuccess(t, tfWorkingDir, awsRegion)
		validateLambdaChainFailure(t, tfWorkingDir, awsRegion)
	})
}

// Test the lambda-vpc integration
func TestLambdaVpc(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "lambda-vpc", options, validateLambdaVpcSuccess)
}

// Test the lambda-runtime-inlinecode integration
func TestLambdaRuntimeInlineCode(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "lambda-runtime.inlinecode", options, validateLambdaRuntimeInlineCode)
}

// Test the event-source-sqs integration
func TestEventSourceSqs(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "event-source-sqs", options, validateEventSourceSqs)
}

// Test the event-source-sqs-filtered integration
func TestEventSourceSqsFiltered(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "event-source-sqs-filtered", options, validateEventSourceSqsFiltered)
}

// Test the event-source-s3 integration
func TestEventSourceS3(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "event-source-s3", options, validateEventSourceS3)
}

// Ensure Function URL works
func testFunctionUrl(t *testing.T, tfWorkingDir string, _awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	functionUrl := util.LoadOutputAttribute(t, terraformOptions, "echo", "url")
	responseCode, response := http_helper.HttpGet(t, functionUrl, nil)
	assert.Equal(t, 200, responseCode)
	terratestLogger.Logf(t, "Response from %s: %v", functionUrl, string(response))
}

// Validate the Destionation integration test
func validateDestinations(t *testing.T, tfWorkingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	functionName := util.LoadOutputAttribute(t, terraformOptions, "function", "name")
	queueUrl := util.LoadOutputAttribute(t, terraformOptions, "queue", "url")

	// https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-lambda-destinations/test/integ.destinations.ts#L88
	util.InvokeFunctionWithParams(t, awsRegion, functionName, &util.LambdaOptions{
		InvocationType: &invocationTypeEvent,
		Payload:        map[string]interface{}{"status": "OK"},
	})
	resp := util.WaitForQueueMessage(t, awsRegion, queueUrl, 20)
	var messageBody map[string]interface{}
	err := json.Unmarshal([]byte(resp.MessageBody), &messageBody)
	require.NoError(t, err, "Failed to unmarshal message body")
	integ.Assert(t, messageBody, []integ.Assertion{
		{
			Path:           "requestContext.condition",
			ExpectedRegexp: strPtr("Success"),
		},
		{
			Path:           "requestPayload.status",
			ExpectedRegexp: strPtr("OK"),
		},
		{
			Path:           "responseContext.statusCode",
			ExpectedRegexp: strPtr("200"),
		},
		{
			Path:           "responsePayload",
			ExpectedRegexp: strPtr("success"),
		},
	})
}

// Validate the LambdaChain integration test happy path
func validateLambdaChainSuccess(t *testing.T, tfWorkingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	firstFunctionName := util.LoadOutputAttribute(t, terraformOptions, "first_function", "name")
	thirdFunctionName := util.LoadOutputAttribute(t, terraformOptions, "third_function", "name")
	thirdFunctionLogGroup := fmt.Sprintf("/aws/lambda/%s", thirdFunctionName)
	// https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-lambda-destinations/test/integ.lambda-chain.ts#L65
	util.InvokeFunctionWithParams(t, awsRegion, firstFunctionName, &util.LambdaOptions{
		InvocationType: &invocationTypeEvent,
		Payload:        map[string]interface{}{"status": "success"},
	})
	messages := util.WaitForLogEvents(t, awsRegion, thirdFunctionLogGroup, 12, 5*time.Second)
	for _, message := range messages {
		// we log messages only, no messages fails the test
		terratestLogger.Logf(t, "Success Test: Message: %s", message)
	}
}

// Validate the LambdaChain integration test failure path
func validateLambdaChainFailure(t *testing.T, tfWorkingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	firstFunctionName := util.LoadOutputAttribute(t, terraformOptions, "first_function", "name")
	errorFunctionName := util.LoadOutputAttribute(t, terraformOptions, "error_function", "name")
	errorLogGroup := fmt.Sprintf("/aws/lambda/%s", errorFunctionName)
	util.InvokeFunctionWithParams(t, awsRegion, firstFunctionName, &util.LambdaOptions{
		InvocationType: &invocationTypeEvent,
		Payload:        map[string]interface{}{"status": "error"},
	})
	messages := util.WaitForLogEvents(t, awsRegion, errorLogGroup, 12, 5*time.Second)
	for _, message := range messages {
		// we log messages only, no messages fails the test
		terratestLogger.Logf(t, "Failure Test: Message: %s", message)
	}
}

// Validate the Lambda provisioning within vpc
func validateLambdaVpcSuccess(t *testing.T, tfWorkingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	firstFunctionName := util.LoadOutputAttribute(t, terraformOptions, "my_lambda", "name")

	util.InvokeFunctionSync(t, awsRegion, firstFunctionName)
	terratestLogger.Logf(t, "Successfully Invoked Function %q", firstFunctionName)
}

// Validate the Lambda runtime inlinecode
func validateLambdaRuntimeInlineCode(t *testing.T, tfWorkingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	// Test individual Lambda Functions from TerraformOutputs
	outputs := terraform.OutputAll(t, terraformOptions)
	for _, outputValue := range outputs {
		functionName, ok := outputValue.(string)
		if !ok {
			continue // ignore any non-string outputs
		}
		t.Run(functionName, func(t *testing.T) {
			// parallel subtests for each function
			t.Parallel()
			util.InvokeFunctionSync(t, awsRegion, functionName)
			terratestLogger.Logf(t, "Successfully Invoked Function %q", functionName)
		})
	}
}

// Validate the Destionation integration test
func validateEventSourceSqs(t *testing.T, tfWorkingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	functionName := util.LoadOutputAttribute(t, terraformOptions, "function", "name")
	queueUrl := util.LoadOutputAttribute(t, terraformOptions, "queue", "url")
	functionLogGroup := fmt.Sprintf("/aws/lambda/%s", functionName)

	messageBody := "Test message"
	aws.SendMessageToQueue(t, awsRegion, queueUrl, messageBody)
	aws.SendMessageToQueue(t, awsRegion, queueUrl, messageBody)
	assertFunctionLogMessage(t, awsRegion, functionLogGroup, integ.Assertion{
		Path:           "Records[0].body",
		ExpectedRegexp: &messageBody,
	})
}

// Validate the Destionation integration test
func validateEventSourceSqsFiltered(t *testing.T, tfWorkingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	functionName := util.LoadOutputAttribute(t, terraformOptions, "function", "name")
	queueUrl := util.LoadOutputAttribute(t, terraformOptions, "queue", "url")
	functionLogGroup := fmt.Sprintf("/aws/lambda/%s", functionName)

	messageBody := `{"id": "test"}`
	aws.SendMessageToQueue(t, awsRegion, queueUrl, "random message") // should not trigger function
	aws.SendMessageToQueue(t, awsRegion, queueUrl, messageBody)
	assertFunctionLogMessage(t, awsRegion, functionLogGroup, integ.Assertion{
		Path:           "Records[0].body",
		ExpectedRegexp: &messageBody,
	})
}

// Validate the Destionation integration test
func validateEventSourceS3(t *testing.T, tfWorkingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	functionName := util.LoadOutputAttribute(t, terraformOptions, "function", "name")
	bucketName := util.LoadOutputAttribute(t, terraformOptions, "bucket", "name")
	functionLogGroup := fmt.Sprintf("/aws/lambda/%s", functionName)

	objectKey := "subdir/test.txt"
	util.UploadS3File(t, awsRegion, bucketName, objectKey, "sample content")
	assertFunctionLogMessage(t, awsRegion, functionLogGroup, integ.Assertion{
		Path:           "Records[0].s3.object.key",
		ExpectedRegexp: &objectKey,
	})
}

// Assert function is called and structured log message matches assertions
func assertFunctionLogMessage(t *testing.T, awsRegion string, functionLogGroup string, assertions ...integ.Assertion) {
	logEntries := util.WaitForLogEvents(t, awsRegion, functionLogGroup, 12, 5*time.Second)
	var logMessage map[string]interface{}
	for _, entry := range logEntries {
		err := json.Unmarshal([]byte(entry), &logMessage)
		if err != nil {
			// ignore, this shouldn't happen (but sometimes lambda system start message is unstructured)
			terratestLogger.Logf(t, "Ignoring log message: %s", entry)
			continue
		}
		if _, ok := logMessage["message"]; ok {
			var event map[string]interface{}
			err := json.Unmarshal([]byte(logMessage["message"].(string)), &event)
			require.NoError(t, err, "Failed to unmarshal event data")
			integ.Assert(t, event, assertions)
		}
	}
}

type integrationTestOptions struct {
	// Region is the AWS region to run the test in.
	//
	// This is used to set the AWS_REGION environment variable
	Region string
	// AdditionalAssets are additional assets to be copied to the working directory.
	//
	// "handlers" is always included, so this is for additional files
	AdditionalAssets []string
}

// run integration test
func runComputeIntegrationTest(t *testing.T, testApp string, options integrationTestOptions, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars := executors.EnvMap(os.Environ())
	envVars["AWS_REGION"] = options.Region
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	assets := []string{"handlers"}
	if len(options.AdditionalAssets) > 0 {
		assets = append(assets, options.AdditionalAssets...)
	}

	test_structure.RunTestStage(t, "synth_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars, assets...)
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, map[string]string{
			// TODO: Fix Dependency tree to avoid this error :(
			".*The EventInvokeConfig for function .* could not be updated due to a concurrent update operation.*": "Failed due to concurrent update operation.",
		})
	})
	test_structure.RunTestStage(t, "validate", func() {
		validate(t, tfWorkingDir, options.Region)
	})
}

// run integration test and validate renaming the environment works without replacing any resources
func runComputeIntegrationTestWithRename(t *testing.T, testApp string, options integrationTestOptions, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars := executors.EnvMap(os.Environ())
	envVars["AWS_REGION"] = options.Region
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	test_structure.RunTestStage(t, "synth_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars, "handlers")
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, map[string]string{
			// TODO: Fix Dependency tree to avoid this error :(
			".*The EventInvokeConfig for function .* could not be updated due to a concurrent update operation.*": "Failed due to concurrent update operation.",
		})
	})
	test_structure.RunTestStage(t, "validate", func() {
		validate(t, tfWorkingDir, options.Region)
	})

	// rename the environment name
	envVars["ENVIRONMENT_NAME"] = "renamed"
	test_structure.RunTestStage(t, "rename_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars, "handlers")
	})

	// confirm no changes in plan
	test_structure.RunTestStage(t, "validate_rename", func() {
		replanUsingTerraform(t, tfWorkingDir)
	})
}

func strPtr(s string) *string {
	return &s
}
