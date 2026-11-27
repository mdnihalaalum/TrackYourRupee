/**
 * ============================================================================
 * TRACKYOURRUPEE v4 — SYSTEM ARCHITECTURE & HARDENED CLIENT ENGINE
 * ============================================================================
 * Implements:
 * - Feature 1: Installable Offline PWA (Service Worker + Manifest)
 * - Feature 3: Full JSON Snapshot Backup, Validation & Merge Restore + Rollback
 * - Feature 4: Per-Category Monthly Spending Caps with Threshold Coloring
 * - Feature 5: Inline/Modal Transaction Editor
 * - Feature 6: Month-over-Month Spending & Top Category Shift Analytics
 * - Engineering Guardrails: Single-pass O(N) metrics index, memoized cache,
 *   global error boundary, rate-limited writes/sync, and automated self-tests.
 */
'use strict';

/* ============================================================================
   1. CONFIGURATION & DECLARATIVE DOMAIN CONSTANTS
   ============================================================================ */
const AppConfig = Object.freeze({
  SCHEMA_VERSION: 4,
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.file',
  DRIVE_FILE_NAME: 'expense.json',
  FUN_EDITION_URL: 'https://trackyourrupeef.vercel.app',
  MAX_AMOUNT: 100000000,
  MAX_TOMBSTONES: 300,
  MAX_IMPORT_BYTES: 2 * 1024 * 1024, // 2 MB DoS protection cap
  ISO_DATE_RE: /^\d{4}-\d{2}-\d{2}$/,
  ISO_MONTH_RE: /^\d{4}-\d{2}$/,
  DRIVE_TEST_MODE_GUARD: true,
  DEFAULT_CLIENT_ID: '381251059137-hkv6bjlmcjg0i32qqblt0h0dubemdgap.apps.googleusercontent.com'
});

const CATEGORIES = Object.freeze([
  { value: 'Food', label: 'Food', cls: 'cat-food' },
  { value: 'Travel', label: 'Travel', cls: 'cat-travel' },
  { value: 'Room/Hostel', label: 'Room / Hostel', cls: 'cat-room' },
  { value: 'Study', label: 'Study', cls: 'cat-study' },
  { value: 'Shopping', label: 'Shopping', cls: 'cat-shopping' },
  { value: 'Other', label: 'Other', cls: 'cat-other' }
]);

const VALID_CATEGORIES = new Set(CATEGORIES.map((c) => c.value));
const VALID_MODES = new Set(['Cash', 'UPI Lite', 'Bank Account', 'UPI Bank']);
const CATEGORY_CLASS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.cls]));

const MODE_META = Object.freeze({
  Cash: { cls: 'badge-cash', label: 'Cash' },
  'UPI Lite': { cls: 'badge-lite', label: 'UPI • Lite' },
  'Bank Account': { cls: 'badge-bank', label: 'UPI • Bank' },
  'UPI Bank': { cls: 'badge-bank', label: 'UPI • Bank' }
});

/* Geometric SVG Icons (Zero Emojis) */
const SVG_SHAPES = Object.freeze({
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  gridCaps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/>',
  volumeOn: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  volumeOff: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  spark: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.8" fill="currentColor" stroke="none"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrowUp: '<polyline points="18 15 12 9 6 15"/>',
  arrowDown: '<polyline points="6 9 12 15 18 9"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>'
});

function renderSvg(name, cls = 'ui-svg') {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${SVG_SHAPES[name] || ''}</svg>`;
}

/* ============================================================================
   2. GLOBAL ERROR BOUNDARY, DIAGNOSTICS & RATE LIMITER (Rules 8, 14, 15)
   ============================================================================ */
const Diagnostics = {
  lastError: 'None',
  lastSavedAt: null,
  swStatus: 'Checking...',
  selfTestStatus: 'Pending',

  recordError(context, err) {
    const msg = err && err.message ? err.message : String(err);
    this.lastError = `${context}: ${msg}`.slice(0, 120);
    console.error(`[TrackYourRupee:${context}]`, err);
  },

  getStorageSummary() {
    try {
      const raw = localStorage.getItem(StorageService.STORAGE_KEY) || '';
      const kb = (new Blob([raw]).size / 1024).toFixed(1);
      return `${kb} KB used (${appData.expenses.length} entries)`;
    } catch {
      return 'Unavailable';
    }
  }
};

window.addEventListener('error', (event) => {
  Diagnostics.recordError('Runtime', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  Diagnostics.recordError('Async', event.reason);
});

function createRateLimiter(minIntervalMs) {
  let lastRun = 0;
  return function allow() {
    const now = Date.now();
    if (now - lastRun < minIntervalMs) return false;
    lastRun = now;
    return true;
  };
}

const canSubmitExpense = createRateLimiter(350);
const canTriggerSync = createRateLimiter(2000);

/* ============================================================================
   3. SOUND SERVICE (Local .mp3 Clips in /sounds/ — Never Ducks Music)
   ============================================================================ */
const SoundService = {
  SOUND_KEY: 'expenseflow_sound_enabled',
  FILES: {
    added: 'sounds/added.mp3',
    deducted: 'sounds/deducted.mp3',
    orange: 'sounds/orange.mp3',
    red: 'sounds/red.mp3'
  },
  cache: {},

  isEnabled() {
    try {
      return localStorage.getItem(this.SOUND_KEY) !== 'false';
    } catch {
      return true;
    }
  },

  setEnabled(enabled) {
    safeSetItem(this.SOUND_KEY, enabled ? 'true' : 'false');
    updateSoundToggleUI();
  },

  toggle() {
    const next = !this.isEnabled();
    this.setEnabled(next);
    if (next) this.play('added');
    return next;
  },

  preload() {
    Object.entries(this.FILES).forEach(([key, src]) => {
      try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.volume = 0.55;
        this.cache[key] = audio;
      } catch {
        /* ignore if audio file missing */
      }
    });
  },

  play(cue) {
    if (!this.isEnabled()) return;
    const src = this.FILES[cue];
    if (!src) return;
    try {
      const base = this.cache[cue] || new Audio(src);
      const player = base.cloneNode(true);
      player.volume = 0.55;
      player.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }
};

/* ============================================================================
   4. SAFE STORAGE, SCHEMA v4, SNAPSHOT BACKUP & ROLLBACK (Rules 11, 16)
   ============================================================================ */
let storageWarningShown = false;

function safeGetItem(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    Diagnostics.recordError('StorageWrite', err);
    if (!storageWarningShown) {
      storageWarningShown = true;
      showAppToast('Storage full or blocked. Export JSON backup now.', null, 6500);
    }
    return false;
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function normalizeId(rawId) {
  const num = Math.floor(Number(rawId));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function generateNumericId() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return Date.now() * 1000 + (arr[0] % 1000);
  }
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function recordTombstone(id) {
  const norm = normalizeId(id);
  if (!norm) return;
  if (!appData.deletedIds.includes(norm)) {
    appData.deletedIds.push(norm);
    if (appData.deletedIds.length > AppConfig.MAX_TOMBSTONES) {
      appData.deletedIds = appData.deletedIds.slice(-AppConfig.MAX_TOMBSTONES);
    }
  }
}

function isValidAmount(val) {
  return typeof val === 'number' && Number.isFinite(val) && val > 0 && val <= AppConfig.MAX_AMOUNT;
}

function isValidBudgetAmount(val) {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= AppConfig.MAX_AMOUNT;
}

function isValidIsoDate(str) {
  if (typeof str !== 'string' || !AppConfig.ISO_DATE_RE.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

const StorageService = {
  STORAGE_KEY: 'expenseflow_data_v3',
  PRE_RESTORE_KEY: 'expenseflow_pre_restore_snapshot',
  FILE_ID_KEY: 'expenseflow_drive_file_id',
  DRIVE_PREF_KEY: 'expenseflow_drive_pref',
  THEME_KEY: 'expenseflow_theme',
  WELCOME_SEEN_KEY: 'expenseflow_welcome_seen',
  BUDGET_REMINDER_KEY: 'expenseflow_budget_reminder',
  RECURRING_PROMPTED_KEY: 'expenseflow_recurring_prompted_ym',
  accessToken: null,
  tokenClient: null,
  driveFileId: safeGetItem('expenseflow_drive_file_id', null),

  emptyState() {
    return {
      budgets: {},
      budgetUpdatedAt: {},
      categoryCaps: {},
      categoryCapsUpdatedAt: 0,
      deletedIds: [],
      expenses: [],
      shortcuts: [],
      recurring: []
    };
  },

  packData(data) {
    const cleanCaps = {};
    if (data.categoryCaps && typeof data.categoryCaps === 'object') {
      Object.entries(data.categoryCaps).forEach(([cat, val]) => {
        const num = Number(val);
        if (VALID_CATEGORIES.has(cat) && isValidAmount(num)) {
          cleanCaps[cat] = num;
        }
      });
    }

    return JSON.stringify({
      app: 'TrackYourRupee',
      v: AppConfig.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      b: data.budgets || {},
      bt: data.budgetUpdatedAt || {},
      cc: cleanCaps,
      cct: Number(data.categoryCapsUpdatedAt) || 0,
      del: Array.isArray(data.deletedIds) ? data.deletedIds.slice(-AppConfig.MAX_TOMBSTONES) : [],
      e: (data.expenses || []).map((x) => ({
        i: normalizeId(x.id) || generateNumericId(),
        a: Number(x.amount),
        c: x.category,
        m: x.mode,
        d: x.date,
        n: x.note || '',
        u: Number(x.updatedAt) || normalizeId(x.id) || Date.now()
      })),
      s: (data.shortcuts || []).map((x) => ({
        i: normalizeId(x.id) || generateNumericId(),
        a: Number(x.amount),
        c: x.category,
        m: x.mode,
        n: x.note || '',
        u: Number(x.updatedAt) || normalizeId(x.id) || Date.now()
      })),
      r: (data.recurring || []).map((x) => ({
        i: normalizeId(x.id) || generateNumericId(),
        a: Number(x.amount),
        c: x.category,
        m: x.mode,
        n: x.note || '',
        u: Number(x.updatedAt) || normalizeId(x.id) || Date.now()
      }))
    });
  },

  unpackData(raw) {
    const empty = this.emptyState();
    if (!raw || typeof raw !== 'object') return empty;

    const sanitizeTx = (x) => {
      if (!x || typeof x !== 'object') return null;
      const amt = Number(x.a ?? x.amount);
      if (!isValidAmount(amt)) return null;
      const id = normalizeId(x.i ?? x.id) || generateNumericId();
      const rawDate = x.d ?? x.date;
      const date = isValidIsoDate(rawDate) ? rawDate : getTodayISO();
      const rawCat = x.c ?? x.category;
      const category = VALID_CATEGORIES.has(rawCat) ? rawCat : 'Other';
      const rawMode = x.m ?? x.mode;
      const mode = VALID_MODES.has(rawMode) ? rawMode : 'Cash';
      const note = String(x.n ?? x.note ?? '').slice(0, 60);
      const updatedAt = Number(x.u ?? x.updatedAt) || id;
      return { id, amount: amt, category, mode, date, note, updatedAt };
    };

    const sanitizePreset = (x) => {
      if (!x || typeof x !== 'object') return null;
      const amt = Number(x.a ?? x.amount);
      if (!isValidAmount(amt)) return null;
      const id = normalizeId(x.i ?? x.id) || generateNumericId();
      const rawCat = x.c ?? x.category;
      const category = VALID_CATEGORIES.has(rawCat) ? rawCat : 'Other';
      const rawMode = x.m ?? x.mode;
      const mode = VALID_MODES.has(rawMode) ? rawMode : 'Cash';
      const note = String(x.n ?? x.note ?? '').slice(0, 40);
      const updatedAt = Number(x.u ?? x.updatedAt) || id;
      return { id, amount: amt, category, mode, note, updatedAt };
    };

    const rawBudgets = raw.b !== undefined ? raw.b : raw.budgets;
    const budgets = {};
    if (rawBudgets && typeof rawBudgets === 'object') {
      Object.entries(rawBudgets).forEach(([ym, val]) => {
        const num = Number(val);
        if (AppConfig.ISO_MONTH_RE.test(ym) && isValidBudgetAmount(num)) {
          budgets[ym] = num;
        }
      });
    }

    const rawCaps = raw.cc !== undefined ? raw.cc : raw.categoryCaps;
    const categoryCaps = {};
    if (rawCaps && typeof rawCaps === 'object') {
      Object.entries(rawCaps).forEach(([cat, val]) => {
        const num = Number(val);
        if (VALID_CATEGORIES.has(cat) && isValidAmount(num)) {
          categoryCaps[cat] = num;
        }
      });
    }

    const rawExpenses = raw.e !== undefined ? raw.e : raw.expenses;
    const rawShortcuts = raw.s !== undefined ? raw.s : raw.shortcuts;
    const rawRecurring = raw.r !== undefined ? raw.r : raw.recurring;

    return {
      budgets,
      budgetUpdatedAt: raw.bt && typeof raw.bt === 'object' ? raw.bt : {},
      categoryCaps,
      categoryCapsUpdatedAt: Number(raw.cct ?? raw.categoryCapsUpdatedAt) || 0,
      deletedIds: Array.isArray(raw.del)
        ? raw.del.map(normalizeId).filter(Boolean).slice(-AppConfig.MAX_TOMBSTONES)
        : [],
      expenses: Array.isArray(rawExpenses) ? rawExpenses.map(sanitizeTx).filter(Boolean) : [],
      shortcuts: Array.isArray(rawShortcuts) ? rawShortcuts.map(sanitizePreset).filter(Boolean) : [],
      recurring: Array.isArray(rawRecurring) ? rawRecurring.map(sanitizePreset).filter(Boolean) : []
    };
  },

  loadLocal() {
    try {
      const raw = safeGetItem(this.STORAGE_KEY);
      if (!raw) return this.emptyState();
      return this.unpackData(JSON.parse(raw));
    } catch (err) {
      Diagnostics.recordError('LoadLocal', err);
      return this.emptyState();
    }
  },

  mergeSnapshots(base, incoming) {
    const deletedSet = new Set([
      ...(base.deletedIds || []).map(normalizeId).filter(Boolean),
      ...(incoming.deletedIds || []).map(normalizeId).filter(Boolean)
    ]);
    const deletedIds = Array.from(deletedSet).slice(-AppConfig.MAX_TOMBSTONES);

    const mergeList = (listA, listB) => {
      const map = new Map();
      [...(listA || []), ...(listB || [])].forEach((item) => {
        const id = normalizeId(item.id);
        if (!id || deletedSet.has(id)) return;
        const normalized = { ...item, id };
        const existing = map.get(id);
        if (!existing || (normalized.updatedAt || 0) >= (existing.updatedAt || 0)) {
          map.set(id, normalized);
        }
      });
      return Array.from(map.values());
    };

    const expenses = mergeList(base.expenses, incoming.expenses).sort(
      (a, b) => b.date.localeCompare(a.date) || b.id - a.id
    );
    const shortcuts = mergeList(base.shortcuts, incoming.shortcuts);
    const recurring = mergeList(base.recurring, incoming.recurring);

    const budgets = { ...(base.budgets || {}) };
    const budgetUpdatedAt = { ...(base.budgetUpdatedAt || {}) };
    const allMonths = new Set([
      ...Object.keys(base.budgets || {}),
      ...Object.keys(incoming.budgets || {})
    ]);
    allMonths.forEach((ym) => {
      const baseTs = budgetUpdatedAt[ym] || 0;
      const incTs = (incoming.budgetUpdatedAt && incoming.budgetUpdatedAt[ym]) || 0;
      if (incTs > baseTs) {
        if (incoming.budgets && incoming.budgets[ym] !== undefined) {
          budgets[ym] = incoming.budgets[ym];
        } else {
          delete budgets[ym];
        }
        budgetUpdatedAt[ym] = incTs;
      }
    });

    const baseCapTs = Number(base.categoryCapsUpdatedAt) || 0;
    const incCapTs = Number(incoming.categoryCapsUpdatedAt) || 0;
    const categoryCaps =
      incCapTs > baseCapTs
        ? { ...(incoming.categoryCaps || {}) }
        : { ...(base.categoryCaps || {}) };
    const categoryCapsUpdatedAt = Math.max(baseCapTs, incCapTs);

    return {
      budgets,
      budgetUpdatedAt,
      categoryCaps,
      categoryCapsUpdatedAt,
      deletedIds,
      expenses,
      shortcuts,
      recurring
    };
  },

  saveLocal(data) {
    AnalyticsEngine.invalidate();
    const ok = safeSetItem(this.STORAGE_KEY, this.packData(data));
    if (ok) {
      Diagnostics.lastSavedAt = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    return ok;
  },

  createPreRestoreSafetySnapshot() {
    safeSetItem(this.PRE_RESTORE_KEY, this.packData(appData));
  },

  hasPreRestoreSnapshot() {
    return Boolean(safeGetItem(this.PRE_RESTORE_KEY));
  },

  rollbackPreRestore() {
    const raw = safeGetItem(this.PRE_RESTORE_KEY);
    if (!raw) return false;
    try {
      const parsed = this.unpackData(JSON.parse(raw));
      appData = parsed;
      this.saveLocal(appData);
      safeRemoveItem(this.PRE_RESTORE_KEY);
      return true;
    } catch (err) {
      Diagnostics.recordError('Rollback', err);
      return false;
    }
  },

  isDriveOptedIn() {
    return safeGetItem(this.DRIVE_PREF_KEY) === 'enabled';
  },

  isConfigured() {
    return Boolean(AppConfig.DEFAULT_CLIENT_ID);
  },

  initTokenClient(callback) {
    if (!this.isConfigured() || typeof google === 'undefined' || !google.accounts) {
      return false;
    }
    if (!this.tokenClient) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: AppConfig.DEFAULT_CLIENT_ID,
        scope: AppConfig.DRIVE_SCOPE,
        callback
      });
    } else {
      this.tokenClient.callback = callback;
    }
    return true;
  },

  requestToken(promptMode = 'consent') {
    return new Promise((resolve, reject) => {
      const ready = this.initTokenClient((response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        this.accessToken = response.access_token;
        safeSetItem(this.DRIVE_PREF_KEY, 'enabled');
        resolve(this.accessToken);
      });
      if (!ready) {
        reject(new Error('Google Identity Services not ready.'));
        return;
      }
      this.tokenClient.requestAccessToken({ prompt: promptMode });
    });
  },

  async driveFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      this.accessToken = null;
      throw new Error('AUTH_EXPIRED');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Drive API (${res.status}): ${text}`);
    }
    return res;
  },

  async findOrCreateDriveFile(initialData) {
    if (this.driveFileId) {
      try {
        await this.driveFetch(
          `https://www.googleapis.com/drive/v3/files/${this.driveFileId}?fields=id,trashed`
        );
        return this.driveFileId;
      } catch {
        this.driveFileId = null;
        safeRemoveItem(this.FILE_ID_KEY);
      }
    }

    const q = encodeURIComponent(`name='${AppConfig.DRIVE_FILE_NAME}' and trashed=false`);
    const searchRes = await this.driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`
    );
    const searchJson = await searchRes.json();

    if (searchJson.files && searchJson.files.length > 0) {
      this.driveFileId = searchJson.files[0].id;
      safeSetItem(this.FILE_ID_KEY, this.driveFileId);
      return this.driveFileId;
    }

    const boundary = 'expenseflow_multipart_boundary';
    const metadata = { name: AppConfig.DRIVE_FILE_NAME, mimeType: 'application/json' };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${this.packData(initialData)}\r\n` +
      `--${boundary}--`;

    const createRes = await this.driveFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      }
    );
    const created = await createRes.json();
    this.driveFileId = created.id;
    safeSetItem(this.FILE_ID_KEY, this.driveFileId);
    return this.driveFileId;
  },

  async readDriveData() {
    if (!this.driveFileId) return null;
    const res = await this.driveFetch(
      `https://www.googleapis.com/drive/v3/files/${this.driveFileId}?alt=media`
    );
    const json = await res.json();
    return this.unpackData(json);
  },

  async writeDriveData(data) {
    if (!this.accessToken) return false;
    await this.findOrCreateDriveFile(data);
    await this.driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${this.driveFileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: this.packData(data)
      }
    );
    return true;
  },

  async saveData(data) {
    const latestDisk = this.loadLocal();
    const merged = this.mergeSnapshots(latestDisk, data);
    appData = merged;

    const savedOk = this.saveLocal(merged);
    if (!savedOk) {
      updateSyncUI('Storage Full / Blocked', 'error');
      return;
    }
    if (!this.isDriveOptedIn()) {
      updateSyncUI('Saved on Device', 'default');
      return;
    }
    if (!this.accessToken) {
      updateSyncUI('Saved Locally (Sync Drive)', 'default');
      return;
    }
    try {
      updateSyncUI('Syncing to Drive...', 'syncing');
      await this.writeDriveData(merged);
      updateSyncUI('Device + Drive Synced', 'connected');
    } catch (err) {
      Diagnostics.recordError('DriveWrite', err);
      updateSyncUI('Saved Locally (Drive paused)', 'error');
    }
  }
};

