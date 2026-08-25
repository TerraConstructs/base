package aws

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
	"github.com/stretchr/testify/require"

	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/testing"
)

// PutEvents sends custom events to Amazon EventBridge so that they can be matched to rules.
func PutEvents(t testing.TestingT, region string, entries []types.PutEventsRequestEntry) {
	err := PutEventsE(t, region, entries)
	require.NoError(t, err)
}

// PutEventsE sends custom events to Amazon EventBridge so that they can be matched to rules.
func PutEventsE(t testing.TestingT, region string, entries []types.PutEventsRequestEntry) error {
	client, err := NewEventBridgeClientE(t, region)
	if err != nil {
		return err
	}

	_, err = client.PutEvents(context.Background(), &eventbridge.PutEventsInput{
		Entries: entries,
	})
	return err
}

// DescribeEventBridgeRule returns the details of the specified rule on the given event bus.
func DescribeEventBridgeRule(t testing.TestingT, region string, ruleName string, eventBusName string) *types.Rule {
	out, err := DescribeEventBridgeRuleE(t, region, ruleName, eventBusName)
	require.NoError(t, err)
	return out
}

// DescribeEventBridgeRuleE returns the details of the specified rule on the given event bus.
func DescribeEventBridgeRuleE(t testing.TestingT, region string, ruleName string, eventBusName string) (*types.Rule, error) {
	client, err := NewEventBridgeClientE(t, region)
	if err != nil {
		return nil, err
	}

	output, err := client.DescribeRule(context.Background(), &eventbridge.DescribeRuleInput{
		Name:         aws.String(ruleName),
		EventBusName: aws.String(eventBusName),
	})

	if err != nil {
		return nil, err
	}

	// Convert DescribeRuleOutput to Rule type
	rule := &types.Rule{
		Name:               output.Name,
		Arn:                output.Arn,
		EventPattern:       output.EventPattern,
		State:              output.State,
		Description:        output.Description,
		ScheduleExpression: output.ScheduleExpression,
		RoleArn:            output.RoleArn,
		ManagedBy:          output.ManagedBy,
		EventBusName:       output.EventBusName,
	}

	return rule, nil
}

// ListEventBridgeTargets lists the targets registered to the specified rule.
func ListEventBridgeTargets(t testing.TestingT, region string, ruleName string, eventBusName string) []types.Target {
	targets, err := ListEventBridgeTargetsE(t, region, ruleName, eventBusName)
	require.NoError(t, err)
	return targets
}

// ListEventBridgeTargetsE lists the targets registered to the specified rule.
func ListEventBridgeTargetsE(t testing.TestingT, region string, ruleName string, eventBusName string) ([]types.Target, error) {
	client, err := NewEventBridgeClientE(t, region)
	if err != nil {
		return nil, err
	}

	output, err := client.ListTargetsByRule(context.Background(), &eventbridge.ListTargetsByRuleInput{
		Rule:         aws.String(ruleName),
		EventBusName: aws.String(eventBusName),
	})

	if err != nil {
		return nil, err
	}

	return output.Targets, nil
}

// NewEventBridgeClient creates an EventBridge client.
func NewEventBridgeClient(t testing.TestingT, region string) *eventbridge.Client {
	client, err := NewEventBridgeClientE(t, region)
	require.NoError(t, err)
	return client
}

// NewEventBridgeClientE creates an EventBridge client.
func NewEventBridgeClientE(t testing.TestingT, region string) (*eventbridge.Client, error) {
	sess, err := terratestaws.NewAuthenticatedSession(region)
	if err != nil {
		return nil, err
	}

	return eventbridge.NewFromConfig(*sess), nil
}
