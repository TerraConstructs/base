package test

import (
	"encoding/json"
	"fmt"
	"net/url"
	"testing"
	"time"

	http_helper "github.com/gruntwork-io/terratest/modules/http-helper"
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/require"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the apigw.token-authorizer app
func TestApigwTokenAuthorizer(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "apigw.token-authorizer", options, func(t *testing.T, tfWorkingDir, awsRegion string) {
		// Optionally force re-deployment of the API Gateway to ensure the latest changes
		// are applied. (no longer needed)
		// util.ReplaceTerraformResource(t, tfWorkingDir, "aws_api_gateway_deployment", "")

		terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
		apiUrl := util.LoadOutputAttribute(t, terraformOptions, "api", "url")
		assertApiResponses(t, apiUrl, []apiTestCase{
			{
				// GET, without Authorization header
				expectedStatusCode: 401,
				expectedResponse:   "Unauthorized",
			},
			{
				authHeader:         "allow",
				expectedStatusCode: 200,
			},
			{
				method:             "OPTIONS",
				expectedStatusCode: 204,
			},
			{
				authHeader:         "deny",
				expectedStatusCode: 403,
				// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/@aws-cdk-testing/framework-integ/test/aws-apigateway/test/authorizers/integ.token-authorizer.ts#L117
				expectedResponse: "User is not authorized to access this resource with an explicit deny",
			},
		})
	})
}

// Test the apigw.token-authorizer-iam-role app
func TestApigwTokenAuthorizerIamRole(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "apigw.token-authorizer-iam-role", options, func(t *testing.T, tfWorkingDir, awsRegion string) {
		terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
		apiUrl := util.LoadOutputAttribute(t, terraformOptions, "api", "url")
		assertApiResponses(t, apiUrl, []apiTestCase{
			{
				// GET, without Authorization header
				expectedStatusCode: 401,
				expectedResponse:   "Unauthorized",
			},
			{
				authHeader:         "allow",
				expectedStatusCode: 200,
			},
			{
				authHeader:         "deny",
				expectedStatusCode: 403,
				// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/@aws-cdk-testing/framework-integ/test/aws-apigateway/test/authorizers/integ.token-authorizer.ts#L117
				expectedResponse: "User is not authorized to access this resource with an explicit deny",
			},
		})
	})
}

// Test the apigw.request-authorizer app
func TestApigwRequestAuthorizer(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "apigw.request-authorizer", options, func(t *testing.T, tfWorkingDir, awsRegion string) {
		terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
		apiUrl := util.LoadOutputAttribute(t, terraformOptions, "api", "url")
		assertApiResponses(t, apiUrl, []apiTestCase{
			{
				// GET, without Authorization header
				expectedStatusCode: 401,
				expectedResponse:   "Unauthorized",
			},
			{
				authHeader:         "allow",
				expectedStatusCode: 200,
				queryParams:        url.Values{"allow": {"yes"}},
			},
			{
				authHeader:         "deny",
				expectedStatusCode: 403,
				queryParams:        url.Values{"allow": {"yes"}},
			},
		})
	})
}

func TestApigwLambda(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "apigw.lambda", options, func(t *testing.T, tfWorkingDir, awsRegion string) {
		terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
		apiUrl := util.LoadOutputAttribute(t, terraformOptions, "api", "url")
		assertApiResponses(t, apiUrl, []apiTestCase{
			{
				// GET should return 200 with JSON body {"message":"Hello"}
				expectedStatusCode: 200,
				expectedResponse:   `"message":"Hello"`,
			},
		})
	})
}

func TestApigwStepFunctions(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "apigw.stepfunctions", options, func(t *testing.T, tfWorkingDir, awsRegion string) {
		terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
		apiUrl := util.LoadOutputAttribute(t, terraformOptions, "api", "url")
		assertApiResponses(t, apiUrl, []apiTestCase{
			{
				body:               map[string]string{"key": "Hello"},
				expectedStatusCode: 200,
				expectedResponse:   "Hello",
			},
		})
	})
}

