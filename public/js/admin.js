/**
 * SUPS Official — Admin Panel Application Logic
 */

let adminToken = localStorage.getItem('sups_admin_token') || null;
let currentTab = 'products';
let currentProducts = [];
let editingProductId = null;
let uploadedImages = [];
// Цвет каждого фото, параллельно uploadedImages: id варианта или '' (без цвета)
let uploadedImageColors = [];
// Цветовые варианты товара: { id, name, hex }. Фото хранятся в uploadedImageColors,
// при сохранении превращаются в индексы color_variants[].images
let currentColors = [];
let currentSizes = [];

const COLOR_PRESETS = [
  { name: 'Сталь', hex: '#c0c4c8' },
  { name: 'Чёрный', hex: '#1e1e1e' },
  { name: 'Золото', hex: '#d4af37' },
  { name: 'Розовое золото', hex: '#e8b4b8' }
];
let reviewUploadedPhotos = [];

document.addEventListener('DOMContentLoaded', () => {
  initAdminApp();
});

async function initAdminApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const qToken = urlParams.get('token');
  if (qToken) {
    adminToken = qToken;
    localStorage.setItem('sups_admin_token', qToken);
  }

  if (!adminToken) {
    showLoginScreen();
    return;
  }

  // Verify token
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!res.ok) throw new Error('Unauthorized');
    const data = await res.json();
    showAdminDashboard(data.user);
  } catch (err) {
    adminToken = null;
    localStorage.removeItem('sups_admin_token');
    showLoginScreen();
  }
}

function showLoginScreen() {
  const loginScreen = document.getElementById('admin-login-screen');
  const mainApp = document.getElementById('admin-main-app');
  if (loginScreen) loginScreen.style.display = 'flex';
  if (mainApp) mainApp.style.display = 'none';

  const form = document.getElementById('admin-login-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const userEl = document.getElementById('login-username');
      const passEl = document.getElementById('login-password');
      const errEl = document.getElementById('login-error');

      try {
        errEl.textContent = '';
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: userEl.value, password: passEl.value })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка входа');

        adminToken = data.token;
        localStorage.setItem('sups_admin_token', adminToken);
        showAdminDashboard(data.user);
      } catch (err) {
        errEl.textContent = err.message;
      }
    };
  }
}

function showAdminDashboard(user) {
  const loginScreen = document.getElementById('admin-login-screen');
  const mainApp = document.getElementById('admin-main-app');
  if (loginScreen) loginScreen.style.display = 'none';
  if (mainApp) mainApp.style.display = 'flex';

  const userBadge = document.getElementById('admin-username-badge');
  if (userBadge && user) userBadge.textContent = user.username;

  bindNavigation();
  switchTab('products');
  loadStats();
  updateTrashCount();
}

function bindNavigation() {
  const navItems = document.querySelectorAll('.admin-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.dataset.tab;
      if (tab) {
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        switchTab(tab);
      }
    });
  });

  const logoutBtn = document.getElementById('admin-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      adminToken = null;
      localStorage.removeItem('sups_admin_token');
      showLoginScreen();
    });
  }

  // Add Product Button
  const addProdBtn = document.getElementById('btn-open-add-product');
  if (addProdBtn) {
    addProdBtn.addEventListener('click', openAddProductModal);
  }

  // Upload dropzone
  const dropzone = document.getElementById('admin-upload-dropzone');
  const fileInput = document.getElementById('admin-photo-input');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) uploadFiles(fileInput.files);
    });
  }

  // Sizes Manager
  const addSizeBtn = document.getElementById('btn-add-size-tag');
  const sizeInput = document.getElementById('admin-input-new-size');
  if (addSizeBtn && sizeInput) {
    addSizeBtn.addEventListener('click', () => {
      const val = sizeInput.value.trim();
      if (val && !currentSizes.includes(val)) {
        currentSizes.push(val);
        renderSizesTags();
        sizeInput.value = '';
      }
    });
    sizeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSizeBtn.click();
      }
    });
  }

  // Colours Manager
  const addColorBtn = document.getElementById('btn-add-color');
  const colorNameInput = document.getElementById('admin-input-new-color-name');
  const colorHexInput = document.getElementById('admin-input-new-color-hex');
  if (addColorBtn && colorNameInput && colorHexInput) {
    addColorBtn.addEventListener('click', () => {
      if (addColorVariant(colorNameInput.value, colorHexInput.value)) {
        colorNameInput.value = '';
      }
    });
    colorNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addColorBtn.click();
      }
    });
  }

  const presetsEl = document.getElementById('admin-color-presets');
  if (presetsEl) {
    presetsEl.innerHTML = COLOR_PRESETS.map((p, i) => `
      <button type="button" class="color-preset-btn" onclick="addColorPreset(${i})">
        <span class="color-dot" style="background:${p.hex}"></span>${p.name}
      </button>
    `).join('');
  }

  const colorPhotoInput = document.getElementById('admin-color-photo-input');
  if (colorPhotoInput) {
    colorPhotoInput.addEventListener('change', async () => {
      if (colorPhotoInput.files.length) {
        await uploadFiles(colorPhotoInput.files, colorPhotoInput.dataset.colorId || '');
      }
      colorPhotoInput.value = '';
    });
  }

  // Product Form Submit
  const prodForm = document.getElementById('admin-product-form');
  if (prodForm) {
    prodForm.addEventListener('submit', handleProductFormSubmit);
  }

  // Review Form Submit
  const reviewForm = document.getElementById('admin-review-form');
  if (reviewForm) {
    reviewForm.addEventListener('submit', handleReviewFormSubmit);
  }

  // Settings Form Submit
  const settingsForm = document.getElementById('admin-settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', handleSettingsSubmit);
  }
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.admin-tab-view').forEach(v => v.style.display = 'none');
  const activeView = document.getElementById(`tab-view-${tab}`);
  if (activeView) activeView.style.display = 'block';

  const titleEl = document.getElementById('admin-topbar-title');
  if (titleEl) {
    const titles = {
      dashboard: 'Аналитика магазина',
      products: 'Управление ассортиментом',
      orders: 'Заказы интернет-магазина',
      reviews: 'Модерация отзывов покупателей',
      customers: 'База покупателей и скидок',
      promo: 'Управление промокодами',
      settings: 'Настройки магазина и Telegram'
    };
    titleEl.textContent = titles[tab] || 'Панель управления';
  }

  if (tab === 'products') loadProductsTable();
  if (tab === 'orders') loadOrdersTable();
  if (tab === 'reviews') loadReviewsTable();
  if (tab === 'customers') loadCustomersTable();
  if (tab === 'promo') loadPromoTable();
  if (tab === 'settings') loadSettings();
  if (tab === 'dashboard') loadAnalytics();
}

/* ============================================================
   Stats & Dashboard
   ============================================================ */
async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();

    const elTotal = document.getElementById('stat-total-products');
    const elStock = document.getElementById('stat-stock-products');
    const elOrders = document.getElementById('stat-total-orders');
    const elRev = document.getElementById('stat-total-rev');

    if (elTotal) elTotal.textContent = data.totalProducts;
    if (elStock) elStock.textContent = data.inStockProducts;
    if (elOrders) elOrders.textContent = data.newOrders;
    if (elRev) elRev.textContent = `${(data.revenue || 0).toLocaleString('ru-RU')} ₽`;
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

/* ============================================================
   Analytics (вкладка «Аналитика»)
   ============================================================ */
let analyticsDays = 30;
let analyticsBound = false;

const AN_DEVICE_NAMES = { mobile: 'Телефон', tablet: 'Планшет', desktop: 'Компьютер', unknown: 'Нет данных' };

function fmtRub(value) {
  return `${Math.round(value || 0).toLocaleString('ru-RU')} ₽`;
}

function fmtNum(value) {
  return Math.round(value || 0).toLocaleString('ru-RU');
}

function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m} мин ${String(s).padStart(2, '0')} с` : `${s} с`;
}

function bindAnalyticsControls() {
  if (analyticsBound) return;
  analyticsBound = true;
  document.querySelectorAll('#an-periods button').forEach(btn => {
    btn.addEventListener('click', () => {
      analyticsDays = parseInt(btn.dataset.days, 10) || 0;
      document.querySelectorAll('#an-periods button').forEach(b => b.classList.toggle('active', b === btn));
      loadAnalytics();
    });
  });
  const scopeEl = document.getElementById('an-scope');
  if (scopeEl) scopeEl.addEventListener('change', loadAnalytics);
}

async function loadAnalytics() {
  bindAnalyticsControls();
  const scope = (document.getElementById('an-scope') || {}).value || 'paid';
  try {
    const res = await fetch(`/api/analytics/report?days=${analyticsDays}&scope=${scope}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
    renderAnalytics(data);
  } catch (err) {
    const el = document.getElementById('an-kpis-sales');
    if (el) el.innerHTML = `<div class="an-empty" style="color:var(--admin-red);">Не удалось загрузить аналитику: ${escapeHtml(err.message)}</div>`;
  }
}

function anKpi(label, value, sub = '') {
  return `
    <div class="an-kpi">
      <div class="an-kpi-label">${label}</div>
      <div class="an-kpi-value">${value}</div>
      ${sub ? `<div class="an-kpi-sub">${sub}</div>` : ''}
    </div>
  `;
}

