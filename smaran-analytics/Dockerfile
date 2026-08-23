# Analytics collector. Small on purpose: it receives counters and serves one
# page, so there is nothing here beyond Python and three packages.
FROM python:3.12-slim

WORKDIR /app

# Dependencies first, so a code change does not reinstall them on every build.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py dashboard.html ./

# The database lives on a mounted volume. Without this the file sits in the
# container's own layer and every redeploy silently throws the history away.
VOLUME ["/data"]
ENV ANALYTICS_DB=/data/analytics.db \
    ANALYTICS_HOST=0.0.0.0 \
    ANALYTICS_PORT=8080

EXPOSE 8080

# A container that answers on the port is not the same as one that works, so
# the check asks the API for real numbers.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/summary?days=1',timeout=4).status==200 else 1)"

CMD ["python", "server.py"]
