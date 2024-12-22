include ../../common.mk

all: ## Test all Monitoring integrations
	go test -v -timeout 30m ./...
.PHONY: all

log-destination-kinesis: ## Test CloudWatch Log Delivery to Kinesis
	go test -v -count 1 -timeout 15m ./... -run ^TestLogDestinationKinesis$
.PHONY: log-destination-kinesis

log-destination-lambda: ## Test CloudWatch Log Delivery to Lambda
	go test -v -count 1 -timeout 15m ./... -run ^TestLogDestinationLambda$
.PHONY: log-destination-lambda

log-group-dataprotection: ## Test CloudWatch Log Group Data Protection
	go test -v -count 1 -timeout 15m ./... -run ^TestLogGroupDataProtection$
.PHONY: log-group-dataprotection

log-group-metrics: ## Test CloudWatch Log Group Metrics
	go test -v -count 1 -timeout 15m ./... -run ^TestLogGroupMetrics$
.PHONY: log-group-metrics
