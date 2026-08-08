#!/bin/sh
set -eu

exec uvicorn app.main:app --host 0.0.0.0 --port 3003 --workers 1
