include ../../common.mk

all: ## Test all Edge
	go test -v -timeout 120m ./...
.PHONY: all

url-rewrite-spa: ## Test Edge function for URL rewrite SPA
	go test -v -timeout 30m ./... -run ^TestUrlRewriteSpa$
.PHONY: url-rewrite-spa

## NOTE: This test is quite flaky :/
kvs-jwt-verify: ## Test Edge function for KVS JWT verify
	go test -v -timeout 30m ./... -run ^TestKvsJwtVerify$
.PHONY: kvs-jwt-verify

multi-zone-acm-pub-cert: ## Test Multi Zone ACM Public Certificate
	go test -v -timeout 30m ./... -run ^TestMultiZoneAcmPubCert$
.PHONY: multi-zone-acm-pub-cert

distribution-policies: ## Test Distribution Policies
	go test -v -timeout 45m ./... -run ^TestDistributionPolicies$
.PHONY: distribution-policies
