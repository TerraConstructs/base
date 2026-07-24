package test

import (
	"context"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	"github.com/aws/aws-sdk-go-v2/service/ecs/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// waitForEcsServiceStable polls DescribeServices until the service reaches
// steady state (exactly one deployment and runningCount == desiredCount —
// the same success condition as the SDK's ServicesStableWaiter).
//
// Deliberately NOT the SDK waiter: aws-sdk-go-v2/service/ecs v1.52.0's
// servicesStableStateRetryable evaluates jmespath "failures[].reason" and
// hard-fails with "waiter comparator expected list got <nil>" whenever the
// API response omits the `failures` array — which is the NORMAL healthy
// response shape. Observed live (twice) on the ecs.lb-awsvpc-nw deploys.
// This poll is also immune to the eventual-consistency window right after
// `apply` where the service is briefly reported MISSING.
func waitForEcsServiceStable(
	t *testing.T,
	client *ecs.Client,
	clusterName string,
	serviceName string,
	timeout time.Duration,
) {
	input := &ecs.DescribeServicesInput{
		Cluster:  aws.String(clusterName),
		Services: []string{serviceName},
	}
	deadline := time.Now().Add(timeout)
	for {
		out, err := client.DescribeServices(context.Background(), input)
		if err == nil && len(out.Services) > 0 {
			svc := out.Services[0]
			if len(svc.Deployments) == 1 && svc.RunningCount == svc.DesiredCount {
				return
			}
		}
		require.False(t, time.Now().After(deadline),
			"ECS service %s in cluster %s did not reach steady state within %s",
			serviceName, clusterName, timeout)
		time.Sleep(15 * time.Second)
	}
}

// Test the ecs.awslogs-driver app
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/fargate/integ.awslogs-driver.ts
func TestEcsAwslogsDriver(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "ecs.awslogs-driver", options, validateEcsAwslogsDriver)
}

func validateEcsAwslogsDriver(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	clusterName := util.LoadOutputAttribute(t, opts, "cluster", "name")
	taskDefArn := util.LoadOutputAttribute(t, opts, "task-definition", "arn")
	logGroupName := util.LoadOutputAttribute(t, opts, "log-group", "logGroupName")
	serviceName := util.LoadOutputAttribute(t, opts, "service", "name")

	// Validate the FargateTaskDefinition(cpu: 512, memoryLimitMiB: 1024) registered by
	// `new ecs.FargateTaskDefinition(stack, 'TaskDef', { memoryLimitMiB: 1024, cpu: 512 })`.
	taskDef := terratestaws.GetEcsTaskDefinition(t, awsRegion, taskDefArn)
	require.NotNil(t, taskDef.Cpu)
	require.NotNil(t, taskDef.Memory)
	assert.Equal(t, "512", *taskDef.Cpu)
	assert.Equal(t, "1024", *taskDef.Memory)
	require.Contains(t, taskDef.RequiresCompatibilities, types.CompatibilityFargate)

	// Validate the single `taskDefinition.addContainer('nginx', { image:
	// ecs.ContainerImage.fromRegistry('nginx'), logging: ecs.LogDrivers.awsLogs({
	// streamPrefix: 'test', logGroup }) })` container.
	require.Len(t, taskDef.ContainerDefinitions, 1, "expected a single 'nginx' container")
	container := taskDef.ContainerDefinitions[0]
	require.NotNil(t, container.Name)
	require.NotNil(t, container.Image)
	assert.Equal(t, "nginx", *container.Name)
	assert.Equal(t, "nginx", *container.Image)

	require.NotNil(t, container.LogConfiguration, "expected the container to have an awslogs log configuration")
	assert.Equal(t, types.LogDriverAwslogs, container.LogConfiguration.LogDriver)
	assert.Equal(t, logGroupName, container.LogConfiguration.Options["awslogs-group"])
	assert.Equal(t, "test", container.LogConfiguration.Options["awslogs-stream-prefix"])
	assert.Equal(t, awsRegion, container.LogConfiguration.Options["awslogs-region"])

	// Validate the `new ecs.FargateService(stack, 'Service', { cluster, taskDefinition })`
	// - default launch type FARGATE, default desired count 1.
	service := terratestaws.GetEcsService(t, awsRegion, clusterName, serviceName)
	assert.Equal(t, types.LaunchTypeFargate, service.LaunchType)
	assert.Equal(t, int32(1), service.DesiredCount)

	// Wait for the service to reach steady state (task RUNNING) before checking for log
	// output - mirrors the ordering of the upstream IntegTest, whose awsApiCall assertion
	// only runs after the stack's resources have stabilized.
	client := terratestaws.NewEcsClient(t, awsRegion)
	waitForEcsServiceStable(t, client, clusterName, serviceName, 10*time.Minute)

	// Port of the upstream IntegTest assertion:
	//   test.assertions.awsApiCall('CloudWatchLogs', 'filterLogEvents', {
	//     logGroupName: logGroup.logGroupName,
	//     limit: 1,
	//   }).assertAtPath('events.0.message', ExpectedResult.stringLikeRegexp('.+')).waitForAssertions();
	events := util.WaitForLogEvents(t, awsRegion, logGroupName, 30, 10*time.Second)
	require.NotEmpty(t, events, "expected at least one log event from the nginx container via the awslogs driver")
	assert.NotEmpty(t, events[0])
}
