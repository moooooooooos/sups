/**
 * Проверка контактов покупателя: мобильный телефон РФ и email (формат + почтовый сервер домена).
 */
const dns = require('dns').promises;

// +7 9XX XXX-XX-XX. 8 и 7 в начале приводим к +7, остальное — ошибка
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) digits = digits.slice(1);
  if (digits.length !== 10 || digits[0] !== '9') return null;
  return `+7${digits}`;
}

function formatPhone(normalized) {
  const d = normalized.slice(2);
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/i;

const domainCache = new Map();

// Домен принимает почту, если у него есть MX-запись (или хотя бы A-запись — по RFC 5321)
async function domainAcceptsMail(domain) {
  const hit = domainCache.get(domain);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.ok;
  let ok = false;
  try {
    const mx = await dns.resolveMx(domain);
    ok = mx.some(r => r.exchange && r.exchange !== '.');
  } catch (e) {
    if (e.code === 'ENODATA') {
      try { ok = (await dns.resolve4(domain)).length > 0; } catch (e2) { ok = false; }
    } else if (e.code !== 'ENOTFOUND' && e.code !== 'ESERVFAIL') {
      ok = true; // сетевой сбой DNS не должен блокировать заказ
    }
  }
  domainCache.set(domain, { at: Date.now(), ok });
  if (domainCache.size > 5000) domainCache.delete(domainCache.keys().next().value);
  return ok;
}

// { ok, email } или { ok: false, error }
async function checkEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Укажите email — на него придёт чек и статус заказа' };
  if (email.length > 254 || !EMAIL_RE.test(email) || email.includes('..')) {
    return { ok: false, error: 'Проверьте email: похоже, в адресе опечатка' };
  }
  const domain = email.split('@')[1];
  if (!(await domainAcceptsMail(domain))) {
    return { ok: false, error: `Почтовый домен «${domain}» не существует или не принимает письма` };
  }
  return { ok: true, email };
}

module.exports = { normalizePhone, formatPhone, checkEmail };
