package aws

import (
	"context"

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

// NewEventBridgeClient creates an RDS client.
func NewEventBridgeClient(t testing.TestingT, region string) *eventbridge.Client {
	client, err := NewEventBridgeClientE(t, region)
	require.NoError(t, err)
	return client
}

// NewEventBridgeClientE creates an RDS client.
func NewEventBridgeClientE(t testing.TestingT, region string) (*eventbridge.Client, error) {
	sess, err := terratestaws.NewAuthenticatedSession(region)
	if err != nil {
		return nil, err
	}

	return eventbridge.NewFromConfig(*sess), nil
}
