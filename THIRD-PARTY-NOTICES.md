# Third-party material

SMARAN.AI's own code is MIT licensed — see LICENSE. That file is the MIT text
and nothing else: a note appended to it, even a true one, stopped GitHub
recognising the licence and it showed as "Other" instead of MIT. Anything that
checks for an OSI-approved licence reads that detection, so the qualification
lives here instead.

The MIT licence covers the code in this repository. It does not cover
third-party material distributed alongside it, or models downloaded at
runtime, each of which keeps its own licence. This file records what those
are, because a licence claiming to cover everything in the repository would be
claiming more than is true.

## Bundled in the repository and the installer

| What | Where | Licence |
|---|---|---|
| MediaPipe Tasks (WASM + hand-tracking models) | `backend/frontend_dist/mediapipe/` | Apache-2.0, Google |
| Inter | `backend/frontend_dist/assets/inter-*` | SIL Open Font License 1.1 |
| JetBrains Mono | website | SIL Open Font License 1.1 |
| React, Vite, Tailwind, lucide-react, three.js, @pixiv/three-vrm, Capacitor | `frontend/package.json` | MIT / Apache-2.0, each its own |
| FastAPI, uvicorn, SQLAlchemy, ChromaDB, faster-whisper, PyInstaller and the rest | `backend/requirements.txt` | MIT / BSD / Apache-2.0, each its own |

## The character model — provenance unknown

`backend/frontend_dist/characters/evelyn/` is an MMD model in PMX format,
shipped in the installer and shown as the character in voice mode.

**Its terms are not recorded anywhere in this repository.** There is no
readme, no licence file and no author credit alongside it, and the PMX header
carries no usage terms that can be read out.

That matters because MMD models almost always come with conditions set by
whoever made them — some forbid redistribution, some forbid commercial use,
some require credit. Shipping one in an installer without knowing which
applies is a real risk, and it is not resolved by this file saying so.

If you know where it came from, record the source and its terms here. If you
do not, the safe course is to replace it with a model whose licence is
written down.

## Not bundled — installed by the user, and not covered by this repository

These are separate projects that SMARAN.AI can drive when you install them.
None of their code is here.

| Project | Licence | Reached by |
|---|---|---|
| [Ollama](https://ollama.com) and the models you pull | MIT (Ollama); models vary — check each | Local HTTP API |
| [Voicebox](https://github.com/jamiepine/voicebox) | MIT | Local REST API and its MCP server |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | Apache-2.0 | Its command line |
| [Meetily](https://github.com/Zackriya-Solutions/meetily) | MIT | Files it exports |
| [Paperclip](https://github.com/paperclipai/paperclip) | MIT | Its command line |
| [google/agents-cli](https://github.com/google/agents-cli) | Apache-2.0 | Its command line |
| MCP servers you add | Each its own | Model Context Protocol |
| Skill repositories you install | Each its own | Cloned to `~/.smaran/skills` |

Skills and MCP servers installed this way live outside the repository and
outside the installer, so their licences apply to them and not to SMARAN.AI.
That includes copyleft ones: OpenMontage, for instance, is AGPL-3.0, and
cloning it into your own skills folder does not put SMARAN.AI under the AGPL,
because none of it is distributed here.

## Models downloaded at runtime

Local models are fetched by you, from Ollama or Hugging Face, and are not part
of this repository or its installer. Some carry restrictions that MIT does not
— Ideogram 4, for example, publishes its inference code under Apache-2.0 but
its weights under a non-commercial agreement. Check the licence of any model
before relying on it commercially.
