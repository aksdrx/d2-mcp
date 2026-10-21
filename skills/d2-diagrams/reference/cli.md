# D2 CLI Reference (v0.9.x)

## Commands

```sh
d2 [flags] input.d2 [output.svg|png|pdf|pptx|gif|txt]
d2 layout [name]       # list engines / engine-specific flags
d2 themes              # list theme IDs
d2 fmt file.d2 ...     # autoformat
d2 validate file.d2    # syntax/compile check (use this in CI)
d2 play file.d2        # open in https://play.d2lang.com
d2 --check file.d2     # check formatting only
```

- Output defaults to `input.svg`. `-` = stdin/stdout:
  `echo 'x -> y' | d2 - - > out.svg`; change format with `--stdout-format=png`.
- **Success = exit code 0.** d2 may still write a partial render on error — never
  check the output file's existence.

## Key flags

| Flag | Default | Meaning |
|---|---|---|
| `-w, --watch` | false | live-reload server (`$HOST`, `$PORT`, `--browser 0` to suppress) |
| `-l, --layout` | dagre | `dagre` \| `elk` \| `tala` |
| `--elk-algorithm` | layered | `layered` `force` `stress` `mrtree` `radial` (with `--layout=elk`) |
| `-t, --theme` | 0 | theme ID (`d2 themes`) |
| `--dark-theme` | -1 | theme when viewer prefers dark mode |
| `-s, --sketch` | false | hand-drawn look |
| `--pad` | 100 | px padding around diagram |
| `--scale` | -1 | e.g. 0.5; 1 disables SVG fit-to-screen |
| `--center` | false | center SVG in viewbox |
| `-b, --bundle` | true | bundle assets+boards into one SVG |
| `--animate-interval` | 0 | ms per board (SVG/GIF) |
| `--target` | — | board to render, `''` = root, suffix `*` = board+children |
| `--force-appendix` | false | tooltip/link appendix in SVG (always on for PNG) |
| `--timeout` | 120 | seconds; raise for huge diagrams |
| `--salt` | — | unique SVG ids when embedding many diagrams in one HTML page |
| `--no-xml-tag` | false | omit `<?xml?>` for inline HTML embedding |
| `--ascii-mode` | extended | `extended` (Unicode) or `standard` (pure ASCII) |
| `--font-*` | bundled | custom .ttf files (regular/bold/italic/semibold/mono…) |
| `--img-cache` | true | disable if icon images change under you |
| `-d, --debug` | false | verbose logs |

Every flag has an env var twin: `D2_LAYOUT`, `D2_THEME`, `D2_DARK_THEME`, `D2_PAD`,
`D2_SKETCH`, `D2_CENTER`, `D2_BUNDLE`, `D2_ANIMATE_INTERVAL`, `D2_TIMEOUT`,
`D2_STDOUT_FORMAT`, `D2_ASCII_MODE`, … Precedence: **flag > env > vars.d2-config**.

## Exports

| Ext | Notes |
|---|---|
| `.svg` | default; interactive (tooltips, links, animation), CSS injected, dark-theme aware |
| `.png` | no external deps (pure Go renderer); tooltips/links become a numbered appendix; ≤32768 px/dimension |
| `.pdf` | PNG pages + clickable links + board navigation |
| `.pptx` | one slide per board — presentations from compositions |
| `.gif` | loops boards; `--animate-interval` (default 1000ms for GIF) |
| `.txt` | ASCII art (ELK/TALA only; dagre input falls back to ELK); keep diagrams simple |

## In-file config (preferred for reproducibility)

```d2
vars: {
  d2-config: {
    layout-engine: tala
    theme-id: 105
    dark-theme-id: 200
    pad: 40
    sketch: false
    center: true
    # theme-overrides / dark-theme-overrides: { B1: "#..." }
  }
}
```

## Watch mode

```sh
d2 -w input.d2 out.svg       # opens browser, hot-reloads on save
HOST=0.0.0.0 PORT=8620 d2 -w input.d2   # WSL/containers: bind explicitly
```
