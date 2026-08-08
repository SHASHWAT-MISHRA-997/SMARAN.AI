# ═══════════════════════════════════════════════════════════
#  SMARAN.AI — Production Dockerfile
#  Stage 1: Build Vite React frontend → /app/static
#  Stage 2: Python FastAPI backend serving bundled frontend
# ═══════════════════════════════════════════════════════════

# ── Stage 1: Build React/Vite Frontend ──────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Install dependencies (layer cache: package.json copied first)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --prefer-offline 2>/dev/null || npm install

# Copy all frontend source files
COPY frontend/ ./

# Override outDir for Docker build so output goes to /frontend/dist
# (The vite.config.js sets outDir: '../backend/frontend_dist' for local dev,
#  but we pass --outDir to override it here)
RUN npx vite build --outDir /frontend_build

# ── Stage 2: Production FastAPI Backend ─────────────────────
FROM python:3.11-slim AS production

LABEL org.opencontainers.image.title="SMARAN.AI"
LABEL org.opencontainers.image.description="Smaran AI — Local AI Knowledge Management Platform"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="SMARAN AI"
LABEL maintainer="utkarshsuthar"

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libgl1 \
    libglib2.0-0 \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY backend/app/ ./app/
COPY backend/bootstrapper.py ./bootstrapper.py
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Copy frontend build from Stage 1 into the location FastAPI serves as static
COPY --from=frontend-builder /frontend_build/ ./frontend_dist/

# Create data directories for persistent volumes
RUN mkdir -p ./data/uploads ./data/chroma

# Port 3003 = FastAPI backend + serves frontend static files
EXPOSE 3003

# Health check so Docker Desktop shows green status
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:3003/api/test/ping -o /dev/null -s || exit 1

# Start FastAPI
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
