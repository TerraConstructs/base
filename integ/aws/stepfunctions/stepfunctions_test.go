package test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/sfn/types"
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

// Run the apps/call-aws-service.ts integration test
func TestCallAwsService(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "call-aws-service", "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			message := "hello world!"
			input := map[string]interface{}{
				"body": message,
			}
			validateStateMachineSucceedsWithOutput(t, tfWorkingDir, awsRegion,
				input,
				// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/aws-sdk/integ.call-aws-service.ts#L13
				integ.Assertion{
					Path:           "Body",
					ExpectedRegexp: &message,
				})
		})
}

// Run the apps/call-aws-service-sfn.ts integration test
func TestCallAwsServiceSfn(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "call-aws-service-sfn", "us-east-1", validateStateMachineSucceeds)
}

// Run the apps/call-aws-service-mwaa.ts integration test
func TestCallAwsServiceMwaa(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "call-aws-service-mwaa", "us-east-1", validateStateMachineSucceeds)
}

// Run the apps/call-aws-service-mediapackagevod.ts integration test
func TestCallAwsServiceMediapackagevod(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "call-aws-service-mediapackagevod", "us-east-1", validateStateMachineSucceeds)
}

// Run the apps/call-aws-service-logs.ts integration test
func TestCallAwsServiceLogs(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "call-aws-service-logs", "us-east-1", validateStateMachineSucceeds)
}

// Run the apps/call-aws-service-efs.ts integration test
func TestCallAwsServiceEfs(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "call-aws-service-efs", "us-east-1", validateCallAwsServiceEfs)
}

// Run the apps/sqs-send-message.ts integration test
func TestSqsSendMessage(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "sqs-send-message", "us-east-1", validateSqsSendMessage)
}

// Run the apps/sfn-invoke-activity.ts integration test
func TestSfnInvokeActivity(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "sfn-invoke-activity", "us-east-1", validateSfnInvokeActivity)
}

// Run the apps/sfn-start-execution.ts integration test
func TestSfnStartExecution(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "sfn-start-execution", "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			message := "hello world!"
			input := map[string]interface{}{
				"body": message,
			}
			validateStateMachineSucceedsWithOutput(t, tfWorkingDir, awsRegion,
				input,
				// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/stepfunctions/integ.start-execution.ts#L10
				integ.Assertion{
					Path:           "Body",
					ExpectedRegexp: &message,
				})
		})
}

// Run the apps/lambda-invoke-function.ts integration test
// https://docs.aws.amazon.com/step-functions/latest/dg/callback-task-sample-sqs.html#call-back-lambda-example
func TestLambdaInvokeFunction(t *testing.T) {
	testApp := "lambda-invoke-function"
	tfWorkingDir := filepath.Join("tf", testApp)
	util.SaveSynthDependencies(t, tfWorkingDir, &map[string]string{
		"@aws-sdk/client-sfn": "^3.682.0",
	})
	runStepfunctionsIntegrationTest(t, testApp, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			input := map[string]any{
				"guid": 1234,
			}
			validateStateMachineSucceedsWithOutput(t, tfWorkingDir, awsRegion, input)
		})
}

// Run the apps/lambda-invoke.ts integration test
func TestLambdaInvoke(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "lambda-invoke", "us-east-1", validateStateMachineSucceeds)
}

// Run the apps/lambda-invoke.payload.only.ts integration test
func TestLambdaInvokePayloadOnly(t *testing.T) {
	runStepfunctionsIntegrationTest(t, "lambda-invoke.payload.only", "us-east-1", validateStateMachineSucceeds)
}

// Run the apps/eventbridge-put-events.ts integration test
func TestEventbridgePutEvents(t *testing.T) {
	// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/@aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/eventbridge/integ.put-events.ts#L43
	runStepfunctionsIntegrationTest(t, "eventbridge-put-events", "us-east-1", validateStateMachineSucceeds)
}

// Validate the call-aws-service-efs integration test
func validateCallAwsServiceEfs(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	stateMachineArn := util.LoadOutputAttribute(t, terraformOptions, "state_machine", "arn")
	efsAccessPointArn := terraform.OutputRequired(t, terraformOptions, "efs_accesspoint_arn")
	// sleep for iam propagation
	time.Sleep(5 * time.Second)

	sampleInput := map[string]interface{}{
		"pathToArn": efsAccessPointArn,
		"pathToId":  "MYTAGVALUE",
	}
	executionArn := util.StartSfnExecution(t, awsRegion, stateMachineArn, sampleInput)
	util.WaitForSfnExecutionStatus(t, awsRegion, *executionArn, types.ExecutionStatusSucceeded, 12, 5*time.Second)
}

// Validate the sqs-send-message integration test
func validateSqsSendMessage(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	stateMachineArn := util.LoadOutputAttribute(t, terraformOptions, "state_machine", "arn")
	queueUrl := util.LoadOutputAttribute(t, terraformOptions, "queue", "url")
	// sleep for iam propagation
	time.Sleep(5 * time.Second)

	executionArn := util.StartSfnExecution(t, awsRegion, stateMachineArn, nil)
	util.WaitForSfnExecutionStatus(t, awsRegion, *executionArn, types.ExecutionStatusSucceeded, 12, 5*time.Second)
	// validate sqs message
	resp := util.WaitForQueueMessage(t, awsRegion, queueUrl, 20)
	terratestLogger.Logf(t, "Message Body: %v", resp.MessageBody)
	// verify this is message sent from the step function
	require.Equal(t, resp.MessageBody, "sending message over")
	aws.DeleteMessageFromQueue(t, awsRegion, queueUrl, resp.ReceiptHandle)
}

