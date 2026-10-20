/**
 * САПС — выбор доставки и проверка контактов в форме заказа.
 * Город выбирается только из подсказок СДЭК, пункт выдачи — из списка перевозчика,
 * адрес курьера — улица и дом (с подсказками DaData, если она подключена в админке).
 * Цена приходит с сервера (/api/delivery/*), сервер перепроверяет всё при оформлении заказа.
 */
(function () {
  const PROVIDER_NAMES = { cdek: 'СДЭК', yandex: 'Яндекс Доставка' };

  const state = {
    config: null,
    city: null,        // { code, name }
    options: [],
    option: null,      // выбранный { provider, type, ... }
    points: [],
    point: null,
    address: { street: '', house: '', flat: '', fias_id: '' },
    quote: null        // ответ /api/delivery/quote
  };

  let root = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function rub(value) {
    return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
  }

  function days(min, max) {
    if (!min && !max) return '';
    if (!max || min === max) return `${min || max} дн.`;
    return `${min}–${max} дн.`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function itemsCount() {
    const items = (window.cart && window.cart.items) || [];
    return items.reduce((n, i) => n + (parseInt(i.quantity, 10) || 1), 0) || 1;
  }

  async function getJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !('ok' in data)) throw new Error(data.error || 'Ошибка сервера');
    return data;
  }

  function setError(message) {
    const el = root && root.querySelector('.dw-error');
    if (el) el.textContent = message || '';
  }

  function setPrice(price, label) {
    if (window.cart && typeof price === 'number') window.cart.setDeliveryMethod(label || 'delivery', price);
  }

  /* ---------- Режим без подключённых перевозчиков ---------- */
  function renderLegacy() {
    root.innerHTML = `
      <div class="form-group">
        <label class="form-label">Город и адрес доставки *</label>
        <input type="text" id="order-address" class="form-input" placeholder="г. Москва, ул. Ленина, д. 5, кв. 10" required minlength="10" autocomplete="street-address">
        <div class="dw-hint">Укажите город, улицу, дом и квартиру — менеджер подтвердит пункт выдачи СДЭК.</div>
      </div>
      <div class="dw-error" role="alert"></div>
    `;
  }

  /* ---------- Основной виджет ---------- */
  function render() {
    root.innerHTML = `
      <div class="form-group">
        <label class="form-label" for="dw-city">Город доставки *</label>
        <div class="dw-suggest">
          <input type="text" id="dw-city" class="form-input" placeholder="Начните вводить город" autocomplete="off" role="combobox" aria-expanded="false">
          <ul class="dw-list" id="dw-city-list" role="listbox" hidden></ul>
        </div>
      </div>
      <div class="form-group dw-options-group" hidden>
        <label class="form-label">Способ доставки *</label>
        <div class="dw-options" id="dw-options"></div>
      </div>
      <div class="form-group dw-pvz-group" hidden>
        <label class="form-label" for="dw-pvz-filter">Пункт выдачи *</label>
        <input type="text" id="dw-pvz-filter" class="form-input" placeholder="Поиск по улице или метро" autocomplete="off">
        <div class="dw-pvz-list" id="dw-pvz-list" role="listbox"></div>
      </div>
      <div class="form-group dw-courier-group" hidden>
        <label class="form-label" for="dw-street">Улица и дом *</label>
        <div class="dw-suggest">
          <input type="text" id="dw-street" class="form-input" placeholder="Улица" autocomplete="off">
          <ul class="dw-list" id="dw-street-list" role="listbox" hidden></ul>
        </div>
        <div class="dw-address-row">
          <input type="text" id="dw-house" class="form-input" placeholder="Дом, корпус" autocomplete="off">
          <input type="text" id="dw-flat" class="form-input" placeholder="Квартира / офис" autocomplete="off">
        </div>
      </div>
      <div class="dw-summary" id="dw-summary"></div>
      <div class="dw-error" role="alert"></div>
    `;
    bindCity();
    bindPoints();
    bindCourier();
  }

  function show(selector, visible) {
    const el = root.querySelector(selector);
    if (el) el.hidden = !visible;
  }

  /* ---------- Город ---------- */
  function bindCity() {
    const input = root.querySelector('#dw-city');
    const list = root.querySelector('#dw-city-list');

    const search = debounce(async (q) => {
      if (q.length < 2) { list.hidden = true; return; }
      try {
        const data = await getJson(`/api/delivery/cities?q=${encodeURIComponent(q)}`);
        const cities = data.cities || [];
        list.innerHTML = cities.length
          ? cities.map(c => `<li role="option" data-code="${esc(c.code)}" data-name="${esc(c.name)}">${esc(c.name)}</li>`).join('')
          : '<li class="dw-empty">Город не найден — проверьте название</li>';
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      } catch (e) {
        setError('Не удалось загрузить города, попробуйте ещё раз');
      }
    }, 250);

    input.addEventListener('input', () => {
      if (state.city) resetFrom('city');
      search(input.value.trim());
    });

    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-code]');
      if (!li) return;
      e.preventDefault();
      selectCity({ code: li.dataset.code, name: li.dataset.name });
      input.value = li.dataset.name;
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    });

    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  }

  function resetFrom(step) {
    if (step === 'city') {
      state.city = null;
      state.options = [];
      show('.dw-options-group', false);
    }
    if (step === 'city' || step === 'option') {
      state.option = null;
      state.points = [];
      state.point = null;
      state.address = { street: '', house: '', flat: '', fias_id: '' };
      show('.dw-pvz-group', false);
      show('.dw-courier-group', false);
    }
    state.quote = null;
    renderSummary();
    setError('');
  }

  async function selectCity(city) {
    resetFrom('city');
    state.city = city;
    const box = root.querySelector('#dw-options');
    show('.dw-options-group', true);
    box.innerHTML = '<div class="dw-loading">Считаем доставку…</div>';
    try {
      const q = new URLSearchParams({ city_code: city.code, city_name: city.name, items: itemsCount() });
      const data = await getJson(`/api/delivery/options?${q}`);
      state.options = data.options || [];
      if (!state.options.length) {
        box.innerHTML = '<div class="dw-empty">В этот город доставка пока недоступна. Напишите нам — подберём вариант.</div>';
        return;
      }
      box.innerHTML = state.options.map((o, i) => `
        <button type="button" class="delivery-option-card" data-index="${i}">
          <strong>${esc(o.title)}</strong>
          <span class="dw-option-meta">${o.price != null ? `${o.from ? 'от ' : ''}${rub(o.price)}` : 'цена по адресу'}${days(o.period_min, o.period_max) ? ` · ${days(o.period_min, o.period_max)}` : ''}</span>
        </button>
      `).join('');
      box.querySelectorAll('.delivery-option-card').forEach(btn => {
        btn.addEventListener('click', () => selectOption(parseInt(btn.dataset.index, 10)));
      });
    } catch (e) {
      box.innerHTML = '';
      setError('Не удалось рассчитать доставку, попробуйте ещё раз');
    }
  }

  /* ---------- Способ ---------- */
  async function selectOption(index) {
    resetFrom('option');
    state.option = state.options[index];
    root.querySelectorAll('#dw-options .delivery-option-card').forEach((b, i) => b.classList.toggle('selected', i === index));
    if (state.option.price != null) setPrice(state.option.price);

    if (state.option.type === 'pvz') {
      show('.dw-pvz-group', true);
      const list = root.querySelector('#dw-pvz-list');
      list.innerHTML = '<div class="dw-loading">Загружаем пункты выдачи…</div>';
      try {
        const q = new URLSearchParams({ provider: state.option.provider, city_code: state.city.code, city_name: state.city.name });
        const data = await getJson(`/api/delivery/points?${q}`);
        state.points = data.points || [];
        renderPoints('');
      } catch (e) {
        list.innerHTML = '';
        setError('Не удалось загрузить пункты выдачи');
      }
    } else {
      show('.dw-courier-group', true);
      root.querySelector('#dw-street').focus();
    }
  }

  /* ---------- ПВЗ ---------- */
  function renderPoints(filter) {
    const list = root.querySelector('#dw-pvz-list');
    const f = filter.trim().toLowerCase();
    const shown = state.points.filter(p => !f || `${p.address} ${p.note}`.toLowerCase().includes(f)).slice(0, 60);
    if (!state.points.length) {
      list.innerHTML = '<div class="dw-empty">В этом городе нет пунктов выдачи — выберите курьера.</div>';
      return;
    }
    list.innerHTML = shown.length ? shown.map(p => `
      <label class="dw-point ${state.point && state.point.id === p.id ? 'selected' : ''}">
        <input type="radio" name="dw-point" value="${esc(p.id)}" ${state.point && state.point.id === p.id ? 'checked' : ''}>
        <span>
          <strong>${esc(p.address)}</strong>
          <small>${esc(p.type === 'postamat' ? 'Постамат' : 'Пункт выдачи')}${p.work_time ? ` · ${esc(p.work_time)}` : ''}</small>
        </span>
      </label>
    `).join('') : '<div class="dw-empty">Ничего не найдено</div>';
  }

  function bindPoints() {
    const filter = root.querySelector('#dw-pvz-filter');
    const list = root.querySelector('#dw-pvz-list');
    filter.addEventListener('input', () => renderPoints(filter.value));
    list.addEventListener('change', (e) => {
      if (e.target.name !== 'dw-point') return;
      state.point = state.points.find(p => String(p.id) === e.target.value) || null;
      list.querySelectorAll('.dw-point').forEach(l => l.classList.toggle('selected', l.contains(e.target)));
      requestQuote();
    });
  }

  /* ---------- Курьер ---------- */
  function bindCourier() {
    const street = root.querySelector('#dw-street');
    const house = root.querySelector('#dw-house');
    const flat = root.querySelector('#dw-flat');
    const list = root.querySelector('#dw-street-list');
    const withSuggest = state.config && state.config.address_suggest;

    if (withSuggest) {
      street.placeholder = 'Улица и дом — выберите из подсказок';
      house.hidden = true;
    }

    const suggest = debounce(async (q) => {
      if (!withSuggest || q.length < 3 || !state.city) { list.hidden = true; return; }
      try {
        const data = await getJson(`/api/delivery/address?${new URLSearchParams({ q, city_name: state.city.name })}`);
        const items = data.suggestions || [];
        list.innerHTML = items.length
          ? items.map((s, i) => `<li role="option" data-i="${i}">${esc(s.value)}${s.has_house ? '' : ' <em>— укажите дом</em>'}</li>`).join('')
          : '<li class="dw-empty">Адрес не найден</li>';
        list._items = items;
        list.hidden = false;
      } catch (e) {
        list.hidden = true;
      }
    }, 300);

    street.addEventListener('input', () => {
      state.address.street = street.value.trim();
      state.address.fias_id = '';
      state.quote = null;
      renderSummary();
      if (withSuggest) suggest(street.value.trim());
      else requestQuoteDebounced();
    });

    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      e.preventDefault();
      const s = list._items[parseInt(li.dataset.i, 10)];
      street.value = s.has_house ? s.value : `${s.value}, `;
      state.address.street = s.street;
      state.address.house = s.house;
      state.address.fias_id = s.has_house ? s.fias_id : '';
      list.hidden = true;
      if (s.has_house) requestQuote();
      else { street.focus(); suggest(street.value); }
    });
    street.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));

    house.addEventListener('input', () => { state.address.house = house.value.trim(); requestQuoteDebounced(); });
    flat.addEventListener('input', () => { state.address.flat = flat.value.trim(); });
  }

  /* ---------- Проверка выбора и цена с сервера ---------- */
  function selection() {
    if (!state.city || !state.option) return null;
    return {
      provider: state.option.provider,
      type: state.option.type,
      city_code: state.city.code,
      city_name: state.city.name,
      point_id: state.point ? state.point.id : null,
      street: state.address.street,
      house: state.address.house,
      flat: state.address.flat,
      fias_id: state.address.fias_id
    };
  }

  function readyForQuote() {
    const s = selection();
    if (!s) return false;
    if (s.type === 'pvz') return Boolean(s.point_id);
    if (state.config && state.config.address_suggest) return Boolean(s.fias_id);
    return s.street.length >= 3 && /\d/.test(s.house);
  }

  let quoteSeq = 0;
  async function requestQuote() {
    state.quote = null;
    renderSummary();
    if (!readyForQuote()) return;
    const seq = ++quoteSeq;
    setError('');
    root.querySelector('#dw-summary').innerHTML = '<div class="dw-loading">Проверяем адрес…</div>';
    try {
      const data = await getJson('/api/delivery/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection: selection(), items: itemsCount() })
      });
      if (seq !== quoteSeq) return;
      if (!data.ok) {
        setError(data.error);
        renderSummary();
        return;
      }
      state.quote = data;
      setPrice(data.price, `${data.provider}_${data.type}`);
      renderSummary();
    } catch (e) {
      if (seq === quoteSeq) setError('Не удалось проверить адрес, попробуйте ещё раз');
    }
  }
  const requestQuoteDebounced = debounce(requestQuote, 600);

  function renderSummary() {
    const el = root && root.querySelector('#dw-summary');
    if (!el) return;
    const q = state.quote;
    el.innerHTML = q ? `
      <div class="dw-summary-ok">
        ✓ ${esc(PROVIDER_NAMES[q.provider])}: ${esc(q.address_text)}<br>
        <span>${rub(q.price)}${days(q.period_min, q.period_max) ? ` · ${days(q.period_min, q.period_max)} в пути` : ''}</span>
      </div>` : '';
  }

  /* ---------- Публичный интерфейс для формы ---------- */
  window.supsDelivery = {
    isLegacy() { return !state.config || (!state.config.providers.cdek && !state.config.providers.yandex); },
    // null — всё в порядке, иначе текст ошибки
    validate() {
      if (this.isLegacy()) {
        const v = (document.getElementById('order-address') || {}).value || '';
        return v.trim().length >= 10 && /\d/.test(v) ? null : 'Укажите полный адрес доставки: город, улица, дом';
      }
      if (!state.city) return 'Выберите город из списка подсказок';
      if (!state.option) return 'Выберите способ доставки';
      if (state.option.type === 'pvz' && !state.point) return 'Выберите пункт выдачи';
      if (!state.quote) return state.option.type === 'courier' ? 'Укажите улицу и дом, мы проверим адрес' : 'Проверяем пункт выдачи, подождите секунду';
      return null;
    },
    getSelection() { return this.isLegacy() ? null : selection(); },
    getLegacyAddress() { return ((document.getElementById('order-address') || {}).value || '').trim(); },
    showError: setError
  };

  /* ---------- Телефон и email ---------- */
  function formatPhone(raw) {
    const value = String(raw).trim();
    let d = value.replace(/\D/g, '');
    // «+7» в поле — код страны; после него набранные 8 или 7 — тоже код (мобильный номер начинается с 9)
    if (value.startsWith('+7')) d = d.slice(1);
    if (d.startsWith('8') || d.startsWith('7')) d = d.slice(1);
    d = d.slice(0, 10);
    let out = '+7';
    if (d.length) out += ` (${d.slice(0, 3)}`;
    if (d.length >= 3) out += ')';
    if (d.length > 3) out += ` ${d.slice(3, 6)}`;
    if (d.length > 6) out += `-${d.slice(6, 8)}`;
    if (d.length > 8) out += `-${d.slice(8, 10)}`;
    return out;
  }

  const DOMAIN_TYPOS = {
    'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.cm': 'gmail.com',
    'yandex.ry': 'yandex.ru', 'yandeks.ru': 'yandex.ru', 'yadex.ru': 'yandex.ru', 'yndex.ru': 'yandex.ru',
    'mail.ry': 'mail.ru', 'mial.ru': 'mail.ru', 'mali.ru': 'mail.ru', 'maill.ru': 'mail.ru',
    'inbox.ry': 'inbox.ru', 'list.ry': 'list.ru', 'bk.ry': 'bk.ru', 'rambler.ry': 'rambler.ru', 'icloud.co': 'icloud.com'
  };

  function fieldError(input, message) {
    if (!input) return;
    let el = input.parentElement.querySelector('.dw-field-error');
    if (!el) {
      el = document.createElement('div');
      el.className = 'dw-field-error';
      input.insertAdjacentElement('afterend', el);
    }
    el.innerHTML = message || '';
    input.classList.toggle('dw-invalid', Boolean(message));
  }

  function phoneError(value) {
    const d = String(value).replace(/\D/g, '');
    return d.length === 11 && d[1] === '9' ? '' : 'Укажите мобильный номер: +7 9XX XXX-XX-XX';
  }

  function emailError(value) {
    const v = String(value).trim().toLowerCase();
    if (!v) return 'Укажите email — на него придёт чек';
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return 'Проверьте email: похоже, в адресе опечатка';
    const domain = v.split('@')[1];
    if (DOMAIN_TYPOS[domain]) {
      const fixed = `${v.split('@')[0]}@${DOMAIN_TYPOS[domain]}`;
      return `Возможно, вы имели в виду <button type="button" class="dw-fix-email" data-email="${esc(fixed)}">${esc(fixed)}</button>?`;
    }
    return '';
  }

  function bindContacts() {
    const phone = document.getElementById('order-phone');
    const email = document.getElementById('order-email');
    if (phone && !phone.dataset.dwBound) {
      phone.dataset.dwBound = '1';
      phone.setAttribute('inputmode', 'tel');
      phone.setAttribute('autocomplete', 'tel');
      phone.addEventListener('focus', () => { if (!phone.value) phone.value = '+7 ('; });
      phone.addEventListener('input', () => { phone.value = formatPhone(phone.value); fieldError(phone, ''); });
      phone.addEventListener('blur', () => { if (phone.value.replace(/\D/g, '').length > 1) fieldError(phone, phoneError(phone.value)); });
    }
    if (email && !email.dataset.dwBound) {
      email.dataset.dwBound = '1';
      email.required = true;
      email.setAttribute('autocomplete', 'email');
      email.addEventListener('input', () => fieldError(email, ''));
      email.addEventListener('blur', () => { if (email.value) fieldError(email, emailError(email.value)); });
      email.parentElement.addEventListener('click', (e) => {
        const btn = e.target.closest('.dw-fix-email');
        if (!btn) return;
        email.value = btn.dataset.email;
        fieldError(email, '');
      });
    }
  }

  // Проверка контактов перед отправкой: true — можно отправлять
  window.supsDelivery.validateContacts = function () {
    const phone = document.getElementById('order-phone');
    const email = document.getElementById('order-email');
    const pErr = phone ? phoneError(phone.value) : '';
    const eErr = email ? emailError(email.value) : '';
    fieldError(phone, pErr);
    fieldError(email, eErr);
    if (pErr) phone.focus();
    else if (eErr) email.focus();
    return !pErr && !eErr;
  };
  window.supsDelivery.fieldError = (field, message) => {
    fieldError(document.getElementById(field === 'phone' ? 'order-phone' : 'order-email'), message);
  };

  /* ---------- Запуск ---------- */
  async function init() {
    root = document.getElementById('delivery-widget');
    if (!root) return;
    bindContacts();
    try {
      state.config = await getJson('/api/delivery/config');
    } catch (e) {
      state.config = null;
    }
    if (window.supsDelivery.isLegacy()) renderLegacy();
    else render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
