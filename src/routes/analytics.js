/**
 * Собственная веб-аналитика САПС.
 *
 * POST /api/analytics/collect — публичный приём событий с сайта (public/js/analytics.js).
 *   Хранятся только анонимные id визита/посетителя из браузера, путь страницы, тип устройства
 *   и источник перехода. IP-адреса и данные покупателей не сохраняются.
 * GET  /api/analytics/report — отчёт для админки (только для администратора).
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('./auth');

// Часовой пояс магазина (Екатеринбург, UTC+5): по нему режутся дни и периоды
const TZ = '+5 hours';
const TZ_BACK = '-5 hours';

const BOT_RE = /bot|crawl|spider|slurp|headless|preview|lighthouse|monitor/i;
const ID_RE = /^[a-z0-9-]{8,64}$/i;
const DEVICES = ['mobile', 'tablet', 'desktop'];

function cleanPath(value) {
  const path = String(value || '/').split('#')[0].slice(0, 300);
  return path.startsWith('/') ? path : '/';
}

// Источник визита: utm_source из адреса, домен внешнего сайта или «Прямые заходы»
function detectSource(path, referrer, host) {
  const utm = /[?&]utm_source=([^&#]+)/i.exec(path);
  if (utm) return decodeURIComponent(utm[1]).slice(0, 60).toLowerCase();
  if (!referrer) return 'direct';
  try {
    const refHost = new URL(referrer).hostname.replace(/^www\./, '');
    if (!refHost || refHost === String(host || '').split(':')[0].replace(/^www\./, '')) return 'direct';
    return refHost.slice(0, 80);
  } catch (e) {
    return 'direct';
  }
}

// Статистика хранится не дольше 2 лет (п. 6.2 Политики обработки ПД)
function purgeOldAnalytics() {
  try {
    db.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now', '-2 years')").run();
    db.prepare("DELETE FROM analytics_sessions WHERE last_seen_at < datetime('now', '-2 years')").run();
  } catch (err) {
    console.error('Analytics purge error:', err);
  }
}
purgeOldAnalytics();
setInterval(purgeOldAnalytics, 24 * 60 * 60 * 1000).unref();

const getSession = db.prepare('SELECT id FROM analytics_sessions WHERE id = ?');
const insertSession = db.prepare(`
  INSERT INTO analytics_sessions (id, visitor_id, device, source, landing_path)
  VALUES (@id, @visitor_id, @device, @source, @landing_path)
`);
const touchSession = db.prepare(`
  UPDATE analytics_sessions
  SET last_seen_at = datetime('now'), pageviews = pageviews + @pageview
  WHERE id = @id
`);
const insertEvent = db.prepare(`
  INSERT INTO analytics_events (session_id, type, path, product_id) VALUES (?, ?, ?, ?)
`);

router.post('/collect', (req, res) => {
  try {
    if (BOT_RE.test(req.get('user-agent') || '')) return res.status(204).end();

    const { v, s, t, path, ref, device, product_id } = req.body || {};
    if (!ID_RE.test(String(v || '')) || !ID_RE.test(String(s || ''))) return res.status(204).end();
    if (!['pageview', 'ping', 'product_view'].includes(t)) return res.status(204).end();

    const pagePath = cleanPath(path);
    const pageview = t === 'pageview' ? 1 : 0;

    db.transaction(() => {
      if (!getSession.get(s)) {
        // Визит начинается только с просмотра страницы, «пинги» без визита игнорируем
        if (!pageview) return;
        insertSession.run({
          id: s,
          visitor_id: v,
          device: DEVICES.includes(device) ? device : 'desktop',
          source: detectSource(pagePath, ref, req.get('host')),
          landing_path: pagePath.split('?')[0]
        });
      }
      touchSession.run({ id: s, pageview });
      if (t !== 'ping') {
        const pid = parseInt(product_id, 10);
        insertEvent.run(s, t, pagePath.split('?')[0], Number.isFinite(pid) ? pid : null);
      }
    })();

    res.status(204).end();
  } catch (err) {
    console.error('Analytics collect error:', err);
    res.status(204).end();
  }
});

/* ---------------- Report ---------------- */

// Начало периода в UTC: days=1 — сегодня, 7/30/90 — последние N дней, 0 — всё время
function periodStart(days) {
  if (!days) return '1970-01-01 00:00:00';
  return db.prepare(`SELECT datetime('now', ?, 'start of day', ?, ?) AS d`)
    .get(TZ, `-${days - 1} days`, TZ_BACK).d;
}

function parseItems(raw) {
  try {
    const items = JSON.parse(raw || '[]');
    return Array.isArray(items) ? items : [];
  } catch (e) {
    return [];
  }
}

