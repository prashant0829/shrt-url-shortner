# syntax=docker/dockerfile:1

# ---- React client -> static files --------------------------------------------------------------
FROM node:24-alpine AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client ./
# vite.config.js writes the bundle to ../server/public (here: /build/server/public).
RUN npm run build

# ---- API: production dependencies only ------------------------------------------------------------
FROM node:24-alpine AS server-deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime image -----------------------------------------------------------------------------
# One image serves the API and the UI; the worker and the migration job reuse it with another command.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=server-deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/migrations ./migrations
COPY --from=client-build /build/server/public ./public

# Never run as root inside the container.
USER node

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/health/live" || exit 1

CMD ["node", "src/server.js"]
