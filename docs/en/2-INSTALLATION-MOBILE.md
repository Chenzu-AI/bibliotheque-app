# 📱 Installation guide — Mobile (Android / iPhone)

**My Library** installs on your phone's home screen like a real app, with **camera access for scanning**.

## Prerequisites
- Android (Chrome) or iPhone (Safari, iOS 16.4+ recommended)
- The app hosted on an **HTTPS** address (required for the camera)

---

## Step 0 — ✅ ALREADY DONE! The app is online

**App URL: https://chenzu-ai.github.io/bibliotheque-app/**

Architecture in place (everything is already configured and automatic):

```
Private repo   Chenzu-AI/Bibliotheque       ← full reference (code + documentation)
        │  on every update (push)
        ▼  automatic synchronization (GitHub Actions)
Public repo    Chenzu-AI/bibliotheque-app  ← hosting mirror
        │
        ▼
https://chenzu-ai.github.io/bibliotheque-app/   ← the app online
```

> Every app update pushed to the private repository appears automatically on the online URL ~2 minutes later. Nothing to do.
> 🔒 **Privacy**: the public site contains only the **software**, never your data. Your books, notes and loans stay in each device's browser.

**Jump straight to Step 2** (installing on your phone) below.

---

## Step 1 — (Reference) Self-hosting the app

If one day you want to host the app elsewhere:

- **GitHub Pages**: repository → **Settings** → **Pages** → Source: *Deploy from a branch* → `main` / `/ (root)` → **Save** → the app is served at `https://YOUR-ACCOUNT.github.io/REPO-NAME/`. ⚠️ The Pages site is always public (even from a private repository) — hence the mirror architecture (private for code, public for hosting)
- **Netlify Drop**: [app.netlify.com/drop](https://app.netlify.com/drop) → drag-and-drop the whole folder → an address like `https://my-library.netlify.app`
- Others: Vercel, Cloudflare Pages — all free

> ⚠️ Remember: data is stored **in each device's browser**. The hosted site stores nothing itself (no account, no data server).

## Step 2 — Install on Android

1. Open **https://chenzu-ai.github.io/bibliotheque-app/** in **Chrome**
2. **Two ways**:
   - The **“⬇️ Install”** button in the app banner (appears when the browser is ready) → confirm
   - Or menu **⋯** (top right) → **“Install app”** / “Add to Home screen”
3. The icon appears on the home screen → the app opens **full screen, without browser bar**

> 💡 Chrome's automatic banner only appears after some usage — the app's ⬇️ button or the ⋯ menu always work immediately.

## Step 2 (iPhone) — Install on iOS

⚠️ **On iPhone there is NO install banner or button**: this is an Apple rule for all web apps, not a flaw of this app. The only way:

1. Open **https://chenzu-ai.github.io/bibliotheque-app/** in **Safari** (mandatory — not Chrome iOS)
2. Tap the **Share** button (square with arrow ↑, at the bottom)
3. Scroll the list → **“Add to Home Screen”**
4. **Add** (top right) → the icon appears on the home screen

> The installed app then behaves like a real iOS app: full screen, clean icon, camera allowed for scanning.

## 📱 Good to know on mobile

- **Bottom bar**: in portrait mode, the secondary buttons (**➕ No ISBN**, **📦 Shelving mode**, **🔎 Inventory**) are tucked behind the **⋯** button at the bottom left — one tap to show them, another to close
- **Automatic updates**: when the app evolves, the site updates itself — reload the page (or close/reopen the installed app) to get the new version. If the old one persists, close/reopen a second time: the browser finalizes the cache update
- **Private browsing**: installation is disabled in private mode — use a normal window

## Step 3 — Scan your books

1. Open the app from the home screen
2. Tap **📷 Scan** → allow the camera (only once)
3. Aim at the barcode **on the back of the book** (EAN-13): the record is created automatically with cover and summary

**Scanning tips**:
- Good lighting, book held flat
- Turn on **🔦 Torch** if lighting is low (if your phone supports it)
- **⚡ Burst mode**: the camera stays open and each book is added in a row — ideal for a whole pile
- **📦 Shelving mode**: enter “Bookcase X, Shelf Y” once, then scan the whole shelf: every book is shelved automatically

## 💻 Using PC + mobile together

The URL **https://chenzu-ai.github.io/bibliotheque-app/** also works on PC (Edge/Chrome → ⊕ Install icon) — no local server needed: GitHub Pages HTTPS allows Windows app installation and even webcam scanning.

Each device has its own local database. To share the library:
1. On the source device: menu ☰ → **💾 Export JSON**
2. Transfer the file (email, cloud…)
3. On the other device: menu ☰ → **📥 Import JSON** → **smart merge** (no duplicates, records are completed)

> ☁️ Even simpler (v2.3): **GitHub cloud backup** — ☰ → 🔑 → GitHub token, then ☁️ Backup to GitHub on one device and ☁️ Restore from GitHub on the other.

> On mobile, stay in “URL covers” mode (default): the “embedded covers” option consumes storage and iOS purges storage of rarely-used apps. Keep regular JSON exports.
---
*My Library — by PrimAlph*

> 🌐 **Language**: the interface is bilingual FR/EN — 🌐 button, automatic browser detection.

> 🇫🇷 **Version française** : [`docs/2-INSTALLATION-MOBILE.md`](../2-INSTALLATION-MOBILE.md)
