const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const orderStatus = require('../services/orderStatus');
const cdekShipments = require('../services/cdekShipments');

const { getSecret } = require('../services/secrets');

const CUSTOMER_JWT_SECRET = getSecret('customer_jwt', 'CUSTOMER_JWT_SECRET');

function generateUserCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `SUPS-U${num}`;
}

function getTierInfo(totalSpent) {
  if (totalSpent >= 50000) {
    return { name: 'Платиновый', discount: 15, cashbackPct: 12, nextTier: null, nextTierSpent: 0 };
  } else if (totalSpent >= 25000) {
    return { name: 'Золотой', discount: 10, cashbackPct: 10, nextTier: 'Платиновый', nextTierSpent: 50000 - totalSpent };
  } else if (totalSpent >= 10000) {
    return { name: 'Серебряный', discount: 5, cashbackPct: 7, nextTier: 'Золотой', nextTierSpent: 25000 - totalSpent };
  } else {
    return { name: 'Бронзовый', discount: 0, cashbackPct: 5, nextTier: 'Серебряный', nextTierSpent: 10000 - totalSpent };
  }
}

function isBirthdayMonth(birthdateStr) {
  if (!birthdateStr) return false;
  try {
    const bDate = new Date(birthdateStr);
    const now = new Date();
    return bDate.getMonth() === now.getMonth();
  } catch (e) {
    return false;
  }
}

// Middleware: Require logged in customer
function requireCustomer(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Необходимо войти в личный кабинет' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET);
    const customer = db.prepare('SELECT id, user_code, name, email, phone, birthdate, bonus_points, personal_discount, total_spent, created_at FROM customers WHERE id = ?').get(decoded.id);
    if (!customer) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    req.customer = customer;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Сессия истекла, войдите снова' });
  }
}

// Middleware: Optional customer token
function optionalCustomer(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET);
      const customer = db.prepare('SELECT id, user_code, name, email, phone, birthdate, bonus_points, personal_discount, total_spent, created_at FROM customers WHERE id = ?').get(decoded.id);
      if (customer) req.customer = customer;
    } catch (e) {}
  }
  next();
}

