#!/usr/bin/env bash
# Установка или обновление САПС на чистом VPS одной командой (запускать от root).
# Повторный запуск безопасен: код обновляется, база заказов, фото и настройки остаются.
set -euo pipefail

APP_DIR=/var/www/sups-store
REPO=https://github.com/moooooooooos/sups.git
BRANCH="${BRANCH:-main}"

echo "🚀 Установка САПС на сервер..."
apt-get update -y
apt-get install -y git curl

if [ -d "$APP_DIR/.git" ]; then
  echo "📦 Сайт уже установлен — обновляем код, данные не трогаем"
  # Копия базы до обновления (в старых версиях data/sups.db лежал в git и мог быть удалён при pull)
  SAFE="/var/backups/sups/pre-update-$(date +%Y-%m-%d_%H%M)"
  mkdir -p "$SAFE"
  cp -a "$APP_DIR"/data/sups.db* "$SAFE"/ 2>/dev/null || true
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  if [ ! -f "$APP_DIR/data/sups.db" ] && [ -f "$SAFE/sups.db" ]; then
    cp -a "$SAFE"/sups.db* "$APP_DIR/data/"
    echo "♻️  База восстановлена из копии $SAFE"
  fi
else
  git clone -b "$BRANCH" "$REPO" "$APP_DIR"
fi

cd "$APP_DIR"
bash deploy.sh
