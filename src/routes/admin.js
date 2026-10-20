const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('./auth');
const upload = require('../services/uploader');
const orderStatus = require('../services/orderStatus');
const cdekShipments = require('../services/cdekShipments');
const customerEmails = require('../services/customerEmails');

// Статусы отправлений СДЭК подтягиваются в фоне раз в 30 минут
cdekShipments.startAutoSync();
// Письма покупателям о статусах заказа — фоновая очередь раз в минуту
customerEmails.startWorker();

// Protect all admin endpoints
router.use(requireAdmin);

function parseProduct(p) {
  if (!p) return null;
  return {
    ...p,
    collections: typeof p.collections === 'string' ? JSON.parse(p.collections || '[]') : p.collections,
    images: typeof p.images === 'string' ? JSON.parse(p.images || '[]') : p.images,
    sizes: typeof p.sizes === 'string' ? JSON.parse(p.sizes || '[]') : p.sizes,
    color_variants: typeof p.color_variants === 'string' ? JSON.parse(p.color_variants || '[]') : (p.color_variants || []),
    related_ids: typeof p.related_ids === 'string' ? JSON.parse(p.related_ids || '[]') : (p.related_ids || []),
    characteristics: typeof p.characteristics === 'string' ? JSON.parse(p.characteristics || '[]') : p.characteristics
  };
}

