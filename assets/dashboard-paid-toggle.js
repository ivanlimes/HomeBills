(function () {
  const APP_STATE_KEY = 'family-monthly-bills.app-state';
  const EPSILON = 0.005;
  const TODAY = () => new Date();

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

  function startOfCurrentMonth(now) {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function parseIsoDate(isoDate) {
    const parts = String(isoDate || '').split('-').map(Number);
    return new Date(parts[0] || 1970, (parts[1] || 1) - 1, parts[2] || 1);
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

  function daysUntil(date, now) {
    const utcTarget = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor((utcTarget - utcNow) / (24 * 60 * 60 * 1000));
  }

  function getBillPaymentsForCurrentMonth(payments, billId, monthDate) {
    return payments.filter(function (payment) {
      return payment.billId === billId && isSameMonth(payment.paymentDate, monthDate);
    });
  }

  function getPaidAmountForCurrentMonth(payments, billId, monthDate) {
    return getBillPaymentsForCurrentMonth(payments, billId, monthDate).reduce(function (sum, payment) {
      return sum + Number(payment.amount || 0);
    }, 0);
  }

  function computeDashboardDueList(state) {
    const now = TODAY();
    const monthDate = startOfCurrentMonth(now);
    const bills = getBills(state);
    const payments = getPayments(state);
    return bills
      .map(function (bill) {
        const billDate = parseIsoDate(bill.nextDueDate);
        const actualAmount = getPaidAmountForCurrentMonth(payments, bill.id, monthDate);
        return {
          billId: bill.id,
          billName: bill.name,
          dueDate: bill.nextDueDate,
          daysUntilDue: daysUntil(billDate, now),
          expectedAmount: Number(bill.expectedAmount || 0),
          paidAmount: actualAmount,
          unpaidAmount: Math.max(Number(bill.expectedAmount || 0) - actualAmount, 0)
        };
      })
      .sort(function (a, b) {
        if (a.daysUntilDue === b.daysUntilDue) return a.billName.localeCompare(b.billName);
        return a.daysUntilDue - b.daysUntilDue;
      });
  }

  function makeId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '_' + window.crypto.randomUUID();
    }
    return prefix + '_' + Math.random().toString(36).slice(2, 10);
  }

  function toggleBillPaid(billId, nextPaidState) {
    const state = readState();
    if (!state || !state.entities || !state.entities.bills || !state.entities.payments) return;

    const billsEntity = state.entities.bills;
    const paymentsEntity = state.entities.payments;
    const bill = billsEntity.byId && billsEntity.byId[billId];
    if (!bill) return;

    const now = TODAY();
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
        notes: 'Marked paid from dashboard.'
      };
      paymentsEntity.allIds = remainingIds.concat(paymentId);
    }

    if (state.ui && typeof state.ui === 'object') {
      state.ui.activeDestination = 'dashboard';
      state.ui.editing = { kind: 'none', selectedPaymentId: null };
      state.ui.selectedBillId = billId;
    }

    writeState(state);
    window.location.reload();
  }

  function ensureStyles() {
    if (document.getElementById('dashboard-paid-toggle-styles')) return;
    const style = document.createElement('style');
    style.id = 'dashboard-paid-toggle-styles';
    style.textContent = [
      '.dashboard-paid-row{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:stretch;}',
      '.dashboard-paid-row + .dashboard-paid-row{margin-top:8px;}',
      '.dashboard-paid-row > .dashboard-list__row{width:100%;margin:0;}',
      '.dashboard-paid-toggle{min-width:78px;align-self:stretch;}',
      '.dashboard-paid-toggle .ui-button__label{font-weight:600;}',
      '.dashboard-paid-toggle[data-paid="true"]{box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);}'
    ].join('');
    document.head.appendChild(style);
  }

  function updateToggleButton(toggle, item) {
    const isPaid = item.unpaidAmount <= EPSILON;
    toggle.dataset.billId = item.billId;
    toggle.dataset.paid = isPaid ? 'true' : 'false';
    toggle.setAttribute('aria-pressed', isPaid ? 'true' : 'false');
    toggle.className = 'ui-button ' + (isPaid ? 'ui-button--primary' : 'ui-button--secondary') + ' dashboard-paid-toggle';
    toggle.innerHTML = '<span class="ui-button__label">Paid</span>';
    toggle.title = isPaid ? 'Mark this bill as not paid for the current month.' : 'Mark this bill as fully paid for the current month.';
    toggle.setAttribute('aria-label', isPaid ? ('Mark ' + item.billName + ' as unpaid for the current month') : ('Mark ' + item.billName + ' as paid for the current month'));
    toggle.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      toggleBillPaid(item.billId, !isPaid);
    };
  }

  function wrapDashboardRow(list, row, item) {
    let wrapper = row.parentElement && row.parentElement.classList.contains('dashboard-paid-row') ? row.parentElement : null;
    let toggle = wrapper ? wrapper.querySelector('.dashboard-paid-toggle') : null;

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'dashboard-paid-row';
      wrapper.setAttribute('role', 'listitem');
      toggle = document.createElement('button');
      toggle.type = 'button';
      list.insertBefore(wrapper, row);
      wrapper.appendChild(toggle);
      wrapper.appendChild(row);
    }

    wrapper.dataset.billId = item.billId;
    row.dataset.billId = item.billId;
    updateToggleButton(toggle, item);
  }

  function syncDashboardPaidButtons() {
    const state = readState();
    if (!state || !state.ui || state.ui.activeDestination !== 'dashboard') return;
    const list = document.querySelector('.dashboard-list[aria-label="Upcoming due bills"]');
    if (!list) return;
    ensureStyles();

    const dueList = computeDashboardDueList(state);
    const rows = Array.from(list.querySelectorAll(':scope > .dashboard-list__row, :scope > .dashboard-paid-row > .dashboard-list__row'));
    rows.forEach(function (row, index) {
      const item = dueList[index];
      if (!item) return;
      wrapDashboardRow(list, row, item);
    });
  }

  const observer = new MutationObserver(function () {
    syncDashboardPaidButtons();
  });

  function start() {
    syncDashboardPaidButtons();
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('storage', syncDashboardPaidButtons);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
