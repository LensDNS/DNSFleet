# DNSFleet — minimal developer conveniences (Unix shell; Git Bash / MSYS2 on Windows).
.PHONY: ensure-webui-dist test

# Copy Next static export into internal/webui/dist for go:embed, or write a tiny placeholder.
ensure-webui-dist:
	@mkdir -p internal/webui/dist
	@if [ -f web/out/index.html ]; then \
		rm -rf internal/webui/dist/* && cp -r web/out/. internal/webui/dist/; \
	else \
		printf '%s\n' '<!DOCTYPE html><html><head><meta charset="utf-8"><title>DNSFleet</title></head><body><p>Build UI: <code>cd web &amp;&amp; npm run build</code> then <code>make ensure-webui-dist</code></p></body></html>' > internal/webui/dist/index.html; \
	fi

# Run Go tests for cmd + internal only (avoids stray packages under web/node_modules).
test: ensure-webui-dist
	go test ./cmd/... ./internal/...
