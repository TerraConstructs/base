package test

import (
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/autoscaling/types"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the autoscaling.custom-scaling app
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-autoscaling/test/integ.custom-scaling.ts
func TestAutoscalingCustomScaling(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "autoscaling.custom-scaling", options, validateAutoscalingCustomScaling)
}

func validateAutoscalingCustomScaling(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	asgName := util.LoadOutputAttribute(t, opts, "fleet", "autoScalingGroupName")

	// Validate the AutoScalingGroup: default (cheapest) capacity - min=max=desired=1 -
	// launched from a launch template (never a deprecated launch configuration)
	// running the smallest burstable instance, t2.micro.
	group := util.GetAutoScalingGroup(t, awsRegion, asgName)
	require.NotNil(t, group.MinSize)
	require.NotNil(t, group.MaxSize)
	require.NotNil(t, group.DesiredCapacity)
	assert.Equal(t, int32(1), *group.MinSize)
	assert.Equal(t, int32(1), *group.MaxSize)
	assert.Equal(t, int32(1), *group.DesiredCapacity)

	require.NotNil(t, group.LaunchTemplate, "expected the AutoScalingGroup to launch from a launch template, not a launch configuration")
	require.NotNil(t, group.LaunchTemplate.LaunchTemplateId)
	ltVersion := util.GetLaunchTemplateLatestVersion(t, awsRegion, *group.LaunchTemplate.LaunchTemplateId)
	require.NotEmpty(t, ltVersion.LaunchTemplateData.InstanceType, "expected the launch template to specify an instance type")
	assert.Equal(t, ec2types.InstanceTypeT2Micro, ltVersion.LaunchTemplateData.InstanceType)

	// Validate the 4 Schedule.cron() scheduled actions ported from the upstream app:
	// ScaleUpInTheMorning, ScaleDownAtNight, ScaleUpInTheDay, ScaleUpInTheWeekDay.
	actions := util.GetAsgScheduledActions(t, awsRegion, asgName)
	require.Len(t, actions, 4, "expected 4 scheduled actions")

	byRecurrence := make(map[string]types.ScheduledUpdateGroupAction, len(actions))
	for _, a := range actions {
		require.NotNil(t, a.Recurrence)
		byRecurrence[*a.Recurrence] = a
	}

	// ScaleUpInTheMorning: Schedule.cron({ hour: "8", minute: "0" }), minCapacity: 5
	morning, ok := byRecurrence["0 8 * * *"]
	require.True(t, ok, "expected a scheduled action with cron '0 8 * * *' (ScaleUpInTheMorning)")
	require.NotNil(t, morning.MinSize)
	assert.Equal(t, int32(5), *morning.MinSize)
	assert.Nil(t, morning.MaxSize)

	// ScaleDownAtNight: Schedule.cron({ hour: "20", minute: "0" }), maxCapacity: 2
	night, ok := byRecurrence["0 20 * * *"]
	require.True(t, ok, "expected a scheduled action with cron '0 20 * * *' (ScaleDownAtNight)")
	require.NotNil(t, night.MaxSize)
	assert.Equal(t, int32(2), *night.MaxSize)
	assert.Nil(t, night.MinSize)

	// ScaleUpInTheDay: Schedule.cron({ minute: "0/10", day: "1" }), minCapacity: 5
	day, ok := byRecurrence["0/10 * 1 * *"]
	require.True(t, ok, "expected a scheduled action with cron '0/10 * 1 * *' (ScaleUpInTheDay)")
	require.NotNil(t, day.MinSize)
	assert.Equal(t, int32(5), *day.MinSize)

	// ScaleUpInTheWeekDay: Schedule.cron({ minute: "0/10", weekDay: "MON-SUN" }), minCapacity: 5
	weekDay, ok := byRecurrence["0/10 * * * MON-SUN"]
	require.True(t, ok, "expected a scheduled action with cron '0/10 * * * MON-SUN' (ScaleUpInTheWeekDay)")
	require.NotNil(t, weekDay.MinSize)
	assert.Equal(t, int32(5), *weekDay.MinSize)

	// Validate the scaleOnCpuUtilization("KeepCPUReasonable", { targetUtilizationPercent: 50 })
	// TargetTrackingScaling policy.
	policies := util.GetAsgScalingPolicies(t, awsRegion, asgName)
	var cpuPolicy *types.ScalingPolicy
	for i := range policies {
		if policies[i].PolicyType != nil && *policies[i].PolicyType == "TargetTrackingScaling" {
			cpuPolicy = &policies[i]
			break
		}
	}
	require.NotNil(t, cpuPolicy, "expected a TargetTrackingScaling policy (KeepCPUReasonable)")
	require.NotNil(t, cpuPolicy.TargetTrackingConfiguration)
	require.NotNil(t, cpuPolicy.TargetTrackingConfiguration.PredefinedMetricSpecification)
	assert.Equal(
		t,
		types.MetricTypeASGAverageCPUUtilization,
		cpuPolicy.TargetTrackingConfiguration.PredefinedMetricSpecification.PredefinedMetricType,
	)
	require.NotNil(t, cpuPolicy.TargetTrackingConfiguration.TargetValue)
	assert.Equal(t, float64(50), *cpuPolicy.TargetTrackingConfiguration.TargetValue)
}
