#!/usr/bin/env node
// Comprehension verification for text-only agents.
//
// Generates, per example diagram: a TEXT DOSSIER (what a blind agent may read:
// extract --text + measured layout map) and a QUESTION battery whose ground
// truth is derived from the same measured geometry the SVG shows. Then scores
// an agent's answers against the key.
//
//   node comprehension.mjs generate <examples-dir> [--out <dir>]   # -> test.json + key.json
//   node comprehension.mjs score <test.json> <answers.json> <key.json>
//
// D2 binary: D2_PATH env or --d2 flag (defaults like the MCP server).

import { extract, toText } from "../../../mcp-server/lib/extract.js";
import { analyzeSvg } from "../../../mcp-server/lib/svgmap.js";
import { spawnFile } from "../../../mcp-server/lib.js";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : def;
}

async function renderSvg(file) {
  const res = await spawnFile({ inputFile: file, args: ["--layout=elk"], stdout: true });
  if (!res.ok || !res.stdout) throw new Error("render failed for " + file + ": " + (res.stderr || "").trim());
  return res.stdout;
}

const norm = (s) => String(s).trim().toLowerCase();
const setEq = (a, b) => {
  const A = new Set((a || []).map(norm));
  const B = new Set((b || []).map(norm));
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
};

// ------------------------------------------------------------- generation

async function buildOne(file) {
  const src = readFileSync(file, "utf8");
  const model = extract(src, { resolveDir: dirname(file) });
  const map = analyzeSvg(await renderSvg(file));

  const warnings = [];
  // consistency: extract's container claims vs measured geometry containment
  const geoById = new Map(map.components.map((c) => [c.id, c]));
  for (const o of model.objects) {
    const g = geoById.get(o.id);
    if (o.container && g && g.container && o.container !== g.container) {
      warnings.push(`container mismatch for ${o.id}: model=${o.container} geometry=${g.container}`);
    }
  }

  // ---- dossier: everything a blind agent is allowed to see
  const dossier = {
    file: basename(file),
    extractText: toText(model),
    layoutMap: {
      canvas: map.canvas,
      components: map.components.map((c) => ({
        id: c.id,
        bbox: [c.x, c.y, c.w, c.h],
        center: [c.cx, c.cy],
        ...(c.container ? { inside: c.container } : {}),
      })),
      edges: map.edges.map((e) => ({ id: e.id, from: e.src, to: e.dst, route: e.waypoints })),
      analysis: map.analysis,
      textMap: map.textMap,
      relations: map.relations,
    },
  };

  // ---- questions + ground truth (answers go to the key only)
  const Q = [];
  const K = {};
  const q = (id, question, answer, type = "exact") => {
    Q.push({ id, question, type });
    K[id] = answer;
  };

  q("objects", `How many components (not counting the title) does "${dossier.file}" contain?`, model.objects.length, "number");
  q("connections", `How many connections does it contain?`, model.connections.length, "number");

  const labeled = model.connections.filter((c) => c.label);
  if (labeled.length) {
    const e = labeled[Math.floor(labeled.length / 2)];
    q("edge-label", `What is the label on the connection from "${e.src}" to "${e.dst}"?`, e.label, "string");
  }

  const degree = new Map();
  for (const c of model.connections) {
    degree.set(c.src, (degree.get(c.src) || 0) + 1);
    degree.set(c.dst, (degree.get(c.dst) || 0) + 1);
  }
  let hub = null;
  let hubDeg = 0;
  for (const [id, d] of degree) if (d > hubDeg) { hub = id; hubDeg = d; }
  if (hub && hubDeg >= 3) {
    q("hub", `Which single component has the most connections (${hubDeg})?`, hub, "string");
    const neighbors = model.connections
      .filter((c) => c.src === hub || c.dst === hub)
      .map((c) => (c.src === hub ? c.dst : c.src));
    q("neighbors", `List ALL components directly connected to "${hub}".`, [...new Set(neighbors)], "set");
  }

  const contained = model.objects.filter((o) => o.container);
  if (contained.length) {
    const target = contained[Math.floor(contained.length / 3)];
    q("inside", `Which container is "${target.id}" inside?`, target.container, "string");
    const contName = target.container;
    const members = model.objects.filter((o) => o.container === contName).map((o) => o.id);
    if (members.length > 1 && members.length < 8)
      q("members", `List ALL components inside "${contName}".`, members, "set");
  }

  if (map.relations.length) {
    const lr = map.relations.filter((r) => r.rel === "left-of");
    if (lr.length) {
      const r = lr[Math.floor(lr.length / 2)];
      q("left-of", `In the rendered layout, which component is directly to the LEFT of "${r.b}"? (answer with one id)`, r.a, "string");
    }
    const ar = map.relations.filter((r) => r.rel === "above");
    if (ar.length) {
      const r = ar[Math.floor(ar.length / 2)];
      q("above", `In the rendered layout, which component is directly ABOVE "${r.b}"? (answer with one id)`, r.a, "string");
    }
  }

  q("crossings", `With the elk engine, how many PAIRS of connections cross each other?`, map.analysis.crossings.length, "number");
  const a = map.canvas.aspect;
  q("aspect", `Is the rendered canvas wide (aspect >= 1.5), tall (aspect <= 0.67), or roughly square? Its aspect is ${a}.`, a >= 1.5 ? "wide" : a <= 0.67 ? "tall" : "square", "string");

  return { dossier, questions: Q, key: K, ...(warnings.length ? { warnings } : {}) };
}

