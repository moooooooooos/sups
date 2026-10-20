/**
 * Статусы заказа: единый список для админки, личного кабинета и синхронизации с перевозчиком.
 * Порядок важен: автоматическая синхронизация никогда не откатывает заказ назад по шагам.
 */
const STATUSES = {
  new: { label: 'Ожидает оплаты', step: 0 },
  paid: { label: 'Оплачен, в обработке', step: 1 },
  processing: { label: 'Собираем заказ', step: 2 },
  shipped: { label: 'Передан в доставку', step: 3 },
  ready_for_pickup: { label: 'Ждёт в пункте выдачи', step: 4 },
  delivered: { label: 'Получен', step: 5 },
  completed: { label: 'Получен', step: 5 },      // старый статус «Выполнен»
  returned: { label: 'Возврат', step: 6, final: true },
  cancelled: { label: 'Отменён', step: 6, final: true }
};

function isValid(status) {
  return Object.prototype.hasOwnProperty.call(STATUSES, status);
}

function label(status) {
  return (STATUSES[status] || {}).label || status;
}

// Можно ли автоматически перевести заказ из current в next (только вперёд, финальные не трогаем)
function canAdvance(current, next) {
  const a = STATUSES[current];
  const b = STATUSES[next];
  if (!b || current === next) return false;
  if (!a) return true;
  if (a.final || current === 'delivered' || current === 'completed') return false;
  return b.step > a.step || b.final;
}

module.exports = { STATUSES, isValid, label, canAdvance };
