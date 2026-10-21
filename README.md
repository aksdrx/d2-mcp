# D2 Diagrams — Agent & Skill Package

Everything an AI agent (or human) needs to author **software architecture and design
diagrams in [D2](https://d2lang.com)**: control component positions, embed diagrams
in Markdown, and integrate into any agent harness on **Linux / macOS / WSL / Windows**.

## What's in the box

```
AGENTS.md                      portable agent contract — drop into any repo root
skills/d2-diagrams/
  SKILL.md                     loadable skill (Claude Code / Kimi / generic harnesses)
  reference/
    syntax.md                  full language reference
    positioning.md             direction / near / grid / top-left / engines
    styling.md                 style.*, themes, classes, globs
    special-shapes.md          sql_table, class, sequence_diagram, markdown/code/LaTeX
    composition.md             layers, scenarios, steps, boards, imports
    cli.md                     CLI flags, env vars, exports, d2-config
    markdown-integration.md    embedding D2 in .md docs, dark mode, CI
  examples/                    8 diagrams, all validated AND rendered (SVG included)
    architecture-grid.d2       layered architecture via grid-rows/columns
    architecture-tala.d2       absolute/top-left + near-shape positioning (TALA)
    c4-container.d2            C4 container diagram
    sequence.d2                sequence diagram with spans/groups/notes
    erd.d2                     ER diagram with crow's-foot cardinality
    uml-class.d2               UML classes with inheritance/composition
    flowchart.d2               decisions, branches, loop-back
    composition.d2             layers + scenarios + steps (animated)
  scripts/
    install.sh                 d2 installer: Linux/macOS/WSL (user-local, no sudo)
    install.ps1                d2 installer: Windows (winget or user-local tarball)
    render.sh / render.ps1     fmt + validate + render in one command
    render_md.py               renders ```d2 fences inside .md files (stdlib only)
mcp-server/                    MCP stdio server: d2_render/validate/fmt/layouts/themes
examples-md/demo.md            the Markdown embedding convention, end to end
```

## Quick start

```sh
# 1. install d2
sh skills/d2-diagrams/scripts/install.sh          # Linux/macOS/WSL
powershell -File skills/d2-diagrams/scripts/install.ps1   # Windows

# 2. author + verify a diagram
sh skills/d2-diagrams/scripts/render.sh skills/d2-diagrams/examples/architecture-grid.d2

# 3. embed diagrams in markdown docs
python3 skills/d2-diagrams/scripts/render_md.py examples-md/demo.md
```

## Positioning cheat sheet (the short version)

| Need | Mechanism | Engine |
|---|---|---|
| overall flow direction | `direction: right` | all |
| title/legend pinned to edge | `near: top-center` | all |
| exact rows/columns | `grid-rows` / `grid-columns` | all |
| object next to another object | `near: shape_id` | TALA |
| absolute coordinates | `top: N` + `left: N` | TALA |

Set the engine in-file for reproducibility:
`vars: { d2-config: { layout-engine: tala } }`.

## Integrating into agent harnesses

- **Any harness reading AGENTS.md** (Claude Code, Cursor, Copilot, Aider, …):
  copy `AGENTS.md` to your repo root. It teaches the authoring loop
  (fmt → validate → render) and the positioning decision table.
- **Skill-based harnesses** (Claude Code `.claude/skills/`, Kimi skills):
  copy the `skills/d2-diagrams/` directory in; `SKILL.md` carries the frontmatter
  and progressive-disclosure layout they expect.
- **MCP-capable harnesses**: register `mcp-server/` (see `mcp-server/README.md`).
  Agents get `d2_render` / `d2_validate` / `d2_fmt` / `d2_layouts` / `d2_themes`
  as native tools.
- **CI**: `python3 skills/d2-diagrams/scripts/render_md.py --check-only '**/*.md'`
  fails the build on broken diagram fences; `d2 validate` covers standalone `.d2`
  files.

## Design principles baked in

1. **Source of truth is text.** `.d2` files (or fences) are diffable, reviewable,
   and editable by both humans and agents.
2. **Always validate.** Exit code 0 from `d2 validate` is the only definition of
   done — never the existence of an output file.
3. **Position structurally, absolutely only when needed.** Direction, containers,
   grids and `near` cover ~95% of layout intent; `top`/`left` (TALA) is the
   escape hatch.
4. **Config travels with the file.** `vars.d2-config` pins layout engine, theme,
   and padding so renders are identical on every machine.

## Sources

Distilled from the official D2 documentation tour (d2lang.com) and CLI manual,
v0.9.0. All examples were validated and rendered with d2 v0.9.0 (dagre/elk/tala).
