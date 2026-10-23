#!/usr/bin/env node
/**
 * d2-mcp-server — MCP stdio server wrapping the d2 CLI + pure-JS tooling.
 *
 * Tools:
 *   d2_render    — compile D2 source/file to svg/png/pdf/pptx/gif/txt
 *   d2_validate  — compile check with structured errors [{line,col,message}]
 *   d2_fmt       — autoformat D2 source
 *   d2_extract   — parse D2 into a relationship model (machine plane)
 *   d2_md_render — render ```d2 fences in .md files (+ dual-plane sidecars)
 *   d2_layouts   — list layout engines available on this machine
 *   d2_themes    — list theme IDs available on this machine
 *   d2_version   — d2 CLI version string
 *
 * The d2 binary is resolved from D2_PATH or PATH (d2 / d2.exe).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { spawnFile, parseDiagnostics, svgDims } from "./lib.js";
import { analyzeSvg } from "./lib/svgmap.js";
import { extract, toText } from "./lib/extract.js";
import { renderMarkdown } from "./lib/mdrender.js";

const server = new McpServer({
  name: "d2",
  version: "0.2.0",
});

const layoutEnum = z.enum(["dagre", "elk", "tala"]);
const formatEnum = z.enum(["svg", "png", "pdf", "pptx", "gif", "txt", "ascii"]);

const sourceOrFile = {
  source: z.string().optional().describe("D2 diagram source code"),
  filePath: z
    .string()
    .optional()
    .describe("Path to an existing .d2 file (alternative to source)"),
};

function readInput({ source, filePath }) {
  if (source !== undefined && source !== null) return { source };
  if (filePath) return { source: fs.readFileSync(filePath, "utf8"), inputFile: filePath };
  throw new Error("provide either source or filePath");
}

function json(x) {
  return { content: [{ type: "text", text: JSON.stringify(x, null, 2) }] };
}

// Shared by d2_variants / d2_layout_map: base source text, the directory
// relative @imports resolve from, and a direction-override wrapper (D2 has no
// --direction CLI flag; an appended root `direction:` wins as last declaration).
function baseSource(input) {
  const opts = readInput(input);
  let sourceText = opts.source;
  let baseDir = process.cwd();
  if (opts.inputFile) {
    const abs = path.resolve(opts.inputFile);
    sourceText = fs.readFileSync(abs, "utf8");
    baseDir = path.dirname(abs);
  }
  return {
    sourceText,
    baseDir,
    withDir: (dir) => sourceText + (dir ? "\n# variant override\ndirection: " + dir + "\n" : ""),
  };
}

// ------------------------------------------------------------ d2_render
server.registerTool(
  "d2_render",
  {
    title: "Render a D2 diagram",
    description:
      "Compiles D2 source (or a .d2 file) to an image file and returns the output path. " +
      "Check success via the `ok` field — d2 can write partial renders on error.",
    inputSchema: {
      ...sourceOrFile,
      outputPath: z
        .string()
        .describe(
          "Absolute path of the output file. Extension picks the format " +
          "(.svg/.png/.pdf/.pptx/.gif/.txt)."
        ),
      layout: layoutEnum.optional().describe("Layout engine (default dagre)"),
      theme: z.number().int().optional().describe("Theme ID (see d2_themes)"),
      darkTheme: z.number().int().optional().describe("Dark-mode theme ID"),
      sketch: z.boolean().optional().describe("Hand-drawn look"),
      pad: z.number().int().optional().describe("Padding in px (default 100)"),
      center: z.boolean().optional().describe("Center the diagram in the canvas"),
      bundle: z.boolean().optional().describe("Inline assets into a single self-contained file"),
      scale: z.number().optional().describe("Scale factor for png/gif exports"),
      animateInterval: z
        .number()
        .int()
        .optional()
        .describe("ms per board for multi-board SVG/GIF exports"),
      target: z
        .string()
        .optional()
        .describe("Board to render, e.g. '' for root or 'scenarios.x'"),
    },
  },
  async (input) => {
    const { source, filePath, outputPath, layout, theme, darkTheme, sketch, pad, center, bundle, scale, animateInterval, target } = input;
    const args = [];
    if (layout) args.push(`--layout=${layout}`);
    if (theme !== undefined) args.push(`--theme=${theme}`);
    if (darkTheme !== undefined) args.push(`--dark-theme=${darkTheme}`);
    if (sketch) args.push("--sketch");
    if (pad !== undefined) args.push(`--pad=${pad}`);
    if (center) args.push("--center");
    if (bundle) args.push("--bundle");
    if (scale !== undefined) args.push(`--scale=${scale}`);
    if (animateInterval !== undefined) args.push(`--animate-interval=${animateInterval}`);
    if (target !== undefined) args.push(`--target=${target}`);
    let spawnOpts;
    try {
      spawnOpts = readInput({ source, filePath });
    } catch (e) {
      return { ...json({ ok: false, error: String(e.message) }), isError: true };
    }
    const res = await spawnFile({ ...spawnOpts, args, outputPath });
    let dims;
    if (res.ok && outputPath && /[.]svg$/i.test(outputPath)) dims = svgDims(outputPath);
    return {
      ...json(
        res.ok
          ? { ok: true, outputPath, message: res.stderr.trim() || "rendered", ...(dims || {}) }
          : {
              ok: false,
              error: res.stderr.trim() || res.stdout.trim(),
              errors: parseDiagnostics(res.stderr || res.stdout),
            }
      ),
      isError: !res.ok,
    };
  }
);

// ------------------------------------------------------------ d2_validate
server.registerTool(
  "d2_validate",
  {
    title: "Validate D2 source",
    description:
      "Runs `d2 validate` on the given source or file. Returns ok=true or structured " +
      "errors [{line,col,message}]. Always call before presenting a diagram as done.",
    inputSchema: { ...sourceOrFile },
  },
  async (input) => {
    let spawnOpts;
    try {
      spawnOpts = readInput(input);
    } catch (e) {
      return { ...json({ ok: false, error: String(e.message) }), isError: true };
    }
    const res = await spawnFile({ ...spawnOpts, args: [], subcommand: "validate" });
    return {
      ...json(
        res.ok
          ? { ok: true }
          : {
              ok: false,
              errors: parseDiagnostics(res.stderr || res.stdout),
              raw: (res.stderr || res.stdout).trim(),
            }
      ),
      isError: !res.ok,
    };
  }
);

// ------------------------------------------------------------ d2_fmt
server.registerTool(
  "d2_fmt",
  {
    title: "Format D2 source",
    description: "Autoformats D2 source (like gofmt) and returns the result.",
    inputSchema: { ...sourceOrFile },
  },
  async (input) => {
    let spawnOpts;
    try {
      spawnOpts = readInput(input);
    } catch (e) {
      return { ...json({ ok: false, error: String(e.message) }), isError: true };
    }
    // d2 fmt - : format stdin to stdout
    const res = await spawnFile({ stdinInput: spawnOpts.source, args: ["-"], subcommand: "fmt" });
    return {
      ...json(
        res.ok
          ? { ok: true, formatted: res.stdout }
          : { ok: false, errors: parseDiagnostics(res.stderr || res.stdout) }
      ),
      isError: !res.ok,
    };
  }
);

// ------------------------------------------------------------ d2_extract
server.registerTool(
  "d2_extract",
  {
    title: "Extract component relationships from D2",
    description:
      "Parses D2 into a machine-readable relationship model — objects (id, label, " +
      "container, shape, classes), connections (src -> dst, label, operator), globs, " +
      "imports, boards and warnings. No d2 binary needed. Use this to answer questions " +
      "about a diagram, diff architectures, or verify code against a diagram. " +
      "Set view='text' for a compact ASCII view instead of JSON.",
    inputSchema: {
      ...sourceOrFile,
      board: z
        .string()
        .optional()
        .describe("Select a sub-board as the top level, e.g. 'layers.internals'"),
      view: z.enum(["json", "text"]).optional().describe("Output form (default json)"),
    },
  },
  async (input) => {
    let src, resolveDir;
    try {
      const r = readInput(input);
      src = r.source;
      resolveDir = r.inputFile ? path.dirname(r.inputFile) : undefined;
    } catch (e) {
      return { ...json({ ok: false, error: String(e.message) }), isError: true };
    }
    try {
      const model = extract(src, { board: input.board, resolveDir });
      if (input.view === "text") {
        return json({ ok: true, text: toText(model) });
      }
      return json(model);
    } catch (e) {
      return { ...json({ ok: false, error: "extract: " + String(e.message || e) }), isError: true };
    }
  }
);

// ------------------------------------------------------------ d2_md_render
server.registerTool(
  "d2_md_render",
  {
    title: "Render d2 fences in Markdown files",
    description:
      "Finds ```d2 fenced blocks in .md files, renders each to an image, refreshes the " +
      "image link under the fence, and (with sidecars=true) writes dual-plane artifacts: " +
      "<name>.txt (compact relationship view for text-only agents) and " +
      "<name>.relations.json (machine-readable model) next to the image. " +
      "checkOnly=true validates without writing.",
    inputSchema: {
      paths: z.array(z.string()).min(1).describe("Markdown file paths"),
      format: z.enum(["svg", "png"]).optional().describe("Image format (default svg)"),
      d2Path: z.string().optional().describe("Path to the d2 binary (else D2_PATH/PATH)"),
      outDir: z.string().optional().describe("Output dir relative to the md file (default 'diagrams')"),
      sidecars: z.boolean().optional().describe("Also write .txt + .relations.json (default false)"),
      checkOnly: z.boolean().optional().describe("Only validate blocks, write nothing"),
      force: z.boolean().optional().describe("Re-render even if unchanged"),
    },
  },
  async ({ paths, format, d2Path, outDir, sidecars, checkOnly, force }) => {
    const opts = {
      files: [],
      format: format || "svg",
      d2: d2Path || process.env.D2_PATH || "d2",
      outDir: outDir || null,
      sidecars: !!sidecars,
      checkOnly: !!checkOnly,
      force: !!force,
    };
    const results = [];
    let bad = 0;
    for (const p of paths) {
      try {
        const r = renderMarkdown(p, opts);
        results.push({ path: p, ...r });
        bad += r.failed;
      } catch (e) {
        results.push({ path: p, rendered: 0, failed: 1, errors: [String(e.message || e)] });
        bad++;
      }
    }
    return { ...json({ ok: bad === 0, files: results }), isError: bad > 0 };
  }
);

// ------------------------------------------------------------ d2_layouts
server.registerTool(
  "d2_layouts",
  {
    title: "List d2 layout engines",
    description: "Lists layout engines available on this machine (dagre/elk/tala...).",
    inputSchema: {},
  },
  async () => {
    const res = await spawnFile({ args: ["layout"] });
    return {
      content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }],
      isError: !res.ok,
    };
  }
);

// ------------------------------------------------------------ d2_themes
server.registerTool(
  "d2_themes",
  {
    title: "List d2 themes",
    description: "Lists theme IDs available on this machine.",
    inputSchema: {},
  },
  async () => {
    const res = await spawnFile({ args: ["themes"] });
    return {
      content: [{ type: "text", text: res.ok ? res.stdout : res.stderr }],
      isError: !res.ok,
    };
  }
);

// ------------------------------------------------------------ d2_variants
server.registerTool(
  "d2_variants",
  {
    title: "Render layout or styling variants for comparison",
    description:
      "Two-stage refinement ladder for the visual plane. stage='layout' renders an "+
      "engine x direction bake-off (default elk/dagre x right/down) so you can pick the "+
      "clearest structure. stage='style' re-renders ONE chosen layout under several "+
      "themes (default 1 Neutral Grey = the black-and-white readability check, "+
      "0 Neutral Default, 8 Colorblind Clear; pass your own theme ids) plus optionally "+
      "a --sketch variant. Every variant returns width/height/aspect from the SVG. "+
      "Inspect the files, pick the winner, delete the rest. Style rule: the diagram "+
      "must stay comprehensible in the monochrome variant — color adds signal, not noise.",
    inputSchema: {
      ...sourceOrFile,
      stage: z.enum(["layout", "style"]).optional().describe("Refinement stage (default 'layout')"),
      layouts: z.array(z.enum(["dagre", "elk", "tala"])).optional().describe("Engines for stage='layout' (default ['elk','dagre'])"),
      directions: z.array(z.enum(["down", "up", "right", "left"])).optional().describe("Directions for stage='layout' (default ['right','down'])"),
      layout: layoutEnum.optional().describe("Fixed engine for stage='style' (else the file's own config)"),
      direction: z.enum(["down", "up", "right", "left"]).optional().describe("Fixed direction for stage='style'"),
      themes: z.array(z.number().int()).optional().describe("Theme ids for stage='style' (default [1,0,8]: grey B&W check, neutral, colorblind-safe)"),
      sketch: z.boolean().optional().describe("stage='style': also render a hand-drawn variant"),
      outDir: z.string().optional().describe("Directory for outputs (default 'variants', relative to cwd)"),
      prefix: z.string().optional().describe("Output basename (default: input filename or 'diagram')"),
    },
  },
  async (input) => {
    const stage = input.stage || "layout";
    let spawnOpts;
    try {
      spawnOpts = readInput(input);
    } catch (e) {
      return { ...json({ ok: false, error: String(e.message) }), isError: true };
    }
    const outDir = input.outDir || "variants";
    const prefix =
      input.prefix ||
      (spawnOpts.inputFile
        ? path.basename(spawnOpts.inputFile).replace(/[.]d2$/i, "")
        : "diagram");
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (e) {
      return { ...json({ ok: false, error: "cannot create outDir: " + String(e.message) }), isError: true };
    }

    // Base source + import dir via the shared helper (direction overrides are
    // appended to the source; renders go through temp files inside baseDir).
    const base = baseSource(input);

    // Build the render plan: [{tag, args, path}]
    const plan = [];
    if (stage === "layout") {
      const engines = input.layouts && input.layouts.length ? input.layouts : ["elk", "dagre"];
      const dirs = input.directions && input.directions.length ? input.directions : ["right", "down"];
      for (const eng of engines)
        for (const dir of dirs)
          plan.push({
            tag: eng + "-" + dir,
            args: ["--layout=" + eng],
            source: base.withDir(dir),
            path: path.join(outDir, prefix + "." + eng + "-" + dir + ".svg"),
          });
    } else {
      const baseArgs = [];
      if (input.layout) baseArgs.push("--layout=" + input.layout);
      const dir = input.direction || null;
      const themes = input.themes && input.themes.length ? input.themes : [1, 0, 8];
      for (const t of themes)
        plan.push({
          tag: "theme-" + t,
          args: [...baseArgs, "--theme=" + t],
          source: base.withDir(dir),
          path: path.join(outDir, prefix + ".theme-" + t + ".svg"),
        });
      if (input.sketch)
        plan.push({
          tag: "sketch",
          args: [...baseArgs, "--sketch"],
          source: base.withDir(dir),
          path: path.join(outDir, prefix + ".sketch.svg"),
        });
    }

    const variants = [];
    const failed = [];
    for (const p of plan) {
      const res = await spawnFile({ source: p.source, args: p.args, outputPath: p.path, cwd: base.baseDir });
      if (!res.ok) {
        failed.push({ tag: p.tag, error: res.stderr.trim() || res.stdout.trim() });
        continue;
      }
      const dims = svgDims(p.path) || {};
      let crossings;
      try {
        crossings = analyzeSvg(fs.readFileSync(p.path, "utf8")).analysis.crossings.length;
      } catch {
        /* geometry optional */
      }
      variants.push({ tag: p.tag, path: p.path, ...dims, ...(crossings !== undefined ? { crossings } : {}) });
    }
    // Data-driven winner for the bake-off: fewest crossings, then aspect closest
    // to 1.6 (inside the 3:2-16:9 band). Lets text-only agents pick without eyes.
    let recommended = null;
    if (variants.length > 1) {
      const scored = [...variants].sort(
        (a, b) => (a.crossings ?? 99) - (b.crossings ?? 99) || Math.abs((a.aspect ?? 9) - 1.6) - Math.abs((b.aspect ?? 9) - 1.6)
      );
      recommended = scored[0].tag;
    }
    return json({
      ok: failed.length === 0,
      stage,
      outDir,
      ...(recommended ? { recommended } : {}),
      variants,
      ...(failed.length ? { failed } : {}),
      hint:
        stage === "layout"
          ? "recommended = fewest crossings then aspect closest to 1.6. Compare variants, keep the clearest, then run stage='style' on the winner."
          : "Keep the variant that reads best in monochrome (theme 1); color must add signal, not noise.",
    });
  }
);

