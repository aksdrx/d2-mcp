// Parse a d2-rendered SVG into post-layout geometry: component bboxes, edge
// routes, crossing/overlap analysis, a discretized text map and relative-position
// predicates. Pure text in / plain data out — lets text-only agents reason about
// (and iterate on) a diagram's visual composition without seeing the image.

const NUM = "-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?";

function attrOf(tag, name) {
  const i = tag.indexOf(name + '="');
  if (i === -1) return null;
  const j = tag.indexOf('"', i + name.length + 2);
  if (j === -1) return null;
  const v = Number(tag.slice(i + name.length + 2, j));
  return Number.isFinite(v) ? v : null;
}

function decodeId(cls) {
  try {
    let s = Buffer.from(cls, "base64").toString("utf8");
    // d2 base64-encodes the HTML-escaped id — undo the entities
    s = s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    // plausible d2 id: printable, no control chars, sane length
    if (!s || s.length > 200 || /[\u0000-\u001f]/.test(s)) return null;
    return s;
  } catch {
    return null;
  }
}

const CONN_RE = /^\((.*)\s(<->|->|<-|--|<-|->)\s(.*)\)(?:\[([0-9]+)\])?$/;
function connParts(id) {
  const m = id.match(/^\((.*)\s(<->|->|<-|--)\s(.*)\)(\[[0-9]+\])?$/);
  if (!m) return null;
  return { src: m[1], operator: m[2], dst: m[3] };
}

/** Tokenize an SVG path d-string into absolute points + bbox (curves are
 *  approximated by their control points — good enough for maps/crossings). */
export function parsePathD(d) {
  const tokens = d.match(/[MLCSTQHVAZmlcstqhvaz]|-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?/g) || [];
  const pts = [];
  let cx = 0;
  let cy = 0;
  let i = 0;
  const rel = (c) => c === c.toLowerCase() && c !== c.toUpperCase();
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) {
      const cmd = t;
      i++; // consume the command letter
      const lower = cmd.toLowerCase();
      const isRel = rel(cmd);
      const next = () => {
        const v = Number(tokens[i]);
        i++;
        return v;
      };
      const n = () => {
        let x = next();
        let y = next();
        if (isRel) { x += cx; y += cy; }
        cx = x; cy = y;
        pts.push([x, y]);
      };
      if (lower === "m" || lower === "l" || lower === "t") n();
      else if (lower === "c") { n(); n(); n(); }
      else if (lower === "s" || lower === "q") { n(); n(); }
      else if (lower === "h") { let x = next(); if (isRel) x += cx; cx = x; pts.push([cx, cy]); }
      else if (lower === "v") { let y = next(); if (isRel) y += cy; cy = y; pts.push([cx, cy]); }
      else if (lower === "a") { next(); next(); next(); next(); next(); n(); }
      else if (lower === "z") { /* close: nothing */ }
      else i++;
    } else {
      i++; // stray number (shouldn't happen) — skip defensively
    }
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bbox = pts.length
    ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    : null;
  return { points: pts, bbox };
}

function segmentIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false; // ignore collinear/touching — only proper crossings count
}

/**
 * Analyze a d2-rendered SVG.
 * @param {string} svgText full SVG document text (stdout of `d2 in.d2 -` or a file)
 * @param {{grid?: {cols?: number, rows?: number}}} [opts]
 */
