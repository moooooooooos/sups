
let staticProductsCache = null;

async function getStaticProductsList() {
  if (staticProductsCache) return staticProductsCache;
  try {
    const res = await fetch("data/products.json");
    if (res.ok) {
      staticProductsCache = await res.json();
      return staticProductsCache;
    }
  } catch (e) {
    console.warn("Failed to fetch data/products.json:", e);
  }
  return [];
}

/**
 * SUPS Official — Catalog & Product Modal Logic
 */

let currentFilters = {
  category: 'all',
  collection: '',
  size: '',
  search: '',
  sort: 'default',
  in_stock: '',
  page: 1,
  limit: 60
};

const COLLECTIONS_CATALOG_INFO = {
  'истории и мифы': {
    name: 'Истории и мифы',
    nameCaps: 'ИСТОРИИ И МИФЫ',
    image: 'images/products/897454476552.jpg',
    tagline: 'ДРЕВНИЕ АРХЕТИПЫ И СКАЗАНИЯ',
    desc: 'Символы вечных легенд, тайные знаки и мистические образы, отлитые в прочной стали. Каждое изделие — это личный талисман с глубоким культурным кодом.'
  },
  'коллаборации': {
    name: 'Коллаборации',
    nameCaps: 'КОЛЛАБОРАЦИИ',
    image: 'images/products/628991000233.jpg',
    tagline: 'СОВМЕСТНЫЕ ПРОЕКТЫ С АРТИСТАМИ',
    desc: 'Синергия концептуального ювелирного дизайна САПС и творческого вижена музыкантов, художников и инфлюенсеров.'
  },
  'конец сказке': {
    name: 'Конец сказке',
    nameCaps: 'КОНЕЦ СКАЗКЕ',
    image: 'images/products/825318204482.jpg',
    tagline: 'ВЗРОСЛЕНИЕ И РЕАЛИЗМ',
    desc: 'Коллекция о моменте, когда наивные иллюзии уступают место честной реальности. Дерзкие геометрические грани и несгибаемый характер.'
  },
  'концептуализм': {
    name: 'Концептуализм',
    nameCaps: 'КОНЦЕПТУАЛИЗМ',
    image: 'images/products/376295654093.png',
    tagline: 'ЧИСТАЯ ИДЕЯ И ФОРМА',
    desc: 'Минимализм, возведенный в абсолют. Архитектурная геометрия, строгие пропорции и глубокая смысловая нагрузка стали.'
  },
  'личная философия': {
    name: 'Личная философия',
    nameCaps: 'ЛИЧНАЯ ФИЛОСОФИЯ',
    image: 'images/products/184026748582.jpg',
    tagline: 'МАНИФЕСТ И ВНУТРЕННИЙ ВЫБОР',
    desc: 'Украшения-напоминания о собственных принципах, внутренней свободе и пути. Стальные гравировки и силуэты твоего выбора.'
  },
  'магия случая': {
    name: 'Магия случая',
    nameCaps: 'МАГИЯ СЛУЧАЯ',
    image: 'images/products/453774308162.png',
    tagline: 'ТАЙНА И СЮРПРИЗ СУДЬБЫ',
    desc: 'Секретные конверты и украшения-сюрпризы. Доверьтесь случаю и получите уникальное изделие САПС с приятной тайной.'
  },
  'сапс х «стереополина»': {
    name: 'САПС х «Стереополина»',
    nameCaps: 'САПС х «СТЕРЕОПОЛИНА»',
    image: 'images/products/399901876532.jpg',
    tagline: 'СИНТИ-ПОП И НОСТАЛЬГИЯ',
    desc: 'Совместная линейка с певицей Стереополиной. Романтика советской эстетики, ирония, взросление и кинематографичный ретро-вайб.'
  },
  'сапс х stervell': {
    name: 'САПС х Stervell',
    nameCaps: 'САПС х STERVELL',
    image: 'images/products/368026792952.jpg',
    tagline: 'ИСКРЕННОСТЬ И САМОПРИНЯТИЕ',
    desc: 'Коллаборация со Stervell о бережном отношении к себе, любви без условий и спокойной внутренней уверенности.'
  },
  'сапс х маша хима': {
    name: 'САПС х Маша Хима',
    nameCaps: 'САПС х МАША ХИМА',
    image: 'images/products/873313565612.jpg',
    tagline: 'ГОЛОС И БЕЗОГОВОРОЧНОЕ «Я РЕШАЮ»',
    desc: 'Дерзкая линейка с хип-хоп исполнительницей Машей Химой. Четкие манифесты, право говорить «нет» и непоколебимая независимость.'
  },
  'сапс х без обид': {
    name: 'САПС х без обид',
    nameCaps: 'САПС х БЕЗ ОБИД',
    image: 'images/products/771361905323.png',
    tagline: 'ИНДИ-РОК И ЧИСТЫЕ ЧУВСТВА',
    desc: 'Коллаборация с группой «без обид». Музыкальные строчки в стали: про юность, драйв, искренность и верность себе.'
  },
  'сапс х никому не говори': {
    name: 'САПС х никому не говори',
    nameCaps: 'САПС х НИКОМУ НЕ ГОВОРИ',
    image: 'images/products/693808457362.jpg',
    tagline: 'СОКРОВЕННЫЕ ТАЙНЫ И ИСТОРИИ',
    desc: 'Тайные послания, символы ночного Токио и личные шифры, хранящие сокровенные мысли от посторонних глаз.'
  },
  'сила внутри': {
    name: 'Сила внутри',
    nameCaps: 'СИЛА ВНУТРИ',
    image: 'images/products/218636752392.jpg',
    tagline: 'НЕСГИБАЕМЫЙ СТЕРЖЕНЬ',
    desc: 'Коллекция про внутреннюю опору, стойкость перед трудностями и спокойную силу, воплощенную в стали AISI 304.'
  },
  'уверенность и упорство': {
    name: 'Уверенность и упорство',
    nameCaps: 'УВЕРЕННОСТЬ И УПОРСТВО',
    image: 'images/products/315128423512.jpg',
    tagline: 'ДОСТИЖЕНИЕ ЦЕЛЕЙ И ФОКУС',
    desc: 'Четкие грани, лаконичный стиль и мощная энергетика для тех, кто идет вперед несмотря ни на какие преграды.'
  },
  'эмоция на металле': {
    name: 'Эмоция на металле',
    nameCaps: 'ЭМОЦИЯ НА МЕТАЛЛЕ',
    image: 'images/products/602190564872.png',
    tagline: 'ЧУВСТВА, ЗАПЕЧАТЛЕННЫЕ В СТАЛИ',
    desc: 'Живая страсть, глубина переживаний и экспрессия в холодной нержавеющей стали, хранящей блеск и эмоции годами.'
  }
};

