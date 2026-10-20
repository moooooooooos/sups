/**
 * SEO и переезд с Тильды без потери поиска:
 *  - страницы товаров по старым адресам Тильды (/rings/tproduct/<uid>-<slug>) открывают каталог
 *    сразу с карточкой товара и отдают свои title, description, Open Graph и разметку Schema.org;
 *  - у новых товаров адрес того же вида, slug строится из названия;
 *  - /sitemap.xml и /robots.txt;
 *  - постоянные (301) перенаправления со страниц Тильды, которых больше нет.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../db');

const PUBLIC_DIR = path.join(__dirname, '../../public');
const SITE_NAME = 'САПС';
const CATEGORY_PAGES = ['rings', 'earrings', 'pendants', 'bracelets', 'mystery'];
const STATIC_PAGES = [
  '/', '/catalogue', '/rings', '/earrings', '/pendants', '/bracelets', '/mystery', '/custom-sups',
  '/sizer', '/buyers', '/cooperation', '/offer', '/privacy', '/agreement', '/consent'
];

// Точные адреса товаров на Тильде (uid → путь), чтобы ссылки из поиска совпадали символ в символ
let tildaUrls = {};
try {
  tildaUrls = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/tilda-product-urls.json'), 'utf8'));
} catch (e) {
  tildaUrls = {};
}

function siteOrigin(req) {
  return process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

function slugify(title) {
  return String(title || '').toLowerCase()
    .split('').map(ch => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'product';
}

// Публичный адрес товара: адрес с Тильды, если был, иначе такой же по формату
function productPath(product) {
  if (product.uid && tildaUrls[String(product.uid)]) return tildaUrls[String(product.uid)];
  const section = CATEGORY_PAGES.includes(product.category) ? product.category : 'catalogue';
  return `/${section}/tproduct/${product.uid || product.id}-${slugify(product.title)}`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function plainText(html, max) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
}

function absoluteUrl(origin, url) {
  if (!url) return '';
  return /^https?:\/\//.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

// GET /<раздел>/tproduct/<uid>-<slug> — страница товара
router.get('/:section/tproduct/:slug', (req, res, next) => {
  const uid = (req.params.slug.match(/^(\d+)/) || [])[1];
  const product = uid ? db.prepare('SELECT * FROM products WHERE uid = ? OR id = ?').get(uid, uid) : null;
  const section = req.params.section;

  if (!product) {
    // Товар сняли с продажи — ведём в его раздел, чтобы посетитель из поиска не упирался в 404
    const target = CATEGORY_PAGES.includes(section) ? `/${section}` : '/catalogue';
    return res.redirect(301, target);
  }

  const canonicalPath = productPath(product);
  if (decodeURI(req.path) !== decodeURI(canonicalPath)) return res.redirect(301, canonicalPath);

  const pageFile = path.join(PUBLIC_DIR, `${CATEGORY_PAGES.includes(section) ? section : 'catalogue'}.html`);
  let html;
  try {
    html = fs.readFileSync(pageFile, 'utf8');
  } catch (e) {
    return next();
  }

  const origin = siteOrigin(req);
  const images = JSON.parse(product.images || '[]');
  const title = `${product.title} — купить за ${Math.round(product.price).toLocaleString('ru-RU')} ₽ | ${SITE_NAME}`;
  const description = plainText(product.description, 160) || `${product.title} из стали AISI 304 от бренда ${SITE_NAME}.`;
  const url = `${origin}${canonicalPath}`;
  const image = absoluteUrl(origin, images[0]);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: plainText(product.description, 500),
    image: images.slice(0, 6).map(src => absoluteUrl(origin, src)),
    sku: product.sku || String(product.uid || product.id),
    brand: { '@type': 'Brand', name: SITE_NAME },
    material: 'Сталь AISI 304',
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'RUB',
      price: product.price,
      availability: product.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition'
    }
  };

  const head = `
  <link rel="canonical" href="${escapeHtml(url)}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${escapeHtml(product.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(url)}">
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
  <meta property="product:price:amount" content="${product.price}">
  <meta property="product:price:currency" content="RUB">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <script>window.SUPS_OPEN_PRODUCT = ${Number(product.id)};</script>
`;

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(description)}">`)
    .replace('</head>', `${head}</head>`);

  res.set('Cache-Control', 'no-cache');
  res.send(html);
});

// GET /sitemap.xml — страницы и все товары в наличии
router.get('/sitemap.xml', (req, res) => {
  const origin = siteOrigin(req);
  const products = db.prepare('SELECT id, uid, title, category, updated_at FROM products WHERE in_stock = 1').all();
  const entry = (loc, lastmod, priority) => `  <url>\n    <loc>${escapeHtml(origin + loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <priority>${priority}</priority>\n  </url>`;
  const urls = [
    ...STATIC_PAGES.map(p => entry(p, null, p === '/' ? '1.0' : CATEGORY_PAGES.includes(p.slice(1)) || p === '/catalogue' ? '0.9' : '0.4')),
    ...products.map(p => entry(productPath(p), p.updated_at ? String(p.updated_at).slice(0, 10) : null, '0.8'))
  ];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
});

// GET /robots.txt — служебные страницы и API не индексируем
router.get('/robots.txt', (req, res) => {
  const origin = siteOrigin(req);
  res.type('text/plain').send([
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /account',
    'Disallow: /api/',
    'Disallow: /order-status',
    'Disallow: /test-payment',
    'Disallow: /leave-review',
    'Disallow: /*?*utm_',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    ''
  ].join('\n'));
});

// Страницы Тильды, которых на новом сайте нет
const LEGACY_REDIRECTS = {
  '/collaborations': '/catalogue?category=collaborations',
  '/business_card': '/',
  '/sitemap-store.xml': '/sitemap.xml',
  '/sitemap-feeds.xml': '/sitemap.xml'
};
Object.entries(LEGACY_REDIRECTS).forEach(([from, to]) => {
  router.get(from, (req, res) => res.redirect(301, to));
});

module.exports = { router, productPath };
