(function () {
  const APP_STATE_KEY = 'family-monthly-bills.app-state';
  const SCHEMA_KEY = 'family-monthly-bills.schema-version';
  const DISABLED_LABEL = 'Import/restore — later';
  const ACTIVE_LABEL = 'Import local data';
  const STATUS_CLASS = 'import-restore-status';
  const SUPPORTED_FILE_MESSAGE = 'Use a Family Monthly Bills export JSON file or an Excel .xlsx workbook.';
  let fileInput = null;
  let activeRow = null;

  const DEFAULT_STATE = {
    schemaVersion: 1,
    entities: { bills: { byId: {}, allIds: [] }, payments: { byId: {}, allIds: [] } },
    forecastSettings: { includeVariableEstimates: true, forecastHorizonMonths: 3 },
    preferences: {
      themeMode: 'system',
      accentPreference: 'dusty-plum',
      backgroundPreference: 'default',
      defaultSort: 'nextDueDate',
      defaultFilter: 'all',
      densityMode: 'comfortable'
    },
    ui: {
      activeDestination: 'dashboard',
      selectedBillId: null,
      editing: { kind: 'none', selectedPaymentId: null },
      billsWorkspace: { searchQuery: '', activeFilter: 'all', sortKey: 'nextDueDate' }
    }
  };

  const BILL_FREQUENCIES = new Set(['monthly', 'quarterly', 'semiannual', 'annual', 'custom']);
  const BILL_CLASSIFICATIONS = new Set(['fixed', 'variable']);
  const BILL_PRIORITIES = new Set(['essential', 'optional']);
  const BILL_STATES = new Set(['active', 'archived']);
  const PAYMENT_TYPES = new Set(['manual', 'autopay', 'refund', 'adjustment']);
  const THEME_MODES = new Set(['system', 'light', 'dark']);
  const DEFAULT_SORTS = new Set(['nextDueDate', 'name', 'expectedAmount', 'category']);
  const DEFAULT_FILTERS = new Set(['all', 'due-soon', 'subscriptions', 'annual', 'autopay']);
  const DENSITY_MODES = new Set(['comfortable', 'compact']);

  const BILL_HEADER_ALIASES = new Map([
    ['id', 'id'], ['billid', 'id'],
    ['name', 'name'], ['billname', 'name'], ['title', 'name'],
    ['category', 'category'], ['subcategory', 'subcategory'],
    ['expectedamount', 'expectedAmount'], ['expected', 'expectedAmount'], ['amount', 'expectedAmount'],
    ['currentcycleactualamount', 'currentCycleActualAmount'], ['actualamount', 'currentCycleActualAmount'], ['actual', 'currentCycleActualAmount'], ['paidamount', 'currentCycleActualAmount'],
    ['frequency', 'frequency'], ['cadence', 'frequency'], ['recurrence', 'frequency'],
    ['nextduedate', 'nextDueDate'], ['nextdue', 'nextDueDate'], ['duedate', 'nextDueDate'], ['due', 'nextDueDate'],
    ['duerule', 'dueRule'], ['rule', 'dueRule'],
    ['autopayenabled', 'autopayEnabled'], ['autopay', 'autopayEnabled'],
    ['classification', 'classification'], ['type', 'classification'], ['billtype', 'classification'],
    ['priority', 'priority'], ['essentialoptional', 'priority'],
    ['payerlabel', 'payerLabel'], ['payer', 'payerLabel'], ['responsibility', 'payerLabel'],
    ['renewalbehavior', 'renewalBehavior'], ['renewal', 'renewalBehavior'],
    ['notes', 'notes'], ['memo', 'notes'], ['comment', 'notes'],
    ['paymenturl', 'paymentUrl'], ['paymentlink', 'paymentUrl'], ['url', 'paymentUrl'], ['link', 'paymentUrl'],
    ['state', 'state'], ['status', 'state']
  ]);

  const PAYMENT_HEADER_ALIASES = new Map([
    ['id', 'id'], ['paymentid', 'id'],
    ['billid', 'billId'], ['bill', 'billId'],
    ['amount', 'amount'], ['paymentamount', 'amount'],
    ['paymentdate', 'paymentDate'], ['date', 'paymentDate'],
    ['paymenttype', 'paymentType'], ['type', 'paymentType'],
    ['notes', 'notes'], ['memo', 'notes'], ['comment', 'notes']
  ]);

  const SHEET_NAME_ALIASES = {
    bills: 'bills',
    bill: 'bills',
    recurringbills: 'bills',
    payments: 'payments',
    payment: 'payments',
    paymentrecords: 'payments',
    forecastsettings: 'forecastSettings',
    forecast: 'forecastSettings',
    settingsforecast: 'forecastSettings',
    preferences: 'preferences',
    preference: 'preferences',
    apppreferences: 'preferences'
  };

  function ensureFileInput() {
    if (fileInput) return fileInput;
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
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

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getCurrentState() {
    try {
      const raw = window.localStorage.getItem(APP_STATE_KEY);
      if (!raw) return deepClone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return deepClone(DEFAULT_STATE);
      return parsed;
    } catch (_error) {
      return deepClone(DEFAULT_STATE);
    }
  }

  function coerceEntityState(input) {
    if (input && typeof input === 'object' && input.byId && input.allIds) return input;
    if (Array.isArray(input)) return upsertEntityState(input.filter(Boolean));
    return null;
  }

  function coerceLegacyJsonShape(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const candidates = [payload, payload.appState, payload.state, payload.localData, payload.data, payload.snapshot, payload.exportedState].filter(function (item) {
      return item && typeof item === 'object';
    });
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (candidate.entities && candidate.entities.bills && candidate.entities.payments) return candidate;
      const billsSource = candidate.bills || candidate.Bills || (candidate.entities && candidate.entities.bills);
      const paymentsSource = candidate.payments || candidate.Payments || (candidate.entities && candidate.entities.payments);
      const bills = coerceEntityState(billsSource);
      const payments = coerceEntityState(paymentsSource);
      if (bills && payments) {
        return {
          schemaVersion: Number.isInteger(candidate.schemaVersion) ? candidate.schemaVersion : 1,
          entities: { bills: bills, payments: payments },
          forecastSettings: candidate.forecastSettings || candidate.ForecastSettings || payload.forecastSettings || payload.ForecastSettings || DEFAULT_STATE.forecastSettings,
          preferences: candidate.preferences || candidate.Preferences || payload.preferences || payload.Preferences || DEFAULT_STATE.preferences,
          ui: candidate.ui || payload.ui || DEFAULT_STATE.ui
        };
      }
    }
    return null;
  }

  function normalizeImportedState(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('The file is empty or is not valid JSON.');
    const normalizedPayload = coerceLegacyJsonShape(payload);
    if (!normalizedPayload || !normalizedPayload.entities || !normalizedPayload.entities.bills || !normalizedPayload.entities.payments) {
      throw new Error('This file does not match the Family Monthly Bills local data format.');
    }
    const schemaVersion = Number.isInteger(normalizedPayload.schemaVersion) ? normalizedPayload.schemaVersion : 1;
    const next = Object.assign({}, normalizedPayload, { schemaVersion: schemaVersion });
    if (!next.forecastSettings || typeof next.forecastSettings !== 'object') next.forecastSettings = deepClone(DEFAULT_STATE.forecastSettings);
    if (!next.preferences || typeof next.preferences !== 'object') next.preferences = deepClone(DEFAULT_STATE.preferences);
    if (!next.ui || typeof next.ui !== 'object') next.ui = {};
    next.ui.activeDestination = 'settings';
    next.ui.selectedBillId = null;
    next.ui.editing = { kind: 'none', selectedPaymentId: null };
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

  function normalizeToken(value) {
    return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  }

  function makeId(prefix, fallbackIndex) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '_' + window.crypto.randomUUID();
    }
    return prefix + '_' + Math.random().toString(36).slice(2, 10) + '_' + String(fallbackIndex || 0);
  }

  function readUint16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readUint32LE(bytes, offset) {
    return (bytes[offset]) + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + ((bytes[offset + 3] << 24) >>> 0);
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser cannot open Excel workbooks locally. Use Chrome or Edge for .xlsx import.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function unzipXlsx(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const decoder = new TextDecoder('utf-8');
    let eocdOffset = -1;
    const minOffset = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
      if (readUint32LE(bytes, i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) throw new Error('The selected Excel file could not be read.');

    const totalEntries = readUint16LE(bytes, eocdOffset + 10);
    const centralDirectoryOffset = readUint32LE(bytes, eocdOffset + 16);
    const entries = new Map();
    let pointer = centralDirectoryOffset;

    for (let entryIndex = 0; entryIndex < totalEntries; entryIndex += 1) {
      if (readUint32LE(bytes, pointer) !== 0x02014b50) {
        throw new Error('The Excel workbook is missing central directory data.');
      }
      const compressionMethod = readUint16LE(bytes, pointer + 10);
      const compressedSize = readUint32LE(bytes, pointer + 20);
      const fileNameLength = readUint16LE(bytes, pointer + 28);
      const extraLength = readUint16LE(bytes, pointer + 30);
      const commentLength = readUint16LE(bytes, pointer + 32);
      const localHeaderOffset = readUint32LE(bytes, pointer + 42);
      const fileNameBytes = bytes.slice(pointer + 46, pointer + 46 + fileNameLength);
      const fileName = decoder.decode(fileNameBytes);

      if (readUint32LE(bytes, localHeaderOffset) !== 0x04034b50) {
        throw new Error('The Excel workbook contains an invalid local file header.');
      }
      const localNameLength = readUint16LE(bytes, localHeaderOffset + 26);
      const localExtraLength = readUint16LE(bytes, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      const data = compressionMethod === 0 ? compressed : compressionMethod === 8 ? await inflateRaw(compressed) : null;
      if (!data) throw new Error('This Excel workbook uses an unsupported compression method.');
      entries.set(fileName, data);
      pointer += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
  }

  function getXmlDocument(entries, path) {
    const bytes = entries.get(path);
    if (!bytes) return null;
    const text = new TextDecoder('utf-8').decode(bytes);
    return new DOMParser().parseFromString(text, 'application/xml');
  }

  function getRelationshipMap(relsDoc, basePath) {
    const map = new Map();
    if (!relsDoc) return map;
    const rels = Array.from(relsDoc.getElementsByTagName('Relationship'));
    rels.forEach(function (rel) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (!id || !target) return;
      let normalizedTarget = target;
      if (normalizedTarget.indexOf('../') === 0) normalizedTarget = normalizedTarget.replace(/^\.\.\//, '');
      if (normalizedTarget.indexOf('/') === 0) normalizedTarget = normalizedTarget.slice(1);
      else normalizedTarget = basePath + normalizedTarget;
      map.set(id, normalizedTarget);
    });
    return map;
  }

  function getSharedStrings(entries) {
    const doc = getXmlDocument(entries, 'xl/sharedStrings.xml');
    if (!doc) return [];
    const items = Array.from(doc.getElementsByTagName('si'));
    return items.map(function (item) {
      return Array.from(item.getElementsByTagName('t')).map(function (node) { return node.textContent || ''; }).join('');
    });
  }

  function columnRefToIndex(ref) {
    const match = /^([A-Z]+)/i.exec(ref || '');
    if (!match) return -1;
    const letters = match[1].toUpperCase();
    let index = 0;
    for (let i = 0; i < letters.length; i += 1) index = index * 26 + (letters.charCodeAt(i) - 64);
    return index - 1;
  }

  function excelSerialToIsoDate(serial) {
    if (!Number.isFinite(serial)) return '';
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Math.round(serial * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  function readCellValue(cell, sharedStrings) {
    const type = cell.getAttribute('t') || '';
    if (type === 'inlineStr') {
      return Array.from(cell.getElementsByTagName('t')).map(function (node) { return node.textContent || ''; }).join('');
    }
    const valueNode = cell.getElementsByTagName('v')[0];
    const raw = valueNode ? (valueNode.textContent || '') : '';
    if (type === 's') {
      const index = Number(raw);
      return Number.isInteger(index) && sharedStrings[index] !== undefined ? sharedStrings[index] : '';
    }
    if (type === 'b') return raw === '1';
    if (type === 'str') return raw;
    if (raw === '') return '';
    const asNumber = Number(raw);
    return Number.isFinite(asNumber) ? asNumber : raw;
  }

  function readWorksheetRows(sheetDoc, sharedStrings) {
    return Array.from(sheetDoc.getElementsByTagName('row')).map(function (row) {
      const values = [];
      Array.from(row.getElementsByTagName('c')).forEach(function (cell) {
        const index = columnRefToIndex(cell.getAttribute('r') || '');
        if (index >= 0) values[index] = readCellValue(cell, sharedStrings);
      });
      return values;
    });
  }

  function getWorkbookSheets(entries) {
    const workbookDoc = getXmlDocument(entries, 'xl/workbook.xml');
    if (!workbookDoc) throw new Error('The Excel workbook is missing workbook.xml.');
    const relMap = getRelationshipMap(getXmlDocument(entries, 'xl/_rels/workbook.xml.rels'), 'xl/');
    const sharedStrings = getSharedStrings(entries);
    return Array.from(workbookDoc.getElementsByTagName('sheet')).map(function (sheetNode) {
      const name = sheetNode.getAttribute('name') || '';
      const relId = sheetNode.getAttribute('r:id') || sheetNode.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || '';
      const path = relMap.get(relId);
      if (!path) return null;
      const sheetDoc = getXmlDocument(entries, path);
      if (!sheetDoc) return null;
      return { name: name, rows: readWorksheetRows(sheetDoc, sharedStrings) };
    }).filter(Boolean);
  }

  function firstNonEmptyRow(rows) {
    return rows.find(function (row) {
      return row.some(function (cell) { return cell !== undefined && cell !== null && String(cell).trim() !== ''; });
    }) || [];
  }

  function toStringValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value).trim();
  }

  function toOptionalString(value) {
    const next = toStringValue(value);
    return next.length > 0 ? next : undefined;
  }

  function toBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const token = normalizeToken(value);
    if (token === 'true' || token === 'yes' || token === 'y' || token === '1') return true;
    if (token === 'false' || token === 'no' || token === 'n' || token === '0') return false;
    return fallback;
  }

  function toNumber(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = toStringValue(value).replace(/[$,]/g, '');
    if (!raw) return fallback;
    const next = Number(raw);
    return Number.isFinite(next) ? next : fallback;
  }

  function toDateString(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return excelSerialToIsoDate(value);
    const raw = toStringValue(value);
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }

  function buildHeaderMap(headerRow, aliases) {
    const map = new Map();
    headerRow.forEach(function (headerValue, index) {
      const key = aliases.get(normalizeToken(headerValue));
      if (key) map.set(index, key);
    });
    return map;
  }

  function readNamedSheets(workbookSheets) {
    const result = {};
    workbookSheets.forEach(function (sheet) {
      const kind = SHEET_NAME_ALIASES[normalizeToken(sheet.name)];
      if (kind && !result[kind]) result[kind] = sheet;
    });
    return result;
  }

  function parseBillsSheet(sheet) {
    if (!sheet) return null;
    const headerRow = firstNonEmptyRow(sheet.rows);
    const headerMap = buildHeaderMap(headerRow, BILL_HEADER_ALIASES);
    if (!headerMap.size) throw new Error('The Bills sheet is missing recognizable bill columns.');
    const headerIndex = sheet.rows.indexOf(headerRow);
    const bills = [];
    for (let i = headerIndex + 1; i < sheet.rows.length; i += 1) {
      const row = sheet.rows[i];
      const cells = {};
      headerMap.forEach(function (key, columnIndex) { cells[key] = row[columnIndex]; });
      const name = toStringValue(cells.name);
      const category = toStringValue(cells.category);
      if (!name && !category) continue;
      if (!name) throw new Error('Bills sheet row ' + (i + 1) + ': Bill name is required.');
      if (!category) throw new Error('Bills sheet row ' + (i + 1) + ': Category is required.');
      const expectedAmount = toNumber(cells.expectedAmount, NaN);
      if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) throw new Error('Bills sheet row ' + (i + 1) + ': Expected Amount must be greater than 0.');
      const nextDueDate = toDateString(cells.nextDueDate);
      if (!nextDueDate) throw new Error('Bills sheet row ' + (i + 1) + ': Next Due Date is required and must be a valid date.');
      const frequency = normalizeToken(cells.frequency) || 'monthly';
      const classification = normalizeToken(cells.classification) || 'fixed';
      const priority = normalizeToken(cells.priority) || 'essential';
      const state = normalizeToken(cells.state) || 'active';
      const actual = toNumber(cells.currentCycleActualAmount, NaN);
      bills.push({
        id: toStringValue(cells.id) || makeId('bill', i + 1),
        name: name,
        category: category,
        subcategory: toOptionalString(cells.subcategory),
        expectedAmount: expectedAmount,
        currentCycleActualAmount: Number.isFinite(actual) ? actual : undefined,
        frequency: BILL_FREQUENCIES.has(frequency) ? frequency : 'monthly',
        nextDueDate: nextDueDate,
        dueRule: toOptionalString(cells.dueRule),
        autopayEnabled: toBoolean(cells.autopayEnabled, false),
        classification: BILL_CLASSIFICATIONS.has(classification) ? classification : 'fixed',
        priority: BILL_PRIORITIES.has(priority) ? priority : 'essential',
        payerLabel: toOptionalString(cells.payerLabel),
        renewalBehavior: toOptionalString(cells.renewalBehavior),
        notes: toOptionalString(cells.notes),
        paymentUrl: toOptionalString(cells.paymentUrl),
        state: BILL_STATES.has(state) ? state : 'active'
      });
    }
    return bills;
  }

  function parsePaymentsSheet(sheet, validBillIds) {
    if (!sheet) return null;
    const headerRow = firstNonEmptyRow(sheet.rows);
    const headerMap = buildHeaderMap(headerRow, PAYMENT_HEADER_ALIASES);
    if (!headerMap.size) return [];
    const headerIndex = sheet.rows.indexOf(headerRow);
    const payments = [];
    for (let i = headerIndex + 1; i < sheet.rows.length; i += 1) {
      const row = sheet.rows[i];
      const cells = {};
      headerMap.forEach(function (key, columnIndex) { cells[key] = row[columnIndex]; });
      const billId = toStringValue(cells.billId);
      const amount = toNumber(cells.amount, NaN);
      const paymentDate = toDateString(cells.paymentDate);
      if (!billId && !amount && !paymentDate) continue;
      if (!billId) throw new Error('Payments sheet row ' + (i + 1) + ': Bill ID is required.');
      if (!validBillIds.has(billId)) throw new Error('Payments sheet row ' + (i + 1) + ': Bill ID "' + billId + '" does not exist in the imported bill set.');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payments sheet row ' + (i + 1) + ': Amount must be greater than 0.');
      if (!paymentDate) throw new Error('Payments sheet row ' + (i + 1) + ': Payment Date is required and must be a valid date.');
      const paymentType = normalizeToken(cells.paymentType) || 'manual';
      payments.push({
        id: toStringValue(cells.id) || makeId('payment', i + 1),
        billId: billId,
        amount: amount,
        paymentDate: paymentDate,
        paymentType: PAYMENT_TYPES.has(paymentType) ? paymentType : 'manual',
        notes: toOptionalString(cells.notes)
      });
    }
    return payments;
  }

  function parseKeyValueSheet(sheet) {
    if (!sheet) return null;
    const rows = sheet.rows.filter(function (row) {
      return row.some(function (cell) { return cell !== undefined && cell !== null && String(cell).trim() !== ''; });
    });
    if (!rows.length) return {};
    let startIndex = 0;
    if (normalizeToken(rows[0][0]) === 'key' && normalizeToken(rows[0][1]) === 'value') startIndex = 1;
    const map = {};
    for (let i = startIndex; i < rows.length; i += 1) {
      const key = toStringValue(rows[i][0]);
      if (!key) continue;
      map[key] = rows[i][1];
    }
    return map;
  }

  function upsertEntityState(items) {
    const byId = {};
    const allIds = [];
    items.forEach(function (item) {
      if (!item || !item.id) return;
      byId[item.id] = item;
      if (allIds.indexOf(item.id) === -1) allIds.push(item.id);
    });
    return { byId: byId, allIds: allIds };
  }

  function normalizeForecastSettings(raw, fallback) {
    const next = Object.assign({}, fallback || DEFAULT_STATE.forecastSettings);
    if (!raw) return next;
    if (raw.monthlyIncomeAssumption !== undefined) {
      const monthlyIncome = toNumber(raw.monthlyIncomeAssumption, NaN);
      if (Number.isFinite(monthlyIncome)) next.monthlyIncomeAssumption = monthlyIncome;
    }
    if (raw.payScheduleAssumption !== undefined) {
      const payScheduleAssumption = toOptionalString(raw.payScheduleAssumption);
      if (payScheduleAssumption) next.payScheduleAssumption = payScheduleAssumption;
    }
    if (raw.includeVariableEstimates !== undefined) next.includeVariableEstimates = toBoolean(raw.includeVariableEstimates, next.includeVariableEstimates);
    if (raw.forecastHorizonMonths !== undefined) next.forecastHorizonMonths = Math.max(1, Math.min(12, Math.round(toNumber(raw.forecastHorizonMonths, next.forecastHorizonMonths || 3))));
    if (raw.scenarioAssumptions !== undefined) {
      const scenarioAssumptions = toOptionalString(raw.scenarioAssumptions);
      if (scenarioAssumptions) next.scenarioAssumptions = scenarioAssumptions;
    }
    return next;
  }

  function normalizePreferences(raw, fallback) {
    const next = Object.assign({}, fallback || DEFAULT_STATE.preferences);
    if (!raw) return next;
    const themeMode = normalizeToken(raw.themeMode);
    if (THEME_MODES.has(themeMode)) next.themeMode = themeMode;
    const accentPreference = toOptionalString(raw.accentPreference);
    if (accentPreference) next.accentPreference = accentPreference;
    const backgroundPreference = toOptionalString(raw.backgroundPreference);
    if (backgroundPreference) next.backgroundPreference = backgroundPreference;
    const defaultSort = toOptionalString(raw.defaultSort);
    if (defaultSort && DEFAULT_SORTS.has(defaultSort)) next.defaultSort = defaultSort;
    const defaultFilter = toOptionalString(raw.defaultFilter);
    if (defaultFilter && DEFAULT_FILTERS.has(defaultFilter)) next.defaultFilter = defaultFilter;
    const densityMode = toOptionalString(raw.densityMode);
    if (densityMode && DENSITY_MODES.has(densityMode)) next.densityMode = densityMode;
    const reminderDefaults = toOptionalString(raw.reminderDefaults);
    if (reminderDefaults) next.reminderDefaults = reminderDefaults;
    return next;
  }

  async function workbookToState(file) {
    const baseState = normalizeImportedState(getCurrentState());
    const entries = await unzipXlsx(await file.arrayBuffer());
    const workbookSheets = getWorkbookSheets(entries);
    const namedSheets = readNamedSheets(workbookSheets);
    if (!namedSheets.bills && !namedSheets.payments && !namedSheets.forecastSettings && !namedSheets.preferences) {
      throw new Error('The Excel workbook does not contain recognizable Bills, Payments, ForecastSettings, or Preferences sheets.');
    }
    const importedBills = parseBillsSheet(namedSheets.bills);
    const finalBills = importedBills !== null ? importedBills : baseState.entities.bills.allIds.map(function (id) { return baseState.entities.bills.byId[id]; });
    const billIdSet = new Set(finalBills.map(function (bill) { return bill.id; }));
    const importedPayments = parsePaymentsSheet(namedSheets.payments, billIdSet);
    const fallbackPayments = baseState.entities.payments.allIds.map(function (id) { return baseState.entities.payments.byId[id]; }).filter(function (payment) { return billIdSet.has(payment.billId); });
    const finalPayments = importedPayments !== null ? importedPayments : fallbackPayments;
    const nextState = normalizeImportedState({
      schemaVersion: baseState.schemaVersion || 1,
      entities: { bills: upsertEntityState(finalBills), payments: upsertEntityState(finalPayments) },
      forecastSettings: normalizeForecastSettings(parseKeyValueSheet(namedSheets.forecastSettings), baseState.forecastSettings),
      preferences: normalizePreferences(parseKeyValueSheet(namedSheets.preferences), baseState.preferences),
      ui: baseState.ui
    });
    return {
      nextState: nextState,
      summary: {
        billCount: finalBills.length,
        paymentCount: finalPayments.length,
        importedBills: importedBills !== null,
        importedPayments: importedPayments !== null,
        importedForecastSettings: !!namedSheets.forecastSettings,
        importedPreferences: !!namedSheets.preferences
      }
    };
  }

  async function importSelectedFile(file) {
    const lowerName = (file.name || '').toLowerCase();
    if (lowerName.endsWith('.json') || file.type === 'application/json') {
      const parsed = JSON.parse(String(await file.text() || ''));
      return { nextState: normalizeImportedState(parsed), statusMessage: 'Local JSON data imported. Reloading with the restored snapshot…' };
    }
    if (lowerName.endsWith('.xlsx')) {
      const result = await workbookToState(file);
      const parts = [];
      if (result.summary.importedBills) parts.push(result.summary.billCount + ' bills');
      if (result.summary.importedPayments) parts.push(result.summary.paymentCount + ' payments');
      if (result.summary.importedForecastSettings) parts.push('forecast settings');
      if (result.summary.importedPreferences) parts.push('preferences');
      return { nextState: result.nextState, statusMessage: 'Excel workbook imported (' + parts.join(', ') + '). Reloading with the restored data…' };
    }
    throw new Error(SUPPORTED_FILE_MESSAGE);
  }

  async function onFileSelected(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    const row = activeRow;
    clearStatus(row);
    try {
      const imported = await importSelectedFile(file);
      persistImportedState(imported.nextState);
      setStatus(row, imported.statusMessage, 'success');
      window.setTimeout(function () { window.location.reload(); }, 220);
    } catch (error) {
      setStatus(row, error && error.message ? error.message : SUPPORTED_FILE_MESSAGE, 'warning');
    } finally {
      input.value = '';
    }
  }

  function activateImportButton(row) {
    if (!row) return;
    const buttons = Array.from(row.querySelectorAll('button'));
    const disabledButton = buttons.find(function (button) { return (button.textContent || '').trim() === DISABLED_LABEL; });
    if (!disabledButton || disabledButton.dataset.importReady === 'true') return;
    const templateButton = buttons.find(function (button) { return (button.textContent || '').trim() === 'Reset local data'; }) || buttons[0];
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
    Array.from(document.querySelectorAll('.screen-inline-actions')).forEach(function (row) {
      if ((row.textContent || '').indexOf(DISABLED_LABEL) !== -1) activateImportButton(row);
    });
  }

  function boot() {
    ensureFileInput();
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
