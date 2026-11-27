# TrackYourRupee – Personal Expense Tracker (Offline First)

A lightweight, privacy-focused personal daily ledger built with Vanilla HTML, CSS and JavaScript. Designed to track daily spend across Indian payment modes with zero backend servers and optional single-file Google Drive cloud backup.

**Live App:** https://trackyourrupee.vercel.app

---

## Main Features

- **Offline-First Local Storage & PWA:** Stores all budgets, category caps, shortcuts, recurring bills, and expenses instantly in browser `localStorage` with an installable Service Worker app shell—no internet or sign-in required.
- **Multi-Channel Payment Tracking:** Separate tracking of expenses across **Cash**, **UPI Lite**, and **UPI Bank Account**.
- **Smart Monthly Budgets & Rollover:** Set a `Set / Replace` base limit, `Reset Budget`, or mid-month `+ Add to Existing` funds, automatically rolling over unspent balances or deficits across months.
- **Category Breakdown, Spending Caps & Month-over-Month Insights:** Live search and filtering by month, category, and payment channel, optional per-category monthly spending caps with warning/over-cap bars, and Month-over-Month spending comparisons.
- **Edit Transactions & One-Tap Shortcuts:** Edit any recorded transaction in place, save frequent expenses as one-tap shortcuts, and manage fixed monthly recurring bills.
- **Full JSON Snapshot Backup/Restore & CSV Export:** Export or merge-restore complete `.json` backups (with pre-restore rollback protection) and download formula-safe `.csv` spreadsheets.
- **Optional Google Drive Sync (`drive.file`):** Connects to your Google Drive using Google Identity Services (OAuth 2.0) and syncs a single, compact `expense.json` file. No other files in your Drive are touched.
- **Light & Dark Themes + Audio Feedback:** Clean Light and Dark modes with optional local `.mp3` sound cues.

---

## Architecture & Privacy

- **Zero-Backend Architecture:** No database or third-party analytics tracker collects your financial records. Your ledger stays on your device unless you manually sign in to Google Drive. (The interface loads the Inter typeface from Google Fonts when online, without sending any financial data.)
- **Least-Privilege Drive Isolation:** Uses the narrow `https://www.googleapis.com/auth/drive.file` scope, restricting access strictly to the single `expense.json` file created by this app.
- **Compact Schema (`v4`):** Uses integer paise precision and compact JSON keys with timestamped conflict resolution and tombstone tracking.

---

## Technology Stack

- **Frontend:** HTML5, CSS3 (CSS Custom Properties, CSS Grid/Flexbox), Vanilla JS (ES6+)
- **Authentication & Cloud Storage:** Google Identity Services (OAuth 2.0), Google Drive REST API v3
- **Hosted by:** Vercel

---

## About the Author

Developed by **Muhammed Nihal Aalum**  
GitHub: [@mdnihalaalum](https://github.com/mdnihalaalum)
