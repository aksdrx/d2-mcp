# AGENTS.md — D2 Diagram Authoring Contract

This file instructs any AI coding agent (Claude Code, Cursor, Copilot, Windsurf, Kimi,
Aider, etc.) how to create and maintain **D2** diagrams in this repository. D2 is a
declarative text-to-diagram language (https://d2lang.com, https://github.com/d2lang/d2).

A full, loadable skill with references, examples and scripts lives in
`skills/d2-diagrams/`. If your harness supports skills, load that first and treat this
file as the always-on summary.

---

## 1. Environment

- The `d2` CLI must be on `PATH`. If `d2 version` fails, install it using
  `skills/d2-diagrams/scripts/install.sh` (Linux/macOS/WSL) or
  `skills/d2-diagrams/scripts/install.ps1` (Windows PowerShell). Never install with
  admin rights unless the user asks; the scripts install user-local binaries.
- All three layout engines (`dagre`, `elk`, `tala`) are bundled with the CLI.
  Check with `d2 layout`.

## 2. Non-negotiable authoring loop

For EVERY diagram you create or edit, run this loop until it passes:

```sh
d2 fmt diagram.d2          # normalize formatting (idempotent)
d2 validate diagram.d2     # MUST exit 0 — fix and repeat until it does
d2 diagram.d2 diagram.svg  # render; judge layout from the SVG, not your imagination
```

Never claim a diagram is "done" without a successful `d2 validate`. Never use the
existence of the output file as success — d2 can write partial renders on error.
Always check the exit code.

## 3. Syntax rules that prevent 90% of agent errors

1. **Connections reference keys, not labels.** `be: Backend` then `be -> fe`.
   Writing `Backend -> Frontend` after that creates *new* shapes.
2. **Keys are case-insensitive.** `PostgreSQL` and `postgresql` are the same shape.
3. Only four connection operators exist: `--`, `->`, `<-`, `<->`.
4. Repeated identical connections **add** parallel edges; they do not override.
   To style an existing one, reference it: `(a -> b)[0].style.stroke-dash: 3`.
5. Redeclaring a shape **merges** attributes. Set an attribute to `null` to delete it.
6. Container children: `server.api` or nested maps. Inside a container, `_` refers to
   the parent scope (`_.outside` reaches a sibling of the container).
7. Reserved keys inside `sql_table` / `class` bodies must be quoted: `"label": string`.
8. `#` starts a comment. URLs with `#` fragments must be quoted.
9. Block strings: `|md ... |`, `|go ... |`, `||ts ... ||` (extend the pipe fence when
   the content itself contains `|`). Standalone text objects are Markdown by default.
10. Strings rarely need quotes; add them only for reserved characters.

## 4. Positioning components (the whole point)

D2 has **no free pixel placement** except on TALA. You position things by combining
five mechanisms — pick the weakest one that achieves the layout:

| Need | Mechanism | Engine support |
|---|---|---|
| Overall flow (top→down, left→right) | `direction: down|up|right|left` | all; per-container only on TALA |
| Fixed spot around the canvas (title, legend, note) | `near: top-center` etc. (8 constants) | all |
| Precise row/column placement | `grid-rows` / `grid-columns` (+ `grid-gap`) | all |
| Place object X next to object Y | `near: some_shape_id` | **TALA only** |
| Lock absolute coordinates | `top: N` + `left: N` (must set both) | **TALA only** |

Also available: `width`/`height` on any shape (on containers: TALA/ELK only), and
`label.near` / `icon.near` with `outside-*` and `border-*` prefixes.

Rules of thumb:

- Default to **dagre**; switch to `elk` for orthogonal edges and row-exact SQL table
  connections; switch to `tala` when you need `top`/`left`, per-container `direction`,
  or `near: <shape>`.
- In grids, pad with invisible spacers (`spacer: "" {style.opacity: 0}`) to control
  alignment; equalize cell sizes with explicit `width`.
- Set layout in-file so renders are reproducible regardless of CLI flags:
  ```d2
  vars: {
    d2-config: {
      layout-engine: tala
      theme-id: 105
      pad: 40
    }
  }
  ```
  (CLI flags and env vars override these.)

## 5. Architecture-diagram conventions used in this repo

- One file per diagram, `kebab-case.d2`, stored next to the `.md` that references it
  (or under `docs/diagrams/`).
- Use **containers** for deployment boundaries (VPC, k8s namespace, host, team).
- Use **classes** for repeatable styling instead of repeating `style.*` blocks:
  ```d2
  classes: {
    datastore: {
      shape: cylinder
      style.fill: "#B6DDFE"
    }
  }
  db.class: datastore
  ```
- Set `tooltip` for secondary detail; set `link` to jump to other docs/boards.
- For large systems, split `models.d2` (all objects) from view files that import and
  wire them (`x: @models` / `...@models` spread import). See
  `skills/d2-diagrams/reference/composition.md`.
- Use `layers:` for levels of abstraction, `scenarios:` for alternate views,
  `steps:` for sequences of states. Export to PDF/PPTX for clickable navigation,
  or SVG with `--animate-interval` for animation.

## 6. Embedding in Markdown

GitHub/VS Code do **not** render ```` ```d2 ```` fences natively. Convention:

1. Keep the `.d2` source fenced in the `.md` (humans and agents can read/edit it).
2. Render to SVG with `python3 skills/d2-diagrams/scripts/render_md.py <file>.md`
   (cross-platform, no deps) — it extracts every `d2` fence, validates each, renders
   `assets/<doc>-<n>.svg`, and writes `<doc>.rendered.md` with image links appended
   after each fence.
3. Commit both the `.md` source and the generated SVG so the docs render everywhere.

Prefer SVG (clickable links/tooltips, dark-theme aware). Use PNG only for PDF/slides
pipelines that can't take SVG; ASCII (`.txt`) for terminals and plain-text docs.

## 7. MCP server (optional)

`mcp-server/` contains a stdio MCP server exposing `d2_render`, `d2_validate`,
`d2_fmt`, `d2_layouts`, `d2_themes`. Register it in any MCP-capable harness
(Claude Code/Desktop, Cursor, etc.) — see `mcp-server/README.md`.

## 8. Reference material

- `skills/d2-diagrams/SKILL.md` — entry point
- `skills/d2-diagrams/reference/syntax.md` — complete language reference
- `skills/d2-diagrams/reference/positioning.md` — everything about placing components
- `skills/d2-diagrams/reference/styling.md` — styles, themes, classes, globs
- `skills/d2-diagrams/reference/special-shapes.md` — sql_table, class, sequence_diagram, text/code/LaTeX
- `skills/d2-diagrams/reference/composition.md` — layers/scenarios/steps, imports, boards
- `skills/d2-diagrams/reference/cli.md` — CLI flags, exports, env vars, d2-config
- `skills/d2-diagrams/reference/markdown-integration.md` — .md embedding patterns
- `skills/d2-diagrams/examples/` — runnable, validated examples per diagram type
- Official tour: https://d2lang.com/tour/intro
