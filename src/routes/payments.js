const express = require('express');
const router = express.Router();
const db = require('../db');
const yookassa = require('../services/yookassa');

// POST /api/payments/create — Create YooKassa payment session
router.post('/create', async (req, res) => {
  try {
    const { order_number } = req.body;
    if (!order_number) {
      return res.status(400).json({ error: 'Не указан номер заказа' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(order_number);
    if (!order) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    if (order.status === 'paid' || order.payment_status === 'paid') {
      return res.json({
        success: true,
        already_paid: true,
        confirmation_url: `/order-status.html?order_number=${encodeURIComponent(order_number)}`
      });
    }

    // Determine return URL
    const host = req.get('host');
    const protocol = req.protocol;
    const returnUrl = `${protocol}://${host}/order-status.html?order_number=${encodeURIComponent(order_number)}`;

    const paymentResult = await yookassa.createPayment({ order, returnUrl });

    res.json({
      success: true,
      payment_id: paymentResult.paymentId,
      confirmation_url: paymentResult.confirmationUrl,
      is_test: paymentResult.isTest
    });

  } catch (err) {
    console.error('Payment creation error:', err);
    res.status(500).json({ error: err.message || 'Ошибка инициализации оплаты' });
  }
});

// POST /api/payments/webhook — YooKassa Webhook Endpoint
router.post('/webhook', async (req, res) => {
  try {
    const result = await yookassa.handleWebhook(req.body);
    // YooKassa requires 200 HTTP code
    res.status(200).json(result);
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(200).json({ error: err.message });
  }
});

// POST /api/payments/test-confirm — Simulator button confirmation
router.post('/test-confirm', async (req, res) => {
  try {
    const { order_number } = req.body;
    if (!order_number) {
      return res.status(400).json({ error: 'Не указан номер заказа' });
    }

    const result = await yookassa.confirmTestPayment(order_number);
    res.json({ success: true, message: 'Оплата успешно подтверждена', ...result });
  } catch (err) {
    console.error('Test payment confirmation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/*
 * Страница статуса открывается по номеру заказа без входа, а номер легко подобрать
 * (дата + 4 цифры). Поэтому персональные данные отдаём только в замаскированном виде.
 */
function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return [parts[0], ...parts.slice(1).map(p => `${p[0]}.`)].join(' ');
}

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 4 ? `+7 (***) ***-${d.slice(-4, -2)}-${d.slice(-2)}` : '';
}

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return '';
  return `${user[0]}***@${domain}`;
}

// Пункт выдачи — публичный адрес; адрес курьерской доставки показываем только до города
function publicAddress(order) {
  if (order.delivery_type === 'pvz') return order.delivery_address;
  const city = String(order.delivery_address || '').split(',')[0].trim();
  return city ? `${city}, адрес скрыт` : '';
}

// GET /api/payments/status/:order_number — Check status for order-status page
router.get('/status/:order_number', (req, res) => {
  try {
    const { order_number } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(order_number);
    if (!order) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    let parsedItems = [];
    try {
      parsedItems = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
    } catch (e) {}

    res.json({
      order_number: order.order_number,
      status: order.status,
      payment_status: order.payment_status || 'pending',
      payment_method: order.payment_method || 'yookassa',
      total_price: order.total_price,
      customer_name: maskName(order.customer_name),
      customer_phone: maskPhone(order.customer_phone),
      customer_email: maskEmail(order.customer_email),
      delivery_method: order.delivery_method,
      delivery_address: publicAddress(order),
      items: parsedItems,
      paid_at: order.paid_at,
      created_at: order.created_at
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка получения статуса заказа' });
  }
});

module.exports = router;
