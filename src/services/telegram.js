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

function getTelegramConfig() {
  const token = getSetting('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN);
  const chatId = getSetting('telegram_chat_id', process.env.TELEGRAM_CHAT_ID);
  const enabled = getSetting('telegram_notifications_enabled', '1');

  if (!enabled || enabled === '0' || !token || !chatId) {
    console.log('[Telegram] Notifications disabled or token/chatId not configured');
    return null;
  }
  return { token, chatId };
}

async function sendTelegramMessage(text) {
  const config = getTelegramConfig();
  if (!config) return false;
  const { token, chatId } = config;

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

// Sends a photo (Buffer) with an HTML caption to the configured chat
async function sendTelegramPhoto(photoBuffer, caption, filename = 'photo.png') {
  const config = getTelegramConfig();
  if (!config) return false;
  const { token, chatId } = config;

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', new Blob([photoBuffer], { type: 'image/png' }), filename);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) {
      console.log('[Telegram] Photo sent successfully');
      return true;
    }
    console.warn('[Telegram] API error:', res.status, await res.text());
    return false;
  } catch (err) {
    console.error('[Telegram] Photo request failed:', err.message);
    return false;
  }
}

function escapeTg(value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Город из адреса доставки: «111024, Россия, Москва, …» или «Москва, ул. …» → «Москва»
function cityOf(address) {
  const parts = String(address || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.find(p => !/^\d+$/.test(p) && !/^россия$/i.test(p)) || '';
}

/**
 * Уведомление о заказе для чата магазина.
 * Персональных данных покупателя (имя, телефон, email, адрес, комментарий) здесь нет:
 * серверы Telegram за границей, это была бы трансграничная передача ПД (152-ФЗ).
 * Данные покупателя — в админке по номеру заказа.
 */
function formatOrderNotification(order) {
  const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');
  const city = cityOf(order.delivery_address);

  let msg = `🛍 <b>НОВЫЙ ЗАКАЗ #${escapeTg(order.order_number)}</b>\n\n`;
  msg += `🚚 <b>Доставка:</b> ${escapeTg(order.delivery_method || 'СДЭК')}${city ? `, ${escapeTg(city)}` : ''} (${order.delivery_price || 0} ₽)\n`;
  if (order.comment) msg += `💬 Есть комментарий покупателя — см. в админке\n`;

  msg += `\n📦 <b>Состав заказа:</b>\n`;
  items.forEach((item, idx) => {
    msg += `${idx + 1}. <b>${escapeTg(item.title)}</b>`;
    if (item.size) msg += ` (размер ${escapeTg(item.size)})`;
    if (item.color) msg += ` (${escapeTg(item.color)})`;
    msg += ` — ${item.quantity || 1} шт. × ${item.price} ₽\n`;
    if (item.is_custom) msg += `   ⚙️ <i>Кастомное изделие — детали в админке</i>\n`;
  });

  msg += `\n💰 <b>Итого:</b> <b>${order.total_price} ₽</b>`;
  if (process.env.SITE_URL) msg += `\n\n🔗 ${process.env.SITE_URL}/admin`;
  return msg;
}

module.exports = {
  sendTelegramMessage,
  sendTelegramPhoto,
  formatOrderNotification
};
