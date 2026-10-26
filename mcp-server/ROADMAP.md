# MCP strengthening roadmap — robust two-plane diagram delivery

Grounded in the text-vs-visual experiments (`_research/text-vs-visual/`, gitignored)
and the regressions they caught. Every item cites the finding that motivates it.

## What the research established

| Finding | Evidence | Consequence |
|---|---|---|
| Text plane beats vision on structural questions | 42/42 vs 35/42; extended set 78/79 | ids, counts, labels, membership, connectivity, position predicates are **solved** by text |
| Vision's losses were translation + measurement | `secrets` guessed for id `vault`, `datastores.auth_db` for `datastores.authdb`, 2 crossings missed, ties unresolved | the text plane must expose the **join keys** (label→id), not just geometry |
| Vision's wins were unmodeled channels | glyphs, color, gestalt, edge slicing, label overprints | geometry-only analysis is insufficient; defects need **detectors** (now: edgeOverlaps, edgeOverLabels, labelCollisions, zOrder) |
| Text plane produces false positives | `title` left-of `oncall` (1px bbox), members-convention ambiguity, phantom `shape` object | derived predicates need validity filters and documented conventions |
| Prose rules rot | architecture-grid shipped at aspect 5.02 with 7 slicing arrows while the R1–R6 doc existed | only **machine gates + adversarial fixtures** prevent regression |

## Contract: what each plane must be

A diagram is robustly delivered when both planes are **complete** (no blind spot the other
channel could catch), **consistent** (both derived from the same source render),
**translatable** (label↔id, glyph↔shape, color↔class joins exist), and **verifiable**
(intent can be asserted and machine-checked). The source id is the only stable join key;
labels, glyphs and colors are views over it.

## P0 — close the demonstrated gaps — **SHIPPED** (layoutMap returns kind, labels, shape/classes, edge index, tiedWith; degenerate bboxes filtered; battery scores tied answers)

1. ~~**Label→id table**~~ in `d2_layout_map`** — add `labels: {label → id}` (and reverse).
   Kills the single largest vision failure class (4/7 original losses).
2. ~~**Tied relations**~~ — when `left-of`/`above` candidates sit within ε, emit all of them
   (`tiedWith`); battery scorer accepts any tied answer. Evidence: dense `partner_b` (pricing vs inventory, 7px),
   cqrs staleness_window (6-way tie).
3. ~~**Degenerate-bbox filtering**~~ — components with height/width ≤ 2px (titles) leave relation
   derivation. Evidence: the `title left-of oncall` false positive that vision correctly rejected.
4. ~~**Diagram-kind tagging**~~ — `layoutMap.kind: flow | sequence | multiboard` derived from
   boardAttrs + lifeline pseudo-edges (`(X -- )`); move the sequence exemptions out of gate
   regexes into machine-readable metadata; annotate crossings/aspect with kind semantics.
5. ~~**Parallel-edge indexing**~~ — surface `[i]` in edge ids and battery edge-label questions
   (8a./8b. `fetch` ambiguity).
6. ~~**Glyph/style surfacing**~~ — join extract's shape + style (shape kind, dashed, fill class) into
   layoutMap components, so agents read `cylinder + dashed` without pixels and conventions
   (solid=sync, dashed=async) become checkable.

## P1 — robustness capabilities — **SHIPPED** (d2_assert + d2_visual_check tools; relations sidecar v2 with joined geometry; variant ranking by slices → labelSlices → crossings → aspect)

7. ~~**`d2_assert` tool**~~ — intent predicates against measured geometry:
   `X left-of Y`, `no slices`, `aspect in 0.67..1.5`, `hub degree ≤ N` → pass/fail with measured
   values. Closes the agent loop: state intent → render → verify → gate.
8. ~~**`d2_visual_check` tool**~~ — the visual-gate as one MCP call (PASS/FAIL + findings),
   so any agent self-checks before claiming done; CI keeps the CLI version.
9. ~~**Sidecar v2**~~ — one JSON per diagram carrying both planes + join keys:
   objects `{id,label,bbox,shape,style,container}`, edges `{id,src,dst,label,route,overlaps,onTop}`;
   `d2_md_render --sidecars` adopts it as the dual-plane contract.
10. ~~**Bake-off upgrade**~~ — `d2_variants` per-variant edgeOverlaps/edgeOverLabels counts;
    recommendation order becomes (slices, crossings, |aspect−1.6|).

## P2 — human-plane polish — **SHIPPED** (style-stage warnings in the gate; committed adversarial fixtures + sensitivity CI step)

11. ~~**Style-stage gates**~~ — monochrome comprehension check (theme 1) and legend-presence
    warning (R5/R6) in the gate's style stage.
