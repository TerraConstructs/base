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
