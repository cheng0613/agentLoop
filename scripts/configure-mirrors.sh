#!/usr/bin/env bash
# Write the build-time package mirrors this checkout should use into .env, so
# `./start.sh dev` and plain `docker build` pick them up without extra flags.
#
# Releases are built against the upstream registries. This script exists for
# networks where those are slow or unreachable; it writes nothing unless asked.
#
# Usage:
#   bash scripts/configure-mirrors.sh              # detect and configure (cn preset)
#   bash scripts/configure-mirrors.sh --preset cn  # Debian + npm + Go inside China
#   bash scripts/configure-mirrors.sh --preset none
#   bash scripts/configure-mirrors.sh --show
set -euo pipefail
cd "$(dirname "$0")/.."

preset="cn"
case "${1:---detect}" in
  --preset) preset="${2:-cn}" ;;
  --show) preset="show" ;;
  --detect|"") preset="cn" ;;
  -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

case "$preset" in
  cn)
    APT="mirrors.aliyun.com"
    NPM="https://registry.npmmirror.com"
    GO="https://goproxy.cn,direct"
    ;;
  none)
    APT=""; NPM=""; GO=""
    ;;
  show)
    if [[ -f .env ]]; then
      grep -E '^(LOOPFORGE_APT_MIRROR|NPM_REGISTRY|GOPROXY)=' .env || echo '(no mirrors configured)'
    else
      echo '(no .env yet)'
    fi
    exit 0
    ;;
  *) echo "unknown preset: $preset (use cn or none)" >&2; exit 2 ;;
esac

touch .env
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  elif [[ -n "$value" ]]; then
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
set_env LOOPFORGE_APT_MIRROR "$APT"
set_env NPM_REGISTRY "$NPM"
set_env GOPROXY "$GO"

printf 'Wrote build mirrors to .env:\n'
printf '  LOOPFORGE_APT_MIRROR=%s\n' "${APT:-(upstream)}"
printf '  NPM_REGISTRY=%s\n' "${NPM:-(upstream)}"
printf '  GOPROXY=%s\n' "${GO:-(upstream)}"
printf '\nBuild with:\n'
printf '  docker build --build-arg APT_MIRROR="$LOOPFORGE_APT_MIRROR" --build-arg NPM_REGISTRY="$NPM_REGISTRY" --build-arg GOPROXY="$GOPROXY" -t agentloop-platform:local .\n'
printf 'or run ./start.sh dev, which reads these from .env.\n'
