package aws

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	gruntworkaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/stretchr/testify/require"
)

// GetDynamoDbClientWithRoleE creates a new DynamoDB client that assumes the specified IAM role.
func GetDynamoDbClientWithRoleE(t *testing.T, awsRegion, roleArn string) (*dynamodb.Client, error) {
	cfg, err := gruntworkaws.NewAuthenticatedSessionFromRole(awsRegion, roleArn)
	if err != nil {
		return nil, err
	}
	return dynamodb.NewFromConfig(*cfg), nil
}

// GetDynamoDbClientWithRole creates a new DynamoDB client that assumes the specified IAM role and fails the test if there's an error.
func GetDynamoDbClientWithRole(t *testing.T, awsRegion, roleArn string) *dynamodb.Client {
	client, err := GetDynamoDbClientWithRoleE(t, awsRegion, roleArn)
	require.NoError(t, err)
	return client
}

// PutDynamoDbItemWithRole puts an item into a DynamoDB table using the given client.
// The item is a struct that will be marshalled into a DynamoDB attribute map.
func PutDynamoDbItemWithRole(t *testing.T, client *dynamodb.Client, tableName string, item interface{}) {
	av, err := attributevalue.MarshalMap(item)
	require.NoError(t, err, "Failed to marshal item for DynamoDB")

	_, err = client.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      av,
	})
	require.NoError(t, err, "Failed to put item into table %s", tableName)
}

// A standard test item for use in DynamoDB utility functions.
type dynamoDBTestItem struct {
	Id      string `dynamodbav:"id"`
	Content string `dynamodbav:"content"`
}

// PutTestItem creates a standard test item with the given ID and content and puts it into the specified table.
func PutTestItem(t *testing.T, client *dynamodb.Client, tableName, itemId, itemContent string) {
	item := dynamoDBTestItem{
		Id:      itemId,
		Content: itemContent,
	}
	PutDynamoDbItemWithRole(t, client, tableName, item)
}

// GetTestItem retrieves a standard test item from the specified table and returns it.
func GetTestItem(t *testing.T, client *dynamodb.Client, tableName, partitionKeyName, itemId string) dynamoDBTestItem {
	var retrievedItem dynamoDBTestItem
	key := MakeDynamoDBStringKey(partitionKeyName, itemId)
	GetDynamoDbItemWithRole(t, client, tableName, key, &retrievedItem)
	return retrievedItem
}

// GetDynamoDbItemWithRole gets an item from a DynamoDB table using the given client.
// The result is unmarshalled into the 'out' interface.
func GetDynamoDbItemWithRole(t *testing.T, client *dynamodb.Client, tableName string, key map[string]types.AttributeValue, out interface{}) {
	result, err := client.GetItem(context.Background(), &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key:       key,
	})
	require.NoError(t, err, "Failed to get item from table %s", tableName)
	require.NotEmpty(t, result.Item, "GetItem returned no item")

	err = attributevalue.UnmarshalMap(result.Item, out)
	require.NoError(t, err, "Failed to unmarshal item from DynamoDB")
}

// MakeDynamoDBStringKey creates a simple DynamoDB key map for a single string attribute.
// This is a convenience helper to avoid boilerplate in tests.
func MakeDynamoDBStringKey(keyName, keyValue string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		keyName: &types.AttributeValueMemberS{Value: keyValue},
	}
}
