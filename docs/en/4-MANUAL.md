# 📖 User manual (English)

**My Library (Ma Bibliothèque)** — full step-by-step manual. Quick version: see [5-QUICK-REFERENCE.md](5-QUICK-REFERENCE.md).

---

## First steps

Open the app, scan your first book — the record is created automatically (title, authors, cover, summary). Click any cover to edit everything.

> **🧪 Demo library**: if your library is empty, the app offers to load 6 sample books (series, active loan, reading progress, 1st edition…) to explore everything in 1 minute. Delete them later by searching the "démo" tag.

## 0. Language and first launch

- **🌐 Button** (top bar): instant FR ↔ EN toggle, remembered in the browser
- Automatic detection on first launch (English browser → English UI)
- On first launch, a **3-screen mini-guide** appears (scan → back up → French sources). It never shows again; "Skip" also dismisses it.

## 1. Adding books

| Means | How |
|---|---|
| **📷 Camera scan** (phone) | Scan button → aim at the barcode on the back |
| **USB scanner** (PC) | Click the bottom bar, scan: ISBN typed + auto-validated |
| **Manual ISBN** | Type the digits in the bottom bar, Enter |
| **➕ No ISBN** | Blank record, opens ready to edit (old books, rare editions) |
| **⚡ Burst mode** | Camera stays open, every scan adds a book in a row |
| **📷 AI shelf photo** | One photo → the AI reads spines row by row and compares with your collection |

**Sources**: Open Library + Google Books + BnF (direct) + BnF/Fnac relay, merged field by field. Every record shows its sources. See section 7 bis to optimize recognition.

**Duplicates**: scanning an already-owned book asks "Add anyway (2nd copy)?". Rescanning an incomplete record **completes it** instead of duplicating.

## 2. Shelving books physically

### Shelving mode (a whole shelf in 2 minutes)

1. Bottom bar → **📦 Shelving mode**
2. Enter "Bookcase" and "Shelf" (with suggestions from your existing locations)
3. Scan the whole shelf — every added book gets this location automatically
4. Click again to exit the mode

The structured location (**bookcase + shelf**) powers: search by location, per-location statistics, scatter detection, shelf inventory.

### Changing a book's location

Open the record → **Bookcase / Shelf** fields → Save. The chip 📍 on the cover shows the location.

### Scatter alert

When scanning a book whose series is already shelved elsewhere: immediate alert ("⚠ Series scattered! This volume: Bookcase 2 · Shelf 4. Other locations: …"). The series view shows all locations per series.

## 3. Organizing the collection

- **Virtual shelves** (multi-membership), **tags**, **favorites ♥**, **wishlist 🛒**
- **Statuses**: to read / reading / read / wishlist
- **Ratings** (1-5 stars) and personal notes
- **Search bar**: full text (title, author, ISBN, series, tags, genre, Dewey, location…)
- **Filters**: shelf, status, favorites-only · **Sorts**: recent, title, author, rating, year, Dewey
- **Dewey + genre** for a library-like classification

### Multi-select (bulk editing)

Toolbar → **☑ Select** → check covers → change status/shelf/genre/location of N books at once.

## 4. Managing series

Menu ☰ → **👥 By series / author**: series, authors, scriptwriters, artists.
Per series: owned volumes, **missing volumes** (🛒 adds them to the wishlist), ongoing/complete status, locations (or scatter).

## 5. Lending a book

1. Open the record → **Loaned to…** + due date → Save
2. Blue 📤 badge on the cover; **Loans** view: active loans, late ones in red, **per-borrower history** (kept after returns)
3. **↩ Return** closes the loan (history keeps it); **Reservations**: "Reserved for…" in the record
4. Reminders on app open: late loans and due-today returns

## 6. Shelf inventory (stocktaking)

1. Menu ☰ → **🔎 Shelf inventory** → pick the location
2. Scan every book on that shelf: ✅ confirmed · ⚠ intruder ("Shelve here" in 1 click) · ❓ unknown ("Integrate" adds it)
3. Report at the end: missing (with "📤 loaned to X"), intruders, unknowns — **history kept** (40 last stocktakes)

## 6 bis. Photographing a shelf (photo + AI)

Menu ☰ → **📷 Shelf photo (AI)**: landscape photo → optional bookcase + shelf prefix (rows become "Shelf 1, 2, 3…") → **🤖 Analyze**.
Result per row: ✅ already shelved here · ⚠ supposed elsewhere ("Shelve here") · ❓ unknown ("Search & add" → record completed online).

## 7. Using the AI (optional)

**Configuration** (☰ → 🤖 AI): provider `api` (Mistral/OpenAI key) or `ollama` (local, free).

- **🤖 AI search** (toolbar): describe in natural language → "unread Uderzo comics shelved in the living room"
- **🤖 Complete with AI** (in a record): generates summary, genre, Dewey number for incomplete records

## 7 bis. Optimizing recognition (Google Books key + BnF/Fnac relay)

The automatic search chain: Open Library → Google Books → **BnF (direct)** → ISBN-10 conversion → **BnF/Fnac relay** → fallback covers. Two optional settings complete it:

