# CTP Platform — single-image, single-process runtime.
#
# The API serves the built Vite UI as static assets (see packages/api/src/main.ts),
# so one container on one port provides both the UI and the API.
#
# Tenant data is NOT baked into the image. Mount it at runtime via CONFIG_ROOT —
# image is code, staging is data (docs/sprints/staging-architecture-design.md).

# ---------- build ----------
FROM node:20-bookworm-slim AS build
WORKDIR /src

# Install deps first so the layer caches across source-only changes.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/api/package.json    packages/api/
COPY packages/web/package.json    packages/web/
RUN npm ci

COPY . .

# .git is excluded from the build context, so pass the stamp in:
#   docker build --build-arg GIT_HASH=$(git rev-parse --short HEAD) #                --build-arg GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD) .
# Without these the image reports version 1.0.0-unknown.
ARG GIT_HASH=unknown
ARG GIT_BRANCH=unknown
ENV GIT_HASH=$GIT_HASH GIT_BRANCH=$GIT_BRANCH

RUN npm run build --workspace=@ctp/engine \
 && npm run build --workspace=@ctp/web \
 && npm run build --workspace=@ctp/api

# Assemble the runtime tree. Layout mirrors the monorepo so the API's relative
# path resolution (dist/src/../../public, ../../config) resolves correctly.
#   /app/packages/api/dist      compiled API — node starts here
#   /app/packages/api/public    built Vite UI — served as static
#   /app/packages/engine/dist   compiled engine
RUN mkdir -p /app/packages/api /app/packages/engine \
 && cp -r packages/api/dist            /app/packages/api/dist \
 && cp -r packages/web/dist            /app/packages/api/public \
 && cp    packages/api/package.json    /app/packages/api/package.json \
 && cp -r packages/engine/dist         /app/packages/engine/dist \
 && cp    packages/engine/package.json /app/packages/engine/package.json \
 && cp    package.json package-lock.json /app/

WORKDIR /app
RUN npm ci --omit=dev

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    CONFIG_ROOT=/data/config \
    TELEMETRY_LOG_DIR=/data/logs

COPY --from=build --chown=node:node /app /app

# cwd must be packages/api — config paths resolve relative to it.
WORKDIR /app/packages/api

RUN mkdir -p /data/logs && chown -R node:node /data
USER node

EXPOSE 3000

# /v1/health is tenant-scoped and 404s without the header, so send one.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD \
  node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health',{headers:{'X-Tenant-Id':'demo-manufacturing'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/main.js"]
