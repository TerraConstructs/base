package test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sns/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/base/integ"
	util "github.com/terraconstructs/base/integ/aws"
	"github.com/terraconstructs/go-synth/executors"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
)

var terratestLogger = loggers.Default

// Test the fifo-queue app
func TestFifoQueue(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	// Confirm the FIFO queue is working as expected
	runNotifyIntegrationTest(t, "fifo-queue", "us-east-1", envVars, validateFifoQueue)
}

// Test the dlq-queue app
func TestDlqQueue(t *testing.T) {
	testApp := "dlq-queue"
	awsRegion := "us-east-1"
	// set low maxReceiveCount to trigger DLQ
	maxReceiveCount := 2
	visibilityTimeoutSeconds := 5

	envVars := executors.EnvMap(os.Environ())
	envVars["MAX_RECEIVE_COUNT"] = strconv.Itoa(maxReceiveCount)
	envVars["VISIBILITY_TIMEOUT_SECONDS"] = strconv.Itoa(visibilityTimeoutSeconds)

	// save maxReceiveCount for future stages
	tfWorkingDir := filepath.Join("tf", testApp)
	test_structure.SaveInt(t, tfWorkingDir, "max_receive_count", maxReceiveCount)
	// Confirm the DLQ queue is working as expected
	runNotifyIntegrationTest(t, testApp, awsRegion, envVars, validateDlqQueue)
}

// Test the stream app
func TestStream(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	// Confirm the kinesis stream is active and iam role has the correct permissions
	runNotifyIntegrationTest(t, "stream", "us-east-1", envVars, validateStream)
}

// Test the stream-dashboard app
func TestStreamDashboard(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	// Confirm the dashboard is working as expected
	runNotifyIntegrationTest(t, "stream-dashboard", "us-east-1", envVars, validateStreamDashboard)
}

// Test the stream-resource-policy app
func TestStreamResourcePolicy(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	// Confirm the stream resource policy is set as expected
	runNotifyIntegrationTest(t, "stream-resource-policy", "us-east-1", envVars, validateStreamResourcePoliy)
}

// Test the sns app
func TestSns(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())

	// See if app deploys
	testApp := "sns"
	awsRegion := "us-east-1"
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
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
	// test_structure.RunTestStage(t, "validate", func() {
	// 	validate(t, tfWorkingDir, awsRegion)
	// })
}

// Test the sns-lambda app
func TestSnsLambda(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())

	// See if app deploys
	testApp := "sns-lambda"
	awsRegion := "us-east-1"
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
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
		validateSnsLambda(t, tfWorkingDir, awsRegion)
	})
}

func validateSnsLambda(t *testing.T, tfDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfDir)
	topicArn := util.LoadOutputAttribute(t, opts, "my_topic", "topicArn")
	echoFunctionName := util.LoadOutputAttribute(t, opts, "echo_function", "name")
	echoFunctionLogGroup := fmt.Sprintf("/aws/lambda/%s", echoFunctionName)
	msgBodyFilteredFunctionName := util.LoadOutputAttribute(t, opts, "filtered_message_body_function", "name")
	msgBodyFilteredFunctionLogGroup := fmt.Sprintf("/aws/lambda/%s", msgBodyFilteredFunctionName)
	// // TODO: Find out why the filtered function is not being triggered
	// filteredFunctionName := util.LoadOutputAttribute(t, opts, "filtered_function", "name")
	// filteredFunctionLogGroup := fmt.Sprintf("/aws/lambda/%s", filteredFunctionName)

	// Publish a Message that should trigger all functions
	bodyPos := `{ "background": { "color": "red" }, "price": 200 }`
	attrsPos := map[string]types.MessageAttributeValue{
		"color": {
			DataType:    aws.String("String"),
			StringValue: aws.String(`"red"`),
		},
		"size": {
			DataType:    aws.String("String"),
			StringValue: aws.String(`"large"`),
		},
		"price": {
			DataType:    aws.String("Number"),
			StringValue: aws.String(`150`),
		},
	}
	util.PublishMessage(t, awsRegion, topicArn, bodyPos, attrsPos)

	messages := util.WaitForLogEvents(t, awsRegion, echoFunctionLogGroup, 12, 5*time.Second)
	for _, message := range messages {
		// we log messages only, no messages fails the test
		terratestLogger.Logf(t, "Success Test: Message: %s", message)
	}
	messages = util.WaitForLogEvents(t, awsRegion, msgBodyFilteredFunctionLogGroup, 12, 5*time.Second)
	for _, message := range messages {
		// we log messages only, no messages fails the test
		terratestLogger.Logf(t, "Success Test: Message: %s", message)
	}
	// // TODO: Find out why the filtered function is not being triggered
	// messages = util.WaitForLogEvents(t, awsRegion, filteredFunctionLogGroup, 12, 5*time.Second)
	// for _, message := range messages {
	// 	// we log messages only, no messages fails the test
	// 	terratestLogger.Logf(t, "Success Test: Message: %s", message)
	// }
}

