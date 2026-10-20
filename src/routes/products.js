const express = require('express');
const router = express.Router();
const db = require('../db');
const { productPath } = require('./seo');

function parseProduct(p) {
  if (!p) return null;
  return {
    ...p,
    categories: typeof p.categories === 'string' ? JSON.parse(p.categories || '[]') : (p.categories || []),
    collections: typeof p.collections === 'string' ? JSON.parse(p.collections || '[]') : p.collections,
    images: typeof p.images === 'string' ? JSON.parse(p.images || '[]') : p.images,
    sizes: typeof p.sizes === 'string' ? JSON.parse(p.sizes || '[]') : p.sizes,
    color_variants: typeof p.color_variants === 'string' ? JSON.parse(p.color_variants || '[]') : (p.color_variants || []),
    related_ids: typeof p.related_ids === 'string' ? JSON.parse(p.related_ids || '[]') : (p.related_ids || []),
    url: productPath(p),
    characteristics: typeof p.characteristics === 'string' ? JSON.parse(p.characteristics || '[]') : p.characteristics
  };
}

const RELATED_LIMIT = 6;

/**
 * «Может понравиться»: сначала товары, выбранные в админке (в их порядке),
 * затем автоподбор — та же коллекция, та же категория, хиты. Товары в наличии раньше.
 */
function relatedProducts(product) {
  const picked = [];
  const seen = new Set([product.id]);
  const add = rows => rows.forEach(r => {
    if (picked.length < RELATED_LIMIT && !seen.has(r.id)) {
      seen.add(r.id);
      picked.push(r);
    }
  });

  const manualIds = Array.isArray(product.related_ids) ? product.related_ids : [];
  if (manualIds.length) {
    const rows = db.prepare(`SELECT * FROM products WHERE id IN (${manualIds.map(() => '?').join(',')})`).all(...manualIds);
    const byId = new Map(rows.map(r => [r.id, r]));
    add(manualIds.map(id => byId.get(id)).filter(r => r && r.in_stock));
  }

  const collections = Array.isArray(product.collections) ? product.collections.filter(Boolean) : [];
  if (picked.length < RELATED_LIMIT && collections.length) {
    const rows = db.prepare(`
      SELECT * FROM products WHERE in_stock = 1 AND id != ?
      ORDER BY is_bestseller DESC, sort_order, id DESC LIMIT 200
    `).all(product.id);
    add(rows.filter(r => {
      const cols = JSON.parse(r.collections || '[]');
      return cols.some(c => collections.includes(c)) && r.category !== product.category;
    }));
    add(rows.filter(r => JSON.parse(r.collections || '[]').some(c => collections.includes(c))));
  }

  if (picked.length < RELATED_LIMIT) {
    add(db.prepare(`
      SELECT * FROM products WHERE in_stock = 1 AND category = ? AND id != ?
      ORDER BY is_bestseller DESC, sort_order, id DESC LIMIT ?
    `).all(product.category, product.id, RELATED_LIMIT * 2));
  }

  if (picked.length < RELATED_LIMIT) {
    add(db.prepare(`
      SELECT * FROM products WHERE in_stock = 1 AND id != ? ORDER BY is_bestseller DESC, id DESC LIMIT ?
    `).all(product.id, RELATED_LIMIT * 2));
  }

  return picked.map(parseProduct).map(p => ({
    id: p.id, title: p.title, price: p.price, price_old: p.price_old, url: p.url,
    category: p.category, image: (p.images || [])[0] || '', manual: manualIds.includes(p.id)
  }));
}

// GET /api/products
router.get('/', (req, res) => {
  try {
    const { category, collection, size, search, sort, in_stock, bestseller, page = 1, limit = 50 } = req.query;

    let query = 'SELECT * FROM products WHERE 1=1';
    let countQuery = 'SELECT count(*) as total FROM products WHERE 1=1';
    const params = [];
    const countParams = [];

    if (category && category !== 'all') {
      query += ' AND (category = ? OR categories LIKE ?)';
      countQuery += ' AND (category = ? OR categories LIKE ?)';
      const catParam = `%"${category}"%`;
      params.push(category, catParam);
      countParams.push(category, catParam);
    }

    if (collection) {
      query += ' AND lower_utf8(collections) LIKE ?';
      countQuery += ' AND lower_utf8(collections) LIKE ?';
      const collParam = `%"${collection.trim().toLowerCase()}"%`;
      params.push(collParam);
      countParams.push(collParam);
    }

    if (size) {
      query += ' AND sizes LIKE ?';
      countQuery += ' AND sizes LIKE ?';
      const sizeParam = `%"${size}"%`;
      params.push(sizeParam);
      countParams.push(sizeParam);
    }

    if (in_stock !== undefined && in_stock !== '') {
      const stockVal = in_stock === '1' || in_stock === 'true' ? 1 : 0;
      query += ' AND in_stock = ?';
      countQuery += ' AND in_stock = ?';
      params.push(stockVal);
      countParams.push(stockVal);
    }

    if (bestseller === '1' || bestseller === 'true') {
      query += ' AND is_bestseller = 1';
      countQuery += ' AND is_bestseller = 1';
    }

    if (search && search.trim()) {
      query += ' AND (lower_utf8(title) LIKE ? OR lower_utf8(description) LIKE ? OR lower_utf8(sku) LIKE ?)';
      countQuery += ' AND (lower_utf8(title) LIKE ? OR lower_utf8(description) LIKE ? OR lower_utf8(sku) LIKE ?)';
      const s = `%${search.trim().toLowerCase()}%`;
      params.push(s, s, s);
      countParams.push(s, s, s);
    }

    // Sorting
    switch (sort) {
      case 'price_asc':
        query += ' ORDER BY price ASC';
        break;
      case 'price_desc':
        query += ' ORDER BY price DESC';
        break;
      case 'title_asc':
        query += ' ORDER BY title ASC';
        break;
      case 'newest':
        query += ' ORDER BY id DESC';
        break;
      default:
        query += ' ORDER BY is_bestseller DESC, sort_order ASC, id ASC';
        break;
    }

    // Pagination
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
    console.error('Error in /api/products:', err);
    res.status(500).json({ error: 'Ошибка сервера при получении товаров' });
  }
});

// GET /api/products/featured (bestsellers for homepage)
router.get('/featured', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM products WHERE is_bestseller = 1 ORDER BY sort_order ASC LIMIT 12').all();
    // if less than 6 bestsellers, supplement with first products
    let items = rows;
    if (items.length < 6) {
      const extra = db.prepare('SELECT * FROM products WHERE is_bestseller = 0 ORDER BY id ASC LIMIT ?').all(6 - items.length);
      items = items.concat(extra);
    }
    res.json({ products: items.map(parseProduct) });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при получении избранных товаров' });
  }
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  try {
    const id = req.params.id;
    let product = null;

    if (/^\d+$/.test(id)) {
      product = db.prepare('SELECT * FROM products WHERE id = ? OR uid = ?').get(id, id);
    }

    if (!product) {
      return res.status(404).json({ error: 'Товар не найден' });
    }

    const parsed = parseProduct(product);

    res.json({ product: parsed, related: relatedProducts(parsed) });
  } catch (err) {
    console.error('Error in /api/products/:id:', err);
    res.status(500).json({ error: 'Ошибка при получении товара' });
  }
});

module.exports = router;
