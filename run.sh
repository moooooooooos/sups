#!/usr/bin/env bash
set -e

echo "🚀 Запуск автоматической установки САПС на сервере..."

# Настройка SSH для работы из терминала Mac
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null || true
if [ -d /etc/ssh/sshd_config.d ]; then
  sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config.d/* 2>/dev/null || true
fi
systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true

# Установка git и клонирование
apt-get update -y
apt-get install -y git curl

rm -rf /var/www/sups-store
git clone https://github.com/moooooooooos/sups.git /var/www/sups-store
cd /var/www/sups-store
bash deploy.sh
