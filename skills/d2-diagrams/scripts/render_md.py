#!/usr/bin/env python3
"""render_md.py — extract ```d2 fences from Markdown, validate and render them,
and produce a Markdown file with image links after each fence.

Cross-platform (Windows/macOS/Linux/WSL), Python 3.8+, stdlib only.
Requires the d2 CLI on PATH (or pass --d2 /path/to/d2).

Usage:
    python render_md.py README.md                     # -> README.rendered.md + assets/*.svg
    python render_md.py docs/a.md docs/b.md --in-place
    python render_md.py README.md --check-only        # CI: validate only, no output
    python render_md.py README.md --format png --layout elk --theme 101

Fence naming:
    ```d2                  -> assets/<doc>-1.svg
    ```d2 name=payments    -> assets/payments.svg
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

FENCE_RE = re.compile(r"^(```+)d2[ \t]*(.*)$")
IMG_RE = re.compile(r"^!\[[^\]]*\]\(([^)]+)\)\s*$")


def find_d2(cli_override=None):
    import shutil
    exe = cli_override or shutil.which("d2")
    if not exe:
        sys.exit("error: d2 CLI not found on PATH (use --d2 to point at the binary)")
    return exe


def run_d2(d2, args, **kw):
    return subprocess.run([d2] + args, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", **kw)


def parse_fences(lines):
    """Yield (start, end, info, source_lines) for each ```d2 fence.
    start/end are indices into lines (end = index of closing fence)."""
    i = 0
    while i < len(lines):
        m = FENCE_RE.match(lines[i].rstrip("\n"))
        if not m:
            i += 1
            continue
        ticks, info = m.group(1), m.group(2).strip()
        j = i + 1
        src = []
        while j < len(lines) and not lines[j].startswith(ticks):
            src.append(lines[j])
            j += 1
        if j < len(lines):
            yield i, j, info, src
            i = j + 1
        else:
            i += 1  # unterminated fence — ignore


def fence_name(info, docbase, index):
    m = re.search(r"(?:^|\s)name=([\w.\-]+)", info or "")
    return m.group(1) if m else f"{docbase}-{index}"


def render_one(d2, source, out_path, fmt, extra):
    """Validate + render one diagram. Returns (ok, message)."""
    with tempfile.NamedTemporaryFile("w", suffix=".d2", delete=False,
                                     encoding="utf-8", newline="\n") as f:
        f.write(source)
        tmp = f.name
    try:
        v = run_d2(d2, ["validate", tmp])
        if v.returncode != 0:
            return False, (v.stderr or v.stdout).strip()
        r = run_d2(d2, extra + [tmp, out_path])
        if r.returncode != 0:
            return False, (r.stderr or r.stdout).strip()
        return True, ""
    finally:
        os.unlink(tmp)


def process(md_path, args, d2):
    with open(md_path, encoding="utf-8") as f:
        lines = f.readlines()

    docbase = os.path.splitext(os.path.basename(md_path))[0]
    docdir = os.path.dirname(os.path.abspath(md_path))
    assets_dir = os.path.join(docdir, "assets")
    fences = list(parse_fences(lines))
    if not fences:
        print(f"{md_path}: no d2 fences")
        return True

    extra = []
    if args.layout:
        extra.append(f"--layout={args.layout}")
    if args.theme is not None:
        extra.append(f"--theme={args.theme}")
    if args.dark_theme is not None:
        extra.append(f"--dark-theme={args.dark_theme}")
    if args.sketch:
        extra.append("--sketch")

    ok_all = True
    inserts = {}  # line index (after fence) -> image line
    for n, (start, end, info, src) in enumerate(fences, 1):
        name = fence_name(info, docbase, n)
        rel = f"assets/{name}.{args.format}"
        out_path = os.path.join(assets_dir, f"{name}.{args.format}")
        label = f"{docbase} diagram {n}" if name == f"{docbase}-{n}" else name

        if not args.check_only:
            os.makedirs(assets_dir, exist_ok=True)
            ok, msg = render_one(d2, "".join(src), out_path, args.format, extra)
        else:
            with tempfile.NamedTemporaryFile("w", suffix=".d2", delete=False,
                                             encoding="utf-8", newline="\n") as t:
                t.write("".join(src))
                tmp = t.name
            v = run_d2(d2, ["validate", tmp])
            os.unlink(tmp)
            ok, msg = v.returncode == 0, (v.stderr or v.stdout).strip()

        if not ok:
            ok_all = False
            print(f"{md_path}: fence {n} ({name}): FAILED\n{msg}", file=sys.stderr)
            continue
        print(f"{md_path}: fence {n} -> {rel}")

        # idempotency: skip insert if an image link to this asset already follows
        nxt = end + 1
        while nxt < len(lines) and not lines[nxt].strip():
            nxt += 1
        already = nxt < len(lines) and (m := IMG_RE.match(lines[nxt].strip())) \
            and m.group(1) == rel
        if not already:
            inserts[end] = f"\n![{label}]({rel})\n"

    if args.check_only:
        return ok_all

    out_lines = []
    for i, line in enumerate(lines):
        out_lines.append(line)
        if i in inserts:
            out_lines.append(inserts[i])

    if args.in_place:
        target = md_path
    else:
        target = os.path.join(docdir, f"{docbase}.rendered.md")
    with open(target, "w", encoding="utf-8", newline="") as f:
        f.writelines(out_lines)
    print(f"wrote {target}")
    return ok_all


def main():
    p = argparse.ArgumentParser(description="Render ```d2 fences in Markdown files.")
    p.add_argument("files", nargs="+", help="Markdown files to process")
    p.add_argument("--in-place", action="store_true",
                   help="rewrite the .md files instead of writing *.rendered.md")
    p.add_argument("--check-only", action="store_true",
                   help="validate only (CI mode); no rendering, no output files")
    p.add_argument("--format", default="svg",
                   choices=["svg", "png", "pdf", "pptx", "gif", "txt"])
    p.add_argument("--layout", choices=["dagre", "elk", "tala"], default=None)
    p.add_argument("--theme", type=int, default=None)
    p.add_argument("--dark-theme", type=int, default=None)
    p.add_argument("--sketch", action="store_true")
    p.add_argument("--d2", default=None, help="path to the d2 binary")
    args = p.parse_args()

    d2 = find_d2(args.d2)
    ok = all(process(f, args, d2) for f in args.files)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
