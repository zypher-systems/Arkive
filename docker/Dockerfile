# syntax=docker/dockerfile:1
#
# Single Arkive image: the Go binary serves the API, WebDAV and the embedded
# React SPA on :8080. Multi-arch friendly — both build stages run on the build
# host ($BUILDPLATFORM) and Go cross-compiles (CGO_ENABLED=0), so
#   docker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile .
# needs no emulation. Pass --build-arg VERSION=1.1.0 to stamp the version.

FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS api
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY api/go.mod api/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY api/ ./
# go:embed picks the SPA up from internal/webui/dist.
COPY --from=web /web/dist/ ./internal/webui/dist/
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/arkive ./cmd/arkive \
 && mkdir -p /out/data/arkive

# Distroless static: CA certificates, tzdata, /tmp and a nonroot user (65532 —
# the same uid the 1.0 api image used, so existing volumes keep working).
# Thumbnails are pure Go, so no ffmpeg/libvips is needed.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=api /out/arkive /usr/local/bin/arkive
COPY --from=api --chown=65532:65532 /out/data /data
ENV ARKIVE_HTTP_ADDR=:8080 \
    ARKIVE_DATA_DIR=/data/arkive
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
    CMD ["/usr/local/bin/arkive", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/arkive"]
CMD ["serve"]
