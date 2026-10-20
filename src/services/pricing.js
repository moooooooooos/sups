/**
 * Цены заказа считаются только здесь: товары — из таблицы products, кастомные кольца — по моделям ниже,
 * промокод — из promo_codes. Цены, пришедшие из браузера, не используются.
 */
const db = require('../db');

// Модели 3D-конструктора. Те же значения показывает public/js/customizer.js (ringModels) — менять вместе.
const CUSTOM_RING_MODELS = {
  ring_flat_6:    { id: 'ring_flat_6', name: 'Кольцо Плоское (6 мм)', basePrice: 8500 },
  ring_classic_4: { id: 'ring_classic_4', name: 'Кольцо Классическое (4 мм)', basePrice: 7900 },
  ring_wide_8:    { id: 'ring_wide_8', name: 'Кольцо Широкое (8 мм)', basePrice: 9200 }
};
const REMOVE_LOGO_PRICE = 500;
const MAX_QUANTITY = 99;
const MAX_LINES = 50;

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch (e) { return fallback; }
}

function customRingPrice(modelId, removeLogo) {
  const model = CUSTOM_RING_MODELS[modelId];
  if (!model) return null;
  return model.basePrice + (removeLogo ? REMOVE_LOGO_PRICE : 0);
}

// Корзины, собранные до появления model_id, узнаём по названию модели и пометке о вотермарке
function legacyCustomModel(item) {
  const text = `${item.title || ''} ${item.custom_details || ''}`;
  const model = Object.values(CUSTOM_RING_MODELS).find(m => text.includes(m.name));
  return model ? { modelId: model.id, removeLogo: /Без вотермарки/i.test(String(item.custom_details || '')) } : null;
}

function fail(error, index) {
  return { ok: false, error, item_index: index };
}

/**
 * Позиции корзины → позиции заказа с серверными ценами.
 * Возвращает { ok: true, items, subtotal, itemsCount } или { ok: false, error, item_index }.
 */
function priceItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return fail('Корзина пуста');
  if (rawItems.length > MAX_LINES) return fail('Слишком много позиций в заказе');

  const getProduct = db.prepare('SELECT id, title, price, in_stock, sizes, color_variants FROM products WHERE id = ?');
  const items = [];
  let subtotal = 0;
  let itemsCount = 0;

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i] || {};
    const quantity = Number(raw.quantity === undefined ? 1 : raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return fail(`Некорректное количество у позиции «${String(raw.title || i + 1).slice(0, 80)}»`, i);
    }
    const size = raw.size ? String(raw.size).slice(0, 20) : '';
    const color = raw.color ? String(raw.color).slice(0, 50) : '';

    let line;
    if (raw.is_custom) {
      const picked = raw.model_id !== undefined
        ? { modelId: String(raw.model_id), removeLogo: raw.remove_logo === true }
        : legacyCustomModel(raw);
      const price = picked && customRingPrice(picked.modelId, picked.removeLogo);
      if (!price) return fail('Кастомное изделие не найдено, соберите его в конструкторе заново', i);
      line = {
        id: null,
        title: `Кастомное кольцо: ${CUSTOM_RING_MODELS[picked.modelId].name}`,
        price,
        quantity,
        size,
        color,
        image: raw.image ? String(raw.image) : '',
        is_custom: true,
        model_id: picked.modelId,
        remove_logo: picked.removeLogo,
        custom_details: raw.custom_details ? String(raw.custom_details).slice(0, 1000) : null
      };
    } else {
      const productId = Number(raw.id);
      const product = Number.isInteger(productId) && productId > 0 ? getProduct.get(productId) : null;
      if (!product) return fail(`Товар «${String(raw.title || i + 1).slice(0, 80)}» больше не продаётся, удалите его из корзины`, i);
      if (!product.in_stock) return fail(`Товара «${product.title}» нет в наличии, удалите его из корзины`, i);

      const sizes = parseJson(product.sizes, []).map(String);
      if (sizes.length && !sizes.includes(size)) return fail(`Выберите размер для «${product.title}»`, i);
      const colors = parseJson(product.color_variants, []).map(v => v && v.name).filter(Boolean);
      if (color && colors.length && !colors.includes(color)) return fail(`Цвет «${color}» для «${product.title}» недоступен`, i);

      // products.price — уже цена со скидкой, price_old лишь зачёркнутая цена на витрине
      line = {
        id: product.id,
        title: product.title,
        price: product.price,
        quantity,
        size,
        color,
        image: raw.image ? String(raw.image).slice(0, 500) : '',
        is_custom: false,
        custom_details: null
      };
    }

    items.push(line);
    subtotal += line.price * line.quantity;
    itemsCount += line.quantity;
  }

  return { ok: true, items, subtotal, itemsCount };
}

/** Промокод: { ok: true, promo: null | { id, code, discount_percent } } или { ok: false, error } */
function checkPromo(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return { ok: true, promo: null };
  const promo = db.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = ?').get(clean);
  if (!promo) return { ok: false, error: 'Промокод не найден' };
  if (!promo.is_active) return { ok: false, error: 'Промокод больше не действует' };
  if (promo.max_uses && promo.current_uses >= promo.max_uses) return { ok: false, error: 'Превышен лимит использования промокода' };
  return { ok: true, promo: { id: promo.id, code: promo.code, discount_percent: promo.discount_percent } };
}

// Списывает одно использование; false, если лимит успели исчерпать параллельным заказом
function consumePromo(promoId) {
  const res = db.prepare(`
    UPDATE promo_codes SET current_uses = current_uses + 1
    WHERE id = ? AND is_active = 1 AND (max_uses IS NULL OR max_uses = 0 OR current_uses < max_uses)
  `).run(promoId);
  return res.changes === 1;
}

// Скидка в рублях так же, как в корзине (public/js/cart.js): Math.round(сумма × % / 100)
function percentDiscount(subtotal, percent) {
  return percent > 0 ? Math.round((subtotal * percent) / 100) : 0;
}

/**
 * Позиции для чека ЮKassa: цены распределяют скидку так, чтобы сумма строк ровно равнялась goodsTotal
 * (ЮKassa отклоняет платёж, если чек не сходится с суммой).
 */
function receiptItems(items, goodsTotal) {
  const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const targetKop = Math.round(goodsTotal * 100);
  if (!subtotal || Math.round(subtotal * 100) === targetKop) return items.map(it => ({ ...it }));

  const ratio = goodsTotal / subtotal;
  const lines = items.map(it => ({ ...it, priceKop: Math.round(it.price * ratio * 100) }));
  let diff = targetKop - lines.reduce((s, l) => s + l.priceKop * l.quantity, 0);

  if (diff !== 0) {
    let idx = lines.findIndex(l => l.quantity === 1 && l.priceKop + diff >= 0);
    if (idx === -1) {
      // Отделяем одну штуку от последней строки, чтобы поправить копейки на ней
      const last = lines[lines.length - 1];
      last.quantity -= 1;
      lines.push({ ...last, quantity: 1 });
      idx = lines.length - 1;
    }
    lines[idx].priceKop += diff;
  }

  return lines.map(({ priceKop, ...l }) => ({ ...l, price: priceKop / 100 }));
}

module.exports = {
  CUSTOM_RING_MODELS,
  REMOVE_LOGO_PRICE,
  customRingPrice,
  priceItems,
  checkPromo,
  consumePromo,
  percentDiscount,
  receiptItems
};
