.PHONY: run test test-web test-mysql clean-mysql build build-chatbot build-gate-mcp css-check check coverage coverage-go coverage-chatbot coverage-web coverage-e2e

GOCACHE ?= /tmp/agentflow-gocache
# Use the local toolchain; go.mod requires go >= 1.26.11.

run:
	GOCACHE=$(GOCACHE) go run ./cmd/agentflow

test:
	GOCACHE=$(GOCACHE) go test -p=16 ./... -count=1 -timeout=4m

# test-web runs only the web package: the front-end gates a UI change can
# actually break (layout, rail, tokens consumed by components). Faster than the
# whole repository, which also builds platform packages a style edit never
# touches.
#
#   make test-web                    every front-end test
#   make test-web RUN=TestRail       only tests whose name matches (Go regexp)
#
# RUN is handed to `go test -run` verbatim; quote it if it contains spaces.
RUN ?=
test-web:
	GOCACHE=$(GOCACHE) go test ./web/ -count=1 -timeout=4m \
		$(if $(strip $(RUN)),-run '$(RUN)')

# css-check guards the design tokens. CSS custom properties fail silently:
# a self-reference or a cycle makes var(--x) resolve to nothing, and the only
# symptom is a component losing its color. Three cases are checked -- self
# reference, cycles, and references with no declaration and no fallback.
#
# This is a repository-wide gate, not a per-change one: it walks every sheet
# under web/ and web/app/. Run it when the token graph changes (declaring or
# referencing a custom property) or before committing, not on every style edit.
# CI runs it as its own step.
css-check:
	python3 scripts/check-css-vars.py

# check is the fast, dependency-free gate worth running before every commit:
# the token graph plus the front-end tests.
check: css-check test-web

# coverage runs the same gates as CI. Needs web/native-chat
# (make build-chatbot). COVERAGE_P lowers Go package parallelism on small hosts.
COVERAGE_P ?= 4

coverage: coverage-go coverage-chatbot coverage-web

coverage-go:
	GOCACHE=$(GOCACHE) GO_TEST_P=$(COVERAGE_P) bash scripts/coverage-go.sh --min 85

coverage-chatbot:
	[ -d chatbot/node_modules/vitest ] || npm --prefix chatbot ci --include=dev --no-audit --no-fund
	npm --prefix chatbot run coverage

coverage-web:
	[ -d webtest/node_modules/c8 ] || npm --prefix webtest ci --include=dev --no-audit --no-fund
	npm --prefix webtest run coverage

# coverage-e2e runs e2e/local.sh all against a throwaway platform and reports
# route coverage plus web/ unit+browser coverage. Not part of CI.
coverage-e2e:
	bash e2e/coverage/report.sh

# test-mysql runs the gorm integration tests against a throwaway local MySQL
# container. It never touches any externally configured database: the DSN is
# bound to 127.0.0.1 and the container is removed afterwards.
MYSQL_CONTAINER ?= agentflow-test-mysql
MYSQL_PORT ?= 33306
MYSQL_TEST_DB ?= agentflow_it
MYSQL_IMAGE ?= mysql:8.0

test-mysql:
	@docker rm -f $(MYSQL_CONTAINER) >/dev/null 2>&1 || true
	docker run -d --name $(MYSQL_CONTAINER) -p 127.0.0.1:$(MYSQL_PORT):3306 \
		-e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=$(MYSQL_TEST_DB) $(MYSQL_IMAGE)
	@echo "waiting for MySQL to become ready..."
	@until docker exec $(MYSQL_CONTAINER) mysqladmin ping -uroot -proot --silent >/dev/null 2>&1; do sleep 1; done
	@until docker exec $(MYSQL_CONTAINER) mysql -uroot -proot -e "SELECT 1" >/dev/null 2>&1; do sleep 1; done
	@sleep 3
	AGENTFLOW_TEST_MYSQL_DSN="root:root@tcp(127.0.0.1:$(MYSQL_PORT))/$(MYSQL_TEST_DB)" \
		GOCACHE=$(GOCACHE) go test -p=1 ./internal/repo/ -count=1 -timeout=180s
	$(MAKE) clean-mysql

clean-mysql:
	-@docker rm -f $(MYSQL_CONTAINER) >/dev/null 2>&1 || true

build: build-chatbot
	mkdir -p bin
	GOCACHE=$(GOCACHE) go build -o bin/agentflow ./cmd/agentflow
	GOCACHE=$(GOCACHE) go build -o bin/agentflow-mcp ./cmd/agentflow-mcp
	GOCACHE=$(GOCACHE) go build -o bin/agentflow-runner ./cmd/agentflow-runner
	$(MAKE) build-gate-mcp

build-chatbot:
	bash scripts/build-chatbot.sh

build-gate-mcp:
	mkdir -p bin
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 GOCACHE=$(GOCACHE) go build -o bin/agentflow-gate-mcp-darwin-amd64 ./cmd/agentflow-gate-mcp
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 GOCACHE=$(GOCACHE) go build -o bin/agentflow-gate-mcp-darwin-arm64 ./cmd/agentflow-gate-mcp
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOCACHE=$(GOCACHE) go build -o bin/agentflow-gate-mcp-linux-amd64 ./cmd/agentflow-gate-mcp
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 GOCACHE=$(GOCACHE) go build -o bin/agentflow-gate-mcp-linux-arm64 ./cmd/agentflow-gate-mcp
