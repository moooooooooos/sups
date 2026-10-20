/**
 * Проверка сайта перед выкладкой: npm run smoke
 * Поднимает сервер на временной чистой базе (каталог из data/catalog-seed.json) и проверяет
 * страницы, API, защиту, SEO, админку и полный тестовый заказ. Рабочая база не трогается,
 * письма и уведомления никуда не уходят. Код выхода 1, если что-то сломано.
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sups-smoke-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = `Smoke-${crypto.randomBytes(8).toString('hex')}`;

const env = {
  ...process.env,
  PORT: String(PORT),
  SUPS_DB_PATH: path.join(TMP, 'smoke.db'),
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  CUSTOMER_JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  MAIL_OUTBOX_DIR: path.join(TMP, 'outbox'),
  SITE_URL: BASE
};

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ ${name} — ${err.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function req(method, url, { body, token, raw } = {}) {
  const res = await fetch(BASE + url, {
    method,
    redirect: 'manual',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  if (!raw) { try { json = JSON.parse(text); } catch (e) { /* не JSON */ } }
  return { status: res.status, headers: res.headers, text, json };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/products?limit=1`);
      if (r.ok) return;
    } catch (e) { /* ещё не поднялся */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('сервер не запустился за 15 секунд');
}

async function main() {
  console.log(`🧪 Проверка сайта на временной базе (${TMP})`);
  execFileSync(process.execPath, ['scripts/seed.js'], { cwd: ROOT, env, stdio: 'ignore' });
  execFileSync(process.execPath, ['scripts/set-admin-password.js'], {
    cwd: ROOT, env: { ...env, ADMIN_USER: 'admin', ADMIN_PASSWORD }, stdio: 'ignore'
  });

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let serverErrors = '';
  server.stderr.on('data', d => { serverErrors += d; });

  try {
    await waitForServer();

    console.log('\nСтраницы');
    const pages = ['/', '/catalogue', '/rings', '/earrings', '/pendants', '/bracelets', '/mystery', '/custom-sups',
      '/sizer', '/buyers', '/cooperation', '/privacy', '/agreement', '/offer', '/consent', '/leave-review',
      '/account', '/order-status', '/admin'];
    const assets = new Set();
    for (const p of pages) {
      await check(`страница ${p}`, async () => {
        const r = await req('GET', p, { raw: true });
        assert(r.status === 200, `код ${r.status}`);
        assert(/<\/html>/i.test(r.text), 'страница обрезана');
        for (const m of r.text.matchAll(/(?:src|href)="(\/(?:css|js|images|assets)\/[^"?#]+)/g)) assets.add(m[1]);
      });
    }
    await check(`файлы стилей, скриптов и картинок (${assets.size})`, async () => {
      const broken = [];
      for (const a of assets) {
        const r = await fetch(BASE + a);
        if (!r.ok) broken.push(`${a} ${r.status}`);
      }
      assert(!broken.length, broken.join(', '));
    });

    console.log('\nSEO');
    await check('robots.txt и sitemap.xml', async () => {
      const robots = await req('GET', '/robots.txt', { raw: true });
      assert(robots.status === 200 && robots.text.includes('Disallow: /admin'), 'robots.txt');
      const sitemap = await req('GET', '/sitemap.xml', { raw: true });
      assert(sitemap.status === 200 && (sitemap.text.match(/<loc>/g) || []).length > 20, 'sitemap.xml');
    });
    await check('страница товара по адресу Тильды', async () => {
      const urls = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tilda-product-urls.json'), 'utf8'));
      const first = Object.values(urls)[0];
      const r = await req('GET', first, { raw: true });
      assert(r.status === 200, `код ${r.status}`);
      assert(r.text.includes('application/ld+json') && r.text.includes('rel="canonical"'), 'нет разметки');
      assert(r.text.includes('window.SUPS_OPEN_PRODUCT'), 'карточка не откроется');
    });
    await check('старые страницы Тильды перенаправляются', async () => {
      const r = await req('GET', '/business_card');
      assert(r.status === 301, `код ${r.status}`);
    });

    console.log('\nAPI и защита');
    let product;
    await check('каталог товаров', async () => {
      const r = await req('GET', '/api/products?limit=100');
      assert(r.status === 200 && r.json.products.length > 0, 'пустой каталог');
      product = r.json.products.find(p => p.in_stock && (!p.sizes || p.sizes.length === 0)) || r.json.products.find(p => p.in_stock);
    });
    await check('админка без входа закрыта', async () => {
      const r = await req('GET', '/api/admin/orders');
      assert(r.status === 401, `код ${r.status}`);
    });
    await check('поддельное уведомление об оплате отклоняется', async () => {
      const r = await req('POST', '/api/payments/webhook', { body: { event: 'payment.succeeded', object: { id: 'fake', metadata: { order_number: 'X' } } } });
      assert(r.json && r.json.success === false, 'принято');
    });

    console.log('\nЗаказ');
    const size = product.sizes && product.sizes.length ? String(product.sizes[0]) : '';
    const orderBody = {
      customer_name: 'Смоук Тест',
      customer_phone: '+7 (912) 000-00-00',
      customer_email: 'smoke-test@gmail.com',
      delivery_address: 'г. Москва, ул. Тестовая, д. 1, кв. 1',
      items: [{ id: product.id, title: product.title, price: product.price, quantity: 1, size }],
      offer_accepted: true,
      pd_consent: true
    };
    await check('без согласия заказ не принимается', async () => {
      const r = await req('POST', '/api/orders', { body: { ...orderBody, pd_consent: false } });
      assert(r.status === 400, `код ${r.status}`);
    });
    await check('неверный телефон не принимается', async () => {
      const r = await req('POST', '/api/orders', { body: { ...orderBody, customer_phone: '123' } });
      assert(r.status === 400 && r.json.field === 'phone', `код ${r.status}`);
    });
    await check('подмена цены отклоняется', async () => {
      const r = await req('POST', '/api/orders', { body: { ...orderBody, items: [{ ...orderBody.items[0], price: 1 }] } });
      assert(r.status === 409, `код ${r.status}`);
    });
    let orderNumber;
    await check('заказ оформляется', async () => {
      const r = await req('POST', '/api/orders', { body: orderBody });
      assert(r.status === 201 && r.json.order_number, `код ${r.status} ${r.text.slice(0, 120)}`);
      orderNumber = r.json.order_number;
      assert(r.json.payment_url, 'нет ссылки на оплату');
    });
    await check('тестовая оплата проходит', async () => {
      const r = await req('POST', '/api/payments/test-confirm', { body: { order_number: orderNumber } });
      assert(r.status === 200, `код ${r.status} ${r.text.slice(0, 120)}`);
      const s = await req('GET', `/api/payments/status/${orderNumber}`);
      assert(s.json.payment_status === 'paid', 'заказ не оплачен');
      assert(!s.text.includes('912) 000-00-00') && !s.text.includes('smoke-test@'), 'данные покупателя не замаскированы');
    });

    console.log('\nАдминка');
    let token;
    await check('вход администратора', async () => {
      const r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: ADMIN_PASSWORD } });
      assert(r.status === 200 && r.json.token, `код ${r.status}`);
      token = r.json.token;
    });
    for (const p of ['/api/admin/stats', '/api/admin/orders', '/api/admin/customers', '/api/admin/settings',
      '/api/admin/products-trash', '/api/analytics/report?days=30', '/api/reviews/admin/list?status=all']) {
      await check(`GET ${p}`, async () => {
        const r = await req('GET', p, { token });
        assert(r.status === 200, `код ${r.status}`);
      });
    }
    await check('карточка заказа и смена статуса', async () => {
      const list = await req('GET', '/api/admin/orders', { token });
      const order = list.json.orders.find(o => o.order_number === orderNumber);
      assert(order, 'заказ не найден в админке');
      const st = await req('PUT', `/api/admin/orders/${order.id}/status`, { token, body: { status: 'processing' } });
      assert(st.status === 200, `статус: код ${st.status}`);
      const card = await req('GET', `/api/admin/orders/${order.id}`, { token });
      assert(card.json.history.map(h => h.status).join(',') === 'new,paid,processing', `история: ${card.json.history.map(h => h.status)}`);
    });
    await check('выгрузка заказов в Excel', async () => {
      const r = await req('GET', '/api/admin/orders-export', { token, raw: true });
      assert(r.status === 200 && r.text.includes(orderNumber), `код ${r.status}`);
    });

    if (/TypeError|ReferenceError|SyntaxError/.test(serverErrors)) {
      failures.push(`ошибки в логе сервера:\n${serverErrors.slice(0, 1500)}`);
    }
  } finally {
    server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(`\n${failures.length ? '❌' : '✅'} Пройдено: ${passed}, ошибок: ${failures.length}`);
  if (failures.length) {
    failures.forEach(f => console.log(`   - ${f}`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Проверка не запустилась:', err.message);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
});
