#!/usr/bin/env bash
#
# Build the Helyos docs and (re)deploy them THROUGH Helyos on the VPS → https://doc.helyos.net
#
# helyosd runs the docs as a container and generates the Traefik config (with automatic
# Let's Encrypt TLS) from the deploy spec's `network` block — no manual proxy config.
# A fresh image tag per deploy makes Helyos roll the deployment. SSH alias `helyos-vps`
# is in ~/.ssh/config.
#
# Usage:  ./deploy-docs.sh
#
set -euo pipefail
cd "$(dirname "$0")"

TAG="helyos-docs:$(git rev-parse --short HEAD 2>/dev/null || date +%s)"

echo "==> Building site (npm run build)..."
npm run build

echo "==> Uploading build to the VPS..."
tar czf - -C build . | ssh helyos-vps \
  'rm -rf ~/helyos-docs/site && mkdir -p ~/helyos-docs/site \
   && tar xzf - -C ~/helyos-docs/site \
   && find ~/helyos-docs/site -name "._*" -delete'

echo "==> Building image $TAG and deploying through Helyos..."
ssh helyos-vps "cd ~/helyos-docs && docker build -t $TAG . >/dev/null \
  && sed 's#image: .*#image: $TAG#' app-native.yaml > app.deploy.yaml \
  && helyos deploy app.deploy.yaml" 2>&1 | grep -iE 'deployed|running|✓|✗|error' || true

echo "==> Verifying..."
ssh helyos-vps 'for i in $(seq 1 20); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://doc.helyos.net/ 2>/dev/null); [ "$c" = 200 ] && break; sleep 2; done; echo "    https://doc.helyos.net -> $c"'
echo "==> Done."
