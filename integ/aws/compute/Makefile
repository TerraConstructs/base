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

lambda-vpc: ## Test lambda in Vpc
	go test -v -count 1 -timeout 60m ./... -run ^TestLambdaVpc$
.PHONY: lambda-vpc

lambda-runtime-inlinecode: ## Test lambda runtime inlinecode
	go test -v -count 1 -timeout 60m ./... -run ^TestLambdaRuntimeInlineCode$
.PHONY: lambda-runtime-inlinecode

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

autoscaling.custom-scaling: ## Test AutoScalingGroup custom scaling (Schedule.cron + scaleOnCpuUtilization)
	go test -v -count 1 -timeout 30m ./... -run ^TestAutoscalingCustomScaling$
.PHONY: autoscaling.custom-scaling

instance-public: ## Test Compute Instance with public IP
	go test -v -count 1 -timeout 15m ./... -run ^TestInstancePublic$
.PHONY: instance-public

machine-image: ## Test Machine Image
	go test -v -count 1 -timeout 15m ./... -run ^TestMachineImage$
.PHONY: machine-image

vpc-lookup: ## Test VPC lookup
	go test -v -count 1 -timeout 15m ./... -run ^TestVpcLookup$
.PHONY: vpc-lookup

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

ecs.awslogs-driver: ## Test Fargate service with the awslogs log driver
	go test -v -count 1 -timeout 30m ./... -run ^TestEcsAwslogsDriver$
.PHONY: ecs.awslogs-driver

ecs.lb-awsvpc-nw: ## Test Fargate service attached to an ALB target group + task-count autoscaling
	go test -v -count 1 -timeout 30m ./... -run ^TestEcsLbAwsvpcNw$
.PHONY: ecs.lb-awsvpc-nw

ecs.ebs-taskattach: ## Test Fargate service with a ServiceManagedVolume (EBS task attach)
	go test -v -count 1 -timeout 30m ./... -run ^TestEcsEbsTaskattach$
.PHONY: ecs.ebs-taskattach

ecs.sd-awsvpc-nw: ## Test EC2 service with CloudMap service discovery (awsvpc) + cluster capacity
	go test -v -count 1 -timeout 45m ./... -run ^TestEcsSdAwsvpcNw$
.PHONY: ecs.sd-awsvpc-nw
