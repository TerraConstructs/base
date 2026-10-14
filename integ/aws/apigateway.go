package aws

import (
	"context"
	"encoding/json"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/apigateway"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// NewApiGatewayClientE creates a new API Gateway (REST) client.
func NewApiGatewayClientE(t testing.TestingT, region string) (*apigateway.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return apigateway.NewFromConfig(cfg), nil
}

// GetRestApiPolicy returns the resource policy stored on a REST API, as
// returned by the API Gateway service (i.e. after service-side normalization).
//
// API Gateway returns the policy as an escaped JSON string (e.g. `{\"Version\"
// ... \/*\/*}`); this helper unescapes it so callers can inspect plain JSON.
func GetRestApiPolicy(t testing.TestingT, region, restApiId string) string {
	policy, err := GetRestApiPolicyE(t, region, restApiId)
	require.NoError(t, err)
	return policy
}

// GetRestApiPolicyE returns the resource policy stored on a REST API.
func GetRestApiPolicyE(t testing.TestingT, region, restApiId string) (string, error) {
	client, err := NewApiGatewayClientE(t, region)
	if err != nil {
		return "", err
	}
	out, err := client.GetRestApi(context.TODO(), &apigateway.GetRestApiInput{
		RestApiId: aws.String(restApiId),
	})
	if err != nil {
		return "", err
	}
	policy := aws.ToString(out.Policy)
	// The policy is returned as an escaped JSON string (`\"` and `\/`); decode
	// it as a JSON string literal to get the plain policy document.
	var unescaped string
	if err := json.Unmarshal([]byte(`"`+policy+`"`), &unescaped); err == nil {
		policy = unescaped
	}
	return policy, nil
}
