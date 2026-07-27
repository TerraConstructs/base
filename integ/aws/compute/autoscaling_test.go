package test

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/autoscaling/types"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/go-synth/executors"

	"github.com/gruntwork-io/terratest/modules/retry"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the autoscaling.custom-scaling app
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-autoscaling/test/integ.custom-scaling.ts
//
// KNOWN FLAKE - https://github.com/TerraConstructs/base/issues/127
// The app creates four scheduled actions on one Auto Scaling group, none of
// which set `startTime`. Terraform creates them concurrently and AWS rejects
// concurrent PutScheduledUpdateGroupAction calls on the same group with
// `AlreadyExists: Scheduled action with this scheduled start time already
// exists`, failing a different action each run.
//
// The retryable error below lets terratest re-run the apply: the actions that
// did get created are already in state, so the retry creates the remaining one
// on its own and no longer races. A serialized apply
// (`tofu apply -parallelism=1`) also creates all four cleanly, which is the
// manual workaround. Both are stopgaps until the construct serializes them.
func TestAutoscalingCustomScaling(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
		AdditionalRetryableErrors: map[string]string{
			// https://github.com/TerraConstructs/base/issues/127
			".*Scheduled action with this scheduled start time already exists.*": "Concurrent PutScheduledUpdateGroupAction calls on one Auto Scaling group conflict.",
		},
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

	// Validate that Tags.of() reached the `aws_autoscaling_group` `tag` blocks and
	// that `applyToLaunchedInstances` controlled propagate-at-launch per tag.
	asgTags := make(map[string]types.TagDescription, len(group.Tags))
	for _, tag := range group.Tags {
		require.NotNil(t, tag.Key)
		asgTags[*tag.Key] = tag
	}

	for key, expected := range map[string]struct {
		value             string
		propagateAtLaunch bool
	}{
		// generated-launch-template path tags the group with its construct path
		"Name":      {value: "autoscaling.custom-scaling/Fleet", propagateAtLaunch: true},
		"superfood": {value: "acai", propagateAtLaunch: true},
		"notsuper":  {value: "caramel", propagateAtLaunch: false},
	} {
		tag, ok := asgTags[key]
		require.True(t, ok, "expected the Auto Scaling group to carry the %q tag", key)
		require.NotNil(t, tag.Value)
		assert.Equal(t, expected.value, *tag.Value, "unexpected value for tag %q", key)
		require.NotNil(t, tag.PropagateAtLaunch)
		assert.Equal(t, expected.propagateAtLaunch, *tag.PropagateAtLaunch, "unexpected propagate at launch for tag %q", key)
	}

	// The instance launched by the group must carry the propagating tags and NOT
	// the one opted out. Deviation from AWS CDK v2.233.0: upstream also renders
	// every tag into the generated launch template's TagSpecifications, which
	// would put `notsuper` back on the instance despite PropagateAtLaunch=false.
	require.NotEmpty(t, group.Instances, "expected the Auto Scaling group to have launched an instance")
	require.NotNil(t, group.Instances[0].InstanceId)
	instance := util.GetEc2InstanceDetails(t, awsRegion, *group.Instances[0].InstanceId)

	instanceTags := make(map[string]string, len(instance.Tags))
	for _, tag := range instance.Tags {
		require.NotNil(t, tag.Key)
		require.NotNil(t, tag.Value)
		instanceTags[*tag.Key] = *tag.Value
	}
	assert.Equal(t, "acai", instanceTags["superfood"], "expected the propagating tag on the launched instance")
	assert.NotContains(t, instanceTags, "notsuper", "expected applyToLaunchedInstances: false to keep the tag off the launched instance")

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

// Test the autoscaling.update-policy app
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-autoscaling/test/integ.asg-update-policy.ts
//
// Structural port of the upstream update-policy fixture. Upstream deploys an
// AutoScalingGroup with `UpdatePolicy.rollingUpdate()`, a CloudFormation-driven
// replacement CloudFormation performs itself; this port configures
// `UpdatePolicy.instanceRefresh()` instead, which is the only update policy the
// `aws_autoscaling_group` resource can back (see the deviation note on
// CommonAutoScalingGroupProps).
//
// https://github.com/TerraConstructs/base/issues/129 - the whole point of the
// policy is that a launch template change reaches the instances already running,
// so validation deploys, changes the launch template, applies again, and checks
// that EC2 Auto Scaling actually started a refresh.
func TestAutoscalingUpdatePolicy(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "autoscaling.update-policy", options, validateAutoscalingUpdatePolicy)
}

