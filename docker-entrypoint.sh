#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Zero-config startup: a fresh clone has no .env, so if APP_SECRET is unset we
# generate one and persist it on the shared `secrets` volume. That keeps the
# key identical for web, worker and every restart (tokens stay decryptable).
#
# Set APP_SECRET explicitly (env/.env) to bring your own key; it always wins.
# ─────────────────────────────────────────────────────────────────────────────
set -e

SECRET_DIR="${SECRET_DIR:-/data/secret}"
SECRET_FILE="$SECRET_DIR/app_secret"

if [ -z "${APP_SECRET:-}" ]; then
  if [ ! -s "$SECRET_FILE" ]; then
    mkdir -p "$SECRET_DIR" 2>/dev/null || true
    tmp="$SECRET_DIR/.app_secret.$$"
    if node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' >"$tmp" 2>/dev/null; then
      chmod 600 "$tmp" 2>/dev/null || true
      # `ln` is atomic: when web, worker and migrate boot together exactly one
      # of them wins and the others read that same key.
      ln "$tmp" "$SECRET_FILE" 2>/dev/null || true
    fi
    rm -f "$tmp"
    [ -s "$SECRET_FILE" ] && echo "[entrypoint] generated APP_SECRET at $SECRET_FILE — back up the secrets volume" >&2
  fi

  # Wait briefly for a sibling container that won the race to finish writing.
  i=0
  while [ ! -s "$SECRET_FILE" ] && [ "$i" -lt 50 ]; do
    sleep 0.1
    i=$((i + 1))
  done

  if [ -s "$SECRET_FILE" ]; then
    APP_SECRET="$(cat "$SECRET_FILE")"
  else
    echo "[entrypoint] WARNING: could not persist APP_SECRET; connected accounts will need reconnecting after a restart" >&2
  fi
  export APP_SECRET
fi

exec "$@"
