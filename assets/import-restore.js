(function () {
  const APP_STATE_KEY = 'family-monthly-bills.app-state';
  const SCHEMA_KEY = 'family-monthly-bills.schema-version';
  const DISABLED_LABEL = 'Import/restore — later';
  const ACTIVE_LABEL = 'Import local data';
  const STATUS_CLASS = 'import-restore-status';
  let fileInput = null;
  let activeRow = null;

  function ensureFileInput() {
    if (fileInput) return fileInput;
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', onFileSelected);
    document.body.appendChild(fileInput);
    return fileInput;
  }

  function setStatus(row, message, tone) {
    if (!row) return;
    let node = row.parentElement && row.parentElement.querySelector('.' + STATUS_CLASS);
    if (!node) {
      node = document.createElement('p');
      node.className = 'settings-help-text ' + STATUS_CLASS;
      row.parentElement.appendChild(node);
    }
    node.textContent = message;
    node.dataset.tone = tone || 'neutral';
  }

  function clearStatus(row) {
    if (!row || !row.parentElement) return;
    const node = row.parentElement.querySelector('.' + STATUS_CLASS);
    if (node) node.remove();
  }

  function normalizeImportedState(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('The file is empty or is not valid JSON.');
    if (!payload.entities || !payload.entities.bills || !payload.entities.payments) {
      throw new Error('This file does not match the Family Monthly Bills local data format.');
    }
    const schemaVersion = Number.isInteger(payload.schemaVersion) ? payload.schemaVersion : 1;
    const next = Object.assign({}, payload, { schemaVersion: schemaVersion });
    if (!next.ui || typeof next.ui !== 'object') next.ui = {};
    next.ui.activeDestination = 'settings';
    if (!next.ui.editing || typeof next.ui.editing !== 'object') {
      next.ui.editing = { kind: 'none', selectedPaymentId: null };
    }
    if (!next.ui.billsWorkspace || typeof next.ui.billsWorkspace !== 'object') {
      next.ui.billsWorkspace = { searchQuery: '', activeFilter: 'all', sortKey: 'nextDueDate' };
    }
    return next;
  }

  function persistImportedState(nextState) {
    const storage = window.localStorage;
    storage.setItem(APP_STATE_KEY, JSON.stringify(nextState));
    storage.setItem(SCHEMA_KEY, String(nextState.schemaVersion || 1));
  }

  function onFileSelected(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    const row = activeRow;
    clearStatus(row);
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const nextState = normalizeImportedState(parsed);
        persistImportedState(nextState);
        setStatus(row, 'Local data imported. Reloading with the restored snapshot…', 'success');
        window.setTimeout(function () {
          window.location.reload();
        }, 180);
      } catch (error) {
        const message = error && error.message ? error.message : 'Import failed. Use a Family Monthly Bills export JSON file.';
        setStatus(row, message, 'warning');
      } finally {
        input.value = '';
      }
    };
    reader.onerror = function () {
      setStatus(row, 'The selected file could not be read.', 'warning');
      input.value = '';
    };
    reader.readAsText(file);
  }

  function activateImportButton(row) {
    if (!row) return;
    const buttons = Array.from(row.querySelectorAll('button'));
    const disabledButton = buttons.find(function (button) {
      return (button.textContent || '').trim() === DISABLED_LABEL;
    });
    if (!disabledButton || disabledButton.dataset.importReady === 'true') return;

    const templateButton = buttons.find(function (button) {
      return (button.textContent || '').trim() === 'Reset local data';
    }) || buttons[0];

    const importButton = templateButton.cloneNode(true);
    importButton.textContent = ACTIVE_LABEL;
    importButton.disabled = false;
    importButton.removeAttribute('disabled');
    importButton.removeAttribute('aria-disabled');
    importButton.dataset.importReady = 'true';
    importButton.addEventListener('click', function () {
      activeRow = row;
      clearStatus(row);
      ensureFileInput().click();
    });

    disabledButton.replaceWith(importButton);
  }

  function scan() {
    const rows = Array.from(document.querySelectorAll('.screen-inline-actions'));
    rows.forEach(function (row) {
      if ((row.textContent || '').indexOf(DISABLED_LABEL) !== -1) {
        activateImportButton(row);
      }
    });
  }

  function boot() {
    ensureFileInput();
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