let loadedCollectionsList = [];

let currentModalProduct = null;
let selectedModalSize = null;
let selectedModalColor = null;
let modalColorVariants = [];
let modalQuantity = 1;

document.addEventListener('DOMContentLoaded', () => {
  // Check if we are on a catalog-enabled page
  if (document.getElementById('products-grid-container')) {
    initCatalogPage();
  }

  // Check if we are on homepage with featured bestsellers
  if (document.getElementById('featured-grid-container')) {
    loadFeaturedProducts();
  }

  initProductModal();
});

async function initCatalogPage() {
  // Read query parameters from URL
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('collection')) {
    currentFilters.collection = urlParams.get('collection').trim();
  }
  if (urlParams.get('category')) {
    currentFilters.category = urlParams.get('category').trim();
  }
  if (urlParams.get('search')) {
    currentFilters.search = urlParams.get('search').trim();
    const searchInput = document.getElementById('catalog-search-input');
    if (searchInput) searchInput.value = currentFilters.search;
  }
  if (urlParams.get('in_stock')) {
    currentFilters.in_stock = urlParams.get('in_stock');
  }

  // Read category from data attribute if on category page e.g. rings.html
  const pageCategory = document.body.dataset.category;
  if (pageCategory) {
    currentFilters.category = pageCategory;
  }

  // Load category filters, collections, and sizes
  await loadFilterOptions();

  // Bind filter events
  setupFilterListeners();

  // Fetch and display products
  loadProducts();
}