// Город из свободного адреса доставки: первая часть до запятой без «г.» / «город»
function cityFromAddress(address) {
  const first = String(address || '').split(',')[0].trim();
  const city = first.replace(/^(г\.?|город)\s*/i, '').trim();
  if (!city || city.length > 40 || /\d/.test(city)) return null;
  return city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
}

// Покупатель для подсчёта повторных заказов: id кабинета, иначе email, иначе телефон
function customerKey(order) {
  if (order.customer_id) return `c${order.customer_id}`;
  const email = String(order.customer_email || '').trim().toLowerCase();
  if (email) return `e${email}`;
  const phone = String(order.customer_phone || '').replace(/\D/g, '').slice(-10);
  return phone ? `p${phone}` : null;
}

// Непрерывный ряд дней от начала периода (или первого дня с данными) до сегодня, пустые дни — нули
function fillDays(daily, firstDay) {
  const today = db.prepare(`SELECT date('now', ?) AS d`).get(TZ).d;
  const known = [...daily.keys()].sort();
  let day = firstDay || known[0] || today;
  const rows = [];
  while (day <= today && rows.length < 800) {
    rows.push(daily.get(day) || { day, sessions: 0, orders: 0, revenue: 0 });
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return rows;
}

function topEntries(map, limit = 10) {
  return [...map.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.count - a.count || (b.revenue || 0) - (a.revenue || 0))
    .slice(0, limit);
}

router.get('/report', requireAdmin, (req, res) => {
  try {
    const days = [1, 7, 30, 90].includes(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 0;
    const scope = req.query.scope === 'all' ? 'all' : 'paid';
    const since = periodStart(days);

    /* --- Трафик --- */
    const traffic = db.prepare(`
      SELECT
        COUNT(*) AS sessions,
        COUNT(DISTINCT visitor_id) AS visitors,
        COALESCE(SUM(pageviews), 0) AS pageviews,
        COALESCE(AVG(strftime('%s', last_seen_at) - strftime('%s', started_at)), 0) AS avg_duration,
        COALESCE(AVG(pageviews), 0) AS avg_pages,
        COALESCE(AVG(CASE WHEN pageviews <= 1
          AND strftime('%s', last_seen_at) - strftime('%s', started_at) < 15 THEN 1.0 ELSE 0 END), 0) AS bounce_rate
      FROM analytics_sessions WHERE started_at >= ?
    `).get(since);

    const sessionDevices = db.prepare(`
      SELECT device AS name, COUNT(*) AS count FROM analytics_sessions
      WHERE started_at >= ? GROUP BY device ORDER BY count DESC
    `).all(since);

    const sources = db.prepare(`
      SELECT source AS name, COUNT(*) AS count, COUNT(DISTINCT visitor_id) AS visitors
      FROM analytics_sessions WHERE started_at >= ?
      GROUP BY source ORDER BY count DESC LIMIT 10
    `).all(since);

    const topPages = db.prepare(`
      SELECT path AS name, COUNT(*) AS count, COUNT(DISTINCT session_id) AS sessions
      FROM analytics_events WHERE type = 'pageview' AND created_at >= ?
      GROUP BY path ORDER BY count DESC LIMIT 10
    `).all(since);

    const topViewed = db.prepare(`
      SELECT e.product_id AS id, COALESCE(p.title, 'Товар #' || e.product_id) AS name,
        COUNT(*) AS count, COUNT(DISTINCT e.session_id) AS sessions
      FROM analytics_events e LEFT JOIN products p ON p.id = e.product_id
      WHERE e.type = 'product_view' AND e.product_id IS NOT NULL AND e.created_at >= ?
      GROUP BY e.product_id ORDER BY count DESC LIMIT 10
    `).all(since);

    /* --- Продажи --- */
    const allOrders = db.prepare(`
      SELECT id, customer_id, customer_email, customer_phone, delivery_address, items,
        total_price, status, payment_status, device, created_at
      FROM orders ORDER BY created_at ASC
    `).all();

    const isPaid = o => o.payment_status === 'paid' || o.status === 'paid';
    const inScope = o => o.status !== 'cancelled' && (scope === 'all' || isPaid(o));

    // Повторный заказ — заказ покупателя, у которого уже был заказ раньше (за всё время)
    const seenCustomers = new Set();
    const repeatIds = new Set();
    for (const o of allOrders.filter(inScope)) {
      const key = customerKey(o);
      if (!key) continue;
      if (seenCustomers.has(key)) repeatIds.add(o.id);
      seenCustomers.add(key);
    }

    const periodOrders = allOrders.filter(o => o.created_at >= since);
    const trackingStart = db.prepare('SELECT MIN(started_at) AS d FROM analytics_sessions').get().d || '9999';
    const counted = periodOrders.filter(inScope);

    let revenue = 0;
    let itemsSold = 0;
    const repeatCustomers = new Set();
    const orderDevices = new Map();
    const cities = new Map();
    const products = new Map();

    for (const o of counted) {
      revenue += Number(o.total_price) || 0;
      if (repeatIds.has(o.id)) repeatCustomers.add(customerKey(o));

      const device = o.device || 'unknown';
      const d = orderDevices.get(device) || { count: 0, revenue: 0 };
      d.count += 1;
      d.revenue += Number(o.total_price) || 0;
      orderDevices.set(device, d);

      const city = cityFromAddress(o.delivery_address) || 'Не определён';
      const c = cities.get(city) || { count: 0, revenue: 0 };
      c.count += 1;
      c.revenue += Number(o.total_price) || 0;
      cities.set(city, c);

      for (const item of parseItems(o.items)) {
        const qty = parseInt(item.quantity, 10) || 1;
        const sum = (Number(item.price) || 0) * qty;
        itemsSold += qty;

        const pKey = item.is_custom ? 'custom' : String(item.id);
        const p = products.get(pKey) || {
          id: item.is_custom ? null : item.id,
          title: item.is_custom ? '3D Кастом (индивидуальные изделия)' : item.title,
          count: 0, revenue: 0, orders: new Set(), variants: new Map()
        };
        p.count += qty;
        p.revenue += sum;
        p.orders.add(o.id);

        const variant = [item.size ? `размер ${item.size}` : '', item.color || ''].filter(Boolean).join(', ') || 'без вариантов';
        const v = p.variants.get(variant) || { count: 0, revenue: 0 };
        v.count += qty;
        v.revenue += sum;
        p.variants.set(variant, v);
        products.set(pKey, p);
      }
    }

    const topPurchases = [...products.values()]
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
      .slice(0, 15)
      .map(p => ({
        id: p.id,
        name: p.title,
        count: p.count,
        revenue: p.revenue,
        orders: p.orders.size,
        variants: topEntries(p.variants, 20)
      }));

    /* --- По дням --- */
    const daily = new Map();
    const dayOf = utc => db.prepare(`SELECT date(?, ?) AS d`).get(utc, TZ).d;
    db.prepare(`
      SELECT date(started_at, ?) AS day, COUNT(*) AS sessions FROM analytics_sessions
      WHERE started_at >= ? GROUP BY day
    `).all(TZ, since).forEach(r => daily.set(r.day, { day: r.day, sessions: r.sessions, orders: 0, revenue: 0 }));
    for (const o of counted) {
      const day = dayOf(o.created_at);
      const row = daily.get(day) || { day, sessions: 0, orders: 0, revenue: 0 };
      row.orders += 1;
      row.revenue += Number(o.total_price) || 0;
      daily.set(day, row);
    }

    res.json({
      period: { days, since, scope },
      traffic: {
        visitors: traffic.visitors,
        sessions: traffic.sessions,
        pageviews: traffic.pageviews,
        avg_duration_sec: Math.round(traffic.avg_duration),
        avg_pages: Math.round(traffic.avg_pages * 10) / 10,
        bounce_rate: Math.round(traffic.bounce_rate * 1000) / 10
      },
      sales: {
        orders_created: periodOrders.length,
        orders_paid: periodOrders.filter(isPaid).length,
        orders_cancelled: periodOrders.filter(o => o.status === 'cancelled').length,
        orders_counted: counted.length,
        revenue,
        avg_check: counted.length ? Math.round(revenue / counted.length) : 0,
        items_sold: itemsSold,
        repeat_orders: counted.filter(o => repeatIds.has(o.id)).length,
        repeat_customers: repeatCustomers.size,
        // Конверсию считаем только по заказам с момента запуска статистики, иначе старые заказы её завышают
        conversion: traffic.sessions
          ? Math.round((counted.filter(o => o.created_at >= trackingStart).length / traffic.sessions) * 1000) / 10
          : 0
      },
      devices: { sessions: sessionDevices, orders: topEntries(orderDevices) },
      sources,
      top_pages: topPages,
      top_viewed: topViewed,
      top_purchases: topPurchases,
      top_cities: topEntries(cities),
      daily: fillDays(daily, days ? dayOf(since) : null)
    });
  } catch (err) {
    console.error('Analytics report error:', err);
    res.status(500).json({ error: 'Ошибка построения отчёта' });
  }
});

module.exports = router;
