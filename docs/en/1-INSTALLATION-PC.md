# 🖥️ Installation guide — PC (Windows 11)

**Ma Bibliothèque / My Library** installs on Windows 11 as a standalone app — no store, no executable.

## ⭐ Express method — from the online URL (30 seconds, recommended)

The app is already hosted over HTTPS: **https://chenzu-ai.github.io/bibliotheque-app/**

1. Open this URL in **Edge** or **Chrome**
2. **Three ways to install** (pick one):
   - The **“⬇️ Install”** button in the app banner (appears after a few seconds)
   - The **⊕** icon in the address bar
   - Menu ⋯ → **Apps** → **Install this site as an app**
3. The app installs as a Windows application: Start menu, desktop, standalone window
4. **Benefits**: no local server needed, **webcam scanning works**, automatic updates from the site

> Methods A and B below are only useful if you want to run 100% offline from your own files, without the URL.

---

## What you need (methods A/B)
- Windows 11 with **Microsoft Edge** or **Google Chrome** (preinstalled)
- The application folder (`index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`, `icons/`)
- Python (optional, for the local server — see method B)

---

## Method A — Direct opening (simplest)

1. Copy the app folder to a fixed location, e.g. `C:\Bibliotheque\`
2. Double-click **`index.html`** → it opens in your browser
3. That's it! Bookmark the page to come back

> ⚠️ Limitation of this method: camera scanning and "app" installation require a local server (method B). Manual ISBN entry and every other feature work perfectly with direct opening.

## Method B — Local server + app installation (recommended)

### Step 1: start the local server
1. Open **PowerShell Terminal** (right-click the Start menu → "Terminal")
2. Go to the app folder:
   ```
   cd C:\Bibliotheque
   ```
3. Start a mini-server:
   ```
   python -m http.server 8080
   ```
   > If Python is not installed: open the Microsoft Store, search "Python 3", install, retry. No-Python alternative: `npx serve` (requires Node.js).

### Step 2: open the app
1. In Edge or Chrome, open: **`http://localhost:8080`**
2. The app loads

### Step 3: install it as a Windows app
1. In the browser address bar, click the **⊕ Install app** icon (or menu ⋯ → Apps → Install)
2. Confirm → **My Library** now appears:
   - in the **Start menu**
   - on the **desktop** / taskbar
   - in a **standalone window**, without browser chrome

3. You can close PowerShell: the service worker caches the app, it opens **offline** straight from the Start menu. (Restart the server only for webcam scanning or fetching new covers.)

---

## 📷 How to scan on PC

| Means | Usage | Recommended |
|---|---|---|
| **USB barcode scanner** (~20-30 €) | Plug it in, click the bottom bar, aim at the barcode: the ISBN is typed + auto-validated | ⭐ Fastest, like a real library |
| **Manual entry** | Type the digits under the book's barcode in the bottom bar, Enter | Always available |
| **Webcam** | "📷 Scan" button (local server required) | For small batches |

> 💡 The USB scanner works **without installing anything**: it emulates a keyboard.

## 🤖 AI on PC (optional)

**Via Ollama (free, 100% local)**:
1. Download from [ollama.com](https://ollama.com) and install
2. In PowerShell: `ollama pull llama3` (or `mistral`, `qwen2.5`…)
3. `ollama serve` (keep it running)
4. In the app: menu ☰ → 🤖 AI → provider **ollama**, URL `http://localhost:11434`

**Via API key (Mistral, OpenAI…)**: menu ☰ → 🤖 AI → provider **api**, paste your key (stored only in your browser).

**Google Books key** (recommended for recognition): menu ☰ → **🔑 API keys (sources)** → paste your key (console.cloud.google.com, 1000 free queries/day) → **🧪 Test** → **💾 Save**. It stays in your browser only.

## 💾 Backing up your data

Data lives **in your browser** (IndexedDB). If you reinstall Windows or switch browsers, it does not follow:
- **Auto backup** already included (every N scans, configurable via ⚙️ Auto backup)
- **Manual backup**: menu ☰ → 💾 Backup now
- **Restore**: menu ☰ → 📥 Import JSON (smart merge, no duplicates)
- ☁️ **GitHub cloud backup** (v2.3): menu ☰ → 🔑 → GitHub token, then ☁️ Backup to GitHub / Restore — your books in your private repository, with version history
- Store your JSON exports in a cloud folder (OneDrive…) for maximum safety
---
*My Library — by PrimAlph*

> 🌐 **Language**: the interface is bilingual FR/EN — 🌐 button, automatic browser detection.

> 🇫🇷 **Version française** : [`docs/1-INSTALLATION-PC.md`](../1-INSTALLATION-PC.md)
