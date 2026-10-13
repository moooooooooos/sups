/**
 * SUPS Official — Main Global JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initSocialPopup();
  initCheckoutForm();
  initHomepageReviews();
  initUserAccountDropdown();
  initStoreMap();
  initBuyersModal();
  initCooperationModal();
  initCollectionsShowcase();
});

// Header User Profile Icon Button & Popover Dropdown (1:1 with user design)
async function initUserAccountDropdown() {
  const headerActions = document.querySelector('.header-actions');
  if (!headerActions) return;

  // Check if dropdown wrap already exists
  let wrap = headerActions.querySelector('.user-account-dropdown-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'user-account-dropdown-wrap';
    wrap.innerHTML = `
      <button class="user-account-btn" id="header-user-btn" title="Профиль">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </button>
      <div class="user-account-menu" id="header-user-menu"></div>
    `;
    headerActions.insertBefore(wrap, headerActions.firstChild);
  }

  const btn = wrap.querySelector('#header-user-btn');
  const menu = wrap.querySelector('#header-user-menu');

  if (!btn || !menu) return;

  // Toggle dropdown on click
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      menu.classList.remove('open');
    }
  });

  const customerToken = localStorage.getItem('sups_customer_token');
  if (customerToken) {
    try {
      const res = await fetch('/api/customers/me', {
        headers: { 'Authorization': `Bearer ${customerToken}` }
      });
      if (!res.ok) throw new Error('Unauthorized');
      const data = await res.json();
      const customer = data.customer;

      let bdayBadge = '';
      if (customer.is_birthday_month) {
        bdayBadge = `<div style="font-size:0.75rem; background:#fff3e0; color:#e65100; font-weight:700; padding:4px 8px; border-radius:6px; margin-top:6px;">🎉 Праздничная скидка ко Дню Рождения!</div>`;
      }

      menu.innerHTML = `
        <div class="user-account-menu-header">
          <div>
            <div class="user-account-menu-title">${customer.name.toUpperCase()} ↗</div>
            <a href="/account" class="user-account-menu-subtitle">Редактировать профиль</a>
            ${bdayBadge}
          </div>
          <button class="user-account-logout-btn" onclick="logoutCustomerHeader()" title="Выйти">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
        <div class="user-account-menu-nav">
          <a href="/account" class="user-account-menu-link">Личный кабинет</a>
          <a href="/account" class="user-account-menu-link">Мои заказы</a>
          <a href="/leave-review" class="user-account-menu-link">Купленные товары</a>
          <a href="/account" class="user-account-menu-link">Мои адреса</a>
        </div>
      `;
      return;
    } catch (e) {
      localStorage.removeItem('sups_customer_token');
    }
  }

  // If not logged in
  menu.innerHTML = `
    <div class="user-account-menu-header">
      <div>
        <div class="user-account-menu-title">ВХОД В ПРОФИЛЬ</div>
        <div class="user-account-menu-subtitle">Скидки, бонусы и заказы</div>
      </div>
    </div>
    <div class="user-account-menu-nav">
      <a href="/account" class="user-account-menu-link" style="font-weight:700;">Войти в личный кабинет</a>
      <a href="/account" class="user-account-menu-link" style="color:#000; opacity:0.7;">Зарегистрироваться</a>
    </div>
  `;
}

function logoutCustomerHeader() {
  localStorage.removeItem('sups_customer_token');
  window.location.reload();
}
window.logoutCustomerHeader = logoutCustomerHeader;

// Mobile Navigation
function initMobileMenu() {
  const toggleBtn = document.querySelector('.mobile-menu-toggle');
  const drawer = document.querySelector('.mobile-nav-drawer');
  const closeBtn = document.querySelector('.mobile-nav-close');

  if (toggleBtn && drawer) {
    toggleBtn.addEventListener('click', () => {
      drawer.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  }

  if (closeBtn && drawer) {
    closeBtn.addEventListener('click', () => {
      drawer.classList.remove('open');
      document.body.style.overflow = '';
    });
  }

  // Close when clicking nav link inside mobile drawer
  if (drawer) {
    drawer.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        drawer.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }
}

// Social Floating Button & Bottom Corner Popup (1:1 with sups-official.ru)
function initSocialPopup() {
  const popup = document.getElementById('custom-social-popup');
  const floatingBtn = document.getElementById('custom-social-floating-btn');
  const closeBtn = document.getElementById('custom-social-popup-close');

  if (!popup || !floatingBtn) return;

  // Show floating button
  floatingBtn.style.display = 'flex';

  // Toggle popup on floating button click
  floatingBtn.addEventListener('click', () => {
    popup.classList.toggle('active');
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      popup.classList.remove('active');
    });
  }

  // Show popup automatically after 10 seconds if not closed yet
  setTimeout(() => {
    if (!sessionStorage.getItem('sups_social_shown')) {
      popup.classList.add('active');
      sessionStorage.setItem('sups_social_shown', 'true');
    }
  }, 10000);
}

// Dynamic Homepage Reviews with Photos and Product Link
async function initHomepageReviews() {
  const container = document.getElementById('homepage-reviews-grid');
  if (!container) return;

  try {
    const res = await fetch('/api/reviews?limit=12');
    const data = await res.json();
    const reviews = data.reviews || [];

    if (reviews.length === 0) return;

    container.innerHTML = reviews.map(r => {
      const photos = Array.isArray(r.photos) ? r.photos : [];
      const photosHtml = photos.length > 0 ? `
        <div class="review-photos-grid" style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
          ${photos.map(url => `<img src="${url}" style="width:64px; height:64px; object-fit:cover; border-radius:6px; border:1px solid #eee; cursor:pointer;" onclick="window.open('${url}', '_blank')">`).join('')}
        </div>
      ` : '';

      const productBadge = r.product_title ? `
        <div style="display:inline-flex; align-items:center; gap:8px; margin-top:10px; background:#f5f5f7; padding:6px 12px; border-radius:20px; font-size:0.8rem; font-weight:600; color:#333; border:1px solid #e8e8ed;">
          ${r.product_image ? `<img src="${r.product_image}" style="width:20px; height:20px; object-fit:cover; border-radius:50%;">` : '✨'}
          <span>${r.product_title}</span>
        </div>
      ` : '';

      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);

      return `
        <div class="review-card" style="background:#fff; border-radius:16px; padding:24px; border:1px solid #eee; display:flex; flex-direction:column; justify-between;">
          <div>
            <div style="color:#f59e0b; font-size:1.1rem; margin-bottom:8px;">${stars}</div>
            <p class="review-text" style="font-size:0.95rem; line-height:1.5; color:#333; margin-bottom:8px;">«${r.text}»</p>
            ${productBadge}
            ${photosHtml}
          </div>
          <div class="review-author" style="margin-top:16px; display:flex; align-items:center; gap:12px; border-top:1px solid #f0f0f0; padding-top:12px;">
            <div class="review-avatar" style="width:40px; height:40px; border-radius:50%; background:#111; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700;">
              ${(r.author_name || 'А')[0].toUpperCase()}
            </div>
            <div>
              <div class="review-name" style="font-weight:700; font-size:0.9rem;">${r.author_name}</div>
              <div class="review-meta" style="font-size:0.8rem; color:#888;">${r.city || 'Санкт-Петербург'}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading homepage reviews:', err);
  }
}

// Checkout Form Submission
function initCheckoutForm() {
  const checkoutBtn = document.getElementById('btn-go-to-checkout');
  const backToCartBtn = document.getElementById('btn-back-to-cart');
  const orderForm = document.getElementById('checkout-order-form');

  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      window.cart.showCheckoutStep();
    });
  }

  if (backToCartBtn) {
    backToCartBtn.addEventListener('click', () => {
      window.cart.showCartStep();
    });
  }

  // Delivery options cards
  const deliveryCards = document.querySelectorAll('.delivery-option-card');
  deliveryCards.forEach(card => {
    card.addEventListener('click', () => {
      deliveryCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const method = card.dataset.method;
      const price = parseFloat(card.dataset.price) || 0;
      window.cart.setDeliveryMethod(method, price);
    });
  });

  // Form submit
  if (orderForm) {
    orderForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = {
        name: document.getElementById('order-name').value,
        phone: document.getElementById('order-phone').value,
        email: document.getElementById('order-email').value,
        address: document.getElementById('order-address').value,
        comment: document.getElementById('order-comment').value
      };
      window.cart.submitOrder(formData);
    });
  }

  // Close Order Success Modal
  const closeSuccessBtn = document.getElementById('btn-close-success');
  const successModal = document.getElementById('order-success-modal');
  if (closeSuccessBtn && successModal) {
    closeSuccessBtn.addEventListener('click', () => {
      successModal.classList.remove('open');
    });
  }
}

// Clean Ad-Free Yandex Store Map (Official JS API)
function initStoreMap() {
  const mapElement = document.getElementById('yandex-store-map');
  if (!mapElement) return;

  function loadYandexMap() {
    if (typeof ymaps === 'undefined') {
      setTimeout(loadYandexMap, 200);
      return;
    }
    ymaps.ready(() => {
      try {
        if (mapElement.dataset.initialized) return;
        mapElement.dataset.initialized = 'true';

        const map = new ymaps.Map('yandex-store-map', {
          center: [56.836643, 60.591456],
          zoom: 16,
          controls: ['zoomControl', 'fullscreenControl']
        });

        const placemark = new ymaps.Placemark([56.836643, 60.591456], {
          hintContent: 'Винтаж маркет «Без пакета» — украшения САПС',
          balloonContentHeader: '<div style="font-family:Montserrat,sans-serif; font-weight:800; font-size:14px; text-transform:uppercase;">Винтаж маркет «Без пакета»</div>',
          balloonContentBody: '<div style="font-size:13px; line-height:1.45; color:#333; margin:6px 0;">г. Екатеринбург, ул. Хохрякова, 1<br><span style="color:#777; font-size:12px;">м. Площадь 1905 года • Шоурум САПС</span></div>',
          balloonContentFooter: '<a href="https://yandex.ru/maps/org/yoma/106918747497/?ll=60.591456%2C56.836643&z=16" target="_blank" rel="noopener noreferrer" style="color:#000; font-weight:700; font-size:12px; text-decoration:underline;">Маршрут в Яндекс Картах ↗</a>'
        }, {
          preset: 'islands#blackShoppingIcon'
        });

        map.geoObjects.add(placemark);
        map.behaviors.disable('scrollZoom');
      } catch (e) {
        console.error('Error initializing store map:', e);
      }
    });
  }

  loadYandexMap();
}

// Buyers Topics & Modal (1:1 with rushev.online structure)
const BUYERS_TOPICS = {
  care: {
    title: 'Уход за украшениями',
    content: `
      <h4>Особенности стали марки AISI 304</h4>
      <p>Основа изделий САПС — высокопрочная нержавеющая сталь марки AISI 304. Она устойчива к коррозии, влаге, поту и перепадам температур.</p>
      <h4>Рекомендации по уходу</h4>
      <ul>
        <li>Для поддержания первозданного блеска периодически промывайте украшение под струей теплой воды с мягким жидким мылом.</li>
        <li>После мытья протрите изделие насухо салфеткой из микрофибры или мягкой тканью.</li>
        <li>Не используйте металлические щетки и агрессивные порошковые абразивы, чтобы не поцарапать полировку.</li>
        <li>При купании в хлорированных бассейнах или термальных источниках рекомендуем ополоснуть украшение пресной водой.</li>
      </ul>
    `
  },
  delivery: {
    title: 'Доставка и оплата',
    content: `
      <h4>Способы и география доставки</h4>
      <p>Мы доставляем заказы по всей территории России и странам СНГ надежными транспортными службами:</p>
      <ul>
        <li><strong>СДЭК:</strong> доставка курьером до двери или в удобный пункт выдачи заказов (ПВЗ). Срок: 2–5 рабочих дней.</li>
        <li><strong>Почта России:</strong> отправления 1-м классом с трек-номером отслеживания. Срок: 3–7 рабочих дней.</li>
      </ul>
      <h4>Оплата</h4>
      <ul>
        <li>Банковские карты (МИР, Visa, Mastercard любых банков РФ).</li>
        <li>Система быстрых платежей (СБП) по QR-коду без комиссии.</li>
        <li>Т-Банк / T-Pay для быстрой оплаты в один клик.</li>
      </ul>
      <p>Каждое изделие бережно упаковывается в крафтовый фирменный конверт САПС с защитной пломбой.</p>
    `
  },
  return: {
    title: 'Возврат товара',
    content: `
      <h4>Условия возврата и обмена</h4>
      <p>Мы стремимся к тому, чтобы украшение приносило вам только уверенность и удовольствие. Если изделие не подошло по размеру или стилю:</p>
      <ul>
        <li>Вы можете оформить возврат или обмен в течение <strong>14 календарных дней</strong> с момента получения заказа.</li>
        <li>Изделие должно сохранить товарный вид, потребительские свойства, оригинальные бирки и фирменную упаковку.</li>
        <li>Изделия с индивидуальной кастомной гравировкой (созданные в 3D-конструкторе) возврату надлежащего качества не подлежат в соответствии с законодательством РФ.</li>
      </ul>
      <h4>Как оформить</h4>
      <p>Для оформления заявки напишите нашему менеджеру в Telegram: <a href="https://t.me/sups_steel" target="_blank" style="color:#000; font-weight:700; text-decoration:underline;">@sups_steel</a> или на почту <a href="mailto:sups.official.spb@gmail.com" style="color:#000; font-weight:700; text-decoration:underline;">sups.official.spb@gmail.com</a>.</p>
    `
  },
  warranty: {
    title: 'Гарантия',
    content: `
      <h4>Гарантийные обязательства САПС</h4>
      <p>Мы полностью уверены в надежности используемых материалов и точности оборудования:</p>
      <ul>
        <li><strong>12 месяцев гарантии</strong> на все изделия со дня покупки.</li>
        <li>Гарантия покрывает целостность металла, устойчивость лазерной гравировки и работоспособность замковых соединений (на серьгах и браслетах).</li>
        <li>В случае обнаружения производственного дефекта мы бесплатно обменяем украшение на новое или вернем полную стоимость покупки.</li>
      </ul>
      <p>Сталь AISI 304 рассчитана на десятилетия активного повседневного использования без потери прочности.</p>
    `
  },
  faq: {
    title: 'Часто задаваемые вопросы',
    content: `
      <h4>Популярные вопросы покупателей</h4>
      <ul>
        <li>
          <strong>Как точно определить свой размер пальца?</strong><br>
          Воспользуйтесь онлайн-инструментом <a href="/sizer" style="color:#000; font-weight:700; text-decoration:underline;">«Определитель размера»</a> на нашем сайте или посетите нашу партнерскую офлайн-точку для живой примерки.
        </li>
        <li>
          <strong>Темнеет ли сталь от воды или духов?</strong><br>
          Нет. В отличие от серебра, нержавеющая сталь марки AISI 304 не окисляется на воздухе и не вступает в реакцию с водой и потом.
        </li>
        <li>
          <strong>Можно ли сделать свой рисунок на кольце?</strong><br>
          Да, перейдите в наш раздел <a href="/custom-sups" style="color:#000; font-weight:700; text-decoration:underline;">«3D Кастом»</a> — там можно выбрать шрифт, загрузить свой символ или надпись для глубокой лазерной гравировки.
        </li>
      </ul>
    `
  },
  loyalty: {
    title: 'Программа лояльности',
    content: `
      <h4>Клуб единомышленников САПС</h4>
      <p>Для постоянных покупателей и участников нашего сообщества действует система привилегий:</p>
      <ul>
        <li><strong>Персональные скидки:</strong> накопительный бонусный процент, растущий с каждым новым заказом в личном кабинете.</li>
        <li><strong>Закрытые дропы:</strong> ранний доступ к лимитированным коллекциям, спецпроектам и секретным конвертам до официального релиза.</li>
        <li><strong>Специальные подарки:</strong> фирменные сувениры и промокоды ко дню рождения и праздникам.</li>
      </ul>
      <p>Зарегистрируйтесь в личном кабинете на сайте, чтобы накапливать историю покупок и получать специальные предложения.</p>
    `
  }
};

function initBuyersModal() {
  // Handle header dropdown hover hysteresis and mobile click
  const dropdownWrap = document.querySelector('.nav-dropdown-wrap');
  const dropdownToggle = document.querySelector('.nav-dropdown-toggle');
  if (dropdownWrap && dropdownToggle) {
    let leaveTimer = null;
    dropdownWrap.addEventListener('mouseenter', () => {
      if (leaveTimer) clearTimeout(leaveTimer);
      dropdownWrap.classList.add('open');
    });
    dropdownWrap.addEventListener('mouseleave', () => {
      leaveTimer = setTimeout(() => {
        dropdownWrap.classList.remove('open');
      }, 250);
    });
    dropdownToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropdownWrap.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!dropdownWrap.contains(e.target)) {
        dropdownWrap.classList.remove('open');
      }
    });
  }

  const backdrop = document.getElementById('buyers-modal-backdrop');
  if (!backdrop) return;

  const titleEl = document.getElementById('buyers-modal-title');
  const bodyEl = document.getElementById('buyers-modal-body');
  const closeBtn = document.getElementById('buyers-modal-close');
  const understandBtn = document.getElementById('buyers-modal-btn-close');

  function openTopic(topicKey) {
    const data = BUYERS_TOPICS[topicKey] || BUYERS_TOPICS.care;
    if (titleEl) titleEl.textContent = data.title;
    if (bodyEl) bodyEl.innerHTML = data.content;

    if (dropdownWrap) dropdownWrap.classList.remove('open');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (understandBtn) understandBtn.addEventListener('click', closeModal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  // Attach to buyer cards on homepage
  document.querySelectorAll('.buyer-card').forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const topic = card.dataset.topic;
      openTopic(topic);
    });
  });

  // Attach to dropdown items and footer links with data-buyer-topic
  document.querySelectorAll('[data-buyer-topic]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const topic = el.dataset.buyerTopic;
      openTopic(topic);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) {
      closeModal();
    }
  });
}

// ============================================================
// Cooperation Modal (Партнерство и переадресация на форму)
// ============================================================
function initCooperationModal() {
  const backdrop = document.getElementById('cooperation-modal-backdrop');
  if (!backdrop) return;

  const closeBtn = document.getElementById('cooperation-modal-close');
  const footerCloseBtn = document.getElementById('cooperation-modal-btn-close');

  function openModal() {
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (footerCloseBtn) footerCloseBtn.addEventListener('click', closeModal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) {
      closeModal();
    }
  });

  // Attach to any link/button with js-open-cooperation or href="/cooperation"
  document.querySelectorAll('.js-open-cooperation, a[href="/cooperation"], a[href="#cooperation"]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.button === 1) return;
      e.preventDefault();
      openModal();
    });
  });

  // If page loaded with hash #cooperation, automatically open
  if (window.location.hash === '#cooperation') {
    openModal();
  }
}

// ============================================================
// Homepage Collections Showcase (14 Collections with Image & Text Preview)
// ============================================================
const COLLECTIONS_DATA = [
  {
    name: 'Истории и мифы',
    nameCaps: 'ИСТОРИИ И МИФЫ',
    num: '01',
    count: 17,
    image: '/images/products/897454476552.jpg',
    tagline: 'ДРЕВНИЕ АРХЕТИПЫ И СКАЗАНИЯ',
    desc: 'Символы вечных легенд, тайные знаки и мистические образы, отлитые в прочной стали. Каждое изделие — это личный талисман с глубоким культурным кодом.',
    tags: ['Мифы', 'Архетипы', '17 изделий']
  },
  {
    name: 'Коллаборации',
    nameCaps: 'КОЛЛАБОРАЦИИ',
    num: '02',
    count: 29,
    image: '/images/products/628991000233.jpg',
    tagline: 'СОВМЕСТНЫЕ ПРОЕКТЫ С АРТИСТАМИ',
    desc: 'Синергия концептуального ювелирного дизайна САПС и творческого вижена музыкантов, художников и инфлюенсеров. Лимитированные серии с уникальным манифестом.',
    tags: ['Коллаборации', 'Лимитировано', '29 изделий']
  },
  {
    name: 'Конец сказке',
    nameCaps: 'КОНЕЦ СКАЗКЕ',
    num: '03',
    count: 19,
    image: '/images/products/825318204482.jpg',
    tagline: 'ВЗРОСЛЕНИЕ И РЕАЛИЗМ',
    desc: 'Коллекция о моменте, когда наивные иллюзии уступают место честной реальности. Дерзкие геометрические грани, смелые формы и несгибаемый характер стали.',
    tags: ['Дерзость', 'Честность', '19 изделий']
  },
  {
    name: 'Концептуализм',
    nameCaps: 'КОНЦЕПТУАЛИЗМ',
    num: '04',
    count: 29,
    image: '/images/products/376295654093.png',
    tagline: 'ЧИСТАЯ ИДЕЯ И ФОРМА',
    desc: 'Минимализм, возведенный в абсолют. Архитектурная геометрия, строгие пропорции и смысловая нагрузка, где каждый штрих и грань имеют четкое значение.',
    tags: ['Геометрия', 'Минимализм', '29 изделий']
  },
  {
    name: 'Личная философия',
    nameCaps: 'ЛИЧНАЯ ФИЛОСОФИЯ',
    num: '05',
    count: 48,
    image: '/images/products/184026748582.jpg',
    tagline: 'МАНИФЕСТ И ВНУТРЕННИЙ ВЫБОР',
    desc: 'Украшения-напоминания о собственных принципах, внутренней свободе и пути. Стальные гравировки и силуэты, отражающие то, во что веришь именно ты.',
    tags: ['Философия', 'Смысл', '48 изделий']
  },
  {
    name: 'Магия случая',
    nameCaps: 'МАГИЯ СЛУЧАЯ',
    num: '06',
    count: 3,
    image: '/images/products/453774308162.png',
    tagline: 'ТАЙНА И СЮРПРИЗ СУДЬБЫ',
    desc: 'Секретные конверты и украшения-сюрпризы. Доверьтесь случаю и получите уникальное изделие САПС с элементом приятной непредсказуемости.',
    tags: ['Секретный бокс', 'Случай', '3 изделия']
  },
  {
    name: 'САПС х «Стереополина»',
    nameCaps: 'САПС х «СТЕРЕОПОЛИНА»',
    num: '07',
    count: 4,
    image: '/images/products/399901876532.jpg',
    tagline: 'СИНТИ-ПОП И НОСТАЛЬГИЯ',
    desc: 'Совместная линейка с синти-поп певицей Стереополиной. Романтика советской эстетики, ирония, взросление и кинематографичный ретро-вайб в стали.',
    tags: ['Стереополина', 'Музыка', '4 изделия']
  },
  {
    name: 'САПС х Stervell',
    nameCaps: 'САПС х STERVELL',
    num: '08',
    count: 7,
    image: '/images/products/368026792952.jpg',
    tagline: 'ИСКРЕННОСТЬ И САМОПРИНЯТИЕ',
    desc: 'Коллаборация со Stervell о бережном отношении к себе, любви без условий и спокойной внутренней уверенности. Украшения как персональный якорь нежности и силы.',
    tags: ['Stervell', 'Любовь к себе', '7 изделий']
  },
  {
    name: 'САПС х Маша Хима',
    nameCaps: 'САПС х МАША ХИМА',
    num: '09',
    count: 6,
    image: '/images/products/873313565612.jpg',
    tagline: 'ГОЛОС И БЕЗОГОВОРОЧНОЕ «Я РЕШАЮ»',
    desc: 'Дерзкая, бескомпромиссная линейка с хип-хоп исполнительницей Машей Химой. Четкие манифесты, право говорить «нет» и непоколебимая личная независимость.',
    tags: ['Маша Хима', 'Я решаю', '6 изделий']
  },
  {
    name: 'САПС х без обид',
    nameCaps: 'САПС х БЕЗ ОБИД',
    num: '10',
    count: 6,
    image: '/images/products/771361905323.png',
    tagline: 'ИНДИ-РОК И ЧИСТЫЕ ЧУВСТВА',
    desc: 'Коллаборация с группой «без обид». Музыкальные строчки, превращенные в стальные артефакты: про юность, драйв, искренность и верность себе.',
    tags: ['без обид', 'Инди-рок', '6 изделий']
  },
  {
    name: 'САПС х никому не говори',
    nameCaps: 'САПС х НИКОМУ НЕ ГОВОРИ',
    num: '11',
    count: 5,
    image: '/images/products/693808457362.jpg',
    tagline: 'СОКРОВЕННЫЕ ТАЙНЫ И ИСТОРИИ',
    desc: 'Тайные послания, символы ночного Токио и личные шифры, понятные только избранным. Украшения, хранящие твои сокровенные мысли от посторонних глаз.',
    tags: ['Секреты', 'Шифры', '5 изделий']
  },
  {
    name: 'Сила внутри',
    nameCaps: 'СИЛА ВНУТРИ',
    num: '12',
    count: 21,
    image: '/images/products/218636752392.jpg',
    tagline: 'НЕСГИБАЕМЫЙ СТЕРЖЕНЬ',
    desc: 'Коллекция про внутреннюю опору, стойкость перед трудностями и спокойную уверенность. Медицинская сталь AISI 304 как материальное воплощение твоей стойкости.',
    tags: ['Стойкость', 'Опора', '21 изделие']
  },
  {
    name: 'Уверенность и упорство',
    nameCaps: 'УВЕРЕННОСТЬ И УПОРСТВО',
    num: '13',
    count: 16,
    image: '/images/products/315128423512.jpg',
    tagline: 'ДОСТИЖЕНИЕ ЦЕЛЕЙ И ФОКУС',
    desc: 'Четкие грани, лаконичный стиль и мощная энергетика для тех, кто идет вперед несмотря ни на что. Украшения, которые подчеркивают решимость и фокус.',
    tags: ['Характер', 'Движение', '16 изделий']
  },
  {
    name: 'Эмоция на металле',
    nameCaps: 'ЭМОЦИЯ НА МЕТАЛЛЕ',
    num: '14',
    count: 34,
    image: '/images/products/602190564872.png',
    tagline: 'ЧУВСТВА, ЗАПЕЧАТЛЕННЫЕ В СТАЛИ',
    desc: 'Живая страсть, глубина переживаний и экспрессия, зафиксированные в холодной нержавеющей стали. Металл хранит эмоции, не тускнея и не теряя блеска с годами.',
    tags: ['Экспрессия', 'Память', '34 изделия']
  }
];

function initCollectionsShowcase() {
  const listEl = document.getElementById('collections-rows-list');
  if (!listEl) return;

  const imgEl = document.getElementById('col-preview-img');
  const numEl = document.getElementById('col-preview-num');
  const taglineEl = document.getElementById('col-preview-tagline');
  const titleEl = document.getElementById('col-preview-title');
  const descEl = document.getElementById('col-preview-desc');
  const metaEl = document.getElementById('col-preview-meta');
  const ctaEl = document.getElementById('col-preview-cta');

  // Render row items
  listEl.innerHTML = COLLECTIONS_DATA.map((col, idx) => `
    <div class="collection-row-item ${idx === 0 ? 'active' : ''}" data-index="${idx}" tabindex="0" role="button" aria-label="Коллекция ${col.name}">
      <div class="collection-row-left">
        <span class="col-row-num">${col.num}</span>
        <span class="col-row-name">${col.nameCaps}</span>
      </div>
      <div class="collection-row-right">
        <span class="col-row-badge">${col.count} шт</span>
        <div class="col-row-arrow">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
    </div>
  `).join('');

  const rowItems = listEl.querySelectorAll('.collection-row-item');

  function updatePreview(index) {
    const col = COLLECTIONS_DATA[index];
    if (!col) return;

    // Update active row class
    rowItems.forEach((r, i) => {
      if (i === index) {
        r.classList.add('active');
      } else {
        r.classList.remove('active');
      }
    });

    // Image transition
    if (imgEl) {
      imgEl.style.opacity = '0.3';
      imgEl.style.transform = 'scale(0.98)';
      setTimeout(() => {
        imgEl.src = col.image;
        imgEl.alt = col.name;
        imgEl.style.opacity = '1';
        imgEl.style.transform = 'scale(1)';
      }, 150);
    }

    if (numEl) numEl.textContent = `${col.num} / 14`;
    if (taglineEl) taglineEl.textContent = col.tagline;
    if (titleEl) titleEl.textContent = col.nameCaps;
    if (descEl) descEl.textContent = col.desc;

    if (metaEl) {
      metaEl.innerHTML = col.tags.map(t => `<span class="col-meta-chip">${t}</span>`).join('');
    }

    if (ctaEl) {
      ctaEl.href = `/catalogue?collection=${encodeURIComponent(col.name)}`;
    }
  }

  // Attach hover and click listeners
  rowItems.forEach((item, idx) => {
    item.addEventListener('mouseenter', () => updatePreview(idx));
    item.addEventListener('click', () => updatePreview(idx));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        updatePreview(idx);
      }
    });
  });

  // Set initial state
  updatePreview(0);
}

