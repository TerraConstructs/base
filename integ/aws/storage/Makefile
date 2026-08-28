include ../../common.mk

table.alarm-metrics: ## Test CloudWatch Alarm Metrics
	go test -v -count 1 -timeout 15m ./... -run ^TestTableAlarmMetrics$
.PHONY: table.alarm-metrics

table.autoscaling: ## Test Auto Scaling Table
	go test -v -count 1 -timeout 15m ./... -run ^TestAutoScalingTable$
.PHONY: table.autoscaling

table.global: ## Test Global Table
	go test -v -count 1 -timeout 15m ./... -run ^TestTableGlobal$
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

bucket-notifications-cross-stack: ## Test cross-stack S3 notifications via the cfncompat custom resource
	go test -v -count 1 -timeout 45m ./... -run ^TestBucketNotificationsCrossStack$
.PHONY: bucket-notifications-cross-stack

# This test names its own stages (deploy_a, validate_ab, ...) rather than the
# deploy_terraform/validate/cleanup_terraform stages ../../common.mk's %-synth-only and
# friends skip by name, so it spells out its own suffix targets - an explicit target wins
# over a `%` pattern rule with the same stem.
bucket-notifications-cross-stack-synth-only: ## Synth only (no deploy/validate/cleanup) - runs without AWS creds
	SKIP_deploy_a=true SKIP_validate_a=true SKIP_deploy_b=true SKIP_validate_ab=true \
	SKIP_deploy_c=true SKIP_validate_abc=true SKIP_redeploy_a=true SKIP_validate_abc_again=true \
	SKIP_destroy_b=true SKIP_validate_ac=true SKIP_cleanup_terraform=true \
	make bucket-notifications-cross-stack
.PHONY: bucket-notifications-cross-stack-synth-only

bucket-notifications-cross-stack-cleanup-only: ## Skip straight to teardown of stacks a/b/c
	SKIP_synth_app=true SKIP_deploy_a=true SKIP_validate_a=true SKIP_deploy_b=true SKIP_validate_ab=true \
	SKIP_deploy_c=true SKIP_validate_abc=true SKIP_redeploy_a=true SKIP_validate_abc_again=true \
	SKIP_destroy_b=true SKIP_validate_ac=true \
	make bucket-notifications-cross-stack
.PHONY: bucket-notifications-cross-stack-cleanup-only
