# Visual Quality: The Human Plane Refinement Ladder

A diagram is "done" when it passes `d2 validate` **and** a human can read it in seconds.
D2's own design docs split legibility into two halves — *visual* ("minimal noise, clean,
aligned, no unnecessary connection crossings, no obvious improvement left") and
*semantic* ("would a coworker's hand layout be more understandable?"). This page is
the checklist for the visual half. The text half lives in `models-views.md`.

Work in **two stages, structure before beauty**:

```
stage 1  LAYOUT bake-off     pick engine x direction (structure, crossings, aspect)
stage 2  STYLE pass          themes + restrained color on the winning layout
```

MCP shortcut: one `d2_variants` call renders a whole stage for you (see below).

## Stage 1 — layout bake-off (R1–R3)

### R1. Render several variants before committing

Never ship the first render. For any architecture diagram, produce 2–4 variants and
inspect them:

```sh
d2 --layout=elk  --direction=right model.d2 out.elk-right.svg
d2 --layout=elk  --direction=down  model.d2 out.elk-down.svg
d2 --layout=dagre --direction=right model.d2 out.dagre-right.svg
# add --layout=tala when the structure is not hierarchical or needs per-container direction
```

Name them `<base>.<engine>-<direction>.svg`, compare, keep the winner (delete the rest,
then set the winner's engine/direction *in the file* via `vars.d2-config` so renders are
reproducible). Judge: fewest crossings, shortest important paths, sane aspect, no shape
piled behind another. Blind (no image viewing): judge via `d2_layout_map` geometry +
`d2_variants`' `recommended` (crossings × aspect).

MCP: `d2_variants { stage: "layout", filePath, layouts: ["elk","dagre"] }` —
returns every variant with `width/height/aspect`.

### R2. Aspect ratio

D2 has no aspect-ratio flag; control it structurally:

- `direction: right` → wide canvas; `direction: down` → tall canvas.
- Wide component sets: wrap them in a container with `grid-columns: 2|3`.
- Target **3:2 to 16:9** for diagrams embedded in docs/READMEs (screens are wide).
- Measure after render — `d2_render` returns `width/height/aspect`; or check the SVG
  `width=` attribute. If aspect > 2.5 or < 0.4, flip direction, add `grid-columns`, or
  cut a smaller view (see `models-views.md`) instead of shipping a banner.

### R3. Minimize crossings

Crossings are the #1 comprehension killer. In order:

1. **Engine choice** — ELK (`layered`) officially "minimizes crossings" and routes
   orthogonally (right angles look deliberate); dagre's curved multi-segment routes
   read as noise when dense. Dense graph → ELK. Non-hierarchical → TALA (also gives
   symmetry and per-container `direction`).
2. **Proximity** — put related components in the same container; short edges rarely
   cross. Every long edge is a candidate for regrouping.
3. **Hub surface** — shapes with degree ≥ 4 need explicit `width`/`height`
   (official D2 recipe: more edge surface → aesthetic routing). `d2_extract` reports
   `metrics.hubs` for exactly this.
4. **Split the view** — if one edge still makes a mess, the diagram is doing too much:
   cut a focused view with suspend/unsuspend instead of fighting the layout engine.
5. **Restyle, don't reroute** — when two edges must cross, differentiate them:
   `stroke-dash` for async, `stroke` color by protocol, `animated` for the hot path.

## Stage 2 — style pass (R4–R6, after the layout is fixed)

### R4. Text fits its shape

- Long labels wrap with `\n`: `db: Primary\\nPostgreSQL`.
- Auto-sized shape too tight? Set explicit `width` (labels must not touch borders).
- Uniform typography via `classes` (`style.font-size`, `bold`), not per-object tweaks.
- Arrowhead labels (`source-arrowhead.label`) bypass auto-placement — keep them ≤ 2 words.

### R5. Semantics carried by structure, not color

- `direction` carries meaning: left→right = data/time flow, top→bottom = layers.
- Shape carries meaning: cylinder = datastore, person = actor, queue = buffer,
  hexagon = gateway/route, stored_data = archive (see `syntax.md`).
- Line style carries meaning: solid = synchronous, dashed = asynchronous/event,
  animated = hot path. Decide once, apply via `classes`, show in a `legend` shape
  whenever the diagram uses ≥ 3 distinct meanings.
- Pin the title `near: top-center`; pin the legend `near: bottom-right`.

### R6. Color adds signal, not noise

Governing rule: **the diagram must stay fully comprehensible in black and white** —
color is an accent layer, never the carrier of meaning (shape/line-style/labels carry it).

- Test with theme **1 (Neutral Grey)** — that IS your monochrome check.
- Start from a low-saturation theme (0 Neutral Default, 4 Cool Classics, 303 C4 for
  architecture, 8 Colorblind Clear for accessibility, 200 Dark Mauve for dark docs).
- At most **one accent color** for what matters most (critical path, the component under
  discussion). Two accents need a justification; three is a dashboard, not a diagram.
- Decorations budget: pick at most one of `shadow`, `3d`, `sketch` — never stacked.
- Every fill/stroke must earn comprehension: if removing the style loses no information,
  remove it.

