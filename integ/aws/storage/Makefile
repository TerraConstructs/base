include ../../common.mk

table.alarm-metrics: ## Test CloudWatch Alarm Metrics
	go test -v -count 1 -timeout 15m ./... -run ^TestTableAlarmMetrics$
.PHONY: table.alarm-metrics

table.autoscaling: ## Test Auto Scaling Table
	go test -v -count 1 -timeout 15m ./... -run ^TestAutoScalingTable$
.PHONY: table.autoscaling

table.global: ## Test Global Table
	go test -v -count 1 -timeout 15m ./... -run ^TestGlobalTable$
.PHONY: table.global

table.kinesis-stream: ## Test Table with Kinesis Stream
	go test -v -count 1 -timeout 15m ./... -run ^TestTableKinesisStream$
.PHONY: table.kinesis-stream

table.mixed-keys: ## Test Table with Mixed Keys
	go test -v -count 1 -timeout 15m ./... -run ^TestTableMixedKeys$
.PHONY: table.mixed-keys

table.policy: ## Test Table with Policy
	go test -v -count 1 -timeout 15m ./... -run ^TestTablePolicy$
.PHONY: table.policy

bucket-notifications: ## Test S3 Bucket with EventBridge Notifications
	go test -v -count 1 -timeout 15m ./... -run ^TestBucketNotifications$
.PHONY: bucket-notifications