/* ============================================================================
   5. SINGLE-PASS O(N) ANALYTICS & INDEXING ENGINE (Rules 12, 13 & Feature 6)
   ============================================================================ */
const AnalyticsEngine = {
  _cache: null,

  invalidate() {
    this._cache = null;
  },

  buildIndex(data = appData) {
    if (this._cache) return this._cache;

    const expensesByMonth = new Map();
    const spentByMonth = new Map();
    const categoryTotalsByMonth = new Map();

    for (const tx of data.expenses || []) {
      const ym = tx.date.slice(0, 7);
      const amt = Number(tx.amount) || 0;

      if (!expensesByMonth.has(ym)) expensesByMonth.set(ym, []);
      expensesByMonth.get(ym).push(tx);

      spentByMonth.set(ym, (spentByMonth.get(ym) || 0) + amt);

      if (!categoryTotalsByMonth.has(ym)) categoryTotalsByMonth.set(ym, {});
      const catMap = categoryTotalsByMonth.get(ym);
      catMap[tx.category] = (catMap[tx.category] || 0) + amt;
    }

    for (const list of expensesByMonth.values()) {
      list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    }

    this._cache = { expensesByMonth, spentByMonth, categoryTotalsByMonth };
    return this._cache;
  },

  getMonthExpenses(ym) {
    return this.buildIndex().expensesByMonth.get(ym) || [];
  },

  getCategoryTotals(ym) {
    return this.buildIndex().categoryTotalsByMonth.get(ym) || {};
  },

  calculateMonthMetrics(targetYm, data = appData) {
    const { spentByMonth } = this.buildIndex(data);
    const allMonths = new Set([
      ...Object.keys(data.budgets || {}),
      ...spentByMonth.keys(),
      targetYm
    ]);
    const sortedMonths = Array.from(allMonths).sort();

    let carryForward = 0;
    let targetMonthAdded = 0;
    let targetMonthSpent = 0;
    let targetRolloverIn = 0;

    for (const ym of sortedMonths) {
      if (ym > targetYm) break;
      const added = Number((data.budgets && data.budgets[ym]) || 0);
      const spent = spentByMonth.get(ym) || 0;

      if (ym === targetYm) {
        targetRolloverIn = carryForward;
        targetMonthAdded = added;
        targetMonthSpent = spent;
      }
      carryForward = carryForward + added - spent;
    }

    return {
      addedThisMonth: targetMonthAdded,
      rolloverIn: targetRolloverIn,
      totalAvailablePool: targetRolloverIn + targetMonthAdded,
      spentThisMonth: targetMonthSpent,
      remainingBalance: carryForward
    };
  },

  getPreviousMonthYm(ym) {
    const [y, m] = ym.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const py = prevDate.getFullYear();
    const pm = String(prevDate.getMonth() + 1).padStart(2, '0');
    return `${py}-${pm}`;
  },

  calculateMoMComparison(targetYm, data = appData) {
    const prevYm = this.getPreviousMonthYm(targetYm);
    const { spentByMonth, categoryTotalsByMonth } = this.buildIndex(data);
    const currSpent = spentByMonth.get(targetYm) || 0;
    const prevSpent = spentByMonth.get(prevYm) || 0;

    const [y, m] = targetYm.split('-').map(Number);
    const todayIso = getTodayISO();
    const daysElapsed =
      targetYm === todayIso.slice(0, 7)
        ? Math.max(1, Number(todayIso.slice(8, 10)))
        : Math.max(1, new Date(y, m, 0).getDate());
    const dailyAvg = currSpent / daysElapsed;

    let pctChange = 0;
    let hasPrev = prevSpent > 0;
    if (hasPrev) {
      pctChange = Math.round(((currSpent - prevSpent) / prevSpent) * 100);
    }

    const currCats = categoryTotalsByMonth.get(targetYm) || {};
    const prevCats = categoryTotalsByMonth.get(prevYm) || {};
    const allCats = new Set([...Object.keys(currCats), ...Object.keys(prevCats)]);

    let topCat = '--';
    let topDiff = 0;
    allCats.forEach((cat) => {
      const diff = (currCats[cat] || 0) - (prevCats[cat] || 0);
      if (Math.abs(diff) > Math.abs(topDiff)) {
        topDiff = diff;
        topCat = cat;
      }
    });

    return {
      prevYm,
      currSpent,
      prevSpent,
      hasPrev,
      pctChange,
      dailyAvg,
      topCat,
      topDiff
    };
  }
};

/* ============================================================================
   6. APP STATE & MULTI-TAB STORAGE SYNC LISTENER
   ============================================================================ */
let appData = StorageService.loadLocal();
if (!Array.isArray(appData.shortcuts)) appData.shortcuts = [];
if (!Array.isArray(appData.recurring)) appData.recurring = [];
if (!Array.isArray(appData.deletedIds)) appData.deletedIds = [];
if (!appData.budgetUpdatedAt || typeof appData.budgetUpdatedAt !== 'object') appData.budgetUpdatedAt = {};
if (!appData.categoryCaps || typeof appData.categoryCaps !== 'object') appData.categoryCaps = {};

window.addEventListener('storage', (event) => {
  if (event.key === StorageService.STORAGE_KEY && event.newValue) {
    appData = StorageService.loadLocal();
    AnalyticsEngine.invalidate();
    renderAll();
    renderShortcutsList();
    renderRecurringList();
    renderMoreList();
  } else if (event.key === StorageService.THEME_KEY && event.newValue) {
    applyTheme(event.newValue, false);
  } else if (event.key === SoundService.SOUND_KEY) {
    updateSoundToggleUI();
    renderMoreList();
  } else if (event.key === StorageService.BUDGET_REMINDER_KEY) {
    renderReminderChip();
  }
});

let selectedMode = 'Cash';
let selectedUpiType = 'UPI Lite';
let activeMonth = getCurrentMonth();
let pendingExpenseEntry = null;
let editingTransactionId = null;
let currentDailyFormulaText = 'Auto-set: Remaining balance / days left in the month';
let previousMonthStatusByYm = {};

// Modals & File Input
const jsonRestoreInput = document.getElementById('jsonRestoreInput');
const welcomeModal = document.getElementById('welcomeModal');
const closeWelcomeBtn = document.getElementById('closeWelcomeBtn');
const rollbackRestoreBtn = document.getElementById('rollbackRestoreBtn');
const diagnosticReadout = document.getElementById('diagnosticReadout');
const openGuideBtn = document.getElementById('openGuideBtn');

const editTxModal = document.getElementById('editTxModal');
const closeEditTxBtn = document.getElementById('closeEditTxBtn');
const cancelEditTxBtn = document.getElementById('cancelEditTxBtn');
const saveEditTxBtn = document.getElementById('saveEditTxBtn');
const editTxAmount = document.getElementById('editTxAmount');
const editTxCategory = document.getElementById('editTxCategory');
const editTxMode = document.getElementById('editTxMode');
const editTxDate = document.getElementById('editTxDate');
const editTxNote = document.getElementById('editTxNote');

const categoryCapsModal = document.getElementById('categoryCapsModal');
const openCategoryCapsBtn = document.getElementById('openCategoryCapsBtn');
const openCategoryCapsFooterBtn = document.getElementById('openCategoryCapsFooterBtn');
const closeCategoryCapsBtn = document.getElementById('closeCategoryCapsBtn');
const cancelCategoryCapsBtn = document.getElementById('cancelCategoryCapsBtn');
const saveCategoryCapsBtn = document.getElementById('saveCategoryCapsBtn');
const categoryCapsFormList = document.getElementById('categoryCapsFormList');

const funEditionModal = document.getElementById('funEditionModal');
const openFunEditionBtn = document.getElementById('openFunEditionBtn');
const closeFunEditionBtn = document.getElementById('closeFunEditionBtn');
const confirmFunEditionBtn = document.getElementById('confirmFunEditionBtn');
const cancelFunEditionBtn = document.getElementById('cancelFunEditionBtn');

const budgetPromptModal = document.getElementById('budgetPromptModal');
const budgetPromptTitle = document.getElementById('budgetPromptTitle');
const budgetPromptMessage = document.getElementById('budgetPromptMessage');
const promptBudgetAmount = document.getElementById('promptBudgetAmount');
const promptRecurringBox = document.getElementById('promptRecurringBox');
const promptRecurringTotal = document.getElementById('promptRecurringTotal');
const promptRecurringChecklist = document.getElementById('promptRecurringChecklist');
const applyRecurringOnlyBtn = document.getElementById('applyRecurringOnlyBtn');
const reminderDateBox = document.getElementById('reminderDateBox');
const budgetReminderDate = document.getElementById('budgetReminderDate');
const savePromptBudgetBtn = document.getElementById('savePromptBudgetBtn');
const notNowBudgetBtn = document.getElementById('notNowBudgetBtn');
const confirmReminderBtn = document.getElementById('confirmReminderBtn');

