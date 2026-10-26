# TASKS — in progress & planned

## In progress

- [ ] **Post-push CI confirmation** — the full audit runs in CI for the first
  time on this commit; watch the workflow once, then close. (gate: none —
  operational check of the new CI step)
- [ ] **Vision-model spot check of rendered slides** — `d2_pptx_render` output
  is verified by machine checks (PNG magic, dimensions, size) but no native
  vision model was available in the authoring environment (base model declares
  no image input; no vision provider configured). First session with a
  vision-capable model should render 2–3 decks and eyeball shape/text fidelity.
  (doc: close or file findings into HISTORY)

## Planned

- [ ] **P4-A: segment-accurate pptx connector routes** — today a d2 route
  (bezier with waypoints) exports as one straight `line` shape (bbox diagonal).
  Decompose svgmap routes into straight segments, emit one `line` shape per
  segment, arrowhead on the last only. Needs a fidelity check comparing
  segment count vs svg path samples. (fix + new gate candidate G7)
- [ ] **P4-B: multiboard pptx export** — `d2_pptx` exports the root board;
  `layers/scenarios/steps` boards are skipped (register F7). Export one slide
  per board; `d2_pptx_render` already handles multi-slide decks.
- [ ] **P4-C: sequence-diagram pptx fidelity** — actor lifelines/spans/notes
  currently approximate. Either special-case mapping or keep documented NOTE.
- [ ] **Audit plane for sub-boards** — G1–G4 gate the root board only; extend
  `extract` usage to iterate `model.boards` so `layers.internals` etc. are
  gated too (composition.d2 has 3 unlabeled conns on internals today).
- [ ] **Trend dashboard** — `runs/*.json` accumulate; add a tiny script that
  diffs consecutive runs (new files, gate flaps, metric drift) for HISTORY
  entries. Low priority while run count is small.

## Done (moved from this list)

- see HISTORY.md
