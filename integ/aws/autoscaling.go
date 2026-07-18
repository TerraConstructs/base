package aws

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/autoscaling"
	"github.com/aws/aws-sdk-go-v2/service/autoscaling/types"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// Naming note: this file covers the EC2 `aws-autoscaling` module (AutoScalingGroup /
// ScheduledAction / target tracking on an ASG). Helper names are prefixed `Asg` to avoid
// colliding with the `aws-application-autoscaling` helpers of the same shape in
// applicationautoscaling.go (GetScalingPolicies, GetScheduledActions, ...).

// NewAsgClientE returns a client for EC2 Auto Scaling in the given region.
func NewAsgClientE(t testing.TestingT, region string) (*autoscaling.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return autoscaling.NewFromConfig(cfg), nil
}

// NewAsgClient returns a client for EC2 Auto Scaling in the given region or fails the test.
func NewAsgClient(t testing.TestingT, region string) *autoscaling.Client {
	client, err := NewAsgClientE(t, region)
	require.NoError(t, err)
	return client
}

// GetAutoScalingGroupE fetches the details of the Auto Scaling group with the given name.
func GetAutoScalingGroupE(t testing.TestingT, region, asgName string) (*types.AutoScalingGroup, error) {
	logger.Log(t, fmt.Sprintf("Describing Auto Scaling group %s in %s", asgName, region))
	client, err := NewAsgClientE(t, region)
	if err != nil {
		return nil, err
	}

	resp, err := client.DescribeAutoScalingGroups(context.Background(), &autoscaling.DescribeAutoScalingGroupsInput{
		AutoScalingGroupNames: []string{asgName},
	})
	if err != nil {
		return nil, err
	}
	if len(resp.AutoScalingGroups) == 0 {
		return nil, fmt.Errorf("no Auto Scaling group found for name %s in %s", asgName, region)
	}
	return &resp.AutoScalingGroups[0], nil
}

// GetAutoScalingGroup fetches the details of the Auto Scaling group or fails the test.
func GetAutoScalingGroup(t testing.TestingT, region, asgName string) *types.AutoScalingGroup {
	group, err := GetAutoScalingGroupE(t, region, asgName)
	require.NoError(t, err)
	return group
}

// GetAsgScheduledActionsE lists the scheduled scaling actions for the given Auto Scaling group.
func GetAsgScheduledActionsE(t testing.TestingT, region, asgName string) ([]types.ScheduledUpdateGroupAction, error) {
	logger.Log(t, fmt.Sprintf("Describing scheduled actions for Auto Scaling group %s in %s", asgName, region))
	client, err := NewAsgClientE(t, region)
	if err != nil {
		return nil, err
	}

	resp, err := client.DescribeScheduledActions(context.Background(), &autoscaling.DescribeScheduledActionsInput{
		AutoScalingGroupName: aws.String(asgName),
	})
	if err != nil {
		return nil, err
	}
	return resp.ScheduledUpdateGroupActions, nil
}

// GetAsgScheduledActions fetches the scheduled scaling actions or fails the test.
func GetAsgScheduledActions(t testing.TestingT, region, asgName string) []types.ScheduledUpdateGroupAction {
	actions, err := GetAsgScheduledActionsE(t, region, asgName)
	require.NoError(t, err)
	return actions
}

// GetAsgScalingPoliciesE lists the scaling policies for the given Auto Scaling group.
func GetAsgScalingPoliciesE(t testing.TestingT, region, asgName string) ([]types.ScalingPolicy, error) {
	logger.Log(t, fmt.Sprintf("Describing scaling policies for Auto Scaling group %s in %s", asgName, region))
	client, err := NewAsgClientE(t, region)
	if err != nil {
		return nil, err
	}

	resp, err := client.DescribePolicies(context.Background(), &autoscaling.DescribePoliciesInput{
		AutoScalingGroupName: aws.String(asgName),
	})
	if err != nil {
		return nil, err
	}
	return resp.ScalingPolicies, nil
}

// GetAsgScalingPolicies fetches the scaling policies or fails the test.
func GetAsgScalingPolicies(t testing.TestingT, region, asgName string) []types.ScalingPolicy {
	policies, err := GetAsgScalingPoliciesE(t, region, asgName)
	require.NoError(t, err)
	return policies
}
