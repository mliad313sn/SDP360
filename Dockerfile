# ─────────────────────────────────────────────────────────────────────────
#  Endeavour Mining — IT Dashboard Docker Image
#  Node.js 20 LTS (Alpine = small image ~180MB)
# ─────────────────────────────────────────────────────────────────────────
FROM node:20-alpine

# Metadata
LABEL maintainer="Endeavour Mining IT"
LABEL description="SDP Analytics Plus proxy + IT Dashboard"
LABEL version="1.0"

# Create app directory inside container
WORKDIR /app

# Copy package files first (Docker layer caching — only re-installs if deps change)
COPY package.json ./
# Only copy package-lock if it exists
COPY package*.json ./

# Build tools needed for better-sqlite3 native compilation on Alpine
RUN apk add --no-cache python3 make g++

# Install production dependencies only
RUN npm install --omit=dev

# Copy server source and all modules
COPY server.js ./
COPY reports-db.js ./
COPY reports-weekly-pptx.js ./
COPY zoho-sync.js ./

# Copy dashboard files (HTML served as static)
COPY public/ ./public/

# The .env file is NOT copied — it must be provided at runtime via:
#   docker run --env-file .env ...   OR   docker compose (reads .env automatically)
# This keeps credentials out of the image.

# Expose the proxy port (must match PORT in .env or defaults to 3456)
EXPOSE 3456

# Health check — hits the /health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3456/health || exit 1

# Start the server
CMD ["node", "server.js"]
