# ⚡ My Library — Quick reference

> One page, the essentials. Details in the full manual (`4-MANUAL.md`).

---

## 🚀 Getting started — official URL: **https://chenzu-ai.github.io/bibliotheque-app/**

| | |
|---|---|
| **PC** | Open the URL in Edge/Chrome → **⊕ Install** (30 s, no server) |
| **Android** | Open the URL in Chrome → **⬇️ Install** button (or menu ⋯ → "Install app") |
| **iPhone** | Open the URL in **Safari** → **Share** button (↑) → **"Add to Home Screen"** (no other way on iOS) |

> Offline without the URL: app folder → `python -m http.server 8080` → `http://localhost:8080` in Edge → **⊕ Install**

## ➕ Add a book
- **Mobile**: 📷 Scan → aim at the barcode on the back. In bulk: ⚡ Burst mode
- **PC**: ISBN in the bottom bar (or USB scanner, or webcam)
- No barcode? **➕ No ISBN**
- Already scanned? The app asks if it's a **2nd copy**

## 📦 Shelve
1. **📦 Shelving mode** → "Bookcase / Shelf"
2. Scan the whole shelf → automatic shelving
3. Click 📦 again to stop

## 🎯 The 10 gestures

| I want to… | Action |
|---|---|
| Edit a record | Click the cover |
| Rate / annotate | Record → ★ stars → note |
| Create a virtual shelf | ☰ → 🗂️ Shelves |
| See a series' missing volumes | ☰ → 👥 By series |
| Lend a book | Record → "Loaned to…" + due date |
| Check a shelf (stocktaking) | ☰ → 🔎 Inventory → scan → report |
| Capture/check a shelf **by photo** (vision AI) | ☰ → 📷 Shelf photo → landscape → bookcase + prefix ("Shelf") → Analyze |
| Search in natural language | 🤖 AI search (configure first: ☰ → 🤖 AI) |
| Change many books at once | ☑ Multi-select → check → Apply |
| Back up | ☰ → 💾 Backup now (JSON) |
| Switch devices | Export JSON → 📥 Import (auto-merge) |

## 🔑 Book recognition (set up once)
- **Google Books key**: ☰ → 🔑 → paste (free, 1000/day) — summaries + covers
- **BnF/Fnac relay**: deploy `worker.js` on Cloudflare (5 min, free) → paste the URL in ☰ → 🔑 — **essential for pre-2010 French books** (the BnF holds the complete legal deposit)
- Book not found? **🔍 Diagnostics** (in ☰ → 🔑) or **🤖 Complete with AI**

## 📖 My reading (☰)
Annual goal 🎯 · "read next" queue · 🎲 next book · progress (current page) · dated notes journal

## 📤 Exports
**JSON** (backup) · **CSV** (Excel) · **HTML** (print) · **Markdown** (notes) · **🏷️ Labels** (50×30 mm spines) · **UNIMARC + MARC21 XML** (pro ILS)

## ☁️ Cloud backup (v2.3)
Your books in **your private GitHub repository** (☰ → 🔑 → GitHub token, then ☁️ Backup / Restore). Multi-device: push on the PC, pull on mobile. Local JSON export always available.

## ☰ Menu — 3 groups + search
The ☰ menu groups features in 3 sections: **📚 Collection & capture** (daily views, AI photo) · **💾 Back up & exchange** (backups, cloud, imports/exports, labels) · **⚙️ Professional & settings** (UNIMARC/MARC21, keys, AI, guest). A **🔍 Search a feature** box filters the menu live — type "unimarc" or "labels" to instantly find a rare feature.

## ⚡ Actions on view
Filter (search, series, shelf, status) or check books (☑) → **⚡ Actions** button: Complete with AI · Update (sources) · Diagnose · Share covers/records · Delete · Select all. The ☑ selection takes precedence over the filter (the counter shows the exact target).

## 🌐 Language
🌐 button (top bar): instant FR ↔ EN, remembered. The Help center ❓ follows the language.

## 📱 Good to know on mobile
- Secondary buttons (No ISBN, Shelving mode, Inventory): behind **⋯** at the bottom left
- App update: close/reopen once (twice if the old version persists)

## ⚠️ 3 golden rules
1. **Regular JSON export** — data lives in the device's browser
2. **Complete title/call number** before printing labels (Dewey + location)
3. On mobile, no "embedded covers" (limited storage)

---
*My Library — local and private app, no account, no server. Details: docs 1-4.*
---
*My Library — by PrimAlph*

> 🇫🇷 **Version française** : [`docs/5-MODE-D-EMPLOI-SYNTHESE.md`](../5-MODE-D-EMPLOI-SYNTHESE.md)
