// Shared spawn helper: run the d2 binary cross-platform (Windows/macOS/Linux/WSL).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function d2Bin() {
  if (process.env.D2_PATH) return process.env.D2_PATH;
  return process.platform === "win32" ? "d2.exe" : "d2";
}

/**
 * Run d2 with optional source written to a temp file.
 *
 * @param {object} o
 * @param {string} [o.source]      D2 source; if set, written to a temp .d2 file
 * @param {string[]} [o.args]      extra CLI flags, or positional args for layout/themes
 * @param {string} [o.subcommand]  e.g. "validate" | "fmt"
 * @param {string} [o.outputPath]  render target; appended after the input file
 * @param {boolean} [o.stdout]     use `-` as output so result lands on stdout (fmt)
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string, code:number}>}
 */
export function spawnFile({ source, args = [], subcommand, outputPath, stdout }) {
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

      if (source !== undefined) {
        dir = mkdtempSync(join(tmpdir(), "d2-mcp-"));
        const input = join(dir, "input.d2");
        writeFileSync(input, source, "utf8");
        full.push(input);
      }
      if (outputPath) full.push(outputPath);
      else if (stdout) full.push("-");

      const child = spawn(d2Bin(), full, { windowsHide: true });
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
