// pptx.js — native PowerPoint round-trip for D2 diagrams.
//
// exportPptx: render + measure the diagram, then rebuild it in .pptx as NATIVE,
// movable PowerPoint shapes (preset geometries, connectors, text) so humans can
// rearrange the diagram in PowerPoint itself.
//
// readPptx: parse a .pptx slide back into a relations-style JSON (shapes with
// positions/texts + connectors) so text models can ingest the human's edits,
// and vision models can be fed a screenshot of the edited slide.
import { spawnFile } from '../lib.js';
import { extract } from './extract.js';
import { analyzeSvg } from './svgmap.js';
import { resolve } from 'node:path';
import fs from 'node:fs';
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';

const EMU_PER_PX = 9525; // 96 px per inch, 914400 EMU per inch
const pxToIn = (px) => Math.round((px / 96) * 10000) / 10000;
const hex6 = (c) => {
  if (!c) return null;
  const m = String(c).match(/#?([0-9A-Fa-f]{6})/);
  return m ? m[1].toUpperCase() : null;
};

// d2 shape name -> PowerPoint preset geometry (closest native analog).
const SHAPE_MAP = {
  rectangle: 'rect',
  rounded_rectangle: 'roundRect',
  cylinder: 'can',
  queue: 'can',
  cloud: 'cloud',
  diamond: 'diamond',
  hexagon: 'hexagon',
  oval: 'ellipse',
  ellipse: 'ellipse',
  circle: 'ellipse',
  page: 'foldedCorner',
  document: 'flowChartDocument',
  person: 'ellipse', // no native person glyph; approximate (label carries meaning)
  text: null,
  code: 'rect',
  class: 'rect',
  sql_table: 'rect',
  paragraph: 'rect',
};
const presetFor = (shape) => (shape && SHAPE_MAP[shape] !== undefined ? SHAPE_MAP[shape] : 'rect');

/** Render + measure the diagram, then build a native-shape .pptx at outPath. */
export async function exportPptx({ src, resolveDir, outPath }) {
  const res = await spawnFile({ source: src, cwd: resolveDir, stdout: true });
  if (!res.ok || !res.stdout) {
    return { ok: false, error: (res.stderr || res.stdout || '').trim() };
  }
  const svg = res.stdout;
  const map = analyzeSvg(svg);
  const model = extract(src, { resolveDir });
  const byId = new Map(map.components.map((c) => [c.id, c]));
  const shapeOf = new Map(model.objects.map((o) => [o.id, o]));
  // containers = components that have children
  const containerSet = new Set(map.components.map((c) => c.container).filter(Boolean));
  const connOp = new Map();
  for (const c of model.connections || []) connOp.set(c.src + '\u0000' + c.dst, c.operator || '->');

  const pptx = new pptxgen();
  const wIn = pxToIn(map.canvas.width);
  const hIn = pxToIn(map.canvas.height);
  pptx.defineLayout({ name: 'D2', width: wIn, height: hIn });
  pptx.layout = 'D2';
  pptx.title = (model.title || 'D2 diagram').replace(/\|/g, ' ').trim();
  const slide = pptx.addSlide();

  const addBox = (c) => {
    const o = shapeOf.get(c.id) || {};
    const preset = containerSet.has(c.id) ? 'roundRect' : presetFor(o.shape);
    if (preset === null) return; // text 'shapes' carry no box
    const fill = hex6(c.fill) || 'FFFFFF';
    const line = hex6(c.stroke) || '404040';
    slide.addShape(preset, {
      x: pxToIn(c.x), y: pxToIn(c.y), w: pxToIn(c.w), h: pxToIn(c.h),
      fill: { color: fill },
      line: { color: line, width: 1 },
      rectRadius: preset === 'roundRect' ? 0.08 : undefined,
    });
    const lab = c.label;
    const text = (lab && lab.text) || (o.label && o.label !== c.id.split('.').pop() ? o.label : null);
    if (text) {
      const fs = lab && lab.fs ? Math.max(8, Math.round(lab.fs * 0.75)) : 11;
      const topAlign = containerSet.has(c.id);
      slide.addText(text, {
        x: pxToIn(c.x), y: pxToIn(c.y), w: pxToIn(c.w), h: pxToIn(c.h),
        fontSize: fs, align: 'center', valign: topAlign ? 'top' : 'middle',
        color: '1B1B1B', margin: 0,
      });
    }
  };

  // paint order: containers (largest first), then leaves, then edges
  const boxes = map.components.slice();
  boxes.sort((a, b) => b.w * b.h - a.w * a.h);
  for (const c of boxes) if (containerSet.has(c.id)) addBox(c);
  for (const c of boxes) if (!containerSet.has(c.id)) addBox(c);

  let connectors = 0;
  for (const e of map.edges || []) {
    const pts = e.waypoints || [];
    if (pts.length < 2) continue;
    let xs = pts.map((p) => p[0]);
    let ys = pts.map((p) => p[1]);
    const bx = Math.min(...xs), by = Math.min(...ys);
    const bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
    const op = connOp.get(e.src + '\u0000' + e.dst) || '->';
    let line = pts;
    if (op === '<-') line = pts.slice().reverse();
    const arrows = op === '--' ? {} : op === '<->' ? { beginArrowType: 'triangle', endArrowType: 'triangle' } : { endArrowType: 'triangle' };
    slide.addShape('line', {
      x: pxToIn(bx), y: pxToIn(by), w: pxToIn(Math.max(bw, 1)), h: pxToIn(Math.max(bh, 1)),
      points: line.map((p) => ({ x: pxToIn(p[0] - bx), y: pxToIn(p[1] - by) })),
      line: { color: '1565C0', width: 1, ...arrows },
    });
    connectors++;
    if (e.labelText) {
      const bb = e.labelBox || { x: e.label ? e.label.x : bx, y: e.label ? e.label.y : by, w: Math.max((e.labelText || '').length * 7, 30), h: 18 };
      slide.addText(e.labelText, {
        x: pxToIn(bb.x), y: pxToIn(bb.y), w: pxToIn(Math.max(bb.w, 20)), h: pxToIn(Math.max(bb.h, 14)),
        fontSize: Math.max(8, Math.round(((e.labelFs || 14) * 0.75))), align: 'center', valign: 'middle', color: '555555', margin: 0,
      });
    }
  }

  await pptx.writeFile({ fileName: outPath });
  return {
    ok: true,
    outPath,
    canvas: map.canvas,
    kind: map.kind,
    shapes: map.components.length,
    connectors,
    manifest: map.components.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, label: c.label ? c.label.text : null })),
    hint: 'native shapes - rearrange in PowerPoint; feed the edited file back via d2_pptx_read (text) and a screenshot (vision)'
  };
}

