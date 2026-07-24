package test

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	"github.com/aws/aws-sdk-go-v2/service/ecs/types"
	http_helper "github.com/gruntwork-io/terratest/modules/http-helper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the ecs.lb-awsvpc-nw app
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/fargate/integ.lb-awsvpc-nw.ts
//
// This exercises BaseService's LB attach logic (attachToApplicationTargetGroup /
// the `load_balancer` block emitted by prepare-time `toTerraform()` in
// src/aws/compute/ecs/base/base-service.ts) and ScalableTaskCount
// (src/aws/compute/ecs/base/scalable-task-count.ts).
func TestEcsLbAwsvpcNw(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "ecs.lb-awsvpc-nw", options, validateEcsLbAwsvpcNw)
}

func validateEcsLbAwsvpcNw(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	clusterName := util.LoadOutputAttribute(t, opts, "cluster", "name")
	serviceName := util.LoadOutputAttribute(t, opts, "service", "name")
	lbDNSName := util.LoadOutputAttribute(t, opts, "lb", "loadBalancerDnsName")

	// Wait for the service to reach steady state before inspecting its load balancer
	// attachment / hitting the ALB - mirrors the ordering used by validateEcsAwslogsDriver.
	client := terratestaws.NewEcsClient(t, awsRegion)
	waitForEcsServiceStable(t, client, clusterName, serviceName, 10*time.Minute)

	// Validate that `listener.addTargets('Fargate', { port: 80, targets: [service] })`
	// wired the service's 'web' container into the target group via BaseService's
	// `attachToApplicationTargetGroup` -> `attachToELBv2`, which pushes onto
	// `this.loadBalancers` and is rendered into the `aws_ecs_service.load_balancer` block
	// by `BaseService.toTerraform()`.
	describeOut, err := client.DescribeServices(context.Background(), &ecs.DescribeServicesInput{
		Cluster:  aws.String(clusterName),
		Services: []string{serviceName},
	})
	require.NoError(t, err)
	require.Len(t, describeOut.Services, 1)
	svc := describeOut.Services[0]

	require.NotEmpty(t, svc.LoadBalancers, "expected the service to be attached to a target group")
	lb := svc.LoadBalancers[0]
	require.NotNil(t, lb.ContainerName)
	require.NotNil(t, lb.ContainerPort)
	require.NotNil(t, lb.TargetGroupArn)
	assert.Equal(t, "web", *lb.ContainerName)
	assert.Equal(t, int32(80), *lb.ContainerPort)
	assert.NotEmpty(t, *lb.TargetGroupArn)
	assert.Equal(t, types.LaunchTypeFargate, svc.LaunchType)

	// Validate the `service.autoScaleTaskCount({ maxCapacity: 10 })` /
	// `scaling.scaleOnCpuUtilization('ReasonableCpu', { targetUtilizationPercent: 10 })`
	// calls registered a ScalableTaskCount (aws_appautoscaling_target +
	// aws_appautoscaling_policy). github.com/aws/aws-sdk-go-v2/service/applicationautoscaling
	// is already a go.mod dependency (see integ/aws/applicationautoscaling.go), so this is
	// validated directly rather than skipped.
	resourceID := fmt.Sprintf("service/%s/%s", clusterName, serviceName)
	targets := util.GetScalableTargetsByResourceId(t, awsRegion, "ecs", resourceID)
	require.Len(t, targets, 1, "expected exactly one scalable target for the service")
	target := targets[0]
	require.NotNil(t, target.MaxCapacity)
	require.NotNil(t, target.MinCapacity)
	assert.Equal(t, int32(10), *target.MaxCapacity)

	// The policy physical name is scope-prefixed by the construct (e.g.
	// "test-ReasonableCpu"), so match on suffix rather than exact equality.
	policies := util.GetScalingPolicies(t, awsRegion, "ecs")
	var foundPolicy bool
	for _, policy := range policies {
		if policy.ResourceId != nil && *policy.ResourceId == resourceID &&
			policy.PolicyName != nil && strings.HasSuffix(*policy.PolicyName, "ReasonableCpu") {
			foundPolicy = true
			break
		}
	}
	assert.True(t, foundPolicy, "expected a 'ReasonableCpu' target tracking scaling policy on the service")

	// Port of the upstream integ test's implicit expectation that the internet-facing
	// ALB successfully routes to the Fargate service behind it - retry since the target
	// group's health checks / DNS propagation take a little while after steady state.
	url := fmt.Sprintf("http://%s/", lbDNSName)
	http_helper.HttpGetWithRetryWithCustomValidation(
		t,
		url,
		nil,
		30,
		10*time.Second,
		func(status int, body string) bool {
			return status == http.StatusOK
		},
	)
}
