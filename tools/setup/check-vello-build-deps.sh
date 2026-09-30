#!/usr/bin/env bash
# Build prerequisites for the shared Vello WASM renderer (`just wasm`).
#
# `wasm-pack build` compiles a cdylib whose build scripts go through the host
# toolchain, so a Rust target + a C linker are both required. Missing either
# one fails the build with messages that don't name the prerequisite
# explicitly (`linker \`cc\` not found`, `wasm32-unknown-unknown` target
# missing), which makes `just setup` fail halfway through.
#
# This helper only *reports* what is missing and how to install it; it never
# installs anything itself, so CI and devs stay in control.
#
# Usage:  tools/setup/check-vello-build-deps.sh
# Exit:   0 when every prerequisite is present, 1 otherwise.

set -uo pipefail

missing=()

# wasm-pack itself.
if ! command -v wasm-pack >/dev/null 2>&1; then
    missing+=("wasm-pack — WASM bundler, not found on PATH.")
fi

# Rust toolchain.
if ! command -v cargo >/dev/null 2>&1; then
    missing+=("cargo — Rust toolchain not found on PATH (looked for the rustup install at \$HOME/.cargo/bin).")
fi

# The wasm32 target — `cargo build --target wasm32-unknown-unknown` needs it.
if command -v rustup >/dev/null 2>&1; then
    if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
        missing+=("rust target wasm32-unknown-unknown — install it with: rustup target add wasm32-unknown-unknown")
    fi
elif command -v cargo >/dev/null 2>&1; then
    # No rustup: only reachable if the target ships with the toolchain.
    :
fi

# Host C linker — rayon-core/crossbeam/proc-macro2 build scripts link with `cc`.
if ! command -v cc >/dev/null 2>&1; then
    missing+=("C linker \`cc\` — build scripts fail with 'linker \`cc\` not found'. Install a C toolchain (Debian/Ubuntu: apt install build-essential).")
fi

if [ "${#missing[@]}" -eq 0 ]; then
    echo "Vello WASM build prerequisites: OK (wasm-pack, cargo, wasm32-unknown-unknown, cc)"
    exit 0
fi

echo "Vello WASM build prerequisites: MISSING ${#missing[@]} item(s)" >&2
for item in "${missing[@]}"; do
    echo "  - ${item}" >&2
done
echo "" >&2
echo "Install the Rust toolchain + wasm target + wasm-pack with:" >&2
echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --target wasm32-unknown-unknown" >&2
echo "  curl -sSfL https://github.com/rustwasm/wasm-pack/releases/latest/download/wasm-pack-\$(uname -m)-unknown-linux-musl.tar.gz | tar xz" >&2
echo "  # then put wasm-pack on PATH (e.g. mv wasm-pack-*/wasm-pack ~/.cargo/bin/)" >&2
echo "" >&2
echo "Re-run this check afterwards: tools/setup/check-vello-build-deps.sh" >&2
exit 1
