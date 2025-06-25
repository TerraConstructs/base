package test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	autoscalingtypes "github.com/aws/aws-sdk-go-v2/service/applicationautoscaling/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/go-synth/executors"

	"github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/gruntwork-io/terratest/modules/terraform"
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
			// TODO: Fix Dependency tree to avoid this error :(
			".*The EventInvokeConfig for function .* could not be updated due to a concurrent update operation.*": "Failed due to concurrent update operation.",
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
			// TODO: Fix Dependency tree to avoid this error :(
			".*The EventInvokeConfig for function .* could not be updated due to a concurrent update operation.*": "Failed due to concurrent update operation.",
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
func validateTableAutoScalingLoadTest(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	tableName := outputs["TableName"].(string)
	resourceId := fmt.Sprintf("table/%s", tableName)

	// 1. Record initial capacity
	initialCapacity := getCurrentReadCapacity(t, awsRegion, resourceId)
	t.Logf("Initial read capacity: %d RCU", initialCapacity)
	assert.Equal(t, int32(5), initialCapacity, "Initial capacity should be 5 RCU")

	// 2. Start load simulation
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	t.Logf("Starting load simulation targeting 30+ percent utilization...")
	go simulateReadLoad(ctx, t, awsRegion, tableName)

	// Give load simulation time to ramp up and CloudWatch metrics to register
	t.Logf("Allowing 30 seconds for load to ramp up...")
	time.Sleep(30 * time.Second)

	// 3. Wait for scale-up
	t.Logf("Waiting for capacity to scale up...")
	scaledUpCapacity := waitForCapacityChange(t, awsRegion, resourceId, initialCapacity, "up", 5*time.Minute)
	assert.Greater(t, scaledUpCapacity, initialCapacity, "Capacity should scale up under load")
	t.Logf("Capacity scaled up from %d to %d RCU", initialCapacity, scaledUpCapacity)

	// 4. Stop load and wait for scale-down
	cancel() // Stop load simulation
	t.Logf("Load stopped, waiting for scale-down...")

	scaledDownCapacity := waitForCapacityChange(t, awsRegion, resourceId, scaledUpCapacity, "down", 6*time.Minute)
	assert.Less(t, scaledDownCapacity, scaledUpCapacity, "Capacity should scale down after load reduction")
	assert.GreaterOrEqual(t, scaledDownCapacity, int32(1), "Capacity should not go below minimum")
	t.Logf("Capacity scaled down from %d to %d RCU", scaledUpCapacity, scaledDownCapacity)
}

// simulateReadLoad creates concurrent load on the DynamoDB table
func simulateReadLoad(ctx context.Context, t *testing.T, region, tableName string) {
	client := aws.NewDynamoDBClient(t, region)

	// Launch multiple goroutines for concurrent load
	// Target: ~2.5 RCU/second (50% of 5 RCU) to exceed 30% threshold
	var wg sync.WaitGroup
	numWorkers := 20

	t.Logf("Starting %d worker goroutines for load simulation", numWorkers)

	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			requestCount := 0

			for {
				select {
				case <-ctx.Done():
					t.Logf("Worker %d completed %d requests", workerID, requestCount)
					return
				default:
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
						t.Logf("Worker %d GetItem error: %v", workerID, err)
					} else {
						requestCount++
					}

					// Control request rate - each worker does ~1 request every 800ms
					// 20 workers * 1.25 req/sec = ~25 req/sec total
					// Each GetItem consumes ~1 RCU, so ~25 RCU/sec total
					// This should be 25/5 = 500% utilization, well above 30% threshold
					time.Sleep(80 * time.Millisecond)
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

	t.Logf("Starting capacity monitoring: baseline=%d, direction=%s, timeout=%v", baselineCapacity, direction, timeout)

	_, err := retry.DoWithRetryE(t, description, maxRetries, 20*time.Second, func() (string, error) {
		pollCount++
		currentCapacity := getCurrentReadCapacity(t, region, resourceId)
		finalCapacity = currentCapacity

		t.Logf("Poll %d: Current capacity = %d RCU (baseline = %d)", pollCount, currentCapacity, baselineCapacity)

		switch direction {
		case "up":
			if currentCapacity > baselineCapacity {
				t.Logf("SUCCESS: Capacity scaled up from %d to %d RCU", baselineCapacity, currentCapacity)
				return fmt.Sprintf("Scaled up to %d", currentCapacity), nil
			}
		case "down":
			if currentCapacity < baselineCapacity {
				t.Logf("SUCCESS: Capacity scaled down from %d to %d RCU", baselineCapacity, currentCapacity)
				return fmt.Sprintf("Scaled down to %d", currentCapacity), nil
			}
		}

		return "", fmt.Errorf("capacity still at %d, waiting for %s scaling", currentCapacity, direction)
	})

	if err != nil {
		t.Logf("TIMEOUT: Capacity did not scale %s within %v (final capacity: %d)", direction, timeout, finalCapacity)
	}

	require.NoError(t, err, "Failed to detect capacity scaling within timeout")
	return finalCapacity
}

