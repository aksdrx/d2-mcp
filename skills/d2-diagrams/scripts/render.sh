#!/bin/sh
# render.sh — the D2 authoring loop in one command: fmt + validate + render.
#
# Usage:
#   sh render.sh diagram.d2 [out.svg] [--watch] [--layout=elk] [any d2 flags...]
#
# Examples:
#   sh render.sh arch.d2                 # -> arch.svg (flags from vars.d2-config apply)
#   sh render.sh arch.d2 out.png --layout=tala --theme=101
#   sh render.sh arch.d2 --watch         # live reload in browser
set -eu

if [ $# -lt 1 ]; then
  echo "usage: sh render.sh diagram.d2 [output] [--watch] [d2 flags...]" >&2
  exit 2
fi

IN=$1; shift

OUT=""
WATCH=0
EXTRA=""
for a in "$@"; do
  case "$a" in
    -w|--watch) WATCH=1 ;;
    *.svg|*.png|*.pdf|*.pptx|*.gif|*.txt)
      if [ -z "$OUT" ]; then OUT=$a; else EXTRA="$EXTRA $a"; fi ;;
    *) EXTRA="$EXTRA $a" ;;
  esac
done
[ -n "$OUT" ] || OUT="${IN%.d2}.svg"

command -v d2 >/dev/null 2>&1 || { echo "d2 not found on PATH — run install.sh first" >&2; exit 1; }

d2 fmt "$IN" >/dev/null
d2 validate "$IN"

# shellcheck disable=SC2086
if [ "$WATCH" = 1 ]; then
  exec d2 -w $EXTRA "$IN" "$OUT"
else
  # shellcheck disable=SC2086
  d2 $EXTRA "$IN" "$OUT"
  echo "rendered: $OUT"
fi
