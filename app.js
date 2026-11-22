/**
 * ============================================================================
 * GOOGLE CLOUD OAUTH CLIENT ID & APP CONSTANTS
 * ============================================================================
 */
const GOOGLE_CLIENT_ID = '381251059137-hkv6bjlmcjg0i32qqblt0h0dubemdgap.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILE_NAME = 'expense.json';
const MAX_AMOUNT = 100000000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* AUD-12: Single Source of Truth for Expense Categories */
const CATEGORIES = [
  { value: 'Food', label: 'Food', cls: 'cat-food' },
  { value: 'Travel', label: 'Travel', cls: 'cat-travel' },
  { value: 'Room/Hostel', label: 'Room / Hostel', cls: 'cat-room' },
  { value: 'Study', label: 'Study', cls: 'cat-study' },
  { value: 'Shopping', label: 'Shopping', cls: 'cat-shopping' },
  { value: 'Other', label: 'Other', cls: 'cat-other' }
];

const CATEGORY_CLASS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.cls]));

/* AUD-11: Declarative Payment Mode Lookup */
const MODE_META = {
  Cash: { cls: 'badge-cash', label: 'Cash' },
  'UPI Lite': { cls: 'badge-lite', label: 'UPI • Lite' },
  'Bank Account': { cls: 'badge-bank', label: 'UPI • Bank' },
  'UPI Bank': { cls: 'badge-bank', label: 'UPI • Bank' }
};

/* ============================================================================
   RELEASE C: SOUND SERVICE (Inbuilt Web Audio API Synthesizer for User Edition)
   ============================================================================ */
const SoundService = {
  SOUND_KEY: 'expenseflow_sound_enabled',
  ctx: null,
  /* Set USE_MEME_AUDIO = true in your Friends Edition alongside a /sounds/ folder */
  USE_MEME_AUDIO: false,
  MEME_FILES: {
    added: 'sounds/added.mp3',
    deducted: 'sounds/deducted.mp3',
    orange: 'sounds/orange.mp3',
    red: 'sounds/red.mp3'
  },

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

  getContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  },

  playTone(freq, startOffset, duration, type = 'sine', peakGain = 0.14, endFreq = null) {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  },

  play(cue) {
    if (!this.isEnabled()) return;
    if (this.USE_MEME_AUDIO && this.MEME_FILES[cue]) {
      try {
        const audio = new Audio(this.MEME_FILES[cue]);
        audio.play().catch(() => {});
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      if (cue === 'added') {
        /* Playful coin chime (B5 -> E6) */
        this.playTone(987.77, 0, 0.11, 'triangle', 0.15);
        this.playTone(1318.51, 0.09, 0.24, 'triangle', 0.16);
      } else if (cue === 'deducted') {
        /* Snappy cash-drawer pop */
        this.playTone(460, 0, 0.13, 'sine', 0.14, 175);
      } else if (cue === 'orange') {
        /* Double-tap playful nudge when crossing into Careful (Orange) */
        this.playTone(587.33, 0, 0.11, 'triangle', 0.14);
        this.playTone(523.25, 0.14, 0.14, 'triangle', 0.14);
      } else if (cue === 'red') {
        /* Retro descending wah-wah-waaaah when crossing into Over/Danger (Red) */
        this.playTone(392.0, 0, 0.16, 'sawtooth', 0.09);
        this.playTone(369.99, 0.18, 0.16, 'sawtooth', 0.09);
        this.playTone(349.23, 0.36, 0.16, 'sawtooth', 0.09);
        this.playTone(329.63, 0.54, 0.38, 'sawtooth', 0.1, 246.94);
      }
    } catch {
      /* ignore audio block on restricted contexts */
    }
  }
};

/* ============================================================================
   SAFE STORAGE HELPERS (AUD-01, AUD-02, AUD-03, AUD-06)
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
    console.error('localStorage write failed:', err);
    if (!storageWarningShown) {
      storageWarningShown = true;
      showAppToast('Storage full or blocked! Export CSV backup now.', null, 6500);
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

function generateNumericId() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return Date.now() * 1000 + (arr[0] % 1000);
  }
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function isValidAmount(val) {
  return typeof val === 'number' && Number.isFinite(val) && val > 0 && val <= MAX_AMOUNT;
}

function isValidBudgetAmount(val) {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= MAX_AMOUNT;
}

function isValidIsoDate(str) {
  if (typeof str !== 'string' || !ISO_DATE_RE.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * StorageService
 * - Primary storage is localStorage (instant, offline, zero sign-in required).
 * - AUD-03: Includes updatedAt timestamps & deletedIds tombstones for future Release D sync.
 */
