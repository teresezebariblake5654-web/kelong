#!/usr/bin/env bash
# Daily PostgreSQL backup for workstation-api.
#
# Usage:
#   DATABASE_URL='postgresql://user@127.0.0.1:5432/db' ./scripts/pg-backup.sh
#   # or export PGPASSWORD / use ~/.pgpass — never hardcode passwords in this file.
#
# Cron example (02:15 daily):
#   15 2 * * * cd /opt/workstation-backend && ./scripts/pg-backup.sh >> logs/pg-backup.log 2>&1
#
# Optional remote upload hook:
#   BACKUP_UPLOAD_CMD='rclone copy "$1" remote:workstation-pg/' ./scripts/pg-backup.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/workstation-$STAMP.sql.gz"
LOG_PREFIX="[pg-backup $(date -Iseconds)]"

mkdir -p "$BACKUP_DIR" "$ROOT_DIR/logs"

log() {
  echo "$LOG_PREFIX $*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

if ! command -v pg_dump >/dev/null 2>&1; then
  fail "pg_dump not found in PATH"
fi

if [[ -z "${DATABASE_URL:-}" && -z "${PGDATABASE:-}" ]]; then
  fail "Set DATABASE_URL or standard libpq env (PGHOST/PGDATABASE/PGUSER). Do not put passwords in this script."
fi

log "starting backup -> $OUT_FILE"

if [[ -n "${DATABASE_URL:-}" ]]; then
  # Prefer connection URI; password should come from the URI userinfo, PGPASSWORD, or .pgpass.
  pg_dump --no-owner --format=plain "$DATABASE_URL" | gzip -c >"$OUT_FILE"
else
  pg_dump --no-owner --format=plain | gzip -c >"$OUT_FILE"
fi

[[ -s "$OUT_FILE" ]] || fail "backup file is empty: $OUT_FILE"
log "backup ok ($(du -h "$OUT_FILE" | awk '{print $1}'))"

# Retention: keep last N days locally.
find "$BACKUP_DIR" -type f -name 'workstation-*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete \
  | while read -r removed; do log "removed expired $removed"; done || true

# Optional off-box upload. BACKUP_UPLOAD_CMD receives the file path as $1.
if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then
  log "running BACKUP_UPLOAD_CMD"
  # shellcheck disable=SC2086
  eval "$BACKUP_UPLOAD_CMD" "$OUT_FILE" || fail "BACKUP_UPLOAD_CMD failed"
  log "upload ok"
else
  log "BACKUP_UPLOAD_CMD unset; skipped remote upload"
fi

log "done"
exit 0
