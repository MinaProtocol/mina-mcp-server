# MCP server bundled with the Mina lightnet so a single Fly machine can host
# both the lightnet (daemon, archive, accounts-manager, postgres, explorer)
# and the streamable-HTTP MCP server.
#
# Build:  docker build -t mina-mcp-server .
# Run:    docker run -p 3000:3000 -p 8080:8080 mina-mcp-server

FROM node:20-bookworm-slim AS builder
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM o1labs/mina-local-network:develop-latest-lightnet

# Node 20 runtime for the MCP server. AllowWeakRepositories survives transient
# Debian apt warnings on bookworm-updates during qemu-emulated arm64 builds
# (same workaround used in mina-lightnet-docker's own Dockerfile).
RUN echo 'Acquire::AllowWeakRepositories "true";' > /etc/apt/apt.conf.d/99-allow-weak-repos \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && node --version && npm --version \
    && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99-allow-weak-repos

WORKDIR /opt/mcp
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json ./package.json
COPY deploy/start.sh /usr/local/bin/start-mcp.sh
RUN chmod +x /usr/local/bin/start-mcp.sh

# 3000 = MCP HTTP transport, 8080 = NGINX (Explorer + GraphQL playground)
EXPOSE 3000 8080

ENV MINA_MCP_MODE=tutorial \
    MINA_MCP_TRANSPORT=http \
    MINA_MCP_HTTP_PORT=3000 \
    MINA_GRAPHQL_ENDPOINT=http://localhost:3085/graphql \
    ARCHIVE_API_ENDPOINT=http://localhost:8282 \
    ACCOUNTS_MANAGER_ENDPOINT=http://localhost:8181 \
    ARCHIVE_DB_HOST=localhost \
    ARCHIVE_DB_PORT=5432 \
    ARCHIVE_DB_NAME=archive \
    ARCHIVE_DB_USER=postgres

ENTRYPOINT ["/usr/local/bin/start-mcp.sh"]
