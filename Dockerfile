# ═══════════════════════════════════════════════════════════
#  SMARAN.AI — Production Dockerfile
#  Python FastAPI backend serving bundled pre-built frontend
# ═══════════════════════════════════════════════════════════

FROM vllm/vllm-openai:v0.8.5.post1 AS production

LABEL org.opencontainers.image.title="SMARAN.AI"
LABEL org.opencontainers.image.description="Smaran AI — Local AI Knowledge Management Platform"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="SMARAN AI"
LABEL maintainer="utkarshsuthar"

RUN printf 'precedence ::ffff:0:0/96  100\n' >> /etc/gai.conf

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
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY backend/app/ ./app/
COPY backend/bootstrapper.py ./bootstrapper.py
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Copy pre-built frontend static bundle directly into container
COPY backend/frontend_dist/ ./frontend_dist/

# Create data directories for persistent volumes
RUN mkdir -p ./data/uploads ./data/chroma

# Port 3003 = FastAPI backend + serves frontend static files
EXPOSE 3003

# Health check so Docker Desktop shows green status
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:3003/api/test/ping -o /dev/null -s || exit 1

# Start the local vLLM engine and FastAPI in one Windows Docker Desktop container.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
