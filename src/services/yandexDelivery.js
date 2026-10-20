/**
 * Яндекс Доставка, API «Доставка в другой день» (платформа B2B):
 * https://yandex.ru/support/delivery-profile/ru/api/other-day/
 * Настройки (таблица settings): yandex_delivery_token, yandex_delivery_station_id (склад отгрузки),
 * yandex_delivery_test_mode ('1' — тестовый контур b2b.taxi.tst.yandex.net).
 * Пока токен не задан, способ «Яндекс Доставка» на сайте не показывается.
 */
const db = require('../db');

const HOSTS = {
  test: 'https://b2b.taxi.tst.yandex.net/api/b2b/platform',
  live: 'https://b2b-authproxy.taxi.yandex.net/api/b2b/platform'
};

function setting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== '' ? String(row.value).trim() : fallback;
}

function config() {
  return {
    token: setting('yandex_delivery_token'),
    stationId: setting('yandex_delivery_station_id'),
    host: setting('yandex_delivery_test_mode', '1') === '0' ? HOSTS.live : HOSTS.test
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.token && c.stationId);
}

async function post(path, body) {
  const c = config();
  if (!c.token) throw new Error('Яндекс Доставка не настроена');
  const res = await fetch(`${c.host}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', 'Accept-Language': 'ru' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Яндекс Доставка ${path}: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const cache = new Map();
async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return value;
}

// geo_id населённого пункта по названию (берём первый вариант)
async function detectGeoId(cityName) {
  const name = String(cityName || '').split(',')[0].trim();
  if (!name) return null;
  return cached(`geo:${name.toLowerCase()}`, 24 * 60 * 60 * 1000, async () => {
    const data = await post('/location/detect', { location: name });
    const v = data && Array.isArray(data.variants) ? data.variants[0] : null;
    return v ? v.geo_id : null;
  });
}

function mapPoint(p) {
  const a = p.address || {};
  return {
    id: p.id,
    type: p.type === 'terminal' ? 'postamat' : 'pvz',
    name: p.name || 'Пункт выдачи Яндекс',
    address: a.full_address || [a.street, a.house].filter(Boolean).join(', '),
    full_address: a.full_address || '',
    city: a.locality || '',
    work_time: '',
    note: p.instruction || '',
    lat: p.position && p.position.latitude,
    lon: p.position && p.position.longitude
  };
}

async function listPoints(cityName) {
  const geoId = await detectGeoId(cityName);
  if (!geoId) return [];
  return cached(`points:${geoId}`, 60 * 60 * 1000, async () => {
    const data = await post('/pickup-points/list', { geo_id: geoId, payment_method: 'already_paid' });
    return (data && Array.isArray(data.points) ? data.points : [])
      .filter(p => p.type !== 'warehouse')
      .map(mapPoint);
  });
}

async function getPoint(pointId) {
  const id = String(pointId || '').trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
  const data = await post('/pickup-points/list', { pickup_point_ids: [id] });
  const p = data && Array.isArray(data.points) ? data.points.find(x => x.id === id) : null;
  return p ? mapPoint(p) : null;
}

// Стоимость: tariff 'self_pickup' + destination.platform_station_id или 'time_interval' + destination.address.
// Неизвестный адрес API отклоняет — этим и проверяем адрес для курьера.
async function calc({ pointId, address }, parcel, assessedRub) {
  const c = config();
  const data = await post('/pricing-calculator', {
    source: { platform_station_id: c.stationId },
    destination: pointId ? { platform_station_id: pointId } : { address },
    tariff: pointId ? 'self_pickup' : 'time_interval',
    total_weight: parcel.weight,
    total_assessed_price: Math.round((assessedRub || 0) * 100),
    payment_method: 'already_paid',
    places: [{ physical_dims: { weight_gross: parcel.weight, dx: parcel.length, dy: parcel.width, dz: parcel.height } }]
  });
  const price = parseFloat(String(data && data.pricing_total || '').replace(',', '.'));
  if (!Number.isFinite(price)) return null;
  return { price: Math.ceil(price), period_min: data.delivery_days || null, period_max: data.delivery_days || null };
}

module.exports = { isConfigured, listPoints, getPoint, calc };
