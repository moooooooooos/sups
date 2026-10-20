const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('./auth');
const upload = require('../services/uploader');

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

// DELETE /api/admin/products/:id - Delete product
router.delete('/products/:id', (req, res) => {
  try {
    const id = req.params.id;
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ success: true, message: 'Товар успешно удален' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при удалении товара' });
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

    const validStatuses = ['new', 'processing', 'shipped', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус заказа' });
    }

    db.prepare(`
      UPDATE orders SET
        status = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(status, id);

    res.json({ success: true, id, status });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при обновлении статуса заказа' });
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
    res.json({ success: true, message: 'Настройки успешно сохранены' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при сохранении настроек' });
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
