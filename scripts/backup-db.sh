#!/usr/bin/env bash
# Ежедневный бэкап базы магазина и загруженных фото (запускается из cron, см. deploy.sh).
# Хранит последние 14 копий базы в /var/backups/sups и раз в неделю — архив uploads.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sups}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Онлайн-копия SQLite: безопасна, пока сайт работает
cd "$APP_DIR"
node -e "
const db = require('./src/db');
db.backup(process.argv[1]).then(() => { console.log('DB backup ok'); process.exit(0); })
  .catch(e => { console.error('DB backup failed:', e.message); process.exit(1); });
" "$BACKUP_DIR/sups-$STAMP.db"
gzip -f "$BACKUP_DIR/sups-$STAMP.db"

# Фото, загруженные через админку, — раз в неделю (по воскресеньям)
if [ "$(date +%u)" = "7" ] && [ -d "$APP_DIR/public/uploads" ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$APP_DIR/public" uploads
fi

# Старые копии удаляем
prune() { # оставить $2 самых новых файлов по маске $1
  { ls -1t "$BACKUP_DIR"/$1 2>/dev/null || true; } | tail -n +$(($2 + 1)) | while read -r f; do rm -f "$f"; done
}
prune "sups-*.db.gz" 14
prune "uploads-*.tar.gz" 4
