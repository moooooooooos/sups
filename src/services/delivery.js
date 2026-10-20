/**
 * Доставка: варианты для города, проверка выбора покупателя и цена — всё считается на сервере.
 *
 * Выбор покупателя (selection):
 *   { provider: 'cdek' | 'yandex', type: 'pvz' | 'courier', city_code, city_name,
 *     point_id,                       // для ПВЗ
 *     street, house, flat, fias_id }  // для курьера (fias_id — дом из подсказок DaData, если она подключена)
 */
const db = require('../db');
const cdek = require('./cdek');
const yandex = require('./yandexDelivery');

const PROVIDER_NAMES = { cdek: 'СДЭК', yandex: 'Яндекс Доставка' };

function setting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== '' ? String(row.value).trim() : fallback;
}

// Посылка: упаковка с первым изделием + вес каждого следующего
function parcelFor(itemsCount) {
  const base = parseInt(setting('delivery_parcel_weight_g', '300'), 10) || 300;
  const perItem = parseInt(setting('delivery_item_weight_g', '50'), 10) || 50;
  const count = Math.max(1, parseInt(itemsCount, 10) || 1);
  return { weight: base + perItem * (count - 1), length: 15, width: 10, height: 5 };
}

function enabledProviders() {
  return { cdek: cdek.isConfigured(), yandex: yandex.isConfigured() };
}

/* ---------- DaData: подсказки адреса до дома (необязательно) ---------- */
const DADATA = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs';

function dadataKey() {
  return setting('dadata_api_key');
}