async function loadFilterOptions() {
  try {
    let data;
    try {
      const res = await fetch("/api/categories");
      if (res.ok) data = await res.json();
    } catch (e) {}

    if (!data || !data.categories) {
      const allProds = await getStaticProductsList();
      const collMap = {};
      const catCount = { rings: 0, earrings: 0, pendants: 0, bracelets: 0, collaborations: 0, mystery: 0 };
      allProds.forEach(p => {
        if (catCount[p.category] !== undefined) catCount[p.category]++;
        if (Array.isArray(p.categories)) {
          p.categories.forEach(c => { if (catCount[c] !== undefined && c !== p.category) catCount[c]++; });
        }
        if (Array.isArray(p.collections)) {
          p.collections.forEach(col => { if (col) collMap[col] = (collMap[col] || 0) + 1; });
        }
      });
      data = {
        categories: [
          { slug: "rings", name: "Кольца", count: catCount.rings },
          { slug: "earrings", name: "Серьги", count: catCount.earrings },
          { slug: "pendants", name: "Подвески", count: catCount.pendants },
          { slug: "bracelets", name: "Браслеты", count: catCount.bracelets },
          { slug: "collaborations", name: "Коллаборации", count: catCount.collaborations },
          { slug: "mystery", name: "Секретный конверт", count: catCount.mystery }
        ],
        collections: Object.keys(collMap).map(k => ({ name: k, count: collMap[k] })),
        sizes: [15, 16, 17, 18, 19, 20, 21, 22].map(s => ({ size: String(s), count: allProds.filter(p => Array.isArray(p.sizes) && p.sizes.includes(String(s))).length }))
      };
    }
    loadedCollectionsList = data.collections || [];

    // 1. Category Pills
    const pillsContainer = document.getElementById('category-pills');
    if (pillsContainer && !document.body.dataset.category) {
      let pillsHtml = `
        <button class="category-pill ${currentFilters.category === 'all' ? 'active' : ''}" data-cat="all">
          Все товары
        </button>
      `;
      data.categories.forEach(cat => {
        pillsHtml += `
          <button class="category-pill ${currentFilters.category === cat.slug ? 'active' : ''}" data-cat="${cat.slug}">
            ${cat.name} (${cat.count})
          </button>
        `;
      });
      pillsContainer.innerHTML = pillsHtml;

      pillsContainer.querySelectorAll('.category-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          pillsContainer.querySelectorAll('.category-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentFilters.category = btn.dataset.cat;
          currentFilters.page = 1;
          syncUrlParams();
          loadProducts();
        });
      });
    }

    // 2. Collection Checkbox List (1:1 with user screenshots)
    const collCheckboxesContainer = document.getElementById('collection-checkboxes-list');
    if (collCheckboxesContainer) {
      renderCollectionCheckboxes(collCheckboxesContainer, loadedCollectionsList);
    }

    // 3. Collection Quick Pills Bar
    const collPillsContainer = document.getElementById('collections-pills-scroll');
    if (collPillsContainer) {
      renderCollectionPills(collPillsContainer, loadedCollectionsList);
    }

    // 4. Update Trigger text & active banner if collection is preset from URL
    updateCollectionUIState();

    // 5. In-Stock button state
    const stockBtn = document.getElementById('filter-stock-btn');
    if (stockBtn && currentFilters.in_stock) {
      stockBtn.classList.add('active');
    }

    // 6. Size Chips
    const sizesContainer = document.getElementById('size-chips-list');
    if (sizesContainer) {
      sizesContainer.innerHTML = '';
      data.sizes.forEach(s => {
        const chip = document.createElement('button');
        chip.className = `size-chip ${currentFilters.size === s.size ? 'active' : ''}`;
        chip.textContent = s.size;
        chip.dataset.size = s.size;
        chip.title = `Размер ${s.size} (${s.count} шт)`;
        chip.addEventListener('click', () => {
          if (chip.classList.contains('active')) {
            chip.classList.remove('active');
            currentFilters.size = '';
          } else {
            sizesContainer.querySelectorAll('.size-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilters.size = s.size;
          }
          currentFilters.page = 1;
          loadProducts();
        });
        sizesContainer.appendChild(chip);
      });
    }

  } catch (err) {
    console.error('Error loading filter options:', err);
  }
}

function renderCollectionCheckboxes(container, collections) {
  container.innerHTML = collections.map(col => {
    const isSelected = currentFilters.collection && currentFilters.collection.toLowerCase() === col.name.toLowerCase();
    return `
      <div class="collection-cb-item ${isSelected ? 'selected' : ''}" data-collection="${col.name}">
        <div class="collection-cb-left">
          <span class="custom-cb-box">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
          <span class="collection-cb-name">${col.name.toUpperCase()}</span>
        </div>
        <span class="collection-cb-count">${col.count}</span>
      </div>
    `;
  }).join('');
}

function renderCollectionPills(container, collections) {
  let pillsHtml = `
    <button class="collection-quick-pill ${!currentFilters.collection ? 'active' : ''}" data-collection="">
      Все коллекции
    </button>
  `;
  collections.forEach(col => {
    const isSelected = currentFilters.collection && currentFilters.collection.toLowerCase() === col.name.toLowerCase();
    pillsHtml += `
      <button class="collection-quick-pill ${isSelected ? 'active' : ''}" data-collection="${col.name}">
        ${col.name} (${col.count})
      </button>
    `;
  });
  container.innerHTML = pillsHtml;
}

