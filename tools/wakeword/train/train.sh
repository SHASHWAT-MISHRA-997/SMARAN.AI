#!/usr/bin/env bash
# Train the "Hey SMARAN" openWakeWord model. Run inside WSL/Linux from
# ~/wwtrain after the setup in README.md. Each stage can be re-run: train.py
# skips clips and features that already exist.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HOME/wwtrain"
source venv/bin/activate

export PIPER_MODEL="$HOME/wwtrain/data/en_US-libritts_r-medium.pt"
# The generator reads "<model>.json" beside the weights; the repo ships it.
[[ -f "$PIPER_MODEL.json" ]] || cp piper-sample-generator/models/en_US-libritts_r-medium.pt.json "$PIPER_MODEL.json"
# piper_train lives at the generator's repo root; the adapter in $HERE stands
# in for the old top-level generate_samples.py that train.py imports.
export PYTHONPATH="$HERE:$HOME/wwtrain/piper-sample-generator${PYTHONPATH:+:$PYTHONPATH}"

cp "$HERE/hey_smaran.yml" ./hey_smaran.yml
# train.py inserts piper_sample_generator_path at the front of sys.path, which
# would find nothing named generate_samples; point it at the adapter instead.
sed -i "s|^piper_sample_generator_path:.*|piper_sample_generator_path: \"$HERE\"|" ./hey_smaran.yml
# Repeat each near-miss phrase custom_negative_repeat times (train.py uses each once).
python - <<'PY2'
import yaml
cfg = yaml.safe_load(open("hey_smaran.yml"))
cfg["custom_negative_phrases"] = cfg["custom_negative_phrases"] * int(cfg.pop("custom_negative_repeat", 1))
yaml.safe_dump(cfg, open("hey_smaran.yml", "w"), allow_unicode=True)
PY2

TRAIN=openWakeWord/openwakeword/train.py
# train.py scores the 11-hour false-positive set as ONE batch: a second 3 GB
# copy on top of the windowed array, which the OOM killer ended at 75% on a
# 8 GB WSL. Same numbers in batches of 8192.
sed -i 's/batch_size=len(X_val_fp_labels)/batch_size=8192/' "$TRAIN"
stage="${1:-all}"
if [[ $stage == all || $stage == clips ]]; then
  python "$TRAIN" --training_config hey_smaran.yml --generate_clips
  python "$HERE/to_16k.py" out/hey_smaran/{positive,negative}_{train,test}
fi
if [[ $stage == all || $stage == augment ]]; then python "$TRAIN" --training_config hey_smaran.yml --augment_clips; fi
if [[ $stage == all || $stage == train ]]; then python "$TRAIN" --training_config hey_smaran.yml --train_model; fi
ls -la out/hey_smaran.onnx 2>/dev/null || true
