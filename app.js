/**
 * ============================================================================
 * GOOGLE CLOUD OAUTH CLIENT ID
 * ============================================================================
 */
const GOOGLE_CLIENT_ID = '381251059137-hkv6bjlmcjg0i32qqblt0h0dubemdgap.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILE_NAME = 'expense.json';

/**
 * StorageService
 * - Primary storage is localStorage (instant, offline, zero sign-in required).
 * - Google Drive sync is 100% opt-in via restricted drive.file scope.
 * - Keeps internal localStorage keys unchanged so existing data remains intact.
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
  driveFileId: localStorage.getItem('expenseflow_drive_file_id') || null,

  packData(data) {
    return JSON.stringify({
      v: 1,
      b: data.budgets || {},
      e: (data.expenses || []).map((x) => ({
        i: x.id,
        a: x.amount,
        c: x.category,
        m: x.mode,
        d: x.date,
        n: x.note || ''
      })),
      s: (data.shortcuts || []).map((x) => ({
        i: x.id,
        a: x.amount,
        c: x.category,
        m: x.mode,
        n: x.note || ''
      }))
    });
  },

  unpackData(raw) {
    if (!raw || typeof raw !== 'object') return { budgets: {}, expenses: [], shortcuts: [] };
    if (raw.b !== undefined || raw.e !== undefined) {
      return {
        budgets: raw.b || {},
        expenses: (raw.e || []).map((x) => ({
          id: x.i || Date.now() + Math.random(),
          amount: Number(x.a) || 0,
          category: x.c || 'Other',
          mode: x.m || 'Cash',
          date: x.d || getTodayISO(),
          note: x.n || ''
        })),
        shortcuts: Array.isArray(raw.s)
          ? raw.s.map((x) => ({
              id: x.i || Date.now() + Math.random(),
              amount: Number(x.a) || 0,
              category: x.c || 'Other',
              mode: x.m || 'Cash',
              note: x.n || ''
            }))
          : []
      };
    }
    return {
      budgets: raw.budgets || {},
      expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
      shortcuts: Array.isArray(raw.shortcuts) ? raw.shortcuts : []
    };
  },

  loadLocal() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return { budgets: {}, expenses: [], shortcuts: [] };
      return this.unpackData(JSON.parse(raw));
    } catch {
      return { budgets: {}, expenses: [], shortcuts: [] };
    }
  },

  saveLocal(data) {
    localStorage.setItem(this.STORAGE_KEY, this.packData(data));
  },

  isDriveOptedIn() {
    return localStorage.getItem(this.DRIVE_PREF_KEY) === 'enabled';
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
        localStorage.setItem(this.DRIVE_PREF_KEY, 'enabled');
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
        localStorage.removeItem(this.FILE_ID_KEY);
      }
    }

    const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
    const searchRes = await this.driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`
    );
    const searchJson = await searchRes.json();

    if (searchJson.files && searchJson.files.length > 0) {
      this.driveFileId = searchJson.files[0].id;
      localStorage.setItem(this.FILE_ID_KEY, this.driveFileId);
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
    localStorage.setItem(this.FILE_ID_KEY, this.driveFileId);
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
    this.saveLocal(data);
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

let selectedMode = 'Cash';
let selectedUpiType = 'UPI Lite';
let activeMonth = getCurrentMonth();
let pendingExpenseEntry = null;
let currentDailyFormulaText = 'Auto-set: Remaining balance ÷ days left in the month';

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
const driveAuthBtn = document.getElementById('driveAuthBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
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
const categoryBars = document.getElementById('categoryBars');

// Shared Toast (Undo + Today's Limit Explanation)
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
    if (undoExpenseId) {
      toastUndoBtn.classList.remove('hidden');
    } else {
      toastUndoBtn.classList.add('hidden');
    }
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
    await window.deleteExpense(idToRemove);
    showAppToast('Expense undone');
  });
}

/* ============================================================================
   HELPERS & FORMATTING
   ============================================================================ */
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
  localStorage.setItem(StorageService.THEME_KEY, isDark ? 'dark' : 'light');
}

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ============================================================================
   GOOGLE DRIVE OPT-IN SYNC FLOW (TEMPORARILY UNAVAILABLE IN TEST MODE)
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
      const mergedMap = new Map();
      [...(cloudData.expenses || []), ...(appData.expenses || [])].forEach((tx) => {
        mergedMap.set(tx.id, tx);
      });
      appData.expenses = Array.from(mergedMap.values()).sort(
        (a, b) => b.date.localeCompare(a.date) || b.id - a.id
      );
      appData.budgets = { ...(cloudData.budgets || {}), ...(appData.budgets || {}) };
      if ((!appData.shortcuts || appData.shortcuts.length === 0) && Array.isArray(cloudData.shortcuts)) {
        appData.shortcuts = cloudData.shortcuts;
      }
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
  localStorage.setItem(StorageService.DRIVE_PREF_KEY, 'dismissed');
  drivePromptBanner.classList.add('hidden');
});

