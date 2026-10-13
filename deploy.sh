#!/usr/bin/env bash
# ==============================================================================
# 🚀 SUPS Jewelry Store — Автоматический скрипт установки на VPS (Ubuntu 22.04/24.04)
# Поддерживает: Timeweb Cloud, Beget, Reg.ru, Selectel и любые Linux VPS
# ==============================================================================

set -e

echo ""
echo "====================================================================="
echo "💎 САПС (SUPS) — Автоматическое развёртывание магазина на сервере"
echo "====================================================================="
echo ""

# Проверка root прав
if [ "$EUID" -ne 0 ]; then
  echo "❌ Пожалуйста, запустите скрипт от имени root (sudo bash deploy.sh)"
  exit 1
fi

APP_DIR=$(pwd)
echo "📁 Рабочая директория: $APP_DIR"

# 1. Обновление пакетов системы
echo ""
echo "📦 1/7 Обновление системных пакетов Ubuntu..."
apt-get update -y
apt-get install -y curl wget git build-essential ufw nginx certbot python3-certbot-nginx

# 2. Установка Node.js 20 LTS
echo ""
echo "⚙️ 2/7 Проверка и установка Node.js 20 LTS..."
if ! command -v node &> /dev/null || [[ $(node -v) != v20* && $(node -v) != v22* ]]; then
  echo "Устанавливаем Node.js 20 LTS через NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "✅ Node.js: $(node -v), npm: $(npm -v)"

# 3. Установка PM2 (менеджер процессов для автоперезапуска)
echo ""
echo "⚙️ 3/7 Установка PM2..."
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
fi
echo "✅ PM2 установлен"

# 4. Установка зависимостей проекта
echo ""
echo "📦 4/7 Установка зависимостей npm..."
cd "$APP_DIR"
npm install --production

# 5. Инициализация базы данных и каталога
echo ""
echo "📦 5/7 Проверка базы данных и сидов..."
node -e '
const db = require("./src/db");
const count = db.prepare("SELECT count(*) as c FROM products").get().c;
console.log("Товаров в базе:", count);
if (count === 0) {
  require("./scripts/seed")();
}
'

# 6. Запуск приложения через PM2
echo ""
echo "🚀 6/7 Запуск Node.js сервера через PM2..."
pm2 stop sups-store 2>/dev/null || true
pm2 delete sups-store 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root || true

# 7. Настройка Nginx и Фаервола
echo ""
echo "🌐 7/7 Настройка Nginx и Firewall (UFW)..."

# Разрешаем порты SSH, HTTP, HTTPS
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

# Запрос домена
read -p "Введите ваш домен (например, sups-official.ru или оставьте пустым для входа по IP): " DOMAIN_NAME

if [ -z "$DOMAIN_NAME" ]; then
  DOMAIN_NAME="_"
  echo "⚠️ Домен не указан. Сайт будет доступен напрямую по IP-адресу сервера."
fi

NGINX_CONF="/etc/nginx/sites-available/sups-store"

cat > "$NGINX_CONF" << EOF
server {
    listen 80;
    server_name $DOMAIN_NAME;

    client_max_body_size 30M;

    # Сжатие gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    location /uploads/ {
        alias $APP_DIR/public/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Активация конфигурации Nginx
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl restart nginx

# Выпуск бесплатного SSL сертификата, если указан домен
if [ "$DOMAIN_NAME" != "_" ]; then
  echo ""
  echo "🔒 Выпуск бесплатного SSL-сертификата (HTTPS) от Let's Encrypt..."
  read -p "Введите ваш email для сертификата Let's Encrypt: " SSL_EMAIL
  if [ -n "$SSL_EMAIL" ]; then
    certbot --nginx -d "$DOMAIN_NAME" --non-interactive --agree-tos -m "$SSL_EMAIL" --redirect || echo "⚠️ Не удалось выпустить SSL. Убедитесь, что DNS А-запись домена указывает на IP этого сервера."
  fi
fi

SERVER_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')

echo ""
echo "====================================================================="
echo "🎉 САЙТ САПС УСПЕШНО РАЗВЕРНУТ И ЗАПУЩЕН!"
echo "====================================================================="
if [ "$DOMAIN_NAME" != "_" ]; then
  echo "🌐 Адрес сайта: https://$DOMAIN_NAME (или http://$DOMAIN_NAME)"
  echo "⚙️  Админ-панель: https://$DOMAIN_NAME/admin"
else
  echo "🌐 Адрес сайта по IP: http://$SERVER_IP"
  echo "⚙️  Админ-панель: http://$SERVER_IP/admin"
fi
echo "🔑 Логин админа: admin  |  Пароль: admin123"
echo "💳 Настройки ЮKassa: вкладка «Настройки» в админ-панели"
echo "====================================================================="
echo ""
