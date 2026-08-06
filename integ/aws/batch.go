package aws

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/batch"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// NewBatchClientE returns a client for AWS Batch in the given region.
func NewBatchClientE(t testing.TestingT, region string) (*batch.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return batch.NewFromConfig(cfg), nil
}

// NewBatchClient returns a client for AWS Batch in the given region or fails the test.
func NewBatchClient(t testing.TestingT, region string) *batch.Client {
	client, err := NewBatchClientE(t, region)
	require.NoError(t, err)
	return client
}
