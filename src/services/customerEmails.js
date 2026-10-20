/**
 * Письма покупателю о заказе: оплачен, передан в доставку (с трек-номером), ждёт в пункте выдачи,
 * получен, отменён. Отправляются в фоне по истории статусов (order_status_history), поэтому
 * не важно, кто сменил статус — ЮKassa, админка или синхронизация со СДЭК.
 * Каждое письмо уходит один раз (таблица order_emails).
 *
 * Настройки SMTP — в админке («Настройки» → «Письма покупателям»), по умолчанию почта Beget:
 *   smtp_host (smtp.beget.com), smtp_port (465), smtp_user, smtp_password, mail_from_name, emails_enabled.
 * Для локальной проверки без SMTP: MAIL_OUTBOX_DIR=<папка> — письма сохраняются туда файлами .eml.
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS order_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    error TEXT,
    UNIQUE(order_id, kind)
  );
`);

const KINDS = {
  paid: {
    subject: n => `Заказ ${n} оплачен`,
    title: 'Спасибо, оплата получена!',
    text: 'Мы уже собираем ваш заказ. Как только передадим его в доставку, пришлём трек-номер.'
  },
  shipped: {
    subject: n => `Заказ ${n} передан в доставку`,
    title: 'Заказ в пути',
    text: 'Мы передали заказ в службу доставки. Отслеживать его можно по трек-номеру ниже.'
  },
  ready_for_pickup: {
    subject: n => `Заказ ${n} ждёт вас в пункте выдачи`,
    title: 'Заказ прибыл в пункт выдачи',
    text: 'Заберите его, пожалуйста, в течение срока хранения. При получении понадобится код из SMS службы доставки или паспорт.'
  },
  delivered: {
    subject: n => `Заказ ${n} получен — спасибо!`,
    title: 'Заказ получен',
    text: 'Надеемся, украшение станет вашим смысловым акцентом. Будем рады вашему отзыву — это помогает другим покупателям.'
  },
  cancelled: {
    subject: n => `Заказ ${n} отменён`,
    title: 'Заказ отменён',
    text: 'Если заказ был оплачен, деньги вернутся на карту в течение 10 дней. Если это ошибка — просто ответьте на это письмо.'
  }
};

function setting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== '' ? String(row.value).trim() : fallback;
}

function smtpConfig() {
  return {
    enabled: setting('emails_enabled', '0') === '1',
    host: setting('smtp_host', 'smtp.beget.com'),
    port: parseInt(setting('smtp_port', '465'), 10) || 465,
    user: setting('smtp_user'),
    pass: setting('smtp_password'),
    fromName: setting('mail_from_name', 'САПС')
  };
}

function isConfigured() {
  const c = smtpConfig();
  return Boolean(c.enabled && c.user && c.pass);
}

function transport() {
  if (process.env.MAIL_OUTBOX_DIR) {
    return nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  }
  const c = smtpConfig();
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 15000
  });
}

async function send({ to, subject, html, text }) {
  const c = smtpConfig();
  const info = await transport().sendMail({
    from: { name: c.fromName, address: c.user || 'shop@localhost' },
    to,
    subject,
    html,
    text
  });
  if (process.env.MAIL_OUTBOX_DIR && info.message) {
    fs.mkdirSync(process.env.MAIL_OUTBOX_DIR, { recursive: true });
    const file = path.join(process.env.MAIL_OUTBOX_DIR, `${Date.now()}-${subject.replace(/[^\wа-яё-]+/gi, '_').slice(0, 60)}.eml`);
    fs.writeFileSync(file, info.message);
  }
  return info;
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function rub(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} ₽`;
}

function siteUrl() {
  return (process.env.SITE_URL || '').replace(/\/$/, '');
}

function trackingUrl(order) {
  return order.tracking_number && order.delivery_provider === 'cdek'
    ? `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(order.tracking_number)}`
    : '';
}

// Письмо: HTML с таблицами (почтовые клиенты) и текстовая версия
function render(order, kind) {
  const k = KINDS[kind];
  const items = JSON.parse(order.items || '[]');
  const site = siteUrl();
  const track = trackingUrl(order);
  const firstName = String(order.customer_name || '').trim().split(/\s+/)[0];
  // «Иван, мы передали…» — после обращения фраза со строчной буквы
  const lead = firstName ? `${firstName}, ${k.text.charAt(0).toLowerCase()}${k.text.slice(1)}` : k.text;

  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;">
        ${esc(i.title)}${i.size ? `, размер ${esc(i.size)}` : ''}${i.color ? `, ${esc(i.color)}` : ''}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap;">
        ${i.quantity || 1} × ${rub(i.price)}
      </td>
    </tr>`).join('');

  const html = `<!doctype html>
<html lang="ru"><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#000;color:#fff;padding:20px 28px;font-size:22px;font-weight:bold;letter-spacing:2px;">САПС</td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 6px;font-size:13px;color:#888;">Заказ ${esc(order.order_number)}</p>
          <h1 style="margin:0 0 14px;font-size:22px;">${esc(k.title)}</h1>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.5;">${esc(lead)}</p>
          ${track && ['shipped', 'ready_for_pickup'].includes(kind) ? `
          <p style="margin:0 0 18px;font-size:15px;">Трек-номер: <b>${esc(order.tracking_number)}</b><br>
            <a href="${esc(track)}" style="color:#000;font-weight:bold;">Отследить посылку →</a></p>` : ''}
          <p style="margin:0 0 6px;font-size:14px;color:#555;">Доставка: ${esc(order.delivery_method || '')}</p>
          <p style="margin:0 0 18px;font-size:14px;color:#555;">${esc(order.delivery_address || '')}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${rows}
            <tr><td style="padding:8px 0;font-size:14px;">Доставка</td><td style="padding:8px 0;font-size:14px;text-align:right;">${order.delivery_price ? rub(order.delivery_price) : 'бесплатно'}</td></tr>
            <tr><td style="padding:8px 0;font-size:16px;font-weight:bold;">Итого</td><td style="padding:8px 0;font-size:16px;font-weight:bold;text-align:right;">${rub(order.total_price)}</td></tr>
          </table>
          ${site ? `<p style="margin:22px 0 0;"><a href="${esc(site)}/account" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;">Заказы в личном кабинете</a></p>` : ''}
          ${kind === 'delivered' && site ? `<p style="margin:14px 0 0;"><a href="${esc(site)}/leave-review?order_id=${order.id}" style="color:#000;font-weight:bold;">Оставить отзыв →</a></p>` : ''}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#fafafa;font-size:12px;color:#888;line-height:1.5;">
          Вопросы по заказу — ответьте на это письмо или напишите в Telegram @sups_steel.<br>
          ИП Богданов Роман Николаевич · ОГРНИП 324861700088491 · ИНН 450126517632
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `САПС — заказ ${order.order_number}`,
    '',
    k.title,
    lead,
    track && ['shipped', 'ready_for_pickup'].includes(kind) ? `\nТрек-номер: ${order.tracking_number}\nОтследить: ${track}` : '',
    '',
    ...items.map(i => `— ${i.title}${i.size ? `, размер ${i.size}` : ''}${i.color ? `, ${i.color}` : ''}: ${i.quantity || 1} × ${rub(i.price)}`),
    `Доставка: ${order.delivery_method || ''}, ${order.delivery_price ? rub(order.delivery_price) : 'бесплатно'}`,
    `Итого: ${rub(order.total_price)}`,
    site ? `\nЛичный кабинет: ${site}/account` : '',
    '',
    'Вопросы — ответьте на это письмо или Telegram @sups_steel.'
  ].filter(line => line !== null).join('\n');

  return { subject: k.subject(order.order_number), html, text };
}

/**
 * Отправить письма по новым событиям статуса. Только события после включения писем
 * (emails_enabled_at), чтобы при первом включении не разослать письма по старым заказам.
 */
