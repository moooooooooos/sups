const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/categories
router.get('/', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all();

    // Get count per category
    const categoriesWithCount = categories.map(c => {
      const row = db.prepare('SELECT count(*) as count FROM products WHERE category = ? OR categories LIKE ?').get(c.slug, `%"${c.slug}"%`);
      return {
        ...c,
        count: row ? row.count : 0
      };
    });

    // Extract all unique collections with their product counts
    const productsWithColls = db.prepare("SELECT collections FROM products WHERE collections != '[]'").all();
    const collectionCountMap = {};

    productsWithColls.forEach(row => {
      try {
        const arr = JSON.parse(row.collections || '[]');
        arr.forEach(coll => {
          if (coll) {
            collectionCountMap[coll] = (collectionCountMap[coll] || 0) + 1;
          }
        });
      } catch (e) {}
    });

    const CANONICAL_COLLECTIONS = [
      'Истории и мифы',
      'Коллаборации',
      'Конец сказке',
      'Концептуализм',
      'Личная философия',
      'Магия случая',
      'САПС х «Стереополина»',
      'САПС х Stervell',
      'САПС х Маша Хима',
      'САПС х Без обид',
      'САПС х Никому не говори',
      'Сила внутри',
      'Уверенность и упорство',
      'Эмоция на металле'
    ];

    const collections = Object.keys(collectionCountMap).map(name => ({
      name,
      count: collectionCountMap[name]
    })).sort((a, b) => {
      const idxA = CANONICAL_COLLECTIONS.findIndex(c => c.toLowerCase() === a.name.toLowerCase());
      const idxB = CANONICAL_COLLECTIONS.findIndex(c => c.toLowerCase() === b.name.toLowerCase());
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name, 'ru');
    });

    // Extract all unique sizes available across products
    const productsWithSizes = db.prepare("SELECT sizes FROM products WHERE sizes != '[]'").all();
    const sizeCountMap = {};
    productsWithSizes.forEach(row => {
      try {
        const arr = JSON.parse(row.sizes || '[]');
        arr.forEach(sz => {
          if (sz) {
            sizeCountMap[sz] = (sizeCountMap[sz] || 0) + 1;
          }
        });
      } catch (e) {}
    });

    const sizes = Object.keys(sizeCountMap)
      .sort((a, b) => parseFloat(a) - parseFloat(b))
      .map(val => ({
        size: val,
        count: sizeCountMap[val]
      }));

    res.json({
      categories: categoriesWithCount,
      collections,
      sizes
    });
  } catch (err) {
    console.error('Error in /api/categories:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
