package test

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	autoscalingtypes "github.com/aws/aws-sdk-go-v2/service/applicationautoscaling/types"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/go-synth/executors"

	"github.com/gruntwork-io/terratest/modules/aws"
	loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

var (
	terratestLogger = loggers.Default
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

// Test the table.alarm-metrics integration
func TestTableAlarmMetrics(t *testing.T) {
	runStorageIntegrationTest(t, "table.alarm-metrics", "us-east-1", validateTableAlarmMetrics)
}

// Validate table.alarm-metrics integration test
func validateTableAlarmMetrics(t *testing.T, tfWorkingDir string, awsRegion string) {
	// terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	// TODO: Implement validation logic for table.alarm-metrics
}

// Test the table.autoscaling integration
func TestAutoScalingTable(t *testing.T) {
	runStorageIntegrationTestWithLoadTest(t, "table.autoscaling", "us-east-1", validateTableAutoScaling, validateTableAutoScalingLoadTest)
}

// Validate table.autoscaling integration test
func validateTableAutoScaling(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	tableName := outputs["TableName"].(string)
	_ = outputs["TableArn"].(string) // TableArn available if needed

	// 1. Resource Provisioning Validation
	// Verify table exists and is ACTIVE using terratest's existing function
	table := aws.GetDynamoDBTable(t, awsRegion, tableName)
	assert.Equal(t, "ACTIVE", string(table.TableStatus))

	// Validate table schema: partition key = "hashKey" (STRING), no sort key
	require.Len(t, table.KeySchema, 1, "Table should have exactly one key (partition key only)")
	assert.Equal(t, "hashKey", *table.KeySchema[0].AttributeName)
	assert.Equal(t, types.KeyTypeHash, table.KeySchema[0].KeyType)

	require.Len(t, table.AttributeDefinitions, 1, "Table should have exactly one attribute definition")
	assert.Equal(t, "hashKey", *table.AttributeDefinitions[0].AttributeName)
	assert.Equal(t, types.ScalarAttributeTypeS, table.AttributeDefinitions[0].AttributeType)

	// 2. Autoscaling Configuration Validation
	resourceId := fmt.Sprintf("table/%s", tableName)

	// Get scalable targets for DynamoDB read capacity
	readTarget := getTableReadCapacityTarget(t, awsRegion, resourceId)
	assert.Equal(t, int32(1), *readTarget.MinCapacity, "Min capacity should be 1")
	assert.Equal(t, int32(10), *readTarget.MaxCapacity, "Max capacity should be 10")

	// Get scaling policies and validate target-tracking policy
	targetTrackingPolicy := util.GetTableTrackingPolicy(t, awsRegion, resourceId)
	require.NotNil(t, targetTrackingPolicy.TargetTrackingScalingPolicyConfiguration, "Target tracking configuration should exist")
	assert.Equal(t, float64(30.0), *targetTrackingPolicy.TargetTrackingScalingPolicyConfiguration.TargetValue, "Target utilization should be 30%")

	// 3. Scheduled Actions Validation
	// Verify we have the expected scheduled actions
	actionsByName := getTableScheduledActionsByName(t, awsRegion, resourceId)

	// Validate "ScaleUpInTheMorning" action
	morningAction, exists := actionsByName["ScaleUpInTheMorning"]
	require.True(t, exists, "ScaleUpInTheMorning scheduled action should exist")
	assert.Equal(t, "cron(0 8 * * ? *)", *morningAction.Schedule, "Morning action should have correct cron schedule")
	require.NotNil(t, morningAction.ScalableTargetAction, "Morning action should have scalable target action")
	assert.Equal(t, int32(5), *morningAction.ScalableTargetAction.MinCapacity, "Morning action should set min capacity to 5")

	// Validate "ScaleDownAtNight" action
	nightAction, exists := actionsByName["ScaleDownAtNight"]
	require.True(t, exists, "ScaleDownAtNight scheduled action should exist")
	assert.Equal(t, "cron(0 20 * * ? *)", *nightAction.Schedule, "Night action should have correct cron schedule")
	require.NotNil(t, nightAction.ScalableTargetAction, "Night action should have scalable target action")
	assert.Equal(t, int32(3), *nightAction.ScalableTargetAction.MaxCapacity, "Night action should set max capacity to 3")
}

// Test the table.global integration
func TestTableGlobal(t *testing.T) {
	runStorageIntegrationTest(t, "table.global", "us-east-1", validateTableGlobal)
}

// Validate table.global integration test
func validateTableGlobal(t *testing.T, tfWorkingDir string, awsRegion string) {
	// terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	// TODO: Implement validation logic for table.alarm-metrics
}

func TestTableKinesisStream(t *testing.T) {
	runStorageIntegrationTest(t, "table.kinesis-stream", "us-east-1", validateTableKinesisStream)
}

// Validate table.alarm-metrics integration test
func validateTableKinesisStream(t *testing.T, tfWorkingDir string, awsRegion string) {
	// terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	// TODO: Implement validation logic for table.alarm-metrics
}

func TestTableMixedKey(t *testing.T) {
	runStorageIntegrationTest(t, "table.mixed-key", "us-east-1", validateTableMixedKey)
}

// Validate table.alarm-metrics integration test
func validateTableMixedKey(t *testing.T, tfWorkingDir string, awsRegion string) {
	// terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	// TODO: Implement validation logic for table.alarm-metrics
}

func TestTablePolicy(t *testing.T) {
	runStorageIntegrationTest(t, "table.policy", "us-east-1", validateTablePolicy)
}

// Validate table.alarm-metrics integration test
func validateTablePolicy(t *testing.T, tfWorkingDir string, awsRegion string) {
	// terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	// TODO: Implement validation logic for table.alarm-metrics
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
			// TODO: Scaling Policy Target race condition on resource Id (despite `resource_id = "table/${aws_dynamodb_table.Table_CD117FA1.name}" containing resource reference)
			".*No scalable target registered for service namespace: dynamodb.*": "Failed due to eventual consistency between AutoScaling and DynamoDb services.",
		})
	})
	test_structure.RunTestStage(t, "validate", func() {
		validate(t, tfWorkingDir, awsRegion)
	})
}

