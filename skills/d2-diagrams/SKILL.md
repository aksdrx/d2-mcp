---
name: d2-diagrams
description: >-
  Author, validate, and render D2 diagrams (software architecture, C4, sequence,
  ER, UML class, flowchart, grid, network/deployment diagrams) as text, and embed
  them in Markdown docs. Use whenever the user asks to draw, generate, edit, or
  maintain architecture/design diagrams as code, control component positions, or
  keep diagrams versioned next to documentation.
---

# D2 Diagrams

D2 turns text into diagrams. You write declarative `.d2` source; the `d2` CLI renders
SVG/PNG/PDF/PPTX/GIF/ASCII. Full language reference: `reference/syntax.md` in this
skill directory. Official docs: https://d2lang.com/tour/intro

## Prerequisites

`d2` CLI on PATH (`d2 version` to check). If missing, run the installer for the
current platform:

- Linux / macOS / WSL: `sh skills/d2-diagrams/scripts/install.sh`
- Windows PowerShell: `pwsh skills/d2-diagrams/scripts/install.ps1`

## The authoring loop (always follow it)

1. Write or edit the `.d2` file.
2. `d2 fmt file.d2` — normalize formatting.
3. `d2 validate file.d2` — must exit 0. Fix errors; repeat.
4. Render **variants and inspect the SVG** — never ship the first render: compare
   2+ `--layout`/`--direction` combos (layout bake-off), then apply a restrained
   style pass. Judge crossings, aspect, label fit. `reference/visual-quality.md`
   is the full checklist; MCP users: one `d2_variants` call renders a whole stage.
5. For live iteration offer `d2 -w file.d2 out.svg` (watch mode + browser reload).

## Minimal D2 in 30 seconds

```d2
direction: right

user: User {shape: person}

cluster: AWS VPC {
  lb: Load Balancer
  api: API Service
  db: PostgreSQL {shape: cylinder}
  lb -> api -> db
}

user -> cluster.lb: HTTPS
```

- Shapes are declared by their key; `key: Label` overrides the visible label.
- `shape:` sets the glyph (`rectangle`, `cylinder`, `cloud`, `person`, `diamond`,
  `page`, `document`, `queue`, `package`, `hexagon`, `circle`, `oval`, `square`,
  `parallelogram`, `step`, `callout`, `stored_data`, `c4-person`, `class`,
  `sql_table`, `sequence_diagram`, `code`, `text`, `image`).
- Connections: `a -> b`, `a -- b`, `a <-> b`, with labels after `:`.
- Containers: `parent: { child }` or `parent.child`; `_` reaches the parent scope.
- Style: `obj.style.fill: "#..."`, `stroke`, `stroke-width`, `stroke-dash`,
  `opacity`, `shadow`, `3d`, `multiple`, `border-radius`, `font-size`, `animated`.
- Reuse styles with `classes: { svc: {...} }` + `obj.class: svc` (arrays allowed).

## Controlling positions — decision table

D2 deliberately has no free x/y placement (except on TALA). Combine these:

| You want | Use | Engines |
|---|---|---|
| Diagram flows left→right | `direction: right` (top level) | all |
| Different flow inside one container | `direction:` inside container | TALA |
| Title / legend / note pinned to a canvas edge | `title: ... {near: top-center}` | all |
| Exact rows/columns (dashboards, comparisons) | `grid-rows: N` / `grid-columns: M` | all |
| Object X visually next to object Y | `near: x` on Y | TALA |
| Absolute pixel lock | `top: 100` + `left: 200` (both required) | TALA |
| Bigger/smaller components | `width` / `height` (px) | all; containers: TALA+ELK |

Details and recipes: `reference/positioning.md`.

## Recipes by diagram type

Copy from `examples/` (all validated) and adapt:

| Diagram | Example file | Key features |
|---|---|---|
| Layered architecture | `examples/architecture-grid.d2` | containers, grid rows, classes |
| Precisely placed architecture | `examples/architecture-tala.d2` | TALA, `near`, `top`/`left` |
| C4 container diagram | `examples/c4-container.d2` | person, boundaries, descriptions |
| Sequence diagram | `examples/sequence.d2` | `shape: sequence_diagram`, spans, groups |
| ER diagram | `examples/erd.d2` | `sql_table`, crow's-foot arrowheads |
| UML class diagram | `examples/uml-class.d2` | `class`, visibilities, inheritance arrowheads |
| Flowchart | `examples/flowchart.d2` | diamonds, labeled branches |
| Animated / multi-view | `examples/composition.d2` | `layers`, `scenarios`, `steps` |
| Model + focused views | `examples/model-views/` | spread imports, `suspend`/`unsuspend`, filtered views |

