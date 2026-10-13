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
try { db.exec("ALTER TABLE reviews ADD COLUMN customer_id INTEGER;"); } catch (e) {}
try { db.exec("ALTER TABLE reviews ADD COLUMN order_id INTEGER;"); } catch (e) {}
try { db.exec("ALTER TABLE customers ADD COLUMN birthdate TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN categories TEXT DEFAULT '[]';"); } catch (e) {}

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
