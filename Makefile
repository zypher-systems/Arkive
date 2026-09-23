# Convenience targets. Docker users only need `docker compose up -d`.
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
WEBUI_DIST := api/internal/webui/dist

.PHONY: build web embed-web api test test-race test-postgres image clean-web

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

image:
	docker build -f docker/Dockerfile --build-arg VERSION=$(VERSION) -t arkive:$(VERSION) .

## clean-web: drop the embedded UI copy (back to the placeholder page)
clean-web:
	find $(WEBUI_DIST) -mindepth 1 ! -name .gitkeep -exec rm -rf {} +
