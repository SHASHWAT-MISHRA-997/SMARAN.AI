# -----------------------------------------------------------------------------
# SMARAN.AI - Production Dockerfile
#  Python FastAPI backend serving bundled pre-built frontend
#  Auto-detects host hardware via bootstrapper.py at container startup
#  Supports multi-GPU telemetry via nvidia-smi / host_stats.json / WMI (AMD + NVIDIA)
# -----------------------------------------------------------------------------

FROM python:3.11-slim AS production

LABEL org.opencontainers.image.title="SMARAN.AI"
LABEL org.opencontainers.image.description="Local AI workspace with responsive chat, source-labelled telemetry, uploaded-file RAG, web search, local voice, and user-configured model routing."
LABEL org.opencontainers.image.version="2.8.5"
LABEL org.opencontainers.image.vendor="SMARAN AI"
LABEL maintainer="shashwatmishra062"
LABEL org.opencontainers.image.docker.cmd="docker run -p 3003:3003 shashwatmishra062/smaran-ai:latest"
LABEL org.opencontainers.image.source="https://github.com/shashwatmishra997/SMARAN.AI"
LABEL org.opencontainers.image.documentation="https://github.com/shashwatmishra997/SMARAN.AI/blob/main/README.md"
LABEL org.opencontainers.image.features="ResponsiveChat,LocalVoice,SourceLabelledTelemetry,UploadedFileRAG,WebSearch,ModelRouting"

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    espeak-ng \
    libgl1 \
    libglib2.0-0 \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Model downloads must live in the persistent /app/data volume used by every
# supported launcher. Keeping HF_HOME in /root would lose weights on update.
ENV DATA_DIR=/app/data \
    HF_HOME=/app/data/models \
    HUGGINGFACE_HUB_CACHE=/app/data/models/hub

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ ./app/
COPY backend/bootstrapper.py ./bootstrapper.py
COPY host_telemetry_bridge.py /opt/smaran/host_telemetry_bridge.py
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY backend/frontend_dist/ ./frontend_dist/

# SMARAN.AI Coding Agent Extension for VS Code & Google Antigravity IDE
COPY vscode-smaran-coding-agent/ ./vscode-smaran-coding-agent/

RUN mkdir -p ./data/uploads ./data/chroma ./data/models/hub

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:3003/api/test/ping -o /dev/null -s || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
