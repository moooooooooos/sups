const crypto = require('crypto');
const db = require('../db');
const { sendTelegramMessage } = require('./telegram');

function getYooKassaConfig() {
  const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'yookassa_%'").all();
  const config = {
    shopId: process.env.YOOKASSA_SHOP_ID || '',
    secretKey: process.env.YOOKASSA_SECRET_KEY || '',
    testMode: '1'
  };

  settingsRows.forEach(row => {
    if (row.key === 'yookassa_shop_id' && row.value) config.shopId = row.value.trim();
    if (row.key === 'yookassa_secret_key' && row.value) config.secretKey = row.value.trim();
    if (row.key === 'yookassa_test_mode') config.testMode = row.value;
  });

  return config;
}

/**
 * Create a new payment via YooKassa API v3
 */
async function createPayment({ order, returnUrl }) {
  const config = getYooKassaConfig();
  const isConfigured = config.shopId && config.secretKey;

  // If live/sandbox credentials are configured in admin panel
  if (isConfigured) {
    try {
      const authStr = Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64');
      const idempotenceKey = `order_${order.order_number}_${Date.now()}`;

      // Build receipt items according to 54-FZ
      let orderItems = [];
      try {
        orderItems = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
      } catch (e) {
        orderItems = [];
      }

      const receiptItems = orderItems.map(item => ({
        description: (item.title || 'Изделие САПС').slice(0, 128),
        quantity: (item.quantity || 1).toFixed(2),
        amount: {
          value: parseFloat(item.price || 0).toFixed(2),
          currency: 'RUB'
        },
        vat_code: 1, // Без НДС / УСН
        payment_subject: 'commodity',
        payment_mode: 'full_prepayment'
      }));

      // Add delivery as receipt item if applicable
      if (order.delivery_price && order.delivery_price > 0) {
        receiptItems.push({
          description: `Доставка (${order.delivery_method || 'СДЭК'})`,
          quantity: '1.00',
          amount: {
            value: parseFloat(order.delivery_price).toFixed(2),
            currency: 'RUB'
          },
          vat_code: 1,
          payment_subject: 'service',
          payment_mode: 'full_prepayment'
        });
      }

      const payload = {
        amount: {
          value: parseFloat(order.total_price).toFixed(2),
          currency: 'RUB'
        },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: returnUrl
        },
        description: `Оплата заказа ${order.order_number} в магазине концептуальных украшений САПС`,
        metadata: {
          order_number: order.order_number,
          order_id: String(order.id)
        }
      };

      // Include receipt if customer email or phone is present
      if (order.customer_email || order.customer_phone) {
        payload.receipt = {
          customer: {
            email: order.customer_email ? order.customer_email.trim() : undefined,
            phone: order.customer_phone ? order.customer_phone.replace(/[^0-9+]/g, '') : undefined
          },
          items: receiptItems
        };
      }

      const response = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotence-Key': idempotenceKey,
          'Authorization': `Basic ${authStr}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('YooKassa API error:', data);
        throw new Error(data.description || 'Ошибка платёжного шлюза ЮKassa');
      }

      // Update order in DB
      db.prepare(`
        UPDATE orders 
        SET payment_id = ?, payment_status = 'pending', payment_method = 'yookassa'
        WHERE id = ?
      `).run(data.id, order.id);

      return {
        success: true,
        paymentId: data.id,
        confirmationUrl: data.confirmation.confirmation_url,
        isTest: config.testMode === '1'
      };

    } catch (err) {
      // С боевыми ключами симулятор не подставляем: иначе заказ «оплачивался» бы без денег
      console.error('YooKassa live call failed:', err.message);
      throw err;
    }
  }

  // Simulated Test Payment Mode (zero-config, works right away!)
  const testPaymentId = 'test_pay_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  db.prepare(`
    UPDATE orders 
    SET payment_id = ?, payment_status = 'pending', payment_method = 'yookassa_test'
    WHERE id = ?
  `).run(testPaymentId, order.id);

  const testConfirmUrl = `/test-payment.html?order_number=${encodeURIComponent(order.order_number)}&amount=${order.total_price}&payment_id=${testPaymentId}`;

  return {
    success: true,
    paymentId: testPaymentId,
    confirmationUrl: testConfirmUrl,
    isTest: true
  };
}

/**
 * Handle incoming Webhook from YooKassa
 */
// Платёж из API ЮKassa (а не из тела уведомления, которое может прислать кто угодно)
async function fetchPayment(paymentId, config) {
  const authStr = Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64');
  const res = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
    headers: { 'Authorization': `Basic ${authStr}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`ЮKassa не подтвердила платёж (${res.status})`);
  return res.json();
}

