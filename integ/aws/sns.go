package aws

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/aws/aws-sdk-go-v2/service/sns/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// GetSubscriptionAttributesE fetches the attributes for a subscription ARN using Terratest SNS client.
func GetSubscriptionAttributesE(t testing.TestingT, region, subArn string) (map[string]string, error) {
	logger.Log(t, fmt.Sprintf("Describing SNS subscription %s in %s", subArn, region))
	client, err := terratestaws.NewSnsClientE(t, region)
	if err != nil {
		return nil, err
	}
	out, err := client.GetSubscriptionAttributes(context.Background(), &sns.GetSubscriptionAttributesInput{
		SubscriptionArn: aws.String(subArn),
	})
	if err != nil {
		return nil, err
	}
	return out.Attributes, nil
}

// PublishMessageE publishes a message to an SNS topic with attributes, using Terratest SNS client.
func PublishMessageE(t testing.TestingT, region, topicArn, body string, attrs map[string]types.MessageAttributeValue) error {
	logger.Log(t, fmt.Sprintf("Publishing to SNS %s in %s", topicArn, region))
	client := terratestaws.NewSnsClient(t, region)
	_, err := client.Publish(context.Background(), &sns.PublishInput{
		TopicArn:          aws.String(topicArn),
		Message:           aws.String(body),
		MessageAttributes: attrs,
	})
	return err
}

// PublishMessage publishes a message to an SNS Topic, failing the test on error.
func PublishMessage(t testing.TestingT, region, topicArn, body string, attrs map[string]types.MessageAttributeValue) {
	err := PublishMessageE(t, region, topicArn, body, attrs)
	require.NoError(t, err)
}

// ParseFilterPolicy parses a FilterPolicy JSON string into a map for assertions.
func ParseFilterPolicy(raw string) (map[string]interface{}, error) {
	var out map[string]interface{}
	err := json.Unmarshal([]byte(raw), &out)
	return out, err
}