function updateCollectionUIState() {
  const dropdownWrap = document.getElementById('collection-dropdown-wrap');
  const triggerText = document.getElementById('collection-trigger-text');
  const banner = document.getElementById('active-collection-banner');

  if (currentFilters.collection) {
    if (triggerText) triggerText.textContent = currentFilters.collection.toUpperCase();
    if (dropdownWrap) dropdownWrap.classList.add('has-filter');

    // Update banner
    if (banner) {
      const infoKey = currentFilters.collection.toLowerCase();
      const info = COLLECTIONS_CATALOG_INFO[infoKey] || {
        name: currentFilters.collection,
        nameCaps: currentFilters.collection.toUpperCase(),
        image: 'assets/placeholder.jpg',
        desc: 'Концептуальная коллекция украшений из медицинской стали AISI 304.'
      };

      const bannerTitle = document.getElementById('active-col-title');
      const bannerDesc = document.getElementById('active-col-desc');
      const bannerImg = document.getElementById('active-col-img');
      const bannerCount = document.getElementById('active-col-count-badge');

      if (bannerTitle) bannerTitle.textContent = info.nameCaps;
      if (bannerDesc) bannerDesc.textContent = info.desc;
      if (bannerImg) bannerImg.src = info.image;

      const foundCol = loadedCollectionsList.find(c => c.name.toLowerCase() === currentFilters.collection.toLowerCase());
      if (bannerCount && foundCol) {
        bannerCount.textContent = `${foundCol.count} изделий`;
      }

      banner.style.display = 'block';
    }
  } else {
    if (triggerText) triggerText.textContent = 'КОЛЛЕКЦИЯ';
    if (dropdownWrap) dropdownWrap.classList.remove('has-filter');
    if (banner) banner.style.display = 'none';
  }

  // Update selected classes on checkboxes
  document.querySelectorAll('.collection-cb-item').forEach(item => {
    const colName = item.dataset.collection;
    const isSel = currentFilters.collection && currentFilters.collection.toLowerCase() === colName.toLowerCase();
    item.classList.toggle('selected', !!isSel);
  });

  // Update active class on quick pills
  document.querySelectorAll('.collection-quick-pill').forEach(pill => {
    const colName = pill.dataset.collection;
    if (!currentFilters.collection) {
      pill.classList.toggle('active', colName === '');
    } else {
      pill.classList.toggle('active', colName && colName.toLowerCase() === currentFilters.collection.toLowerCase());
    }
  });
}

function selectCollectionFilter(collectionName) {
  if (currentFilters.collection && currentFilters.collection.toLowerCase() === (collectionName || '').toLowerCase()) {
    currentFilters.collection = '';
  } else {
    currentFilters.collection = collectionName || '';
  }

  currentFilters.page = 1;
  updateCollectionUIState();
  syncUrlParams();
  loadProducts();
}

function syncUrlParams() {
  const url = new URL(window.location);
  if (currentFilters.collection) {
    url.searchParams.set('collection', currentFilters.collection);
  } else {
    url.searchParams.delete('collection');
  }

  if (currentFilters.category && currentFilters.category !== 'all') {
    url.searchParams.set('category', currentFilters.category);
  } else {
    url.searchParams.delete('category');
  }

  if (currentFilters.in_stock) {
    url.searchParams.set('in_stock', currentFilters.in_stock);
  } else {
    url.searchParams.delete('in_stock');
  }

  if (currentFilters.search) {
    url.searchParams.set('search', currentFilters.search);
  } else {
    url.searchParams.delete('search');
  }

  window.history.replaceState({}, '', url.toString());
}