const StorageService = {
  STORAGE_KEY: 'expenseflow_data_v3',
  FILE_ID_KEY: 'expenseflow_drive_file_id',
  DRIVE_PREF_KEY: 'expenseflow_drive_pref',
  THEME_KEY: 'expenseflow_theme',
  WELCOME_SEEN_KEY: 'expenseflow_welcome_seen',
  BUDGET_REMINDER_KEY: 'expenseflow_budget_reminder',
  accessToken: null,
  tokenClient: null,
  driveFileId: safeGetItem('expenseflow_drive_file_id', null),

  packData(data) {
    return JSON.stringify({
      v: 2,
      b: data.budgets || {},
      bt: data.budgetUpdatedAt || {},
      del: Array.isArray(data.deletedIds) ? data.deletedIds.slice(-300) : [],
      e: (data.expenses || []).map((x) => ({
        i: Number(x.id),
        a: Number(x.amount),
        c: x.category,
        m: x.mode,
        d: x.date,
        n: x.note || '',
        u: Number(x.updatedAt) || Number(x.id) || Date.now()
      })),
      s: (data.shortcuts || []).map((x) => ({
        i: Number(x.id),
        a: Number(x.amount),
        c: x.category,
        m: x.mode,
        n: x.note || '',
        u: Number(x.updatedAt) || Number(x.id) || Date.now()
      }))
    });
  },

  unpackData(raw) {
    const empty = { budgets: {}, budgetUpdatedAt: {}, deletedIds: [], expenses: [], shortcuts: [] };
    if (!raw || typeof raw !== 'object') return empty;

    const validCats = new Set(CATEGORIES.map((c) => c.value));
    const validModes = new Set(['Cash', 'UPI Lite', 'Bank Account', 'UPI Bank']);

    const sanitizeTx = (x) => {
      if (!x || typeof x !== 'object') return null;
      const amt = Number(x.a ?? x.amount);
      if (!isValidAmount(amt)) return null;
      const rawId = Number(x.i ?? x.id);
      const id = Number.isFinite(rawId) && rawId > 0 ? rawId : generateNumericId();
      const rawDate = x.d ?? x.date;
      const date = isValidIsoDate(rawDate) ? rawDate : getTodayISO();
      const rawCat = x.c ?? x.category;
      const category = validCats.has(rawCat) ? rawCat : 'Other';
      const rawMode = x.m ?? x.mode;
      const mode = validModes.has(rawMode) ? rawMode : 'Cash';
      const note = String(x.n ?? x.note ?? '').slice(0, 60);
      const updatedAt = Number(x.u ?? x.updatedAt) || id;
      return { id, amount: amt, category, mode, date, note, updatedAt };
    };

    const sanitizeShortcut = (x) => {
      if (!x || typeof x !== 'object') return null;
      const amt = Number(x.a ?? x.amount);
      if (!isValidAmount(amt)) return null;
      const rawId = Number(x.i ?? x.id);
      const id = Number.isFinite(rawId) && rawId > 0 ? rawId : generateNumericId();
      const rawCat = x.c ?? x.category;
      const category = validCats.has(rawCat) ? rawCat : 'Other';
      const rawMode = x.m ?? x.mode;
      const mode = validModes.has(rawMode) ? rawMode : 'Cash';
      const note = String(x.n ?? x.note ?? '').slice(0, 40);
      const updatedAt = Number(x.u ?? x.updatedAt) || id;
      return { id, amount: amt, category, mode, note, updatedAt };
    };

    const rawBudgets = raw.b !== undefined ? raw.b : raw.budgets;
    const budgets = {};
    if (rawBudgets && typeof rawBudgets === 'object') {
      Object.entries(rawBudgets).forEach(([ym, val]) => {
        const num = Number(val);
        if (/^\d{4}-\d{2}$/.test(ym) && isValidBudgetAmount(num)) {
          budgets[ym] = num;
        }
      });
    }

    const rawExpenses = raw.e !== undefined ? raw.e : raw.expenses;
    const rawShortcuts = raw.s !== undefined ? raw.s : raw.shortcuts;

    return {
      budgets,
      budgetUpdatedAt: raw.bt && typeof raw.bt === 'object' ? raw.bt : {},
      deletedIds: Array.isArray(raw.del) ? raw.del.map(Number).filter(Number.isFinite) : [],
      expenses: Array.isArray(rawExpenses) ? rawExpenses.map(sanitizeTx).filter(Boolean) : [],
      shortcuts: Array.isArray(rawShortcuts) ? rawShortcuts.map(sanitizeShortcut).filter(Boolean) : []
    };
  },

  loadLocal() {
    try {
      const raw = safeGetItem(this.STORAGE_KEY);
      if (!raw) return { budgets: {}, budgetUpdatedAt: {}, deletedIds: [], expenses: [], shortcuts: [] };
      return this.unpackData(JSON.parse(raw));
    } catch {
      return { budgets: {}, budgetUpdatedAt: {}, deletedIds: [], expenses: [], shortcuts: [] };
    }
  },

  saveLocal(data) {
    return safeSetItem(this.STORAGE_KEY, this.packData(data));
  },

  isDriveOptedIn() {
    return safeGetItem(this.DRIVE_PREF_KEY) === 'enabled';
  },

  isConfigured() {
    return GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('YOUR_GOOGLE_CLIENT_ID');
  },

  initTokenClient(callback) {
    if (!this.isConfigured() || typeof google === 'undefined' || !google.accounts) {
      return false;
    }
    if (!this.tokenClient) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
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
        reject(new Error('Google Identity Services not ready or Client ID missing.'));
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

    const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
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
    const metadata = { name: DRIVE_FILE_NAME, mimeType: 'application/json' };
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
    const savedOk = this.saveLocal(data);
    if (!savedOk) {
      updateSyncUI('Storage Full / Blocked', 'error');
      return;
    }
    if (!this.isDriveOptedIn()) {
      updateSyncUI('Saved on Device', 'default');
      return;
    }
    if (!this.accessToken) {
      updateSyncUI('Saved Locally (Click Sync Drive)', 'default');
      return;
    }
    try {
      updateSyncUI('Syncing to Drive...', 'syncing');
      await this.writeDriveData(data);
      updateSyncUI('Device + Drive Synced', 'connected');
    } catch (err) {
      console.error(err);
      updateSyncUI('Saved Locally (Drive paused)', 'error');
    }
  }
};

