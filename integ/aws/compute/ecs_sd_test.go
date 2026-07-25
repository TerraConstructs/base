package test

import (
	"fmt"
	"testing"
	"time"

	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the ecs.sd-awsvpc-nw app
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/ec2/integ.sd-awsvpc-nw.ts
//
// This is the first EC2-capacity / CloudMap-service-discovery integ test in this
// package. It deploy-validates two code paths that have never been exercised live:
//   - BaseService's CloudMap service registration (`cloudMapOptions` -> `enableCloudMap()`
//     -> `service_registries` emitted by base-service.ts's prepare-time toTerraform()).
//   - `cluster.addCapacity()`'s EC2 capacity path: ASG + ECS-optimized AMI (via SSM
//     parameter) + the instance-drain lifecycle hook (drain-hook/instance-drain-hook.ts).
func TestEcsSdAwsvpcNw(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "ecs.sd-awsvpc-nw", options, validateEcsSdAwsvpcNw)
}

func validateEcsSdAwsvpcNw(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	clusterName := util.LoadOutputAttribute(t, opts, "cluster", "name")
	serviceName := util.LoadOutputAttribute(t, opts, "service", "name")

	// (a) Validate the `cluster.addCapacity('DefaultAutoScalingGroup', { instanceType:
	// t2.micro })` EC2 capacity path: wait for the ASG's container instance(s) to
	// register with the cluster. Instances take a few minutes to launch, bootstrap via
	// user data (`echo ECS_CLUSTER=... >> /etc/ecs/ecs.config`), and register the ECS
	// agent, so poll rather than assume immediate readiness.
	msg, err := retry.DoWithRetryE(
		t,
		fmt.Sprintf("Waiting for container instances to register with cluster %s", clusterName),
		60, // 60 * 10s = 10 minutes
		10*time.Second,
		func() (string, error) {
			cluster := terratestaws.GetEcsCluster(t, awsRegion, clusterName)
			if cluster.RegisteredContainerInstancesCount < 1 {
				return "", fmt.Errorf(
					"cluster %s has %d registered container instances, want >= 1",
					clusterName, cluster.RegisteredContainerInstancesCount,
				)
			}
			return fmt.Sprintf(
				"cluster %s has %d registered container instance(s)",
				clusterName, cluster.RegisteredContainerInstancesCount,
			), nil
		},
	)
	require.NoError(t, err, "expected the DefaultAutoScalingGroup's EC2 instance(s) to register with the cluster")
	t.Log(msg)

	// (b) Wait for the FrontendService to reach steady state (task RUNNING, scheduled onto
	// a registered container instance) before checking the CloudMap wiring below - mirrors
	// the ordering of the upstream IntegTest, whose assertions only run once the stack's
	// resources have stabilized.
	client := terratestaws.NewEcsClient(t, awsRegion)
	waitForEcsServiceStable(t, client, clusterName, serviceName, 15*time.Minute)

	// (c) Validate BaseService's CloudMap service registration: `new ecs.Ec2Service(stack,
	// 'FrontendService', { cloudMapOptions: { name: 'frontend' } })` should have called
	// `enableCloudMap()`, which attaches a `service_registries` block (pointing at the
	// `aws_service_discovery_service` created for 'frontend') to the ECS service.
	service := terratestaws.GetEcsService(t, awsRegion, clusterName, serviceName)
	require.NotEmpty(t, service.ServiceRegistries, "expected the Ec2Service to have a CloudMap service registry attached")
	assert.NotNil(t, service.ServiceRegistries[0].RegistryArn, "expected the service registry to reference the CloudMap service ARN")

	// (d) github.com/aws/aws-sdk-go-v2/service/servicediscovery is already a dependency of
	// this module (used by integ/aws/servicediscovery.go's DiscoverCloudMapInstancesE), so
	// confirm the frontend task actually registered itself as a discoverable instance under
	// the cluster's default 'scorekeep.com' PrivateDnsNamespace / 'frontend' CloudMap
	// service. Both names are static string literals passed directly in
	// apps/ecs.sd-awsvpc-nw.ts (`cluster.addDefaultCloudMapNamespace({ name: 'scorekeep.com'
	// })`, `cloudMapOptions: { name: 'frontend' }`), not generated names, so they don't need
	// a TerraformOutput to recover here - they're already known at test-authoring time.
	discoverMsg, err := retry.DoWithRetryE(
		t,
		"Waiting for the frontend task to be discoverable via Cloud Map (scorekeep.com/frontend)",
		12, // 12 * 10s = 2 minutes - DiscoverInstances propagation lags slightly behind service-steady-state
		10*time.Second,
		func() (string, error) {
			instances, discoverErr := util.DiscoverCloudMapInstancesE(t, awsRegion, "scorekeep.com", "frontend")
			if discoverErr != nil {
				return "", discoverErr
			}
			if len(instances) < 1 {
				return "", fmt.Errorf("expected >= 1 discoverable instance for scorekeep.com/frontend, got %d", len(instances))
			}
			return fmt.Sprintf("found %d discoverable instance(s) for scorekeep.com/frontend", len(instances)), nil
		},
	)
	require.NoError(t, err, "expected DiscoverInstances to find the frontend task registered under scorekeep.com")
	t.Log(discoverMsg)
}
