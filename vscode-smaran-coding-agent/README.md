# SMARAN.AI Codex 🚀

<div align="center">

![Version](https://img.shields.io/badge/version-1.3.7-blue?style=for-the-badge&logo=semver)
![VS Code](https://img.shields.io/badge/VS_Code-1.90+-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge&logo=opensourceinitiative&logoColor=white)
![Publisher](https://img.shields.io/badge/publisher-ShashwatMishra-purple?style=for-the-badge&logo=visual-studio-code&logoColor=white)

[![Marketplace](https://img.shields.io/badge/VS_Code_Marketplace-Install-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=ShashwatMishra.smaran-ai-codex)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/shashwatmishra997/SMARAN.AI)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://hub.docker.com/r/shashwatmishra062/smaran-ai)

</div>

---

## ✨ Overview

**SMARAN.AI Codex** is a production-grade AI coding assistant that runs as a VS Code extension, connecting to your local SMARAN.AI backend or cloud model providers. Built with privacy-first architecture, approval-gated actions, and configurable model routing.

> **🎯 One-click install → Connect to localhost:3003 → Start coding with AI**

---

## 🎨 Key Features

### 🧠 **Intelligent Code Assistance**
| Feature | Description |
|---------|-------------|
| 💬 **Chat Console** | Full-featured chat interface in VS Code sidebar |
| 🔍 **Code Explanation** | Select code → Get detailed explanations |
| 🔧 **Smart Refactoring** | AI-powered code refactoring with diff preview |
| 🧪 **Test Generation** | Auto-generate unit test suites |
| 🐛 **Auto-Fix Diagnostics** | Fix errors and warnings with one click |
| ✨ **Code Generation** | Generate code from natural language instructions |

### 🔐 **Security & Privacy First**
- ✅ **Approval-gated actions** — Every file write and terminal command requires explicit confirmation
- ✅ **Workspace-bounded** — Operates only within your opened workspace
- ✅ **Local-first** — Runs on your hardware, no data leaves your machine
- ✅ **VS Code permissions** — Respects Workspace Trust and OS permissions

### 🌐 **Flexible Model Routing**
```
┌─────────────────────────────────────────────────────────────┐
│  LOCAL MODELS (Ollama)          │  CLOUD PROVIDERS          │
├─────────────────────────────────┼────────────────────────────┤
│  qwen2.5-coder:7b              │  OpenAI (GPT-4, GPT-3.5)   │
│  deepseek-coder:6.7b           │  Anthropic (Claude 3.5)    │
│  codellama:7b                  │  Google (Gemini)           │
│  llama3.1:8b                   │  Groq, Together, OpenRouter│
│  ...and 50+ more               │  NVIDIA NIM, Mistral, etc. │
└─────────────────────────────────┴────────────────────────────┘
```

### 🎙️ **Voice & Dictation** (Optional)
- **Microphone button** → Dictate prompts using Web Speech API
- **Speaker button** → Read-aloud last response
- **Auto-read** → Optional automatic read-aloud of responses
- **Language selector** → Shared across dictation, response, and read-aloud locales

### 📎 **Attachment Support**
- Text files (up to 50K chars/file)
- Image files (metadata only in current version)
- Workspace file manifest (60 entries max)

---

## 🚀 Quick Start

### 🎯 One-Command Install (Recommended)

<div align="center">

**Windows PowerShell (Admin):**
```powershell
irm https://raw.githubusercontent.com/shashwatmishra997/SMARAN.AI/main/install-smaran.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/shashwatmishra997/SMARAN.AI/main/install-smaran.sh | sh
```

</div>

> ⚡ **What the installer does:**
> 1. 🔍 Detects Docker & installs Docker Desktop if missing
> 2. 📦 Pulls latest SMARAN.AI image (`shashwatmishra062/smaran-ai:latest`)
> 3. 🔧 Configures Ollama + starter model (`qwen2.5:1.5b`)
> 4. 🌐 Starts container on `localhost:3003` with health checks
> 5. 🌍 Opens browser automatically when ready
> 6. 📊 Starts **Windows Host Telemetry Bridge** for real GPU/CPU metrics

### 🐳 Manual Docker Start
```bash
docker run -d \
  --name smaran-ai \
  -p 3003:3003 \
  -v smaran_data:/app/data \
  --restart unless-stopped \
  shashwatmishra062/smaran-ai:latest
```

Then open: **http://localhost:3003**

---

## ⚙️ Extension Configuration

Open VS Code Settings (`Ctrl+,`) → Search **SMARAN.AI**:

| Setting | Default | Description |
|---------|---------|-------------|
| `smaran.backendUrl` | `http://localhost:3003` | Backend endpoint URL |
| `smaran.defaultModel` | `auto` | Default model (auto, deepseek-coder, claude-3.5-sonnet, qwen-2.5-coder) |
| `smaran.enableHeadroomCompression` | `true` | Enable context preparation |
| `smaran.autoApplyDiffs` | `false` | Auto-apply file edits without diff preview |

---

## 🎮 Usage Guide

### 🎯 **Opening the Console**
- **Command Palette** (`Ctrl+Shift+P`) → `SMARAN.AI: Open Console`
- Click **SMARAN.AI icon** in Activity Bar
- Keyboard shortcut: Configure in `Keyboard Shortcuts` → `smaran.startAgent`

### 💻 **Editor Integration**
Right-click in editor → **SMARAN.AI** submenu:
- `Explain Selected Code` 📖
- `Refactor Selection` 🔧
- `Generate Unit Tests` 🧪
- `Auto-Fix Error` 🐛

### ⌨️ **Keyboard Shortcuts** (Customizable)
| Action | Default | Command ID |
|--------|---------|------------|
| Open Console | *None* | `smaran.startAgent` |
| Generate Code | *None* | `smaran.generateCode` |
| Explain Code | *None* | `smaran.explainCode` |
| Refactor Code | *None* | `smaran.refactorCode` |
| Generate Tests | *None* | `smaran.generateTests` |
| Fix Diagnostics | *None* | `smaran.fixDiagnostics` |

> 💡 **Tip:** Bind shortcuts in `File → Preferences → Keyboard Shortcuts` → Search `smaran`

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS CODE EXTENSION                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Sidebar    │  │  Webview    │  │  Extension Host         │ │
│  │  (Activity  │  │  (Chat UI)  │  │  • Context Builder      │ │
│  │   Bar)      │  │             │  │  • Action Validator     │ │
│  └──────┬──────┘  └──────┬──────┘  │  • Model Router         │ │
│         │                │         │  • Telemetry Client     │ │
│         └────────┬───────┘         └───────────┬─────────────┘ │
│                  │                              │              │
│                  ▼                              ▼              │
│         ┌─────────────────────────────────────────────────┐   │
│         │           HTTP / WebSocket                      │   │
│         └─────────────────────────────────────────────────┘   │
└────────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SMARAN.AI BACKEND                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ Ollama  │ │ vLLM    │ │ RAG     │ │ Web     │ │ Plugins │  │
│  │ Local   │ │ Cloud   │ │ Engine  │ │ Search  │ │ (MCP)   │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Real Hardware Telemetry (Windows)

For **accurate GPU/CPU/RAM metrics** matching Windows Task Manager:

```powershell
# Run once to enable real hardware detection
.\run-host-telemetry.ps1
```

**What it does:**
- Runs telemetry bridge **natively on Windows** (not in Docker VM)
- Detects: NVIDIA RTX (VRAM, temp, usage), AMD, Intel GPUs
- CPU: Real cores, threads, usage %, frequency
- RAM: Total/used/available, disk I/O, network
- Writes to `%LOCALAPPDATA%\SMARAN.AI\telemetry\host_stats.json`
- Docker container reads via bind mount → Shows in Performance Panel

---

## 🎨 Screenshots



---

## 🛠️ Development

### Prerequisites
- Node.js 18+
- VS Code 1.90+
- TypeScript 5.9+

### Build & Run
```bash
cd vscode-smaran-coding-agent
npm install
npm run compile          # Compile TypeScript
npm run watch            # Watch mode for development
```

### Package for Marketplace
```bash
npm install -g @vscode/vsce
vsce package
# Creates: smaran-ai-codex-1.3.4.vsix
```

### Publish to Marketplace
```bash
vsce publish
# Or: vsce publish patch/minor/major
```

---

## 📁 Project Structure

```
vscode-smaran-coding-agent/
├── src/
│   ├── extension.ts          # Main entry point
│   ├── chatView.ts           # Webview panel provider
│   ├── contextBuilder.ts     # Workspace context gathering
│   ├── modelRouter.ts        # Local/cloud model routing
│   ├── actionValidator.ts    # Approval-gated actions
│   ├── telemetryClient.ts    # Real-time metrics
│   └── utils/
├── media/
│   ├── agent.svg             # Extension icon
│   └── agent.png             # Marketplace icon
├── out/                      # Compiled JavaScript
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript config
└── README.md                 # This file
```

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push branch: `git push origin feature/amazing-feature`
5. Open Pull Request

---

## 📄 License

**MIT License** — Free for personal and commercial use.

Copyright (c) 2024-present **Shashwat Mishra**

---

## 👨‍💻 Developer

<div align="center">

**Created with ❤️ by Shashwat Mishra**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/sm980/)
[![Portfolio](https://img.shields.io/badge/Portfolio-Visit-6366F1?style=for-the-badge&logo=vercel&logoColor=white)](https://shashwatmishra-portfolio.netlify.app/)
[![GitHub](https://img.shields.io/badge/GitHub-Follow-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/shashwatmishra997)

</div>

---

## 🙏 Acknowledgments

- **VS Code Team** — Extensible editor platform
- **Ollama** — Local LLM runtime
- **vLLM** — High-throughput inference
- **Lucide** — Beautiful icons
- **Tailwind CSS** — Utility-first styling
- **All Contributors** — Issues, PRs, feedback

---

<div align="center">

**⭐ Star the repo if you find it useful!**

[![GitHub Stars](https://img.shields.io/github/stars/shashwatmishra997/SMARAN.AI?style=social)](https://github.com/shashwatmishra997/SMARAN.AI/stargazers)

</div>