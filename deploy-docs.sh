#!/usr/bin/env bash
#
# Build the Helyos docs, push the image to GHCR, and (re)deploy through Helyos.
#   → https://doc.helyos.net  (served by helyosd behind its built-in Traefik proxy + ACME)
#
# helyosd generates the proxy/TLS config from the deploy spec's `network` block; the
# image lives at ghcr.io/helyos-labs/helyos-docs. SSH alias `helyos-vps` is in
# ~/.ssh/config. The VPS must be logged in to ghcr.io (docker login) to push.
#
# Note: Helyos doesn't roll a deployment on image change alone, so we rm + redeploy
# (a few seconds of downtime) to pick up the new image.
#
# Usage:  ./deploy-docs.sh
#
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="ghcr.io/helyos-labs/helyos-docs"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)"

echo "==> Building site (npm run build)..."
npm run build

echo "==> Uploading build to the VPS..."
tar czf - -C build . | ssh helyos-vps \
  'rm -rf ~/helyos-docs/site && mkdir -p ~/helyos-docs/site \
   && tar xzf - -C ~/helyos-docs/site \
   && find ~/helyos-docs/site -name "._*" -delete'

echo "==> Building and pushing ${IMAGE}:${TAG} to GHCR..."
ssh helyos-vps "cd ~/helyos-docs \
  && docker build -t ${IMAGE}:${TAG} -t ${IMAGE}:latest . >/dev/null \
  && docker push ${IMAGE}:${TAG} >/dev/null \
  && docker push ${IMAGE}:latest >/dev/null && echo '    pushed'"

echo "==> Deploying through Helyos (pulls from GHCR)..."
ssh helyos-vps "cd ~/helyos-docs \
  && sed 's#image: .*#image: ${IMAGE}:${TAG}#' app-native.yaml > app.deploy.yaml \
  && helyos rm docs -p helyos -y >/dev/null 2>&1 || true \
  && helyos deploy app.deploy.yaml" 2>&1 | grep -iE 'deployed|✓|✗|error' || true

echo "==> Verifying..."
ssh helyos-vps 'for i in $(seq 1 20); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://doc.helyos.net/ 2>/dev/null); [ "$c" = 200 ] && break; sleep 2; done; echo "    https://doc.helyos.net -> $c"'
echo "==> Done: https://doc.helyos.net"
