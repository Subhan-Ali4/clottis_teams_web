#!/usr/bin/env bash
set -Eeuo pipefail
IMAGE="${1:?Pass the Docker image tag}"
NAME=clottis-teams-web
PORT=3002
OLD_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$NAME" 2>/dev/null || true)"
docker image inspect "$IMAGE" >/dev/null
docker rm -f "${NAME}-candidate" >/dev/null 2>&1 || true
docker run -d --name "${NAME}-candidate" -p 127.0.0.1:13002:3000 "$IMAGE" >/dev/null
trap 'docker rm -f "${NAME}-candidate" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:13002/api/health >/dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:13002/api/health >/dev/null
docker rm -f "${NAME}-candidate" >/dev/null
trap - EXIT
docker stop "$NAME"
docker rm "$NAME"
docker run -d --name "$NAME" --restart unless-stopped -p 127.0.0.1:${PORT}:3000 "$IMAGE"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:${PORT}/api/health >/dev/null; then exit 0; fi
  sleep 2
done
if [[ -n "$OLD_IMAGE" ]]; then
  docker rm -f "$NAME"
  docker run -d --name "$NAME" --restart unless-stopped -p 127.0.0.1:${PORT}:3000 "$OLD_IMAGE"
fi
exit 1
