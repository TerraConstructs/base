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

rds.groups: ## Test RDS SubnetGroup, ParameterGroup (both binds), OptionGroup, DatabaseSecret
	go test -v -count 1 -timeout 20m ./... -run ^TestRdsGroups$
.PHONY: rds.groups

rds.instance: ## Test DatabaseInstance L2 (live Postgres db.t3.micro + attached secret)
	go test -v -count 1 -timeout 45m ./... -run ^TestRdsInstance$
.PHONY: rds.instance

rds.cluster: ## Test DatabaseCluster L2 (live Aurora PostgreSQL Serverless v2 + Data API)
	go test -v -count 1 -timeout 60m ./... -run ^TestRdsCluster$
.PHONY: rds.cluster

rds.proxy: ## Test DatabaseProxy L2 (live RDS Proxy fronting MySQL db.t3.micro)
	go test -v -count 1 -timeout 45m ./... -run ^TestRdsProxy$
.PHONY: rds.proxy

docdb.cluster: ## Test DocDB DatabaseCluster L2 (live DocumentDB cluster + instance)
	go test -v -count 1 -timeout 45m ./... -run ^TestDocdbCluster$
.PHONY: docdb.cluster

elasticache.serverless-cache: ## Test ElastiCache ServerlessCache L2 (live Valkey 8 + IamUser + UserGroup)
	go test -v -count 1 -timeout 30m ./... -run ^TestElasticacheServerlessCache$
.PHONY: elasticache.serverless-cache

neptune.cluster: ## Test Neptune DatabaseCluster L2 (live serverless cluster + instance)
	go test -v -count 1 -timeout 45m ./... -run ^TestNeptuneCluster$
.PHONY: neptune.cluster

bucket-notifications: ## Test S3 Bucket with EventBridge Notifications
	go test -v -count 1 -timeout 15m ./... -run ^TestBucketNotifications$
.PHONY: bucket-notifications
