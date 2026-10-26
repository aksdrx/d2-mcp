#!/usr/bin/env node
/**
 * mdrender.js — render ```d2 fenced blocks inside Markdown files.
 *
 * Pure JS (no Python). For each fenced d2 block:
 *   1. validate + render it to SVG/PNG via the d2 binary,
 *   2. refresh the image link directly under the fence,
 *   3. optionally write dual-plane sidecars:
 *        <name>.txt            — compact text view of relationships (AI plane)
 *        <name>.relations.json — machine-readable relationship model
 *
 * Fence info string options: layout=<engine> theme=<id> dark-theme=<id>
 * sketch=true pad=<n> center=true scale=<n>
 *
 * Usage:
 *   node mdrender.js doc.md [more.md ...] [--format svg|png]
 *        [--d2 <path-to-d2>] [--out-dir <dir>] [--sidecars]
 *        [--check-only] [--force]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { extract, toText } from "./extract.js";
import { analyzeSvg } from "./svgmap.js";

// ---------------------------------------------------------------- helpers

function parseArgs(argv) {
  const opts = {
    files: [],
    format: "svg",
    d2: process.env.D2_PATH || "d2",
    outDir: null,
    sidecars: false,
    checkOnly: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format") opts.format = argv[++i];
    else if (a === "--d2") opts.d2 = argv[++i];
    else if (a === "--out-dir") opts.outDir = argv[++i];
    else if (a === "--sidecars") opts.sidecars = true;
    else if (a === "--check-only") opts.checkOnly = true;
    else if (a === "--force") opts.force = true;
    else if (a === "-" || a === "-") opts.files.push(a);
    else if (!a.startsWith("--")) opts.files.push(a);
  }
  return opts;
}

/** Parse the fence info string: "d2 layout=elk theme=105 sketch" */
function fenceOptions(info) {
  const out = {};
  for (const tok of info.split(/[\s,]+/).filter(Boolean)) {
    if (tok === "d2") continue;
    const m = tok.match(/^([a-zA-Z-]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, k, v] = m;
    out[k] = v === undefined ? true : v;
  }
  return out;
}

/** Find ```d2 fenced blocks. Returns [{start,end,info,body,indent}] (line indexes, end exclusive-ish). */
export function findD2Fences(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)```([a-zA-Z0-9_-]*)(.*)$/);
    if (m && m[2].toLowerCase() === "d2") {
      const indent = m[1];
      const start = i;
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (/^(\s*)```\s*$/.test(lines[j]) && lines[j].startsWith(indent)) break;
        body.push(lines[j].slice(Math.min(indent.length, lines[j].length)));
      }
      blocks.push({ start, end: j, info: (m[3] || "").trim(), body: body.join("\n"), indent });
      i = j + 1;
    } else {
      i++;
    }
  }
  return blocks;
}

