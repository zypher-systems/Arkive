# Convenience targets. Docker users only need `docker compose up -d`.
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
WEBUI_DIST := api/internal/webui/dist

.PHONY: build web embed-web api test test-race test-postgres e2e e2e-up e2e-down image clean-web

## build: web UI + single arkive binary with the UI embedded (./arkive)
build: embed-web api

web:
	cd web && npm ci && npm run build

embed-web: web
	find $(WEBUI_DIST) -mindepth 1 ! -name .gitkeep -exec rm -rf {} +
	cp -R web/dist/. $(WEBUI_DIST)/

api:
	cd api && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o ../arkive ./cmd/arkive

## test: Go tests on SQLite (a fresh database per test, no setup needed)
test:
	cd api && go vet ./... && go test ./...

## test-race: the same with the race detector (needs a C toolchain)
test-race:
	cd api && go test -race ./...

## test-postgres: Go tests on PostgreSQL, e.g.
##   docker run -d --rm -p 5432:5432 -e POSTGRES_USER=arkive -e POSTGRES_PASSWORD=arkive postgres:16-alpine
TEST_POSTGRES_URL ?= postgres://arkive:arkive@localhost:5432/arkive?sslmode=disable
test-postgres:
	cd api && ARKIVE_TEST_DATABASE_URL='$(TEST_POSTGRES_URL)' go test ./...

## e2e: Playwright suite (e2e/) against a fresh compose stack built from this
##   checkout, torn down afterwards. E2E_COMPOSE=docker-compose.postgres.yml for
##   PostgreSQL; E2E_PORT picks the host port. Needs Docker and Node; run
##   `cd e2e && npx playwright install chromium` once (or set
##   PLAYWRIGHT_CHROMIUM_EXECUTABLE to a local Chromium).
E2E_COMPOSE ?= docker-compose.yml
E2E_PORT ?= 3180
E2E_PROJECT ?= arkive-e2e
E2E_TOKEN := e2e-setup-token
E2E_STACK = ARKIVE_PORT=$(E2E_PORT) ARKIVE_PUBLIC_URL=http://localhost:$(E2E_PORT) \
	ARKIVE_SETUP_TOKEN=$(E2E_TOKEN) \
	ARKIVE_TRUSTED_PROXIES=127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 \
	docker compose -p $(E2E_PROJECT) -f $(E2E_COMPOSE) -f docker-compose.build.yml
e2e: e2e-up
	cd e2e && npm ci && ARKIVE_E2E_URL=http://localhost:$(E2E_PORT) ARKIVE_SETUP_TOKEN=$(E2E_TOKEN) \
		npx playwright test; status=$$?; cd .. && $(MAKE) --no-print-directory e2e-down; exit $$status

e2e-up:
	$(E2E_STACK) up -d --build --wait

e2e-down:
	$(E2E_STACK) down -v

image:
	docker build -f docker/Dockerfile --build-arg VERSION=$(VERSION) -t arkive:$(VERSION) .

## clean-web: drop the embedded UI copy (back to the placeholder page)
clean-web:
	find $(WEBUI_DIST) -mindepth 1 ! -name .gitkeep -exec rm -rf {} +