function maybeShowDrivePrompt() {
  return;
}

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

/* ============================================================================
   SMART MONTHLY BUDGET PROMPT, REMINDER VIEW & DELETE
   ============================================================================ */
function getSavedReminder() {
  try {
    const raw = localStorage.getItem(StorageService.BUDGET_REMINDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSavedReminder() {
  localStorage.removeItem(StorageService.BUDGET_REMINDER_KEY);
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

  if (showDateImmediately) {
    reminderDateBox.classList.remove('hidden');
  } else {
    reminderDateBox.classList.add('hidden');
  }

  budgetPromptModal.classList.remove('hidden');
  setTimeout(() => {
    if (showDateImmediately) {
      budgetReminderDate.focus();
    } else {
      promptBudgetAmount.focus();
      promptBudgetAmount.select();
    }
  }, 50);
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
  renderAll();
  await StorageService.saveData(appData);
  maybeShowDrivePrompt();
}

savePromptBudgetBtn.addEventListener('click', async () => {
  const val = parseFloat(promptBudgetAmount.value);
  if (isNaN(val) || val <= 0) {
    promptBudgetAmount.focus();
    return;
  }

  const targetMonth = pendingExpenseEntry ? pendingExpenseEntry.date.slice(0, 7) : activeMonth;
  appData.budgets[targetMonth] = (Number(appData.budgets[targetMonth]) || 0) + val;
  clearSavedReminder();

  budgetPromptModal.classList.add('hidden');
  renderAll();
  await StorageService.saveData(appData);
  await finalizePendingExpense();
});

notNowBudgetBtn.addEventListener('click', () => {
  reminderDateBox.classList.remove('hidden');
  budgetReminderDate.focus();
});

confirmReminderBtn.addEventListener('click', async () => {
  const chosenDate = budgetReminderDate.value;
  if (!chosenDate) {
    budgetReminderDate.focus();
    return;
  }

  const targetMonth = pendingExpenseEntry ? pendingExpenseEntry.date.slice(0, 7) : activeMonth;
  localStorage.setItem(
    StorageService.BUDGET_REMINDER_KEY,
    JSON.stringify({ month: targetMonth, remindOn: chosenDate })
  );

  budgetPromptModal.classList.add('hidden');
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
  if (e.target.value) {
    activeMonth = e.target.value;
    renderAll();
  }
});

// Welcome / Privacy Modal
closeWelcomeBtn.addEventListener('click', () => {
  localStorage.setItem(StorageService.WELCOME_SEEN_KEY, 'true');
  welcomeModal.classList.add('hidden');
  checkMonthlyBudgetPrompt();
});

openGuideBtn.addEventListener('click', () => {
  welcomeModal.classList.remove('hidden');
});

// Tappable Today's Limit Formula Explanation
if (dailyAllowanceSub) {
  dailyAllowanceSub.addEventListener('click', () => {
    showAppToast(currentDailyFormulaText, null, 3800);
  });
}

// Inline Budget Drawer with Fast 150ms Auto-Scroll Above Mobile Keypad + Auto-Select
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
  if (isNaN(val) || val <= 0) {
    budgetInput.focus();
    return;
  }
  appData.budgets[activeMonth] = Number(appData.budgets[activeMonth] || 0) + val;
  clearSavedReminder();
  budgetDrawer.classList.add('hidden');
  renderAll();
  await StorageService.saveData(appData);
});

replaceBudgetBtn.addEventListener('click', async () => {
  const val = parseFloat(budgetInput.value);
  if (isNaN(val) || val < 0) {
    budgetInput.focus();
    return;
  }
  appData.budgets[activeMonth] = val;
  if (val > 0) {
    clearSavedReminder();
  }
  budgetDrawer.classList.add('hidden');
  renderAll();
  await StorageService.saveData(appData);
});

resetBudgetBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    `Reset ${formatMonthLabel(activeMonth)} budget to ₹0? Your recorded expenses will not be deleted.`
  );
  if (!confirmed) return;
  delete appData.budgets[activeMonth];
  budgetDrawer.classList.add('hidden');
  renderAll();
  await StorageService.saveData(appData);
});