MCP: `d2_variants { stage: "style", filePath, layout: "elk", direction: "right",
themes: [1, 0, 8], sketch: true }` — renders the monochrome check, neutral,
colorblind-safe and hand-drawn variants in one call. Pick the one that reads best;
again, persist the winner's `theme-id` in `vars.d2-config`.

## Blind-agent workflow (no image viewing)

Agents that cannot see the rendered SVG still get **measured** geometry — not a
guess — via MCP `d2_layout_map`: canvas size/aspect, every component's bbox +
center + container, edge routes, **crossing pairs**, overlapping shapes, a
discretized `textMap` grid, and relative-position predicates (`left-of`,
`above`). Iterate like this:

1. **Map** — `d2_layout_map { filePath, layout, direction }` → read `textMap`,
   `relations`, `analysis.crossings`.
2. **Align with the user** — describe composition in map vocabulary ("payments
   sits row 3, left of ledger"); collect intended positions the same way
   ("queue should be right of orders").
3. **Adjust knobs** — translate intent into D2: `direction`, `near`,
   `grid-columns` on a container, regrouping into containers, hub
   `width`/`height` (from `d2_extract` metrics).
4. **Re-map and compare** — positions are deterministic per engine (except
   TALA); re-run the map and check the predicates moved as intended. Converged
   = crossings minimized, aspect in band, map matches user intent.

The bake-off itself is also blind-friendly: `d2_variants` returns `crossings` +
`aspect` per variant and a data-driven `recommended` tag (fewest crossings,
then aspect closest to 1.6) — no eyes required to shortlist, only to overrule.

## Engine quick-reference

| | dagre (default) | elk | tala |
|---|---|---|---|
| Routes | curved, can look squiggly | orthogonal (right angles) | orthogonal, whiteboard-like |
| Crossings | occasional odd routing | **officially "good at minimizing"** | handles symmetry well |
| Structure | strictly hierarchical | hierarchical (layered) + force/stress/radial/mrtree via `--elk-algorithm` | any, incl. non-hierarchical |
| Containers | container↔container via shim | native, best support | first-class |
| Special | — | SQL tables route to exact rows | `top`/`left`, `near: <shape>`, per-container `direction`, dynamic label placement |
| Caveat | unmaintained | extra bends sometimes | randomness: small edits can reshuffle the layout |

Default recipe: **dagre for quick small diagrams, ELK for dense/orthogonal work,
TALA when you need whiteboard-style control.**

## Anti-patterns → fixes

| Anti-pattern | Fix |
|---|---|
| God diagram (everything in one canvas) | Cut focused views with suspend/unsuspend globs (`models-views.md`) |
| Boxes-and-lines soup | Group by container (proximity); direction carries flow |
| Squiggly dense dagre routes | Switch to `--layout=elk` |
| Label overflows shape | `\n` wrap or explicit `width` |
| Crossed arrows hiding topology | ELK + regroup + hub width/height; or split the view |
| Rainbow palette (color = decoration) | Monochrome base (theme 1) + ONE accent |
| shadow + 3d + animated everywhere | Pick one decoration, purposefully |
| Meaning only visible in color | Encode in shape/line-style/label; color redundant |
| Banner-shaped output (aspect > 4) | Flip direction / grid-columns / split views |

## Final review checklist

- [ ] `d2 validate` exit 0
- [ ] 2+ layout variants were compared; winner persisted in `vars.d2-config`
- [ ] Crossings: minimized or deliberately differentiated
- [ ] Aspect within 3:2–16:9 (or justified exception)
- [ ] Every label fits inside its shape; arrowhead labels ≤ 2 words
- [ ] Theme-1 (monochrome) render still fully readable
- [ ] ≤ 1 accent color, ≤ 1 decoration style
- [ ] Legend present when using ≥ 3 visual meanings
- [ ] Text plane sidecars generated (`--sidecars` / `d2_extract`)

## Machine-checked gates

- Machine gates: `scripts/visual-gate.mjs` fails on aspect outside 0.4..2.5 or any
  edge-over-shape slice (arrow crossing a shape it is not connected to) in the
  showcase examples; `d2_layout_map` reports both as `analysis.crossings` and
  `analysis.edgeOverlaps`. Sequence diagrams are exempt from the slice check
  (lifelines legitimately traverse groups).

## Agent verification loop

Machine-checked in this order (MCP names in parentheses):

1. **Bake-off** — `d2_variants stage='layout'`; recommendation ranks by
   (edge slices, label slices, crossings, |aspect-1.6|). Persist the winner in
   `vars.d2-config`.
2. **Intent** — `d2_assert` your claims about the composition (left-of/above,
   inside, no-slices, aspect band, hub degree, label exists); every assertion
   returns the measured value.
3. **Floor** — `d2_visual_check` (one call) or the CI gate
   `scripts/visual-gate.mjs`: aspect inside 0.4..2.5, zero edge slices, zero
   label slices (sequence boards exempt). The gate also checks every board of a
   multiboard file via `--target` and warns on style-stage issues
   (classes without a legend; theme-1 monochrome collisions).
4. **Sensitivity** — `scripts/sensitivity-check.mjs` pins detector behavior on
   the adversarial fixtures (`examples/adversarial/`): every new defect class
   gets a fixture BEFORE it gets a fix.