async function handleWebhook(body) {
  if (!body || !body.event || !body.object || !body.object.id) {
    return { success: false, error: 'Invalid webhook payload' };
  }

  const config = getYooKassaConfig();
  if (!(config.shopId && config.secretKey)) {
    return { success: false, error: 'YooKassa is not configured' };
  }

  const paymentId = String(body.object.id);
  const payment = await fetchPayment(paymentId, config);
  const object = payment;
  const event = payment.status === 'succeeded' ? 'payment.succeeded'
    : payment.status === 'canceled' ? 'payment.canceled' : 'payment.' + payment.status;

  // Заказ ищем только по id платежа, который мы сами сохранили при создании
  const order = db.prepare('SELECT * FROM orders WHERE payment_id = ?').get(paymentId);
  if (!order) {
    console.warn(`[YooKassa Webhook] Order not found for payment ${paymentId}`);
    return { success: false, error: 'Order not found' };
  }

  const paidValue = parseFloat(payment.amount && payment.amount.value);
  if (event === 'payment.succeeded' && Math.abs(paidValue - Number(order.total_price)) > 0.009) {
    console.error(`[YooKassa Webhook] Amount mismatch for ${order.order_number}: paid ${paidValue}, expected ${order.total_price}`);
    return { success: false, error: 'Amount mismatch' };
  }

  if (event === 'payment.succeeded') {
    db.prepare(`
      UPDATE orders 
      SET status = 'paid', payment_status = 'paid', paid_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(order.id);

    // Send Telegram Notification
    try {
      const msg = `💳 *ОПЛАТА ПОЛУЧЕНА (ЮKassa)*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📦 *Заказ:* \`${order.order_number}\`\n` +
        `💰 *Сумма:* ${order.total_price.toLocaleString('ru-RU')} ₽\n` +
        `🚚 *Доставка:* ${order.delivery_method}\n` +
        `🆔 *ID платежа:* \`${paymentId}\`\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `✅ Заказ переведен в статус *Оплачен*`;

      await sendTelegramMessage(msg);
    } catch (e) {
      console.warn('Telegram send failed:', e.message);
    }

    return { success: true, status: 'paid' };
  }

  if (event === 'payment.canceled') {
    db.prepare(`
      UPDATE orders 
      SET payment_status = 'canceled', updated_at = datetime('now')
      WHERE id = ?
    `).run(order.id);
    return { success: true, status: 'canceled' };
  }

  return { success: true, status: object.status };
}

/**
 * Confirm test payment for simulator
 */
async function confirmTestPayment(orderNumber) {
  const config = getYooKassaConfig();
  if (config.shopId && config.secretKey) {
    throw new Error('Тестовая оплата отключена: подключена ЮKassa');
  }
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderNumber);
  if (!order) {
    throw new Error('Заказ не найден');
  }
  if (order.payment_method !== 'yookassa_test' || order.payment_status === 'paid') {
    throw new Error('Для этого заказа тестовая оплата недоступна');
  }

  db.prepare(`
    UPDATE orders 
    SET status = 'paid', payment_status = 'paid', paid_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(order.id);

  // Send Telegram Notification
  try {
    const msg = `💳 *ТЕСТОВАЯ ОПЛАТА ПОЛУЧЕНА*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📦 *Заказ:* \`${order.order_number}\`\n` +
      `💰 *Сумма:* ${order.total_price.toLocaleString('ru-RU')} ₽\n` +
      `🚚 *Доставка:* ${order.delivery_method}\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Заказ переведен в статус *Оплачен*`;

    await sendTelegramMessage(msg);
  } catch (e) {
    console.warn('Telegram send failed:', e.message);
  }

  return { success: true, order_number: order.order_number };
}

module.exports = {
  getYooKassaConfig,
  createPayment,
  handleWebhook,
  confirmTestPayment
};