/* ============================================================================
   APP STATE & DOM REFERENCES
   ============================================================================ */
let appData = StorageService.loadLocal();
if (!Array.isArray(appData.shortcuts)) appData.shortcuts = [];
if (!Array.isArray(appData.deletedIds)) appData.deletedIds = [];
if (!appData.budgetUpdatedAt || typeof appData.budgetUpdatedAt !== 'object') appData.budgetUpdatedAt = {};

let selectedMode = 'Cash';
let selectedUpiType = 'UPI Lite';
let activeMonth = getCurrentMonth();
let pendingExpenseEntry = null;
let currentDailyFormulaText = 'Auto-set: Remaining balance ÷ days left in the month';
let previousMonthStatusByYm = {};

// Modals
const welcomeModal = document.getElementById('welcomeModal');
const closeWelcomeBtn = document.getElementById('closeWelcomeBtn');
const openGuideBtn = document.getElementById('openGuideBtn');

const budgetPromptModal = document.getElementById('budgetPromptModal');
const budgetPromptTitle = document.getElementById('budgetPromptTitle');
const budgetPromptMessage = document.getElementById('budgetPromptMessage');
const promptBudgetAmount = document.getElementById('promptBudgetAmount');
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
const soundToggleBtn = document.getElementById('soundToggleBtn');
const driveAuthBtn = document.getElementById('driveAuthBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportAllBackupBtn = document.getElementById('exportAllBackupBtn');
const drivePromptBanner = document.getElementById('drivePromptBanner');
const promptConnectBtn = document.getElementById('promptConnectBtn');
const promptDismissBtn = document.getElementById('promptDismissBtn');

// Summary Modules (Wallet, Spending, Payment Split)
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

const cashTotal = document.getElementById('cashTotal');
const upiLiteTotal = document.getElementById('upiLiteTotal');
const upiBankTotal = document.getElementById('upiBankTotal');

// Inline Budget Drawer
const budgetDrawer = document.getElementById('budgetDrawer');
const budgetDrawerTitle = document.getElementById('budgetDrawerTitle');
const budgetInput = document.getElementById('budgetInput');
const addFundsBtn = document.getElementById('addFundsBtn');
const replaceBudgetBtn = document.getElementById('replaceBudgetBtn');
const scheduleReminderDrawerBtn = document.getElementById('scheduleReminderDrawerBtn');
const resetBudgetBtn = document.getElementById('resetBudgetBtn');
const cancelBudgetBtn = document.getElementById('cancelBudgetBtn');

// Add Expense Form
const formCard = document.querySelector('.form-card');
const expenseForm = document.getElementById('expenseForm');
const amountInput = document.getElementById('amount');
const categoryInput = document.getElementById('category');
const paymentModeGroup = document.getElementById('paymentModeGroup');
const upiSubGroup = document.getElementById('upiSubGroup');
const upiTypeGroup = document.getElementById('upiTypeGroup');
const dateInput = document.getElementById('date');
const noteInput = document.getElementById('note');

// History & Breakdown
const historyCount = document.getElementById('historyCount');
const searchInput = document.getElementById('searchInput');
const filterCategory = document.getElementById('filterCategory');
const filterPayment = document.getElementById('filterPayment');
const transactionList = document.getElementById('transactionList');
const breakdownMonthLabel = document.getElementById('breakdownMonthLabel');
const categoryDonut = document.getElementById('categoryDonut');

// Recent 3 (Desktop + Mobile)
const recentList = document.getElementById('recentList');
const recentCount = document.getElementById('recentCount');
const recentSeeAllBtn = document.getElementById('recentSeeAllBtn');

// Shared Toast (Undo + Today's Limit Explanation + Storage Warnings)
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
   HELPERS, POPULATORS & FORMATTING (AUD-10, AUD-11, AUD-12)
   ============================================================================ */
function populateCategorySelects() {
  const scCategory = document.getElementById('scCategory');
  const formSelects = [categoryInput, scCategory].filter(Boolean);
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

function updateSyncUI(text, state = 'default') {
  storageStatus.textContent = text;
  storageStatus.className = 'storage-badge';
  if (state === 'connected') storageStatus.classList.add('connected');
  if (state === 'syncing') storageStatus.classList.add('syncing');
  if (state === 'error') storageStatus.classList.add('error');
}

function updateSoundToggleUI() {
  const on = SoundService.isEnabled();
  if (soundToggleBtn) {
    soundToggleBtn.textContent = on ? '🔊 Sound: On' : '🔇 Sound: Off';
  }
}

if (soundToggleBtn) {
  soundToggleBtn.addEventListener('click', () => {
    const enabled = SoundService.toggle();
    showAppToast(enabled ? 'Sound effects enabled' : 'Sound effects muted');
  });
}

/* AUD-10: Single Shared Month Selector & Transaction Row Renderer */
function getMonthExpenses(ym = activeMonth) {
  return appData.expenses
    .filter((e) => e.date.startsWith(ym))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

function renderTransactionRow(e) {
  const meta = MODE_META[e.mode] || MODE_META.Cash;
  const noteHtml = e.note ? ` • ${escapeHtml(e.note)}` : '';
  const ariaLabel = escapeHtml(`Delete ${e.category} ${formatINR(e.amount)}`);

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
        <button type="button" class="delete-btn" data-delete-id="${e.id}" aria-label="${ariaLabel}" title="Delete expense">✕</button>
      </div>
    </div>
  `;
}

/* ============================================================================
   THEME MANAGEMENT
   ============================================================================ */
function applyTheme(theme) {
  const isDark = theme === 'dark';
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeToggleBtn.textContent = 'Light Mode';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeToggleBtn.textContent = 'Dark Mode';
  }
  safeSetItem(StorageService.THEME_KEY, isDark ? 'dark' : 'light');
}

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ============================================================================
   GOOGLE DRIVE OPT-IN SYNC FLOW (RELEASE D DEFERRED — TEST MODE GUARD ACTIVE)
   ============================================================================ */
async function triggerDriveSync(promptMode = 'consent') {
  alert('Google Drive Backup is temporarily unavailable while the app is in testing mode. Your expenses remain safely saved on this device.');
  return;

  if (!StorageService.isConfigured()) {
    alert('Google Client ID missing in app.js.');
    return;
  }

  try {
    updateSyncUI('Connecting Drive...', 'syncing');
    await StorageService.requestToken(promptMode);
    await StorageService.findOrCreateDriveFile(appData);

    const cloudData = await StorageService.readDriveData();
    if (cloudData) {
      const deletedSet = new Set([...(appData.deletedIds || []), ...(cloudData.deletedIds || [])]);
      appData.deletedIds = Array.from(deletedSet);

      const mergedMap = new Map();
      [...(cloudData.expenses || []), ...(appData.expenses || [])].forEach((tx) => {
        if (deletedSet.has(tx.id)) return;
        const existing = mergedMap.get(tx.id);
        if (!existing || (tx.updatedAt || 0) >= (existing.updatedAt || 0)) {
          mergedMap.set(tx.id, tx);
        }
      });
      appData.expenses = Array.from(mergedMap.values()).sort(
        (a, b) => b.date.localeCompare(a.date) || b.id - a.id
      );

      const allBudgetMonths = new Set([
        ...Object.keys(cloudData.budgets || {}),
        ...Object.keys(appData.budgets || {})
      ]);
      allBudgetMonths.forEach((ym) => {
        const localTs = (appData.budgetUpdatedAt && appData.budgetUpdatedAt[ym]) || 0;
        const cloudTs = (cloudData.budgetUpdatedAt && cloudData.budgetUpdatedAt[ym]) || 0;
        if (cloudTs > localTs && cloudData.budgets[ym] !== undefined) {
          appData.budgets[ym] = cloudData.budgets[ym];
          appData.budgetUpdatedAt[ym] = cloudTs;
        }
      });

      const scMap = new Map();
      [...(cloudData.shortcuts || []), ...(appData.shortcuts || [])].forEach((sc) => {
        if (deletedSet.has(sc.id)) return;
        const existing = scMap.get(sc.id);
        if (!existing || (sc.updatedAt || 0) >= (existing.updatedAt || 0)) {
          scMap.set(sc.id, sc);
        }
      });
      appData.shortcuts = Array.from(scMap.values());
    }

    StorageService.saveLocal(appData);
    await StorageService.writeDriveData(appData);
    drivePromptBanner.classList.add('hidden');
    driveAuthBtn.textContent = 'Sync Drive Now';
    driveAuthBtn.classList.add('connected');
    updateSyncUI('Device + Drive Synced', 'connected');
    renderAll();
  } catch (err) {
    console.error(err);
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
   BUDGET & ROLLOVER LOGIC
   ============================================================================ */
function calculateMonthMetrics(targetYm) {
  const allMonths = new Set([
    ...Object.keys(appData.budgets),
    ...appData.expenses.map((e) => e.date.slice(0, 7)),
    targetYm
  ]);
  const sortedMonths = Array.from(allMonths).sort();

  let carryForward = 0;
  let targetMonthAdded = 0;
  let targetMonthSpent = 0;
  let targetRolloverIn = 0;

  for (const ym of sortedMonths) {
    if (ym > targetYm) break;
    const added = Number(appData.budgets[ym] || 0);
    const spent = appData.expenses
      .filter((e) => e.date.startsWith(ym))
      .reduce((sum, e) => sum + Number(e.amount), 0);

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
}

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

/* ============================================================================
   SMART MONTHLY BUDGET PROMPT, REMINDER VIEW & DELETE
   ============================================================================ */
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

deleteReminderBtn.addEventListener('click', () => {
  clearSavedReminder();
});

function openBudgetPrompt(targetMonth, reasonText, pendingEntry = null, showDateImmediately = false) {
  pendingExpenseEntry = pendingEntry;
  const label = formatMonthLabel(targetMonth);
  budgetPromptTitle.textContent = `Set ${label} Budget`;
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
  openModalWithFocus(budgetPromptModal, showDateImmediately ? budgetReminderDate : promptBudgetAmount);
}

function checkMonthlyBudgetPrompt() {
  const today = getTodayISO();
  const currentYm = today.slice(0, 7);
  const hasCurrentBudget = (Number(appData.budgets[currentYm]) || 0) > 0;

  if (hasCurrentBudget) return;

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

  openBudgetPrompt(
    currentYm,
    `Welcome to ${formatMonthLabel(currentYm)}! Set your monthly budget now to track your balance.`
  );
}

async function finalizePendingExpense() {
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
}

savePromptBudgetBtn.addEventListener('click', async () => {
  const val = parseFloat(promptBudgetAmount.value);
  if (!isValidAmount(val)) {
    promptBudgetAmount.focus();
    showAppToast('Enter a valid amount between ₹1 and ₹10,00,00,000');
    return;
  }

  const targetMonth = pendingExpenseEntry ? pendingExpenseEntry.date.slice(0, 7) : activeMonth;
  appData.budgets[targetMonth] = (Number(appData.budgets[targetMonth]) || 0) + val;
  appData.budgetUpdatedAt[targetMonth] = Date.now();
  clearSavedReminder();

  closeModal(budgetPromptModal);
  const hasPending = Boolean(pendingExpenseEntry);
  renderAll({ soundCue: hasPending ? null : 'added', targetYm: targetMonth });
  await StorageService.saveData(appData);
  await finalizePendingExpense();
});

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

  const targetMonth = pendingExpenseEntry ? pendingExpenseEntry.date.slice(0, 7) : activeMonth;
  safeSetItem(
    StorageService.BUDGET_REMINDER_KEY,
    JSON.stringify({ month: targetMonth, remindOn: chosenDate })
  );

  closeModal(budgetPromptModal);
  renderReminderChip();
  await finalizePendingExpense();
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
   AUD-07: MODAL FOCUS TRAP & ESCAPE KEY HANDLER
   ============================================================================ */
let lastFocusedBeforeModal = null;

function getVisibleModal() {
  const modals = [shortcutsModal, budgetPromptModal, welcomeModal].filter(Boolean);
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
    if (activeModal === shortcutsModal) {
      closeShortcutsModal(false);
    } else {
      closeModal(activeModal);
    }
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
   UI INTERACTIONS: PILLS, MODALS, INLINE BUDGET DRAWER & TODAY'S LIMIT INFO
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
  if (e.target.value && /^\d{4}-\d{2}$/.test(e.target.value)) {
    activeMonth = e.target.value;
    renderAll();
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

// Welcome / Privacy Modal
closeWelcomeBtn.addEventListener('click', () => {
  safeSetItem(StorageService.WELCOME_SEEN_KEY, 'true');
  closeModal(welcomeModal);
  checkMonthlyBudgetPrompt();
});

openGuideBtn.addEventListener('click', () => {
  openModalWithFocus(welcomeModal, closeWelcomeBtn);
});

// Tappable Today's Limit Formula Explanation
if (dailyAllowanceSub) {
  dailyAllowanceSub.addEventListener('click', () => {
    showAppToast(currentDailyFormulaText, null, 3800);
  });
}

// Inline Budget Drawer
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
    `Reset ${formatMonthLabel(activeMonth)} budget to ₹0? Your recorded expenses will not be deleted.`
  );
  if (!confirmed) return;
  delete appData.budgets[activeMonth];
  appData.budgetUpdatedAt[activeMonth] = Date.now();
  budgetDrawer.classList.add('hidden');
  renderAll();
  await StorageService.saveData(appData);
});

/* ============================================================================
   EXPENSE CRUD, DELEGATED DELETE (AUD-02) & SANITIZED CSV EXPORT (AUD-04)
   ============================================================================ */
expenseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
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
      `Before recording ₹${amount}, would you like to set your ${formatMonthLabel(entryMonth)} budget first?`,
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
  const numId = Number(id);
  if (!Number.isFinite(numId)) return;
  appData.expenses = appData.expenses.filter((item) => item.id !== numId);
  if (!appData.deletedIds.includes(numId)) {
    appData.deletedIds.push(numId);
  }
  renderAll();
  await StorageService.saveData(appData);
}

/* AUD-02: Delegated delete handlers on both History & Recent lists (no inline onclick) */
function handleTransactionListClick(e) {
  const delBtn = e.target.closest('[data-delete-id]');
  if (!delBtn) return;
  const id = Number(delBtn.dataset.deleteId);
  if (Number.isFinite(id)) {
    deleteExpenseById(id);
  }
}

transactionList.addEventListener('click', handleTransactionListClick);
if (recentList) {
  recentList.addEventListener('click', handleTransactionListClick);
}

/* AUD-04: CSV Formula Injection Neutralization + Blob Download (# safe) */
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
  const monthExpenses = getMonthExpenses(activeMonth);
  if (monthExpenses.length === 0) {
    alert(`No expenses recorded in ${formatMonthLabel(activeMonth)} to export.`);
    return;
  }
  downloadExpensesCsv(monthExpenses, activeMonth);
});

if (exportAllBackupBtn) {
  exportAllBackupBtn.addEventListener('click', () => {
    downloadExpensesCsv(appData.expenses, 'All_Months_Backup');
  });
}

filterCategory.addEventListener('change', renderTransactions);
filterPayment.addEventListener('change', renderTransactions);
searchInput.addEventListener('input', renderTransactions);

/* ============================================================================
   RENDERING ENGINE (CONSOLIDATED AUD-10/11 + RELEASE B + RELEASE C AUDIO)
   ============================================================================ */
function renderAll(options = {}) {
  const { soundCue = null, targetYm = activeMonth } = options;
  const prevStatus = previousMonthStatusByYm[targetYm];

  renderSummaryAndSplit();
  renderReminderChip();
  renderCategoryDonut();
  renderRecent();
  renderTransactions();

  const newStatus = getMonthHealthStatus(calculateMonthMetrics(targetYm));
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

function renderSummaryAndSplit() {
  const metrics = calculateMonthMetrics(activeMonth);
  const label = formatMonthLabel(activeMonth);
  const today = getTodayISO();

  // 1. Wallet Module
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

  budgetBarFill.style.width = `${barFillPct}%`;
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

  // 2. Spending Module
  const monthExpenses = getMonthExpenses(activeMonth);
  spentMonthLabel.textContent = `Spent (${label})`;
  monthTotal.textContent = formatINR(metrics.spentThisMonth);
  monthCount.textContent = `${monthExpenses.length} ${monthExpenses.length === 1 ? 'transaction' : 'transactions'}`;

  const todayExpenses = appData.expenses.filter((e) => e.date === today);
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
    dailyAllowanceSub.textContent = `Today's limit: ${formatINR(Math.round(todaysLimit))} ⓘ`;
    currentDailyFormulaText = `Auto-set: ${formatINR(currentBalance)} balance left ÷ ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
  } else if (todaySum > 0) {
    todayStatus = 'red';
    todayStatusWord = 'Over';
    dailyAllowanceSub.textContent = 'No allowance left ⓘ';
    currentDailyFormulaText = 'Auto-set: ₹0 balance remaining for the rest of this month';
  } else {
    dailyAllowanceSub.textContent = "Set budget for today's limit ⓘ";
    currentDailyFormulaText = 'Auto-set: Balance left ÷ days remaining once a monthly budget is added';
  }

  setStatusClass(todayStatusBadge, todayStatus);
  todayStatusBadge.textContent = todayStatusWord;

  // 3. Payment Split Module
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

/* Release B: Unified SVG Donut Breakdown for Desktop Left Column + Mobile Insights */
function renderCategoryDonut() {
  if (!categoryDonut) return;
  const R = 48;
  const C = 2 * Math.PI * R;
  const items = getMonthExpenses(activeMonth);
  const total = items.reduce((s, e) => s + Number(e.amount), 0);
  if (breakdownMonthLabel) breakdownMonthLabel.textContent = formatMonthLabel(activeMonth);

  const totals = {};
  items.forEach((e) => {
    totals[e.category] = (totals[e.category] || 0) + Number(e.amount);
  });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  let segments = '';
  if (total > 0) {
    const gap = sorted.length > 1 ? 1.2 : 0;
    let offset = 0;
    segments = sorted
      .map(([cat, val]) => {
        const len = (val / total) * C;
        const dash = Math.max(len - gap, 0.01);
        const seg = `<circle class="donut-seg ${CATEGORY_CLASS[cat] || 'cat-other'}" cx="60" cy="60" r="${R}"
          stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-offset}"></circle>`;
        offset += len;
        return seg;
      })
      .join('');
  } else {
    segments = `<circle class="donut-track" cx="60" cy="60" r="${R}"></circle>`;
  }

  const totalText = formatINR(total);
  const legend =
    total > 0
      ? `<ul class="donut-legend">${sorted
          .map(([cat, val]) => {
            const pct = Math.round((val / total) * 100);
            return `<li class="donut-legend-item">
              <span class="donut-dot ${CATEGORY_CLASS[cat] || 'cat-other'}"></span>
              <span class="donut-legend-name">${escapeHtml(cat)}</span>
              <span class="donut-legend-amt">${formatINR(val)}</span>
              <span class="donut-legend-pct">${pct}%</span>
            </li>`;
          })
          .join('')}</ul>`
      : '<p class="empty-state">No expenses recorded yet.</p>';

  categoryDonut.innerHTML = `
    <div class="donut-wrap">
      <svg class="donut-svg" viewBox="0 0 120 120" role="img" aria-label="Category breakdown: ${totalText} spent">
        <g transform="rotate(-90 60 60)">${segments}</g>
      </svg>
      <div class="donut-center">
        <strong class="${totalText.length > 9 ? 'is-long' : ''}">${totalText}</strong>
        <span>spent</span>
      </div>
    </div>
    ${legend}
  `;
}