async function dadata(path, body) {
  const res = await fetch(`${DADATA}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${dadataKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`DaData ${res.status}`);
  return res.json();
}

function mapDadata(s) {
  const d = s.data || {};
  return {
    value: s.value,
    street: d.street_with_type || d.settlement_with_type || '',
    house: [d.house_type, d.house, d.block_type, d.block].filter(Boolean).join(' '),
    fias_id: d.house_fias_id || d.fias_id || '',
    has_house: Boolean(d.house),
    city: d.city || d.settlement || ''
  };
}

async function suggestAddress(query, cityName) {
  if (!dadataKey()) return null;
  const city = String(cityName || '').split(',')[0].trim();
  const data = await dadata('/suggest/address', {
    query: `${city ? `${city}, ` : ''}${String(query || '').slice(0, 120)}`,
    count: 7,
    from_bound: { value: 'street' },
    to_bound: { value: 'house' },
    locations: city ? [{ city }, { settlement: city }] : undefined
  });
  return (data.suggestions || []).map(mapDadata);
}

async function addressByFias(fiasId) {
  const data = await dadata('/findById/address', { query: fiasId, count: 1 });
  const s = data.suggestions && data.suggestions[0];
  return s ? mapDadata(s) : null;
}

/* ---------- Варианты доставки для города ---------- */

async function optionsForCity(cityCode, cityName, itemsCount) {
  const parcel = parcelFor(itemsCount);
  const enabled = enabledProviders();
  const tasks = [];

  if (enabled.cdek && cityCode) {
    tasks.push(cdek.calcTariff(cityCode, cdek.TARIFF_PVZ, parcel)
      .then(q => q && { provider: 'cdek', type: 'pvz', title: 'СДЭК — пункт выдачи или постамат', ...q }));
    tasks.push(cdek.calcTariff(cityCode, cdek.TARIFF_COURIER, parcel)
      .then(q => q && { provider: 'cdek', type: 'courier', title: 'СДЭК — курьер до двери', ...q }));
  }

  if (enabled.yandex && cityName) {
    // Цена Яндекса зависит от точки: показываем «от» по первому ПВЗ города
    tasks.push(yandex.listPoints(cityName).then(async points => {
      if (!points.length) return null;
      const q = await yandex.calc({ pointId: points[0].id }, parcel);
      return q && { provider: 'yandex', type: 'pvz', title: 'Яндекс Доставка — пункт выдачи', from: true, ...q };
    }));
    tasks.push(Promise.resolve({ provider: 'yandex', type: 'courier', title: 'Яндекс Доставка — курьер', price: null, needs_address: true }));
  }

  // Сбой одного перевозчика не должен ломать выбор у другого
  const results = await Promise.allSettled(tasks);
  results.filter(r => r.status === 'rejected').forEach(r => console.warn('Delivery option error:', r.reason && r.reason.message));
  return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}

async function listPoints(provider, cityCode, cityName) {
  if (provider === 'cdek' && cdek.isConfigured()) return cdek.listPoints(cityCode);
  if (provider === 'yandex' && yandex.isConfigured()) return yandex.listPoints(cityName);
  return [];
}

async function cityMatches(cityCode, cityName) {
  const list = await cdek.suggestCities(String(cityName || '').split(',')[0]);
  return list.some(c => String(c.code) === String(cityCode));
}

const STREET_RE = /[a-zа-яё]{2,}/i;
const HOUSE_RE = /^\d{1,4}[а-яa-z]?(\s*[\/-]\s*\d{1,4}[а-яa-z]?)?(\s*(к|корп\.?|корпус|с|стр\.?|строение|лит\.?)\s*\d{0,3}[а-яa-z]?)*$/i;

/**
 * Проверяет выбор покупателя у перевозчика и возвращает данные для заказа:
 * { ok: true, provider, type, method_label, address_text, point_id, city_code, price, period_min, period_max }
 * или { ok: false, error }.
 */
async function resolveSelection(sel, itemsCount, assessedRub) {
  const s = sel || {};
  const provider = s.provider;
  const type = s.type;
  if (!PROVIDER_NAMES[provider] || !['pvz', 'courier'].includes(type)) {
    return { ok: false, error: 'Выберите способ доставки' };
  }
  if (!enabledProviders()[provider]) return { ok: false, error: `${PROVIDER_NAMES[provider]} сейчас недоступна, выберите другой способ` };

  const cityCode = parseInt(s.city_code, 10);
  const cityName = String(s.city_name || '').trim().slice(0, 200);
  if (!cityCode || !cityName) return { ok: false, error: 'Выберите город из списка подсказок' };
  if (!(await cityMatches(cityCode, cityName))) return { ok: false, error: 'Город не найден, выберите его из списка подсказок' };

  const parcel = parcelFor(itemsCount);
  const base = { provider, type, city_code: cityCode, point_id: null };

  if (type === 'pvz') {
    const point = provider === 'cdek' ? await cdek.getPoint(s.point_id) : await yandex.getPoint(s.point_id);
    if (!point) return { ok: false, error: 'Пункт выдачи не найден или закрыт, выберите другой' };
    if (provider === 'cdek' && String(point.city_code) !== String(cityCode)) {
      return { ok: false, error: 'Пункт выдачи находится в другом городе' };
    }
    const quote = provider === 'cdek'
      ? await cdek.calcTariff(cityCode, point.type === 'postamat' ? cdek.TARIFF_POSTAMAT : cdek.TARIFF_PVZ, parcel)
      : await yandex.calc({ pointId: point.id }, parcel, assessedRub);
    if (!quote) return { ok: false, error: 'Не удалось рассчитать доставку в этот пункт, выберите другой' };
    return {
      ok: true, ...base, ...quote,
      point_id: point.id,
      method_label: `${PROVIDER_NAMES[provider]}, ${point.type === 'postamat' ? 'постамат' : 'пункт выдачи'} ${point.id}`,
      address_text: point.full_address || `${cityName.split(',')[0]}, ${point.address}`
    };
  }

  // Курьер: адрес до дома
  let street = String(s.street || '').trim().slice(0, 120);
  let house = String(s.house || '').trim().slice(0, 30);
  const flat = String(s.flat || '').trim().slice(0, 20);

  if (dadataKey()) {
    // С подсказками DaData дом должен быть выбран из списка
    const found = s.fias_id ? await addressByFias(String(s.fias_id)).catch(() => null) : null;
    if (!found || !found.has_house) return { ok: false, error: 'Выберите улицу и дом из подсказок' };
    street = found.street;
    house = found.house;
  } else if (!STREET_RE.test(street) || !HOUSE_RE.test(house)) {
    return { ok: false, error: 'Укажите улицу и номер дома (например: ул. Ленина, 5к1)' };
  }

  const city = cityName.split(',')[0];
  const addressForCarrier = `${city}, ${street}, ${house}`;
  const quote = provider === 'cdek'
    ? await cdek.calcTariff(cityCode, cdek.TARIFF_COURIER, parcel)
    : await yandex.calc({ address: addressForCarrier }, parcel, assessedRub).catch(err => {
      if (err.status === 400) return null; // Яндекс не нашёл адрес
      throw err;
    });
  if (!quote) return { ok: false, error: 'Курьер не доставляет по этому адресу, проверьте адрес или выберите пункт выдачи' };

  return {
    ok: true, ...base, ...quote,
    method_label: `${PROVIDER_NAMES[provider]}, курьер`,
    address_text: `${addressForCarrier}${flat ? `, кв. ${flat}` : ''}`
  };
}

module.exports = {
  enabledProviders,
  optionsForCity,
  listPoints,
  suggestAddress,
  resolveSelection,
  hasAddressSuggest: () => Boolean(dadataKey())
};
