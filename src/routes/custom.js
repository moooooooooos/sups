const express = require('express');
const router = express.Router();
const { sendTelegramPhoto } = require('../services/telegram');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const recentByIp = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const hits = (recentByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recentByIp.set(ip, hits);
  if (recentByIp.size > 5000) {
    for (const [key, times] of recentByIp) {
      if (!times.some((t) => now - t < RATE_WINDOW_MS)) recentByIp.delete(key);
    }
  }
  return hits.length > RATE_MAX;
}

function escapeHtml(value, maxLen = 200) {
  return String(value ?? '')
    .slice(0, maxLen)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// POST /api/custom/preview — notify the shop about a custom ring added to cart
router.post('/preview', async (req, res) => {
  try {
    if (isRateLimited(req.ip)) {
      return res.status(429).json({ error: 'Слишком много запросов' });
    }

    const { image, model, metal, size, outTexts, inTexts, removeWatermark, price } = req.body || {};
    const match = typeof image === 'string' && image.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Некорректное изображение' });
    }
    const photo = Buffer.from(match[1], 'base64');
    if (photo.length === 0 || photo.length > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: 'Некорректный размер изображения' });
    }

    let caption = `💍 <b>НОВЫЙ ЗАКАЗ В КОРЗИНУ (CAD КАСТОМ)</b>\n\n`;
    caption += `🏷 <b>Изделие:</b> ${escapeHtml(model, 100)}\n`;
    caption += `✨ <b>Металл:</b> ${escapeHtml(metal, 100)}\n`;
    caption += `📏 <b>Размер:</b> ${escapeHtml(size, 20)} р-р\n`;
    if (outTexts) caption += `✍️ <b>Гравировка снаружи:</b> ${escapeHtml(outTexts, 250)}\n`;
    if (inTexts) caption += `🔒 <b>Гравировка внутри:</b> ${escapeHtml(inTexts, 250)}\n`;
    caption += `⚙️ <b>Лого внутри:</b> ${removeWatermark ? 'Убрано (+500 ₽)' : 'Сохранено'}\n`;
    caption += `💰 <b>Сумма:</b> ${Number(price) || 0} ₽`;

    const sent = await sendTelegramPhoto(photo, caption, 'custom-ring.png');
    res.json({ success: sent });
  } catch (err) {
    console.error('[Custom preview] Error:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
