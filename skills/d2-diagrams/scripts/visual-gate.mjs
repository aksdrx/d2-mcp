#!/usr/bin/env node
// visual-gate.mjs — machine-enforced visual-quality floor for showcase examples.
// Fails (exit 1) when a rendered diagram:
//   - aspect > 2.5 or < 0.4  (R2 iterate threshold from reference/visual-quality.md)
//   - any edge route slices a shape it is not connected to (edge-over-shape)
// Crossings are reported but not gated (a bake-off may accept a few).
// Usage: node skills/d2-diagrams/scripts/visual-gate.mjs [files-or-dirs...]
//        (defaults to the showcase examples, excluding the comprehension
//         fixtures, which deliberately include degraded layouts)
import { spawnFile } from '../../../mcp-server/lib.js';
import { analyzeSvg } from '../../../mcp-server/lib/svgmap.js';
import { resolve, dirname, isAbsolute } from 'node:path';
import { readdirSync, statSync, readFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const here = dirname(new URL(import.meta.url).pathname);
const root = resolve(here, '../../..');

const args = process.argv.slice(2);
let files = [];
if (args.length) {
  for (const a of args) {
    const p = resolve(a);
    if (statSync(p).isDirectory()) files.push(...readdirSync(p).filter((f) => f.endsWith('.d2')).map((f) => resolve(p, f)));
    else files.push(p);
  }
} else {
  const ex = resolve(root, 'skills/d2-diagrams/examples');
  files = readdirSync(ex).filter((f) => f.endsWith('.d2')).map((f) => resolve(ex, f));
  const mv = resolve(ex, 'model-views');
  files.push(...readdirSync(mv).filter((f) => f.endsWith('.d2')).map((f) => resolve(mv, f)));
}
files.sort();

if (process.env.D2_PATH === undefined && process.env.D2) process.env.D2_PATH = process.env.D2;
// the exe is spawned with per-file cwd: make the path absolute or it ENOENTs
if (process.env.D2_PATH && !isAbsolute(process.env.D2_PATH)) process.env.D2_PATH = resolve(root, process.env.D2_PATH);
if (!process.env.D2_PATH) {
  // default to a d2 on PATH; spawnFile resolves via D2_PATH or PATH lookup
}

let bad = 0;
for (const f of files) {
  const rel = f.slice(root.length + 1);
  // render via source + cwd (mirrors d2_layout_map): no file paths cross the
  // process boundary, so @imports resolve and WSL/Windows exes behave.
  const src = (await import('node:fs')).readFileSync(f, 'utf8');
  const isSequence = /shape:\s*sequence_diagram/.test(src);
  const isMultiboard = /^(layers|scenarios|steps):/m.test(src);
  if (isMultiboard) { console.log('SKIP ' + rel + ' — multiboard (stdout render unsupported; covered by CI render step)'); continue; }
  const r = await spawnFile({ source: src, cwd: dirname(f), stdout: true });
  let svg = r.stdout;
  if (!r.ok) {
    // spawnFile's temp input lives in a hidden subdir of cwd, so relative
    // imports (model-views/view-*.d2 → model.d2) cannot resolve there. Retry
    // by rendering the real file path, where imports resolve naturally.
    try {
      const exe = process.env.D2_PATH || 'd2';
      const outTmp = f + '.gate.svg';
      execFileSync(exe, [f, outTmp], { stdio: 'pipe' });
      svg = readFileSync(outTmp, 'utf8');
      unlinkSync(outTmp);
    } catch {
      console.log('FAIL ' + rel + ' — render failed: ' + (r.stderr || '').trim().slice(0, 200));
      bad++;
      continue;
    }
  }
  const m = analyzeSvg(svg);
  const a = m.canvas.aspect;
  const problems = [];
  if (a > 2.5 || a < 0.4) problems.push('aspect ' + a.toFixed(2) + ' outside 0.4..2.5');
  const slices = (m.analysis.edgeOverlaps || []).length;
  if (slices > 0 && !isSequence) problems.push(slices + ' edge-over-shape slice(s): ' + m.analysis.edgeOverlaps.slice(0, 3).map((o) => o.edge + ' through ' + o.shape).join('; '));
  const labelSlices = (m.analysis.edgeOverLabels || []).length;
  if (labelSlices > 0 && !isSequence) problems.push(labelSlices + ' edge-over-label slice(s): ' + m.analysis.edgeOverLabels.slice(0, 3).map((o) => o.edge + ' over ' + o.labelOf).join('; '));
  let note = m.analysis.crossings.length ? ' [' + m.analysis.crossings.length + ' crossings]' : '';
  const labColl = (m.analysis.labelCollisions || []).length;
  if (labColl) note += ' [' + labColl + ' label collision(s)]';
  if (m.analysis.zOrder && m.analysis.zOrder.edgesPaintOverShapes === false && !isSequence) note += ' [edges painted under shapes]';
  if (isSequence && slices) note += ' [sequence: ' + slices + ' lifeline/band traversals exempt]';
  if (problems.length) { console.log('FAIL ' + rel + ' — ' + problems.join('; ') + note); bad++; }
  else console.log('PASS ' + rel + ' — ' + m.canvas.width + 'x' + m.canvas.height + ' a=' + a.toFixed(2) + note);
}
console.log(bad ? 'VISUAL GATE: ' + bad + ' file(s) failed' : 'VISUAL GATE: all ' + files.length + ' pass');
process.exit(bad ? 1 : 0);
