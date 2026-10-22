// Shared spawn helper: run the d2 binary cross-platform (Windows/macOS/Linux/WSL).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function d2Bin() {
  if (process.env.D2_PATH) return process.env.D2_PATH;
  return process.platform === "win32" ? "d2.exe" : "d2";
}

/**
 * When a Windows d2.exe runs under WSL, translate /mnt/<drive>/... POSIX paths
 * to X:\\... so the Windows binary can open them. Relative paths pass through.
 */
function childPath(p) {
  if (/\.exe$/i.test(d2Bin())) {
    const m = p.match(/^(?:\/mnt\/|\/)([a-z])\/(.*)$/i);
    if (m && existsSync("/mnt/" + m[1].toLowerCase())) {
      return m[1].toUpperCase() + ":\\" + m[2].replace(/\//g, "\\");
    }
  }
  return p;
}

/**
 * Read an SVG's intrinsic size (d2 writes width="N" height="N" on <svg>).
 * Returns {width, height, aspect} rounded, or null if unreadable.
 */
export function svgDims(svgPath) {
  try {
    const m = readFileSync(svgPath, "utf8")
      .slice(0, 600)
      .match(/<svg[^>]*?\bwidth="(\d+(?:\.\d+)?)"[^>]*?\bheight="(\d+(?:\.\d+)?)"/s);
    if (!m) return null;
    const width = Math.round(Number(m[1]));
    const height = Math.round(Number(m[2]));
    if (!width || !height) return null;
    return { width, height, aspect: Math.round((width / height) * 100) / 100 };
  } catch {
    return null;
  }
}

/**
 * Parse d2 compiler diagnostics ("file.d2:3:1: message") into structured errors.
 */
export function parseDiagnostics(text) {
  const errors = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    // strip "err: github.com/.../pkg.Fn: " wrappers before the position
    const line = rawLine.replace(/^err:\s*[\w./\\-]+:\s*/, "").replace(/^err:\s*/, "");
    let m = line.match(/^(?:[^:\s][^:]*?):(\d+):(\d+):\s*(.*)$/);
    if (!m) m = line.match(/^(\d+):(\d+):\s*(.*)$/);
    if (m) errors.push({ line: +m[1], col: +m[2], message: m[3] });
    else if (line.trim() && errors.length) {
      errors[errors.length - 1].message += "\n" + line;
    } else if (line.trim() && !/^err failed to compile/.test(line)) {
      errors.push({ line: 0, col: 0, message: line.trim() });
    }
  }
  return errors;
}

/**
 * Run d2 with optional source written to a temp file.
 *
 * @param {object} o
 * @param {string} [o.source]      D2 source; if set, written to a temp .d2 file
 * @param {string} [o.inputFile]   existing .d2/.md file to pass instead of source
 * @param {string} [o.stdinInput]  pipe this through stdin instead (d2 fmt -)
 * @param {string[]} [o.args]      extra CLI flags, or positional args for layout/themes
 * @param {string} [o.subcommand]  e.g. "validate" | "fmt"
 * @param {string} [o.outputPath]  render target; appended after the input file
 * @param {boolean} [o.stdout]     use `-` as output so result lands on stdout (fmt)
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string, code:number}>}
 */
export function spawnFile({ source, inputFile, stdinInput, args = [], subcommand, outputPath, stdout, cwd }) {
  return new Promise((resolve) => {
    let dir;
    const done = (result) => {
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
      resolve(result);
    };

    try {
      const full = [];
      if (subcommand) full.push(subcommand);
      full.push(...args);

      if (inputFile) {
        full.push(childPath(inputFile));
      } else if (source !== undefined) {
        // keep the temp file near the input's directory so a Windows d2.exe under
        // WSL can read it AND relative @imports resolve on both CWD-based (win exe)
        // and file-based (native) import resolution
        dir = mkdtempSync(join(cwd || process.cwd(), ".d2-mcp-"));
        const input = join(dir, "input.d2");
        writeFileSync(input, source, "utf8");
        full.push(childPath(input));
      }
      if (outputPath) full.push(childPath(outputPath));
      else if (stdout) full.push("-");

      const child = spawn(d2Bin(), full, {
        windowsHide: true,
        // cwd must stay a POSIX path (Node resolves it; WSL interop maps a /mnt/...
        // cwd to the Windows equivalent for the exe). Args are childPath-ed above.
        ...(cwd ? { cwd: String(cwd) } : {}),
        stdio: [stdinInput ? "pipe" : "ignore", "pipe", "pipe"],
      });
    if (stdinInput) {
      child.stdin.write(stdinInput);
      child.stdin.end();
    }
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d.toString("utf8")));
      child.stderr.on("data", (d) => (err += d.toString("utf8")));
      child.on("error", (e) =>
        done({ ok: false, stdout: out, stderr: String(e), code: -1 })
      );
      child.on("close", (code) =>
        done({ ok: code === 0, stdout: out, stderr: err, code })
      );
    } catch (e) {
      done({ ok: false, stdout: "", stderr: String(e), code: -1 });
    }
  });
}
