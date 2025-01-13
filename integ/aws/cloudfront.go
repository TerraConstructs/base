package aws

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudfront"
	"github.com/aws/aws-sdk-go-v2/service/cloudfront/types"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/hashicorp/go-multierror"
	"github.com/stretchr/testify/require"
)

type CloudFrontTestFunctionResult struct {
	Utilization  int // The amount of time that the function took to run as a percentage of the maximum allowed time.
	ErrorMessage *string
	// The event object returned by the function. For more information about the
	// structure of the event object, see [Event object structure]in the Amazon CloudFront Developer Guide.
	//
	// [Event object structure]: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html
	Output map[string]interface{}
	// Contains the log lines that the function wrote (if any) when running the test.
	ExecutionLogs []string
}

const invalidFunctionErrorPrefix = "The CloudFront function associated with the CloudFront distribution is invalid or could not run. Error: "

// responseValidator is a function that validates the response of a CloudFront function test.
type responseValidator func(*CloudFrontTestFunctionResult) error

// Tests a CloudFront function.
//
// To test a function, you provide an event object that represents an HTTP request
// or response that your CloudFront distribution could receive in production.
// CloudFront runs the function, passing it the event object that you provided, and
// returns the function's result (the modified event object) in the response. The
// response also contains function logs and error messages, if any exist. For more
// information about testing functions, see [Testing functions]in the Amazon CloudFront Developer
// Guide.
//
// To test a function, you provide the function's name and stage (DEVELOPMENT or LIVE)
// along with the event object. To get the function's name and version, you can use
// ListFunctions and DescribeFunction.
//
// [Testing functions]: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/managing-functions.html#test-function
func TestCloudFrontFunction(t testing.TestingT, name string, stage string, event CloudFrontFunctionEvent, expectedError string, expectedOutput *map[string]interface{}) error {
	validateResponse := responseValidator(func(r *CloudFrontTestFunctionResult) error {
		var combinedErr error
		gotError := aws.ToString(r.ErrorMessage)
		if gotError != expectedError {
			combinedErr = multierror.Append(combinedErr, fmt.Errorf("got Error :%s\nWant Error:%s", gotError, expectedError))
		}

		if expectedOutput != nil {
			expectedOutputBytes, _ := json.MarshalIndent(r.Output, "", "  ")
			if r.Output == nil {
				combinedErr = multierror.Append(combinedErr, fmt.Errorf("got nil Output\nWant Output:%v", string(expectedOutputBytes)))
			} else {
				prettyPrint, err := PrettyPrintBeforeAfter(r.Output, *expectedOutput)
				if err != nil {
					combinedErr = multierror.Append(combinedErr, fmt.Errorf("error matching expected Output:%v", err))
				}
				if prettyPrint != "" {
					combinedErr = multierror.Append(combinedErr, fmt.Errorf("expected Output mismatch (-got, +want):%s", prettyPrint))
				}
			}
		} else {
			if r.Output != nil {
				outputBytes, _ := json.MarshalIndent(r.Output, "", "  ")
				combinedErr = multierror.Append(combinedErr, fmt.Errorf("got Output:%v\nWant nil Output", string(outputBytes)))
			}
		}
		return combinedErr
	})
	return TestCloudFrontFunctionWithCustomValidation(t, name, stage, event, validateResponse)
}

// TestCloudFrontFunctionWithCustomValidation performs a Function test and validate the response. Fails the test if there is an error.
func TestCloudFrontFunctionWithCustomValidation(t testing.TestingT, name string, stage string, event CloudFrontFunctionEvent, validateResponse responseValidator) error {
	functionStage := assertFunctionStage(t, stage)
	err := TestCloudFrontFunctionWithCustomValidationE(t, name, functionStage, event, validateResponse)
	require.NoError(t, err)
	return nil
}

// TestCloudFrontFunctionWithCustomValidationE performs a Function test and validate the response.
func TestCloudFrontFunctionWithCustomValidationE(t testing.TestingT, name string, stage types.FunctionStage, event CloudFrontFunctionEvent, validateResponse responseValidator) error {
	response, err := TestCloudFrontFunctionE(t, name, stage, event)
	if err != nil {
		return err
	}
	// log utilization for information purposes
	logger.Log(t, fmt.Sprintf("CloudFront Function Utilization: (%d%%)", response.Utilization))
	if err := validateResponse(response); err != nil {
		return CloudFrontFunctionValidationFailed{
			FunctionName: name + ":" + string(stage),
			Failures:     err,
		}
	}
	return nil
}