async function generate(dir, outDir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".d2"))
    .sort()
    .map((f) => resolve(dir, f));
  const tests = [];
  const keys = {};
  for (const f of files) {
    const t = await buildOne(f);
    tests.push(t);
    keys[t.dossier.file] = t.key;
    process.stderr.write(`generated ${t.dossier.file}: ${t.questions.length} questions` + (t.warnings ? " [WARNINGS: " + t.warnings.join("; ") + "]" : "") + "\n");
    delete t.key;
  }
  mkdirSync(outDir, { recursive: true });
  const testPath = join(outDir, "comprehension-test.json");
  const keyPath = join(outDir, "comprehension-key.json");
  writeFileSync(testPath, JSON.stringify({ generated: new Date().toISOString(), tests }, null, 1));
  // key file keeps only answers, never the dossier
  writeFileSync(keyPath, JSON.stringify(keys, null, 1));
  console.log("wrote " + testPath + " and " + keyPath);
}

// ------------------------------------------------------------- scoring

function score(testPath, answersPath, keyPath) {
  const test = JSON.parse(readFileSync(testPath, "utf8"));
  const given = JSON.parse(readFileSync(answersPath, "utf8"));
  const key = JSON.parse(readFileSync(keyPath, "utf8"));
  let pass = 0;
  let total = 0;
  const lines = [];
  for (const t of test.tests) {
    const fileAnswers = given[t.dossier.file] || {};
    for (const q of t.questions) {
      total++;
      const expected = key[t.dossier.file][q.id];
      const actual = fileAnswers[q.id];
      let ok;
      if (q.type === "set") ok = Array.isArray(actual) && setEq(actual, expected);
      else if (q.type === "number") ok = Number(actual) === Number(expected);
      else ok = norm(actual) === norm(expected);
      if (ok) pass++;
      lines.push(`${ok ? "PASS" : "FAIL"} ${t.dossier.file} ${q.id}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
    }
  }
  console.log(lines.join("\n"));
  const pct = total ? Math.round((pass / total) * 100) : 0;
  console.log(`\nSCORE: ${pass}/${total} (${pct}%) — ${pct >= 90 ? "PARITY: text-plane comprehension equivalent" : pct >= 70 ? "PARTIAL: review failed categories" : "BELOW PARITY"}`);
  process.exit(pct >= 90 ? 0 : 1);
}

// ------------------------------------------------------------- main
const mode = process.argv[2];
if (mode === "generate") {
  const dir = resolve(root, process.argv[3] || "skills/d2-diagrams/examples/comprehension");
  const outDir = resolve(process.cwd(), arg("--out", "."));
  if (arg("--d2")) process.env.D2_PATH = resolve(process.argv[process.argv.indexOf("--d2") + 1]);
  await generate(dir, outDir);
} else if (mode === "score") {
  score(resolve(process.cwd(), process.argv[3]), resolve(process.cwd(), process.argv[4]), resolve(process.cwd(), process.argv[5]));
} else {
  console.error("usage: comprehension.mjs generate [examples-dir] [--out dir] [--d2 path] | score <test.json> <answers.json> <key.json>");
  process.exit(2);
}
