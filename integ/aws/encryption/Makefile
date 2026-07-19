include ../../common.mk

all: ## Test all Encryption integrations
	go test -v -timeout 30m ./...
.PHONY: all

key: ## Test AWS KMS Customer Master Key creation
	go test -v -count 1 -timeout 15m ./... -run ^TestKey$
.PHONY: key

key-alias: ## Test AWS KMS CMK + alias creation
	go test -v -count 1 -timeout 15m ./... -run ^TestKeyAlias$
.PHONY: key-alias

secret-attach: ## Test SecretsManager Secret.attach() against an RDS DbInstance
	go test -v -count 1 -timeout 30m ./... -run ^TestSecretAttach$
.PHONY: secret-attach

secret.replica: ## Test AWS Secrets Manager Secret + replica region
	go test -v -count 1 -timeout 15m ./... -run ^TestSecretReplica$
.PHONY: secret.replica
