include ../../common.mk

all: ## Test all Notify integrations
	go test -v -timeout 30m ./...
.PHONY: all

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
