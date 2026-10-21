# Styling D2 Diagrams

## 1. style.* keywords

Set under the reserved `style` field, on shapes and connections:

```d2
svc: API {
  style: {
    opacity: 0.9            # 0–1
    stroke: "#2E7D32"       # CSS color / hex / subset of CSS gradients
    fill: "#E8F5E9"         # shape only
    fill-pattern: dots      # dots | lines | grain | none (shape only)
    stroke-width: 2         # 1–15
    stroke-dash: 4          # 0–10
    border-radius: 8        # 0–20; big value => pill; also rounds ELK edge corners
    shadow: true            # shape only
    3d: true                # rectangle/square only
    multiple: true          # stacked-cards effect (shape only)
    double-border: true     # rectangles & ovals
    font: mono
    font-size: 20           # 8–100
    font-color: "#1B5E20"
    animated: true          # dashed-line marching ants on connections (SVG)
    bold: true
    italic: false
    underline: true
    text-transform: uppercase  # uppercase | lowercase | title | none
  }
}
```

Notes:
- On `sql_table`/`class`: `fill` colors the header, `stroke` colors the body,
  `font-color` recolors header text.
- Root level: `style.fill` sets the diagram background; also `fill-pattern`,
  `stroke` (frame), `stroke-width`, `stroke-dash`, `double-border`.
- `animated` only shows in SVG (and GIF) exports.

## 2. classes — reusable style bundles

```d2
classes: {
  service: {
    shape: rectangle
    style: {
      border-radius: 8
      fill: "#E3F2FD"
      stroke: "#1565C0"
    }
  }
  datastore: {
    shape: cylinder
    style.fill: "#FFF3E0"
  }
  deprecated: {
    style.opacity: 0.4
    style.stroke-dash: 3
  }
}

api.class: service
worker.class: [service; deprecated]  # multiple: applied left-to-right
db.class: datastore
bus -> api: {class: critical}        # works on connections too
(bus -> api)[0].class: critical      # ...or afterwards
```

- Object's own attributes override class attributes.
- Every `class` value is emitted as a CSS class on the SVG element → post-process
  with custom CSS/JS when embedding.

## 3. globs — change defaults everywhere

```d2
*.style.border-radius: 10        # every shape in this scope
(* -> *)[*]: {                   # every connection
  style.stroke-width: 2
}
```

See `syntax.md` §8 for the full glob grammar (`**`, `***`, filters).

## 4. themes

```sh
d2 themes                        # list all theme IDs
d2 -t 101 in.d2                  # light theme
d2 --dark-theme 200 in.d2        # auto-switch when viewer prefers dark
D2_THEME=101 d2 in.d2            # env var
```

Or in-file:

```d2
vars: {
  d2-config: {
    theme-id: 101
    dark-theme-id: 200
    theme-overrides: {           # recolor any palette slot
      B1: "#2E7D32"
      AA5: "#90CAF9"
    }
  }
}
```

Palette slots: `N1..N7` (neutrals), `B1..B6` (main colors), `AA2 AA4 AA5`
(accents), `AB4 AB5` (accent fills).

Special themes change more than colors — e.g. Terminal theme uppercases labels,
forces mono font, dots fill-pattern, double-border on the outermost container.
Negate with `style.text-transform: none` etc.

## 5. sketch mode

```sh
d2 --sketch in.d2 out.svg        # hand-drawn look
# or vars.d2-config.sketch: true
```

## 6. Fonts

CLI flags (`--font-regular`, `--font-bold`, `--font-italic`, `--font-semibold`,
`--font-mono*`) point at `.ttf` files — needed for CJK text or brand fonts.
Defaults: Source Sans Pro / Source Code Pro.
