const express = require('express');
const router = express.Router();
const db = require('../db');
const upload = require('../services/uploader');
const { requireAdmin } = require('./auth');
const { optionalCustomer, requireCustomer } = require('./customers');

function parseReview(r) {
  if (!r) return null;
  return {
    ...r,
    photos: typeof r.photos === 'string' ? JSON.parse(r.photos || '[]') : r.photos
  };
}

// GET /api/reviews/my-purchases — Get ONLY purchased items & orders for logged-in user
router.get('/my-purchases', requireCustomer, (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT * FROM orders 
      WHERE (customer_id = ? OR customer_email = ? OR (customer_phone != '' AND customer_phone = ?))
        AND status != 'cancelled'
      ORDER BY id DESC
    `).all(req.customer.id, req.customer.email, req.customer.phone || 'NO_PHONE');

    const purchasedProductsMap = new Map();
    const purchasedOrders = [];

    orders.forEach(order => {
      let items = [];
      try { items = JSON.parse(order.items || '[]'); } catch (e) {}

      items.forEach(item => {
        if (item.id && !purchasedProductsMap.has(item.id)) {
          purchasedProductsMap.set(item.id, {
            product_id: item.id,
            title: item.title,
            image: item.image || '/assets/placeholder.jpg',
            price: item.price,
            order_id: order.id,
            order_number: order.order_number
          });
        }
      });

      if (items.length >= 2) {
        purchasedOrders.push({
          order_id: order.id,
          order_number: order.order_number,
          item_count: items.length,
          total_price: order.total_price,
          items_summary: items.map(i => i.title).join(', ')
        });
      }
    });

    res.json({
      customer: {
        id: req.customer.id,
        user_code: req.customer.user_code,
        name: req.customer.name
      },
      purchased_products: Array.from(purchasedProductsMap.values()),
      purchased_orders: purchasedOrders
    });
  } catch (err) {
    console.error('Error fetching my-purchases:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/reviews — Public list of approved reviews with product title & thumbnail
router.get('/', (req, res) => {
  try {
    const { product_id, limit = 50 } = req.query;

    let query = `
      SELECT r.*, p.title as product_title, p.images as product_images, p.category as product_category,
             o.order_number as linked_order_number
      FROM reviews r
      LEFT JOIN products p ON r.product_id = p.id
      LEFT JOIN orders o ON r.order_id = o.id
      WHERE r.status = 'approved'
    `;
    const params = [];

    if (product_id) {
      query += ' AND r.product_id = ?';
      params.push(product_id);
    }

    query += ' ORDER BY r.id DESC LIMIT ?';
    params.push(parseInt(limit) || 50);

    const rows = db.prepare(query).all(...params);
    const reviews = rows.map(r => {
      let prodImg = '';
      try {
        const imgs = JSON.parse(r.product_images || '[]');
        if (imgs.length > 0) prodImg = imgs[0];
      } catch (e) {}

      let displayTitle = r.product_title;
      if (!displayTitle && r.linked_order_number) {
        displayTitle = `Общий отзыв на Заказ #${r.linked_order_number}`;
      }

      return {
        ...parseReview(r),
        product_title: displayTitle,
        product_image: prodImg
      };
    });

    res.json({ reviews });
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).json({ error: 'Ошибка при получении отзывов' });
  }
});

// POST /api/reviews/upload — Public upload for review photo attachments
router.post('/upload', upload.array('photos', 5), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Файлы не выбраны' });
    }
    const urls = req.files.map(f => `/uploads/${f.filename}`);
    res.json({ success: true, urls });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки фото' });
  }
});

