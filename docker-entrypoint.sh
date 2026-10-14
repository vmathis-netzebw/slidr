#!/bin/sh
set -e

# Bind-Mounts gehören oft root oder einer fremden UID – vor dem Rechte-Drop korrigieren.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node "$@"
fi

exec "$@"
