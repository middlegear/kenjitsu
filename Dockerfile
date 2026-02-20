# ==========================================
#  Build Stage
# ==========================================
FROM node:24-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json tsconfig.json ./

# Install dependencies
RUN npm install

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
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start the server
CMD ["node", "dist/server.js"]