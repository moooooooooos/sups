#!/usr/bin/env bash
# ==============================================================================
# САПС — установка и обновление магазина на VPS (Ubuntu 22.04/24.04, Beget и др.)
# Первый запуск: ставит Node.js, PM2, nginx, SSL, спрашивает домен и пароль админа.
# Повторный запуск: обновляет зависимости и перезапускает сайт; база, фото и настройки
# (data/, public/uploads/) не трогаются.
# ==============================================================================
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "❌ Запустите от root: sudo bash deploy.sh"
  exit 1
fi

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_CONF="$APP_DIR/data/.deploy.json"
cd "$APP_DIR"
mkdir -p "$APP_DIR/data" "$APP_DIR/public/uploads"

echo ""
echo "💎 САПС — развёртывание магазина ($APP_DIR)"
echo ""

# 1. Системные пакеты
echo "📦 1/8 Системные пакеты..."
apt-get update -y
apt-get install -y curl git build-essential ufw nginx certbot python3-certbot-nginx

# 2. Node.js 20 LTS
echo "⚙️  2/8 Node.js..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* && "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "   Node.js $(node -v)"

# 3. PM2 и ротация логов
echo "⚙️  3/8 PM2..."
command -v pm2 >/dev/null 2>&1 || npm install -g pm2
pm2 install pm2-logrotate >/dev/null 2>&1 || true

# 4. Зависимости
echo "📦 4/8 Зависимости npm..."
npm ci --omit=dev

# Проверка новой версии на временной базе: если что-то сломано, сайт не перезапускаем
echo "🧪 Проверка сайта..."
if ! node scripts/smoke-test.js; then
  echo "❌ Проверка не пройдена — работающая версия сайта не тронута. Подробности выше."
  exit 1
fi

# 5. Домен (спрашиваем один раз и запоминаем)
echo "🌐 5/8 Домен..."
DOMAIN_NAME=""
if [ -f "$DEPLOY_CONF" ]; then
  DOMAIN_NAME="$(node -e "console.log(require('$DEPLOY_CONF').domain || '')")"
fi
if [ -z "$DOMAIN_NAME" ]; then
  read -r -p "Домен сайта без www (например, sups-official.ru; пусто — вход по IP): " DOMAIN_NAME
  DOMAIN_NAME="${DOMAIN_NAME#www.}"
  SITE_URL=""
  [ -n "$DOMAIN_NAME" ] && SITE_URL="https://$DOMAIN_NAME"
  node -e "require('fs').writeFileSync('$DEPLOY_CONF', JSON.stringify({ domain: process.argv[1], siteUrl: process.argv[2] }, null, 2))" "$DOMAIN_NAME" "$SITE_URL"
  chmod 600 "$DEPLOY_CONF"
fi
echo "   Домен: ${DOMAIN_NAME:-не указан (по IP)}"

# 6. База: при первом запуске — каталог и администратор
echo "🗄  6/8 База данных..."
node -e '
const db = require("./src/db");
if (db.prepare("SELECT count(*) AS c FROM products").get().c === 0) require("./scripts/seed")();
console.log("   Товаров в базе:", db.prepare("SELECT count(*) AS c FROM products").get().c);
'
ADMINS="$(node -e 'console.log(require("./src/db").prepare("SELECT count(*) AS c FROM admin_users").get().c)')"
if [ "$ADMINS" = "0" ]; then
  echo "   Создаём администратора сайта (пароль не короче 10 символов)."
  node scripts/set-admin-password.js
fi
chmod 600 "$APP_DIR"/data/*.db* 2>/dev/null || true

# 7. Запуск через PM2 (автоперезапуск при сбое и после перезагрузки сервера)
echo "🚀 7/8 Запуск сайта..."
if pm2 describe sups-store >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# Ежедневный бэкап в 04:30 (хранятся 14 последних копий в /var/backups/sups)
chmod +x scripts/backup-db.sh
CRON_LINE="30 4 * * * $APP_DIR/scripts/backup-db.sh >> /var/log/sups-backup.log 2>&1"
# На новом сервере crontab пуст: crontab -l и grep завершаются с ошибкой, поэтому || true
{ crontab -l 2>/dev/null | grep -v 'scripts/backup-db.sh' || true; echo "$CRON_LINE"; } | crontab -

# 8. nginx, фаервол, SSL
echo "🌐 8/8 nginx и SSL..."
ufw allow 22/tcp >/dev/null || true
ufw allow 80/tcp >/dev/null || true
ufw allow 443/tcp >/dev/null || true
ufw --force enable >/dev/null || true

SERVER_NAMES="_"
[ -n "$DOMAIN_NAME" ] && SERVER_NAMES="$DOMAIN_NAME www.$DOMAIN_NAME"
NGINX_CONF="/etc/nginx/sites-available/sups-store"

# Конфиг пишем только при первой установке: certbot потом дописывает в него SSL
if [ ! -f "$NGINX_CONF" ]; then
  cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name $SERVER_NAMES;

    client_max_body_size 30M;
    server_tokens off;

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # www → без www, одна версия сайта для поисковиков
    if (\$host = www.$DOMAIN_NAME) {
        return 301 \$scheme://$DOMAIN_NAME\$request_uri;
    }

    # Фото товаров из админки — отдаёт nginx, кэш на месяц
    location /uploads/ {
        alias $APP_DIR/public/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl reload nginx || systemctl restart nginx

if [ -n "$DOMAIN_NAME" ] && [ ! -d "/etc/letsencrypt/live/$DOMAIN_NAME" ]; then
  read -r -p "Email для SSL-сертификата Let's Encrypt (пусто — пропустить): " SSL_EMAIL
  if [ -n "$SSL_EMAIL" ]; then
    certbot --nginx -d "$DOMAIN_NAME" -d "www.$DOMAIN_NAME" --non-interactive --agree-tos -m "$SSL_EMAIL" --redirect \
      || echo "⚠️  SSL не выпущен: проверьте, что A-записи $DOMAIN_NAME и www.$DOMAIN_NAME указывают на этот сервер, и запустите deploy.sh ещё раз."
  fi
fi

# Быстрая проверка, что сайт отвечает
sleep 2
if curl -fsS -o /dev/null "http://127.0.0.1:3000/api/products?limit=1"; then
  echo "✅ Сайт отвечает"
else
  echo "⚠️  Сайт не отвечает — смотрите логи: pm2 logs sups-store"
fi

echo ""
echo "====================================================================="
if [ -n "$DOMAIN_NAME" ]; then
  echo "🌐 Сайт:    https://$DOMAIN_NAME"
  echo "⚙️  Админка: https://$DOMAIN_NAME/admin"
else
  echo "🌐 Сайт:    http://$(hostname -I | awk '{print $1}')"
fi
echo "🔑 Сменить пароль админа: node scripts/set-admin-password.js"
echo "💳 Ключи ЮKassa, СДЭК и почты: админка → «Настройки»"
echo "💾 Бэкапы базы: /var/backups/sups (каждый день в 04:30)"
echo "====================================================================="
