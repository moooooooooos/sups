const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /api/promo/validate — Validate a promo code
router.post('/validate', (req, res) => {
  try {
    const { code } = req.body;

    if (!code || !code.trim()) {
      return res.status(400).json({ valid: false, error: 'Введите промокод' });
    }

    const cleanCode = code.trim().toUpperCase();
    const promo = db.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = ?').get(cleanCode);

    if (!promo) {
      return res.status(404).json({ valid: false, error: 'Промокод не найден' });
    }

    if (!promo.is_active) {
      return res.status(400).json({ valid: false, error: 'Данный промокод неактивен' });
    }

    if (promo.max_uses && promo.current_uses >= promo.max_uses) {
      return res.status(400).json({ valid: false, error: 'Превышен лимит использования промокода' });
    }

    res.json({
      valid: true,
      code: promo.code,
      discount_percent: promo.discount_percent,
      message: `Промокод активирован! Скидка ${promo.discount_percent}%`
    });
  } catch (err) {
    console.error('Error validating promo code:', err);
    res.status(500).json({ valid: false, error: 'Ошибка проверки промокода' });
  }
});

module.exports = router;