## Embedding into Markdown files

GitHub etc. don't render ```` ```d2 ```` fences. Convention:

```sh
python3 skills/d2-diagrams/scripts/render_md.py README.md
# -> validates + renders each d2 fence to assets/README-1.svg ...
# -> writes README.rendered.md with ![...](assets/...) after each fence

node mcp-server/lib/mdrender.js README.md --sidecars   # JS pipeline (no Python)
# -> also writes assets/<name>.txt + <name>.relations.json (text plane)
```

Full patterns (side-by-side source+image, CI hooks, dark mode):
`reference/markdown-integration.md`.

## Two planes: diagrams for AI and for humans

Every architecture diagram serves two audiences — plan for both:

- **Text plane** (AI agents, CI, grep): stable object keys, labeled connections,
  and machine-readable sidecars (`.relations.json`). Extract with
  `node mcp-server/lib/extract.js diagram.d2 --json|--text` or MCP `d2_extract`
  (includes `metrics`: maxDegree + hubs needing explicit width/height). Use the
  JSON to verify code against the diagram (join on dotted ids + edge labels).
- **Visual plane** (humans): refine in two stages — **layout bake-off**
  (2+ engine × direction variants; ELK minimizes crossings, TALA for
  non-hierarchical; aspect 3:2–16:9) then a **style pass** (comprehensible in
  monochrome first — theme 1; ≤ 1 accent color; color adds signal, not noise).
  MCP `d2_variants` renders either stage in one call. Without image viewing,
  MCP `d2_layout_map` returns measured geometry (bboxes, edge routes,
  crossings, a textMap grid, left-of/above predicates) to iterate composition
  as text.
- Keep **one model**, cut focused views with `suspend`/`unsuspend` globs instead
  of forking copies.

Full workflows: `reference/models-views.md` (text plane + JSON contract) and
`reference/visual-quality.md` (visual plane rules R1–R6 + refinement ladder).

## Common pitfalls (check before declaring done)

- `Backend -> Frontend` when shapes were declared as `be`/`fe` → duplicate shapes.
- Using `near: some_shape` or `top/left` without `layout-engine: tala`.
- Forgetting that `grid-rows` then `grid-columns` (order!) sets the fill direction.
- `#` in URLs/labels starts a comment — quote the string.
- Reserved words (`label`, `shape`, `icon`…) as row names in `sql_table`/`class` —
  quote them: `"label": string`.
- Assuming output file exists ⇒ success. Only exit code 0 means success.

## When the user wants MCP integration

Point them to `mcp-server/` in the repo root: a stdio MCP server wrapping the d2 CLI
with 10 tools — `d2_render` (returns width/height/aspect), `d2_validate` (structured
errors), `d2_fmt`, `d2_extract` (relationships as JSON/text + hub metrics, no binary
needed), `d2_md_render` (render every d2 fence in a .md, optional sidecars),
`d2_variants` (layout bake-off + styling variants, data-driven `recommended`),
`d2_layout_map` (measured post-layout geometry as text for blind agents),
`d2_layouts`, `d2_themes`, `d2_version` — that any MCP-capable harness can register.
See `mcp-server/README.md`.

## Reference index

- `reference/syntax.md` — complete language syntax (shapes, connections, containers,
  strings, imports, vars, globs, suspend/unsuspend, overrides)
- `reference/positioning.md` — direction, near, grid, top/left, dimensions, engines
- `reference/styling.md` — style keywords, themes, classes, globs-as-defaults
- `reference/special-shapes.md` — sql_table, class, sequence_diagram, markdown/code/LaTeX text
- `reference/composition.md` — layers, scenarios, steps, boards, links, imports
- `reference/models-views.md` — model-view pattern, dual-plane JSON contract,
  verifying code against diagrams
- `reference/visual-quality.md` — human-plane refinement ladder: layout bake-off,
  crossings, aspect, monochrome-first styling (R1–R6)
- `reference/troubleshooting.md` — parse/layout/render recipes, interactivity
  matrix, hard limits
- `reference/cli.md` — CLI flags, env vars, exports, d2-config vars
- `reference/markdown-integration.md` — .md embedding + render pipeline + sidecars
