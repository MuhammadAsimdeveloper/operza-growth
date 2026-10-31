# ==============================================================================
# Operza Unified Backend API - Production Dockerfile
# ==============================================================================

FROM node:22-alpine AS base

# Install security updates & dumb-init for proper signal handling
RUN apk update && apk upgrade && apk add --no-cache dumb-init curl

WORKDIR /app

# Copy root workspace configurations
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/workflow-engine/package.json ./packages/workflow-engine/

# Install dependencies across all workspaces
RUN npm ci --omit=dev

# Copy application code
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Create persistent data directory and set permissions for node user
RUN mkdir -p /app/apps/api/data && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

EXPOSE 4000

# Docker healthcheck pinging /health
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "apps/api/server.mjs"]