// run integration test with load testing
func runStorageIntegrationTestWithLoadTest(
	t *testing.T,
	testApp, awsRegion string,
	validate func(t *testing.T, tfWorkingDir string, awsRegion string),
	loadTest func(t *testing.T, tfWorkingDir string, awsRegion string),
) {
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
			// TODO: Scaling Policy Target race condition on resource Id (despite `resource_id = "table/${aws_dynamodb_table.Table_CD117FA1.name}" containing resource reference)
			".*No scalable target registered for service namespace: dynamodb.*": "Failed due to eventual consistency between AutoScaling and DynamoDb services.",
		})
	})
	test_structure.RunTestStage(t, "validate", func() {
		validate(t, tfWorkingDir, awsRegion)
	})
	test_structure.RunTestStage(t, "load_test", func() {
		loadTest(t, tfWorkingDir, awsRegion)
	})
}

// Utlity Functions //

// getTableScheduledActionsByName retrieves the scheduled actions for a DynamoDB table and returns them as a map by action name
func getTableScheduledActionsByName(t *testing.T, awsRegion string, resourceId string) map[string]autoscalingtypes.ScheduledAction {
	scheduledActions := util.GetScheduledActionsByResourceId(t, awsRegion, "dynamodb", resourceId)

	require.Len(t, scheduledActions, 2, "Should have exactly 2 scheduled actions")

	actionsByName := make(map[string]autoscalingtypes.ScheduledAction)
	for _, action := range scheduledActions {
		actionsByName[*action.ScheduledActionName] = action
	}
	return actionsByName
}

// getTableReadCapacityTarget gets the read capacity target for a DynamoDB table or fails the test if not found
func getTableReadCapacityTarget(t *testing.T, awsRegion string, resourceId string) *autoscalingtypes.ScalableTarget {
	targets := util.GetScalableTargetsByResourceId(t, awsRegion, "dynamodb", resourceId)

	var readTarget *autoscalingtypes.ScalableTarget
	for _, target := range targets {
		if target.ScalableDimension == autoscalingtypes.ScalableDimensionDynamoDBTableReadCapacityUnits {
			readTarget = &target
			break
		}
	}
	require.NotNil(t, readTarget, "Read capacity scalable target should exist")
	return readTarget
}

