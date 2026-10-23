# Contributing

Thanks for improving the kit! This repo is agent-friendly: every rule that applies
to humans applies to AI contributors too (`AGENTS.md` is the full contract).

## The non-negotiable loop

For every diagram you add or edit:

```sh
d2 fmt --write <file>.d2      # canonical formatting (CI checks it)
d2 validate <file>.d2         # must exit 0
d2 <file>.d2 <file>.svg       # commit the render next to the source
```

For architecture diagrams, run a layout bake-off first (the `d2_variants` MCP tool or
`skills/d2-diagrams/reference/visual-quality.md`) and persist the winning
engine/direction/theme in `vars: {d2-config: {...}}` inside the file.

## Local checks (mirror CI)

```sh
sh skills/d2-diagrams/scripts/install.sh   # d2 CLI, user-local
(cd mcp-server && npm ci)                  # MCP server deps
node mcp-server/smoke.mjs                  # 10-tool MCP smoke test
```

See `.github/workflows/ci.yml` for the authoritative list: fmt check, validate,
render, text-plane extraction, comprehension battery, markdown fences, MCP smoke.

## Commit style

- Imperative subject, lowercase, no period: 'add er example', 'fix extract scope leak'.
- One logical change per commit; regenerate sidecars in the same commit as the source.

## Vendoring third-party diagrams

Only with a compatible license; add a provenance header to the file and an entry in
`NOTICE.md`.
