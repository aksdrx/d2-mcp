#!/bin/sh
# Cross-platform d2 installer: Linux, macOS, WSL.
# Installs user-local (no sudo) whenever possible.
#
# Usage:
#   sh install.sh            # install
#   sh install.sh --dry-run  # show what would happen
set -eu

log() { printf '%s\n' "$*"; }

if command -v d2 >/dev/null 2>&1; then
  log "d2 already installed: $(command -v d2) ($(d2 version 2>/dev/null || true))"
  exit 0
fi

# 1) Prefer the official installer — it detects package managers
#    (brew/apt/dnf/pacman/nix…) and installs appropriately.
if command -v curl >/dev/null 2>&1; then
  log "Trying official install script (https://d2lang.com/install.sh) ..."
  if curl -fsSL --max-time 60 https://d2lang.com/install.sh | sh -s -- ${1:-}; then
    command -v d2 >/dev/null 2>&1 && { log "Installed: $(d2 version)"; exit 0; }
  fi
  log "Official script unavailable or incomplete; falling back to release tarball."
fi

# 2) Fallback: precompiled tarball from GitHub releases into ~/.local/bin
OS=$(uname -s | tr '[:upper:]' '[:lower:]')   # linux | darwin
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) log "Unsupported arch: $ARCH"; exit 1 ;;
esac

# WSL reports as linux — tarball works identically there.
TAG=$(curl -fsSL --max-time 30 https://api.github.com/repos/d2lang/d2/releases/latest \
      | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[ -n "$TAG" ] || { log "Could not determine latest d2 release tag."; exit 1; }

DEST="$HOME/.local/bin"
mkdir -p "$DEST"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

URL="https://github.com/d2lang/d2/releases/download/${TAG}/d2-${TAG}-${OS}-${ARCH}.tar.gz"
log "Downloading $URL"
curl -fsSL --max-time 300 -o "$TMP/d2.tar.gz" "$URL"
tar -xzf "$TMP/d2.tar.gz" -C "$TMP"
cp "$TMP/d2-${TAG}/bin/d2" "$DEST/d2"
chmod +x "$DEST/d2"

if ! command -v d2 >/dev/null 2>&1; then
  log "NOTE: add $DEST to your PATH, e.g.:"
  log "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.profile"
fi
log "Installed $("$DEST/d2" version) to $DEST/d2"