/* Release B: Recent 3 Entries (Top of Right Column on Desktop, Home on Mobile) */
function renderRecent() {
  if (!recentList || !recentCount) return;
  const all = getMonthExpenses(activeMonth);
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

function renderTransactions() {
  const catFilter = filterCategory.value;
  const modeFilter = filterPayment.value;
  const query = searchInput.value.trim().toLowerCase();

  const filtered = getMonthExpenses(activeMonth)
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

/* AUD-05: Full HTML Escaping Including Single Quotes */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================================
   SHORTCUTS MANAGER & MOBILE NAVIGATION (Desktop + Mobile Unified)
   ============================================================================ */
const FEATURE_REQUEST_URL = '';
const TAB_KEY = 'expenseflow_mobile_tab';
const TABS = ['home', 'transactions', 'insights', 'more'];
const KEYBOARD_INPUT_TYPES = ['text', 'number', 'search', 'email', 'tel', 'url', 'password'];

const ICONS = {
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  backup: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5"/><path d="M12 7.5h.01"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>'
};

const tabbar = document.getElementById('mobileTabbar');
const tabButtons = tabbar ? Array.from(tabbar.querySelectorAll('.mobile-tab')) : [];
const moreList = document.getElementById('moreList');

const openQuickAddBtn = document.getElementById('openQuickAddBtn');
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

  if (startInCreateMode) {
    startCreateShortcut();
  } else {
    shortcutEditorBox.classList.add('hidden');
  }
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
  quickLogConfirmMeta.textContent = `${sc.mode} • Saved default: ${formatINR(sc.amount)} (won't change)`;
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

if (openQuickAddBtn) {
  openQuickAddBtn.addEventListener('click', () => openShortcutsModal(false));
}
if (headerShortcutsBtn) {
  headerShortcutsBtn.addEventListener('click', () => openShortcutsModal(false));
}
if (addNewShortcutModalBtn) {
  addNewShortcutModalBtn.addEventListener('click', startCreateShortcut);
}
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
    const idx = appData.shortcuts.findIndex((s) => s.id === editingShortcutId);
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
  if (!appData.shortcuts || appData.shortcuts.length === 0) {
    shortcutsList.innerHTML =
      '<p class="empty-state">No shortcuts yet. Tap <strong>+ Add</strong> above or <strong>☆ Save shortcut</strong> on Add Expense.</p>';
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
            <button type="button" class="sc-icon-btn" data-sc-action="up" ${idx === 0 ? 'disabled' : ''} aria-label="Move ${labelForAria} shortcut up" title="Move up">↑</button>
            <button type="button" class="sc-icon-btn" data-sc-action="down" ${idx === appData.shortcuts.length - 1 ? 'disabled' : ''} aria-label="Move ${labelForAria} shortcut down" title="Move down">↓</button>
            <button type="button" class="sc-icon-btn" data-sc-action="edit" aria-label="Edit ${labelForAria} shortcut" title="Edit">✎</button>
            <button type="button" class="sc-icon-btn sc-del" data-sc-action="delete" aria-label="Delete ${labelForAria} shortcut" title="Delete">✕</button>
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

  const id = Number(row.dataset.scId);
  const idx = appData.shortcuts.findIndex((s) => s.id === id);
  if (idx === -1) return;

  const action = actionBtn.dataset.scAction;
  if (action === 'use') {
    promptShortcutAmount(appData.shortcuts[idx]);
  } else if (action === 'edit') {
    startEditShortcut(appData.shortcuts[idx]);
  } else if (action === 'delete') {
    if (!appData.deletedIds.includes(id)) {
      appData.deletedIds.push(id);
    }
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

/* ---------- Mobile Tabs & Unified History State Machine (AUD-09) ---------- */
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

function svgIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function getMoreItems() {
  const count = (appData.shortcuts || []).length;
  const soundOn = SoundService.isEnabled();
  return [
    {
      icon: 'bolt',
      title: 'Shortcuts',
      desc: 'Add, edit, or quick-log your saved expenses',
      tag: `${count}`,
      action: () => openShortcutsModal(false)
    },
    {
      icon: 'volume',
      title: 'Sound Effects',
      desc: 'Playful audio feedback when adding or spending',
      tag: soundOn ? 'On' : 'Off',
      action: () => {
        const next = SoundService.toggle();
        renderMoreList();
        showAppToast(next ? 'Sound effects enabled' : 'Sound effects muted');
      }
    },
    {
      icon: 'backup',
      title: 'Backup All Months (CSV)',
      desc: 'Download every recorded month in one CSV file',
      action: () => downloadExpensesCsv(appData.expenses, 'All_Months_Backup')
    },
    {
      icon: 'bulb',
      title: 'Request a feature',
      desc: 'Tell us what you would like to see next',
      action: () => {
        if (FEATURE_REQUEST_URL) window.open(FEATURE_REQUEST_URL, '_blank', 'noopener');
        else showAppToast('Feature requests will open here soon');
      }
    },
    {
      icon: 'info',
      title: 'App Info & Privacy',
      desc: 'How your data is stored and kept private',
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
      <span class="more-icon">${svgIcon(item.icon)}</span>
      <span class="more-text">
        <span class="more-title">${escapeHtml(item.title)}${
          item.tag ? ` <span class="more-tag">${escapeHtml(item.tag)}</span>` : ''
        }</span>
        <span class="more-desc">${escapeHtml(item.desc)}</span>
      </span>
      <span class="more-chevron">${svgIcon('chevron')}</span>
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
   BOOTSTRAPPING (OFFLINE-FIRST, DEFAULT LIGHT MODE)
   ============================================================================ */
function init() {
  populateCategorySelects();

  const savedTheme = safeGetItem(StorageService.THEME_KEY, 'light');
  applyTheme(savedTheme);
  updateSoundToggleUI();

  activeMonthInput.value = activeMonth;
  dateInput.value = getTodayISO();

  previousMonthStatusByYm[activeMonth] = getMonthHealthStatus(calculateMonthMetrics(activeMonth));

  if (safeGetItem(StorageService.WELCOME_SEEN_KEY) !== 'true') {
    openModalWithFocus(welcomeModal, closeWelcomeBtn);
  } else {
    checkMonthlyBudgetPrompt();
  }

  if (StorageService.isDriveOptedIn()) {
    updateSyncUI('Saved Locally (Click Sync Drive)', 'default');
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
