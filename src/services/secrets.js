/**
 * Секреты для подписи токенов входа (админка и личный кабинет).
 * Берутся из переменных окружения, а если их нет — генерируются один раз и хранятся
 * в data/.secrets.json на сервере (файл в .gitignore). Захардкоженных значений в коде нет:
 * репозиторий публичный, и известный ключ позволил бы подделать вход в админку.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '../../data/.secrets.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function getSecret(name, envName) {
  if (process.env[envName]) return process.env[envName];
  const stored = load();
  if (!stored[name]) {
    stored[name] = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });
  }
  return stored[name];
}

module.exports = { getSecret };