function setupFilterListeners() {
  const dropdownWrap = document.getElementById('collection-dropdown-wrap');
  const triggerBtn = document.getElementById('collection-filter-btn');
  const resetBtn = document.getElementById('collection-filter-reset');
  const checkboxesList = document.getElementById('collection-checkboxes-list');
  const pillsList = document.getElementById('collections-pills-scroll');
  const stockBtn = document.getElementById('filter-stock-btn');
  const clearBannerBtn = document.getElementById('active-col-clear-btn');

  // Toggle Dropdown Menu
  if (triggerBtn && dropdownWrap) {
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownWrap.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!dropdownWrap.contains(e.target)) {
        dropdownWrap.classList.remove('open');
      }
    });
  }

  // Reset collections dropdown
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCollectionFilter('');
      if (dropdownWrap) dropdownWrap.classList.remove('open');
    });
  }

  // Checkbox items click delegation
  if (checkboxesList) {
    checkboxesList.addEventListener('click', (e) => {
      const item = e.target.closest('.collection-cb-item');
      if (!item) return;
      e.stopPropagation();
      const colName = item.dataset.collection;
      selectCollectionFilter(colName);
      if (dropdownWrap) dropdownWrap.classList.remove('open');
    });
  }

  // Quick pills click delegation
  if (pillsList) {
    pillsList.addEventListener('click', (e) => {
      const pill = e.target.closest('.collection-quick-pill');
      if (!pill) return;
      const colName = pill.dataset.collection;
      selectCollectionFilter(colName);
    });
  }

  // In-Stock toggle
  if (stockBtn) {
    stockBtn.addEventListener('click', () => {
      if (currentFilters.in_stock) {
        currentFilters.in_stock = '';
        stockBtn.classList.remove('active');
      } else {
        currentFilters.in_stock = '1';
        stockBtn.classList.add('active');
      }
      currentFilters.page = 1;
      syncUrlParams();
      loadProducts();
    });
  }

  // Clear banner button
  if (clearBannerBtn) {
    clearBannerBtn.addEventListener('click', () => {
      selectCollectionFilter('');
    });
  }

  // Search input with debounce
  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentFilters.search = e.target.value.trim();
        currentFilters.page = 1;
        syncUrlParams();
        loadProducts();
      }, 300);
    });
  }

  // Sort select
  const sortSelect = document.getElementById('catalog-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentFilters.sort = e.target.value;
      currentFilters.page = 1;
      loadProducts();
    });
  }
}