/* ============================================================================
   EXPENSE CRUD & CSV EXPORT
   ============================================================================ */
expenseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseFloat(amountInput.value);
  if (isNaN(amount) || amount <= 0) return;

  const mode = selectedMode === 'Cash' ? 'Cash' : selectedUpiType;
  const entryDate = dateInput.value || getTodayISO();

  const entry = {
    id: Date.now(),
    amount,
    category: categoryInput.value,
    mode,
    date: entryDate,
    note: noteInput.value.trim()
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
  renderAll();
  await StorageService.saveData(appData);
  maybeShowDrivePrompt();
});

window.deleteExpense = async function (id) {
  appData.expenses = appData.expenses.filter((item) => item.id !== id);
  renderAll();
  await StorageService.saveData(appData);
};

exportCsvBtn.addEventListener('click', () => {
  const monthExpenses = appData.expenses.filter((e) => e.date.startsWith(activeMonth));
  if (monthExpenses.length === 0) {
    alert(`No expenses recorded in ${formatMonthLabel(activeMonth)} to export.`);
    return;
  }

  const headers = ['Date', 'Category', 'Payment Mode', 'Amount (INR)', 'Note'];
  const rows = monthExpenses.map((e) => [
    e.date,
    `"${e.category}"`,
    `"${e.mode}"`,
    e.amount,
    `"${(e.note || '').replace(/"/g, '""')}"`
  ]);

  const csvString = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `TrackYourRupee_${activeMonth}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

filterCategory.addEventListener('change', renderTransactions);
filterPayment.addEventListener('change', renderTransactions);
searchInput.addEventListener('input', renderTransactions);

/* ============================================================================
   RENDERING ENGINE (PHASE 2: 3 MODULES & STATUS COLORS)
   ============================================================================ */
function renderAll() {
  renderSummaryAndSplit();
  renderReminderChip();
  renderCategoryBreakdown();
  renderTransactions();
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

  // Month status color: > 50% left = green, 20-50% left = yellow, < 20% left = red
  let monthStatus = 'green';
  let monthStatusWord = 'On track';
  let barFillPct = 0;

  if (metrics.totalAvailablePool > 0) {
    const leftPct = (metrics.remainingBalance / metrics.totalAvailablePool) * 100;
    barFillPct = Math.min(100, Math.max(0, Math.round(leftPct)));

    if (leftPct > 50) {
      monthStatus = 'green';
      monthStatusWord = 'On track';
    } else if (leftPct >= 20) {
      monthStatus = 'yellow';
      monthStatusWord = 'Careful';
    } else {
      monthStatus = 'red';
      monthStatusWord = 'Over';
    }
  } else if (metrics.remainingBalance < 0) {
    monthStatus = 'red';
    monthStatusWord = 'Over';
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
  const monthExpenses = appData.expenses.filter((e) => e.date.startsWith(activeMonth));
  spentMonthLabel.textContent = `Spent (${label})`;
  monthTotal.textContent = formatINR(metrics.spentThisMonth);
  monthCount.textContent = `${monthExpenses.length} ${monthExpenses.length === 1 ? 'transaction' : 'transactions'}`;

  const todayExpenses = appData.expenses.filter((e) => e.date === today);
  const todaySum = todayExpenses.reduce((s, e) => s + Number(e.amount), 0);
  todayTotal.textContent = formatINR(todaySum);
  todayDateLabel.textContent = formatDateReadable(today);

  // Today's limit = current balance left ÷ remaining days in month
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

function renderCategoryBreakdown() {
  const monthExpenses = appData.expenses.filter((e) => e.date.startsWith(activeMonth));
  const totalSpent = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
  breakdownMonthLabel.textContent = formatMonthLabel(activeMonth);

  if (monthExpenses.length === 0 || totalSpent === 0) {
    categoryBars.innerHTML = '<p class="empty-state">No expenses recorded yet.</p>';
    return;
  }

  const totals = {};
  monthExpenses.forEach((e) => {
    totals[e.category] = (totals[e.category] || 0) + Number(e.amount);
  });

  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  categoryBars.innerHTML = sorted
    .map(([cat, val]) => {
      const pct = Math.round((val / totalSpent) * 100);
      return `
        <div class="bar-item">
          <div class="bar-top">
            <span>${escapeHtml(cat)}</span>
            <span>${formatINR(val)} (${pct}%)</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderTransactions() {
  const catFilter = filterCategory.value;
  const modeFilter = filterPayment.value;
  const query = searchInput.value.trim().toLowerCase();

  const filtered = appData.expenses
    .filter((e) => e.date.startsWith(activeMonth))
    .filter((e) => (catFilter === 'ALL' ? true : e.category === catFilter))
    .filter((e) => (modeFilter === 'ALL' ? true : e.mode === modeFilter))
    .filter((e) => {
      if (!query) return true;
      return (
        (e.note && e.note.toLowerCase().includes(query)) ||
        e.category.toLowerCase().includes(query) ||
        e.mode.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  historyCount.textContent = `Showing ${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`;

  if (filtered.length === 0) {
    transactionList.innerHTML =
      '<p class="empty-state">No matching expenses for this month.</p>';
    return;
  }

  transactionList.innerHTML = filtered
    .map((e) => {
      const isCash = e.mode === 'Cash';
      const isLite = e.mode === 'UPI Lite';
      const badgeClass = isCash ? 'badge-cash' : isLite ? 'badge-lite' : 'badge-bank';
      const modeLabel = isCash ? 'Cash' : isLite ? 'UPI • Lite' : 'UPI • Bank';
      const noteHtml = e.note ? ` • ${escapeHtml(e.note)}` : '';

      return `
        <div class="tx-item">
          <div class="tx-left">
            <div class="tx-title-row">
              <span class="tx-category">${escapeHtml(e.category)}</span>
              <span class="badge ${badgeClass}">${modeLabel}</span>
            </div>
            <div class="tx-meta">
              ${formatDateReadable(e.date)}${noteHtml}
            </div>
          </div>
          <div class="tx-right">
            <span class="tx-amount">${formatINR(e.amount)}</span>
            <button type="button" class="delete-btn" title="Delete expense" onclick="deleteExpense(${e.id})">✕</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================================
   BOOTSTRAPPING (OFFLINE-FIRST, DEFAULT LIGHT MODE)
   ============================================================================ */
function init() {
  const savedTheme = localStorage.getItem(StorageService.THEME_KEY) || 'light';
  applyTheme(savedTheme);

  activeMonthInput.value = activeMonth;
  dateInput.value = getTodayISO();

  if (localStorage.getItem(StorageService.WELCOME_SEEN_KEY) !== 'true') {
    welcomeModal.classList.remove('hidden');
  } else {
    checkMonthlyBudgetPrompt();
  }

  if (StorageService.isDriveOptedIn()) {
    updateSyncUI('Saved Locally (Click Sync Drive)', 'default');
    driveAuthBtn.textContent = 'Sync Drive';
  } else {
    updateSyncUI('Saved on Device', 'default');
  }

  renderAll();
  maybeShowDrivePrompt();
}

init();

/* ============================================================================
   TRACKYOURRUPEE • PHASE 1: MOBILE SHORTCUTS & BOTTOM TABS (phones ≤ 640px)
   ============================================================================ */
const FEATURE_REQUEST_URL = '';

(function () {
  const TAB_KEY = 'expenseflow_mobile_tab';
  const TABS = ['home', 'transactions', 'insights', 'more'];
  const RECENT_LIMIT = 3;
  const KEYBOARD_INPUT_TYPES = ['text', 'number', 'search', 'email', 'tel', 'url', 'password'];

  const CATEGORY_CLASS = {
    Food: 'cat-food',
    Travel: 'cat-travel',
    'Room/Hostel': 'cat-room',
    Study: 'cat-study',
    Shopping: 'cat-shopping',
    Other: 'cat-other'
  };

  const ICONS = {
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5"/><path d="M12 7.5h.01"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>'
  };

  const tabbar = document.getElementById('mobileTabbar');
  const tabButtons = Array.from(tabbar.querySelectorAll('.mobile-tab'));

  const recentList = document.getElementById('recentList');
  const recentCount = document.getElementById('recentCount');
  const recentSeeAllBtn = document.getElementById('recentSeeAllBtn');
  const categoryDonut = document.getElementById('categoryDonut');
  const moreList = document.getElementById('moreList');

  // Shortcut DOM elements
  const openQuickAddBtn = document.getElementById('openQuickAddBtn');
  const saveAsShortcutBtn = document.getElementById('saveAsShortcutBtn');
  const shortcutsModal = document.getElementById('shortcutsModal');
  const addNewShortcutModalBtn = document.getElementById('addNewShortcutModalBtn');
  const closeShortcutsBtn = document.getElementById('closeShortcutsBtn');
  const closeShortcutsFooterBtn = document.getElementById('closeShortcutsFooterBtn');
  const shortcutsList = document.getElementById('shortcutsList');

  // One-time quick-log amount adjuster DOM elements
  const quickLogConfirmBox = document.getElementById('quickLogConfirmBox');
  const quickLogConfirmTitle = document.getElementById('quickLogConfirmTitle');
  const quickLogConfirmMeta = document.getElementById('quickLogConfirmMeta');
  const quickLogAmountInput = document.getElementById('quickLogAmountInput');
  const confirmQuickLogBtn = document.getElementById('confirmQuickLogBtn');
  const cancelQuickLogBtn = document.getElementById('cancelQuickLogBtn');

  // Shortcut creator / editor DOM elements
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

  /* ---------- Cross-Browser History API Back Gesture Handling ---------- */
  function getCurrentTab() {
    return document.body.getAttribute('data-mobile-tab') || 'home';
  }

  function pushModalHistoryState(modalName) {
    if (window.history && window.history.pushState) {
      window.history.pushState({ tab: getCurrentTab(), modal: modalName }, '');
    }
  }

  function closeShortcutsModalUI() {
    shortcutsModal.classList.add('hidden');
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
    shortcutsModal.classList.remove('hidden');

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
    if (isNaN(finalAmount) || finalAmount <= 0) {
      quickLogAmountInput.focus();
      return;
    }

    const today = getTodayISO();
    const entry = {
      id: Date.now(),
      amount: finalAmount,
      category: sc.category,
      mode: sc.mode,
      date: today,
      note: sc.note || ''
    };

    appData.expenses.unshift(entry);
    const entryMonth = today.slice(0, 7);
    if (entryMonth !== activeMonth) {
      activeMonth = entryMonth;
      activeMonthInput.value = activeMonth;
    }

    closeShortcutsModal(false);
    renderAll();
    await StorageService.saveData(appData);
    showAppToast(`Added ${formatINR(entry.amount)} — Undo`, entry.id);
  }

  if (openQuickAddBtn) {
    openQuickAddBtn.addEventListener('click', () => openShortcutsModal(false));
  }
  if (addNewShortcutModalBtn) {
    addNewShortcutModalBtn.addEventListener('click', startCreateShortcut);
  }
  closeShortcutsBtn.addEventListener('click', () => closeShortcutsModal(false));
  closeShortcutsFooterBtn.addEventListener('click', () => closeShortcutsModal(false));

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
      if (isNaN(amount) || amount <= 0) {
        amountInput.focus();
        showAppToast('Enter an amount first');
        return;
      }

      const mode = selectedMode === 'Cash' ? 'Cash' : selectedUpiType;
      const shortcut = {
        id: Date.now(),
        amount,
        category: categoryInput.value,
        mode,
        note: noteInput.value.trim()
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
    if (isNaN(val) || val <= 0) {
      scAmount.focus();
      return;
    }

    if (editingShortcutId === null) {
      appData.shortcuts.push({
        id: Date.now(),
        amount: val,
        category: scCategory.value,
        mode: scMode.value,
        note: scNote.value.trim()
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
          note: scNote.value.trim()
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
        '<p class="empty-state">No shortcuts yet. Tap <strong>+ Add</strong> above or <strong>☆ Save shortcut</strong> on Home.</p>';
      return;
    }

    shortcutsList.innerHTML = appData.shortcuts
      .map((sc, idx) => {
        const isCash = sc.mode === 'Cash';
        const isLite = sc.mode === 'UPI Lite';
        const badgeClass = isCash ? 'badge-cash' : isLite ? 'badge-lite' : 'badge-bank';
        const modeLabel = isCash ? 'Cash' : isLite ? 'UPI • Lite' : 'UPI • Bank';
        const titleText = sc.note ? escapeHtml(sc.note) : escapeHtml(sc.category);
        const subText = sc.note ? `${escapeHtml(sc.category)} • ` : '';

        return `
          <div class="shortcut-row" data-sc-id="${sc.id}">
            <button type="button" class="shortcut-tap-area" data-sc-action="use">
              <div class="shortcut-main">
                <strong>${titleText}</strong>
                <span class="shortcut-amt">${formatINR(sc.amount)}</span>
              </div>
              <div class="shortcut-sub">
                <span>${subText}</span>
                <span class="badge ${badgeClass}">${modeLabel}</span>
              </div>
            </button>
            <div class="shortcut-controls">
              <button type="button" class="sc-icon-btn" data-sc-action="up" ${idx === 0 ? 'disabled' : ''} title="Move up">↑</button>
              <button type="button" class="sc-icon-btn" data-sc-action="down" ${idx === appData.shortcuts.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
              <button type="button" class="sc-icon-btn" data-sc-action="edit" title="Edit">✎</button>
              <button type="button" class="sc-icon-btn sc-del" data-sc-action="delete" title="Delete">✕</button>
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

  /* ---------- Tabs + History API Back Navigation ---------- */
  function readSavedTab() {
    try {
      const t = localStorage.getItem(TAB_KEY);
      return TABS.includes(t) ? t : 'home';
    } catch {
      return 'home';
    }
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
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
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
      budgetPromptModal.classList.add('hidden');
      return;
    }
    if (welcomeModal && !welcomeModal.classList.contains('hidden')) {
      welcomeModal.classList.add('hidden');
      return;
    }
    const targetTab = event.state && TABS.includes(event.state.tab) ? event.state.tab : 'home';
    applyTabUI(targetTab, false);
  });

  tabbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.mobile-tab');
    if (btn) setTab(btn.dataset.tab, true, false);
  });

  recentSeeAllBtn.addEventListener('click', () => setTab('transactions', true, false));

  /* ---------- Hide tab bar while typing ---------- */
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

  /* ---------- Shared helpers ---------- */
  function monthExpensesSorted() {
    return appData.expenses
      .filter((e) => e.date.startsWith(activeMonth))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }

  function txItemHtml(e) {
    const isCash = e.mode === 'Cash';
    const isLite = e.mode === 'UPI Lite';
    const badgeClass = isCash ? 'badge-cash' : isLite ? 'badge-lite' : 'badge-bank';
    const modeLabel = isCash ? 'Cash' : isLite ? 'UPI • Lite' : 'UPI • Bank';
    const noteHtml = e.note ? ` • ${escapeHtml(e.note)}` : '';
    return `
      <div class="tx-item">
        <div class="tx-left">
          <div class="tx-title-row">
            <span class="tx-category">${escapeHtml(e.category)}</span>
            <span class="badge ${badgeClass}">${modeLabel}</span>
          </div>
          <div class="tx-meta">${formatDateReadable(e.date)}${noteHtml}</div>
        </div>
        <div class="tx-right">
          <span class="tx-amount">${formatINR(e.amount)}</span>
          <button type="button" class="delete-btn" title="Delete expense" onclick="deleteExpense(${e.id})">✕</button>
        </div>
      </div>
    `;
  }

  /* ---------- Home: Recent ---------- */
  function renderRecent() {
    const all = monthExpensesSorted();
    if (all.length === 0) {
      recentCount.textContent = `No entries in ${formatMonthLabel(activeMonth)}`;
      recentList.innerHTML = '<p class="empty-state">No expenses in this month yet.</p>';
      recentSeeAllBtn.classList.add('hidden');
      return;
    }
    const latest = all.slice(0, RECENT_LIMIT);
    recentCount.textContent = `Latest ${latest.length} of ${all.length}`;
    recentList.innerHTML = latest.map(txItemHtml).join('');
    recentSeeAllBtn.classList.remove('hidden');
  }

  /* ---------- Insights: Donut ---------- */
  function renderDonut() {
    const R = 48;
    const C = 2 * Math.PI * R;
    const items = monthExpensesSorted();
    const total = items.reduce((s, e) => s + Number(e.amount), 0);

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

  /* ---------- More ---------- */
  function svgIcon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  function getMoreItems() {
    const count = (appData.shortcuts || []).length;
    return [
      {
        icon: 'bolt',
        title: 'Shortcuts',
        desc: 'Add, edit, or quick-log your saved expenses',
        tag: `${count}`,
        action: () => openShortcutsModal(false)
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

  moreList.addEventListener('click', (e) => {
    const row = e.target.closest('.more-row');
    if (!row) return;
    const items = getMoreItems();
    const item = items[Number(row.dataset.moreIndex)];
    if (item && item.action) item.action();
  });

  /* ---------- Hook into renderAll ---------- */
  function renderMobileExtras() {
    try {
      renderRecent();
      renderDonut();
    } catch (err) {
      console.error('Mobile tabs render failed', err);
    }
  }

  const originalRenderAll = renderAll;
  renderAll = function () {
    originalRenderAll();
    renderMobileExtras();
  };

  renderMoreList();
  const initialTab = readSavedTab();
  applyTabUI(initialTab, false);
  if (window.history && window.history.replaceState) {
    window.history.replaceState({ tab: 'home' }, '');
    if (initialTab !== 'home') {
      window.history.pushState({ tab: initialTab }, '');
    }
  }
  renderMobileExtras();
})();
