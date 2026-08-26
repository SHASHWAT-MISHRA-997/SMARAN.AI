# Every modality conversion: what is possible here, and on what terms

Verified **2026-08-26** against the Hugging Face API, which is also where you
can check any line of this yourself — every model below is a public page.

Two things are stated on every row because both decide whether something can
ship: the **weights licence**, which is not always the repository's licence,
and the **real download**, which is not the repository's size.

## The size trap, stated once

A repository total counts every variant it holds — fp32 alongside fp16, `.bin`
alongside `.safetensors`. Loading in fp16 touches one set. SDXL's repository is
50 GB; the fp16 weights a pipeline actually fetches are **7.1 GB**. LTX-Video's
repository is 254 GB against a **28.4 GB** load. Quoting the repository total
would rule out models that fit comfortably.

## Already working in SMARAN.AI

Not to be rebuilt.

| Conversion | How | State |
|---|---|---|
| text → text | local Ollama, or a provider key | working |
| text → software | the coding assistant; this is its main job | working |
| speech → text | faster-whisper, installed | working |
| text → speech | edge-tts, installed | working |
| image → text | vision models in the catalogue | working |
| text → video | LTX-Video, local | working, ~9 min a clip |
| image → video | LTX image-to-video, same weights | code present, untested |
| video → images | FFmpeg 9.0, installed | trivial, not yet exposed |

## Candidates, with the terms

| Conversion | Model | Weights licence | fp16 download | On 6 GB |
|---|---|---|---|---|
| text → speech | `hexgrad/Kokoro-82M` | **apache-2.0** | 82M params | comfortable |
| text → image | `stable-diffusion-v1-5` | creativeml-openrail-m | **2.7 GB** | comfortable |
| text → image | `stabilityai/stable-diffusion-xl-base-1.0` | openrail++ | **7.1 GB** | needs offload |
| image → image | `Qwen/Qwen-Image-Edit-2509` | **apache-2.0** | large | no |
| image → image | `black-forest-labs/FLUX.2-klein-4B` | **apache-2.0** | large | unverified |
| image → text | `Salesforce/blip-image-captioning-base` | bsd-3-clause | ~1 GB | comfortable |
| image → 3d | `microsoft/TRELLIS-image-large` | **mit** | **3.3 GB** | comfortable |
| text → 3d | `microsoft/TRELLIS-text-xlarge` | **mit** | — | unverified |
| video → video | `ByteDance-Seed/SeedVR2-3B` | **apache-2.0** | 14.6 GB | no |
| image → video | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` | **apache-2.0** | — | unverified |
| text → video | `Wan-AI/Wan2.1-T2V-1.3B-Diffusers` | **apache-2.0** | 28.9 GB | no |

Kokoro is worth singling out: 82 million parameters, Apache-2.0, and the most
downloaded text-to-speech model on the Hub by an order of magnitude. It runs
on a machine with no GPU at all.

Wan2.1-T2V is only 1.3B parameters and still 28.9 GB, because the download is
dominated by its T5 text encoder rather than by the model that makes pictures.
The parameter count in a model's name is not its download.

## Licences that would bite later

**`facebook/musicgen-*` is `cc-by-nc-4.0`.** Non-commercial. It is the top
result for text-to-audio and would be the obvious choice, and anything made
with it could not be sold or used in a commercial product. Not integrated.

**`coqui/XTTS-v2` is "other"** — Coqui's CPML, which is also non-commercial.
Second most downloaded voice-cloning model, same problem.

**`stabilityai/sdxl-turbo` is "other"**, not openrail like SDXL base. The fast
one and the base one do not share terms.

Where a licence reads "other" it has not been read yet, and this file does not
guess at what it permits.

## Honestly out of reach on this hardware

Not "not yet" — these state requirements far beyond a 6 GB card:

- HunyuanVideo: 45 GB minimum, by its own README
- Qwen-Image-Edit, SeedVR2-3B, Wan2.1-T2V: all above 14 GB

A machine with a larger card runs them; the registry already refuses with the
numbers rather than failing part way through.

## What is not a model problem

- **text → website** is text → code. The assistant already writes HTML, CSS
  and JavaScript. There is nothing to install.
- **speech → speech** is speech → text → text → speech. Every part exists.
- **speech → video** is speech → text → text → video. Same.
- **video → text** is frames out with FFmpeg, then a vision model. Both exist.

Chaining what is here covers more of the list than any new download would.
