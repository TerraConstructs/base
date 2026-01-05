include ../../common.mk

all: ## Test all Notify integrations
	go test -v -timeout 30m ./...
.PHONY: all

queue: ## Test Queue semantics
	go test -v -timeout 30m ./... -run ^TestQueue$
.PHONY: fifo-queue

source-queue-permission: ## Test Queue with SourceQueue Permissions
	go test -v -timeout 30m ./... -run ^TestSourceQueuePermission$
.PHONY: fifo-queue

fifo-queue: ## Test Queue with FIFO semantics
	go test -v -timeout 30m ./... -run ^TestFifoQueue$
.PHONY: fifo-queue

dlq-queue: ## Test DLQ Queue
	go test -v -timeout 30m ./... -run ^TestDlqQueue$
.PHONY: dlq-queue

stream: ## Test Kinesis Data Stream
	go test -v -timeout 30m ./... -run ^TestStream$
.PHONY: stream

stream-dashboard: ## Test Kinesis Data Stream Dashboard
	go test -v -timeout 30m ./... -run ^TestStreamDashboard$
.PHONY: stream-dashboard

stream-resource-policy: ## Test Kinesis Data Stream Resource Policy
	go test -v -timeout 30m ./... -run ^TestStreamResourcePolicy$
.PHONY: stream-resource-policy

sns: ## Test SNS integration app
	go test -v -timeout 30m ./... -run ^TestSns$
.PHONY: sns

sns-lambda: ## Test SNS Lambda integration app
	go test -v -timeout 30m ./... -run ^TestSnsLambda$
.PHONY: sns-lambda

sns-sqs: ## Test SNS integration with sqs
	go test -v -timeout 30m ./... -run ^TestSnsSqs$
.PHONY: sns-sqs

sns-url: ## Test SNS URL subscription integration app
	go test -v -timeout 30m ./... -run ^TestSnsUrl$
.PHONY: sns-url