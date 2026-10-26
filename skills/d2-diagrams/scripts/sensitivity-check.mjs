#!/usr/bin/env node
// sensitivity-check.mjs — detector regression track (P2-12).
// The adversarial fixtures under examples/adversarial/ encode findings the
// detectors MUST catch (and a clean control they must stay quiet on).
// Any drift in analyzeSvg sensitivity fails this check — add a fixture for
// every new defect class before fixing it.
import { spawnFile } from '../../../mcp-server/lib.js';
import { analyzeSvg } from '../../../mcp-server/lib/svgmap.js';
import { resolve, dirname } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
const root = resolve(here, '../../..');
if (process.env.D2_PATH && !process.env.D2_PATH.startsWith('/'))
  process.env.D2_PATH = resolve(root, process.env.D2_PATH);

const cases = [
  { file: 'adv-overlap.d2', expect: (m) => (m.analysis.edgeOverlaps || []).length >= 1, why: 'at least one edge-over-shape slice' },
  { file: 'adv-labels.d2', expect: (m) => (m.analysis.labelCollisions || []).length >= 1 && (m.analysis.edgeOverlaps || []).length === 0, why: 'label collision(s) without any slice' },
  { file: 'adv-clean.d2', expect: (m) => (m.analysis.edgeOverlaps || []).length === 0 && (m.analysis.edgeOverLabels || []).length === 0 && (m.analysis.labelCollisions || []).length === 0 && m.canvas.aspect >= 0.4 && m.canvas.aspect <= 2.5, why: 'zero findings and aspect in band' },
];

let bad = 0;
for (const c of cases) {
  const f = resolve(root, 'skills/d2-diagrams/examples/adversarial', c.file);
  const { readFileSync } = await import('node:fs');
  const r = await spawnFile({ source: readFileSync(f, 'utf8'), cwd: dirname(f), stdout: true });
  if (!r.ok) { console.log('FAIL ' + c.file + ' — render failed'); bad++; continue; }
  const m = analyzeSvg(r.stdout);
  if (c.expect(m)) console.log('PASS ' + c.file + ' — ' + c.why);
  else { console.log('FAIL ' + c.file + ' — expected: ' + c.why + '; got slices=' + ((m.analysis.edgeOverlaps) || []).length + ' labelSlices=' + ((m.analysis.edgeOverLabels) || []).length + ' collisions=' + ((m.analysis.labelCollisions) || []).length + ' a=' + m.canvas.aspect); bad++; }
}
console.log(bad ? 'SENSITIVITY: ' + bad + ' fixture(s) failed' : 'SENSITIVITY: all ' + cases.length + ' fixtures behave as designed');
process.exit(bad ? 1 : 0);
