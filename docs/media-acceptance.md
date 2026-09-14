# Video and image generation — acceptance evidence

Measured on the machine this was built for: **RTX 2060, 6 GB VRAM, 16.6 GB
system RAM, Windows 11**. Every number below was produced by running the
thing, not estimated. Where something is impossible on this hardware it says
so and shows the arithmetic, because "slow" and "cannot" are different
answers and only one of them is worth waiting for.

Date: 2026-09-14.

---

## 1. A video is produced, and it is a real video

| Check | Evidence |
|---|---|
| A clip renders end to end | `data/video/smoke.mp4`, sha256 `964e8926068da38e242a5abc…`, 56,608 bytes |
| It is the size that was planned | ffmpeg reports `736x416`, `24 fps`, `Duration 00:00:01.38` |
| It contains the frames claimed | 33 frames decoded to raw RGB and counted |
| It is not a still image | mean per-frame change 0.66; **0 identical consecutive frames**; first vs last frame differs by 6.16 |
| It is not washed out | mean brightness 102.4, **0.54 %** of pixels blown out (the old 704×480 configuration measured 29 %) |
| Wall clock | 2,309 s (38.5 min) total: 138 s prompt encode, 14 s pipeline load, the rest diffusion and decode |

Prompt: *"a paper lantern drifting slowly upward through a misty pine forest at
dawn…"*. The rendered clip shows a lantern glowing through fog between pine
trunks, i.e. the prompt was followed.

## 2. The crash that made all of this unreachable

Loading the text encoder **segmentation faulted** — no Python exception, no log
line, the process simply died. Confirmed with `faulthandler` to be inside
`transformers/core_model_loading.py:970 materialize_tensors`.

| | Before | After |
|---|---|---|
| Text encoder load | segfault (exit 139) | 26 s |
| RAM held while loading it | ~9.5 GB attempted, 8.6–9.3 GB available | ~2.7 GB |
| Full generation | never completed | 38.5 min, file on disk |

Component sizes on disk, which is where the problem comes from:
`text_encoder` 19.05 GB · `transformer` 7.69 GB · `vae` 1.68 GB.

## 3. Shape

`plan_clip()` output at 2 s:

| Asked | Got |
|---|---|
| 16:9 | 736×416 |
| 9:16 | 416×736 |
| 1:1 | 544×544 |
| 4:3 | within 12 % of 1.333 |

All sizes are multiples of 32 (the model errors otherwise). Verified by
`tests/test_video_aspect_and_duration.py`.

## 4. Length

`plan_sequence()`, requested vs planned, all at one fixed size so the clips can
be joined:

| Requested | Chunks | Planned total | Estimate |
|---|---|---|---|
| 1.5 s | 1 | 1.4 s | ~48 min |
| 2 s | 1 | 1.7 s | ~60 min |
| 3 s | 2 | 2.8 s | ~85 min |
| 5 s | 3 | 4.8 s | ~2.8 h |
| 10 s | 6 | 9.9 s | ~5.8 h |
| 300 s | 176 | 300.0 s | **~175 h** |

Planning is arithmetic, not a trial run: 300 s plans in 0.032 s.

A single pass is capped by the decode, which holds every frame at full
resolution in VRAM at once — not by time. At 736×416 that cap is 43 frames.

## 5. What is not possible here, with the numbers

These are not "slow". They do not fit in 6 GB and no setting changes that.

| Asked for | Over the decode budget by |
|---|---|
| 5 min in one pass | 172× (~180 h) |
| 1 s at 4K | 15× — will not decode at all |
| 1 s at 8K | 60× |
| 5 min at 4K | 4,524× (~197 days) |

What is offered instead, labelled as such in the code and in the API response:

* **Longer** — a chain of continuations, each conditioned on the previous
  clip's last frame. Moves forward; does not loop. Not one unbroken shot.
* **Larger** — Lanczos enlargement of a finished clip to HD/QHD/4K/8K.
  Verified to hit the exact target height with the aspect preserved and an
  even width. **Adds no detail**, and the result string says so.

## 6. Sound

The video model has **no audio head**. It cannot produce sound, and nothing in
this repository pretends otherwise.

A soundtrack can be generated from the same prompt by MusicGen and muxed
underneath. That model never sees the picture, so it will not match the
action. Weights are ~2.2 GB and are **not downloaded unless asked for** — at
the time of writing they are not installed here, and `status()` says so rather
than inventing a tone generator.

Muxing itself is verified without the model, against real ffmpeg: a silent
clip reports no audio, a muxed clip reports audio, a 5 s track under a 1 s clip
produces a 1 s file, and the video stream is copied rather than re-encoded.
`has_audio()` reads the file rather than trusting that ffmpeg was asked.

## 7. Prompt reading