// Список «название — значение» с полоской доли от максимума
function anBarList(rows, opts = {}) {
  if (!rows || !rows.length) return '<div class="an-empty">Пока нет данных за этот период</div>';
  const valueOf = opts.value || (r => r.count);
  const max = Math.max(...rows.map(valueOf), 1);
  return `<div class="an-list">${rows.map(r => `
    <div class="an-row">
      <div class="an-row-top">
        <span class="an-row-name">${escapeHtml(opts.name ? opts.name(r) : r.name)}</span>
        <span class="an-row-val">${opts.label ? opts.label(r) : fmtNum(valueOf(r))}</span>
      </div>
      <div class="an-bar"><span style="width:${Math.max(2, (valueOf(r) / max) * 100)}%"></span></div>
    </div>
  `).join('')}</div>`;
}

function renderAnalytics(data) {
  const s = data.sales;
  const t = data.traffic;
  const scopeLabel = data.period.scope === 'all' ? 'оформленных' : 'оплаченных';

  document.getElementById('an-kpis-sales').innerHTML = [
    anKpi('Выручка', fmtRub(s.revenue), `${scopeLabel} заказов: ${fmtNum(s.orders_counted)}`),
    anKpi('Заказы', fmtNum(s.orders_created), `оплачено ${fmtNum(s.orders_paid)} · отменено ${fmtNum(s.orders_cancelled)}`),
    anKpi('Средний чек', fmtRub(s.avg_check)),
    anKpi('Продано изделий', `${fmtNum(s.items_sold)} шт.`),
    anKpi('Повторные заказы', fmtNum(s.repeat_orders), `покупателей вернулось: ${fmtNum(s.repeat_customers)}`),
    anKpi('Конверсия', `${s.conversion}%`, 'заказов на 100 визитов')
  ].join('');

  document.getElementById('an-kpis-traffic').innerHTML = [
    anKpi('Посетители', fmtNum(t.visitors), 'уникальные браузеры'),
    anKpi('Визиты', fmtNum(t.sessions)),
    anKpi('Просмотры страниц', fmtNum(t.pageviews)),
    anKpi('Среднее время на сайте', fmtDuration(t.avg_duration_sec)),
    anKpi('Страниц за визит', String(t.avg_pages).replace('.', ',')),
    anKpi('Отказы', `${String(t.bounce_rate).replace('.', ',')}%`, '1 страница и меньше 15 с')
  ].join('');

  renderDailyChart(data.daily);

  // Топ покупок с разбивкой по вариантам
  const purchasesEl = document.getElementById('an-top-purchases');
  purchasesEl.innerHTML = data.top_purchases.length
    ? `<div class="an-list">${data.top_purchases.map((p, i) => {
        const max = data.top_purchases[0].count || 1;
        return `
          <details class="an-purchase">
            <summary class="an-row">
              <div class="an-row-top">
                <span class="an-row-name">${i + 1}. ${escapeHtml(p.name)}</span>
                <span class="an-row-val">${fmtNum(p.count)} шт. · ${fmtRub(p.revenue)}</span>
              </div>
              <div class="an-bar"><span style="width:${Math.max(2, (p.count / max) * 100)}%"></span></div>
            </summary>
            <table class="an-variants">
              <tr><th>Вариант</th><th>Шт.</th><th>Сумма</th></tr>
              ${p.variants.map(v => `<tr><td>${escapeHtml(v.name)}</td><td>${fmtNum(v.count)}</td><td>${fmtRub(v.revenue)}</td></tr>`).join('')}
              <tr class="an-variants-total"><td>Заказов с товаром</td><td colspan="2">${fmtNum(p.orders)}</td></tr>
            </table>
          </details>
        `;
      }).join('')}</div>`
    : '<div class="an-empty">Пока нет продаж за этот период</div>';

  document.getElementById('an-top-viewed').innerHTML = anBarList(data.top_viewed, {
    label: r => `${fmtNum(r.count)} просм. · ${fmtNum(r.sessions)} виз.`
  });

  document.getElementById('an-top-cities').innerHTML = anBarList(data.top_cities, {
    label: r => `${fmtNum(r.count)} зак. · ${fmtRub(r.revenue)}`
  });

  document.getElementById('an-devices').innerHTML = `
    <div class="an-subtitle">Визиты</div>
    ${anBarList(data.devices.sessions, { name: r => AN_DEVICE_NAMES[r.name] || r.name })}
    <div class="an-subtitle">Заказы</div>
    ${anBarList(data.devices.orders, {
      name: r => AN_DEVICE_NAMES[r.name] || r.name,
      label: r => `${fmtNum(r.count)} зак. · ${fmtRub(r.revenue)}`
    })}
  `;

  document.getElementById('an-sources').innerHTML = anBarList(data.sources, {
    name: r => (r.name === 'direct' ? 'Прямые заходы' : r.name),
    label: r => `${fmtNum(r.count)} виз.`
  });

  document.getElementById('an-top-pages').innerHTML = anBarList(data.top_pages, {
    label: r => `${fmtNum(r.count)} просм.`
  });
}

// Столбики выручки по дням и линия визитов (SVG без библиотек)
function renderDailyChart(daily) {
  const el = document.getElementById('an-daily-chart');
  if (!el) return;
  if (!daily || !daily.length) {
    el.innerHTML = '<div class="an-empty">Пока нет данных за этот период</div>';
    return;
  }
  const W = 760, H = 220, padL = 8, padR = 8, padT = 12, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const step = innerW / daily.length;
  const maxRev = Math.max(...daily.map(d => d.revenue), 1);
  const maxSes = Math.max(...daily.map(d => d.sessions), 1);
  const barW = Math.max(2, Math.min(28, step * 0.6));
  const labelEvery = Math.ceil(daily.length / 10);

  const bars = daily.map((d, i) => {
    const h = (d.revenue / maxRev) * innerH;
    const x = padL + i * step + (step - barW) / 2;
    return `<rect class="an-chart-bar" x="${x.toFixed(1)}" y="${(padT + innerH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2">
      <title>${d.day}: ${fmtRub(d.revenue)}, заказов ${d.orders}, визитов ${d.sessions}</title></rect>`;
  }).join('');

  const points = daily.map((d, i) => {
    const x = padL + i * step + step / 2;
    const y = padT + innerH - (d.sessions / maxSes) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const labels = daily.map((d, i) => (i % labelEvery === 0
    ? `<text class="an-chart-label" x="${(padL + i * step + step / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${d.day.slice(8, 10)}.${d.day.slice(5, 7)}</text>`
    : '')).join('');

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="an-chart-svg" role="img" aria-label="Выручка и визиты по дням">
      <line class="an-chart-axis" x1="${padL}" x2="${W - padR}" y1="${padT + innerH}" y2="${padT + innerH}"></line>
      ${bars}
      <polyline class="an-chart-line" points="${points}"></polyline>
      ${labels}
    </svg>
    <div class="an-chart-max">макс. выручка за день: ${fmtRub(maxRev)} · макс. визитов: ${fmtNum(maxSes)}</div>
  `;
}

/* ============================================================
   Products CRUD & Inline Editing
   ============================================================ */
async function loadProductsTable() {
  const tbody = document.getElementById('admin-products-tbody');
  const searchInput = document.getElementById('admin-prod-search');
  const catFilter = document.getElementById('admin-prod-category-filter');
  const countEl = document.getElementById('admin-prod-count');

  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px;">Загрузка товаров...</td></tr>';

  try {
    const search = searchInput ? searchInput.value.trim() : '';
    const cat = catFilter ? catFilter.value : 'all';

    const params = new URLSearchParams({ limit: 200 });
    if (search) params.append('search', search);
    if (cat && cat !== 'all') params.append('category', cat);

    const res = await fetch(`/api/admin/products?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    currentProducts = data.products || [];

    if (countEl) countEl.textContent = `${currentProducts.length} шт.`;

    if (currentProducts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px;">Товары не найдены</td></tr>';
      return;
    }

    tbody.innerHTML = currentProducts.map(p => {
      const img = (p.images && p.images[0]) || '/assets/placeholder.jpg';
      let discountBadge = '';
      if (p.price_old && p.price_old > p.price) {
        const pct = Math.round((1 - p.price / p.price_old) * 100);
        discountBadge = `<span style="font-size:0.7rem; background:#ffe5e5; color:#d93838; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px;">-${pct}%</span>`;
      }

      return `
        <tr>
          <td>
            <div class="table-product-cell">
              <img src="${img}" class="table-product-thumb" onerror="this.src='/assets/placeholder.jpg'">
              <div>
                <strong>${p.title}</strong>
                <div style="font-size: 0.75rem; color: #888;">SKU: ${p.sku || '-'} | ID: ${p.id}</div>
              </div>
            </div>
          </td>
          <td>${formatCatLabel(p.category)}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="number" class="table-price-input" value="${p.price}" data-old="${p.price}"
                     onchange="updateInlinePrice(${p.id}, this.value, this)">
              <span>₽</span>
            </div>
          </td>
          <td>
            ${p.price_old ? `<span style="color:#888; text-decoration:line-through;">${p.price_old} ₽</span>${discountBadge}` : '-'}
          </td>
          <td>
            <button type="button" class="table-badge ${p.in_stock ? 'table-badge-instock' : 'table-badge-out'}"
                    style="border:none; cursor:pointer;"
                    onclick="toggleProductStock(${p.id}, ${p.in_stock ? 0 : 1})">
              ${p.in_stock ? 'В наличии' : 'Под заказ'}
            </button>
          </td>
          <td>${(p.sizes && p.sizes.length) ? p.sizes.join(', ') : '—'}</td>
          <td>
            <div class="table-actions-cell">
              <button class="admin-btn-icon" title="Редактировать" onclick="editProduct(${p.id})">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button class="admin-btn-icon" title="Сделать копию (для комбо и вариаций)" onclick="duplicateProduct(${p.id}, '${escapeQuote(p.title)}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <button class="admin-btn-icon delete" title="Удалить в корзину" onclick="deleteProduct(${p.id}, '${escapeQuote(p.title)}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading products table:', err);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">Ошибка загрузки</td></tr>';
  }
}

async function updateInlinePrice(productId, newPrice, inputEl) {
  const oldPrice = inputEl ? inputEl.dataset.old : '';
  const ok = await adminConfirm({
    title: 'Изменить цену?',
    text: `Новая цена: <b>${(parseFloat(newPrice) || 0).toLocaleString('ru-RU')} ₽</b>${oldPrice ? ` (было ${parseFloat(oldPrice).toLocaleString('ru-RU')} ₽)` : ''}. На сайте она изменится сразу.`,
    confirmText: 'Сохранить цену'
  });
  if (!ok) {
    if (inputEl) inputEl.value = oldPrice;
    return;
  }
  if (inputEl) inputEl.dataset.old = newPrice;
  try {
    const res = await fetch(`/api/admin/products/${productId}/price`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ price: parseFloat(newPrice) || 0 })
    });
    if (!res.ok) throw new Error('Ошибка обновления цены');
  } catch (err) {
    alert(err.message);
  }
}

async function toggleProductStock(productId, newStockStatus) {
  const ok = await adminConfirm({
    title: newStockStatus ? 'Вернуть товар в продажу?' : 'Снять товар с продажи?',
    text: newStockStatus ? 'Товар снова можно будет купить.' : 'Товар останется в каталоге с пометкой «нет в наличии», купить его будет нельзя.',
    confirmText: newStockStatus ? 'Вернуть в продажу' : 'Снять с продажи'
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/admin/products/${productId}/stock`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ in_stock: newStockStatus })
    });
    if (res.ok) loadProductsTable();
  } catch (err) {
    alert('Ошибка при изменении наличия');
  }
}

