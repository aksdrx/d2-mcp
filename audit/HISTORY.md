# HISTORY — findings & resolutions (append-only)

## 2026-10-26 — full audit re-run with pptx capabilities (all green)

Learnings from the previous audit (`runs/baseline-pre-fixes.json`, 23 files)
and how each finding is now prevented:

| # | Previous finding | Resolution | Regression prevention |
|---|---|---|---|
| 1 | 4 renderFail (composition + 3 view-*.d2) — audit rendered without file-relative cwd | audit renders with `cwd` = file dir; multiboard output resolved to `<stem>/index.svg` | **G1** (exit 1 on any render failure) |
| 2 | Unpinned layout engines in showcase | `composition.d2` now pins `layout-engine: dagre` (others already pinned) | **G2** |
| 3 | Unlabeled connections in showcase | labels added: tala `charge -> orders: creates`, flowchart `start -> checks: submit`, composition chain; ERD column joins exempt (structure-labeled per R5) | **G3** |
| 4 | Extreme aspects (up to 4.72) in corpus | R2 scope note (vertical genres); composition root restructured 0.34 → 0.75 (`grid-columns: 2` platform wrapper) | **G4** (floor 0.4..2.5 on showcase + model-views) |
| 5 | pptx-fidelity.mjs crashed (`m.kind` ReferenceError), duplicate `squash`, deleted its own evidence | rewritten: `auditFiles()` API + CLI, evidence kept in `.pptx-fidelity/`, per-file JSON results | **G5** runs it on every push |
| 6 | extract() did not resolve `(** -> **)[*]: suspend/unsuspend` — views misreported hidden elements as visible (8 conns vs 2 rendered) | `applyGlobs()` in extract.js: ordered glob rules, &label/&src/&dst filters, endpoint reveal | **G5** connector counts; extract check in CI |
| 7 | No way to feed a .pptx to a vision model | `renderPptxPng()` + `d2_pptx_render` MCP tool (resvg, zero-transitive dep) | **G6** + smoke check #14 |
| 8 | audit labels compared raw markdown / \uXXXX escapes vs rendered text — false FAILs (tala md note, cqrs en-dash) | audit normalizes like d2 render: md line stripping + \uXXXX unescaping | G5 (stable comparisons — a flapping gate is no gate) |

Sequence-diagram export stays a recorded NOTE (approximation), not a failure —
see STATUS.md.

Commit: "audit: three-plane quality audit (G1–G6), pptx render tool, tracking folder"
