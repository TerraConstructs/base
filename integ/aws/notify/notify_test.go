package test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	eventbridgetypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
	"github.com/aws/aws-sdk-go-v2/service/sns/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/base/integ"
	util "github.com/terraconstructs/base/integ/aws"
	"github.com/terraconstructs/go-synth/executors"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
)

var terratestLogger = loggers.Default

// Test the sqs app
func TestQueue(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	// Confirm the queue is working as expected
	runNotifyIntegrationTest(t, "sqs", "us-east-1", envVars, validateQueue)
}

// Test the sqs-source-queue-permission app
func TestSourceQueuePermission(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	// Confirm the Source Queue Permissions are working as expected
	runNotifyIntegrationTest(t, "sqs-source-queue-permission", "us-east-1", envVars, validateSourceQueuePermission)
}

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

// Test the eventbridge-rule-lambda app
// Regression test for: https://github.com/TerraConstructs/base/pull/89
// Bug: EventBridge Rule with custom event bus was not setting event_bus_name on targets
func TestEventBridgeRuleLambda(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	// Confirm the EventBridge Rule with custom event bus works as expected
	runNotifyIntegrationTest(t, "eventbridge-rule-lambda", "us-east-1", envVars, validateEventBridgeRuleLambda)
}

func validateQueue(t *testing.T, workingDir string, awsRegion string) {
	snapshotPath := filepath.Join("snapshots", "sqs")

	// Load the Terraform Options and outputs
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	// Extract all queue URLs and role ARN from outputs
	dlqUrl := outputs["DlqUrl"].(string)
	queueUrl := outputs["QueueUrl"].(string)
	fifoUrl := outputs["FifoUrl"].(string)
	highThroughputFifoUrl := outputs["HighThroughputFifoUrl"].(string)
	sqsManagedUrl := outputs["SqsManagedUrl"].(string)
	unencryptedUrl := outputs["UnencryptedUrl"].(string)
	sslUrl := outputs["SslUrl"].(string)
	roleArn := outputs["RoleArn"].(string)

	// ===== 1. Validate DLQ (Dead Letter Queue) - basic standard queue =====
	terratestLogger.Logf(t, "Validating DeadLetterQueue...")
	dlqAttrs := util.GetQueueAttributes(t, awsRegion, dlqUrl)

	// Verify it's not a FIFO queue
	assert.NotEqual(t, "true", dlqAttrs["FifoQueue"], "DLQ should not be FIFO")

	// Verify no custom KMS encryption (DLQ has no encryption configured, may use AWS default SSE)
	assert.Empty(t, dlqAttrs["KmsMasterKeyId"], "DLQ should not have KMS encryption")

	// Verify standard attributes exist
	assert.NotEmpty(t, dlqAttrs["QueueArn"], "DLQ should have ARN")
	assert.NotEmpty(t, dlqAttrs["MessageRetentionPeriod"], "DLQ should have message retention period")
	assert.NotEmpty(t, dlqAttrs["VisibilityTimeout"], "DLQ should have visibility timeout")

	// ===== 2. Validate Queue - with DLQ config and KMS_MANAGED encryption =====
	terratestLogger.Logf(t, "Validating Queue with DLQ and KMS_MANAGED encryption...")
	queueAttrs := util.GetQueueAttributes(t, awsRegion, queueUrl)

	// Verify KMS_MANAGED encryption (uses AWS managed key)
	assert.Equal(t, "alias/aws/sqs", queueAttrs["KmsMasterKeyId"], "Queue should use KMS_MANAGED encryption")

	// Verify DLQ configuration
	require.NotEmpty(t, queueAttrs["RedrivePolicy"], "Queue should have redrive policy")

	var redrivePolicy map[string]interface{}
	err := json.Unmarshal([]byte(queueAttrs["RedrivePolicy"]), &redrivePolicy)
	require.NoError(t, err, "Should be able to parse redrive policy JSON")

	// Verify maxReceiveCount
	maxReceiveCount := int(redrivePolicy["maxReceiveCount"].(float64))
	assert.Equal(t, 5, maxReceiveCount, "Queue should have maxReceiveCount of 5")

	// Verify deadLetterTargetArn points to DLQ
	assert.Equal(t, dlqAttrs["QueueArn"], redrivePolicy["deadLetterTargetArn"], "DLQ ARN should match")

	// ===== 3. Validate FIFO Queue - with custom KMS key =====
	terratestLogger.Logf(t, "Validating FIFO Queue with custom KMS key...")
	fifoAttrs := util.GetQueueAttributes(t, awsRegion, fifoUrl)

	// Verify FIFO
	assert.Equal(t, "true", fifoAttrs["FifoQueue"], "Should be a FIFO queue")

	// Verify queue URL contains .fifo
	assert.Contains(t, fifoUrl, ".fifo", "FIFO queue URL should contain .fifo")

	// Verify custom KMS key (should be a full ARN, not alias/aws/sqs)
	assert.NotEmpty(t, fifoAttrs["KmsMasterKeyId"], "FIFO queue should have KMS key")
	assert.Contains(t, fifoAttrs["KmsMasterKeyId"], "arn:aws:kms:", "Should have custom KMS key ARN")

	// ===== 4. Validate High Throughput FIFO =====
	terratestLogger.Logf(t, "Validating High Throughput FIFO Queue...")
	htFifoAttrs := util.GetQueueAttributes(t, awsRegion, highThroughputFifoUrl)

	// Verify FIFO
	assert.Equal(t, "true", htFifoAttrs["FifoQueue"], "Should be a FIFO queue")

	// Verify deduplication scope
	assert.Equal(t, "messageGroup", htFifoAttrs["DeduplicationScope"], "Should have messageGroup deduplication scope")

	// Verify throughput limit
	assert.Equal(t, "perMessageGroupId", htFifoAttrs["FifoThroughputLimit"], "Should have perMessageGroupId throughput limit")

	// ===== 5. Validate SQS-Managed Encrypted Queue =====
	terratestLogger.Logf(t, "Validating SQS-Managed Encrypted Queue...")
	sqsManagedAttrs := util.GetQueueAttributes(t, awsRegion, sqsManagedUrl)

	// Verify SQS-managed SSE is enabled
	assert.Equal(t, "true", sqsManagedAttrs["SqsManagedSseEnabled"], "Should have SQS-managed SSE enabled")

	// Verify no KMS key (mutually exclusive with SQS-managed SSE)
	assert.Empty(t, sqsManagedAttrs["KmsMasterKeyId"], "Should not have KMS key with SQS-managed SSE")

	// ===== 6. Validate Unencrypted Queue =====
	terratestLogger.Logf(t, "Validating Unencrypted Queue...")
	unencryptedAttrs := util.GetQueueAttributes(t, awsRegion, unencryptedUrl)

	// Verify no encryption (explicitly set to UNENCRYPTED in sqs.ts)
	assert.Empty(t, unencryptedAttrs["KmsMasterKeyId"], "Should not have KMS encryption")
	// SqsManagedSseEnabled should be explicitly false for UNENCRYPTED queues
	sqsManagedSse, exists := unencryptedAttrs["SqsManagedSseEnabled"]
	if exists {
		assert.Equal(t, "false", sqsManagedSse, "Should have SQS-managed SSE explicitly disabled")
	}
	// Also check that it's not just missing the key but actually set to false
	assert.NotEqual(t, "true", unencryptedAttrs["SqsManagedSseEnabled"], "Should not have SQS-managed SSE enabled")

	// ===== 7. Validate SSL Queue - with enforceSSL policy =====
	terratestLogger.Logf(t, "Validating SSL Queue policy...")
	sslPolicyDoc := util.GetQueuePolicy(t, awsRegion, sslUrl)

	if os.Getenv("WRITE_SNAPSHOTS") == "true" {
		writeSnapshot(t, snapshotPath, sslPolicyDoc, "SSLQueuePolicy")
	} else {
		// Validate policy has Deny statement with aws:SecureTransport condition
		actionRe := "^sqs:\\*$"
		effectRe := "^Deny$"

		integ.Assert(t, sslPolicyDoc, []integ.Assertion{
			{
				Path:           "Statement[?Effect=='Deny'].Action[]",
				ExpectedRegexp: &actionRe,
			},
			{
				Path:           "Statement[?Effect=='Deny'].Effect",
				ExpectedRegexp: &effectRe,
			},
		})
	}

	// ===== 8. Validate IAM Role Permissions =====
	terratestLogger.Logf(t, "Validating IAM Role permissions...")
	// Extract role name from ARN (format: arn:aws:iam::ACCOUNT:role/ROLE_NAME)
	roleName := roleArn[strings.LastIndex(roleArn, "/")+1:]
	role := util.GetIamRole(t, awsRegion, roleName)

	// Verify inline policies exist
	require.Greater(t, len(role.InlinePolicies), 0, "Role should have inline policies")

	// Parse first policy document
	var rolePolicyDoc map[string]interface{}
	err = json.Unmarshal([]byte(role.InlinePolicies[0].PolicyDocument), &rolePolicyDoc)
	require.NoError(t, err, "Should be able to parse policy document JSON")

	if os.Getenv("WRITE_SNAPSHOTS") == "true" {
		writeSnapshot(t, snapshotPath, role, "RoleWithQueuePermissions")
		writeSnapshot(t, snapshotPath, rolePolicyDoc, "QueueConsumePolicyDocument")
	} else {
		// Validate consume actions are present
		actionsRe := "^sqs:(ChangeMessageVisibility|DeleteMessage|ReceiveMessage|GetQueueAttributes|GetQueueUrl)$"
		integ.Assert(t, rolePolicyDoc, []integ.Assertion{
			{
				Path:           "Statement[].Action[]",
				ExpectedRegexp: &actionsRe,
			},
		})

		// Validate resources point to queues (should be queue ARNs)
		resourceRe := "^arn:aws:sqs:"
		integ.Assert(t, rolePolicyDoc, []integ.Assertion{
			{
				Path:           "Statement[].Resource[]",
				ExpectedRegexp: &resourceRe,
			},
		})
	}

	terratestLogger.Logf(t, "All queue validations passed!")
}

