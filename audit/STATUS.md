# STATUS — current

**Last full run: 2026-10-27T06:01Z — ALL GATES GREEN** (runs/2026-10-27T06-01-49-742Z.json)

```
G1=pass  every example renders with its pinned vars
G2=pass  showcase + model-views + stress pin layout engine and theme (R1)
G3=pass  showcase + model-views + stress label every connection (R5)
G4=pass  showcase + stress aspect in 0.4..2.5 band (R2)
G5=pass  pptx export -> read-back fidelity (29/29)
G6=pass  every exported pptx rasterizes to valid PNGs (29/29)
```

Corpus: 29 files — showcase 8, model-views 4, comprehension 8, adversarial 3,
stress 6 (web-sourced quantitative/complex: bank TCO, terraform, CLOS fabric,
ERD analytics, KPI dashboard, queue workers — sources cited in file headers).

Stress-round fixes (regression-locked by the gates above):

- svgmap now takes only the first whitespace token of a 'class' attr: d2 emits
  'class="<b64id> <css-class>"' for '(a -> b)[*].class: blue' styled edges and
  Node base64 silently skipped the space, decoding the css name into the id
  (bank-tco lost 3/12 edges -> pptx lost 3 connectors). Caught by G5 on the
  stress set; locked by G5 connectors>=connections on class-styled conns.
- pptx-fidelity renderLines no longer strips '_' from labels — underscores are
  snake_case, not markdown emphasis (order_items/global_connection mismatches).
  Locked by G5 label-presence checks over the stress set.

Known non-blocking approximations (recorded in every run JSON):

- sequence.d2, cqrs-sequence.d2: pptx export of sequence diagrams is an
  approximation (spans/notes map to text boxes); logged as NOTE, not FAIL.
- pptx connectors are straight 'line' preset shapes — d2's curved routes are
  flattened. See TASKS.md (planned: segment-accurate routes).
