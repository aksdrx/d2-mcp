#!/usr/bin/env node
// example-audit.mjs — source-plane audit of the example corpus.
// For every example .d2: render with the pinned in-file vars (cwd = file dir,
// the artifact that faked 4 renderFailures in the pre-fixes baseline), then
// extract the model and measure the rendered SVG. Emits baseline-shaped
// entries + gate verdicts. Imported by audit/run-audit.mjs.
import { extract } from '../mcp-server/lib/extract.js';
import { analyzeSvg } from '../mcp-server/lib/svgmap.js';
import { discoverExamples } from '../skills/d2-diagrams/scripts/pptx-fidelity.mjs';
import { resolve, dirname, basename } from 'node:path';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const D2 = process.env.D2_PATH || 'd2';

/**
 * Audit the source plane of every example. Returns per-file entries
 * (baseline shape + renderOk + expected/visible counts) and gate verdicts:
 *  G1 every example renders (fixes the pre-fixes renderFail artifact)
 *  G2 showcase + model-views pin engine+theme (R1 regression)
 *  G3 showcase + model-views label every connection (R5 regression)
 *  G4 aspect ratio in band for horizontal-genre showcase files (R2)
 * comprehension/adversarial are metrics-only: adversarial fixtures
 * intentionally violate the rules — they exist to prove the gates can fail.
 */
export async function auditExamples(root, { log = () => {} } = {}) {
  const tmp = mkdtempSync(resolve(root, '.audit-render-'));
  try {
    const entries = [];
    for (const { path: f, set, rel } of discoverExamples(root)) {
      const e = { set, file: rel.replace('skills/d2-diagrams/examples/', '') };
      entries.push(e);
      const src = readFileSync(f, 'utf8');
      const dir = dirname(f);
      const out = resolve(tmp, e.file.replace(/[/\\]/g, '_') + '.svg');
      const r = spawnSync(D2, [f, out], { cwd: dir, encoding: 'utf8' }); // cwd = file dir (G1 lesson)
      e.renderOk = r.status === 0;
      // multiboard files (layers/scenarios/steps) render into <out-stem>/index.svg
      let svgPath = out;
      if (!existsSync(svgPath)) {
        for (const stem of [basename(out).replace(/\.svg$/, ''), basename(out).replace(/\.d2\.svg$/, '')])
          for (const cand of [resolve(tmp, stem + '/index.svg'), resolve(dir, stem + '/index.svg')])
            if (existsSync(cand)) { svgPath = cand; break; }
      }
      if (!e.renderOk || !existsSync(svgPath)) {
        e.renderOk = false;
        e.renderErr = ((r.stderr || r.stdout || '') + ' [no svg output]').split('\n')[0].slice(0, 120);
        log('RENDERFAIL ' + e.file + ' — ' + e.renderErr);
        continue;
      }
      const model = extract(src, { resolveDir: dir });
      const svg = readFileSync(svgPath, 'utf8');
      const a = analyzeSvg(svg);
      e.kind = model.boardAttrs?.shape === 'sequence_diagram' || model.objects.some((o) => o.shape === 'sequence_diagram')
        ? 'sequence' : 'flow';
      e.objects = model.metrics.objects;
      e.conns = model.metrics.connections;
      // column->column joins (sql_table ERD relations) are structure-labeled
      // (crow's foot + constraint: foreign_key) — R5 semantics-by-structure
      e.unlabeled = model.connections.filter((c) => !c.suspended && !c.label && !(String(c.src).includes('.') && String(c.dst).includes('.'))).length;
      e.visibleConns = model.connections.filter((c) => !c.suspended).length;
      e.suspended = model.objects.filter((o) => o.suspended).length + model.connections.filter((c) => c.suspended).length;
      e.pinnedEngine = model.config?.layoutEngine || null;
      e.pinnedTheme = model.config?.themeId ?? null;
      e.pinnedPad = model.config?.pad ?? null;
      e.direction = model.direction || null;
      e.canvas = a.canvas ? { w: Math.round(a.canvas.width), h: Math.round(a.canvas.height) } : null;
      e.a = a.canvas ? +(a.canvas.width / a.canvas.height).toFixed(2) : null;
      e.cross = a.crossings ?? null;
      e.collisions = a.collisions ?? null;
      e.slices = a.slices ?? null;
      e.labelSlices = a.labelSlices ?? null;
      log('OK ' + e.file + ' — a=' + e.a + ' cross=' + e.cross + ' unlabeled=' + e.unlabeled);
    }
    const g = (id, desc, pass, failures) => ({ id, desc, pass, failures: failures || [] });
    const gated = entries.filter((e) => ['showcase', 'model-views', 'stress'].includes(e.set));
    const gates = [
      g('G1', 'every example renders with its pinned vars', entries.every((e) => e.renderOk),
        entries.filter((e) => !e.renderOk).map((e) => e.file + ': ' + (e.renderErr || ''))),
      g('G2', 'showcase + model-views + stress pin layout engine and theme (R1)', gated.every((e) => e.pinnedEngine && e.pinnedTheme != null),
        gated.filter((e) => !(e.pinnedEngine && e.pinnedTheme != null)).map((e) => e.file)),
      g('G3', 'showcase + model-views + stress label every connection (R5)', gated.every((e) => e.unlabeled === 0),
        gated.filter((e) => e.unlabeled > 0).map((e) => e.file + ': ' + e.unlabeled + ' unlabeled')),
      g('G4', 'horizontal-genre showcase + stress aspect in 0.4..2.5 band (R2)', gated.every((e) => e.kind === 'sequence' || (e.a != null && e.a >= 0.4 && e.a <= 2.5)),
        gated.filter((e) => e.kind !== 'sequence' && (e.a == null || e.a < 0.4 || e.a > 2.5)).map((e) => e.file + ': a=' + e.a)),
    ];
    return { entries, gates };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] || '') === new URL(import.meta.url).pathname) {
  const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
  const { entries, gates } = await auditExamples(root, { log: (m) => console.log(m) });
  for (const g of gates) console.log((g.pass ? 'PASS ' : 'FAIL ') + g.id + ' — ' + g.desc + (g.failures.length ? ': ' + g.failures.join('; ') : ''));
  process.exit(gates.every((g) => g.pass) ? 0 : 1);
}