// Topbar & Drive Banner
const monthCalendarBox = document.getElementById('monthCalendarBox');
const activeMonthInput = document.getElementById('activeMonthInput');
const storageStatus = document.getElementById('storageStatus');
const headerShortcutsBtn = document.getElementById('headerShortcutsBtn');
const headerPlanCapsBtn = document.getElementById('headerPlanCapsBtn');
const planCapsHubModal = document.getElementById('planCapsHubModal');
const closePlanCapsHubBtn = document.getElementById('closePlanCapsHubBtn');
const donePlanCapsHubBtn = document.getElementById('donePlanCapsHubBtn');
const hubOpenRecurringBtn = document.getElementById('hubOpenRecurringBtn');
const hubOpenCapsBtn = document.getElementById('hubOpenCapsBtn');
const hubRecurringCount = document.getElementById('hubRecurringCount');
const hubCapsCount = document.getElementById('hubCapsCount');

const backupHubModal = document.getElementById('backupHubModal');
const closeBackupHubBtn = document.getElementById('closeBackupHubBtn');
const doneBackupHubBtn = document.getElementById('doneBackupHubBtn');
const hubExportJsonBtn = document.getElementById('hubExportJsonBtn');
const hubImportJsonBtn = document.getElementById('hubImportJsonBtn');
const hubExportCsvBtn = document.getElementById('hubExportCsvBtn');
const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundToggleIcon = document.getElementById('soundToggleIcon');
const soundToggleText = document.getElementById('soundToggleText');
const driveAuthBtn = document.getElementById('driveAuthBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportJsonBackupBtn = document.getElementById('exportJsonBackupBtn');
const importJsonRestoreBtn = document.getElementById('importJsonRestoreBtn');
const exportAllBackupBtn = document.getElementById('exportAllBackupBtn');
const drivePromptBanner = document.getElementById('drivePromptBanner');
const promptConnectBtn = document.getElementById('promptConnectBtn');
const promptDismissBtn = document.getElementById('promptDismissBtn');

// Summary Modules
const walletModule = document.getElementById('walletModule');
const monthStatusBadge = document.getElementById('monthStatusBadge');
const budgetCardLabel = document.getElementById('budgetCardLabel');
const editBudgetBtn = document.getElementById('editBudgetBtn');
const budgetTotal = document.getElementById('budgetTotal');
const budgetStatusSub = document.getElementById('budgetStatusSub');
const budgetReminderChip = document.getElementById('budgetReminderChip');
const budgetReminderText = document.getElementById('budgetReminderText');
const deleteReminderBtn = document.getElementById('deleteReminderBtn');

const remainingBalanceValue = document.getElementById('remainingBalanceValue');
const budgetBarFill = document.getElementById('budgetBarFill');
const remainingBalanceSub = document.getElementById('remainingBalanceSub');

const spentMonthLabel = document.getElementById('spentMonthLabel');
const monthTotal = document.getElementById('monthTotal');
const monthCount = document.getElementById('monthCount');
const todayTotal = document.getElementById('todayTotal');
const todayDateLabel = document.getElementById('todayDateLabel');
const todayStatusBadge = document.getElementById('todayStatusBadge');
const dailyAllowanceSub = document.getElementById('dailyAllowanceSub');
const dailyAllowanceText = document.getElementById('dailyAllowanceText');

const cashTotal = document.getElementById('cashTotal');
const upiLiteTotal = document.getElementById('upiLiteTotal');
const upiBankTotal = document.getElementById('upiBankTotal');

// Month-over-Month DOM
const momSubtitle = document.getElementById('momSubtitle');
const momDeltaBadge = document.getElementById('momDeltaBadge');
const momPrevLabel = document.getElementById('momPrevLabel');
const momPrevTotal = document.getElementById('momPrevTotal');
const momDailyAvg = document.getElementById('momDailyAvg');
const momTopShiftCategory = document.getElementById('momTopShiftCategory');
const momTopShiftDetail = document.getElementById('momTopShiftDetail');

// Inline Budget Drawer
const budgetDrawer = document.getElementById('budgetDrawer');
const budgetDrawerTitle = document.getElementById('budgetDrawerTitle');
const budgetInput = document.getElementById('budgetInput');
const addFundsBtn = document.getElementById('addFundsBtn');
const replaceBudgetBtn = document.getElementById('replaceBudgetBtn');
const scheduleReminderDrawerBtn = document.getElementById('scheduleReminderDrawerBtn');
const resetBudgetBtn = document.getElementById('resetBudgetBtn');
const cancelBudgetBtn = document.getElementById('cancelBudgetBtn');

// Form, History & Breakdown
const formCard = document.querySelector('.form-card');
const expenseForm = document.getElementById('expenseForm');
const amountInput = document.getElementById('amount');
const categoryInput = document.getElementById('category');
const paymentModeGroup = document.getElementById('paymentModeGroup');
const upiSubGroup = document.getElementById('upiSubGroup');
const upiTypeGroup = document.getElementById('upiTypeGroup');
const dateInput = document.getElementById('date');
const noteInput = document.getElementById('note');

const historyCount = document.getElementById('historyCount');
const searchInput = document.getElementById('searchInput');
const filterCategory = document.getElementById('filterCategory');
const filterPayment = document.getElementById('filterPayment');
const transactionList = document.getElementById('transactionList');
const breakdownMonthLabel = document.getElementById('breakdownMonthLabel');
const categoryDonut = document.getElementById('categoryDonut');

const recentList = document.getElementById('recentList');
const recentCount = document.getElementById('recentCount');
const recentSeeAllBtn = document.getElementById('recentSeeAllBtn');

// Shared Toast
const toastEl = document.getElementById('mobileToast');
const toastTextEl = document.getElementById('mobileToastText');
const toastUndoBtn = document.getElementById('mobileToastUndoBtn');
let lastUndoExpenseId = null;
let toastTimer = null;

function showAppToast(message, undoExpenseId = null, durationMs = 2600) {
  if (!toastEl || !toastTextEl) return;
  toastTextEl.textContent = message;
  lastUndoExpenseId = undoExpenseId;
  if (toastUndoBtn) {
    toastUndoBtn.classList.toggle('hidden', !undoExpenseId);
  }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      toastEl.classList.remove('show');
      lastUndoExpenseId = null;
    },
    undoExpenseId ? 4500 : durationMs
  );
}

if (toastUndoBtn) {
  toastUndoBtn.addEventListener('click', async () => {
    if (!lastUndoExpenseId) return;
    const idToRemove = lastUndoExpenseId;
    lastUndoExpenseId = null;
    toastEl.classList.remove('show');
    await deleteExpenseById(idToRemove);
    showAppToast('Expense undone');
  });
}

/* ============================================================================
   7. FORMATTING, SELECT POPULATORS & TRANSACTION ROW RENDERER
   ============================================================================ */
function populateCategorySelects() {
  const scCategory = document.getElementById('scCategory');
  const recCategory = document.getElementById('recCategory');
  const formSelects = [categoryInput, editTxCategory, scCategory, recCategory].filter(Boolean);
  const optionsHtml = CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`
  ).join('');

  formSelects.forEach((sel) => {
    sel.innerHTML = optionsHtml;
  });

  if (filterCategory) {
    filterCategory.innerHTML = `<option value="ALL">All Categories</option>${optionsHtml}`;
  }
}

function getTodayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().split('T')[0];
}

function getCurrentMonth() {
  return getTodayISO().slice(0, 7);
}

function formatINR(num) {
  return '₹' + Number(num || 0).toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function formatDateReadable(iso) {
  if (!isValidIsoDate(iso)) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getRemainingDaysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const totalDays = new Date(y, m, 0).getDate();
  const todayIso = getTodayISO();
  const currentYm = todayIso.slice(0, 7);
  if (ym === currentYm) {
    const todayDay = Number(todayIso.slice(8, 10));
    return Math.max(1, totalDays - todayDay + 1);
  }
  return Math.max(1, totalDays);
}

function setStatusClass(el, status) {
  if (!el) return;
  el.classList.remove('status-green', 'status-yellow', 'status-red');
  el.classList.add(`status-${status}`);
}

function setWidthClass(el, pct) {
  if (!el) return;
  const clamped = Math.min(100, Math.max(0, Math.round(Number(pct) || 0)));
  Array.from(el.classList).forEach((cls) => {
    if (/^w-\d+$/.test(cls)) el.classList.remove(cls);
  });
  el.classList.add(`w-${clamped}`);
}

function updateSyncUI(text, state = 'default') {
  storageStatus.textContent = text;
  storageStatus.className = 'storage-badge';
  if (state === 'connected') storageStatus.classList.add('connected');
  if (state === 'syncing') storageStatus.classList.add('syncing');
  if (state === 'error') storageStatus.classList.add('error');
}

function updateSoundToggleUI() {
  const on = SoundService.isEnabled();
  if (soundToggleText) {
    soundToggleText.textContent = on ? 'Sound: On' : 'Sound: Off';
  }
  if (soundToggleIcon) {
    soundToggleIcon.innerHTML = on ? SVG_SHAPES.volumeOn : SVG_SHAPES.volumeOff;
  }
}

if (soundToggleBtn) {
  soundToggleBtn.addEventListener('click', () => {
    const enabled = SoundService.toggle();
    showAppToast(enabled ? 'Sound effects enabled' : 'Sound effects muted');
  });
}

function renderTransactionRow(e) {
  const meta = MODE_META[e.mode] || MODE_META.Cash;
  const noteHtml = e.note ? ` • ${escapeHtml(e.note)}` : '';
  const editAria = escapeHtml(`Edit ${e.category} ${formatINR(e.amount)}`);
  const delAria = escapeHtml(`Delete ${e.category} ${formatINR(e.amount)}`);

  return `
    <div class="tx-item">
      <div class="tx-left">
        <div class="tx-title-row">
          <span class="tx-category">${escapeHtml(e.category)}</span>
          <span class="badge ${meta.cls}">${meta.label}</span>
        </div>
        <div class="tx-meta">${formatDateReadable(e.date)}${noteHtml}</div>
      </div>
      <div class="tx-right">
        <span class="tx-amount">${formatINR(e.amount)}</span>
        <button type="button" class="tx-action-btn" data-edit-id="${e.id}" aria-label="${editAria}" title="Edit expense">
          ${renderSvg('edit', 'ui-svg-xs')}
        </button>
        <button type="button" class="tx-action-btn delete-btn" data-delete-id="${e.id}" aria-label="${delAria}" title="Delete expense">
          ${renderSvg('close', 'ui-svg-xs')}
        </button>
      </div>
    </div>
  `;
}

/* ============================================================================
   8. FEATURE 5: EDIT EXISTING TRANSACTION MODAL
   ============================================================================ */
function openEditTransactionModal(id) {
  const numId = normalizeId(id);
  const tx = appData.expenses.find((item) => normalizeId(item.id) === numId);
  if (!tx) return;

  editingTransactionId = numId;
  editTxAmount.value = tx.amount;
  editTxCategory.value = VALID_CATEGORIES.has(tx.category) ? tx.category : 'Other';
  editTxMode.value = tx.mode === 'UPI Bank' ? 'Bank Account' : tx.mode;
  editTxDate.value = tx.date;
  editTxNote.value = tx.note || '';

  openModalWithFocus(editTxModal, editTxAmount);
}

function closeEditTransactionModal() {
  editingTransactionId = null;
  closeModal(editTxModal);
}

if (closeEditTxBtn) closeEditTxBtn.addEventListener('click', closeEditTransactionModal);
if (cancelEditTxBtn) cancelEditTxBtn.addEventListener('click', closeEditTransactionModal);

if (saveEditTxBtn) {
  saveEditTxBtn.addEventListener('click', async () => {
    if (!editingTransactionId) return;
    const amt = parseFloat(editTxAmount.value);
    if (!isValidAmount(amt)) {
      editTxAmount.focus();
      showAppToast('Enter a valid amount between ₹1 and ₹10,00,00,000');
      return;
    }
    if (!isValidIsoDate(editTxDate.value)) {
      editTxDate.focus();
      showAppToast('Select a valid date');
      return;
    }

    const idx = appData.expenses.findIndex((item) => normalizeId(item.id) === editingTransactionId);
    if (idx === -1) {
      closeEditTransactionModal();
      return;
    }

    appData.expenses[idx] = {
      ...appData.expenses[idx],
      amount: amt,
      category: editTxCategory.value,
      mode: editTxMode.value,
      date: editTxDate.value,
      note: editTxNote.value.trim().slice(0, 60),
      updatedAt: Date.now()
    };

    const editedMonth = editTxDate.value.slice(0, 7);
    if (editedMonth !== activeMonth) {
      activeMonth = editedMonth;
      activeMonthInput.value = activeMonth;
    }

    closeEditTransactionModal();
    renderAll({ targetYm: editedMonth });
    await StorageService.saveData(appData);
    showAppToast('Transaction updated');
  });
}

/* ============================================================================
   9. FEATURE 4: PER-CATEGORY MONTHLY SPENDING CAPS MODAL
   ============================================================================ */
function openCategoryCapsModal() {
  if (!categoryCapsFormList) return;
  const caps = appData.categoryCaps || {};

  categoryCapsFormList.innerHTML = CATEGORIES.map((cat) => {
    const currentVal = caps[cat.value] ? Number(caps[cat.value]) : '';
    return `
      <div class="cap-input-row ${cat.cls}">
        <span class="cap-input-label">
          <span class="donut-dot"></span>
          <span>${escapeHtml(cat.label)}</span>
        </span>
        <input
          type="number"
          data-cap-cat="${escapeHtml(cat.value)}"
          value="${currentVal}"
          min="0"
          max="100000000"
          step="1"
          placeholder="No cap"
          aria-label="Monthly cap for ${escapeHtml(cat.label)}"
        />
      </div>
    `;
  }).join('');

  const firstInput = categoryCapsFormList.querySelector('input');
  openModalWithFocus(categoryCapsModal, firstInput);
}

function openPlanCapsHubModal() {
  if (!planCapsHubModal) return;
  if (hubRecurringCount) hubRecurringCount.textContent = String((appData.recurring || []).length);
  if (hubCapsCount) hubCapsCount.textContent = String(Object.keys(appData.categoryCaps || {}).length);
  openModalWithFocus(planCapsHubModal, hubOpenRecurringBtn);
}

function openBackupHubModal() {
  if (!backupHubModal) return;
  if (backupHubModal.classList.contains('hidden')) {
    pushModalHistoryState('backup');
  }
  openModalWithFocus(backupHubModal, hubExportJsonBtn);
}

function closeBackupHubModal(fromPopState = false) {
  if (!backupHubModal || backupHubModal.classList.contains('hidden')) return;
  closeModal(backupHubModal);
  if (!fromPopState && window.history && window.history.state && window.history.state.modal === 'backup') {
    window.history.back();
  }
}

if (headerPlanCapsBtn) headerPlanCapsBtn.addEventListener('click', openPlanCapsHubModal);
if (closePlanCapsHubBtn) closePlanCapsHubBtn.addEventListener('click', () => closeModal(planCapsHubModal));
if (donePlanCapsHubBtn) donePlanCapsHubBtn.addEventListener('click', () => closeModal(planCapsHubModal));
if (hubOpenRecurringBtn) {
  hubOpenRecurringBtn.addEventListener('click', () => {
    closeModal(planCapsHubModal);
    openRecurringModal();
  });
}
if (hubOpenCapsBtn) {
  hubOpenCapsBtn.addEventListener('click', () => {
    closeModal(planCapsHubModal);
    openCategoryCapsModal();
  });
}

if (closeBackupHubBtn) closeBackupHubBtn.addEventListener('click', () => closeBackupHubModal(false));
if (doneBackupHubBtn) doneBackupHubBtn.addEventListener('click', () => closeBackupHubModal(false));
if (hubExportJsonBtn) {
  hubExportJsonBtn.addEventListener('click', () => {
    closeBackupHubModal(false);
    downloadJsonSnapshot();
  });
}
if (hubImportJsonBtn) {
  hubImportJsonBtn.addEventListener('click', () => {
    closeBackupHubModal(false);
    triggerJsonRestorePicker();
  });
}
if (hubExportCsvBtn) {
  hubExportCsvBtn.addEventListener('click', () => {
    closeBackupHubModal(false);
    downloadExpensesCsv(appData.expenses, 'All_Months_Backup');
  });
}

if (openCategoryCapsBtn) openCategoryCapsBtn.addEventListener('click', openCategoryCapsModal);
if (openCategoryCapsFooterBtn) openCategoryCapsFooterBtn.addEventListener('click', openCategoryCapsModal);
if (closeCategoryCapsBtn) closeCategoryCapsBtn.addEventListener('click', () => closeModal(categoryCapsModal));
if (cancelCategoryCapsBtn) cancelCategoryCapsBtn.addEventListener('click', () => closeModal(categoryCapsModal));

if (saveCategoryCapsBtn) {
  saveCategoryCapsBtn.addEventListener('click', async () => {
    const nextCaps = {};
    const inputs = Array.from(categoryCapsFormList.querySelectorAll('input[data-cap-cat]'));
    for (const inp of inputs) {
      const cat = inp.dataset.capCat;
      const rawVal = inp.value.trim();
      if (!rawVal) continue;
      const num = parseFloat(rawVal);
      if (!isValidBudgetAmount(num)) {
        inp.focus();
        showAppToast(`Invalid cap for ${cat}`);
        return;
      }
      if (num > 0 && VALID_CATEGORIES.has(cat)) {
        nextCaps[cat] = num;
      }
    }

    appData.categoryCaps = nextCaps;
    appData.categoryCapsUpdatedAt = Date.now();
    closeModal(categoryCapsModal);
    renderAll();
    await StorageService.saveData(appData);
    showAppToast('Category caps saved');
  });
}

/* ============================================================================
   10. FEATURE 3: JSON FULL-STATE BACKUP, RESTORE & PRE-RESTORE ROLLBACK
   ============================================================================ */
function downloadJsonSnapshot() {
  const jsonStr = StorageService.packData(appData);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `TrackYourRupee_Snapshot_${getTodayISO()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAppToast('Full JSON snapshot downloaded');
}

function triggerJsonRestorePicker() {
  if (!jsonRestoreInput) return;
  jsonRestoreInput.value = '';
  jsonRestoreInput.click();
}

if (exportJsonBackupBtn) exportJsonBackupBtn.addEventListener('click', downloadJsonSnapshot);
if (importJsonRestoreBtn) importJsonRestoreBtn.addEventListener('click', triggerJsonRestorePicker);

if (jsonRestoreInput) {
  jsonRestoreInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (file.size > AppConfig.MAX_IMPORT_BYTES) {
      showAppToast('Backup file exceeds 2 MB limit');
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || (parsed.e === undefined && parsed.expenses === undefined)) {
        showAppToast('Invalid TrackYourRupee JSON backup file');
        return;
      }

      StorageService.createPreRestoreSafetySnapshot();
      const unpacked = StorageService.unpackData(parsed);
      appData = StorageService.mergeSnapshots(appData, unpacked);
      StorageService.saveLocal(appData);
      renderAll();
      renderMoreList();
      updateDiagnosticsReadout();
      showAppToast(`Restored ${unpacked.expenses.length} entries (Rollback available in Info)`);
    } catch (err) {
      Diagnostics.recordError('JsonRestore', err);
      showAppToast('Could not read JSON backup file');
    }
  });
}

