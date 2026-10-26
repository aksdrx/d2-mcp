# Visual-model regression procedure

Run whenever the extractor (`lib/extract.js`), geometry parser (`lib/svgmap.js`),
battery generator, or d2 version changes — and before releases. Requires a
vision-capable model session (native image reading).

## 1. Stimuli

```sh
mkdir -p _research/visual-regression/png
# battery (elk, as scored):
for f in skills/d2-diagrams/examples/comprehension/*.d2; do
  d2 --layout=elk "$f" "_research/visual-regression/png/$(basename "$f" .d2).png"
done
# adversarial + showcase (their own pinned engines):
#   render each of examples/adversarial/*.d2 and examples/*.d2 + model-views/*.d2
```

## 2. Blind visual pass

For each battery PNG, view the image and answer the battery questions from pixels
only — same JSON shape as the text answers (`{"<file>.d2": {qid: value}}`).
Conventions: ids are the obvious case-form of the visible label (US user → `US_user`,
Query API → `QueryAPI`); multiline labels keep raw `\n` escapes (battery key convention);
record per-fixture `_notes` for anything ambiguous. Known semantic gaps to expect:

- sequence diagrams: message arrows never cross each other — answer 0 crossings
  even though the key counts lifeline×message intersections;
- stacked-column above/left-of near-ties may differ from the geometric-nearest key;
- degree ties (e.g. 3-3 state machines) are 50/50 guesses.

## 3. Score

```sh
node skills/d2-diagrams/scripts/comprehension.mjs score \
  _research/battery-latest/comprehension-test.json \
  _research/visual-regression/answers-visual.json \
  _research/battery-latest/comprehension-key.json
```

Compare against the text pass on the same battery. Expect visual to lose only on
the documented semantic gaps; a NEW loss category means a real regression.

## 4. Detector ground-truthing

View the adversarial PNGs and confirm: adv-overlap defects are VISIBLE (label
overprint + arrow through shape); adv-clean shows zero findings. Calibration
context: `labelCollisions` is box-level (can be glyph-clean) — advisory;
`edgeOverlaps` is hard (always a real defect).

## 5. Showcase review + record

View each showcase PNG (pinned engines); note any defect the detectors missed
(aesthetics, glyph issues, color). Record everything in
`_research/visual-regression/RESULTS.md` and compare with the previous pass.