func validateAutoscalingUpdatePolicy(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	asgName := util.LoadOutputAttribute(t, opts, "asg", "autoScalingGroupName")

	// (a) The freshly deployed group runs its single instance off a launch
	// template. `instance_refresh` is not an Auto Scaling API attribute - it only
	// tells the provider what to do on a subsequent apply - so there is nothing to
	// assert about it on the group itself yet, and no refresh has run.
	group := util.GetAutoScalingGroup(t, awsRegion, asgName)
	require.NotNil(t, group.DesiredCapacity)
	assert.Equal(t, int32(1), *group.DesiredCapacity)
	require.NotNil(t, group.LaunchTemplate, "expected the group to launch from a launch template")

	require.Empty(t,
		util.GetAsgInstanceRefreshes(t, awsRegion, asgName),
		"expected no instance refresh before the launch template changes",
	)

	// (b) Change the launch template and apply again.
	//
	// This second synth+apply lives inside the validate stage rather than in stages
	// of its own so the `%-synth-only` / `%-validate-only` make targets (which only
	// know the four standard stage names) keep behaving sensibly.
	envVars := executors.EnvMap(os.Environ())
	envVars["AWS_REGION"] = awsRegion
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = "autoscaling.update-policy"
	envVars["LAUNCH_TEMPLATE_REVISION"] = "v2"

	util.SynthApp(t, "autoscaling.update-policy", tfWorkingDir, envVars, "handlers")
	util.DeployUsingTerraform(t, tfWorkingDir, nil)

	// (c) The apply hands the rollout to EC2 Auto Scaling and returns without
	// waiting for it, so poll until the refresh shows up.
	refresh, err := retry.DoWithRetryInterfaceE(
		t,
		fmt.Sprintf("Waiting for an instance refresh on Auto Scaling group %s", asgName),
		30, // 30 * 10s = 5 minutes
		10*time.Second,
		func() (interface{}, error) {
			refreshes := util.GetAsgInstanceRefreshes(t, awsRegion, asgName)
			if len(refreshes) == 0 {
				return nil, fmt.Errorf(
					"Auto Scaling group %s has no instance refresh after the launch template changed",
					asgName,
				)
			}
			return refreshes[0], nil
		},
	)
	require.NoError(t, err)

	instanceRefresh := refresh.(types.InstanceRefresh)
	assert.NotContains(t,
		[]types.InstanceRefreshStatus{
			types.InstanceRefreshStatusFailed,
			types.InstanceRefreshStatusCancelled,
			types.InstanceRefreshStatusCancelling,
			types.InstanceRefreshStatusRollbackInProgress,
			types.InstanceRefreshStatusRollbackFailed,
			types.InstanceRefreshStatusRollbackSuccessful,
		},
		instanceRefresh.Status,
		"instance refresh went wrong: %v", instanceRefresh.StatusReason,
	)

	// The preferences configured through `UpdatePolicy.instanceRefresh()` must have
	// reached the StartInstanceRefresh call, not just the Terraform config.
	require.NotNil(t, instanceRefresh.Preferences)
	require.NotNil(t, instanceRefresh.Preferences.MinHealthyPercentage)
	assert.Equal(t, int32(0), *instanceRefresh.Preferences.MinHealthyPercentage)
	require.NotNil(t, instanceRefresh.Preferences.MaxHealthyPercentage)
	assert.Equal(t, int32(100), *instanceRefresh.Preferences.MaxHealthyPercentage)
	require.NotNil(t, instanceRefresh.Preferences.InstanceWarmup)
	assert.Equal(t, int32(0), *instanceRefresh.Preferences.InstanceWarmup)
}