export function analyzeSvg(svgText, opts = {}) {
  // canvas: pick the first <svg ...> tag that carries width+height (d2 emits an
  // outer tag with viewBox only and an inner one with explicit dimensions)
  let canvas = null;
  let pos = svgText.indexOf("<svg");
  while (pos !== -1 && !canvas) {
    const tag = svgText.slice(pos, svgText.indexOf(">", pos) + 1);
    const w = attrOf(tag, "width");
    const h = attrOf(tag, "height");
    if (w !== null && h !== null) canvas = { width: Math.round(w), height: Math.round(h) };
    pos = svgText.indexOf("<svg", pos + 1);
  }
  if (canvas) canvas.aspect = Math.round((canvas.width / canvas.height) * 100) / 100;

  // Walk the group tree: d2 wraps every object/connection in a top-level
  // <g class="base64(id)"> whose body holds the shape geometry, route and labels.
  // (A flat split fails: each group nests a <g class="shape"> child.)
  const components = [];
  const edges = [];
  const topLevel = [];
  let depth = 0;
  let start = -1;
  for (const m of svgText.matchAll(/<g\b[^>]*>|<\/g>/g)) {
    if (m[0].startsWith("</g>")) {
      depth--;
      if (depth === 0 && start !== -1) {
        topLevel.push(svgText.slice(start, m.index + m[0].length));
        start = -1;
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  for (const chunk of topLevel) {
    const cls = (chunk.match(/class="([^"]*)"/) || [])[1];
    if (!cls) continue;
    // Connections render as "K" + base64("(src OP dst)[i]") — test the stripped
    // form FIRST: a naive full decode of "K..." yields printable garbage.
    const stripped = cls.startsWith("K") ? decodeId(cls.slice(1)) : null;
    const decoded = decodeId(cls);
    let id = null;
    let conn = null;
    if (stripped && CONN_RE.test(stripped)) {
      conn = connParts(stripped);
      id = stripped;
    } else if (decoded && CONN_RE.test(decoded)) {
      conn = connParts(decoded);
      id = decoded;
    } else if (decoded && !/[()]/.test(decoded)) {
      id = decoded;
    }
    if (!id) continue;

    const rect = chunk.match(/<rect[^>]*>/);
    const pathTags = chunk.match(/<path[^>]*>/g) || [];
    const textTag = chunk.match(/<text[^>]*>/);

    if (conn) {
      const routeTag = pathTags.find((p) => /class="connection/.test(p)) || pathTags[0];
      if (!routeTag) continue;
      const dm = routeTag.match(/ d="([^"]*)"/);
      if (!dm) continue;
      const { points } = parsePathD(dm[1]);
      const labelPos = textTag
        ? { x: attrOf(textTag[0], "x"), y: attrOf(textTag[0], "y") }
        : null;
      edges.push({ id, src: conn.src, dst: conn.dst, label: labelPos, waypoints: points.map(([x, y]) => [Math.round(x), Math.round(y)]) });
      continue;
    }

    // component: rect wins; else union of path bboxes (cylinders etc. have 2 paths)
    let bbox = null;
    if (rect) {
      const x = attrOf(rect[0], "x");
      const y = attrOf(rect[0], "y");
      const w = attrOf(rect[0], "width");
      const h = attrOf(rect[0], "height");
      if (x !== null && y !== null && w !== null && h !== null) bbox = { x, y, w, h };
    }
    if (!bbox) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pathTags) {
        const dm = p.match(/ d="([^"]*)"/);
        if (!dm) continue;
        const { bbox: b } = parsePathD(dm[1]);
        if (!b) continue;
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      }
      if (x0 !== Infinity) bbox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (!bbox) continue;
    const c = {
      id,
      x: Math.round(bbox.x), y: Math.round(bbox.y),
      w: Math.round(bbox.w), h: Math.round(bbox.h),
      cx: Math.round(bbox.x + bbox.w / 2), cy: Math.round(bbox.y + bbox.h / 2),
      container: null,
    };
    if (textTag) {
      c.label = { x: attrOf(textTag[0], "x"), y: attrOf(textTag[0], "y") };
    }
    components.push(c);
  }

  // container detection: smallest strictly-larger bbox that contains this one
  const withArea = components.map((c, i) => ({ c, i, area: c.w * c.h })).sort((a, b) => b.area - a.area);
  for (const { c, i } of withArea) {
    for (const { c: p, i: j } of withArea) {
      if (i === j) continue;
      if (p.w * p.h <= c.w * c.h * 1.05) continue;
      const tol = 2;
      if (p.x - tol <= c.x && p.y - tol <= c.y && p.x + p.w + tol >= c.x + c.w && p.y + p.h + tol >= c.y + c.h) {
        if (!c.container || p.w * p.h < components.find((q) => q.id === c.container).w * components.find((q) => q.id === c.container).h) c.container = p.id;
      }
    }
  }

  // crossings: proper segment intersections between edges not sharing an endpoint
  const crossings = [];
  for (let a = 0; a < edges.length; a++) {
    for (let b = a + 1; b < edges.length; b++) {
      const ea = edges[a];
      const eb = edges[b];
      const sa = new Set([ea.src, ea.dst]);
      if (sa.has(eb.src) || sa.has(eb.dst)) continue;
      let hit = false;
      outer: for (let i = 0; i + 1 < ea.waypoints.length; i++) {
        for (let j = 0; j + 1 < eb.waypoints.length; j++) {
          if (segmentIntersect(ea.waypoints[i], ea.waypoints[i + 1], eb.waypoints[j], eb.waypoints[j + 1])) { hit = true; break outer; }
        }
      }
      if (hit) crossings.push({ edges: [ea.id, eb.id] });
    }
  }

  // partial bbox overlaps (excluding container/child nesting)
  const overlapping = [];
  for (let a = 0; a < components.length; a++) {
    for (let b = a + 1; b < components.length; b++) {
      const p = components[a];
      const q = components[b];
      const ox = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x));
      const oy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
      if (ox <= 2 || oy <= 2) continue;
      const nested = p.container === q.id || q.container === p.id;
      if (!nested) overlapping.push({ a: p.id, b: q.id });
    }
  }

  // label issues: label anchor clearly outside its shape. Person/icon shapes
  // legitimately carry their label just below the outline (~28px tolerance).
  const labelIssues = [];
  for (const c of components) {
    if (!c.label || c.label.x === null || c.label.y === null) continue;
    const { x, y } = c.label;
    if (x < c.x - 8 || x > c.x + c.w + 8 || y < c.y - 8 || y > c.y + c.h + 28) {
      labelIssues.push({ id: c.id, problem: "label-outside" });
    }
  }

  // textMap: discretize content bounds into a grid of cells
  const xs = components.flatMap((c) => [c.x, c.x + c.w]);
  const ys = components.flatMap((c) => [c.y, c.y + c.h]);
  let textMap = null;
  const bounds = xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : null;
  if (bounds) {
    const bw = Math.max(1, bounds.x1 - bounds.x0);
    const bh = Math.max(1, bounds.y1 - bounds.y0);
    const contentAspect = bw / bh;
    const cols = Math.max(3, Math.min(24, Math.round(opts.grid?.cols || Math.max(6, 6 * Math.max(0.5, Math.min(2.5, contentAspect))))));
    const rows = Math.max(2, Math.min(40, Math.round(opts.grid?.rows || (cols / Math.max(0.4, contentAspect)) / 1.6)));
    const cellW = bw / cols;
    const cellH = bh / rows;
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
    for (const c of components) {
      const col = Math.max(0, Math.min(cols - 1, Math.floor((c.cx - bounds.x0) / cellW)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor((c.cy - bounds.y0) / cellH)));
      grid[row][col].push(c.id.split(".").pop());
    }
    const lines = [`grid ${cols}x${rows} (columns left→right, rows top→bottom):`];
    for (let r = 0; r < rows; r++) {
      const cells = grid[r].map((cell) => (cell.length ? cell.join("/").slice(0, 14) : "·"));
      if (cells.some((s) => s !== "·")) lines.push(String(r + 1).padStart(2) + " | " + cells.join(" "));
    }
    textMap = lines.join("\n");
  }

  // relative-position predicates between near-enough components
  const relations = [];
  const diag = Math.hypot(bounds ? bounds.x1 - bounds.x0 : 1, bounds ? bounds.y1 - bounds.y0 : 1);
  const top = components.filter((c) => !c.container || c.container === "title");
  for (let a = 0; a < top.length; a++) {
    for (let b = a + 1; b < top.length; b++) {
      const p = top[a];
      const q = top[b];
      const vOverlap = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
      const hOverlap = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
      const hGap = Math.max(p.x, q.x) - Math.min(p.x + p.w, q.x + q.w);
      const vGap = Math.max(p.y, q.y) - Math.min(p.y + p.h, q.y + q.h);
      if (hGap > 0 && vOverlap > Math.min(p.h, q.h) * 0.25 && hGap < diag * 0.35) {
        relations.push({ a: p.x < q.x ? p.id : q.id, rel: "left-of", b: p.x < q.x ? q.id : p.id });
      } else if (vGap > 0 && hOverlap > Math.min(p.w, q.w) * 0.25 && vGap < diag * 0.35) {
        relations.push({ a: p.y < q.y ? p.id : q.id, rel: "above", b: p.y < q.y ? q.id : p.id });
      }
    }
    if (relations.length > 60) break;
  }

  return {
    canvas,
    components,
    edges,
    analysis: { crossings, overlapping, labelIssues },
    textMap,
    relations,
  };
}
