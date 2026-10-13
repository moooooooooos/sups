const https = require('https');
const db = require('../db');

function getSetting(key, defaultValue = '') {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  } catch (err) {
    return defaultValue;
  }
}

async function sendTelegramMessage(text) {
  const token = getSetting('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN);
  const chatId = getSetting('telegram_chat_id', process.env.TELEGRAM_CHAT_ID);
  const enabled = getSetting('telegram_notifications_enabled', '1');

  if (!enabled || enabled === '0' || !token || !chatId) {
    console.log('[Telegram] Notifications disabled or token/chatId not configured');
    return false;
  }

  const payload = JSON.stringify({
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });

  return new Promise((resolve) => {
    const req = https.request(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 6000
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[Telegram] Notification sent successfully');
            resolve(true);
          } else {
            console.warn('[Telegram] API error:', res.statusCode, responseData);
            resolve(false);
          }
        });
      }
    );

    req.on('error', (err) => {
      console.error('[Telegram] Request failed:', err.message);
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn('[Telegram] Request timeout');
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

function formatOrderNotification(order) {
  const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');

  let msg = `🛍 <b>НОВЫЙ ЗАКАЗ #${order.order_number}</b>\n\n`;
  msg += `👤 <b>Клиент:</b> ${order.customer_name}\n`;
  msg += `📞 <b>Телефон:</b> ${order.customer_phone}\n`;
  if (order.customer_email) msg += `✉️ <b>Email:</b> ${order.customer_email}\n`;
  msg += `🚚 <b>Доставка:</b> ${order.delivery_method || 'СДЭК'} (${order.delivery_price || 0} ₽)\n`;
  if (order.delivery_address) msg += `📍 <b>Адрес:</b> ${order.delivery_address}\n`;
  if (order.comment) msg += `💬 <b>Комментарий:</b> ${order.comment}\n`;

  msg += `\n📦 <b>Состав заказа:</b>\n`;
  items.forEach((item, idx) => {
    msg += `${idx + 1}. <b>${item.title}</b>`;
    if (item.size) msg += ` (Размер: ${item.size})`;
    msg += ` — ${item.quantity || 1} шт. × ${item.price} ₽\n`;

    // If custom 3D ring details exist
    if (item.is_custom || item.custom_details) {
      const cd = item.custom_details || {};
      msg += `   ⚙️ <i>Кастом:</i> Металл: ${cd.metal || 'Сталь'}, Текст: "${cd.text || '-'}", Шрифт: ${cd.font || '-'}\n`;
      if (cd.imageUrl) msg += `   🖼 <i>Рисунок:</i> ${cd.imageUrl}\n`;
    }
  });

  msg += `\n💰 <b>Итого к оплате:</b> <b>${order.total_price} ₽</b>`;
  return msg;
}

module.exports = {
  sendTelegramMessage,
  formatOrderNotification
};
