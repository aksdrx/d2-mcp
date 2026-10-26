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

function parseTextEl(chunk) {
  const m = chunk.match(/<text([^>]*)>([^<]*)<\/text>/);
  if (!m) return null;
  const tag = "<text" + m[1] + ">";
  const style = (tag.match(/style="([^"]*)"/) || [])[1] || "";
  const fsm = style.match(/font-size:\s*([0-9.]+)px/);
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return {
    x: attrOf(tag, "x"),
    y: attrOf(tag, "y"),
    fs: fsm ? Number(fsm[1]) : 16,
    middle: /text-anchor:\s*middle/.test(style),
    text: unesc(m[2].trim()),
  };
}

/** Estimated text bbox from a text element: anchor + string length
 *  (sans-serif averages ~0.62em per glyph). Good enough for overlap tests. */
function labelBoxOf(t) {
  if (!t || t.x === null || t.y === null) return null;
  const fs = t.fs || 16;
  const w = Math.max((t.text || "").length * fs * 0.62, fs);
  const h = fs * 1.25;
  const x = t.middle ? t.x - w / 2 : t.x;
  return { x, y: t.y - fs * 0.9, w, h };
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
  const docOrder = []; // {i, kind, id} — document order equals SVG paint order
  let depth = 0;
  let start = -1;
  for (const m of svgText.matchAll(/<g\b[^>]*>|<\/g>/g)) {
    if (m[0].startsWith("</g>")) {
      depth--;
      if (depth === 0 && start !== -1) {
        topLevel.push({ text: svgText.slice(start, m.index + m[0].length), start });
        start = -1;
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  for (let ti = 0; ti < topLevel.length; ti++) {
    const chunk = topLevel[ti].text;
    const chunkStart = topLevel[ti].start;
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
    } else if (decoded && /[()]/.test(decoded)) {
      // Container-scoped connection: d2 renders edges whose endpoints both live
      // inside container X as base64("X.(a OP b)[i]") — no "K" prefix, and ids
      // are RELATIVE to X (e.g. vpc.(web.web1 -> api.gateway)[0] means
      // vpc.web.web1 -> vpc.api.gateway). Resolve them to absolute ids.
      const cm = decoded.match(/^((?:[^.()]*\.)+)?\((.*)\s(<->|->|<-|--)\s(.*)\)(\[[0-9]+\])?$/);
      if (cm) {
        const prefix = cm[1] ? cm[1].slice(0, -1) : null;
        const abs = (x) => (prefix && !x.startsWith(prefix + ".") ? prefix + "." + x : x);
        conn = { src: abs(cm[2]), operator: cm[3], dst: abs(cm[4]) };
        id = decoded;
      }
    } else if (decoded && !/[()]/.test(decoded)) {
      id = decoded;
    }
    if (!id) continue;
    docOrder.push({ i: ti, kind: conn ? "edge" : "shape", id });

    const rect = chunk.match(/<rect[^>]*>/);
    const pathTags = chunk.match(/<path[^>]*>/g) || [];
    const textTag = chunk.match(/<text[^>]*>/);

    if (conn) {
      const routeTag = pathTags.find((p) => /class="connection/.test(p)) || pathTags[0];
      if (!routeTag) continue;
      const dm = routeTag.match(/ d="([^"]*)"/);
      if (!dm) continue;
      const { points } = parsePathD(dm[1]);
      const lt = textTag ? parseTextEl(chunk) : null;
      const labelPos = lt ? { x: lt.x, y: lt.y } : null;
      const idxM = id.match(/\[([0-9]+)\]$/);
      const e = { id, src: conn.src, dst: conn.dst, label: labelPos, waypoints: points.map(([x, y]) => [Math.round(x), Math.round(y)]), ...(idxM ? { index: Number(idxM[1]) } : {}) };
      if (lt) { e.labelText = lt.text; e.labelFs = lt.fs; e.labelBox = labelBoxOf(lt); }
      edges.push(e);
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
      const grow = (bx, by, bw, bh) => {
        x0 = Math.min(x0, bx); y0 = Math.min(y0, by);
        x1 = Math.max(x1, bx + bw); y1 = Math.max(y1, by + bh);
      };
      for (const p of pathTags) {
        const dm = p.match(/ d="([^"]*)"/);
        if (!dm) continue;
        const { bbox: b } = parsePathD(dm[1]);
        if (!b) continue;
        grow(b.x, b.y, b.w, b.h);
      }
      // circles and ovals render as <circle>/<ellipse> (no rect, no path)
      for (const ce of chunk.match(/<(circle|ellipse)\b[^>]*>/g) || []) {
        const cx = Number(attrOf(ce, "cx"));
        const cy = Number(attrOf(ce, "cy"));
        const rx = Number(attrOf(ce, "rx") ?? attrOf(ce, "r") ?? 0);
        const ry = Number(attrOf(ce, "ry") ?? attrOf(ce, "r") ?? 0);
        if (!isNaN(cx) && !isNaN(rx)) grow(cx - rx, cy - (isNaN(ry) ? rx : ry), rx * 2, (isNaN(ry) ? rx : ry) * 2);
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
    let lblChunk = chunk;
    if (!textTag) {
      // person/circle/oval/diamond labels render AFTER the closing </g> —
      // take the first <text> element that follows this component's group
      const after = svgText.slice(chunkStart + chunk.length, chunkStart + chunk.length + 400);
      const tm = after.match(/<text[\s\S]*?<\/text>/);
      if (tm) lblChunk = tm[0];
    }
    if (textTag || lblChunk !== chunk) {
      const t = parseTextEl(lblChunk);
      c.label = t
        ? { x: t.x, y: t.y, text: t.text, fs: t.fs, middle: t.middle, box: labelBoxOf(t) }
        : { x: attrOf(textTag[0], "x"), y: attrOf(textTag[0], "y") };
    }
    // resolved paint (theme colors land here): first shape fill/stroke in the chunk
    const fillM = chunk.match(/\sfill="([^"]+)"/);
    const strokeM = chunk.match(/\sstroke="([^"]+)"/);
    c.fill = fillM && fillM[1] !== "none" ? fillM[1] : null;
    c.stroke = strokeM && strokeM[1] !== "none" ? strokeM[1] : null;
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

  const compById = new Map(components.map((c) => [c.id, c]));

  // relative-position predicates between near-enough components
  const relations = [];
  const diag = Math.hypot(bounds ? bounds.x1 - bounds.x0 : 1, bounds ? bounds.y1 - bounds.y0 : 1);
  // P0-3: sub-2px bboxes (titles render as 1px-high text lines) produce absurd
  // predicates (title left-of X) — exclude them from relation derivation.
  const top = components.filter((c) => (!c.container || c.container === "title") && c.w >= 2 && c.h >= 2);
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
  // P0-2: annotate ties — when several candidates sit at nearly the same gap from
  // the same target, "the component left-of X" is genuinely ambiguous; surface it.
  {
    const gapOf = (a, rel, b) => {
      const p = compById.get(a), q = compById.get(b);
      if (!p || !q) return Infinity;
      if (rel === "left-of") return q.x - (p.x + p.w);
      return q.y - (p.y + p.h);
    };
    const groups = new Map();
    for (const r of relations) {
      const k = r.rel + "\u0000" + r.b;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const rs of groups.values()) {
      if (rs.length < 2) continue;
      let best = Infinity;
      for (const r of rs) best = Math.min(best, gapOf(r.a, r.rel, r.b));
      const tied = rs.filter((r) => gapOf(r.a, r.rel, r.b) <= best + 8).map((r) => r.a);
      if (tied.length > 1) for (const r of rs) if (tied.includes(r.a)) r.tiedWith = tied.filter((x) => x !== r.a);
    }
  }

  // ---- edge-over-shape slicing: an edge route passing through a shape it is
  // not connected to. Slicing a LEAF shape is always a defect; slicing a
  // CONTAINER is only legitimate for ancestors of the edge's endpoints (an
  // edge must exit its source container and enter its target container).
  const ancestorsOf = new Map();
  const ancestorSet = (id) => {
    if (ancestorsOf.has(id)) return ancestorsOf.get(id);
    const set = new Set();
    let cur = compById.get(id);
    while (cur && cur.container) { set.add(cur.container); cur = compById.get(cur.container); }
    ancestorsOf.set(id, set);
    return set;
  };
  const segHitsBBox = (x1, y1, x2, y2, bx, by, bw, bh) => {
    // slab-method segment vs AABB; endpoints exactly on the border do not count
    const pad = 2;
    const minX = bx + pad, maxX = bx + bw - pad, minY = by + pad, maxY = by + bh - pad;
    if (minX >= maxX || minY >= maxY) return false;
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (!clip(-dx, x1 - minX)) return false;
    if (!clip(dx, maxX - x1)) return false;
    if (!clip(-dy, y1 - minY)) return false;
    if (!clip(dy, maxY - y1)) return false;
    return t1 - t0 > 0.02; // ignore grazing corner touches
  };
  // SVG class ids occasionally decode with trailing garbage; match on cleaned ids
  const cleanId = (id) => String(id).replace(/[^\x20-\x7E].*$/, "");
  const cleanCompById = new Map(components.map((c) => [cleanId(c.id), c]));
  const cleanAncestors = (id) => {
    const set = new Set();
    let cur = cleanCompById.get(cleanId(id));
    while (cur && cur.container) { set.add(cleanId(cur.container)); cur = cleanCompById.get(cleanId(cur.container)); }
    return set;
  };
  // ---- paint order (z-order): document order = SVG paint order, later wins.
  const lastIdxOf = new Map();
  for (const d of docOrder) lastIdxOf.set(d.kind + ":" + cleanId(d.id), d.i);
  const idxOf = (kind, id) => {
    const v = lastIdxOf.get(kind + ":" + cleanId(id));
    return v === undefined ? -1 : v;
  };
  const shapeIdxs = docOrder.filter((d) => d.kind === "shape").map((d) => d.i);
  const edgeIdxs = docOrder.filter((d) => d.kind === "edge").map((d) => d.i);
  const zOrder = {
    shapes: shapeIdxs.length,
    edges: edgeIdxs.length,
    // true when every connection group paints after every shape group
    edgesPaintOverShapes: shapeIdxs.length > 0 && edgeIdxs.length > 0
      ? Math.min(...edgeIdxs) > Math.max(...shapeIdxs)
      : null,
  };

  const edgeOverlaps = [];
  for (const e of edges) {
    const legit = new Set([e.src, e.dst, ...cleanAncestors(e.src), ...cleanAncestors(e.dst)]);
    // descendants of a container endpoint are legitimately traversed on entry
    for (const c of components) {
      if (legit.has(e.src) && cleanId(c.id).startsWith(e.src + ".")) legit.add(cleanId(c.id));
      if (legit.has(e.dst) && cleanId(c.id).startsWith(e.dst + ".")) legit.add(cleanId(c.id));
    }
    for (let i = 0; i + 1 < e.waypoints.length; i++) {
      const [x1, y1] = e.waypoints[i];
      const [x2, y2] = e.waypoints[i + 1];
      for (const c of components) {
        if (legit.has(c.id) || legit.has(cleanId(c.id)) || c.id === "title") continue;
        if (segHitsBBox(x1, y1, x2, y2, c.x, c.y, c.w, c.h)) {
          edgeOverlaps.push({ edge: e.id, shape: cleanId(c.id), onTop: idxOf("edge", e.id) > idxOf("shape", c.id) });
          break; // one hit per shape is enough; keep scanning segments
        }
      }
    }
  }

  // ---- edge-over-label: an edge route crossing a text label it does not own
  const edgeOverLabels = [];
  const sameEnds = (e, f) =>
    (e.src === f.src && e.dst === f.dst) || (e.src === f.dst && e.dst === f.src);
  const segBox = (e, box) => {
    if (!box) return false;
    for (let i = 0; i + 1 < e.waypoints.length; i++) {
      if (segHitsBBox(e.waypoints[i][0], e.waypoints[i][1], e.waypoints[i + 1][0], e.waypoints[i + 1][1], box.x, box.y, box.w, box.h)) return true;
    }
    return false;
  };
  for (const e of edges) {
    const legit = new Set([cleanId(e.src), cleanId(e.dst), ...cleanAncestors(e.src), ...cleanAncestors(e.dst)]);
    for (const c of components) {
      if (c.id === "title" || !c.label || !c.label.box) continue;
      if (legit.has(cleanId(c.id))) continue;
      if (segBox(e, c.label.box)) {
        edgeOverLabels.push({ edge: e.id, labelOf: cleanId(c.id), kind: "shape", onTop: idxOf("edge", e.id) > idxOf("shape", c.id) });
      }
    }
    for (const f of edges) {
      if (f === e || sameEnds(e, f) || !f.labelBox) continue;
      if (segBox(e, f.labelBox)) {
        edgeOverLabels.push({ edge: e.id, labelOf: f.id, kind: "edge-label", onTop: idxOf("edge", e.id) > idxOf("edge", f.id) });
      }
    }
  }

  // ---- label vs label: two text labels whose estimated boxes overlap
  const owners = [];
  for (const c of components) {
    if (!c.label || !c.label.box) continue;
    owners.push({ id: cleanId(c.id), kind: c.id === "title" ? "title" : "shape", box: c.label.box });
  }
  for (const e of edges) {
    if (!e.labelBox) continue;
    owners.push({ id: e.id, kind: "edge-label", box: e.labelBox });
  }
  const labelCollisions = [];
  for (let a = 0; a < owners.length; a++) {
    for (let b = a + 1; b < owners.length; b++) {
      const p = owners[a].box, q = owners[b].box;
      const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
      const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
      if (ox > 3 && oy > 3) labelCollisions.push({ a: { id: owners[a].id, kind: owners[a].kind }, b: { id: owners[b].id, kind: owners[b].kind } });
    }
  }
  if (labelCollisions.length > 40) labelCollisions.length = 40;

  // P0-4: sequence boards render lifelines as (X -- ) pseudo-edges
  const lifelines = edges.filter((e) => e.dst === "" || /\(-- \)(\[[0-9]+\])?$/.test(e.id)).length;
  const kind = lifelines > 0 ? "sequence" : "flow";

  return {
    kind,
    canvas,
    components,
    edges,
    analysis: { crossings, overlapping, labelIssues, edgeOverlaps, edgeOverLabels, labelCollisions, zOrder },
    textMap,
    relations,
  };
}
