#!/usr/bin/env node
/**
 * extract.js — pure-JavaScript D2 relationship extractor (the "AI plane").
 *
 * Parses the documented D2 subset into a machine-readable model of components
 * and their relationships — so a text-only agent can consume an architecture
 * diagram without rendering it, and code implementations can be verified
 * against the diagram's declared structure.
 *
 * Requires NO d2 binary and NO dependencies — plain Node >= 18.
 * The d2 CLI remains the authority for rendering and validation; this parser
 * targets the authoring subset documented in ../skills/d2-diagrams/reference/.
 *
 * CLI:
 *   node extract.js diagram.d2              # pretty JSON (default)
 *   node extract.js diagram.d2 --text       # compact human/AI-readable edge list
 *   node extract.js - < diagram.d2          # stdin
 *
 * JSON contract:
 * {
 *   ok: true,
 *   direction: "down",                       // root direction
 *   config: {layout?, theme?, darkTheme?, sketch?, pad?, center?},
 *   objects: [{ id, label, container, shape, classes[], tooltip, link, icon,
 *               direction?, attributes[]?, suspended?, sequence? }],
 *             // id = absolute dotted path ("vpc.api"); container = parent id | null
 *             // attributes[] only for shape: sql_table / class
 *   connections: [{ id, src, dst, operator, label, classes[] }],
 *             // operator: "->" | "<-" | "--" | "<->" (as written; ids absolute)
 *   globs: [{ pattern, value, line }],       // glob rules incl. suspend/unsuspend
 *   imports: [{ path, alias?, spread? }],
 *   boards: { "layers.x": {direction, objects, connections, globs} },
 *   warnings: ["..."]
 * }
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- helpers

const OPERATORS = ["<->", "->", "<-", "--"];
const DIRECTIONS = new Set(["up", "down", "left", "right"]);

/** Keys that configure the current object rather than create children. */
const RESERVED_OBJ_KEYS = new Set([
  "shape", "label", "class", "style", "tooltip", "link", "icon", "near",
  "width", "height", "top", "left", "constraint", "direction",
  "grid-rows", "grid-columns", "grid-gap", "vertical-gap", "horizontal-gap",
  "suspended",
]);

/** Root-only (or board-root) meta containers. */
const META_CONTAINERS = new Set(["vars", "classes", "layers", "scenarios", "steps"]);

function unquote(s) {
  const t = String(s).trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

function stripQuotesAware(s, fn) {
  // Run fn over the string, skipping regions inside quotes.
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\") continue;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (fn(c, i)) return i;
  }
  return -1;
}

function stripLineComment(line) {
  const i = stripQuotesAware(line, (c) => c === "#");
  return i === -1 ? line : line.slice(0, i);
}

/** Split on a single-character separator at top level (outside quotes). */
function splitTopLevel(s, sep) {
  const parts = [];
  let cur = "";
  let q = null;
  const bracketStack = [];
  const closing = { "{": "}", "[": "]", "(": ")" };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === "\\") {
        cur += s[++i] ?? "";
      } else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (closing[c]) {
      bracketStack.push(closing[c]);
      cur += c;
      continue;
    }
    if (bracketStack.length) {
      cur += c;
      if (c === bracketStack[bracketStack.length - 1]) bracketStack.pop();
      continue;
    }
    if (c === sep) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

/** Positions of top-level connection operators (longest match first). */
function topLevelOperators(s) {
  const found = [];
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    for (const op of OPERATORS) {
      if (s.startsWith(op, i)) {
        found.push({ op, index: i });
        i += op.length - 1;
        break;
      }
    }
  }
  return found;
}

/** Split "a.b.c" on top-level dots; segments unquoted. */
function splitPath(s) {
  return splitTopLevel(s, ".").map((p) => unquote(p)).filter((p) => p.length > 0);
}

// ------------------------------------------------- pass 1: logical lines
// Collapses block strings (|md ... |) into placeholder tokens so downstream
// parsing never sees their content; strips line comments; skips """ comments.

const BLOCK_RE = /^(\S.*)?[\t ]*\|{1,2}([a-zA-Z0-9_-]*)[\t ]*$/;