if (rollbackRestoreBtn) {
  rollbackRestoreBtn.addEventListener('click', () => {
    if (!StorageService.hasPreRestoreSnapshot()) {
      showAppToast('No pre-restore snapshot available');
      return;
    }
    const ok = StorageService.rollbackPreRestore();
    if (ok) {
      renderAll();
      renderMoreList();
      updateDiagnosticsReadout();
      showAppToast('Rolled back to state before last restore');
    } else {
      showAppToast('Rollback failed');
    }
  });
}

/* ============================================================================
   11. THEME MANAGEMENT, FUN EDITION MODAL & DRIVE SYNC
   ============================================================================ */
function applyTheme(theme, persist = true) {
  const isDark = theme === 'dark';
  const statusBg = isDark ? '#0b0d11' : '#f4f5f7';
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeToggleBtn.textContent = 'Light Mode';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeToggleBtn.textContent = 'Dark Mode';
  }
  const metaLight = document.getElementById('metaThemeLight');
  const metaDark = document.getElementById('metaThemeDark');
  if (metaLight) metaLight.setAttribute('content', statusBg);
  if (metaDark) metaDark.setAttribute('content', statusBg);
  if (persist) {
    safeSetItem(StorageService.THEME_KEY, isDark ? 'dark' : 'light');
  }
}

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

function openFunEditionWarning() {
  if (!funEditionModal) return;
  openModalWithFocus(funEditionModal, cancelFunEditionBtn);
}

if (openFunEditionBtn) openFunEditionBtn.addEventListener('click', openFunEditionWarning);
if (closeFunEditionBtn) closeFunEditionBtn.addEventListener('click', () => closeModal(funEditionModal));
if (cancelFunEditionBtn) cancelFunEditionBtn.addEventListener('click', () => closeModal(funEditionModal));
if (confirmFunEditionBtn) {
  confirmFunEditionBtn.addEventListener('click', () => {
    closeModal(funEditionModal);
    window.open(AppConfig.FUN_EDITION_URL, '_blank', 'noopener,noreferrer');
  });
}

async function triggerDriveSync(promptMode = 'consent') {
  if (!canTriggerSync()) return;

  if (AppConfig.DRIVE_TEST_MODE_GUARD) {
    showAppToast('Drive sync paused in test mode. Use Backup JSON or CSV.');
    return;
  }

  try {
    updateSyncUI('Connecting Drive...', 'syncing');
    await StorageService.requestToken(promptMode);
    await StorageService.findOrCreateDriveFile(appData);

    const cloudData = await StorageService.readDriveData();
    if (cloudData) {
      appData = StorageService.mergeSnapshots(appData, cloudData);
    }

    StorageService.saveLocal(appData);
    await StorageService.writeDriveData(appData);
    drivePromptBanner.classList.add('hidden');
    driveAuthBtn.textContent = 'Sync Drive Now';
    driveAuthBtn.classList.add('connected');
    updateSyncUI('Device + Drive Synced', 'connected');
    renderAll();
  } catch (err) {
    Diagnostics.recordError('DriveSync', err);
    updateSyncUI('Saved on Device (Drive cancelled)', 'error');
  }
}

driveAuthBtn.addEventListener('click', () => {
  triggerDriveSync(StorageService.accessToken ? '' : 'consent');
});

promptConnectBtn.addEventListener('click', () => {
  triggerDriveSync('consent');
});

promptDismissBtn.addEventListener('click', () => {
  safeSetItem(StorageService.DRIVE_PREF_KEY, 'dismissed');
  drivePromptBanner.classList.add('hidden');
});

/* ============================================================================
   12. BUDGET HEALTH & SMART MONTHLY PROMPT
   ============================================================================ */
function getMonthHealthStatus(metrics) {
  if (metrics.totalAvailablePool > 0) {
    const leftPct = (metrics.remainingBalance / metrics.totalAvailablePool) * 100;
    if (leftPct > 50) return 'green';
    if (leftPct >= 20) return 'yellow';
    return 'red';
  }
  if (metrics.remainingBalance < 0) return 'red';
  return 'green';
}

let promptTargetMonth = activeMonth;

function getSavedReminder() {
  try {
    const raw = safeGetItem(StorageService.BUDGET_REMINDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSavedReminder() {
  safeRemoveItem(StorageService.BUDGET_REMINDER_KEY);
  renderReminderChip();
}

function renderReminderChip() {
  const reminder = getSavedReminder();
  if (reminder && reminder.month === activeMonth && reminder.remindOn) {
    budgetReminderText.textContent = `Reminder: ${formatDateReadable(reminder.remindOn)}`;
    budgetReminderChip.classList.remove('hidden');
  } else {
    budgetReminderChip.classList.add('hidden');
  }
}

deleteReminderBtn.addEventListener('click', clearSavedReminder);

function updatePromptRecurringTotal() {
  if (!promptRecurringChecklist || !promptRecurringTotal) return;
  const checkedBoxes = Array.from(promptRecurringChecklist.querySelectorAll('input[type="checkbox"]:checked'));
  const sum = checkedBoxes.reduce((acc, cb) => acc + Number(cb.dataset.amount || 0), 0);
  promptRecurringTotal.textContent = `Selected: ${formatINR(sum)}`;
}

function renderPromptRecurringChecklist() {
  if (!promptRecurringBox || !promptRecurringChecklist) return;
  const bills = appData.recurring || [];
  if (bills.length === 0) {
    promptRecurringBox.classList.add('hidden');
    if (applyRecurringOnlyBtn) applyRecurringOnlyBtn.classList.add('hidden');
    return;
  }

  promptRecurringBox.classList.remove('hidden');
  if (applyRecurringOnlyBtn) applyRecurringOnlyBtn.classList.remove('hidden');

  promptRecurringChecklist.innerHTML = bills
    .map((b) => {
      const meta = MODE_META[b.mode] || MODE_META.Cash;
      const title = b.note ? `${escapeHtml(b.note)} (${escapeHtml(b.category)})` : escapeHtml(b.category);
      return `
        <label class="recurring-check-item">
          <span class="recurring-check-left">
            <input type="checkbox" checked data-rec-id="${b.id}" data-amount="${b.amount}" />
            <span><strong>${title}</strong> &bull; <span class="muted-text">${meta.label}</span></span>
          </span>
          <strong>${formatINR(b.amount)}</strong>
        </label>
      `;
    })
    .join('');

  updatePromptRecurringTotal();
}

if (promptRecurringChecklist) {
  promptRecurringChecklist.addEventListener('change', updatePromptRecurringTotal);
}

function applyCheckedRecurringBills(targetYm) {
  if (!promptRecurringChecklist || promptRecurringBox.classList.contains('hidden')) return 0;
  const checkedIds = new Set(
    Array.from(promptRecurringChecklist.querySelectorAll('input[type="checkbox"]:checked')).map((cb) =>
      normalizeId(cb.dataset.recId)
    )
  );
  if (checkedIds.size === 0) return 0;

  const todayIso = getTodayISO();
  const billDate = targetYm === todayIso.slice(0, 7) ? todayIso : `${targetYm}-01`;
  let addedCount = 0;

  (appData.recurring || []).forEach((bill) => {
    if (!checkedIds.has(normalizeId(bill.id))) return;
    appData.expenses.unshift({
      id: generateNumericId() + addedCount * 1000,
      amount: Number(bill.amount),
      category: bill.category,
      mode: bill.mode,
      date: billDate,
      note: bill.note || 'Monthly Fixed Bill',
      updatedAt: Date.now()
    });
    addedCount++;
  });

  if (addedCount > 0) {
    safeSetItem(StorageService.RECURRING_PROMPTED_KEY, targetYm);
  }
  return addedCount;
}

function openBudgetPrompt(targetMonth, reasonText, pendingEntry = null, showDateImmediately = false) {
  pendingExpenseEntry = pendingEntry;
  promptTargetMonth = targetMonth;
  const label = formatMonthLabel(targetMonth);
  const hasBudget = (Number(appData.budgets[targetMonth]) || 0) > 0;

  budgetPromptTitle.textContent = hasBudget
    ? `${label} Monthly Fixed Bills`
    : `Set ${label} Budget`;
  budgetPromptMessage.textContent = reasonText;
  promptBudgetAmount.value = '';

  const today = getTodayISO();
  const existingReminder = getSavedReminder();
  budgetReminderDate.min = today;
  budgetReminderDate.value =
    existingReminder && existingReminder.month === targetMonth && existingReminder.remindOn >= today
      ? existingReminder.remindOn
      : today;

  reminderDateBox.classList.toggle('hidden', !showDateImmediately);
  if (showDateImmediately) {
    promptRecurringBox.classList.add('hidden');
  } else {
    renderPromptRecurringChecklist();
  }

  openModalWithFocus(budgetPromptModal, showDateImmediately ? budgetReminderDate : promptBudgetAmount);
}

function checkMonthlyBudgetPrompt() {
  const today = getTodayISO();
  const currentYm = today.slice(0, 7);
  const hasCurrentBudget = (Number(appData.budgets[currentYm]) || 0) > 0;
  const hasRecurringBills = (appData.recurring || []).length > 0;
  const alreadyPromptedRecurring = safeGetItem(StorageService.RECURRING_PROMPTED_KEY) === currentYm;

  if (hasCurrentBudget) {
    if (hasRecurringBills && !alreadyPromptedRecurring) {
      safeSetItem(StorageService.RECURRING_PROMPTED_KEY, currentYm);
      openBudgetPrompt(
        currentYm,
        `New month (${formatMonthLabel(currentYm)}) started. Confirm your monthly fixed bills or add extra allowance.`
      );
    }
    return;
  }

  const savedReminder = getSavedReminder();
  if (savedReminder && savedReminder.month === currentYm && savedReminder.remindOn) {
    if (today >= savedReminder.remindOn) {
      openBudgetPrompt(
        currentYm,
        `Reminder: You scheduled ${formatDateReadable(savedReminder.remindOn)} to add your ${formatMonthLabel(currentYm)} budget.`
      );
    }
    return;
  }

  safeSetItem(StorageService.RECURRING_PROMPTED_KEY, currentYm);
  openBudgetPrompt(
    currentYm,
    `Set your ${formatMonthLabel(currentYm)} monthly budget and confirm any fixed monthly bills.`
  );
}

async function finalizePendingExpense(recurringCountAdded = 0) {
  if (!pendingExpenseEntry) return;
  const entry = pendingExpenseEntry;
  pendingExpenseEntry = null;

  appData.expenses.unshift(entry);
  const entryMonth = entry.date.slice(0, 7);
  if (entryMonth !== activeMonth) {
    activeMonth = entryMonth;
    activeMonthInput.value = activeMonth;
  }
  amountInput.value = '';
  noteInput.value = '';
  renderAll({ soundCue: 'deducted', targetYm: entryMonth });
  await StorageService.saveData(appData);
  if (recurringCountAdded > 0) {
    showAppToast(`Added expense + ${recurringCountAdded} recurring ${recurringCountAdded === 1 ? 'bill' : 'bills'}`);
  }
}

savePromptBudgetBtn.addEventListener('click', async () => {
  const val = parseFloat(promptBudgetAmount.value);
  if (!isValidAmount(val)) {
    promptBudgetAmount.focus();
    showAppToast('Enter a valid amount between ₹1 and ₹10,00,00,000');
    return;
  }

  const targetMonth = pendingExpenseEntry ? pendingExpenseEntry.date.slice(0, 7) : promptTargetMonth;
  appData.budgets[targetMonth] = (Number(appData.budgets[targetMonth]) || 0) + val;
  appData.budgetUpdatedAt[targetMonth] = Date.now();
  clearSavedReminder();

  const billsAdded = applyCheckedRecurringBills(targetMonth);
  if (targetMonth !== activeMonth) {
    activeMonth = targetMonth;
    activeMonthInput.value = activeMonth;
  }

  closeModal(budgetPromptModal);
  const hasPending = Boolean(pendingExpenseEntry);
  renderAll({ soundCue: hasPending ? null : 'added', targetYm: targetMonth });
  await StorageService.saveData(appData);
  if (!hasPending && billsAdded > 0) {
    showAppToast(`Budget saved + ${billsAdded} recurring ${billsAdded === 1 ? 'bill' : 'bills'} added`);
  }
  await finalizePendingExpense(billsAdded);
});

if (applyRecurringOnlyBtn) {
  applyRecurringOnlyBtn.addEventListener('click', async () => {
    const targetMonth = pendingExpenseEntry ? pendingExpenseEntry.date.slice(0, 7) : promptTargetMonth;
    const billsAdded = applyCheckedRecurringBills(targetMonth);
    if (billsAdded === 0) {
      showAppToast('Select at least one recurring bill first');
      return;
    }
    if (targetMonth !== activeMonth) {
      activeMonth = targetMonth;
      activeMonthInput.value = activeMonth;
    }
    closeModal(budgetPromptModal);
    const hasPending = Boolean(pendingExpenseEntry);
    renderAll({ soundCue: hasPending ? null : 'deducted', targetYm: targetMonth });
    await StorageService.saveData(appData);
    if (!hasPending) {
      showAppToast(`Added ${billsAdded} recurring ${billsAdded === 1 ? 'bill' : 'bills'}`);
    }
    await finalizePendingExpense(billsAdded);
  });
}

notNowBudgetBtn.addEventListener('click', () => {
  reminderDateBox.classList.remove('hidden');
  budgetReminderDate.focus();
});

confirmReminderBtn.addEventListener('click', async () => {
  const chosenDate = budgetReminderDate.value;
  if (!isValidIsoDate(chosenDate)) {
    budgetReminderDate.focus();
    return;
  }

  const targetMonth = pendingExpenseEntry ? pendingExpenseEntry.date.slice(0, 7) : promptTargetMonth;
  safeSetItem(
    StorageService.BUDGET_REMINDER_KEY,
    JSON.stringify({ month: targetMonth, remindOn: chosenDate })
  );

  closeModal(budgetPromptModal);
  renderReminderChip();
  await finalizePendingExpense(0);
});

promptBudgetAmount.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    savePromptBudgetBtn.click();
  }
});

