# Troubleshooting & Limits

Recipes distilled from the official D2 docs (tour/troubleshoot, tour/faq). Check
here before debugging from scratch.

## Parsing & syntax

| Symptom | Cause | Fix |
|---|---|---|
| `failed to import "model.d2"` when rendering a view from another directory | d2 v0.9.0 (Windows exe) resolves relative imports against the **CWD**, not the importing file | `cd` into the view's directory before rendering, or pass paths relative to your CWD |
| Weird parse error on a label with `()[]{}:` | Reserved/punctuation chars in key or label | Quote it: `"x(int y)": "[]int"` |
| Reserved keyword needed as a key (`width`, `label`, …) | Keyword clash | Quote the key: `"width": width` |
| Lookalike unicode chars break the file | Full-width `：` `，` pasted from chat/CJK IME | Replace with ASCII `:` `,` |
| Label too wide for shape | No auto-wrap for plain labels | Insert `\n` in the label, or switch shape to `text`/`markdown` |
| Markdown in label renders literally | Only `|md ... |` blocks and `shape: markdown` interpret it | Use a block string or the shape |
| `<br>` warned as non-semantic HTML | Renderer wants semantic HTML | Use `<br/>` (self-closed) |

## Layout

| Symptom | Cause | Fix |
|---|---|---|
| `near: x` / `top`/`left` silently ignored | Not on TALA engine | Add `vars: {d2-config: {layout-engine: tala}}` |
| Edge spaghetti around one shape | Too few anchor points for edge count | Give the shape explicit `width`/`height` (more edge surface) |
| Container children cramped | Container sizing is engine-driven | Set `width`/`height` on the container (TALA/ELK), or restructure |
| Overlaps/odd output on huge graphs | ELK/dagre heuristics degrade past a few hundred nodes | Split into boards/views (suspend/unsuspend, layers); D2 is not tested on thousands of nodes |

## Rendering & embedding

| Symptom | Cause | Fix |
|---|---|---|
| `link:` works locally, not on GitHub | GitHub renders SVG via `<img>` — no links/tooltips | Keep links, but ALSO state them in text; or host where inline SVG is used |
| Watch mode `-w` not reloading | Browser cache / old page | It auto-reloads; check the CLI actually recompiled (watch msg) |
| Partial SVG written then compile error | d2 writes output even on some errors | ALWAYS check exit code; never trust file existence |
| Dark mode ignored | Missing dark theme | `d2 --dark-theme 200 in.d2 out.svg` embeds both palettes |

## SVG interactivity matrix (from the official FAQ)

| Embedding | `link:` clicks | `tooltip:` hovers |
|---|---|---|
| Inline `<svg>` in HTML | ✅ | ✅ |
| `<object>` / `<iframe>` / `<embed>` | ✅ | ✅ |
| `<img>` (incl. **GitHub README**) | ❌ | ❌ |
| CSS `background-image` | ❌ | ❌ |

Consequence for `.md` integration: on GitHub, links/tooltips in rendered SVGs do
NOT work — treat them as progressive enhancement and duplicate any navigational
information in the surrounding text.

## Hard limits (by design, per FAQ)

- An object can live in **only one container** (no Venn diagrams).
- **No ports/pins** on shapes yet (tracked in d2 discussion #605).
- Not stress-tested beyond ~thousands of nodes; model-view splitting is the
  intended answer at scale.
- One `direction` per container; per-edge routing control doesn't exist.

## Interpreter/api differences

- `d2 fmt file.d2` rewrites the file in place; `d2 fmt -` formats stdin→stdout.
- `fmt` also runs as part of every compile — invalid formatting can't break render.
- Browser/JS usage: `npm install @d2lang/d2`, or try snippets at
  https://play.d2lang.com. Comparison with other tools: https://text-to-diagram.com.