async function deleteProduct(productId, title) {
  const ok = await adminConfirm({
    title: 'Удалить товар?',
    text: `«${escapeHtml(title)}» пропадёт с сайта и попадёт в корзину. Восстановить его можно в течение 30 дней.`,
    confirmText: 'Удалить в корзину',
    danger: true
  });
  if (!ok) return;

  try {
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      loadProductsTable();
      loadStats();
      updateTrashCount();
    } else {
      throw new Error('Ошибка при удалении');
    }
  } catch (err) {
    alert(err.message);
  }
}

// Копия карточки: открывается сразу на редактирование
async function duplicateProduct(productId, title) {
  const ok = await adminConfirm({
    title: 'Сделать копию товара?',
    text: `Будет создана карточка «${escapeHtml(title)} (копия)» со всеми фото, размерами, цветами и описанием. Её можно сразу отредактировать.`,
    confirmText: 'Сделать копию'
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/admin/products/${productId}/duplicate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка копирования');
    await loadProductsTable();
    if (!currentProducts.some(p => p.id === data.product.id)) currentProducts.unshift(data.product);
    editProduct(data.product.id);
  } catch (err) {
    alert(err.message);
  }
}

/* ---------- Корзина удалённых товаров ---------- */
async function updateTrashCount() {
  const el = document.getElementById('admin-trash-count');
  if (!el) return;
  try {
    const res = await fetch('/api/admin/products-trash', { headers: { 'Authorization': `Bearer ${adminToken}` } });
    const data = await res.json();
    const n = (data.items || []).length;
    el.textContent = n ? String(n) : '';
  } catch (e) {}
}

async function openTrashModal() {
  const modal = document.getElementById('admin-trash-modal');
  const list = document.getElementById('admin-trash-list');
  list.innerHTML = '<div class="order-card-sub" style="padding:20px; text-align:center;">Загрузка…</div>';
  modal.classList.add('open');
  try {
    const res = await fetch('/api/admin/products-trash', { headers: { 'Authorization': `Bearer ${adminToken}` } });
    const data = await res.json();
    const items = data.items || [];
    list.innerHTML = items.length ? items.map(i => `
      <div class="trash-row">
        <img src="${escapeHtml(i.image || '/assets/placeholder.jpg')}" alt="">
        <div class="trash-info">
          <strong>${escapeHtml(i.title)}</strong>
          <div class="order-card-sub">${i.price ? `${Math.round(i.price).toLocaleString('ru-RU')} ₽ · ` : ''}удалён ${formatDate(i.deleted_at)} · ID ${i.id}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="restoreProduct(${i.id}, '${escapeQuote(i.title)}')">Восстановить</button>
        <button type="button" class="btn btn-sm btn-danger-outline" onclick="purgeProduct(${i.id}, '${escapeQuote(i.title)}')">Удалить навсегда</button>
      </div>
    `).join('') : '<div class="order-card-sub" style="padding:20px; text-align:center;">Корзина пуста</div>';
  } catch (e) {
    list.innerHTML = '<div style="color:var(--admin-red); padding:20px;">Не удалось загрузить корзину</div>';
  }
}

function closeTrashModal() {
  document.getElementById('admin-trash-modal').classList.remove('open');
}

async function restoreProduct(id, title) {
  const ok = await adminConfirm({ title: 'Восстановить товар?', text: `«${escapeHtml(title)}» снова появится в каталоге.`, confirmText: 'Восстановить' });
  if (!ok) return;
  const res = await fetch(`/api/admin/products-trash/${id}/restore`, { method: 'POST', headers: { 'Authorization': `Bearer ${adminToken}` } });
  if (!res.ok) { alert('Не удалось восстановить товар'); return; }
  openTrashModal();
  loadProductsTable();
  updateTrashCount();
}

async function purgeProduct(id, title) {
  const ok = await adminConfirm({
    title: 'Удалить навсегда?',
    text: `«${escapeHtml(title)}» будет удалён без возможности восстановления.`,
    confirmText: 'Удалить навсегда',
    danger: true
  });
  if (!ok) return;
  await fetch(`/api/admin/products-trash/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${adminToken}` } });
  openTrashModal();
  updateTrashCount();
}

/* ============================================================
   Add / Edit Product Modal & File Uploads
   ============================================================ */
function calcDiscountBadge() {
  const priceEl = document.getElementById('prod-form-price');
  const oldPriceEl = document.getElementById('prod-form-price-old');
  const badgeEl = document.getElementById('prod-discount-badge');

  if (!priceEl || !oldPriceEl || !badgeEl) return;

  const price = parseFloat(priceEl.value) || 0;
  const oldPrice = parseFloat(oldPriceEl.value) || 0;

  if (oldPrice > price && price > 0) {
    const pct = Math.round((1 - price / oldPrice) * 100);
    badgeEl.textContent = `(Скидка ${pct}%)`;
  } else {
    badgeEl.textContent = '';
  }
}

function addPhotoUrlFromInput() {
  const urlInput = document.getElementById('admin-input-photo-url');
  if (!urlInput) return;
  const val = urlInput.value.trim();
  if (val) {
    uploadedImages.push(val);
    uploadedImageColors.push('');
    renderImagePreviews();
    urlInput.value = '';
  }
}

function openAddProductModal() {
  editingProductId = null;
  uploadedImages = [];
  uploadedImageColors = [];
  currentColors = [];
  currentSizes = ['16', '17', '18', '19', '20', '21'];
  currentRelatedIds = [];
  briefProducts = null; // список для поиска перечитываем при каждом открытии формы

  document.getElementById('admin-modal-title').textContent = 'Добавить новый товар';
  document.getElementById('prod-form-title').value = '';
  document.getElementById('prod-form-sku').value = '';
  document.getElementById('prod-form-category').value = 'rings';
  document.getElementById('prod-form-collection').value = '';
  document.getElementById('prod-form-price').value = '';
  document.getElementById('prod-form-price-old').value = '';
  document.getElementById('prod-form-desc').value = '';
  document.getElementById('prod-form-instock').checked = true;
  document.getElementById('prod-form-bestseller').checked = false;

  calcDiscountBadge();
  renderImagePreviews();
  renderSizesTags();
  renderRelated();

  document.getElementById('admin-product-modal-backdrop').classList.add('open');
}

function editProduct(productId) {
  const prod = currentProducts.find(p => p.id === productId);
  if (!prod) return;

  editingProductId = productId;
  uploadedImages = Array.isArray(prod.images) ? [...prod.images] : [];
  currentSizes = Array.isArray(prod.sizes) ? [...prod.sizes] : [];
  currentRelatedIds = Array.isArray(prod.related_ids) ? [...prod.related_ids] : [];
  briefProducts = null;

  // color_variants[].images — индексы фото; раскладываем их по фото
  uploadedImageColors = uploadedImages.map(() => '');
  currentColors = [];
  (Array.isArray(prod.color_variants) ? prod.color_variants : []).forEach(v => {
    const id = String(v.id || v.name || '').trim();
    if (!id || currentColors.some(c => c.id === id)) return;
    currentColors.push({ id, name: v.name || id, hex: v.hex || '#cccccc' });
    (Array.isArray(v.images) ? v.images : []).forEach(i => {
      if (i >= 0 && i < uploadedImageColors.length && !uploadedImageColors[i]) {
        uploadedImageColors[i] = id;
      }
    });
  });

  document.getElementById('admin-modal-title').textContent = `Редактирование: ${prod.title}`;
  document.getElementById('prod-form-title').value = prod.title || '';
  document.getElementById('prod-form-sku').value = prod.sku || '';
  document.getElementById('prod-form-category').value = prod.category || 'rings';
  document.getElementById('prod-form-collection').value = (prod.collections && prod.collections[0]) || '';
  document.getElementById('prod-form-price').value = prod.price || '';
  document.getElementById('prod-form-price-old').value = prod.price_old || '';
  document.getElementById('prod-form-desc').value = prod.description || '';
  document.getElementById('prod-form-instock').checked = !!prod.in_stock;
  document.getElementById('prod-form-bestseller').checked = !!prod.is_bestseller;

  calcDiscountBadge();
  renderImagePreviews();
  renderSizesTags();
  renderRelated();

  document.getElementById('admin-product-modal-backdrop').classList.add('open');
}

