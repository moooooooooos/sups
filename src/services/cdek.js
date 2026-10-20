/**
 * СДЭК API v2 (https://apidoc.cdek.ru): города, пункты выдачи, расчёт тарифов.
 * Доступы хранятся в таблице settings (вкладка «Настройки» админки):
 *   cdek_client_id, cdek_client_secret, cdek_test_mode ('1' — тестовая среда api.edu.cdek.ru),
 *   cdek_sender_city_code — код города отправки (по умолчанию 250, Екатеринбург).
 */
const db = require('../db');

const HOSTS = { test: 'https://api.edu.cdek.ru', live: 'https://api.cdek.ru' };

// Тарифы «Посылка» для интернет-магазина: из офиса СДЭК в ПВЗ / постамат / до двери
const TARIFF_PVZ = 136;
const TARIFF_POSTAMAT = 368;
const TARIFF_COURIER = 137;

function setting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== '' ? String(row.value).trim() : fallback;
}

function config() {
  return {
    clientId: setting('cdek_client_id'),
    clientSecret: setting('cdek_client_secret'),
    host: setting('cdek_test_mode', '1') === '0' ? HOSTS.live : HOSTS.test,
    senderCityCode: parseInt(setting('cdek_sender_city_code', '250'), 10) || 250
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.clientId && c.clientSecret);
}

let tokenCache = { key: '', token: '', expiresAt: 0 };

async function getToken(c) {
  const cacheKey = `${c.host}|${c.clientId}`;
  if (tokenCache.key === cacheKey && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const res = await fetch(`${c.host}/v2/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`СДЭК: авторизация не удалась (${res.status})`);
  const data = await res.json();
  tokenCache = { key: cacheKey, token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

async function request(path, { method = 'GET', query, body } = {}) {
  const c = config();
  if (!c.clientId || !c.clientSecret) throw new Error('СДЭК не настроен');
  const token = await getToken(c);
  const url = `${c.host}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`СДЭК ${path}: ${res.status}`);
  return data;
}

// Небольшой кэш в памяти: города и ПВЗ меняются редко
const cache = new Map();
async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

async function suggestCities(name) {
  const q = String(name || '').trim().slice(0, 60);
  if (q.length < 2) return [];
  return cached(`cities:${q.toLowerCase()}`, 10 * 60 * 1000, async () => {
    const list = await request('/v2/location/suggest/cities', { query: { name: q, country_code: 'RU' } });
    return (Array.isArray(list) ? list : []).slice(0, 10).map(c => ({ code: c.code, name: c.full_name }));
  });
}

function mapPoint(p) {
  return {
    id: p.code,
    type: p.type === 'POSTAMAT' ? 'postamat' : 'pvz',
    name: p.type === 'POSTAMAT' ? 'Постамат СДЭК' : 'Пункт выдачи СДЭК',
    address: p.location && p.location.address,
    full_address: p.location && p.location.address_full,
    city_code: p.location && p.location.city_code,
    city: p.location && p.location.city,
    work_time: p.work_time || '',
    note: p.address_comment || '',
    lat: p.location && p.location.latitude,
    lon: p.location && p.location.longitude
  };
}

async function listPoints(cityCode) {
  const code = parseInt(cityCode, 10);
  if (!code) return [];
  return cached(`points:${code}`, 60 * 60 * 1000, async () => {
    const list = await request('/v2/deliverypoints', { query: { city_code: code, type: 'ALL', is_handout: 'true' } });
    return (Array.isArray(list) ? list : [])
      .filter(p => !p.status || p.status === 'ACTIVE')
      .map(mapPoint);
  });
}

async function getPoint(pointCode) {
  const code = String(pointCode || '').trim();
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) return null;
  const list = await request('/v2/deliverypoints', { query: { code } });
  const p = Array.isArray(list) ? list.find(x => x.code === code) : null;
  return p && (!p.status || p.status === 'ACTIVE') ? mapPoint(p) : null;
}

// Стоимость и срок по тарифу; parcel = { weight (г), length, width, height (см) }
async function calcTariff(cityCode, tariffCode, parcel) {
  const c = config();
  const data = await request('/v2/calculator/tarifflist', {
    method: 'POST',
    body: {
      type: 1,
      from_location: { code: c.senderCityCode },
      to_location: { code: parseInt(cityCode, 10) },
      packages: [parcel]
    }
  });
  const tariff = (data.tariff_codes || []).find(t => t.tariff_code === tariffCode);
  if (!tariff) return null;
  return {
    price: Math.ceil(tariff.delivery_sum),
    period_min: tariff.period_min,
    period_max: tariff.period_max
  };
}

module.exports = {
  isConfigured,
  suggestCities,
  listPoints,
  getPoint,
  calcTariff,
  TARIFF_PVZ,
  TARIFF_POSTAMAT,
  TARIFF_COURIER
};
