package test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
	"github.com/environment-toolkit/go-synth/executors"
	"github.com/envtio/base/integ"
	util "github.com/envtio/base/integ/aws"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	loggers "github.com/gruntwork-io/terratest/modules/logger"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
)

var terratestLogger = loggers.Default

// Run the apps/log-destination-kinesis.ts integration test
func TestLogDestinationKinesis(t *testing.T) {
	runMonitoringIntegrationTest(t, "log-destination-kinesis", "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			// Load the Terraform Options saved by the earlier deploy_terraform stage
			terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
			streamName := util.LoadOutputAttribute(t, terraformOptions, "stream", "streamName")

			// If the proper dependency is not set, then the deployment fails with:
			// Resource handler returned message: "Could not deliver test message to specified
			// Kinesis stream. Check if the given kinesis stream is in ACTIVE state.
			// (Service: CloudWatchLogs, Status Code: 400, Request ID: [...])"

			util.WaitForStreamActive(t, awsRegion, streamName, 10, 10*time.Second)
		})
}

// Run the apps/log-destination-lambda.ts integration test
func TestLogDestinationLambda(t *testing.T) {
	app := "log-destination-lambda"
	runMonitoringIntegrationTest(t, app, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			snapshotPath := filepath.Join("snapshots", app)
			// Load the Terraform Options saved by the earlier deploy_terraform stage
			terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
			queueUrl := util.LoadOutputAttribute(t, terraformOptions, "queue", "url")
			// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/%40aws-cdk-testing/framework-integ/test/aws-logs-destinations/test/integ.lambda.ts#L62
			util.PutEvents(t, awsRegion, []types.PutEventsRequestEntry{
				{
					Detail:     aws.String(`{"foo": "bar"}`),
					DetailType: aws.String("cdk-integ-custom-rule"),
					Source:     aws.String("cdk-lambda-integ"),
				},
			})
			resp := terratestaws.WaitForQueueMessage(t, awsRegion, queueUrl, 20)
			if os.Getenv("WRITE_SNAPSHOTS") == "true" {
				writeSnapshot(t, snapshotPath, resp, "ReceivedMessage")
			} else {
				var messageBody map[string]interface{}
				err := json.Unmarshal([]byte(resp.MessageBody), &messageBody)
				require.NoError(t, err, "Failed to unmarshal message body")
				integ.Assert(t, messageBody, []integ.Assertion{
					{
						Path:           "responsePayload",
						ExpectedRegexp: aws.String(`success`),
					},
				})
			}
		})
}

// run the apps/log-group-metrics.ts integration test
func TestLogGroupMetrics(t *testing.T) {
	app := "log-group-metrics"
	runMonitoringIntegrationTest(t, app, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			snapshotPath := filepath.Join("snapshots", app)
			// Load the Terraform Options saved by the earlier deploy_terraform stage
			terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
			for _, outputName := range []string{"alarm1", "alarm2"} {
				alarmName := util.LoadOutputAttribute(t, terraformOptions, outputName, "alarmName")
				alarm := util.GetMetricAlarm(t, awsRegion, alarmName)
				require.NotNil(t, alarm)
				if os.Getenv("WRITE_SNAPSHOTS") == "true" {
					writeSnapshot(t, snapshotPath, alarm, outputName)
				} else {
					integ.Assert(t, alarm, []integ.Assertion{
						{
							Path:           "Namespace",
							ExpectedRegexp: aws.String(`AWS/Logs`),
						},
						{
							Path:           "MetricName",
							ExpectedRegexp: aws.String(`IncomingBytes|IncomingLogs`),
						},
						{
							Path:           "Threshold",
							ExpectedRegexp: aws.String(`1`),
						},
						{
							Path:           "EvaluationPeriods",
							ExpectedRegexp: aws.String(`1`),
						},
						{
							Path:           "Period",
							ExpectedRegexp: aws.String(`300`),
						},
					})
				}
			}
		})
}

// run the apps/log-group-dataprotection.ts integration test
func TestLogGroupDataProtection(t *testing.T) {
	app := "log-group-dataprotection"
	runMonitoringIntegrationTest(t, app, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			snapshotPath := filepath.Join("snapshots", app)
			// Load the Terraform Options saved by the earlier deploy_terraform stage
			terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
			logGroupName := util.LoadOutputAttribute(t, terraformOptions, "log_group", "logGroupName")
			// TODO: Align output keys, should be bucketName
			bucketName := util.LoadOutputAttribute(t, terraformOptions, "bucket", "name")
			policyStr := util.GetDataProtectionPolicyDocument(t, awsRegion, logGroupName)
			var policy any
			err := json.Unmarshal([]byte(policyStr), &policy)
			require.NoError(t, err)
			if os.Getenv("WRITE_SNAPSHOTS") == "true" {
				writeSnapshot(t, snapshotPath, policy, "DataProtectionPolicy")
			} else {
				integ.Assert(t, policy, []integ.Assertion{
					{
						// confirm custom data identifier is defined
						Path:           "configuration.customDataIdentifier[].name",
						ExpectedRegexp: aws.String(`EmployeeId`),
					},
					{
						// ensure ALL statement[].dataIdentifier[] elements are one of the expected values
						Path: `statement[].dataIdentifier[]
							| [? !contains([
									'arn:aws:dataprotection::aws:data-identifier/DriversLicense-US',
									'arn:aws:dataprotection::aws:data-identifier/EmailAddress',
									'EmployeeId'
								], @)]
							| length(@)`,
						ExpectedRegexp: aws.String("^0$"),
					},
				})
			}
			// TODO: tf destroy fails on non-empty bucket, may need to fix this.
			terratestaws.EmptyS3Bucket(t, awsRegion, bucketName)
		})
}

// run monitoring integration test
func runMonitoringIntegrationTest(t *testing.T, testApp, awsRegion string, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
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