// GET /api/admin/stats - Dashboard metrics
router.get('/stats', (req, res) => {
  try {
    const totalProducts = db.prepare('SELECT count(*) as c FROM products').get().c;
    const inStockProducts = db.prepare('SELECT count(*) as c FROM products WHERE in_stock = 1').get().c;
    const totalOrders = db.prepare('SELECT count(*) as c FROM orders').get().c;
    const newOrders = db.prepare("SELECT count(*) as c FROM orders WHERE status = 'new'").get().c;
    const revenueRow = db.prepare("SELECT sum(total_price) as rev FROM orders WHERE status != 'cancelled'").get();
    const revenue = revenueRow && revenueRow.rev ? revenueRow.rev : 0;
    const totalCustomers = db.prepare('SELECT count(*) as c FROM customers').get().c;

    res.json({
      totalProducts,
      inStockProducts,
      totalOrders,
      newOrders,
      revenue,
      totalCustomers
    });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/admin/customers — List registered customers
router.get('/customers', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id OR o.customer_email = c.email) as orders_count
      FROM customers c
      ORDER BY c.id DESC
    `).all();

    const customers = rows.map(c => {
      const { password_hash, ...rest } = c;
      return rest;
    });

    res.json({ customers });
  } catch (err) {
    console.error('Error fetching admin customers:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// PUT /api/admin/customers/:id — Adjust bonus points or personal discount
router.put('/customers/:id', (req, res) => {
  try {
    const id = req.params.id;
    const { bonus_points, personal_discount } = req.body;

    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Покупатель не найден' });
    }

    db.prepare(`
      UPDATE customers 
      SET bonus_points = ?, personal_discount = ?
      WHERE id = ?
    `).run(
      bonus_points !== undefined ? parseInt(bonus_points) : existing.bonus_points,
      personal_discount !== undefined ? parseInt(personal_discount) : existing.personal_discount,
      id
    );

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при обновлении покупателя' });
  }
});

// GET /api/admin/products - List products for admin table
router.get('/products', (req, res) => {
  try {
    const { search, category, in_stock, page = 1, limit = 50 } = req.query;

    let query = 'SELECT * FROM products WHERE 1=1';
    let countQuery = 'SELECT count(*) as total FROM products WHERE 1=1';
    const params = [];
    const countParams = [];

    if (category && category !== 'all') {
      query += ' AND category = ?';
      countQuery += ' AND category = ?';
      params.push(category);
      countParams.push(category);
    }

    if (in_stock !== undefined && in_stock !== '') {
      const stockVal = in_stock === '1' || in_stock === 'true' ? 1 : 0;
      query += ' AND in_stock = ?';
      countQuery += ' AND in_stock = ?';
      params.push(stockVal);
      countParams.push(stockVal);
    }

    if (search && search.trim()) {
      query += ' AND (title LIKE ? OR sku LIKE ?)';
      countQuery += ' AND (title LIKE ? OR sku LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s);
      countParams.push(s, s);
    }

    query += ' ORDER BY id DESC';

    const numLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const numPage = Math.max(parseInt(page) || 1, 1);
    const offset = (numPage - 1) * numLimit;

    query += ' LIMIT ? OFFSET ?';
    params.push(numLimit, offset);

    const totalRow = db.prepare(countQuery).get(...countParams);
    const total = totalRow ? totalRow.total : 0;

    const rows = db.prepare(query).all(...params);
    const products = rows.map(parseProduct);

    res.json({
      products,
      pagination: {
        total,
        page: numPage,
        limit: numLimit,
        pages: Math.ceil(total / numLimit)
      }
    });
  } catch (err) {
    console.error('Error in admin products list:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/admin/products-brief - All products in short form (для выбора «Может понравиться»)
router.get('/products-brief', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, title, sku, category, price, in_stock, images FROM products ORDER BY title').all();
    res.json({
      products: rows.map(r => ({
        id: r.id, title: r.title, sku: r.sku, category: r.category, price: r.price, in_stock: r.in_stock,
        image: (JSON.parse(r.images || '[]') || [])[0] || ''
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки товаров' });
  }
});

// «Может понравиться»: только существующие товары, без самого товара, без повторов, до 12 штук
function saveRelated(productId, relatedIds) {
  if (relatedIds === undefined) return;
  const ids = [...new Set((Array.isArray(relatedIds) ? relatedIds : []).map(Number))]
    .filter(id => Number.isInteger(id) && id > 0 && id !== Number(productId))
    .filter(id => db.prepare('SELECT 1 FROM products WHERE id = ?').get(id))
    .slice(0, 12);
  db.prepare('UPDATE products SET related_ids = ? WHERE id = ?').run(JSON.stringify(ids), productId);
}

// POST /api/admin/products - Add product
router.post('/products', (req, res) => {
  try {
    const {
      title,
      sku = '',
      category = 'rings',
      collections = [],
      price,
      price_old = null,
      description = '',
      characteristics = [],
      images = [],
      sizes = [],
      color_variants = [],
      related_ids,
      in_stock = 1,
      is_bestseller = 0,
      sort_order = 0
    } = req.body;

    if (!title || price === undefined) {
      return res.status(400).json({ error: 'Название и цена обязательны' });
    }

    // Generate unique UID
    const uid = Date.now() + Math.floor(Math.random() * 1000);

    const stmt = db.prepare(`
      INSERT INTO products (
        uid, title, sku, category, collections, price, price_old,
        description, characteristics, images, sizes, color_variants, in_stock, is_bestseller, sort_order
      ) VALUES (
        @uid, @title, @sku, @category, @collections, @price, @price_old,
        @description, @characteristics, @images, @sizes, @color_variants, @in_stock, @is_bestseller, @sort_order
      )
    `);

    const result = stmt.run({
      uid,
      title: title.trim(),
      sku: sku.trim(),
      category: category || 'rings',
      collections: JSON.stringify(Array.isArray(collections) ? collections : [collections]),
      price: parseFloat(price) || 0,
      price_old: price_old ? parseFloat(price_old) : null,
      description: description.trim(),
      characteristics: JSON.stringify(characteristics || []),
      images: JSON.stringify(images || []),
      sizes: JSON.stringify(sizes || []),
      color_variants: JSON.stringify(Array.isArray(color_variants) ? color_variants : []),
      in_stock: in_stock ? 1 : 0,
      is_bestseller: is_bestseller ? 1 : 0,
      sort_order: parseInt(sort_order) || 0
    });

    saveRelated(result.lastInsertRowid, related_ids);
    const newProd = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, product: parseProduct(newProd) });
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ error: 'Ошибка при сохранении товара' });
  }
});

// PUT /api/admin/products/:id - Edit product
router.put('/products/:id', (req, res) => {
  try {
    const id = req.params.id;
    const {
      title,
      sku,
      category,
      collections,
      price,
      price_old,
      description,
      characteristics,
      images,
      sizes,
      color_variants,
      related_ids,
      in_stock,
      is_bestseller,
      sort_order
    } = req.body;

    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Товар не найден' });
    }

    const stmt = db.prepare(`
      UPDATE products SET
        title = @title,
        sku = @sku,
        category = @category,
        collections = @collections,
        price = @price,
        price_old = @price_old,
        description = @description,
        characteristics = @characteristics,
        images = @images,
        sizes = @sizes,
        color_variants = @color_variants,
        in_stock = @in_stock,
        is_bestseller = @is_bestseller,
        sort_order = @sort_order,
        updated_at = datetime('now')
      WHERE id = @id
    `);

    stmt.run({
      id,
      title: title !== undefined ? title.trim() : existing.title,
      sku: sku !== undefined ? sku.trim() : existing.sku,
      category: category || existing.category,
      collections: JSON.stringify(collections !== undefined ? (Array.isArray(collections) ? collections : [collections]) : JSON.parse(existing.collections || '[]')),
      price: price !== undefined ? parseFloat(price) : existing.price,
      price_old: price_old !== undefined ? (price_old ? parseFloat(price_old) : null) : existing.price_old,
      description: description !== undefined ? description.trim() : existing.description,
      characteristics: JSON.stringify(characteristics !== undefined ? characteristics : JSON.parse(existing.characteristics || '[]')),
      images: JSON.stringify(images !== undefined ? images : JSON.parse(existing.images || '[]')),
      sizes: JSON.stringify(sizes !== undefined ? sizes : JSON.parse(existing.sizes || '[]')),
      color_variants: JSON.stringify(color_variants !== undefined ? (Array.isArray(color_variants) ? color_variants : []) : JSON.parse(existing.color_variants || '[]')),
      in_stock: in_stock !== undefined ? (in_stock ? 1 : 0) : existing.in_stock,
      is_bestseller: is_bestseller !== undefined ? (is_bestseller ? 1 : 0) : existing.is_bestseller,
      sort_order: sort_order !== undefined ? parseInt(sort_order) : existing.sort_order
    });

    saveRelated(id, related_ids);
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.json({ success: true, product: parseProduct(updated) });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Ошибка сервера при обновлении товара' });
  }
});

// PATCH /api/admin/products/:id/price - Quick inline price update
router.patch('/products/:id/price', (req, res) => {
  try {
    const id = req.params.id;
    const { price, price_old } = req.body;

    if (price === undefined) {
      return res.status(400).json({ error: 'Укажите новую цену' });
    }

    db.prepare(`
      UPDATE products SET
        price = ?,
        price_old = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(parseFloat(price) || 0, price_old ? parseFloat(price_old) : null, id);

    res.json({ success: true, id, price, price_old });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при изменении цены' });
  }
});