budgetReminderDate.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmReminderBtn.click();
  }
});

budgetInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addFundsBtn.click();
  }
});

/* ============================================================================
   13. MODAL FOCUS TRAP & ESCAPE KEY HANDLER
   ============================================================================ */
let lastFocusedBeforeModal = null;

function getVisibleModal() {
  const modals = [
    editTxModal,
    categoryCapsModal,
    planCapsHubModal,
    backupHubModal,
    funEditionModal,
    recurringModal,
    shortcutsModal,
    budgetPromptModal,
    welcomeModal
  ].filter(Boolean);
  return modals.find((m) => !m.classList.contains('hidden')) || null;
}

function openModalWithFocus(modalEl, initialFocusEl = null) {
  if (!modalEl) return;
  lastFocusedBeforeModal = document.activeElement;
  modalEl.classList.remove('hidden');
  setTimeout(() => {
    if (initialFocusEl && typeof initialFocusEl.focus === 'function') {
      initialFocusEl.focus();
      if (typeof initialFocusEl.select === 'function') initialFocusEl.select();
    } else {
      const focusables = modalEl.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length > 0) focusables[0].focus();
    }
  }, 40);
}

function closeModal(modalEl) {
  if (!modalEl || modalEl.classList.contains('hidden')) return;
  modalEl.classList.add('hidden');
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
    lastFocusedBeforeModal.focus();
    lastFocusedBeforeModal = null;
  }
}

document.addEventListener('keydown', (e) => {
  const activeModal = getVisibleModal();
  if (!activeModal) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    if (activeModal === shortcutsModal) closeShortcutsModal(false);
    else if (activeModal === recurringModal) closeRecurringModal(false);
    else if (activeModal === backupHubModal) closeBackupHubModal(false);
    else if (activeModal === editTxModal) closeEditTransactionModal();
    else closeModal(activeModal);
    return;
  }

  if (e.key === 'Tab') {
    const focusables = Array.from(
      activeModal.querySelectorAll(
        'button:not([disabled]):not(.hidden), input:not([disabled]):not(.hidden), select:not([disabled]):not(.hidden), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);

    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

/* ============================================================================
   14. UI INTERACTIONS: PILLS, BUDGET DRAWER, DIAGNOSTICS & EXPENSE CRUD
   ============================================================================ */
paymentModeGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  paymentModeGroup.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  selectedMode = btn.dataset.mode;
  upiSubGroup.classList.toggle('hidden', selectedMode !== 'UPI');
});

upiTypeGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  upiTypeGroup.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  selectedUpiType = btn.dataset.upi;
});

activeMonthInput.addEventListener('change', (e) => {
  if (e.target.value && AppConfig.ISO_MONTH_RE.test(e.target.value)) {
    activeMonth = e.target.value;
    renderAll();

    const hasBudget = (Number(appData.budgets[activeMonth]) || 0) > 0;
    const hasExpenses = AnalyticsEngine.getMonthExpenses(activeMonth).length > 0;
    if (!hasBudget && !hasExpenses && (appData.recurring || []).length > 0) {
      openBudgetPrompt(
        activeMonth,
        `Set your ${formatMonthLabel(activeMonth)} budget and choose recurring bills to include.`
      );
    }
  }
});

if (monthCalendarBox && activeMonthInput) {
  monthCalendarBox.addEventListener('click', () => {
    if (typeof activeMonthInput.showPicker === 'function') {
      try {
        activeMonthInput.showPicker();
      } catch {
        activeMonthInput.focus();
      }
    } else {
      activeMonthInput.focus();
    }
  });
}

function updateDiagnosticsReadout() {
  if (!diagnosticReadout) return;
  const storageText = Diagnostics.getStorageSummary();
  const savedText = Diagnostics.lastSavedAt || 'Session active';
  diagnosticReadout.textContent =
    `Schema: v${AppConfig.SCHEMA_VERSION} | Storage: ${storageText} | ` +
    `Cache: ${Diagnostics.swStatus} | Self-Tests: ${Diagnostics.selfTestStatus} | ` +
    `Last Write: ${savedText} | Errors: ${Diagnostics.lastError}`;
  if (rollbackRestoreBtn) {
    rollbackRestoreBtn.classList.toggle('hidden', !StorageService.hasPreRestoreSnapshot());
  }
}

closeWelcomeBtn.addEventListener('click', () => {
  safeSetItem(StorageService.WELCOME_SEEN_KEY, 'true');
  closeModal(welcomeModal);
  checkMonthlyBudgetPrompt();
});

openGuideBtn.addEventListener('click', () => {
  updateDiagnosticsReadout();
  openModalWithFocus(welcomeModal, closeWelcomeBtn);
});

if (dailyAllowanceSub) {
  dailyAllowanceSub.addEventListener('click', () => {
    showAppToast(currentDailyFormulaText, null, 3800);
  });
}

editBudgetBtn.addEventListener('click', () => {
  budgetDrawerTitle.textContent = `Manage ${formatMonthLabel(activeMonth)} Budget (₹)`;
  budgetInput.value = '';
  budgetDrawer.classList.toggle('hidden');
  if (!budgetDrawer.classList.contains('hidden')) {
    budgetInput.focus();
    budgetInput.select();
    setTimeout(() => {
      budgetDrawer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }
});

function scrollAddExpenseIntoView() {
  if (!formCard || window.innerWidth > 640) return;
  setTimeout(() => {
    formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 150);
}

amountInput.addEventListener('focus', scrollAddExpenseIntoView);
noteInput.addEventListener('focus', scrollAddExpenseIntoView);

scheduleReminderDrawerBtn.addEventListener('click', () => {
  budgetDrawer.classList.add('hidden');
  openBudgetPrompt(
    activeMonth,
    `Pick a reminder date for your ${formatMonthLabel(activeMonth)} budget:`,
    null,
    true
  );
});

cancelBudgetBtn.addEventListener('click', () => {
  budgetDrawer.classList.add('hidden');
});

addFundsBtn.addEventListener('click', async () => {
  const val = parseFloat(budgetInput.value);
  if (!isValidAmount(val)) {
    budgetInput.focus();
    showAppToast('Enter a valid amount between ₹1 and ₹10,00,00,000');
    return;
  }
  appData.budgets[activeMonth] = Number(appData.budgets[activeMonth] || 0) + val;
  appData.budgetUpdatedAt[activeMonth] = Date.now();
  clearSavedReminder();
  budgetDrawer.classList.add('hidden');
  renderAll({ soundCue: 'added', targetYm: activeMonth });
  await StorageService.saveData(appData);
});

replaceBudgetBtn.addEventListener('click', async () => {
  const val = parseFloat(budgetInput.value);
  if (!isValidBudgetAmount(val)) {
    budgetInput.focus();
    showAppToast('Enter a valid budget amount (₹0 to ₹10,00,00,000)');
    return;
  }
  const prevVal = Number(appData.budgets[activeMonth] || 0);
  appData.budgets[activeMonth] = val;
  appData.budgetUpdatedAt[activeMonth] = Date.now();
  if (val > 0) {
    clearSavedReminder();
  }
  budgetDrawer.classList.add('hidden');
  renderAll({ soundCue: val > prevVal ? 'added' : null, targetYm: activeMonth });
  await StorageService.saveData(appData);
});

resetBudgetBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    `Reset ${formatMonthLabel(activeMonth)} budget to ₹0? Recorded expenses will remain intact.`
  );
  if (!confirmed) return;
  delete appData.budgets[activeMonth];
  appData.budgetUpdatedAt[activeMonth] = Date.now();
  budgetDrawer.classList.add('hidden');
  renderAll();
  await StorageService.saveData(appData);
});

expenseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!canSubmitExpense()) return;

  const amount = parseFloat(amountInput.value);
  if (!isValidAmount(amount)) {
    amountInput.focus();
    showAppToast('Enter a valid amount between ₹1 and ₹10,00,00,000');
    return;
  }

  const entryDate = dateInput.value;
  if (!isValidIsoDate(entryDate)) {
    dateInput.focus();
    showAppToast('Please select a valid date');
    return;
  }

  const mode = selectedMode === 'Cash' ? 'Cash' : selectedUpiType;
  const nowId = generateNumericId();

  const entry = {
    id: nowId,
    amount,
    category: categoryInput.value,
    mode,
    date: entryDate,
    note: noteInput.value.trim().slice(0, 60),
    updatedAt: Date.now()
  };

  const entryMonth = entryDate.slice(0, 7);
  const hasAnyBudget = Object.values(appData.budgets).some((b) => Number(b) > 0);
  const reminder = getSavedReminder();
  const hasDeferredThisMonth = reminder && reminder.month === entryMonth;

  if (!hasAnyBudget && !hasDeferredThisMonth) {
    openBudgetPrompt(
      entryMonth,
      `Before recording ₹${amount}, set your ${formatMonthLabel(entryMonth)} budget first?`,
      entry
    );
    return;
  }

  appData.expenses.unshift(entry);
  if (entryMonth !== activeMonth) {
    activeMonth = entryMonth;
    activeMonthInput.value = activeMonth;
  }

  amountInput.value = '';
  noteInput.value = '';
  renderAll({ soundCue: 'deducted', targetYm: entryMonth });
  await StorageService.saveData(appData);
});

async function deleteExpenseById(id) {
  const numId = normalizeId(id);
  if (!numId) return;
  appData.expenses = appData.expenses.filter((item) => normalizeId(item.id) !== numId);
  recordTombstone(numId);
  renderAll();
  await StorageService.saveData(appData);
}

function handleTransactionListClick(e) {
  const editBtn = e.target.closest('[data-edit-id]');
  if (editBtn) {
    const id = normalizeId(editBtn.dataset.editId);
    if (id) openEditTransactionModal(id);
    return;
  }

  const delBtn = e.target.closest('[data-delete-id]');
  if (delBtn) {
    const id = normalizeId(delBtn.dataset.deleteId);
    if (id) deleteExpenseById(id);
  }
}

transactionList.addEventListener('click', handleTransactionListClick);
if (recentList) {
  recentList.addEventListener('click', handleTransactionListClick);
}

