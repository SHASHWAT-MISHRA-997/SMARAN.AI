# -----------------------------------------------------------------------------
# SMARAN.AI - Production Dockerfile
#  Python FastAPI backend serving bundled pre-built frontend
#  Auto-detects host hardware via bootstrapper.py at container startup
#  Supports multi-GPU telemetry via nvidia-smi / host_stats.json / WMI (AMD + NVIDIA)
# -----------------------------------------------------------------------------

FROM python:3.11-slim AS production

LABEL org.opencontainers.image.title="SMARAN.AI"
LABEL org.opencontainers.image.description="SMARAN.AI - Enterprise AI Workspace with OmniRoute Multi-LLM Router, Headroom Compression, Deep RAG, MCP Hub, and SMARAN.AI Coding Agent Extension for VS Code & Google Antigravity IDE."
LABEL org.opencontainers.image.version="2.5.0"
LABEL org.opencontainers.image.vendor="SMARAN AI"
LABEL maintainer="shashwatmishra062"
LABEL org.opencontainers.image.docker.cmd="docker run -p 3003:3003 shashwatmishra062/smaran-ai:app-v2.5.0"
LABEL org.opencontainers.image.source="https://github.com/shashwatmishra062/GMRPL-AI-ASSISTANT"
LABEL org.opencontainers.image.documentation="https://github.com/shashwatmishra062/GMRPL-AI-ASSISTANT/blob/main/README.md"
LABEL org.opencontainers.image.features="OmniRoute,Headroom,Claude-Mem,MCP-Hub,CodingAgent"

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libgl1 \
    libglib2.0-0 \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ ./app/
COPY backend/bootstrapper.py ./bootstrapper.py
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY backend/frontend_dist/ ./frontend_dist/

# SMARAN.AI Coding Agent Extension for VS Code & Google Antigravity IDE
COPY vscode-smaran-coding-agent/ ./vscode-smaran-coding-agent/

RUN mkdir -p ./data/uploads ./data/chroma ./data/models

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:3003/api/test/ping -o /dev/null -s || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
