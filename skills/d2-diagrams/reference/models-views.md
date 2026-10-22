# Models, Views, and the Two-Plane Workflow

D2 diagrams in this kit serve **two audiences at once**:

1. **The text plane** — AI agents, grep, CI checks. Diagrams are *data*: components,
   containers, and typed relationships that can be extracted as JSON and diffed
   against code.
2. **The visual plane** — humans reading the docs. Diagrams are *pictures*: clear
   layout, consistent icons/shapes, themes, tooltips.

One `.d2` source serves both. This page explains how to structure it.

Two orthogonal axes, both starting from the same model:

- **Views** (semantic cuts): which components/edges are shown — suspend/unsuspend
  globs per view file. Cuts *what* is in the picture.
- **Variants** (visual alternatives): how the same view is laid out and styled —
  engine × direction bake-off, then themes. Changes *how* the picture looks.
  See `reference/visual-quality.md` for the two-stage refinement ladder.

## The model-view pattern (suspend/unsuspend)

Real architectures have too many components to show in one picture. Instead of
maintaining several divergent `.d2` files, keep **one model** and cut **views** out
of it with glob suspensions.

**Recommended layout — one model file, one file per view** (this is what
`examples/model-views/` does):

```d2
# model.d2 — every component and relationship, defined exactly once
users: Customers {shape: person}
web: Web App
api: API Gateway {shape: hexagon}
orders: Order Service
payments: Payment Service
ledger: Ledger {shape: cylinder}

users -> web: browse
web -> api: HTTPS
api -> orders: gRPC
orders -> payments: charge
payments -> ledger: INSERT
orders -> ledger: SELECT
```

```d2
# view-payment-flow.d2 — money path only
...@model.d2            # spread import: pull in the whole model

**: suspend             # hide every shape
(** -> **)[*]: suspend  # hide every connection

(** -> **)[*]: unsuspend {
  &label: charge        # re-reveal edges by label …
}
(** -> **)[*]: unsuspend {
  &label: INSERT
}
```

```d2
# view-full.d2 — everything: just import the model unchanged
...@model.d2
```

Render each view like any diagram: `d2 view-payment-flow.d2 out.svg` — but note:
run this **from the view file's directory**; d2 v0.9.0's Windows build resolves
relative imports against the CWD (see `reference/troubleshooting.md`).

Mechanics:

- `**: suspend` hides every shape; `(** -> **)[*]: suspend` hides every edge.
- Filtered unsuspends re-reveal subsets: `&dst: payments` (edges pointing at a
  shape), `&label: charge` (edges by label), `&src: ...` (edges from a shape).
- Unconnected endpoints of unsuspended edges stay visible automatically.
- The single-file variant (model + `**: suspend` + one unsuspend block, all in the
  same file) also works — that's the official docs' style — but you get **one
  view per file** that way; imports scale better.
- ⚠️ Don't combine a root-level `**: suspend` with `layers:` in one file: the
  suspension applies inside the layer boards too and the layers render empty.
  Use separate view files (or per-layer glob rules) instead.

## The dual-plane contract

Every diagram that documents an architecture should carry BOTH planes:

| Plane | Artifact | Produced by |
|---|---|---|
| Visual | `<name>.svg` next to the `.md` | `d2` render (via `render_md.py` or MCP `d2_render`) |
| Text (compact) | `<name>.txt` — ASCII outline | `d2 --format ascii`, or extractor `toText()` |
| Text (rich) | `<name>.relations.json` — machine model | extractor (below), or MCP `d2_extract` |

`.relations.json` schema (stable contract; the MCP tool returns exactly this):

```json
{
  "ok": true,
  "direction": "right",
  "objects": [
    {"id": "platform.api", "label": "API Service", "container": "platform",
     "shape": "rectangle", "classes": ["svc"], "attributes": []}
  ],
  "connections": [
    {"id": "platform.lb -> platform.api", "src": "platform.lb",
     "dst": "platform.api", "operator": "->", "label": "HTTPS"}
  ],
  "imports": [], "warnings": []
}
```

- `id`s are **dotted absolute paths** (`vpc.api`) — stable anchors for review tools.
- `attributes` carries `sql_table`/`class` rows and methods when present.
- `warnings` lists anything the extractor could not fully resolve — treat non-empty
  `warnings` as a lint failure in CI.

Generate the text plane:

```sh
# CLI (no d2 binary needed — pure JS parser)
node mcp-server/lib/extract.js diagram.d2 --json > diagram.relations.json
node mcp-server/lib/extract.js diagram.d2 --text   # compact outline

# MCP (any harness)
d2_extract { "filePath": "diagram.d2", "view": "json" }

# Markdown pipeline: text sidecars for every fence
node mcp-server/lib/mdrender.js README.md --sidecars
# → assets/<name>.svg + assets/<name>.txt + assets/<name>.relations.json
```

## Verifying code against diagrams

The rich sidecar is what makes diagrams *checkable*:

1. **Extract the intended architecture** from the `.d2` (or the `.md` fence
   sidecar): every object id, every connection, every label.
2. **Extract the actual architecture** from the code — imports, HTTP/RPC routes,
   DB tables, module dependencies (whatever your stack offers: grep, AST tools,
   `go list`, dependency-cruiser …).
3. **Diff the two graphs.** Report:
   - connections in the diagram with no code counterpart (stale doc),
   - code dependencies missing from the diagram (undocumented coupling),
   - objects whose container differs (wrong boundary).
4. Run the diff in CI next to `d2 validate` so drift fails the build.

Because ids are dotted paths and labels are explicit, most checks are simple
join/anti-join on the two JSON graphs — no graph database required.

## Authoring checklist for dual-plane diagrams

- State the diagram's context in the source header — `# scope: checkout flow`,
  `# entry: api.gateway` — and `link` the owning doc (`link: ../design.md`); a
  text-only agent reading the `.d2` or its sidecar must know what the diagram is
  *for* and where it sits in the project.
- Give every object an explicit, stable key (`payments`, not `p`) — the key is the
  id in the relations JSON.
- Label connections with the *kind* of interaction (`HTTPS`, `gRPC`, `INSERT`,
  `publishes`) — labels are the edge types verification joins on.
- Prefer `shape:`/`icon:` that match the component's nature (cylinder = store,
  person = actor, queue = buffer) — the text plane ignores them, the visual plane
  depends on them.
- Keep one model file; cut focused views with suspend/unsuspend instead of
  forking copies that drift apart.
- Commit sidecars (`.txt`, `.relations.json`) so reviewers and CI can use them
  without running tooling.
