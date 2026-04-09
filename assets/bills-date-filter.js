(function () {
  const STORAGE_KEY = 'family-monthly-bills.bills-date-filter';

  function readSavedFilter() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { start: '', end: '' };
      const parsed = JSON.parse(raw);
      return {
        start: typeof parsed.start === 'string' ? parsed.start : '',
        end: typeof parsed.end === 'string' ? parsed.end : ''
      };
    } catch (_error) {
      return { start: '', end: '' };
    }
  }

  function writeSavedFilter(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (_error) {
      // Ignore localStorage write failures.
    }
  }

  function ensureStyles() {
    if (document.getElementById('bills-date-filter-styles')) return;
    const style = document.createElement('style');
    style.id = 'bills-date-filter-styles';
    style.textContent = [
      '.bills-date-filter{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:end;}',
      '.bills-date-filter__field{display:flex;flex-direction:column;gap:6px;min-width:0;}',
      '.bills-date-filter__label{font-size:12px;font-weight:600;opacity:.82;}',
      '.bills-date-filter__actions{display:flex;align-items:end;}',
      '.bills-date-filter__clear{width:100%;}',
      '.bills-date-filter-empty{margin-top:12px;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.08);display:none;}',
      '.bills-date-filter-empty[data-visible="true"]{display:block;}',
      '.bills-table__row--body[data-date-filter-hidden="true"]{display:none;}',
      '@media (max-width: 980px){.bills-date-filter{grid-template-columns:1fr;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function parseDate(value) {
    if (!value || typeof value !== 'string') return null;
    const parts = value.split('-').map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function normalizeDate(value) {
    const date = parseDate(value);
    return date ? value : '';
  }

  function getCurrentFilter() {
    const filterNode = document.querySelector('.bills-date-filter');
    if (!filterNode) return { start: '', end: '' };
    return {
      start: normalizeDate(filterNode.querySelector('[data-bills-date-start]')?.value || ''),
      end: normalizeDate(filterNode.querySelector('[data-bills-date-end]')?.value || '')
    };
  }

  function getRowDueDate(row) {
    const cell = row.querySelector(':scope > .bills-table__cell:nth-child(6)');
    return normalizeDate(cell ? cell.textContent.trim() : '');
  }

  function matchesRange(dateValue, range) {
    if (!dateValue) return false;
    if (!range.start && !range.end) return true;
    if (range.start && dateValue < range.start) return false;
    if (range.end && dateValue > range.end) return false;
    return true;
  }

  function ensureEmptyState(shell) {
    let note = shell.parentElement.querySelector('.bills-date-filter-empty');
    if (!note) {
      note = document.createElement('div');
      note.className = 'bills-date-filter-empty';
      note.innerHTML = '<strong>No bills match the selected due-date range.</strong><div>Adjust or clear the date filter. Your existing search and saved filters are still active.</div>';
      shell.insertAdjacentElement('afterend', note);
    }
    return note;
  }

  function updateSummaryCard(visibleCount, totalRows, filterActive) {
    const card = document.querySelector('.bills-summary-card');
    if (!card) return;
    const value = card.querySelector('.bills-summary-card__value');
    const meta = card.querySelector('.bills-summary-card__meta');
    if (value) value.textContent = String(visibleCount);
    if (meta) {
      meta.textContent = filterActive
        ? visibleCount + ' shown after due-date filter · ' + totalRows + ' current matches'
        : totalRows + ' total in current workspace view';
    }
  }

  function applyDateFilter() {
    const shell = document.querySelector('.bills-table-shell');
    if (!shell) return;
    const rows = Array.from(shell.querySelectorAll('.bills-table__row--body'));
    const range = getCurrentFilter();
    const filterActive = Boolean(range.start || range.end);
    let visibleCount = 0;

    rows.forEach(function (row) {
      const dueDate = getRowDueDate(row);
      const visible = matchesRange(dueDate, range);
      row.dataset.dateFilterHidden = visible ? 'false' : 'true';
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const emptyState = ensureEmptyState(shell);
    emptyState.dataset.visible = filterActive && visibleCount === 0 ? 'true' : 'false';
    updateSummaryCard(visibleCount, rows.length, filterActive);
    writeSavedFilter(range);
  }

  function ensureControls() {
    const controls = document.querySelector('.bills-controls');
    if (!controls) return;
    if (controls.querySelector('.bills-date-filter')) return;

    const saved = readSavedFilter();
    const wrapper = document.createElement('div');
    wrapper.className = 'bills-date-filter';
    wrapper.innerHTML = [
      '<label class="bills-date-filter__field">',
      '  <span class="bills-date-filter__label">Due date from</span>',
      '  <input class="editor-input" type="date" data-bills-date-start />',
      '</label>',
      '<label class="bills-date-filter__field">',
      '  <span class="bills-date-filter__label">Due date to</span>',
      '  <input class="editor-input" type="date" data-bills-date-end />',
      '</label>',
      '<div class="bills-date-filter__actions">',
      '  <button type="button" class="ui-button ui-button--secondary bills-date-filter__clear">',
      '    <span class="ui-button__label">Clear dates</span>',
      '  </button>',
      '</div>'
    ].join('');

    controls.appendChild(wrapper);

    const startInput = wrapper.querySelector('[data-bills-date-start]');
    const endInput = wrapper.querySelector('[data-bills-date-end]');
    const clearButton = wrapper.querySelector('.bills-date-filter__clear');

    startInput.value = saved.start;
    endInput.value = saved.end;

    startInput.addEventListener('input', applyDateFilter);
    endInput.addEventListener('input', applyDateFilter);
    clearButton.addEventListener('click', function () {
      startInput.value = '';
      endInput.value = '';
      applyDateFilter();
    });
  }

  function syncBillsDateFilter() {
    const activeTitle = document.querySelector('.shell-top-bar__title');
    if (!activeTitle || !/Bills/.test(activeTitle.textContent || '')) return;
    ensureStyles();
    ensureControls();
    applyDateFilter();
  }

  const observer = new MutationObserver(function () {
    syncBillsDateFilter();
  });

  function start() {
    syncBillsDateFilter();
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('storage', syncBillsDateFilter);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
