/**
 * Отправления СДЭК: создание заказа в СДЭК по заказу магазина и синхронизация статусов.
 * Статусы СДЭК переводятся в статусы магазина (только вперёд), покупатель видит их в личном кабинете.
 * Настройка cdek_shipment_point — код офиса СДЭК, куда магазин сдаёт посылки (тарифы «склад-…»).
 */
const db = require('../db');
const cdek = require('./cdek');
const orderStatus = require('./orderStatus');

// Код статуса СДЭК → статус магазина
const CDEK_TO_STATUS = {
  RECEIVED_AT_SHIPMENT_WAREHOUSE: 'shipped',
  READY_TO_SHIP_AT_SENDING_OFFICE: 'shipped',
  SENT_TO_TRANSIT_CITY: 'shipped',
  SENT_TO_RECIPIENT_CITY: 'shipped',
  ACCEPTED_IN_TRANSIT_CITY: 'shipped',
  ACCEPTED_IN_RECIPIENT_CITY: 'shipped',
  TAKEN_BY_COURIER: 'shipped',
  ACCEPTED_AT_PICK_UP_POINT: 'ready_for_pickup',
  POSTOMAT_POSTED: 'ready_for_pickup',
  DELIVERED: 'delivered',
  POSTOMAT_RECEIVED: 'delivered',
  RETURNED_TO_SENDER_CITY_WAREHOUSE: 'returned',
  RETURNED: 'returned'
};

function setting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== '' ? String(row.value).trim() : fallback;
}

function digitsPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+7${d}` : String(phone || '');
}

function parseItems(raw) {
  try { return JSON.parse(raw || '[]'); } catch (e) { return []; }
}

// Создать отправление в СДЭК для заказа магазина
async function createShipment(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Заказ не найден');
  if (order.delivery_provider !== 'cdek') throw new Error('Заказ оформлен не на доставку СДЭК');
  if (order.shipment_uuid) throw new Error('Отправление уже создано');
  if (order.status === 'cancelled') throw new Error('Заказ отменён');

  const shipmentPoint = setting('cdek_shipment_point');
  if (!shipmentPoint) throw new Error('Укажите в настройках код офиса СДЭК, куда вы сдаёте посылки');

  const items = parseItems(order.items);
  const count = items.reduce((n, i) => n + (parseInt(i.quantity, 10) || 1), 0) || 1;
  const base = parseInt(setting('delivery_parcel_weight_g', '300'), 10) || 300;
  const perItem = parseInt(setting('delivery_item_weight_g', '50'), 10) || 50;
  const weight = base + perItem * (count - 1);

  let tariff = cdek.TARIFF_COURIER;
  const body = {
    type: 1,
    number: order.order_number,
    comment: order.comment || undefined,
    shipment_point: shipmentPoint,
    recipient: {
      name: order.customer_name,
      phones: [{ number: digitsPhone(order.customer_phone) }],
      email: order.customer_email || undefined
    },
    packages: [{
      number: '1',
      weight,
      length: 15,
      width: 10,
      height: 5,
      items: items.map((i, idx) => ({
        name: [i.title, i.size ? `р. ${i.size}` : '', i.color || ''].filter(Boolean).join(', ').slice(0, 255),
        ware_key: String(i.id || `item-${idx + 1}`),
        payment: { value: 0 },           // заказ оплачен на сайте
        cost: Number(i.price) || 0,
        weight: Math.max(1, Math.floor(weight / count)), // вес единицы: вес посылки поровну на изделия
        amount: parseInt(i.quantity, 10) || 1
      }))
    }]
  };

  if (order.delivery_type === 'pvz') {
    const point = await cdek.getPoint(order.delivery_point_id);
    if (!point) throw new Error(`Пункт выдачи ${order.delivery_point_id} закрыт — свяжитесь с покупателем`);
    tariff = point.type === 'postamat' ? cdek.TARIFF_POSTAMAT : cdek.TARIFF_PVZ;
    body.delivery_point = point.id;
  } else {
    body.to_location = { code: order.delivery_city_code, address: order.delivery_address };
  }
  body.tariff_code = tariff;

  const created = await cdek.request('/v2/orders', { method: 'POST', body });
  const uuid = created && created.entity && created.entity.uuid;
  if (!uuid) throw new Error('СДЭК не вернул номер отправления');

  db.prepare(`
    UPDATE orders SET shipment_uuid = ?, shipment_error = NULL, updated_at = datetime('now') WHERE id = ?
  `).run(uuid, order.id);
  if (orderStatus.canAdvance(order.status, 'processing') && order.status !== 'new') {
    db.prepare("UPDATE orders SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(order.id);
  }

  // СДЭК обрабатывает заказ асинхронно — через пару секунд подтягиваем трек-номер и статус
  setTimeout(() => syncShipment(order.id).catch(err => console.warn('CDEK sync after create:', err.message)), 4000);
  return { uuid };
}

// Подтянуть статус отправления из СДЭК и при необходимости продвинуть статус заказа
async function syncShipment(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || !order.shipment_uuid) return null;

  const data = await cdek.request(`/v2/orders/${order.shipment_uuid}`);
  const entity = (data && data.entity) || {};
  const failed = (data.requests || []).find(r => r.state === 'INVALID');
  const statuses = (entity.statuses || [])
    .filter(s => !s.deleted)
    .sort((a, b) => String(b.date_time).localeCompare(String(a.date_time)));
  const latest = statuses[0];

  const errorText = failed && failed.errors && failed.errors.length
    ? failed.errors.map(e => e.message).join('; ').slice(0, 500)
    : null;

  db.prepare(`
    UPDATE orders SET tracking_number = COALESCE(?, tracking_number), shipment_status = ?,
      shipment_error = ?, shipment_synced_at = datetime('now')
    WHERE id = ?
  `).run(entity.cdek_number || null, latest ? latest.name : null, errorText, order.id);

  const mapped = latest && CDEK_TO_STATUS[latest.code];
  if (mapped && orderStatus.canAdvance(order.status, mapped)) {
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(mapped, order.id);
  }
  return { status: mapped || order.status, cdek_status: latest ? latest.name : null, tracking_number: entity.cdek_number || order.tracking_number };
}

// Фоновая синхронизация всех активных отправлений (раз в 30 минут)
async function syncAll() {
  if (!cdek.isConfigured()) return;
  const rows = db.prepare(`
    SELECT id FROM orders
    WHERE shipment_uuid IS NOT NULL AND status NOT IN ('delivered', 'completed', 'cancelled', 'returned')
  `).all();
  for (const row of rows) {
    try {
      await syncShipment(row.id);
    } catch (err) {
      console.warn(`CDEK sync order ${row.id}:`, err.message);
    }
  }
}

function startAutoSync() {
  const run = () => syncAll().catch(err => console.warn('CDEK auto sync:', err.message));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 30 * 60 * 1000).unref();
}

module.exports = { createShipment, syncShipment, syncAll, startAutoSync };
