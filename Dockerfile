# ==========================================
#  Build Stage
# ==========================================
FROM node:24-slim AS builder

WORKDIR /app


COPY package*.json tsconfig.json .npmrc ./


ARG NPM_TOKEN
RUN if [ -n "$NPM_TOKEN" ]; then \
      npm config set //npm.pkg.github.com/:_authToken=$NPM_TOKEN; \
    fi

RUN npm install

# dist-tag (latest | nightly)
ARG EXTENSION_TAG=latest
RUN npm install @middlegear/kenjitsu-extensions@${EXTENSION_TAG}

# Copy full source code
COPY . .

# Build TypeScript
RUN npm run build


# ==========================================
#  Runtime Stage
# ==========================================
FROM node:24-slim

WORKDIR /app

# Copy only build output and essentials
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY package*.json .npmrc ./

# Configure npm again for GitHub Packages (optional)
ARG NPM_TOKEN
RUN if [ -n "$NPM_TOKEN" ]; then \
      npm config set //npm.pkg.github.com/:_authToken=$NPM_TOKEN; \
    fi

# Install only production dependencies
RUN npm install --omit=dev

# Re-pin extensions package to the same dist-tag used in the build stage
ARG EXTENSION_TAG=latest
RUN npm install @middlegear/kenjitsu-extensions@${EXTENSION_TAG} --omit=dev

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start the server
CMD ["node", "dist/server.js"]