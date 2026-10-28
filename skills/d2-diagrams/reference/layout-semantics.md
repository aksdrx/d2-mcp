# Layout semantics — the reading-order rule

How to arrange components so a diagram reads like the process it describes.
Distilled from the dense.d2 refinement study (REPORT.md, Extensions 1–3): a metric-optimal
layout (fewest crossings, aspect 1.6) was rejected by a human because it broke reading
order; encoding reading order as hard constraints produced a layout rated "much better"
with 3 crossings instead of 1's metric winner — and a cleaner endpoint fan than the
original baseline.

## The rule

Let the diagram have **entry points** (sources of the described process), **exits**
(terminal consumers / sinks), and **middle stages**. Then:

**R1 — one flow axis.** Pick a single dominant reading direction and keep every stage
subordinate to it: `direction: right` for data/process flows and pipelines,
`direction: down` for hierarchies, sequences, org charts. Never mix axes per tier.

**R2 — anchors on opposite sides.** The entry node(s) pin to the start edge of the flow
axis; the exit node(s) pin to the opposite edge. Layout optimization may never pull an
anchor into the middle: if the engine scatters them, pin them (`near:` for elk/dagre,
absolute `{top: N; left: N}` for TALA). The reader's first question is "where does this
start and where does it end" — answer it spatially before any edge is traced.

**R3 — homogeneous components are adjacent.** Components of the same role or class —
partner_a/partner_b, worker pools, replicas, edge POPs, consumer groups — form ONE
contiguous column (right flow) or row (down flow), ordered consistently with their
feeders where a natural order exists. Readers perceive them as a single group; scattering
them across the canvas destroys the group reading and tangles the feeder lanes.
In d2: place them in one container (`grid-rows`/`grid-columns` when you want uniform
cells) or pin them to a shared x/y band.

**R4 — monotone tiers.** Middle stages sit between the anchors, ordered by process order;
prefer every edge to make non-negative progress along the flow axis (feeders left of their
consumers). A structural cycle may exist in the data — render it as the one deliberate
back-flow, not as scattered zig-zags.

**R5 — spend the crossing budget at hubs.** Some crossings are mathematically inevitable
in dense meshes (complete bipartite subgraphs K3,2+ cannot be planar). When they must
exist, concentrate them at high-fan-out hub nodes — the entry or exit hub. Readers parse
a hub as "many things connect here" and tolerate a local tangle; what they cannot forgive
is a tangled **endpoint fan** (middle tiers × exits), because that region answers "who
consumes what". Practical check: in the accepted dense layout all 3 residual crossings
involve edges leaving the entry hub (checkout), while all 6 feeder→partner edges are
uncrossed.

**R6 — labels ride long segments.** Every edge label sits on a segment long enough to
carry it (mostly a horizontal run), inside the arrow or just above/below it; labels never
overprint each other or a shape. d2 places labels at the path arclength midpoint and gives
you no direct control — label quality is achieved only through node geometry (move the
nodes so the midpoint falls on a long run). TALA labels hover ≈26 px above the line.

R1–R4 are **hard constraints** (violations = reject the layout, even if it wins on
crossings); R5–R6 are **quality objectives** (minimize subject to R1–R4).

## Applying it mechanically

1. Classify every component: entry / middle / exit / homogeneous-group-of(entry|middle|exit).
2. Choose the axis and direction; assign each component a **band** (allowed x or y range).
3. Pick the engine: elk/dagre for auto-layout with `near:` hints; TALA for absolute pins
   (`id: Label {top: N; left: N}` — both required; units are canvas px under TALA).
   TALA re-routes globally on any pin change — hand edits don't compose; search instead.
4. Search pins **within the bands** (hill-climb/anneal, ~1–2k measured renders), scoring
   crossings + label-fit + collisions; bands guarantee the result still reads correctly.
5. Accept only if R1–R4 hold exactly and R5–R6 are minimized.

## Verifying programmatically

`d2_layout_map` (or `mcp-server/lib/svgmap.js` → `analyzeSvg`) measures everything
needed. After rendering the candidate:

- **Anchors opposite**: entry bbox max-x < every middle min-x; exit bbox min-x > every
  middle max-x (vertical analogue for `direction: down`).
- **Group adjacency**: homogeneous siblings share a column/row band; their pairwise gaps
  are smaller than the gap to the next tier.
- **Crossing locus**: every reported crossing should involve a hub-outbound edge or be
  provably topological; flag crossings inside an endpoint fan.
- **Labels**: 0 `labelCollisions`, 0 `edgeOverLabels`; label-fit per the Extension-3
  analyzer (some merged waypoint segment ≥ labelBox.w + 12 carries the label).
- Gate the whole thing with `skills/d2-diagrams/scripts/visual-gate.mjs`.

## Worked example

`_research/text-vs-visual/dense-tala-final.d2` (render:
`_research/text-vs-visual/png/dense-tala-final.png`): checkout pinned left as entry,
partner_a+partner_b pinned to one right-hand column as exits, pricing/inventory between
them, ledger/notifications on top, fraud/vault lower-left — baseline reading geography
kept exactly, while crossings dropped 4→3 (all at the entry hub), label collisions 2→0,
clipped labels 1→0, aspect 3.05→1.54.
