#!/usr/bin/env node
// run-audit.mjs — single entry point for the full three-plane audit.
//
//   source plane  audit/example-audit.mjs        G1..G4 (render, pins, labels, aspect)
//   pptx plane    skills/.../pptx-fidelity.mjs   G5 (export -> read-back round trip)
//   render plane  this file                      G6 (every pptx rasterizes to PNG)
//
// Writes audit/runs/<ISO>.json and exits 1 if any gate fails, so CI and
// pre-commit can block regressions. Tracking docs: audit/STATUS.md (current),
// audit/TASKS.md (in progress + planned), audit/HISTORY.md (log).
import { auditExamples } from './example-audit.mjs';
import { auditFiles } from '../skills/d2-diagrams/scripts/pptx-fidelity.mjs';
import { renderPptxPng } from '../mcp-server/lib/pptx.js';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.D2_PATH && !process.env.D2_PATH.startsWith('/'))
  process.env.D2_PATH = resolve(root, process.env.D2_PATH);

const t0 = Date.now();
const d2v = spawnSync(process.env.D2_PATH || 'd2', ['version'], { encoding: 'utf8' });

// ---- plane 1: source
console.log('== source plane (G1..G4)');
const src = await auditExamples(root, { log: (m) => console.log('  ' + m) });

// ---- plane 2: pptx round-trip fidelity (keeps .pptx-fidelity/ for plane 3)
console.log('== pptx fidelity plane (G5)');
const fid = await auditFiles(root, { keep: true, log: (m) => console.log('  ' + m) });
const g5 = { id: 'G5', desc: 'pptx export -> read-back: labels, connectors, geometry', pass: fid.bad === 0, failures: fid.results.filter((r) => !r.ok && !r.skip).map((r) => r.file + ': ' + r.problems.join('; ')) };

// ---- plane 3: pptx render plane — every exported deck rasterizes
console.log('== pptx render plane (G6)');
const fidDir = resolve(root, '.pptx-fidelity');
const scale = 2;
const renders = [];
for (const f of readdirSync(fidDir).filter((f) => f.endsWith('.pptx')).sort()) {
  const r = await renderPptxPng(resolve(fidDir, f), { outDir: resolve(root, '.audit-render'), scale });
  const e = { file: f, ok: r.ok === true, error: r.error || null, slides: r.slides ? r.slides.length : 0, canvas: r.canvas || null, notes: r.notes || [] };
  if (r.ok && r.slides) {
    for (const s of r.slides) {
      const buf = readFileSync(s.file);
      const pngMagic = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      e.pngMagic = e.pngMagic !== false && pngMagic;
      e.minBytes = Math.min(e.minBytes ?? Infinity, buf.length);
      e.dimsOk = e.dimsOk !== false && s.width === r.canvas.width * scale;
    }
    if (!e.pngMagic || !e.dimsOk || e.minBytes < 5000) { e.ok = false; e.error = 'pngMagic=' + e.pngMagic + ' dimsOk=' + e.dimsOk + ' minBytes=' + e.minBytes; }
  }
  renders.push(e);
  console.log('  ' + (e.ok ? 'PASS' : 'FAIL') + ' ' + f + ' — ' + e.slides + ' slide(s)' + (e.ok ? '' : ' — ' + e.error));
}
rmSync(resolve(root, '.audit-render'), { recursive: true, force: true });
const g6 = {
  id: 'G6', desc: 'every exported pptx rasterizes to valid PNGs (vision feed)',
  pass: renders.every((e) => e.ok),
  failures: renders.filter((e) => !e.ok).map((e) => e.file + ': ' + e.error),
};

// ---- assemble + persist
const gates = [...src.gates, g5, g6];
const run = {
  when: new Date().toISOString(),
  tookMs: Date.now() - t0,
  tools: { d2: (d2v.stdout || '').trim().split('\n')[0], node: process.version },
  source: { entries: src.entries },
  fidelity: { results: fid.results, bad: fid.bad },
  render: { scale, results: renders },
  gates,
  gateSummary: gates.map((g) => g.id + '=' + (g.pass ? 'pass' : 'FAIL')).join(' '),
};
mkdirSync(resolve(root, 'audit/runs'), { recursive: true });
const outPath = resolve(root, 'audit/runs', run.when.replace(/[:.]/g, '-') + '.json');
writeFileSync(outPath, JSON.stringify(run, null, 1) + '\n');

console.log('\n' + run.gateSummary);
console.log('run: ' + basename(outPath) + ' (' + run.tookMs + 'ms)');
process.exit(gates.every((g) => g.pass) ? 0 : 1);
