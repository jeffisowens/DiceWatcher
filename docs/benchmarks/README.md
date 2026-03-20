# DiceWatcher Benchmarks

These saved benchmark exports capture the local-only recognizer baseline as of March 20, 2026.

Files:

- `canonical-d6-batch-2026-03-20.json`
  - Controlled benchmark batch with one saved fixture for each `d6` face from `1` through `6`
  - This is the canonical pass set for the current prototype

- `face4-stress-batch-2026-03-20.json`
  - Reused multi-shot face-4 robustness batch
  - This is the stress set used to tune face-4 localization and pip-preservation behavior

How to use these files:

1. Load the matching fixture images in the web app batch evaluator.
2. Compare new exported results against these saved baseline exports.
3. Treat regressions on the canonical batch as blockers.
4. Treat changes on the face-4 stress batch as robustness signals.

Current benchmark summary:

- Canonical `1-6` batch is passing
- Face-4 stress batch is passing except for one low-quality localization outlier that may still require retake

Known expectation:

- The prototype remains local-only, `d6`-only, and optimized for controlled tray/background conditions with manual review before send.
