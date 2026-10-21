# Embedding D2 in Markdown Files

## The core problem

GitHub, GitLab (without config), VS Code preview and most static site generators do
**not** render ```` ```d2 ```` fences (unlike Mermaid). So the convention is:
**keep the D2 source in the .md, and render it to SVG files that the .md links to.**

Benefits: source stays diffable and AI-editable in the doc; rendered images display
everywhere.

## Pattern A — source fence + generated image (recommended default)

```markdown
## System overview

```d2
direction: right
user -> lb -> api -> db
```

![System overview](assets/architecture-1.svg)
```

Generate the images with the bundled script (pure Python ≥3.8, no deps,
Windows/macOS/Linux/WSL):

```sh
python3 render_md.py README.md                 # writes assets/README-1.svg … and README.rendered.md
python3 render_md.py docs/*.md --in-place      # rewrite the .md files directly
python3 render_md.py README.md --format png --layout elk --theme 101
```

Behavior:
- Extracts every ```` ```d2 ```` fence, in order.
- Validates each with `d2 validate` — fails the doc loudly on error.
- Renders to `assets/<docname>-<n>.<ext>` next to the source file.
- In the output .md, each fence is followed by `![<docname> diagram n](assets/…)`.
- Skips fences whose rendered image already follows (idempotent re-runs with
  `--in-place`).
- Optional fence info string: ```` ```d2 name=payment-flow ```` →
  `assets/payment-flow.svg` (stable names instead of numbering).

## Pattern B — side-by-side (docs sites)

```markdown
| Source | Rendered |
|---|---|
| <pre>...</pre> | ![](assets/x.svg) |
```

## Pattern C — collapsible source

```markdown
![diagram](assets/x.svg)
<details><summary>D2 source</summary>

```d2
x -> y
```

</details>
```

## Choosing the export format for docs

- **SVG** (default): clickable `link`s, hover `tooltip`s, dark-theme switching via
  `--dark-theme`, crisp at any zoom. Best for GitHub READMEs and web docs.
- **PNG**: for PowerPoint/Word pipelines or wiki engines that strip SVG. Tooltips
  become a numbered appendix automatically.
- **ASCII** (`.txt`): terminals, commit messages, plain-text RFCs. Keep those
  diagrams box-and-arrow simple.

## Dark mode

```sh
d2 --dark-theme 200 -t 105 diagram.d2 diagram.svg
```

One SVG then adapts to the reader's system preference. (GitHub renders SVG in an
`<img>`, so `prefers-color-scheme` applies.) For PNG you must render two variants
and use `<picture>` or GitHub's `#gh-dark-mode-only` fragment:

```markdown
![diagram](assets/x-light.png#gh-light-mode-only)
![diagram](assets/x-dark.png#gh-dark-mode-only)
```

## CI recipe (fail the build on broken diagrams)

```sh
#!/bin/sh
# lint-diagrams.sh — validate every d2 fence in every .md
git ls-files '*.md' | while read -r f; do
  python3 render_md.py "$f" --check-only || exit 1
done
git ls-files '*.d2' | while read -r f; do d2 validate "$f" || exit 1; done
```

## Editors

- VS Code: official `terrastruct.d2` extension (syntax + preview).
- Vim/Neovim: `terrastruct/d2-vim`.
- Obsidian: community D2 plugin renders fences live (see d2 docs "obsidian").