// Test the sns-sqs app
func TestSnsSqs(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())

	// See if app deploys
	testApp := "sns-sqs"
	awsRegion := "us-east-1"
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
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
		validateSnsToSqs(t, tfWorkingDir, awsRegion)
	})
}

func validateSnsToSqs(t *testing.T, tfDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfDir)
	topicArn := util.LoadOutputAttribute(t, opts, "my_topic", "topicArn")
	queueUrl := util.LoadOutputAttribute(t, opts, "my_queue", "url")

	// 1) Positive case: matches filter → should arrive
	bodyPos := `{ "background": { "color": "green" }, "price": 200 }`
	util.PublishMessage(t, awsRegion, topicArn, bodyPos, nil)

	msg := util.WaitForQueueMessage(t, awsRegion, queueUrl, 20)
	require.NoError(t, msg.Error, "Expected to receive a message from the queue")
	var got map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(msg.MessageBody), &got))
	assert.Equal(t, bodyPos, got["Message"])

	// clean up
	terratestaws.DeleteMessageFromQueue(t, awsRegion, queueUrl, msg.ReceiptHandle)

	// 3. Negative case: a non-matching message
	bodyNeg := `{ "background": { "color": "white" }, "price": 100 }`
	util.PublishMessage(t, awsRegion, topicArn, bodyNeg, nil)
	// Use the E-variant to get an error on timeout rather than blocking
	resp := util.WaitForQueueMessage(t, awsRegion, queueUrl, 5)
	assert.NotNil(t, resp.Error, "Expected an error for non-matching filter")
}

// Test the sns-url app
func TestSnsUrl(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())

	// See if app deploys
	testApp := "sns-url"
	awsRegion := "us-east-1"
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
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
	// test_structure.RunTestStage(t, "validate", func() {
	// 	validate(t, tfWorkingDir, awsRegion)
	// })
}

func validateFifoQueue(t *testing.T, workingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	queueUrl := util.LoadOutputAttribute(t, terraformOptions, "fifo_queue", "url")
	messageBody := "Test message"
	// NOTE: either you pass in deduplicationId or set content based deduplication in the apps/fifo-queue.ts code
	util.SendMessageFifoToQueueWithDeduplicationId(t, awsRegion, queueUrl, messageBody, "test-group-id", "test-deduplication-id")
	resp := util.WaitForQueueMessage(t, awsRegion, queueUrl, 5)
	// TODO: should we validate deduplication prevents sending the same message?

	// Verify the message body matches
	assert.Equal(t, messageBody, resp.MessageBody, "Message body should match")
	terratestLogger.Logf(t, "Message successfully received from Fifo Queue: %s", resp.MessageBody)
}

func validateDlqQueue(t *testing.T, workingDir string, awsRegion string) {
	maxReceiveCount := test_structure.LoadInt(t, workingDir, "max_receive_count")
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	queueUrl := util.LoadOutputAttribute(t, terraformOptions, "queue", "url")
	dlqUrl := util.LoadOutputAttribute(t, terraformOptions, "dlq_queue", "url")
	messageBody := "Test message"
	terratestaws.SendMessageToQueue(t, awsRegion, queueUrl, messageBody)

	// Attempt to exceed the maxReceiveCount message without deleting it (trigger DLQ policy)
	for i := 0; i < maxReceiveCount; i++ {
		msgResponse := util.WaitForQueueMessage(t, awsRegion, queueUrl, 5)
		if msgResponse.Error != nil {
			t.Fatalf("Failed to receive message from queue: %v", msgResponse.Error)
		}
		terratestLogger.Logf(t, "Received message attempt %d/%d (approx receipts: %d): %s", i+1, maxReceiveCount, msgResponse.ApproximateReceiveCount, msgResponse.MessageBody)
		// Indicate message processing failure by setting visibility timeout to 0
		util.ChangeMessageVisibility(t, awsRegion, queueUrl, msgResponse.ReceiptHandle, 0)
	}

	// this should fail, or at least trigger the DLQ policy
	srcMsgResponse := util.WaitForQueueMessage(t, awsRegion, queueUrl, 1)
	if srcMsgResponse.Error == nil {
		t.Fatalf("Received message from queue after maxReceiveCount (approx receipts: %d): %s", srcMsgResponse.ApproximateReceiveCount, srcMsgResponse.MessageBody)
	}

	// Verify the message is moved to DLQ
	dlqMsgResponse := util.WaitForQueueMessage(t, awsRegion, dlqUrl, 60)
	if dlqMsgResponse.Error != nil {
		t.Fatalf("Failed to receive message from DLQ: %v", dlqMsgResponse.Error)
	}

	// Verify the message body matches
	assert.Equal(t, messageBody, dlqMsgResponse.MessageBody, "Message body should match in DLQ")
	terratestLogger.Logf(t, "Message was successfully moved to DLQ: %s (approx receipts: %d)", dlqMsgResponse.MessageBody, dlqMsgResponse.ApproximateReceiveCount)

	// Delete the message from the DLQ
	terratestaws.DeleteMessageFromQueue(t, awsRegion, dlqUrl, dlqMsgResponse.ReceiptHandle)
}

