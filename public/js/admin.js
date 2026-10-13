/**
 * SUPS Official — Admin Panel Application Logic
 */

let adminToken = localStorage.getItem('sups_admin_token') || null;
let currentTab = 'products';
let currentProducts = [];
let editingProductId = null;
let uploadedImages = [];
let currentSizes = [];
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
      dashboard: 'Сводка и аналитика',
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
  if (tab === 'dashboard') loadStats();
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
              <input type="number" class="table-price-input" value="${p.price}" 
                     onchange="updateInlinePrice(${p.id}, this.value)">
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
              <button class="admin-btn-icon delete" title="Удалить" onclick="deleteProduct(${p.id}, '${escapeQuote(p.title)}')">
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

async function updateInlinePrice(productId, newPrice) {
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
  if (!confirm(`Вы действительно хотите удалить товар "${title}"?`)) return;

  try {
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      loadProductsTable();
      loadStats();
    } else {
      throw new Error('Ошибка при удалении');
    }
  } catch (err) {
    alert(err.message);
  }
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
    renderImagePreviews();
    urlInput.value = '';
  }
}

function openAddProductModal() {
  editingProductId = null;
  uploadedImages = [];
  currentSizes = ['16', '17', '18', '19', '20', '21'];

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

  document.getElementById('admin-product-modal-backdrop').classList.add('open');
}

function editProduct(productId) {
  const prod = currentProducts.find(p => p.id === productId);
  if (!prod) return;

  editingProductId = productId;
  uploadedImages = Array.isArray(prod.images) ? [...prod.images] : [];
  currentSizes = Array.isArray(prod.sizes) ? [...prod.sizes] : [];

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

  document.getElementById('admin-product-modal-backdrop').classList.add('open');
}

function closeProductModal() {
  document.getElementById('admin-product-modal-backdrop').classList.remove('open');
}

async function uploadFiles(fileList) {
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
      renderImagePreviews();
    }
  } catch (err) {
    alert(`Не удалось загрузить фото: ${err.message}`);
  }
}

function renderImagePreviews() {
  const container = document.getElementById('admin-image-previews');
  if (!container) return;

  container.innerHTML = uploadedImages.map((url, i) => `
    <div class="image-preview-item">
      <img src="${url}">
      <button type="button" class="image-preview-remove" onclick="removeUploadedImage(${i})">×</button>
    </div>
  `).join('');
}

function removeUploadedImage(index) {
  uploadedImages.splice(index, 1);
  renderImagePreviews();
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
  if (!confirm(`Удалить отзыв от "${author}"?`)) return;

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
        <td><strong>#${o.order_number}</strong></td>
        <td>${formatDate(o.created_at)}</td>
        <td>
          <div><strong>${o.customer_name}</strong></div>
          <div style="font-size:0.8rem; color:#888;">${o.customer_phone}</div>
        </td>
        <td>${o.delivery_method}</td>
        <td>
          <div><strong>${o.total_price.toLocaleString('ru-RU')} ₽</strong></div>
          <div style="margin-top:4px;">
            ${o.payment_status === 'paid' || o.status === 'paid'
              ? '<span style="background:#e8f5e9; color:#2e7d32; padding:3px 8px; border-radius:10px; font-size:0.75rem; font-weight:700;">Оплачен ✅</span>'
              : '<span style="background:#fff8e1; color:#f57f17; padding:3px 8px; border-radius:10px; font-size:0.75rem; font-weight:600;">Ожидает оплаты</span>'}
          </div>
        </td>
        <td>
          <select class="filter-select" onchange="updateOrderStatus(${o.id}, this.value)" style="padding:4px 8px; font-size:0.8rem;">
            <option value="new" ${o.status === 'new' ? 'selected' : ''}>Новый</option>
            <option value="processing" ${o.status === 'processing' ? 'selected' : ''}>В обработке</option>
            <option value="shipped" ${o.status === 'shipped' ? 'selected' : ''}>Отправлен</option>
            <option value="completed" ${o.status === 'completed' ? 'selected' : ''}>Выполнен</option>
            <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>Отменен</option>
          </select>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="viewOrderDetails(${o.id})">
            Детали
          </button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">Ошибка загрузки заказов</td></tr>';
  }
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) loadStats();
  } catch (err) {
    alert('Ошибка обновления статуса');
  }
}

async function viewOrderDetails(orderId) {
  try {
    const res = await fetch(`/api/admin/orders?limit=100`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const order = (data.orders || []).find(o => o.id === orderId);
    if (!order) return;

    const modal = document.getElementById('admin-order-modal');
    const contentEl = document.getElementById('admin-order-detail-content');

    const items = Array.isArray(order.items) ? order.items : [];

    contentEl.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3>Заказ #${order.order_number}</h3>
        <div style="font-size: 0.85rem; color: #888;">Создан: ${formatDate(order.created_at)}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
        <div class="ui-card">
          <strong>Информация о клиенте</strong>
          <div style="margin-top: 8px; font-size: 0.9rem;">
            <div>Имя: <b>${order.customer_name}</b></div>
            <div>Телефон: <a href="tel:${order.customer_phone}">${order.customer_phone}</a></div>
            ${order.customer_email ? `<div>Email: ${order.customer_email}</div>` : ''}
          </div>
        </div>
        <div class="ui-card">
          <strong>Доставка</strong>
          <div style="margin-top: 8px; font-size: 0.9rem;">
            <div>Способ: <b>${order.delivery_method}</b></div>
            <div>Адрес / ПВЗ: ${order.delivery_address || 'Не указан'}</div>
            ${order.comment ? `<div>Комментарий: <i>${order.comment}</i></div>` : ''}
          </div>
        </div>
      </div>

      <h4>Состав заказа:</h4>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        ${items.map(item => `
          <div style="display: flex; gap: 12px; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 12px;">
            <img src="${item.image || '/assets/placeholder.jpg'}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px;">
            <div style="flex: 1;">
              <strong>${item.title}</strong>
              ${item.size ? `<div style="font-size: 0.85rem; color: #666;">Размер: ${item.size}</div>` : ''}
              ${item.is_custom && item.custom_details ? `
                <div style="font-size: 0.8rem; background: #f0f0f0; padding: 4px 8px; border-radius: 4px; margin-top: 4px;">
                  ⚙️ Металл: ${item.custom_details.metal || '-'} | Текст: "${item.custom_details.text || '-'}" | Шрифт: ${item.custom_details.font || '-'}
                </div>
              ` : ''}
            </div>
            <div>
              <b>${item.quantity} шт. × ${item.price} ₽</b>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="margin-top: 20px; text-align: right; font-size: 1.2rem;">
        Итого к оплате: <b>${order.total_price.toLocaleString('ru-RU')} ₽</b>
      </div>
    `;

    modal.classList.add('open');
  } catch (e) {
    console.error(e);
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
  const newBonuses = prompt(`Изменить бонусы для ${name}:`, currentBonuses);
  if (newBonuses === null) return;

  const newDiscount = prompt(`Изменить персональную скидку (%) для ${name}:`, currentDiscount);
  if (newDiscount === null) return;

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
  if (!confirm(`Удалить промокод "${code}"?`)) return;

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
