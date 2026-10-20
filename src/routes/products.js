const express = require('express');
const router = express.Router();
const db = require('../db');

function parseProduct(p) {
  if (!p) return null;
  return {
    ...p,
    categories: typeof p.categories === 'string' ? JSON.parse(p.categories || '[]') : (p.categories || []),
    collections: typeof p.collections === 'string' ? JSON.parse(p.collections || '[]') : p.collections,
    images: typeof p.images === 'string' ? JSON.parse(p.images || '[]') : p.images,
    sizes: typeof p.sizes === 'string' ? JSON.parse(p.sizes || '[]') : p.sizes,
    color_variants: typeof p.color_variants === 'string' ? JSON.parse(p.color_variants || '[]') : (p.color_variants || []),
    characteristics: typeof p.characteristics === 'string' ? JSON.parse(p.characteristics || '[]') : p.characteristics
  };
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

    // Get related products from same category
    const related = db.prepare('SELECT * FROM products WHERE category = ? AND id != ? LIMIT 4')
      .all(product.category, product.id)
      .map(parseProduct);

    res.json({ product: parsed, related });
  } catch (err) {
    console.error('Error in /api/products/:id:', err);
    res.status(500).json({ error: 'Ошибка при получении товара' });
  }
});

module.exports = router;