// PATCH /api/admin/products/:id/stock - Quick inline stock toggle
router.patch('/products/:id/stock', (req, res) => {
  try {
    const id = req.params.id;
    const { in_stock } = req.body;

    db.prepare(`
      UPDATE products SET
        in_stock = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(in_stock ? 1 : 0, id);

    res.json({ success: true, id, in_stock: in_stock ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при изменении наличия' });
  }
});

// Колонки таблицы products (для копирования и восстановления строк целиком)
function productColumns() {
  return db.prepare('PRAGMA table_info(products)').all().map(c => c.name);
}

function insertProductRow(row) {
  const cols = productColumns().filter(c => Object.prototype.hasOwnProperty.call(row, c));
  const stmt = db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(c => `@${c}`).join(', ')})`);
  return stmt.run(Object.fromEntries(cols.map(c => [c, row[c]])));
}

// Корзина хранит товары 30 дней, потом удаляет окончательно
function purgeTrash() {
  db.prepare("DELETE FROM products_trash WHERE deleted_at < datetime('now', '-30 days')").run();
}

// DELETE /api/admin/products/:id - Move product to trash (можно восстановить 30 дней)
router.delete('/products/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Товар не найден' });
    db.transaction(() => {
      db.prepare('INSERT OR REPLACE INTO products_trash (id, title, data) VALUES (?, ?, ?)').run(row.id, row.title, JSON.stringify(row));
      db.prepare('DELETE FROM products WHERE id = ?').run(row.id);
    })();
    purgeTrash();
    res.json({ success: true, message: 'Товар перемещён в корзину' });
  } catch (err) {
    console.error('Error moving product to trash:', err);
    res.status(500).json({ error: 'Ошибка при удалении товара' });
  }
});

