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
  const d2exe = process.env.D2_PATH || 'd2';
  const { spawnSync } = await import('node:child_process');
  const tmpIn = resolve(resolveDir, '.pptx-in.d2');
  fs.writeFileSync(tmpIn, src);
  let res = spawnSync(d2exe, ['.pptx-in.d2', '-'], { cwd: resolveDir, encoding: 'utf8' }); // '-' = SVG to stdout
  let multiboard = /multiboard/.test(res.stderr || '');
  if (multiboard) {
    // multiboard sources cannot write stdout at target '*'; render the root board
    res = spawnSync(d2exe, ['.pptx-in.d2', '--target=', '-'], { cwd: resolveDir, encoding: 'utf8' });
  }
  try { fs.unlinkSync(tmpIn); } catch {}
  // multiboard first-attempts can leave an output dir/file named after the tmp
  // input next to the source; remove both so crashed runs leave no artifacts
  try { fs.rmSync(resolve(resolveDir, '.pptx-in'), { recursive: true, force: true }); } catch {}
  try { fs.rmSync(resolve(resolveDir, '.pptx-in.svg'), { force: true }); } catch {}
  if (res.status !== 0) {
    return { ok: false, error: ((res.stderr || '') + (res.stdout || '')).trim().slice(0, 300) };
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
  if (!map.canvas) return { ok: false, error: 'render produced no measurable canvas (multiboard?)' };
  const wIn = pxToIn(map.canvas.width);
  const hIn = pxToIn(map.canvas.height);
  pptx.defineLayout({ name: 'D2', width: wIn, height: hIn });
  pptx.layout = 'D2';
  pptx.title = (model.title || 'D2 diagram').replace(/\|/g, ' ').trim();
  const slide = pptx.addSlide();

  const addBox = (c) => {
    const o = shapeOf.get(c.id) || {};
    const preset = containerSet.has(c.id) ? 'roundRect' : presetFor(o.shape);
    if (preset === null) {
      // text 'shapes' carry no box, but their text still ships
      const t = c.label && c.label.text;
      if (t) slide.addText(t, {
        x: pxToIn(c.x), y: pxToIn(c.y), w: pxToIn(c.w), h: pxToIn(c.h),
        fontSize: Math.max(8, Math.round(((c.label.fs || 16) * 0.75))), align: 'left', valign: 'top', color: '1B1B1B', margin: 0,
      });
      return;
    }
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
    let pts = e.waypoints || [];
    if (pts.length < 2) {
      // degenerate route (path-parse gap, e.g. compact d-strings): fall back to a
      // straight center-to-center connector so no connection is ever lost
      const s = byId.get(e.src), d = byId.get(e.dst);
      if (!s || !d) continue;
      pts = [[s.cx, s.cy], [d.cx, d.cy]];
    }
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
    const unesc = (x) => String(x).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const texts = [...chunk.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => unesc(t[1])).join('');
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

// ------------------------------------------------------------ pptx -> PNG
// renderPptxPng: rasterize every slide of a .pptx (OOXML -> SVG -> PNG via
// @resvg/resvg-js, the single rasterizer dep). Lets a vision model read the
// deck directly - no PowerPoint or LibreOffice needed. Covers everything
// d2_pptx emits (preset geometries, text boxes, straight-line connectors,
// triangle arrowheads) plus common human edits; unknown presets fall back to
// their bounding rect so nothing silently disappears from the image.

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const emuToPx = (v) => Number(v) / EMU_PER_PX;
const unescXml = (x) => String(x).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function grabEl(tag, x) {
  const start = x.indexOf('<' + tag);
  if (start === -1) return null;
  const gt = x.indexOf('>', start);
  if (gt === -1) return null;
  if (x[gt - 1] === '/') return x.slice(start, gt + 1);
  const closeTag = '</' + tag + '>';
  const end = x.indexOf(closeTag, start);
  if (end === -1) return x.slice(start, gt + 1); // tolerate truncation
  return x.slice(start, end + closeTag.length);
}
const attrOf = (tag, name) => {
  const m = tag && tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
};
const pptxColor = (chunk) => {
  const m = chunk && chunk.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/);
  return m ? '#' + m[1].toUpperCase() : null;
};

function presetSvg(prst, x, y, w, h, fill, stroke, sw) {
  const st = 'fill="' + (fill || 'none') + '" stroke="' + (stroke || 'none') + '" stroke-width="' + sw + '"';
  w = Math.max(w, 1); h = Math.max(h, 1);
  const cx = x + w / 2, cy = y + h / 2;
  switch (prst) {
    case 'ellipse':
      return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + w / 2 + '" ry="' + h / 2 + '" ' + st + '/>';
    case 'roundRect':
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (Math.min(w, h) * 0.12).toFixed(1) + '" ' + st + '/>';
    case 'can': { // cylinder: body path + top ellipse (d2 datastore/queue)
      const ry = Math.min(h * 0.15, w / 2);
      return '<g ' + st + ' stroke-linejoin="round">' +
        '<path d="M ' + x + ' ' + (y + ry) + ' A ' + (w / 2) + ' ' + ry + ' 0 0 1 ' + (x + w) + ' ' + (y + ry) +
        ' L ' + (x + w) + ' ' + (y + h - ry) + ' A ' + (w / 2) + ' ' + ry + ' 0 0 1 ' + x + ' ' + (y + h - ry) + ' Z"/>' +
        '<ellipse cx="' + cx + '" cy="' + (y + ry) + '" rx="' + (w / 2) + '" ry="' + ry + '"/></g>';
    }
    case 'diamond':
      return '<polygon points="' + cx + ',' + y + ' ' + (x + w) + ',' + cy + ' ' + cx + ',' + (y + h) + ' ' + x + ',' + cy + '" ' + st + '/>';
    case 'triangle':
      return '<polygon points="' + cx + ',' + y + ' ' + (x + w) + ',' + (y + h) + ' ' + x + ',' + (y + h) + '" ' + st + '/>';
    case 'hexagon': {
      const c = w * 0.25;
      return '<polygon points="' + (x + c) + ',' + y + ' ' + (x + w - c) + ',' + y + ' ' + (x + w) + ',' + cy + ' ' + (x + w - c) + ',' + (y + h) + ' ' + (x + c) + ',' + (y + h) + ' ' + x + ',' + cy + '" ' + st + '/>';
    }
    case 'chevron': {
      const c = Math.min(w, h) * 0.35;
      return '<polygon points="' + x + ',' + y + ' ' + (x + w - c) + ',' + y + ' ' + (x + w) + ',' + cy + ' ' + (x + w - c) + ',' + (y + h) + ' ' + x + ',' + (y + h) + ' ' + (x + c) + ',' + cy + '" ' + st + '/>';
    }
    case 'foldedCorner': {
      const c = Math.min(w, h) * 0.22;
      return '<path d="M ' + x + ' ' + y + ' L ' + (x + w - c) + ' ' + y + ' L ' + (x + w) + ' ' + (y + c) + ' L ' + (x + w) + ' ' + (y + h) + ' L ' + x + ' ' + (y + h) + ' Z" ' + st + '/>';
    }
    default: // rect, flowChartDocument, cloud, ... -> bounding rect keeps layout visible
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" ' + st + '/>';
  }
}

function lineSvg(x, y, w, h, flipH, flipV, stroke, sw, headEnd, tailEnd, dash) {
  let x1 = x, y1 = y, x2 = x + w, y2 = y + h;
  if (flipH) { x1 = x + w; x2 = x; }
  if (flipV) { y1 = y + h; y2 = y; }
  const arrow = (ax, ay, bx, by) => {
    const ang = Math.atan2(ay - by, ax - bx), s = Math.max(sw * 4, 7);
    const bx1 = ax - Math.cos(ang) * s, by1 = ay - Math.sin(ang) * s;
    const o = Math.PI / 2, r = s * 0.45;
    const p2x = bx1 - Math.cos(ang - o) * r, p2y = by1 - Math.sin(ang - o) * r;
    const p3x = bx1 - Math.cos(ang + o) * r, p3y = by1 - Math.sin(ang + o) * r;
    return '<polygon points="' + bx1 + ',' + by1 + ' ' + p2x + ',' + p2y + ' ' + p3x + ',' + p3y + '" fill="' + stroke + '"/>';
  };
  return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + sw + '"' +
    (dash && dash !== 'solid' ? ' stroke-dasharray="' + sw * 3 + ',' + sw * 2 + '"' : '') + '/>' +
    (tailEnd ? arrow(x2, y2, x1, y1) : '') +
    (headEnd ? arrow(x1, y1, x2, y2) : '');
}

function textSvg(txBody, x, y, w, h) {
  if (!txBody) return '';
  const bodyPr = grabEl('a:bodyPr', txBody) || '';
  const insL = emuToPx(attrOf(bodyPr, 'lIns') ?? 91440);
  const insR = emuToPx(attrOf(bodyPr, 'rIns') ?? 91440);
  const insT = emuToPx(attrOf(bodyPr, 'tIns') ?? 45720);
  const insB = emuToPx(attrOf(bodyPr, 'bIns') ?? 45720);
  const anchor = attrOf(bodyPr, 'anchor') || 't';
  const paras = [];
  for (const pm of txBody.matchAll(/<a:p(?: [^>]*)?>([\s\S]*?)<\/a:p>/g)) {
    const runs = [];
    for (const rm of pm[1].matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
      const rPr = (rm[1].match(/<a:rPr([^>]*)>/) || ['', ''])[1];
      const szPt = Number((rPr.match(/ sz="(\d+)"/) || [])[1] || 1400) / 100;
      const t = (rm[1].match(/<a:t>([\s\S]*?)<\/a:t>/) || ['', ''])[1];
      if (t) runs.push({ text: unescXml(t), px: Math.max(6, szPt * 4 / 3), b: / b="1"/.test(rPr), i: / i="1"/.test(rPr), color: pptxColor(rm[1]) || '#1B1B1B' });
    }
    if (runs.length) paras.push({ runs, align: attrOf(grabEl('a:pPr', pm[1]) || '', 'algn') || 'l' });
  }
  if (!paras.length) return '';
  const lh = (p) => Math.max(...p.runs.map((r) => r.px)) * 1.25;
  const total = paras.reduce((a, p) => a + lh(p), 0);
  let yy = anchor === 'ctr' ? y + (h - total) / 2 : anchor === 'b' ? y + h - insB - total : y + insT;
  const out = [];
  for (const p of paras) {
    const sz = Math.max(...p.runs.map((r) => r.px));
    const ax = p.align === 'ctr' ? x + w / 2 : p.align === 'r' ? x + w - insR : x + insL;
    const anchorAttr = p.align === 'ctr' ? 'middle' : p.align === 'r' ? 'end' : 'start';
    out.push('<text x="' + ax + '" y="' + (yy + sz * 0.85).toFixed(1) + '" text-anchor="' + anchorAttr + '" font-family="DejaVu Sans, Ubuntu, sans-serif">' +
      p.runs.map((r) => '<tspan font-size="' + r.px.toFixed(1) + '" fill="' + r.color + '"' + (r.b ? ' font-weight="bold"' : '') + (r.i ? ' font-style="italic"' : '') + '>' + xmlEsc(r.text) + '</tspan>').join('') +
      '</text>');
    yy += lh(p);
  }
  return out.join('');
}

/** Rasterize a .pptx into one PNG per slide for vision models. */
export async function renderPptxPng(pptxPath, { outDir, scale = 2 } = {}) {
  let Resvg;
  try { ({ Resvg } = await import('@resvg/resvg-js')); }
  catch (e) { return { ok: false, error: 'rasterizer unavailable (npm i @resvg/resvg-js): ' + String(e.message || e) }; }
  let zip;
  try { zip = await JSZip.loadAsync(fs.readFileSync(pptxPath)); }
  catch (e) { return { ok: false, error: 'not a readable .pptx: ' + String(e.message) }; }
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  if (!slideNames.length) return { ok: false, error: 'no ppt/slides/slideN.xml found' };
  const presXml = zip.file('ppt/presentation.xml') ? await zip.file('ppt/presentation.xml').async('string') : '';
  const szm = presXml.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  const canvas = szm ? { width: Math.round(emuToPx(szm[1])), height: Math.round(emuToPx(szm[2])) } : { width: 960, height: 540 };
  const dir = outDir || resolve(pptxPath, '..');
  fs.mkdirSync(dir, { recursive: true });
  const stem = resolve(pptxPath).replace(/\.[^.\/]+$/, '').split(/[\\/]/).pop();
  const notes = [];
  const slides = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.file(slideNames[i]).async('string');
    const body = ['<rect x="0" y="0" width="' + canvas.width + '" height="' + canvas.height + '" fill="#FFFFFF"/>'];
    for (const m of xml.matchAll(/<p:(sp|cxnSp|pic|graphicFrame)>([\s\S]*?)<\/p:\1>/g)) {
      const kind = m[1], chunk = m[2];
      if (kind === 'pic' || kind === 'graphicFrame') { notes.push('slide ' + (i + 1) + ': ' + kind + ' not rendered (not produced by d2_pptx)'); continue; }
      const spPr = grabEl('p:spPr', chunk) || '';
      const xfrm = grabEl('a:xfrm', spPr) || '';
      const off = grabEl('a:off', xfrm) || '', ext = grabEl('a:ext', xfrm) || '';
      if (!off || !ext) continue;
      const x = emuToPx(attrOf(off, 'x')), y = emuToPx(attrOf(off, 'y'));
      const w = emuToPx(attrOf(ext, 'cx')), h = emuToPx(attrOf(ext, 'cy'));
      const lnEl = grabEl('a:ln', spPr);
      const beforeLn = lnEl ? spPr.slice(0, spPr.indexOf('<a:ln')) : spPr;
      const fill = /<a:noFill/.test(beforeLn) ? null : pptxColor(beforeLn);
      const stroke = lnEl ? (pptxColor(lnEl) || 'none') : 'none';
      const sw = lnEl && attrOf(lnEl, 'w') ? Math.max(0.75, emuToPx(attrOf(lnEl, 'w'))) : 1;
      const prst = (spPr.match(/prst="([^"]+)"/) || [])[1] || (kind === 'cxnSp' ? 'line' : 'rect');
      if (prst === 'line') {
        body.push(lineSvg(x, y, w, h, /flipH="1"/.test(xfrm), /flipV="1"/.test(xfrm),
          stroke === 'none' ? '#1565C0' : stroke, sw,
          /<a:headEnd type="(triangle|arrow)"/.test(lnEl || ''), /<a:tailEnd type="(triangle|arrow)"/.test(lnEl || ''),
          attrOf(lnEl || '', 'prstDash') || 'solid'));
      } else {
        body.push(presetSvg(prst, x, y, w, h, fill, stroke === 'none' ? null : stroke, sw));
      }
      body.push(textSvg(grabEl('p:txBody', chunk), x, y, w, h));
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + canvas.width + '" height="' + canvas.height + '" viewBox="0 0 ' + canvas.width + ' ' + canvas.height + '">' + body.join('') + '</svg>';
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: Math.max(1, Math.round(canvas.width * scale)) },
      font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
    }).render().asPng();
    const file = resolve(dir, stem + '.slide' + (i + 1) + '.png');
    fs.writeFileSync(file, png);
    slides.push({ index: i + 1, file, width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale), bytes: png.length });
  }
  return {
    ok: true, engine: 'resvg', canvas, slides, notes,
    hint: 'feed these PNGs to a vision model (read_image / image tool) to verify or diff the deck visually',
  };
}