// TestCloudFrontFunctionE performs a Function test and validates the response.
func TestCloudFrontFunctionE(t testing.TestingT, name string, stage types.FunctionStage, event CloudFrontFunctionEvent) (*CloudFrontTestFunctionResult, error) {
	ctx := context.TODO()

	jsonData, err := json.Marshal(event)
	if err != nil {
		return nil, fmt.Errorf("error serializing CloudFront Function Event: %q", err)
	}

	client := NewCloudFrontclient(t)
	functionDetails, err := client.DescribeFunction(ctx, &cloudfront.DescribeFunctionInput{
		Name:  aws.String(name),
		Stage: stage,
	})
	if err != nil {
		return nil, err
	}

	r, err := client.TestFunction(ctx, &cloudfront.TestFunctionInput{
		EventObject: jsonData,
		IfMatch:     functionDetails.ETag,
		Name:        aws.String(name),
		Stage:       stage,
	})
	if err != nil {
		return nil, err
	}

	return parseTestResult(r.TestResult)
}

// WaitForDistributionDeployed waits for a CloudFront distribution to be deployed.
func WaitForDistributionDeployed(t testing.TestingT, region string, distributionId string, maxRetries int, sleepBetweenRetries time.Duration) {
	WaitForDistributionStatus(t, region, distributionId, "Deployed", maxRetries, sleepBetweenRetries)
}

// WaitForDistributionStatus waits for a CloudFront distribution to have the specified status.
func WaitForDistributionStatus(
	t testing.TestingT,
	region string,
	distributionId string,
	status string,
	maxRetries int,
	sleepBetweenRetries time.Duration,
) {
	err := WaitForDistributionStatusE(t, region, distributionId, status, maxRetries, sleepBetweenRetries)
	require.NoError(t, err)
}

// WaitForDistributionStatusE waits for a CloudFront distribution to have the specified status.
func WaitForDistributionStatusE(
	t testing.TestingT,
	region string,
	distributionId string,
	status string,
	maxRetries int,
	sleepBetweenRetries time.Duration,
) error {
	description := fmt.Sprintf("Waiting for CloudFront Distribution %s status: %q", distributionId, status)

	msg, err := retry.DoWithRetryE(
		t,
		description,
		maxRetries,
		sleepBetweenRetries,
		func() (string, error) {
			distribution, err := GetDistributionE(t, region, distributionId)
			if err != nil {
				return "", err
			}

			if *distribution.Status != status {
				return "", fmt.Errorf("stream status is %s, not %s", *distribution.Status, status)
			}
			return "Distribution is now at desired status", nil
		},
	)
	logger.Log(t, msg)
	return err
}

// GetDistributionE returns the configuration of a CloudFront Distribution
func GetDistributionE(t testing.TestingT, region string, distributionId string) (*types.Distribution, error) {
	client, err := NewCloudFrontclientE(t)
	if err != nil {
		return nil, err
	}
	result, err := client.GetDistribution(context.Background(), &cloudfront.GetDistributionInput{
		Id: aws.String(distributionId),
	})

	if err != nil {
		return nil, err
	}

	return result.Distribution, nil
}

// NewCloudFrontclient returns a client for CloudFront. This will fail the test and
// stop execution if there is an error.
func NewCloudFrontclient(t testing.TestingT) *cloudfront.Client {
	sess, err := NewCloudFrontclientE(t)
	require.NoError(t, err)
	return sess
}

// NewCloudFrontclientE returns a client for CloudFront.
func NewCloudFrontclientE(t testing.TestingT) (*cloudfront.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion("us-east-1"))
	if err != nil {
		return nil, err
	}
	return cloudfront.NewFromConfig(cfg), nil
}

// assertFunctionStage validates the function stage or fails the test.
func assertFunctionStage(t testing.TestingT, stage string) types.FunctionStage {
	var functionStage types.FunctionStage
	switch stage {
	case string(types.FunctionStageDevelopment):
		functionStage = types.FunctionStageDevelopment
	case string(types.FunctionStageLive):
		functionStage = types.FunctionStageLive
	default:
		t.Errorf("Invalid function stage: %s", stage)
		return types.FunctionStageDevelopment
	}
	return functionStage
}

func parseTestResult(testResult *types.TestResult) (*CloudFrontTestFunctionResult, error) {
	result := CloudFrontTestFunctionResult{
		ExecutionLogs: testResult.FunctionExecutionLogs,
	}
	var err error

	if aws.ToString(testResult.FunctionErrorMessage) != "" {
		result.ErrorMessage = aws.String(invalidFunctionErrorPrefix + *testResult.FunctionErrorMessage)
	}

	if testResult.ComputeUtilization != nil {
		result.Utilization, err = strconv.Atoi(aws.ToString(testResult.ComputeUtilization))
		if err != nil {
			return &result, err
		}
	}
	var output interface{}
	if testResult.FunctionOutput != nil {
		err := json.Unmarshal([]byte(*testResult.FunctionOutput), &output)
		if err != nil {
			return &result, fmt.Errorf("JSON decode error: %w", err)
		}
	}
	result.Output = make(map[string]interface{})
	if output != nil {
		outputMap, ok := output.(map[string]interface{})
		if ok {
			if len(outputMap) != 0 {
				result.Output = outputMap
			}
		}
	}
	return &result, nil
}