// POST /api/reviews — Public submission of new review (STRICT: Purchased items/orders only!)
router.post('/', optionalCustomer, (req, res) => {
  try {
    const { product_id, order_id, author_name, city = '', rating = 5, text, photos = [] } = req.body;

    if (!author_name || !text) {
      return res.status(400).json({ error: 'Пожалуйста, укажите имя и текст отзыва' });
    }

    let customerId = req.customer ? req.customer.id : null;
    let customerObj = req.customer || null;

    // Check if customer is logged in or can be identified
    if (!customerObj) {
      return res.status(403).json({
        error: 'Оставлять отзывы могут только покупатели. Пожалуйста, войдите в свой личный кабинет.'
      });
    }

    // Get customer's past orders
    const orders = db.prepare(`
      SELECT * FROM orders 
      WHERE (customer_id = ? OR customer_email = ? OR (customer_phone != '' AND customer_phone = ?))
        AND status != 'cancelled'
    `).all(customerObj.id, customerObj.email, customerObj.phone || 'NO_PHONE');

    if (orders.length === 0) {
      return res.status(403).json({
        error: 'У вас пока нет оформленных заказов. Отзывы могут оставлять только покупатели.'
      });
    }

    // Extract valid purchased product IDs and order IDs
    const validProductIds = new Set();
    const validOrderIds = new Set();

    orders.forEach(o => {
      validOrderIds.add(o.id);
      let items = [];
      try { items = JSON.parse(o.items || '[]'); } catch (e) {}
      items.forEach(i => {
        if (i.id) validProductIds.add(parseInt(i.id));
      });
    });

    let targetProductId = product_id ? parseInt(product_id) : null;
    let targetOrderId = order_id ? parseInt(order_id) : null;

    // Validate that either targetProductId or targetOrderId was purchased by this user
    if (targetProductId) {
      if (!validProductIds.has(targetProductId)) {
        return res.status(403).json({
          error: 'Вы можете оставить отзыв только на украшение, которое вы действительно приобретали.'
        });
      }
    } else if (targetOrderId) {
      if (!validOrderIds.has(targetOrderId)) {
        return res.status(403).json({
          error: 'Указанный заказ не найден в вашей истории покупок.'
        });
      }
    } else {
      return res.status(400).json({
        error: 'Пожалуйста, выберите купленное украшение или заказ из вашего списка покупок.'
      });
    }

    const stmt = db.prepare(`
      INSERT INTO reviews (customer_id, order_id, product_id, author_name, city, rating, text, photos, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    const result = stmt.run(
      customerId,
      targetOrderId,
      targetProductId,
      author_name.trim(),
      city.trim(),
      Math.min(Math.max(parseInt(rating) || 5, 1), 5),
      text.trim(),
      JSON.stringify(Array.isArray(photos) ? photos : [])
    );

    res.status(201).json({
      success: true,
      message: 'Спасибо! Ваш отзыв отправлен на модерацию и появится на сайте после проверки.',
      review_id: result.lastInsertRowid
    });
  } catch (err) {
    console.error('Error creating review:', err);
    res.status(500).json({ error: 'Ошибка сервера при отправке отзыва' });
  }
});

// ============================================================
// ADMIN REVIEWS ENDPOINTS
// ============================================================

// GET /api/reviews/admin/list — Admin list of all reviews
router.get('/admin/list', requireAdmin, (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT r.*, p.title as product_title, p.images as product_images,
             c.user_code, c.name as customer_account_name, o.order_number as linked_order_number
      FROM reviews r
      LEFT JOIN products p ON r.product_id = p.id
      LEFT JOIN customers c ON r.customer_id = c.id
      LEFT JOIN orders o ON r.order_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ' AND r.status = ?';
      params.push(status);
    }

    query += ' ORDER BY r.id DESC';

    const rows = db.prepare(query).all(...params);
    const reviews = rows.map(r => {
      let prodImg = '';
      try {
        const imgs = JSON.parse(r.product_images || '[]');
        if (imgs.length > 0) prodImg = imgs[0];
      } catch (e) {}

      let displayTitle = r.product_title;
      if (!displayTitle && r.linked_order_number) {
        displayTitle = `Общий отзыв на Заказ #${r.linked_order_number}`;
      }

      return {
        ...parseReview(r),
        product_title: displayTitle,
        product_image: prodImg
      };
    });

    res.json({ reviews });
  } catch (err) {
    console.error('Error fetching admin reviews:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// PUT /api/reviews/admin/:id/status — Update review status (approved/pending/rejected)
router.put('/admin/:id/status', requireAdmin, (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    if (!['approved', 'pending', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Неверный статус' });
    }

    db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(status, id);
    res.json({ success: true, id, status });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления статуса' });
  }
});

// DELETE /api/reviews/admin/:id — Delete review
router.delete('/admin/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
    res.json({ success: true, message: 'Отзыв удален' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при удалении отзыва' });
  }
});

// POST /api/reviews/admin/add — Admin manually add review
router.post('/admin/add', requireAdmin, (req, res) => {
  try {
    const { product_id, order_id, author_name, city = '', rating = 5, text, photos = [], status = 'approved' } = req.body;

    if (!author_name || !text) {
      return res.status(400).json({ error: 'Укажите имя автора и текст отзыва' });
    }

    const stmt = db.prepare(`
      INSERT INTO reviews (product_id, order_id, author_name, city, rating, text, photos, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      product_id ? parseInt(product_id) : null,
      order_id ? parseInt(order_id) : null,
      author_name.trim(),
      city.trim(),
      parseInt(rating) || 5,
      text.trim(),
      JSON.stringify(Array.isArray(photos) ? photos : []),
      status
    );

    res.status(201).json({ success: true, review_id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при создании отзыва' });
  }
});

module.exports = router;
