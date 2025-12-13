include ../../common.mk

nodejs-function-url: ## Test Node.js function with a function URL
	go test -v -count 1 -timeout 15m ./... -run ^TestNodeJsFunctionUrl$
.PHONY: nodejs-function-url

destinations: ## Test function with destinations
	go test -v -count 1 -timeout 15m ./... -run ^TestDestinations$
.PHONY: destination

lambda-chain: ## Test chain of lambda functions
	go test -v -count 1 -timeout 15m ./... -run ^TestLambdaChain$
.PHONY: lambda-chain

event-source-sqs: ## Test sqs event source with lambda
	go test -v -count 1 -timeout 15m ./... -run ^TestEventSourceSqs$
.PHONY: event-source-sqs

event-source-sqs-filtered: ## Test sqs event source with filter criteria
	go test -v -count 1 -timeout 15m ./... -run ^TestEventSourceSqsFiltered$
.PHONY: event-source-sqs-filtered

event-source-s3: ## Test s3 event source with lambda
	go test -v -count 1 -timeout 15m ./... -run ^TestEventSourceS3$
.PHONY: event-source-sqs

instance: ## Test Compute Instance
	go test -v -count 1 -timeout 15m ./... -run ^TestInstance$
.PHONY: instance

launch-template: ## Test Launch Template
	go test -v -count 1 -timeout 15m ./... -run ^TestLaunchTemplate$
.PHONY: launch-template

instance-public: ## Test Compute Instance with public IP
	go test -v -count 1 -timeout 15m ./... -run ^TestInstancePublic$
.PHONY: instance-public

machine-image: ## Test Machine Image
	go test -v -count 1 -timeout 15m ./... -run ^TestMachineImage$
.PHONY: machine-image

apigw-authorizer: ## Test All API Gateway Authorizer tests (sequential)
	go test -v -count 1 -p 1 -parallel 1 -timeout 15m ./... -run '^TestApigw.*Authorizer.*$$'
.PHONY: apigw-authorizer

apigw-token-authorizer: ## Test API Gateway with Token Authorizer
	go test -v -count 1 -timeout 15m ./... -run ^TestApigwTokenAuthorizer$
.PHONY: apigw-token-authorizer

apigw-token-authorizer-iam-role: ## Test API Gateway with Token Authorizer and IAM Role
	go test -v -count 1 -timeout 15m ./... -run ^TestApigwTokenAuthorizerIamRole$
.PHONY: apigw-token-authorizer-iam-role

apigw-request-authorizer: ## Test API Gateway with Request Authorizer
	go test -v -count 1 -timeout 15m ./... -run ^TestApigwRequestAuthorizer$
.PHONY: apigw-request-authorizer

apigw-lambda: ## Test API Gateway with Lambda Integration
	go test -v -count 1 -timeout 15m ./... -run ^TestApigwLambda$
.PHONY: apigw-lambda

apigw-sfn: ## Test API Gateway with Step Function Integration
	go test -v -count 1 -timeout 15m ./... -run ^TestApigwStepFunctions$
.PHONY: apigw-sfn

apigw-definition-asset: ## Test API Gateway with definition asset
	go test -v -count 1 -timeout 15m ./... -run ^TestApiDefinitionAsset$
.PHONY: apigw-definition-asset

apigw-definition-inline: ## Test API Gateway with inline definition
	go test -v -count 1 -timeout 15m ./... -run ^TestApiDefinitionInline$
.PHONY: apigw-definition-inline
