# audit/ — quality tracking

This folder is the single source of truth for diagram-quality auditing: what was
found, what fixed it, what prevents it from coming back, and what is still open.

| File | Purpose |
|---|---|
| `STATUS.md` | Current state — gate verdicts from the latest run |
| `TASKS.md` | In-progress and planned work (with owners: gate/fix/doc) |
| `HISTORY.md` | Append-only log of findings and resolutions |
| `runs/<timestamp>.json` | Machine-written full audit results (one per run) |
| `runs/baseline-pre-fixes.json` | Frozen pre-fix baseline (the "previous audit") |
| `example-audit.mjs` | Source plane: G1–G4 |
| `run-audit.mjs` | Entry point: all three planes, writes runs/, exit 1 on any gate FAIL |

## Running

```bash
node audit/run-audit.mjs          # all planes, ~16s locally
node audit/example-audit.mjs      # source plane only
node skills/d2-diagrams/scripts/pptx-fidelity.mjs   # pptx plane only (CLI)
```

CI runs the full audit on every push/PR (`.github/workflows/ci.yml`).

## The three planes

1. **Source plane (G1–G4)** — every example renders with its pinned vars,
   showcase + model-views pin engine/theme (R1), label connections (R5),
   aspect floor 0.4..2.5 (R2). Adversarial fixtures are metrics-only: they
   exist to prove the gates *can* fail.
2. **pptx fidelity plane (G5)** — `d2_pptx` export → `d2_pptx_read` ingest:
   labels, connector counts, geometry drift ≤ 3px.
3. **pptx render plane (G6)** — every exported deck rasterizes to valid PNGs
   (`d2_pptx_render`, resvg) so vision models can consume decks directly.

Scratch dirs `.pptx-fidelity/` and `.audit-render/` are gitignored artifacts.