function closeProductModal() {
  document.getElementById('admin-product-modal-backdrop').classList.remove('open');
}

async function uploadFiles(fileList, colorId = '') {
  const formData = new FormData();
  for (let i = 0; i < fileList.length; i++) {
    formData.append('photos', fileList[i]);
  }

  try {
    const res = await fetch('/api/admin/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');

    if (data.urls) {
      uploadedImages.push(...data.urls);
      uploadedImageColors.push(...data.urls.map(() => colorId));
      renderImagePreviews();
    }
  } catch (err) {
    alert(`Не удалось загрузить фото: ${err.message}`);
  }
}

// Общий альбом товара + блок цветов (они зависят друг от друга, поэтому рисуются вместе)
function renderImagePreviews() {
  const container = document.getElementById('admin-image-previews');
  if (container) {
    const last = uploadedImages.length - 1;
    container.innerHTML = uploadedImages.map((url, i) => {
      const colorId = uploadedImageColors[i] || '';
      const color = currentColors.find(c => c.id === colorId);
      return `
        <div class="image-preview-card" draggable="true" data-index="${i}" title="Перетащите, чтобы поменять порядок">
          <div class="image-preview-item" style="${color ? `border-color:${escapeHtml(color.hex)}` : ''}">
            <img src="${escapeHtml(url)}">
            <button type="button" class="image-preview-remove" onclick="removeUploadedImage(${i})" title="Удалить фото">×</button>
            ${i === 0 ? '<span class="image-preview-main">Главное</span>' : ''}
          </div>
          <div class="image-preview-move">
            <button type="button" onclick="moveUploadedImage(${i}, -1)" ${i === 0 ? 'disabled' : ''} title="Левее">‹</button>
            <button type="button" onclick="moveUploadedImage(${i}, 1)" ${i === last ? 'disabled' : ''} title="Правее">›</button>
          </div>
          ${currentColors.length ? `
            <select class="image-preview-color" onchange="setImageColor(${i}, this.value)" title="Цвет на фото">
              <option value="">Без цвета</option>
              ${currentColors.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === colorId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          ` : ''}
        </div>
      `;
    }).join('');
    bindPhotoDragAndDrop(container);
  }
  renderColorVariants();
}

// Перетаскивание фото: бросить на другое фото — встать на его место (цвет фото едет вместе с ним)
function bindPhotoDragAndDrop(container) {
  let from = null;
  container.querySelectorAll('.image-preview-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      from = parseInt(card.dataset.index, 10);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(from));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      container.querySelectorAll('.drop-target').forEach(c => c.classList.remove('drop-target'));
    });
    card.addEventListener('dragover', e => {
      if (from === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drop-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      const to = parseInt(card.dataset.index, 10);
      if (from === null || from === to) return;
      const [img] = uploadedImages.splice(from, 1);
      const [color] = uploadedImageColors.splice(from, 1);
      uploadedImages.splice(to, 0, img);
      uploadedImageColors.splice(to, 0, color);
      from = null;
      renderImagePreviews();
    });
  });
}

function removeUploadedImage(index) {
  uploadedImages.splice(index, 1);
  uploadedImageColors.splice(index, 1);
  renderImagePreviews();
}

function moveUploadedImage(index, delta) {
  const to = index + delta;
  if (to < 0 || to >= uploadedImages.length) return;
  [uploadedImages[index], uploadedImages[to]] = [uploadedImages[to], uploadedImages[index]];
  [uploadedImageColors[index], uploadedImageColors[to]] = [uploadedImageColors[to], uploadedImageColors[index]];
  renderImagePreviews();
}

function setImageColor(index, colorId) {
  uploadedImageColors[index] = colorId || '';
  renderImagePreviews();
}

/* ---------- «Может понравиться» ---------- */
let currentRelatedIds = [];
let briefProducts = null;

async function loadBriefProducts() {
  if (briefProducts) return briefProducts;
  const res = await fetch('/api/admin/products-brief', { headers: { 'Authorization': `Bearer ${adminToken}` } });
  const data = await res.json();
  briefProducts = data.products || [];
  return briefProducts;
}

async function renderRelated() {
  const list = document.getElementById('admin-related-list');
  if (!list) return;
  bindRelatedSearch();
  const all = await loadBriefProducts().catch(() => []);
  const byId = new Map(all.map(p => [p.id, p]));
  const items = currentRelatedIds.map(id => byId.get(id)).filter(Boolean);
  list.innerHTML = items.length ? items.map((p, i) => `
    <div class="related-item">
      <img src="${escapeHtml(p.image || '/assets/placeholder.jpg')}" alt="">
      <div class="related-info">
        <strong>${escapeHtml(p.title)}</strong>
        <span>${Math.round(p.price).toLocaleString('ru-RU')} ₽${p.in_stock ? '' : ' · нет в наличии, на сайте не покажется'}</span>
      </div>
      <button type="button" onclick="moveRelated(${i}, -1)" ${i === 0 ? 'disabled' : ''} title="Выше">↑</button>
      <button type="button" onclick="moveRelated(${i}, 1)" ${i === items.length - 1 ? 'disabled' : ''} title="Ниже">↓</button>
      <button type="button" class="related-remove" onclick="removeRelated(${p.id})" title="Убрать">×</button>
    </div>
  `).join('') : '<div class="settings-hint" style="margin:8px 0 0;">Пока не выбрано — на сайте покажутся товары, подобранные автоматически.</div>';
}

function bindRelatedSearch() {
  const input = document.getElementById('admin-related-search');
  const results = document.getElementById('admin-related-results');
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';

  input.addEventListener('input', async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { results.hidden = true; return; }
    const all = await loadBriefProducts();
    const found = all
      .filter(p => p.id !== editingProductId && !currentRelatedIds.includes(p.id))
      .filter(p => `${p.title} ${p.sku || ''}`.toLowerCase().includes(q))
      .slice(0, 8);
    results.innerHTML = found.length ? found.map(p => `
      <li data-id="${p.id}">
        <img src="${escapeHtml(p.image || '/assets/placeholder.jpg')}" alt="">
        <span>${escapeHtml(p.title)}</span>
        <small>${Math.round(p.price).toLocaleString('ru-RU')} ₽</small>
      </li>
    `).join('') : '<li class="related-empty">Ничего не найдено</li>';
    results.hidden = false;
  });

  results.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    e.preventDefault();
    if (currentRelatedIds.length >= 12) { alert('Можно выбрать до 12 украшений'); return; }
    currentRelatedIds.push(parseInt(li.dataset.id, 10));
    input.value = '';
    results.hidden = true;
    renderRelated();
  });
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));
}

function moveRelated(index, delta) {
  const to = index + delta;
  if (to < 0 || to >= currentRelatedIds.length) return;
  [currentRelatedIds[index], currentRelatedIds[to]] = [currentRelatedIds[to], currentRelatedIds[index]];
  renderRelated();
}

function removeRelated(id) {
  currentRelatedIds = currentRelatedIds.filter(x => x !== id);
  renderRelated();
}

/* ---------- Colour variants ---------- */
function addColorVariant(name, hex) {
  name = String(name || '').trim();
  if (!name) return false;
  if (currentColors.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    alert(`Цвет «${name}» уже добавлен`);
    return false;
  }
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  currentColors.push({ id, name, hex: hex || '#cccccc' });
  renderImagePreviews();
  return true;
}

function addColorPreset(index) {
  const p = COLOR_PRESETS[index];
  if (p) addColorVariant(p.name, p.hex);
}

function updateColorVariant(colorId, field, value) {
  const color = currentColors.find(c => c.id === colorId);
  if (!color) return;
  if (field === 'name') {
    value = String(value).trim();
    if (!value) { renderImagePreviews(); return; }
  }
  color[field] = value;
  renderImagePreviews();
}

async function removeColorVariant(colorId) {
  const color = currentColors.find(c => c.id === colorId);
  if (!color) return;
  const count = uploadedImageColors.filter(id => id === colorId).length;
  const msg = count
    ? `Удалить цвет «${color.name}»? Его фото (${count}) останутся в альбоме без цвета.`
    : `Удалить цвет «${color.name}»?`;
  if (!(await adminConfirm({ title: 'Удалить цвет?', text: escapeHtml(msg), confirmText: 'Удалить цвет', danger: true }))) return;
  currentColors = currentColors.filter(c => c.id !== colorId);
  uploadedImageColors = uploadedImageColors.map(id => (id === colorId ? '' : id));
  renderImagePreviews();
}

function pickColorPhotos(colorId) {
  const input = document.getElementById('admin-color-photo-input');
  if (!input) return;
  input.dataset.colorId = colorId;
  input.click();
}