// Validate the sfn-invoke-activity integration test.
//
// This test validates the Poller pattern with external Activity Workers simulated by Terratest
func validateSfnInvokeActivity(t *testing.T, tfWorkingDir string, awsRegion string) {
	workerName := "terratest_worker"
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	stateMachineArn := util.LoadOutputAttribute(t, terraformOptions, "state_machine", "arn")
	submitJobActivity := util.LoadOutputAttribute(t, terraformOptions, "submit_job_activity", "arn")
	checkJobActivity := util.LoadOutputAttribute(t, terraformOptions, "check_job_activity", "arn")

	waitTime := 10 // NOTE: we poll for activity 5s before poller resumes
	executionArn := util.StartSfnExecution(t, awsRegion, stateMachineArn, map[string]string{
		"wait_time": strconv.Itoa(waitTime),
	})
	util.WaitForSfnExecutionStatus(t, awsRegion, *executionArn, types.ExecutionStatusRunning, 3, 3*time.Second)

	// 1. Signal submitJob activity to state machine
	guid := "1234"
	terratestLogger.Logf(t, "Submitting Job: %v", guid)
	submitJobHandler := util.GetSfnActivity(t, awsRegion, submitJobActivity, &workerName)
	err := submitJobHandler.SendSuccess(guid) // output guid of submitted job
	if err != nil {
		terratestLogger.Logf(t, "Error sending submitJob Activity success: %v", err)
		util.StopSfnExecution(t, awsRegion, *executionArn)
		t.FailNow()
	}

	// 2. Sleep during Poller wait_time
	terratestLogger.Logf(t, "Waiting for State Machine to create Check Job Activity")
	time.Sleep(time.Duration(waitTime-5) * time.Second)

	// 3. Report Job status to Poller
	checkJobHandler := util.GetSfnActivity(t, awsRegion, checkJobActivity, &workerName)
	require.Equal(t, checkJobHandler.Input(), guid)
	err = checkJobHandler.SendSuccess("SUCCEEDED") // output job status SUCCEEDED
	if err != nil {
		terratestLogger.Logf(t, "Error sending checkJob Activity success: %v", err)
		util.StopSfnExecution(t, awsRegion, *executionArn)
		t.FailNow()
	}

	// 4. Report final job status
	checkJobHandler = util.GetSfnActivity(t, awsRegion, checkJobActivity, &workerName)
	integ.Assert(t, checkJobHandler.Input(), []integ.Assertion{
		{
			Path:           "input.guid", // validate nested input of final checkJob activity
			ExpectedRegexp: &guid,
		},
	})
	err = checkJobHandler.SendSuccess("SUCCEEDED") // output final job status SUCCEEDED
	require.NoError(t, err)
	// ensure state machine execution completes
	util.WaitForSfnExecutionStatus(t, awsRegion, *executionArn, types.ExecutionStatusSucceeded, 3, 3*time.Second)
}

// Validate state machine execution succeeds after starting without checking the output
func validateStateMachineSucceeds(t *testing.T, tfWorkingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	stateMachineArn := util.LoadOutputAttribute(t, terraformOptions, "state_machine", "arn")
	// sleep for iam propagation
	time.Sleep(5 * time.Second)

	// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/aws-sdk/integ.call-aws-service-sfn.ts#L35
	// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/lambda/integ.invoke.ts#L99
	executionArn := util.StartSfnExecution(t, awsRegion, stateMachineArn, nil)
	util.WaitForSfnExecutionStatus(t, awsRegion, *executionArn,
		types.ExecutionStatusSucceeded,
		3,
		3*time.Second,
	)
}

// Validate state machine execution succeeds after starting and asserts output
func validateStateMachineSucceedsWithOutput(t *testing.T, tfWorkingDir string, awsRegion string, input interface{}, assertions ...integ.Assertion) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	stateMachineArn := util.LoadOutputAttribute(t, terraformOptions, "state_machine", "arn")
	// sleep for iam propagation
	time.Sleep(5 * time.Second)
	executionArn := util.StartSfnExecution(t, awsRegion, stateMachineArn, input)
	result := util.WaitForSfnExecutionStatus(t, awsRegion, *executionArn,
		types.ExecutionStatusSucceeded,
		3,
		3*time.Second,
	)
	require.NotNil(t, result.Output)
	var output map[string]interface{}
	err := json.Unmarshal([]byte(result.Output), &output)
	require.NoError(t, err)
	integ.Assert(t, output, assertions)
}

// run stepfunctions integration test
func runStepfunctionsIntegrationTest(t *testing.T, testApp, awsRegion string, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
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
		util.SynthApp(t, testApp, tfWorkingDir, envVars, "handlers")
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, nil)
	})
	test_structure.RunTestStage(t, "validate", func() {
		validate(t, tfWorkingDir, awsRegion)
	})
}
