#!/usr/bin/env node
/**
 * d2-mcp-server — MCP stdio server wrapping the d2 CLI.
 *
 * Tools:
 *   d2_render    — compile D2 source to svg/png/pdf/pptx/gif/ascii
 *   d2_validate  — syntax/compile check, returns errors with line numbers
 *   d2_fmt       — autoformat D2 source
 *   d2_layouts   — list layout engines available on this machine
 *   d2_themes    — list theme IDs available on this machine
 *
 * The d2 binary is resolved from D2_PATH or PATH (d2 / d2.exe).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawnFile } from "./lib.js";

const server = new McpServer({
  name: "d2",
  version: "0.1.0",
});

const layoutEnum = z.enum(["dagre", "elk", "tala"]);
const formatEnum = z.enum(["svg", "png", "pdf", "pptx", "gif", "txt", "ascii"]);

server.registerTool(
  "d2_render",
  {
    title: "Render a D2 diagram",
    description:
      "Compiles D2 source to an image file and returns the output path. " +
      "Check success via the `ok` field — d2 can write partial renders on error.",
    inputSchema: {
      source: z.string().describe("D2 diagram source code"),
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
  async ({ source, outputPath, layout, theme, darkTheme, sketch, pad, animateInterval, target }) => {
    const args = [];
    if (layout) args.push(`--layout=${layout}`);
    if (theme !== undefined) args.push(`--theme=${theme}`);
    if (darkTheme !== undefined) args.push(`--dark-theme=${darkTheme}`);
    if (sketch) args.push("--sketch");
    if (pad !== undefined) args.push(`--pad=${pad}`);
    if (animateInterval !== undefined) args.push(`--animate-interval=${animateInterval}`);
    if (target !== undefined) args.push(`--target=${target}`);
    const res = await spawnFile({ source, args, outputPath });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            res.ok
              ? { ok: true, outputPath, message: res.stderr.trim() || "rendered" }
              : { ok: false, error: res.stderr.trim() || res.stdout.trim() },
            null,
            2
          ),
        },
      ],
      isError: !res.ok,
    };
  }
);

server.registerTool(
  "d2_validate",
  {
    title: "Validate D2 source",
    description:
      "Runs `d2 validate` on the given source. Returns ok=true or the compiler " +
      "errors with line numbers. Always call before presenting a diagram as done.",
    inputSchema: {
      source: z.string().describe("D2 diagram source code"),
    },
  },
  async ({ source }) => {
    const res = await spawnFile({ source, args: [], subcommand: "validate" });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            res.ok
              ? { ok: true }
              : { ok: false, errors: (res.stderr || res.stdout).trim() },
            null,
            2
          ),
        },
      ],
      isError: !res.ok,
    };
  }
);

server.registerTool(
  "d2_fmt",
  {
    title: "Format D2 source",
    description: "Autoformats D2 source (like gofmt) and returns the result.",
    inputSchema: {
      source: z.string().describe("D2 diagram source code"),
    },
  },
  async ({ source }) => {
    const res = await spawnFile({ source, args: [], subcommand: "fmt", stdout: true });
    return {
      content: [
        {
          type: "text",
          text: res.ok
            ? JSON.stringify({ ok: true, formatted: res.stdout }, null, 2)
            : JSON.stringify({ ok: false, errors: (res.stderr || res.stdout).trim() }, null, 2),
        },
      ],
      isError: !res.ok,
    };
  }
);

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

const transport = new StdioServerTransport();
await server.connect(transport);
