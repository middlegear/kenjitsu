# ==========================================
#  Build Stage
# ==========================================
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./

RUN --mount=type=secret,id=npm_token \
    if [ -f /run/secrets/npm_token ]; then \
      npm config set //npm.pkg.github.com/:_authToken="$(cat /run/secrets/npm_token)"; \
    fi && \
    npm config set @middlegear:registry https://npm.pkg.github.com && \
    npm install && \
    npm config delete //npm.pkg.github.com/:_authToken || true

# dist-tag: latest (stable) | nightly
ARG EXTENSION_TAG=latest
RUN --mount=type=secret,id=npm_token \
    if [ -f /run/secrets/npm_token ]; then \
      npm config set //npm.pkg.github.com/:_authToken="$(cat /run/secrets/npm_token)"; \
    fi && \
    npm install @middlegear/kenjitsu-extensions@${EXTENSION_TAG} && \
    npm config delete //npm.pkg.github.com/:_authToken || true

COPY . .

RUN npm run build

RUN npm prune --omit=dev && npm cache clean --force


# ==========================================
#  Runtime Stage
# ==========================================
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/public ./public
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./

USER appuser

EXPOSE 3000

CMD ["node", "dist/server.js"]