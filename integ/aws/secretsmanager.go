package aws

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager/types"
	"github.com/stretchr/testify/require"

	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/gruntwork-io/terratest/modules/testing"
)

// DescribeSecret describes a Secrets Manager secret or panics if not found.
func DescribeSecret(t testing.TestingT, region, secretID string) *secretsmanager.DescribeSecretOutput {
	output, err := DescribeSecretE(t, region, secretID)
	require.NoError(t, err)
	return output
}

// DescribeSecretE describes a Secrets Manager secret in the given region.
func DescribeSecretE(t testing.TestingT, region, secretID string) (*secretsmanager.DescribeSecretOutput, error) {
	client := terratestaws.NewSecretsManagerClient(t, region)

	return client.DescribeSecret(context.Background(), &secretsmanager.DescribeSecretInput{
		SecretId: &secretID,
	})
}

// GetSecretReplicationStatus returns the replication status entry for the given replica region, or
// an error if the secret has not (yet) been replicated to that region.
func GetSecretReplicationStatusE(t testing.TestingT, region, secretID, replicaRegion string) (*types.ReplicationStatusType, error) {
	output, err := DescribeSecretE(t, region, secretID)
	if err != nil {
		return nil, err
	}

	for _, status := range output.ReplicationStatus {
		if status.Region != nil && *status.Region == replicaRegion {
			return &status, nil
		}
	}

	return nil, fmt.Errorf("secret %s has no replication status for region %s", secretID, replicaRegion)
}

// WaitForSecretReplicationInSync waits until the given secret's replica in replicaRegion reaches the
// "InSync" status, or fails the test if it does not within maxRetries.
func WaitForSecretReplicationInSync(t testing.TestingT, region, secretID, replicaRegion string, maxRetries int, sleepBetweenRetries time.Duration) {
	err := WaitForSecretReplicationInSyncE(t, region, secretID, replicaRegion, maxRetries, sleepBetweenRetries)
	require.NoError(t, err)
}

// WaitForSecretReplicationInSyncE waits until the given secret's replica in replicaRegion reaches the
// "InSync" status.
func WaitForSecretReplicationInSyncE(t testing.TestingT, region, secretID, replicaRegion string, maxRetries int, sleepBetweenRetries time.Duration) error {
	msg, err := retry.DoWithRetryE(
		t,
		fmt.Sprintf("Waiting for secret %s replica in %s to be %s.", secretID, replicaRegion, types.StatusTypeInSync),
		maxRetries,
		sleepBetweenRetries,
		func() (string, error) {
			status, err := GetSecretReplicationStatusE(t, region, secretID, replicaRegion)
			if err != nil {
				return "", err
			}
			if status.Status != types.StatusTypeInSync {
				return "", fmt.Errorf("replica of secret %s in %s has status %s, want %s", secretID, replicaRegion, status.Status, types.StatusTypeInSync)
			}
			return fmt.Sprintf("Replica of secret %s in %s is now %s", secretID, replicaRegion, types.StatusTypeInSync), nil
		},
	)
	logger.Log(t, msg)
	return err
}
