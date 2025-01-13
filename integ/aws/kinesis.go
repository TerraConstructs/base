package aws

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kinesis"
	"github.com/aws/aws-sdk-go-v2/service/kinesis/types"
	"github.com/stretchr/testify/require"

	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/gruntwork-io/terratest/modules/testing"
)

// GetStreamResourcePolicy returns the Kinesis stream resource policy as a JSON string
func GetStreamResourcePolicy(t testing.TestingT, region string, streamArn string) string {
	policy, err := GetStreamResourcePolicyE(t, region, streamArn)
	require.NoError(t, err)
	return *policy
}

// GetStreamResourcePolicy returns the Kinesis stream resource policy as a JSON string or an error
func GetStreamResourcePolicyE(t testing.TestingT, region string, streamArn string) (*string, error) {
	client, err := NewKinesisClientE(t, region)
	if err != nil {
		return nil, err
	}

	result, err := client.GetResourcePolicy(context.Background(), &kinesis.GetResourcePolicyInput{
		ResourceARN: aws.String(streamArn),
	})

	if err != nil {
		return nil, err
	}

	return result.Policy, nil
}

// DescribeStream returns the description of a Kinesis stream.
func DescribeStream(t testing.TestingT, region string, streamName string) *types.StreamDescription {
	result, err := DescribeStreamE(t, region, streamName)
	require.NoError(t, err)
	return result
}

// DescribeStreamE returns the description of a Kinesis stream.
func DescribeStreamE(t testing.TestingT, region string, streamName string) (*types.StreamDescription, error) {
	client, err := NewKinesisClientE(t, region)
	if err != nil {
		return nil, err
	}
	result, err := client.DescribeStream(context.Background(), &kinesis.DescribeStreamInput{
		StreamName: aws.String(streamName),
	})

	if err != nil {
		return nil, err
	}

	return result.StreamDescription, nil
}

// WaitForStreamActive waits for a Kinesis stream to be active.
func WaitForStreamActive(
	t testing.TestingT,
	region string,
	streamName string,
	maxRetries int,
	sleepBetweenRetries time.Duration,
) {
	err := WaitForStreamActiveE(t, region, streamName, maxRetries, sleepBetweenRetries)
	require.NoError(t, err)
}

// WaitForStreamActiveE waits for a Kinesis stream to be active.
func WaitForStreamActiveE(
	t testing.TestingT,
	region string,
	streamName string,
	maxRetries int,
	sleepBetweenRetries time.Duration,
) error {
	return WaitForStreamStatusE(t, region, streamName, types.StreamStatusActive, maxRetries, sleepBetweenRetries)
}

// WaitForStreamStatus waits for a Kinesis stream to have the specified status.
func WaitForStreamStatus(
	t testing.TestingT,
	region string,
	streamName string,
	status types.StreamStatus,
	maxRetries int,
	sleepBetweenRetries time.Duration,
) {
	err := WaitForStreamStatusE(t, region, streamName, status, maxRetries, sleepBetweenRetries)
	require.NoError(t, err)
}

// WaitForStreamStatusE waits for a Kinesis stream to have the specified status.
func WaitForStreamStatusE(
	t testing.TestingT,
	region string,
	streamName string,
	status types.StreamStatus,
	maxRetries int,
	sleepBetweenRetries time.Duration,
) error {
	description := fmt.Sprintf("Waiting for Kinesis Stream %s status: %q", streamName, status)

	msg, err := retry.DoWithRetryE(
		t,
		description,
		maxRetries,
		sleepBetweenRetries,
		func() (string, error) {
			streamDescription, err := DescribeStreamE(t, region, streamName)
			if err != nil {
				return "", err
			}

			if streamDescription.StreamStatus != status {
				return "", fmt.Errorf("stream status is %s, not %s", streamDescription.StreamStatus, status)
			}
			return "Stream is now at desired status", nil
		},
	)
	logger.Log(t, msg)
	return err
}

// NewKinesisClient creates a kinesis client.
func NewKinesisClient(t testing.TestingT, region string) *kinesis.Client {
	client, err := NewKinesisClientE(t, region)
	require.NoError(t, err)
	return client
}

// NewKinesisClientE creates a kinesis client.
func NewKinesisClientE(t testing.TestingT, region string) (*kinesis.Client, error) {
	sess, err := terratestaws.NewAuthenticatedSession(region)
	if err != nil {
		return nil, err
	}

	return kinesis.NewFromConfig(*sess), nil
}
