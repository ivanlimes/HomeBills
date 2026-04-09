(function () {
  const APP_STATE_KEY = 'family-monthly-bills.app-state';
  const EPSILON = 0.005;

  function readState() {
    try {
      const raw = window.localStorage.getItem(APP_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function writeState(nextState) {
    window.localStorage.setItem(APP_STATE_KEY, JSON.stringify(nextState));
  }

  function getBills(state) {
    const billsEntity = state && state.entities && state.entities.bills;
    if (!billsEntity || !Array.isArray(billsEntity.allIds)) return [];
    return billsEntity.allIds
      .map(function (id) { return billsEntity.byId && billsEntity.byId[id]; })
      .filter(Boolean)
      .filter(function (bill) { return bill.state === 'active'; });
  }

  function getPayments(state) {
    const paymentsEntity = state && state.entities && state.entities.payments;
    if (!paymentsEntity || !Array.isArray(paymentsEntity.allIds)) return [];
    return paymentsEntity.allIds
      .map(function (id) { return paymentsEntity.byId && paymentsEntity.byId[id]; })
      .filter(Boolean);
  }

  function parseIsoDate(isoDate) {
    const parts = String(isoDate || '').split('-').map(Number);
    return new Date(parts[0] || 1970, (parts[1] || 1) - 1, parts[2] || 1);
  }

  function startOfCurrentMonth(now) {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function isSameMonth(isoDate, monthDate) {
    const date = parseIsoDate(isoDate);
    return date.getFullYear() === monthDate.getFullYear() && date.getMonth() === monthDate.getMonth();
  }

  function formatTodayIso(now) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function getPaidAmountForCurrentMonth(payments, billId, monthDate) {
    return payments.reduce(function (sum, payment) {
      if (payment.billId !== billId || !isSameMonth(payment.paymentDate, monthDate)) return sum;
      return sum + Number(payment.amount || 0);
    }, 0);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function makeId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '_' + window.crypto.randomUUID();
    }
    return prefix + '_' + Math.random().toString(36).slice(2, 10);
  }

  function ensureStyles() {
    if (document.getElementById('bills-paid-toggle-styles')) return;
    const style = document.createElement('style');
    style.id = 'bills-paid-toggle-styles';
    style.textContent = [
      '.bills-paid-row{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:stretch;}',
      '.bills-paid-row + .bills-paid-row{margin-top:8px;}',
      '.bills-paid-row > .bills-table__row{width:100%;margin:0;}',
      '.bills-paid-toggle{min-width:78px;align-self:stretch;}',
      '.bills-paid-toggle .ui-button__label{font-weight:600;}',
      '.bills-paid-row[hidden]{display:none !important;}',
      '@media (max-width: 980px){.bills-paid-row{grid-template-columns:1fr;}.bills-paid-toggle{width:100%;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function findBillForRow(row, bills, usedIds) {
    const cells = row.querySelectorAll(':scope > .bills-table__cell');
    if (!cells.length) return null;
    const name = normalizeText(cells[0].querySelector('strong') ? cells[0].querySelector('strong').textContent : cells[0].textContent);
    const category = normalizeText(cells[1] ? cells[1].textContent : '');
    const nextDueDate = String(cells[5] ? cells[5].textContent.trim() : '');

    return bills.find(function (bill) {
      if (!bill || usedIds.has(bill.id)) return false;
      return normalizeText(bill.name) === name && normalizeText(bill.category) === category && String(bill.nextDueDate || '') === nextDueDate;
    }) || null;
  }

  function toggleBillPaid(billId, nextPaidState) {
    const state = readState();
    if (!state || !state.entities || !state.entities.bills || !state.entities.payments) return;

    const billsEntity = state.entities.bills;
    const paymentsEntity = state.entities.payments;
    const bill = billsEntity.byId && billsEntity.byId[billId];
    if (!bill) return;

    const now = new Date();
    const todayIso = formatTodayIso(now);
    const monthDate = startOfCurrentMonth(now);

    const remainingIds = [];
    for (const paymentId of paymentsEntity.allIds || []) {
      const payment = paymentsEntity.byId && paymentsEntity.byId[paymentId];
      if (!payment) continue;
      const sameBill = payment.billId === billId;
      const sameMonth = isSameMonth(payment.paymentDate, monthDate);
      if (sameBill && sameMonth) {
        delete paymentsEntity.byId[paymentId];
      } else {
        remainingIds.push(paymentId);
      }
    }
    paymentsEntity.allIds = remainingIds;

    if (nextPaidState) {
      const paymentId = makeId('payment');
      paymentsEntity.byId[paymentId] = {
        id: paymentId,
        billId: billId,
        amount: Number(bill.expectedAmount || 0),
        paymentDate: todayIso,
        paymentType: bill.autopayEnabled ? 'autopay' : 'manual',
        notes: 'Marked paid from bills tab.'
      };
      paymentsEntity.allIds = remainingIds.concat(paymentId);
    }

    if (state.ui && typeof state.ui === 'object') {
      state.ui.activeDestination = 'bills';
      state.ui.editing = { kind: 'none', selectedPaymentId: null };
      state.ui.selectedBillId = billId;
    }

    writeState(state);
    window.location.reload();
  }

  function updateToggleButton(toggle, bill, isPaid) {
    toggle.dataset.billId = bill.id;
    toggle.dataset.paid = isPaid ? 'true' : 'false';
    toggle.setAttribute('aria-pressed', isPaid ? 'true' : 'false');
    toggle.className = 'ui-button ' + (isPaid ? 'ui-button--primary' : 'ui-button--secondary') + ' bills-paid-toggle';
    toggle.innerHTML = '<span class="ui-button__label">Paid</span>';
    toggle.title = isPaid ? 'Mark this bill as not paid for the current month.' : 'Mark this bill as fully paid for the current month.';
    toggle.setAttribute('aria-label', isPaid ? ('Mark ' + bill.name + ' as unpaid for the current month') : ('Mark ' + bill.name + ' as paid for the current month'));
    toggle.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      toggleBillPaid(bill.id, !isPaid);
    };
  }

  function wrapBillsRow(body, row, bill, isPaid) {
    let wrapper = row.parentElement && row.parentElement.classList.contains('bills-paid-row') ? row.parentElement : null;
    let toggle = wrapper ? wrapper.querySelector('.bills-paid-toggle') : null;

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'bills-paid-row';
      wrapper.setAttribute('role', 'presentation');
      toggle = document.createElement('button');
      toggle.type = 'button';
      body.insertBefore(wrapper, row);
      wrapper.appendChild(toggle);
      wrapper.appendChild(row);
    }

    wrapper.dataset.billId = bill.id;
    row.dataset.billId = bill.id;
    wrapper.hidden = !!row.hidden;
    updateToggleButton(toggle, bill, isPaid);
  }

  function syncBillsPaidButtons() {
    const state = readState();
    if (!state || !state.ui || state.ui.activeDestination !== 'bills') return;
    const body = document.querySelector('.bills-table__body');
    if (!body) return;
    ensureStyles();

    const monthDate = startOfCurrentMonth(new Date());
    const bills = getBills(state);
    const payments = getPayments(state);
    const usedIds = new Set();
    const rows = Array.from(body.querySelectorAll(':scope > .bills-table__row--body, :scope > .bills-paid-row > .bills-table__row--body'));

    rows.forEach(function (row) {
      const bill = findBillForRow(row, bills, usedIds);
      if (!bill) return;
      usedIds.add(bill.id);
      const paidAmount = getPaidAmountForCurrentMonth(payments, bill.id, monthDate);
      const isPaid = Math.abs(Number(bill.expectedAmount || 0) - paidAmount) <= EPSILON || paidAmount > Number(bill.expectedAmount || 0) - EPSILON;
      wrapBillsRow(body, row, bill, isPaid);
    });
  }

  const observer = new MutationObserver(function () {
    syncBillsPaidButtons();
  });

  function start() {
    syncBillsPaidButtons();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-date-filter-hidden']
    });
    window.addEventListener('storage', syncBillsPaidButtons);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
