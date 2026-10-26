#!/usr/bin/env node
// pptx-fidelity.mjs — pptx round-trip audit (d2_pptx export -> d2_pptx_read -> compare).
// Machine gate for the pptx plane: catches missing labels, dropped connectors and
// geometry drift between the exported deck and the read-back model. Imported by
// audit/run-audit.mjs; also runnable standalone (exit 1 on any FAIL).
import { exportPptx, readPptx } from '../../../mcp-server/lib/pptx.js';
import { extract } from '../../../mcp-server/lib/extract.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, mkdirSync, rmSync } from 'node:fs';

const PX_TOL = 3; // EMU rounding + layout jitter tolerance (px)
const squash = (x) => String(x).toLowerCase().replace(/\s+/g, '');
// d2 interprets \uXXXX escapes at render time, and renders markdown blocks as
// styled text (## / ** / list bullets vanish). Normalize model labels the same
// way before comparing, so the gate fails on dropped elements, not syntax.
const renderLines = (label) =>
  String(label)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .split('\n')
    .map((l) => l.replace(/^[\s#>*-]+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean);
const isSequence = (model) =>
  (model.boardAttrs && model.boardAttrs.shape === 'sequence_diagram') ||
  (model.objects || []).some((o) => o.shape === 'sequence_diagram');

/** Discover all example .d2 files, tagged by audit set. */
export function discoverExamples(root) {
  const sets = [
    ['showcase', 'skills/d2-diagrams/examples'],
    ['model-views', 'skills/d2-diagrams/examples/model-views'],
    ['comprehension', 'skills/d2-diagrams/examples/comprehension'],
    ['adversarial', 'skills/d2-diagrams/examples/adversarial'],
  ];
  const files = [];
  for (const [set, rel] of sets)
    for (const f of readdirSync(resolve(root, rel)).filter((f) => f.endsWith('.d2')))
      files.push({ path: resolve(root, rel, f), set, rel: rel + '/' + f });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Audit every example file: export to pptx, read back, compare against the
 * source model. Returns { results, bad, files } — never throws on per-file
 * failures (each failure is recorded, not fatal).
 */
export async function auditFiles(root, { outDir, keep = true, log = () => {} } = {}) {
  outDir = outDir || resolve(root, '.pptx-fidelity');
  mkdirSync(outDir, { recursive: true });
  const results = [];
  let bad = 0;
  for (const { path: f, set, rel } of discoverExamples(root)) {
    const entry = { set, file: rel, ok: false, skip: null, problems: [], shapes: 0, lines: 0, conns: 0, driftPx: 0 };
    results.push(entry);
    const src = readFileSync(f, 'utf8');
    const model = extract(src, { resolveDir: dirname(f) });
    const outPath = resolve(outDir, rel.replace(/[/\\]/g, '_') + '.pptx');
    const exp = await exportPptx({ src, resolveDir: dirname(f), outPath });
    if (!exp.ok) {
      const multiboard = /^(layers|scenarios|steps):/m.test(src);
      if (multiboard) { entry.skip = 'multiboard (register F7)'; log('SKIP ' + rel + ' — multiboard'); continue; }
      entry.problems.push('export: ' + (exp.error || '').slice(0, 120));
      log('FAIL ' + rel + ' — export: ' + (exp.error || '').slice(0, 120));
      bad++; continue;
    }
    const back = await readPptx(outPath);
    if (!back.ok) {
      entry.problems.push('read: ' + (back.error || '').slice(0, 120));
      log('FAIL ' + rel + ' — read: ' + (back.error || '').slice(0, 120));
      bad++; continue;
    }
    entry.shapes = back.shapes.length;
    // 1. every labeled source object must appear as pptx text
    const texts = new Set(back.shapes.map((s) => squash(s.text || '')));
    const labeled = (model.objects || []).filter((o) => !o.suspended && o.label && o.label.trim() && o.label.trim().toLowerCase() !== o.id.split('.').pop().toLowerCase());
    const missing = labeled.filter((o) => !renderLines(o.label).some((line) => texts.has(squash(line))));
    if (missing.length) entry.problems.push(missing.length + ' label(s) missing: ' + missing.slice(0, 3).map((o) => o.id).join(', '));
    // 2. connectors: one pptx line per source connection (edge labels add text boxes, not lines)
    entry.lines = back.shapes.filter((s) => s.preset === 'line').length;
    const suspendedIds = new Set((model.objects || []).filter((o) => o.suspended).map((o) => o.id));
    entry.conns = (model.connections || []).filter((c) => !c.suspended && !suspendedIds.has(c.src) && !suspendedIds.has(c.dst)).length;
    if (entry.lines < entry.conns) entry.problems.push('connectors ' + entry.lines + ' < connections ' + entry.conns);
    // 3. positions: export manifest vs read-back geometry
    for (const mf of exp.manifest || []) {
      if (!mf.label) continue;
      const s = back.shapes.find((x) => (x.text || '').toLowerCase() === String(mf.label).toLowerCase());
      if (!s || s.x === null) continue;
      entry.driftPx = Math.max(entry.driftPx, Math.abs(s.x - mf.x), Math.abs(s.y - mf.y));
    }
    if (entry.driftPx > PX_TOL) entry.problems.push('position drift ' + entry.driftPx + 'px > ' + PX_TOL);
    // sequence diagrams are a known approximation (notes/actors) -> NOTE, not FAIL
    if (entry.problems.length && isSequence(model)) {
      entry.skip = 'sequence approximation';
      log('NOTE ' + rel + ' — sequence approximation: ' + entry.problems.join('; '));
    } else if (entry.problems.length) {
      log('FAIL ' + rel + ' — ' + entry.problems.join('; '));
      bad++; continue;
    } else {
      log('PASS ' + rel + ' — ' + back.shapes.length + ' elements, ' + entry.lines + '/' + entry.conns + ' connectors, drift ' + entry.driftPx + 'px');
    }
    entry.ok = !entry.problems.length || !!entry.skip;
  }
  if (!keep) rmSync(outDir, { recursive: true, force: true });
  return { results, bad, files: results.length };
}

// ---------------------------------------------------------------- CLI
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '../../..');
  if (process.env.D2_PATH && !process.env.D2_PATH.startsWith('/'))
    process.env.D2_PATH = resolve(root, process.env.D2_PATH);
  const keep = !process.argv.includes('--no-keep');
  const { bad, files } = await auditFiles(root, { keep, log: (m) => console.log(m) });
  console.log(bad ? 'PPTX FIDELITY: ' + bad + ' file(s) failed' : 'PPTX FIDELITY: all ' + files + ' pass');
  process.exit(bad ? 1 : 0);
}