function toLogicalLines(source, warnings) {
  const blocks = [];
  const lines = [];
  let inBlock = false;
  let inComment = false;
  let buf = null;
  let keyPart = "";
  let keyIndentVal = 0;
  let startLine = 0;
  let skipBrace = false;

  const rawLines = source.split(/\r?\n/);
  for (let n = 0; n < rawLines.length; n++) {
    const raw = rawLines[n];
    if (inComment) {
      if (raw.trim() === '\"\"\"') inComment = false;
      continue;
    }
    if (inBlock) {
      const tClose = raw.trim();
      const inlineMapClose = /^\|{1,2}[\t ]*\{[\s\S]*\}[\t ]*$/.test(tClose);
      const openMapClose = /^\|{1,2}[\t ]*\{[\t ]*$/.test(tClose);
      if (tClose === "|" || tClose === "||" || inlineMapClose || openMapClose) {
        blocks.push({ key: keyPart, content: buf.join("\n"), line: startLine });
        const ph = "\u0000B" + (blocks.length - 1) + "\u0000";
        lines.push({
          indent: keyIndentVal,
          text: (keyPart + " " + ph).trim(),
          line: startLine,
        });
        inBlock = false;
        buf = null;
        // "| {" — the block string is followed by an attached layout map; skip it
        if (openMapClose) skipBrace = true;
      } else {
        buf.push(raw);
      }
      continue;
    }
    const t = raw.trim();
    if (skipBrace) {
      if (t.startsWith("}")) skipBrace = false;
      continue;
    }
    if (t === '\"\"\"') {
      inComment = true;
      continue;
    }
    if (t === "") continue;
    const m = t.match(BLOCK_RE);
    const colon = stripQuotesAware(t, (c) => c === ":");
    if (m && colon !== -1 && colon < t.length - 1) {
      // "key: |lang" — open a block string.
      inBlock = true;
      buf = [];
      keyPart = t.slice(0, colon + 1).trim();
      keyIndentVal = raw.search(/\S/);
      startLine = n + 1;
      continue;
    }
    const cleaned = stripLineComment(raw).trimEnd();
    if (cleaned.trim() === "") continue;
    if (/\t/.test(raw)) warnings.push(`tab character in line ${n + 1} (d2 requires spaces)`);
    lines.push({ indent: raw.search(/\S/), text: cleaned.trim(), line: n + 1 });
  }
  if (inBlock) warnings.push(`unterminated block string starting line ${startLine}`);
  return { lines, blocks };
}

function keyIndent(keyPart) {
  // Indent of the opening line is lost; approximate from the captured key.
  return 0;
}

// ------------------------------------------------- pass 2: tree by indent

function buildTree(lines) {
  const root = { indent: -1, text: "", children: [], line: 0 };
  const stack = [root];
  const processLine = (ln) => {
    const t = ln.text.trim();
    if (t.startsWith("}")) {
      // a closing brace pops every block opened at or right of this indent
      while (stack.length > 1 && stack[stack.length - 1].indent >= ln.indent) stack.pop();
      return;
    }
    if (t === "") return;
    while (stack.length > 1 && stack[stack.length - 1].indent >= ln.indent) stack.pop();
    // A block can open mid-line: "key: Label { grid-columns: 3" — the text
    // after the unmatched "{" becomes the block's first child line. (A balanced
    // "{...}" pair stays inline: handled as an attached map downstream.)
    const bo = t.indexOf("{");
    if (bo !== -1 && !/\{[\t ]*$/.test(t)) {
      let depth = 0;
      let close = -1;
      for (let i = bo; i < t.length; i++) {
        if (t[i] === "{") depth++;
        else if (t[i] === "}") { depth--; if (depth === 0) { close = i; break; } }
      }
      if (close === -1) {
        const head = t.slice(0, bo).trim();
        const rest = t.slice(bo + 1).trim();
        const node = { indent: ln.indent, text: head, children: [], line: ln.line };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
        if (rest) processLine({ indent: ln.indent + 1, text: rest, line: ln.line });
        return;
      }
    }
    const opens = /\{[\t ]*$/.test(t);
    const node = {
      indent: ln.indent,
      text: opens ? t.replace(/\{[\t ]*$/, "").trim() : t,
      children: [],
      line: ln.line,
    };
    stack[stack.length - 1].children.push(node);
    if (opens) stack.push(node);
  };
  for (const ln of lines) processLine(ln);
  return root;
}

// ------------------------------------------------- pass 3: interpret

function newModel() {
  return {
    direction: "down",
    config: {},
    objects: new Map(),
    connections: [],
    globs: [],
    imports: [],
    classDefs: [],
    warnings: [],
    boards: {},
  };
}

function baseObj(id, container) {
  return {
    id,
    label: id.split(".").pop(),
    container: container ?? null,
    shape: null,
    classes: [],
    tooltip: null,
    link: null,
    icon: null,
  };
}

function ensureObject(model, id, container) {
  let o = model.objects.get(id);
  if (!o) {
    o = baseObj(id, container);
    model.objects.set(id, o);
  }
  return o;
}

/** Create every object on a dotted path; returns the final object. */
function ensurePath(model, scopeId, segs, line, warnings) {
  // d2 resolves ids absolutely when the path exists from root, else scoped.
  const flat = segs.join(".");
  if (model.objects.has(flat)) return model.objects.get(flat);
  let cur = scopeId || null;
  let obj = null;
  for (const seg of segs) {
    const id = cur ? cur + "." + seg : seg;
    obj = ensureObject(model, id, cur);
    cur = id;
  }
  return obj;
}

function applyReserved(obj, key, rawValue, node, model) {
  const value = unquote(rawValue);
  switch (key) {
    case "shape":
      obj.shape = value;
      if (value === "sequence_diagram") obj.sequence = true;
      break;
    case "label":
      obj.label = value;
      break;
    case "class":
      obj.classes = value.startsWith("[")
        ? splitTopLevel(value.replace(/^\[|\]$/g, ""), ";").map(unquote).filter(Boolean)
        : [value];
      break;
    case "tooltip": obj.tooltip = value; break;
    case "link": obj.link = value; break;
    case "icon": obj.icon = value; break;
    case "direction":
      if (DIRECTIONS.has(value)) obj.direction = value;
      break;
    case "suspended":
      obj.suspended = value === "true" || value === "";
      break;
    default:
      break; // style, near, width, height, grid-* — layout-only, ignored
  }
  if (node && node.children) {
    for (const ch of node.children) {
      const ck = unquote(ch.text.split(":")[0]);
      if (ck === "constraint" || ck === "near" || ck === "label") applyReserved(obj, ck, ch.text.split(":").slice(1).join(":"), ch, model);
    }
  }
}

function isGlobPattern(s) {
  return s.includes("*") || /^\(.*\)\[/.test(s);
}

function segsLen(segs) {
  return segs.length;
}

function recordGlob(model, pattern, value, line) {
  model.globs.push({ pattern: pattern.trim(), value: (value || "").trim(), line });
}

function parseInlineMap(value) {
  const inner = value.trim().replace(/^\{/, "").replace(/\}$/, "");
  return splitTopLevel(inner, ";").map((t) => t.trim()).filter(Boolean);
}

/**
 * Interpret a list of statement nodes within a scope (object id or null=root).
 */
function interpretStatements(nodes, scopeId, model, opts = {}) {
  for (const node of nodes) {
    const stmts = splitTopLevel(node.text, ";").map((s) => s.trim()).filter(Boolean);
    stmts.forEach((stmt, i) => {
      const children = i === stmts.length - 1 ? node.children : null;
      interpretStatement(stmt, children, scopeId, model, node.line, opts);
    });
  }
}

function interpretStatement(stmt, children, scopeId, model, line, opts) {
  if (!stmt) return;

  const colonAt = stripQuotesAware(stmt, (c) => c === ":");
  const ops = topLevelOperators(stmt);
  const firstOp = ops.length ? ops[0].index : -1;

  // ---- connection? (operator before any top-level colon, operands present)
  if (firstOp !== -1 && (colonAt === -1 || firstOp < colonAt)) {
    interpretConnection(stmt, ops, colonAt, children, scopeId, model, line);
    return;
  }

  // ---- bare statement (no colon): declaration, spread import, or glob
  if (colonAt === -1) {
    const t = stmt.trim();
    if (/^\.\.\.@/.test(t)) {
      model.imports.push({ path: t.replace(/^\.\.\./, "").replace(/^@/, ""), spread: true });
      return;
    }
    if (isGlobPattern(t)) {
      recordGlob(model, t, children && children.length ? children.map((c) => c.text).join("; ") : "", line);
      return;
    }
    const segs = splitPath(t);
    const o = segs.length ? ensurePath(model, scopeId, segs, line, model.warnings) : null;
    if (children && children.length && o) interpretStatements(children, o.id, model, opts);
    return;
  }

  // ---- key: value
  const keyRaw = stmt.slice(0, colonAt).trim();
  const value = stmt.slice(colonAt + 1).trim();
  const key = unquote(keyRaw);
  const segs = splitPath(keyRaw);

  // import forms
  if (value.startsWith("@")) {
    model.imports.push({ path: value.slice(1), alias: key });
    return;
  }

  // glob rules like "**: suspend" or "(* -> *)[*]: unsuspend"
  if (isGlobPattern(keyRaw)) {
    recordGlob(model, keyRaw, value, line);
    if (children && children.length) {
      // glob filters: &dst / &label / &src
      const filters = {};
      for (const ch of children) {
        const cAt = ch.text.indexOf(":");
        if (cAt > 0) filters[unquote(ch.text.slice(0, cAt))] = unquote(ch.text.slice(cAt + 1));
      }
      model.globs[model.globs.length - 1].filters = filters;
    }
    return;
  }

  // board-root meta containers
  if (scopeId === null && META_CONTAINERS.has(key)) {
    interpretMeta(key, value, children, model, opts);
    return;
  }

  // root-level direction
  if (scopeId === null && key === "direction" && !keyRaw.includes(".")) {
    const v = unquote(value);
    if (DIRECTIONS.has(v)) model.direction = v;
    return;
  }

  // layout-only subtrees we consume but do not model (style maps, vars, ...)
  if (key === "style" || key === "vars" || key === "near") return;

  // root-level reserved attributes (e.g. "shape: sequence_diagram") configure the
  // board itself; they must not become objects (they have no geometry anyway)
  if (scopeId === null && RESERVED_OBJ_KEYS.has(key) && !keyRaw.includes(".")) {
    model.boardAttrs = model.boardAttrs || {};
    model.boardAttrs[key] = unquote(value);
    return;
  }
  if (segsLen(segs) > 1 && RESERVED_OBJ_KEYS.has(segs[0]) && !RESERVED_OBJ_KEYS.has(segs[segs.length - 1])) {
    // e.g. "label.near: outside-top-center" or "style.fill: red"
    return;
  }

  // reserved key applying to the CURRENT object (only valid with a scope)
  if (scopeId !== null && RESERVED_OBJ_KEYS.has(key) && !keyRaw.includes(".")) {
    const obj = ensureObject(model, scopeId, null);
    applyReserved(obj, key, value, children, model);
    return;
  }

  if (!segs.length) return;

  // dotted path whose LAST segment is reserved: "x.shape: cylinder"
  const last = segs[segs.length - 1];
  if (segs.length > 1 && RESERVED_OBJ_KEYS.has(last)) {
    const target = ensurePath(model, scopeId, segs.slice(0, -1), line, model.warnings);
    if (target) applyReserved(target, last, value, children, model);
    return;
  }

  // sql_table / class rows become attributes, not child objects
  const scopeObj = scopeId ? model.objects.get(scopeId) : null;
  if (scopeObj && (scopeObj.shape === "sql_table" || scopeObj.shape === "class")) {
    const attr = { name: key, type: unquote(value) };
    if (/\(/.test(key)) attr.kind = "method";
    if (children && children.length) {
      for (const ch of children) {
        const cAt = ch.text.indexOf(":");
        if (cAt > 0 && unquote(ch.text.slice(0, cAt)) === "constraint") {
          const cv = ch.text.slice(cAt + 1).trim();
          attr.constraint = cv.startsWith("[")
            ? splitTopLevel(cv.replace(/^\[|\]$/g, ""), ";").map(unquote).filter(Boolean)
            : unquote(cv);
        }
      }
    }
    scopeObj.attributes = scopeObj.attributes || [];
    scopeObj.attributes.push(attr);
    return;
  }

  // inline map value "k: {a: 1; b: 2}"
  if (value.startsWith("{") && value.endsWith("}")) {
    const inner = parseInlineMap(value);
    if (RESERVED_OBJ_KEYS.has(key)) {
      const obj = scopeId ? ensureObject(model, scopeId, null) : null;
      if (obj) for (const s of inner) interpretStatement(s, null, obj.id, model, line, opts);
      return;
    }
    const o = ensurePath(model, scopeId, segs, line, model.warnings);
    if (o) for (const s of inner) interpretStatement(s, null, o.id, model, line, opts);
    if (children && children.length && o) interpretStatements(children, o.id, model, opts);
    return;
  }

  // "key: Label {inline: map}" — label and single-line map together
  // root-level title: diagram property, not an object (children like near are consumed)
  if (key === "title" && !scopeId) {
    model.title = unquote(value);
    return;
  }

  const im = !value.startsWith("{") && value.endsWith("}") ? value.match(/^(.*?)\s*\{([\s\S]*)\}\s*$/) : null;
  if (im) {
    const labelPart = unquote(im[1].trim());
    const o = ensurePath(model, scopeId, segs, line, model.warnings);
    if (!o) return;
    if (labelPart) o.label = labelPart;
    for (const s of splitTopLevel(im[2], ";").map((x) => x.trim()).filter(Boolean)) {
      interpretStatement(s, null, o.id, model, line, opts);
    }
    if (children && children.length) interpretStatements(children, o.id, model, opts);
    return;
  }

  // block string placeholder or plain scalar value
  const o = ensurePath(model, scopeId, segs, line, model.warnings);
  if (!o) return;
  if (value) o.label = unquote(value);
  if (children && children.length) {
    // suspend/unsuspend values on objects
    if (value === "suspend") o.suspended = true;
    if (value === "unsuspend") o.suspended = false;
    interpretStatements(children, o.id, model, opts);
  } else if (value === "suspend") o.suspended = true;
  else if (value === "unsuspend") o.suspended = false;
}

function interpretConnection(stmt, ops, colonAt, children, scopeId, model, line) {
  const head = colonAt === -1 ? stmt : stmt.slice(0, colonAt);
  // a trailing top-level "{ ... }" (inline style etc.) is not part of the label
  let labelRaw = colonAt === -1 ? "" : stmt.slice(colonAt + 1).trim();
  if (labelRaw.endsWith("}")) {
    let depth = 0, inStr = null, blockStart = -1;
    for (let i = 0; i < labelRaw.length; i++) {
      const ch = labelRaw[i];
      if (inStr) { if (ch === inStr && labelRaw[i - 1] !== "\\") inStr = null; continue; }
      if (ch === '"' || ch === "'") { inStr = ch; continue; }
      if (ch === "{") { if (depth === 0) blockStart = i; depth++; }
      else if (ch === "}") {
        depth--;
        if (depth === 0 && i === labelRaw.length - 1 && blockStart > 0) { labelRaw = labelRaw.slice(0, blockStart).trim(); break; }
      }
    }
  }
  const label = colonAt === -1 ? "" : unquote(labelRaw).replace(/:$/, "").trim();

  if (isGlobPattern(head)) {
    recordGlob(model, head, label, line);
    if (children && children.length) {
      const filters = {};
      for (const ch of children) {
        const cAt = ch.text.indexOf(":");
        if (cAt > 0) filters[unquote(ch.text.slice(0, cAt))] = unquote(ch.text.slice(cAt + 1));
      }
      model.globs[model.globs.length - 1].filters = filters;
    }
    return;
  }

  // split head into operands + operators
  const pieces = [];
  let cursor = 0;
  for (const { op, index } of ops) {
    if (index >= head.length) break;
    pieces.push(head.slice(cursor, index).trim());
    pieces.push(op);
    cursor = index + op.length;
  }
  pieces.push(head.slice(cursor).trim());
  // pieces: [id0, op0, id1, op1, id2, ...]

  const resolveOperand = (raw) => {
    if (!raw) return null;
    if (raw.startsWith("(")) return { ref: raw }; // (a -> b)[0] reference
    const segs = splitPath(raw);
    if (!segs.length) return null;
    const o = ensurePath(model, scopeId, segs, line, model.warnings);
    return o ? o.id : null;
  };

  const edgeClasses = [];
  if (children) {
    for (const ch of children) {
      const cAt = ch.text.indexOf(":");
      const ck = unquote(ch.text.slice(0, cAt > 0 ? cAt : undefined));
      if (ck === "class") {
        const cv = ch.text.slice(cAt + 1).trim();
        edgeClasses.push(...(cv.startsWith("[") ? splitTopLevel(cv.replace(/^\[|\]$/g, ""), ";") : [cv]).map(unquote).filter(Boolean));
      }
    }
  }

  let a = null;
  for (let i = 0; i < pieces.length; i += 2) {
    const operandRaw = pieces[i];
    const op = pieces[i + 1];
    if (a === null) {
      a = resolveOperand(operandRaw);
      continue;
    }
    const opIdx = i - 1;
    const operator = pieces[opIdx] || op || "->";
    const b = resolveOperand(operandRaw);
    if (a === null || b === null) {
      // dangling glob/ref operand — record what we can
      model.warnings.push(`could not resolve connection operand near "${operandRaw}" (line ${line})`);
      a = b;
      continue;
    }
    model.connections.push({
      id: "e" + (model.connections.length + 1),
      src: typeof a === "string" ? a : a.ref,
      dst: typeof b === "string" ? b : b.ref,
      operator,
      label: label || "",
      classes: edgeClasses,
    });
    a = b;
  }
}

function interpretMeta(key, value, children, model, opts) {
  if (key === "vars") {
    // vars: { d2-config: { layout-engine: tala, ... } }
    for (const ch of children || []) {
      if (unquote(ch.text.split(":")[0]) === "d2-config") {
        for (const g of ch.children || []) {
          const cAt = g.text.indexOf(":");
          if (cAt === -1) continue;
          const k = unquote(g.text.slice(0, cAt)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          const v = unquote(g.text.slice(cAt + 1));
          if (["layoutEngine", "themeId", "darkThemeId", "sketch", "pad", "center"].includes(k)) {
            model.config[k] = v === "true" ? true : v === "false" ? false : isNaN(+v) ? v : +v;
          }
        }
      }
    }
    return;
  }
  if (key === "classes") {
    for (const ch of children || []) model.classDefs.push(unquote(ch.text.split(":")[0]));
    return;
  }
  // layers / scenarios / steps → boards
  for (const ch of children || []) {
    const boardKey = unquote(splitTopLevel(ch.text, ";")[0].split(":")[0]);
    if (!boardKey) continue;
    const boardName = (opts.boardPrefix ? opts.boardPrefix + "." : "") + key + "." + boardKey;
    const sub = newModel();
    // a board may itself declare its own label on the same line
    const labelAt = ch.text.indexOf(":");
    if (labelAt > 0) sub.label = unquote(ch.text.slice(labelAt + 1));
    const subOpts = { boardPrefix: boardName };
    interpretStatements(ch.children || [], null, sub, subOpts);
    model.boards[boardName] = boardToPOJO(sub, subOpts);
    Object.assign(model.boards, sub.boards);
  }
}

function boardToPOJO(m, opts) {
  const out = {
    direction: m.direction,
    config: m.config,
    objects: [...m.objects.values()],
    connections: m.connections,
    globs: m.globs,
    imports: m.imports,
  };
  if (m.boardAttrs && Object.keys(m.boardAttrs).length) out.boardAttrs = m.boardAttrs;
  if (m.label) out.label = m.label;
  if (m.title) out.title = m.title;
  if (m.classDefs.length) out.classDefs = m.classDefs;
  out.boards = m.boards;
  return out;
}

/** Visual-plane hints: degree counts, hubs (degree >= 4) that need explicit width/height. */
function computeMetrics(objects, connections) {
  const degree = new Map();
  const bump = (id) => degree.set(id, (degree.get(id) || 0) + 1);
  for (const c of connections) {
    bump(c.src);
    bump(c.dst);
  }
  let maxDegree = 0;
  for (const d of degree.values()) if (d > maxDegree) maxDegree = d;
  const hubs = [];
  for (const [id, d] of degree) if (d >= 4) hubs.push({ id, degree: d });
  hubs.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  return { objects: objects.length, connections: connections.length, maxDegree, hubs };
}

// ------------------------------------------------- public API

/**
 * Parse D2 source into the relationship model.
 * @param {string} source
 * @param {{board?: string, resolveDir?: string}} [opts] select a non-root board
 *   as the top level; resolveDir enables local `@file` import resolution
 */
export function extract(source, opts = {}) {
  const warnings = [];
  const { lines, blocks } = toLogicalLines(source, warnings);
  const tree = buildTree(lines);
  const model = newModel();
  interpretStatements(tree.children, null, model, {});

  const substitute = (label) =>
    typeof label === "string"
      ? label.replace(/\u0000B(\d+)\u0000/g, (_, i) => (blocks[+i] ? blocks[+i].content.trim() : ""))
      : label;
  for (const o of model.objects.values()) o.label = substitute(o.label);
  if (model.title) model.title = substitute(model.title);
  for (const b of Object.values(model.boards)) {
    for (const o of b.objects || []) o.label = substitute(o.label);
  }

  const result = boardToPOJO(model, {});
  result.ok = true;
  result.blockStrings = blocks.map((b) => ({ key: b.key.replace(/:\s*$/, ""), content: b.content, line: b.line }));
  result.warnings = warnings.concat(model.warnings);
  if (opts.resolveDir) resolveImports(result, opts.resolveDir, new Set());
  result.metrics = computeMetrics(result.objects, result.connections);
  if (opts.board && model.boards[opts.board]) {
    const b = model.boards[opts.board];
    return { ...b, ok: true, board: opts.board, boards: model.boards, warnings: result.warnings, metrics: computeMetrics(b.objects, b.connections) };
  }
  return result;
}

/**
 * Merge locally imported files into the model (spread `...@file` merges flat,
 * `alias: @file` nests under the alias). Globs intentionally do NOT carry over
 * (D2 semantics: only `***` crosses imports).
 */
function resolveImports(model, dir, visited) {
  const { readFileSync } = require("node:fs");
  const { resolve, dirname } = require("node:path");
  for (const imp of model.imports || []) {
    if (imp.resolved) continue;
    const file = resolve(dir, imp.path);
    if (visited.has(file)) {
      model.warnings.push("circular import skipped: " + imp.path);
      continue;
    }
    // d2 accepts extensionless imports (@model === @model.d2); try exact, then +.d2
    let src = null;
    for (const candidate of file.endsWith(".d2") ? [file] : [file, file + ".d2"]) {
      try {
        src = readFileSync(candidate, "utf8");
        if (src != null) break;
      } catch {
        src = null;
      }
    }
    if (src == null) {
      model.warnings.push("import not resolved (file unreadable): " + imp.path);
      continue;
    }
    visited.add(file);
    const imported = extract(src, { resolveDir: dirname(file) });
    visited.delete(file);
    const prefix = imp.alias || null;
    const haveObj = new Set(model.objects.map((o) => o.id));
    const haveConn = new Set(model.connections.map((c) => c.src + "\u0000" + c.dst + "\u0000" + c.label));
    for (const o of imported.objects) {
      const o2 = prefix
        ? { ...o, id: prefix + "." + o.id, container: o.container ? prefix + "." + o.container : prefix }
        : o;
      if (!haveObj.has(o2.id)) {
        model.objects.push(o2);
        haveObj.add(o2.id);
      }
    }
    for (const c of imported.connections) {
      const c2 = prefix
        ? { ...c, id: prefix + "." + c.id, src: prefix + "." + c.src, dst: prefix + "." + c.dst }
        : c;
      const k = c2.src + "\u0000" + c2.dst + "\u0000" + c2.label;
      if (!haveConn.has(k)) {
        model.connections.push(c2);
        haveConn.add(k);
      }
    }
    for (const [k, v] of Object.entries(imported.config || {})) {
      if (model.config[k] === undefined) model.config[k] = v;
    }
    if ((!model.direction || model.direction === "down") && imported.direction && imported.direction !== "down") model.direction = imported.direction;
    if (imported.classDefs) model.classDefs = [...new Set([...(model.classDefs || []), ...imported.classDefs])];
    imp.resolved = true;
  }
}

/** Compact text rendering of the model — the terminal / text-only-agent view. */
export function toText(model) {
  const out = [];
  const dir = model.direction || "down";
  const layout = model.config?.layoutEngine || "dagre (default)";
  out.push(`direction: ${dir} | layout: ${layout}${model.config?.themeId ? " | theme: " + model.config.themeId : ""}`);
  const objs = model.objects || [];
  out.push(`objects (${objs.length}):`);
  for (const o of objs) {
    let line = "  " + o.id;
    const bits = [];
    if (o.label && o.label !== o.id.split(".").pop()) bits.push('"' + o.label + '"');
    if (o.shape) bits.push(o.shape);
    if (o.classes && o.classes.length) bits.push("class:" + o.classes.join(","));
    if (o.suspended) bits.push("suspended");
    if (bits.length) line += "  — " + bits.join(" | ");
    out.push(line);
    if (o.attributes) {
      for (const a of o.attributes) {
        out.push(`      ${a.name}${a.type ? ": " + a.type : ""}${a.constraint ? " {" + [].concat(a.constraint).join(",") + "}" : ""}`);
      }
    }
  }
  const conns = model.connections || [];
  out.push(`connections (${conns.length}):`);
  for (const c of conns) {
    out.push(`  ${c.src} ${c.operator} ${c.dst}${c.label ? " : " + c.label : ""}`);
  }
  const m = model.metrics;
  if (m) {
    out.push(`metrics: ${m.objects} objects, ${m.connections} connections, maxDegree ${m.maxDegree}`);
    if (m.hubs.length)
      out.push("hubs (degree>=4, give explicit width/height): " + m.hubs.map((h) => h.id + " (" + h.degree + ")").join(", "));
  }
  if (model.imports && model.imports.length) {
    out.push("imports: " + model.imports.map((i) => (i.spread ? "..." : "") + i.path + (i.alias ? " as " + i.alias : "")).join(", "));
  }
  if (model.classDefs && model.classDefs.length) out.push("classes defined: " + model.classDefs.join(", "));
  if (model.globs && model.globs.length) {
    out.push("glob rules:");
    for (const g of model.globs) out.push(`  ${g.pattern}${g.value ? ": " + g.value : ""}${g.filters ? " " + JSON.stringify(g.filters) : ""} (line ${g.line})`);
  }
  const boards = Object.keys(model.boards || {});
  if (boards.length) {
    out.push("boards: " + boards.map((b) => `${b} (${model.boards[b].objects.length} objects, ${model.boards[b].connections.length} connections)`).join("; "));
  }
  if (model.warnings && model.warnings.length) {
    out.push("warnings:");
    for (const w of model.warnings) out.push("  ! " + w);
  }
  return out.join("\n");
}

// ------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { file: null, text: false, board: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--text") args.text = true;
    else if (a === "--json") args.text = false;
    else if (a === "--board") args.board = argv[++i];
    else if (!args.file) args.file = a;
  }
  return args;
}

async function readInput(file) {
  if (!file || file === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  const { readFileSync } = await import("node:fs");
  return readFileSync(file, "utf8");
}

if (import.meta.url === new URL("file://" + process.argv[1]).href && !process.env.D2_EXTRACT_NO_CLI) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const source = await readInput(args.file);
    const { dirname } = require("node:path");
    const model = extract(source, { board: args.board, resolveDir: args.file && args.file !== "-" ? dirname(args.file) : process.cwd() });
    console.log(args.text ? toText(model) : JSON.stringify(model, null, 2));
  } catch (e) {
    console.error("extract: " + (e && e.message ? e.message : e));
    process.exit(1);
  }
}