/** Derive output basename for a block: nearest heading, else block index. */
function blockName(lines, block, idx, mdPath) {
  let title = null;
  for (let i = block.start - 1; i >= 0; i--) {
    const m = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (m) {
      title = m[1];
      break;
    }
  }
  const base = path.basename(mdPath, path.extname(mdPath));
  const slug = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base}-${slug ? slug + "-" : ""}${String(idx + 1).padStart(2, "0")}`;
}

function runD2(opts, src, outPath, fenceOpts) {
  const tmp = outPath + ".src.d2";
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(tmp, src);
  const args = [tmp, outPath];
  if (fenceOpts.layout) args.push("--layout", String(fenceOpts.layout));
  if (fenceOpts.theme) args.push("--theme", String(fenceOpts.theme));
  if (fenceOpts["dark-theme"]) args.push("--dark-theme", String(fenceOpts["dark-theme"]));
  if (String(fenceOpts.sketch) === "true") args.push("--sketch");
  if (fenceOpts.pad) args.push("--pad", String(fenceOpts.pad));
  if (String(fenceOpts.center) === "true") args.push("--center");
  if (fenceOpts.scale) args.push("--scale", String(fenceOpts.scale));
  const r = spawnSync(opts.d2, args, { encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "", tmp };
}

/** Refresh the image link line(s) directly below a fence. */
function imageLinkLine(linkPath, alt) {
  return `![${alt}](${linkPath})`;
}

// ---------------------------------------------------------------- core

/**
 * Process one markdown file.
 * @returns {{rendered: number, failed: number, errors: string[]}}
 */
export function renderMarkdown(mdPath, opts) {
  const raw = fs.readFileSync(mdPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const fences = findD2Fences(lines);
  const errors = [];
  if (!fences.length) return { rendered: 0, failed: 0, errors };

  const relDir = opts.outDir || path.join(path.dirname(mdPath), "diagrams");
  const outDir = path.isAbsolute(relDir) ? relDir : path.join(path.dirname(mdPath), relDir);
  let rendered = 0;
  let skipped = 0;
  let failed = 0;
  const outLines = [...lines];
  const manifestPath = path.join(outDir, ".d2-manifest.json");
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {}
  const saveManifest = () => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  };

  // process bottom-up so indexes stay valid
  const sorted = [...fences].reverse();
  for (let bi = 0; bi < sorted.length; bi++) {
    const block = sorted[bi];
    const idx = fences.indexOf(block);
    const fenceOpts = fenceOptions(block.info);
    const name = fenceOpts.name || blockName(lines, block, idx, mdPath);
    const format = fenceOpts.format || opts.format;

    // text plane always available (no binary needed)
    const model = opts.sidecars || opts.checkOnly ? extract(block.body) : null;
    if (opts.sidecars) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, name + ".txt"),
        toText(model) + "\n",
      );
      // v1 text-only sidecar; upgraded with geometry after a successful render
      fs.writeFileSync(
        path.join(outDir, name + ".relations.json"),
        JSON.stringify(model, null, 2) + "\n",
      );
    }

    if (opts.checkOnly) {
      if (model && model.warnings && model.warnings.length) {
        errors.push(`${mdPath} block ${idx + 1}: ${model.warnings.join("; ")}`);
      }
      continue;
    }

    const outPath = path.join(outDir, `${name}.${format}`);
    const srcHash = crypto.createHash("sha256").update(block.body + "|" + JSON.stringify(fenceOpts) + "|" + format).digest("hex").slice(0, 16);
    const stale =
      opts.force ||
      !fs.existsSync(outPath) ||
      manifest[mdPath + "#" + name] !== srcHash;
    if (!stale) {
      skipped++;
      continue;
    }

    const res = runD2(opts, block.body, outPath, fenceOpts);
    try {
      fs.unlinkSync(res.tmp);
    } catch {}
    if (!res.ok) {
      failed++;
      errors.push(`${mdPath} block ${idx + 1}: d2 failed: ${(res.stderr || res.stdout).trim().split("\n").slice(0, 4).join(" | ")}`);
      continue;
    }
    rendered++;
    manifest[mdPath + "#" + name] = srcHash;

    // sidecar v2: join the measured geometry into the relations model so both
    // planes + the label->id join travel in ONE artifact per diagram
    if (opts.sidecars && model && format === "svg") {
      try {
        const svgText = fs.readFileSync(outPath, "utf8");
        const map = analyzeSvg(svgText);
        const byId = new Map(map.components.map((c) => [c.id, c]));
        const objects = (model.objects || []).map((o) => {
          const g = byId.get(o.id);
          return g
            ? { ...o, bbox: [g.x, g.y, g.w, g.h], center: [g.cx, g.cy] }
            : { ...o };
        });
        const geoEdges = new Map();
        for (const e of map.edges || []) geoEdges.set(e.src + "\u0000" + e.dst, e);
        const connections = (model.connections || []).map((c) => {
          const e = geoEdges.get(c.src + "\u0000" + c.dst);
          return e ? { ...c, ...(e.index !== undefined ? { index: e.index } : {}), route: e.waypoints } : { ...c };
        });
        const v2 = {
          schema: "d2-relations-v2",
          ...model,
          kind: map.kind,
          canvas: map.canvas,
          objects,
          connections,
          analysis: {
            crossings: (map.analysis.crossings || []).length,
            edgeOverlaps: (map.analysis.edgeOverlaps || []).slice(0, 20),
            edgeOverLabels: (map.analysis.edgeOverLabels || []).slice(0, 20),
            labelCollisions: (map.analysis.labelCollisions || []).slice(0, 20),
          },
        };
        fs.writeFileSync(path.join(outDir, name + ".relations.json"), JSON.stringify(v2, null, 2) + "\n");
      } catch {
        /* keep the v1 sidecar if geometry analysis fails */
      }
    }
    const linkPath = path.isAbsolute(relDir)
      ? path.relative(path.dirname(path.resolve(mdPath)), outPath)
      : `${relDir}/${name}.${format}`;
    let ins = block.end + 1;
    while (ins < outLines.length && outLines[ins].trim() === "") ins++;
    const linkRe = /^!\[[^\]]*\]\([^)]*\)\s*$/;
    if (ins < outLines.length && linkRe.test(outLines[ins])) {
      const alt = (outLines[ins].match(/^!\[([^\]]*)\]/) || [])[1] || name;
      outLines[ins] = imageLinkLine(linkPath.split(path.sep).join("/"), alt || name);
    } else {
      outLines.splice(block.end + 1, 0, "", imageLinkLine(linkPath.split(path.sep).join("/"), name));
    }
  }

  if (!opts.checkOnly && (rendered || failed)) {
    fs.writeFileSync(mdPath, outLines.join("\n"));
    saveManifest();
  }
  return { rendered, skipped, failed, errors };
}

// ---------------------------------------------------------------- CLI

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.files.length) {
    console.error("usage: node mdrender.js <file.md ...> [--format svg|png] [--d2 <path>] [--out-dir <dir>] [--sidecars] [--check-only] [--force]");
    process.exit(2);
  }
  let bad = 0;
  for (const f of opts.files) {
    const r = renderMarkdown(f, opts);
    console.log(`${f}: ${r.rendered} rendered, ${r.skipped || 0} fresh, ${r.failed} failed${opts.checkOnly ? " (check-only)" : ""}`);
    for (const e of r.errors) console.error("  ! " + e);
    bad += r.failed;
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main();
}
