package aws

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
	"github.com/stretchr/testify/require"

	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/testing"
)

// ref: https://github.com/gruntwork-io/terratest/blob/main/modules/aws/kms.go

// GetKmsKey gets the KMS key
func GetKmsKey(t testing.TestingT, region string, cmkID string) *types.KeyMetadata {
	keyMetadata, err := GetKmsKeyE(t, region, cmkID)
	require.NoError(t, err)
	return keyMetadata
}

// GetKmsKeyE gets the metadata for KMS Customer Master Key (CMK) in the given region with the given ID. The ID can be an alias, such as
// as "alias/my-cmk".
func GetKmsKeyE(t testing.TestingT, region string, cmkID string) (*types.KeyMetadata, error) {
	kmsClient, err := terratestaws.NewKmsClientE(t, region)
	if err != nil {
		return nil, err
	}

	result, err := kmsClient.DescribeKey(context.Background(), &kms.DescribeKeyInput{
		KeyId: aws.String(cmkID),
	})

	if err != nil {
		return nil, err
	}

	return result.KeyMetadata, nil
}

// GetKmsKeyPolicy gets the key policy document in JSON format.
func GetKmsKeyPolicy(t testing.TestingT, region string, cmkID string) string {
	keyPolicy, err := GetKmsKeyPolicyE(t, region, cmkID)
	require.NoError(t, err)
	return *keyPolicy
}

// GetKmsKeyPolicyE gets the key policy document in JSON format.
func GetKmsKeyPolicyE(t testing.TestingT, region string, cmkID string) (*string, error) {
	kmsClient, err := terratestaws.NewKmsClientE(t, region)
	if err != nil {
		return nil, err
	}

	result, err := kmsClient.GetKeyPolicy(context.Background(), &kms.GetKeyPolicyInput{
		KeyId: aws.String(cmkID),
	})

	if err != nil {
		return nil, err
	}

	return result.Policy, nil
}

// GetKmsAlias gets the KMS alias or panic if not found.
func GetKmsAlias(t testing.TestingT, region string, aliasName string) types.AliasListEntry {
	alias, err := GetKmsAliasE(t, region, aliasName)
	require.NoError(t, err)
	return *alias
}

// GetKmsAliasE gets the KMS alias
func GetKmsAliasE(t testing.TestingT, region string, aliasName string) (*types.AliasListEntry, error) {
	kmsClient, err := terratestaws.NewKmsClientE(t, region)
	if err != nil {
		return nil, err
	}

	result, err := kmsClient.ListAliases(context.Background(), &kms.ListAliasesInput{})

	if err != nil {
		return nil, err
	}

	for _, alias := range result.Aliases {
		if *alias.AliasName == aliasName {
			return &alias, nil
		}
	}

	return nil, fmt.Errorf("KMS alias not found: %s", aliasName)
}
