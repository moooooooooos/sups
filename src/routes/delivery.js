/**
 * Публичные методы доставки для формы заказа.
 * GET  /api/delivery/config                — какие перевозчики подключены
 * GET  /api/delivery/cities?q=             — подсказки городов (справочник СДЭК)
 * GET  /api/delivery/options?city_code=&city_name=&items=  — способы и цены
 * GET  /api/delivery/points?provider=&city_code=&city_name= — пункты выдачи
 * GET  /api/delivery/address?q=&city_name= — подсказки улицы и дома (если подключена DaData)
 * POST /api/delivery/quote                 — проверка выбора и итоговая цена
 * POST /api/delivery/check-contacts        — проверка телефона и email
 */
const express = require('express');
const router = express.Router();
const delivery = require('../services/delivery');
const cdek = require('../services/cdek');
const contacts = require('../services/contacts');

function fail(res, err, fallback) {
  console.warn('Delivery API error:', err.message);
  res.status(502).json({ error: fallback });
}

router.get('/config', (req, res) => {
  res.json({ providers: delivery.enabledProviders(), address_suggest: delivery.hasAddressSuggest() });
});

router.get('/cities', async (req, res) => {
  try {
    if (!cdek.isConfigured()) return res.json({ cities: [] });
    res.json({ cities: await cdek.suggestCities(req.query.q) });
  } catch (err) {
    fail(res, err, 'Не удалось загрузить список городов');
  }
});

router.get('/options', async (req, res) => {
  try {
    const options = await delivery.optionsForCity(req.query.city_code, req.query.city_name, req.query.items);
    res.json({ options });
  } catch (err) {
    fail(res, err, 'Не удалось рассчитать доставку');
  }
});

router.get('/points', async (req, res) => {
  try {
    const points = await delivery.listPoints(req.query.provider, req.query.city_code, req.query.city_name);
    res.json({ points });
  } catch (err) {
    fail(res, err, 'Не удалось загрузить пункты выдачи');
  }
});

router.get('/address', async (req, res) => {
  try {
    res.json({ suggestions: (await delivery.suggestAddress(req.query.q, req.query.city_name)) || [] });
  } catch (err) {
    fail(res, err, 'Не удалось загрузить подсказки адреса');
  }
});

router.post('/quote', async (req, res) => {
  try {
    const result = await delivery.resolveSelection(req.body && req.body.selection, req.body && req.body.items);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    fail(res, err, 'Не удалось проверить доставку, попробуйте ещё раз');
  }
});

router.post('/check-contacts', async (req, res) => {
  const errors = {};
  const phone = contacts.normalizePhone(req.body && req.body.phone);
  if (!phone) errors.phone = 'Укажите мобильный номер в формате +7 9XX XXX-XX-XX';
  const email = await contacts.checkEmail(req.body && req.body.email);
  if (!email.ok) errors.email = email.error;
  res.json({ ok: !Object.keys(errors).length, errors, phone: phone ? contacts.formatPhone(phone) : null });
});

module.exports = router;
