#!/usr/bin/env bash
# Builds DynIs for macOS (Apple Silicon and Intel in one app) on a Mac.
# Usage, from the DynIs folder:  bash scripts/build-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script builds the Mac app and must run on a Mac." >&2
  exit 1
fi

step "Checking tools"
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Installing Xcode Command Line Tools. Click Install in the window that opens, then run this script again."
  xcode-select --install || true
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "Installing Rust (rustup)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "Installing Bun…"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
rustup target add aarch64-apple-darwin x86_64-apple-darwin

step "Installing dependencies"
bun install

step "Running tests"
bun test
(cd src-tauri && cargo test)

step "Building (this takes a few minutes the first time)"
bun run tauri build --target universal-apple-darwin --bundles app,dmg

OUT="src-tauri/target/universal-apple-darwin/release/bundle"
step "Done"
echo "App: $OUT/macos/DynIs.app"
echo "Installer: $(ls "$OUT"/dmg/*.dmg)"
echo
echo "The app isn't signed. The first time, right-click DynIs in Applications and choose Open,"
echo "or run: xattr -dr com.apple.quarantine /Applications/DynIs.app"