function renderColorVariants() {
  const container = document.getElementById('admin-colors-container');
  const warningEl = document.getElementById('admin-colors-warning');
  if (!container) return;

  container.innerHTML = currentColors.map(c => {
    const photos = uploadedImages
      .map((url, i) => ({ url, i }))
      .filter(p => uploadedImageColors[p.i] === c.id);
    return `
      <div class="color-card">
        <div class="color-card-head">
          <input type="color" class="color-hex-input" value="${escapeHtml(c.hex)}"
                 onchange="updateColorVariant('${escapeHtml(c.id)}', 'hex', this.value)" title="Оттенок кружка на сайте">
          <input type="text" class="form-input color-name-input" value="${escapeHtml(c.name)}"
                 onchange="updateColorVariant('${escapeHtml(c.id)}', 'name', this.value)">
          <span class="color-card-count">${photos.length} фото</span>
          <button type="button" class="btn btn-secondary btn-sm" onclick="pickColorPhotos('${escapeHtml(c.id)}')">+ Загрузить фото</button>
          <button type="button" class="color-card-remove" onclick="removeColorVariant('${escapeHtml(c.id)}')" title="Удалить цвет">×</button>
        </div>
        <div class="color-card-photos">
          ${photos.length
            ? photos.map(p => `
                <div class="image-preview-item small">
                  <img src="${escapeHtml(p.url)}">
                  <button type="button" class="image-preview-remove" onclick="setImageColor(${p.i}, '')" title="Отвязать от цвета">×</button>
                </div>
              `).join('')
            : '<span class="color-card-empty">Нет фото — на сайте этот цвет не появится</span>'}
        </div>
      </div>
    `;
  }).join('');

  if (warningEl) {
    const untagged = currentColors.length ? uploadedImageColors.filter(id => !id).length : 0;
    warningEl.textContent = untagged
      ? `Фото без цвета: ${untagged}. Пока у товара есть цвета, покупатель их не увидит — выберите цвет под каждым фото.`
      : '';
  }
}

