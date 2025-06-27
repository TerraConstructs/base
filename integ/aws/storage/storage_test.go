package test

import (
	"context"
	"encoding/json"
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
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	// Get table names and ARNs from terraform outputs using LoadOutputAttribute
	tableName := util.LoadOutputAttribute(t, terraformOptions, "table", "tableName")
	terratestLogger.Logf(t, "Validating global table %s in region %s", tableName, awsRegion)

	// 1. Verify table exists and is ACTIVE
	table := aws.GetDynamoDBTable(t, awsRegion, tableName)
	assert.Equal(t, "ACTIVE", string(table.TableStatus), "Table %s should be ACTIVE", tableName)
	terratestLogger.Logf(t, "Table %s is ACTIVE in region %s", tableName, awsRegion)

	// 2. Verify global table replication (Global Tables V2)
	// For Global Tables V2, replica information is available in the main table description
	require.NotNil(t, table.Replicas, "Table %s should have replicas (Global Tables V2)", tableName)
	require.Len(t, table.Replicas, 2, "Table %s should have exactly 2 replicas", tableName)

	// Check replication regions
	expectedRegions := []string{"eu-west-2", "eu-central-1"}
	actualRegions := []string{}
	for _, replica := range table.Replicas {
		actualRegions = append(actualRegions, *replica.RegionName)
		assert.Equal(t, types.ReplicaStatusActive, replica.ReplicaStatus, "Replica in region %s should be ACTIVE", *replica.RegionName)
		terratestLogger.Logf(t, "Replica in region %s is ACTIVE", *replica.RegionName)
	}
	assert.ElementsMatch(t, expectedRegions, actualRegions, "Global table %s should have replicas in expected regions", tableName)

	// Verify Global Tables version
	require.NotNil(t, table.GlobalTableVersion, "Table %s should have GlobalTableVersion", tableName)
	assert.Equal(t, "2019.11.21", *table.GlobalTableVersion, "Table %s should use Global Tables V2", tableName)

	// 3. Verify global secondary index
	require.NotNil(t, table.GlobalSecondaryIndexes, "Table %s should have global secondary indexes", tableName)
	assert.Len(t, table.GlobalSecondaryIndexes, 1, "Table %s should have exactly one global secondary index", tableName)
	assert.Equal(t, "my-index", *table.GlobalSecondaryIndexes[0].IndexName, "Global secondary index name should be 'my-index'")
	assert.Equal(t, types.IndexStatusActive, table.GlobalSecondaryIndexes[0].IndexStatus, "Global secondary index 'my-index' should be ACTIVE")

	terratestLogger.Logf(t, "Global table %s validation completed successfully!", tableName)
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

// Validate table.policy integration test
func validateTablePolicy(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	// Get table names and ARNs from terraform outputs using LoadOutputAttribute
	tableTest1Name := util.LoadOutputAttribute(t, terraformOptions, "table", "tableName")
	tableTest2Name := util.LoadOutputAttribute(t, terraformOptions, "table_two", "tableName")
	tableTest1Arn := util.LoadOutputAttribute(t, terraformOptions, "table", "tableArn")
	tableTest2Arn := util.LoadOutputAttribute(t, terraformOptions, "table_two", "tableArn")

	// 1. Table Creation and Schema Validation
	terratestLogger.Logf(t, "Validating table schemas...")

	// Validate TableTest1 schema: partition key = "id" (STRING), no sort key
	validateTableSchema(t, awsRegion, tableTest1Name, "id", "", "TableTest1")

	// Validate TableTest2 schema: partition key = "PK" (STRING), no sort key
	validateTableSchema(t, awsRegion, tableTest2Name, "PK", "", "TableTest2")

	// 2. Resource Policy Validation for TableTest1
	terratestLogger.Logf(t, "Validating TableTest1 resource policy...")
	policy := getDynamoDBTableResourcePolicy(t, awsRegion, tableTest1Arn)
	require.NotNil(t, policy, "TableTest1 should have a resource policy")

	// Parse policy document
	var policyDoc map[string]interface{}
	err := json.Unmarshal([]byte(*policy), &policyDoc)
	require.NoError(t, err, "Policy document should be valid JSON")

	// Validate policy structure and content
	validateResourcePolicyContent(t, policyDoc, "TableTest1")

	// 3. grantReadData Policy Validation for TableTest2
	terratestLogger.Logf(t, "Validating TableTest2 grantReadData policy...")
	// Note: grantReadData creates resource policies when it can't add to principal IAM policies
	// For TableTest2, we verify that a resource policy exists (created by grantReadData)
	policy2 := getDynamoDBTableResourcePolicy(t, awsRegion, tableTest2Arn)
	require.NotNil(t, policy2, "TableTest2 should have a resource policy created by grantReadData")

	// Parse policy document for TableTest2
	var policyDoc2 map[string]interface{}
	err2 := json.Unmarshal([]byte(*policy2), &policyDoc2)
	require.NoError(t, err2, "TableTest2 policy document should be valid JSON")

	// Validate TableTest2 policy content (should have more specific read-only actions)
	validateGrantReadDataPolicyContent(t, policyDoc2, "TableTest2")

	terratestLogger.Logf(t, "Table policy validation completed successfully!")
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

// validateTableSchema validates the schema of a DynamoDB table
func validateTableSchema(t *testing.T, awsRegion string, tableName string, expectedPartitionKey string, expectedSortKey string, tableIdentifier string) {
	table := aws.GetDynamoDBTable(t, awsRegion, tableName)
	assert.Equal(t, "ACTIVE", string(table.TableStatus), "%s should be ACTIVE", tableIdentifier)

	// Validate partition key
	require.Len(t, table.KeySchema, getExpectedKeyCount(expectedSortKey), "%s should have correct number of keys", tableIdentifier)

	// Find partition key
	var partitionKey *types.KeySchemaElement
	for _, key := range table.KeySchema {
		if key.KeyType == types.KeyTypeHash {
			partitionKey = &key
			break
		}
	}
	require.NotNil(t, partitionKey, "%s should have a partition key", tableIdentifier)
	assert.Equal(t, expectedPartitionKey, *partitionKey.AttributeName, "%s partition key should be %s", tableIdentifier, expectedPartitionKey)

	// Validate sort key if expected
	if expectedSortKey != "" {
		var sortKey *types.KeySchemaElement
		for _, key := range table.KeySchema {
			if key.KeyType == types.KeyTypeRange {
				sortKey = &key
				break
			}
		}
		require.NotNil(t, sortKey, "%s should have a sort key", tableIdentifier)
		assert.Equal(t, expectedSortKey, *sortKey.AttributeName, "%s sort key should be %s", tableIdentifier, expectedSortKey)
	}

	// Validate attribute definitions
	expectedAttrCount := 1
	if expectedSortKey != "" {
		expectedAttrCount = 2
	}
	require.Len(t, table.AttributeDefinitions, expectedAttrCount, "%s should have correct number of attribute definitions", tableIdentifier)

	// Find partition key attribute definition
	var partitionKeyAttr *types.AttributeDefinition
	for _, attr := range table.AttributeDefinitions {
		if *attr.AttributeName == expectedPartitionKey {
			partitionKeyAttr = &attr
			break
		}
	}
	require.NotNil(t, partitionKeyAttr, "%s should have partition key attribute definition", tableIdentifier)
	assert.Equal(t, types.ScalarAttributeTypeS, partitionKeyAttr.AttributeType, "%s partition key should be STRING type", tableIdentifier)
}

// getExpectedKeyCount returns the expected number of keys based on whether sort key is provided
func getExpectedKeyCount(expectedSortKey string) int {
	if expectedSortKey == "" {
		return 1 // Only partition key
	}
	return 2 // Partition key + sort key
}

// getDynamoDBTableResourcePolicy retrieves the resource policy for a DynamoDB table with retry logic for eventual consistency
func getDynamoDBTableResourcePolicy(t *testing.T, awsRegion string, tableArn string) *string {
	client := aws.NewDynamoDBClient(t, awsRegion)

	// Retry logic for eventual consistency - GetResourcePolicy can initially return PolicyNotFoundException
	description := fmt.Sprintf("Getting resource policy for table %s", tableArn)
	maxRetries := 5
	retryInterval := 10 * time.Second

	var policy *string
	_, err := retry.DoWithRetryE(t, description, maxRetries, retryInterval, func() (string, error) {
		result, err := client.GetResourcePolicy(context.Background(), &dynamodb.GetResourcePolicyInput{
			ResourceArn: awssdk.String(tableArn),
		})

		if err != nil {
			// Check if it's a PolicyNotFoundException (expected for tables without policies)
			if strings.Contains(err.Error(), "PolicyNotFoundException") {
				terratestLogger.Logf(t, "No resource policy found for table %s", tableArn)
				policy = nil
				return "No policy found", nil
			}
			return "", err
		}

		if result.Policy != nil {
			policy = result.Policy
			terratestLogger.Logf(t, "Successfully retrieved resource policy for table %s", tableArn)
			return "Policy retrieved", nil
		}

		return "", fmt.Errorf("policy result was nil")
	})

	// For eventual consistency, we allow PolicyNotFoundException to be the final result
	if err != nil && !strings.Contains(err.Error(), "PolicyNotFoundException") {
		require.NoError(t, err, "Failed to get resource policy")
	}

	return policy
}

// validateResourcePolicyContent validates the content of a DynamoDB resource policy
func validateResourcePolicyContent(t *testing.T, policyDoc map[string]interface{}, tableIdentifier string) {
	// Validate policy document structure
	require.Contains(t, policyDoc, "Statement", "%s policy should have Statement", tableIdentifier)

	statements, ok := policyDoc["Statement"].([]interface{})
	require.True(t, ok, "%s policy Statement should be an array", tableIdentifier)
	require.Len(t, statements, 1, "%s policy should have exactly one statement", tableIdentifier)

	statement, ok := statements[0].(map[string]interface{})
	require.True(t, ok, "%s policy statement should be an object", tableIdentifier)

	// Validate Effect
	require.Contains(t, statement, "Effect", "%s policy statement should have Effect", tableIdentifier)
	assert.Equal(t, "Allow", statement["Effect"], "%s policy statement Effect should be Allow", tableIdentifier)

	// Validate Action
	require.Contains(t, statement, "Action", "%s policy statement should have Action", tableIdentifier)
	action := statement["Action"]

	// Action can be either a string or an array
	var actionString string
	switch v := action.(type) {
	case string:
		actionString = v
	case []interface{}:
		require.Len(t, v, 1, "%s policy statement should have exactly one action", tableIdentifier)
		actionString = v[0].(string)
	default:
		require.Fail(t, "Unexpected action type", "%s policy statement Action should be string or array", tableIdentifier)
	}

	assert.Equal(t, "dynamodb:*", actionString, "%s policy statement should allow dynamodb:* actions", tableIdentifier)

	// Validate Principal
	require.Contains(t, statement, "Principal", "%s policy statement should have Principal", tableIdentifier)
	principal, ok := statement["Principal"].(map[string]interface{})
	require.True(t, ok, "%s policy statement Principal should be an object", tableIdentifier)

	require.Contains(t, principal, "AWS", "%s policy statement Principal should have AWS", tableIdentifier)
	awsPrincipal := principal["AWS"]

	// Principal can be either a string or an array - handle both cases
	var principalArn string
	switch v := awsPrincipal.(type) {
	case string:
		principalArn = v
	case []interface{}:
		require.Len(t, v, 1, "%s policy statement should have exactly one AWS principal", tableIdentifier)
		principalArn = v[0].(string)
	default:
		require.Fail(t, "Unexpected principal type", "%s policy statement AWS principal should be string or array", tableIdentifier)
	}

	// Validate that it's an account root principal (format: arn:aws:iam::ACCOUNT-ID:root)
	assert.Contains(t, principalArn, ":root", "%s policy statement should grant access to account root principal", tableIdentifier)
	assert.Contains(t, principalArn, "arn:aws:iam::", "%s policy statement should be a valid IAM ARN", tableIdentifier)

	// Validate Resource
	require.Contains(t, statement, "Resource", "%s policy statement should have Resource", tableIdentifier)
	resource := statement["Resource"]

	// Resource can be either a string or an array
	var resourceString string
	switch v := resource.(type) {
	case string:
		resourceString = v
	case []interface{}:
		require.Len(t, v, 1, "%s policy statement should have exactly one resource", tableIdentifier)
		resourceString = v[0].(string)
	default:
		require.Fail(t, "Unexpected resource type", "%s policy statement Resource should be string or array", tableIdentifier)
	}

	assert.Equal(t, "*", resourceString, "%s policy statement should allow access to all resources", tableIdentifier)

	terratestLogger.Logf(t, "Successfully validated %s resource policy content", tableIdentifier)
}

// validateGrantReadDataPolicyContent validates the content of a DynamoDB resource policy created by grantReadData
func validateGrantReadDataPolicyContent(t *testing.T, policyDoc map[string]interface{}, tableIdentifier string) {
	// Validate policy document structure
	require.Contains(t, policyDoc, "Statement", "%s policy should have Statement", tableIdentifier)

	statements, ok := policyDoc["Statement"].([]interface{})
	require.True(t, ok, "%s policy Statement should be an array", tableIdentifier)
	require.Len(t, statements, 1, "%s policy should have exactly one statement", tableIdentifier)

	statement, ok := statements[0].(map[string]interface{})
	require.True(t, ok, "%s policy statement should be an object", tableIdentifier)

	// Validate Effect
	require.Contains(t, statement, "Effect", "%s policy statement should have Effect", tableIdentifier)
	assert.Equal(t, "Allow", statement["Effect"], "%s policy statement Effect should be Allow", tableIdentifier)

	// Validate Action - grantReadData should only have read-specific actions
	require.Contains(t, statement, "Action", "%s policy statement should have Action", tableIdentifier)
	actions, ok := statement["Action"].([]interface{})
	require.True(t, ok, "%s policy statement Action should be an array", tableIdentifier)

	// Verify that we have read-only actions (not "dynamodb:*")
	actionStrings := make([]string, len(actions))
	for i, action := range actions {
		actionStrings[i] = action.(string)
	}

	// Check for expected read actions (these come from READ_DATA_ACTIONS_TABLE_SAFE + DESCRIBE_TABLE)
	expectedReadActions := []string{
		"dynamodb:BatchGetItem",
		"dynamodb:ConditionCheckItem",
		"dynamodb:DescribeTable",
		"dynamodb:GetItem",
		"dynamodb:Query",
		"dynamodb:Scan",
	}

	for _, expectedAction := range expectedReadActions {
		assert.Contains(t, actionStrings, expectedAction, "%s policy should contain read action %s", tableIdentifier, expectedAction)
	}

	// Should NOT contain write actions like PutItem, UpdateItem, DeleteItem
	forbiddenWriteActions := []string{
		"dynamodb:PutItem",
		"dynamodb:UpdateItem",
		"dynamodb:DeleteItem",
		"dynamodb:BatchWriteItem",
	}

	for _, forbiddenAction := range forbiddenWriteActions {
		assert.NotContains(t, actionStrings, forbiddenAction, "%s policy should not contain write action %s", tableIdentifier, forbiddenAction)
	}

	// Should NOT contain wildcard action
	assert.NotContains(t, actionStrings, "dynamodb:*", "%s policy should not contain wildcard action", tableIdentifier)

	// Validate Principal - should be the account root principal
	require.Contains(t, statement, "Principal", "%s policy statement should have Principal", tableIdentifier)
	principal, ok := statement["Principal"].(map[string]interface{})
	require.True(t, ok, "%s policy statement Principal should be an object", tableIdentifier)

	require.Contains(t, principal, "AWS", "%s policy statement Principal should have AWS", tableIdentifier)
	awsPrincipal := principal["AWS"]

	// Principal can be either a string or an array - handle both cases
	var principalArn string
	switch v := awsPrincipal.(type) {
	case string:
		principalArn = v
	case []interface{}:
		require.Len(t, v, 1, "%s policy statement should have exactly one AWS principal", tableIdentifier)
		principalArn = v[0].(string)
	default:
		require.Fail(t, "Unexpected principal type", "%s policy statement AWS principal should be string or array", tableIdentifier)
	}

	// Validate that it's an account root principal (format: arn:aws:iam::ACCOUNT-ID:root)
	assert.Contains(t, principalArn, ":root", "%s policy statement should grant access to account root principal", tableIdentifier)
	assert.Contains(t, principalArn, "arn:aws:iam::", "%s policy statement should be a valid IAM ARN", tableIdentifier)

	// Validate Resource - should reference the table
	require.Contains(t, statement, "Resource", "%s policy statement should have Resource", tableIdentifier)
	resource := statement["Resource"]

	// Resource can be either a string or an array
	var resourceArns []string
	switch v := resource.(type) {
	case string:
		resourceArns = []string{v}
	case []interface{}:
		resourceArns = make([]string, len(v))
		for i, res := range v {
			resourceArns[i] = res.(string)
		}
	default:
		require.Fail(t, "Unexpected resource type", "%s policy statement Resource should be string or array", tableIdentifier)
	}

	require.GreaterOrEqual(t, len(resourceArns), 1, "%s policy statement should have at least one resource", tableIdentifier)

	// First resource should be the table ARN
	tableArn := resourceArns[0]
	assert.Contains(t, tableArn, "arn:aws:dynamodb:", "%s policy statement should reference a DynamoDB table", tableIdentifier)
	assert.Contains(t, tableArn, "table/", "%s policy statement should reference a table resource", tableIdentifier)

	terratestLogger.Logf(t, "Successfully validated %s grantReadData policy content", tableIdentifier)
}
