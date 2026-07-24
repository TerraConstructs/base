package test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	"github.com/aws/aws-sdk-go-v2/service/ecs/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the ecs.asg-capacity-provider app
//
// Ports ec2/integ.capacity-provider.ts (the only upstream ECS integ that is purely
// AsgCapacityProvider + cluster.addAsgCapacityProvider() + an Ec2Service on a
// capacityProviderStrategies strategy), minimally augmented with a bridge-mode ALB
// target (borrowed from ec2/integ.lb-bridge-nw.ts) so the ASG-connections -> ALB
// security-group propagation fixed in cluster.ts can be observed from the AWS SDK.
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/ec2/integ.capacity-provider.ts
//
// This deploy-validates three fixes/behaviors in cluster.ts / base-service.ts that have
// never been exercised live:
//  1. cluster.ts ~L2119-2130: `AsgCapacityProvider`'s `aws_ecs_capacity_provider.auto_scaling_group_provider.auto_scaling_group_arn`
//     is populated from `autoScalingGroup.autoScalingGroupArn` (a real ARN), not the ASG
//     name - the Terraform resource requires a real ARN or every subsequent plan shows
//     perpetual drift/replacement.
//  2. cluster.ts ~L733-739: `addAsgCapacityProvider()` propagates the ASG's security
//     groups into `cluster.connections`, which `Ec2Service` (bridge/host/none network
//     modes) copies onto the service - and which `listener.addTargets()` /
//     `attachToELBv2()` (base-service.ts ~L2049) then authorizes ALB -> container-instance
//     ingress against.
//  3. cluster.ts ~L1098-1114 `toTerraform()`: every `addAsgCapacityProvider()` /
//     `enableFargateCapacityProviders()` / `addDefaultCapacityProviderStrategy()` call
//     merges into a SINGLE `aws_ecs_cluster_capacity_providers` resource per cluster
//     (idempotent `tryFindChild` guard), not one resource per call.
//  4. base-service.ts ~L824-829: `launchType` is blanked out (omitted) on the
//     `aws_ecs_service` resource whenever `capacityProviderStrategies` is set.
func TestEcsAsgCapacityProvider(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "ecs.asg-capacity-provider", options, validateEcsAsgCapacityProvider)
}

