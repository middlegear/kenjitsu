# ==========================================
# Build Stage
# ==========================================
FROM node:24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json tsconfig.json ./

RUN npm install

COPY . .

RUN npm run build

RUN npm prune --omit=dev \
 && npm cache clean --force

# ==========================================
# Runtime Stage
# ==========================================
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S appgroup \
 && adduser -S appuser -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/public ./public
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./

USER appuser

EXPOSE 3000

CMD ["node", "dist/server.js"]