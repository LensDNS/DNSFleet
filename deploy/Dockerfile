# syntax=docker/dockerfile:1
# node → builder-go → runtime (distroless)

FROM node:22-bookworm AS node
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ARG NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH
ENV NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH=${NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH}
ENV NODE_ENV=production
RUN npm run build

FROM golang:1.24-bookworm AS builder-go
WORKDIR /src
ENV GOTOOLCHAIN=auto
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=node /web/out/ ./internal/webui/dist/
ENV CGO_ENABLED=0
RUN go build -trimpath -ldflags="-s -w" -o /out/dnsfleet ./cmd/dnsfleet

FROM gcr.io/distroless/static-debian12:nonroot AS runtime
COPY --from=builder-go /out/dnsfleet /dnsfleet
USER nonroot:nonroot
EXPOSE 8080
ENV DNSFLEET_HTTP_ADDR=:8080
ENTRYPOINT ["/dnsfleet"]
