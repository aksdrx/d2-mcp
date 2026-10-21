# Positioning Components in D2

How to control where things land. D2's philosophy: the layout engine positions
everything; you *influence* layout with structure. The only true absolute placement
is `top`/`left` on the TALA engine.

## 0. Choose the engine first

| Engine | Strengths | Positioning extras |
|---|---|---|
| `dagre` (default) | fast, hierarchical, battle-tested | none beyond `direction` + `near` constants |
| `elk` | orthogonal edges, container routing, exact SQL-row edges | `width`/`height` on containers |
| `tala` | built for software architecture; symmetric, non-hierarchical | `top`/`left`, `near: <shape>`, per-container `direction`, container dims, grid cell routing |

Set it reproducibly in-file:

```d2
vars: {
  d2-config: {
    layout-engine: tala
  }
}
```

or via CLI `--layout=tala` / env `D2_LAYOUT=tala` (these override the file).

## 1. direction — relative flow

```d2
direction: right   # up | down | right | left (default is down)
```

- Applies to the scope it's declared in.
- **TALA only**: may be set per-container; other engines are single-direction.
- Cheapest, most robust positioning tool. `direction: right` + containers gets you
  classic left-to-right system diagrams.

## 2. near — pin to canvas edges (all engines)

Eight constants: `top-left` `top-center` `top-right` `center-left` `center-right`
`bottom-left` `bottom-center` `bottom-right`.

```d2
title: Payment Platform — System Context {
  near: top-center
}

legend: {
  near: bottom-right
  sync: {style.fill: "#8CE99A"}
  async: {style.fill: "#FFE066"}
}

note: |md
  ## Why two databases?
  GDPR requires EU data residency.
| {
  near: bottom-left
}
```

Great for: titles, legends, long-form explanations pinned outside the flow.

### near another shape (TALA only)

```d2
explanation: |md ... | {
  near: aws   # absolute ID of another object
}
```

### Label & icon micro-positioning (all engines)

```d2
server: {
  label.near: outside-top-center    # outside-* puts label outside bounding box
  icon.near: border-bottom-right    # border-* sits on the border
}
```

Values for label/icon: the 8 constants plus `outside-top-left`,
`outside-top-center`, `outside-top-right`, `outside-left-center`,
`outside-right-center`, `outside-bottom-left`, `outside-bottom-center`,
`outside-bottom-right` (note the order: `outside-left-center` ≠ `center-left`),
and `border-` prefixed variants.

`tooltip` + `near` = permanently visible tooltip.

## 3. grid-rows / grid-columns — structured placement (all engines)

```d2
grid-rows: 3       # objects fill row by row
grid-columns: 2    # ...or column by column
# BOTH set: whichever keyword appears FIRST is the dominant fill direction

grid-gap: 0            # equivalent to setting both gaps
vertical-gap: 20
horizontal-gap: 40
```

- Cells fill in **declaration order** of the shapes.
- Column cells share width; row cells share height. Fix ragged cells with explicit
  `width`/`height` on shapes.
- With only rows OR only columns set, objects expand to fill the axis.
- Align asymmetric content with invisible spacers:

```d2
grid-rows: 2
a
pad1: "" {style.opacity: 0}   # invisible spacer
b
c
```

- Connections between grid cells: straight center-to-center on dagre/ELK, proper
  routing on TALA. Connections to/from a grid container itself work normally.
- Grids nest: put grids, sequence diagrams, or normal containers inside grid cells.
- `grid-gap: 0` builds seamless maps/tables; consider Markdown tables for dense data.

## 4. width / height — sizing

```d2
lb: Load Balancer {
  width: 280
  height: 120
}
```

- Works on any non-container shape on all engines.
- On containers: TALA and ELK only (TALA may grow them to fit children).
- `circle`/`square` stay 1:1 (max of the two wins).

## 5. top / left — absolute lock (TALA only)

```d2
vars: {d2-config: {layout-engine: tala}}

x: {
  top: 100    # px from top of diagram
  left: 100   # px from left; BOTH must be set
}
x -> y        # TALA positions y around the locked x
```

Use sparingly: pin one or two anchors (e.g. "client always top-left"), let TALA flow
the rest. Locking many objects re-creates the maintenance burden of drag-and-drop
tools.

## 6. Structural techniques that move things (any engine)

1. **Declaration order** — first-seen order influences placement; declare the
   backbone flow first, then side branches.
2. **Container hierarchy** — grouping is the strongest layout signal. Prefer
   `region.az.service` nesting over flat shapes with long names.
3. **Connection direction** — `a -> b` pulls b "after" a along `direction`.
   Use `<-` instead of `->` to flip emphasis without rewriting.
4. **Invisible helpers** — `spacer: "" {style.opacity: 0}` and undisplayed
   connections (`a -> b: {style.opacity: 0}`) nudge layout. Keep them commented
   as layout hints so future editors don't delete them.
5. **Chains** — `a -> b -> c -> d` guarantees a clean pipeline ordering.

## 7. Cheat matrix

| Requirement | Recipe |
|---|---|
| "Overview reads left to right" | `direction: right` at root |
| "DB column on the far right" | `direction: right` + containers per column |
| "Title on top, legend bottom-right" | `near: top-center` / `near: bottom-right` |
| "3×2 matrix of services" | `grid-rows: 3` `grid-columns: 2` |
| "Note glued to the payments container" | TALA + `near: payments` |
| "Logo exactly at (20,20)" | TALA + `top`/`left` |
| "All boxes same size" | `width`/`height` per shape or class |
| "Timeline across the top" | `direction: right` inside that container (TALA) |
