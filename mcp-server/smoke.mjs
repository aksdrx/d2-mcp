// Self-contained MCP smoke test: boots the stdio server, exercises every tool,
// exits non-zero on any failure. Used by CI; run locally with:
//   node mcp-server/smoke.mjs            (d2 resolved from PATH, or set D2_PATH)
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';

const p = spawn('node', ['mcp-server/index.js']);
const rl = readline.createInterface({ input: p.stdout });
let id = 0;
const pending = new Map();
const t0 = Date.now();
const send = (method, params) => new Promise((res) => {
  const i = ++id;
  pending.set(i, res);
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
});
rl.on('line', (l) => {
  try {
    const m = JSON.parse(l);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  } catch {}
});

await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const call = (name, args) => send('tools/call', { name, arguments: args });
const text = (r) => r.result.content[0].text;
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!cond) fail++;
};

// scratch dir inside cwd: the Windows d2 exe under WSL cannot use POSIX /tmp paths
const tmp = '.d2-smoke';
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
try {
  // 1. d2_validate: ok + structured errors
  check('validate ok', JSON.parse(text(await call('d2_validate', { source: 'a -> b' }))).ok === true);
  const bad = JSON.parse(text(await call('d2_validate', { source: 'a ->' })));
  check('validate bad structured', bad.ok === false && Array.isArray(bad.errors) && bad.errors.length > 0 && typeof bad.errors[0].line === 'number',
    JSON.stringify(bad.errors && bad.errors[0]).slice(0, 100));

  // 2. d2_extract: inline + import resolution via inputFile
  const ex1 = JSON.parse(text(await call('d2_extract', { source: 'x: {a}\n x.a -> x.b: call' })));
  check('extract inline', ex1.ok === true && ex1.objects.length >= 2 && ex1.connections.length === 1);
  const m2 = JSON.parse(text(await call('d2_extract', { filePath: 'skills/d2-diagrams/examples/model-views/view-payment-flow.d2' })));
  check('extract import-merged', m2.ok === true && m2.objects.length === 8 && m2.connections.length === 8, m2.objects.length + 'obj/' + m2.connections.length + 'conn');

  // 3. d2_md_render with sidecars on a scratch copy
  writeFileSync(tmp + '/doc.md', '# T\n\n```d2 name=g\na -> b: hi\n```\n');
  const mdr = JSON.parse(text(await call('d2_md_render', { paths: [tmp + '/doc.md'], outDir: 'assets', sidecars: true })));
  const f0 = mdr.files && mdr.files[0];
  let sideOk = false;
  try { readFileSync(tmp + '/assets/g.txt', 'utf8'); readFileSync(tmp + '/assets/g.relations.json', 'utf8'); sideOk = true; } catch {}
  check('md_render+sidecars', mdr.ok === true && f0 && f0.failed === 0 && sideOk, JSON.stringify(f0));

  // 4. d2_fmt stdin
  check('fmt', JSON.parse(text(await call('d2_fmt', { source: 'a->b' }))).formatted.trim() === 'a -> b');

  // 5. d2_render to outputPath (writes SVG)
  const rr = JSON.parse(text(await call('d2_render', { source: 'x -> y: e', outputPath: tmp + '/r.svg' })));
  let svgOk = false;
  try { svgOk = readFileSync(tmp + '/r.svg', 'utf8').startsWith('<'); } catch {}
  check('render file', rr.ok === true && svgOk, rr.message || '');

  // 6. d2_variants: layout bake-off ranks and recommends
  const varr = JSON.parse(text(await call('d2_variants', { source: 'a -> b -> c', stage: 'layout', outDir: tmp + '/variants' })));
  check('variants layout', varr.ok === true && Array.isArray(varr.variants) && varr.variants.length >= 2 && !!varr.recommended,
    (varr.variants || []).length + ' variants');

  // 7. d2_layout_map: geometry as text
  const lm = JSON.parse(text(await call('d2_layout_map', { source: 'a -> b\nc -> d' })));
  check('layout_map', lm.ok === true && lm.components && lm.components.length === 4 && Array.isArray(lm.relations),
    lm.components ? lm.components.length + ' components' : 'none');

  // 8. layouts / themes / version
  const layTxt = text(await call('d2_layouts', {}));
  check('layouts', layTxt.includes('dagre') && layTxt.includes('tala'), layTxt.slice(0, 60));
  const thTxt = text(await call('d2_themes', {}));
  check('themes', thTxt.length > 100, thTxt.length + ' chars');
  const ver = JSON.parse(text(await call('d2_version', {})));
  check('version', typeof ver.version === 'string' && ver.version.length > 0, ver.version || '');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fail ? 'SMOKE FAILURES: ' + fail : 'SMOKE ALL GREEN (10 tools)');
p.kill();
process.exit(fail ? 1 : 0);
