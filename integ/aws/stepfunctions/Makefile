include ../../common.mk

all: ## Test all Stepfunctions
	go test -v -timeout 30m ./...
.PHONY: all

call-aws-service: ## Test StateMachine call AWS Service
	go test -v -count 1 -timeout 15m ./... -run ^TestCallAwsService$$
.PHONY: call-aws-service

call-aws-service-sfn: ## Test StateMachine call child State Machine
	go test -v -count 1 -timeout 15m ./... -run ^TestCallAwsServiceSfn$$
.PHONY: call-aws-service-sfn

call-aws-service-mwaa: ## Test StateMachine call to Managed Airflow
	go test -v -count 1 -timeout 15m ./... -run ^TestCallAwsServiceMwaa$$
.PHONY: call-aws-service-mwaa

call-aws-service-logs: ## Test StateMachine call to CloudWatch Logs
	go test -v -count 1 -timeout 15m ./... -run ^TestCallAwsServiceLogs$$
.PHONY: call-aws-service-logs

call-aws-service-mediapackagevod: ## Test StateMachine call to Managed Airflow
	go test -v -count 1 -timeout 15m ./... -run ^TestCallAwsServiceMediapackagevod$$
.PHONY: call-aws-service-mediapackagevod

call-aws-service-efs: ## Test StateMachine call to tag EFS Access Point
	go test -v -count 1 -timeout 15m ./... -run ^TestCallAwsServiceEfs$$
.PHONY: call-aws-service-efs

sqs-send-message: ## Test StateMachine sending sqs message
	go test -v -count 1 -timeout 15m ./... -run ^TestSqsSendMessage$$
.PHONY: sqs-send-message

sfn-invoke-activity: ## Test Job Poller StateMachine with simulated Activity Handler
	go test -v -count 1 -timeout 15m ./... -run ^TestSfnInvokeActivity$$
.PHONY: sfn-invoke-activity

sfn-start-execution: ## Test StateMachine starting other StateMachine
	go test -v -count 1 -timeout 15m ./... -run ^TestSfnStartExecution$$
.PHONY: sfn-start-execution

lambda-invoke-function: ## Test StateMachine with callback Lambda Activity Handler
	go test -v -count 1 -timeout 15m ./... -run ^TestLambdaInvokeFunction$$
.PHONY: lambda-invoke-function

lambda-invoke-payload-only: ## Test StateMachine Invoke lambda with payload response only
	go test -v -count 1 -timeout 15m ./... -run ^TestLambdaInvokePayloadOnly$$
.PHONY: lambda-invoke-payload-only

lambda-invoke: ## Test StateMachine with Lambda Invoke Activity Handlers
	go test -v -count 1 -timeout 15m ./... -run ^TestLambdaInvoke$$
.PHONY: lambda-invoke

eventbridge-put-events: ## Test StateMachine putting events in user Event Bus
	go test -v -count 1 -timeout 15m ./... -run ^TestEventbridgePutEvents$$
.PHONY: eventbridge-put-events