// validateTableAutoScalingLoadTest performs load testing validation for DynamoDB autoscaling
// Note: Only tests scale-up behavior due to AWS DynamoDB autoscaling cooldown periods (15-20 minutes for scale-down)
func validateTableAutoScalingLoadTest(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	tableName := outputs["TableName"].(string)
	resourceId := fmt.Sprintf("table/%s", tableName)

	// 1. Record initial capacity
	initialCapacity := getCurrentReadCapacity(t, awsRegion, resourceId)
	terratestLogger.Logf(t, "Initial read capacity: %d RCU", initialCapacity)
	assert.Equal(t, int32(5), initialCapacity, "Initial capacity should be 5 RCU")

	// 2. Start load simulation
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	terratestLogger.Logf(t, "Starting load simulation targeting 30+ percent utilization...")
	go simulateReadLoad(ctx, t, awsRegion, tableName)

	// Give load simulation time to ramp up and CloudWatch metrics to register
	terratestLogger.Logf(t, "Allowing 30 seconds for load to ramp up...")
	time.Sleep(30 * time.Second)

	// 3. Wait for scale-up
	terratestLogger.Logf(t, "Waiting for capacity to scale up...")
	scaledUpCapacity := waitForCapacityChange(t, awsRegion, resourceId, initialCapacity, "up", 5*time.Minute)
	assert.Greater(t, scaledUpCapacity, initialCapacity, "Capacity should scale up under load")
	terratestLogger.Logf(t, "Capacity scaled up from %d to %d RCU", initialCapacity, scaledUpCapacity)

	// 4. Stop load simulation (scale-down testing skipped due to 15-20 minute cooldown periods)
	cancel() // Stop load simulation
	terratestLogger.Logf(t, "Load simulation completed. Scale-up validation successful!")
	terratestLogger.Logf(t, "Note: Scale-down testing skipped due to AWS DynamoDB autoscaling cooldown periods (15-20 minutes)")
}

// simulateReadLoad creates concurrent load on the DynamoDB table with exponential backoff
func simulateReadLoad(ctx context.Context, t *testing.T, region, tableName string) {
	client := aws.NewDynamoDBClient(t, region)

	// Target: ~15 RCU/second to exceed 30% threshold while allowing for backoff
	var wg sync.WaitGroup
	numWorkers := 10

	terratestLogger.Logf(t, "Starting %d worker goroutines for load simulation with exponential backoff", numWorkers)

	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			requestCount := 0
			successCount := 0
			backoffDelay := 200 * time.Millisecond // Base interval
			maxBackoff := 5 * time.Second          // Maximum backoff
			minBackoff := 100 * time.Millisecond   // Minimum backoff for errors

			for {
				select {
				case <-ctx.Done():
					terratestLogger.Logf(t, "Worker %d completed %d requests (%d successful)", workerID, requestCount, successCount)
					return
				default:
					requestCount++

					// Perform GetItem with random key
					key := fmt.Sprintf("loadtest-%d-%d", workerID, time.Now().UnixNano())
					_, err := client.GetItem(ctx, &dynamodb.GetItemInput{
						TableName: awssdk.String(tableName),
						Key: map[string]types.AttributeValue{
							"hashKey": &types.AttributeValueMemberS{Value: key},
						},
						ConsistentRead: awssdk.Bool(true), // Use consistent reads for more predictable RCU consumption
					})

					if err != nil && ctx.Err() == nil {
						// Classify error type for appropriate handling
						errorMsg := err.Error()
						isThrottling := strings.Contains(errorMsg, "ProvisionedThroughputExceededException")
						isRetryQuotaExceeded := strings.Contains(errorMsg, "retry quota exceeded")

						if isThrottling {
							// Exponential backoff for throttling errors
							backoffDelay = time.Duration(float64(backoffDelay) * 1.5)
							if backoffDelay > maxBackoff {
								backoffDelay = maxBackoff
							}
							// Add jitter to prevent thundering herd
							jitter := time.Duration(rand.Intn(int(backoffDelay.Milliseconds()/4))) * time.Millisecond
							totalDelay := backoffDelay + jitter

							if requestCount <= 3 { // Only log first few throttling errors per worker
								terratestLogger.Logf(t, "Worker %d throttled, backing off for %v (request %d)", workerID, totalDelay, requestCount)
							}
							time.Sleep(totalDelay)
						} else if isRetryQuotaExceeded {
							// Longer backoff for retry quota exceeded
							quotaBackoff := 2*time.Second + time.Duration(rand.Intn(3000))*time.Millisecond
							if requestCount <= 2 { // Only log first couple quota errors per worker
								terratestLogger.Logf(t, "Worker %d retry quota exceeded, backing off for %v", workerID, quotaBackoff)
							}
							time.Sleep(quotaBackoff)
						} else {
							// Other errors - shorter backoff
							if requestCount <= 3 {
								terratestLogger.Logf(t, "Worker %d error: %v", workerID, err)
							}
							time.Sleep(minBackoff)
						}
					} else {
						// Success - reset backoff and increment success counter
						successCount++
						backoffDelay = 200 * time.Millisecond // Reset to base interval

						// Normal interval between successful requests
						// 10 workers * 200ms = ~50 requests/second total when not throttled
						// Each GetItem consumes ~1 RCU, targeting ~200% utilization to exceed 30% threshold
						time.Sleep(backoffDelay)
					}
				}
			}
		}(i)
	}

	wg.Wait()
}