Shape and duration are read from the sentence. The dangerous direction is a
false positive: it deletes words before the model sees them.

Read correctly: `"5 second"`, `"3 second ka"`, `"10 sec"`, `"2s"`, `"12 sekand"`,
`"5 minute"`, `"9:16"`, `"portrait mode"`, `"vertical video"`, `"in portrait"`,
`"landscape format"`, `"widescreen"`, `"square video"`, `"reels"`.

Correctly **not** read as a shape, with the prompt left byte-identical:
`"a video of a mountain landscape at sunrise"`, `"paint a portrait of a woman"`,
`"a video of a wide river"`, `"a square table"`, `"a man in shorts"`,
`"make a short video"` (a length, not a shape).

## 8. Guard rails

* Chat will not start a job estimated over **3 hours** without being asked
  again. It quotes the chunk count and the hours instead.
* An impossible request is refused in under a second, with the longest length
  that would work at that size — and that offer is checked to be true.
* A soundtrack or enlargement failure never discards a clip that took an hour
  to render; it is reported in the job messages.

## 9. Tests

`581` backend tests and `180` frontend tests pass. Frontend requires
`node --experimental-vm-modules --test "tests/*.test.mjs"`.

Covering this area specifically:

* `tests/test_video_memory_path.py` — the segfault. Pins structure, not
  behaviour, because loading the weights on the test machine would reproduce
  the crash it guards against.
* `tests/test_video_aspect_and_duration.py`
* `tests/test_video_prompt_options.py`
* `tests/test_video_continuity.py` — exercises the real ffmpeg binary
* `tests/test_video_soundtrack.py`

## 10. Bugs found and fixed while building this

Each would have been silent:

1. A new `/plan` route was named `plan`, shadowing `from .planner import plan`
   at module level, so `/capabilities` began calling the wrong function.
2. Chunk lengths were multiplied out: a 2 s request planned 3.4 s of video,
   counted against a length the renderer would then snap down.
3. Chunks were planned independently, so the planner shrank resolution for a
   short tail — producing clips of different sizes, which cannot be
   concatenated at all.
4. Every decode check re-probed the GPU; a long plan queried it thousands of
   times to answer a question that is pure arithmetic.
5. A huge request started its frame search at 2.4 million frames and stepped
   down by 8 — about 180 million iterations. 322 s → 0.104 s.

## 11. Images

Measured on the same machine, Stable Diffusion 1.5 at 20 steps:

| Size | Time | Peak VRAM |
|---|---|---|
| 512 | 7.1 s | 2.08 GB |
| 640 | 9.8 s | 2.50 GB |
| 768 | 15.3 s | 3.25 GB |
| 896 | 52.3 s | 4.46 GB |
| 1024 | **339.2 s** | 6.30 GB — past the card, so it thrashes |

The default was **384×384 with a hard ceiling of 512**. It is now 768, chosen
from free VRAM against those peaks. SD 1.5 is capped at 768 whatever the card
holds: past roughly its training resolution it draws a second head rather than
more detail, so more pixels would be a worse picture, not a sharper one.

**The shipped defaults returned a black image.** Same prompt, same card, same
model, both measured from the files on disk:

| | Before | After |
|---|---|---|
| Size | 384×384 | 768×768 |
| Bytes | **509** | 1,222,980 |
| Mean pixel value | **0.00** | 112.61 |
| Every pixel identical | **yes** | no |
| Time | 44 s | 18 s |

Two steps through SD 1.5 produces noise, the safety checker reads noise as a
false positive and substitutes a black frame, and that was saved and reported
as the finished picture. Steps and guidance now follow the model family — a
turbo model wants 4 steps at guidance 0, SD 1.5 wants 25 at 7.5 — and a blank
frame is refused rather than saved.

Shape: 1:1, 16:9, 9:16, 4:3, 3:4, every size a multiple of 8.
QHD/4K/8K are Lanczos enlargement, and the result says so in the same breath
as the size.

Read correctly from a prompt: `"4K"`, `"QHD"`, `"8K"`, `"HD"`, `"UHD"`,
`"portrait photo"`, `"landscape image"`, `"square picture"`.
Correctly **not** read, with the prompt left byte-identical:
`"a portrait of a woman"`, `"a photo of a mountain landscape"`,
`"a painting of a wide valley"`, `"a square table in a sunlit room"`.

The model is whichever is already on disk, so asking for a picture never
starts an unannounced download.

## Not done

* Native QHD/4K/8K rendering, for video or for images — this card cannot do
  either, see §5 and §11. Both are offered as enlargement, labelled as such.
* A five minute clip has not been *run*, only planned. At ~175 h it has not
  been started, and the estimate is labelled "at most".
* Image detail beyond 768 would need a different model (SDXL) or a tiled
  refine pass. Neither is installed, and neither is fetched without asking.