// Цвета в формате API: images — индексы фото в итоговом альбоме
function buildColorVariantsPayload() {
  return currentColors.map(c => ({
    id: c.id,
    name: c.name,
    hex: c.hex,
    images: uploadedImageColors
      .map((id, i) => (id === c.id ? i : -1))
      .filter(i => i >= 0)
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function renderSizesTags() {
  const container = document.getElementById('admin-sizes-tags-container');
  if (!container) return;

  container.innerHTML = currentSizes.map((sz, i) => `
    <div class="size-tag">
      <span>${sz}</span>
      <span class="size-tag-remove" onclick="removeSizeTag(${i})">×</span>
    </div>
  `).join('');
}

function removeSizeTag(index) {
  currentSizes.splice(index, 1);
  renderSizesTags();
}

async function handleProductFormSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('prod-form-title').value.trim();
  const price = parseFloat(document.getElementById('prod-form-price').value) || 0;
  const priceOldVal = document.getElementById('prod-form-price-old').value.trim();
  const priceOld = priceOldVal ? parseFloat(priceOldVal) : null;
  const sku = document.getElementById('prod-form-sku').value.trim();
  const category = document.getElementById('prod-form-category').value;
  const collection = document.getElementById('prod-form-collection').value.trim();
  const description = document.getElementById('prod-form-desc').value.trim();
  const in_stock = document.getElementById('prod-form-instock').checked ? 1 : 0;
  const is_bestseller = document.getElementById('prod-form-bestseller').checked ? 1 : 0;

  const payload = {
    title,
    sku,
    category,
    collections: collection ? [collection] : [],
    price,
    price_old: priceOld,
    description,
    images: uploadedImages,
    color_variants: buildColorVariantsPayload(),
    related_ids: currentRelatedIds,
    sizes: currentSizes,
    in_stock,
    is_bestseller
  };

  try {
    const url = editingProductId ? `/api/admin/products/${editingProductId}` : '/api/admin/products';
    const method = editingProductId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка при сохранении');

    closeProductModal();
    loadProductsTable();
    loadStats();
  } catch (err) {
    alert(err.message);
  }
}

/* ============================================================
   Reviews Management & Moderation
   ============================================================ */
async function loadReviewsTable() {
  const tbody = document.getElementById('admin-reviews-tbody');
  const statusFilter = document.getElementById('admin-reviews-status-filter');
  const countEl = document.getElementById('admin-reviews-count');

  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 30px;">Загрузка отзывов...</td></tr>';

  try {
    const status = statusFilter ? statusFilter.value : 'all';
    const res = await fetch(`/api/reviews/admin/list?status=${status}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const reviews = data.reviews || [];

    if (countEl) countEl.textContent = `${reviews.length} шт.`;

    if (reviews.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 30px;">Отзывов не найдено</td></tr>';
      return;
    }

    tbody.innerHTML = reviews.map(r => {
      const photos = Array.isArray(r.photos) ? r.photos : [];
      const photosHtml = photos.length > 0 ? `
        <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
          ${photos.map(p => `<img src="${p}" style="width:44px; height:44px; object-fit:cover; border-radius:4px; border:1px solid #ddd;" target="_blank">`).join('')}
        </div>
      ` : '';

      const productBadge = r.product_title ? `
        <div style="display:flex; align-items:center; gap:8px;">
          ${r.product_image ? `<img src="${r.product_image}" style="width:36px; height:36px; object-fit:cover; border-radius:4px;">` : ''}
          <div style="font-weight:600; font-size:0.85rem;">${r.product_title}</div>
        </div>
      ` : '<span style="color:#888; font-style:italic;">Общий отзыв</span>';

      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);

      return `
        <tr>
          <td>
            <strong>${r.author_name}</strong>
            <div style="font-size:0.8rem; color:#888;">${r.city || 'Город не указан'}</div>
            <div style="font-size:0.75rem; color:#aaa;">${formatDate(r.created_at)}</div>
          </td>
          <td>${productBadge}</td>
          <td><span style="color:#f59e0b; font-weight:bold;">${stars}</span></td>
          <td>
            <div style="max-width:320px; font-size:0.85rem; line-height:1.4;">${r.text}</div>
            ${photosHtml}
          </td>
          <td>
            <select class="filter-select" onchange="updateReviewStatus(${r.id}, this.value)" style="padding:4px 8px; font-size:0.8rem;">
              <option value="approved" ${r.status === 'approved' ? 'selected' : ''}>Одобрен</option>
              <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>Модерация</option>
              <option value="rejected" ${r.status === 'rejected' ? 'selected' : ''}>Отклонен</option>
            </select>
          </td>
          <td>
            <div class="table-actions-cell">
              <button class="admin-btn-icon delete" title="Удалить отзыв" onclick="deleteReview(${r.id}, '${escapeQuote(r.author_name)}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading reviews table:', err);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Ошибка загрузки отзывов</td></tr>';
  }
}

async function updateReviewStatus(reviewId, newStatus) {
  try {
    const res = await fetch(`/api/reviews/admin/${reviewId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error('Ошибка обновления статуса');
  } catch (err) {
    alert(err.message);
  }
}

async function deleteReview(reviewId, author) {
  if (!(await adminConfirm({ title: 'Удалить отзыв?', text: `Отзыв от «${escapeHtml(author)}» будет удалён без возможности восстановления.`, confirmText: 'Удалить', danger: true }))) return;

  try {
    const res = await fetch(`/api/reviews/admin/${reviewId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      loadReviewsTable();
    } else {
      throw new Error('Ошибка при удалении');
    }
  } catch (err) {
    alert(err.message);
  }
}

async function openAddReviewModal() {
  reviewUploadedPhotos = [];
  document.getElementById('review-form-author').value = '';
  document.getElementById('review-form-city').value = '';
  document.getElementById('review-form-rating').value = '5';
  document.getElementById('review-form-text').value = '';
  document.getElementById('review-form-status').value = 'approved';

  // Populate product dropdown
  const prodSelect = document.getElementById('review-form-product-id');
  if (prodSelect) {
    prodSelect.innerHTML = '<option value="">Без привязки к конкретному товару</option>';
    if (currentProducts.length === 0) {
      try {
        const res = await fetch('/api/products?limit=200');
        const data = await res.json();
        currentProducts = data.products || [];
      } catch (e) {}
    }
    currentProducts.forEach(p => {
      prodSelect.innerHTML += `<option value="${p.id}">${p.title} (${p.price} ₽)</option>`;
    });
  }

  renderReviewImagePreviews();
  document.getElementById('admin-review-modal-backdrop').classList.add('open');
}

function closeReviewModal() {
  document.getElementById('admin-review-modal-backdrop').classList.remove('open');
}

function addReviewPhotoUrl() {
  const urlInput = document.getElementById('admin-input-review-photo-url');
  if (!urlInput) return;
  const val = urlInput.value.trim();
  if (val) {
    reviewUploadedPhotos.push(val);
    renderReviewImagePreviews();
    urlInput.value = '';
  }
}

function renderReviewImagePreviews() {
  const container = document.getElementById('admin-review-photo-previews');
  if (!container) return;

  container.innerHTML = reviewUploadedPhotos.map((url, i) => `
    <div class="image-preview-item">
      <img src="${url}">
      <button type="button" class="image-preview-remove" onclick="removeReviewUploadedPhoto(${i})">×</button>
    </div>
  `).join('');
}

function removeReviewUploadedPhoto(index) {
  reviewUploadedPhotos.splice(index, 1);
  renderReviewImagePreviews();
}

async function handleReviewFormSubmit(e) {
  e.preventDefault();

  const product_id = document.getElementById('review-form-product-id').value;
  const author_name = document.getElementById('review-form-author').value.trim();
  const city = document.getElementById('review-form-city').value.trim();
  const rating = document.getElementById('review-form-rating').value;
  const text = document.getElementById('review-form-text').value.trim();
  const status = document.getElementById('review-form-status').value;

  const payload = {
    product_id: product_id ? parseInt(product_id) : null,
    author_name,
    city,
    rating: parseInt(rating),
    text,
    photos: reviewUploadedPhotos,
    status
  };

  try {
    const res = await fetch('/api/reviews/admin/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка при сохранении отзыва');

    closeReviewModal();
    loadReviewsTable();
  } catch (err) {
    alert(err.message);
  }
}

/* ============================================================
   Orders Management & Detail Modal
   ============================================================ */
/* ---------- Подтверждение действий (вместо системного confirm) ---------- */
function adminConfirm({ title = 'Подтвердите действие', text = '', confirmText = 'Подтвердить', danger = false } = {}) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop open confirm-backdrop';
    backdrop.innerHTML = `
      <div class="admin-modal-card confirm-card" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        ${text ? `<p>${text}</p>` : ''}
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-answer="no">Отмена</button>
          <button type="button" class="btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    const close = answer => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(answer);
    };
    const onKey = e => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    backdrop.addEventListener('click', e => {
      const btn = e.target.closest('[data-answer]');
      if (btn) close(btn.dataset.answer === 'yes');
      else if (e.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-answer="yes"]').focus();
  });
}

/* ---------- Небольшая форма в окне (вместо системного prompt, который работает не везде) ---------- */
function adminForm({ title, text = '', fields, confirmText = 'Сохранить' }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop open confirm-backdrop';
    backdrop.innerHTML = `
      <form class="admin-modal-card confirm-card" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        ${text ? `<p>${text}</p>` : ''}
        ${fields.map(fl => `
          <div class="form-group">
            <label class="form-label">${escapeHtml(fl.label)}</label>
            <input class="form-input" name="${escapeHtml(fl.name)}" type="${fl.type || 'text'}" value="${escapeHtml(fl.value ?? '')}"
              ${fl.min !== undefined ? `min="${fl.min}"` : ''} ${fl.max !== undefined ? `max="${fl.max}"` : ''} required>
          </div>
        `).join('')}
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-answer="no">Отмена</button>
          <button type="submit" class="btn btn-primary btn-sm">${escapeHtml(confirmText)}</button>
        </div>
      </form>
    `;
    const form = backdrop.querySelector('form');
    const close = value => { backdrop.remove(); resolve(value); };
    form.addEventListener('submit', e => {
      e.preventDefault();
      close(Object.fromEntries(new FormData(form).entries()));
    });
    backdrop.addEventListener('click', e => {
      if (e.target.closest('[data-answer="no"]') || e.target === backdrop) close(null);
    });
    backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
    document.body.appendChild(backdrop);
    form.querySelector('input').focus();
  });
}

/* ---------- Заказы ---------- */
const ORDER_STATUS_LABELS = {
  new: 'Ожидает оплаты',
  paid: 'Оплачен, в обработке',
  processing: 'Собираем заказ',
  shipped: 'Передан в доставку',
  ready_for_pickup: 'Ждёт в пункте выдачи',
  delivered: 'Получен',
  completed: 'Получен',
  returned: 'Возврат',
  cancelled: 'Отменён'
};
const ORDER_STATUS_ORDER = ['new', 'paid', 'processing', 'shipped', 'ready_for_pickup', 'delivered', 'returned', 'cancelled'];

function orderStatusBadge(status) {
  return `<span class="order-badge order-badge-${escapeHtml(status || 'new')}">${escapeHtml(ORDER_STATUS_LABELS[status] || status)}</span>`;
}

function paymentBadge(o) {
  if (o.payment_status === 'paid' || o.status === 'paid') return '<span class="pay-badge pay-ok">Оплачен</span>';
  if (o.payment_status === 'canceled') return '<span class="pay-badge pay-fail">Оплата не прошла</span>';
  return '<span class="pay-badge pay-wait">Ожидает оплаты</span>';
}

function rubles(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} ₽`;
}

async function loadOrdersTable() {
  const tbody = document.getElementById('admin-orders-tbody');
  const statusFilter = document.getElementById('admin-orders-status-filter');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px;">Загрузка заказов...</td></tr>';

  try {
    const status = statusFilter ? statusFilter.value : 'all';
    const res = await fetch(`/api/admin/orders?status=${status}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px;">Заказов пока нет</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td><strong>#${escapeHtml(o.order_number)}</strong></td>
        <td>${formatDate(o.created_at)}</td>
        <td>
          <div><strong>${escapeHtml(o.customer_name)}</strong></div>
          <div style="font-size:0.8rem; color:#888;">${escapeHtml(o.customer_phone)}</div>
        </td>
        <td>
          <div>${escapeHtml(o.delivery_method || '—')}</div>
          ${o.tracking_number ? `<div style="font-size:0.75rem; color:#888;">Трек: ${escapeHtml(o.tracking_number)}</div>` : ''}
        </td>
        <td>
          <div><strong>${rubles(o.total_price)}</strong></div>
          <div style="margin-top:4px;">${paymentBadge(o)}</div>
        </td>
        <td>
          <select class="filter-select order-status-select" data-current="${escapeHtml(o.status)}" onchange="updateOrderStatus(${o.id}, this.value, this)" style="padding:4px 8px; font-size:0.8rem;">
            ${ORDER_STATUS_ORDER.map(s => `<option value="${s}" ${(o.status === s || (o.status === 'completed' && s === 'delivered')) ? 'selected' : ''}>${ORDER_STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="viewOrderDetails(${o.id})">Открыть</button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">Ошибка загрузки заказов</td></tr>';
  }
}

async function updateOrderStatus(orderId, newStatus, selectEl) {
  const previous = selectEl ? selectEl.dataset.current : null;
  const ok = await adminConfirm({
    title: 'Сменить статус заказа?',
    text: `Новый статус: <b>${escapeHtml(ORDER_STATUS_LABELS[newStatus] || newStatus)}</b>. Покупатель увидит его в личном кабинете.`,
    confirmText: 'Сменить статус',
    danger: newStatus === 'cancelled'
  });
  if (!ok) {
    if (selectEl && previous) selectEl.value = previous === 'completed' ? 'delivered' : previous;
    return false;
  }
  try {
    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error();
    if (selectEl) selectEl.dataset.current = newStatus;
    loadStats();
    return true;
  } catch (err) {
    alert('Ошибка обновления статуса');
    if (selectEl && previous) selectEl.value = previous;
    return false;
  }
}

async function viewOrderDetails(orderId) {
  const modal = document.getElementById('admin-order-modal');
  const contentEl = document.getElementById('admin-order-detail-content');
  contentEl.innerHTML = '<div style="padding:30px; text-align:center; color:#888;">Загрузка заказа…</div>';
  modal.classList.add('open');

  try {
    const res = await fetch(`/api/admin/orders/${orderId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
    renderOrderCard(data);
  } catch (e) {
    contentEl.innerHTML = `<div style="padding:30px; color:var(--admin-red);">Не удалось загрузить заказ: ${escapeHtml(e.message)}</div>`;
  }
}

function renderOrderCard({ order: o, history, customer }) {
  const contentEl = document.getElementById('admin-order-detail-content');
  const items = Array.isArray(o.items) ? o.items : [];
  const itemsCount = items.reduce((n, i) => n + (parseInt(i.quantity, 10) || 1), 0);
  const deliveryType = { pvz: 'Пункт выдачи / постамат', courier: 'Курьер до двери' }[o.delivery_type] || '';
  const trackingUrl = o.tracking_number && o.delivery_provider === 'cdek'
    ? `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(o.tracking_number)}` : '';
  const canCreateShipment = o.delivery_provider === 'cdek' && !o.shipment_uuid && o.status !== 'cancelled';
  const copyText = [
    `Заказ ${o.order_number}`, o.customer_name, o.customer_phone, o.customer_email,
    `${o.delivery_method || ''}: ${o.delivery_address || ''}`,
    ...items.map(i => `${i.title}${i.size ? `, р. ${i.size}` : ''}${i.color ? `, ${i.color}` : ''} × ${i.quantity}`)
  ].filter(Boolean).join('\n');

  contentEl.innerHTML = `
    <div class="order-card-head">
      <div>
        <h3>Заказ #${escapeHtml(o.order_number)}</h3>
        <div class="order-card-sub">Создан ${formatDate(o.created_at)}${o.device ? ` · ${{ mobile: 'с телефона', tablet: 'с планшета', desktop: 'с компьютера' }[o.device] || ''}` : ''}</div>
      </div>
      <div class="order-card-badges">${orderStatusBadge(o.status)} ${paymentBadge(o)}</div>
    </div>

    <div class="order-timeline">
      ${history.map(h => `
        <div class="order-timeline-step">
          <span class="order-timeline-dot"></span>
          <div><b>${escapeHtml(h.label)}</b><div class="order-card-sub">${formatDate(h.created_at)}</div></div>
        </div>
      `).join('')}
    </div>

    <div class="order-card-grid">
      <div class="ui-card">
        <strong>Покупатель</strong>
        <div class="order-card-lines">
          <div>${escapeHtml(o.customer_name)}</div>
          <div><a href="tel:${escapeHtml(o.customer_phone)}">${escapeHtml(o.customer_phone)}</a></div>
          ${o.customer_email ? `<div><a href="mailto:${escapeHtml(o.customer_email)}">${escapeHtml(o.customer_email)}</a></div>` : ''}
          <div class="order-card-sub">Заказов у покупателя: ${customer.orders_count}${customer.paid_sum ? ` · оплачено всего ${rubles(customer.paid_sum)}` : ''}</div>
          ${o.customer_id ? '<div class="order-card-sub">Есть личный кабинет</div>' : ''}
        </div>
      </div>

      <div class="ui-card">
        <strong>Доставка</strong>
        <div class="order-card-lines">
          <div><b>${escapeHtml(o.delivery_method || '—')}</b>${deliveryType ? ` · ${deliveryType}` : ''}</div>
          <div>${escapeHtml(o.delivery_address || 'Адрес не указан')}</div>
          ${o.delivery_point_id ? `<div class="order-card-sub">Код пункта: ${escapeHtml(o.delivery_point_id)}</div>` : ''}
          ${o.tracking_number ? `<div>Трек-номер: <b>${escapeHtml(o.tracking_number)}</b>${trackingUrl ? ` · <a href="${trackingUrl}" target="_blank" rel="noopener">отследить</a>` : ''}</div>` : ''}
          ${o.shipment_status ? `<div class="order-card-sub">Статус СДЭК: ${escapeHtml(o.shipment_status)}${o.shipment_synced_at ? ` (обновлён ${formatDate(o.shipment_synced_at)})` : ''}</div>` : ''}
          ${o.shipment_error ? `<div class="order-card-error">Ошибка СДЭК: ${escapeHtml(o.shipment_error)}</div>` : ''}
          <div class="order-card-actions">
            ${canCreateShipment ? `<button type="button" class="btn btn-primary btn-sm" onclick="createOrderShipment(${o.id})">Передать в СДЭК</button>` : ''}
            ${o.shipment_uuid ? `<button type="button" class="btn btn-secondary btn-sm" onclick="syncOrderShipment(${o.id})">Обновить статус из СДЭК</button>` : ''}
          </div>
          ${!o.delivery_provider ? '<div class="order-card-sub">Заказ оформлен без выбора перевозчика — отправление создаётся вручную.</div>' : ''}
        </div>
      </div>
    </div>

    ${o.comment ? `<div class="ui-card order-comment"><strong>Комментарий покупателя</strong><div>${escapeHtml(o.comment)}</div></div>` : ''}

    <h4 style="margin: 20px 0 10px;">Состав заказа · ${itemsCount} шт.</h4>
    <div class="order-items">
      ${items.map(item => `
        <div class="order-item">
          <img src="${escapeHtml(item.image || '/assets/placeholder.jpg')}" alt="">
          <div class="order-item-info">
            <strong>${escapeHtml(item.title)}</strong>
            <div class="order-card-sub">
              ${[item.size ? `Размер: ${escapeHtml(item.size)}` : '', item.color ? `Цвет: ${escapeHtml(item.color)}` : '', item.id && !item.is_custom ? `ID ${escapeHtml(item.id)}` : ''].filter(Boolean).join(' · ')}
            </div>
            ${item.is_custom && item.custom_details ? `
              <div class="order-item-custom">⚙️ Металл: ${escapeHtml(item.custom_details.metal || '-')} · Текст: «${escapeHtml(item.custom_details.text || '-')}» · Шрифт: ${escapeHtml(item.custom_details.font || '-')}</div>
            ` : ''}
          </div>
          <div class="order-item-price">${item.quantity} × ${rubles(item.price)}<br><b>${rubles(item.price * item.quantity)}</b></div>
        </div>
      `).join('')}
    </div>

    <div class="order-totals">
      <div><span>Товары</span><span>${rubles(o.subtotal)}</span></div>
      ${o.discount_amount ? `<div><span>Скидка</span><span>−${rubles(o.discount_amount)}</span></div>` : ''}
      ${o.bonus_used ? `<div><span>Оплачено бонусами</span><span>−${rubles(o.bonus_used)}</span></div>` : ''}
      ${o.promo_code ? `<div><span>Промокод</span><span>${escapeHtml(o.promo_code)}</span></div>` : ''}
      <div><span>Доставка</span><span>${o.delivery_price ? rubles(o.delivery_price) : 'бесплатно'}</span></div>
      <div class="order-totals-total"><span>Итого</span><span>${rubles(o.total_price)}</span></div>
      <div class="order-card-sub">${o.paid_at ? `Оплачен ${formatDate(o.paid_at)}` : 'Оплата не поступала'}${o.payment_id ? ` · платёж ${escapeHtml(o.payment_id)}` : ''}</div>
    </div>

    <div class="order-card-actions" style="margin-top:16px;">
      <button type="button" class="btn btn-secondary btn-sm" id="order-copy-btn">Скопировать данные</button>
      ${o.status !== 'cancelled' ? `<button type="button" class="btn btn-sm btn-danger-outline" onclick="cancelOrderFromCard(${o.id})">Отменить заказ</button>` : ''}
    </div>
    ${o.pd_consent_at ? `<div class="order-card-sub" style="margin-top:10px;">Согласие на обработку ПД: ${formatDate(o.pd_consent_at)}</div>` : ''}
  `;

  document.getElementById('order-copy-btn').addEventListener('click', async e => {
    try {
      await navigator.clipboard.writeText(copyText);
      e.target.textContent = 'Скопировано';
    } catch (err) {
      e.target.textContent = 'Не удалось скопировать';
    }
  });
}

async function createOrderShipment(orderId) {
  const ok = await adminConfirm({
    title: 'Передать заказ в СДЭК?',
    text: 'В СДЭК будет создано отправление с данными покупателя и составом заказа. После этого статус доставки будет обновляться автоматически.',
    confirmText: 'Создать отправление'
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/admin/orders/${orderId}/shipment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setTimeout(() => viewOrderDetails(orderId), 5000);
    viewOrderDetails(orderId);
    loadOrdersTable();
  } catch (e) {
    alert(`Не удалось создать отправление: ${e.message}`);
  }
}

async function syncOrderShipment(orderId) {
  try {
    const res = await fetch(`/api/admin/orders/${orderId}/sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    viewOrderDetails(orderId);
    loadOrdersTable();
  } catch (e) {
    alert(e.message);
  }
}

async function cancelOrderFromCard(orderId) {
  if (await updateOrderStatus(orderId, 'cancelled')) {
    viewOrderDetails(orderId);
    loadOrdersTable();
  }
}

function closeOrderModal() {
  document.getElementById('admin-order-modal').classList.remove('open');
}

/* ============================================================
   Settings Management
   ============================================================ */
async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const s = data.settings || {};

    const elToken = document.getElementById('setting-tg-token');
    const elChat = document.getElementById('setting-tg-chat');
    const elPvz = document.getElementById('setting-deliv-pvz');
    const elCourier = document.getElementById('setting-deliv-courier');
    const elPost = document.getElementById('setting-deliv-post');
    const elYooShop = document.getElementById('setting-yoo-shop-id');
    const elYooKey = document.getElementById('setting-yoo-secret-key');
    const elYooTest = document.getElementById('setting-yoo-test-mode');
    const elWebhook = document.getElementById('yoo-webhook-url');

    if (elToken) elToken.value = s.telegram_bot_token || '';
    if (elChat) elChat.value = s.telegram_chat_id || '';
    if (elPvz) elPvz.value = s.delivery_cdek_pvz || '350';
    if (elCourier) elCourier.value = s.delivery_cdek_courier || '550';
    if (elPost) elPost.value = s.delivery_post || '390';
    if (elYooShop) elYooShop.value = s.yookassa_shop_id || '';
    if (elYooKey) elYooKey.value = s.yookassa_secret_key || '';
    if (elYooTest) elYooTest.checked = s.yookassa_test_mode !== '0';
    if (elWebhook) elWebhook.textContent = `${window.location.origin}/api/payments/webhook`;

    const setVal = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    setVal('setting-free-delivery', s.free_delivery_threshold ?? '7000');
    setVal('setting-parcel-weight', s.delivery_parcel_weight_g || '300');
    setVal('setting-item-weight', s.delivery_item_weight_g || '50');
    setVal('setting-cdek-id', s.cdek_client_id || '');
    setVal('setting-cdek-secret', s.cdek_client_secret || '');
    setVal('setting-cdek-city', s.cdek_sender_city_code || '250');
    setVal('setting-cdek-shipment-point', s.cdek_shipment_point || '');
    setVal('setting-ya-token', s.yandex_delivery_token || '');
    setVal('setting-ya-station', s.yandex_delivery_station_id || '');
    setVal('setting-dadata-key', s.dadata_api_key || '');
    const cdekTest = document.getElementById('setting-cdek-test');
    if (cdekTest) cdekTest.checked = s.cdek_test_mode !== '0';
    const yaTest = document.getElementById('setting-ya-test');
    if (yaTest) yaTest.checked = s.yandex_delivery_test_mode !== '0';
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const payload = {
    telegram_bot_token: document.getElementById('setting-tg-token').value.trim(),
    telegram_chat_id: document.getElementById('setting-tg-chat').value.trim(),
    delivery_cdek_pvz: document.getElementById('setting-deliv-pvz').value.trim(),
    delivery_cdek_courier: document.getElementById('setting-deliv-courier') ? document.getElementById('setting-deliv-courier').value.trim() : '550',
    delivery_post: document.getElementById('setting-deliv-post') ? document.getElementById('setting-deliv-post').value.trim() : '390',
    yookassa_shop_id: document.getElementById('setting-yoo-shop-id') ? document.getElementById('setting-yoo-shop-id').value.trim() : '',
    yookassa_secret_key: document.getElementById('setting-yoo-secret-key') ? document.getElementById('setting-yoo-secret-key').value.trim() : '',
    yookassa_test_mode: document.getElementById('setting-yoo-test-mode') && document.getElementById('setting-yoo-test-mode').checked ? '1' : '0'
  };

  // Доставка: перевозчики и параметры посылки
  const deliveryFields = {
    free_delivery_threshold: 'setting-free-delivery',
    delivery_parcel_weight_g: 'setting-parcel-weight',
    delivery_item_weight_g: 'setting-item-weight',
    cdek_client_id: 'setting-cdek-id',
    cdek_client_secret: 'setting-cdek-secret',
    cdek_sender_city_code: 'setting-cdek-city',
    cdek_shipment_point: 'setting-cdek-shipment-point',
    yandex_delivery_token: 'setting-ya-token',
    yandex_delivery_station_id: 'setting-ya-station',
    dadata_api_key: 'setting-dadata-key'
  };
  Object.entries(deliveryFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) payload[key] = el.value.trim();
  });
  payload.cdek_test_mode = document.getElementById('setting-cdek-test')?.checked ? '1' : '0';
  payload.yandex_delivery_test_mode = document.getElementById('setting-ya-test')?.checked ? '1' : '0';

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) alert('Настройки сохранены успешно!');
  } catch (e) {
    alert('Ошибка сохранения настроек');
  }
}

// Helpers
function formatCatLabel(cat) {
  const map = {
    rings: 'Кольца',
    earrings: 'Серьги',
    pendants: 'Подвески',
    bracelets: 'Браслеты',
    mystery: 'Секретный конверт',
    collaborations: 'Коллаборации'
  };
  return map[cat] || cat;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeQuote(str) {
  return (str || '').replace(/'/g, "\\'");
}

// Customers Management
async function loadCustomersTable() {
  const tbody = document.getElementById('admin-customers-tbody');
  const countEl = document.getElementById('admin-customers-count');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px;">Загрузка покупателей...</td></tr>';

  try {
    const res = await fetch('/api/admin/customers', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const customers = data.customers || [];

    if (countEl) countEl.textContent = `${customers.length} чел.`;

    if (customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px;">Покупатели пока не зарегистрированы</td></tr>';
      return;
    }

    tbody.innerHTML = customers.map(c => `
      <tr>
        <td>
          <div style="font-weight:700; color:#111;">${c.name}</div>
          <div style="font-size:0.8rem; background:#111; color:#fff; display:inline-block; padding:2px 8px; border-radius:10px; margin-top:2px;">
            ${c.user_code}
          </div>
        </td>
        <td>
          <div>${c.email}</div>
          <div style="font-size:0.8rem; color:#888;">${c.phone || '—'}</div>
        </td>
        <td><strong>${c.orders_count || 0} шт.</strong></td>
        <td><strong>${(c.total_spent || 0).toLocaleString('ru-RU')} ₽</strong></td>
        <td><span style="color:#2563eb; font-weight:700;">${c.bonus_points || 0} Б</span></td>
        <td><span style="color:#d97706; font-weight:700;">${c.personal_discount || 0}%</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="editCustomerBonuses(${c.id}, '${escapeQuote(c.name)}', ${c.bonus_points || 0}, ${c.personal_discount || 0})">
            Изменить
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">Ошибка загрузки покупателей</td></tr>';
  }
}

async function editCustomerBonuses(customerId, name, currentBonuses, currentDiscount) {
  const values = await adminForm({
    title: `Бонусы и скидка: ${name}`,
    text: `Сейчас: ${escapeHtml(currentBonuses)} бонусов, скидка ${escapeHtml(currentDiscount)}%. Изменения увидит покупатель в личном кабинете.`,
    fields: [
      { name: 'bonuses', label: 'Бонусы', type: 'number', value: currentBonuses, min: 0 },
      { name: 'discount', label: 'Персональная скидка, %', type: 'number', value: currentDiscount, min: 0, max: 50 }
    ]
  });
  if (!values) return;
  const newBonuses = values.bonuses;
  const newDiscount = values.discount;

  try {
    const res = await fetch(`/api/admin/customers/${customerId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        bonus_points: parseInt(newBonuses) || 0,
        personal_discount: parseInt(newDiscount) || 0
      })
    });
    if (res.ok) {
      loadCustomersTable();
    } else {
      alert('Ошибка при изменении данных покупателя');
    }
  } catch (e) {
    alert('Ошибка сервера');
  }
}

// Promo Codes Management
let currentPromoCodes = [];
let editingPromoId = null;

async function loadPromoTable() {
  const tbody = document.getElementById('admin-promo-tbody');
  const countEl = document.getElementById('admin-promo-count');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px;">Загрузка промокодов...</td></tr>';

  try {
    const res = await fetch('/api/admin/promo-codes', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    currentPromoCodes = data.promoCodes || [];

    if (countEl) countEl.textContent = `${currentPromoCodes.length} шт.`;

    if (currentPromoCodes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px;">Промокоды не найдены</td></tr>';
      return;
    }

    tbody.innerHTML = currentPromoCodes.map(p => `
      <tr>
        <td><strong style="font-size:1.1rem; color:#111;">${p.code}</strong></td>
        <td><span style="font-weight:800; color:#d93838; font-size:1rem;">-${p.discount_percent}%</span></td>
        <td><strong>${p.current_uses}</strong> раз</td>
        <td>${p.max_uses || 'Безлимитно'}</td>
        <td>
          <span class="table-badge ${p.is_active ? 'table-badge-instock' : 'table-badge-out'}">
            ${p.is_active ? 'Активен' : 'Неактивен'}
          </span>
        </td>
        <td>${formatDate(p.created_at)}</td>
        <td>
          <div class="table-actions-cell">
            <button class="admin-btn-icon" title="Редактировать" onclick="editPromoCode(${p.id})">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="admin-btn-icon delete" title="Удалить" onclick="deletePromoCode(${p.id}, '${escapeQuote(p.code)}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">Ошибка загрузки промокодов</td></tr>';
  }
}

function openAddPromoModal() {
  editingPromoId = null;
  document.getElementById('admin-promo-modal-title').textContent = 'Создать промокод';
  document.getElementById('promo-form-code').value = '';
  document.getElementById('promo-form-discount').value = '10';
  document.getElementById('promo-form-max-uses').value = '100';
  document.getElementById('promo-form-active').checked = true;
  document.getElementById('admin-promo-modal-backdrop').classList.add('open');
}

function editPromoCode(id) {
  const p = currentPromoCodes.find(item => item.id === id);
  if (!p) return;

  editingPromoId = id;
  document.getElementById('admin-promo-modal-title').textContent = `Редактирование: ${p.code}`;
  document.getElementById('promo-form-code').value = p.code || '';
  document.getElementById('promo-form-discount').value = p.discount_percent || 10;
  document.getElementById('promo-form-max-uses').value = p.max_uses || 100;
  document.getElementById('promo-form-active').checked = !!p.is_active;
  document.getElementById('admin-promo-modal-backdrop').classList.add('open');
}

function closePromoModal() {
  document.getElementById('admin-promo-modal-backdrop').classList.remove('open');
}

async function handlePromoFormSubmit(e) {
  e.preventDefault();

  const code = document.getElementById('promo-form-code').value.trim().toUpperCase();
  const discount_percent = parseInt(document.getElementById('promo-form-discount').value) || 10;
  const max_uses = parseInt(document.getElementById('promo-form-max-uses').value) || 100;
  const is_active = document.getElementById('promo-form-active').checked ? 1 : 0;

  const payload = { code, discount_percent, max_uses, is_active };

  try {
    const url = editingPromoId ? `/api/admin/promo-codes/${editingPromoId}` : '/api/admin/promo-codes';
    const method = editingPromoId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка при сохранении промокода');

    closePromoModal();
    loadPromoTable();
  } catch (err) {
    alert(err.message);
  }
}

async function deletePromoCode(id, code) {
  if (!(await adminConfirm({ title: 'Удалить промокод?', text: `Промокод «${escapeHtml(code)}» перестанет работать.`, confirmText: 'Удалить', danger: true }))) return;

  try {
    const res = await fetch(`/api/admin/promo-codes/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      loadPromoTable();
    } else {
      throw new Error('Ошибка при удалении');
    }
  } catch (err) {
    alert(err.message);
  }
}

// Bind promo form listener in init
document.addEventListener('DOMContentLoaded', () => {
  const promoForm = document.getElementById('admin-promo-form');
  if (promoForm) promoForm.addEventListener('submit', handlePromoFormSubmit);
});

// Make globally accessible
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.updateInlinePrice = updateInlinePrice;
window.toggleProductStock = toggleProductStock;
window.calcDiscountBadge = calcDiscountBadge;
window.addPhotoUrlFromInput = addPhotoUrlFromInput;
window.removeUploadedImage = removeUploadedImage;
window.removeSizeTag = removeSizeTag;
window.closeProductModal = closeProductModal;
window.viewOrderDetails = viewOrderDetails;
window.closeOrderModal = closeOrderModal;
window.updateOrderStatus = updateOrderStatus;

// Reviews Globals
window.loadReviewsTable = loadReviewsTable;
window.updateReviewStatus = updateReviewStatus;
window.deleteReview = deleteReview;
window.openAddReviewModal = openAddReviewModal;
window.closeReviewModal = closeReviewModal;
window.addReviewPhotoUrl = addReviewPhotoUrl;
window.removeReviewUploadedPhoto = removeReviewUploadedPhoto;

// Customers Globals
window.loadCustomersTable = loadCustomersTable;
window.editCustomerBonuses = editCustomerBonuses;

// Promo Globals
window.loadPromoTable = loadPromoTable;
window.openAddPromoModal = openAddPromoModal;
window.editPromoCode = editPromoCode;
window.closePromoModal = closePromoModal;
window.deletePromoCode = deletePromoCode;
