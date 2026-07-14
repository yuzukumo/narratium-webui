# syntax=docker/dockerfile:1.7

FROM node:24.18.0-alpine AS frontend
ARG PNPM_VERSION=11.12.0
WORKDIR /src
RUN apk add --no-cache brotli \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN NEXT_TELEMETRY_DISABLED=1 pnpm build \
    && find out -type f \( -name '*.css' -o -name '*.html' -o -name '*.js' -o -name '*.json' -o -name '*.svg' -o -name '*.txt' -o -name '*.xml' \) -size +1k \
      -exec gzip -9 -k '{}' \; \
    && find out -type f \( -name '*.css' -o -name '*.html' -o -name '*.js' -o -name '*.json' -o -name '*.svg' -o -name '*.txt' -o -name '*.xml' \) -size +1k \
      -exec brotli --quality=11 --keep '{}' \;

FROM golang:1.26.5-alpine AS backend
ARG GOPROXY="https://proxy.golang.org|direct"
ENV GOPROXY=${GOPROXY}
WORKDIR /src/backend
RUN apk add --no-cache git
COPY backend/go.mod backend/go.sum ./
RUN set -eux; \
    for attempt in 1 2 3 4 5; do \
      if go mod download; then exit 0; fi; \
      if [ "$attempt" -eq 5 ]; then exit 1; fi; \
      sleep $((attempt * 2)); \
    done
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /narratium ./cmd/server

FROM alpine:3.23
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S narratium \
    && adduser -S -G narratium -h /app narratium \
    && mkdir -p /app/data \
    && chown narratium:narratium /app/data \
    && chmod 700 /app/data
WORKDIR /app
COPY --from=backend --chown=narratium:narratium /narratium ./narratium
COPY --from=frontend --chown=narratium:narratium /src/out ./out
USER narratium
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/api/v1/health || exit 1
ENTRYPOINT ["/app/narratium"]
