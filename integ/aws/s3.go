package aws

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
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

	uploader := terratestaws.NewS3Uploader(t, awsRegion)

	_, err := uploader.Upload(context.Background(), params)
	if err != nil {
		return err
	}
	return nil
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

// GetS3BucketNotificationLambdaArns fetches the given bucket's notification
// configuration and returns the set of `LambdaFunctionArn`s currently configured on it -
// e.g. to assert a cross-stack `Custom::S3BucketNotifications` merge (see
// `BucketNotificationsResource`) landed the entries several stacks contributed, and
// only those, without asserting a single stack's exact ordering of the others'.
func GetS3BucketNotificationLambdaArns(t testing.TestingT, region string, bucketName string) map[string]bool {
	config, err := GetS3BucketNotificationE(t, region, bucketName)
	require.NoError(t, err)

	arns := make(map[string]bool, len(config.LambdaFunctionConfigurations))
	for _, c := range config.LambdaFunctionConfigurations {
		if c.LambdaFunctionArn != nil {
			arns[*c.LambdaFunctionArn] = true
		}
	}
	return arns
}
