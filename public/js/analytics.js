/**
 * САПС — собственная анонимная веб-аналитика.
 * Считает визиты, просмотры страниц и товаров, время на сайте и тип устройства.
 * В браузере хранятся только случайные id посетителя и визита (localStorage),
 * никаких имён, телефонов и IP — см. раздел 6 Политики обработки ПД.
 */
(function () {
  const ENDPOINT = '/api/analytics/collect';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // визит заканчивается после 30 минут бездействия
  const PING_MS = 15 * 1000;                 // пока вкладка открыта, продлеваем визит

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function detectDevice() {
    const ua = navigator.userAgent || '';
    const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPad|Tablet/i.test(ua) || touchMac || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
    if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  let visitorId = storageGet('sups_vid');
  if (!visitorId) {
    visitorId = randomId();
    storageSet('sups_vid', visitorId);
  }

  // Текущий визит общий для всех вкладок; новый — после 30 минут тишины
  function sessionId() {
    let session = null;
    try { session = JSON.parse(storageGet('sups_sid') || 'null'); } catch (e) {}
    const now = Date.now();
    if (!session || !session.id || now - session.last > SESSION_TIMEOUT_MS) {
      session = { id: randomId(), last: now };
    }
    session.last = now;
    storageSet('sups_sid', JSON.stringify(session));
    return session.id;
  }

  const device = detectDevice();

  function send(type, extra) {
    const body = Object.assign({
      v: visitorId,
      s: sessionId(),
      t: type,
      path: location.pathname + location.search,
      ref: type === 'pageview' ? document.referrer : '',
      device
    }, extra || {});
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true
      }).catch(() => {});
    } catch (e) {}
  }

  send('pageview');

  setInterval(() => {
    if (document.visibilityState === 'visible') send('ping');
  }, PING_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send('ping');
  });

  window.supsAnalytics = {
    device,
    track(type, extra) { send(type, extra); }
  };
})();