function sanitizeCsvCell(value) {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function downloadExpensesCsv(expensesSubset, fileLabel) {
  if (!expensesSubset || expensesSubset.length === 0) {
    showAppToast('No expenses available to export');
    return;
  }
  const headers = ['Date', 'Category', 'Payment Mode', 'Amount (INR)', 'Note'];
  const rows = expensesSubset.map((e) => [
    e.date,
    sanitizeCsvCell(e.category),
    sanitizeCsvCell(e.mode),
    Number(e.amount),
    sanitizeCsvCell(e.note || '')
  ]);

  const csvString = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `TrackYourRupee_${fileLabel}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

exportCsvBtn.addEventListener('click', (e) => {
  if (e.shiftKey) {
    downloadExpensesCsv(appData.expenses, 'All_Months_Backup');
    return;
  }
  const monthExpenses = AnalyticsEngine.getMonthExpenses(activeMonth);
  if (monthExpenses.length === 0) {
    showAppToast(`No expenses recorded in ${formatMonthLabel(activeMonth)}`);
    return;
  }
  downloadExpensesCsv(monthExpenses, activeMonth);
});

if (exportAllBackupBtn) {
  exportAllBackupBtn.addEventListener('click', () => {
    downloadExpensesCsv(appData.expenses, 'All_Months_Backup');
  });
}

filterCategory.addEventListener('change', () => renderTransactions());
filterPayment.addEventListener('change', () => renderTransactions());
searchInput.addEventListener('input', () => renderTransactions());

/* ============================================================================
   15. RENDERING ENGINE (SUMMARY, MoM, CATEGORY CAPS, RECENT & HISTORY)
   ============================================================================ */
function renderAll(options = {}) {
  const { soundCue = null, targetYm = activeMonth } = options;
  AnalyticsEngine.invalidate();

  const prevStatus = previousMonthStatusByYm[targetYm];
  const currentMonthExpenses = AnalyticsEngine.getMonthExpenses(activeMonth);

  renderSummaryAndSplit(currentMonthExpenses);
  renderMoMComparison();
  renderReminderChip();
  renderCategoryBreakdown(currentMonthExpenses);
  renderRecent(currentMonthExpenses);
  renderTransactions(currentMonthExpenses);

  const newStatus = getMonthHealthStatus(AnalyticsEngine.calculateMonthMetrics(targetYm));
  previousMonthStatusByYm[targetYm] = newStatus;

  if (soundCue) {
    if (prevStatus && prevStatus !== newStatus && newStatus === 'red') {
      SoundService.play('red');
    } else if (prevStatus === 'green' && newStatus === 'yellow') {
      SoundService.play('orange');
    } else {
      SoundService.play(soundCue);
    }
  }
}

function renderSummaryAndSplit(monthExpenses = AnalyticsEngine.getMonthExpenses(activeMonth)) {
  const metrics = AnalyticsEngine.calculateMonthMetrics(activeMonth);
  const label = formatMonthLabel(activeMonth);
  const today = getTodayISO();

  budgetCardLabel.textContent = `${label} Allowance`;
  budgetTotal.textContent = formatINR(metrics.addedThisMonth);
  budgetStatusSub.textContent =
    metrics.addedThisMonth > 0
      ? 'Allowance added'
      : 'Click "+ Add / Edit" to set';

  remainingBalanceValue.textContent = formatINR(metrics.remainingBalance);
  remainingBalanceValue.classList.toggle('text-danger', metrics.remainingBalance < 0);

  const monthStatus = getMonthHealthStatus(metrics);
  const monthStatusWord =
    monthStatus === 'green' ? 'On track' : monthStatus === 'yellow' ? 'Careful' : 'Over';
  let barFillPct = 0;

  if (metrics.totalAvailablePool > 0) {
    const leftPct = (metrics.remainingBalance / metrics.totalAvailablePool) * 100;
    barFillPct = Math.min(100, Math.max(0, Math.round(leftPct)));
  } else if (metrics.remainingBalance < 0) {
    barFillPct = 100;
  }

  setWidthClass(budgetBarFill, barFillPct);
  setStatusClass(budgetBarFill, monthStatus);
  setStatusClass(walletModule, monthStatus);
  setStatusClass(monthCalendarBox, monthStatus);
  setStatusClass(monthStatusBadge, monthStatus);
  monthStatusBadge.textContent = monthStatusWord;

  if (metrics.rolloverIn > 0) {
    remainingBalanceSub.textContent = `Includes +${formatINR(metrics.rolloverIn)} rollover`;
  } else if (metrics.rolloverIn < 0) {
    remainingBalanceSub.textContent = `Includes ${formatINR(metrics.rolloverIn)} deficit`;
  } else {
    remainingBalanceSub.textContent = 'Includes prev. month rollover';
  }

  spentMonthLabel.textContent = `Spent (${label})`;
  monthTotal.textContent = formatINR(metrics.spentThisMonth);
  monthCount.textContent = `${monthExpenses.length} ${monthExpenses.length === 1 ? 'transaction' : 'transactions'}`;

  const todayExpenses = AnalyticsEngine.getMonthExpenses(today.slice(0, 7)).filter((e) => e.date === today);
  const todaySum = todayExpenses.reduce((s, e) => s + Number(e.amount), 0);
  todayTotal.textContent = formatINR(todaySum);
  todayDateLabel.textContent = formatDateReadable(today);

  const daysLeft = getRemainingDaysInMonth(activeMonth);
  const currentBalance = metrics.remainingBalance;
  const todaysLimit = currentBalance > 0 ? currentBalance / daysLeft : 0;

  let todayStatus = 'green';
  let todayStatusWord = 'On track';

  if (todaysLimit > 0) {
    const todayRatio = (todaySum / todaysLimit) * 100;
    if (todayRatio < 70) {
      todayStatus = 'green';
      todayStatusWord = 'On track';
    } else if (todayRatio <= 100) {
      todayStatus = 'yellow';
      todayStatusWord = 'Careful';
    } else {
      todayStatus = 'red';
      todayStatusWord = 'Over';
    }
    if (dailyAllowanceText) dailyAllowanceText.textContent = `Today's limit: ${formatINR(Math.round(todaysLimit))}`;
    currentDailyFormulaText = `Auto-set: ${formatINR(currentBalance)} balance left / ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
  } else if (todaySum > 0) {
    todayStatus = 'red';
    todayStatusWord = 'Over';
    if (dailyAllowanceText) dailyAllowanceText.textContent = 'No allowance left';
    currentDailyFormulaText = 'Auto-set: ₹0 balance remaining for the rest of this month';
  } else {
    if (dailyAllowanceText) dailyAllowanceText.textContent = "Set budget for today's limit";
    currentDailyFormulaText = 'Auto-set: Balance left / days remaining once a monthly budget is added';
  }

  setStatusClass(todayStatusBadge, todayStatus);
  todayStatusBadge.textContent = todayStatusWord;

  let cashSum = 0;
  let upiLiteSum = 0;
  let upiBankSum = 0;

  monthExpenses.forEach((e) => {
    if (e.mode === 'Cash') cashSum += Number(e.amount);
    else if (e.mode === 'UPI Lite') upiLiteSum += Number(e.amount);
    else if (e.mode === 'Bank Account' || e.mode === 'UPI Bank') upiBankSum += Number(e.amount);
  });

  cashTotal.textContent = formatINR(cashSum);
  upiLiteTotal.textContent = formatINR(upiLiteSum);
  upiBankTotal.textContent = formatINR(upiBankSum);
}

function renderMoMComparison() {
  if (!momDeltaBadge || !momPrevTotal) return;
  const mom = AnalyticsEngine.calculateMoMComparison(activeMonth);
  const prevLabel = formatMonthLabel(mom.prevYm);

  if (momSubtitle) momSubtitle.textContent = `Comparing against ${prevLabel}`;
  if (momPrevLabel) momPrevLabel.textContent = `Spent in ${prevLabel}`;
  momPrevTotal.textContent = formatINR(mom.prevSpent);
  if (momDailyAvg) momDailyAvg.textContent = `Daily avg: ${formatINR(Math.round(mom.dailyAvg))}`;

  if (!mom.hasPrev) {
    setStatusClass(momDeltaBadge, 'green');
    momDeltaBadge.textContent = 'Baseline';
  } else if (mom.pctChange <= 0) {
    setStatusClass(momDeltaBadge, 'green');
    momDeltaBadge.textContent = `${mom.pctChange}%`;
  } else if (mom.pctChange <= 15) {
    setStatusClass(momDeltaBadge, 'yellow');
    momDeltaBadge.textContent = `+${mom.pctChange}%`;
  } else {
    setStatusClass(momDeltaBadge, 'red');
    momDeltaBadge.textContent = `+${mom.pctChange}%`;
  }

  if (momTopShiftCategory && momTopShiftDetail) {
    if (mom.topCat === '--' || mom.topDiff === 0) {
      momTopShiftCategory.textContent = '--';
      momTopShiftDetail.textContent = 'No shift recorded';
    } else {
      momTopShiftCategory.textContent = mom.topCat;
      const sign = mom.topDiff > 0 ? '+' : '-';
      momTopShiftDetail.textContent = `${sign}${formatINR(Math.abs(mom.topDiff))} vs ${prevLabel}`;
    }
  }
}

function renderCategoryBreakdown(items = AnalyticsEngine.getMonthExpenses(activeMonth)) {
  if (!categoryDonut) return;
  const total = items.reduce((s, e) => s + Number(e.amount), 0);
  if (breakdownMonthLabel) breakdownMonthLabel.textContent = formatMonthLabel(activeMonth);

  const totals = { ...AnalyticsEngine.getCategoryTotals(activeMonth) };
  const caps = appData.categoryCaps || {};

  // Ensure categories with active caps appear even if ₹0 spent yet
  Object.keys(caps).forEach((cat) => {
    if (caps[cat] > 0 && totals[cat] === undefined) {
      totals[cat] = 0;
    }
  });

  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    categoryDonut.innerHTML = '<p class="empty-state">No expenses recorded yet.</p>';
    return;
  }

  const totalText = formatINR(total);
  const barsHtml = sorted
    .map(([cat, val]) => {
      const cap = Number(caps[cat] || 0);
      const sharePct = total > 0 ? Math.round((val / total) * 100) : 0;
      const barPct =
        cap > 0
          ? Math.min(100, Math.max(val > 0 ? 2 : 0, Math.round((val / cap) * 100)))
          : total > 0
            ? Math.min(100, Math.max(1, sharePct))
            : 0;

      let capStateClass = '';
      let capBadgeHtml = '';
      if (cap > 0) {
        const capRatio = (val / cap) * 100;
        if (capRatio > 100) capStateClass = 'cap-over';
        else if (capRatio >= 80) capStateClass = 'cap-warn';
        capBadgeHtml = `<span class="cap-badge ${capStateClass}">Cap ${formatINR(cap)}</span>`;
      }

      const catCls = CATEGORY_CLASS[cat] || 'cat-other';
      return `
        <li class="cat-bar-item ${catCls} ${capStateClass}">
          <div class="cat-bar-top">
            <span class="cat-bar-label">
              <span class="donut-dot"></span>
              <span class="donut-legend-name">${escapeHtml(cat)}</span>
              ${capBadgeHtml}
            </span>
            <span class="cat-bar-values">
              <span class="donut-legend-amt">${formatINR(val)}</span>
              <span class="donut-legend-pct">${cap > 0 ? Math.round((val / cap) * 100) : sharePct}%</span>
            </span>
          </div>
          <div class="cat-bar-track">
            <div class="cat-bar-fill ${capStateClass} w-${barPct}"></div>
          </div>
        </li>
      `;
    })
    .join('');

  categoryDonut.innerHTML = `
    <div class="cat-bars-summary">
      <span class="muted-text">Total Spent</span>
      <strong>${totalText}</strong>
    </div>
    <ul class="cat-bars-list">${barsHtml}</ul>
  `;
}

function renderRecent(all = AnalyticsEngine.getMonthExpenses(activeMonth)) {
  if (!recentList || !recentCount) return;
  if (all.length === 0) {
    recentCount.textContent = `No entries in ${formatMonthLabel(activeMonth)}`;
    recentList.innerHTML = '<p class="empty-state">No expenses in this month yet.</p>';
    if (recentSeeAllBtn) recentSeeAllBtn.classList.add('hidden');
    return;
  }
  const latest = all.slice(0, 3);
  recentCount.textContent = `Latest ${latest.length} of ${all.length}`;
  recentList.innerHTML = latest.map(renderTransactionRow).join('');
  if (recentSeeAllBtn) recentSeeAllBtn.classList.remove('hidden');
}

function renderTransactions(monthItems = AnalyticsEngine.getMonthExpenses(activeMonth)) {
  const catFilter = filterCategory.value;
  const modeFilter = filterPayment.value;
  const query = searchInput.value.trim().toLowerCase();

  const filtered = monthItems
    .filter((e) => (catFilter === 'ALL' ? true : e.category === catFilter))
    .filter((e) => (modeFilter === 'ALL' ? true : e.mode === modeFilter))
    .filter((e) => {
      if (!query) return true;
      return (
        (e.note && e.note.toLowerCase().includes(query)) ||
        e.category.toLowerCase().includes(query) ||
        e.mode.toLowerCase().includes(query) ||
        String(e.amount).includes(query)
      );
    });

  historyCount.textContent = `Showing ${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`;

  if (filtered.length === 0) {
    transactionList.innerHTML =
      '<p class="empty-state">No matching expenses for this month.</p>';
    return;
  }

  transactionList.innerHTML = filtered.map(renderTransactionRow).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================================
   16. SHORTCUTS MANAGER & MONTHLY FIXED BILLS MANAGER
   ============================================================================ */
const TAB_KEY = 'expenseflow_mobile_tab';
const TABS = ['home', 'transactions', 'insights', 'more'];
const KEYBOARD_INPUT_TYPES = ['text', 'number', 'search', 'email', 'tel', 'url', 'password'];

const tabbar = document.getElementById('mobileTabbar');
const tabButtons = tabbar ? Array.from(tabbar.querySelectorAll('.mobile-tab')) : [];
const moreList = document.getElementById('moreList');

const openQuickAddBtn = document.getElementById('openQuickAddBtn');
const openRecurringQuickBtn = document.getElementById('openRecurringQuickBtn');
const saveAsShortcutBtn = document.getElementById('saveAsShortcutBtn');
const shortcutsModal = document.getElementById('shortcutsModal');
const addNewShortcutModalBtn = document.getElementById('addNewShortcutModalBtn');
const closeShortcutsBtn = document.getElementById('closeShortcutsBtn');
const closeShortcutsFooterBtn = document.getElementById('closeShortcutsFooterBtn');
const shortcutsList = document.getElementById('shortcutsList');

const quickLogConfirmBox = document.getElementById('quickLogConfirmBox');
const quickLogConfirmTitle = document.getElementById('quickLogConfirmTitle');
const quickLogConfirmMeta = document.getElementById('quickLogConfirmMeta');
const quickLogAmountInput = document.getElementById('quickLogAmountInput');
const confirmQuickLogBtn = document.getElementById('confirmQuickLogBtn');
const cancelQuickLogBtn = document.getElementById('cancelQuickLogBtn');

const shortcutEditorBox = document.getElementById('shortcutEditorBox');
const shortcutEditorTitle = document.getElementById('shortcutEditorTitle');
const scAmount = document.getElementById('scAmount');
const scCategory = document.getElementById('scCategory');
const scMode = document.getElementById('scMode');
const scNote = document.getElementById('scNote');
const saveShortcutEditBtn = document.getElementById('saveShortcutEditBtn');
const cancelShortcutEditBtn = document.getElementById('cancelShortcutEditBtn');

let editingShortcutId = null;
let pendingQuickLogShortcut = null;

const recurringModal = document.getElementById('recurringModal');
const addNewRecurringBtn = document.getElementById('addNewRecurringBtn');
const closeRecurringBtn = document.getElementById('closeRecurringBtn');
const closeRecurringFooterBtn = document.getElementById('closeRecurringFooterBtn');
const applyRecurringNowBtn = document.getElementById('applyRecurringNowBtn');
const recurringEditorBox = document.getElementById('recurringEditorBox');
const recurringEditorTitle = document.getElementById('recurringEditorTitle');
const recAmount = document.getElementById('recAmount');
const recCategory = document.getElementById('recCategory');
const recMode = document.getElementById('recMode');
const recNote = document.getElementById('recNote');
const saveRecurringEditBtn = document.getElementById('saveRecurringEditBtn');
const cancelRecurringEditBtn = document.getElementById('cancelRecurringEditBtn');
const recurringList = document.getElementById('recurringList');

let editingRecurringId = null;

function getCurrentTab() {
  return document.body.getAttribute('data-mobile-tab') || 'home';
}

function pushModalHistoryState(modalName) {
  if (window.history && window.history.pushState) {
    window.history.pushState({ tab: getCurrentTab(), modal: modalName }, '');
  }
}

function closeShortcutsModalUI() {
  closeModal(shortcutsModal);
  shortcutEditorBox.classList.add('hidden');
  quickLogConfirmBox.classList.add('hidden');
  editingShortcutId = null;
  pendingQuickLogShortcut = null;
}

function openShortcutsModal(startInCreateMode = false) {
  editingShortcutId = null;
  pendingQuickLogShortcut = null;
  quickLogConfirmBox.classList.add('hidden');
  renderShortcutsList();
  if (shortcutsModal.classList.contains('hidden')) {
    pushModalHistoryState('shortcuts');
  }
  openModalWithFocus(shortcutsModal, startInCreateMode ? scAmount : addNewShortcutModalBtn);

  if (startInCreateMode) startCreateShortcut();
  else shortcutEditorBox.classList.add('hidden');
}

function closeShortcutsModal(fromPopState = false) {
  if (shortcutsModal.classList.contains('hidden')) return;
  closeShortcutsModalUI();
  if (!fromPopState && window.history && window.history.state && window.history.state.modal === 'shortcuts') {
    window.history.back();
  }
}

function startCreateShortcut() {
  editingShortcutId = null;
  pendingQuickLogShortcut = null;
  quickLogConfirmBox.classList.add('hidden');
  shortcutEditorTitle.textContent = 'New Shortcut';
  scAmount.value = '';
  scCategory.value = 'Food';
  scMode.value = 'Cash';
  scNote.value = '';
  shortcutEditorBox.classList.remove('hidden');
  setTimeout(() => scAmount.focus(), 40);
}

function startEditShortcut(sc) {
  editingShortcutId = sc.id;
  pendingQuickLogShortcut = null;
  quickLogConfirmBox.classList.add('hidden');
  shortcutEditorTitle.textContent = 'Edit Shortcut';
  scAmount.value = sc.amount;
  scCategory.value = sc.category;
  scMode.value = sc.mode;
  scNote.value = sc.note || '';
  shortcutEditorBox.classList.remove('hidden');
  setTimeout(() => {
    scAmount.focus();
    scAmount.select();
  }, 40);
}

function promptShortcutAmount(sc) {
  pendingQuickLogShortcut = sc;
  shortcutEditorBox.classList.add('hidden');
  const title = sc.note ? `${sc.note} (${sc.category})` : sc.category;
  quickLogConfirmTitle.textContent = `Add ${title}`;
  quickLogConfirmMeta.textContent = `${sc.mode} • Saved default: ${formatINR(sc.amount)} (stays unchanged)`;
  quickLogAmountInput.value = sc.amount;
  quickLogConfirmBox.classList.remove('hidden');
  setTimeout(() => {
    quickLogAmountInput.focus();
    quickLogAmountInput.select();
  }, 40);
}

async function commitShortcutExpense(sc, overrideAmount) {
  const finalAmount = Number(overrideAmount);
  if (!isValidAmount(finalAmount)) {
    quickLogAmountInput.focus();
    showAppToast('Enter a valid amount between ₹1 and ₹10,00,00,000');
    return;
  }

  const today = getTodayISO();
  const entry = {
    id: generateNumericId(),
    amount: finalAmount,
    category: sc.category,
    mode: sc.mode,
    date: today,
    note: (sc.note || '').slice(0, 60),
    updatedAt: Date.now()
  };

  appData.expenses.unshift(entry);
  const entryMonth = today.slice(0, 7);
  if (entryMonth !== activeMonth) {
    activeMonth = entryMonth;
    activeMonthInput.value = activeMonth;
  }

  closeShortcutsModal(false);
  renderAll({ soundCue: 'deducted', targetYm: entryMonth });
  await StorageService.saveData(appData);
  showAppToast(`Added ${formatINR(entry.amount)} — Undo`, entry.id);
}

if (openQuickAddBtn) openQuickAddBtn.addEventListener('click', () => openShortcutsModal(false));
if (openRecurringQuickBtn) openRecurringQuickBtn.addEventListener('click', openRecurringModal);
if (headerShortcutsBtn) headerShortcutsBtn.addEventListener('click', () => openShortcutsModal(false));
if (addNewShortcutModalBtn) addNewShortcutModalBtn.addEventListener('click', startCreateShortcut);
if (closeShortcutsBtn) closeShortcutsBtn.addEventListener('click', () => closeShortcutsModal(false));
if (closeShortcutsFooterBtn) closeShortcutsFooterBtn.addEventListener('click', () => closeShortcutsModal(false));

confirmQuickLogBtn.addEventListener('click', async () => {
  if (!pendingQuickLogShortcut) return;
  await commitShortcutExpense(pendingQuickLogShortcut, quickLogAmountInput.value);
});

cancelQuickLogBtn.addEventListener('click', () => {
  pendingQuickLogShortcut = null;
  quickLogConfirmBox.classList.add('hidden');
});

quickLogAmountInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmQuickLogBtn.click();
  }
});

if (saveAsShortcutBtn) {
  saveAsShortcutBtn.addEventListener('click', async () => {
    const amount = parseFloat(amountInput.value);
    if (!isValidAmount(amount)) {
      amountInput.focus();
      showAppToast('Enter a valid amount first');
      return;
    }

    const mode = selectedMode === 'Cash' ? 'Cash' : selectedUpiType;
    const shortcut = {
      id: generateNumericId(),
      amount,
      category: categoryInput.value,
      mode,
      note: noteInput.value.trim().slice(0, 40),
      updatedAt: Date.now()
    };

    appData.shortcuts.push(shortcut);
    await StorageService.saveData(appData);
    renderMoreList();
    showAppToast(`Saved shortcut: ${formatINR(amount)}`);
  });
}

cancelShortcutEditBtn.addEventListener('click', () => {
  editingShortcutId = null;
  shortcutEditorBox.classList.add('hidden');
});

saveShortcutEditBtn.addEventListener('click', async () => {
  const val = parseFloat(scAmount.value);
  if (!isValidAmount(val)) {
    scAmount.focus();
    showAppToast('Enter a valid amount between ₹1 and ₹10,00,00,000');
    return;
  }

  if (editingShortcutId === null) {
    appData.shortcuts.push({
      id: generateNumericId(),
      amount: val,
      category: scCategory.value,
      mode: scMode.value,
      note: scNote.value.trim().slice(0, 40),
      updatedAt: Date.now()
    });
    await StorageService.saveData(appData);
    showAppToast(`Saved shortcut: ${formatINR(val)}`);
  } else {
    const idx = appData.shortcuts.findIndex((s) => normalizeId(s.id) === editingShortcutId);
    if (idx !== -1) {
      appData.shortcuts[idx] = {
        ...appData.shortcuts[idx],
        amount: val,
        category: scCategory.value,
        mode: scMode.value,
        note: scNote.value.trim().slice(0, 40),
        updatedAt: Date.now()
      };
      await StorageService.saveData(appData);
      showAppToast('Shortcut updated');
    }
  }

  editingShortcutId = null;
  shortcutEditorBox.classList.add('hidden');
  renderShortcutsList();
  renderMoreList();
});

function renderShortcutsList() {
  if (!shortcutsList) return;
  if (!appData.shortcuts || appData.shortcuts.length === 0) {
    shortcutsList.innerHTML =
      '<p class="empty-state">No shortcuts yet. Tap <strong>+ Add</strong> above or <strong>Save shortcut</strong> on Add Expense.</p>';
    return;
  }

  shortcutsList.innerHTML = appData.shortcuts
    .map((sc, idx) => {
      const meta = MODE_META[sc.mode] || MODE_META.Cash;
      const titleText = sc.note ? escapeHtml(sc.note) : escapeHtml(sc.category);
      const subText = sc.note ? `${escapeHtml(sc.category)} • ` : '';
      const labelForAria = escapeHtml(sc.note || sc.category);

      return `
        <div class="shortcut-row" data-sc-id="${sc.id}">
          <button type="button" class="shortcut-tap-area" data-sc-action="use" aria-label="Use shortcut ${labelForAria} ${formatINR(sc.amount)}">
            <div class="shortcut-main">
              <strong>${titleText}</strong>
              <span class="shortcut-amt">${formatINR(sc.amount)}</span>
            </div>
            <div class="shortcut-sub">
              <span>${subText}</span>
              <span class="badge ${meta.cls}">${meta.label}</span>
            </div>
          </button>
          <div class="shortcut-controls">
            <button type="button" class="sc-icon-btn" data-sc-action="up" ${idx === 0 ? 'disabled' : ''} aria-label="Move ${labelForAria} shortcut up" title="Move up">${renderSvg('arrowUp', 'ui-svg-xs')}</button>
            <button type="button" class="sc-icon-btn" data-sc-action="down" ${idx === appData.shortcuts.length - 1 ? 'disabled' : ''} aria-label="Move ${labelForAria} shortcut down" title="Move down">${renderSvg('arrowDown', 'ui-svg-xs')}</button>
            <button type="button" class="sc-icon-btn" data-sc-action="edit" aria-label="Edit ${labelForAria} shortcut" title="Edit">${renderSvg('edit', 'ui-svg-xs')}</button>
            <button type="button" class="sc-icon-btn sc-del" data-sc-action="delete" aria-label="Delete ${labelForAria} shortcut" title="Delete">${renderSvg('close', 'ui-svg-xs')}</button>
          </div>
        </div>
      `;
    })
    .join('');
}

shortcutsList.addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('[data-sc-action]');
  const row = e.target.closest('.shortcut-row');
  if (!actionBtn || !row) return;

  const id = normalizeId(row.dataset.scId);
  const idx = appData.shortcuts.findIndex((s) => normalizeId(s.id) === id);
  if (idx === -1) return;

  const action = actionBtn.dataset.scAction;
  if (action === 'use') {
    promptShortcutAmount(appData.shortcuts[idx]);
  } else if (action === 'edit') {
    startEditShortcut(appData.shortcuts[idx]);
  } else if (action === 'delete') {
    recordTombstone(id);
    appData.shortcuts.splice(idx, 1);
    await StorageService.saveData(appData);
    renderShortcutsList();
    renderMoreList();
    showAppToast('Shortcut deleted');
  } else if (action === 'up' && idx > 0) {
    const temp = appData.shortcuts[idx - 1];
    appData.shortcuts[idx - 1] = appData.shortcuts[idx];
    appData.shortcuts[idx] = temp;
    await StorageService.saveData(appData);
    renderShortcutsList();
  } else if (action === 'down' && idx < appData.shortcuts.length - 1) {
    const temp = appData.shortcuts[idx + 1];
    appData.shortcuts[idx + 1] = appData.shortcuts[idx];
    appData.shortcuts[idx] = temp;
    await StorageService.saveData(appData);
    renderShortcutsList();
  }
});

/* Recurring Bills Manager */
function closeRecurringModalUI() {
  closeModal(recurringModal);
  recurringEditorBox.classList.add('hidden');
  editingRecurringId = null;
}

function openRecurringModal() {
  editingRecurringId = null;
  recurringEditorBox.classList.add('hidden');
  renderRecurringList();
  if (recurringModal.classList.contains('hidden')) {
    pushModalHistoryState('recurring');
  }
  openModalWithFocus(recurringModal, addNewRecurringBtn);
}

function closeRecurringModal(fromPopState = false) {
  if (recurringModal.classList.contains('hidden')) return;
  closeRecurringModalUI();
  if (!fromPopState && window.history && window.history.state && window.history.state.modal === 'recurring') {
    window.history.back();
  }
}

function startCreateRecurring() {
  editingRecurringId = null;
  recurringEditorTitle.textContent = 'New Monthly Bill';
  recAmount.value = '';
  recCategory.value = 'Room/Hostel';
  recMode.value = 'Bank Account';
  recNote.value = '';
  recurringEditorBox.classList.remove('hidden');
  setTimeout(() => recAmount.focus(), 40);
}

function startEditRecurring(bill) {
  editingRecurringId = normalizeId(bill.id);
  recurringEditorTitle.textContent = 'Edit Monthly Bill';
  recAmount.value = bill.amount;
  recCategory.value = bill.category;
  recMode.value = bill.mode;
  recNote.value = bill.note || '';
  recurringEditorBox.classList.remove('hidden');
  setTimeout(() => {
    recAmount.focus();
    recAmount.select();
  }, 40);
}

async function addSingleRecurringBillNow(bill) {
  const todayIso = getTodayISO();
  const billDate = activeMonth === todayIso.slice(0, 7) ? todayIso : `${activeMonth}-01`;
  const entry = {
    id: generateNumericId(),
    amount: Number(bill.amount),
    category: bill.category,
    mode: bill.mode,
    date: billDate,
    note: bill.note || 'Monthly Fixed Bill',
    updatedAt: Date.now()
  };

  appData.expenses.unshift(entry);
  closeRecurringModal(false);
  renderAll({ soundCue: 'deducted', targetYm: activeMonth });
  await StorageService.saveData(appData);
  showAppToast(`Added ${formatINR(entry.amount)} — Undo`, entry.id);
}

if (addNewRecurringBtn) addNewRecurringBtn.addEventListener('click', startCreateRecurring);
if (closeRecurringBtn) closeRecurringBtn.addEventListener('click', () => closeRecurringModal(false));
if (closeRecurringFooterBtn) closeRecurringFooterBtn.addEventListener('click', () => closeRecurringModal(false));
if (cancelRecurringEditBtn) {
  cancelRecurringEditBtn.addEventListener('click', () => {
    editingRecurringId = null;
    recurringEditorBox.classList.add('hidden');
  });
}

if (saveRecurringEditBtn) {
  saveRecurringEditBtn.addEventListener('click', async () => {
    const val = parseFloat(recAmount.value);
    if (!isValidAmount(val)) {
      recAmount.focus();
      showAppToast('Enter a valid amount between ₹1 and ₹10,00,00,000');
      return;
    }

    if (editingRecurringId === null) {
      appData.recurring.push({
        id: generateNumericId(),
        amount: val,
        category: recCategory.value,
        mode: recMode.value,
        note: recNote.value.trim().slice(0, 40),
        updatedAt: Date.now()
      });
      await StorageService.saveData(appData);
      showAppToast(`Saved monthly bill: ${formatINR(val)}`);
    } else {
      const idx = appData.recurring.findIndex((r) => normalizeId(r.id) === editingRecurringId);
      if (idx !== -1) {
        appData.recurring[idx] = {
          ...appData.recurring[idx],
          amount: val,
          category: recCategory.value,
          mode: recMode.value,
          note: recNote.value.trim().slice(0, 40),
          updatedAt: Date.now()
        };
        await StorageService.saveData(appData);
        showAppToast('Monthly bill updated');
      }
    }

    editingRecurringId = null;
    recurringEditorBox.classList.add('hidden');
    renderRecurringList();
    renderMoreList();
  });
}

if (applyRecurringNowBtn) {
  applyRecurringNowBtn.addEventListener('click', async () => {
    const bills = appData.recurring || [];
    if (bills.length === 0) {
      showAppToast('Add a monthly bill first using + Add');
      return;
    }
    const todayIso = getTodayISO();
    const billDate = activeMonth === todayIso.slice(0, 7) ? todayIso : `${activeMonth}-01`;
    bills.forEach((bill, idx) => {
      appData.expenses.unshift({
        id: generateNumericId() + idx * 1000,
        amount: Number(bill.amount),
        category: bill.category,
        mode: bill.mode,
        date: billDate,
        note: bill.note || 'Monthly Fixed Bill',
        updatedAt: Date.now()
      });
    });

    closeRecurringModal(false);
    renderAll({ soundCue: 'deducted', targetYm: activeMonth });
    await StorageService.saveData(appData);
    showAppToast(`Added ${bills.length} recurring ${bills.length === 1 ? 'bill' : 'bills'} to ${formatMonthLabel(activeMonth)}`);
  });
}

function renderRecurringList() {
  if (!recurringList) return;
  const bills = appData.recurring || [];
  if (bills.length === 0) {
    recurringList.innerHTML =
      '<p class="empty-state">No fixed monthly bills yet. Tap <strong>+ Add</strong> above for Rent, Wi-Fi, or Mess bills.</p>';
    return;
  }

  recurringList.innerHTML = bills
    .map((bill) => {
      const meta = MODE_META[bill.mode] || MODE_META.Cash;
      const titleText = bill.note ? escapeHtml(bill.note) : escapeHtml(bill.category);
      const subText = bill.note ? `${escapeHtml(bill.category)} • ` : '';
      const labelForAria = escapeHtml(bill.note || bill.category);

      return `
        <div class="shortcut-row" data-rec-id="${bill.id}">
          <button type="button" class="shortcut-tap-area" data-rec-action="use" aria-label="Add ${labelForAria} ${formatINR(bill.amount)} now" title="Tap to log this bill now">
            <div class="shortcut-main">
              <strong>${titleText}</strong>
              <span class="shortcut-amt">${formatINR(bill.amount)} / mo</span>
            </div>
            <div class="shortcut-sub">
              <span>${subText}Tap to add now • </span>
              <span class="badge ${meta.cls}">${meta.label}</span>
            </div>
          </button>
          <div class="shortcut-controls">
            <button type="button" class="sc-icon-btn" data-rec-action="edit" aria-label="Edit ${labelForAria} monthly bill" title="Edit">${renderSvg('edit', 'ui-svg-xs')}</button>
            <button type="button" class="sc-icon-btn sc-del" data-rec-action="delete" aria-label="Delete ${labelForAria} monthly bill" title="Delete">${renderSvg('close', 'ui-svg-xs')}</button>
          </div>
        </div>
      `;
    })
    .join('');
}

if (recurringList) {
  recurringList.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-rec-action]');
    const row = e.target.closest('.shortcut-row');
    if (!actionBtn || !row) return;

    const id = normalizeId(row.dataset.recId);
    const idx = appData.recurring.findIndex((r) => normalizeId(r.id) === id);
    if (idx === -1) return;

    const action = actionBtn.dataset.recAction;
    if (action === 'use') {
      await addSingleRecurringBillNow(appData.recurring[idx]);
    } else if (action === 'edit') {
      startEditRecurring(appData.recurring[idx]);
    } else if (action === 'delete') {
      recordTombstone(id);
      appData.recurring.splice(idx, 1);
      await StorageService.saveData(appData);
      renderRecurringList();
      renderMoreList();
      showAppToast('Monthly bill removed');
    }
  });
}

/* ============================================================================
   17. MOBILE TABS & UNIFIED HISTORY STATE MACHINE
   ============================================================================ */
function readSavedTab() {
  const t = safeGetItem(TAB_KEY, 'home');
  return TABS.includes(t) ? t : 'home';
}

function applyTabUI(tab, scrollTop) {
  if (!TABS.includes(tab)) tab = 'home';
  document.body.setAttribute('data-mobile-tab', tab);
  tabButtons.forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  safeSetItem(TAB_KEY, tab);
  if (scrollTop) window.scrollTo(0, 0);
}

function setTab(tab, scrollTop, fromPopState = false) {
  if (!TABS.includes(tab)) tab = 'home';
  const prevTab = getCurrentTab();

  if (!fromPopState && window.history && window.history.pushState && prevTab !== tab) {
    if (tab === 'home') {
      if (window.history.state && window.history.state.tab && window.history.state.tab !== 'home') {
        applyTabUI('home', scrollTop);
        window.history.back();
        return;
      }
      window.history.replaceState({ tab: 'home' }, '');
    } else if (prevTab === 'home') {
      window.history.pushState({ tab }, '');
    } else {
      window.history.replaceState({ tab }, '');
    }
  }

  applyTabUI(tab, scrollTop);
}

window.addEventListener('popstate', (event) => {
  if (backupHubModal && !backupHubModal.classList.contains('hidden')) {
    closeModal(backupHubModal);
    return;
  }
  if (planCapsHubModal && !planCapsHubModal.classList.contains('hidden')) {
    closeModal(planCapsHubModal);
    return;
  }
  if (editTxModal && !editTxModal.classList.contains('hidden')) {
    closeEditTransactionModal();
    return;
  }
  if (categoryCapsModal && !categoryCapsModal.classList.contains('hidden')) {
    closeModal(categoryCapsModal);
    return;
  }
  if (funEditionModal && !funEditionModal.classList.contains('hidden')) {
    closeModal(funEditionModal);
    return;
  }
  if (!recurringModal.classList.contains('hidden')) {
    closeRecurringModalUI();
    return;
  }
  if (!shortcutsModal.classList.contains('hidden')) {
    closeShortcutsModalUI();
    return;
  }
  if (budgetPromptModal && !budgetPromptModal.classList.contains('hidden')) {
    closeModal(budgetPromptModal);
    return;
  }
  if (welcomeModal && !welcomeModal.classList.contains('hidden')) {
    closeModal(welcomeModal);
    return;
  }
  const targetTab = event.state && TABS.includes(event.state.tab) ? event.state.tab : 'home';
  applyTabUI(targetTab, false);
});

if (tabbar) {
  tabbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.mobile-tab');
    if (btn) setTab(btn.dataset.tab, true, false);
  });
}

if (recentSeeAllBtn) {
  recentSeeAllBtn.addEventListener('click', () => setTab('transactions', true, false));
}

function isKeyboardField(el) {
  if (!el || !el.tagName) return false;
  if (el.closest('.modal-backdrop')) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return KEYBOARD_INPUT_TYPES.includes((el.getAttribute('type') || 'text').toLowerCase());
}

function syncKeyboardState() {
  document.body.classList.toggle('mtab-kb-open', isKeyboardField(document.activeElement));
}

document.addEventListener('focusin', syncKeyboardState);
document.addEventListener('focusout', () => setTimeout(syncKeyboardState, 0));

function getMoreItems() {
  const scCount = (appData.shortcuts || []).length;
  const recCount = (appData.recurring || []).length;
  const capsCount = Object.keys(appData.categoryCaps || {}).length;
  const soundOn = SoundService.isEnabled();
  return [
    {
      icon: 'bolt',
      title: 'Shortcuts',
      desc: 'Add, edit, or quick-log saved expenses',
      tag: `${scCount}`,
      action: () => openShortcutsModal(false)
    },
    {
      icon: 'repeat',
      title: 'Monthly Fixed Bills',
      desc: 'Rent, Wi-Fi & recurring monthly bills',
      tag: `${recCount}`,
      action: openRecurringModal
    },
    {
      icon: 'gridCaps',
      title: 'Category Monthly Caps',
      desc: 'Set spending caps per category with alert bars',
      tag: `${capsCount}`,
      action: openCategoryCapsModal
    },
    {
      icon: soundOn ? 'volumeOn' : 'volumeOff',
      title: 'Sound Effects',
      desc: 'Audio feedback when adding or spending',
      tag: soundOn ? 'On' : 'Off',
      action: () => {
        const next = SoundService.toggle();
        renderMoreList();
        showAppToast(next ? 'Sound effects enabled' : 'Sound effects muted');
      }
    },
    {
      icon: 'download',
      title: 'Backup & Restore',
      desc: 'JSON snapshot backup, restore & CSV export',
      tag: '3 options',
      action: openBackupHubModal
    },
    {
      icon: 'spark',
      title: 'Fun Audio Edition',
      desc: 'Switch to reaction-sound version',
      action: openFunEditionWarning
    },
    {
      icon: 'info',
      title: 'App Info & Diagnostics',
      desc: 'Schema health, offline cache & rollback controls',
      action: () => openGuideBtn.click()
    }
  ];
}

function renderMoreList() {
  if (!moreList) return;
  const items = getMoreItems();
  moreList.innerHTML = items
    .map(
      (item, i) => `
    <button type="button" class="more-row" data-more-index="${i}">
      <span class="more-icon">${renderSvg(item.icon, '')}</span>
      <span class="more-text">
        <span class="more-title">${escapeHtml(item.title)}${
          item.tag ? ` <span class="more-tag">${escapeHtml(item.tag)}</span>` : ''
        }</span>
        <span class="more-desc">${escapeHtml(item.desc)}</span>
      </span>
      <span class="more-chevron">${renderSvg('chevron', '')}</span>
    </button>`
    )
    .join('');
}

if (moreList) {
  moreList.addEventListener('click', (e) => {
    const row = e.target.closest('.more-row');
    if (!row) return;
    const items = getMoreItems();
    const item = items[Number(row.dataset.moreIndex)];
    if (item && item.action) item.action();
  });
}

/* ============================================================================
   18. BUILT-IN SELF-TEST SUITE & SERVICE WORKER REGISTRATION (Rules 13, 17)
   ============================================================================ */
const AppSelfTest = {
  run() {
    try {
      // Test 1: XSS sanitization
      const escaped = escapeHtml('<script>alert(1)</script>');
      if (escaped.includes('<script>')) throw new Error('XSS escape check failed');

      // Test 2: Schema v4 pack/unpack roundtrip with categoryCaps
      const sample = StorageService.unpackData({
        b: { '2026-10': 3000, '2026-11': 2000 },
        cc: { Food: 1500 },
        e: [
          { i: 101, a: 500, c: 'Food', m: 'Cash', d: '2026-10-15', n: 'Test' },
          { i: 102, a: 800, c: 'Food', m: 'UPI Lite', d: '2026-11-10', n: 'Test2' }
        ]
      });
      if (sample.categoryCaps.Food !== 1500 || sample.expenses.length !== 2) {
        throw new Error('Schema unpack check failed');
      }

      // Test 3: Rollover & MoM analytics verification
      const metricsNov = AnalyticsEngine.calculateMonthMetrics('2026-11', sample);
      // Oct rollover = 3000 - 500 = 2500; Nov available = 2500 + 2000 = 4500; Nov remaining = 4500 - 800 = 3700
      if (metricsNov.rolloverIn !== 2500 || metricsNov.remainingBalance !== 3700) {
        throw new Error('Rollover math check failed');
      }

      const momNov = AnalyticsEngine.calculateMoMComparison('2026-11', sample);
      // Nov spent 800 vs Oct spent 500 -> +60%
      if (momNov.pctChange !== 60 || momNov.topCat !== 'Food') {
        throw new Error('MoM analytics check failed');
      }

      AnalyticsEngine.invalidate();
      Diagnostics.selfTestStatus = 'Passed (4/4)';
      return true;
    } catch (err) {
      AnalyticsEngine.invalidate();
      Diagnostics.recordError('SelfTest', err);
      Diagnostics.selfTestStatus = `Failed (${err.message})`;
      return false;
    }
  }
};

function registerOfflineServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    Diagnostics.swStatus = 'Unsupported';
    return;
  }
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    Diagnostics.swStatus = 'Requires HTTPS';
    return;
  }
  navigator.serviceWorker
    .register('./sw.js')
    .then(() => {
      Diagnostics.swStatus = 'Active (Offline Ready)';
      updateDiagnosticsReadout();
    })
    .catch((err) => {
      Diagnostics.recordError('ServiceWorker', err);
      Diagnostics.swStatus = 'Registration paused';
    });
}

/* ============================================================================
   19. BOOTSTRAPPING
   ============================================================================ */
function init() {
  populateCategorySelects();
  SoundService.preload();
  AppSelfTest.run();
  registerOfflineServiceWorker();

  const savedTheme = safeGetItem(StorageService.THEME_KEY, 'light');
  applyTheme(savedTheme, false);
  updateSoundToggleUI();

  activeMonthInput.value = activeMonth;
  dateInput.value = getTodayISO();

  previousMonthStatusByYm[activeMonth] = getMonthHealthStatus(
    AnalyticsEngine.calculateMonthMetrics(activeMonth)
  );

  updateDiagnosticsReadout();

  if (safeGetItem(StorageService.WELCOME_SEEN_KEY) !== 'true') {
    openModalWithFocus(welcomeModal, closeWelcomeBtn);
  } else {
    checkMonthlyBudgetPrompt();
  }

  if (StorageService.isDriveOptedIn()) {
    updateSyncUI('Saved Locally (Sync Drive)', 'default');
    driveAuthBtn.textContent = 'Sync Drive';
  } else {
    updateSyncUI('Saved on Device', 'default');
  }

  renderMoreList();
  const initialTab = readSavedTab();
  applyTabUI(initialTab, false);
  if (window.history && window.history.replaceState) {
    window.history.replaceState({ tab: 'home' }, '');
    if (initialTab !== 'home') {
      window.history.pushState({ tab: initialTab }, '');
    }
  }

  renderAll();
}

init();
