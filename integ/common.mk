help: ## Print out every target with a description
	@awk 'BEGIN { FS = ":.*##" } \
	/^[a-zA-Z0-9_.-]+:.*##/ { \
		target = $$1; desc = $$2; \
		if (desc ~ /^ Test/) { \
			test_targets[target] = desc; \
			test_names[++test_count] = target; \
		} else { \
			other_targets[target] = desc; \
			other_names[++other_count] = target; \
		} \
	} \
	END { \
		if (test_count > 0) { \
			print "\nTest Targets:"; \
			for (i = 1; i <= test_count; i++) { \
				t = test_names[i]; \
				printf "  \033[36m%-25s\033[0m %s\n", t, test_targets[t]; \
			} \
		} \
		if (other_count > 0) { \
			print "\nOther Targets:"; \
			for (i = 1; i <= other_count; i++) { \
				t = other_names[i]; \
				printf "  \033[36m%-25s\033[0m %s\n", t, other_targets[t]; \
			} \
		} \
	}' $(MAKEFILE_LIST)
	@echo ""
	@echo "Special pattern targets:"
	@awk '/^## %/ { sub(/^## /, "  "); print }' $(MAKEFILE_LIST)
.PHONY: help

## %-no-cleanup:              Skip cleanup step (i.e. foo-no-cleanup)
%-no-cleanup:
	SKIP_cleanup_terraform=true make $*
.PHONY: %-no-cleanup

## %-synth-only:              Skip deploy, validate, and cleanup steps (i.e. foo-synth-only)
%-synth-only:
	SKIP_deploy_terraform=true SKIP_validate=true SKIP_cleanup_terraform=true make $*
.PHONY: %-synth-only

## %-validate-only:           Skip synth and cleanup steps (i.e. foo-validate-only)
%-validate-only:
	SKIP_synth_app=true SKIP_cleanup_terraform=true make $*
.PHONY: %-validate-only

## %-cleanup-only:            Skip synth, deploy, and validate steps (i.e. foo-cleanup-only)
%-cleanup-only:
	SKIP_synth_app=true SKIP_deploy_terraform=true SKIP_validate=true make $*
.PHONY: %-cleanup-only

