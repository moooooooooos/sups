/**
 * Первое наполнение пустой базы на новом сервере: каталог из data/catalog-seed.json
 * и базовые настройки. Вызывается из server.js, если в базе нет товаров.
 * Учётная запись админа здесь НЕ создаётся — её создаёт scripts/set-admin-password.js
 * (deploy.sh спрашивает пароль при установке).
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const SEED_FILE = path.join(__dirname, '../data/catalog-seed.json');

const DEFAULT_SETTINGS = {
  telegram_notifications_enabled: '1',
  delivery_cdek_pvz: '350',
  free_delivery_threshold: '7000',
  cdek_test_mode: '1',
  cdek_sender_city_code: '250',
  yandex_delivery_test_mode: '1',
  yookassa_test_mode: '0'
};

function insertRows(table, rows) {
  if (!rows.length) return 0;
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  const stmtCache = new Map();
  let count = 0;
  for (const row of rows) {
    const cols = Object.keys(row).filter(c => columns.has(c));
    const key = cols.join(',');
    if (!stmtCache.has(key)) {
      stmtCache.set(key, db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(c => `@${c}`).join(', ')})`));
    }
    count += stmtCache.get(key).run(Object.fromEntries(cols.map(c => [c, row[c]]))).changes;
  }
  return count;
}

function seed() {
  const data = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const result = db.transaction(() => {
    const categories = insertRows('categories', data.categories || []);
    const products = insertRows('products', data.products || []);
    const setSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => setSetting.run(k, v));
    return { categories, products };
  })();
  console.log(`🌱 Seed: товаров ${result.products}, категорий ${result.categories}`);
  return result;
}

module.exports = seed;

if (require.main === module) seed();