async function loadProducts() {
  const container = document.getElementById('products-grid-container');
  const countEl = document.getElementById('catalog-products-count');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: span 3; text-align: center; padding: 60px 0; color: #888;">
      Загрузка изделий САПС...
    </div>
  `;

  try {
    const params = new URLSearchParams();
    if (currentFilters.category && currentFilters.category !== 'all') params.append('category', currentFilters.category);
    if (currentFilters.collection) params.append('collection', currentFilters.collection);
    if (currentFilters.in_stock) params.append('in_stock', currentFilters.in_stock);
    if (currentFilters.size) params.append('size', currentFilters.size);
    if (currentFilters.search) params.append('search', currentFilters.search);
    if (currentFilters.sort) params.append('sort', currentFilters.sort);
    params.append('page', currentFilters.page);
    params.append('limit', currentFilters.limit);

    let data;
    try {
      const res = await fetch("/api/products?" + params.toString());
      if (res.ok) data = await res.json();
    } catch (e) {}

    if (!data || !data.products) {
      let prods = await getStaticProductsList();
      if (currentFilters.category && currentFilters.category !== "all") {
        prods = prods.filter(p => p.category === currentFilters.category || (Array.isArray(p.categories) && p.categories.includes(currentFilters.category)));
      }
      if (currentFilters.collection) {
        prods = prods.filter(p => Array.isArray(p.collections) && p.collections.some(c => c.toLowerCase() === currentFilters.collection.toLowerCase()));
      }
      if (currentFilters.in_stock) {
        prods = prods.filter(p => p.in_stock === 1);
      }
      if (currentFilters.size) {
        prods = prods.filter(p => Array.isArray(p.sizes) && p.sizes.includes(String(currentFilters.size)));
      }
      if (currentFilters.search) {
        const q = currentFilters.search.toLowerCase();
        prods = prods.filter(p => (p.title && p.title.toLowerCase().includes(q)) || (p.description && p.description.toLowerCase().includes(q)));
      }
      if (currentFilters.sort === "price-asc") prods.sort((a,b) => a.price - b.price);
      else if (currentFilters.sort === "price-desc") prods.sort((a,b) => b.price - a.price);
      
      const total = prods.length;
      data = { products: prods, pagination: { total, page: 1, limit: 100 } };
    }

    if (countEl) {
      countEl.textContent = `Найдено: ${data.pagination.total} изделий`;
    }

    if (!data.products || data.products.length === 0) {
      container.innerHTML = `
        <div class="catalog-empty-state">
          <h3>Изделия не найдены</h3>
          <p>Попробуйте изменить параметры фильтрации или поисковый запрос</p>
          <button class="btn btn-primary btn-sm" onclick="resetFilters()">Сбросить фильтры</button>
        </div>
      `;
      return;
    }

    container.innerHTML = data.products.map(p => renderProductCard(p)).join('');

    // Attach click handlers to open modal
    container.querySelectorAll('.js-open-product').forEach(el => {
      el.addEventListener('click', (e) => {
        const prodId = el.dataset.productId;
        openProductModal(prodId);
      });
    });

  } catch (err) {
    console.error('Error loading products:', err);
    container.innerHTML = `
      <div class="catalog-empty-state">
        <h3>Ошибка загрузки каталога</h3>
        <p>Пожалуйста, обновите страницу</p>
      </div>
    `;
  }
}

function renderProductCard(p) {
  const mainImage = (p.images && p.images[0]) || 'assets/placeholder.jpg';
  const hasDiscount = p.price_old && p.price_old > p.price;
  const isBestseller = p.is_bestseller;
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const collName = (p.collections && p.collections[0]) ? p.collections[0] : '';

  return `
    <div class="product-card" data-product-id="${p.id}">
      <div class="product-img-wrap js-open-product" data-product-id="${p.id}">
        ${isBestseller ? `<div class="product-badge badge-bestseller">Хит</div>` : ''}
        ${hasDiscount ? `<div class="product-badge badge-sale">Скидка</div>` : ''}
        ${!p.in_stock ? `<div class="product-badge badge-out">Под заказ</div>` : ''}
        <img src="${mainImage}" alt="${p.title}" loading="lazy" onerror="this.src='assets/placeholder.jpg'">
      </div>
      <div class="product-card-body">
        <div class="product-card-header">
          ${collName ? `<div class="product-collection-chip">${collName}</div>` : ''}
          <div class="product-category-tag">${formatCategoryName(p.category)}</div>
          <h3 class="product-card-title js-open-product" data-product-id="${p.id}">${p.title}</h3>
          ${sizes.length > 0 ? `
            <div class="product-card-sizes">
              ${sizes.slice(0, 5).map(s => `<span class="size-pill-sm">${s}</span>`).join('')}
              ${sizes.length > 5 ? `<span class="size-pill-sm">+${sizes.length - 5}</span>` : ''}
            </div>
          ` : ''}
        </div>
        <div class="product-card-footer">
          <div class="product-prices">
            <span class="product-price-current">${p.price.toLocaleString('ru-RU')} ₽</span>
            ${hasDiscount ? `<span class="product-price-old">${p.price_old.toLocaleString('ru-RU')} ₽</span>` : ''}
          </div>
          <button class="product-btn-add js-open-product" data-product-id="${p.id}">
            Выбрать
          </button>
        </div>
      </div>
    </div>
  `;
}

function formatCategoryName(cat) {
  const map = {
    rings: 'Кольцо',
    earrings: 'Серьги',
    pendants: 'Подвеска',
    bracelets: 'Браслет',
    mystery: 'Секретный конверт',
    collaborations: 'Коллаборация'
  };
  return map[cat] || 'Украшение';
}

function resetFilters() {
  currentFilters = {
    category: 'all',
    collection: '',
    size: '',
    search: '',
    sort: 'default',
    in_stock: '',
    page: 1,
    limit: 60
  };

  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput) searchInput.value = '';

  const stockBtn = document.getElementById('filter-stock-btn');
  if (stockBtn) stockBtn.classList.remove('active');

  document.querySelectorAll('.size-chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.category-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === 'all');
  });

  updateCollectionUIState();
  syncUrlParams();
  loadProducts();
}

async function loadFeaturedProducts() {
  const container = document.getElementById('featured-grid-container');
  if (!container) return;

  try {
    let data;
    try {
      const res = await fetch("/api/products/featured");
      if (res.ok) data = await res.json();
    } catch (e) {}

    if (!data || !data.products) {
      const all = await getStaticProductsList();
      const best = all.filter(p => p.is_bestseller).slice(0, 8);
      data = { products: best.length > 0 ? best : all.slice(0, 8) };
    }
    if (data.products && data.products.length > 0) {
      container.innerHTML = data.products.slice(0, 6).map(p => renderProductCard(p)).join('');
      container.querySelectorAll('.js-open-product').forEach(el => {
        el.addEventListener('click', () => openProductModal(el.dataset.productId));
      });
    }
  } catch (e) {
    console.error('Error loading featured products:', e);
  }
}

/* ============================================================
   Product Detail Modal
   ============================================================ */
function initProductModal() {
  const backdrop = document.getElementById('product-modal-backdrop');
  if (!backdrop) return;

  backdrop.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'product-modal-backdrop') {
      closeProductModal();
    }
  });

  const closeBtn = document.getElementById('product-modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeProductModal);

  // Quantity controls
  const minusBtn = document.getElementById('modal-qty-minus');
  const plusBtn = document.getElementById('modal-qty-plus');
  const qtyInput = document.getElementById('modal-qty-val');

  if (minusBtn && plusBtn && qtyInput) {
    minusBtn.addEventListener('click', () => {
      if (modalQuantity > 1) {
        modalQuantity--;
        qtyInput.value = modalQuantity;
      }
    });
    plusBtn.addEventListener('click', () => {
      modalQuantity++;
      qtyInput.value = modalQuantity;
    });
  }

  // Add to cart button
  const addBtn = document.getElementById('modal-btn-add-cart');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!currentModalProduct) return;

      const sizes = currentModalProduct.sizes || [];
      if (sizes.length > 0 && !selectedModalSize) {
        alert('Пожалуйста, выберите размер изделия');
        return;
      }

      const pickedColor = modalColorVariants.find(v => v.id === selectedModalColor);

      window.cart.addItem({
        id: currentModalProduct.id,
        title: currentModalProduct.title,
        price: currentModalProduct.price,
        image: (pickedColor && pickedColor.images[0]) || (currentModalProduct.images && currentModalProduct.images[0]) || '',
        size: selectedModalSize || '',
        color: pickedColor ? pickedColor.name : '',
        quantity: modalQuantity
      });

      closeProductModal();
    });
  }
}

async function openProductModal(productId) {
  const backdrop = document.getElementById('product-modal-backdrop');
  if (!backdrop) return;

  try {
    let data;
    try {
      const res = await fetch("/api/products/" + productId);
      if (res.ok) data = await res.json();
    } catch (e) {}

    if (!data || !data.product) {
      const all = await getStaticProductsList();
      const prod = all.find(p => String(p.id) === String(productId) || String(p.uid) === String(productId));
      if (!prod) throw new Error("Товар не найден");
      data = { product: prod };
    }

    currentModalProduct = data.product;
    selectedModalSize = null;
    modalQuantity = 1;

    // Reset qty
    const qtyInput = document.getElementById('modal-qty-val');
    if (qtyInput) qtyInput.value = 1;

    // Populate Fields
    document.getElementById('modal-product-cat').textContent = formatCategoryName(currentModalProduct.category);
    document.getElementById('modal-product-title').textContent = currentModalProduct.title;
    document.getElementById('modal-product-price').textContent = `${currentModalProduct.price.toLocaleString('ru-RU')} ₽`;

    const oldPriceEl = document.getElementById('modal-product-old-price');
    if (oldPriceEl) {
      if (currentModalProduct.price_old) {
        oldPriceEl.textContent = `${currentModalProduct.price_old.toLocaleString('ru-RU')} ₽`;
        oldPriceEl.style.display = 'inline';
      } else {
        oldPriceEl.style.display = 'none';
      }
    }

    // Description
    const descEl = document.getElementById('modal-product-desc');
    if (descEl) {
      const rawDesc = currentModalProduct.description || 'Концептуальное изделие ручной работы САПС из стали AISI 304.';
      const cleanDesc = rawDesc
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/?[^>]+(>|$)/g, '')
        .trim();
      descEl.textContent = cleanDesc;
    }

    // Characteristics
    const specsContainer = document.getElementById('modal-specs-container');
    if (specsContainer) {
      let specs = Array.isArray(currentModalProduct.characteristics) ? currentModalProduct.characteristics : [];
      if (specs.length === 0) {
        specs = [
          { title: 'Материал', value: 'Сталь AISI 304' },
          { title: 'Свойства', value: 'Не ржавеет, не темнеет, не боится воды' }
        ];
      }
      specsContainer.innerHTML = specs.map(s => `
        <div class="modal-spec-row">
          <span class="modal-spec-name">${s.title || s.name}</span>
          <span class="modal-spec-val">${s.value}</span>
        </div>
      `).join('');
    }

    // Colors + Gallery
    // Если у товара размечены цвета, альбом показывает только фото выбранного цвета.
    selectedModalColor = null;
    modalColorVariants = getColorVariants(currentModalProduct);
    renderModalColors();
    renderModalGallery(getModalImages());

    // Sizes
    const sizesGroup = document.getElementById('modal-sizes-group');
    const sizesList = document.getElementById('modal-sizes-list');
    const sizes = Array.isArray(currentModalProduct.sizes) ? currentModalProduct.sizes : [];

    if (sizesList) {
      if (sizes.length > 0) {
        sizesGroup.style.display = 'block';
        sizesList.innerHTML = sizes.map(sz => `
          <button type="button" class="modal-size-btn" onclick="selectModalSize('${sz}', this)">
            ${sz}
          </button>
        `).join('');
      } else {
        sizesGroup.style.display = 'none';
      }
    }

    // Show backdrop
    const container = backdrop.querySelector('.product-modal-container');
    if (container) container.scrollTop = 0;
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';

  } catch (err) {
    console.error('Error showing product modal:', err);
  }
}

/**
 * Цветовые варианты товара: product.color_variants = [
 *   { id: 'pink', name: 'Розовое золото', hex: '#E8B4B8', images: [0, 1, 2] }
 * ]
 * images: индексы (с нуля) фото из product.images, относящихся к этому цвету.
 * Варианты без фото отбрасываются: переключать там нечего.
 */
function getColorVariants(product) {
  const all = Array.isArray(product.images) ? product.images : [];
  const raw = Array.isArray(product.color_variants) ? product.color_variants : [];
  return raw
    .map(v => ({
      id: String(v.id || v.name || ''),
      name: v.name || v.id || '',
      hex: v.hex || '#cccccc',
      images: (Array.isArray(v.images) ? v.images : [])
        .map(i => all[i])
        .filter(Boolean)
    }))
    .filter(v => v.id && v.images.length > 0);
}

// Фото для текущего выбора: выбранный цвет, иначе весь альбом товара
function getModalImages() {
  const selected = modalColorVariants.find(v => v.id === selectedModalColor);
  if (selected) return selected.images;
  const all = currentModalProduct.images || [];
  return all.length > 0 ? all : ['assets/placeholder.jpg'];
}

function renderModalColors() {
  const group = document.getElementById('modal-colors-group');
  const list = document.getElementById('modal-colors-list');
  if (!group || !list) return;

  if (modalColorVariants.length === 0) {
    group.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  // Цвет выбран сразу (первый), чтобы альбом никогда не смешивал цвета
  selectedModalColor = modalColorVariants[0].id;
  group.style.display = 'block';
  list.innerHTML = modalColorVariants.map(v => `
    <button type="button" class="modal-color-btn ${v.id === selectedModalColor ? 'active' : ''}"
            data-color="${escapeAttr(v.id)}" title="${escapeAttr(v.name)}" aria-label="${escapeAttr(v.name)}"
            onclick="selectModalColor('${escapeAttr(v.id)}', this)">
      <span class="modal-color-dot" style="background:${escapeAttr(v.hex)}"></span>
      <span class="modal-color-label">${escapeAttr(v.name)}</span>
    </button>
  `).join('');
  updateModalColorName();
}

function updateModalColorName() {
  const nameEl = document.getElementById('modal-color-name');
  const selected = modalColorVariants.find(v => v.id === selectedModalColor);
  if (nameEl) nameEl.textContent = selected ? selected.name : '';
}

function renderModalGallery(images) {
  const mainImgEl = document.getElementById('modal-main-img');
  const thumbsContainer = document.getElementById('modal-thumbs-container');

  if (mainImgEl) mainImgEl.src = images[0];
  if (thumbsContainer) {
    thumbsContainer.scrollLeft = 0;
    if (images.length > 1) {
      thumbsContainer.style.display = 'flex';
      thumbsContainer.innerHTML = images.map((src, i) => `
        <div class="modal-thumb ${i === 0 ? 'active' : ''}" onclick="switchModalImage('${escapeAttr(src)}', this)">
          <img src="${escapeAttr(src)}" alt="Фото ${i + 1}" loading="lazy">
        </div>
      `).join('');
    } else {
      thumbsContainer.style.display = 'none';
      thumbsContainer.innerHTML = '';
    }
  }
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function selectModalColor(colorId, btnEl) {
  selectedModalColor = colorId;
  document.querySelectorAll('.modal-color-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  updateModalColorName();
  renderModalGallery(getModalImages());
}

function switchModalImage(src, thumbEl) {
  const mainImg = document.getElementById('modal-main-img');
  if (mainImg) mainImg.src = src;

  const thumbs = document.querySelectorAll('.modal-thumb');
  thumbs.forEach(t => t.classList.remove('active'));
  if (thumbEl) thumbEl.classList.add('active');
}

function selectModalSize(size, btnEl) {
  selectedModalSize = size;
  const btns = document.querySelectorAll('.modal-size-btn');
  btns.forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
}

function closeProductModal() {
  const backdrop = document.getElementById('product-modal-backdrop');
  if (backdrop) {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// Make functions available globally for inline onclick
window.switchModalImage = switchModalImage;
window.selectModalColor = selectModalColor;
window.selectModalSize = selectModalSize;
window.openProductModal = openProductModal;
window.resetFilters = resetFilters;
