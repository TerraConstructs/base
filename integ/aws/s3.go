package aws

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// UploadS3File uploads a file to the given S3 bucket with the given key and body and fails the test if there is any error.
func UploadS3File(t testing.TestingT, awsRegion string, s3BucketName string, key string, body string) {
	err := UploadS3FileE(t, awsRegion, s3BucketName, key, body)
	require.NoError(t, err)
}

// UploadS3FileE uploads a file to the given S3 bucket with the given key and body and returns an error if there is any.
func UploadS3FileE(t testing.TestingT, awsRegion string, s3BucketName string, key string, body string) error {
	logger.Log(t, fmt.Sprintf("Uploading %s files to bucket %s", key, s3BucketName))
	params := &s3.PutObjectInput{
		Bucket: aws.String(s3BucketName),
		Key:    &key,
		Body:   strings.NewReader(body),
	}

	s3Client, err := terratestaws.NewS3ClientE(t, awsRegion)
	if err != nil {
		return err
	}

	_, err = s3Client.PutObject(context.Background(), params)
	return err
}

// AssertS3BucketNotificationExists checks if the given S3 bucket has a notification configuration and returns an error if it does not.
func AssertS3BucketNotificationExists(t testing.TestingT, region string, bucketName string) {
	err := AssertS3BucketNotificationExistsE(t, region, bucketName)
	require.NoError(t, err)
}

// AssertS3BucketVersioningExistsE checks if the given S3 bucket has a notification configuration and returns an error if it does not.
func AssertS3BucketNotificationExistsE(t testing.TestingT, region string, bucketName string) error {
	config, err := GetS3BucketNotificationE(t, region, bucketName)
	if err != nil {
		return err
	}
	// logger.Log(t, fmt.Sprintf("Got notification configuration for bucket %s: %v", bucketName, config))
	if config == nil || (len(config.TopicConfigurations) == 0 &&
		len(config.QueueConfigurations) == 0 &&
		len(config.LambdaFunctionConfigurations) == 0 &&
		config.EventBridgeConfiguration == nil) {
		return NewBucketNotificationNotEnabledError(bucketName, region)
	}
	return nil
}

// GetS3BucketNotificationE fetches the given bucket's notification configuration
func GetS3BucketNotificationE(t testing.TestingT, region string, bucketName string) (*s3.GetBucketNotificationConfigurationOutput, error) {
	s3Client, err := terratestaws.NewS3ClientE(t, region)
	if err != nil {
		return nil, err
	}

	return s3Client.GetBucketNotificationConfiguration(context.Background(), &s3.GetBucketNotificationConfigurationInput{
		Bucket: &bucketName,
	})
}

// GetS3BucketNotificationLambdaConfigurations fetches the given bucket's notification
// configuration and returns its `LambdaFunctionConfigurations` as S3 reports them
// (including each entry's `Id` and key filter), failing the test on any error.
func GetS3BucketNotificationLambdaConfigurations(t testing.TestingT, region string, bucketName string) []s3types.LambdaFunctionConfiguration {
	configs, err := GetS3BucketNotificationLambdaConfigurationsE(t, region, bucketName)
	require.NoError(t, err)
	return configs
}

// GetS3BucketNotificationLambdaConfigurationsE fetches the given bucket's notification
// configuration and returns its `LambdaFunctionConfigurations` as S3 reports them
// (including each entry's `Id` and key filter) - e.g. to assert the Ids a cross-stack
// `Custom::S3BucketNotifications` handler wrote survive another stack's apply.
func GetS3BucketNotificationLambdaConfigurationsE(t testing.TestingT, region string, bucketName string) ([]s3types.LambdaFunctionConfiguration, error) {
	config, err := GetS3BucketNotificationE(t, region, bucketName)
	if err != nil {
		return nil, err
	}
	return config.LambdaFunctionConfigurations, nil
}