// GET /api/admin/products-trash - Deleted products
router.get('/products-trash', (req, res) => {
  try {
    purgeTrash();
    const rows = db.prepare('SELECT id, title, data, deleted_at FROM products_trash ORDER BY deleted_at DESC').all();
    res.json({
      items: rows.map(r => {
        const p = JSON.parse(r.data || '{}');
        const images = typeof p.images === 'string' ? JSON.parse(p.images || '[]') : (p.images || []);
        return { id: r.id, title: r.title, price: p.price, category: p.category, image: images[0] || '', deleted_at: r.deleted_at };
      })
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки корзины' });
  }
});

// POST /api/admin/products-trash/:id/restore - Restore product with the same id
router.post('/products-trash/:id/restore', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM products_trash WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Товара нет в корзине' });
    const data = JSON.parse(row.data);
    if (db.prepare('SELECT id FROM products WHERE id = ?').get(data.id)) delete data.id;
    if (data.uid && db.prepare('SELECT id FROM products WHERE uid = ?').get(data.uid)) data.uid = null;
    db.transaction(() => {
      insertProductRow(data);
      db.prepare('DELETE FROM products_trash WHERE id = ?').run(row.id);
    })();
    res.json({ success: true });
  } catch (err) {
    console.error('Error restoring product:', err);
    res.status(500).json({ error: 'Не удалось восстановить товар' });
  }
});

// DELETE /api/admin/products-trash/:id - Delete permanently
router.delete('/products-trash/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM products_trash WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// POST /api/admin/products/:id/duplicate - Copy product card (для новых комбо и вариаций)
router.post('/products/:id/duplicate', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Товар не найден' });
    const copy = { ...row, title: `${row.title} (копия)`, sku: '', uid: null, is_bestseller: 0 };
    delete copy.id;
    delete copy.created_at;
    delete copy.updated_at;
    const result = insertProductRow(copy);
    const product = parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid));
    res.status(201).json({ success: true, product });
  } catch (err) {
    console.error('Error duplicating product:', err);
    res.status(500).json({ error: 'Не удалось скопировать товар' });
  }
});

// POST /api/admin/upload - Upload product photo
router.post('/upload', upload.array('photos', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Файлы не загружены' });
    }

    const fileUrls = req.files.map(file => `/uploads/${file.filename}`);
    res.json({ success: true, urls: fileUrls });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке файлов' });
  }
});

