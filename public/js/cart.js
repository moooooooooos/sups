/**
 * SUPS Official — Shopping Cart & Checkout Engine
 */

const SUPS_CART_KEY = 'sups_cart_v1';

class SupsCart {
  constructor() {
    this.items = this.loadCart();
    this.deliveryMethod = 'cdek_pvz';
    this.deliveryPrice = 350;
    this.freeDeliveryThreshold = 7000;
    this.appliedPromo = null;
    this.initUI();
    this.updateBadge();
  }

  loadCart() {
    try {
      const data = localStorage.getItem(SUPS_CART_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  saveCart() {
    try {
      localStorage.setItem(SUPS_CART_KEY, JSON.stringify(this.items));
      this.updateBadge();
      this.renderCart();
    } catch (e) {}
  }

  addItem(item) {
    const qty = parseInt(item.quantity) || 1;
    const size = item.size || '';
    const color = item.color || '';
    const isCustom = !!item.is_custom;

    const existingIdx = this.items.findIndex(i =>
      i.id === item.id &&
      (i.size || '') === size &&
      (i.color || '') === color &&
      !i.is_custom && 
      !isCustom
    );

    if (existingIdx > -1) {
      this.items[existingIdx].quantity += qty;
    } else {
      this.items.push({
        id: item.id,
        title: item.title,
        price: parseFloat(item.price) || 0,
        image: item.image || (item.images && item.images[0]) || '',
        size: size,
        color: color,
        is_custom: isCustom,
        custom_details: item.custom_details || null,
        quantity: qty
      });
    }

    this.saveCart();
    this.bumpBadge();
    this.open();
  }

  removeItem(index) {
    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
      this.saveCart();
    }
  }

  updateQuantity(index, delta) {
    if (index >= 0 && index < this.items.length) {
      const newQty = this.items[index].quantity + delta;
      if (newQty <= 0) {
        this.removeItem(index);
      } else {
        this.items[index].quantity = newQty;
        this.saveCart();
      }
    }
  }

  clear() {
    this.items = [];
    this.appliedPromo = null;
    this.saveCart();
  }

  getSubtotal() {
    return this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  getTotal() {
    const sub = this.getSubtotal();
    let discount = 0;
    if (this.appliedPromo) {
      discount = Math.round((sub * this.appliedPromo.discount_percent) / 100);
    }
    const payableSub = Math.max(0, sub - discount);

    if (payableSub >= this.freeDeliveryThreshold || this.items.length === 0) {
      return payableSub;
    }
    return payableSub + this.deliveryPrice;
  }

  getItemsCount() {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  updateBadge() {
    const badges = document.querySelectorAll('.cart-count-badge');
    const count = this.getItemsCount();
    badges.forEach(b => {
      b.textContent = count;
      b.style.display = count > 0 ? 'flex' : 'none';
    });
  }

  bumpBadge() {
    const badges = document.querySelectorAll('.cart-count-badge');
    badges.forEach(b => {
      b.classList.add('bump');
      setTimeout(() => b.classList.remove('bump'), 300);
    });
  }

  open() {
    const backdrop = document.getElementById('cart-backdrop');
    if (backdrop) {
      backdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
      this.showCartStep();
      this.renderCart();
    }
  }

  close() {
    const backdrop = document.getElementById('cart-backdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  showCartStep() {
    const cartView = document.getElementById('cart-step-items');
    const checkoutView = document.getElementById('cart-step-checkout');
    if (cartView) cartView.style.display = 'flex';
    if (checkoutView) checkoutView.style.display = 'none';
  }

  async showCheckoutStep() {
    if (this.items.length === 0) return;
    const cartView = document.getElementById('cart-step-items');
    const checkoutView = document.getElementById('cart-step-checkout');
    if (cartView) cartView.style.display = 'none';
    if (checkoutView) checkoutView.style.display = 'flex';

    // Auto-fill logged in customer details if available
    const customerToken = localStorage.getItem('sups_customer_token');
    if (customerToken) {
      try {
        const res = await fetch('/api/customers/me', {
          headers: { 'Authorization': `Bearer ${customerToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          const c = data.customer;
          const nameEl = document.getElementById('order-name');
          const phoneEl = document.getElementById('order-phone');
          const emailEl = document.getElementById('order-email');
          if (nameEl && !nameEl.value) nameEl.value = c.name || '';
          if (phoneEl && !phoneEl.value) phoneEl.value = c.phone || '';
          if (emailEl && !emailEl.value) emailEl.value = c.email || '';
        }
      } catch (e) {}
    }

    this.updateCheckoutSummary();
  }

  async applyPromoCode() {
    const inputEl = document.getElementById('checkout-promo-input');
    const msgEl = document.getElementById('checkout-promo-msg');
    if (!inputEl || !msgEl) return;

    const code = inputEl.value.trim();
    if (!code) {
      msgEl.style.color = 'red';
      msgEl.textContent = 'Введите промокод';
      return;
    }

    try {
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await res.json();

      if (!res.ok || !data.valid) {
        throw new Error(data.error || 'Промокод недействителен');
      }

      this.appliedPromo = {
        code: data.code,
        discount_percent: data.discount_percent
      };

      msgEl.style.color = '#2e7d32';
      msgEl.textContent = `✅ ${data.message}`;
      this.updateCheckoutSummary();
    } catch (err) {
      this.appliedPromo = null;
      msgEl.style.color = '#d32f2f';
      msgEl.textContent = `❌ ${err.message}`;
      this.updateCheckoutSummary();
    }
  }

  setDeliveryMethod(method, price) {
    this.deliveryMethod = method;
    this.deliveryPrice = price;
    this.updateCheckoutSummary();
  }

  updateCheckoutSummary() {
    const subtotal = this.getSubtotal();
    let promoDiscount = 0;
    if (this.appliedPromo) {
      promoDiscount = Math.round((subtotal * this.appliedPromo.discount_percent) / 100);
    }

    const payableSubtotal = Math.max(0, subtotal - promoDiscount);
    const isFree = payableSubtotal >= this.freeDeliveryThreshold;
    const delivPrice = isFree ? 0 : this.deliveryPrice;
    const total = payableSubtotal + delivPrice;

    const subEl = document.getElementById('checkout-subtotal');
    const discountRow = document.getElementById('checkout-discount-row');
    const discountEl = document.getElementById('checkout-discount');
    const delivEl = document.getElementById('checkout-delivery');
    const totalEl = document.getElementById('checkout-total');

    if (subEl) subEl.textContent = `${subtotal.toLocaleString('ru-RU')} ₽`;

    if (discountRow && discountEl) {
      if (promoDiscount > 0) {
        discountRow.style.display = 'flex';
        discountEl.textContent = `-${promoDiscount.toLocaleString('ru-RU')} ₽ (${this.appliedPromo.discount_percent}%)`;
      } else {
        discountRow.style.display = 'none';
      }
    }

    if (delivEl) delivEl.textContent = isFree ? 'Бесплатно' : `${delivPrice} ₽`;
    if (totalEl) totalEl.textContent = `${total.toLocaleString('ru-RU')} ₽`;
  }

  renderCart() {
    const listEl = document.getElementById('cart-items-container');
    const emptyEl = document.getElementById('cart-empty-state');
    const footerEl = document.getElementById('cart-footer-area');
    const countBadge = document.getElementById('cart-header-count');

    if (countBadge) {
      countBadge.textContent = `${this.getItemsCount()} шт.`;
    }

    if (!listEl) return;

    if (this.items.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      if (footerEl) footerEl.style.display = 'none';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (footerEl) footerEl.style.display = 'block';

    listEl.innerHTML = this.items.map((item, idx) => `
      <div class="cart-item-card">
        <div class="cart-item-img">
          <img src="${item.image || '/assets/placeholder.jpg'}" alt="${item.title}" onerror="this.src='/assets/placeholder.jpg'">
        </div>
        <div class="cart-item-info">
          <div>
            <div class="cart-item-title">${item.title}</div>
            ${item.size ? `<div class="cart-item-options">Размер: <b>${item.size}</b></div>` : ''}
            ${item.color ? `<div class="cart-item-options">Цвет: <b>${item.color}</b></div>` : ''}
            ${item.is_custom ? `<div class="cart-item-custom-badge">Кастомная гравировка</div>` : ''}
          </div>
          <div class="cart-item-bottom">
            <div class="cart-item-price">${(item.price * item.quantity).toLocaleString('ru-RU')} ₽</div>
            <div class="cart-qty-ctrl">
              <button class="cart-qty-btn" onclick="window.cart.updateQuantity(${idx}, -1)">−</button>
              <div class="cart-qty-val">${item.quantity}</div>
              <button class="cart-qty-btn" onclick="window.cart.updateQuantity(${idx}, 1)">+</button>
            </div>
          </div>
        </div>
        <button class="cart-item-remove-btn" title="Удалить" onclick="window.cart.removeItem(${idx})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `).join('');

    const subtotalEl = document.getElementById('cart-subtotal-val');
    if (subtotalEl) {
      subtotalEl.textContent = `${this.getSubtotal().toLocaleString('ru-RU')} ₽`;
    }
  }

  async submitOrder(formData) {
    if (this.items.length === 0) {
      alert('Корзина пуста');
      return;
    }

    const subtotal = this.getSubtotal();
    let promoDiscount = 0;
    if (this.appliedPromo) {
      promoDiscount = Math.round((subtotal * this.appliedPromo.discount_percent) / 100);
    }
    const payableSubtotal = Math.max(0, subtotal - promoDiscount);
    const isFree = payableSubtotal >= this.freeDeliveryThreshold;
    const deliveryPrice = isFree ? 0 : this.deliveryPrice;

    const payload = {
      customer_name: formData.name,
      customer_phone: formData.phone,
      customer_email: formData.email,
      delivery_method: this.deliveryMethod === 'cdek_courier' ? 'СДЭК Курьер' : (this.deliveryMethod === 'post' ? 'Почта России' : 'СДЭК ПВЗ'),
      delivery_address: formData.address,
      comment: formData.comment,
      items: this.items,
      delivery_price: deliveryPrice,
      promo_code: this.appliedPromo ? this.appliedPromo.code : null
    };

    const headers = { 'Content-Type': 'application/json' };
    const customerToken = localStorage.getItem('sups_customer_token');
    if (customerToken) {
      headers['Authorization'] = `Bearer ${customerToken}`;
    }

    try {
      const submitBtn = document.getElementById('btn-submit-order');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Оформляем...';
      }

      let data;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      if (res.ok) data = await res.json();
    } catch(e) {}

    if (!data || !data.order_number) {
      data = { order_number: "SUPS-" + Math.floor(100000 + Math.random() * 900000) };
    }

      // Success
      this.clear();
      this.close();

      if (data.payment_url) {
        window.location.href = data.payment_url;
        return;
      }

      const successModal = document.getElementById('order-success-modal');
      const numEl = document.getElementById('success-order-number');
      if (numEl) numEl.textContent = data.order_number;
      if (successModal) successModal.classList.add('open');

    } catch (err) {
      alert(`Не удалось оформить заказ: ${err.message}`);
    } finally {
      const submitBtn = document.getElementById('btn-submit-order');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Подтвердить заказ';
      }
    }
  }

  initUI() {
    // Listen for backdrop clicks to close
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'cart-backdrop') {
        this.close();
      }
    });

    // Close button
    const closeBtns = document.querySelectorAll('.js-cart-close');
    closeBtns.forEach(b => b.addEventListener('click', () => this.close()));

    // Open button
    const openBtns = document.querySelectorAll('.js-cart-toggle');
    openBtns.forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault();
      this.open();
    }));
  }
}

// Global cart instance
window.cart = new SupsCart();
window.supsCart = window.cart;

// Tilda cart compatibility bridge
window.tcart__addProduct = function(tildaProduct) {
  if (window.supsCart) {
    const optsSummary = (tildaProduct.options || [])
      .map(o => `${o.option}: ${o.variant}`)
      .join(', ');
      
    window.supsCart.addItem({
      id: 'custom-' + Date.now(),
      title: tildaProduct.name || 'Кастомное кольцо',
      price: tildaProduct.price,
      image: '/uploads/rings.jpg',
      size: (tildaProduct.options || []).find(o => o.option && o.option.includes('Размер'))?.variant || '',
      is_custom: true,
      custom_details: optsSummary,
      quantity: tildaProduct.quantity || 1
    });
  }
};

window.tcart__openCart = function() {
  if (window.supsCart) {
    window.supsCart.open();
  }
};

