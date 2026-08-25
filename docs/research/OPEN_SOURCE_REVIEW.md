# Two suggested projects, read before borrowing anything

Verified: **2026-08-26**

## Anil-matcha/Open-Generative-AI

MIT licence, JavaScript, 27,109 stars, last pushed 2026-08-24.

Its headline is "500+ models (Flux, Midjourney, Kling, Sora, Veo)". Those are
not weights it ships. They are reached through **Muapi**, a paid service the
app asks you for a key to: "You'll be prompted to enter your Muapi API key on
first use". Midjourney, Sora and Veo have no open weights to ship.

It does have local inference, and this is the genuinely interesting part:

- **sd.cpp** for images — "runs on CPU (all platforms) and Metal GPU on Apple
  Silicon; CUDA/Vulkan/ROCm on Linux/Windows". CPU-capable image generation is
  exactly what a machine with no usable GPU needs.
- **Wan2GP** for video — but "The app does not bundle Python or model weights
  for Wan2GP. You run Wan2GP yourself on a machine with a CUDA or ROCm GPU and
  point the desktop app at its URL." Its own table calls Wan 2.2 "Slow on
  consumer GPUs".

Its business model is resale: "set your own credit/subscription prices for end
users, keep the margin". That is the opposite of a free product.

**Verdict.** The MIT licence means its code can be read and reused freely. The
idea worth taking is sd.cpp for image generation on machines without a usable
GPU. Its video story is a pointer at a service you host separately, which is
less than SMARAN.AI already does locally.

## calesthio/OpenMontage

**AGPL-3.0**, Python, 50,267 stars, last pushed 2026-08-22.

An agentic video production system: pipelines, tools and skill files that plan
a production from a source clip. The planning layer is real work.

Two findings decide this one.

**The generation is not free.** The tools it orchestrates need paid keys —
`ATLASCLOUD_API_KEY` for "Seedream/Nano Banana/GPT Image + Kling/Seedance/
Hailuo video", `KLING_API_KEY` for "Official Kling video, image, TTS, avatar,
lip sync". OpenMontage decides *what* to generate; somebody else's paid API
generates it.

**The licence is incompatible with shipping a closed app.** AGPL-3.0 is strong
copyleft. Distributing software that incorporates AGPL code obliges you to
offer the complete corresponding source of the whole combined work under the
same terms, and its network clause extends that to users reached over a
network. SMARAN.AI is distributed as an installer and its source is not
published. Taking code from here would require publishing all of it.

**Verdict.** Do not copy code from it. Its *approach* — break a long piece into
shots, plan them, assemble on a timeline — is an idea, and ideas are not
licensed. That approach is already what the master specification describes in
section 28, and implementing it independently is unaffected by AGPL.

## What neither one gives us

Free local video generation. LTX-Video, running locally on this machine, is
already further along than either: no key, no external service, no per-clip
charge. Both of these are orchestration layers, and underneath both the actual
pixels come from a paid API.
