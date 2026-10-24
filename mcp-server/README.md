# d2-mcp-server

A stdio [MCP](https://modelcontextprotocol.io) server that wraps the `d2` CLI so any
MCP-capable agent harness can render and validate D2 diagrams as native tool calls —
plus pure-JS tools that serve the **text plane** (component relationships as JSON)
without even needing the d2 binary.

## Tools

| Tool | Purpose |
|---|---|
| `d2_render` | D2 source/file → `.svg/.png/.pdf/.pptx/.gif/.txt` (layout/theme/sketch/pad/center/bundle/scale options). SVG results include `width`/`height`/`aspect`. |
| `d2_validate` | compile check; structured errors `[{line, col, message}]` |
| `d2_fmt` | autoformat D2 source (gofmt-style, stdin→stdout) |
| `d2_extract` | parse D2 into a relationship model — objects (dotted ids, labels, shapes, containers), connections (typed labels), globs, boards, and `metrics` (maxDegree + hubs needing explicit width/height). `view: "text"` for a compact outline. Resolves local `@imports`. **No d2 binary needed.** |
| `d2_md_render` | render every ```d2 fence in `.md` files; refreshes image links; optional dual-plane sidecars (`.txt` + `.relations.json`) |
| `d2_variants` | two-stage visual refinement: `stage:"layout"` renders an engine×direction bake-off; `stage:"style"` re-renders the winning layout under themes (default 1 Neutral Grey = monochrome check, 0 neutral, 8 colorblind-safe) ± sketch. Every variant returns `width/height/aspect` + `crossings`, plus a data-driven `recommended` winner. |
| `d2_layout_map` | measured post-layout geometry as text (no image viewing needed): canvas, component bboxes/centers/containers, edge routes, crossing pairs, overlapping shapes, `textMap` grid, `left-of`/`above` predicates — lets text-only agents iterate visual composition with user feedback. |
| `d2_layouts` | list layout engines on this machine |
| `d2_themes` | list theme IDs on this machine |
| `d2_version` | d2 CLI version string |

The dual-plane contract (`d2_extract` / sidecar JSON schema) is documented in
`../skills/d2-diagrams/reference/models-views.md`; the visual refinement ladder the
variants tool implements and the blind-agent geometry workflow (`d2_layout_map`)
are in `../skills/d2-diagrams/reference/visual-quality.md`.

## Requirements

- Node.js ≥ 18
- `d2` CLI on `PATH` (installers: `../skills/d2-diagrams/scripts/install.sh` /
  `install.ps1`), or point `D2_PATH` at the binary.
- `d2_extract` works with no binary at all (pure JS).

## Setup

```sh
cd mcp-server
npm install
```

## Register in your harness

Replace `<ROOT>` with the absolute path of this repo's `mcp-server` directory.

**Claude Code / Claude Desktop** (`claude_desktop_config.json` or
`.mcp.json` / `claude mcp add`):

```json
{
  "mcpServers": {
    "d2": {
      "command": "node",
      "args": ["<ROOT>/index.js"]
    }
  }
}
```

or

```sh
claude mcp add d2 -- node <ROOT>/index.js
```

**Cursor** (`~/.cursor/mcp.json`): same JSON block as above.

**Windsurf** (`~/.codeium/windsurf/mcp_config.json`): same JSON block.

**Windows note**: if `d2` is not on the system PATH in the harness environment, add
`"env": {"D2_PATH": "C:\\Users\\you\\AppData\\Local\\Programs\\d2\\d2.exe"}` to the
server entry.

## Smoke test

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"d2_validate","arguments":{"source":"a -> b"}}}' \
  | node index.js
```

Expect `"ok": true` in the response for id 2.

## Roadmap

Two-plane strengthening plan grounded in the text-vs-visual research: [ROADMAP.md](ROADMAP.md)