// getCurrentReadCapacity gets the current read capacity for a DynamoDB table
func getCurrentReadCapacity(t *testing.T, region, resourceId string) int32 {
	// Extract table name from resourceId (format: "table/tableName")
	tableName := resourceId[6:] // Remove "table/" prefix

	// Get actual current capacity from DynamoDB
	dynamoClient := aws.NewDynamoDBClient(t, region)
	result, err := dynamoClient.DescribeTable(context.Background(), &dynamodb.DescribeTableInput{
		TableName: awssdk.String(tableName),
	})
	require.NoError(t, err, "Failed to describe DynamoDB table")

	return int32(*result.Table.ProvisionedThroughput.ReadCapacityUnits)
}

// waitForCapacityChange waits for the DynamoDB table capacity to change
func waitForCapacityChange(t *testing.T, region, resourceId string, baselineCapacity int32, direction string, timeout time.Duration) int32 {
	description := fmt.Sprintf("Waiting for capacity to scale %s from %d", direction, baselineCapacity)

	maxRetries := int(timeout.Seconds() / 20) // Poll every 20 seconds
	if maxRetries < 1 {
		maxRetries = 1
	}

	var finalCapacity int32
	pollCount := 0

	terratestLogger.Logf(t, "Starting capacity monitoring: baseline=%d, direction=%s, timeout=%v", baselineCapacity, direction, timeout)

	_, err := retry.DoWithRetryE(t, description, maxRetries, 20*time.Second, func() (string, error) {
		pollCount++
		currentCapacity := getCurrentReadCapacity(t, region, resourceId)
		finalCapacity = currentCapacity

		terratestLogger.Logf(t, "Poll %d: Current capacity = %d RCU (baseline = %d)", pollCount, currentCapacity, baselineCapacity)

		switch direction {
		case "up":
			if currentCapacity > baselineCapacity {
				terratestLogger.Logf(t, "SUCCESS: Capacity scaled up from %d to %d RCU", baselineCapacity, currentCapacity)
				return fmt.Sprintf("Scaled up to %d", currentCapacity), nil
			}
		case "down":
			if currentCapacity < baselineCapacity {
				terratestLogger.Logf(t, "SUCCESS: Capacity scaled down from %d to %d RCU", baselineCapacity, currentCapacity)
				return fmt.Sprintf("Scaled down to %d", currentCapacity), nil
			}
		}

		return "", fmt.Errorf("capacity still at %d, waiting for %s scaling", currentCapacity, direction)
	})

	if err != nil {
		terratestLogger.Logf(t, "TIMEOUT: Capacity did not scale %s within %v (final capacity: %d)", direction, timeout, finalCapacity)
	}

	require.NoError(t, err, "Failed to detect capacity scaling within timeout")
	return finalCapacity
}