// POST /api/customers/register
router.post('/register', (req, res) => {
  try {
    const { name, email, phone, birthdate, password, agreement_accepted = false, pd_consent = false } = req.body;

    if (agreement_accepted !== true || pd_consent !== true) {
      return res.status(400).json({ error: 'Подтвердите согласие с пользовательским соглашением и на обработку персональных данных' });
    }

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Пожалуйста, заполните имя, email и пароль' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM customers WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'Пользователь с таким email уже зарегистрирован' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    let userCode = generateUserCode();
    // Ensure code uniqueness
    while (db.prepare('SELECT id FROM customers WHERE user_code = ?').get(userCode)) {
      userCode = generateUserCode();
    }

    // Give 100 welcome bonus points
    const stmt = db.prepare(`
      INSERT INTO customers (user_code, name, email, phone, birthdate, password_hash, bonus_points, personal_discount, total_spent, pd_consent_at)
      VALUES (?, ?, ?, ?, ?, ?, 100, 0, 0, datetime('now'))
    `);

    const result = stmt.run(userCode, name.trim(), cleanEmail, phone ? phone.trim() : '', birthdate ? birthdate.trim() : '', hash);
    const customerId = result.lastInsertRowid;

    // Auto link any past orders placed with this email or phone
    if (phone) {
      db.prepare('UPDATE orders SET customer_id = ? WHERE (customer_email = ? OR customer_phone = ?) AND customer_id IS NULL')
        .run(customerId, cleanEmail, phone.trim());
    } else {
      db.prepare('UPDATE orders SET customer_id = ? WHERE customer_email = ? AND customer_id IS NULL')
        .run(customerId, cleanEmail);
    }

    // Recalculate total spent from existing linked orders
    const spentRow = db.prepare("SELECT SUM(total_price) as sum_spent FROM orders WHERE customer_id = ? AND status != 'cancelled'").get(customerId);
    const realSpent = spentRow.sum_spent || 0;
    const tier = getTierInfo(realSpent);

    db.prepare('UPDATE customers SET total_spent = ?, personal_discount = ? WHERE id = ?')
      .run(realSpent, tier.discount, customerId);

    const token = jwt.sign({ id: customerId, user_code: userCode, email: cleanEmail }, CUSTOMER_JWT_SECRET, { expiresIn: '60d' });

    const updatedCustomer = db.prepare('SELECT id, user_code, name, email, phone, birthdate, bonus_points, personal_discount, total_spent, created_at FROM customers WHERE id = ?').get(customerId);

    res.status(201).json({
      success: true,
      token,
      customer: {
        ...updatedCustomer,
        tier,
        is_birthday_month: isBirthdayMonth(updatedCustomer.birthdate)
      }
    });
  } catch (err) {
    console.error('Customer register error:', err);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// POST /api/customers/login
router.post('/login', (req, res) => {
  try {
    const { login, password } = req.body; // login can be email or phone or user_code

    if (!login || !password) {
      return res.status(400).json({ error: 'Введите email/телефон и пароль' });
    }

    const cleanLogin = login.trim().toLowerCase();
    const customer = db.prepare(`
      SELECT * FROM customers 
      WHERE LOWER(email) = ? OR LOWER(phone) = ? OR LOWER(user_code) = ?
    `).get(cleanLogin, cleanLogin, cleanLogin);

    if (!customer) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const isMatch = bcrypt.compareSync(password, customer.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const tier = getTierInfo(customer.total_spent);
    const token = jwt.sign({ id: customer.id, user_code: customer.user_code, email: customer.email }, CUSTOMER_JWT_SECRET, { expiresIn: '60d' });

    const { password_hash, ...customerData } = customer;

    res.json({
      success: true,
      token,
      customer: {
        ...customerData,
        tier,
        is_birthday_month: isBirthdayMonth(customerData.birthdate)
      }
    });
  } catch (err) {
    console.error('Customer login error:', err);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

// GET /api/customers/me
router.get('/me', requireCustomer, (req, res) => {
  const tier = getTierInfo(req.customer.total_spent);
  res.json({
    customer: {
      ...req.customer,
      tier,
      is_birthday_month: isBirthdayMonth(req.customer.birthdate)
    }
  });
});

// GET /api/customers/orders — Customer order history
router.get('/orders', requireCustomer, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM orders 
      WHERE customer_id = ? OR customer_email = ? OR (customer_phone != '' AND customer_phone = ?)
      ORDER BY id DESC
    `).all(req.customer.id, req.customer.email, req.customer.phone || 'NO_PHONE');

    const historyStmt = db.prepare('SELECT status, created_at FROM order_status_history WHERE order_id = ? ORDER BY id');
    const orders = rows.map(o => ({
      id: o.id,
      order_number: o.order_number,
      created_at: o.created_at,
      items: JSON.parse(o.items || '[]'),
      subtotal: o.subtotal,
      discount_amount: o.discount_amount,
      bonus_used: o.bonus_used,
      delivery_price: o.delivery_price,
      total_price: o.total_price,
      status: o.status,
      status_label: orderStatus.label(o.status),
      payment_status: o.payment_status,
      paid_at: o.paid_at,
      delivery_method: o.delivery_method,
      delivery_address: o.delivery_address,
      delivery_type: o.delivery_type,
      tracking_number: o.tracking_number,
      tracking_url: o.tracking_number && o.delivery_provider === 'cdek'
        ? `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(o.tracking_number)}`
        : null,
      shipment_status: o.shipment_status,
      history: historyStmt.all(o.id).map(h => ({ ...h, label: orderStatus.label(h.status) }))
    }));

    // Статусы доставки, которые давно не обновлялись, подтягиваем из СДЭК в фоне
    rows.filter(o => o.shipment_uuid && !['delivered', 'completed', 'cancelled', 'returned'].includes(o.status))
      .filter(o => !o.shipment_synced_at || Date.now() - Date.parse(`${o.shipment_synced_at.replace(' ', 'T')}Z`) > 15 * 60 * 1000)
      .forEach(o => cdekShipments.syncShipment(o.id).catch(err => console.warn('CDEK sync (account):', err.message)));

    res.json({ orders });
  } catch (err) {
    console.error('Error fetching customer orders:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/customers/purchased-items — Returns ONLY items and orders purchased by this customer
router.get('/purchased-items', requireCustomer, (req, res) => {
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
            order_number: order.order_number,
            purchase_date: order.created_at
          });
        }
      });

      if (items.length >= 1) {
        purchasedOrders.push({
          order_id: order.id,
          order_number: order.order_number,
          item_count: items.length,
          total_price: order.total_price,
          purchase_date: order.created_at,
          summary: items.map(i => i.title).join(', ')
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
    console.error('Error fetching purchased items:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/customers/activate-promo — Activate a promo code in customer account
router.post('/activate-promo', requireCustomer, (req, res) => {
  try {
    const { code } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ error: 'Введите промокод' });
    }

    const cleanCode = code.trim().toUpperCase();
    const promo = db.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = ?').get(cleanCode);

    if (!promo || !promo.is_active) {
      return res.status(400).json({ error: 'Промокод недействителен или истек' });
    }

    const currentDiscount = req.customer.personal_discount || 0;
    const newDiscount = Math.max(currentDiscount, promo.discount_percent);

    db.prepare(`
      UPDATE customers 
      SET personal_discount = ?, bonus_points = bonus_points + 50
      WHERE id = ?
    `).run(newDiscount, req.customer.id);

    // Increment uses
    db.prepare('UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = ?').run(promo.id);

    res.json({
      success: true,
      new_discount: newDiscount,
      message: `Промокод «${promo.code}» успешно активирован! Ваша скидка: ${newDiscount}%, начислено 50 бонусов.`
    });
  } catch (err) {
    console.error('Error activating promo for customer:', err);
    res.status(500).json({ error: 'Ошибка активации промокода' });
  }
});

module.exports = {
  router,
  requireCustomer,
  optionalCustomer
};
