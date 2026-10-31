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

/* UPC-A (12 chiffres, Amerique du Nord) -> EAN-13: prefixer 0 et recalculer la clef.
   Un UPC valide est deja un EAN-13 implicite commencant par 0 — la clef reste correcte. */
function upcToEan13(upc) {
  if (!/^\d{12}$/.test(upc)) return upc;
  const core = '0' + upc.slice(0, 11);
  const sum = core.split('').reduce((acc, d, i) => acc + (+d) * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  return core + check;
}

function normalizeIsbn(raw) {
  raw = upcToEan13(String(raw || '').replace(/[^0-9Xx]/g, ''));
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

/* ---------- Store (IndexedDB, fallback localStorage) ---------- */
const STORE_KEY = 'biblio.items.v1';
const SHELF_KEY = 'biblio.shelves.v1';
const LISTS_KEY = 'biblio.lists.v1';
const GOALS_KEY = 'biblio.goals.v1';
let readingGoals = { year: new Date().getFullYear() + 1, target: 0 };
try { readingGoals = { ...readingGoals, ...(JSON.parse(localStorage.getItem(GOALS_KEY)) || {}) }; } catch {}
function saveGoals() { try { localStorage.setItem(GOALS_KEY, JSON.stringify(readingGoals)); } catch {} }
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
      toast(tm('storage_full'));
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
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    const removed = this.items.length < before;
    if (removed) this.save();
    return removed;
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
  const variants = [isbn];
  const alt = isbn.length === 13 ? isbn13to10(isbn) : isbn10to13(isbn);
  if (alt) variants.push(alt);
  for (const v of variants) {
    try {
      const url = `https://covers.openlibrary.org/b/isbn/${v}-L.jpg?default=false`;
      const r = await fetchWithTimeout(url, 9000);
      if (r.ok) return url.replace('&default=false', '');
    } catch {}
  }
  // Dernier recours : la banque de couvertures communautaire (URL configuree dans les cles API)
  const bankBase = (apiKeys.bank || '').replace(/\/$/, '');
  if (bankBase) {
    for (const v of variants) {
      try {
        const url = `${bankBase}/${v}.jpg`;
        const r = await fetchWithTimeout(url, 8000);
        if (r.ok) return url;
      } catch {}
    }
  }
  return '';
}

/* Conversion ISBN-13 (prefixe 978) <-> ISBN-10 */
function isbn13to10(isbn13) {
  if (!/^978[0-9]{10}$/.test(isbn13)) return '';
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(core[i], 10) * (10 - i);
  const rest = 11 - (sum % 11);
  const check = rest === 11 ? '0' : rest === 10 ? 'X' : String(rest);
  return core + check;
}

function isbn10to13(isbn10) {
  if (!/^[0-9]{9}[0-9X]$/.test(isbn10)) return '';
  const core = '978' + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(core[i], 10) * (i % 2 === 0 ? 1 : 3);
  const check = String((10 - (sum % 10)) % 10);
  return core + check;
}

/* Recherche complete: ISBN fourni, puis son equivalent converti si echec partiel */
/* Fnac: catalogue francais, couvre les nouveautes (parutions trop recentes pour BnF/OL/GB) */
async function fetchFnac(isbn) {
  try {
    const url = 'https://www.fnac.com/SearchResult/ResultList.aspx?Search=' + encodeURIComponent(isbn) + '&SCat=0%21&sft=1&sa=0';
    const r = await fetchWithTimeout(url, 15000);
    if (!r.ok) return null;
    const html = await r.text();
    // Extraction depuis le HTML de la page de resultats
    const titleMatch = html.match(/<a[^>]*class="[^"]*Article-title[^"]*"[^>]*>([^<]+)<\/a>/) || html.match(/<h2[^>]*>([^<]{5,150})<\/h2>/);
    if (!titleMatch) return null;
    let title = titleMatch[1].trim();
    // nettoyage des titres Fnac: "Titre - : Titre reel Tout savoir sur ..." et suffixes promo
    const cutIdx = title.indexOf('Tout savoir sur');
    if (cutIdx > 0) {
      let base = title.slice(0, cutIdx).replace(/[\s:,-]+$/, '').trim();
      // le titre reel est souvent apres "Titre commercial - : "
      const sepIdx = base.indexOf('- :');
      if (sepIdx >= 0 && sepIdx < base.length - 4) base = base.slice(sepIdx + 3).trim();
      title = base;
    }
    title = title.replace(/\s*-\s*Tout savoir sur.*$/i, '').trim();
    // Auteurs
    const authors = [];
    const authorBlock = html.match(/class="[^"]*Article-descSub[^"]*"[^>]*>([^<]+)</) || html.match(/([A-Z][a-zA-ZÀ-ÿ' -]+)\s*\(Illustration\)/);
    if (authorBlock) {
      for (const a of authorBlock[1].split(/,|\bet\b/)) {
        const name = a.trim().replace(/\(.*\)/, '').trim();
        if (name && name.length > 2 && !/^\d/.test(name)) authors.push(name);
      }
    }
    // Editeur
    let publisher = '';
    const pubMatch = html.match(/Editeur\s*<[^>]*>\s*([A-Za-zÀ-ÿ .]+?)\s*<\//i) || html.match(/Editeur ([A-Za-zÀ-ÿ .]+)\s/i);
    if (pubMatch) publisher = pubMatch[1].trim();
    // Date de parution
    let date = '';
    const dateMatch = html.match(/Parution\s*<[^>]*>\s*(\d{2}\/\d{2}\/(\d{4}))|Parution (\d{2}\/\d{2}\/(\d{4}))/);
    if (dateMatch) date = ((dateMatch[2] || dateMatch[4])) || '';
    return {
      isbn, isbn10: '',
      title,
      subtitle: '',
      authors: authors.slice(0, 4),
      publisher,
      publishedDate: date,
      pageCount: null,
      language: 'fr',
      categories: [],
      summary: '',
      cover: '',
    };
  } catch { return null; }
}

function sourcesOfReport(report) {
  if (!report) return [];
  const src = [];
  if (report.googleBooks) src.push('Google Books');
  if (report.bnf) src.push('BnF');
  if (report.openLibrary) src.push('Open Library');
  if (report.cover) src.push('Covers');
  return src;
}

/* Cache local des reconnaissances: evite de re-interroger BnF/Google pour le meme livre
   (diagnostics re-max, mises a jour repetees, re-scans). TTL 30 jours. */
const META_CACHE_KEY = 'biblio.meta.cache.v1';
const META_CACHE_TTL = 30 * 24 * 3600 * 1000;

function metaCacheGet(isbn) {
  try {
    const all = JSON.parse(localStorage.getItem(META_CACHE_KEY) || '{}');
    const e = all[isbn];
    if (!e) return null;
    if (Date.now() - e.at > META_CACHE_TTL) { delete all[isbn]; localStorage.setItem(META_CACHE_KEY, JSON.stringify(all)); return null; }
    return e.meta;
  } catch { return null; }
}

function metaCacheSet(isbn, meta) {
  if (!isbn || !meta || !meta.title) return;
  try {
    const all = JSON.parse(localStorage.getItem(META_CACHE_KEY) || '{}');
    // hygiene: purger les entrees expirees si le cache grossit (>500 entrees)
    const keys = Object.keys(all);
    if (keys.length > 500) {
      for (const k of keys) if (Date.now() - all[k].at > META_CACHE_TTL) delete all[k];
    }
    all[isbn] = { at: Date.now(), meta };
    localStorage.setItem(META_CACHE_KEY, JSON.stringify(all));
  } catch { /* quota localStorage: echouer silencieusement */ }
}

/* Memoire de travail sans stockage: cache court (une session) pour les recherche par titre */

async function fetchMetadataSmart(isbn) {
  const meta = await fetchMetadataSmartRaw(isbn);
  if (meta && meta.title) metaCacheSet(isbn, meta);
  return meta;
}

async function fetchMetadataSmartRaw(isbn) {
  const __cached = metaCacheGet(isbn);
  if (__cached) return __cached;

  const primary = await fetchMetadata(isbn, true);
  const found = sourcesOfReport(primary.report);
  if (primary.meta && primary.meta.title && primary.meta.title !== 'Sans titre') return { ...primary.meta, srcFound: found };
  const alt = isbn.length === 13 ? isbn13to10(isbn) : isbn10to13(isbn);
  if (alt) {
    const second = await fetchMetadata(alt, true);
    const secondMeta = second.meta;
    if (secondMeta && secondMeta.title) {
      const found2 = [...found, ...sourcesOfReport(second.report)];
      if (!primary.meta) return { ...secondMeta, isbn, srcFound: found2 };
      // fusion: prefer filled fields of second
      const merged = { ...primary.meta };
      for (const [k, v] of Object.entries(secondMeta)) {
        const cur = merged[k];
        const empty = cur === '' || cur === null || (Array.isArray(cur) && !cur.length) || cur === 'Sans titre';
        if (empty && v) merged[k] = v;
      }
      return { ...merged, srcFound: found2 };
    }
  }
  // Dernier recours: banque de fiches communautaire (fond edite par les utilisateurs)
  const bankRecord = await fetchRecordFromBank(isbn);
  if (bankRecord && bankRecord.title) {
    if (!primary.meta) return bankRecord;
    const mergedBank = { ...primary.meta };
    for (const [k, v] of Object.entries(bankRecord)) {
      const cur = mergedBank[k];
      const empty = cur === '' || cur === null || (Array.isArray(cur) && !cur.length) || cur === 'Sans titre';
      if (empty && v) mergedBank[k] = v;
    }
    return { ...mergedBank, srcFound: [...found, 'Banque de fiches'] };
  }
  // Avant-dernier recours: relais FR (Fnac/BnF via micro-service Cloudflare) si configure
  const relay = await fetchRelay(isbn);
  if (relay) {
    if (!primary.meta) return { ...relay, srcFound: [...found, 'Relais FR'] };
    const merged = { ...primary.meta };
    for (const [k, v] of Object.entries(relay)) {
      const cur = merged[k];
      const empty = cur === '' || cur === null || (Array.isArray(cur) && !cur.length) || cur === 'Sans titre';
      if (empty && v) merged[k] = v;
    }
    return { ...merged, srcFound: [...found, 'Relais FR'] };
  }
  return primary.meta ? { ...primary.meta, srcFound: found } : null;
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
/* Recherche BnF par titre (+auteur) — le meilleur chercheur pour le fonds francais.
   Retourne un meta complet avec ISBN quand la notice en a un. */
async function fetchBnfByTitle(title, author) {
  try {
    const cleanT = String(title || '').replace(/["<>]/g, ' ').trim();
    if (!cleanT) return null;
    let q = `bib.title all "${cleanT}"`;
    const cleanA = String(author || '').split(',')[0].replace(/["<>]/g, ' ').trim();
    if (cleanA) q += ` and bib.author all "${cleanA}"`;
    const url = 'https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=' + encodeURIComponent(q) + '&maximumRecords=5&recordSchema=dc';
    const r = await fetchWithTimeout(url, 12000);
    if (!r.ok) return null;
    const xml = await r.text();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    const numFound = doc.querySelector('numberOfRecords');
    if (!numFound || parseInt(numFound.textContent, 10) === 0) return null;
    const recs = [...doc.querySelectorAll('record')];
    if (!recs.length) return null;
    // prendre la notice dont le titre matche le mieux
    let best = null, bestSim = 0;
    for (const rec of recs) {
      const titleEl = rec.getElementsByTagName('dc:title')[0];
      const recTitle = titleEl ? titleEl.textContent.trim() : '';
      const sim = titleSimilarity(recTitle, cleanT);
      if (sim > bestSim) { bestSim = sim; best = rec; }
    }
    if (!best || bestSim < 0.3) return null;
    const getTag = (tag) => {
      const el = best.getElementsByTagName(tag)[0];
      return el ? el.textContent.trim() : '';
    };
    const recTitle = getTag('dc:title');
    if (!recTitle) return null;
    const creators = [...best.getElementsByTagName('dc:creator')].map((e) => e.textContent.trim()).filter(Boolean);
    // ISBN depuis les identifiants de la notice
    let isbn13 = '';
    for (const idEl of best.getElementsByTagName('dc:identifier')) {
      const t = idEl.textContent.trim();
      const m = t.match(/(?:ISBN|EAN)\s*:?\s*(9\d{12}|\d{9}[\dX])/i);
      if (m) { isbn13 = normalizeIsbn(m[1]); if (/^\d{13}$/.test(isbn13)) break; }
    }
    return {
      isbn: /^\d{13}$/.test(isbn13) ? isbn13 : '',
      isbn10: '',
      title: recTitle.split(' / ')[0],
      subtitle: '',
      authors: creators.slice(0, 4).map((c) => c.split('(')[0].trim()).filter(Boolean),
      publisher: (getTag('dc:publisher') || '').replace(/\s*\([^)]*\)\s*$/, '').trim(),
      publishedDate: (getTag('dc:date') || '').slice(0, 4),
      pageCount: null, language: 'fr', categories: [], summary: '', cover: '',
      srcBnf: true,
    };
  } catch { return null; }
}

async function fetchBnf(isbn) {
  try {
    const q = `bib.isbn all "${isbn}"`;
    const url = 'https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=' + encodeURIComponent(q) + '&maximumRecords=1&recordSchema=dc';
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
  // BnF en direct depuis le navigateur (l'API SRU autorise CORS) - si l'appel est bloque, repli silencieux (le relais worker prend le relais)
  if (on('bnf')) jobs.push(fetchBnf(isbn).then((r) => { report.bnf = r; }).catch(() => {}));
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

/* État de complétude de fiche : draft (à compléter) → '' (complète) → locked (verrouillée, lecture seule).
   - draft : badge + les fiches vierges/photo-blanks naissent ainsi ; le scan-pour-compléter les passe en complètes
   - locked : fiche figée — sauvegarde et scan-complétion refusés tant que le verrou n'est pas levé dans la fiche */
function recordStateLabel(state) {
  return { draft: t('rs_draft'), locked: t('rs_locked') }[state] || '';
}
function isRecordLocked(it) { return it && it.recordState === 'locked'; }

function blankItem(isbn) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    isbn,
    title: '', subtitle: '', authors: [], publisher: '', publishedDate: '',
    pageCount: null, language: '', categories: [], summary: '', backCoverText: '', cover: '',
    coverBack: '', shelves: [], tags: [], rating: 0, notes: '', status: 'unread',
    medium: 'book', volume: '', series: '', location: '', furniture: '', slot: '', duplicateOf: false,
    scenario: [], art: [], favorite: false, wishlist: false,
    loan: null, loanHistory: [],
    dewey: '', genre: '',
    collection: '', format: '', editionType: 'standard', price: null, audience: '',
    borrowedFrom: '', acquiredAt: '', acquiredFrom: '', acquiredPrice: null, srcFound: [],
    disposedAt: '', disposedHow: '', disposedPrice: null,
    currentPage: null, readNext: false, nextOrder: null,
    readingLog: [],
    seriesState: '', seriesTotal: null,
    recordState: 'draft',
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

/* Beep de confirmation au scan (mode douchette/rafale) — WebAudio, aucun fichier, desactivable */
let __beepMuted = false;
function scanBeep(ok = true) {
  try {
    if (__beepMuted) return;
    const ctx = scanBeep._ctx || (scanBeep._ctx = new (window.AudioContext || window.webkitAudioContext)());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = ok ? 880 : 220; // ok = bip aigu, erreur = grave
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
  } catch {}
}

/* EAN generique: les DVD/Blu-ray/CD/jeux ont des EAN-13 non-ISBN (pas de prefixe 978/979).
   Pas de base gratuite fiable par EAN pour ces supports -> on cree la fiche avec l'EAN,
   le type multimédia est proposé, et l'utilisateur/l'IA complète (titre, pochette) via la photo ou le clavier. */
/* Scan-pour-compléter: l'ISBN scanné remplit la fiche blank ouverte.
   L'emplacement de la fiche (rangé depuis la photo) est conservé — seule l'identité se remplit. */
async function completeBlankWithScan(targetId, rawCode) {
  const isbn = normalizeIsbn(rawCode);
  const it = store.findById(targetId);
  if (!it) { lookupAndMaybeAdd(rawCode); return; }
  if (isRecordLocked(it)) { toast(tm('rs_locked_blocked'), 4500); scanBeep(false); return; }
  toast(tm('searching'));
  const meta = await fetchMetadataSmart(isbn);
  if (!meta || !meta.title) { toast(tm('not_found'), 4000); scanBeep(false); return; }
  // remplir la fiche cible (garder emplacement, series photoPos, isBlank retire)
  for (const k of Object.keys(meta)) if (meta[k] !== null && meta[k] !== undefined && meta[k] !== '') it[k] = meta[k];
  it.isBlank = false;
  it.title = meta.title;
  it.isbn = isbn;
  if (it.recordState === 'draft') it.recordState = '';
  store.update(it);
  scanBeep(true);
  toast(tm('scan_complete_done', meta.title), 4500);
  renderAll();
  autoBackupTick();
  openDetail(it.id);
}

function showDupModal(dup) {
  pendingIsbn = dup[0].isbn || pendingIsbn;
  const loc = dup[0].furniture ? `${dup[0].furniture}${dup[0].slot ? ' · ' + dup[0].slot : ''}` : '';
  $('#dupMsg').innerHTML = `
    ✅ « <b>${esc(dup[0].title || pendingIsbn)}</b> » est <b>DÉJÀ DANS VOTRE BIBLIOTHÈQUE</b>${dup.length > 1 ? ` (${dup.length} exemplaires)` : ''}.<br>
    ${loc ? `📍 Rangé à : <b>${esc(loc)}</b>` : ''}<br>
    <span class="hint">${t('dup_add_hint')}</span>`;
  $('#dupModal').classList.remove('hidden');
}

function isBookEan(code) {
  return /^(978|979)/.test(code);
}

async function lookupAndMaybeAdd(isbn, silentDup = false) {
  isbn = normalizeIsbn(isbn);
  if (!/^[0-9]{9}[0-9X]|[0-9]{13}$/.test(isbn)) { toast(tm('bad_isbn')); return; }
  // EAN non-livre: d'abord tenter la reconnaissance automatique (MusicBrainz via relais — CD/vinyles)
  if (/^[0-9]{13}$/.test(isbn) && !isBookEan(isbn)) {
    if (!silentDup) toast(tm('searching'));
    const mediaMeta = await fetchRelay(isbn).catch(() => null);
    if (mediaMeta && mediaMeta.title && !/^EAN/.test(mediaMeta.title)) {
      const dupM = store.findByIsbn(isbn);
      const media = store.add({ isbn, medium: mediaMeta.medium || 'music', status: 'unread', addedAt: new Date().toISOString(), related: [], ...mediaMeta });
      applyShelveMode(media);
      autoBackupTick();
      scanBeep(true);
      toast(mediaMeta.medium === 'music' ? tm('music_found') : tm('media_found') , 4000);
      renderAll();
      openDetail(media.id);
      return;
    }
  }
  // EAN non-livre (DVD/Blu-ray/CD/vinyle/jeu): fiche multimédia assistée — l'IA/le titre complète ensuite
  if (/^[0-9]{13}$/.test(isbn) && !isBookEan(isbn)) {
    const dupMedia = store.findByIsbn(isbn);
    if (dupMedia.length && !silentDup) { pendingIsbn = isbn; showDupModal(dupMedia); return; }
    const media = store.add({ isbn, title: 'EAN ' + isbn, medium: 'other', status: 'unread', addedAt: new Date().toISOString(),
      note: tm('media_ean_hint'), related: [] });
    toast(tm('media_ean_created'), 5000);
    renderAll();
    openDetail(media.id);
    return;
  }
  const dup = store.findByIsbn(isbn);
  // Rescan d'une fiche vide/incomplete => on la COMPLETE au lieu de dupliquer
  const blank = dup.find((d) => isBlankFiche(d));
  if (blank && !silentDup) {
    toast(tm('incomplete_search'));
    const meta = await fetchMetadataSmart(isbn);
    if (meta) {
      enrichItem(blank, meta);
      store.update(blank);
      toast(`Fiche complétée : ${blank.title}`, 3500);
      renderAll();
      openDetail(blank.id);
      return;
    }
    toast(tm('still_not_found'), 4500);
    openDetail(blank.id);
    return;
  }
  if (dup.length && !silentDup) {
    pendingIsbn = isbn;
    $('#dupMsg').innerHTML = `« <b>${esc(dup[0].title || isbn)}</b> » est déjà dans votre bibliothèque${dup.length > 1 ? ` (${dup.length} exemplaires)` : ''}.<br>Voulez-vous ajouter un autre exemplaire ?`;
    $('#dupModal').classList.remove('hidden');
    return;
  }
  toast(tm('searching'));
  const meta = await fetchMetadataSmart(isbn);
  const item = { ...blankItem(isbn), ...(meta || {}), duplicateOf: dup.length > 0 };
  applyShelveMode(item);
  autoBackupTick();
  scheduleAutoSync();
  scanBeep(true);
  if (!meta) {
    toast(tm('not_found'));
    scanBeep(false);
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

/* Alert right after a scan when the series is spread across several spots
   — propose: ouvrir la fiche OU regrouper tous les tomes vers un emplacement choisi */
function checkSeriesScatter(item) {
  if (!item.series) return;
  const scatter = seriesScatter(item.series);
  if (scatter.length < 2) return;
  const loc = locationOf(item) || (LANG === 'en' ? '— not set —' : '— non renseigné —');
  const others = scatter.filter((s) => s.loc !== loc);
  if (!others.length) return;
  const detail = others.map((s) => `« ${s.loc} » (tomes : ${s.tomes.join(', ')})`).join(' ; ');
  const regroup = tm('scatter_regroup', item.series, others.length);
  const manual = tm('scatter_manual');
  setTimeout(() => {
    const choice = confirm(`⚠ ${tm('scatter_alert', item.series)}\n\n${tm('scatter_here', loc)}\n${tm('scatter_others')} : ${detail}\n\n${regroup}\n(${tm('scatter_cancel')})`);
    if (!choice) return;
    // Demander l'emplacement cible (defaut = emplacement du tome courant)
    const target = prompt(tm('scatter_target_prompt', loc), loc);
    if (!target) return;
    // regrouper: tous les tomes de la serie pas deja a la cible
    let moved = 0;
    const parts = target.split('·').map((x) => x.trim());
    for (const it2 of store.items) {
      if (it2.series !== item.series) continue;
      const it2Loc = locationOf(it2);
      if (it2Loc === target) continue;
      it2.furniture = parts[0] || '';
      it2.slot = parts.slice(1).join(' · ');
      it2.location = target;
      store.update(it2);
      moved++;
    }
    renderAll();
    autoBackupTick();
    toast(tm('scatter_done', item.series, moved), 5000);
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
  $('#scanStatus').textContent = t('cam_init');
  $('#btnBurst').classList.toggle('hidden', !!invSession);
  $('#btnBurst').classList.toggle('shelve-on', burstScan);
  if (!window.ZXing) {
    $('#scanStatus').textContent = t('cam_nolib');
    stopScan();
    return;
  }
  codeReader = new ZXing.BrowserMultiFormatReader();
  try {
    await codeReader.decodeFromVideoDevice(null, $('#scanVideo'), (result, err) => {
      if (result && scanActive) {
        const txt = result.getText();
        if (txt && txt.startsWith('BIBLIO:')) {
          if (invSession) { toast(tm('qr_ignored')); return; }
          stopScan();
          tryHandleQrCode(txt);
          return;
        }
        if (/^[0-9]{13}$/.test(txt) || /^[0-9]{9}[0-9X]$/.test(txt) || /^[0-9]{12}$/.test(txt)) {
          // mode scan-complete: le scan remplit la fiche blank ouverte
          if (window.__scanCompleteTargetId) {
            const targetId = window.__scanCompleteTargetId;
            window.__scanCompleteTargetId = null;
            stopScan();
            completeBlankWithScan(targetId, txt);
            return;
          }
          if (invSession) { invHandleScan(txt); return; }
          if (burstScan) {
            const now = Date.now();
            if (txt === lastScannedCode && now - lastScanTime < 3000) return;
            lastScannedCode = txt;
            lastScanTime = now;
            lookupAndMaybeAdd(txt);
            $('#scanStatus').textContent = t('burst_added') + ' ' + txt + ' ' + t('burst_more');
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
    $('#scanStatus').textContent = t('cam_fail');
  }
}

$('#btnBurst').addEventListener('click', () => {
  burstScan = !burstScan;
  $('#btnBurst').classList.toggle('shelve-on', burstScan);
  $('#scanStatus').textContent = burstScan ? t('burst_on') : t('scan_aim');
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
  } catch { toast(tm('no_torch')); }
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

/* Rapport de dispersion: toutes les series eparpillees de la bibliotheque,
   avec regroupement en 1 clic par serie (version gratuite simplifiee du plan pro). */
function scatterReport() {
  const out = [];
  const seen = new Set();
  for (const it of store.items) {
    if (!it.series || seen.has(it.series)) continue;
    seen.add(it.series);
    const scatter = seriesScatter(it.series);
    if (scatter.length < 2) continue;
    out.push({ series: it.series, spots: scatter });
  }
  return out;
}

function runScatterReport() {
  const report = scatterReport();
  const modal = $('#scatterReportModal');
  if (!modal) return;
  const body = $('#scatterReportBody');
  if (!report.length) {
    body.innerHTML = '<p class="hint">' + (LANG === 'en' ? 'No scattered series — your whole library is tidy! ✨' : 'Aucune série dispersée — votre bibliothèque est bien rangée ! ✨') + '</p>';
  } else {
    let html = '';
    for (const r of report) {
      const total = r.spots.reduce((n, s) => n + s.tomes.length, 0);
      html += `<div class="group-card" style="margin-bottom:10px">
        <b>📖 ${esc(r.series)}</b> <span class="hint">(${total} tomes · ${r.spots.length} emplacements)</span>
        <div style="margin:6px 0">${r.spots.map((s) => `<span class="missing-chip" style="background:#e3ecf5;border-color:#b8cfe6;color:#2f5d8a">${esc(s.loc)} → ${s.tomes.join(', ')}</span>`).join(' ')}</div>
        <button class="btn small scatter-gather" data-series="${esc(r.series)}">📦 ${t('scatter_gather_btn')}</button>
      </div>`;
    }
    body.innerHTML = html;
    body.querySelectorAll('.scatter-gather').forEach((btn) => btn.addEventListener('click', () => {
      const series = btn.dataset.series;
      const first = store.items.find((i) => i.series === series);
      const loc = first ? (locationOf(first) || '') : '';
      const target = prompt(tm('scatter_target_prompt', loc || '?'), loc);
      if (!target) return;
      let moved = 0;
      const parts = target.split('·').map((x) => x.trim());
      for (const it2 of store.items) {
        if (it2.series !== series) continue;
        if (locationOf(it2) === target) continue;
        it2.furniture = parts[0] || '';
        it2.slot = parts.slice(1).join(' · ');
        it2.location = target;
        store.update(it2);
        moved++;
      }
      renderAll();
      autoBackupTick();
      toast(tm('scatter_done', series, moved), 5000);
      runScatterReport(); // rafraichir le rapport
    }));
  }
  modal.classList.remove('hidden');
}

/* Relations inverses automatiques: si A -> "suite de" B, alors B <- "préquelle" A (calcule, jamais stocke deux fois).
   Inverses de lecture: "suite de" <-> "préquelle", "spin-off de" <-> "a pour spin-off", etc. */
const REL_INVERSE = {
  prequel: 'hasprequel', hasprequel: 'prequel',        // prequelle = origines (souvent publiee apres) ; inverse: "a pour prequelle"
  sequel: 'predecessor', predecessor: 'sequel',        // suite de X <-> X est le volume precedent
  previous: 'next', next: 'previous',                  // tomes voisins: volume precedent <-> volume suivant
  spinoff: 'hasspinoff', hasspinoff: 'spinoff',
  universe: 'universe', cycle: 'cycle',
  adaptation: 'adaptedfrom', adaptedfrom: 'adaptation',
  analysis: 'analyzedby', analyzedby: 'analysis',
  artbook: 'artbookof', artbookof: 'artbook',
  translation: 'translatedfrom', translatedfrom: 'translation',
};

/* Tous les liens d'une fiche: directs + inverses, dedoublonnes */
function allRelated(it) {
  if (!it) return [];
  const out = new Map();
  for (const r of (it.related || [])) if (r.id) out.set(r.id, r.rel);
  for (const o of store.items) {
    if (o.id === it.id) continue;
    for (const r of (o.related || [])) {
      if (r.id === it.id && !out.has(o.id)) out.set(o.id, REL_INVERSE[r.rel] || 'universe');
    }
  }
  return [...out.entries()].map(([id, rel]) => ({ id, rel }));
}

function markLoanReturned(item, date) {
  if (!Array.isArray(item.loanHistory)) item.loanHistory = [];
  const open = [...item.loanHistory].reverse().find((h) => !h.returned);
  if (open) open.returned = date;
}

/* Remplir le filtre Genre : vos genres réels (avec compte) + les natures de la taxonomie à explorer.
   Trié : d'abord ce que vous possédez (avec compte), puis le reste de la taxonomie. */
function renderGenreFilter() {
  const sel = $('#genreFilter');
  if (!sel) return;
  const cur = sel.value;
  const counts = {};
  const segCounts = {}; // chaque segment de la hierarchie compte aussi (Science-fiction tous supports)
  for (const it of store.items) {
    const g = (it.genre || '').trim();
    if (!g) continue;
    counts[g] = (counts[g] || 0) + 1;
    for (const seg of g.split('/').map((x) => x.trim()).filter(Boolean)) {
      segCounts[seg] = (segCounts[seg] || 0) + 1;
    }
  }
  const mine = Object.entries(counts).filter(([g]) => g).sort((a, b) => b[1] - a[1]);
  const taxo = Object.keys(GENRE_TAXONOMY).filter((n) => !segCounts[n]);
  // segments de niveau 2+ presents dans vos genres (ex. "Science-fiction" tous supports) — triees
  const segs = Object.entries(segCounts).filter(([g, n]) => n >= 2 && !counts[g]).sort((a, b) => b[1] - a[1]).slice(0, 25);
  let html = `<option value="">${t('all_genres')}</option>`;
  if (mine.length) {
    html += `<optgroup label="${t('gf_mine')}">`;
    for (const [g, n] of mine) html += `<option value="${esc(g)}">${esc(g)} (${n})</option>`;
    html += '</optgroup>';
  }
  if (segs.length) {
    html += `<optgroup label="${t('gf_bytheme')}">`;
    for (const [g, n] of segs) html += `<option value="/${esc(g)}">${esc(g)} — tous supports (${n})</option>`;
    html += '</optgroup>';
  }
  if (taxo.length) {
    html += `<optgroup label="${t('gf_explore')}">`;
    for (const n of taxo) html += `<option value="${esc(n)}">${esc(n)}</option>`;
    html += '</optgroup>';
  }
  sel.innerHTML = html;
  if (cur) sel.value = cur;
}

function currentFilter() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const sort = $('#sortSelect').value;
  const shelf = $('#shelfFilter').value;
  const status = $('#statusFilter').value;
  const medium = $('#mediumFilter') ? $('#mediumFilter').value : '';
  const genre = $('#genreFilter') ? $('#genreFilter').value : '';
  let items = store.items.slice();
  if (medium) items = items.filter((i) => i.medium === medium);
  if (genre) {
    if (genre.startsWith('/')) {
      // "/Science-fiction" = ce theme TOUT support TOUTE nature (match par inclusion de segment)
      const seg = genre.slice(1).trim();
      items = items.filter((i) => (i.genre || '').split('/').map((x) => x.trim()).includes(seg));
    } else {
      items = items.filter((i) => (i.genre || '').startsWith(genre)); // prefixe: Roman trouve Roman / SF / Cyberpunk
    }
  }
  if (shelf) items = items.filter((i) => i.shelves.includes(shelf));
  if (status === 'loaned') items = items.filter((i) => i.loan);
  else if (status) items = items.filter((i) => i.status === status);
  if ($('#favOnly').checked) items = items.filter((i) => i.favorite);
  if (q) {
    items = items.filter((i) =>
      [i.title, i.subtitle, i.authors.join(', '), i.isbn, i.series, i.universe, i.publisher,
       i.tags.join(' '), i.notes, i.categories.join(' '), i.dewey, i.genre, i.location, i.furniture, i.slot, i.collection, i.audience,
       mediumLabel(i.medium || 'book'), // taper "film", "bd", "jeu de société", "jdr"... dans la recherche trouve le support
       i.owner || '',
       // œuvres liées: chercher aussi par les titres des fiches liées (ex: chercher "Sambre" trouve l'artbook lie)
       ...(i.related || []).map((r) => { const o = store.findById(r.id); return o ? o.title + ' ' + (o.series || '') : ''; })]
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
  updateCtxBar(items);
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
        ${it.universe ? `<p class="hint">🌌 ${esc(it.universe)}</p>` : ''}
        ${allRelated(it).length ? `<p class="hint">🔗 ${allRelated(it).length}</p>` : ''}
        ${it.recordState === 'draft' ? `<span class="chip" style="background:#f0e6c8;border-color:#c9a86a;color:#7a5c1e">✏️ ${t('rs_draft')}</span>` : ''}
        ${it.recordState === 'locked' ? `<span class="chip" style="background:#dfe8f0;border-color:#8fb0cc;color:#2f5d8a">🔒 ${t('rs_locked')}</span>` : ''}
        ${it.rating ? `<div class="stars">${starStr(it.rating)}</div>` : ''}
        ${it.favorite ? '<div class="stars"><span class="fav-mark">' + t('chip_fav') + '</span></div>' : ''}
        <div class="chips">
          ${it.wishlist ? '<span class="chip wish">🛒 ' + t('chip_wish') + '</span>' : ''}
          ${it.loan ? '<span class="chip loan">📤 ' + esc(it.loan.to) + '</span>' : ''}
          ${it.location ? '<span class="chip shelf">📍 ' + esc(it.location) + '</span>' : ''}
          ${(it.shelves || []).map((s) => `<span class="chip shelf">${esc(s)}</span>`).join('')}
          ${it.duplicateOf ? '<span class="chip dup">⚠ ' + t('chip_dup') + '</span>' : ''}
          ${it.editionType && it.editionType !== 'standard' ? `<span class="chip ed">${{ first: t('chip_first'), collector: t('chip_collector'), rare: t('chip_rare'), incunable: t('chip_incunable') }[it.editionType] || ''}</span>` : ''}
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
        $('#bulkCount').textContent = bulkSel.size + (LANG === 'en' ? ' selected' : ' sélectionné(s)');
        if (!$('#filterOpsBar').classList.contains('hidden')) refreshFilterOpsCount();
      });
    } else {
      card.addEventListener('click', () => openDetail(it.id));
    }
    grid.appendChild(card);
  }
  const more = $('#btnMore');
  more.classList.toggle('hidden', items.length <= renderGrid._shown);
  $('#pageInfo').textContent = `${shown.length} ${t('shown_of')} ${items.length}`;
  $('#countBadge').textContent = store.items.length + ' ' + (store.items.length > 1 ? t('cnt_books') : t('cnt_book'));
}

function resetPaging() { renderGrid._reset = true; }

function renderShelfOptions() {
  const sel = $('#shelfFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">' + t('all_shelves') + '</option>' +
    store.shelves.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.value = store.shelves.includes(cur) ? cur : '';
}

function renderShelves() {
  const ul = $('#shelfList');
  ul.innerHTML = '';
  if (!store.shelves.length) {
    ul.innerHTML = '<li class="hint">' + t('no_shelf') + '</li>';
    return;
  }
  for (const s of store.shelves) {
    const n = store.items.filter((i) => i.shelves.includes(s)).length;
    const li = document.createElement('li');
    li.innerHTML = `<span><b>${esc(s)}</b> <span class="hint">— ${n} ${t('lists_count')}</span></span>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-danger small';
    btn.textContent = t('delete_btn');
    btn.addEventListener('click', () => {
      if (!confirm(`${t('shelf_del')} « ${s} » ? ${t('shelf_del2')}`)) return;
      store.shelves = store.shelves.filter((x) => x !== s);
      store.items.forEach((i) => { i.shelves = i.shelves.filter((x) => x !== s); });
      store.save();
      renderAll();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

/* 🛡️ Rapport d'assurance : valeur totale du fonds + export imprimable (le besoin n°1 des cataloguers selon la recherche) */
function insuranceReport() {
  const items = store.items.filter((i) => !i.wishlist && !i.disposedHow);
  const total = items.reduce((sum, i) => sum + (i.price || 0), 0);
  const withPrice = items.filter((i) => i.price).length;
  const byFurniture = {};
  for (const i of items) {
    const f = i.furniture || (LANG === 'en' ? '(no furniture)' : '(sans meuble)');
    byFurniture[f] = (byFurniture[f] || 0) + (i.price || 0);
  }
  return { total, count: items.length, withPrice, byFurniture, items };
}

function exportInsuranceReport() {
  const r = insuranceReport();
  const today = new Date().toISOString().slice(0, 10);
  let txt = (LANG === 'en' ? 'HOME LIBRARY — INSURANCE REPORT' : 'BIBLIOTH\u00c8QUE PERSONNELLE — RAPPORT D\u0027ASSURANCE') + '\n'
    + (LANG === 'en' ? 'Generated: ' : 'G\u00e9n\u00e9r\u00e9 le : ') + today + '\n'
    + (LANG === 'en' ? 'Items: ' : '\u0152uvres : ') + r.count + '\n'
    + (LANG === 'en' ? 'With declared value: ' : 'Avec valeur d\u00e9clar\u00e9e : ') + r.withPrice + '\n'
    + (LANG === 'en' ? 'TOTAL DECLARED VALUE: ' : 'VALEUR TOTALE D\u00c9CLAR\u00c9E : ') + r.total.toFixed(2) + ' EUR\n\n'
    + (LANG === 'en' ? 'BY FURNITURE' : 'PAR MEUBLE') + '\n';
  for (const [f, v] of Object.entries(r.byFurniture).sort((a, b) => b[1] - a[1])) {
    txt += `${f}: ${v.toFixed(2)} EUR\n`;
  }
  txt += '\n' + (LANG === 'en' ? 'DETAILED LIST' : 'LISTE D\u00c9TAILL\u00c9E') + '\n';
  for (const i of r.items.sort((a, b) => (a.furniture || '').localeCompare(b.furniture || ''))) {
    txt += `- ${(i.title || '?').slice(0, 60)} | ${(i.authors || []).join(', ').slice(0, 30)} | ${(i.isbn || '')} | ${i.furniture || ''}${i.slot ? ' \u00b7 ' + i.slot : ''} | ${(i.price || 0).toFixed(2)} EUR\n`;
  }
  download(`rapport-assurance-${today}.txt`, txt, 'text/plain');
  toast(tm('ins_report_done', r.count, r.total.toFixed(2) + ' EUR'), 5000);
}

function renderStats() {
  const v = $('#viewStats');
  const items = store.items;
  const yNow = String(readingGoals.year);
  const doneY = items.filter((i) => i.status === 'read' && (i.readFinish || '').startsWith(yNow)).length;
  const pagesY = items.filter((i) => i.status === 'read' && (i.readFinish || '').startsWith(yNow)).reduce((s2, i) => s2 + (i.pageCount || 0), 0);
  const estHoursY = Math.round(pagesY / 30);
  const inProg = items.filter((i) => i.status === 'reading' && !i.disposedHow);
  const queueN = items.filter((i) => i.readNext && !i.disposedHow).length;
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
    <h2>${t('stat_title')}</h2>
    <div class="stats-grid">
      <div class="stat-card"><div class="num">${items.length}</div><div class="lbl">${t('s_total')}</div></div>
      <div class="stat-card"><div class="num">${authors.size}</div><div class="lbl">${t('s_authors')}</div></div>
      <div class="stat-card"><div class="num">${publishers.size}</div><div class="lbl">${t('s_pub')}</div></div>
      <div class="stat-card"><div class="num">${avg}</div><div class="lbl">${t('s_avgrating')}</div></div>
      <div class="stat-card"><div class="num">${byStatus.read}</div><div class="lbl">${t('s_read')}</div></div>
      <div class="stat-card"><div class="num">${byStatus.reading}</div><div class="lbl">${t('s_reading')}</div></div>
      <div class="stat-card"><div class="num">${byStatus.unread}</div><div class="lbl">${t('s_unread')}</div></div>
      <div class="stat-card"><div class="num">${byStatus.wish}</div><div class="lbl">${t('s_wish')}</div></div>
      <div class="stat-card"><div class="num">${loaned}</div><div class="lbl">${t('s_loaned')} ${late ? `(${late} ${t('s_late')})` : ''}</div></div>
      <div class="stat-card"><div class="num">${store.items.filter((i) => i.favorite).length}</div><div class="lbl">${t('s_favs')}</div></div>
      <div class="stat-card"><div class="num">${(() => { const tot = store.items.reduce((s2, i) => s2 + (i.price || 0), 0); return tot ? Math.round(tot).toLocaleString('fr-FR') + ' €' : '—'; })()}</div><div class="lbl">${t('s_value')}</div></div>
      <div class="stat-card"><div class="num">${store.items.filter((i) => i.editionType && i.editionType !== 'standard').length}</div><div class="lbl">${t('s_editions')}</div></div>
      ${Object.entries(mediums).map(([m, n]) =>
        `<div class="stat-card"><div class="num">${n}</div><div class="lbl">${esc(mediumLabel(m))}</div></div>`).join('')}
      <div class="stat-card"><div class="num">🛡️ ${esc(insuranceReport().total.toFixed(0))} €</div><div class="lbl">${t('ins_total')}</div></div>
      <div class="stat-card"><div class="num">${store.items.filter((i) => i.status === 'read' && (i.readFinish || '').startsWith(new Date().getFullYear().toString())).reduce((a, i) => a + (i.pageCount || 0), 0)}</div><div class="lbl">${t('stat_pages_year', new Date().getFullYear())}</div></div>
      <div class="stat-card"><div class="num">${new Set(store.items.filter((i) => i.series && i.seriesState === 'ongoing').map((i) => i.series)).size}</div><div class="lbl">${t('stat_ongoing')}</div></div>
      <div style="flex:1 1 100%;margin-top:8px"><button class="btn" id="btnInsuranceReport" onclick="exportInsuranceReport()">🛡️ ${t('ins_report_btn')}</button></div>
    </div>
    <h2>📍 ${t('s_byloc')}</h2>
    <div class="stats-grid">${locationsList().map(([loc, its]) => {
      const max = Math.max(...locationsList().map(([, l]) => l.length), 1);
      const pct = Math.round(its.length / max * 100);
      return `<div class="stat-card"><div class="num">${its.length}</div><div class="lbl">${esc(loc)}</div>
        <div class="heat"><div class="heat-fill" style="width:${pct}%"></div></div>
        <button type="button" class="btn btn-danger small loc-del" data-loc="${esc(loc)}" title="${t('loc_del_title')}">🗑️</button></div>`;
  v.querySelectorAll('.loc-del').forEach((b) => b.addEventListener('click', () => {
    deleteLocationBooks(b.dataset.loc);
  }));
    }).join('') || `<p class="hint">${t('no_loc')}</p>`}</div>
    <h2>📖 ${t('s_reading')} (${readingGoals.year})</h2>
    <div class="stats-grid">
      <div class="stat-card"><div class="num">${doneY}</div><div class="lbl">${t('s_done_goal')} : ${readingGoals.target || '—'})</div></div>
      <div class="stat-card"><div class="num">${pagesY.toLocaleString('fr-FR')}</div><div class="lbl">${t('s_pages')} (${estHoursY} ${t('s_hours_est')})</div></div>
      <div class="stat-card"><div class="num">${inProg.length}</div><div class="lbl">${t('s_inprog')}</div></div>
      <div class="stat-card"><div class="num">${Math.round(pagesY / Math.max(1, doneY))}</div><div class="lbl">${t('s_avgpages')}</div></div>
      <div class="stat-card"><div class="num">${queueN}</div><div class="lbl">${t('s_queue')}</div></div>
    </div>
    <h2>📈 ${t('s_time')}</h2>
    ${additionsChart()}
    <h2>⭐ ${t('s_top_authors')}</h2>
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

/* Taxonomie des genres (3 niveaux) : Nature > Genre > Sous-genre.
   Champ fiche : format "Nature / Genre / Sous-genre" (ex. "Roman / Science-fiction / Cyberpunk").
   Les 3 listes sont proposees dans la fiche ; la recherche et le hasard filtrent par niveau. */
const GENRE_TAXONOMY = {
  "Roman": { "Policier": ["Noir", "Procédural", "Whodunit"], "Science-fiction": ["Cyberpunk", "Space opera", "Utopie/Dystopie", "Post-apocalyptique"], "Fantastique": ["Heroic fantasy", "Dark fantasy", "Conte de fées moderne", "Horreur"], "Espionnage": ["Géopolitique", "Thriller"], "Historique": [], "Romance": [], "Aventure": [], "Autobiographie romancée": [] },
  "Nouvelle": { "Recueil": [], "Fantastique": ["Horreur"], "Science-fiction": [] },
  "Biographie / Autobiographie": { "Témoignage": [], "Mémoires": [], "Biographie historique": [] },
  "Essai": { "Philosophie": [], "Sociologie": [], "Politique": [], "Économie": [], "Écologie": [], "Féminisme": [] },
  "Histoire": { "Antiquité": [], "Moyen Âge": [], "Époque moderne": [], "Seconde Guerre mondiale": [], "Histoire locale": [] },
  "Géographie / Voyage": { "Récit de voyage": [], "Géopolitique": [] },
  "Religion / Spiritualité": { "Christianisme": [], "Bouddhisme": [], "Spiritualité / Bien-être": [], "Autres": [] },
  "Sciences": { "Physique": [], "Vulgarisation": [], "Astronomie": [], "Biologie": [], "Médecine": [] },
  "Poésie": { "Recueil": [], "Anthologie": [] },
  "Théâtre": { "Comédie": [], "Tragédie": [], "Vaudeville": [] },
  "Bande dessinée": { "Franco-belge": ["Aventure", "Humour", "Western", "Historique"], "Manga": ["Shonen", "Shojo", "Seinen", "Josei", "Isekai"], "Comics US": ["Super-héros", "Indépendant"], "Roman graphique": [] },
  "Pratique / Cuisine": { "Recettes": [], "Végétal": [], "Pâtisserie": [] },
  "Jeunesse": { "Album": [], "Roman jeunesse": [], "BD jeunesse": [] },
  "Jeu de société": { "Familial": [], "Stratégie": [], "Ambiance": [], "Expert": [] },
  "Jeu vidéo": { "Action/Aventure": [], "RPG": [], "Stratégie": [], "Simulation": [] },
  "JDR": { "Manuel de règles": [], "Scénario/Campagne": [], "Univers/Background": [] },
  "Musique": { "Rock": [], "Pop": [], "Classique": [], "Jazz": [], "Bande originale": [] },
  "Film": { "Action": [], "Comédie": [], "Drame": [], "Documentaire": [], "Animation": [] },
  "Série": { "Drame": [], "Comédie": [], "Thriller": [], "Documentaire": [] },
  "Autre": {}
};
/* Corriger la structure mixte ci-dessus (certaines valeurs etaient des strings par erreur) */
for (const [nat, genres] of Object.entries(GENRE_TAXONOMY)) {
  for (const [g, subs] of Object.entries(genres)) {
    if (!Array.isArray(subs)) { GENRE_TAXONOMY[nat][g] = []; }
  }
  if (GENRE_TAXONOMY[nat]["Sciences"] && !Array.isArray(GENRE_TAXONOMY[nat]["Sciences"])) { /* noop */ }
}
// normaliser: Sciences avait "Physique" sans tableau
if (GENRE_TAXONOMY.Sciences) for (const k of Object.keys(GENRE_TAXONOMY.Sciences)) if (!Array.isArray(GENRE_TAXONOMY.Sciences[k])) GENRE_TAXONOMY.Sciences[k] = [];
if (GENRE_TAXONOMY.Jeunesse) for (const k of Object.keys(GENRE_TAXONOMY.Jeunesse)) if (!Array.isArray(GENRE_TAXONOMY.Jeunesse[k])) GENRE_TAXONOMY.Jeunesse[k] = [];

/* Suggestions de genres : toutes les combinaisons taxonomie (autocompletion du champ genre).
   Format : "Nature", "Nature / Genre", "Nature / Genre / Sous-genre". */
function genreTaxoSuggestions() {
  const out = [];
  for (const [nat, genres] of Object.entries(GENRE_TAXONOMY)) {
    out.push(`<option value="${esc(nat)}">`);
    for (const [g, subs] of Object.entries(genres)) {
      out.push(`<option value="${esc(nat + ' / ' + g)}">`);
      for (const sg of subs) out.push(`<option value="${esc(nat + ' / ' + g + ' / ' + sg)}">`);
    }
  }
  return out.join('');
}

function mediumLabel(m) {
  return { book: 'Livres', comic: 'BD', manga: 'Mangas', film: 'Films', series: 'Séries', music: 'Musiques', game: 'Jeux', boardgame: 'Jeux de société', videogame: 'Jeux vidéo', rpg: 'JDR', other: 'Autres' }[m] || m;
}

/* Barre de contexte: visible quand un filtre/recherche est actif, avec le compte en direct */
function updateCtxBar(items) {
  const bar = $('#ctxBar');
  if (!bar) return;
  const q = $('#searchInput').value.trim();
  const shelf = $('#shelfFilter').value;
  const status = $('#statusFilter').value;
  const fav = $('#favOnly').checked;
  const active = q || shelf || status || fav;
  if (!active) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const n = items.length;
  const total = store.items.length;
  $('#ctxCount').textContent = `${n} / ${total} ` + (LANG === 'en' ? 'shown' : 'affichés');
}

function renderAll() {
  if (typeof renderGenreFilter === 'function') { try { renderGenreFilter(); } catch {} }
  renderShelfOptions();
  renderGrid();
  renderShelves();
  renderStats();
  if (typeof renderGroups === 'function') renderGroups();
  if (typeof renderLists === 'function') renderLists();
  if (typeof renderLoans === 'function') renderLoans();
  if (typeof renderBorrowers === 'function') renderBorrowers();
  if (typeof renderReading === 'function') renderReading();
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
    ${field(t('f_title'), `<input type="text" name="title" value="${esc(it.title)}">`)}
    ${field(t('f_subtitle'), `<input type="text" name="subtitle" value="${esc(it.subtitle || '')}">`)}
    ${field(t('f_authors'), `<input type="text" name="authors" value="${esc(it.authors.join(', '))}">`)}
    <div class="form-row">
      ${field(t('f_record_state'), `<select name="recordState">
        <option value="draft" ${it.recordState === 'draft' ? 'selected' : ''}>${t('rs_draft')}</option>
        <option value="" ${(it.recordState || '') === '' ? 'selected' : ''}>${t('rs_complete')}</option>
        <option value="locked" ${it.recordState === 'locked' ? 'selected' : ''}>${t('rs_locked')}</option>
      </select>`)}
      ${field('Type', `<select name="medium">
        <option value="book" ${it.medium === 'book' ? 'selected' : ''}>Livre</option>
        <option value="comic" ${it.medium === 'comic' ? 'selected' : ''}>BD</option>
        <option value="manga" ${it.medium === 'manga' ? 'selected' : ''}>Manga</option>
        <option value="film" ${it.medium === 'film' ? 'selected' : ''}>Film (VHS/DVD/Blu-ray)</option>
        <option value="series" ${it.medium === 'series' ? 'selected' : ''}>Série (DVD/Blu-ray)</option>
        <option value="music" ${it.medium === 'music' ? 'selected' : ''}>Musique (CD/vinyle)</option>
        <option value="game" ${it.medium === 'game' ? 'selected' : ''}>Jeu</option>
        <option value="boardgame" ${it.medium === 'boardgame' ? 'selected' : ''}>Jeu de société / plateau</option>
        <option value="videogame" ${it.medium === 'videogame' ? 'selected' : ''}>Jeu vidéo</option>
        <option value="rpg" ${it.medium === 'rpg' ? 'selected' : ''}>JDR</option>
        <option value="other" ${it.medium === 'other' ? 'selected' : ''}>Autre</option>
      </select>`)}
      ${field('Statut', `<select name="status">
        <option value="unread" ${it.status === 'unread' ? 'selected' : ''}>À lire</option>
        <option value="reading" ${it.status === 'reading' ? 'selected' : ''}>En lecture</option>
        <option value="read" ${it.status === 'read' ? 'selected' : ''}>Lu</option>
      </select>`)}
    </div>
    <div class="form-row">
      ${field(t('f_series'), `<input type="text" name="series" value="${esc(it.series || '')}">`)}
      ${field(t('f_owner'), `<input type="text" name="owner" value="${esc(it.owner || '')}" placeholder="${t('f_owner_ph')}">`)}
      ${field(t('f_universe'), `<input type="text" name="universe" value="${esc(it.universe || '')}" placeholder="${t('f_universe_ph')}">`)}
      ${field(t('f_volume'), `<input type="text" name="volume" value="${esc(it.volume || '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_scenario'), `<input type="text" name="scenario" value="${esc((it.scenario || []).join(', '))}">`)}
      ${field(t('f_art'), `<input type="text" name="art" value="${esc((it.art || []).join(', '))}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_dewey'), `<input type="text" name="dewey" inputmode="decimal" value="${esc(it.dewey || '')}">`)}
      ${field(t('f_genre'), `<input type="text" name="genre" value="${esc(it.genre || '')}" list="genreTaxoList" placeholder="${t('f_genre_ph')}">`)}
      <datalist id="genreTaxoList">${genreTaxoSuggestions()}</datalist>
    </div>
    <div class="form-row">
      ${field(t('f_collection'), `<input type="text" name="collection" list="collectionList" value="${esc(it.collection || '')}"><datalist id="collectionList">${[...new Set(store.items.map((i) => i.collection).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`)}
      ${field('Format', `<select name="format">
        <option value="">—</option>
        ${[['Broché','f_fmt_broche'],['Poche','f_fmt_poche'],['Relié','f_fmt_relie'],['Grand format','f_fmt_grand'],['Cartonné','f_fmt_cart'],['Digital','f_fmt_digital']].map(([f, k]) => `<option value="${f}" ${it.format === f ? 'selected' : ''}>${t(k)}</option>`).join('')}
      </select>`)}
    </div>
    <div class="form-row">
      ${field(t('f_edition'), `<select name="editionType">
        ${[['standard', t('f_ed_standard')], ['first', t('f_ed_first')], ['collector', t('f_ed_collector')], ['rare', t('f_ed_rare')], ['incunable', t('f_ed_incunable')]].map(([v, lbl]) => `<option value="${v}" ${it.editionType === v ? 'selected' : ''}>${lbl}</option>`).join('')}
      </select>`)}
      ${field(t('f_price'), `<input type="number" name="price" step="0.01" min="0" value="${esc(it.price ?? '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_audience'), `<input type="text" name="audience" value="${esc(it.audience || '')}">`)}
      ${field(t('f_borrowed'), `<input type="text" name="borrowedFrom" value="${esc(it.borrowedFrom || '')}" placeholder="ex. Marie — à rendre">`)}
    </div>
    <div class="form-row">
      ${field(t('f_acqdate'), `<input type="date" name="acquiredAt" value="${esc(it.acquiredAt || '')}">`)}
      ${field(t('f_acqfrom'), `<input type="text" name="acquiredFrom" value="${esc(it.acquiredFrom || '')}" placeholder="ex. Librairie Decitre, brocante…">`)}
      ${field(t('f_acqprice'), `<input type="number" name="acquiredPrice" step="0.01" min="0" value="${esc(it.acquiredPrice ?? '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_disposed'), `<select name="disposedHow">
        ${[['', t('f_disp_none')], ['sold', t('f_disp_sold')], ['given', t('f_disp_given')], ['lost', t('f_disp_lost')], ['lent-away', t('f_disp_lent')]].map(([v, lbl]) => `<option value="${v}" ${it.disposedHow === v ? 'selected' : ''}>${lbl}</option>`).join('')}
      </select>`)}
      ${field(t('f_dispdate'), `<input type="date" name="disposedAt" value="${esc(it.disposedAt || '')}">`)}
      ${field(t('f_dispprice'), `<input type="number" name="disposedPrice" step="0.01" min="0" value="${esc(it.disposedPrice ?? '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_currentpage'), `<input type="number" name="currentPage" min="0" value="${esc(it.currentPage ?? '')}">`)}
      ${field('File « à lire ensuite »', `<label class="chk"><input type="checkbox" name="readNext" ${it.readNext ? 'checked' : ''}> Inclure dans ma file de lecture</label>`)}
    </div>
    <div class="form-row">
      ${field(t('f_seriesstate'), `<select name="seriesState">
        <option value="" ${!it.seriesState ? 'selected' : ''}>—</option>
        <option value="ongoing" ${it.seriesState === 'ongoing' ? 'selected' : ''}>${t('f_ongoing')}</option>
        <option value="complete" ${it.seriesState === 'complete' ? 'selected' : ''}>${t('f_complete')}</option>
      </select>`)}
      ${field(t('f_seriestotal'), `<input type="number" name="seriesTotal" min="1" value="${esc(it.seriesTotal ?? '')}">`)}
    </div>
    <div class="form-row">
      <label style="flex:1"><b>${t('f_related_title')}</b> <span class="hint">${t('f_related_hint')}</span></label>
    </div>
    <div id="relatedEditor">
      ${(it.related || []).map((r, idx) => `
        <div class="form-row" data-relidx="${idx}">
          <select name="rel_type_${idx}" style="flex:0 0 200px">
            ${['prequel','sequel','previous','next','spinoff','universe','adaptation','cycle','analysis','artbook','translation'].map((k) => `<option value="${k}" ${r.rel === k ? 'selected' : ''}>${t('rel_' + k)}</option>`).join('')}
          </select>
          <select name="rel_target_${idx}" style="flex:1">
            ${store.items.filter((o) => o.id !== it.id).map((o) => `<option value="${o.id}" ${r.id === o.id ? 'selected' : ''}>${esc((o.title || '').slice(0, 60))}${o.series ? ' (' + esc(o.series) + ')' : ''}</option>`).join('')}
          </select>
          <button type="button" class="btn small rel-del" data-relidx="${idx}">🗑️</button>
        </div>`).join('')}
      <div class="form-row"><button type="button" class="btn small" id="btnAddRelated">➕ ${t('rel_add')}</button></div>
    </div>
    <div class="form-row">
      <label class="chk"><input type="checkbox" name="favorite" ${it.favorite ? 'checked' : ''}> ♥ Favori</label>
      <label class="chk"><input type="checkbox" name="wishlist" ${it.wishlist ? 'checked' : ''}> ${t('f_wish')}</label>
    </div>
    <div class="form-row">
      ${field('Prêt', `<div style="display:flex;gap:8px;align-items:center">
        <input type="text" name="loanTo" placeholder="Prêté à…" value="${esc(it.loan ? it.loan.to : '')}">
        <input type="date" name="loanDue" value="${esc(it.loan ? it.loan.due || '' : '')}" title="Retour prévu">
        ${it.loan ? '<button type="button" class="btn small" id="btnReturnLoan">' + t('btn_return') + '</button>' : ''}
      </div>`)}
    </div>
    ${field(t('f_rating') || 'Note (sur 5)', `<div class="stars-input" id="starsInput">${[1,2,3,4,5].map((n) =>
      `<span data-n="${n}" class="${n <= (it.rating || 0) ? 'on' : ''}">★</span>`).join('')}</div>`)}
    ${field(t('f_notes'), `<textarea name="notes">${esc(it.notes || '')}</textarea>`)}
    ${field(t('f_shelves'), shelvesChecks || '<span class="hint">' + t('no_shelf2') + '</span>')}
    ${field(t('f_tags'), `<input type="text" name="tags" value="${esc(tagsStr)}">`)}
    ${field(t('f_location'), `<div class="form-row location-row">
      <input type="text" name="furniture" list="furnitureList" placeholder="Meuble (ex. Bibliothèque salon)" value="${esc(it.furniture || '')}">
      <input type="text" name="slot" list="slotList" placeholder="Étagère / rayon (ex. Étagère 4)" value="${esc(it.slot || '')}">
      <datalist id="furnitureList">${knownFurniture().map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
      <datalist id="slotList">${knownSlots().map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    </div>`)}
    ${field(t('f_summary'), `<textarea name="summary" rows="4">${esc(it.summary || '')}</textarea>`)}
    ${field(t('f_backcover'), `<textarea name="backCoverText" rows="3" placeholder="${t('f_backcover_ph')}">${esc(it.backCoverText || '')}</textarea>`)}
    <div class="form-row">
      ${field(t('f_publisher'), `<input type="text" name="publisher" value="${esc(it.publisher || '')}">`)}
      ${field(t('f_pubdate'), `<input type="text" name="publishedDate" value="${esc(it.publishedDate || '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_isbn'), `<input type="text" name="isbn" value="${esc(it.isbn)}">`)}
      ${field(t('f_pages'), `<input type="number" name="pageCount" value="${esc(it.pageCount ?? '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_cover'), `<input type="text" name="cover" value="${esc(it.cover || '')}">`)}
      ${field(t('f_coverback'), `<input type="text" name="coverBack" value="${esc(it.coverBack || '')}">`)}
      <div class="form-row">
        <div>
          <label>Importer une image depuis l'appareil (contourne les liens bloqués — image stockée dans la fiche, à vie)</label>
          <div class="row">
            <input type="file" id="importCoverFront" accept="image/*" class="hidden">
            <label for="importCoverFront" class="btn small" style="cursor:pointer">📷 Couverture devant…</label>
            <button type="button" class="btn small" id="btnAiReadCover" title="${t('ai_cover_title')}">🤖 ${t('ai_cover_btn')}</button>
            <input type="file" id="importCoverBack" accept="image/*" class="hidden">
            <label for="importCoverBack" class="btn small" style="cursor:pointer">📷 Dos…</label>
          </div>
          <p class="hint" id="importCoverStatus"></p>
        </div>
      </div>
      <div class="hint">
        ${t('cov_hint')}
        <a target="_blank" rel="noopener" href="https://www.chasse-aux-livres.fr/livre/${esc(it.isbn)}">${t('cov_chasse')}</a>
        ${t('cov_chasse_how')}
        ${t('cov_or')} <a target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent((LANG === 'en' ? 'book cover ' : 'couverture ') + (it.title || '') + ' ' + it.isbn)}">${t('cov_google')}</a>
        <br>${t('cov_local')}
      </div>
    </div>
    ${it.universe || allRelated(it).length ? `<div class="form-row" style="margin-top:10px;background:var(--bg-accent);padding:8px;border-radius:8px">
      ${it.universe ? `<div>🌌 <b>${t('f_universe')} :</b> ${esc(it.universe)}</div>` : ''}
      ${allRelated(it).length ? `<div style="margin-top:4px">🔗 <b>${t('f_related_title')}</b> : ${allRelated(it).filter((r) => store.findById(r.id)).map((r) => {
        const o = store.findById(r.id);
        return `<a href="#" class="rel-link" data-relid="${o.id}">${t('rel_' + (r.rel || 'universe'))} : ${esc((o.title || '').slice(0, 40))}${o.series ? ' (' + esc(o.series) + ')' : ''}</a>`;
      }).join(' · ')}</div>` : ''}
    </div>` : ''}
    <p class="refs">${t('added_on')} ${esc((it.addedAt || '').slice(0, 10))} · ISBN : ${esc(it.isbn)}${it.isbn10 ? ' / ' + esc(it.isbn10) : ''}${it.language ? ' · ' + t('f_language') + ': ' + esc(it.language) : ''}${(it.srcFound || []).length ? ' · ' + t('sources_found') + ': ' + esc(it.srcFound.join(', ')) : ''}</p>
    <div class="form-row ext-links">
      ${it.isbn ? `<a class="btn small" target="_blank" rel="noopener" href="https://www.chasse-aux-livres.fr/livre/${esc(it.isbn)}">${t('ext_chasse')}</a>
      ${publisherDomain(it.publisher) ? `<a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent('site:' + publisherDomain(it.publisher) + ' ' + it.isbn)}">🏠 ${t('ext_publisher')}</a>` : ''}
      <a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent('couverture livre ' + (it.title || '') + ' ' + it.isbn)}">${t('ext_img')}</a>
      ${it.series ? `<a class="btn small" target="_blank" rel="noopener" href="https://www.chasse-aux-livres.fr/recherche?q=${encodeURIComponent(it.series)}">📚 ${t('ext_series')} « ${esc(it.series)} »</a>` : ''}` : ''}
    </div>
    <div class="form-actions-group">
      <div class="form-actions-title">${t('act_verify')}</div>
      <div class="form-row ext-links">
        <button type="button" class="btn small" id="btnDiagRecord" title="${t('diag_record_title')}" ${it.isbn ? '' : 'disabled'}>🔍 ${t('diag_record')}</button>
        <button type="button" class="btn small" id="btnRefreshRecord" title="${t('refresh_record_title')}" ${it.isbn ? '' : 'disabled'}>🔄 ${t('refresh_record')}</button>
        ${(it.isBlank || it.title === '?' || !it.isbn) ? `<button type="button" class="btn small btn-primary" id="btnScanComplete" title="${t('scan_complete_title')}">📷 ${t('scan_complete_btn')}</button>` : ''}
        <button type="button" class="btn small" id="btnAiFill" title="${t('ai_fill_title')}" ${it.title && !String(it.title).startsWith('ISBN ') ? '' : 'disabled'}>🤖 ${t('ai_fill_btn')}</button>
      </div>
      <div class="form-actions-title">${t('act_share')}</div>
      <div class="form-row ext-links">
        <button type="button" class="btn small" id="btnShareCover" title="${t('share_cover_title')}" ${it.isbn ? '' : 'disabled'}>🤝 ${t('share_cover')}</button>
        <button type="button" class="btn small" id="btnShareCoverBack" title="${t('share_coverback_title')}" ${it.isbn && it.coverBack ? '' : 'disabled'}>🤝 ${t('share_coverback')}</button>
        <button type="button" class="btn small" id="btnShareRecord" title="${t('share_record_title')}" ${it.title && !String(it.title).startsWith('ISBN ') ? '' : 'disabled'}>📝 ${t('share_record')}</button>
      </div>
    </div>

  `;
  $('#detailModal').classList.remove('hidden');
  addLogToDetail(it);
  wireCoverImport('importCoverFront', 'cover');
  wireCoverImport('importCoverBack', 'coverBack');
  /* 🤖 IA lit la couverture : photo importée (devant/dos) -> IA vision extrait titre/auteur/ISBN/résumé */
  const btnAiCover = $('#btnAiReadCover');
  if (btnAiCover) btnAiCover.addEventListener('click', () => {
    const it2 = store.findById(editingId);
    const src = it2 && (it2.coverBack || it2.cover);
    if (!src) { toast(tm('ai_cover_needimg'), 4500); return; }
    (async () => {
      if (!aiCfg.key && aiCfg.provider !== 'ollama') { toast(tm('ai_first'), 4000); return; }
      toast(tm('ai_cover_reading'), 3000);
      try {
        const sys = 'Tu lis des photographies de couvertures de livres (recto ou verso/4e de couverture). Renvoie UNIQUEMENT un JSON: {"title":"titre","authors":["auteurs"],"isbn":"ISBN si lisible","summary":"résumé de la 4e de couverture si visible","publisher":"éditeur","collection":"collection"} — chaîne vide si non lisible.';
        const resp = await aiVisionShelf(sys, src);
        const m = resp.match(/\{[\s\S]*\}/);
        if (!m) { toast(tm('ai_cover_fail'), 4000); return; }
        const data = JSON.parse(m[0]);
        let n = 0;
        if (data.title && (!it2.title || it2.title === '?')) { it2.title = data.title; n++; }
        if (Array.isArray(data.authors) && data.authors.length && !(it2.authors || []).length) { it2.authors = data.authors; n++; }
        const isbn13 = data.isbn ? normalizeIsbn(String(data.isbn)) : '';
        if (isbn13 && /^\d{13}$/.test(isbn13) && !it2.isbn) { it2.isbn = isbn13; n++; }
        if (data.summary && !it2.summary) { it2.summary = data.summary; n++; }
        if (data.publisher && !it2.publisher) { it2.publisher = data.publisher; n++; }
        if (data.collection && !it2.collection && KNOWN_COLLECTIONS.includes(String(data.collection).trim())) { it2.collection = String(data.collection).trim(); n++; }
        if (n) {
          if (it2.recordState === 'draft' && it2.title && it2.title !== '?') it2.recordState = '';
          store.update(it2);
          renderAll();
          autoBackupTick();
          toast(tm('ai_cover_done', n), 4500);
          openDetail(it2.id);
        } else toast(tm('ai_nothing'), 3500);
      } catch (e) { toast(tm('err_ai') + ' ' + e.message, 4500); }
    })();
  });

  // 📷 Scanner pour compléter: scan caméra/douchette de l'ISBN du livre -> la fiche blank se remplit
  const btnScanComplete = $('#btnScanComplete');
  if (btnScanComplete) btnScanComplete.addEventListener('click', () => {
    // demarrer le scan en mode 'complete' — le resultat remplira CETTE fiche
    window.__scanCompleteTargetId = editingId;
    window.__reopenDetailAfterScan = editingId; // rouvrir la fiche apres le scan
    $('#detailModal').classList.add('hidden'); // liberer l'ecran pour la camera
    startScan();
  });
  const btnAiFill = $('#btnAiFill');
  if (btnAiFill) btnAiFill.addEventListener('click', async () => {
    if (!aiCfg.key && aiCfg.provider !== 'ollama') { toast(tm('ai_first'), 4000); return; }
    // fiche '?' sans ISBN: l'IA ne peut pas deviner un titre — orienter vers le scan
    if ((it.title === '?' || !it.title) && !it.isbn) {
      toast(tm('ai_need_hint'), 5000);
      return;
    }
    btnAiFill.disabled = true;
    btnAiFill.textContent = t('ai_filling');
    try {
      const res = await aiFillItem(editingId);
      if (res && res.mergedInto) {
        toast(tm('ai_merged'), 5000);
        openDetail(res.mergedInto);
      } else {
        const n = res && res.changed ? new Set(res.changed).size : 0;
        const steps = window.__aiSteps || [];
        window.__aiSteps = [];
        if (n) toast(tm('ai_filled') + ' (' + n + ')', 4000);
        else if (steps.length) toast(tm('ai_failed_steps') + ' — ' + steps.join(' · '), 7000);
        else toast(tm('ai_nothing'), 3500);
        openDetail(editingId);
      }
      renderAll();
    } catch (e) {
      toast(tm('err_ai') + ' ' + e.message, 4000);
    }
    btnAiFill.disabled = false;
    btnAiFill.textContent = t('ai_fill_btn');
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
    if (!confirm(tm('loan_return_confirm', it2.title, it2.loan.to))) return;
    markLoanReturned(it2, todayISO());
    it2.loan = null;
    store.update(it2);
    $('#detailModal').classList.add('hidden');
    renderAll();
    toast(tm('returned'));
  });
  const hist = (it.loanHistory || []);
  if (hist.length) {
    const box = document.createElement('div');
    box.innerHTML = `${field((LANG === 'en' ? 'Loan history' : 'Historique des prêts'), `<div class="hint">${hist.slice().reverse().map((h) =>
      `📤 ${esc(h.to)} · ${esc(h.date)}${h.due ? ` → ${esc(h.due)}` : ''} · ${h.returned ? `↩ ${t('since')} ${esc(h.returned)}` : '<b>' + t('ongoing') + '</b>'}`).join('<br>')}</div>`)}`;
    $('#detailForm').appendChild(box);
  }
}

$('#btnShowBack').addEventListener('click', () => {
  const it = store.findById(editingId);
  toast(it && it.coverBack ? (LANG === 'en' ? 'This book has a back-cover image: tap "Flip".' : 'Cet ouvrage a une image de dos : cliquez « Retourner ».') : (LANG === 'en' ? 'No back-cover image yet. Add it via the back-cover URL field.' : 'Aucune image de dos enregistrée. Ajoutez-la via le champ « URL image dos ».'));
});
$('#btnFlipCover').addEventListener('click', () => {
  // bascule propre: montrer l'autre face (jamais les deux cachées)
  const front = $('#coverFront'), back = $('#coverBack');
  const showingFront = !front.classList.contains('hidden');
  front.classList.toggle('hidden', showingFront);
  back.classList.toggle('hidden', !showingFront);
});

/* Diagnostic d'une fiche + partage couverture a la banque */
$('#detailBody').addEventListener('click', async (e) => {
  const relA = e.target.closest && e.target.closest('a.rel-link');
  if (relA) { e.preventDefault(); openDetail(relA.dataset.relid); return; }
  const refreshBtn = e.target.closest('#btnRefreshRecord');
  if (refreshBtn) {
    const it = store.findById(editingId);
    if (!it) return;
    refreshBtn.disabled = true;
    refreshBtn.textContent = t('diag_querying');
    try {
      const res = await refreshRecordFromSources(it);
      if (res && res.mergedInto) {
        toast(tm('ai_merged'), 5000);
        openDetail(res.mergedInto);
      } else {
        toast(res.changed ? tm('refresh_done', res.changed) + ' (' + (res.sources || []).join(', ') + ')' : tm('refresh_none'), 5000);
        if (res.changed) openDetail(editingId);
      }
    } catch (err) { toast(tm('cloud_fail') + ' ' + err.message, 6000); }
    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄 ' + t('refresh_record');
    return;
  }
  const recBtn = e.target.closest('#btnShareRecord');
  if (recBtn) {
    const it = store.findById(editingId);
    if (!it || !it.isbn || !it.title || it.title.startsWith('ISBN ')) { toast(tm('share_record_empty'), 5000); return; }
    recBtn.disabled = true;
    try {
      await shareRecordToBank(it);
      toast(tm('share_record_done'), 4500);
    } catch (err) { toast(tm('cloud_fail') + ' ' + err.message, 6000); }
    recBtn.disabled = false;
    return;
  }
  const shareBackBtn = e.target.closest('#btnShareCoverBack');
  if (shareBackBtn) {
    const it = store.findById(editingId);
    if (!it || !it.isbn || !it.coverBack || !String(it.coverBack).startsWith('data:image')) { toast(tm('share_need_embedded'), 5000); return; }
    shareBackBtn.disabled = true;
    try {
      const res = await shareCoverToBank(normalizeIsbn(it.isbn) + '-dos', it.coverBack);
      toast(res.uploaded ? tm('share_done') : tm('share_already'), 4500);
    } catch (err) { toast(tm('cloud_fail') + ' ' + err.message, 6000); }
    shareBackBtn.disabled = false;
    return;
  }
  const shareBtn = e.target.closest('#btnShareCover');
  if (shareBtn) {
    const it = store.findById(editingId);
    if (!it || !it.isbn) { toast(tm('share_need_isbn'), 4000); return; }
    const src = coverStore.data[it.id] || it.cover;
    if (!src || !String(src).startsWith('data:image')) { toast(tm('share_need_embedded'), 5000); return; }
    shareBtn.disabled = true;
    try {
      const res = await shareCoverToBank(normalizeIsbn(it.isbn), src);
      toast(res.uploaded ? tm('share_done') : tm('share_already'), 4500);
    } catch (err) { toast(tm('cloud_fail') + ' ' + err.message, 6000); }
    shareBtn.disabled = false;
    return;
  }
  const btn = e.target.closest('#btnDiagRecord');
  if (!btn) return;
  const it = store.findById(editingId);
  if (!it || !it.isbn) return;
  const isbn = normalizeIsbn(it.isbn);
  if (!isbn) return;
  const lines = [];
  const out = prompt; // (inutilise)
  btn.disabled = true;
  btn.textContent = t('diag_querying');
  const jobs = [
    fetchGoogleBooks(isbn).then((r) => lines.push(r ? `✅ Google Books: « ${r.title} » ${r.cover ? '(' + t('diag_cover') + ' ✓)' : '(' + t('diag_nocover') + ')'} ${r.summary ? '(' + t('diag_summary') + ' ✓)' : ''}` : t('diag_gb_none'))).catch(() => lines.push(t('diag_net_err', 'Google Books'))),
    fetchBnf(isbn).then((r) => lines.push(r ? `✅ BnF: « ${r.title} » — ${r.authors.join(', ')}` : t('diag_bnf_none'))).catch(() => lines.push(t('diag_net_err', 'BnF'))),
    fetchOpenLibrary(isbn).then((r) => lines.push(r ? `✅ Open Library: « ${r.title} »` : t('diag_ol_none'))).catch(() => lines.push(t('diag_net_err', 'Open Library'))),
    fetchCoverFallback(isbn).then((r) => lines.push(r ? t('diag_covers_ok') : t('diag_covers_none'))).catch(() => lines.push(t('diag_net_err', 'Covers'))),
  ];
  await Promise.all(jobs);
  if (apiKeys.relay) {
    try {
      const rr = await fetchRelay(isbn);
      lines.push(rr ? `✅ ${t('diag_relay')} (Fnac/BnF): « ${rr.title} » — ${rr.publisher}` : t('diag_relay_none'));
    } catch { lines.push(t('diag_relay_err')); }
  } else {
    lines.push(t('diag_relay_unset'));
  }
  const foundCount = lines.filter((l) => l.startsWith('✅')).length;
  const recap = (it.srcFound || []).length ? t('diag_record_found_by') + ': ' + it.srcFound.join(', ') : '';
  toast(`${t('diag_record_result')} (${foundCount}) : ` + lines.join(' · '), 12000);
  if (recap) toast(recap, 8000);
  btn.disabled = false;
  btn.textContent = '🔍 ' + t('diag_record');
});

$('#detailBody').addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btnAddRelated') {
    const it = store.findById(editingId);
    if (it) { (it.related = it.related || []).push({ rel: 'sequel', id: '' }); openDetail(it.id); renderAll(); }
    return;
  }
  if (e.target && e.target.classList && e.target.classList.contains('rel-del')) {
    const it = store.findById(editingId);
    if (it) { (it.related = it.related || []).splice(+e.target.dataset.relidx, 1); openDetail(it.id); renderAll(); }
  }
});

$('#btnSaveDetail').addEventListener('click', () => {
  const it = store.findById(editingId);
  if (!it) return;
  const newState = $('#detailForm').querySelector('[name="recordState"]') ? $('#detailForm').querySelector('[name="recordState"]').value : '';
  if (isRecordLocked(it) && newState === 'locked') { toast(tm('rs_locked_blocked'), 4500); return; } // deverrouillage explicite requis
  // Verrouiller une fiche COMPLETE = signal de qualité -> proposer le partage à la banque communautaire
  if (!isRecordLocked(it) && newState === 'locked' && it.isbn && it.title && !it.title.startsWith('ISBN ')) {
    const pref = sharePref();
    if (pref === 'yes') {
      shareRecordToBank(it).then(() => toast(tm('rs_locked_shared'), 4000)).catch(() => toast(tm('rs_locked_sharefail'), 3500));
    } else if (pref !== 'no') {
      // pas de preference: demander une fois (modale share existante, avec memo)
      sharePromptItemId = it.id;
      const m = document.getElementById('sharePromptModal');
      if (m) { document.getElementById('chkShareRemember').checked = false; m.classList.remove('hidden'); toast(tm('rs_locked_askshare'), 4500); }
    }
  }

  const f = $('#detailForm');
  const val = (n) => f.querySelector(`[name="${n}"]`).value.trim();
  it.title = val('title');
  it.subtitle = val('subtitle');
  it.authors = val('authors').split(',').map((s) => s.trim()).filter(Boolean);
  it.recordState = f.querySelector('[name="recordState"]') ? f.querySelector('[name="recordState"]').value : '';
  it.medium = f.querySelector('[name="medium"]').value;
  const newStatus = f.querySelector('[name="status"]').value;
  if (newStatus === 'read' && it.status !== 'read') it.readFinish = todayISO();
  if (newStatus !== 'read') it.readFinish = '';
  it.status = newStatus;
  it.series = val('series');
  it.owner = val('owner');
  it.volume = val('volume');
  it.scenario = val('scenario').split(',').map((s) => s.trim()).filter(Boolean);
  it.art = val('art').split(',').map((s) => s.trim()).filter(Boolean);
  it.seriesState = f.querySelector('[name="seriesState"]').value;
  it.seriesTotal = +val('seriesTotal') || null;
  it.favorite = f.querySelector('[name="favorite"]').checked;
  it.wishlist = f.querySelector('[name="wishlist"]').checked;
  it.dewey = val('dewey').replace(',', '.').trim();
  it.genre = val('genre');
  it.collection = val('collection');
  it.format = f.querySelector('[name="format"]').value;
  it.editionType = f.querySelector('[name="editionType"]').value;
  it.price = +val('price') || null;
  it.audience = val('audience');
  it.borrowedFrom = val('borrowedFrom');
  it.acquiredAt = val('acquiredAt');
  it.acquiredFrom = val('acquiredFrom');
  it.acquiredPrice = +val('acquiredPrice') || null;
  it.disposedAt = val('disposedAt');
  it.disposedHow = f.querySelector('[name="disposedHow"]').value;
  it.disposedPrice = +val('disposedPrice') || null;
  it.currentPage = +val('currentPage') || null;
  it.readNext = f.querySelector('[name="readNext"]').checked;
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
  it.backCoverText = val('backCoverText');
  it.publisher = val('publisher');
  it.publishedDate = val('publishedDate');
  it.isbn = normalizeIsbn(val('isbn'));
  it.pageCount = +val('pageCount') || null;
  it.cover = val('cover');
  it.coverBack = val('coverBack');
  store.update(it);
  $('#detailModal').classList.add('hidden');
  toast(tm('saved'));
  renderAll();
  maybeSuggestShare(it);
});

document.getElementById('btnShareYes').addEventListener('click', async () => {
  const remember = document.getElementById('chkShareRemember').checked;
  if (remember) setSharePref('yes');
  document.getElementById('sharePromptModal').classList.add('hidden');
  const it = sharePromptItemId && store.findById(sharePromptItemId);
  if (it) { try { await shareRecordToBank(it); toast(tm('share_record_done'), 4500); } catch (e) { toast(tm('cloud_fail') + ' ' + e.message, 6000); } }
  sharePromptItemId = null;
});
document.getElementById('btnShareNo').addEventListener('click', () => {
  const remember = document.getElementById('chkShareRemember').checked;
  if (remember) setSharePref('no');
  document.getElementById('sharePromptModal').classList.add('hidden');
  sharePromptItemId = null;
});

$('#btnDeleteDetail').addEventListener('click', () => {
  const it = store.findById(editingId);
  if (!it) return;
  if (!confirm(tm('delete_confirm', it.title))) return;
  store.remove(editingId);
  $('#detailModal').classList.add('hidden');
  toast(tm('deleted'));
  renderAll();
});
$('#btnCloseDetail').addEventListener('click', () => $('#detailModal').classList.add('hidden'));

/* ---------- Shelves ---------- */
$('#btnAddShelf').addEventListener('click', () => {
  const name = $('#newShelfName').value.trim();
  if (!name) return;
  if (store.shelves.includes(name)) { toast(tm('shelf_exists')); return; }
  store.shelves.push(name);
  store.save();
  $('#newShelfName').value = '';
  renderAll();
  toast((LANG === 'en' ? `Shelf “${name}” created.` : `Étagère « ${name} » créée.`));
});

/* ---------- Navigation ---------- */
/* Recherche de fonction dans le menu: filtre les boutons par libellé */
$('#navSearch').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('#mainNav .nav-item').forEach((b) => {
    const txt = (b.textContent || '').toLowerCase();
    const hit = !q || txt.includes(q);
    b.classList.toggle('hidden', !hit);
    if (hit) shown++;
  });
  document.querySelectorAll('#mainNav .nav-group').forEach((g) => {
    const any = [...g.querySelectorAll('.nav-item')].some((b) => !b.classList.contains('hidden'));
    g.classList.toggle('hidden', !any);
  });
  $('#navSearchCount').textContent = q ? shown + (LANG === 'en' ? ' found' : ' trouvée(s)') : '';
});

$('#btnMenu').addEventListener('click', () => $('#mainNav').classList.toggle('hidden'));
// Regle universelle: tout clic dans le menu sur un bouton SANS data-view (donc ouvrant une modale/outil) referme le menu
$('#mainNav').addEventListener('click', (e) => {
  const btn = e.target.closest('button.nav-btn');
  if (btn && !btn.dataset.view) {
    // laisser le handler specifique agir, mais refermer le menu
    setTimeout(() => $('#mainNav').classList.add('hidden'), 0);
  }
});
$('#mainNav').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  $('#mainNav').classList.add('hidden');
  document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
  const view = { grid: '#viewGrid', shelves: '#viewShelves', stats: '#viewStats', groups: '#viewGroups', lists: '#viewLists', loans: '#viewLoans', inventory: '#viewInventory', reading: '#viewReading' }[btn.dataset.view] || '#viewGrid';
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
  return JSON.stringify({ app: LANG === 'en' ? 'My Library' : 'Ma Bibliothèque', exportedAt: new Date().toISOString(), embeddedCovers: coversCfg.embedded, covers, shelves: store.shelves, lists: store.lists, items: store.items }, null, 2);
}

/* 🔄 Auto-sync GitHub : push silencieux 30s après la dernière activité (si token configuré) */
let __autoSyncScheduled = false;
function scheduleAutoSync() {
  if (!apiKeys.ghToken || __autoSyncScheduled) return;
  __autoSyncScheduled = true;
  setTimeout(async () => {
    __autoSyncScheduled = false;
    try { await cloudBackupPush(); toast(tm('autosync_done'), 2500); } catch {}
  }, 30000);
}

function autoBackupTick() {
  if (!backupCfg.enabled || !backupCfg.every) return;
  backupCfg.since++;
  saveBackupCfg();
  if (backupCfg.since >= backupCfg.every) {
    backupCfg.since = 0;
    saveBackupCfg();
    download(`bibliotheque-auto-${stamp()}.json`, exportJsonPayload(), 'application/json');
    toast(tm('auto_backup'));
  }
}

$('#btnBackupNow').addEventListener('click', () => {
  download(`bibliotheque-${stamp()}-${new Date().toTimeString().slice(0,5).replace(':','h')}.json`, exportJsonPayload(), 'application/json');
  toast(tm('backup_done'));
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
  toast(n ? (LANG === 'en' ? `Auto backup: every ${n} scans.` : `Sauvegarde auto : tous les ${n} scans.`) : (LANG === 'en' ? 'Auto backup disabled.' : 'Sauvegarde auto désactivée.'));
});

/* ---------- Sauvegarde cloud GitHub (privée, via votre token personnel) ----------
   Pousse/récupère le JSON complet de la bibliothèque dans le dépôt privé
   (fichier bibliothek-backup.json à la racine). Le token reste dans le navigateur. */
const GH_BACKUP_PATH = 'bibliotheque-sauvegarde.json';

async function ghApi(path, opts = {}) {
  const token = apiKeys.ghToken;
  if (!token) throw new Error(LANG === 'en' ? 'GitHub token missing (☰ → 🔑 → Token GitHub)' : 'Token GitHub manquant (☰ → 🔑 → Token GitHub)');
  const r = await fetchWithTimeout(`https://api.github.com/repos/Chenzu-AI/Bibliotheque/contents/${path}`, 15000, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...((opts && opts.headers) || {}),
    },
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error(LANG === 'en' ? 'Invalid token' : 'Token invalide');
    if (r.status === 404) throw new Error('NOT_FOUND');
    throw new Error('HTTP ' + r.status);
  }
  return r.json();
}

async function cloudBackupPush() {
  const payload = exportJsonPayload();
  let sha = null;
  try { const cur = await ghApi(GH_BACKUP_PATH); sha = cur.sha; } catch (e) { if (String(e.message) !== 'NOT_FOUND') { if (!/HTTP 404/.test(e.message)) throw e; } }
  const body = JSON.stringify({
    message: tm('cloud_commit_msg') + stamp(),
    content: btoa(unescape(encodeURIComponent(payload))),
    ...(sha ? { sha } : {}),
  });
  await ghApi(GH_BACKUP_PATH, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
  return true;
}

async function cloudBackupPull() {
  const cur = await ghApi(GH_BACKUP_PATH + '?ref=main');
  const json = JSON.parse(decodeURIComponent(escape(atob(cur.content))));
  if (!json || !Array.isArray(json.items)) throw new Error(LANG === 'en' ? 'Invalid backup file' : 'Fichier de sauvegarde invalide');
  return json;
}

/* ---------- Banque de FICHES (fond communautaire de metadonnees, sauf donnees personnelles) ----------
   Le meme dossier covers/ heberge fiches/<ISBN>.json : une fiche complete editee par un humain
   vaut mieux qu'une notice incomplete des catalogues. Partage volontaire, consultation automatique
   comme recours final de la reconnaissance. Champs personnels JAMAIS exportes. */
const PERSONAL_FIELDS = ['loan', 'loanHistory', 'notes', 'rating', 'favorite', 'wishlist', 'readNext', 'nextOrder', 'currentPage', 'readingLog', 'acquiredAt', 'acquiredFrom', 'acquiredPrice', 'borrowedFrom', 'disposedHow', 'disposedAt', 'disposedPrice', 'reserved', 'shelves', 'tags', 'duplicateOf', 'addedAt', 'readFinish', 'furniture', 'slot', 'srcFound', 'id'];

function sanitizeItemForShare(it) {
  const clean = { ...blankItem(it.isbn) };
  for (const k of Object.keys(it)) {
    if (PERSONAL_FIELDS.includes(k)) continue;
    clean[k] = it[k];
  }
  clean.isbn = normalizeIsbn(it.isbn);
  clean.sharedAt = new Date().toISOString().slice(0, 10);
  return clean;
}

/* Mise a jour d'une fiche depuis les sources (BnF, Google Books, relais, banques) —
   complete UNIQUEMENT les champs vides, n'ecrase jamais vos saisies */
async function refreshRecordFromSources(it) {
  // Cas 1: pas d'ISBN — recherche par titre+auteur sur Google Books, puis si ISBN trouve, chaine complete
  if (!it.isbn) {
    const q = [it.title, (it.authors || [])[0]].filter(Boolean).join(' ');
    if (!q || String(it.title).startsWith('ISBN ')) return { changed: 0 };
    try {
      const r = await fetchWithTimeout('https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent('intitle:' + q) + gbKeyParam(), 12000);
      const data = await r.json();
      if (data.items && data.items.length) {
        // prendre le resultat le plus proche du titre
        let best = data.items[0], bestSim = 0;
        for (const item of data.items.slice(0, 5)) {
          const sim = titleSimilarity(item.volumeInfo && item.volumeInfo.title || '', it.title);
          if (sim > bestSim) { bestSim = sim; best = item; }
        }
        const meta = normalizeGoogleMeta(best);
        if (meta.isbn) {
          // ISBN identifie: verifier un doublon existant puis lancer la chaine complete
          const isbn13 = normalizeIsbn(meta.isbn);
          const dup = store.items.find((x) => x.id !== it.id && x.isbn === isbn13);
          if (dup) {
            if (it.furniture && !dup.furniture) { dup.furniture = it.furniture; dup.slot = it.slot; dup.location = it.location; }
            store.update(dup); store.remove(it.id);
            return { changed: ['merged'], mergedInto: dup.id };
          }
          it.isbn = isbn13;
          const full = await fetchMetadataSmart(isbn13);
          if (full) return applyMetaToItem(it, full);
        }
        // pas d'ISBN dans Google: remplir ce qu'on a (titre/auteur/editeur/annee/couverture/resume)
        return applyMetaToItem(it, meta);
      }
    } catch {}
    return { changed: 0 };
  }
  const isbn = normalizeIsbn(it.isbn);
  const meta = await fetchMetadataSmart(isbn);
  if (!meta) return { changed: 0 };
  return applyMetaToItem(it, meta);
}

/* Application champ-par-champ (vide uniquement) + fusion des sources */
async function applyMetaToItem(it, meta) {
  let changed = 0;
  const FIELDS = ['title', 'subtitle', 'authors', 'publisher', 'publishedDate', 'pageCount', 'language', 'categories', 'summary', 'backCoverText', 'cover', 'isbn', 'isbn10', 'series', 'genre', 'dewey'];
  for (const k of FIELDS) {
    const cur = it[k];
    const empty = cur === '' || cur === null || cur === undefined || (Array.isArray(cur) && !cur.length) || String(cur).startsWith('ISBN ');
    const val = meta[k];
    if (empty && val && !(Array.isArray(val) && !val.length)) { it[k] = val; changed++; }
  }
  if (Array.isArray(meta.srcFound) && meta.srcFound.length) {
    it.srcFound = [...new Set([...(it.srcFound || []), ...meta.srcFound])];
  }
  if (changed) { store.update(it); renderAll(); }
  return { changed, sources: meta.srcFound || [] };
}
/* Suggestion de partage a la sauvegarde : oui/non + se souvenir de mon choix */
const SHARE_PREF_KEY = 'biblio.share.pref.v1';
function sharePref() {
  try { return localStorage.getItem(SHARE_PREF_KEY) || 'ask'; } catch { return 'ask'; }
}
function setSharePref(v) { try { localStorage.setItem(SHARE_PREF_KEY, v); } catch {} }
let sharePromptItemId = null;

function maybeSuggestShare(it) {
  if (!it || !it.isbn || !it.title || String(it.title).startsWith('ISBN ')) return;
  const pref = sharePref();
  if (pref === 'no') return;
  if (pref === 'yes') { shareRecordToBank(it).then(() => toast(tm('share_auto_done'), 3000)).catch(() => {}); return; }
  sharePromptItemId = it.id;
  const m = document.getElementById('sharePromptModal');
  if (m) { document.getElementById('chkShareRemember').checked = false; m.classList.remove('hidden'); }
}

async function shareRecordToBank(it) {
  if (!it.isbn) return { error: 'no-isbn' };
  const token = apiKeys.ghToken;
  if (!token) throw new Error(LANG === 'en' ? 'GitHub token missing (☰ → 🔑)' : 'Token GitHub manquant (☰ → 🔑)');
  const base = bankBase();
  const m = base && base.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\//);
  const repo = m ? `${m[1]}/${m[2]}` : 'Chenzu-AI/Bibliotheque';
  const clean = sanitizeItemForShare(it);
  const path = `covers/fiches/${clean.isbn}.json`;
  let sha = null;
  try { const cur = await ghApiFor(repo, path); sha = cur.sha; } catch (e) { /* 404: absent */ }
  const body = JSON.stringify({
    message: 'Fiche communautaire — ' + clean.isbn,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(clean, null, 1)))),
    ...(sha ? { sha } : {}),
  });
  await ghApiFor(repo, path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
  return sha ? { updated: true } : { uploaded: true };
}

async function fetchRecordFromBank(isbn) {
  const base = bankBase();
  if (!base) return null;
  const variants = [isbn];
  const alt = isbn.length === 13 ? isbn13to10(isbn) : isbn10to13(isbn);
  if (alt) variants.push(alt);
  for (const v of variants) {
    try {
      const r = await fetchWithTimeout(`${base}/fiches/${v}.json`, 8000);
      if (!r.ok) continue;
      const data = await r.json();
      if (data && data.title) return { ...data, isbn, srcFound: ['Banque de fiches'] };
    } catch {}
  }
  return null;
}

/* ---------- Banque de couvertures : partage ---------- */
function bankBase() { return (apiKeys.bank || '').replace(/\/$/, ''); }

async function shareCoverToBank(isbn, dataUrl) {
  if (!isbn || !dataUrl || !dataUrl.startsWith('data:image')) return { error: 'invalid' };
  const token = apiKeys.ghToken;
  if (!token) throw new Error(LANG === 'en' ? 'GitHub token missing (☰ → 🔑)' : 'Token GitHub manquant (☰ → 🔑)');
  // depot cible : extrait de l'URL de banque (bibliotheque-app = miroir public) sinon depot prive
  const base = bankBase();
  const m = base && base.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\//);
  const repo = m ? `${m[1]}/${m[2]}` : 'Chenzu-AI/Bibliotheque';
  // 1. deja present ? (HEAD via GET contents, silencieux)
  try {
    await ghApiFor(repo, `covers/${isbn}.jpg`);
    return { already: true };
  } catch (e) { /* 404 = absent, on continue */ }
  // 2. upload
  const b64 = dataUrl.split(',')[1];
  await ghApiFor(repo, `covers/${isbn}.jpg`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Banque de couvertures — ' + isbn, content: b64 }),
  });
  return { uploaded: true };
}

async function ghApiFor(repo, path, opts = {}) {
  const token = apiKeys.ghToken;
  if (!token) throw new Error('no token');
  const r = await fetchWithTimeout(`https://api.github.com/repos/${repo}/contents/${path}`, 15000, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...((opts && opts.headers) || {}),
    },
  });
  if (!r.ok) {
    if (r.status === 404) throw new Error('NOT_FOUND');
    throw new Error('HTTP ' + r.status);
  }
  return r.json();
}

/* Partage du fond entier (pro) : deduplique, envoie par lots, reprise possible */
async function shareAllCoversToBank(onProgress) {
  const targets = [];
  for (const [id, dataUrl] of Object.entries(coverStore.data)) {
    const it = store.findById(id);
    if (!it || !it.isbn || !dataUrl || !String(dataUrl).startsWith('data:image')) continue;
    targets.push({ isbn: normalizeIsbn(it.isbn), dataUrl });
  }
  const unique = new Map();
  for (const t of targets) if (!unique.has(t.isbn)) unique.set(t.isbn, t.dataUrl);
  let sent = 0, skipped = 0, total = unique.size;
  for (const [isbn, dataUrl] of unique) {
    try {
      const res = await shareCoverToBank(isbn, dataUrl);
      if (res.uploaded) sent++; else skipped++;
    } catch { skipped++; }
    if (onProgress) onProgress(sent + skipped, total, sent);
    await new Promise((r2) => setTimeout(r2, 700)); // respect des limites API GitHub
  }
  return { sent, skipped, total };
}

function wireCloudBackupUI() {
  const btnPush = document.getElementById('btnCloudPush');
  const btnPull = document.getElementById('btnCloudPull');
  if (btnPush) btnPush.addEventListener('click', async () => {
    if (!confirm(tm('cloud_push_confirm'))) return;
    btnPush.disabled = true;
    try {
      await cloudBackupPush();
      toast(tm('cloud_push_done'), 4000);
    } catch (e) { toast(tm('cloud_fail') + ' ' + e.message, 6000); }
    btnPush.disabled = false;
  });
  if (btnPull) btnPull.addEventListener('click', async () => {
    if (!confirm(tm('cloud_pull_confirm'))) return;
    btnPull.disabled = true;
    try {
      const json = await cloudBackupPull();
      importJsonData(json);
      toast(tm('cloud_pull_done'), 4000);
    } catch (e) {
      if (String(e.message) === 'NOT_FOUND') toast(tm('cloud_pull_empty'), 5000);
      else toast(tm('cloud_fail') + ' ' + e.message, 6000);
    }
    btnPull.disabled = false;
  });
}
wireCloudBackupUI();

$('#btnScatterReport').addEventListener('click', () => runScatterReport());
$('#btnCloseScatterReport').addEventListener('click', () => $('#scatterReportModal').classList.add('hidden'));

$('#btnShareFund').addEventListener('click', async () => {
  const count = Object.values(coverStore.data).filter((d) => String(d).startsWith('data:image')).length;
  if (!count) { toast(tm('share_fund_none'), 5000); return; }
  if (!confirm(tm('share_fund_confirm', count))) return;
  const btn = $('#btnShareFund');
  btn.disabled = true;
  const res = await shareAllCoversToBank((done, total, sent) => {
    btn.textContent = `🤝 ${done}/${total}…`;
  });
  btn.disabled = false;
  btn.textContent = '';
  applyI18n();
  toast(tm('share_fund_done', res.sent, res.skipped), 6000);
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
  item.title = (LANG === 'en' ? 'New book' : 'Nouvel ouvrage');
  applyShelveMode(item);
  store.add(item);
  renderAll();
  openDetail(item.id);
  toast(tm('blank_created'));
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
  // INSERTION avec décalage : si un point d'insertion est défini (ex. @6),
  // les positions >= point se décalent de +1 et le livre scanné prend la position libérée.
  if (shelveMode.insertAt) {
    const curPos = shelveMode.insertAt + (shelveMode.scanned || 0);
    // décaler les fiches existantes de cette étagère dont photoPos >= curPos
    let shifted = 0;
    for (const it2 of store.items) {
      if (it2.id === item.id) continue;
      if (it2.furniture === item.furniture && it2.slot === item.slot && it2.photoPos && it2.photoPos >= curPos) {
        it2.photoPos = it2.photoPos + 1;
        shifted++;
        store.update(it2);
      }
    }
    item.photoPos = curPos;
    shelveMode.scanned = (shelveMode.scanned || 0) + 1;
    saveShelveMode();
    toast(shifted ? tm('shelve_inserted', curPos, shifted) : tm('shelve_inserted_noshift', curPos), 3000);
    return;
  }
  // progression contre l'agencement declare (ex. 26+4p=30)
  if (shelveMode.expected) {
    shelveMode.scanned = (shelveMode.scanned || 0) + 1;
    saveShelveMode();
    if (shelveMode.scanned >= shelveMode.expected) {
      toast(tm('shelve_complete', shelveMode.scanned), 5000);
    } else {
      toast(`${shelveMode.scanned}/${shelveMode.expected} ${LANG === 'en' ? 'scanned on this shelf' : 'scannés sur cette étagère'}`, 1800);
    }
  }
}

$('#btnShelveMode').addEventListener('click', () => {
  if (shelveMode) {
    shelveMode = null;
    saveShelveMode();
    toast(tm('shelve_off'));
    return;
  }
  const furniture = prompt('Meuble à associer aux prochains scans :\n(ex. « Bibliothèque salon », « Meuble 2 »)', knownFurniture()[0] || '');
  if (furniture === null) return;
  const slot = prompt('Étagère / rayon :\n(ex. « Étagère 4 », « Rayon A »)', '');
  if (slot === null) return;
  shelveMode = { furniture: furniture.trim(), slot: slot.trim() };
  saveShelveMode();
  toast(tm('shelve_on'));
});

function stamp() { return todayISO(); }

$('#btnExportJson').addEventListener('click', () => {
  download(`bibliotheque-${stamp()}.json`, exportJsonPayload(), 'application/json');
  toast(tm('exp_json'));
});

$('#btnExportMd').addEventListener('click', () => {
  const lines = [];
  lines.push(`# Ma Bibliothèque`);
  lines.push(`_${store.items.length} ouvrages — ${t('exp_of')} ${new Date().toLocaleDateString('fr-FR')}_`);
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
      if (it.series) meta.push(`**Série :** ${it.series}${it.seriesState === 'ongoing' ? ' *(ongoing series)*' : it.seriesState === 'complete' ? ' *(complete series)*' : ''}`);
      if (it.publisher) meta.push(`**Éditeur :** ${it.publisher}${it.publishedDate ? ` (${it.publishedDate})` : ''}`);
      if (it.isbn) meta.push(`**ISBN :** ${it.isbn}`);
      if (it.pageCount) meta.push(`**Pages :** ${it.pageCount}`);
      meta.push(`**${t('f_status')} :** ${{ unread: t('st_unread'), reading: t('st_reading'), read: t('st_read'), wish: t('st_wish') }[it.status] || it.status}`);
      if (it.dewey) meta.push(`**Cote :** ${it.dewey}`);
      if (it.genre) meta.push(`**Genre :** ${it.genre}`);
      if (it.collection) meta.push(`**Collection :** ${it.collection}`);
      if (it.format) meta.push(`**Format :** ${it.format}`);
      if (it.editionType && it.editionType !== 'standard') meta.push(`**${t('f_edition')} :** ${{ first: t('ed_first'), collector: t('ed_collector'), rare: t('ed_rare'), incunable: t('ed_incunable') }[it.editionType]}`);
      if (it.price) meta.push(`**Prix éditeur :** ${it.price} €`);
      if (it.audience) meta.push(`**Public :** ${it.audience}`);
      if (it.loan) meta.push(`**Prêté à :** ${it.loan.to}${it.loan.due ? ` (retour prévu le ${it.loan.due})` : ''}`);
      if ((it.loanHistory || []).length) meta.push(`**Loan history:** ${it.loanHistory.map((h) => `${h.to} (${h.date}${h.returned ? ` → ${h.returned}` : ' ongoing'})`).join(' ; ')}`);
      if (it.rating) meta.push(`**Note :** ${'★'.repeat(it.rating)}${'☆'.repeat(5 - it.rating)}`);
      if (it.favorite) meta.push('**Favori :** ♥');
      if (it.wishlist) meta.push('**Wishlist:** to buy');
      if (it.location) meta.push(`**${t('f_location')} :** ${it.location}`);
      if (it.tags.length) meta.push(`**Tags :** ${it.tags.join(', ')}`);
      lines.push(meta.join('  \n'));
      if (it.summary) { lines.push(''); lines.push(it.summary.replace(/\n+/g, ' ')); }
      if (it.backCoverText) { lines.push(''); lines.push(it.backCoverText.replace(/\n+/g, ' ')); }
      if (it.notes) { lines.push(''); lines.push(`> ${it.notes.replace(/\n+/g, ' ')}`); }
      lines.push('');
    }
  }
  download(`bibliotheque-${stamp()}.md`, lines.join('\n'), 'text/markdown');
  toast(tm('exp_md'));
});

$('#btnExportCsv').addEventListener('click', () => {
  const cols = ['isbn', 'title', 'subtitle', 'authors', 'medium', 'series', 'volume', 'publisher',
    'publishedDate', 'pageCount', 'status', 'rating', 'tags', 'shelves', 'location', 'notes', 'summary', 'backCoverText', 'dewey', 'genre', 'collection', 'format', 'editionType', 'price', 'audience', 'loanTo', 'loanDue', 'addedAt'];
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(',')];
  for (const it of store.items) {
    const o = { ...it, authors: (it.authors || []).join('; '), tags: (it.tags || []).join('; '), shelves: (it.shelves || []).join('; '),
      loanTo: it.loan ? it.loan.to : '', loanDue: it.loan ? (it.loan.due || '') : '' };
    rows.push(cols.map((c) => q(o[c])).join(','));
  }
  download(`bibliotheque-${stamp()}.csv`, '\ufeff' + rows.join('\r\n'), 'text/csv');
  toast(tm('exp_csv'));
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
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${t('exp_my')} ${t('exp_export')} ${stamp()}</title>
  <style>body{font-family:Segoe UI,sans-serif;background:#f4f2ee;margin:0;padding:20px}
  .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
  .card{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:12px}
  .card img{max-width:100px;border-radius:4px}
  blockquote{font-style:italic;color:#555}</style></head>
  <body><h1>${t('exp_my')} ${store.items.length} ${t('labels_count')}</h1><div class="grid">${cards}</div></body></html>`;
  download(`bibliotheque-${stamp()}.html`, html, 'text/html');
  toast(tm('exp_html'));
});

async function importJsonData(data) {
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
  toast((LANG === 'en' ? `Import: ${added} added, ${merged} merged, ${dupIgnored} identical.` : `Import : ${added} ajouté(s), ${merged} fusionné(s), ${dupIgnored} identique(s).`), 4000);
}

$('#btnImport').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { await importJsonData(JSON.parse(await file.text())); } catch { toast(tm('bad_json')); }
});


/* ---------- Search live ---------- */
['#searchInput', '#sortSelect', '#shelfFilter', '#statusFilter', '#mediumFilter', '#genreFilter'].forEach((s) =>
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
      toast(tm('covers_migrated'));
    }
    return;
  }
  let lsData = {};
  try { lsData = (JSON.parse(localStorage.getItem(COVERS_KEY + '.data')) || {}); } catch {}
  coverStore.data = lsData;
  coverStore.inIdb = false;
}

async function migrateCoversToIdb() {
  if (!coverStore._db) { toast(tm('idb_na')); return false; }
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
  try { localStorage.setItem(COVERS_KEY + '.data', JSON.stringify(coverStore.data)); } catch { toast(tm('storage_migrate')); }
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
  if (!targets.length) { toast(tm('covers_all_done')); return; }
  toast(tm('embarking'));
  for (const it of targets) {
    await embedCover(it);
    done++;
    if (done % 25 === 0) toast(tm('covers_progress', done, targets.length), 1500);
  }
  toast(tm('covers_done', done), 4000);
  renderAll();
}

$('#btnCoversCfg').addEventListener('click', async () => {
  const total = Object.keys(coverStore.data).length;
  const size = Math.round((JSON.stringify(coverStore.data).length) / 1024 / 1024);
  if (!coversCfg.embedded) {
    if (!confirm(tm('covers_confirm'))) return;
    coversCfg.embedded = true;
    saveCoversCfg();
    if (!coverStore.inIdb) await migrateCoversToIdb();
    await embedAllCovers();
  } else {
    const choices = tm('covers_choices', total, size, coverStore.inIdb ? 'IndexedDB' : 'localStorage');
    if (!confirm(choices)) return;
    coversCfg.embedded = false;
    coverStore.data = {};
    saveCoversCfg();
    if (coverStore.inIdb && coverStore._db) await coversDbClear(coverStore._db);
    try { localStorage.removeItem(COVERS_KEY + '.data'); } catch {}
    renderAll();
    toast(tm('covers_removed'));
  }
});

/* ---------- Init ---------- */
if (typeof applyI18n === 'function') applyI18n();
/* Auto-recharge une fois quand le service worker installe une nouvelle version
   (evite les pages figees sur un vieux code apres mise a jour — session par session, jamais en boucle) */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SW-RELOADED' && !sessionStorage.getItem('biblio.reloaded')) {
      try { sessionStorage.setItem('biblio.reloaded', '1'); } catch {}
      location.reload();
    }
  });
}
store.init().then(async () => { await coversInit(); renderAll(); updateShelveUI(); lateLoansReminder(); });
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
    else if (groupMode === 'universe') { keys = [it.universe || (it.series ? '— ' + t('no_universe_group') : '')].filter(Boolean); }
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
  return state === 'ongoing' ? '<span class="series-state ongoing">' + t('series_going2') + '</span>'
       : state === 'complete' ? '<span class="series-state complete">' + t('series_done2') + '</span>' : '';
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
        ? `<div class="missing"><b>${t('g_missing_count')} (${missing.length}/${first.seriesTotal}) :</b> ${chips}</div>`
        : '<div class="missing"><b>' + t('g_complete') + '</b></div>';
    } else if (groupMode === 'series' && vols.length > 1) {
      const gaps = [];
      for (let n = Math.min(...vols); n <= Math.max(...vols); n++) if (!vols.includes(n)) gaps.push(n);
      if (gaps.length) missingHtml = `<div class="missing"><b>${t('g_missing')}</b> ${gaps.map((n) => `<span class="missing-chip">T. ${n} <button data-series="${esc(name)}" data-vol="${n}" title="Ajouter aux souhaits">🛒</button></span>`).join('')}</div>`;
    }
    const volList = items.map((i) => esc(i.volume ? `T.${i.volume}` : i.title)).join(' · ');
    let locHtml = '';
    if (groupMode === 'series') {
      const scatter = seriesScatter(name);
      if (scatter.length > 1) {
        locHtml = `<div class="missing"><b>${t('g_locations')}</b> ${scatter.map((s) => `<span class="missing-chip" style="background:#e3ecf5;border-color:#b8cfe6;color:#2f5d8a">${esc(s.loc)} → ${s.tomes.join(', ')}</span>`).join(' ')}</div>`;
      } else if (scatter.length === 1 && scatter[0].loc !== '—') {
        locHtml = `<div class="missing"><b>${t('g_stored')}</b> ${esc(scatter[0].loc)}</div>`;
      }
    }
    return `<div class="group-card">
      <h3 data-filter="${esc(name)}">${esc(name)} ${state} <span class="hint">(${items.length})</span></h3>
      <button type="button" class="btn btn-danger small group-del" data-group="${esc(name)}" title="${t('group_del_title')}">🗑️ ${t('group_del')}</button>
      <button type="button" class="btn small group-ops" data-group="${esc(name)}" title="${t('group_ops_title')}">⚡</button>
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
    toast((LANG === 'en' ? `“${item.title}” added to wishlist.` : `« ${item.title} » ajouté aux souhaits.`));
  }));

  body.querySelectorAll('.group-ops').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const name = b.dataset.group;
    // appliquer le filtre recherche sur la serie et ouvrir le panneau Actions
    $('#searchInput').value = name;
    switchView('grid');
    renderAll();
    const bar = $('#filterOpsBar');
    bar.classList.remove('hidden');
    const n = refreshFilterOpsCount();
    toast(tm('group_ops_hint', name, n), 5000);
  }));
  body.querySelectorAll('.group-del').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const name = b.dataset.group;
    const inGroup = store.items.filter((i) => [i.series, ...i.authors, ...i.scenario, ...i.art].some((v) => v === name));
    if (!inGroup.length) return;
    if (!confirm(tm('group_del_confirm', name, inGroup.length))) return;
    let n = 0;
    for (const it of inGroup) { store.remove(it.id); n++; }
    toast(tm('bulk_delete_done', n), 3500);
    renderAll();
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
  if (c.shelf) parts.push((LANG === 'en' ? 'shelf ' : 'étagère ') + c.shelf);
  if (c.status) parts.push({ unread: t('st_unread2'), reading: t('st_reading2'), read: t('st_read2'), wish: t('st_wish2') }[c.status] || c.status);
  if (c.favOnly) parts.push(t('s_favs').toLowerCase());
  return parts.join(' + ') || t('all_collection');
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
    body.innerHTML = '<p class="hint">' + t('lists_empty') + '</p>';
    return;
  }
  body.innerHTML = store.lists.map((l, idx) => {
    const items = applyCriteria(l.criteria);
    return `<div class="list-card">
      <div>
        <span class="name">${esc(l.name)}</span>
        <div class="crit">${esc(criteriaLabel(l.criteria))} — ${items.length} ${t('lists_count')}</div>
      </div>
      <div>
        <button class="btn small" data-open="${idx}">${t('r_open')}</button>
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
    const lines = [t('csv_header')]
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
  toast(tm('list_saved'));
});

/* ---------- Loans (prêts) ---------- */
function renderLoans() {
  const body = $('#loanBody');
  if (!body) return;
  const loaned = store.items.filter((i) => i.loan);
  if (!loaned.length) {
    body.innerHTML = '<p class="hint">' + t('no_loans') + '</p>';
    return;
  }
  const today = todayISO();
  body.innerHTML = loaned.map((it) => {
    const late = it.loan.due && it.loan.due < today;
    return `<div class="list-card" style="${late ? 'border-color:#dc2626' : ''}">
      <div>
        <span class="name">${esc(it.title)}</span>
        <div class="crit">${t('loaned_to')} <b>${esc(it.loan.to)}</b> — ${t('since')} ${esc(it.loan.date)}${it.loan.due ? ` · ${t('due_back')} ${esc(it.loan.due)}` : ''}${late ? ` <b style="color:#dc2626">⚠ ${t('s_late').toUpperCase()}</b>` : ''}</div>
      </div>
      <div>
        <button class="btn small" data-open-item="${esc(it.id)}">${t('rec_btn')}</button>
        <button class="btn small btn-primary" data-return="${esc(it.id)}">${t('btn_return')}</button>
      </div>
    </div>`;
  }).join('');
  body.querySelectorAll('[data-open-item]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.openItem)));
  body.querySelectorAll('[data-return]').forEach((b) => b.addEventListener('click', () => {
    const it = store.findById(b.dataset.return);
    if (!it) return;
    if (!confirm((LANG === 'en' ? `“${it.title}” returned by ${it.loan.to}?` : `« ${it.title} » rendu par ${it.loan.to} ?`))) return;
    it.loan = null;
    store.update(it);
    renderAll();
    toast(tm('returned'));
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
    body.innerHTML = '<p class="hint">' + t('loans_empty') + '</p>';
    return;
  }
  const today = todayISO();
  body.innerHTML = [...hist.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([who, loans]) => {
    const current = loans.filter((l) => !l.returned);
    const past = loans.filter((l) => l.returned);
    const late = current.filter((l) => l.due && l.due < today);
    return `<div class="group-card">
      <h3>${esc(who)} <span class="hint">(${loans.length} ${loans.length > 1 ? t('l_loans_pl') : t('l_loan_one')})</span>${late.length ? '<span class="series-state ongoing">⚠ ' + late.length + ' ' + t('s_late') + '</span>' : ''}</h3>
      ${current.length ? `<div class="vols"><b>${t('ongoing')}</b> ${current.map((l) => `${esc(l.title)} (${t('since')} ${esc(l.date)}${l.due ? `, ${t('due_back')} ${esc(l.due)}` : ''})`).join(' · ')}</div>` : ''}
      ${past.length ? `<div class="vols"><b>' + (LANG === 'en' ? 'Returned:' : 'Rendus :') + '</b> ${past.map((l) => `${esc(l.title)} (${esc(l.date)} → ${esc(l.returned)})`).join(' · ')}</div>` : ''}
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
  if (!text) throw new Error(LANG === 'en' ? 'empty response' : 'réponse vide');
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
    { unread: t('st_unread'), reading: t('st_reading'), read: t('st_read'), wish: t('st_wish') }[i.status] || i.status,
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

/* Complete une fiche par IA en deux temps:
   1. L'IA deduit l'ISBN (ou l'ISBN-10) a partir du titre/auteur/editeur/tome
   2. La chaine de sources complete (BnF, Google Books, Open Library, relais, banques) prend le relais
      — les vraies donnees catalogues valent mieux que la memoire de l'IA
   3. L'IA ne genere que ce que les sources ne donnent pas: resume, genre, Dewey */
/* Domaines des editeurs frequents -> bouton "page editeur" dans la fiche
   (recherche Google site: ciblee — methode universelle legale, aucun scraping, l'utilisateur voit la page officielle) */
const PUBLISHER_DOMAINS = {
  rustica: 'rusticaeditions.com',
  hachette: 'hachette-pratique.com',
  larousse: 'editions-larousse.fr',
  glenat: 'glenat.com',
  dargaud: 'dargaud.com',
  dupuis: 'dupuis.com',
  delcourt: 'editions-delcourt.fr',
  casterman: 'casterman.com',
  futuropolis: 'futuropolis.fr',
  lelombard: 'lelombard.com',
  soleil: 'soleilprod.com',
  fluide: 'fluideglacial.com',
  pika: 'pika.fr',
  kana: 'kana.fr',
  kurokawa: 'kurokawa.fr',
  "ki-oon": 'ki-oon.com',
  akata: 'akata.fr',
  gallimard: 'gallimard.fr',
  flammarion: 'editions.flammarion.com',
  albin: 'albin-michel.fr',
  seuil: 'seuil.com',
  grasset: 'grasset.fr',
  stock: 'editions-stock.fr',
  fayard: 'fayard.fr',
  laffont: 'laffont.fr',
  marabout: 'marabout.com',
  michel: 'michel-lafon.fr',
  hugo: 'hugoetcompagnie.com',
  brague: 'bragelonne.fr',
};

function publisherDomain(publisher) {
  if (!publisher) return '';
  const p = String(publisher).toLowerCase();
  for (const [key, domain] of Object.entries(PUBLISHER_DOMAINS)) {
    if (p.includes(key)) return domain;
  }
  return '';
}

/* Collections editoriales FR reelles (liste blanche anti-hallucination IA) */
/* Univers/cycles narratifs connus (liste blanche anti-hallucination IA) — s'enrichit avec le fonds reel */
const KNOWN_UNIVERSES = ['Cycle des Robots', 'Cycle de Fondation', "Univers d'Asimov", 'Aldébaran', 'Bételgeuse', 'Antares', 'Lou !', 'Seuls', 'Astérix', 'Lucky Luke', 'Thorgal', 'Le Monde de Narnia', 'Terre du Milieu', 'Univers étendu Star Wars', 'Marvel', 'DC', 'Univers de Dune', 'Hypérion', 'Culture', 'Disque-monde', 'Harry Potter', 'Witcher', 'Le Trône de fer', 'Univers Lovecraft'];

const KNOWN_COLLECTIONS = ['Folio', 'Folio Poche', 'Folio 2€', 'Folio Junior', 'Le Livre de Poche', 'Pocket', 'Presses Pocket', 'Presses Pocket Croisés', 'Points', 'Points Seuil', 'Points Essais', 'Points Roman', 'Points Histoire', 'Champs', 'Champs Flammarion', 'Champs Sciences', 'Que sais-je ?', 'Simplissime', 'Pour les Nuls', 'Grand Livre du Mois', 'Marabout', 'Marabout Service', 'J\u0027ai lu', 'J\u0027ai lu Roman', 'GF', 'GF Flammarion', 'Tel', 'Tel Gallimard', 'Bibliothèque des sciences humaines', 'La Découverte/Poche', 'Le Seuil Points', 'L\u0027Imaginaire', 'Folio Policier', 'Folio Thriller', 'Rivages Poche', 'Le Livre de Poche Policier', 'Biblio Essais', 'Le Passeur', '10/18', 'Domaine Français', 'Étonnants Classiques', 'Classiques Garnier', 'Bibliothèque verte', 'Bibliothèque rose', 'Le Livre de Poche Jeunesse', 'Poesie/', 'Poésie Gallimard', 'Folio Sagesses', 'Folio Actuel', 'Mille et une nuits', 'Zulma Poche', 'Sabine Wespieser', '10/18 | Domaine étranger', 'Harper Torch', 'Hors série Connaissance', 'Les Essentiels', 'First', 'L\u0027Archipel', 'J\u0027ai lu pour elle', 'Harlequin', 'Tallandier', 'Taillandier Histoire', 'Perrin', 'Plon', 'Presses de la Cité', 'Belfond', 'Rivages', 'Actes Sud', 'Babel', 'Actes Sud Babel', 'Casterman', 'Dargaud', 'Fleuve Noir', 'Milady', 'Harlequin HQN', 'Mosaïque', 'Solar', 'Pour la Science', 'Belin Poche', 'Ophrys', 'Armand Colin', 'PUF Poche', 'Que sais-je', 'Repères', 'Cursus', '128', 'Sup', 'U', 'Poches Aide', '128 | Que sais-je?', 'L\u0027Aube Poche', 'Pocket | Terre', 'Biblio Romans', 'Folio Gallimard', 'Gallimard Poche', 'J\u0027ai lu | Bibliothèque', 'Le Masque', 'L\u0027Aube', 'Le Grand Livre du Mois', 'Ej | Rouergue', 'La Table Ronde', 'Petite Vermillon', 'Petite Pléiade', 'Les petits précieux Rustica', 'Les petits précieux', 'Simplessime', 'Terre & Passions', 'Rustica Docs', 'Le Chêne', 'Du Chêne', 'Grandes découvertes Gallimard', 'Découvertes Gallimard', 'Découvertes Gallimard Poche', 'Que sais-je ? PUF'];

async function aiFillItem(id) {
  const it = store.findById(id);
  if (!it) return {};
  const changed = [];

  // --- Etape 0: VERIFIER ET CORRIGER les champs mal remplis (auteur dans le titre, serie/collection absentes...) ---
  // Suspect si: le titre contient un mot genre "Simplissime"/"Folio" (collection), ou un nom d'auteur colle au titre
  const suspicious = (it.title && (/[|] efficace| : l'essentiel|pour les nuls/i.test(it.title) || /^(Folio|Points|GF|Tel) /i.test(it.title) || it.title.split(' ').length > 7));
  const missingSerie = !it.series && !it.collection && it.title;
  if ((suspicious || missingSerie) && it.title && !String(it.title).startsWith('ISBN ')) {
    try {
      const sys = `Tu nettoies des fiches de bibliothèque françaises mal remplies. Renvoie UNIQUEMENT un JSON avec les champs corrigés (chaîne vide si inchangé):
{"title": "titre NETTOYÉ sans l'auteur ni la collection", "authors": ["auteur extrait du titre si présent"], "series": "série d'œuvres", "universe": "univers/cycle narratif si connu (ex: Cycle des Robots, Univers d'Asimov, monde de Bételgeuse) — chaîne vide sinon", "collection": "collection éditoriale (Simplissime, Folio, Que sais-je ?, Le Livre de Poche, Pocket…)", "volume": "numéro de tome si présent"}
Exemples: "Simplissime Les plantes qui soignent Danièle Fest simple" -> title:"Les plantes qui soignent", collection:"Simplissime", authors:["Danièle Fest"].
"Le Petit Prince Folio Saint-Exupéry" -> title:"Le Petit Prince", collection:"Folio", authors:["Saint-Exupéry"].`;
      const user = `Fiche actuelle:\nTitre: ${it.title}\nAuteurs: ${(it.authors || []).join(', ') || '(vide)'}\nSérie: ${it.series || '(vide)'}\nCollection: ${it.collection || '(vide)'}\nÉditeur: ${it.publisher || ''}`;
      const resp = await aiChat(sys, user, 300);
      const m = resp.match(/\{[\s\S]*\}/);
      if (m) {
        const data = JSON.parse(m[0]);
        // appliquer uniquement les corrections CREDIBLES (ne pas casser une fiche saine)
        if (data.title && data.title.length > 2 && data.title.length < (it.title || '').length && !/[|]/.test(data.title)) {
          // le titre corrigé doit être plus court (on a retiré du bruit) et rester lisible
          it.title = data.title; changed.push('title');
        }
        if (Array.isArray(data.authors) && data.authors.length && !(it.authors || []).length) { it.authors = data.authors; changed.push('authors'); }
        if (data.series && !it.series) { it.series = data.series; changed.push('series'); }
        // Garde anti-hallucination: la collection proposee doit etre une collection REELLE connue
        if (data.collection && !it.collection && KNOWN_COLLECTIONS.includes(String(data.collection).trim())) { it.collection = String(data.collection).trim(); changed.push('collection'); }
        if (data.volume && !it.volume) { it.volume = String(data.volume); changed.push('volume'); }
        if (data.universe && !it.universe && KNOWN_UNIVERSES.some((u) => u.toLowerCase() === String(data.universe).trim().toLowerCase())) { it.universe = String(data.universe).trim(); changed.push('universe'); }
      }
    } catch (e0) { (window.__aiSteps = window.__aiSteps || []).push('nettoyage: ' + (e0 && e0.message)); }
  }

  // --- Etape 1: chercher un ISBN si absent (l'IA est bonne a ce deduction logique) ---
  if (!it.isbn && it.title && !String(it.title).startsWith('ISBN ')) {
    try {
      const sys = 'Tu identifies des livres. Renvoie UNIQUEMENT un JSON: {"isbn": "EAN-13 ou ISBN-13 du livre decrit", "isbn10": "ISBN-10 si connu", "publisher": "editeur", "publishedDate": "annee", "authors": ["auteurs"], "series": "serie", "volume": "tome"}. Si incertain, chaîne vide.';
      const user = `Titre: ${it.title}${it.subtitle ? ' — ' + it.subtitle : ''}\n${(it.authors || []).length ? 'Auteurs: ' + it.authors.join(', ') : ''}\n${it.publisher ? 'Éditeur: ' + it.publisher : ''}\n${it.publishedDate ? 'Année: ' + it.publishedDate : ''}\n${it.series ? 'Série: ' + it.series + (it.volume ? ' tome ' + it.volume : '') : ''}\nType: ${it.medium || 'livre'}`;
      const resp = await aiChat(sys, user, 300);
      const m = resp.match(/\{[\s\S]*\}/);
      if (m) {
        const data = JSON.parse(m[0]);
        const isbn13 = normalizeIsbn(String(data.isbn || ''));
        if (isbn13 && /^\d{13}$/.test(isbn13)) {
          // Valider par les sources AVANT d'ecrire: si les catalogles connaissent cet ISBN, c'est le bon
          // Anti-doublon: si une AUTRE fiche a deja cet ISBN, c'est un doublon — fusionner dans l'existante et supprimer la vierge
          const dup = store.items.find((x) => x.id !== it.id && x.isbn === isbn13);
          if (dup) {
            // completer la fiche existante avec l'emplacement de la vierge (elle vient d'etre rangee par la photo)
            if (it.furniture && !dup.furniture) { dup.furniture = it.furniture; dup.slot = it.slot; dup.location = it.location; }
            for (const [k, v] of Object.entries(it)) {
              const cur = dup[k];
              const empty = cur === '' || cur === null || cur === undefined || (Array.isArray(cur) && !cur.length);
              if (empty && v && k !== 'id' && !['furniture', 'slot', 'location', 'addedAt'].includes(k)) dup[k] = v;
            }
            store.update(dup);
            store.remove(it.id);
            return { changed: ['merged'], mergedInto: dup.id };
          }
          const meta = await fetchMetadataSmart(isbn13);
          if (meta && meta.title) {
            for (const [k, v] of Object.entries(meta)) {
              const cur = it[k];
              const empty = cur === '' || cur === null || cur === undefined || (Array.isArray(cur) && !cur.length);
              if (empty && v && !(Array.isArray(v) && !v.length)) { it[k] = v; changed.push(k); }
            }
            changed.push('isbn');
            it.srcFound = [...new Set([...(it.srcFound || []), ...(meta.srcFound || []), 'IA (ISBN)'])];
          } else {
            // ISBN IA non confirme: garder les infos IA dediées mais sans ISBN (source non fiable seule)
            if (data.publisher && !it.publisher) { it.publisher = String(data.publisher); changed.push('publisher'); }
            if (data.publishedDate && !it.publishedDate) { it.publishedDate = String(data.publishedDate); changed.push('publishedDate'); }
          }
        }
      }
    } catch (e1) { (window.__aiSteps = window.__aiSteps || []).push('ISBN: ' + (e1 && e1.message)); }
  }

  // --- Etape 1bis: si ISBN present, rafraichir depuis les sources (comme le bouton Mettre a jour) ---
  if (it.isbn) {
    const res = await refreshRecordFromSources(it);
    for (let i = 0; i < res.changed; i++) changed.push('src');
  }

  // --- Etape 2: generer ce que les sources ne donnent pas (resume FR, genre, Dewey) ---
  const needAi = !it.summary || !it.genre || !it.dewey;
  if (needAi) {
    const sys = `Tu complètes des fiches de bibliothèque${it.isbn ? '' : ' (sans ISBN — base-toi sur le titre et l\'auteur)'}. Renvoie UNIQUEMENT un objet JSON avec les champs: {"summary": "résumé en 3-4 phrases", "genre": "genre", "dewey": "cote Dewey comme 843 ou 741.5"}. Pas d'autre texte.`;
    const user = `Titre: ${it.title}${it.subtitle ? ' — ' + it.subtitle : ''}\nAuteurs: ${(it.authors || []).join(', ')}\nÉditeur: ${it.publisher}\nAnnée: ${it.publishedDate}\nType: ${it.medium}`;
    const resp = await aiChat(sys, user, 400);
    const m = resp.match(/\{[\s\S]*\}/);
    if (m) {
      const data = JSON.parse(m[0]);
      if (data.summary && !it.summary) { it.summary = String(data.summary); changed.push('summary'); }
      if (data.genre && !it.genre) { it.genre = String(data.genre); changed.push('genre'); }
      if (data.dewey && !it.dewey) { it.dewey = String(data.dewey).replace(',', '.').trim(); changed.push('dewey'); }
    }
  }
  store.update(it);
  return { changed };
}

/* ---------- UI ---------- */
$('#btnAiCfg').addEventListener('click', async () => {
  const prov = prompt(LANG === 'en' ? 'AI provider:\n- "api": Mistral/OpenAI-compatible service (key required)\n- "ollama": local model (free, no key needed)\n\nYour choice (api or ollama):' : 'Fournisseur IA :\n- "api" : service compatible Mistral/OpenAI (clé requise)\n- "ollama" : modèle local (gratuit, clé non requise)\n\nVotre choix (api ou ollama) :', aiCfg.provider);
  if (!prov) return;
  const provider = prov.trim().toLowerCase() === 'ollama' ? 'ollama' : 'api';
  let url = aiCfg.url, model = aiCfg.model, key = aiCfg.key;
  if (provider === 'ollama') {
    url = prompt(LANG === 'en' ? 'Ollama URL:' : 'URL Ollama :', url === 'https://api.mistral.ai/v1' ? 'http://localhost:11434' : url) || 'http://localhost:11434';
    model = prompt(LANG === 'en' ? 'Local model (e.g. llama3, mistral, qwen2.5):' : 'Modèle local (ex. llama3, mistral, qwen2.5) :', model && model !== 'mistral-small-latest' ? model : 'llama3') || 'llama3';
  } else {
    url = prompt(LANG === 'en' ? 'API URL:' : 'URL de l’API :', url && url !== 'http://localhost:11434' ? url : 'https://api.mistral.ai/v1') || 'https://api.mistral.ai/v1';
    model = prompt(LANG === 'en' ? 'Model (e.g. mistral-small-latest):' : 'Modèle (ex. mistral-small-latest) :', model === 'llama3' ? 'mistral-small-latest' : model) || 'mistral-small-latest';
    key = prompt(LANG === 'en' ? 'API key (stored only in this browser):' : 'Clé API (stockée uniquement dans ce navigateur) :', key) || '';
  }
  aiCfg = { provider, url, model, key };
  saveAiCfg();
  toast(provider === 'ollama' ? (LANG === 'en' ? 'Local AI configured (Ollama).' : 'IA locale configurée (Ollama).') : (LANG === 'en' ? 'API AI configured.' : 'IA par API configurée.'));
});

$('#btnAiRun').addEventListener('click', async () => {
  const q = $('#aiQuery').value.trim();
  if (!q) return;
  if (!aiCfg.key && aiCfg.provider !== 'ollama') { toast(tm('ai_first_key'), 4000); return; }
  $('#aiResult').textContent = (LANG === 'en' ? 'AI search in progress…' : 'Recherche IA en cours…');
  $('#aiResultGrid').innerHTML = '';
  try {
    const { items } = await aiSearch(q);
    $('#aiResult').textContent = items.length ? `${items.length} ${t('ai_found')}` : t('ai_none');
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
    $('#aiResult').textContent = (LANG === 'en' ? 'AI error: ' : 'Erreur IA : ') + e.message + (aiCfg.provider === 'ollama' ? (LANG === 'en' ? ' — check that Ollama is running (ollama serve).' : ' — vérifiez qu’Ollama tourne (ollama serve).') : (LANG === 'en' ? ' — check key/URL/model.' : ' — vérifiez clé/URL/modèle.'));
  }
});

$('#btnCloseAi').addEventListener('click', () => $('#aiModal').classList.add('hidden'));

/* Expose an entry point: open modal */
$('#btnAiOpen') && $('#btnAiOpen').addEventListener('click', () => { $('#mainNav').classList.add('hidden'); $('#aiModal').classList.remove('hidden'); });

window.__ai = { getCfg: () => aiCfg, setCfg: (c) => { aiCfg = { ...aiCfg, ...c }; saveAiCfg(); }, aiSearch, aiFillItem };

/* ---------- CSV import (from Libib / CLZ / Excel) ---------- */
$('#btnImportCsv').addEventListener('click', () => $('#importCsvFile').click());
$('#importCsvFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) { toast(tm('csv_empty')); return; }
    const sep = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';
    const heads = lines[0].split(sep).map((h) => h.replace(/"/g, '').trim().toLowerCase());
    const findCol = (names) => heads.findIndex((h) => names.some((n) => h.includes(n)));
    const cIsbn = findCol(['isbn13', 'isbn']);
    const cTitle = findCol(['titre', 'title']);
    const cAuthors = findCol(['auteur', 'author']);
    const cStatus = findCol(['statut', 'status']);
    if (cTitle < 0) { toast(tm('csv_no_title')); return; }
    let added = 0, skipped = 0;
    for (const line of lines.slice(1)) {
      const cells = line.split(sep).map((c) => c.replace(/^"|"$/g, '').trim());
      const title = cells[cTitle];
      if (!title) { skipped++; continue; }
      const isbn = cIsbn >= 0 ? normalizeIsbn(cells[cIsbn]) : '';
      if (isbn && store.items.some((i) => i.isbn === isbn && i.title === title)) { skipped++; continue; }
      const item = blankItem(isbn);
      item.title = title;
      if (cAuthors >= 0) item.authors = cells[cAuthors].split(/[,;/]/).map((a) => a.trim()).filter(Boolean);
      if (cStatus >= 0) {
        const st = cells[cStatus].toLowerCase();
        if (/lus?|read|fini/.test(st)) { item.status = 'read'; item.readFinish = todayISO(); }
        else if (/cours|reading|en cours/.test(st)) item.status = 'reading';
        else if (/souhait|wish|acheter/.test(st)) { item.status = 'wish'; item.wishlist = true; }
      }
      store.items.push(item);
      added++;
    }
    store.save();
    renderAll();
    toast((LANG === 'en' ? `CSV import: ${added} added, ${skipped} skipped.` : `Import CSV : ${added} ajouté(s), ${skipped} ignoré(s).`), 4000);
  } catch (err) { toast(tm('err_csv') +  + err.message, 4000); }
});

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

/* Supprimer tous les ouvrages d'un emplacement (meuble/etagere) */
function deleteLocationBooks(loc) {
  const inLoc = store.items.filter((i) => [i.location, [i.furniture, i.slot].filter(Boolean).join(' · ')].includes(loc));
  if (!inLoc.length) { toast(tm('loc_empty')); return false; }
  if (!confirm(tm('loc_del_confirm', loc, inLoc.length))) return false;
  let n = 0;
  for (const it of inLoc) { store.remove(it.id); n++; }
  toast(tm('bulk_delete_done', n), 3500);
  scheduleAutoSync();
  renderAll();
  return true;
}

function renderInventoryLocations() {
  const sel = $('#invLocation');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">' + t('g_select') + '</option>' +
    locationsList().map(([loc, items]) => `<option value="${esc(loc)}">${esc(loc)} (${items.length} ${t('lists_count')})</option>`).join('');
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
    invFeedLine(`<div class="inv-line miss">❓ <b>${esc(isbn)}</b> — ${t('inv_unknown')} <button class="btn small inv-add" data-isbn="${esc(isbn)}">${t('inv_integrate')}</button></div>`);
  } else {
    const there = found.filter((i) => (locationOf(i) || '') === loc);
    if (there.length) {
      invSession.seen.add(there[0].id);
      invFeedLine(`<div class="inv-line ok">✅ <b>${esc(there[0].title)}</b> — ${t('inv_ok')}</div>`);
    } else {
      invSession.intruders.push(found[0].id);
      invFeedLine(`<div class="inv-line warn">⚠ <b>${esc(found[0].title)}</b> — ${t('inv_supposed')} « ${esc(locationOf(found[0]) || t('inv_unknown_loc'))} ». <button class="btn small inv-move" data-id="${esc(found[0].id)}">📦 ${t('inv_shelve_here')}</button></div>`);
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
  if (!hist.length) { body.innerHTML = '<p class="hint">' + t('inv_none') + '</p>'; return; }
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
    <h3>${t('inv_missing')} (${missing.length})</h3>
    <p class="hint">${t('inv_here_hint')} ${LANG === 'en' ? 'Check whether they are out, loaned, or elsewhere.' : 'Vérifiez s\'ils sont sortis, prêtés, ou ailleurs.'}</p>
    ${missing.map((i) => `<div class="inv-line miss">📕 <b>${esc(i.title)}</b>${i.loan ? ' — 📤 ' + t('loaned_to') + ' ' + esc(i.loan.to) : ''}${i.wishlist ? ' — 🛒 ' + (LANG === 'en' ? 'wishlist, not purchased yet' : 'souhait, pas encore acheté') : ''}</div>`).join('')}` : '<h3>✅ ' + (LANG === 'en' ? 'Nothing missing' : 'Rien de manquant') + '</h3>';
  const intrudersHtml = invSession.intruders.length ? `
    <h3>⚠ ${t('inv_intruders')} (${invSession.intruders.length})</h3>
    <p class="hint">${LANG === 'en' ? 'Scanned here but supposed to be shelved elsewhere (kept here if you clicked "Shelve it here").' : 'Scannés ici mais censés être rangés ailleurs (rangés ici si vous avez cliqué « Le ranger ici »).'}</p>` : '';
  const unknownHtml = invSession.unknown.length ? `
    <h3>❓ ${t('inv_unknowns')} (${invSession.unknown.length})</h3>
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
  toast(tm('inv_done'));
  renderInventoryLocations();
  renderInvHistory();
}

$('#btnInvStart').addEventListener('click', () => {
  const loc = $('#invLocation').value;
  if (!loc) { toast(tm('shelve_pick_loc')); return; }
  const expected = store.items.filter((i) => (locationOf(i) || '') === loc && !i.wishlist);
  invSession = { loc, expected, seen: new Set(), intruders: [], unknown: [], count: 0 };
  $('#invFeed').innerHTML = '';
  $('#invResult').innerHTML = '';
  $('#invPanel').classList.remove('hidden');
  updateInvProgress();
  toast(`Inventaire de « ${loc} » démarré — ${expected.length} ${t('inv_started')}`, 4000);
  if (expected.length && confirm(tm('inv_camera'))) startScan();
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
      invFeedLine(`<div class="inv-line ok">✅ <b>${esc(item.title || isbn)}</b> — ${t('inv_integrated')}</div>`);
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
      invFeedLine(`<div class="inv-line ok">✅ <b>${esc(it.title)}</b> — ${t('inv_now')}</div>`);
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
  if (!items.length) { toast(tm('no_labels')); return; }
  const withLoc = items.filter((i) => i.dewey || i.location);
  if (!withLoc.length) { toast(tm('no_dewey'), 4500); return; }
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
  if (!win) { toast(tm('allow_popups_print')); return; }
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${t('labels_title')} — ' + (LANG === 'en' ? 'My Library' : 'Ma Bibliothèque') + '</title>
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
  <h1>${t('labels_title')} — ${sorted.length} ${t('labels_count')}</h1>
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
  sel.innerHTML = '<option value="">' + t('g_shelf') + '</option>' + store.shelves.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.value = cur;
}

/* Actions sur le filtre courant (recherche, serie, etagere, statut...)
   Si une selection ☑ est en cours, elle PRIME sur le filtre (agir sur les livres cochés) */
function filterOpsItems() {
  const filtered = currentFilter();
  if (typeof bulkMode !== 'undefined' && bulkMode && bulkSel.size > 0) {
    const ids = new Set(bulkSel);
    return filtered.filter((i) => ids.has(i.id));
  }
  return filtered;
}

$('#ctxFilterOps').addEventListener('click', () => $('#btnFilterOps').click());
$('#ctxBulkMode').addEventListener('click', () => $('#btnBulkMode').click());
$('#ctxClear').addEventListener('click', () => {
  $('#searchInput').value = '';
  $('#shelfFilter').value = '';
  $('#statusFilter').value = '';
  if ($('#mediumFilter')) $('#mediumFilter').value = '';
  $('#favOnly').checked = false;
  renderAll();
});

$('#btnFilterOps').addEventListener('click', () => {
  const bar = $('#filterOpsBar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) {
    refreshFilterOpsCount();
  }
});

/* Met a jour le compteur du panneau (selection ou affichage) */
function refreshFilterOpsCount() {
  const n = filterOpsItems().length;
  const sel = typeof bulkMode !== 'undefined' && bulkMode && bulkSel.size > 0;
  $('#filterOpsCount').textContent = n + (sel ? (LANG === 'en' ? ' selected' : ' sélectionnés') : (LANG === 'en' ? ' shown' : ' affichés'));
  return n;
}

$('#btnFilterOpsClose').addEventListener('click', () => $('#filterOpsBar').classList.add('hidden'));

$('#btnFilterSelectAll').addEventListener('click', () => {
  if (!bulkMode) $('#btnBulkMode').click();
  const items = filterOpsItems();
  for (const it of items) bulkSel.add(it.id);
  $('#bulkCount').textContent = bulkSel.size + (LANG === 'en' ? ' selected' : ' sélectionné(s)');
  renderAll();
  toast(tm('filter_selected', items.length), 3500);
});

$('#btnFilterRefresh').addEventListener('click', async () => {
  const items = filterOpsItems().filter((i) => i.isbn || (i.title && !String(i.title).startsWith('ISBN ')));
  if (!items.length) { toast(tm('filter_none_refresh'), 4000); return; }
  const btn = $('#btnFilterRefresh');
  btn.disabled = true;
  let done = 0, changed = 0, merged = 0;
  for (const it of items) {
    btn.textContent = `🔄 ${++done}/${items.length}…`;
    try {
      const res = await refreshRecordFromSources(it);
      if (res && res.mergedInto) { store.remove(it.id); merged++; }
      else changed += (res.changed || 0);
    } catch {}
    await new Promise((r) => setTimeout(r, 800));
  }
  btn.disabled = false;
  btn.textContent = '';
  btn.textContent = '🔄 ' + (LANG === 'en' ? 'Update (sources)' : 'Mettre à jour (sources)');
  renderAll();
  autoBackupTick();
  toast(tm('filter_refresh_done', changed, merged), 6000);
});

$('#btnFilterAiComplete').addEventListener('click', async () => {
  if (!aiCfg.key && aiCfg.provider !== 'ollama') { toast(tm('ai_first'), 4000); return; }
  const items = filterOpsItems().filter((i) => !i.summary || !i.genre || !i.dewey || !i.isbn);
  if (!items.length) { toast(tm('ai_nothing'), 4000); return; }
  const btn = $('#btnFilterAiComplete');
  btn.disabled = true;
  let done = 0, fills = 0, merged = 0;
  for (const it of items) {
    btn.textContent = `🤝 ${++done}/${items.length}…`;
    try {
      const res = await aiFillItem(it.id);
      if (res && res.mergedInto) merged++;
      else fills += (res && res.changed ? res.changed.length : 0);
    } catch {}
    renderAll();
    await new Promise((r) => setTimeout(r, 600));
  }
  btn.disabled = false;
  btn.textContent = '🤝 ' + (LANG === 'en' ? 'Complete with AI' : 'Compléter par IA');
  renderAll();
  autoBackupTick();
  toast(tm('filter_ai_done', fills, merged), 6000);
});

$('#btnFilterDiag').addEventListener('click', async () => {
  const items = filterOpsItems().filter((i) => i.isbn);
  if (!items.length) { toast(tm('filter_none_diag'), 4000); return; }
  const btn = $('#btnFilterDiag');
  btn.disabled = true;
  let done = 0, found = 0;
  const report = [];
  for (const it of items) {
    btn.textContent = `🔍 ${++done}/${items.length}…`;
    try {
      const isbn = normalizeIsbn(it.isbn);
      const [gb, bnf] = await Promise.all([fetchGoogleBooks(isbn).catch(() => null), fetchBnf(isbn).catch(() => null)]);
      const n = (gb ? 1 : 0) + (bnf ? 1 : 0);
      found += n;
      report.push(`${n}/${2} ${it.title.slice(0, 30)}`);
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  btn.disabled = false;
  btn.textContent = '🔍 ' + (LANG === 'en' ? 'Diagnose' : 'Diagnostiquer');
  const full = report.filter((r) => r.startsWith('2/')).length;
  const empty = report.filter((r) => r.startsWith('0/')).length;
  toast(tm('filter_diag_done', items.length, full, empty), 7000);
});

$('#btnFilterShareCover').addEventListener('click', async () => {
  if (!apiKeys.ghToken) { toast(tm('cloud_need_token'), 5000); return; }
  const items = filterOpsItems().filter((i) => i.isbn && (coverStore.data[i.id] || (i.cover && String(i.cover).startsWith('data:image'))));
  if (!items.length) { toast(tm('share_need_embedded'), 5000); return; }
  const btn = $('#btnFilterShareCover');
  btn.disabled = true;
  let done = 0, sent = 0, already = 0;
  for (const it of items) {
    btn.textContent = `🖼️ ${++done}/${items.length}…`;
    try {
      const src = coverStore.data[it.id] || it.cover;
      const res = await shareCoverToBank(normalizeIsbn(it.isbn), src);
      if (res.uploaded) sent++; else already++;
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
  }
  btn.disabled = false;
  btn.textContent = '🖼️ ' + (LANG === 'en' ? 'Share covers' : 'Partager couvertures');
  toast(tm('filter_share_done', sent, already), 6000);
});

$('#btnFilterShareRecord').addEventListener('click', async () => {
  if (!apiKeys.ghToken) { toast(tm('cloud_need_token'), 5000); return; }
  const items = filterOpsItems().filter((i) => i.isbn && i.title && !String(i.title).startsWith('ISBN '));
  if (!items.length) { toast(tm('share_record_empty'), 5000); return; }
  const btn = $('#btnFilterShareRecord');
  btn.disabled = true;
  let done = 0, sent = 0, upd = 0;
  for (const it of items) {
    btn.textContent = `📝 ${++done}/${items.length}…`;
    try {
      const res = await shareRecordToBank(it);
      if (res.uploaded) sent++; else if (res.updated) upd++;
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
  }
  btn.disabled = false;
  btn.textContent = '📝 ' + (LANG === 'en' ? 'Share records' : 'Partager fiches');
  toast(tm('filter_share_record_done', sent + upd, upd), 6000);
});

$('#btnFilterDelete').addEventListener('click', () => {
  const items = filterOpsItems();
  if (!items.length) { toast(tm('filter_none'), 4000); return; }
  const sample = items.slice(0, 3).map((i) => i.title).join(', ');
  if (!confirm(tm('filter_del_confirm', items.length) + (sample ? `\n(${sample}${items.length > 3 ? '…' : ''})` : ''))) return;
  let n = 0;
  for (const it of items) { store.remove(it.id); n++; }
  renderAll();
  toast(tm('bulk_delete_done', n), 4000);
});

$('#btnBulkMode').addEventListener('click', () => {
  bulkMode = !bulkMode;
  bulkSel.clear();
  $('#bulkBar').classList.toggle('hidden', !bulkMode);
  $('#btnBulkMode').classList.toggle('shelve-on', bulkMode);
  renderBulkShelfOptions();
  renderGrid();
  if (bulkMode) toast(tm('bulk_hint'));
});

$('#btnBulkCancel').addEventListener('click', () => {
  bulkMode = false;
  bulkSel.clear();
  $('#bulkBar').classList.add('hidden');
  $('#btnBulkMode').classList.remove('shelve-on');
  renderGrid();
});

$('#btnBulkDelete').addEventListener('click', () => {
  if (!bulkSel.size) { toast(tm('bulk_pick')); return; }
  const titles = [...bulkSel].slice(0, 5).map((id) => (store.findById(id) || {}).title).filter(Boolean).join(', ');
  if (!confirm(tm('bulk_delete_confirm', bulkSel.size) + (titles ? '\n(' + titles + (bulkSel.size > 5 ? '…' : '') + ')' : ''))) return;
  let n = 0;
  for (const id of bulkSel) { if (store.remove(id)) n++; }
  bulkSel.clear();
  $('#bulkCount').textContent = '';
  toast(tm('bulk_delete_done', n), 3500);
  renderAll();
});

$('#btnBulkApply').addEventListener('click', () => {
  if (!bulkSel.size) { toast(tm('bulk_pick')); return; }
  const status = $('#bulkStatus').value;
  const shelf = $('#bulkShelfSelect').value;
  const genre = $('#bulkGenre').value.trim();
  const loc = $('#bulkLocation').value.trim();
  if (!status && !shelf && !genre && !loc) { toast(tm('pick_change')); return; }
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
  toast(`${n} ` + (LANG === 'en' ? 'record(s) updated.' : 'ouvrage(s) mis à jour.'), 3000);
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
  if (outcome === 'accepted') toast(tm('installed'));
  deferredPrompt = null;
  $('#btnInstall').classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  $('#btnInstall').classList.add('hidden');
  toast(tm('pwa_installed'));
});

/* ---------- API keys manager (stored per-browser, never in code) ---------- */
const KEYS_STORE = 'biblio.keys.v1';
let apiKeys = { googleBooks: '' };
try { apiKeys = { ...apiKeys, ...(JSON.parse(localStorage.getItem(KEYS_STORE)) || {}) }; } catch {}
function saveApiKeys() {
  try { localStorage.setItem(KEYS_STORE, JSON.stringify(apiKeys)); }
  catch { toast(tm('key_save_fail')); }
}

function gbKeyParam() {
  return apiKeys.googleBooks ? `&key=${encodeURIComponent(apiKeys.googleBooks)}` : '';
}

$('#btnKeysCfg').addEventListener('click', () => {
  $('#keyGoogleBooks').value = apiKeys.googleBooks || '';
  $('#keyRelay').value = apiKeys.relay || '';
  $('#keyBank').value = apiKeys.bank || '';
  $('#keyGhToken').value = apiKeys.ghToken || '';
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
  apiKeys.relay = $('#keyRelay').value.trim();
  apiKeys.bank = $('#keyBank').value.trim();
  apiKeys.ghToken = $('#keyGhToken').value.trim();
  saveApiKeys();
  const sources = {
    googleBooks: $('#srcGoogleBooks').checked,
    bnf: $('#srcBnf').checked,
    openLibrary: $('#srcOpenLibrary').checked,
  };
  try { localStorage.setItem('biblio.sources.v1', JSON.stringify(sources)); } catch {}
  $('#keysModal').classList.add('hidden');
  const active = Object.entries(sources).filter(([, v]) => v).map(([k]) => ({ googleBooks: 'Google Books', bnf: 'BnF', openLibrary: 'Open Library' }[k])).join(', ');
  toast((LANG === 'en' ? 'Settings saved — active sources: ' : 'Réglages enregistrés — sources actives : ') + (active || (LANG === 'en' ? 'none!' : 'aucune !')), 3500);
});

$('#btnTestKeys').addEventListener('click', async () => {
  const key = $('#keyGoogleBooks').value.trim();
  const out = $('#keysTestResult');
  if (!key) { out.textContent = t('keys_enter_first'); return; }
  out.textContent = t('keys_testing');
  try {
    const r = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:9782070541270&key=${encodeURIComponent(key)}`, 12000);
    const data = await r.json();
    if (data.error) {
      const code = data.error.code || '?';
      const msg = data.error.message || 'erreur';
      let hint = '';
      if (/has not been used in project|is disabled/i.test(msg)) hint = (LANG === 'en' ? '→ The Google Books API is NOT enabled on this project. Open https://console.cloud.google.com/apis/library/books.googleapis.com (check the selected project at the top) → Enable.' : '→ L\'API « Google Books API » n\'est PAS activée sur ce projet. Ouvrez https://console.cloud.google.com/apis/library/books.googleapis.com (vérifiez le projet sélectionné en haut) → Activer.');
      else if (/Service temporarily unavailable/i.test(msg)) hint = (LANG === 'en' ? '→ Most frequent cause: API not enabled on the key project, or key and API in two different projects. Open https://console.cloud.google.com/apis/library/books.googleapis.com, check the project at the top right, enable.' : '→ Cause la plus fréquente : API non activée sur le projet de la clé, ou clé et API dans deux projets différents. Ouvrez https://console.cloud.google.com/apis/library/books.googleapis.com, vérifiez le projet en haut à droite, activez.');
      else if (/API key not valid|API_KEY_INVALID/i.test(msg)) hint = (LANG === 'en' ? '→ Invalid key: copy it fully from Credentials (starts with AIza).' : '→ Clé invalide : recopiez-la entièrement depuis Identifiants (elle commence par AIza).');
      else if (/RefererNotAllowed|referrer/i.test(msg)) hint = (LANG === 'en' ? '→ Referrer restriction: add https://chenzu-ai.github.io/* to the key restrictions (Credentials → key → Restrictions).' : '→ Restriction référents : ajoutez https://chenzu-ai.github.io/* dans les restrictions de la clé (Identifiants → clé → Restrictions).');
      else if (data.error.status === 'RESOURCE_EXHAUSTED') hint = (LANG === 'en' ? '→ Daily quota exhausted (1000/day): try again tomorrow.' : '→ Quota du jour épuisé (1000/jour) : réessayez demain.');
      out.textContent = `❌ ${code} — ${msg} ${hint}`;
      return;
    }
    out.textContent = data.totalItems > 0
      ? (LANG === 'en' ? '✅ Valid key — Google Books responds (book found).' : '✅ Clé valide — Google Books répond (livre trouvé).')
      : (LANG === 'en' ? '✅ Valid key — Google Books responds (this exact book is unknown, but the key works).' : '✅ Clé valide — Google Books répond (ce livre précis est inconnu, mais la clé fonctionne).');
  } catch (e) {
    out.textContent = '❌ ' + t('diag_net') + e.message;
  }
});

/* Diagnostic ISBN: que répond chaque source ? */
$('#btnDiagIsbn').addEventListener('click', async () => {
  const isbn = normalizeIsbn($('#diagIsbn').value);
  const out = $('#diagResult');
  if (!isbn) { out.textContent = t('diag_enter_isbn'); return; }
  out.textContent = t('diag_querying');
  const lines = [];
  const jobs = [
    fetchGoogleBooks(isbn).then((r) => lines.push(r ? `✅ Google Books: « ${r.title} » ${r.cover ? '(' + t('diag_cover') + ' ✓)' : '(' + t('diag_nocover') + ')'} ${r.summary ? '(' + t('diag_summary') + ' ✓)' : ''}` : t('diag_gb_none'))).catch(() => lines.push(t('diag_net_err', 'Google Books'))),
    fetchBnf(isbn).then((r) => lines.push(r ? `✅ BnF: « ${r.title} » — ${r.authors.join(', ')}` : t('diag_bnf_none'))).catch(() => lines.push(t('diag_net_err', 'BnF'))),
    fetchOpenLibrary(isbn).then((r) => lines.push(r ? `✅ Open Library: « ${r.title} »` : t('diag_ol_none'))).catch(() => lines.push(t('diag_net_err', 'Open Library'))),
    fetchCoverFallback(isbn).then((r) => lines.push(r ? t('diag_covers_ok') : t('diag_covers_none'))).catch(() => lines.push(t('diag_net_err', 'Covers'))),
  ];
  await Promise.all(jobs);
  // Deuxieme vague: ISBN-10 converti + relais FR
  const alt = isbn.length === 13 ? isbn13to10(isbn) : isbn10to13(isbn);
  if (alt) {
    const jobs2 = [
      fetchGoogleBooks(alt).then((r) => lines.push(r ? `✅ Google Books (ISBN-10 ${alt}): « ${r.title} »` : `❌ Google Books (ISBN-10 ${alt}): ` + t('diag_nothing'))).catch(() => lines.push(`❌ Google Books (ISBN-10): ` + t('diag_network'))),
      fetchOpenLibrary(alt).then((r) => lines.push(r ? `✅ Open Library (ISBN-10 ${alt}): « ${r.title} »` : `❌ Open Library (ISBN-10 ${alt}): ` + t('diag_nothing'))).catch(() => lines.push(`❌ Open Library (ISBN-10): ` + t('diag_network'))),
    ];
    await Promise.all(jobs2);
  }
  if (apiKeys.relay) {
    try {
      const rr = await fetchRelay(isbn);
      lines.push(rr ? `✅ ${t('diag_relay')} (Fnac/BnF): « ${rr.title} » — ${rr.publisher}` : t('diag_relay_none'));
    } catch { lines.push(t('diag_relay_err')); }
  } else {
    lines.push(t('diag_relay_unset'));
  }
  out.innerHTML = lines.join('<br>') + '<br><b>' + t('diag_all_fail') + '</b>';
});

/* ---------- Shelf photo AI (lecture des tranches par rangées) ---------- */
let shelfPhotoData = null;

$('#btnShelfPhotoCam').addEventListener('click', () => $('#shelfPhotoCamInput').click());
// La camera et le fichier alimentent le meme flux: rediriger l'evenement change
$('#shelfPhotoCamInput').addEventListener('change', (e) => {
  const inp = $('#shelfPhotoInput');
  const files = e.target.files;
  if (files && files.length) {
    try { inp.files = files; } catch {}
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  e.target.value = '';
});

/* 📷 Scanner cette étagère : active le mode rangement avec le meuble + étagère du formulaire photo,
   PUIS ouvre le scanner — chaque ISBN scanné crée une fiche complète rangée à cet emplacement.
   L'agencement saisi (ex. 26+4p=30) sert de décompte attendu : progression affichée à chaque scan. */
$('#btnShelfScanMode').addEventListener('click', () => {
  const furniture = ($('#shelfFurniture') && $('#shelfFurniture').value.trim()) || knownFurniture()[0] || '';
  const slotPrefix = ($('#shelfPrefix') && $('#shelfPrefix').value.trim()) || (LANG === 'en' ? 'Row' : 'Étagère');
  if (!furniture) { toast(tm('shelve_need_furniture'), 4000); return; }
  const slot = prompt(tm('shelve_slot_prompt', slotPrefix), slotPrefix + ' 1');
  if (slot === null) return;
  // notation d'insertion : « Étagère 1 @6 » = insérer à la position 6 (décale les suivantes)
  let slotName = slot.trim();
  let insertAt = 0;
  const atM = slotName.match(/\s*@\s*(\d+)\s*$/);
  if (atM) { insertAt = parseInt(atM[1], 10); slotName = slotName.replace(/\s*@\s*\d+\s*$/, '').trim(); }
  shelveMode = { furniture, slot: slotName, insertAt: insertAt || 0 };
  saveShelveMode();
  // agencement attendu: le decompte saisi (5+3g+12+4p=24) donne le nombre de livres a scanner
  const layoutRaw = ($('#shelfBooksPerRow') && $('#shelfBooksPerRow').value.trim()) || '';
  const spec = parseRowSpec(layoutRaw);
  shelveMode.expected = spec && spec.total ? spec.total : 0;
  shelveMode.scanned = 0;
  saveShelveMode();
  $('#shelfModal').classList.add('hidden');
  toast(shelveMode.expected ? tm('shelve_on_expected', shelveMode.expected) : tm('shelve_on'), 3500);
  startScan();
});

/* Agencement photo persistant : le champ 'Par rangée' est mémorisé entre les sessions */
function saveShelfLayout(v) { try { localStorage.setItem('biblio.shelf.layout', v || ''); } catch {} }
function loadShelfLayout() { try { return localStorage.getItem('biblio.shelf.layout') || ''; } catch { return ''; } }

$('#btnShelfPhoto').addEventListener('click', () => {
  $('#mainNav').classList.add('hidden'); // refermer le menu (la modale couvre sinon le menu en transparence)
  $('#shelfModal').classList.remove('hidden');
  if ($('#shelfBooksPerRow') && !$('#shelfBooksPerRow').value) $('#shelfBooksPerRow').value = loadShelfLayout();
  const fl = document.getElementById('furnitureList');
  if (!fl) {
    const dl = document.createElement('datalist');
    dl.id = 'furnitureList';
    dl.innerHTML = knownFurniture().map((f) => `<option value="${esc(f)}">`).join('');
    document.body.appendChild(dl);
  }
  $('#shelfStatus').textContent = aiCfg.key || aiCfg.provider === 'ollama' ? '' : t('ph_need_ai');
});

$('#btnCloseShelf').addEventListener('click', () => $('#shelfModal').classList.add('hidden'));

$('#shelfPhotoInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  // Compression maitrisee AVANT l'IA: 1600px max, JPEG 90% (qualite tranche) — evite que l'API
  // recompresse une photo de 12 Mo et detruise la lisibilite des tranches fines
  compressImageFile(file, 1600, (dataUrl) => {
    shelfPhotoData = dataUrl;
    const img = $('#shelfPreview');
    img.src = shelfPhotoData;
    img.classList.remove('hidden');
  });
});

async function aiVisionShelf(prompt, imageDataUrl) {
  const sys = 'Tu es un assistant expert en reconnaissance de tranches de livres sur une photo d\'étagère. Réponds UNIQUEMENT en JSON valide.';
  const user = prompt;
  if (aiCfg.provider === 'ollama') {
    const r = await fetchWithTimeout((aiCfg.url || 'http://localhost:11434') + '/api/generate', 120000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: aiCfg.model || 'llama3.2-vision', prompt: sys + '\n' + user, images: [imageDataUrl.split(',')[1]], stream: false, format: 'json' }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    return (data.response || '').trim();
  }
  const r = await fetchWithTimeout(aiEndpoint(), 120000, {
    method: 'POST',
    headers: aiHeaders(),
    body: JSON.stringify({
      model: aiCfg.model,
      messages: [{ role: 'user', content: [
        { type: 'text', text: sys + '\n' + user },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ] }],
      temperature: 0.1,
    }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
}

/* Recherche complete d'un livre a partir du titre/auteur (photo d'etagere):
   1. Google Books par titre+auteur, meilleur match par similarite
   2. Si ISBN trouve -> chaine complete (BnF, relais, banques) via lookupBookByIsbn
   3. Anti-doublon (ISBN exact OU titre similaire >= 0.85): complete l'existante
   Retour: { item, isNew, sources } */
async function searchBookByTitle(u, onNote) {
  const q = [u.title, (u.author || '').split(',')[0]].filter(Boolean).join(' ').trim();
  if (!q) return null;
  let meta = null, sim = 0;
  // Source 0 (priorite fonds FR): BnF par titre — depouille le depot legal francais
  const bnfMeta = await fetchBnfByTitle(u.title, (u.author || '').split(',')[0]);
  if (bnfMeta) {
    meta = bnfMeta;
    sim = titleSimilarity(bnfMeta.title, u.title);
    meta.srcFound = ['BnF'];
    if (bnfMeta.isbn) {
      const full = await fetchMetadataSmart(normalizeIsbn(bnfMeta.isbn));
      if (full) for (const [k, v] of Object.entries(full)) {
        const cur = meta[k];
        const empty = cur === '' || cur === null || cur === undefined || (Array.isArray(cur) && !cur.length);
        if (empty && v && !(Array.isArray(v) && !v.length)) meta[k] = v;
      }
    }
  }
  // Source 1: Google Books (quota 1000/jour avec cle, 429 = quota epuise) — si BnF n'a rien donne
  let gbDown = false;
  if (!meta) try {
    const r = await fetchWithTimeout('https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent(q) + gbKeyParam(), 12000);
    if (r.status === 429) {
      gbDown = true; // quota Google epuise pour aujourd'hui
    } else if (r.ok) {
      const data = await r.json();
      if (data.items && data.items.length) {
        let best = data.items[0];
        for (const item of data.items.slice(0, 6)) {
          const s2 = titleSimilarity((item.volumeInfo && item.volumeInfo.title) || '', u.title);
          if (s2 > sim) { sim = s2; best = item; }
        }
        if (sim >= 0.3) meta = normalizeGoogleMeta(best);
      }
    }
  } catch {}
  // Source 2 (secours): Open Library par titre — pas de quota, meme API libre que le scan
  if (!meta) {
    try {
      const r2 = await fetchWithTimeout('https://openlibrary.org/search.json?q=' + encodeURIComponent(q) + '&fields=title,author_name,isbn,publisher,first_publish_year,number_of_pages_median,cover_i&limit=6', 12000);
      if (r2.ok) {
        const d2 = await r2.json();
        if (d2.docs && d2.docs.length) {
          let best2 = d2.docs[0];
          for (const doc of d2.docs.slice(0, 6)) {
            const s3 = titleSimilarity(doc.title || '', u.title);
            if (s3 > sim) { sim = s3; best2 = doc; }
          }
          if (sim >= 0.3) {
            const isbn13 = ((best2.isbn || []).map(normalizeIsbn).find((x) => /^\d{13}$/.test(x)) || '');
            meta = {
              title: best2.title || u.title,
              authors: best2.author_name || (u.author ? [u.author] : []),
              publisher: (best2.publisher || [])[0] || '',
              publishedDate: String(best2.first_publish_year || ''),
              pageCount: best2.number_of_pages_median || null,
              isbn: isbn13,
              cover: best2.cover_i ? 'https://covers.openlibrary.org/b/id/' + best2.cover_i + '-L.jpg' : '',
              summary: '',
            };
          }
        }
      }
    } catch {}
  }
  if (!meta) {
    if (gbDown) throw new Error('GB_QUOTA');
    return null;
  }
  const isbn13 = meta.isbn ? normalizeIsbn(meta.isbn) : '';

  // Anti-doublon 1: ISBN exact deja present
  if (isbn13) {
    const dupIsbn = store.items.find((x) => x.isbn === isbn13);
    if (dupIsbn) return { item: dupIsbn, isNew: false, merged: true };
  }
  // Anti-doublon 2: titre tres proche deja present (la photo peut redecouvrir un possede)
  const dupTitle = store.items.find((x) => x.title && titleSimilarity(x.title, meta.title || u.title) >= 0.85);
  if (dupTitle) {
    if (isbn13 && !dupTitle.isbn) dupTitle.isbn = isbn13;
    if (u.furniture && !dupTitle.furniture) { dupTitle.furniture = u.furniture; dupTitle.slot = u.slot; dupTitle.location = u.loc; }
    if (dupTitle.isbn) { const full = await fetchMetadataSmart(normalizeIsbn(dupTitle.isbn)); if (full) applyMetaToItem(dupTitle, full); }
    store.update(dupTitle);
    return { item: dupTitle, isNew: false, merged: true };
  }

  // Nouveau livre: creer puis completer par la chaine complete
  const item = { ...blankItem(isbn13), ...meta, isbn: isbn13 };
  item.furniture = u.furniture || ''; item.slot = u.slot || ''; item.location = u.loc || '';
  if (u.volume) item.volume = u.volume;
  if (u.scenario && !(item.scenario || []).length) item.scenario = [u.scenario];
  if (u.art && !(item.art || []).length) item.art = [u.art];
  if (u.series && !item.series) item.series = u.series;
  if (isbn13) {
    const full = await fetchMetadataSmart(isbn13);
    if (full) for (const [k, v] of Object.entries(full)) {
      const cur = item[k];
      const empty = cur === '' || cur === null || cur === undefined || (Array.isArray(cur) && !cur.length);
      if (empty && v && !(Array.isArray(v) && !v.length)) item[k] = v;
    }
  }
  store.add(item);
  return { item, isNew: true };
}

/* Similarite de titres (0-1) — mots communs normalises */
function titleSimilarity(a, b) {
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const wa = norm(a), wb = norm(b);
  if (!wa.length || !wb.length) return 0;
  const common = wa.filter((w) => wb.includes(w)).length;
  return (2 * common) / (wa.length + wb.length);
}

/* Mode rangement inverse (proposition 3) :
   Pour les inconnus a serie/collection connue mais titre illisible, si vous possedez deja
   des tomes de cette serie, deduire le tome par les numeros vus sur les tranches voisines
   et completer depuis les fiches existantes (ou les marquer manquants).
   Retourne le nombre de fiches completees par deduction. */
function deduceMuteSpines(unknownList) {
  let deduced = 0;
  // grouper les inconnus par serie/collection
  const bySerie = {};
  for (const u of unknownList) {
    const serie = (u.series || u.collection || '').trim();
    if (!serie) continue;
    (bySerie[serie] = bySerie[serie] || []).push(u);
  }
  for (const [serie, us] of Object.entries(bySerie)) {
    // vos fiches existantes de cette serie/collection
    const owned = store.items.filter((i) => i.series === serie || i.collection === serie);
    if (!owned.length) continue;
    // inconnus avec numero de tome lu -> chercher la fiche correspondante par tome
    for (const u of us) {
      const vol = parseInt(u.volume, 10);
      if (isNaN(vol)) continue;
      const match = owned.find((i) => parseInt(i.volume, 10) === vol);
      if (match) {
        // la tranche muette correspond a un tome possede: la marquer rangee ici si pas deja
        if (u.furniture && !match.furniture) {
          match.furniture = u.furniture; match.slot = u.slot; match.location = u.loc;
          store.update(match);
        }
        deduced++;
      }
    }
  }
  return deduced;
}

/* Rapprochement complet d'un livre de photo: par titre, sinon par série/collection + tome */
function matchShelfBook(b, prefix, furniture) {
  const byTitle = matchShelfTitle([b.title, b.volume, b.author, b.scenario, b.art].filter(Boolean).join(' '));
  if (byTitle) return byTitle;
  // Tranche muette: série ou collection + numéro de tome -> chercher la fiche correspondante
  const serie = (b.series || b.collection || '').trim();
  const vol = parseInt(b.volume, 10);
  if (serie && !isNaN(vol)) {
    return store.items.find((i) =>
      (i.series === serie || i.collection === serie) && parseInt(i.volume, 10) === vol
    ) || null;
  }
  return null;
}

function matchShelfTitle(title, row, prefix, furniture) {
  if (!title || !String(title).trim()) return null;
  /* Rapprochement par série/collection + tome pour les tranches muettes :
     la photo fournit [title, volume, author, scenario, art] jointes — si le titre est vide
     mais qu'un numéro de tome est présent, on tente série+collection+tome. */
  // similarite Dice sur le titre seul, puis avec serie+tome, puis avec auteurs — meilleur des trois
  let best = null, bestScore = 0;
  for (const it of store.items) {
    const cands = [
      [titleSimilarity(title, it.title), 1],
      [titleSimilarity(title, [it.title, it.series].filter(Boolean).join(' ')), 0.95],
    ];
    if (it.volume) cands.push([titleSimilarity(String(title) + ' ' + it.volume, [it.title, it.series, 'tome ' + it.volume].filter(Boolean).join(' ')), 0.9]);
    const sc = Math.max(...cands.map(([v, w]) => v * w));
    if (sc > bestScore) { bestScore = sc; best = it; }
  }
  return bestScore >= 0.55 ? best : null;
}

/* Analyse des positions de série dans une rangée photo: suites complètes, tomes manquants,
   désordres, insertions suspectes → section Conseils de rangement du bilan ( restaurée 30/10
   — avait été perdue lors d'une édition, détectée par le test de chargement complet ) */
function analyzeSeriesPositions(rows, prefix, furniture) {
  const tips = [];
  const series = {};
  for (const row of rows) {
    for (const b of (row.books || [])) {
      const serie = (b.series || b.collection || '').trim();
      const vol = parseInt(b.volume, 10);
      const pos = parseInt(b.pos, 10);
      if (!serie || isNaN(vol) || isNaN(pos)) continue;
      (series[serie] = series[serie] || []).push({ vol, pos, title: b.title || serie });
    }
  }
  for (const [serie, books] of Object.entries(series)) {
    if (books.length < 2) continue;
    books.sort((a, b2) => a.pos - b2.pos);
    const vols = books.map((x) => x.vol);
    const min = Math.min(...vols), max = Math.max(...vols);
    const contiguous = books.every((x, i) => i === 0 || x.pos === books[i - 1].pos + 1);
    const ordered = vols.every((v, i) => i === 0 || v === vols[i - 1] + 1);
    const reversed = vols.every((v, i) => i === 0 || v === vols[i - 1] - 1); // suite COMPLETE decroissante vue = ordre de lecture inverse
    if ((ordered || reversed) && contiguous) {
      tips.push(`<div class="inv-line ok">📚 ${esc(serie)} : tomes ${min}-${max} contigus et en ordre — parfait (${books.length} livres)${reversed && !ordered ? ' (lus de droite à gauche)' : ''}</div>`);
    } else {
      const missing = [];
      for (let v = min; v <= max; v++) if (!vols.includes(v)) missing.push(v);
      if (missing.length) tips.push(`<div class="inv-line miss">📐 ${esc(serie)} : tomes manquants dans la suite — ${missing.map((v) => 'T.' + v).join(', ')} (entre T.${min} et T.${max} visibles)</div>`);
      if (contiguous && !ordered && !reversed) {
        tips.push(`<div class="inv-line miss">↔️ ${esc(serie)} : tomes ${vols.join(', ')} côte à côte mais dans le désordre — envisager de les remettre en ordre</div>`);
      }
      if (!contiguous && books.length >= 2) {
        const sortedVols = [...books].sort((a, b2) => a.vol - b2.vol);
        for (let i = 1; i < sortedVols.length; i++) {
          const prev = sortedVols[i - 1], cur = sortedVols[i];
          if (cur.pos > prev.pos + 1 && cur.vol !== prev.vol + 1) {
            tips.push(`<div class="inv-line warn">🧩 ${esc(serie)} : « ${esc(prev.title)} » en position ${prev.pos} et « ${esc(cur.title)} » en position ${cur.pos} — un rangement intermédiaire ou un tome intercalé ? Vérifier l'ordre</div>`);
          }
        }
      }
    }
  }
  return tips;
}

/* Parseur de description de rangée : « 2+5g+8+4m+6+5d+3p=33 »
   = 2 debout, pile de 5 à gauche, 8 debout, pile de 4 au milieu, 6 debout, pile de 5 à droite, 3 sur le dessus — total 33.
   Qualificatifs : p=dessus/sur le dessus, g=gauche, d=droite, m=milieu. Un nombre seul = livres debout.
   Retour : { text: description en clair, total: N, ok: total déclaré == somme } */
function parseRowSpec(raw) {
  const out = { text: '', total: null, ok: true };
  if (!raw) return out;
  const rows = raw.split(/[,;\n]/).map((r) => r.trim()).filter(Boolean);
  const descs = [];
  let grand = 0;
  rows.forEach((rowSpec, ri) => {
    const mTotal = rowSpec.match(/=\s*(\d+)/);
    const declared = mTotal ? +mTotal[1] : null;
    const body = rowSpec.replace(/=\s*\d+/, '');
    const segs = body.split('+').map((x) => x.trim()).filter(Boolean);
    const parts = [];
    let sum = 0;
    for (const seg of segs) {
      const m = seg.match(/^(\d+)\s*([pgdm])?$/i);
      if (!m) continue;
      const n = +m[1];
      const q = (m[2] || '').toLowerCase();
      sum += n;
      if (!q) parts.push(n + ' debout');
      else {
        const labels = { p: 'sur le dessus', g: '\u00e0 gauche', d: '\u00e0 droite', m: 'au milieu' };
        parts.push('pile de ' + n + ' ' + labels[q]);
      }
    }
    if (declared !== null && declared !== sum) out.ok = false;
    grand += sum;
    descs.push('rang\u00e9e ' + (ri + 1) + ' : ' + parts.join(', ') + ' — total ' + sum + (declared !== null ? ' (d\u00e9clar\u00e9 ' + declared + ')' : ''));
  });
  out.total = grand;
  out.text = descs.join(' ; ');
  return out;
}

$('#btnShelfAnalyze').addEventListener('click', async () => {
  if (!shelfPhotoData) { $('#shelfStatus').textContent = t('ph_take'); return; }
  if (!aiCfg.key && aiCfg.provider !== 'ollama') { $('#shelfStatus').textContent = t('ai_notcfg'); return; }
  const prefix = $('#shelfPrefix').value.trim() || (LANG === 'en' ? 'Row' : 'Rangée');
  const furniture = $('#shelfFurniture').value.trim();
  const rowsHint = $('#shelfRows').value ? ` La photo montre environ ${$('#shelfRows').value} rangées.` : '';
  const perRowRaw = ($('#shelfBooksPerRow') && $('#shelfBooksPerRow').value.trim()) || '';
  saveShelfLayout(perRowRaw);
  const rowSpec = parseRowSpec(perRowRaw);
  const booksPerRowHint = perRowRaw ? ` DESCRIPTION PHYSIQUE DES RANGÉES fournie par l'utilisateur : « ${perRowRaw} » (p=pile sur le dessus, g=pile à gauche, d=pile à droite, m=pile au milieu ; un nombre seul = livres debout, dans l'ordre gauche→droite). Décodée : ${rowSpec.text}. Total déclaré : ${rowSpec.total}. Pour CHAQUE rangée, vérifie ton décompte (count), l'ordre des segments et tes "flat":true contre cette description, et signale tout écart.` : '';
  const flatHint = '';
  $('#shelfStatus').textContent = t('ph_progress');
  $('#shelfResult').innerHTML = '';
  try {
    const prompt = `Analyse cette photo d'étagère de livres/BD/mangas (prise en paysage, tranches visibles).${rowsHint}${booksPerRowHint}${flatHint}
Identifie chaque livre visible PAR RANGÉE, de haut en bas puis de gauche à droite.
RÈGLES STRICTES — une tranche peut porter : titre, auteur, scénariste, dessinateur, éditeur, collection, numéro de tome. SÉPARE chaque information dans SON champ :
- "title" : UNIQUEMENT le titre (le nom de l'œuvre). JAMAIS l'auteur, le dessinateur, le scénariste, l'éditeur, la collection, ni le numéro de tome
- "author" : l'auteur (ou le/les personnes nommées en vedette ; pour un manga c'est souvent le seul nom sur la tranche)
- "scenario" : le SCÉNARISTE s'il est distinct de l'auteur (BD : "scénario X")
- "art" : le DESSINATEUR s'il est distinct (BD : "dessin Y")
- "publisher" : l'ÉDITEUR (ex. Dargaud, Kana, Gallimard — souvent en bas de tranche)
- "series" : la SÉRIE d'œuvres si différente du titre (ex. "Astérix" pour un album)
- "collection" : la COLLECTION ÉDITORIALE (ex. "Folio", "Simplissime", "Que sais-je ?") — différente de la série
- "volume" : le numéro de tome SANS le mot "tome" ni "T." (juste le chiffre)
- Chaque TOME visible = une entrée séparée
- Ne fusionne JAMAIS deux livres adjacents : deux tranches qui se touchent = deux entrées
- Si la tranche montre la couverture (livre rangé face visible), décris-le aussi
- Champ illisible : chaîne vide

COLLECTIONS À TRANCHES UNIFORMES (fréquentes en France) : Folio, Le Livre de Poche, Pocket, Presses Pocket, Que sais-je ?, Simplissime (First), Pour les Nuls, Marabout, J'ai lu, Points, Champs, GF, Tel, Flammarion, Seuil Points… Ces collections ont des tranches de couleur/format uniformes SANS titre lisible.
Pour ces livres :
- identifie la COLLECTION par sa couleur/format caractéristique (ex. tranche blanche + bande de couleur = Simplissime ; tranche bleu nuit = Que sais-je ?)
- si un NUMÉRO de tome est visible même petit : mets-le dans "volume"
- si le titre est trop petit mais partiellement déchiffrable : mets ce que tu lis dans "title"
- mets la collection dans "collection" (ex. "Simplissime") et "title" vide si illisible
Un livre de collection à tranche muette est TOUJOURS une entrée — ne l'ignore pas.

EXHAUSTIVITÉ ABSOLUE (critique) : une étagère contient souvent 25-40 livres par rangée. Compte PHYSIQUEMENT les tranches visibles sur chaque rangée avant de répondre. RÈGLE : CHAQUE livre physique visible = UNE entrée dans "books", SANS EXCEPTION. Si une tranche est muette ou illisible (ex. collection "Simplissime" sans titre lisible), crée QUAND MÊME une entrée avec title:"?" et toutes les infos visibles (collection, numéro de tome si lisible) — N'AUGMENTE PAS de positions. Le champ "count" doit être ÉGAL au nombre d'entrées listées, et l'utilisateur vous a donné le décompte réel : s'il manque des entrées par rapport à son chiffre, relisez la photo et ajoutez les livres manquants en "?".
EXEMPLE : si l'utilisateur indique 26 livres et que tu n'en identifies que 20, liste quand même 26 entrées (les 6 muets en "?").
Pour chaque livre, indique aussi sa POSITION dans la rangée: "pos" = numéro d'ordre depuis la gauche (1, 2, 3…).
LIVRES HORIZONTAUX : certains livres sont posés À PLAT (couchés, empilés en pile sur l'étagère ou couchés devant les rangées debout). Détecte-les aussi avec "flat": true (un livre debout a "flat": false, défaut).
NUMÉROTATION CONTINUE : les livres à plat COMPTENT dans la séquence des positions de la rangée, SELON LEUR EMPLACEMENT PHYSIQUE :
- Pile TOUT À GAUCHE de la rangée (première chose visible) : les à plat sont les PREMIERS positions. Ex : pile de 5 à plat à gauche puis 10 debout → à plat pos 1-5 (ordre de la pile : du dessus vers le dessous), debout pos 6-15.
- Pile AU MILIEU de la rangée : la pile occupe sa position réelle. Ex : 5 debout, une pile de 3, puis 7 debout → debout pos 1-5, pile pos 6-8, puis debout pos 9-15.
- Pile posée SUR le dessus d'un groupe de livres debout (couchée à l'extrémité, DERRIÈRE ou DEVANT la rangée debout) : les à plat viennent TOUJOURS APRÈS tous les debout de la rangée, en DERNIÈRES positions. Ex : 15 debout + 5 couchés dessus → debout pos 1-15, à plat pos 16-20. IMPORTANT : même si la pile couchée paraît visuellement devant le début de la rangée (photo en perspective), les livres DEBOUT occupent toujours les premières positions.
Règle générale : la position suit l'ORDRE DE LECTURE PHYSIQUE de la rangée, de gauche à droite ; une pile couchée prend la plage de positions correspondant à l'espace physique qu'elle occupe.
PLUSIEURS PILES : une rangée peut contenir PLUSIEURS piles (ex : pile de 3 à gauche, 8 debout, pile de 5 à droite → pos 1-3, 4-11, 12-16) ou même ÊTRE ENTIÈREMENT composée de piles (ex : 3 piles de 5 → pos 1-5, 6-10, 11-15). Traite chaque pile comme un bloc de positions consécutives, dans l'ordre gauche → droite, et liste chaque livre de chaque pile du dessus vers le dessous.
Le "count" de la rangée inclut TOUS les livres (debout + à plat).
LIVRES HORIZONTAUX : certains livres sont posés À PLAT (couchés, empilés en pile sur l'étagère ou couchés devant les rangées debout). Détecte-les aussi : liste-les dans l'ordre de la pile (du dessus vers le dessous) avec "pos" = position de la pile dans la rangée et "flat": true. Un livre debout a "flat": false (défaut).
Regroupe mentalement les livres contigus de la même série/collection et donne le premier/dernier de chaque groupe si identifiable.
Réponds UNIQUEMENT avec un JSON: {"rows":[{"n":1,"count":30,"books":[{"title":"...","pos":1,...}]}]}
Sois exhaustif mais ne devine pas.`;
    const resp = await aiVisionShelf(prompt, shelfPhotoData);
    const m = resp.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(LANG === 'en' ? 'unparsable AI response' : 'réponse IA non parsable');
    const parsed = JSON.parse(m[0]);
    const rows = parsed.rows || [];
    let knownHere = 0, misplaced = 0, unknown = 0;
    let html = '';
    for (const row of rows) {
      const rowNum = row.n || (rows.indexOf(row) + 1);
      const slotName = `${prefix} ${rowNum}`;
      const rowLoc = furniture ? `${furniture} · ${slotName}` : slotName;
      html += `<h3 style="margin:12px 0 6px">${esc(slotName)}${furniture ? ' (' + esc(furniture) + ')' : ''}</h3>`;
      for (const b of (row.books || [])) {
        const match = matchShelfBook(b, prefix, furniture);
        if (!match) {
          unknown++;
          const extra = [];
          if (b.author) extra.push(esc(b.author));
          if (b.scenario) extra.push(t('ph_by_script') + ' ' + esc(b.scenario));
          if (b.art) extra.push(t('ph_by_art') + ' ' + esc(b.art));
          if (b.publisher) extra.push(esc(b.publisher));
          html += `<div class="inv-line warn">❓ <b>${esc(b.title || '?')}</b>${b.volume ? ' T.' + esc(b.volume) : ''}${b.pos ? ' <span class="hint">[' + b.pos + (b.flat ? '·' + t('flat_short') : '') + ']</span>' : ''}${extra.length ? ' — ' + extra.join(' · ') : ''} — ${t('ph_unknown_lib')} <button class="btn small shelf-search" data-q="${esc([b.title, b.author].filter(Boolean).join(' '))}" data-loc="${esc(rowLoc)}">🔎 ${t('ph_search_add')}</button></div>`;
        } else {
          const itLoc = match.furniture && match.slot ? `${match.furniture} · ${match.slot}` : (match.location || '');
          if (!furniture || itLoc === rowLoc || (match.furniture === furniture && match.slot === slotName)) {
            knownHere++;
            html += `<div class="inv-line ok">✅ <b>${esc(match.title)}</b>${b.pos ? ' <span class="hint">[' + b.pos + ']</span>' : ''} — ${t('inv_here')}</div>`;
          } else {
            misplaced++;
            html += `<div class="inv-line miss">⚠ <b>${esc(match.title)}</b> — ${t('inv_listed')} « ${esc(itLoc || t('inv_unknown_loc'))} » <button class="btn small shelf-move" data-id="${esc(match.id)}" data-loc="${esc(rowLoc)}" data-f="${esc(furniture)}" data-s="${esc(slotName)}">📦 ${t('inv_shelve_here')}</button></div>`;
          }
        }
      }
    }
    // Collecte des inconnus pour l'ajout par lots
    window.__shelfUnknown = [];
    for (const row of rows) for (const b of (row.books || [])) {
      if (!matchShelfBook(b, prefix, furniture)) {
        const rowNum = row.n || (rows.indexOf(row) + 1);
        const slotName = `${prefix} ${rowNum}`;
        const rowLoc = furniture ? `${furniture} · ${slotName}` : slotName;
        window.__shelfUnknown.push({ title: b.title || '', volume: b.volume || '', author: b.author || '', scenario: b.scenario || '', art: b.art || '', publisher: b.publisher || '', series: b.series || '', collection: b.collection || '', loc: rowLoc, furniture, slot: slotName, pos: b.pos || null, flat: !!b.flat });
      }
    }
    const muteWithSerie = window.__shelfUnknown.filter((u) => (u.series || u.collection) && u.volume).length;
    const deduceBtn = muteWithSerie ? ` <button class="btn small" id="btnShelfDeduce" title="${t('ph_deduce_title')}">🧩 ${t('ph_deduce')} (${muteWithSerie})</button>` : '';
    const posTips = analyzeSeriesPositions(rows, prefix, furniture);
    const posHtml = posTips.length ? `<div class="group-card"><b>${t('ph_layout_tips')}</b>${posTips.join('')}</div>` : '';
    const batchBtn = window.__shelfUnknown.length ? ` <button class="btn btn-primary small" id="btnShelfIdentifyAll">🔎 ${t('ph_identify_all')} (${window.__shelfUnknown.length})</button>${deduceBtn} <button class="btn small" id="btnShelfCreateBlanks">📥 ${t('ph_create_blanks')} (${window.__shelfUnknown.length})</button>` : '';
    let totalSeen = 0;
    for (const row of rows) totalSeen += (row.books || []).length;
    html = `<div class="group-card"><b>${t('ph_summary')}</b> — ${knownHere} ${t('inv_ranged')} · ${misplaced} ${t('inv_misplaced')} · ${unknown} ${t('inv_inv')}${batchBtn}</div>` + posHtml + html;
    $('#shelfStatus').textContent = t('ph_done') + ' (' + totalSeen + ' ' + (LANG === 'en' ? 'books seen by the AI' : 'livres vus par l’IA') + ')';
    $('#shelfResult').innerHTML = html;
    $('#shelfStatus').textContent = t('ph_done');

    // Creer les fiches inconnues (titre '?', emplacement range) — a completer ensuite par scan (la fiche a un bouton 📷) ou IA
    const cbBtn = document.getElementById('btnShelfCreateBlanks');
    if (cbBtn) cbBtn.addEventListener('click', () => {
      const list = window.__shelfUnknown || [];
      if (!list.length) return;
      let created = 0;
      for (const u of list) {
        // garde anti-doublon PRECIS: un blank existe deja pour CETTE position photo (furniture + slot + pos)
        const already = store.items.some((it) => it.isBlank && it.furniture === u.furniture && it.slot === (u.loc || '') && String(it.photoPos || '') === String(u.pos || ''));
        if (already) continue;
        const parts = (u.loc || '').split('·').map((x) => x.trim());
        const item = { ...blankItem(''), title: '?', series: u.series || '', volume: u.volume || '', publisher: u.publisher || '',
          furniture: u.furniture || parts[0] || '', slot: u.loc || '', location: u.loc || '', status: 'unread',
          addedAt: new Date().toISOString(), isBlank: true, photoPos: u.pos || null };
        store.add(item);
        created++;
      }
      renderAll();
      autoBackupTick();
      toast(tm('ph_blanks_created', created), 5000);
    });

    // Rangement inverse: deduire les tomes par serie + numero lu sur la tranche muette
    const dedBtn = document.getElementById('btnShelfDeduce');
    if (dedBtn) dedBtn.addEventListener('click', () => {
      const n = deduceMuteSpines(window.__shelfUnknown || []);
      toast(n ? tm('ph_deduce_done', n) : tm('ph_deduce_none'), 5000);
      if (n) { renderAll(); autoBackupTick(); }
    });

    // Identification complete par lots: recherche Google -> ISBN -> chaine complete (BnF, relais, banques)
    const idBtn = document.getElementById('btnShelfIdentifyAll');
    if (idBtn) idBtn.addEventListener('click', async () => {
      // OPTIMISATION: ecarter les muets inexploitables (titre "?" sans serie ni tome) — introuvables
      // en ligne par definition, ils gaspilleraient ~15-20s chacun. Ils restent dans le bilan pour scan/douchette.
      const all = window.__shelfUnknown || [];
      const list = all.filter((u) => {
        const hasTitle = u.title && u.title !== '?' && !/^\?+$/.test((u.title || '').trim());
        const hasSerieVol = (u.series || u.collection) && (u.volume || '').trim(); // serie + TOME requis (serie seule insuffisante)
        return hasTitle || hasSerieVol;
      });
      const skipped = all.length - list.length;
      if (!list.length) { toast(tm('ph_none_identifiable', all.length), 5000); return; }
      if (skipped) toast(tm('ph_skipped_mute', skipped), 4500);
      idBtn.disabled = true;
      let found = 0, merged = 0, notFound = 0, quotaStopped = -1;
      const identifiedIds = [];
      for (let i = 0; i < list.length; i++) {
        idBtn.textContent = `🔎 ${i + 1}/${list.length}…`;
        const u = list[i];
        try {
          const res = await searchBookByTitle(u);
          if (res && res.isNew) { found++; identifiedIds.push(u); }
          else if (res && res.merged) { merged++; identifiedIds.push(u); }
          else notFound++;
        } catch (e) {
          if (e && e.message === 'GB_QUOTA') {
            quotaStopped = i; // arreter proprement: Google epuise, Open Library a repondu au mieux
            break;
          }
          notFound++;
        }
        renderAll();
        await new Promise((r2) => setTimeout(r2, 900)); // menager le quota Google (1000/jour)
      }
      idBtn.disabled = false;
      // Mettre a jour les listes: retirer les identifies (trouves + merges) de __shelfUnknown
      const identifiedSet = new Set(identifiedIds);
      window.__shelfUnknown = (window.__shelfUnknown || []).filter((u) => !identifiedSet.has(u));
      const remaining = window.__shelfUnknown.length;
      const remainingSearchable = window.__shelfUnknown.filter((u) => {
        const hasTitle = u.title && u.title !== '?' && !/^\?+$/.test((u.title || '').trim());
        const hasSerieVol = (u.series || u.collection) && (u.volume || '').trim();
        return hasTitle || hasSerieVol;
      }).length;
      idBtn.textContent = '🔎 ' + t('ph_identify_all') + ' (' + remainingSearchable + ')';
      const cbBtn2 = document.getElementById('btnShelfCreateBlanks');
      if (cbBtn2) cbBtn2.textContent = '📥 ' + t('ph_create_blanks') + ' (' + remaining + ')';
      renderAll();
      autoBackupTick();
      const msg = quotaStopped >= 0
        ? tm('ph_quota_stopped', found + merged, list.length - quotaStopped)
        : tm('ph_identify_done', found, merged, notFound);
      toast(msg, 9000);
      $('#shelfStatus').textContent = msg;
    });

    $('#shelfResult').querySelectorAll('.shelf-search').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      const q = btn.dataset.q;
      const loc = btn.dataset.loc;
      const parts = loc.includes('·') ? loc.split('·').map((p) => p.trim()) : ['', loc];
      $('#shelfStatus').textContent = t('ph_searching') + ' « ' + q + ' »…';
      const u = (window.__shelfUnknown || []).find((x) => loc === x.loc && x.title && q.startsWith(x.title)) || { title: q, loc, furniture: parts[0], slot: parts[1] };
      try {
        const res = await searchBookByTitle({ ...u, loc, furniture: parts[0], slot: parts[1] });
        if (res) {
          if (res.merged) { toast(tm('ai_merged'), 4000); $('#shelfStatus').textContent = tm('ai_merged'); }
          else { $('#shelfStatus').textContent = t('burst_added') + ' ' + res.item.title; toast(t('burst_added') + ' ' + res.item.title, 3000); }
          renderAll();
        } else {
          // introuvable en ligne: fiche vierge avec le titre lu (completable plus tard par IA)
          const item = blankItem('');
          item.title = q;
          item.furniture = parts[0]; item.slot = parts[1]; item.location = loc;
          store.add(item);
          renderAll();
          openDetail(item.id);
          $('#shelfStatus').textContent = t('ph_notonline');
        }
      } catch { $('#shelfStatus').textContent = t('ph_err'); }
      btn.disabled = false;
    }));

    $('#shelfResult').querySelectorAll('.shelf-move').forEach((btn) => btn.addEventListener('click', () => {
      const it = store.findById(btn.dataset.id);
      if (!it) return;
      it.furniture = btn.dataset.f;
      it.slot = btn.dataset.s;
      it.location = [btn.dataset.f, btn.dataset.s].filter(Boolean).join(' · ');
      store.update(it);
      renderAll();
      btn.closest('.inv-line').className = 'inv-line ok';
      btn.closest('.inv-line').innerHTML = `✅ <b>${esc(it.title)}</b> — ${t('inv_shelved_here')}`;
      toast(tm('loc_updated'));
    }));
  } catch (e) {
    $('#shelfStatus').textContent = (LANG === 'en' ? 'AI error: ' : 'Erreur IA : ') + e.message + (aiCfg.provider === 'ollama' ? (LANG === 'en' ? ' — use a vision model (e.g. llama3.2-vision).' : ' — utilisez un modèle avec vision (ex. llama3.2-vision).') : (LANG === 'en' ? ' — make sure your model handles images (pixtral, gpt-4o…).' : ' — vérifiez que votre modèle gère les images (pixtral, gpt-4o…).'));
  }
});

/* ---------- Reading view: goal, queue, in-progress, random pick ---------- */
function booksFinishedThisYear() {
  const y = String(readingGoals.year);
  return store.items.filter((i) => i.status === 'read' && (i.readFinish || '').startsWith(y));
}

function renderReading() {
  const v = $('#viewReading');
  if (!v) return;
  const done = booksFinishedThisYear().length;
  const target = readingGoals.target || 0;
  $('#goalCard').innerHTML = target
    ? `<h3>🎯 ${t('r_goal_title')} ${readingGoals.year} : ${done}/${target} ${t('r_books')}</h3><div class="heat"><div class="heat-fill" style="width:${Math.min(100, Math.round(done / target * 100))}%"></div></div><p class="hint">${Math.max(0, target - done)} ${t('r_left')} · ${target - done > 0 ? Math.ceil((target - done) / Math.max(1, (new Date(readingGoals.year, 11, 31) - Date.now()) / 86400000)) + ' ' + t('r_pace') : t('r_reached')}</p>`
    : '<p class="hint">' + t('r_nogoal') + '</p>';

  const queue = store.items.filter((i) => i.readNext && !i.disposedHow).sort((a, b) => (a.nextOrder || 0) - (b.nextOrder || 0));
  $('#queueBody').innerHTML = queue.length ? queue.map((it) => `
    <div class="inv-line ok">📖 <b>${esc(it.title)}</b>${it.series ? ' (' + esc(it.series) + (it.volume ? ' T.' + esc(it.volume) : '') + ')' : ''}
      <button class="btn small queue-open" data-id="${esc(it.id)}">${t('r_open')}</button>
      <button class="btn small queue-remove" data-id="${esc(it.id)}">${t('r_remove')}</button></div>`).join('')
    : '<p class="hint">' + t('r_empty') + '</p>';
  $('#queueBody').querySelectorAll('.queue-open').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.id)));
  $('#queueBody').querySelectorAll('.queue-remove').forEach((b) => b.addEventListener('click', () => {
    const it = store.findById(b.dataset.id);
    if (it) { it.readNext = false; store.update(it); renderAll(); }
  }));

  const prog = store.items.filter((i) => i.status === 'reading' && !i.disposedHow);
  $('#inprogressBody').innerHTML = prog.length ? prog.map((it) => {
    const pct = it.currentPage && it.pageCount ? Math.min(100, Math.round(it.currentPage / it.pageCount * 100)) : null;
    return `<div class="inv-line warn">📚 <b>${esc(it.title)}</b>${pct !== null ? ` — ${t('r_page')} ${it.currentPage}/${it.pageCount} (${pct} %) <div class="heat"><div class="heat-fill" style="width:${pct}%"></div></div>` : ` — ${t('r_setpage')} <button class="btn small queue-open2" data-id="${esc(it.id)}">${t('r_open')}</button></div>`}</div>`;
  }).join('') : '<p class="hint">' + t('r_noprog') + '</p>';
  $('#inprogressBody').querySelectorAll('.queue-open2').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.id)));
}

$('#btnSetGoal').addEventListener('click', () => {
  const y = prompt(t('r_goalyear') + ' :', String(readingGoals.year));
  if (y === null) return;
  const tval = prompt(t('r_goalbooks') + ' :', String(readingGoals.target || 50));
  if (tval === null) return;
  readingGoals = { year: parseInt(y, 10) || new Date().getFullYear(), target: parseInt(tval, 10) || 0 };
  saveGoals();
  renderReading();
  toast(tm('goal_saved'));
});

/* Hasard COMPLET : toutes les œuvres non lues, tous supports confondus (livre, film, jeu, musique…) */
$('#btnRandomFull').addEventListener('click', () => {
  const pool = store.items.filter((i) => i.status === 'unread' && !i.disposedHow && !i.loan);
  if (!pool.length) { toast(tm('no_unread')); return; }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const kind = mediumLabel(pick.medium || 'book').replace(/s$/, '');
  if (confirm(tm('random_pick_full', pick.title + (pick.series ? ' (' + pick.series + ')' : ''), kind))) openDetail(pick.id);
});

$('#btnRandomNext').addEventListener('click', () => {
  // Le hasard reflète l'affichage courant : filtres (genre, étagère, support, recherche…) actifs
  let pool = store.items.filter((i) => i.status === 'unread' && !i.disposedHow && !i.loan);
  try { const shown = currentFilter().filter((i) => i.status === 'unread' && !i.disposedHow && !i.loan); if (shown.length) pool = shown; } catch {}
  if (!pool.length) { toast(tm('no_unread')); return; }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (confirm(tm('random_pick', pick.title + (pick.series ? ' (' + pick.series + ')' : '')))) openDetail(pick.id);
});

/* ---------- Reading log (journal daté) in detail ---------- */
function addLogToDetail(it) {
  const logDiv = document.createElement('div');
  logDiv.innerHTML = `${field(t('log_title'), `
    <textarea name="newLogEntry" placeholder="${t('log_new_ph')}…"></textarea>
    <button type="button" class="btn small" id="btnAddLog">➕ ${t('log_add')}</button>
    <div class="hint" id="logHistory">${(it.readingLog || []).slice().reverse().map((l) => `📅 ${esc(l.date)} — ${esc(l.text)}`).join('<br>') || t('log_empty')}</div>`)}`;
  $('#detailForm').appendChild(logDiv);
  logDiv.querySelector('#btnAddLog').addEventListener('click', () => {
    const txt = logDiv.querySelector('[name="newLogEntry"]').value.trim();
    if (!txt) return;
    const fresh = store.findById(editingId);
    if (!fresh) return;
    if (!Array.isArray(fresh.readingLog)) fresh.readingLog = [];
    fresh.readingLog.push({ date: todayISO(), text: txt });
    store.update(fresh);
    logDiv.querySelector('[name="newLogEntry"]').value = '';
    logDiv.querySelector('#logHistory').innerHTML = fresh.readingLog.slice().reverse().map((l) => `📅 ${esc(l.date)} — ${esc(l.text)}`).join('<br>');
    toast(tm('log_added'));
  });
}

/* ---------- Late loans reminder at startup ---------- */
function lateLoansReminder() {
  const today = todayISO();
  const late = store.items.filter((i) => i.loan && i.loan.due && i.loan.due < today);
  const due = store.items.filter((i) => i.loan && i.loan.due === today);
  let msg = '';
  if (late.length) msg = `⏰ ${late.length} prêt(s) en retard : ` + late.slice(0, 3).map((i) => `« ${i.title} » (${i.loan.to})`).join(', ') + (late.length > 3 ? '…' : '');
  else if (due.length) msg = `📅 ${due.length} retour(s) de prêt prévu(s) aujourd'hui.`;
  if (msg) setTimeout(() => toast(msg, 6000), 1200);
}

/* ---------- Help center ---------- */
const APP_VERSION = '2.5.0';
$('#btnHelp').addEventListener('click', () => {
  const v = $('#appVersion');
  if (v) v.textContent = APP_VERSION;
  $('#helpModal').classList.remove('hidden');
});
$('#btnCloseHelp').addEventListener('click', () => $('#helpModal').classList.add('hidden'));

/* ---------- QR codes d'exemplaires ---------- */
function qrDataUrl(text, size) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const cell = Math.max(2, Math.floor(size / (n + 4)));
    const dim = cell * (n + 4);
    const canvas = document.createElement('canvas');
    canvas.width = dim; canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + 2) * cell, (r + 2) * cell, cell, cell);
    }
    return canvas.toDataURL('image/png');
  } catch { return ''; }
}

/* Scan QR => open item: handled in scan flow via BIBLIO: prefix */
function tryHandleQrCode(txt) {
  if (txt && txt.startsWith('BIBLIO:')) {
    const id = txt.slice(7).trim();
    const it = store.findById(id);
    if (it) { openDetail(it.id); return true; }
    toast(tm('qr_unknown'));
    return true;
  }
  return false;
}

/* Etiquettes QR (50x30 avec QR + titre + emplacement) */
$('#btnQrLabels').addEventListener('click', () => {
  // Choix du lot : toute la bibliotheque OU seulement l'affichage courant (filtre/recherche actifs)
  const current = currentFilter().filter((i) => !i.wishlist && !i.disposedHow);
  const all = store.items.filter((i) => !i.wishlist && !i.disposedHow);
  let items = all;
  if (current.length && current.length < all.length) {
    const scope = confirm(tm('qr_scope_prompt', all.length, current.length));
    items = scope ? current : all;
  }
  if (!items.length) { toast(tm('no_items')); return; }
  // choix des champs imprimes (2e ligne): emplacement (defaut), auteur, ISBN ou Dewey
  const field = prompt(tm('qr_field_prompt', 'loc'), 'loc');
  const fieldKey = ({ loc: 'location', author: 'authors', isbn: 'isbn', dewey: 'dewey' })[field] || 'location';
  const labels = items.slice(0, 300).map((i) => {
    const qr = qrDataUrl('BIBLIO:' + i.id, 120);
    const second = fieldKey === 'authors' ? (i.authors || []).join(', ') : (i[fieldKey] || i.location || i.isbn || '');
    return `<div class="qr-label">
      <img src="${qr}" alt="">
      <div class="qr-txt">
        <div class="qr-title">${esc((i.title || '').slice(0, 30))}</div>
        <div class="qr-loc">${esc(second)}</div>
      </div>
    </div>`;
  }).join('');
  const win = window.open('', '_blank');
  if (!win) { toast(tm('allow_popups'), 3000); return; }
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${t('lbl_qr')}</title>
  <style>
    @page { margin: 8mm; }
    body { font-family: "Segoe UI", sans-serif; margin: 0; padding: 8px; }
    .sheet { display: flex; flex-wrap: wrap; gap: 3mm; }
    .qr-label { width: 64mm; height: 25mm; border: 1px dashed #999; display: flex; align-items: center; gap: 2mm; padding: 1.5mm; page-break-inside: avoid; }
    .qr-label img { height: 20mm; width: 20mm; }
    .qr-txt { flex: 1; overflow: hidden; }
    .qr-title { font-size: 7.5pt; font-weight: 600; }
    .qr-loc { font-size: 6.5pt; color: #555; margin-top: 1mm; }
    .no-print { font-size: 8pt; color: #777; margin-bottom: 8px; }
    @media print { .no-print { display: none; } }
  </style></head><body>
  <p class="no-print">${t('lbl_shelf_qr')}</p>
  <div class="sheet">${labels}</div>
  <script>window.onload = () => setTimeout(() => window.print(), 400);<\/script>
  </body></html>`);
  win.document.close();
});

/* ---------- Export UNIMARC (compatibilite catalogues pro) ---------- */
function pad(s, n) { return String(s).padStart(n, '0'); }
function unimarcField(tag, value) {
  if (!value) return '';
  const ind1 = ' ', ind2 = ' ';
  return tag + ind1 + ind2 + String(value) + '\x1e';
}
function itemToUnimarc(it) {
  const f200 = '200  \x1fa' + (it.title || 'Sans titre') + (it.authors.length ? '\x1ff' + it.authors.join(', ') : '');
  const f210 = (it.publisher || it.publishedDate) ? '210  ' + (it.publisher ? '\x1fc' + it.publisher : '') + (it.publishedDate ? '\x1fd' + it.publishedDate : '') : '';
  const f215 = it.pageCount ? '215  \x1fa' + it.pageCount + ' p.' : '';
  const f010 = it.isbn ? '010  \x1fa' + (it.isbn.length === 10 ? it.isbn : it.isbn.replace(/(\d{3})(\d{1,5})(\d{1,3})(\d)/, '$1-$2-$3-$4')) : '';
  const f690 = it.genre ? '690  \x1fa' + it.genre : '';
  const f330 = it.summary ? '330  \x1fa' + it.summary.replace(/\n+/g, ' ').slice(0, 900) : '';
  const f910 = it.location ? '910  \x1fa' + it.location : '';
  return '\x1d' + (f010 ? f010 + '\x1f' : '') + f200 + '\x1e' + (f210 ? f210 + '\x1e' : '') + (f215 ? f215 + '\x1e' : '') + (f330 ? f330 + '\x1e' : '') + (f690 ? f690 + '\x1e' : '') + (f910 ? f910 + '\x1e' : '');
}

$('#btnUnimarc').addEventListener('click', () => {
  const items = store.items.filter((i) => !i.wishlist && !i.disposedHow);
  if (!items.length) { toast(tm('no_items')); return; }
  // Format ISO 2709 (structure UNIMARC echange)
  let out = '';
  for (const it of items) {
    const base = itemToUnimarc(it);
    if (!base) continue;
    const dirLen = 24 + ((base.match(/\x1e/g) || []).length * 12);
    const total = 24 + dirLen + 1 + base.length;
    const leader = pad(total, 5) + 'nam a22     450 ' + pad(base.length, 5);
    out += leader + base + '\n';
  }
  const win = window.open('', '_blank');
  if (!win) { toast(tm('allow_popups'), 3000); return; }
  win.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>' + tm('unimarc_title') + '</title></head><body style="font-family:monospace;white-space:pre-wrap;font-size:11px">' + esc(out).replace(/\x1e/g, '$\n').replace(/\x1f/g, ' | ') + '</body></html>');
  win.document.close();
  const blob = new Blob([out], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bibliotheque-unimarc-${stamp()}.txt`;
  a.click();
  toast(tm('unimarc_exported', items.length), 4000);
});

/* ---------- Export MARC21 XML (SIGB internationaux) ---------- */
function xmlEsc(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function itemToMarc21Xml(it) {
  const df = (tag, code, val) => val ? `    <datafield tag="${tag}" ind1=" " ind2=" ">\n      <subfield code="${code}">${xmlEsc(val)}</subfield>\n    </datafield>` : '';
  return `  <record>\n    <leader>     nam a22     4500</leader>\n    <controlfield tag="008">|||||||fr\\\\\\000 0||||d</controlfield>\n`
    + (it.isbn ? `    <datafield tag="020" ind1=" " ind2=" ">\n      <subfield code="a">${xmlEsc(it.isbn)}</subfield>\n    </datafield>\n` : '')
    + `    <datafield tag="100" ind1="1" ind2=" ">\n      <subfield code="a">${xmlEsc((it.authors || [])[0] || '')}</subfield>\n    </datafield>\n`
    + `    <datafield tag="245" ind1="1" ind2="0">\n      <subfield code="a">${xmlEsc(it.title || 'Sans titre')}</subfield>\n    </datafield>\n`
    + (df('260', 'b', it.publisher) ? `    <datafield tag="260" ind1=" " ind2=" ">\n      <subfield code="b">${xmlEsc(it.publisher)}</subfield>\n${it.publishedDate ? `      <subfield code="c">${xmlEsc(it.publishedDate)}</subfield>\n` : ''}    </datafield>\n` : '')
    + (it.pageCount ? `    <datafield tag="300" ind1=" " ind2=" ">\n      <subfield code="a">${xmlEsc(it.pageCount)} p.</subfield>\n    </datafield>\n` : '')
    + (it.summary ? `    <datafield tag="520" ind1=" " ind2=" ">\n      <subfield code="a">${xmlEsc(it.summary.replace(/\n+/g, ' ').slice(0, 900))}</subfield>\n    </datafield>\n` : '')
    + (it.genre ? `    <datafield tag="650" ind1=" " ind2=" ">\n      <subfield code="a">${xmlEsc(it.genre)}</subfield>\n    </datafield>\n` : '')
    + (it.location ? `    <datafield tag="852" ind1=" " ind2=" ">\n      <subfield code="a">${xmlEsc(it.location)}</subfield>\n    </datafield>\n` : '')
    + `  </record>`;
}

$('#btnMarc21').addEventListener('click', () => {
  const items = store.items.filter((i) => !i.wishlist && !i.disposedHow);
  if (!items.length) { toast(tm('no_items')); return; }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<collection xmlns="http://www.loc.gov/MARC21/slim">\n` + items.map(itemToMarc21Xml).join('\n') + '\n</collection>\n';
  download(`bibliotheque-marc21-${stamp()}.xml`, xml, 'application/xml');
  toast(tm('marc21_exported', items.length), 4000);
});

/* ---------- Import UNIMARC (ISO 2709) — reprise de fonds depuis Koha/PMB ---------- */
function unimarcRecordsFromIso2709(text) {
  const records = [];
  const FS = '\x1f', RS = '\x1e', GS = '\x1d';
  let rest = text;
  while (rest.length > 24) {
    const len = parseInt(rest.slice(0, 5), 10);
    if (!len || isNaN(len) || len > rest.length) break;
    const rec = rest.slice(0, len);
    rest = rest.slice(len);
    if (!rec.includes(RS)) continue;
    const dirEnd = rec.indexOf(RS);
    const directory = rec.slice(24, dirEnd);
    const data = rec.slice(dirEnd + 1);
    const fields = [];
    for (let i = 0; i + 12 <= directory.length; i += 12) {
      const tag = directory.slice(i, i + 3);
      const flen = parseInt(directory.slice(i + 3, i + 7), 10);
      const fpos = parseInt(directory.slice(i + 7, i + 12), 10);
      fields.push({ tag, raw: data.slice(fpos, fpos + flen) });
    }
    const get = (tag, code) => {
      const f = fields.find((x) => x.tag === tag);
      if (!f) return '';
      const parts = f.raw.split(FS).filter(Boolean);
      for (const p of parts) if (p.startsWith(code)) return p.slice(code.length).trim();
      return '';
    };
    const title = get('200', 'a') || get('245', 'a');
    if (!title) continue;
    const isbnRaw = get('010', 'a') || get('020', 'a');
    records.push({
      title,
      authors: [get('200', 'f') || get('100', 'a')].filter(Boolean),
      publisher: get('210', 'c') || get('210', 'b') || get('260', 'b'),
      publishedDate: (get('210', 'd') || get('260', 'c') || '').slice(0, 4),
      pageCount: parseInt(get('215', 'a'), 10) || null,
      summary: get('330', 'a'),
      genre: get('690', 'a'),
      location: get('910', 'a'),
      isbn: normalizeIsbn((isbnRaw || '').replace(/[^0-9Xx]/g, '')),
    });
  }
  return records;
}

$('#btnImportUnimarc').addEventListener('click', () => $('#unimarcFile').click());
$('#unimarcFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const records = unimarcRecordsFromIso2709(text);
    if (!records.length) { toast(tm('unimarc_import_none'), 4000); return; }
    await importJsonData({ items: records });
    toast(tm('unimarc_import_done', records.length), 4000);
  } catch { toast(tm('bad_json'), 3000); }
});

/* ---------- Reservations ---------- */
/* champ 'reserved' dans la fiche: { to, date } — ajoute au bloc pret */
function reservationField(it) {
  const cur = it.reserved || null;
  const html = field(t('f_reserved'), `<input type="text" name="reservedTo" placeholder="${t('f_reserved_ph')}" value="${cur ? esc(cur.to) : ''}">`);
  return html;
}

/* ---------- Catalogue invite (OPAC local protege par PIN) ---------- */
let guestMode = { active: false, pin: '' };
try { guestMode.pin = JSON.parse(localStorage.getItem('biblio.pin.v1') || '""') || ''; } catch {}

function renderGuestCatalog() {
  const v = $('#viewGuest');
  if (!v) return;
  const q = ($('#guestSearch') && $('#guestSearch').value || '').toLowerCase();
  let items = store.items.filter((i) => !i.wishlist && !i.disposedHow);
  if (q) items = items.filter((i) => [i.title, i.authors.join(', '), i.isbn, i.series].join(' ').toLowerCase().includes(q));
  items = items.slice(0, 120);
  v.innerHTML = `
    <h2>👁️ ${t('guest_title2')}</h2>
    <p class="hint">${t('guest_hint')} ${(guestMode.pin ? t('guest_protected') : t('guest_nopin') + ' (☰ → 👁️)')}. ${t('guest_out')}</p>
    <input type="search" id="guestSearch" placeholder="${t('guest_search')}" value="${esc(q)}">
    <div class="grid" style="margin-top:14px">
      ${items.map((i) => `<div class="card"><div class="meta" style="padding:10px 12px">
        <h3>${esc(i.title)}</h3>
        <p>${esc(i.authors.join(', ') || '')}</p>
        ${i.loan ? '<p class="hint">📤 ' + t('guest_loaned') + ' ' + esc(i.loan.to) + '</p>' : ''}
        ${i.location ? '<p class="hint">📍 ' + esc(i.location) + '</p>' : ''}
      </div></div>`).join('')}
    </div>`;
  const gs = $('#guestSearch');
  if (gs) gs.addEventListener('input', renderGuestCatalog);
}

/* ---------- Mode démo : bibliothèque d'exemple (prospects/pro) ---------- */
function demoLibraryItems() {
  const base = [
    { isbn: '9782070541270', title: 'Le Trône de fer, tome 1', authors: ['George R. R. Martin'], publisher: "J'ai lu", publishedDate: '2003', pageCount: 704, genre: 'Fantasy', dewey: '813', series: 'Le Trône de fer', volume: '1', seriesTotal: 15, seriesState: 'ongoing', status: 'read', rating: 5, favorite: true, summary: 'L\'intégrale des nouvelles et romans qui ont inspiré la série — Winterfell, les complots, le mur.', location: 'Bibliothèque salon · Étagère 1', furniture: 'Bibliothèque salon', slot: 'Étagère 1', tags: ['démo'], price: 14.9 },
    { isbn: '9782221110003', title: "Toutes ces choses qu'on ne s'est pas dites", authors: ['Marc Levy'], publisher: 'R. Laffont', publishedDate: '2008', pageCount: 425, genre: 'Roman', dewey: '843', status: 'read', rating: 4, summary: 'Un père et une fille, un secret de trente ans.', location: 'Bibliothèque salon · Étagère 1', furniture: 'Bibliothèque salon', slot: 'Étagère 1', tags: ['démo'], loan: { to: 'Claire', date: todayISO(), due: todayISO() } },
    { isbn: '9782505141358', title: 'Saint Seiya — Rerise of Poseidon, tome 1', authors: ['Tsunakan Suda'], publisher: 'Kana', publishedDate: '2026', pageCount: 192, genre: 'Manga', dewey: '741.5', series: 'Saint Seiya — Rerise of Poseidon', volume: '1', seriesTotal: 3, seriesState: 'ongoing', status: 'reading', rating: 4, currentPage: 84, location: 'Bibliothèque salon · Étagère 2', furniture: 'Bibliothèque salon', slot: 'Étagère 2', tags: ['démo'], collection: 'Shonen Kana', format: 'Broché', price: 8.1, audience: 'Dès 10 ans' },
    { isbn: '9782070413119', title: '1984', authors: ['George Orwell'], publisher: 'Gallimard', publishedDate: '1972', pageCount: 376, genre: 'Dystopie', dewey: '823', status: 'unread', rating: 0, summary: 'Big Brother vous regarde.', location: 'Bibliothèque salon · Étagère 2', furniture: 'Bibliothèque salon', slot: 'Étagère 2', tags: ['démo'], readNext: true, wishlist: false },
    { isbn: '9782211030389', title: 'L\'Alchimiste', authors: ['Paulo Coelho'], publisher: 'Gallimard', publishedDate: '1996', pageCount: 188, genre: 'Roman', status: 'read', rating: 3, location: 'Meuble 2 · Rayon A', furniture: 'Meuble 2', slot: 'Rayon A', tags: ['démo'] },
    { isbn: '9782012101881', title: 'Le Petit Prince', authors: ['Antoine de Saint-Exupéry'], publisher: 'Gallimard', publishedDate: '2015', pageCount: 96, genre: 'Conte', dewey: '843', status: 'read', rating: 5, favorite: true, summary: 'Un aviateur, un renard, une rose.', location: 'Meuble 2 · Rayon A', furniture: 'Meuble 2', slot: 'Rayon A', tags: ['démo'], editionType: 'first' },
  ];
  return base.map((b) => ({ ...blankItem(b.isbn), ...b, addedAt: todayISO(), srcFound: ['démo'] }));
}

$('#btnGuest').addEventListener('click', () => {
  if (!store.items.length && confirm(tm('demo_offer'))) {
    for (const it of demoLibraryItems()) store.add(it);
    renderAll();
    toast(tm('demo_loaded'), 4000);
  }
  if (guestMode.pin) {
    const entry = prompt('Code PIN du catalogue invité :');
    if (entry === null) return;
    if (entry !== guestMode.pin) { toast(tm('bad_pin')); return; }
  } else if (confirm(tm('no_pin'))) {
    const pin = prompt('Choisissez un code PIN (chiffres) :');
    if (pin) { guestMode.pin = pin; localStorage.setItem('biblio.pin.v1', JSON.stringify(pin)); }
  }
  document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
  $('#viewGuest').classList.remove('hidden');
  $('#mainNav').classList.add('hidden');
  $('#guestBtns').classList.remove('hidden');
  renderGuestCatalog();
});

$('#btnExitGuest').addEventListener('click', () => {
  $('#guestBtns').classList.add('hidden');
  $('#viewGuest').classList.add('hidden');
  $('#viewGrid').classList.remove('hidden');
  renderAll();
});

/* ---------- Language toggle ---------- */
/* Bascule langue: gere par onclick inline (__toggleLang dans i18n.js) — plus robuste mobile */

/* ---------- Import local d'images de couverture (contourne le hotlinking bloque) ---------- */
function compressImageFile(file, maxDim, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      let dataUrl;
      try { dataUrl = canvas.toDataURL('image/jpeg', 0.90); } catch { dataUrl = fr.result; }
      cb(dataUrl, width, height);
    };
    img.onerror = () => cb(fr.result, 0, 0);
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}

function wireCoverImport(fileInputId, targetFieldName) {
  const input = document.getElementById(fileInputId);
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const status = document.getElementById('importCoverStatus');
    if (status) status.textContent = 'Compression de l\u2019image\u2026';
    compressImageFile(file, 600, (dataUrl, w, h) => {
      const fieldEl = document.getElementById('detailForm').querySelector(`[name="${targetFieldName}"]`);
      if (fieldEl) fieldEl.value = dataUrl;
      if (status) status.textContent = `Image int\u00e9gr\u00e9e (${w}\u00d7${h} px) \u2014 cliquez \u00ab Enregistrer \u00bb pour la fixer dans la fiche.`;
    });
  });
}

wireCoverImport('importCoverFront', 'cover');
wireCoverImport('importCoverBack', 'coverBack');

/* ---------- Onboarding (premier lancement) ---------- */
const OB_KEY = 'biblio.onboarded.v1';
let obStep = 1;

function obApplyLang() {
  const m = { obTitle1: ['ob_s1_t', 'obText1', 'ob_s1_x'], obTitle2: ['ob_s2_t', 'obText2', 'ob_s2_x'], obTitle3: ['ob_s3_t', 'obText3', 'ob_s3_x'] };
  for (const [id, [tk, tx, xk]] of Object.entries(m)) {
    const el = document.getElementById(id); if (el) el.textContent = t(tk);
    const ex = document.getElementById(tx); if (ex) ex.textContent = t(xk);
  }
  const btns = { obNext: 'ob_next', obPrev: 'ob_prev', obDone: 'ob_done', obSkip: 'ob_skip' };
  for (const [id, k] of Object.entries(btns)) { const el = document.getElementById(id); if (el) el.textContent = t(k); }
  const w = document.querySelector('#onboardingModal h2'); if (w) w.textContent = t('ob_welcome') + ' · ' + (LANG === 'fr' ? 'Welcome!' : 'Bienvenue !');
}

function obShow(step) {
  obStep = step;
  [1, 2, 3].forEach((n) => { const el = document.getElementById('obStep' + n); if (el) el.classList.toggle('hidden', n !== step); });
  const prev = document.getElementById('obPrev');
  const next = document.getElementById('obNext');
  const done = document.getElementById('obDone');
  if (prev) prev.classList.toggle('hidden', step === 1);
  if (next) next.classList.toggle('hidden', step === 3);
  if (done) done.classList.toggle('hidden', step !== 3);
  obApplyLang();
}

function obClose() {
  const m = document.getElementById('onboardingModal');
  if (m) m.classList.add('hidden');
  try { localStorage.setItem(OB_KEY, '1'); } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  let seen = null;
  try { seen = localStorage.getItem(OB_KEY); } catch {}
  if (seen) return;
  const m = document.getElementById('onboardingModal');
  if (!m) return;
  m.classList.remove('hidden');
  obShow(1);
  const next = document.getElementById('obNext');
  const prev = document.getElementById('obPrev');
  const done = document.getElementById('obDone');
  const skip = document.getElementById('obSkip');
  if (next) next.addEventListener('click', () => obShow(Math.min(3, obStep + 1)));
  if (prev) prev.addEventListener('click', () => obShow(Math.max(1, obStep - 1)));
  if (done) done.addEventListener('click', obClose);
  if (skip) skip.addEventListener('click', obClose);
});

/* ---------- Relais BnF/Fnac (worker Cloudflare) ---------- */
async function fetchRelay(isbn) {
  const base = apiKeys.relay;
  if (!base) return null;
  try {
    const variants = [isbn];
    const alt = isbn.length === 13 ? isbn13to10(isbn) : isbn10to13(isbn);
    if (alt) variants.push(alt);
    for (const v of variants) {
      const r = await fetchWithTimeout(`${base}/?isbn=${encodeURIComponent(v)}`, 12000);
      if (!r.ok) continue;
      const data = await r.json();
      if (data && data.found) {
        return {
          source: data.source || 'relay',
          title: data.title || '',
          authors: Array.isArray(data.authors) ? data.authors : (data.authors ? [data.authors] : []),
          publisher: data.publisher || '',
          publishedDate: data.date || '',
          pageCount: data.pages || null,
          summary: data.summary || '',
          cover: data.cover || '',
        };
      }
    }
  } catch {}
  return null;
}