let running = false;
async function processQueue() {
  if (running || (!isConfigured() && !process.env.MAIL_OUTBOX_DIR)) return 0;
  running = true;
  let sent = 0;
  try {
    const since = setting('emails_enabled_at', '1970-01-01 00:00:00');
    const events = db.prepare(`
      SELECT h.order_id, h.status, MAX(h.created_at) AS at
      FROM order_status_history h
      JOIN orders o ON o.id = h.order_id
      WHERE h.created_at >= ? AND h.status IN (${Object.keys(KINDS).map(() => '?').join(',')})
        AND o.customer_email IS NOT NULL AND o.customer_email != ''
        AND NOT EXISTS (SELECT 1 FROM order_emails e WHERE e.order_id = h.order_id AND e.kind = h.status)
      GROUP BY h.order_id, h.status
      ORDER BY at
      LIMIT 20
    `).all(since, ...Object.keys(KINDS));

    for (const ev of events) {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(ev.order_id);
      // Статус успел смениться дальше (например, сразу «получен») — промежуточное письмо не шлём
      const stillRelevant = order.status === ev.status || (ev.status === 'paid' && order.payment_status === 'paid');
      if (!stillRelevant) {
        db.prepare('INSERT OR IGNORE INTO order_emails (order_id, kind, error) VALUES (?, ?, ?)').run(ev.order_id, ev.status, 'skipped: status changed');
        continue;
      }
      // Письмо «передан в доставку» ждёт трек-номер (до 6 часов), чтобы в нём было что отслеживать
      if (ev.status === 'shipped' && !order.tracking_number && Date.now() - Date.parse(`${ev.at.replace(' ', 'T')}Z`) < 6 * 3600 * 1000) continue;

      try {
        await send({ to: order.customer_email, ...render(order, ev.status) });
        db.prepare('INSERT OR IGNORE INTO order_emails (order_id, kind) VALUES (?, ?)').run(order.id, ev.status);
        sent++;
      } catch (err) {
        console.warn(`[Email] ${order.order_number} ${ev.status}:`, err.message);
        break; // SMTP недоступен — попробуем в следующий проход
      }
    }
  } finally {
    running = false;
  }
  return sent;
}

function startWorker() {
  setInterval(() => processQueue().catch(err => console.warn('[Email] queue:', err.message)), 60 * 1000).unref();
}

// Тестовое письмо из админки: проверяет SMTP-настройки
async function sendTest(to) {
  const c = smtpConfig();
  if (!c.user || !c.pass) throw new Error('Укажите адрес и пароль почты отправителя');
  await transport().verify().catch(err => { throw new Error(`SMTP не принимает подключение: ${err.message}`); });
  await send({
    to,
    subject: 'Тестовое письмо магазина САПС',
    text: 'Если вы читаете это письмо — отправка писем покупателям настроена правильно.',
    html: '<p>Если вы читаете это письмо — отправка писем покупателям настроена правильно.</p>'
  });
}

module.exports = { processQueue, startWorker, sendTest, render, isConfigured, KINDS };