func validateSourceQueuePermission(t *testing.T, workingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	// Extract queue URLs and ARNs
	sourceQueue1Url := outputs["SourceQueue1Url"].(string)
	sourceQueue1Arn := outputs["SourceQueue1Arn"].(string)
	sourceQueue2Url := outputs["SourceQueue2Url"].(string)
	sourceQueue2Arn := outputs["SourceQueue2Arn"].(string)
	dlqUrl := outputs["DeadLetterQueueUrl"].(string)
	dlqArn := outputs["DeadLetterQueueArn"].(string)

	terratestLogger.Logf(t, "Retrieved queue URLs and ARNs from outputs")

	// Validate SourceQueue1 (ALLOW_ALL)
	terratestLogger.Logf(t, "Validating SourceQueue1 with ALLOW_ALL...")
	sq1Attrs := util.GetQueueAttributes(t, awsRegion, sourceQueue1Url)

	// Parse RedriveAllowPolicy
	require.NotEmpty(t, sq1Attrs["RedriveAllowPolicy"], "SourceQueue1 should have redrive allow policy")
	var sq1RedriveAllowPolicy map[string]any
	err := json.Unmarshal([]byte(sq1Attrs["RedriveAllowPolicy"]), &sq1RedriveAllowPolicy)
	require.NoError(t, err, "Should be able to parse SourceQueue1 RedriveAllowPolicy JSON")

	// Validate redrivePermission is ALLOW_ALL
	assert.Equal(t, "allowAll", sq1RedriveAllowPolicy["redrivePermission"],
		"SourceQueue1 should have ALLOW_ALL redrive permission")

	// Validate SourceQueue2 (DENY_ALL)
	terratestLogger.Logf(t, "Validating SourceQueue2 with DENY_ALL...")
	sq2Attrs := util.GetQueueAttributes(t, awsRegion, sourceQueue2Url)

	// Parse RedriveAllowPolicy
	require.NotEmpty(t, sq2Attrs["RedriveAllowPolicy"], "SourceQueue2 should have redrive allow policy")
	var sq2RedriveAllowPolicy map[string]any
	err = json.Unmarshal([]byte(sq2Attrs["RedriveAllowPolicy"]), &sq2RedriveAllowPolicy)
	require.NoError(t, err, "Should be able to parse SourceQueue2 RedriveAllowPolicy JSON")

	// Validate redrivePermission is DENY_ALL
	assert.Equal(t, "denyAll", sq2RedriveAllowPolicy["redrivePermission"],
		"SourceQueue2 should have DENY_ALL redrive permission")

	// Validate DeadLetterQueue (BY_QUEUE)
	terratestLogger.Logf(t, "Validating DeadLetterQueue with BY_QUEUE...")
	dlqAttrs := util.GetQueueAttributes(t, awsRegion, dlqUrl)

	// Parse RedriveAllowPolicy
	require.NotEmpty(t, dlqAttrs["RedriveAllowPolicy"], "DLQ should have redrive allow policy")
	var dlqRedriveAllowPolicy map[string]any
	err = json.Unmarshal([]byte(dlqAttrs["RedriveAllowPolicy"]), &dlqRedriveAllowPolicy)
	require.NoError(t, err, "Should be able to parse DLQ RedriveAllowPolicy JSON")

	// Validate redrivePermission is BY_QUEUE
	assert.Equal(t, "byQueue", dlqRedriveAllowPolicy["redrivePermission"],
		"DLQ should have BY_QUEUE redrive permission")

	// Validate sourceQueueArns contains both source queues
	sourceQueueArns, ok := dlqRedriveAllowPolicy["sourceQueueArns"].([]any)
	require.True(t, ok, "Should have sourceQueueArns array")
	require.Len(t, sourceQueueArns, 2, "Should have exactly 2 source queue ARNs")

	// Convert to string slice for easier comparison
	arnsSlice := make([]string, len(sourceQueueArns))
	for i, arn := range sourceQueueArns {
		arnsSlice[i] = arn.(string)
	}

	// Verify both source queue ARNs are present (order may vary)
	assert.Contains(t, arnsSlice, sourceQueue1Arn, "Should contain SourceQueue1 ARN")
	assert.Contains(t, arnsSlice, sourceQueue2Arn, "Should contain SourceQueue2 ARN")

	// Suppress unused variable warnings
	_ = dlqArn

	terratestLogger.Logf(t, "All source queue permission validations passed!")
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

func validateEventBridgeRuleLambda(t *testing.T, tfDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfDir)

	// Get outputs
	eventBusName := util.LoadOutputAttribute(t, opts, "event_bus", "name")
	ruleName := util.LoadOutputAttribute(t, opts, "rule", "name")
	targetFunctionName := util.LoadOutputAttribute(t, opts, "target_function", "name")
	importedBusRuleName := util.LoadOutputAttribute(t, opts, "imported_bus_rule", "name")
	importedBusFunctionName := util.LoadOutputAttribute(t, opts, "imported_bus_function", "name")

	// ===== 1. Validate Rule is on the correct event bus =====
	terratestLogger.Logf(t, "Validating rule %s is on event bus %s...", ruleName, eventBusName)
	rule := util.DescribeEventBridgeRule(t, awsRegion, ruleName, eventBusName)

	// Verify rule is on the custom event bus
	assert.Equal(t, eventBusName, *rule.EventBusName, "Rule should be on the custom event bus")
	assert.Equal(t, ruleName, *rule.Name, "Rule name should match")

	// ===== 2. Validate Targets have correct event bus name =====
	terratestLogger.Logf(t, "Validating targets for rule %s have correct event bus name...", ruleName)
	targets := util.ListEventBridgeTargets(t, awsRegion, ruleName, eventBusName)

	// Verify we have at least one target
	require.Greater(t, len(targets), 0, "Rule should have at least one target")

	// Note: The EventBridge API doesn't expose the event_bus_name on the target itself
	// But the fact that ListTargetsByRule succeeds with the custom event bus name
	// proves that the target was created with the correct event bus name
	// (otherwise the API would fail to find the target)
	terratestLogger.Logf(t, "Found %d target(s) for rule %s on event bus %s", len(targets), ruleName, eventBusName)

	// ===== 3. Validate imported event bus rule and targets =====
	terratestLogger.Logf(t, "Validating imported event bus rule %s...", importedBusRuleName)
	importedRule := util.DescribeEventBridgeRule(t, awsRegion, importedBusRuleName, eventBusName)

	assert.Equal(t, eventBusName, *importedRule.EventBusName, "Imported rule should be on the custom event bus")
	assert.Equal(t, importedBusRuleName, *importedRule.Name, "Imported rule name should match")

	importedTargets := util.ListEventBridgeTargets(t, awsRegion, importedBusRuleName, eventBusName)
	require.Greater(t, len(importedTargets), 0, "Imported rule should have at least one target")

	// ===== 4. Test triggering the rule by sending an event =====
	terratestLogger.Logf(t, "Testing rule trigger by sending event to event bus %s...", eventBusName)

	targetFunctionLogGroup := fmt.Sprintf("/aws/lambda/%s", targetFunctionName)
	importedBusFunctionLogGroup := fmt.Sprintf("/aws/lambda/%s", importedBusFunctionName)

	// Send an event that matches the first rule's pattern
	util.PutEvents(t, awsRegion, []eventbridgetypes.PutEventsRequestEntry{
		{
			Source:       aws.String("custom.source"),
			DetailType:   aws.String("Custom Event"),
			Detail:       aws.String(`{"test": "data", "message": "Hello from custom event bus"}`),
			EventBusName: aws.String(eventBusName),
		},
	})

	// Wait for Lambda to be invoked and check logs
	messages := util.WaitForLogEvents(t, awsRegion, targetFunctionLogGroup, 12, 5*time.Second)
	require.Greater(t, len(messages), 0, "Expected Lambda function to be invoked and log messages")
	terratestLogger.Logf(t, "Successfully triggered rule %s, Lambda logged %d messages", ruleName, len(messages))

	// Send an event that matches the imported bus rule's pattern
	util.PutEvents(t, awsRegion, []eventbridgetypes.PutEventsRequestEntry{
		{
			Source:       aws.String("imported.source"),
			DetailType:   aws.String("Imported Event"),
			Detail:       aws.String(`{"test": "data", "message": "Hello from imported event bus"}`),
			EventBusName: aws.String(eventBusName),
		},
	})

	// Wait for the imported bus Lambda to be invoked
	importedMessages := util.WaitForLogEvents(t, awsRegion, importedBusFunctionLogGroup, 12, 5*time.Second)
	require.Greater(t, len(importedMessages), 0, "Expected imported bus Lambda function to be invoked and log messages")
	terratestLogger.Logf(t, "Successfully triggered imported bus rule %s, Lambda logged %d messages", importedBusRuleName, len(importedMessages))

	terratestLogger.Logf(t, "All EventBridge rule validations passed!")
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
