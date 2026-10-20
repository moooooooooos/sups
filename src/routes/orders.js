const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendTelegramMessage, formatOrderNotification } = require('../services/telegram');
const { optionalCustomer } = require('./customers');
const yookassa = require('../services/yookassa');
const delivery = require('../services/delivery');
const contacts = require('../services/contacts');

function setting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== '' ? row.value : fallback;
}

function getTierInfo(totalSpent) {
  if (totalSpent >= 50000) return { discount: 15, cashbackPct: 12 };
  if (totalSpent >= 25000) return { discount: 10, cashbackPct: 10 };
  if (totalSpent >= 10000) return { discount: 5, cashbackPct: 7 };
  return { discount: 0, cashbackPct: 5 };
}

// POST /api/orders (Create new order from checkout)
router.post('/', optionalCustomer, async (req, res) => {
  try {
    const {
      customer_name,
      customer_phone,
      customer_email,
      delivery_address,
      delivery: deliverySelection,
      comment,
      items,
      use_bonuses = false,
      offer_accepted = false,
      pd_consent = false,
      device = null
    } = req.body;

    if (offer_accepted !== true || pd_consent !== true) {
      return res.status(400).json({ error: 'Подтвердите согласие с офертой и на обработку персональных данных' });
    }

    if (!customer_name || !String(customer_name).trim()) {
      return res.status(400).json({ error: 'Пожалуйста, укажите имя' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Корзина пуста' });
    }

    // Контакты: только реальный мобильный номер и email с существующим почтовым доменом
    const phoneNormalized = contacts.normalizePhone(customer_phone);
    if (!phoneNormalized) {
      return res.status(400).json({ error: 'Укажите мобильный номер в формате +7 9XX XXX-XX-XX', field: 'phone' });
    }
    const emailCheck = await contacts.checkEmail(customer_email);
    if (!emailCheck.ok) {
      return res.status(400).json({ error: emailCheck.error, field: 'email' });
    }
    const phoneClean = contacts.formatPhone(phoneNormalized);
    const emailClean = emailCheck.email;

    // Calculate subtotal
    let subtotal = 0;
    items.forEach(item => {
      const p = parseFloat(item.price) || 0;
      const q = parseInt(item.quantity) || 1;
      subtotal += p * q;
    });

    let customerId = req.customer ? req.customer.id : null;
    let customerObj = req.customer || null;

    // Try finding customer by email or phone if not logged in
    if (!customerObj) {
      customerObj = db.prepare("SELECT * FROM customers WHERE (email = ? AND email != '') OR (phone = ? AND phone != '') OR (phone = ? AND phone != '')")
        .get(emailClean, phoneClean, String(customer_phone).trim());
      if (customerObj) customerId = customerObj.id;
    }

    let discountAmount = 0;
    let bonusUsed = 0;

    // Apply customer personal discount if available
    if (customerObj && customerObj.personal_discount > 0) {
      discountAmount = Math.round((subtotal * customerObj.personal_discount) / 100);
    }

    let payableSubtotal = Math.max(0, subtotal - discountAmount);

    // Apply bonus points if requested
    if (use_bonuses && customerObj && customerObj.bonus_points > 0) {
      bonusUsed = Math.min(customerObj.bonus_points, Math.floor(payableSubtotal * 0.5)); // max 50% paid with bonuses
      payableSubtotal -= bonusUsed;
    }

    // Доставка проверяется у перевозчика, цена считается здесь, а не берётся из браузера
    const itemsCount = items.reduce((n, item) => n + (parseInt(item.quantity, 10) || 1), 0);
    const providers = delivery.enabledProviders();
    let shipping;
    if (providers.cdek || providers.yandex) {
      try {
        shipping = await delivery.resolveSelection(deliverySelection, itemsCount, subtotal);
      } catch (shipErr) {
        console.error('Delivery check error:', shipErr.message);
        return res.status(502).json({ error: 'Не удалось проверить доставку, попробуйте ещё раз через минуту', field: 'delivery' });
      }
      if (!shipping.ok) return res.status(400).json({ error: shipping.error, field: 'delivery' });
    } else {
      // Перевозчики ещё не подключены: адрес вручную, цена из настроек
      const addressText = String(delivery_address || '').trim();
      if (addressText.length < 10 || !/\d/.test(addressText)) {
        return res.status(400).json({ error: 'Укажите полный адрес доставки: город, улица, дом', field: 'delivery' });
      }
      shipping = {
        provider: null, type: null, point_id: null, city_code: null,
        price: parseFloat(setting('delivery_cdek_pvz', '350')) || 0,
        method_label: 'СДЭК', address_text: addressText.slice(0, 300)
      };
    }

    const freeThreshold = parseFloat(setting('free_delivery_threshold', '7000')) || 0;
    const deliv = freeThreshold && payableSubtotal >= freeThreshold ? 0 : shipping.price;
    const delivery_method = shipping.method_label;
    const deliveryAddress = shipping.address_text;
    const total_price = payableSubtotal + deliv;

    // Generate Order Number: SUPS-YYYYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const order_number = `SUPS-${dateStr}-${randSuffix}`;

    const stmt = db.prepare(`
      INSERT INTO orders (
        order_number, customer_id, customer_name, customer_phone, customer_email,
        delivery_method, delivery_address, comment, items,
        subtotal, delivery_price, bonus_used, discount_amount, total_price, status, pd_consent_at, device,
        delivery_provider, delivery_type, delivery_point_id, delivery_city_code
      ) VALUES (
        @order_number, @customer_id, @customer_name, @customer_phone, @customer_email,
        @delivery_method, @delivery_address, @comment, @items,
        @subtotal, @delivery_price, @bonus_used, @discount_amount, @total_price, 'new', datetime('now'), @device,
        @delivery_provider, @delivery_type, @delivery_point_id, @delivery_city_code
      )
    `);

    const result = stmt.run({
      order_number,
      customer_id: customerId,
      customer_name: customer_name.trim(),
      customer_phone: phoneClean,
      customer_email: emailClean,
      delivery_method,
      delivery_address: deliveryAddress,
      delivery_provider: shipping.provider,
      delivery_type: shipping.type,
      delivery_point_id: shipping.point_id,
      delivery_city_code: shipping.city_code,
      comment: comment ? comment.trim() : '',
      items: JSON.stringify(items),
      subtotal,
      delivery_price: deliv,
      bonus_used: bonusUsed,
      discount_amount: discountAmount,
      total_price,
      device: ['mobile', 'tablet', 'desktop'].includes(device) ? device : null
    });

    // Update customer stats & bonus points
    if (customerObj) {
      const tier = getTierInfo(customerObj.total_spent + total_price);
      const earnedBonuses = Math.floor((total_price * tier.cashbackPct) / 100);
      const newBonusBalance = Math.max(0, customerObj.bonus_points - bonusUsed) + earnedBonuses;
      const newTotalSpent = customerObj.total_spent + total_price;

      db.prepare(`
        UPDATE customers 
        SET bonus_points = ?, total_spent = ?, personal_discount = ?
        WHERE id = ?
      `).run(newBonusBalance, newTotalSpent, Math.max(customerObj.personal_discount, tier.discount), customerObj.id);
    }

    const newOrder = {
      id: result.lastInsertRowid,
      order_number,
      customer_name,
      customer_phone: phoneClean,
      customer_email: emailClean,
      delivery_method,
      delivery_address: deliveryAddress,
      comment,
      items,
      subtotal,
      delivery_price: deliv,
      bonus_used: bonusUsed,
      discount_amount: discountAmount,
      total_price,
      status: 'new'
    };

    // Send Telegram Notification in background (non-blocking)
    try {
      const msg = formatOrderNotification(newOrder);
      sendTelegramMessage(msg).catch(err => {
        console.warn('Telegram notification async error:', err.message);
      });
    } catch (tgErr) {
      console.warn('Telegram formatting error:', tgErr);
    }
    // Initialize YooKassa payment session
    const host = req.get('host');
    const protocol = req.protocol;
    const returnUrl = `${protocol}://${host}/order-status.html?order_number=${encodeURIComponent(order_number)}`;

    let paymentUrl = null;
    try {
      const payRes = await yookassa.createPayment({
        order: {
          id: result.lastInsertRowid,
          order_number,
          total_price,
          customer_name,
          customer_phone: phoneClean,
          customer_email: emailClean,
          delivery_method,
          delivery_price: deliv,
          items
        },
        returnUrl
      });
      paymentUrl = payRes.confirmationUrl;
    } catch (payErr) {
      console.warn('Payment init warning:', payErr.message);
    }

    res.status(201).json({
      success: true,
      order_number,
      order_id: result.lastInsertRowid,
      payment_url: paymentUrl,
      bonus_earned: customerObj ? Math.floor((total_price * getTierInfo(customerObj.total_spent).cashbackPct) / 100) : 0,
      message: 'Заказ успешно оформлен!'
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ error: 'Ошибка сервера при оформлении заказа' });
  }
});

module.exports = router;
