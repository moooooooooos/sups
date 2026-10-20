const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'sups.db');
const db = new Database(DB_PATH);

// Enable WAL mode for performance
db.pragma('journal_mode = WAL');

// Custom SQLite function for full Unicode/Cyrillic lowercase support
db.function('lower_utf8', (str) => (str ? String(str).toLowerCase() : ''));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid BIGINT UNIQUE,
    title TEXT NOT NULL,
    sku TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    collections TEXT DEFAULT '[]',
    price REAL NOT NULL,
    price_old REAL,
    description TEXT,
    characteristics TEXT DEFAULT '[]',
    images TEXT DEFAULT '[]',
    sizes TEXT DEFAULT '[]',
    in_stock INTEGER DEFAULT 1,
    is_bestseller INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    delivery_method TEXT,
    delivery_address TEXT,
    comment TEXT,
    items TEXT NOT NULL,
    subtotal REAL NOT NULL,
    delivery_price REAL DEFAULT 0,
    bonus_used INTEGER DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    promo_code TEXT,
    total_price REAL NOT NULL,
    status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    birthdate TEXT,
    password_hash TEXT NOT NULL,
    bonus_points INTEGER DEFAULT 100,
    personal_discount INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    order_id INTEGER,
    product_id INTEGER,
    author_name TEXT NOT NULL,
    city TEXT,
    rating INTEGER DEFAULT 5,
    text TEXT NOT NULL,
    photos TEXT DEFAULT '[]',
    status TEXT DEFAULT 'approved',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    discount_percent INTEGER NOT NULL DEFAULT 10,
    max_uses INTEGER DEFAULT 100,
    current_uses INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Safe migrations for existing DB
try { db.exec("ALTER TABLE orders ADD COLUMN customer_id INTEGER;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN bonus_used INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN promo_code TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'yookassa';"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN payment_id TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'pending';"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN paid_at TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN color_variants TEXT DEFAULT '[]';"); } catch (e) {}
try { db.exec("ALTER TABLE reviews ADD COLUMN customer_id INTEGER;"); } catch (e) {}
try { db.exec("ALTER TABLE reviews ADD COLUMN order_id INTEGER;"); } catch (e) {}
try { db.exec("ALTER TABLE customers ADD COLUMN birthdate TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN categories TEXT DEFAULT '[]';"); } catch (e) {}
// Когда получено согласие на обработку ПД (и на распространение — для отзывов), 152-ФЗ
try { db.exec("ALTER TABLE orders ADD COLUMN pd_consent_at TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE customers ADD COLUMN pd_consent_at TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE reviews ADD COLUMN pd_consent_at TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE reviews ADD COLUMN publish_consent_at TEXT;"); } catch (e) {}
// Устройство, с которого оформлен заказ (mobile / tablet / desktop)
try { db.exec("ALTER TABLE orders ADD COLUMN device TEXT;"); } catch (e) {}
// Доставка, проверенная у перевозчика: cdek / yandex, pvz / courier, код ПВЗ, код города СДЭК
try { db.exec("ALTER TABLE orders ADD COLUMN delivery_provider TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN delivery_type TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN delivery_point_id TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN delivery_city_code INTEGER;"); } catch (e) {}

// Отправление у перевозчика: uuid заказа в СДЭК, трек-номер, последний статус перевозчика
try { db.exec("ALTER TABLE orders ADD COLUMN shipment_uuid TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN tracking_number TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN shipment_status TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN shipment_synced_at TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN shipment_error TEXT;"); } catch (e) {}

// История статусов заказа пишется триггерами — при любом изменении статуса (оплата, админка, СДЭК)
db.exec(`
  CREATE TABLE IF NOT EXISTS order_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_order_status_history ON order_status_history(order_id, id);

  CREATE TRIGGER IF NOT EXISTS trg_order_status_insert AFTER INSERT ON orders
  BEGIN
    INSERT INTO order_status_history (order_id, status) VALUES (NEW.id, COALESCE(NEW.status, 'new'));
  END;

  CREATE TRIGGER IF NOT EXISTS trg_order_status_update AFTER UPDATE OF status ON orders
  WHEN OLD.status IS NOT NEW.status
  BEGIN
    INSERT INTO order_status_history (order_id, status) VALUES (NEW.id, NEW.status);
  END;

  -- Заказы, созданные до появления истории: текущий статус на дату создания
  INSERT INTO order_status_history (order_id, status, created_at)
  SELECT o.id, COALESCE(o.status, 'new'), o.created_at FROM orders o
  WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id);
`);

// «Может понравиться»: id товаров, выбранных вручную в админке (JSON-массив)
try { db.exec("ALTER TABLE products ADD COLUMN related_ids TEXT DEFAULT '[]';"); } catch (e) {}

// Корзина удалённых товаров: строка товара целиком, восстановление с тем же id
db.exec(`
  CREATE TABLE IF NOT EXISTS products_trash (
    id INTEGER PRIMARY KEY,
    title TEXT,
    data TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Собственная анонимная веб-аналитика: визиты и события (без IP и без привязки к покупателю)
db.exec(`
  CREATE TABLE IF NOT EXISTS analytics_sessions (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    pageviews INTEGER NOT NULL DEFAULT 0,
    device TEXT,
    source TEXT,
    landing_path TEXT
  );

  CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    path TEXT,
    product_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_an_sessions_started ON analytics_sessions(started_at);
  CREATE INDEX IF NOT EXISTS idx_an_events_created ON analytics_events(created_at, type);
`);

// Safe indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
  CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id);
`);

// Safe indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  CREATE INDEX IF NOT EXISTS idx_products_categories ON products(categories);
  CREATE INDEX IF NOT EXISTS idx_products_instock ON products(in_stock);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
  CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(user_code);
  CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
  CREATE INDEX IF NOT EXISTS idx_promo_code ON promo_codes(code);
`);

// Seed default promo codes
try {
  const count = db.prepare('SELECT COUNT(*) as c FROM promo_codes').get().c;
  if (count === 0) {
    db.prepare("INSERT INTO promo_codes (code, discount_percent, max_uses, is_active) VALUES ('SUPS10', 10, 500, 1)").run();
    db.prepare("INSERT INTO promo_codes (code, discount_percent, max_uses, is_active) VALUES ('STEEL15', 15, 200, 1)").run();
    db.prepare("INSERT INTO promo_codes (code, discount_percent, max_uses, is_active) VALUES ('VIP20', 20, 50, 1)").run();
  }
} catch (e) {}

module.exports = db;