/** Parse a .pptx slide back into a relations-style JSON (post-edit state). */
export async function readPptx(pptxPath) {
  let zip;
  try {
    zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  } catch (e) {
    return { ok: false, error: 'not a readable .pptx: ' + String(e.message) };
  }
  const slideFile = zip.file('ppt/slides/slide1.xml');
  if (!slideFile) return { ok: false, error: 'no slide1.xml found' };
  const xml = await slideFile.async('string');
  const px = (emu) => Math.round(Number(emu) / EMU_PER_PX);
  // return the FULL element body (opening tag through closing tag), not just
  // the opening tag - position/size children live inside the element
  const grab = (tag, x) => {
    const start = x.indexOf('<' + tag);
    if (start === -1) return null;
    const gt = x.indexOf('>', start);
    if (gt === -1) return null;
    if (x[gt - 1] === '/') return x.slice(start, gt + 1); // self-closing (<a:off .../>)
    const closeTag = '</' + tag + '>';
    const end = x.indexOf(closeTag, start);
    if (end === -1) return null;
    return x.slice(start, end + closeTag.length);
  };
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(name + '="([^"]*)"'));
    return m ? m[1] : null;
  };
  const objects = [];
  const connectors = [];
  for (const m of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const chunk = m[0];
    const spPr = grab('p:spPr', chunk) || '';
    const off = grab('a:off', spPr) || '';
    const ext = grab('a:ext', spPr) || '';
    const prst = (spPr.match(/prst="([^"]+)"/) || [])[1] || 'rect';
    const texts = [...chunk.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join('');
    const nv = grab('p:nvSpPr', chunk) || '';
    objects.push({
      id: attr(nv, 'id') || String(objects.length),
      name: attr(nv, 'name') || '',
      preset: prst,
      x: off ? px(attr(off, 'x')) : null,
      y: off ? px(attr(off, 'y')) : null,
      w: ext ? px(attr(ext, 'cx')) : null,
      h: ext ? px(attr(ext, 'cy')) : null,
      text: texts || null,
    });
  }
  for (const m of xml.matchAll(/<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g)) {
    const chunk = m[0];
    const spPr = grab('p:spPr', chunk) || '';
    const off = grab('a:off', spPr) || '';
    const ext = grab('a:ext', spPr) || '';
    const nv = grab('p:nvCxnSpPr', chunk) || '';
    const st = grab('a:stCxn', chunk);
    const en = grab('a:endCxn', chunk);
    connectors.push({
      id: attr(nv, 'id') || String(connectors.length),
      name: attr(nv, 'name') || '',
      x: off ? px(attr(off, 'x')) : null,
      y: off ? px(attr(off, 'y')) : null,
      w: ext ? px(attr(ext, 'cx')) : null,
      h: ext ? px(attr(ext, 'cy')) : null,
      headShapeId: st ? attr(st, 'id') : null,
      tailShapeId: en ? attr(en, 'id') : null,
    });
  }
  const presXml = zip.file('ppt/presentation.xml');
  let canvas = null;
  if (presXml) {
    const px2 = (await presXml.async('string')).match(/<p:sldSz cx="([0-9]+)" cy="([0-9]+)"/);
    if (px2) canvas = { width: px(px2[1]), height: px(px2[2]) };
  }
  return { ok: true, canvas, shapes: objects, connectors, hint: 'compare with the d2_pptx export manifest to see what the human moved/renamed/deleted; feed a slide screenshot to a vision model for the visual diff' };
}