// ------------------------------------------------------------ d2_layout_map
server.registerTool(
  "d2_layout_map",
  {
    title: "Post-layout geometry as text (for agents that cannot view images)",
    description:
      "Renders the diagram in-memory and returns MEASURED geometry (not predicted): " +
      "canvas size/aspect, per-component bboxes + centers + containers, edge routes, " +
      "crossing pairs, overlapping shapes, a discretized textMap grid, and " +
      "relative-position predicates (left-of / above). Lets text-only agents judge " +
      "and iterate visual composition: show the user the textMap, collect intended " +
      "positions, adjust direction/near/grid/containers, re-run until it converges.",
    inputSchema: {
      ...sourceOrFile,
      layout: layoutEnum.optional().describe("Layout engine to measure with (default: the file's own config)"),
      direction: z.enum(["down", "up", "right", "left"]).optional().describe("Direction override to measure with"),
      theme: z.number().int().optional().describe("Theme id (fonts slightly change geometry)"),
      gridCols: z.number().int().min(3).max(24).optional().describe("textMap grid columns (default: auto from aspect)"),
      gridRows: z.number().int().min(2).max(40).optional().describe("textMap grid rows (default: auto)"),
      target: z.string().optional().describe("Board to measure, e.g. '' for root or 'scenarios.x'"),
    },
  },
  async (input) => {
    let base;
    try {
      base = baseSource(input);
    } catch (e) {
      return { ...json({ ok: false, error: String(e.message) }), isError: true };
    }
    const args = [];
    if (input.layout) args.push("--layout=" + input.layout);
    if (input.theme !== undefined) args.push("--theme=" + input.theme);
    if (input.target !== undefined) args.push("--target=" + input.target);
    const res = await spawnFile({
      source: base.withDir(input.direction),
      args,
      cwd: base.baseDir,
      stdout: true,
    });
    if (!res.ok || !res.stdout) {
      return {
        ...json({
          ok: false,
          error: (res.stderr || res.stdout || "").trim(),
          errors: parseDiagnostics(res.stderr || ""),
        }),
        isError: true,
      };
    }
    const map = analyzeSvg(res.stdout, {
      grid: { cols: input.gridCols, rows: input.gridRows },
    });
    return json({
      ok: true,
      engine: input.layout || null,
      direction: input.direction || null,
      ...map,
      hint: "Compare textMap/relations with the intended composition; tweak direction, near, grid-columns or containers and re-run. Fewest crossings + aspect 3:2 to 16:9 wins. analysis.edgeOverlaps lists arrows slicing shapes they are not connected to — fix with direction, hub width/height, or by splitting the view. (Sequence diagrams: lifeline traversals of groups are expected.)"
    });
  }
);

// ------------------------------------------------------------ d2_version
server.registerTool(
  "d2_version",
  {
    title: "d2 CLI version",
    description: "Returns the d2 binary version string, e.g. v0.9.0.",
    inputSchema: {},
  },
  async () => {
    const res = await spawnFile({ args: ["--version"] });
    return {
      ...json({ ok: res.ok, version: (res.stdout || res.stderr).trim() }),
      isError: !res.ok,
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