// GET /api/admin/orders - List orders
router.get('/orders', (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;

    let query = 'SELECT * FROM orders WHERE 1=1';
    let countQuery = 'SELECT count(*) as total FROM orders WHERE 1=1';
    const params = [];
    const countParams = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      countQuery += ' AND status = ?';
      params.push(status);
      countParams.push(status);
    }

    if (search && search.trim()) {
      query += ' AND (order_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)';
      countQuery += ' AND (order_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
      countParams.push(s, s, s);
    }

    query += ' ORDER BY id DESC';

    const numLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const numPage = Math.max(parseInt(page) || 1, 1);
    const offset = (numPage - 1) * numLimit;

    query += ' LIMIT ? OFFSET ?';
    params.push(numLimit, offset);

    const totalRow = db.prepare(countQuery).get(...countParams);
    const total = totalRow ? totalRow.total : 0;

    const rows = db.prepare(query).all(...params);
    const orders = rows.map(o => ({
      ...o,
      items: typeof o.items === 'string' ? JSON.parse(o.items || '[]') : o.items
    }));

    res.json({
      orders,
      pagination: {
        total,
        page: numPage,
        limit: numLimit,
        pages: Math.ceil(total / numLimit)
      }
    });
  } catch (err) {
    console.error('Error fetching admin orders:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// PUT /api/admin/orders/:id/status - Update order status
router.put('/orders/:id/status', (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    if (!orderStatus.isValid(status) || status === 'completed') {
      return res.status(400).json({ error: 'Недопустимый статус заказа' });
    }

    db.prepare(`
      UPDATE orders SET
        status = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(status, id);

    // Ручная отметка «Оплачен» (например, перевод на карту) фиксирует и саму оплату
    if (status === 'paid') {
      db.prepare(`
        UPDATE orders SET payment_status = 'paid', paid_at = COALESCE(paid_at, datetime('now'))
        WHERE id = ? AND COALESCE(payment_status, '') != 'paid'
      `).run(id);
    }

    res.json({ success: true, id, status });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при обновлении статуса заказа' });
  }
});

// GET /api/admin/orders/:id - Full order card: history, shipment, customer stats
router.get('/orders/:id', (req, res) => {
  try {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Заказ не найден' });
    const history = db.prepare('SELECT status, created_at FROM order_status_history WHERE order_id = ? ORDER BY id').all(o.id);
    const phoneDigits = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
    const customerOrders = db.prepare(`
      SELECT COUNT(*) AS c, COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_price END), 0) AS paid_sum
      FROM orders
      WHERE (customer_email != '' AND lower(customer_email) = lower(?))
         OR (? != '' AND substr(replace(replace(replace(replace(replace(customer_phone, '+', ''), ' ', ''), '(', ''), ')', ''), '-', ''), -10) = ?)
    `).get(o.customer_email || '', phoneDigits, phoneDigits);
    res.json({
      order: { ...o, items: JSON.parse(o.items || '[]'), status_label: orderStatus.label(o.status) },
      history: history.map(h => ({ ...h, label: orderStatus.label(h.status) })),
      customer: { orders_count: customerOrders.c, paid_sum: customerOrders.paid_sum },
      statuses: Object.entries(orderStatus.STATUSES)
        .filter(([key]) => key !== 'completed')
        .map(([key, s]) => ({ key, label: s.label }))
    });
  } catch (err) {
    console.error('Error fetching order card:', err);
    res.status(500).json({ error: 'Ошибка загрузки заказа' });
  }
});

// GET /api/admin/orders-export?status=&from=&to= - Заказы в CSV для Excel (разделитель «;», UTF-8 с BOM)
router.get('/orders-export', (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.status && req.query.status !== 'all') { where.push('status = ?'); params.push(req.query.status); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) { where.push("date(created_at, '+5 hours') >= ?"); params.push(req.query.from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) { where.push("date(created_at, '+5 hours') <= ?"); params.push(req.query.to); }
    const rows = db.prepare(`SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`).all(...params);

    const cell = v => {
      const s = v == null ? '' : String(v);
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Номер', 'Дата (Екб)', 'Статус', 'Оплата', 'Дата оплаты', 'Покупатель', 'Телефон', 'Email',
      'Состав', 'Кол-во, шт', 'Товары, ₽', 'Скидка, ₽', 'Бонусы, ₽', 'Промокод', 'Доставка, ₽', 'Итого, ₽',
      'Способ доставки', 'Адрес / ПВЗ', 'Трек-номер', 'Устройство', 'Комментарий'];
    const lines = rows.map(o => {
      const items = JSON.parse(o.items || '[]');
      const toLocal = d => (d ? db.prepare("SELECT datetime(?, '+5 hours') AS d").get(d).d : '');
      return [
        o.order_number, toLocal(o.created_at), orderStatus.label(o.status),
        o.payment_status === 'paid' ? 'оплачен' : (o.payment_status === 'canceled' ? 'не прошла' : 'нет'),
        toLocal(o.paid_at), o.customer_name, o.customer_phone, o.customer_email,
        items.map(i => `${i.title}${i.size ? ` р.${i.size}` : ''}${i.color ? ` ${i.color}` : ''} ×${i.quantity || 1}`).join(' | '),
        items.reduce((n, i) => n + (parseInt(i.quantity, 10) || 1), 0),
        o.subtotal, o.discount_amount || 0, o.bonus_used || 0, o.promo_code || '', o.delivery_price || 0, o.total_price,
        o.delivery_method, o.delivery_address, o.tracking_number || '', o.device || '', o.comment || ''
      ].map(cell).join(';');
    });
    const csv = '﻿' + [header.join(';'), ...lines].join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="sups-orders-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Orders export error:', err);
    res.status(500).json({ error: 'Ошибка выгрузки заказов' });
  }
});

// POST /api/admin/orders/:id/shipment - Create CDEK shipment for the order
router.post('/orders/:id/shipment', async (req, res) => {
  try {
    const result = await cdekShipments.createShipment(parseInt(req.params.id, 10));
    res.json({ success: true, ...result });
  } catch (err) {
    console.warn('Create shipment error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/orders/:id/sync - Refresh shipment status from CDEK now
router.post('/orders/:id/sync', async (req, res) => {
  try {
    const result = await cdekShipments.syncShipment(parseInt(req.params.id, 10));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ error: `СДЭК не ответил: ${err.message}` });
  }
});

// GET /api/admin/settings
router.get('/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при получении настроек' });
  }
});

// POST /api/admin/settings
router.post('/settings', (req, res) => {
  try {
    const settings = req.body;
    const upsert = db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (@key, @value)
      ON CONFLICT(key) DO UPDATE SET value = @value
    `);

    const updateMany = db.transaction((obj) => {
      for (const [key, value] of Object.entries(obj)) {
        upsert.run({ key, value: String(value) });
      }
    });

    updateMany(settings);

    // Письма шлём только по событиям после включения — без рассылки по старым заказам
    if (settings.emails_enabled === '1' && !db.prepare("SELECT 1 FROM settings WHERE key = 'emails_enabled_at' AND value != ''").get()) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('emails_enabled_at', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = datetime('now')").run();
    }
    res.json({ success: true, message: 'Настройки успешно сохранены' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при сохранении настроек' });
  }
});

// POST /api/admin/test-email - Проверка почты для писем покупателям
router.post('/test-email', async (req, res) => {
  const to = String((req.body && req.body.to) || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Укажите email, куда отправить тестовое письмо' });
  try {
    await customerEmails.sendTest(to);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/change-password
router.post('/change-password', (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const adminId = req.adminUser.id;

    const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(adminId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const isMatch = bcrypt.compareSync(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Текущий пароль указан неверно' });
    }

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'Новый пароль должен содержать минимум 6 символов' });
    }

    const newHash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(newHash, adminId);

    res.json({ success: true, message: 'Пароль успешно изменен' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при смене пароля' });
  }
});

// GET /api/admin/promo-codes — List all promo codes
router.get('/promo-codes', (req, res) => {
  try {
    const promoCodes = db.prepare('SELECT * FROM promo_codes ORDER BY id DESC').all();
    res.json({ promoCodes });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/admin/promo-codes — Create promo code
router.post('/promo-codes', (req, res) => {
  try {
    const { code, discount_percent, max_uses, is_active } = req.body;

    if (!code || discount_percent === undefined) {
      return res.status(400).json({ error: 'Укажите код и процент скидки' });
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = db.prepare('SELECT id FROM promo_codes WHERE UPPER(code) = ?').get(cleanCode);
    if (existing) {
      return res.status(400).json({ error: 'Промокод с таким именем уже существует' });
    }

    const stmt = db.prepare(`
      INSERT INTO promo_codes (code, discount_percent, max_uses, is_active)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      cleanCode,
      parseInt(discount_percent) || 10,
      parseInt(max_uses) || 100,
      is_active !== undefined ? (is_active ? 1 : 0) : 1
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка создания промокода' });
  }
});

// PUT /api/admin/promo-codes/:id — Update promo code
router.put('/promo-codes/:id', (req, res) => {
  try {
    const id = req.params.id;
    const { code, discount_percent, max_uses, is_active } = req.body;

    const existing = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Промокод не найден' });
    }

    db.prepare(`
      UPDATE promo_codes SET
        code = ?,
        discount_percent = ?,
        max_uses = ?,
        is_active = ?
      WHERE id = ?
    `).run(
      code ? code.trim().toUpperCase() : existing.code,
      discount_percent !== undefined ? parseInt(discount_percent) : existing.discount_percent,
      max_uses !== undefined ? parseInt(max_uses) : existing.max_uses,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      id
    );

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления промокода' });
  }
});

// DELETE /api/admin/promo-codes/:id — Delete promo code
router.delete('/promo-codes/:id', (req, res) => {
  try {
    const id = req.params.id;
    db.prepare('DELETE FROM promo_codes WHERE id = ?').run(id);
    res.json({ success: true, message: 'Промокод удален' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при удалении промокода' });
  }
});

module.exports = router;