12. ~~**Release regression track**~~ — run the image-capable visual pass over the battery each
    release; commit adversarial fixtures (forced slices, overprints, ties) alongside the
    comprehension set so detectors stay sensitive.

## Method (the learning loop that produced this)

Every defect found by any channel — human review, visual model, gate, agent — becomes:
(a) an adversarial fixture, (b) a detector if missing, (c) a gate rule if critical.
That loop already shipped five capabilities (edgeOverlaps, edgeOverLabels, labelCollisions,
zOrder, the gate) and fixed three showcase diagrams; this roadmap is its continuation.

## P3 — vision-native support + formalized ruleset (planned)

Grounded in the first visual regression pass: vision reached 97% PARITY; its
remaining losses are (a) a semantic gap (sequence crossings metric), (b) counting
tasks over dense geometry, (c) small or overprinted text requiring harness
downscaling, (d) degree ties. Vision strengths (glyphs, color, gestalt) still find
things detectors model late. P3 makes the MCP serve BOTH channels deliberately.

### New capabilities (tools)

1. `d2_focus` - component/region crop render. Render one component bbox (plus
   neighborhood margin) at native or 2x scale as PNG, so vision models read small or
   overprinted text at native resolution instead of fighting harness downscaling
   (the experiment needed 4-6x zoom crops by hand).
2. `d2_annotate` - findings-overlay render. Re-render with red boxes on
   `edgeOverlaps`, `edgeOverLabels` and `labelCollisions` hits so a vision model can
   verify detector findings at a glance (detector-vision alignment loop).
3. `d2_manifest` - expected-inventory for perception self-check. From the source
   alone (no render): object inventory {id, label, shape, classes}, edge count, kind,
   glyph list. A vision model views the diagram, then diffs what it saw against the
   manifest - counting errors become verification errors with ground truth.
4. Vision render profile - `renderProfile: vision` preset on render/focus: scale 2,
   high-contrast theme, minimum font-size, no decorative fills - pixels optimized
   for vision encoders rather than humans.

### Formalizing best practices (rules as data)

5. Machine-readable ruleset `skills/d2-diagrams/ruleset.json`: every rule as
   {id, plane: visual|text|both, level: prose|warning|gate|assertion, params}. R1-R6
   and the V-rules below become DATA that the gate, sensitivity checks and docs all
   read; prose cites rule ids instead of duplicating thresholds.
6. Vision rules (V-series): V1 label min px-height at default scale; V2 contrast
   floor (theme + fill pairs); V3 density cap (components per canvas area); V4 no
   color-alone semantics (every class differs by shape or dash too); V5 label length
   cap; V6 max crossings per hub. Each: level + params + detector or manual note.
7. Sequence-crossings wording fix: battery/gate wording becomes kind-aware
   (message arrows crossing each other) - eliminates the semantic gap the visual
   regression hit.

### Protocol for vision-native agents

8. reference/vision-protocols.md - the vision counterpart of the Agent verification
   loop: manifest first, then full view, then `d2_focus` crops for anything
   uncertain, then `d2_assert` to verify claims, then `d2_annotate` to double-check
   detector findings. Plus authoring guidance for vision legibility (V-rules).
9. Battery extension: vision-only question types (glyph identification, color-class
   mapping, density estimation) so the regression tracks vision capabilities
   independently of text-shaped questions.

### Priority

P3-a (fast, high value): ruleset.json + V-rule wiring into the gate (5, 6) and the
sequence wording fix (7). P3-b: d2_manifest + vision protocol doc (3, 8). P3-c:
d2_focus + d2_annotate + vision render profile (1, 2, 4) + battery extension (9).

## P4 — native PowerPoint round-trip — **SHIPPED** (`d2_pptx` + `d2_pptx_read`; v0.6.0)

Requested directly by the user: render the SAME d2 diagrams as native PowerPoint
shapes (not images), let the human rearrange elements in PowerPoint, then feed the
edited deck back — text model via `d2_pptx_read` (relations JSON with positions,
texts, head/tail connector refs; diff against the d2_pptx export manifest), vision
model via a slide screenshot (`read_image`; LibreOffice unavailable, so PNG export
from PowerPoint is the documented path).

Implementation: `lib/pptx.js` (exportPptx: render + analyzeSvg + extract join, then
pptxgenjs deck — preset geometries per d2 shape, containers painted largest-first,
connectors as line shapes along the d2 waypoint routes with operator-correct
arrowheads, edge labels at measured positions; readPptx: JSZip OOXML parse with a
self-closing-aware element grabber). svgmap components now carry resolved `fill`/
`stroke`. Smoke: 13 checks incl. the round-trip. Deps: pptxgenjs + jszip
(npm --cache inside the workspace; default cache sits on a read-only mount).