func TestApiDefinitionAsset(t *testing.T) {
	options := integrationTestOptions{
		Region:           region,
		AdditionalAssets: []string{"sample-definition.yaml"},
	}
	runComputeIntegrationTest(t, "apigw.definition-asset", options, func(t *testing.T, tfWorkingDir, awsRegion string) {
		terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
		// Test individual endpoint URLs from TerraformOutputs
		outputs := terraform.OutputAll(t, terraformOptions)

		petsUrl := outputs["PetsURL"].(string)
		assertApiResponses(t, petsUrl, []apiTestCase{
			{
				expectedStatusCode: 200,
			},
		})

		booksUrl := outputs["BooksURL"].(string)
		assertApiResponses(t, booksUrl, []apiTestCase{
			{
				expectedStatusCode: 200,
			},
		})
	})
}

func TestApiDefinitionInline(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "apigw.definition-inline", options, func(t *testing.T, tfWorkingDir, awsRegion string) {
		terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
		// Test individual endpoint URLs from TerraformOutputs
		outputs := terraform.OutputAll(t, terraformOptions)

		petsUrl := outputs["PetsURL"].(string)
		assertApiResponses(t, petsUrl, []apiTestCase{
			{
				expectedStatusCode: 200,
			},
		})
	})
}

// func TestApigwGrantExecute(t *testing.T) {
// 	runComputeIntegrationTest(t, "apigw.grant-execute", region, func(t *testing.T, tfWorkingDir, awsRegion string) {}

// apiTestCase defines a test case for the API Gateway
type apiTestCase struct {
	testName           string     // Name of the test case, used for test identification
	method             string     // HTTP method to use for the request
	body               any        // Data to send in the body of POST/PUT requests
	authHeader         string     // Value for the Authorization header, if any
	expectedStatusCode int        // Expected HTTP status code from the response
	expectedResponse   string     // Expected substring in the response body
	queryParams        url.Values // Query parameters to include in the request
}

// assertApiResponses executes a series of test cases against the API Gateway
// It performs HTTP requests to the API Gateway and checks the responses.
// It retries each request up to 5 times with a 15-second timeout for each attempt
func assertApiResponses(t *testing.T, apiUrl string, testCases []apiTestCase) {
	for _, tc := range testCases {
		tc := tc // capture range variable
		headers := map[string]string{}
		method := tc.method
		var bodyBytes []byte
		if tc.body != nil {
			if method == "" {
				method = "POST" // Use POST if body is provided
			} else if method != "POST" && method != "PUT" {
				t.Fatalf("body is only supported for POST or PUT requests, got %s", method)
			}
			var err error
			bodyBytes, err = json.Marshal(tc.body)
			require.NoError(t, err, "Failed to marshal body to JSON")
			// ensure Content-Type is set for JSON body
			headers["Content-Type"] = "application/json"
		}
		if method == "" {
			method = "GET" // Default to GET if no method is specified
		}
		testName := method
		if tc.authHeader != "" {
			testName += "_auth_" + tc.authHeader
		}
		testName += fmt.Sprintf("_expect_%d", tc.expectedStatusCode)

		testUrl := apiUrl
		if tc.queryParams != nil {
			testUrl += "?" + tc.queryParams.Encode()
			testName += "_query_" + tc.queryParams.Encode()
		}

		// If a specific test name is provided, use it
		if tc.testName != "" {
			testName = tc.testName
		}
		t.Run(testName, func(t *testing.T) {
			if tc.authHeader != "" {
				headers["Authorization"] = tc.authHeader
			}
			respBody := http_helper.HTTPDoWithRetry(t,
				method, testUrl, bodyBytes, headers, tc.expectedStatusCode, 5, time.Second*15, nil)
			if tc.expectedResponse != "" {
				require.Contains(t, respBody, tc.expectedResponse,
					"Expected response body to contain %q, got: %s", tc.expectedResponse, respBody)
			}
		})
	}
}