func validateStream(t *testing.T, workingDir string, awsRegion string) {
	snapshotPath := filepath.Join("snapshots", "stream")
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	streamName := util.LoadOutputAttribute(t, terraformOptions, "stream", "streamName")
	roleName := util.LoadOutputAttribute(t, terraformOptions, "role", "name")
	role := util.GetIamRole(t, awsRegion, roleName)
	// require the InlinePolicies to have more than 0 elements
	require.Greater(t, len(role.InlinePolicies), 0)
	// require the policy document to be a valid JSON
	var policyDoc any
	err := json.Unmarshal([]byte(role.InlinePolicies[0].PolicyDocument), &policyDoc)
	require.NoError(t, err)
	if os.Getenv("WRITE_SNAPSHOTS") == "true" {
		writeSnapshot(t, snapshotPath, role, "RoleOutputs")
		writeSnapshot(t, snapshotPath, policyDoc, "PolicyDocument")
	} else {
		actionsRe := "^kinesis:PutRecord$"
		integ.Assert(t, policyDoc, []integ.Assertion{
			{
				Path:           "Statement[].Action[]",
				ExpectedRegexp: &actionsRe,
			},
		})
	}
	util.WaitForStreamActive(t, awsRegion, streamName, 10, 10*time.Second)
}

func validateStreamDashboard(t *testing.T, workingDir string, awsRegion string) {
	snapshotPath := filepath.Join("snapshots", "stream-dashboard")
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	dashboardName := util.LoadOutputAttribute(t, terraformOptions, "dashboard", "dashboardName")
	dashboardBody := util.GetDashboardBody(t, awsRegion, dashboardName)
	// assert the dashboard body is a valid JSON
	var dashboard any
	err := json.Unmarshal([]byte(*dashboardBody), &dashboard)
	require.NoError(t, err)
	if os.Getenv("WRITE_SNAPSHOTS") == "true" {
		writeSnapshot(t, snapshotPath, dashboard, "DashBoardBody")
	}
}

func validateStreamResourcePoliy(t *testing.T, workingDir string, awsRegion string) {
	snapshotPath := filepath.Join("snapshots", "stream-resource-policy")
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	streamArn := util.LoadOutputAttribute(t, terraformOptions, "stream", "streamArn")
	policyString := util.GetStreamResourcePolicy(t, awsRegion, streamArn)
	// assert the policyDoc body is a valid JSON
	var policyDoc any
	err := json.Unmarshal([]byte(policyString), &policyDoc)
	require.NoError(t, err)
	if os.Getenv("WRITE_SNAPSHOTS") == "true" {
		writeSnapshot(t, snapshotPath, policyDoc, "StreamResourcePolicy")
	} else {
		actionsRe := "^kinesis:GetRecords$"
		principalRe := "^arn:aws:iam::\\d{12}:root$"
		integ.Assert(t, policyDoc, []integ.Assertion{
			{
				Path:           "Statement[].Action[]",
				ExpectedRegexp: &actionsRe,
			},
			{
				Path:           "Statement[].Principal.AWS",
				ExpectedRegexp: &principalRe,
			},
		})
	}
}

// run integration test
func runNotifyIntegrationTest(t *testing.T, testApp, awsRegion string, envVars map[string]string, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
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
