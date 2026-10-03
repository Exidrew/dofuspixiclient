#!/usr/bin/env bash
# One-shot dev setup for Fedora (and RHEL-family) workstations.
#
# Installs everything needed to run the project locally:
#   - Docker + Docker Compose plugin (server side)
#   - Bun (client + seed scripts)
#   - CEF/Electrobun runtime libraries (only needed for the NATIVE window,
#     i.e. `bun run dev`; the browser flow `bun run hmr` does NOT need them)
#
# It does NOT install Rust/wasm-pack: the Vello WASM renderer is vendored in
# the repo (apps/electrobun/wasm/vello), so no Rust toolchain is required.
#
# Usage:
#   tools/setup/fedora-setup.sh            # install everything
#   tools/setup/fedora-setup.sh --no-cef   # skip the CEF libs (browser-only dev)
#
# Run as your normal user; the script calls sudo where needed.

set -uo pipefail

install_cef=1
for arg in "$@"; do
    case "$arg" in
        --no-cef) install_cef=0 ;;
        -h|--help)
            sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
    esac
done

if ! command -v dnf >/dev/null 2>&1; then
    echo "error: this script targets Fedora/RHEL (dnf not found)." >&2
    echo "       On other distros, install Docker, Bun and the CEF libs manually." >&2
    exit 1
fi

echo "==> Installing base packages (docker, git, tar, unzip)..."
sudo dnf install -y dnf-plugins-core git tar unzip

echo "==> Installing Docker..."
if ! command -v docker >/dev/null 2>&1; then
    # Official Docker CE repo (Fedora).
    sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl enable --now docker
else
    echo "    docker already installed — skipping."
fi

# Let the current user run docker without sudo (needs a re-login to take effect).
if ! id -nG "$USER" | grep -qw docker; then
    echo "==> Adding $USER to the 'docker' group (log out/in for this to apply)..."
    sudo usermod -aG docker "$USER"
fi

echo "==> Installing Bun..."
if ! command -v bun >/dev/null 2>&1; then
    if [ -x "$HOME/.bun/bin/bun" ]; then
        echo "    bun already present at ~/.bun/bin/bun — add it to PATH:"
        echo "      export PATH=\"\$HOME/.bun/bin:\$PATH\""
    else
        curl -fsSL https://bun.sh/install | bash
        echo "    add Bun to your shell PATH:"
        echo "      export PATH=\"\$HOME/.bun/bin:\$PATH\""
    fi
else
    echo "    bun already installed — skipping."
fi

if [ "$install_cef" -eq 1 ]; then
    echo "==> Installing CEF/Electrobun runtime libraries (native window)..."
    sudo dnf install -y \
        nss atk at-spi2-atk cups-libs libXcomposite libXdamage \
        libXrandr libgbm libxkbcommon mesa-libGL alsa-lib
else
    echo "==> Skipping CEF libs (--no-cef). The browser flow (bun run hmr) works anyway."
fi

echo
echo "==> Checking GPU / Vulkan (needed for in-game rendering)..."
if command -v vulkaninfo >/dev/null 2>&1; then
    vulkaninfo --summary 2>/dev/null | head -20 || true
else
    echo "    'vulkaninfo' not found. Install it to verify Vulkan support:"
    echo "      sudo dnf install -y vulkan-tools"
    echo "    WebGPU under Linux needs a working Vulkan driver."
fi

cat <<'EOF'

Setup done.

Next steps:
  1. Re-login (or run `newgrp docker`) so the docker group membership applies.
  2. Start the server:
       docker compose -f docker-compose.local.yml up -d --build
  3. Start the client (from apps/electrobun):
       bun install
       bun run hmr        # then open http://localhost:5173
     or `bun run dev` for the native window.

Login: admin / admin
EOF
