include ./common.mk


this: ## Test all integ utilities
	go test -v -count 1 .
.PHONY: this

assert: ## Test assert
	go test -v -count 1 . -run ^TestAssert
.PHONY: assert

terraform-output-jmes: ## Test terraform output with jmespath
	go test -v -count 1 . -run ^TestTerraformOutputJMES
.PHONY: terraform-output-jmes
aws-emulator: ## Run all AWS integ targets against one AWS emulator (EMULATOR_SERVICE, EMULATOR_SKIP_FILE)
	@was_running=$$(docker ps -q -f name=^$(EMULATOR_NAME)$$); \
	$(MAKE) --no-print-directory emulator-up || { [ -n "$$was_running" ] || $(MAKE) --no-print-directory emulator-down; exit 1; }; \
	./emulator-all.sh; \
	status=$$?; [ -n "$$was_running" ] || $(MAKE) --no-print-directory emulator-down; exit $$status
.PHONY: aws-emulator
aws-emulator-list: ## List the AWS integ targets that aws-emulator runs and skips
	@./emulator-all.sh --list
.PHONY: aws-emulator-list