func validateEcsAsgCapacityProvider(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	clusterName := util.LoadOutputAttribute(t, opts, "cluster", "name")
	serviceName := util.LoadOutputAttribute(t, opts, "service", "name")
	cpName := terraform.Output(t, opts, "capacity-provider-name")
	asgName := terraform.Output(t, opts, "asg-name")
	lbSecurityGroupId := terraform.Output(t, opts, "lb-security-group-id")
	require.NotEmpty(t, cpName)
	require.NotEmpty(t, asgName)
	require.NotEmpty(t, lbSecurityGroupId)

	ecsClient := terratestaws.NewEcsClient(t, awsRegion)
	ec2Client := util.NewEc2Client(t, awsRegion)

	// --- Finding 1: AsgCapacityProvider's auto_scaling_group_arn is a real ARN, and the
	// stack has no perpetual drift as a result. ---
	//
	// Cross-check the capacity provider's `AutoScalingGroupArn` against the ASG's own ARN
	// (from autoscaling.DescribeAutoScalingGroups) rather than just pattern-matching the
	// prefix, so a regression that swaps in some *other* well-formed ARN would still fail.
	asg := util.GetAutoScalingGroup(t, awsRegion, asgName)
	require.NotNil(t, asg.AutoScalingGroupARN)

	cpOut, err := ecsClient.DescribeCapacityProviders(context.Background(), &ecs.DescribeCapacityProvidersInput{
		CapacityProviders: []string{cpName},
	})
	require.NoError(t, err)
	require.Len(t, cpOut.CapacityProviders, 1, "expected exactly one capacity provider named %s", cpName)
	provider := cpOut.CapacityProviders[0]
	assert.Equal(t, types.CapacityProviderStatusActive, provider.Status)
	require.NotNil(t, provider.AutoScalingGroupProvider)
	require.NotNil(t, provider.AutoScalingGroupProvider.AutoScalingGroupArn)
	providerAsgArn := *provider.AutoScalingGroupProvider.AutoScalingGroupArn
	assert.True(t, strings.HasPrefix(providerAsgArn, "arn:aws:autoscaling:"),
		"expected AutoScalingGroupArn %q to be a real ARN (arn:aws:autoscaling:...), not the bare ASG name", providerAsgArn)
	assert.Equal(t, *asg.AutoScalingGroupARN, providerAsgArn,
		"expected the capacity provider's AutoScalingGroupArn to match the ASG's own ARN")

	// The regression proof: with a real ARN wired in (rather than the bare ASG name),
	// re-planning the already-applied stack should show zero changes - a bare name would
	// read back as a real ARN from the provider and diff against the configured value on
	// every subsequent plan.
	planExitCode := terraform.PlanExitCode(t, opts)
	assert.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)

	// --- Finding 3: addAsgCapacityProvider() merges into a single
	// aws_ecs_cluster_capacity_providers resource per cluster. ---
	clusterOut, err := ecsClient.DescribeClusters(context.Background(), &ecs.DescribeClustersInput{
		Clusters: []string{clusterName},
		Include:  []types.ClusterField{types.ClusterFieldAttachments, types.ClusterFieldSettings},
	})
	require.NoError(t, err)
	require.Len(t, clusterOut.Clusters, 1)
	cluster := clusterOut.Clusters[0]
	assert.Contains(t, cluster.CapacityProviders, cpName,
		"expected the cluster's capacity providers to include %s", cpName)
	assert.Len(t, cluster.CapacityProviders, 1,
		"expected exactly one capacity-provider association on the cluster (a single merged aws_ecs_cluster_capacity_providers resource)")

	// --- Wait for the service to reach steady state before checking SG propagation /
	// task placement - mirrors the ordering used by validateEcsAwslogsDriver /
	// validateEcsLbAwsvpcNw. Also gives the ASG's instance time to launch and register. ---
	waitForEcsServiceStable(t, ecsClient, clusterName, serviceName, 20*time.Minute)

	// --- Finding 2: addAsgCapacityProvider() propagates the ASG's security group into
	// cluster.connections, which listener.addTargets() authorized ALB -> container-instance
	// ingress against. ---
	//
	// Identify the container-instance SG the way the construct wiring does: ASG ->
	// instance -> the instance's own security groups (NOT a fixed name/tag guess).
	// Re-fetch the ASG here (rather than reusing the Finding-1 snapshot taken right after
	// apply, before the instance may have appeared in the ASG's Instances list) now that
	// the service is steady, so the instance is guaranteed to be launched/registered.
	asg = util.GetAutoScalingGroup(t, awsRegion, asgName)
	require.NotEmpty(t, asg.Instances, "expected the ASG to have at least one instance by the time the service is steady")
	instanceID := asg.Instances[0].InstanceId
	require.NotNil(t, instanceID)

	instOut, err := ec2Client.DescribeInstances(context.Background(), &ec2.DescribeInstancesInput{
		InstanceIds: []string{*instanceID},
	})
	require.NoError(t, err)
	require.Len(t, instOut.Reservations, 1)
	require.Len(t, instOut.Reservations[0].Instances, 1)
	require.NotEmpty(t, instOut.Reservations[0].Instances[0].SecurityGroups,
		"expected the container instance to have at least one security group")
	instanceSgID := instOut.Reservations[0].Instances[0].SecurityGroups[0].GroupId
	require.NotNil(t, instanceSgID)

	sgOut, err := ec2Client.DescribeSecurityGroups(context.Background(), &ec2.DescribeSecurityGroupsInput{
		GroupIds: []string{*instanceSgID},
	})
	require.NoError(t, err)
	require.Len(t, sgOut.SecurityGroups, 1)

	var foundAlbIngress bool
	for _, perm := range sgOut.SecurityGroups[0].IpPermissions {
		for _, pair := range perm.UserIdGroupPairs {
			if pair.GroupId != nil && *pair.GroupId == lbSecurityGroupId {
				// hostPort 8080 is the fixed bridge-mode mapping used by the 'web'
				// container; accept either an exact port match or an "all
				// protocols/ports" rule (FromPort/ToPort nil or -1).
				if ipPermissionCoversPort(perm, 8080) {
					foundAlbIngress = true
				}
			}
		}
	}
	assert.True(t, foundAlbIngress,
		"expected the container-instance security group (%s) to have an ingress rule referencing the ALB's security group (%s) covering port 8080 - addAsgCapacityProvider() should have propagated the ASG's SG into cluster.connections",
		*instanceSgID, lbSecurityGroupId)

	// --- Finding 4: launchType is blanked out (empty/EC2-via-capacity-provider, not a
	// bare EC2 launchType) when capacityProviderStrategies is set. ---
	tasksOut, err := ecsClient.ListTasks(context.Background(), &ecs.ListTasksInput{
		Cluster:     aws.String(clusterName),
		ServiceName: aws.String(serviceName),
	})
	require.NoError(t, err)
	require.NotEmpty(t, tasksOut.TaskArns, "expected at least one running task for the service")

	describeTasksOut, err := ecsClient.DescribeTasks(context.Background(), &ecs.DescribeTasksInput{
		Cluster: aws.String(clusterName),
		Tasks:   tasksOut.TaskArns,
	})
	require.NoError(t, err)
	require.NotEmpty(t, describeTasksOut.Tasks)
	task := describeTasksOut.Tasks[0]
	// ECS reports LaunchType "EC2" for tasks placed via an EC2-backed capacity
	// provider (observed live) - CapacityProviderName being set is the actual
	// proof the task was placed by the strategy rather than a bare launchType.
	// The synthesized aws_ecs_service correctly omits launch_type in favor of
	// capacity_provider_strategy (asserted at synth by cluster.test.ts).
	require.NotNil(t, task.CapacityProviderName)
	assert.Equal(t, cpName, *task.CapacityProviderName,
		"expected the task to have been placed via the %s capacity provider", cpName)
}

// ipPermissionCoversPort reports whether the given ingress rule covers the given TCP
// port - either an exact FromPort/ToPort range match, or an "all traffic" rule
// (IpProtocol "-1", which reports FromPort/ToPort as nil).
func ipPermissionCoversPort(perm ec2types.IpPermission, port int32) bool {
	if perm.IpProtocol != nil && *perm.IpProtocol == "-1" {
		return true
	}
	if perm.FromPort == nil || perm.ToPort == nil {
		return false
	}
	return *perm.FromPort <= port && port <= *perm.ToPort
}
