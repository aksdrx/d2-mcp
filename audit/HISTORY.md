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

## 2026-10-27 — stress corpus round (web-sourced quantitative/complex, 23 -> 29 files)

User asked for more quantitative + more complex diagrams from the web to make
the example set more versatile. Six new files under `examples/stress/` (sources
cited in file headers): bank-tco (judepayne/dictim cookbook),
terraform-dbtlabs (dbt-labs provider), queue-workers (golang-queue),
clos-network (CLOS fabric pattern), erd-analytics + kpi-dashboard (authored).
Each engine/direction chosen by 4-variant bake-off; winners pinned in vars.

The new set immediately caught two real bugs — exactly its purpose:

| # | Finding | Resolution | Regression prevention |
|---|---|---|---|
| 9 | svgmap decoded `class="<b64id> blue"` as ONE base64 token — Node base64 silently skips the space, so `(a -> b)[*].class: blue` edges carried css-name garbage in the decoded id; bank-tco lost 3/12 edges -> pptx lost 3 connectors | svgmap takes the first whitespace token of the class attr only (mcp-server/lib/svgmap.js) | **G5** connectors >= connections over class-styled conns (bank-tco 12/12) |
| 10 | fidelity renderLines stripped `_` as markdown emphasis — snake_case labels (order_items, global_connection, staleness_window) mismatched their pptx text | underscore removed from the strip class (only `*` and backtick remain) | **G5** label-presence checks over sql_table/glob-heavy stress files |

Also fixed: AGENTS.md §2 documented a nonexistent d2 CLI `--direction` flag
(v0.9.0 has no such flag; direction is in-language). Doc-only.

Gates G2/G3/G4 now cover the stress set too (gated set = showcase +
model-views + stress). Full run green: runs/2026-10-27T06-01-49-742Z.json.
