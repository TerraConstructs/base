package aws

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/applicationautoscaling"
	"github.com/aws/aws-sdk-go-v2/service/applicationautoscaling/types"
	"github.com/stretchr/testify/require"

	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/testing"
)

// GetTableTrackingPolicy gets the target tracking policy for a DynamoDB table or errors if not found
func GetTableTrackingPolicy(t testing.TestingT, awsRegion string, resourceId string) *types.ScalingPolicy {
	policy, err := GetTableTrackingPolicyE(t, awsRegion, resourceId)
	require.NoError(t, err)
	return policy
}

// GetTableTrackingPolicy gets the target tracking policy for a DynamoDB table or returns an error if not found
func GetTableTrackingPolicyE(t testing.TestingT, awsRegion string, resourceId string) (*types.ScalingPolicy, error) {
	policies := GetScalingPolicies(t, awsRegion, "dynamodb")

	var targetTrackingPolicy *types.ScalingPolicy
	for _, policy := range policies {
		if *policy.ResourceId == resourceId &&
			policy.ScalableDimension == types.ScalableDimensionDynamoDBTableReadCapacityUnits &&
			policy.PolicyType == types.PolicyTypeTargetTrackingScaling {
			targetTrackingPolicy = &policy
			break
		}
	}
	if targetTrackingPolicy == nil {
		return nil, fmt.Errorf("no target tracking policy found for resource ID: %s", resourceId)
	}
	return targetTrackingPolicy, nil
}

// GetScalableTargets gets the Application Auto Scaling scalable targets for the given service namespace
func GetScalableTargets(t testing.TestingT, region string, serviceNamespace string) []types.ScalableTarget {
	targets, err := GetScalableTargetsE(t, region, serviceNamespace)
	require.NoError(t, err)
	return targets
}

// GetScalableTargetsE gets the Application Auto Scaling scalable targets for the given service namespace
func GetScalableTargetsE(t testing.TestingT, region string, serviceNamespace string) ([]types.ScalableTarget, error) {
	client, err := NewApplicationAutoScalingClientE(t, region)
	if err != nil {
		return nil, err
	}

	result, err := client.DescribeScalableTargets(context.Background(), &applicationautoscaling.DescribeScalableTargetsInput{
		ServiceNamespace: types.ServiceNamespace(serviceNamespace),
	})

	if err != nil {
		return nil, err
	}

	return result.ScalableTargets, nil
}

// GetScalingPolicies gets the Application Auto Scaling scaling policies for the given service namespace
func GetScalingPolicies(t testing.TestingT, region string, serviceNamespace string) []types.ScalingPolicy {
	policies, err := GetScalingPoliciesE(t, region, serviceNamespace)
	require.NoError(t, err)
	return policies
}

// GetScalingPoliciesE gets the Application Auto Scaling scaling policies for the given service namespace
func GetScalingPoliciesE(t testing.TestingT, region string, serviceNamespace string) ([]types.ScalingPolicy, error) {
	client, err := NewApplicationAutoScalingClientE(t, region)
	if err != nil {
		return nil, err
	}

	result, err := client.DescribeScalingPolicies(context.Background(), &applicationautoscaling.DescribeScalingPoliciesInput{
		ServiceNamespace: types.ServiceNamespace(serviceNamespace),
	})

	if err != nil {
		return nil, err
	}

	return result.ScalingPolicies, nil
}

// GetScheduledActions gets the Application Auto Scaling scheduled actions for the given service namespace
func GetScheduledActions(t testing.TestingT, region string, serviceNamespace string) []types.ScheduledAction {
	actions, err := GetScheduledActionsE(t, region, serviceNamespace)
	require.NoError(t, err)
	return actions
}

// GetScheduledActionsE gets the Application Auto Scaling scheduled actions for the given service namespace
func GetScheduledActionsE(t testing.TestingT, region string, serviceNamespace string) ([]types.ScheduledAction, error) {
	client, err := NewApplicationAutoScalingClientE(t, region)
	if err != nil {
		return nil, err
	}

	result, err := client.DescribeScheduledActions(context.Background(), &applicationautoscaling.DescribeScheduledActionsInput{
		ServiceNamespace: types.ServiceNamespace(serviceNamespace),
	})

	if err != nil {
		return nil, err
	}

	return result.ScheduledActions, nil
}

// GetScalableTargetsByResourceId gets scalable targets filtered by resource ID
func GetScalableTargetsByResourceId(t testing.TestingT, region string, serviceNamespace string, resourceId string) []types.ScalableTarget {
	targets, err := GetScalableTargetsByResourceIdE(t, region, serviceNamespace, resourceId)
	require.NoError(t, err)
	return targets
}

// GetScalableTargetsByResourceIdE gets scalable targets filtered by resource ID
func GetScalableTargetsByResourceIdE(t testing.TestingT, region string, serviceNamespace string, resourceId string) ([]types.ScalableTarget, error) {
	client, err := NewApplicationAutoScalingClientE(t, region)
	if err != nil {
		return nil, err
	}

	result, err := client.DescribeScalableTargets(context.Background(), &applicationautoscaling.DescribeScalableTargetsInput{
		ServiceNamespace: types.ServiceNamespace(serviceNamespace),
		ResourceIds:      []string{resourceId},
	})

	if err != nil {
		return nil, err
	}

	return result.ScalableTargets, nil
}

// GetScheduledActionsByResourceId gets scheduled actions filtered by resource ID
func GetScheduledActionsByResourceId(t testing.TestingT, region string, serviceNamespace string, resourceId string) []types.ScheduledAction {
	actions, err := GetScheduledActionsByResourceIdE(t, region, serviceNamespace, resourceId)
	require.NoError(t, err)
	return actions
}

// GetScheduledActionsByResourceIdE gets scheduled actions filtered by resource ID
func GetScheduledActionsByResourceIdE(t testing.TestingT, region string, serviceNamespace string, resourceId string) ([]types.ScheduledAction, error) {
	client, err := NewApplicationAutoScalingClientE(t, region)
	if err != nil {
		return nil, err
	}

	result, err := client.DescribeScheduledActions(context.Background(), &applicationautoscaling.DescribeScheduledActionsInput{
		ServiceNamespace: types.ServiceNamespace(serviceNamespace),
		ResourceId:       aws.String(resourceId),
	})

	if err != nil {
		return nil, err
	}

	return result.ScheduledActions, nil
}

// NewApplicationAutoScalingClient creates a new Application Auto Scaling client
func NewApplicationAutoScalingClient(t testing.TestingT, region string) *applicationautoscaling.Client {
	client, err := NewApplicationAutoScalingClientE(t, region)
	require.NoError(t, err)
	return client
}

// NewApplicationAutoScalingClientE creates a new Application Auto Scaling client
func NewApplicationAutoScalingClientE(t testing.TestingT, region string) (*applicationautoscaling.Client, error) {
	sess, err := terratestaws.NewAuthenticatedSession(region)
	if err != nil {
		return nil, err
	}
	return applicationautoscaling.NewFromConfig(*sess), nil
}
