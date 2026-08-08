FROM python:3.10-slim

# Install system dependencies needed for compiling packages and python-magic
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Run pip-audit to scan for vulnerabilities during the build
RUN pip install --no-cache-dir pip-audit && (pip-audit --local || true)

# Copy application code
COPY . .

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
