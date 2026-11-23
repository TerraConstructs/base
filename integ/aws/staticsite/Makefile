include ../../common.mk

public-website-bucket: ## Test Public S3 Bucket with website configuration
	go test -v -timeout 15m ./... -run ^TestPublicWebsiteBucket$$
.PHONY: public-website-bucket

cdn-website-bucket: ## Test CDN with s3 origin Bucket and custom domain
	go test -v -timeout 45m ./... -run ^TestCdnWebsiteBucket$$
.PHONY: cdn-website-bucket
