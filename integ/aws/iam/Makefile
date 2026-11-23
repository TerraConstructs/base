include ../../common.mk

all: ## Test all IAM
	go test -v -timeout 30m ./...
.PHONY: all

role: ## Test IAM Role
	go test -v -timeout 30m ./... -run ^TestRole$$
.PHONY: role

composite-principal: ## Test Composite Principal
	go test -v -timeout 30m ./... -run ^TestCompositePrincipal$$
.PHONY: composite-principal

condition-with-ref: ## Test Condition with Ref
	go test -v -timeout 30m ./... -run ^TestConditionWithRef$$
.PHONY: condition-with-ref

managed-policy: ## Test Managed Policies
	go test -v -timeout 30m ./... -run ^TestManagedPolicy$$
.PHONY: managed-policy
