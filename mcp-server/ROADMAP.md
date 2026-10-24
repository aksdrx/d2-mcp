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

## P0 — close the demonstrated gaps

1. **Label→id table in `d2_layout_map`** — add `labels: {label → id}` (and reverse).
   Kills the single largest vision failure class (4/7 original losses).
2. **Tied relations** — when `left-of`/`above` candidates sit within ε, emit all of them
   (`tiedWith`); battery scorer accepts any tied answer. Evidence: dense `partner_b` (pricing vs inventory, 7px),
   cqrs staleness_window (6-way tie).
3. **Degenerate-bbox filtering** — components with height/width ≤ 2px (titles) leave relation
   derivation. Evidence: the `title left-of oncall` false positive that vision correctly rejected.
4. **Diagram-kind tagging** — `layoutMap.kind: flow | sequence | multiboard` derived from
   boardAttrs + lifeline pseudo-edges (`(X -- )`); move the sequence exemptions out of gate
   regexes into machine-readable metadata; annotate crossings/aspect with kind semantics.
5. **Parallel-edge indexing** — surface `[i]` in edge ids and battery edge-label questions
   (8a./8b. `fetch` ambiguity).
6. **Glyph/style surfacing** — join extract's shape + style (shape kind, dashed, fill class) into
   layoutMap components, so agents read `cylinder + dashed` without pixels and conventions
   (solid=sync, dashed=async) become checkable.

## P1 — robustness capabilities

7. **`d2_assert` tool** — intent predicates against measured geometry:
   `X left-of Y`, `no slices`, `aspect in 0.67..1.5`, `hub degree ≤ N` → pass/fail with measured
   values. Closes the agent loop: state intent → render → verify → gate.
8. **`d2_visual_check` tool** — the visual-gate as one MCP call (PASS/FAIL + findings),
   so any agent self-checks before claiming done; CI keeps the CLI version.
9. **Sidecar v2** — one JSON per diagram carrying both planes + join keys:
   objects `{id,label,bbox,shape,style,container}`, edges `{id,src,dst,label,route,overlaps,onTop}`;
   `d2_md_render --sidecars` adopts it as the dual-plane contract.
10. **Bake-off upgrade** — `d2_variants` per-variant edgeOverlaps/edgeOverLabels counts;
    recommendation order becomes (slices, crossings, |aspect−1.6|).

## P2 — human-plane polish

11. **Style-stage gates** — monochrome comprehension check (theme 1) and legend-presence
    warning (R5/R6) in the gate's style stage.
12. **Release regression track** — run the image-capable visual pass over the battery each
    release; commit adversarial fixtures (forced slices, overprints, ties) alongside the
    comprehension set so detectors stay sensitive.

## Method (the learning loop that produced this)

Every defect found by any channel — human review, visual model, gate, agent — becomes:
(a) an adversarial fixture, (b) a detector if missing, (c) a gate rule if critical.
That loop already shipped five capabilities (edgeOverlaps, edgeOverLabels, labelCollisions,
zOrder, the gate) and fixed three showcase diagrams; this roadmap is its continuation.
