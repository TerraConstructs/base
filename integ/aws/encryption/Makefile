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
