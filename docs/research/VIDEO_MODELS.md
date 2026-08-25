# Video generation: what the sources actually say

Every figure below was read from the project's own repository or model card on
the date given. Nothing here is inferred from a benchmark blog, a comparison
article or from what a model "should" need. Where a source does not state a
number, this file says so rather than supplying one.

Verified: **2026-08-26**

## The machine this was checked against

Read from the running app's own hardware report, not assumed:

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 2060 |
| VRAM | 6.0 GB |
| System RAM | 15.42 GB |

## Stated requirements

| Model | Minimum VRAM stated | Source |
|---|---|---|
| HunyuanVideo | **45 GB** (544x960, 129 frames), 60 GB at 720p | [README](https://github.com/Tencent-Hunyuan/HunyuanVideo) |
| LTX-Video (13B distilled LoRA) | **1 GB** | [README](https://github.com/Lightricks/LTX-Video) |
| CogVideoX | not stated in the README | [README](https://github.com/THUDM/CogVideo) |
| Wan2.1 | not stated in the README | [README](https://github.com/Wan-Video/Wan2.1) |

HunyuanVideo's README words it directly: "The minimum GPU memory required is
60GB for 720px1280px129f and 45G for 544px960px129f", and it recommends 80 GB.
Against 6 GB that is not a tuning problem. It is not usable here, and no
quantisation closes a gap of that size.

## Licences — code and weights are not the same thing

| Model | Code licence | Weights licence (Hugging Face) |
|---|---|---|
| LTX-Video | Apache-2.0 | **other** (custom terms) |
| CogVideoX-2b | — | **apache-2.0** |
| CogVideoX-5b | — | other |
| HunyuanVideo | — | other |

LTX-Video ships an Apache-2.0 LICENSE file in its repository while its weights
are published under custom terms. Reading the repository licence alone and
concluding the weights are Apache-2.0 would be wrong, and it is the exact
mistake this table exists to prevent. "other" is not a refusal — it means the
terms must be read before the model is enabled under a commercial-safe
setting, and that has not been done yet.

## On duration

LTX-Video's release notes for v0.9.8 (July 2025) advertise distilled models
with "up to 60 seconds of video". That is the longest single-generation figure
any of these projects states.

For context on what the large models produce: HunyuanVideo's memory table is
quoted for **129 frames**, which at 24 fps is about 5.4 seconds — on an 80 GB
card. Minutes-long output from one generation is not something any of these
models claims, at any hardware level.

Longer pieces are assembled from short shots on a timeline. That is the
approach the master specification already describes in section 28, and it is
the only honest route to a five-minute video today.

## Not yet verified

Recorded as unknown rather than guessed:

- CogVideoX-2b and Wan2.1 VRAM figures. Neither README states one; the model
  cards and inference code need reading before either is offered.
- Whether LTX-Video's 1 GB figure holds for image-to-video as well as
  text-to-video, and at what resolution and frame count.
- The actual terms behind each "other" weights licence.
- Measured speed on a 6 GB RTX 2060. No number here is a measurement — they
  are all vendor claims, and vendor claims are made on datacentre hardware.
