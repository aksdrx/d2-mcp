# d2-mcp-server

A stdio [MCP](https://modelcontextprotocol.io) server that wraps the `d2` CLI so any
MCP-capable agent harness can render and validate D2 diagrams as native tool calls.

## Tools

| Tool | Purpose |
|---|---|
| `d2_render` | D2 source → `.svg/.png/.pdf/.pptx/.gif/.txt` file (layout/theme/sketch/pad/target/animate options) |
| `d2_validate` | compile check; returns errors with line numbers |
| `d2_fmt` | autoformat D2 source (gofmt-style) |
| `d2_layouts` | list layout engines on this machine |
| `d2_themes` | list theme IDs on this machine |

## Requirements

- Node.js ≥ 18
- `d2` CLI on `PATH` (installers: `../skills/d2-diagrams/scripts/install.sh` /
  `install.ps1`), or point `D2_PATH` at the binary.

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
