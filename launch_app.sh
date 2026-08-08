#!/usr/bin/env bash
# ====================================================================
# SMARAN.AI — Universal macOS & Linux System Launcher
# ====================================================================
# Developed by SHASHWAT MISHRA (https://www.linkedin.com/in/sm980/)
# ====================================================================

set -e

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║              SMARAN.AI — SYSTEM ENGINE LAUNCHER                  ║"
echo "║              100% Offline Universal Enterprise AI                ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Check Docker installation
if ! command -v docker &> /dev/null; then
    echo "❌ [ERROR] Docker is not installed or not in PATH."
    echo "Please install Docker Desktop (macOS/Windows) or Docker Engine (Linux)."
    exit 1
fi

echo "🟢 [1/2] Pulling latest SMARAN.AI production engine..."
docker pull shashwatmishra062/smaran-ai:latest

echo "🚀 [2/2] Starting SMARAN.AI container..."
docker compose up -d --build --force-recreate app

echo ""
echo "===================================================================="
echo "    🟢 SMARAN.AI IS ONLINE & READY!"
echo "    💻 Desktop Access: http://localhost:3003"
echo "    📱 Mobile / LAN Access: http://$(hostname -I | awk '{print $1}'):3003"
echo "===================================================================="
echo ""
