# Verifying Text-Plane Comprehension

Can a text-only agent (no image viewing) understand a diagram's composition as
well as a visual model? For **structural and positional facts** this is
objectively testable, because the ground truth is *measured*: the layout map
reads the same geometry the rendered SVG displays. This page defines the kit's
standard verification procedure.

## What is verifiable — and what is not

| Category | Verifiable? | Ground truth source |
|---|---|---|
| Component count, identity, nesting | yes | `d2_extract` model (objects, containers) |
| Connections, labels, direction, neighbors | yes | `d2_extract` model (connections) |
| Hub degree | yes | `d2_extract` metrics |
| Rendered positions (left-of / above), aspect | yes | `d2_layout_map` measured geometry |
| Edge crossings | yes | `d2_layout_map` analysis |
| Aesthetic quality, "does it look good" | **no** (subjective) | human review / user feedback loop |

The benchmark covers every verifiable category. Subjective quality stays in
the human refinement ladder (`visual-quality.md`).

## The benchmark

Examples live in `examples/comprehension/` — deliberately diverse:

- `containers.d2` — nested deployment topology (membership, boundaries, 17 objects)
- `dense.d2` — crossing-heavy integration mesh (4 crossing pairs under elk)
- `grid.d2` — ownership grid (square aspect, 23 objects, grid layout)
- `pipeline.d2` — telemetry fan-out (hub router, wide aspect)

## Procedure

### 1. Generate the test (deterministic)

```sh
D2_PATH=path/to/d2 node skills/d2-diagrams/scripts/comprehension.mjs \
  generate skills/d2-diagrams/examples/comprehension --out ./bench
```

Produces `bench/comprehension-test.json` (per diagram: a **dossier** — the
`d2_extract` text view plus the `d2_layout_map` geometry: bboxes, routes,
crossings, textMap, relations — and a question battery) and
`bench/comprehension-key.json` (answers only; keep it away from the agent).

Question categories (auto-derived, ~9–11 per diagram): object/connection
counts, edge labels, hub + full neighbor sets, container membership (both
directions), rendered left-of/above positions, crossing-pair count, aspect
class. The generator also cross-checks the extract model against measured
containment and emits warnings on mismatch.

### 2. Run the text-only agent

Give the agent **only** the dossier JSON (it must not see the key, the .d2
source, or any SVG) and ask the questions verbatim. Answers as JSON:

```json
{ "containers.d2": { "objects": 17, "edge-label": "gRPC", "neighbors": ["..."] }, ... }
```

### 3. Score

```sh
node skills/d2-diagrams/scripts/comprehension.mjs score \
  bench/comprehension-test.json answers.json bench/comprehension-key.json
```

Verdicts: **≥90% PARITY** (text-plane comprehension equivalent to reading the
image for structural/positional facts), 70–89% PARTIAL (inspect the failed
category), <70% BELOW PARITY. Exit code mirrors the verdict for CI use.

### Interpretation

A PARITY score demonstrates the agent answered topology, nesting, labeling,
hub, position and crossing questions from the text plane alone — the same
facts a visual model extracts by looking at the SVG. It does **not** certify
aesthetic judgment; that remains the human's call in the refinement loop.