clean: ## clean up temporary files (tf/*, apps/cdktf.out, /tmp/go-synth-*)
	rm -rf tf/*
	rm -rf apps/cdktf.out
	rm -rf /tmp/go-synth-*
.PHONY: clean

# Pinned by multi-arch index digest; keep in sync with EMULATOR_IMAGE in projenrc/github-workflows.ts.
EMULATOR_IMAGE ?= ghcr.io/xsavikx/aws-emulator:1.0.598.1@sha256:ddcdd78ff9e7b84ca2828c9e838cf4c5e8027da3996364a93cf0650e15b6b6f0
EMULATOR_PORT ?= 9397
EMULATOR_NAME ?= terraconstructs-aws-emulator
EMULATOR_DIR := $(HOME)/.aws/emulator/$(EMULATOR_PORT)
EMULATOR_EXTERNAL ?=

emulator-up: ## Start the AWS emulator container (reuses a running one, port: EMULATOR_PORT)
	@if [ "$$(docker inspect -f '{{.State.Health.Status}}' $(EMULATOR_NAME) 2>/dev/null)" = "healthy" ] \
		&& docker port $(EMULATOR_NAME) 2>/dev/null | grep -q ':$(EMULATOR_PORT)$$'; then \
		echo "Reusing the running AWS emulator $(EMULATOR_NAME) on port $(EMULATOR_PORT)"; exit 0; \
	fi; \
	docker rm -f $(EMULATOR_NAME) >/dev/null 2>&1 || true; \
	if command -v lsof >/dev/null 2>&1; then \
		lsof -nP -iTCP:$(EMULATOR_PORT) -sTCP:LISTEN >/dev/null 2>&1 && busy=1; \
	elif command -v ss >/dev/null 2>&1; then \
		ss -ltn "sport = :$(EMULATOR_PORT)" 2>/dev/null | grep -q LISTEN && busy=1; \
	else \
		bash -c 'exec 3<>/dev/tcp/127.0.0.1/$(EMULATOR_PORT)' >/dev/null 2>&1 && busy=1; \
	fi; \
	if [ -n "$$busy" ]; then \
		echo "Port $(EMULATOR_PORT) is in use by another process:"; \
		lsof -nP -iTCP:$(EMULATOR_PORT) -sTCP:LISTEN 2>/dev/null || ss -ltnp "sport = :$(EMULATOR_PORT)" 2>/dev/null || true; \
		echo "Stop it or run with another port, for example: make EMULATOR_PORT=9398 ..."; exit 1; \
	fi; \
	$(MAKE) --no-print-directory emulator-start
.PHONY: emulator-up

emulator-start:
	@mkdir -p "$(HOME)/.aws/emulator"
	@docker run -d --name $(EMULATOR_NAME) --memory=2g --memory-swap=2g \
		--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
		-p 127.0.0.1:$(EMULATOR_PORT):$(EMULATOR_PORT) \
		--user "$$(id -u):$$(id -g)" -e HOME="$(HOME)" -e EMULATOR_TELEMETRY=off \
		-e EMULATOR_HEALTHCHECK_PORT=$(EMULATOR_PORT) \
		-v "$(HOME)/.aws/emulator:$(HOME)/.aws/emulator" \
		$(EMULATOR_IMAGE) -p $(EMULATOR_PORT) >/dev/null
	@echo "Waiting for the AWS emulator..."
	@for i in $$(seq 1 60); do \
		[ "$$(docker inspect -f '{{.State.Health.Status}}' $(EMULATOR_NAME))" = "healthy" ] && exit 0; \
		sleep 1; \
	done; \
	docker logs $(EMULATOR_NAME); \
	echo "The AWS emulator did not become healthy"; exit 1
.PHONY: emulator-start

emulator-down: ## Stop the AWS emulator container
	@docker rm -f $(EMULATOR_NAME) >/dev/null 2>&1 || true
.PHONY: emulator-down

## %-emulator:                Run a target against the AWS emulator (i.e. key-emulator, requires Docker or EMULATOR_EXTERNAL=1)
%-emulator:
	@$(MAKE) --no-print-directory -n $* >/dev/null 2>&1 || { \
		echo "No target '$*' in $$(pwd). Run make from the directory that defines it, for example integ/aws/encryption."; exit 1; }; \
	if [ -n "$(EMULATOR_EXTERNAL)" ]; then \
		if [ -z "$$AWS_ENDPOINT_URL" ]; then \
			echo "EMULATOR_EXTERNAL is set but AWS_ENDPOINT_URL is empty. Start the emulator first, for example with the run-aws-emulator action."; exit 1; \
		fi; \
		exec env -u AWS_PROFILE -u AWS_SESSION_TOKEN -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SECURITY_TOKEN \
			$(MAKE) --no-print-directory $*; \
	fi; \
	was_running=$$(docker ps -q -f name=^$(EMULATOR_NAME)$$); \
	$(MAKE) --no-print-directory emulator-up || { [ -n "$$was_running" ] || $(MAKE) --no-print-directory emulator-down; exit 1; }; \
	mkdir -p "$(EMULATOR_DIR)" && : > "$(EMULATOR_DIR)/empty-config"; \
	env -u AWS_PROFILE -u AWS_SESSION_TOKEN -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SECURITY_TOKEN \
	AWS_CONFIG_FILE=$(EMULATOR_DIR)/empty-config AWS_EC2_METADATA_DISABLED=true \
	AWS_DISABLE_HOST_PREFIX_INJECTION=true \
	AWS_ENDPOINT_URL=https://127.0.0.1:$(EMULATOR_PORT) \
	AWS_CA_BUNDLE=$(EMULATOR_DIR)/ca.pem \
	AWS_SHARED_CREDENTIALS_FILE=$(EMULATOR_DIR)/emulator_credentials \
	AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1 \
	$(MAKE) --no-print-directory $*; \
	status=$$?; [ -n "$$was_running" ] || $(MAKE) --no-print-directory emulator-down; exit $$status
.PHONY: %-emulator