### A. Google Books key (summaries and covers, 1000 free queries/day)
1. [console.cloud.google.com](https://console.cloud.google.com) → project → *APIs & Services* → enable **"Google Books API"** → *Credentials* → **Create credentials** → **API key**
2. **☰ → 🔑 API keys** → paste the key → **🧪 Test** (✅ = valid) → **💾 Save**
3. The key stays **in your browser only**. Recommended: restrict to referrers `chenzu-ai.github.io/*`

### B. BnF/Fnac relay (essential for French books, especially pre-2010)
International databases miss part of the old French backlist; the **BnF has everything** (legal deposit). Since v2.3 the BnF is queried **directly from the browser**; the relay worker completes for the Fnac and as fallback:

1. **https://dash.cloudflare.com** → free account → **Workers & Pages** → Create → **"Hello World"** → name it `biblio-relais` → Deploy
2. **Edit code** → replace the code with the repository's **`worker.js`** → **Deploy**
3. Test: `https://biblio-relais.your-subdomain.workers.dev/?isbn=9782221110003` → JSON with the title = ✅
4. **☰ → 🔑 API keys** → **"French relay URL"** field → paste → **💾 Save**

> Cost: 0 € (100,000 free requests/day). The worker stores nothing; only queried ISBNs transit. Customizable subdomain if you don't want your name in the URL.

### Diagnostics on failure
**☰ → 🔑 → "🔍 ISBN diagnostics"**: enter an ISBN → the app shows what **every source** answers (including the converted ISBN-10 and the relay). If everything is ❌: the book is absent from catalogs → fill manually or with **🤖 Complete with AI**.

> 💡 **Rescanning an incomplete record**: the app completes the existing record automatically (no duplicate). For a genuine 2nd copy, answer "Add anyway" when the record is already complete.

## 7 ter. Reading tracking ("My reading" view)

**☰ → 📖 My reading** — your reading cockpit:
- **🎯 Annual goal**: "Set my goal" button (e.g. 40 books in 2027) — progress bar, books left, feasible pace
- **🎲 Pick my next book**: random draw among your "to read"
- **"Read next" queue**: check the box in a record; manage (open/remove) in the view
- **In progress**: books with "reading" status and their progress — set the **current page** in the record for the progress bar
- **Reading journal**: in each record, add timestamped notes ("03/15: chapter 3 excellent")

> Switching a book to "**Read**" automatically records the end date — this feeds the yearly statistics (finished books, pages read, estimated reading hours) in the Statistics tab.

## 7 quater. Book life cycle (acquisition and disposal)

In each record:
- **Acquired on / from / price paid** — distinct from the list price (catalog value)
- **Borrowed from someone?** — the mirror of loans: track books others lent you
- **Disposed**: Sold / Given / Lost / Lent not returned + date + sale price. The record is kept (history), the book automatically leaves active views and statistics

## 8. Back up, export, restore

| Need | Action |
|---|---|
| Full backup | ☰ → **💾 Backup now** (JSON) |
| Automatic backup | ☰ → **⚙️ Auto backup** → every N scans (0 = off) |
| Transfer to another device | **💾 Export JSON** → file → on the other device: **📥 Import JSON** (merge, no duplicates) |
| Excel spreadsheet | ☰ → **📄 Export CSV** |
| Catalog to print/share | ☰ → **🖨️ Export HTML** |
| Obsidian/Notion/GitHub | ☰ → **📝 Export Markdown** |
| Spine labels to stick | ☰ → **🏷️ Spine labels** → print (50×30 mm) |
| Covers offline forever | ☰ → **🖼️ Embedded covers** (PC recommended only) |
| Backup to your private GitHub | ☰ → **☁️ Backup to GitHub** (v2.3 — token in 🔑, version history included) |
| Professional ILS (Koha/PMB) | ☰ → **📤 UNIMARC export** or **📤 MARC21 XML export** |
| Take over an existing pro catalog | ☰ → **📥 UNIMARC import** (ISO 2709 export from the ILS) |

**UNIMARC and MARC21 (v2.3)** — complete professional interoperability: exports in both ILS standards, and holdings takeover from Koha/PMB (records 010/200/210/215/330/690/910 become app records, merged without duplicates).

### ☁️ GitHub cloud backup (v2.3)

The most robust backup — your data in **your private GitHub repository**, with GitHub's version history (you can return to any previous backup).

1. **Create a GitHub token**: github.com/settings/tokens → *Generate new token (classic)* → check `repo` → copy the `ghp_…`
2. **Paste the token in the app**: ☰ → 🔑 API keys → *GitHub token* field → Save (the token stays in your browser, nowhere else)
3. **☁️ Backup to GitHub** (menu): the full library is pushed to the `bibliotheque-sauvegarde.json` file of the private repository
4. **☁️ Restore from GitHub** (menu): merges the remote backup into the local library — nothing is ever overwritten

**Multi-device without a server**: back up from the PC, restore on mobile (or the other way). The token must be configured on each device.

## 9. Tracking activity

Menu ☰ → **📊 Statistics**: totals, statuses, ratings, catalog value, remarkable editions, per-location breakdown, 12-month additions curve, top authors.

## 10. Tips

- **Backup rhythm**: one JSON export per month minimum; store it in a cloud (OneDrive…) — or use the ☁️ GitHub cloud backup
- **Embedded covers**: on PC only (storage); on mobile keep URL covers
- **Dewey**: enter `843` or `741.5` — the comma becomes a dot automatically
- **Guest catalog** (☰ → 👁️): PIN-protected read-only view to show your collection — with the demo library loaded, it's a ready-made showcase

---
*My Library — by PrimAlph*

> 🇫🇷 **Version française** : [`docs/4-MANUEL.md`](../4-MANUEL.md)
