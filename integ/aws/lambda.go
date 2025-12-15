package aws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/lambda"
	"github.com/aws/aws-sdk-go-v2/service/lambda/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// TODO: PR "Event" Invocation Type support to terratest upstream
// ref: https://github.com/gruntwork-io/terratest/pull/817
type InvocationTypeOption string

const (
	InvocationTypeRequestResponse InvocationTypeOption = "RequestResponse"
	InvocationTypeDryRun          InvocationTypeOption = "DryRun"
	InvocationTypeEvent           InvocationTypeOption = "Event"
)

// LambdaOptions contains additional parameters for InvokeFunctionWithParams().
// It contains a subset of the fields found in the lambda.InvokeInput struct.
type LambdaOptions struct {
	// InvocationType can be one of InvocationTypeOption values:
	//    * InvocationTypeRequestResponse (default) - Invoke the function
	//      synchronously.  Keep the connection open until the function
	//      returns a response or times out.
	//    * InvocationTypeDryRun - Validate parameter values and verify
	//      that the user or role has permission to invoke the function.
	//    * InvocationTypeEvent – Invoke the function asynchronously.
	//      Send events that fail multiple times to the function's
	//      dead-letter queue (if one is configured). The API response
	//      only includes a status code.
	InvocationType *InvocationTypeOption

	// Lambda function input; will be converted to JSON.
	Payload interface{}
}

func (itype *InvocationTypeOption) Value() (string, error) {
	if itype != nil {
		switch *itype {
		case
			InvocationTypeRequestResponse,
			InvocationTypeDryRun,
			InvocationTypeEvent:
			return string(*itype), nil
		default:
			msg := fmt.Sprintf("LambdaOptions.InvocationType, if specified, must either be \"%s\", \"%s\" or \"%s\"",
				InvocationTypeRequestResponse,
				InvocationTypeDryRun, InvocationTypeEvent)
			return "", errors.New(msg)
		}
	}
	return string(InvocationTypeRequestResponse), nil
}

// InvokeFunctionSync invokes a lambda function synchronously. Keep the connection open until the function
// returns a response or times out. Checks for failure using "require".
func InvokeFunctionSync(t testing.TestingT, region, functionName string) *terratestaws.LambdaOutput {
	invokeSync := InvocationTypeRequestResponse
	input := LambdaOptions{
		InvocationType: &invokeSync,
		Payload:        nil,
	}
	return InvokeFunctionWithParams(t, region, functionName, &input)
}

// InvokeFunctionSyncE invokes a lambda function synchronously. Keep the connection open until the function
// returns a response or times out. Returns the status code and payload
// in a LambdaOutput struct and the error. A non-nil error will either reflect
// a problem with the parameters supplied to this function or an error returned
// by the Lambda.
func InvokeFunctionSyncE(t testing.TestingT, region, functionName string) (*terratestaws.LambdaOutput, error) {
	invokeSync := InvocationTypeRequestResponse
	input := LambdaOptions{
		InvocationType: &invokeSync,
		Payload:        nil,
	}
	return InvokeFunctionWithParamsE(t, region, functionName, &input)
}

// InvokeFunctionWithParams invokes a lambda function using parameters
// supplied in the LambdaOptions struct and returns values in a LambdaOutput
// struct. Checks for failure using "require".
func InvokeFunctionWithParams(t testing.TestingT, region, functionName string, input *LambdaOptions) *terratestaws.LambdaOutput {
	out, err := InvokeFunctionWithParamsE(t, region, functionName, input)
	if err != nil && out.Payload != nil {
		terratestLogger.Logf(t, "out: %q", string(out.Payload))
	}
	require.NoError(t, err, "Error invoking function %s: %q", functionName, err)
	return out
}

// InvokeFunctionWithParamsE invokes a lambda function using parameters
// supplied in the LambdaOptions struct. Returns the status code and payload
// in a LambdaOutput struct and the error.  A non-nil error will either reflect
// a problem with the parameters supplied to this function or an error returned
// by the Lambda.
func InvokeFunctionWithParamsE(t testing.TestingT, region, functionName string, input *LambdaOptions) (*terratestaws.LambdaOutput, error) {
	lambdaClient, err := terratestaws.NewLambdaClientE(t, region)
	if err != nil {
		return nil, err
	}

	// Verify the InvocationType is one of the allowed values and report
	// an error if it's not.  By default the InvocationType will be
	// "RequestResponse".
	invocationType, err := input.InvocationType.Value()
	if err != nil {
		return nil, err
	}

	invokeInput := &lambda.InvokeInput{
		FunctionName:   &functionName,
		InvocationType: types.InvocationType(invocationType),
	}

	if input.Payload != nil {
		payloadJson, err := json.Marshal(input.Payload)
		if err != nil {
			return nil, err
		}
		invokeInput.Payload = payloadJson
	}

	out, err := lambdaClient.Invoke(context.Background(), invokeInput)
	if err != nil {
		return nil, err
	}

	// As this function supports different invocation types, it must
	// then support different combinations of output other than just
	// payload.
	lambdaOutput := terratestaws.LambdaOutput{
		Payload:    out.Payload,
		StatusCode: out.StatusCode,
	}

	if out.FunctionError != nil {
		return &lambdaOutput, errors.New(*out.FunctionError)
	}

	return &lambdaOutput, nil
}
