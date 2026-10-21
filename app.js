'use strict';

/* ---------- Utils ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function normalizeIsbn(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

/* ---------- Store (IndexedDB, fallback localStorage) ---------- */
const STORE_KEY = 'biblio.items.v1';
const SHELF_KEY = 'biblio.shelves.v1';
const LISTS_KEY = 'biblio.lists.v1';
const DB_NAME = 'biblio';
const DB_VERSION = 1;

function idbOpen() {
  return new Promise((resolve) => {
    if (!indexedDB) { resolve(null); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function idbGet(db, key) {
  return new Promise((resolve) => {
    if (!db) { resolve(null); return; }
    try {
      const tx = db.transaction('kv', 'readonly');
      const r = tx.objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function idbSet(db, key, val) {
  return new Promise((resolve) => {
    if (!db) { resolve(false); return; }
    try {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

const store = {
  items: [],
  shelves: [],
  lists: [],
  _db: null,
  _useIdb: false,
  async init() {
    this._db = await idbOpen();
    this._useIdb = !!this._db;
    if (this._useIdb) {
      const [items, shelves, lists] = await Promise.all([idbGet(this._db, 'items'), idbGet(this._db, 'shelves'), idbGet(this._db, 'lists')]);
      if (items) { this.items = items; this.shelves = shelves || []; this.lists = lists || []; return; }
    }
    try { this.items = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { this.items = []; }
    try { this.shelves = JSON.parse(localStorage.getItem(SHELF_KEY)) || []; } catch { this.shelves = []; }
    try { this.lists = JSON.parse(localStorage.getItem(LISTS_KEY)) || []; } catch { this.lists = []; }
    if (this._useIdb && this.items.length) await this.save();
  },
  async save() {
    if (this._useIdb) {
      const ok = await idbSet(this._db, 'items', this.items);
      await idbSet(this._db, 'shelves', this.shelves);
      await idbSet(this._db, 'lists', this.lists);
      if (ok) { localStorage.removeItem(STORE_KEY); return; }
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.items));
      localStorage.setItem(SHELF_KEY, JSON.stringify(this.shelves));
      localStorage.setItem(LISTS_KEY, JSON.stringify(this.lists));
    } catch (e) {
      toast('Stockage saturé — faites un export JSON puis libérez de l’espace.', 5000);
    }
  },
  findByIsbn(isbn) {
    return this.items.filter((i) => i.isbn === isbn);
  },
  findById(id) {
    return this.items.find((i) => i.id === id);
  },
  add(item) {
    this.items.push(item);
    this.save();
  },
  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
  },
  update(item) {
    const i = this.items.findIndex((x) => x.id === item.id);
    if (i >= 0) { this.items[i] = item; this.save(); }
  },
};

/* ---------- Metadata fetching (Open Library + Google Books) ---------- */
async function fetchWithTimeout(url, ms = 12000, options = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

function normalizeGoogleMeta(g) {
  const vi = g.volumeInfo || {};
  const ids = (vi.industryIdentifiers || []);
  const isbn13 = ids.find((x) => x.type === 'ISBN_13');
  const isbn10 = ids.find((x) => x.type === 'ISBN_10');
  const img = vi.imageLinks ? (vi.imageLinks.thumbnail || vi.imageLinks.smallThumbnail) : null;
  return {
    isbn: (isbn13 && isbn13.identifier) || (isbn10 && isbn10.identifier) || '',
    isbn10: isbn10 ? isbn10.identifier : '',
    title: vi.title || 'Sans titre',
    subtitle: vi.subtitle || '',
    authors: vi.authors || [],
    publisher: vi.publisher || '',
    publishedDate: vi.publishedDate || '',
    pageCount: vi.pageCount || null,
    language: vi.language || '',
    categories: vi.categories || [],
    summary: vi.description ? vi.description.replace(/<[^>]+>/g, ' ') : '',
    cover: img ? img.replace('http://', 'https://').replace('zoom=1', 'zoom=3') : '',
  };
}

async function fetchOpenLibrary(isbn) {
  try {
    const r = await fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    if (!r.ok) return null;
    const data = await r.json();
    const d = data[`ISBN:${isbn}`];
    if (!d) return null;
    return {
      isbn,
      isbn10: isbn.length === 10 ? isbn : '',
      title: d.title || 'Sans titre',
      subtitle: d.subtitle || '',
      authors: (d.authors || []).map((a) => a.name),
      publisher: d.publishers && d.publishers[0] ? d.publishers[0].name : '',
      publishedDate: d.publish_date || '',
      pageCount: d.number_of_pages || null,
      language: '',
      categories: (d.subjects || []).map((s) => s.name).slice(0, 6),
      summary: (d.excerpts && d.excerpts[0] ? d.excerpts[0].text : '') ||
               (d.notes ? String(d.notes) : ''),
      cover: d.cover ? (d.cover.large || d.cover.medium || d.cover.small) : '',
    };
  } catch { return null; }
}

async function fetchGoogleBooks(isbn) {
  try {
    const r = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${gbKeyParam()}`);
    if (!r.ok) return null;
    const data = await r.json();
    if (data.error) return null;
    if (data.totalItems === 0 || !data.items) return null;
    return normalizeGoogleMeta(data.items[0]);
  } catch { return null; }
}

async function fetchCoverFallback(isbn) {
  if (!isbn) return '';
  try {
    const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
    const r = await fetchWithTimeout(url, 9000);
    if (r.ok) return url.replace('&default=false', '');
  } catch {}
  return '';
}

async function fetchOpenLibrarySearch(isbn) {
  try {
    const r = await fetchWithTimeout(`https://openlibrary.org/search.json?isbn=${isbn}&fields=title,author_name,first_publish_year,publisher&limit=1`, 10000);
    if (!r.ok) return null;
    const data = await r.json();
    const d = data.docs && data.docs[0];
    if (!d) return null;
    return {
      isbn,
      isbn10: '',
      title: d.title || 'Sans titre',
      subtitle: '',
      authors: d.author_name || [],
      publisher: (d.publisher || [])[0] || '',
      publishedDate: d.first_publish_year ? String(d.first_publish_year) : '',
      pageCount: null,
      language: '',
      categories: [],
      summary: '',
      cover: '',
    };
  } catch { return null; }
}

/* Catalogue BnF via SRU (catalogue.bnf.fr) - API officielle, edition française */
async function fetchBnf(isbn) {
  try {
    const q = `bib.persistentid all "isbn:${isbn}" or bib.persistentid all "${isbn}"`;
    const url = 'https://catalogue.bnf.fr/SRU?version=1.2&operation=searchRetrieve&query=' + encodeURIComponent(q) + '&maximumRecords=1&recordSchema=dc';
    const r = await fetchWithTimeout(url, 12000);
    if (!r.ok) return null;
    const xml = await r.text();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    const numFound = doc.querySelector('numberOfRecords');
    if (!numFound || parseInt(numFound.textContent, 10) === 0) return null;
    const rec = doc.querySelector('record');
    if (!rec) return null;
    const getTag = (tag) => {
      const el = rec.querySelector(tag);
      return el ? el.textContent.trim() : '';
    };
    const title = getTag('dc\:title') || rec.getElementsByTagName('dc:title')[0]?.textContent || '';
    if (!title) return null;
    const creators = [...rec.getElementsByTagName('dc:creator')].map((e) => e.textContent.trim()).filter(Boolean);
    const publisher = (rec.getElementsByTagName('dc:publisher')[0] || {}).textContent || '';
    const date = (rec.getElementsByTagName('dc:date')[0] || {}).textContent || '';
    return {
      isbn, isbn10: '',
      title,
      subtitle: '',
      authors: creators.slice(0, 4),
      publisher: publisher.trim(),
      publishedDate: date.trim().slice(0, 4),
      pageCount: null, language: 'fr', categories: [], summary: '', cover: '',
    };
  } catch { return null; }
}

async function fetchMetadata(isbn, wantReport = false) {
  let sources = {};
  try { sources = JSON.parse(localStorage.getItem('biblio.sources.v1') || '{}'); } catch {}
  const on = (id) => sources[id] !== false; // toutes actives par defaut
  const report = { googleBooks: null, bnf: null, openLibrary: null, cover: null };
  const jobs = [];
  if (on('googleBooks')) jobs.push(fetchGoogleBooks(isbn).then((r) => { report.googleBooks = r; }));
  if (on('bnf')) jobs.push(fetchBnf(isbn).then((r) => { report.bnf = r; }));
  if (on('openLibrary')) {
    jobs.push(fetchOpenLibrary(isbn).then((r) => { report.openLibrary = r; }));
    jobs.push(fetchOpenLibrarySearch(isbn).then((r) => { if (!report.openLibrary) report.openLibrary = r; }));
  }
  await Promise.all(jobs);

  // Priorite de base : Google Books (riche) > BnF (FR) > Open Library
  const order = [report.googleBooks, report.bnf, report.openLibrary];
  let meta = order.find((m) => m) || null;
  if (!meta) {
    if (wantReport) return { meta: null, report };
    return null;
  }
  // Fusion par champ : chaque source complete les champs manquants
  for (const other of order) {
    if (!other || other === meta) continue;
    if (!meta.title || meta.title === 'Sans titre') meta.title = other.title;
    if (!meta.subtitle && other.subtitle) meta.subtitle = other.subtitle;
    if ((!meta.authors || !meta.authors.length) && other.authors) meta.authors = other.authors;
    if (!meta.publisher && other.publisher) meta.publisher = other.publisher;
    if (!meta.publishedDate && other.publishedDate) meta.publishedDate = other.publishedDate;
    if (!meta.pageCount && other.pageCount) meta.pageCount = other.pageCount;
    if (!meta.language && other.language) meta.language = other.language;
    if ((!meta.categories || !meta.categories.length) && other.categories) meta.categories = other.categories;
    if (!meta.summary && other.summary) meta.summary = other.summary;
    if (!meta.cover && other.cover) meta.cover = other.cover;
    if (!meta.isbn10 && other.isbn10) meta.isbn10 = other.isbn10;
  }
  if (!meta.cover) {
    meta.cover = await fetchCoverFallback(isbn);
    report.cover = meta.cover || null;
  }
  if (wantReport) return { meta, report };
  return meta;
}

function blankItem(isbn) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    isbn,
    title: '', subtitle: '', authors: [], publisher: '', publishedDate: '',
    pageCount: null, language: '', categories: [], summary: '', cover: '',
    coverBack: '', shelves: [], tags: [], rating: 0, notes: '', status: 'unread',
    medium: 'book', volume: '', series: '', location: '', furniture: '', slot: '', duplicateOf: false,
    scenario: [], art: [], favorite: false, wishlist: false,
    loan: null, loanHistory: [],
    dewey: '', genre: '',
    seriesState: '', seriesTotal: null,
    addedAt: new Date().toISOString(),
  };
}

/* ---------- Adding flow (with duplicate detection) ---------- */
let pendingIsbn = null;

function isBlankFiche(item) {
  if (!item) return false;
  const hasTitle = item.title && !/^ISBN \d+/.test(item.title);
  return !hasTitle || (!item.authors.length && !item.summary && !item.cover);
}

function enrichItem(item, meta) {
  if (!meta) return item;
  const before = JSON.stringify(item);
  if (!item.title || /^ISBN \d+/.test(item.title)) item.title = meta.title;
  if (!item.subtitle) item.subtitle = meta.subtitle || '';
  if (!item.authors.length) item.authors = meta.authors || [];
  if (!item.publisher) item.publisher = meta.publisher || '';
  if (!item.publishedDate) item.publishedDate = meta.publishedDate || '';
  if (!item.pageCount) item.pageCount = meta.pageCount || null;
  if (!item.language) item.language = meta.language || '';
  if (!item.categories.length) item.categories = meta.categories || [];
  if (!item.summary) item.summary = meta.summary || '';
  if (!item.cover) item.cover = meta.cover || '';
  if (!item.isbn10 && meta.isbn10) item.isbn10 = meta.isbn10;
  return JSON.stringify(item) !== before;
}

async function lookupAndMaybeAdd(isbn, silentDup = false) {
  isbn = normalizeIsbn(isbn);
  if (!/^[0-9]{9}[0-9X]|[0-9]{13}$/.test(isbn)) { toast('ISBN invalide (10 ou 13 chiffres attendus).'); return; }
  const dup = store.findByIsbn(isbn);
  // Rescan d'une fiche vide/incomplete => on la COMPLETE au lieu de dupliquer
  const blank = dup.find((d) => isBlankFiche(d));
  if (blank && !silentDup) {
    toast('Fiche existante incomplète détectée — recherche des informations…');
    const meta = await fetchMetadata(isbn);
    if (meta) {
      enrichItem(blank, meta);
      store.update(blank);
      toast(`Fiche complétée : ${blank.title}`, 3500);
      renderAll();
      openDetail(blank.id);
      return;
    }
    toast('Toujours introuvable dans les catalogues — ouvrez la fiche pour compléter à la main ou via 🤖 IA.', 4500);
    openDetail(blank.id);
    return;
  }
  if (dup.length && !silentDup) {
    pendingIsbn = isbn;
    $('#dupMsg').innerHTML = `« <b>${esc(dup[0].title || isbn)}</b> » est déjà dans votre bibliothèque${dup.length > 1 ? ` (${dup.length} exemplaires)` : ''}.<br>Voulez-vous ajouter un autre exemplaire ?`;
    $('#dupModal').classList.remove('hidden');
    return;
  }
  toast('Recherche des informations…');
  const meta = await fetchMetadata(isbn);
  const item = { ...blankItem(isbn), ...(meta || {}), duplicateOf: dup.length > 0 };
  applyShelveMode(item);
  autoBackupTick();
  if (!meta) {
    toast('Introuvable dans les catalogues (édition française rare ?) — fiche créée : complétez titre/auteur, ou utilisez 🤖 Compléter par IA.', 5000);
    item.title = `ISBN ${isbn}`;
    store.add(item);
    openDetail(item.id);
  } else {
    store.add(item);
    toast(`Ajouté : ${meta.title}`, 3000);
  }
  checkSeriesScatter(item);
  renderAll();
}

/* Alert right after a scan when the series is spread across several spots */
function checkSeriesScatter(item) {
  if (!item.series) return;
  const scatter = seriesScatter(item.series);
  if (scatter.length < 2) return;
  const loc = locationOf(item) || '— non renseigné —';
  const others = scatter.filter((s) => s.loc !== loc);
  if (!others.length) return;
  const detail = others.map((s) => `« ${s.loc} » (tomes : ${s.tomes.join(', ')})`).join(' ; ');
  setTimeout(() => {
    if (confirm(`⚠ Série « ${item.series} » dispersée !\n\nCe tome : ${loc}\nAutres emplacements : ${detail}\n\nVoulez-vous ouvrir la fiche pour indiquer où ranger ce tome ?`)) {
      openDetail(item.id);
    }
  }, 400);
}

$('#btnDupAdd').addEventListener('click', () => {
  $('#dupModal').classList.add('hidden');
  if (pendingIsbn) lookupAndMaybeAdd(pendingIsbn, true);
});
$('#btnDupCancel').addEventListener('click', () => {
  $('#dupModal').classList.add('hidden');
  pendingIsbn = null;
});

/* ---------- Scanner ---------- */
let codeReader = null;
let scanActive = false;

let burstScan = false;
let lastScannedCode = '';
let lastScanTime = 0;

async function startScan() {
  if (scanActive) return;
  scanActive = true;
  $('#scanModal').classList.remove('hidden');
  $('#scanStatus').textContent = 'Initialisation de la caméra…';
  $('#btnBurst').classList.toggle('hidden', !!invSession);
  $('#btnBurst').classList.toggle('shelve-on', burstScan);
  if (!window.ZXing) {
    $('#scanStatus').textContent = 'Bibliothèque de scan non chargée (hors-ligne ?). Saisissez l\'ISBN manuellement ci-dessous.';
    stopScan();
    return;
  }
  codeReader = new ZXing.BrowserMultiFormatReader();
  try {
    await codeReader.decodeFromVideoDevice(null, $('#scanVideo'), (result, err) => {
      if (result && scanActive) {
        const txt = result.getText();
        if (/^[0-9]{13}$/.test(txt) || /^[0-9]{9}[0-9X]$/.test(txt)) {
          if (invSession) { invHandleScan(txt); return; }
          if (burstScan) {
            const now = Date.now();
            if (txt === lastScannedCode && now - lastScanTime < 3000) return;
            lastScannedCode = txt;
            lastScanTime = now;
            lookupAndMaybeAdd(txt);
            $('#scanStatus').textContent = '⚡ Ajouté : ' + txt + ' — continuez à scanner !';
            return;
          }
          stopScan();
          lookupAndMaybeAdd(txt);
        }
      }
    });
    $('#scanStatus').textContent = burstScan
      ? '⚡ Mode rafale : chaque code scanné est ajouté directement. Continuez sans fermer.'
      : 'Visez le code-barres (EAN-13 / ISBN) au dos du livre…';
    try {
      const track = codeReader.stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) $('#btnTorch').classList.remove('hidden');
    } catch {}
  } catch (e) {
    $('#scanStatus').textContent = 'Caméra indisponible ou refusée. Sur PC, saisissez l\'ISBN manuellement.';
  }
}

$('#btnBurst').addEventListener('click', () => {
  burstScan = !burstScan;
  $('#btnBurst').classList.toggle('shelve-on', burstScan);
  $('#scanStatus').textContent = burstScan
    ? '⚡ Mode rafale : chaque code scanné est ajouté directement. Continuez sans fermer.'
    : 'Visez le code-barres (EAN-13 / ISBN) au dos du livre…';
});

function stopScan() {
  scanActive = false;
  if (codeReader) { codeReader.reset(); codeReader = null; }
  $('#scanModal').classList.add('hidden');
  $('#btnTorch').classList.add('hidden');
}

$('#btnScan').addEventListener('click', startScan);
$('#btnCloseScan').addEventListener('click', stopScan);
$('#btnTorch').addEventListener('click', async () => {
  try {
    const track = codeReader.stream.getVideoTracks()[0];
    const on = track.getCapabilities && track.getCapabilities().torch;
    await track.applyConstraints({ advanced: [{ torch: !$('#btnTorch').dataset.on }] });
    $('#btnTorch').dataset.on = $('#btnTorch').dataset.on === '1' ? '' : '1';
  } catch { toast('Lampe non disponible.'); }
});

/* ---------- Rendering: grid ---------- */
function starStr(n) {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function knownFurniture() {
  return [...new Set(store.items.map((i) => i.furniture).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
}

function knownSlots() {
  return [...new Set(store.items.map((i) => i.slot).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
}

function locationOf(it) {
  if (it.furniture || it.slot) return [it.furniture, it.slot].filter(Boolean).join(' · ');
  return it.location || '';
}

/* Volumes of the same series stored at different physical spots */
function seriesScatter(series) {
  if (!series) return [];
  const vols = store.items.filter((i) => i.series === series);
  const spots = new Map();
  for (const v of vols) {
    const loc = locationOf(v) || '—';
    if (!spots.has(loc)) spots.set(loc, []);
    spots.get(loc).push(v.volume ? 'T.' + v.volume : v.title);
  }
  return [...spots.entries()].map(([loc, tomes]) => ({ loc, tomes }))
    .sort((a, b) => a.loc.localeCompare(b.loc, 'fr'));
}

function markLoanReturned(item, date) {
  if (!Array.isArray(item.loanHistory)) item.loanHistory = [];
  const open = [...item.loanHistory].reverse().find((h) => !h.returned);
  if (open) open.returned = date;
}

function currentFilter() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const sort = $('#sortSelect').value;
  const shelf = $('#shelfFilter').value;
  const status = $('#statusFilter').value;
  let items = store.items.slice();
  if (shelf) items = items.filter((i) => i.shelves.includes(shelf));
  if (status === 'loaned') items = items.filter((i) => i.loan);
  else if (status) items = items.filter((i) => i.status === status);
  if ($('#favOnly').checked) items = items.filter((i) => i.favorite);
  if (q) {
    items = items.filter((i) =>
      [i.title, i.subtitle, i.authors.join(', '), i.isbn, i.series, i.publisher,
       i.tags.join(' '), i.notes, i.categories.join(' '), i.dewey, i.genre, i.location, i.furniture, i.slot]
        .join(' ').toLowerCase().includes(q));
  }
  const cmp = {
    added: (a, b) => b.addedAt.localeCompare(a.addedAt),
    title: (a, b) => a.title.localeCompare(b.title, 'fr'),
    author: (a, b) => (a.authors[0] || '').localeCompare(b.authors[0] || '', 'fr'),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    year: (a, b) => (b.publishedDate || '').localeCompare(a.publishedDate || ''),
    dewey: (a, b) => (parseFloat(a.dewey) || 1e9) - (parseFloat(b.dewey) || 1e9) || (a.genre || '').localeCompare(b.genre || '', 'fr'),
  }[sort];
  return items.sort(cmp);
}

function renderGrid() {
  const grid = $('#grid');
  const items = currentFilter();
  const PAGE = 60;
  renderGrid._shown = renderGrid._reset ? PAGE : (renderGrid._shown || PAGE);
  renderGrid._reset = false;
  const shown = items.slice(0, renderGrid._shown);
  grid.innerHTML = '';
  $('#emptyMsg').classList.toggle('hidden', items.length > 0);
  for (const it of shown) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      ${coverSrc(it)
        ? `<img class="thumb" loading="lazy" src="${esc(coverSrc(it))}" alt="">`
        : `<div class="thumb placeholder">📖</div>`}
      <div class="meta">
        <h3>${esc(it.title)}</h3>
        <p>${esc(it.authors.join(', ') || it.isbn)}</p>
        ${it.rating ? `<div class="stars">${starStr(it.rating)}</div>` : ''}
        ${it.favorite ? '<div class="stars"><span class="fav-mark">♥ favori</span></div>' : ''}
        <div class="chips">
          ${it.wishlist ? '<span class="chip wish">🛒 souhait</span>' : ''}
          ${it.loan ? '<span class="chip loan">📤 ' + esc(it.loan.to) + '</span>' : ''}
          ${it.location ? '<span class="chip shelf">📍 ' + esc(it.location) + '</span>' : ''}
          ${(it.shelves || []).map((s) => `<span class="chip shelf">${esc(s)}</span>`).join('')}
          ${it.duplicateOf ? '<span class="chip dup">⚠ doublon</span>' : ''}
        </div>
      </div>`;
    if (bulkMode) {
      const cb = document.createElement('div');
      cb.className = 'bulk-check' + (bulkSel.has(it.id) ? ' on' : '');
      cb.textContent = bulkSel.has(it.id) ? '☑' : '☐';
      card.appendChild(cb);
      card.addEventListener('click', (e) => {
        e.preventDefault();
        if (bulkSel.has(it.id)) bulkSel.delete(it.id); else bulkSel.add(it.id);
        cb.textContent = bulkSel.has(it.id) ? '☑' : '☐';
        cb.classList.toggle('on', bulkSel.has(it.id));
        $('#bulkCount').textContent = bulkSel.size + ' sélectionné(s)';
      });
    } else {
      card.addEventListener('click', () => openDetail(it.id));
    }
    grid.appendChild(card);
  }
  const more = $('#btnMore');
  more.classList.toggle('hidden', items.length <= renderGrid._shown);
  $('#pageInfo').textContent = `${shown.length} affichés sur ${items.length}`;
  $('#countBadge').textContent = store.items.length + ' ouvrage' + (store.items.length > 1 ? 's' : '');
}

function resetPaging() { renderGrid._reset = true; }

function renderShelfOptions() {
  const sel = $('#shelfFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Toutes les étagères</option>' +
    store.shelves.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.value = store.shelves.includes(cur) ? cur : '';
}

function renderShelves() {
  const ul = $('#shelfList');
  ul.innerHTML = '';
  if (!store.shelves.length) {
    ul.innerHTML = '<li class="hint">Aucune étagère. Créez-en une ci-dessus.</li>';
    return;
  }
  for (const s of store.shelves) {
    const n = store.items.filter((i) => i.shelves.includes(s)).length;
    const li = document.createElement('li');
    li.innerHTML = `<span><b>${esc(s)}</b> <span class="hint">— ${n} ouvrage(s)</span></span>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-danger small';
    btn.textContent = 'Supprimer';
    btn.addEventListener('click', () => {
      if (!confirm(`Supprimer l'étagère « ${s} » ? Les ouvrages ne seront pas supprimés.`)) return;
      store.shelves = store.shelves.filter((x) => x !== s);
      store.items.forEach((i) => { i.shelves = i.shelves.filter((x) => x !== s); });
      store.save();
      renderAll();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function renderStats() {
  const v = $('#viewStats');
  const items = store.items;
  const rated = items.filter((i) => i.rating > 0);
  const avg = rated.length ? (rated.reduce((s, i) => s + i.rating, 0) / rated.length).toFixed(1) : '—';
  const authors = new Set(items.flatMap((i) => i.authors));
  const publishers = new Set(items.map((i) => i.publisher).filter(Boolean));
  const byStatus = { unread: 0, reading: 0, read: 0, wish: 0 };
  const loaned = items.filter((i) => i.loan).length;
  const late = items.filter((i) => i.loan && i.loan.due && i.loan.due < todayISO()).length;
  items.forEach((i) => { if (byStatus[i.status] !== undefined) byStatus[i.status]++; });
  const mediums = {};
  items.forEach((i) => { mediums[i.medium] = (mediums[i.medium] || 0) + 1; });
  v.innerHTML = `
    <h2>Statistiques</h2>
    <div class="stats-grid">
      <div class="stat-card"><div class="num">${items.length}</div><div class="lbl">Ouvrages total</div></div>
      <div class="stat-card"><div class="num">${authors.size}</div><div class="lbl">Auteurs distincts</div></div>
      <div class="stat-card"><div class="num">${publishers.size}</div><div class="lbl">Éditeurs distincts</div></div>
      <div class="stat-card"><div class="num">${avg}</div><div class="lbl">Note moyenne</div></div>
      <div class="stat-card"><div class="num">${byStatus.read}</div><div class="lbl">Lus</div></div>
      <div class="stat-card"><div class="num">${byStatus.reading}</div><div class="lbl">En lecture</div></div>
      <div class="stat-card"><div class="num">${byStatus.unread}</div><div class="lbl">À lire</div></div>
      <div class="stat-card"><div class="num">${byStatus.wish}</div><div class="lbl">Souhaits (à acheter)</div></div>
      <div class="stat-card"><div class="num">${loaned}</div><div class="lbl">Prêtés ${late ? `(${late} en retard)` : ''}</div></div>
      <div class="stat-card"><div class="num">${store.items.filter((i) => i.favorite).length}</div><div class="lbl">Favoris</div></div>
      ${Object.entries(mediums).map(([m, n]) =>
        `<div class="stat-card"><div class="num">${n}</div><div class="lbl">${esc(mediumLabel(m))}</div></div>`).join('')}
    </div>
    <h2>📍 Répartition par emplacement</h2>
    <div class="stats-grid">${locationsList().map(([loc, its]) => {
      const max = Math.max(...locationsList().map(([, l]) => l.length), 1);
      const pct = Math.round(its.length / max * 100);
      return `<div class="stat-card"><div class="num">${its.length}</div><div class="lbl">${esc(loc)}</div>
        <div class="heat"><div class="heat-fill" style="width:${pct}%"></div></div></div>`;
    }).join('') || '<p class="hint">Aucun emplacement renseigné.</p>'}</div>
    <h2>📈 Ajouts dans le temps</h2>
    ${additionsChart()}
    <h2>⭐ Top auteurs</h2>
    <div class="stats-grid">${topAuthors(8).map(([a, n]) =>
      `<div class="stat-card"><div class="num">${n}</div><div class="lbl">${esc(a)}</div></div>`).join('') || '<p class="hint">—</p>'}</div>`;
}

function topAuthors(n) {
  const count = new Map();
  for (const it of store.items) for (const a of (it.authors || [])) count.set(a, (count.get(a) || 0) + 1);
  return [...count.entries()].sort((x, y) => y[1] - x[1]).slice(0, n);
}

function additionsChart() {
  const items = store.items.filter((i) => i.addedAt);
  if (!items.length) return '<p class="hint">—</p>';
  const byMonth = new Map();
  for (const it of items) {
    const m = it.addedAt.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) || 0) + 1);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const max = Math.max(...months.map(([, n]) => n), 1);
  return `<div class="chart">${months.map(([m, n]) =>
    `<div class="chart-col" title="${m} : ${n} ajout(s)"><div class="chart-bar" style="height:${Math.round(n / max * 70) + 4}px"></div><span class="chart-lbl">${m.slice(2).replace('-', '/')}</span></div>`).join('')}</div>`;
}

function mediumLabel(m) {
  return { book: 'Livres', comic: 'BD', manga: 'Mangas', other: 'Autres' }[m] || m;
}

function renderAll() {
  renderShelfOptions();
  renderGrid();
  renderShelves();
  renderStats();
  if (typeof renderGroups === 'function') renderGroups();
  if (typeof renderLists === 'function') renderLists();
  if (typeof renderLoans === 'function') renderLoans();
  if (typeof renderBorrowers === 'function') renderBorrowers();
}

/* ---------- Detail / edit ---------- */
let editingId = null;

function field(label, inner) {
  return `<div><label>${label}</label>${inner}</div>`;
}

function openDetail(id) {
  const it = store.findById(id);
  if (!it) return;
  editingId = id;
  $('#detailTitle').textContent = it.title || 'Ouvrage';
  const img = $('#coverFront');
  const src = coverSrc(it);
  if (src) { img.src = src; img.classList.remove('hidden'); }
  else img.classList.add('hidden');
  const back = $('#coverBack');
  const showBack = $('#btnShowBack');
  const flip = $('#btnFlipCover');
  if (it.coverBack) { back.src = it.coverBack; back.classList.remove('hidden'); flip.classList.remove('hidden'); showBack.classList.add('hidden'); }
  else { back.classList.add('hidden'); flip.classList.add('hidden'); showBack.classList.remove('hidden'); }

  const shelvesChecks = store.shelves.map((s) =>
    `<label class="chk"><input type="checkbox" name="shelves" value="${esc(s)}" ${it.shelves.includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join('');
  const tagsStr = (it.tags || []).join(', ');
  $('#detailForm').innerHTML = `
    ${field('Titre', `<input type="text" name="title" value="${esc(it.title)}">`)}
    ${field('Sous-titre', `<input type="text" name="subtitle" value="${esc(it.subtitle || '')}">`)}
    ${field('Auteur(s) — séparés par des virgules', `<input type="text" name="authors" value="${esc(it.authors.join(', '))}">`)}
    <div class="form-row">
      ${field('Type', `<select name="medium">
        <option value="book" ${it.medium === 'book' ? 'selected' : ''}>Livre</option>
        <option value="comic" ${it.medium === 'comic' ? 'selected' : ''}>BD</option>
        <option value="manga" ${it.medium === 'manga' ? 'selected' : ''}>Manga</option>
        <option value="other" ${it.medium === 'other' ? 'selected' : ''}>Autre</option>
      </select>`)}
      ${field('Statut', `<select name="status">
        <option value="unread" ${it.status === 'unread' ? 'selected' : ''}>À lire</option>
        <option value="reading" ${it.status === 'reading' ? 'selected' : ''}>En lecture</option>
        <option value="read" ${it.status === 'read' ? 'selected' : ''}>Lu</option>
      </select>`)}
    </div>
    <div class="form-row">
      ${field('Série', `<input type="text" name="series" value="${esc(it.series || '')}">`)}
      ${field('Tome / Volume', `<input type="text" name="volume" value="${esc(it.volume || '')}">`)}
    </div>
    <div class="form-row">
      ${field('Scénariste(s) — virgules', `<input type="text" name="scenario" value="${esc((it.scenario || []).join(', '))}">`)}
      ${field('Dessinateur(s) — virgules', `<input type="text" name="art" value="${esc((it.art || []).join(', '))}">`)}
    </div>
    <div class="form-row">
      ${field('Cote Dewey (ex. 843, 741.5)', `<input type="text" name="dewey" inputmode="decimal" value="${esc(it.dewey || '')}">`)}
      ${field('Genre (ex. Polar, SF, Heroic fantasy)', `<input type="text" name="genre" value="${esc(it.genre || '')}">`)}
    </div>
    <div class="form-row">
      ${field('État de la série', `<select name="seriesState">
        <option value="" ${!it.seriesState ? 'selected' : ''}>—</option>
        <option value="ongoing" ${it.seriesState === 'ongoing' ? 'selected' : ''}>Série en cours (suite prévue)</option>
        <option value="complete" ${it.seriesState === 'complete' ? 'selected' : ''}>Série complète</option>
      </select>`)}
      ${field('Nombre de tomes de la série', `<input type="number" name="seriesTotal" min="1" value="${esc(it.seriesTotal ?? '')}">`)}
    </div>
    <div class="form-row">
      <label class="chk"><input type="checkbox" name="favorite" ${it.favorite ? 'checked' : ''}> ♥ Favori</label>
      <label class="chk"><input type="checkbox" name="wishlist" ${it.wishlist ? 'checked' : ''}> 🛒 Souhait (à acheter)</label>
    </div>
    <div class="form-row">
      ${field('Prêt', `<div style="display:flex;gap:8px;align-items:center">
        <input type="text" name="loanTo" placeholder="Prêté à…" value="${esc(it.loan ? it.loan.to : '')}">
        <input type="date" name="loanDue" value="${esc(it.loan ? it.loan.due || '' : '')}" title="Retour prévu">
        ${it.loan ? '<button type="button" class="btn small" id="btnReturnLoan">↩ Retour</button>' : ''}
      </div>`)}
    </div>
    ${field('Note (sur 5)', `<div class="stars-input" id="starsInput">${[1,2,3,4,5].map((n) =>
      `<span data-n="${n}" class="${n <= (it.rating || 0) ? 'on' : ''}">★</span>`).join('')}</div>`)}
    ${field('Annotation / avis personnel', `<textarea name="notes">${esc(it.notes || '')}</textarea>`)}
    ${field('Étagères', shelvesChecks || '<span class="hint">Aucune étagère — créez-en une dans l\'onglet Étagères.</span>')}
    ${field('Tags (virgules)', `<input type="text" name="tags" value="${esc(tagsStr)}">`)}
    ${field('Emplacement physique', `<div class="form-row location-row">
      <input type="text" name="furniture" list="furnitureList" placeholder="Meuble (ex. Bibliothèque salon)" value="${esc(it.furniture || '')}">
      <input type="text" name="slot" list="slotList" placeholder="Étagère / rayon (ex. Étagère 4)" value="${esc(it.slot || '')}">
      <datalist id="furnitureList">${knownFurniture().map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
      <datalist id="slotList">${knownSlots().map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    </div>`)}
    ${field('Résumé', `<textarea name="summary" rows="4">${esc(it.summary || '')}</textarea>`)}
    <div class="form-row">
      ${field('Éditeur', `<input type="text" name="publisher" value="${esc(it.publisher || '')}">`)}
      ${field('Date de publication', `<input type="text" name="publishedDate" value="${esc(it.publishedDate || '')}">`)}
    </div>
    <div class="form-row">
      ${field('ISBN', `<input type="text" name="isbn" value="${esc(it.isbn)}">`)}
      ${field('Pages', `<input type="number" name="pageCount" value="${esc(it.pageCount ?? '')}">`)}
    </div>
    <div class="form-row">
      ${field('URL image couverture', `<input type="text" name="cover" value="${esc(it.cover || '')}">`)}
      ${field('URL image dos', `<input type="text" name="coverBack" value="${esc(it.coverBack || '')}">`)}
    </div>
    <p class="refs">Ajouté le ${esc((it.addedAt || '').slice(0, 10))} · ISBN : ${esc(it.isbn)}${it.isbn10 ? ' / ' + esc(it.isbn10) : ''}${it.language ? ' · langue : ' + esc(it.language) : ''}</p>
    ${it.isbn ? `<div class="form-row ext-links">
      <a class="btn small" target="_blank" rel="noopener" href="https://www.chasse-aux-livres.fr/livre/${esc(it.isbn)}">🇫🇷 Chasse aux livres</a>
      <a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent('couverture livre ' + (it.title || '') + ' ' + it.isbn)}">🖼️ Image couverture</a>
      ${it.series ? `<a class="btn small" target="_blank" rel="noopener" href="https://www.chasse-aux-livres.fr/recherche?q=${encodeURIComponent(it.series)}">📚 La série « ${esc(it.series)} »</a>` : ''}
    </div>` : ''}
  `;
  $('#detailModal').classList.remove('hidden');
  const btnAiFill = $('#btnAiFill');
  if (btnAiFill) btnAiFill.addEventListener('click', async () => {
    if (!aiCfg.key && aiCfg.provider !== 'ollama') { toast('Configurez d’abord l’IA dans le menu 🤖 IA.', 4000); return; }
    btnAiFill.disabled = true;
    btnAiFill.textContent = '⏳ Complément IA…';
    try {
      await aiFillItem(editingId);
      toast('Fiche complétée par l’IA.');
      openDetail(editingId);
      renderAll();
    } catch (e) {
      toast('Erreur IA : ' + e.message, 4000);
    }
    btnAiFill.disabled = false;
    btnAiFill.textContent = '🤖 Compléter par IA';
  });
  $('#starsInput').addEventListener('click', (e) => {
    const n = +e.target.dataset.n;
    if (!n) return;
    $('#starsInput').dataset.value = n;
    [...$('#starsInput').children].forEach((s) => s.classList.toggle('on', +s.dataset.n <= n));
  });
  const btnRet = $('#btnReturnLoan');
  if (btnRet) btnRet.addEventListener('click', () => {
    const it2 = store.findById(editingId);
    if (!it2 || !it2.loan) return;
    if (!confirm(`« ${it2.title} » rendu par ${it2.loan.to} ?`)) return;
    markLoanReturned(it2, todayISO());
    it2.loan = null;
    store.update(it2);
    $('#detailModal').classList.add('hidden');
    renderAll();
    toast('Retour enregistré.');
  });
  const hist = (it.loanHistory || []);
  if (hist.length) {
    const box = document.createElement('div');
    box.innerHTML = `${field('Historique des prêts', `<div class="hint">${hist.slice().reverse().map((h) =>
      `📤 ${esc(h.to)} · ${esc(h.date)}${h.due ? ` → ${esc(h.due)}` : ''} · ${h.returned ? `↩ rendu le ${esc(h.returned)}` : '<b>en cours</b>'}`).join('<br>')}</div>`)}`;
    $('#detailForm').appendChild(box);
  }
}

$('#btnShowBack').addEventListener('click', () => {
  const it = store.findById(editingId);
  toast(it && it.coverBack ? 'Cet ouvrage a une image de dos : cliquez « Retourner ».' : 'Aucune image de dos enregistrée. Ajoutez-la via le champ « URL image dos ».');
});
$('#btnFlipCover').addEventListener('click', () => {
  $('#coverFront').classList.toggle('hidden');
  $('#coverBack').classList.toggle('hidden');
});

$('#btnSaveDetail').addEventListener('click', () => {
  const it = store.findById(editingId);
  if (!it) return;
  const f = $('#detailForm');
  const val = (n) => f.querySelector(`[name="${n}"]`).value.trim();
  it.title = val('title');
  it.subtitle = val('subtitle');
  it.authors = val('authors').split(',').map((s) => s.trim()).filter(Boolean);
  it.medium = f.querySelector('[name="medium"]').value;
  it.status = f.querySelector('[name="status"]').value;
  it.series = val('series');
  it.volume = val('volume');
  it.scenario = val('scenario').split(',').map((s) => s.trim()).filter(Boolean);
  it.art = val('art').split(',').map((s) => s.trim()).filter(Boolean);
  it.seriesState = f.querySelector('[name="seriesState"]').value;
  it.seriesTotal = +val('seriesTotal') || null;
  it.favorite = f.querySelector('[name="favorite"]').checked;
  it.wishlist = f.querySelector('[name="wishlist"]').checked;
  it.dewey = val('dewey').replace(',', '.').trim();
  it.genre = val('genre');
  const loanTo = val('loanTo');
  const loanDue = val('loanDue') || null;
  if (loanTo) {
    const sameAsCurrent = it.loan && it.loan.to === loanTo;
    const prevDue = sameAsCurrent ? (it.loan.due || null) : null;
    it.loan = { to: loanTo, date: sameAsCurrent ? it.loan.date : todayISO(), due: loanDue };
    if (!sameAsCurrent) {
      if (!Array.isArray(it.loanHistory)) it.loanHistory = [];
      it.loanHistory.push({ to: loanTo, date: it.loan.date, due: loanDue, returned: null });
    } else if (prevDue !== loanDue) {
      it.loan.due = loanDue;
      const open = (it.loanHistory || []).findLast((h) => h.to === loanTo && !h.returned);
      if (open) open.due = loanDue;
    }
  } else if (it.loan) {
    markLoanReturned(it, todayISO());
    it.loan = null;
  }
  it.rating = $('#starsInput').dataset.value ? +$('#starsInput').dataset.value : (it.rating || 0);
  it.notes = val('notes');
  it.shelves = [...f.querySelectorAll('[name="shelves"]:checked')].map((c) => c.value);
  it.tags = val('tags').split(',').map((s) => s.trim()).filter(Boolean);
  it.furniture = val('furniture');
  it.slot = val('slot');
  it.location = [it.furniture, it.slot].filter(Boolean).join(' · ') || '';
  it.summary = val('summary');
  it.publisher = val('publisher');
  it.publishedDate = val('publishedDate');
  it.isbn = normalizeIsbn(val('isbn'));
  it.pageCount = +val('pageCount') || null;
  it.cover = val('cover');
  it.coverBack = val('coverBack');
  store.update(it);
  $('#detailModal').classList.add('hidden');
  toast('Enregistré.');
  renderAll();
});

$('#btnDeleteDetail').addEventListener('click', () => {
  const it = store.findById(editingId);
  if (!it) return;
  if (!confirm(`Supprimer « ${it.title} » de la bibliothèque ?`)) return;
  store.remove(editingId);
  $('#detailModal').classList.add('hidden');
  toast('Supprimé.');
  renderAll();
});
$('#btnCloseDetail').addEventListener('click', () => $('#detailModal').classList.add('hidden'));

/* ---------- Shelves ---------- */
$('#btnAddShelf').addEventListener('click', () => {
  const name = $('#newShelfName').value.trim();
  if (!name) return;
  if (store.shelves.includes(name)) { toast('Cette étagère existe déjà.'); return; }
  store.shelves.push(name);
  store.save();
  $('#newShelfName').value = '';
  renderAll();
  toast(`Étagère « ${name} » créée.`);
});

/* ---------- Navigation ---------- */
$('#btnMenu').addEventListener('click', () => $('#mainNav').classList.toggle('hidden'));
$('#mainNav').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  $('#mainNav').classList.add('hidden');
  document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
  const view = { grid: '#viewGrid', shelves: '#viewShelves', stats: '#viewStats', groups: '#viewGroups', lists: '#viewLists', loans: '#viewLoans', inventory: '#viewInventory' }[btn.dataset.view] || '#viewGrid';
  if (btn.dataset.view === 'inventory') renderInventoryLocations();
  $(view).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
});

/* ---------- Auto backup ---------- */
const BKCFG_KEY = 'biblio.backup.v1';
let backupCfg = { every: 10, since: 0, enabled: true };
try { backupCfg = { ...backupCfg, ...(JSON.parse(localStorage.getItem(BKCFG_KEY)) || {}) }; } catch {}

function saveBackupCfg() { localStorage.setItem(BKCFG_KEY, JSON.stringify(backupCfg)); }

function exportJsonPayload() {
  const covers = coversCfg.embedded ? coverStore.data : {};
  return JSON.stringify({ app: 'Ma Bibliothèque', exportedAt: new Date().toISOString(), embeddedCovers: coversCfg.embedded, covers, shelves: store.shelves, lists: store.lists, items: store.items }, null, 2);
}

function autoBackupTick() {
  if (!backupCfg.enabled || !backupCfg.every) return;
  backupCfg.since++;
  saveBackupCfg();
  if (backupCfg.since >= backupCfg.every) {
    backupCfg.since = 0;
    saveBackupCfg();
    download(`bibliotheque-auto-${stamp()}.json`, exportJsonPayload(), 'application/json');
    toast('Sauvegarde automatique téléchargée.', 3500);
  }
}

$('#btnBackupNow').addEventListener('click', () => {
  download(`bibliotheque-${stamp()}-${new Date().toTimeString().slice(0,5).replace(':','h')}.json`, exportJsonPayload(), 'application/json');
  toast('Sauvegarde téléchargée.');
});

$('#btnBackupCfg').addEventListener('click', () => {
  const raw = prompt('Sauvegarde automatique : tous les N scans (0 = désactivée). N =', String(backupCfg.every));
  if (raw === null) return;
  const n = Math.max(0, Math.floor(+raw || 0));
  backupCfg.every = n;
  backupCfg.enabled = n > 0;
  backupCfg.since = 0;
  saveBackupCfg();
  $('#bkCfgLbl').textContent = n;
  toast(n ? `Sauvegarde auto : tous les ${n} scans.` : 'Sauvegarde auto désactivée.');
});

/* ---------- Import / export ---------- */
$('#btnManualAdd').addEventListener('click', () => {
  const v = $('#manualIsbn').value;
  $('#manualIsbn').value = '';
  if (invSession) { invHandleScan(v); return; }
  lookupAndMaybeAdd(v);
});
$('#manualIsbn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { lookupAndMaybeAdd(e.target.value); e.target.value = ''; }
});

function addWithoutIsbn() {
  const item = blankItem('');
  item.title = 'Nouvel ouvrage';
  applyShelveMode(item);
  store.add(item);
  renderAll();
  openDetail(item.id);
  toast('Fiche vierge créée — complétez les informations.');
}
$('#btnAddNoIsbn').addEventListener('click', addWithoutIsbn);

/* ---------- Shelve mode (scan a whole shelf at once) ---------- */
const SHELVE_KEY = 'biblio.shelve.v1';
let shelveMode = null;
try { shelveMode = JSON.parse(localStorage.getItem(SHELVE_KEY)) || null; } catch {}

function saveShelveMode() {
  if (shelveMode) localStorage.setItem(SHELVE_KEY, JSON.stringify(shelveMode));
  else localStorage.removeItem(SHELVE_KEY);
  updateShelveUI();
}

function updateShelveUI() {
  const btn = $('#btnShelveMode');
  if (!btn) return;
  if (shelveMode) {
    btn.classList.add('shelve-on');
    btn.textContent = `📦 ${shelveMode.furniture || '?'} · ${shelveMode.slot || '?'} (actif — cliquer pour arrêter)`;
  } else {
    btn.classList.remove('shelve-on');
    btn.textContent = '📦 Mode rangement';
  }
}

function applyShelveMode(item) {
  if (!shelveMode) return;
  item.furniture = shelveMode.furniture || '';
  item.slot = shelveMode.slot || '';
  item.location = [item.furniture, item.slot].filter(Boolean).join(' · ');
}

$('#btnShelveMode').addEventListener('click', () => {
  if (shelveMode) {
    shelveMode = null;
    saveShelveMode();
    toast('Mode rangement désactivé.');
    return;
  }
  const furniture = prompt('Meuble à associer aux prochains scans :\n(ex. « Bibliothèque salon », « Meuble 2 »)', knownFurniture()[0] || '');
  if (furniture === null) return;
  const slot = prompt('Étagère / rayon :\n(ex. « Étagère 4 », « Rayon A »)', '');
  if (slot === null) return;
  shelveMode = { furniture: furniture.trim(), slot: slot.trim() };
  saveShelveMode();
  toast('Mode rangement actif — scannez ou ajoutez vos livres, ils seront rangés automatiquement ici.', 4500);
});

function stamp() { return todayISO(); }

$('#btnExportJson').addEventListener('click', () => {
  download(`bibliotheque-${stamp()}.json`, exportJsonPayload(), 'application/json');
  toast('Export JSON téléchargé.');
});

$('#btnExportMd').addEventListener('click', () => {
  const lines = [];
  lines.push(`# Ma Bibliothèque`);
  lines.push(`_${store.items.length} ouvrages — export du ${new Date().toLocaleDateString('fr-FR')}_`);
  lines.push('');
  const groups = new Map();
  for (const it of store.items) {
    const key = it.shelves.length ? it.shelves.join(' / ') : 'Sans étagère';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const [shelf, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))) {
    lines.push(`## ${shelf} (${items.length})`);
    lines.push('');
    for (const it of items) {
      lines.push(`### ${it.title}${it.volume ? ` — T.${it.volume}` : ''}`);
      const meta = [];
      if (it.authors.length) meta.push(`**Auteurs :** ${it.authors.join(', ')}`);
      if ((it.scenario || []).length) meta.push(`**Scénario :** ${it.scenario.join(', ')}`);
      if ((it.art || []).length) meta.push(`**Dessin :** ${it.art.join(', ')}`);
      if (it.series) meta.push(`**Série :** ${it.series}${it.seriesState === 'ongoing' ? ' *(série en cours)*' : it.seriesState === 'complete' ? ' *(série complète)*' : ''}`);
      if (it.publisher) meta.push(`**Éditeur :** ${it.publisher}${it.publishedDate ? ` (${it.publishedDate})` : ''}`);
      if (it.isbn) meta.push(`**ISBN :** ${it.isbn}`);
      if (it.pageCount) meta.push(`**Pages :** ${it.pageCount}`);
      meta.push(`**Statut :** ${{ unread: 'à lire', reading: 'en lecture', read: 'lu', wish: 'souhait (à acheter)' }[it.status] || it.status}`);
      if (it.dewey) meta.push(`**Cote :** ${it.dewey}`);
      if (it.genre) meta.push(`**Genre :** ${it.genre}`);
      if (it.loan) meta.push(`**Prêté à :** ${it.loan.to}${it.loan.due ? ` (retour prévu le ${it.loan.due})` : ''}`);
      if ((it.loanHistory || []).length) meta.push(`**Historique prêts :** ${it.loanHistory.map((h) => `${h.to} (${h.date}${h.returned ? ` → ${h.returned}` : ' en cours'})`).join(' ; ')}`);
      if (it.rating) meta.push(`**Note :** ${'★'.repeat(it.rating)}${'☆'.repeat(5 - it.rating)}`);
      if (it.favorite) meta.push('**Favori :** ♥');
      if (it.wishlist) meta.push('**Souhait :** à acheter');
      if (it.location) meta.push(`**Emplacement :** ${it.location}${it.furniture ? ' (meuble : ' + it.furniture + (it.slot ? ', étagère : ' + it.slot + ')' : ')') : ''}`);
      if (it.tags.length) meta.push(`**Tags :** ${it.tags.join(', ')}`);
      lines.push(meta.join('  \n'));
      if (it.summary) { lines.push(''); lines.push(it.summary.replace(/\n+/g, ' ')); }
      if (it.notes) { lines.push(''); lines.push(`> ${it.notes.replace(/\n+/g, ' ')}`); }
      lines.push('');
    }
  }
  download(`bibliotheque-${stamp()}.md`, lines.join('\n'), 'text/markdown');
  toast('Export Markdown téléchargé.');
});

$('#btnExportCsv').addEventListener('click', () => {
  const cols = ['isbn', 'title', 'subtitle', 'authors', 'medium', 'series', 'volume', 'publisher',
    'publishedDate', 'pageCount', 'status', 'rating', 'tags', 'shelves', 'location', 'notes', 'summary', 'dewey', 'genre', 'loanTo', 'loanDue', 'addedAt'];
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(',')];
  for (const it of store.items) {
    const o = { ...it, authors: (it.authors || []).join('; '), tags: (it.tags || []).join('; '), shelves: (it.shelves || []).join('; '),
      loanTo: it.loan ? it.loan.to : '', loanDue: it.loan ? (it.loan.due || '') : '' };
    rows.push(cols.map((c) => q(o[c])).join(','));
  }
  download(`bibliotheque-${stamp()}.csv`, '\ufeff' + rows.join('\r\n'), 'text/csv');
  toast('Export CSV téléchargé (compatible Excel).');
});

$('#btnExportHtml').addEventListener('click', () => {
  const cards = store.items.map((it) => `
    <div class="card">
      ${coverSrc(it) ? `<img src="${esc(coverSrc(it))}">` : ''}
      <h3>${esc(it.title)}</h3>
      <p>${esc(it.authors.join(', '))}</p>
      ${it.rating ? `<p>${starStr(it.rating)}</p>` : ''}
      ${it.notes ? `<blockquote>${esc(it.notes)}</blockquote>` : ''}
      <p class="refs">${esc(it.isbn)} · ${esc(it.publisher)} · ${esc(it.publishedDate)} · ${esc(mediumLabel(it.medium))}</p>
    </div>`).join('');
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Ma Bibliothèque — export ${stamp()}</title>
  <style>body{font-family:Segoe UI,sans-serif;background:#f4f2ee;margin:0;padding:20px}
  .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
  .card{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:12px}
  .card img{max-width:100px;border-radius:4px}
  blockquote{font-style:italic;color:#555}</style></head>
  <body><h1>Ma Bibliothèque — ${store.items.length} ouvrages</h1><div class="grid">${cards}</div></body></html>`;
  download(`bibliotheque-${stamp()}.html`, html, 'text/html');
  toast('Export HTML téléchargé (imprimable).');
});

$('#btnImport').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const items = Array.isArray(data) ? data : (data.items || []);
    let added = 0, merged = 0, dupIgnored = 0;
    for (const raw of items) {
      const isbn = normalizeIsbn(raw.isbn);
      if (isbn) {
        const existing = store.items.find((i) => i.isbn === isbn && (raw.title || '') === (i.title || ''));
        if (existing) {
          const before = JSON.stringify(existing);
          Object.assign(existing, raw, { id: existing.id, shelves: [...new Set([...(existing.shelves||[]), ...(raw.shelves||[])])], tags: [...new Set([...(existing.tags||[]), ...(raw.tags||[])])] });
          if (JSON.stringify(existing) !== before) merged++; else dupIgnored++;
          continue;
        }
      }
      const it = { ...blankItem(isbn), ...raw, id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()) };
      if (!it.shelves) it.shelves = [];
      if (!it.tags) it.tags = [];
      if (!it.scenario) it.scenario = [];
      if (!it.art) it.art = [];
      store.items.push(it);
      added++;
      (it.shelves || []).forEach((s) => { if (!store.shelves.includes(s)) store.shelves.push(s); });
    }
    if (data.shelves) data.shelves.forEach((s) => { if (!store.shelves.includes(s)) store.shelves.push(s); });
    if (data.lists) { const ids = new Set(store.lists.map((l) => l.id)); data.lists.forEach((l) => { if (!ids.has(l.id)) store.lists.push(l); }); }
    if (data.covers && data.embeddedCovers) {
      coverStore.data = { ...data.covers, ...coverStore.data };
      coversCfg.embedded = true;
      saveCoversCfg();
      await saveCoverData();
    }
    store.save();
    renderAll();
    toast(`Import : ${added} ajouté(s), ${merged} fusionné(s), ${dupIgnored} identique(s).`, 4000);
  } catch { toast('Fichier JSON invalide.'); }
});

/* ---------- Search live ---------- */
['#searchInput', '#sortSelect', '#shelfFilter', '#statusFilter'].forEach((s) =>
  $(s).addEventListener('input', () => { resetPaging(); renderGrid(); }));
$('#favOnly').addEventListener('change', () => { resetPaging(); renderGrid(); });
$('#btnMore').addEventListener('click', () => { renderGrid._shown += 60; renderGrid(); });

/* ---------- Embedded covers (option PC, IndexedDB with localStorage fallback) ---------- */
const COVERS_KEY = 'biblio.covers.v1';
const COVERS_DB = 'biblio-covers';
let coversCfg = { embedded: false };
try { coversCfg = { ...coversCfg, ...(JSON.parse(localStorage.getItem(COVERS_KEY)) || {}) }; } catch {}
let coverStore = { data: {}, inIdb: false, _db: null };

function coversDbOpen() {
  return new Promise((resolve) => {
    if (!indexedDB) { resolve(null); return; }
    let req;
    try { req = indexedDB.open(COVERS_DB, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function coversDbGet(db, store, key) {
  return new Promise((resolve) => {
    if (!db) { resolve(null); return; }
    try {
      const r = db.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function coversDbGetAll(db) {
  return new Promise((resolve) => {
    if (!db) { resolve(null); return; }
    try {
      const r = db.transaction('covers', 'readonly').objectStore('covers').getAllKeys();
      const keys = r;
      keys.onsuccess = () => {
        const ids = keys.result || [];
        const store = db.transaction('covers', 'readonly').objectStore('covers');
        const out = {};
        let left = ids.length;
        if (!left) { resolve({}); return; }
        ids.forEach((id) => {
          const g = store.get(id);
          g.onsuccess = () => {
            out[id] = g.result;
            if (--left === 0) resolve(out);
          };
          g.onerror = () => { if (--left === 0) resolve(out); };
        });
      };
      keys.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function coversDbPut(db, id, dataUrl) {
  return new Promise((resolve) => {
    if (!db) { resolve(false); return; }
    try {
      const tx = db.transaction('covers', 'readwrite');
      tx.objectStore('covers').put(dataUrl, id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

function coversDbClear(db) {
  return new Promise((resolve) => {
    if (!db) { resolve(false); return; }
    try {
      const tx = db.transaction('covers', 'readwrite');
      tx.objectStore('covers').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

async function coversInit() {
  coverStore._db = await coversDbOpen();
  if (coverStore._db) {
    coverStore.inIdb = true;
    const idbCovers = await coversDbGetAll(coverStore._db);
    if (idbCovers && Object.keys(idbCovers).length) {
      coverStore.data = { ...idbCovers, ...coverStore.data };
    }
    let lsData = {};
    try { lsData = (JSON.parse(localStorage.getItem(COVERS_KEY + '.data')) || {}); } catch {}
    const lsSize = Object.keys(lsData).length;
    if (lsSize) {
      coverStore.data = { ...coverStore.data, ...lsData };
      await migrateCoversToIdb();
      toast('Couvertures migrées vers IndexedDB.', 3000);
    }
    return;
  }
  let lsData = {};
  try { lsData = (JSON.parse(localStorage.getItem(COVERS_KEY + '.data')) || {}); } catch {}
  coverStore.data = lsData;
  coverStore.inIdb = false;
}

async function migrateCoversToIdb() {
  if (!coverStore._db) { toast('IndexedDB indisponible — couvertures conservées dans localStorage.'); return false; }
  let ok = 0;
  for (const [id, data] of Object.entries(coverStore.data)) if (await coversDbPut(coverStore._db, id, data)) ok++;
  coverStore.inIdb = true;
  try {
    const tx = coverStore._db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(true, 'inIdb');
  } catch {}
  try { localStorage.removeItem(COVERS_KEY + '.data'); } catch {}
  return true;
}

function saveCoversCfg() { try { localStorage.setItem(COVERS_KEY, JSON.stringify({ embedded: coversCfg.embedded })); } catch {} }

async function saveCoverData() {
  if (coverStore.inIdb && coverStore._db) {
    for (const [id, data] of Object.entries(coverStore.data)) await coversDbPut(coverStore._db, id, data);
    return;
  }
  try { localStorage.setItem(COVERS_KEY + '.data', JSON.stringify(coverStore.data)); } catch { toast('Stockage local saturé — activez la migration IndexedDB dans « 🖼️ Couvertures embarquées ».', 5000); }
}

function coverSrc(it) {
  if (coversCfg.embedded && coverStore.data[it.id]) return coverStore.data[it.id];
  return it.cover || '';
}

async function embedCover(it) {
  if (!it.cover || coverStore.data[it.id]) return;
  try {
    const r = await fetchWithTimeout(it.cover, 15000);
    const blob = await r.blob();
    if (blob.size > 2 * 1024 * 1024) return;
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
    coverStore.data[it.id] = dataUrl;
    await saveCoverData();
  } catch {}
}

async function embedAllCovers() {
  if (!coversCfg.embedded) return;
  let done = 0;
  const targets = store.items.filter((i) => i.cover && !coverStore.data[i.id]);
  if (!targets.length) { toast('Toutes les couvertures sont déjà embarquées.'); return; }
  toast('Embarquement des couvertures en cours…', 3000);
  for (const it of targets) {
    await embedCover(it);
    done++;
    if (done % 25 === 0) toast(`${done}/${targets.length} couvertures embarquées…`, 1500);
  }
  toast(`Couvertures embarquées : ${done}.`, 4000);
  renderAll();
}

$('#btnCoversCfg').addEventListener('click', async () => {
  const total = Object.keys(coverStore.data).length;
  const size = Math.round((JSON.stringify(coverStore.data).length) / 1024 / 1024);
  if (!coversCfg.embedded) {
    if (!confirm('Embarquer les images de couverture dans l’application ?\n\nStockage : IndexedDB (illimité en pratique sur PC) — recommandé sur installation PC (≈100 Ko par ouvrage : ~1 Go pour 10 000 livres).\nAvantage : couvertures visibles hors-ligne et dans la sauvegarde JSON.\nContinuer ?')) return;
    coversCfg.embedded = true;
    saveCoversCfg();
    if (!coverStore.inIdb) await migrateCoversToIdb();
    await embedAllCovers();
  } else {
    const choices = `Couvertures embarquées : ${total} image(s), ≈${size} Mo — stockées dans ${coverStore.inIdb ? 'IndexedDB' : 'localStorage'}.\n\nOK = désactiver et VIDER les images embarquées (les URLs restent).\nAnnuler = garder.`;
    if (!confirm(choices)) return;
    coversCfg.embedded = false;
    coverStore.data = {};
    saveCoversCfg();
    if (coverStore.inIdb && coverStore._db) await coversDbClear(coverStore._db);
    try { localStorage.removeItem(COVERS_KEY + '.data'); } catch {}
    renderAll();
    toast('Couvertures embarquées supprimées (les URLs restent).');
  }
});

/* ---------- Init ---------- */
store.init().then(async () => { await coversInit(); renderAll(); updateShelveUI(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

window.__app = { store, lookupAndMaybeAdd, openDetail, renderGrid, renderStats, renderAll, $, esc, starStr, coverSrc, fetchWithTimeout, toast, todayISO, blankItem, download, stamp,
  setEmbeddedCover: (id, data) => { coverStore.data[id] = data; }, enableEmbedded: () => { coversCfg.embedded = true; }, coversCfgRef: () => coversCfg, coverStoreRef: () => coverStore, coversInitRef: coversInit, saveCoverDataRef: saveCoverData, migrateCoversRef: migrateCoversToIdb,
  seriesScatterRef: seriesScatter, checkSeriesScatterRef: checkSeriesScatter, knownFurnitureRef: knownFurniture, knownSlotsRef: knownSlots, applyShelveModeRef: applyShelveMode, updateShelveUIRef: updateShelveUI,
  invHandleScanRef: invHandleScan, invSessionRef: () => invSession, locationsListRef: locationsList, renderInventoryLocationsRef: renderInventoryLocations };

/* ---------- Grouped views (series / authors / scenario / art) ---------- */
let groupMode = 'series';

function groupItems() {
  const groups = new Map();
  for (const it of store.items) {
    let keys = [];
    if (groupMode === 'series') { if (it.series) keys = [it.series]; }
    else if (groupMode === 'authors') keys = it.authors || [];
    else if (groupMode === 'scenario') keys = it.scenario || [];
    else if (groupMode === 'art') keys = it.art || [];
    for (const k of keys) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
}

function seriesStateLabel(state) {
  return state === 'ongoing' ? '<span class="series-state ongoing">série en cours</span>'
       : state === 'complete' ? '<span class="series-state complete">série complète</span>' : '';
}

function renderGroups() {
  const body = $('#groupBody');
  if (!body) return;
  const groups = groupItems();
  if (!groups.length) {
    body.innerHTML = '<p class="hint">Aucun regroupement disponible — renseignez les champs « Série », « Auteur(s) », « Scénariste(s) » ou « Dessinateur(s) » dans les fiches.</p>';
    return;
  }
  body.innerHTML = groups.map(([name, items]) => {
    items = items.slice().sort((a, b) => (parseInt(a.volume, 10) || 0) - (parseInt(b.volume, 10) || 0) || a.title.localeCompare(b.title, 'fr'));
    const first = items[0];
    const state = groupMode === 'series' ? seriesStateLabel(first.seriesState) : '';
    const vols = items.map((i) => parseInt(i.volume, 10)).filter((n) => !isNaN(n));
    let missingHtml = '';
    if (groupMode === 'series' && first.seriesTotal) {
      const owned = new Set(vols);
      const missing = [];
      for (let n = 1; n <= first.seriesTotal; n++) if (!owned.has(n)) missing.push(n);
      const chips = missing.map((n) => `<span class="missing-chip">T. ${n} <button data-series="${esc(name)}" data-vol="${n}" title="Ajouter aux souhaits">🛒</button> <a target="_blank" rel="noopener" href="https://www.chasse-aux-livres.fr/recherche?q=${encodeURIComponent(name + ' ' + n)}" title="Chercher ce tome sur Chasse aux livres (comparateur de prix)">🔎</a></span>`).join('');
      missingHtml = missing.length
        ? `<div class="missing"><b>Manquants (${missing.length}/${first.seriesTotal}) :</b> ${chips}</div>`
        : '<div class="missing"><b>✔ Collection complète</b></div>';
    } else if (groupMode === 'series' && vols.length > 1) {
      const gaps = [];
      for (let n = Math.min(...vols); n <= Math.max(...vols); n++) if (!vols.includes(n)) gaps.push(n);
      if (gaps.length) missingHtml = `<div class="missing"><b>Tomes non possédés :</b> ${gaps.map((n) => `<span class="missing-chip">T. ${n} <button data-series="${esc(name)}" data-vol="${n}" title="Ajouter aux souhaits">🛒</button></span>`).join('')}</div>`;
    }
    const volList = items.map((i) => esc(i.volume ? `T.${i.volume}` : i.title)).join(' · ');
    let locHtml = '';
    if (groupMode === 'series') {
      const scatter = seriesScatter(name);
      if (scatter.length > 1) {
        locHtml = `<div class="missing"><b>📍 Emplacements :</b> ${scatter.map((s) => `<span class="missing-chip" style="background:#e3ecf5;border-color:#b8cfe6;color:#2f5d8a">${esc(s.loc)} → ${s.tomes.join(', ')}</span>`).join(' ')}</div>`;
      } else if (scatter.length === 1 && scatter[0].loc !== '—') {
        locHtml = `<div class="missing"><b>📍 Rangé :</b> ${esc(scatter[0].loc)}</div>`;
      }
    }
    return `<div class="group-card">
      <h3 data-filter="${esc(name)}">${esc(name)} ${state} <span class="hint">(${items.length})</span></h3>
      <div class="vols">${volList}</div>
      ${locHtml}
      ${missingHtml}
    </div>`;
  }).join('');

  body.querySelectorAll('.missing-chip button').forEach((b) => b.addEventListener('click', () => {
    const item = blankItem('');
    item.title = `${b.dataset.series} — Tome ${b.dataset.vol}`;
    item.series = b.dataset.series;
    item.volume = b.dataset.vol;
    item.status = 'wish';
    item.wishlist = true;
    store.add(item);
    renderAll();
    toast(`« ${item.title} » ajouté aux souhaits.`);
  }));

  body.querySelectorAll('h3[data-filter]').forEach((h) => h.addEventListener('click', () => {
    $('#searchInput').value = h.dataset.filter;
    $('#sortSelect').value = 'title';
    $('#shelfFilter').value = '';
    $('#statusFilter').value = '';
    $('#favOnly').checked = false;
    document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
    $('#viewGrid').classList.remove('hidden');
    renderGrid();
    window.scrollTo({ top: 0 });
  }));
}

$('#groupTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  groupMode = btn.dataset.g;
  document.querySelectorAll('#groupTabs .tab').forEach((t) => t.classList.toggle('active', t === btn));
  renderGroups();
});

/* ---------- Saved lists (search results as reusable lists) ---------- */
function currentCriteria() {
  return {
    q: $('#searchInput').value.trim(),
    sort: $('#sortSelect').value,
    shelf: $('#shelfFilter').value,
    status: $('#statusFilter').value,
    favOnly: $('#favOnly').checked,
  };
}

function criteriaLabel(c) {
  const parts = [];
  if (c.q) parts.push(`« ${c.q} »`);
  if (c.shelf) parts.push(`étagère ${c.shelf}`);
  if (c.status) parts.push({ unread: 'à lire', reading: 'en lecture', read: 'lus', wish: 'souhaits' }[c.status] || c.status);
  if (c.favOnly) parts.push('favoris');
  return parts.join(' + ') || 'toute la collection';
}

function applyCriteria(c) {
  const cur = currentCriteria();
  $('#searchInput').value = c.q;
  $('#sortSelect').value = c.sort;
  $('#shelfFilter').value = c.shelf;
  $('#statusFilter').value = c.status;
  $('#favOnly').checked = c.favOnly;
  const res = currentFilter();
  $('#searchInput').value = cur.q;
  $('#sortSelect').value = cur.sort;
  $('#shelfFilter').value = cur.shelf;
  $('#statusFilter').value = cur.status;
  $('#favOnly').checked = cur.favOnly;
  return res;
}

function renderLists() {
  const body = $('#listBody');
  if (!body) return;
  if (!store.lists.length) {
    body.innerHTML = '<p class="hint">Aucune liste. Filtrez la collection puis cliquez sur « 💾 Sauver cette recherche ».</p>';
    return;
  }
  body.innerHTML = store.lists.map((l, idx) => {
    const items = applyCriteria(l.criteria);
    return `<div class="list-card">
      <div>
        <span class="name">${esc(l.name)}</span>
        <div class="crit">${esc(criteriaLabel(l.criteria))} — ${items.length} ouvrage(s)</div>
      </div>
      <div>
        <button class="btn small" data-open="${idx}">Ouvrir</button>
        <button class="btn small" data-export="${idx}">💾</button>
        <button class="btn small btn-danger" data-del="${idx}">Supprimer</button>
      </div>
    </div>`;
  }).join('');
  body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const l = store.lists[+b.dataset.open];
    $('#searchInput').value = l.criteria.q;
    $('#sortSelect').value = l.criteria.sort;
    $('#shelfFilter').value = l.criteria.shelf;
    $('#statusFilter').value = l.criteria.status;
    $('#favOnly').checked = l.criteria.favOnly;
    document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
    $('#viewGrid').classList.remove('hidden');
    renderGrid();
    window.scrollTo({ top: 0 });
  }));
  body.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => {
    const l = store.lists[+b.dataset.export];
    const items = applyCriteria(l.criteria);
    const lines = ['Titre,Auteurs,Série,Tome,ISBN,Statut,Note']
      .concat(items.map((i) => `"${[i.title, i.authors.join('; '), i.series, i.volume, i.isbn, i.status, i.rating].map((x) => String(x ?? '').replace(/"/g, '""')).join('","')}"`));
    download(`liste-${l.name.replace(/[^\w\-]+/g, '_')}-${stamp()}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv');
  }));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    store.lists.splice(+b.dataset.del, 1);
    store.save();
    renderLists();
  }));
}

$('#btnSaveSearch').addEventListener('click', () => {
  const c = currentCriteria();
  const name = prompt('Nom de la liste :', criteriaLabel(c));
  if (!name) return;
  store.lists.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name, criteria: c, createdAt: new Date().toISOString() });
  store.save();
  renderLists();
  toast('Liste sauvegardée.');
});

/* ---------- Loans (prêts) ---------- */
function renderLoans() {
  const body = $('#loanBody');
  if (!body) return;
  const loaned = store.items.filter((i) => i.loan);
  if (!loaned.length) {
    body.innerHTML = '<p class="hint">Aucun prêt en cours. Ouvrez une fiche → « 📤 Prêter » pour enregistrer un prêt.</p>';
    return;
  }
  const today = todayISO();
  body.innerHTML = loaned.map((it) => {
    const late = it.loan.due && it.loan.due < today;
    return `<div class="list-card" style="${late ? 'border-color:#dc2626' : ''}">
      <div>
        <span class="name">${esc(it.title)}</span>
        <div class="crit"> prêté à <b>${esc(it.loan.to)}</b> — depuis le ${esc(it.loan.date)}${it.loan.due ? ` · retour prévu le ${esc(it.loan.due)}` : ''}${late ? ' <b style="color:#dc2626">⚠ EN RETARD</b>' : ''}</div>
      </div>
      <div>
        <button class="btn small" data-open-item="${esc(it.id)}">Fiche</button>
        <button class="btn small btn-primary" data-return="${esc(it.id)}">↩ Retour</button>
      </div>
    </div>`;
  }).join('');
  body.querySelectorAll('[data-open-item]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.openItem)));
  body.querySelectorAll('[data-return]').forEach((b) => b.addEventListener('click', () => {
    const it = store.findById(b.dataset.return);
    if (!it) return;
    if (!confirm(`« ${it.title} » rendu par ${it.loan.to} ?`)) return;
    it.loan = null;
    store.update(it);
    renderAll();
    toast('Retour enregistré.');
  }));
}

/* ---------- Borrower history (historique des prêts par personne) ---------- */
function renderBorrowers() {
  const body = $('#borrowerBody');
  if (!body) return;
  const hist = new Map();
  for (const it of store.items) {
    for (const h of (it.loanHistory || [])) {
      if (!hist.has(h.to)) hist.set(h.to, []);
      hist.get(h.to).push({ ...h, title: it.title, id: it.id });
    }
    if (it.loan) {
      if (!hist.has(it.loan.to)) hist.set(it.loan.to, []);
      if (!hist.get(it.loan.to).some((x) => !x.returned)) hist.get(it.loan.to).push({ ...it.loan, title: it.title, id: it.id });
    }
  }
  if (!hist.size) {
    body.innerHTML = '<p class="hint">Aucun prêt enregistré. Les prêts apparaissent ici et restent consultables après retour.</p>';
    return;
  }
  const today = todayISO();
  body.innerHTML = [...hist.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([who, loans]) => {
    const current = loans.filter((l) => !l.returned);
    const past = loans.filter((l) => l.returned);
    const late = current.filter((l) => l.due && l.due < today);
    return `<div class="group-card">
      <h3>${esc(who)} <span class="hint">(${loans.length} prêt${loans.length > 1 ? 's' : ''})</span>${late.length ? '<span class="series-state ongoing">⚠ ' + late.length + ' en retard</span>' : ''}</h3>
      ${current.length ? `<div class="vols"><b>En cours :</b> ${current.map((l) => `${esc(l.title)} (depuis ${esc(l.date)}${l.due ? `, prévu ${esc(l.due)}` : ''})`).join(' · ')}</div>` : ''}
      ${past.length ? `<div class="vols"><b>Rendus :</b> ${past.map((l) => `${esc(l.title)} (${esc(l.date)} → ${esc(l.returned)})`).join(' · ')}</div>` : ''}
    </div>`;
  }).join('');
  body.querySelectorAll('.group-card h3').forEach(() => {});
}


/* ---------- AI integration (API compatible Mistral/OpenAI, or local Ollama) ---------- */
const AI_KEY = 'biblio.ai.v1';
let aiCfg = { provider: 'api', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', key: '' };
try { aiCfg = { ...aiCfg, ...(JSON.parse(localStorage.getItem(AI_KEY)) || {}) }; } catch {}
function saveAiCfg() { try { localStorage.setItem(AI_KEY, JSON.stringify(aiCfg)); } catch {} }

function aiEndpoint() {
  if (aiCfg.provider === 'ollama') return (aiCfg.url || 'http://localhost:11434') + '/api/chat';
  return (aiCfg.url || 'https://api.mistral.ai/v1') + '/chat/completions';
}

function aiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (aiCfg.provider !== 'ollama' && aiCfg.key) h.Authorization = 'Bearer ' + aiCfg.key;
  return h;
}

function aiMessages(system, user) {
  if (aiCfg.provider === 'ollama') {
    return { model: aiCfg.model || 'llama3', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: false };
  }
  return { model: aiCfg.model || 'mistral-small-latest', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2 };
}

async function aiChat(system, user, maxTokens = 400) {
  const body = aiMessages(system, user);
  if (aiCfg.provider !== 'ollama') body.max_tokens = maxTokens;
  const r = await fetchWithTimeout(aiEndpoint(), 45000, {
    method: 'POST', headers: aiHeaders(), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  const text = aiCfg.provider === 'ollama'
    ? (data.message && data.message.content)
    : (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
  if (!text) throw new Error('réponse vide');
  return text.trim();
}

/* Build a compact catalog summary for the AI (cap to keep prompt reasonable) */
function catalogForAI() {
  const cap = 1500;
  const items = store.items.slice(0, cap);
  const lines = items.map((i) => [
    i.id.slice(0, 8),
    i.title,
    (i.authors || []).join('/'),
    i.genre || '',
    i.dewey || '',
    i.series ? `${i.series} T.${i.volume || '?'}` : '',
    i.publishedDate || '',
    { unread: 'à lire', reading: 'en lecture', read: 'lu', wish: 'souhait' }[i.status] || i.status,
    i.rating || 0,
    i.favorite ? 'favori' : '',
  ].filter(Boolean).join(' | '));
  return `id8 | titre | auteurs | genre | dewey | serie/tome | annee | statut | note | favori\n${lines.join('\n')}${store.items.length > cap ? `\n(+${store.items.length - cap} autres non listés)` : ''}`;
}

function aiParseIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\b[a-f0-9]{8}\b/gi)) ids.add(m[0].toLowerCase());
  return [...ids].map((id8) => store.items.find((i) => i.id.toLowerCase().startsWith(id8))).filter(Boolean);
}

async function aiSearch(q) {
  const sys = `Tu es un assistant de recherche dans une bibliothèque personnelle. On te donne le catalogue (lignes: id8|titre|auteurs|genre|dewey|serie/tome|annee|statut|note|favori). Renvoie UNIQUEMENT les id8 (identifiants à 8 caractères hexadécimaux) des ouvrages correspondant à la demande, séparés par des virgules ou des espaces, sans autre texte. Si aucun ne correspond, réponds "aucun".`;
  const user = `Catalogue:\n${catalogForAI()}\n\nDemande: ${q}`;
  const resp = await aiChat(sys, user, 300);
  if (/aucun/i.test(resp) && !/\b[a-f0-9]{8}\b/i.test(resp)) return { items: [], raw: resp };
  return { items: aiParseIds(resp), raw: resp };
}

async function aiFillItem(id) {
  const it = store.findById(id);
  if (!it) return;
  const sys = `Tu complètes des fiches de bibliothèque. Renvoie UNIQUEMENT un objet JSON avec les champs: {"summary": "résumé en 3-4 phrases", "genre": "genre", "dewey": "cote Dewey comme 843 ou 741.5"}. Pas d'autre texte.`;
  const user = `Titre: ${it.title}${it.subtitle ? ' — ' + it.subtitle : ''}\nAuteurs: ${(it.authors || []).join(', ')}\nÉditeur: ${it.publisher}\nAnnée: ${it.publishedDate}\nType: ${it.medium}`;
  const resp = await aiChat(sys, user, 400);
  const m = resp.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('JSON introuvable');
  const data = JSON.parse(m[0]);
  if (data.summary && !it.summary) it.summary = String(data.summary);
  if (data.genre && !it.genre) it.genre = String(data.genre);
  if (data.dewey && !it.dewey) it.dewey = String(data.dewey).replace(',', '.').trim();
  store.update(it);
  return data;
}

/* ---------- UI ---------- */
$('#btnAiCfg').addEventListener('click', async () => {
  const prov = prompt(`Fournisseur IA :\n- "api" : service compatible Mistral/OpenAI (clé requise)\n- "ollama" : modèle local (gratuit, clé non requise)\n\nVotre choix (api ou ollama) :`, aiCfg.provider);
  if (!prov) return;
  const provider = prov.trim().toLowerCase() === 'ollama' ? 'ollama' : 'api';
  let url = aiCfg.url, model = aiCfg.model, key = aiCfg.key;
  if (provider === 'ollama') {
    url = prompt('URL Ollama :', url === 'https://api.mistral.ai/v1' ? 'http://localhost:11434' : url) || 'http://localhost:11434';
    model = prompt('Modèle local (ex. llama3, mistral, qwen2.5) :', model && model !== 'mistral-small-latest' ? model : 'llama3') || 'llama3';
  } else {
    url = prompt('URL de l’API :', url && url !== 'http://localhost:11434' ? url : 'https://api.mistral.ai/v1') || 'https://api.mistral.ai/v1';
    model = prompt('Modèle (ex. mistral-small-latest) :', model === 'llama3' ? 'mistral-small-latest' : model) || 'mistral-small-latest';
    key = prompt('Clé API (stockée uniquement dans ce navigateur) :', key) || '';
  }
  aiCfg = { provider, url, model, key };
  saveAiCfg();
  toast(provider === 'ollama' ? 'IA locale configurée (Ollama).' : 'IA par API configurée.');
});

$('#btnAiRun').addEventListener('click', async () => {
  const q = $('#aiQuery').value.trim();
  if (!q) return;
  if (!aiCfg.key && aiCfg.provider !== 'ollama') { toast('Configurez d’abord l’IA dans le menu 🤖 IA (clé API ou Ollama).', 4000); return; }
  $('#aiResult').textContent = 'Recherche IA en cours…';
  $('#aiResultGrid').innerHTML = '';
  try {
    const { items } = await aiSearch(q);
    $('#aiResult').textContent = items.length ? `${items.length} ouvrage(s) trouvé(s) :` : 'Aucun ouvrage correspondant trouvé.';
    const grid = $('#aiResultGrid');
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `${coverSrc(it) ? `<img class="thumb" loading="lazy" src="${esc(coverSrc(it))}" alt="">` : '<div class="thumb placeholder">📖</div>'}
        <div class="meta"><h3>${esc(it.title)}</h3><p>${esc(it.authors.join(', ') || it.isbn)}</p>${it.rating ? `<div class="stars">${starStr(it.rating)}</div>` : ''}</div>`;
      card.addEventListener('click', () => { $('#aiModal').classList.add('hidden'); openDetail(it.id); });
      grid.appendChild(card);
    }
  } catch (e) {
    $('#aiResult').textContent = 'Erreur IA : ' + e.message + (aiCfg.provider === 'ollama' ? ' — vérifiez qu’Ollama tourne (ollama serve).' : ' — vérifiez clé/URL/modèle.');
  }
});

$('#btnCloseAi').addEventListener('click', () => $('#aiModal').classList.add('hidden'));

/* Expose an entry point: open modal */
$('#btnAiOpen') && $('#btnAiOpen').addEventListener('click', () => $('#aiModal').classList.remove('hidden'));

window.__ai = { getCfg: () => aiCfg, setCfg: (c) => { aiCfg = { ...aiCfg, ...c }; saveAiCfg(); }, aiSearch, aiFillItem };

/* ---------- Inventory mode (rescan a shelf and check it) ---------- */
let invSession = null;

function locationsList() {
  const locs = new Map();
  for (const it of store.items) {
    const key = [it.furniture, it.slot].filter(Boolean).join(' · ') || it.location || '';
    if (!key) continue;
    if (!locs.has(key)) locs.set(key, []);
    locs.get(key).push(it);
  }
  return [...locs.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
}

function renderInventoryLocations() {
  const sel = $('#invLocation');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Choisir l\'emplacement à inventorier —</option>' +
    locationsList().map(([loc, items]) => `<option value="${esc(loc)}">${esc(loc)} (${items.length} ouvrage(s))</option>`).join('');
  if (locationsList().some(([l]) => l === cur)) sel.value = cur;
}

function invFeedLine(html) {
  const feed = $('#invFeed');
  const div = document.createElement('div');
  div.innerHTML = html;
  feed.prepend(div);
}

async function invHandleScan(isbn) {
  isbn = normalizeIsbn(isbn);
  if (!invSession || !isbn) return;
  const { loc } = invSession;
  const found = store.items.filter((i) => i.isbn === isbn);
  if (!found.length) {
    invSession.unknown.push(isbn);
    invFeedLine(`<div class="inv-line miss">❓ <b>${esc(isbn)}</b> — inconnu dans la bibliothèque. <button class="btn small inv-add" data-isbn="${esc(isbn)}">➕ L'intégrer</button></div>`);
  } else {
    const there = found.filter((i) => (locationOf(i) || '') === loc);
    if (there.length) {
      invSession.seen.add(there[0].id);
      invFeedLine(`<div class="inv-line ok">✅ <b>${esc(there[0].title)}</b> — bien rangé ici.</div>`);
    } else {
      invSession.intruders.push(found[0].id);
      invFeedLine(`<div class="inv-line warn">⚠ <b>${esc(found[0].title)}</b> — censé être à « ${esc(locationOf(found[0]) || 'emplacement non renseigné')} ». <button class="btn small inv-move" data-id="${esc(found[0].id)}">📦 Le ranger ici</button></div>`);
    }
  }
  invSession.count++;
  updateInvProgress();
}

function updateInvProgress() {
  if (!invSession) return;
  const expected = invSession.expected.length;
  const seen = invSession.seen.size;
  $('#invCount').textContent = `${invSession.count} scanné(s) — ${seen}/${expected} attendus trouvés${invSession.intruders.length ? ` · ${invSession.intruders.length} intrus` : ''}${invSession.unknown.length ? ` · ${invSession.unknown.length} inconnu(s)` : ''}`;
}

/* ---------- Inventory history ---------- */
const INVHIST_KEY = 'biblio.invhist.v1';
function loadInvHist() {
  try { return JSON.parse(localStorage.getItem(INVHIST_KEY)) || []; } catch { return []; }
}
function saveInvHist(h) { try { localStorage.setItem(INVHIST_KEY, JSON.stringify(h.slice(-40))); } catch {} }

function renderInvHistory() {
  const body = $('#invHistBody');
  if (!body) return;
  const hist = loadInvHist();
  if (!hist.length) { body.innerHTML = '<p class="hint">Aucun inventaire enregistré pour l\instant.</p>'; return; }
  body.innerHTML = hist.slice().reverse().map((h) => {
    const date = new Date(h.date).toLocaleDateString('fr-FR');
    const status = h.missingCount === 0 ? '✔ conforme' : `${h.missingCount} manquant(s)`;
    return `<div class="inv-line ${h.missingCount === 0 ? 'ok' : 'miss'}"><b>${esc(h.loc)}</b> — ${date} · ${h.seen}/${h.expected} confirmés · ${status}${h.intruders ? ` · ${h.intruders} intrus` : ''}${h.unknown ? ` · ${h.unknown} inconnu(s)` : ''}</div>`;
  }).join('');
}

function invFinish() {
  if (!invSession) return;
  const missing = invSession.expected.filter((i) => !invSession.seen.has(i.id));
  const res = $('#invResult');
  const missingHtml = missing.length ? `
    <h3>❌ Manquants sur l'étagère (${missing.length})</h3>
    <p class="hint">Ces ouvrages sont censés être ici mais n'ont pas été scannés. Vérifiez s'ils sont sortis, prêtés, ou ailleurs.</p>
    ${missing.map((i) => `<div class="inv-line miss">📕 <b>${esc(i.title)}</b>${i.loan ? ' — 📤 prêté à ' + esc(i.loan.to) : ''}${i.wishlist ? ' — 🛒 souhait, pas encore acheté' : ''}</div>`).join('')}` : '<h3>✅ Rien de manquant</h3>';
  const intrudersHtml = invSession.intruders.length ? `
    <h3>⚠ Intrus (${invSession.intruders.length})</h3>
    <p class="hint">Scannés ici mais censés être rangés ailleurs (rangés ici si vous avez cliqué « Le ranger ici »).</p>` : '';
  const unknownHtml = invSession.unknown.length ? `
    <h3>❓ Inconnus (${invSession.unknown.length})</h3>
    <p class="hint">Scannés mais absents de la bibliothèque (« L'intégrer » les ajoute à cet emplacement).</p>` : '';
  res.innerHTML = `<div class="group-card">
    <h3>Bilan — ${esc(invSession.loc)}</h3>
    <p class="hint">${invSession.seen.size}/${invSession.expected.length} attendus confirmés · ${missing.length} manquant(s) · ${invSession.intruders.length} intrus · ${invSession.unknown.length} inconnu(s)</p>
  </div>${missingHtml}${intrudersHtml}${unknownHtml}`;
  const hist = loadInvHist();
  hist.push({ date: new Date().toISOString(), loc: invSession.loc, expected: invSession.expected.length,
    seen: invSession.seen.size, missingCount: missing.length, intruders: invSession.intruders.length, unknown: invSession.unknown.length });
  saveInvHist(hist);
  invSession = null;
  $('#invPanel').classList.add('hidden');
  toast('Inventaire terminé — bilan affiché ci-dessous.', 3500);
  renderInventoryLocations();
  renderInvHistory();
}

$('#btnInvStart').addEventListener('click', () => {
  const loc = $('#invLocation').value;
  if (!loc) { toast('Choisissez d\'abord un emplacement.'); return; }
  const expected = store.items.filter((i) => (locationOf(i) || '') === loc && !i.wishlist);
  invSession = { loc, expected, seen: new Set(), intruders: [], unknown: [], count: 0 };
  $('#invFeed').innerHTML = '';
  $('#invResult').innerHTML = '';
  $('#invPanel').classList.remove('hidden');
  updateInvProgress();
  toast(`Inventaire de « ${loc} » démarré — ${expected.length} ouvrage(s) attendus. Scannez !`, 4000);
  if (expected.length && confirm('Démarrer la caméra pour scanner cette étagère ?\n(Sinon, saisissez les ISBN dans la barre du bas ou avec une douchette.)')) startScan();
});

$('#btnInvStop').addEventListener('click', invFinish);

$('#invFeed').addEventListener('click', async (e) => {
  const addBtn = e.target.closest('.inv-add');
  const moveBtn = e.target.closest('.inv-move');
  if (addBtn) {
    const isbn = addBtn.dataset.isbn;
    $('#invPanel').classList.remove('hidden');
    await lookupAndMaybeAdd(isbn, true);
    const item = store.findByIsbn(isbn)[0];
    if (item && invSession) {
      const [furniture, ...rest] = invSession.loc.split(' · ');
      item.furniture = furniture;
      item.slot = rest.join(' · ');
      item.location = invSession.loc;
      store.update(item);
      invSession.seen.add(item.id);
      invFeedLine(`<div class="inv-line ok">✅ <b>${esc(item.title || isbn)}</b> — intégré ici.</div>`);
      updateInvProgress();
    }
  } else if (moveBtn) {
    const it = store.findById(moveBtn.dataset.id);
    if (it && invSession) {
      const [furniture, ...rest] = invSession.loc.split(' · ');
      it.furniture = furniture;
      it.slot = rest.join(' · ');
      it.location = invSession.loc;
      store.update(it);
      invSession.intruders = invSession.intruders.filter((id) => id !== it.id);
      invSession.seen.add(it.id);
      invFeedLine(`<div class="inv-line ok">✅ <b>${esc(it.title)}</b> — rangé ici désormais.</div>`);
      renderAll();
      updateInvProgress();
    }
  }
});

$('#btnInvQuick').addEventListener('click', () => {
  document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
  $('#viewInventory').classList.remove('hidden');
  renderInventoryLocations();
});

/* ---------- Printable spine labels (étiquettes de cote) ---------- */
$('#btnPrintLabels').addEventListener('click', () => {
  const items = store.items.filter((i) => !i.wishlist);
  if (!items.length) { toast('Aucun ouvrage à étiqueter.'); return; }
  const withLoc = items.filter((i) => i.dewey || i.location);
  if (!withLoc.length) { toast('Aucune cote Dewey ni emplacement renseigné — complétez d\'abord des fiches.', 4500); return; }
  const sorted = withLoc.slice().sort((a, b) => (parseFloat(a.dewey) || 1e9) - (parseFloat(b.dewey) || 1e9) || (a.title || '').localeCompare(b.title || '', 'fr'));
  const labels = sorted.map((i) => {
    const lines = [];
    if (i.dewey) lines.push(`<div class="lb-dewey">${esc(i.dewey)}</div>`);
    if (i.location) lines.push(`<div class="lb-loc">${esc(i.location)}</div>`);
    const vol = i.volume ? ` T.${esc(i.volume)}` : '';
    lines.push(`<div class="lb-title">${esc((i.series ? i.series + vol + ' — ' : '') + (i.title || '').slice(0, 38))}${(i.title || '').length > 38 ? '…' : ''}</div>`);
    if (i.genre) lines.push(`<div class="lb-genre">${esc(i.genre)}</div>`);
    return `<div class="label">${lines.join('')}</div>`;
  }).join('');
  const win = window.open('', '_blank');
  if (!win) { toast('Autorisez les pop-ups pour imprimer les étiquettes.', 4500); return; }
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Étiquettes de cote — Ma Bibliothèque</title>
  <style>
    @page { margin: 8mm; }
    body { font-family: "Segoe UI", sans-serif; margin: 0; padding: 8px; background: #fff; }
    .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
    .label {
      width: 50mm; height: 30mm; border: 1px dashed #999; border-radius: 2mm;
      padding: 2.5mm; box-sizing: border-box; display: flex; flex-direction: column; gap: 1mm;
      page-break-inside: avoid; overflow: hidden;
    }
    .lb-dewey { font-size: 13pt; font-weight: 700; }
    .lb-loc { font-size: 8.5pt; color: #2f5d8a; font-weight: 600; }
    .lb-title { font-size: 8pt; color: #333; flex: 1; }
    .lb-genre { font-size: 7.5pt; color: #777; font-style: italic; }
    h1 { font-size: 12pt; margin: 0 0 6px; }
    .hint { font-size: 8pt; color: #777; margin: 0 0 10px; }
    @media print { .no-print { display: none; } }
  </style></head><body>
  <h1>Étiquettes de cote — ${sorted.length} ouvrage(s)</h1>
  <p class="hint no-print">Format : 50 × 30 mm (étiquettes standard A4 48/65/70). Ajustez l'échelle d'impression si besoin.</p>
  <div class="sheet">${labels}</div>
  <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
  </body></html>`);
  win.document.close();
});

/* ---------- Bulk edit (sélection multiple) ---------- */
let bulkMode = false;
const bulkSel = new Set();

function renderBulkShelfOptions() {
  const sel = $('#bulkShelfSelect');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Étagère —</option>' + store.shelves.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.value = cur;
}

$('#btnBulkMode').addEventListener('click', () => {
  bulkMode = !bulkMode;
  bulkSel.clear();
  $('#bulkBar').classList.toggle('hidden', !bulkMode);
  $('#btnBulkMode').classList.toggle('shelve-on', bulkMode);
  renderBulkShelfOptions();
  renderGrid();
  if (bulkMode) toast('Mode sélection : cochez des couvertures puis modifiez-les en masse.', 3500);
});

$('#btnBulkCancel').addEventListener('click', () => {
  bulkMode = false;
  bulkSel.clear();
  $('#bulkBar').classList.add('hidden');
  $('#btnBulkMode').classList.remove('shelve-on');
  renderGrid();
});

$('#btnBulkApply').addEventListener('click', () => {
  if (!bulkSel.size) { toast('Sélectionnez d\'abord des ouvrages.'); return; }
  const status = $('#bulkStatus').value;
  const shelf = $('#bulkShelfSelect').value;
  const genre = $('#bulkGenre').value.trim();
  const loc = $('#bulkLocation').value.trim();
  if (!status && !shelf && !genre && !loc) { toast('Choisissez au moins une modification.'); return; }
  let n = 0;
  for (const id of bulkSel) {
    const it = store.findById(id);
    if (!it) continue;
    if (status) it.status = status;
    if (shelf && !it.shelves.includes(shelf)) it.shelves.push(shelf);
    if (genre) it.genre = genre;
    if (loc) {
      const parts = loc.split('·').map((p) => p.trim());
      it.furniture = parts[0] || '';
      it.slot = parts.slice(1).join(' · ');
      it.location = loc;
    }
    store.update(it);
    n++;
  }
  toast(`${n} ouvrage(s) mis à jour.`, 3000);
  $('#bulkStatus').value = '';
  $('#bulkShelfSelect').value = '';
  $('#bulkGenre').value = '';
  $('#bulkLocation').value = '';
  bulkSel.clear();
  $('#bulkCount').textContent = '';
  renderAll();
});

$('#btnMoreActions').addEventListener('click', () => $('#manualAddBar').classList.toggle('open'));

/* ---------- Install button (PWA) ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('#btnInstall');
  if (btn) btn.classList.remove('hidden');
});

$('#btnInstall').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') toast('Application installée !');
  deferredPrompt = null;
  $('#btnInstall').classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  $('#btnInstall').classList.add('hidden');
  toast("Application installée — retrouvez-la sur votre écran d'accueil.");
});

/* ---------- API keys manager (stored per-browser, never in code) ---------- */
const KEYS_STORE = 'biblio.keys.v1';
let apiKeys = { googleBooks: '' };
try { apiKeys = { ...apiKeys, ...(JSON.parse(localStorage.getItem(KEYS_STORE)) || {}) }; } catch {}
function saveApiKeys() {
  try { localStorage.setItem(KEYS_STORE, JSON.stringify(apiKeys)); }
  catch { toast('Impossible de sauvegarder la clé (stockage plein ?).', 4000); }
}

function gbKeyParam() {
  return apiKeys.googleBooks ? `&key=${encodeURIComponent(apiKeys.googleBooks)}` : '';
}

$('#btnKeysCfg').addEventListener('click', () => {
  $('#keyGoogleBooks').value = apiKeys.googleBooks || '';
  $('#keysTestResult').textContent = '';
  let sources = {};
  try { sources = JSON.parse(localStorage.getItem('biblio.sources.v1') || '{}'); } catch {}
  $('#srcGoogleBooks').checked = sources.googleBooks !== false;
  $('#srcBnf').checked = sources.bnf !== false;
  $('#srcOpenLibrary').checked = sources.openLibrary !== false;
  $('#keysModal').classList.remove('hidden');
});

$('#btnCloseKeys').addEventListener('click', () => $('#keysModal').classList.add('hidden'));

$('#btnSaveKeys').addEventListener('click', () => {
  apiKeys.googleBooks = $('#keyGoogleBooks').value.trim();
  saveApiKeys();
  const sources = {
    googleBooks: $('#srcGoogleBooks').checked,
    bnf: $('#srcBnf').checked,
    openLibrary: $('#srcOpenLibrary').checked,
  };
  try { localStorage.setItem('biblio.sources.v1', JSON.stringify(sources)); } catch {}
  $('#keysModal').classList.add('hidden');
  const active = Object.entries(sources).filter(([, v]) => v).map(([k]) => ({ googleBooks: 'Google Books', bnf: 'BnF', openLibrary: 'Open Library' }[k])).join(', ');
  toast(`Réglages enregistrés — sources actives : ${active || 'aucune !'}`, 3500);
});

$('#btnTestKeys').addEventListener('click', async () => {
  const key = $('#keyGoogleBooks').value.trim();
  const out = $('#keysTestResult');
  if (!key) { out.textContent = 'Entrez d\'abord une clé.'; return; }
  out.textContent = 'Test en cours…';
  try {
    const r = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:9782070541270&key=${encodeURIComponent(key)}`, 12000);
    const data = await r.json();
    if (data.error) {
      const code = data.error.code || '?';
      const msg = data.error.message || 'erreur';
      let hint = '';
      if (/has not been used in project|is disabled/i.test(msg)) hint = '→ L\'API « Google Books API » n\'est PAS activée sur ce projet. Ouvrez https://console.cloud.google.com/apis/library/books.googleapis.com (vérifiez le projet sélectionné en haut) → Activer.';
      else if (/Service temporarily unavailable/i.test(msg)) hint = '→ Cause la plus fréquente : API non activée sur le projet de la clé, ou clé et API dans deux projets différents. Ouvrez https://console.cloud.google.com/apis/library/books.googleapis.com, vérifiez le projet en haut à droite, activez.';
      else if (/API key not valid|API_KEY_INVALID/i.test(msg)) hint = '→ Clé invalide : recopiez-la entièrement depuis Identifiants (elle commence par AIza).';
      else if (/RefererNotAllowed|referrer/i.test(msg)) hint = '→ Restriction référants : ajoutez https://chenzu-ai.github.io/* dans les restrictions de la clé (Identifiants → clé → Restrictions).';
      else if (data.error.status === 'RESOURCE_EXHAUSTED') hint = '→ Quota du jour épuisé (1000/jour) : réessayez demain.';
      out.textContent = `❌ ${code} — ${msg} ${hint}`;
      return;
    }
    out.textContent = data.totalItems > 0
      ? '✅ Clé valide — Google Books répond (livre trouvé).'
      : '✅ Clé valide — Google Books répond (ce livre précis est inconnu, mais la clé fonctionne).';
  } catch (e) {
    out.textContent = '❌ Erreur réseau : ' + e.message;
  }
});

/* Diagnostic ISBN: que répond chaque source ? */
$('#btnDiagIsbn').addEventListener('click', async () => {
  const isbn = normalizeIsbn($('#diagIsbn').value);
  const out = $('#diagResult');
  if (!isbn) { out.textContent = 'Entrez un ISBN.'; return; }
  out.textContent = 'Interrogation des sources actives…';
  const lines = [];
  const jobs = [
    fetchGoogleBooks(isbn).then((r) => lines.push(r ? `✅ Google Books : « ${r.title} » ${r.cover ? '(couverture ✓)' : '(sans couverture)'} ${r.summary ? '(résumé ✓)' : ''}` : '❌ Google Books : rien (clé absente/invalide, quota, ou livre inconnu)')).catch(() => lines.push('❌ Google Books : erreur réseau')),
    fetchBnf(isbn).then((r) => lines.push(r ? `✅ BnF : « ${r.title} » — ${r.authors.join(', ')}` : '❌ BnF : livre non trouvé au catalogue')).catch(() => lines.push('❌ BnF : erreur réseau')),
    fetchOpenLibrary(isbn).then((r) => lines.push(r ? `✅ Open Library : « ${r.title} »` : '❌ Open Library : rien')).catch(() => lines.push('❌ Open Library : erreur réseau')),
    fetchCoverFallback(isbn).then((r) => lines.push(r ? '✅ Couvertures Open Library : image trouvée' : '❌ Couvertures : aucune image pour cet ISBN')).catch(() => lines.push('❌ Couvertures : erreur réseau')),
  ];
  await Promise.all(jobs);
  out.innerHTML = lines.join('<br>') + '<br><b>Si tout est ❌ : le livre est absent des catalogues en ligne (édition très récente/confidentielle) — complétez la fiche à la main ou via 🤖 IA.</b>';
});
