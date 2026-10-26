# STATUS — current

**Last full run: 2026-10-26T14:08Z — ALL GATES GREEN** (`runs/2026-10-26T14-08-19-472Z.json`)

```
G1=pass  every example renders with its pinned vars
G2=pass  showcase + model-views pin layout engine and theme (R1)
G3=pass  showcase + model-views label every connection (R5)
G4=pass  showcase aspect in 0.4..2.5 band (R2)
G5=pass  pptx export -> read-back fidelity (23/23, 2 sequence NOTEs)
G6=pass  every exported pptx rasterizes to valid PNGs (23/23)
```

Corpus: 23 files — showcase 8, model-views 4, comprehension 8, adversarial 3.

Known non-blocking approximations (recorded in every run JSON):

- `sequence.d2`, `cqrs-sequence.d2`: pptx export of sequence diagrams is an
  approximation (spans/notes map to text boxes); logged as NOTE, not FAIL.
- pptx connectors are straight `line` preset shapes — d2's curved routes are
  flattened. See TASKS.md (planned: segment-accurate routes).
