'use strict';

/* ---------- Utils ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);

/* Parse JSON tolérant : les IA renvoient parfois des caractères de contrôle bruts
   (sauts de ligne dans les chaînes) qui cassent JSON.parse. On assainit avant l'analyse. */
function parseAiJson(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  let txt = m ? m[0] : '';
  // (pas de return anticipé: même sans accolades, le sauvetage regex ci-dessous tente l'extraction)
  // echapper les caracteres de controle non valides dans les strings JSON (0x00-0x1F sauf echappements deja presents)
  // echapper TOUS les caracteres de controle y compris saut de ligne (0x0A) — casse JSON.parse dans les strings
  txt = txt.replace(/[\x00-\x1F]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  try { return JSON.parse(txt); } catch {}
  // 2e tentative: remplacer par des espaces
  try { return JSON.parse(txt.replace(/[\x00-\x1F]+/g, ' ')); } catch {}
  // 3e tentative (sauvetage): extraire par patterns ce que l'IA a lu (JSON tronqué, texte libre, guillemets JSON)
  const out = {};
  const grab = (re, keys) => {
    const mt = String(raw || '').match(re);
    if (mt && mt[1] && mt[1].trim()) for (const k of keys) if (!out[k]) out[k] = mt[1].trim();
  };
  // style JSON: "title":"Valeur" (le champ peut être en tête même si le JSON est tronqué)
  grab(/"title"\s*:\s*"([^"\n\r]{1,120})/i, ['title']);
  grab(/"authors?"\s*:\s*\[?"?([^"\n\r\],]{1,80})/i, ['authors']);
  grab(/"isbn"\s*:\s*"?([0-9Xx-]{10,17})/i, ['isbn']);
  grab(/"publisher"\s*:\s*"([^"\n\r]{1,80})/i, ['publisher']);
  grab(/"collection"\s*:\s*"([^"\n\r]{1,80})/i, ['collection']);
  grab(/"summary"\s*:\s*"([^"\n\r]{1,600})/i, ['summary']);
  // style texte libre: "Titre: Valeur"
  grab(/(?:titre|title)\s*[:\u00a0]\s*([^\n\r;]{1,120})/i, ['title']);
  grab(/(?:auteur|author)\s*[:\u00a0]\s*([^\n\r;]{1,80})/i, ['authors']);
  grab(/(?:isbn|ean)\s*[:\u00a0]\s*([0-9Xx-]{10,17})/i, ['isbn']);
  grab(/(?:éditeur|editeur|publisher)\s*[:\u00a0]\s*([^\n\r;]{1,80})/i, ['publisher']);
  if (out.authors) out.authors = [out.authors];
  if (Object.keys(out).length) return out;
  return null;
}

/* 🔬 Diagnostic IA dans une modale COPIABLE (alert() ne permet pas de copier sur mobile) */
function showDiagModal(title, text) {
  const m = document.getElementById('diagModal');
  if (!m) { alert(title + '\n\n' + text); return; }
  document.getElementById('diagModalTitle').textContent = title;
  const ta = document.getElementById('diagModalText');
  ta.value = String(text || '').slice(0, 3000);
  m.classList.remove('hidden');
}
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'diagCopyBtn') {
    const ta = document.getElementById('diagModalText');
    const done = () => { document.getElementById('diagCopyBtn').textContent = '✅ Copié'; setTimeout(() => { const b = document.getElementById('diagCopyBtn'); if (b) b.textContent = '📋 Copier'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done).catch(() => { ta.select(); done(); });
    else { ta.focus(); ta.select(); done(); }
  }
});

/* 🚨 Capteur d'erreurs global: toute exception runtime affiche un toast —
   plus jamais de code mort silencieux (boutons sans handler, etc.) */
window.addEventListener('error', (e) => {
  try { toast('⚠️ Erreur interne: ' + String(e.message || '?').slice(0, 120), 8000); } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  try { const m = e && e.reason && e.reason.message ? e.reason.message : String(e && e.reason || '?'); toast('⚠️ Erreur async: ' + m.slice(0, 120), 8000); } catch {}
});

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
    // Garde anti-collision: deux fiches avec le même id seraient inséparables
    // (édition/suppression simultanées — bug réel rapporté par l'utilisateur)
    if (item.id && this.items.some((x) => x.id === item.id)) {
      item.id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
    }
    this.items.push(item);
    this.save();
    return item; // les flux multimédia utilisent la valeur de retour (media.id, applyShelveMode(media)…)
  },
  remove(id) {
    // Ne supprimer qu'UNE entrée: si des doublons d'id existent (données héritées du bug de collision),
    // filter-all les emporterait d'un coup — splice du premier match seulement
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.save();
    return true;
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

/* Open Library: rate limit 1 req/s anonyme, ~3 req/s identifié — throttle 350 ms partagé
   (lookup ISBN, recherche, couvertures). Guide d'orchestration docs/orchestration-api.md. */
let __olLast = 0;
async function olThrottle() {
  const wait = 350 - (Date.now() - __olLast);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  __olLast = Date.now();
}

async function fetchOpenLibrary(isbn) {
  try {
    await olThrottle();
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

/* 🎬 TMDB (The Movie Database) — source de référence films/séries (gratuite, clé sur themoviedb.org).
   Retrieval-constrained : l\u0027app va CHERCHER le film (titre, réalisateur, acteurs, synopsis, année, affiche)
   au lieu de demander à l\u0027IA de le deviner. */
function tmdbKeyParam() { return apiKeys.tmdb ? ('&api_key=' + encodeURIComponent(apiKeys.tmdb)) : ''; }

async function fetchTmdbByTitle(title, year, lang) {
  if (!apiKeys.tmdb || !title) return null;
  const lg = lang || 'fr-FR';
  try {
    const q = encodeURIComponent(title);
    const y = year ? ('&year=' + encodeURIComponent(year)) : '';
    const r = await fetchWithTimeout(`https://api.themoviedb.org/3/search/multi?query=${q}${y}&language=${lg}${tmdbKeyParam()}`, 15000);
    if (!r.ok) return null;
    const data = await r.json();
    const hit = (data.results || []).find((x) => x.media_type === 'movie' || x.media_type === 'tv');
    if (!hit) return null;
    // crédits (réalisateur, acteurs)
    const cr = await fetchWithTimeout(`https://api.themoviedb.org/3/${hit.media_type}/${hit.id}/credits?language=fr-FR${tmdbKeyParam()}`, 15000);
    let director = null, cast = [];
    if (cr.ok) {
      const credits = await cr.json();
      const dir = (credits.crew || []).find((c) => c.job === 'Director' || c.job === 'Series Director');
      if (dir) director = dir.name;
      cast = (credits.cast || []).slice(0, 5).map((c) => c.name);
    }
    const meta = {
      title: hit.title || hit.name || '',
      authors: [director, ...cast].filter(Boolean),
      medium: hit.media_type === 'movie' ? 'film' : 'series',
      publishedDate: String(hit.release_date || hit.first_air_date || '').slice(0, 4),
      summary: hit.overview || '',
      publisher: 'TMDB',
      cover: hit.poster_path ? ('https://image.tmdb.org/t/p/w500' + hit.poster_path) : '',
      srcFound: ['TMDB'],
    };
    return meta.title ? meta : null;
  } catch { return null; }
}

/* 🎮 IGDB (Internet Game Database) — source de référence jeux vidéo (gratuite via app Twitch).
   Retrieval-constrained : l'app va CHERCHER le jeu (titre, studio, année, synopsis, couverture). */
let __igdbToken = null; let __igdbTokenExp = 0;
async function igdbToken() {
  if (!apiKeys.igdbId || !apiKeys.igdbSecret) return null;
  if (__igdbToken && Date.now() < __igdbTokenExp) return __igdbToken;
  try {
    const r = await fetchWithTimeout(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(apiKeys.igdbId)}&client_secret=${encodeURIComponent(apiKeys.igdbSecret)}&grant_type=client_credentials`, 15000, { method: 'POST' });
    if (!r.ok) return null;
    const data = await r.json();
    __igdbToken = data.access_token;
    __igdbTokenExp = Date.now() + (data.expires_in - 60) * 1000;
    return __igdbToken;
  } catch { return null; }
}

async function fetchIgdbByTitle(title) {
  const tok = await igdbToken();
  if (!tok || !title) return null;
  try {
    // Rate limit IGDB : 4 req/s max — throttle 250 ms (guide d'orchestration docs/orchestration-api.md)
    const waitI = 250 - (Date.now() - (fetchIgdbByTitle.__last || 0));
    if (waitI > 0) await new Promise((r) => setTimeout(r, waitI));
    fetchIgdbByTitle.__last = Date.now();
    const r = await fetchWithTimeout('https://api.igdb.com/v4/games', 15000, {
      method: 'POST',
      headers: { 'Client-ID': apiKeys.igdbId, 'Authorization': 'Bearer ' + tok, 'Accept': 'application/json' },
      body: `search "${title.replace(/"/g, '')}"; fields name,summary,first_release_date,cover.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,genres.name,platforms.name; limit 3;`,
    });
    if (!r.ok) return null;
    const hits = await r.json();
    const hit = (hits || []).find((h) => h.name && h.name.toLowerCase().includes(String(title).trim().toLowerCase().substring(0, Math.min(15, hit_len(title))))) || (hits || [])[0];
    if (!hit) return null;
    const dev = (hit.involved_companies || []).find((c) => c.developer);
    const pub = (hit.involved_companies || []).find((c) => c.publisher);
    // Mapping plateforme IGDB → liste fermée de l'appli (PLATFORMS [code, label])
    const igdbPlats = (hit.platforms || []).map((p) => p.name || '');
    const platMatch = PLATFORMS.find(([c, l]) => igdbPlats.some((n) => n.toLowerCase().includes(l.toLowerCase())));
    const meta = {
      title: hit.name || '',
      authors: dev && dev.company ? [dev.company.name] : [],
      medium: 'game',
      publishedDate: hit.first_release_date ? String(new Date(hit.first_release_date * 1000).getFullYear()) : '',
      summary: hit.summary || '',
      publisher: pub && pub.company ? pub.company.name : '',
      cover: hit.cover ? ('https://images.igdb.com/igdb/image/upload/t_cover_big/' + hit.cover.image_id + '.jpg') : '',
      genre: (hit.genres || []).map((g) => g.name).join(' / '),
      platform: platMatch ? platMatch[0] : '',
      srcFound: ['IGDB'],
    };
    return meta.title ? meta : null;
  } catch { return null; }
}

/* 🍙 AniList (graphql.anilist.co) — source de référence mangas (gratuite, sans clé, 90 req/min).
   Couvre: titre multi-langue, auteurs (scénario/dessin via staff), genres, synopsis, couverture, date.
   Guide d'orchestration: docs/orchestration-api.md — AniList = meilleure source manga. */
async function fetchAniListByTitle(title) {
  if (!title || String(title).startsWith('EAN ') || String(title).startsWith('ISBN ')) return null;
  try {
    const q = 'query ($s: String) { Page(perPage: 3) { media (type: MANGA, search: $s) { title { romaji english native } genres description coverImage { large } startDate { year } format staff (perPage: 4) { edges { role node { name { full } } } } } } }';
    const r = await fetchWithTimeout('https://graphql.anilist.co', 12000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: q, variables: { s: String(title).trim() } }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const hits = (data && data.data && data.data.Page && data.data.Page.media) || [];
    const normT = (x) => String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const hit = hits.find((h) => normT(h.title && (h.title.romaji || h.title.english)).includes(normT(title).substring(0, 12))) || hits[0];
    if (!hit) return null;
    const staffEdges = (hit.staff && hit.staff.edges) || [];
    const authors = staffEdges.map((e) => (e.node && e.node.name && e.node.name.full) || '').filter(Boolean).slice(0, 3);
    const meta = {
      title: (hit.title && (hit.title.english || hit.title.romaji)) || '',
      authors,
      medium: 'manga',
      publishedDate: (hit.startDate && hit.startDate.year) ? String(hit.startDate.year) : '',
      summary: (hit.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      cover: (hit.coverImage && hit.coverImage.large) || '',
      genre: (hit.genres || []).join(' / '),
      publisher: '',
      srcFound: ['AniList'],
    };
    return meta.title ? meta : null;
  } catch { return null; }
}

/* 🎲 BoardGameGeek XML API2 — LA source jeux de société (rate limit strict ~1 req/5s, throttle intégré).
   Couvre: auteurs, année, joueurs min/max, âge, durée, catégories, mécanismes, complexité, image. */
let __bggLast = 0;
async function bggThrottle() {
  const wait = 5000 - (Date.now() - __bggLast);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  __bggLast = Date.now();
}

/* Requête BGG avec gestion des statuts spécifiques (livrable résilience du documentalist):
   202 = « Still preparing » (file d'attente BGG) → 1 retry après 5 s
   401/403 = token invalide/expiré → toast explicite (jamais une erreur technique brute)
   429 = rate limit → backoff
   5xx = BGG surchargé → 1 retry */
async function bggRequest(endpoint, params) {
  const url = 'https://boardgamegeek.com/xmlapi2/' + endpoint + '?' + new URLSearchParams(params).toString();
  const headers = { 'Authorization': 'Bearer ' + apiKeys.bggToken };
  const doFetch = () => fetchWithTimeout(url, 12000, { headers });
  let res = await doFetch();
  if (res.status === 202) { await new Promise((r) => setTimeout(r, 5000)); await bggThrottle(); res = await doFetch(); }
  if (res.status === 500 || res.status === 503) { await new Promise((r) => setTimeout(r, 4000)); await bggThrottle(); res = await doFetch(); }
  if (res.status === 401 || res.status === 403) { toast('BGG : token invalide ou expiré — vérifiez ☰→🔑 (boardgamegeek.com/applications)', 5000); return null; }
  if (res.status === 429) { toast('BGG : rate limit atteint (1 req/5s) — réessayez dans un instant', 4000); return null; }
  if (!res.ok) return null;
  return new DOMParser().parseFromString(await res.text(), 'application/xml');
}

async function fetchBggByTitle(title) {
  if (!apiKeys.bggToken) return null; // BGG exige un token Bearer depuis 07/2025 (boardgamegeek.com/applications)
  if (!title || String(title).startsWith('EAN ') || String(title).startsWith('ISBN ')) return null;
  try {
    await bggThrottle();
    const sdoc = await bggRequest('search', { query: String(title).trim(), type: 'boardgame' });
    if (!sdoc) return null;
    const items = Array.from(sdoc.querySelectorAll('item'));
    if (!items.length) return null;
    const normT = (x) => String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const pick = items.find((i) => { const n = i.querySelector('name'); return n && normT(n.getAttribute('value')).includes(normT(title).substring(0, 12)); }) || items[0];
    const bggId = pick.getAttribute('id');
    if (!bggId) return null;
    await bggThrottle();
    const tdoc = await bggRequest('thing', { id: bggId, stats: '1' });
    if (!tdoc) return null;
    const thing = tdoc.querySelector('item');
    if (!thing) return null;
    const val = (name, attr) => { const el = thing.querySelector(name); return el ? (attr ? el.getAttribute(attr) : el.textContent) : ''; };
    // ⚠️ Le XML BGG utilise type="boardgamedesigner" (pas d'attribut relation) — bug v2.35.0 corrigé
    const designers = Array.from(thing.querySelectorAll('link[type="boardgamedesigner"]')).map((l) => l.getAttribute('value')).slice(0, 3);
    const publishers = Array.from(thing.querySelectorAll('link[type="boardgamepublisher"]')).map((l) => l.getAttribute('value')).slice(0, 1);
    const categories = Array.from(thing.querySelectorAll('link[type="boardgamecategory"]')).map((l) => l.getAttribute('value')).slice(0, 4);
    const mechanics = Array.from(thing.querySelectorAll('link[type="boardgamemechanic"]')).map((l) => l.getAttribute('value')).slice(0, 4);
    const minP = val('minplayers', 'value'); const maxP = val('maxplayers', 'value');
    const cwEl = thing.querySelector('ratings averageweight');
    const cw = cwEl && cwEl.getAttribute('value') ? parseFloat(cwEl.getAttribute('value')) : 0;
    const complexity = cw > 0 ? (cw >= 3 ? 'lourd' : cw >= 2 ? 'moyen' : 'leger') : '';
    // mapping sur les listes fermées de l'appli (fiche JDS): tranches de durée + paliers d'âge
    const pt = parseInt(val('playingtime', 'value'), 10) || 0;
    const playDuration = pt > 0 ? (pt <= 15 ? '-15' : pt <= 30 ? '15-30' : pt <= 60 ? '30-60' : pt <= 120 ? '60-120' : '120+') : '';
    const ma = parseInt(val('minage', 'value'), 10);
    const ageMin = Number.isFinite(ma) ? (ma >= 18 ? '18+' : ma >= 14 ? '14+' : ma >= 12 ? '12+' : ma >= 10 ? '10+' : ma >= 8 ? '8+' : ma >= 6 ? '6+' : '3+') : '';
    const mechTxt = mechanics.length ? ('\nMécanismes : ' + mechanics.join(' / ')) : '';
    const meta = {
      title: (thing.querySelector('name') && thing.querySelector('name').getAttribute('value')) || '',
      authors: designers,
      medium: 'boardgame',
      publishedDate: val('yearpublished', 'value') || '',
      summary: ((val('description') || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#10;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) + mechTxt).trim(),
      cover: val('image') || '',
      genre: categories.join(' / '),
      players: (minP && maxP) ? (minP === maxP ? minP : (minP + '-' + maxP)) : '',
      ageMin,
      playDuration,
      complexity,
      publisher: publishers[0] || '',
      srcFound: ['BGG'],
    };
    return meta.title ? meta : null;
  } catch { return null; }
}

/* 🌐 Wikidata SPARQL — fallback transversal (CC0, sans clé, ~1 req/s, throttle intégré).
   Dernier recours de la cascade: BnF → Google Books → Open Library → Banque → Relais FR → Wikidata (docs/orchestration-api.md). */
let __wdLast = 0;
async function wdThrottle() {
  const wait = 1100 - (Date.now() - __wdLast);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  __wdLast = Date.now();
}

/* 🎵 Discogs (api.discogs.com) — fallback musique par excellence (16 M de sorties, vinyles/CD).
   Token personnel requis (discogs.com/settings/developers) — 60 req/min authentifié, throttle 1/s intégré.
   Recherche: barcode normalisé d'abord, fallback q= plein texte (codes-barres saisis avec espaces). */
let __dcLast = 0;
async function discogsThrottle() {
  const wait = 1000 - (Date.now() - __dcLast);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  __dcLast = Date.now();
}

// Mapping format Discogs → liste fermée de l'appli (référentiel musique)
const DISCOGS_CARRIERS = { 'Vinyl': 'vinyle-33', 'LP': 'vinyle-33', '7"': 'vinyle-45', 'CD': 'cd', 'Cassette': 'k7-audio', 'SACD': 'sacd', 'DVD': 'dvd' };

async function discogsRequest(path, params) {
  if (!apiKeys.discogsToken) return null;
  await discogsThrottle();
  const url = 'https://api.discogs.com' + path + '?' + new URLSearchParams(params).toString();
  const r = await fetchWithTimeout(url, 12000, { headers: { 'Authorization': 'Discogs token=' + apiKeys.discogsToken, 'Accept': 'application/vnd.discogs.v2.discogs+json' } });
  if (r.status === 429) { toast('Discogs : rate limit atteint — réessayez dans un instant', 4000); return null; }
  if (r.status === 401 || r.status === 403) { toast('Discogs : token invalide — vérifiez ☰→🔑 (discogs.com/settings/developers)', 5000); return null; }
  if (!r.ok) return null;
  return r.json();
}

async function fetchDiscogsRelease(id) {
  const d = await discogsRequest('/releases/' + id, {});
  if (!d || !d.title) return null;
  const artistes = (d.artists || []).map((a) => String(a.name || '').replace(/ \(\d+\)$/, ''));
  const fmt = ((d.formats || [])[0] || {}).name || '';
  const carrier = DISCOGS_CARRIERS[fmt] || '';
  return {
    title: d.title,
    authors: artistes.length ? [artistes.join(' & ')] : [],
    medium: 'music',
    publisher: ((d.labels || [])[0] || {}).name || '',
    publishedDate: d.year ? String(d.year) : '',
    genre: [...(d.genres || []), ...(d.styles || [])].slice(0, 4).join(' / '),
    carrier,
    cover: (d.images && d.images[0] && (d.images[0].uri || '').replace('http://', 'https://')) || '',
    summary: '',
    srcFound: ['Discogs'],
  };
}

async function fetchDiscogsByBarcodeOrTitle({ barcode, title, artiste }) {
  // Priorité 1: code-barres normalisé (sans espaces/tirets), fallback q= plein texte
  if (barcode) {
    const code = String(barcode).replace(/[\s-]/g, '');
    let data = await discogsRequest('/database/search', { barcode: code, type: 'release' });
    if (!data || !(data.results || []).length) data = await discogsRequest('/database/search', { q: code, type: 'release' });
    if (data && (data.results || []).length) return fetchDiscogsRelease(data.results[0].id);
  }
  // Priorité 2: titre (+ artiste)
  if (title) {
    const params = { type: 'release', release_title: String(title).trim() };
    if (artiste) params.artist = String(artiste).trim();
    const data = await discogsRequest('/database/search', params);
    if (data && (data.results || []).length) return fetchDiscogsRelease(data.results[0].id);
  }
  return null;
}

/* 💾 CrossRef (api.crossref.org) — source de référence ressources numériques (articles, revues, actes).
   Gratuite, sans clé, CORS ouvert. Throttle 10 req/s prudent. Lookup DOI direct ou recherche floue par titre. */
let __crLast = 0;
async function crossrefThrottle() {
  const wait = 100 - (Date.now() - __crLast);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  __crLast = Date.now();
}

async function crossrefRequest(path) {
  await crossrefThrottle();
  const r = await fetchWithTimeout('https://api.crossref.org' + path, 12000, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) return null;
  return r.json();
}

function parseCrossref(item) {
  if (!item) return null;
  const a0 = (item.author || [])[0];
  const dateParts = (item['published-print'] && item['published-print']['date-parts'] && item['published-print']['date-parts'][0])
    || (item['published-online'] && item['published-online']['date-parts'] && item['published-online']['date-parts'][0])
    || (item.issued && item.issued['date-parts'] && item.issued['date-parts'][0]) || [];
  const revue = Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title'];
  return {
    title: Array.isArray(item.title) ? item.title[0] : (item.title || ''),
    authors: a0 ? [((a0.family || '') + ' ' + (a0.given || '')).trim()] : [],
    medium: 'digital',
    publisher: item.publisher || '',
    publishedDate: dateParts[0] ? String(dateParts[0]) : '',
    genre: revue || item.type || '',
    summary: item.abstract ? String(item.abstract).replace(/<[^>]+>/g, ' ').trim() : '',
    srcFound: ['CrossRef'],
  };
}

async function fetchCrossrefByDoiOrTitle({ doi, title, auteur }) {
  // Priorité 1: DOI direct (normalisé — retirer https://doi.org/ si collé)
  if (doi) {
    const doiClean = String(doi).replace(/^https?:\/\/doi\.org\//i, '').trim();
    const data = await crossrefRequest('/works/' + encodeURIComponent(doiClean));
    if (data && data.message) return parseCrossref(data.message);
  }
  // Priorité 2: recherche bibliographique floue par titre (+ auteur)
  if (title) {
    const params = new URLSearchParams({ 'query.bibliographic': String(title).trim(), rows: '3' });
    if (auteur) params.set('query.author', String(auteur).trim());
    const data = await crossrefRequest('/works?' + params.toString());
    if (data && data.message && (data.message.items || []).length) return parseCrossref(data.message.items[0]);
  }
  return null;
}

async function fetchWikidataByIsbn(isbn) {
  if (!isbn) return null;
  try {
    await wdThrottle();
    const q = 'SELECT ?itemLabel ?authorLabel ?publisherLabel ?date WHERE { ?item wdt:P212 "' + isbn + '" . OPTIONAL { ?item wdt:P50 ?author } OPTIONAL { ?item wdt:P123 ?publisher } OPTIONAL { ?item wdt:P577 ?date } SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". } } LIMIT 1';
    const url = 'https://query.wikidata.org/sparql?format=json&origin=*&query=' + encodeURIComponent(q);
    const r = await fetchWithTimeout(url, 12000);
    if (!r.ok) return null;
    const data = await r.json();
    const row = data && data.results && data.results.bindings && data.results.bindings[0];
    if (!row || !row.itemLabel) return null;
    return {
      title: row.itemLabel.value || '',
      authors: row.authorLabel ? [row.authorLabel.value] : [],
      publisher: (row.publisherLabel && row.publisherLabel.value) || '',
      publishedDate: row.date ? String(new Date(row.date.value).getFullYear()) : '',
      summary: '',
      cover: '',
      srcFound: ['Wikidata'],
    };
  } catch { return null; }
}
function hit_len(t) { return String(t || '').length; }

async function fetchGoogleBooks(isbn) {
  try {
    const r = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${gbKeyParam()}`);
    if (!r.ok) return null;
    const data = await r.json();
    if (data.error) return null;
    if (data.totalItems === 0 || !data.items) return null;
    // Un même ISBN peut renvoyer plusieurs items (éditions/réimpressions):
    // filtrer par correspondance EXACTE de l'identifiant (ISBN_13 ou ISBN_10) avant de prendre le 1er
    const wantType = isbn.length === 13 ? 'ISBN_13' : 'ISBN_10';
    const exact = data.items.find((item) => {
      const ids = (item.volumeInfo && item.volumeInfo.industryIdentifiers) || [];
      return ids.some((i) => i.type === wantType && i.identifier === isbn);
    });
    return normalizeGoogleMeta(exact || data.items[0]);
  } catch { return null; }
}

async function fetchCoverFallback(isbn) {
  if (!isbn) return '';
  const variants = [isbn];
  const alt = isbn.length === 13 ? isbn13to10(isbn) : isbn10to13(isbn);
  if (alt) variants.push(alt);
  for (const v of variants) {
    try {
      await olThrottle();
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
    if (!e) { __metaCacheMisses++; return null; }
    if (Date.now() - e.at > META_CACHE_TTL) { delete all[isbn]; localStorage.setItem(META_CACHE_KEY, JSON.stringify(all)); __metaCacheMisses++; return null; }
    // compteur d'accès (LRU) + statistiques de hit (santé du cache, livrable documentalist)
    e.n = (e.n || 0) + 1; __metaCacheHits++;
    all[isbn] = e; localStorage.setItem(META_CACHE_KEY, JSON.stringify(all));
    return e.meta;
  } catch { return null; }
}

/* Santé du cache (dashboard allégé — PWA mono-utilisateur): hits/misses + entrées.
   Affiché dans les diagnostics (showDiagModal) et la console. */
let __metaCacheHits = 0, __metaCacheMisses = 0;
function metaCacheStats() {
  let n = 0;
  try { n = Object.keys(JSON.parse(localStorage.getItem(META_CACHE_KEY) || '{}')).length; } catch {}
  const total = __metaCacheHits + __metaCacheMisses;
  return { entrees: n, hits: __metaCacheHits, misses: __metaCacheMisses, tauxHit: total ? Math.round(100 * __metaCacheHits / total) : null };
}

function metaCacheSet(isbn, meta) {
  if (!isbn || !meta || !meta.title) return;
  try {
    const all = JSON.parse(localStorage.getItem(META_CACHE_KEY) || '{}');
    // hygiene: purge expirees, puis eviction LRU si le cache depasse 500 entrees
    // (evite le quota localStorage sur les fonds de plusieurs milliers de documents)
    const keys = Object.keys(all);
    if (keys.length > 500) {
      for (const k of keys) if (Date.now() - all[k].at > META_CACHE_TTL) delete all[k];
      const rest = Object.keys(all);
      if (rest.length > 500) {
        rest.sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
        for (const k of rest.slice(0, rest.length - 500)) delete all[k];
      }
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
  // Dernier recours de la cascade (docs/orchestration-api.md): Wikidata SPARQL par ISBN-13 (P212), CC0
  const wd = await fetchWikidataByIsbn(isbn.length === 13 ? isbn : (isbn10to13(isbn) || isbn));
  if (wd && wd.title) {
    if (!primary.meta) return { ...wd, isbn, srcFound: [...found, 'Wikidata'] };
    const mergedWd = { ...primary.meta };
    for (const [k, v] of Object.entries(wd)) {
      const cur = mergedWd[k];
      const empty = cur === '' || cur === null || (Array.isArray(cur) && !cur.length) || cur === 'Sans titre';
      if (empty && v) mergedWd[k] = v;
    }
    return { ...mergedWd, srcFound: [...found, 'Wikidata'] };
  }
  return primary.meta ? { ...primary.meta, srcFound: found } : null;
}

async function fetchOpenLibrarySearch(isbn) {
  try {
    await olThrottle();
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

/* Catalogage par derivation: cree le TOME SUIVANT a partir de la fiche courante.
   On garde tout ce qui est constant dans une serie (serie, auteurs, editeur, medium, genre, pays,
   langue, collection, sens de lecture, sujets, etagere) et on reinitialise ce qui change a chaque tome:
   ISBN (rescan), numero (incremente), photos recto/verso, resumes, cote (a regenerer). */

/* Extrait un numero de tome colle en fin de titre (IA ou saisie): « X Tome 3 », « X t.3 », « X Vol. 3 »
   -> titre propre + champ volume. En bibliotheconomie le titre reste celui de l'oeuvre, le numero vit dans son champ. */
function extractVolumeFromTitle(it) {
  if (!it.title) return false;
  const m = String(it.title).match(/^(.*?)[\s]*[-:·]?[\s]*(?:tome|t\.|vol\.?|volume|#)\s*(\d{1,3})\s*$/i);
  if (!m || !m[1].trim()) return false;
  const base = m[1].replace(/[\s,:·-]+$/, '').trim();
  if (base.length < 2) return false;
  it.title = base;
  if (!it.volume) it.volume = m[2];
  return true;
}

function duplicateForNextVolume(src) {
  const it = JSON.parse(JSON.stringify(src));
  it.id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  const vol = String(it.volume || '').match(/\d+/);
  it.volume = vol ? String(parseInt(vol[0], 10) + 1).padStart(String(vol[0]).length, '0') : it.volume;
  it.isbn = ''; it.isbn10 = '';
  it.cover = ''; it.coverBack = ''; it.backCoverText = ''; it.summary = '';
  it.cote = '';
  it.status = 'unread'; it.rating = 0; it.currentPage = null; it.readingLog = [];
  it.relations = []; it.notes = '';
  it.recordState = ''; delete it.sharedAt;
  it.aiAssisted = false; it.fieldSources = {};
  it.loan = null; it.loanHistory = [];
  it.acquiredAt = ''; it.acquiredPrice = null; it.acquiredFrom = '';
  it.favorite = false; it.addedAt = new Date().toISOString();
  store.add(it);
  renderAll();
  openDetail(it.id);
  toast((LANG === 'en' ? 'Next volume created \u2014 scan the ISBN, add the covers, then save' : "Tome suivant cr\u00e9\u00e9 \u2014 scannez l'ISBN, ajoutez les photos, puis enregistrez"), 6000);
  setTimeout(() => { const tEl = document.querySelector('#detailForm [name="isbn"]'); if (tEl) { tEl.focus(); tEl.select(); } }, 300);
}

function blankItem(isbn) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    isbn,
    title: '', subtitle: '', authors: [], publisher: '', publishedDate: '',
    pageCount: null, language: '', categories: [], summary: '', backCoverText: '', cover: '',
    coverBack: '', shelves: [], tags: [], rating: 0, notes: '', status: 'unread',
    medium: 'book', mediaSubtype: '', carrier: '', platform: '', gameMode: '', readingDirection: '', periodicity: '', collectionState: '', seasonsCount: null, episodesCount: null, channel: '', formation: '', instrument: '', esar: '', mechanic: '', players: '', ageMin: '', playDuration: '', complexity: '', softwareCategory: '', licenseType: '', accessibility: '', awards: '', cote: '', relations: [], subjects: [], zone: '', audioVersion: '', audioLangs: '', imageFormat: '', country: '', volume: '', series: '', location: '', furniture: '', slot: '', duplicateOf: false,
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


/* 🗑️ Purge des fiches vides: scans non résolus (titre « ISBN xxx »/« EAN xxx », sans auteurs ni couverture).
   Nettoie les échecs de scan en masse — chaque fiche supprimée reste annulable via le bouton Annuler. */

/* Détecte un titre majoritairement en écriture non latine (hébreu, arabe, chinois…) —
   signal classique d'une notice erronée renvoyée par une source pour un ISBN français.
   On n'écrase rien: on AVERTIT, l'humain vérifie la fiche. */
function isNonLatinTitle(title) {
  const t = String(title || '');
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (!letters.length) return false;
  const latin = letters.match(/[a-zA-ZÀ-ÿ]/g) || [];
  return latin.length / letters.length < 0.3;
}

function purgeBlankFiches() {
  const targets = store.items.filter((x) => ((x.title || '').match(/^(ISBN|EAN) \\d+/)) && !(x.authors || []).length && !x.cover && !x.disposedHow);
  if (!targets.length) { toast(LANG === 'en' ? 'No blank records to purge' : 'Aucune fiche vide à purger', 3500); return; }
  if (!confirm((LANG === 'en' ? 'Delete ' : 'Supprimer ') + targets.length + (LANG === 'en' ? ' blank record(s) (scans without title/authors/cover)? Undo available.' : ' fiche(s) vide(s) (scans sans titre/auteurs/couverture) ? Annulation possible.'))) return;
  saveBulkSnapshot(targets);
  for (const t of targets) store.remove(t.id);
  renderAll();
  toast(LANG === 'en' ? targets.length + ' blank record(s) deleted' : targets.length + ' fiche(s) vide(s) supprimée(s)', 4000);
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

/* ═══ RÉFÉRENTIEL MULTIMÉDIA (4 axes) — types de contenu, supports, éditions ═══
   D'après le système de classification documentaire : type (l'œuvre) / support (le contenant)
   / édition (la version) / numérotation (position — champ volume + saison/épisode existants). */
const MEDIA_TYPES = [
  ['film', 'Film (cinéma)'], ['film-cm', 'Court-métrage'], ['film-an', 'Film d\u0027animation'],
  ['film-an-jp', 'Film d\u0027animation japonais (anime)'], ['film-doc', 'Documentaire de cinéma'],
  ['telefilm', 'Téléfilm'], ['miniserie', 'Mini-série'], ['webserie', 'Web-série'],
  ['serie', 'Série télévisée'], ['serie-an', 'Série d\u0027animation'], ['serie-an-jp', 'Anime (série japonaise)'],
  ['doc', 'Documentaire'], ['doc-his', 'Documentaire historique'], ['doc-nat', 'Documentaire nature'],
  ['doc-sci', 'Documentaire scientifique'], ['doc-bio', 'Documentaire biographique'],
  ['rep', 'Reportage'], ['mag-tv', 'Magazine télévisé'],
  ['spectacle', 'Spectacle filmé'], ['concert', 'Concert filmé'], ['opera', 'Opéra'], ['ballet', 'Ballet'],
  ['humour', 'One-man-show / humour'], ['theatre', 'Théâtre filmé'],
  ['clip', 'Clip musical'], ['comedie-musicale', 'Comédie musicale'],
  ['jeunesse', 'Jeunesse / dessin animé jeunesse'], ['makingof', 'Making-of / bonus'],
  ['formation', 'Formation / tutoriel'], ['interview', 'Interview / débat / conférence'],
];
const CARRIERS = [
  ['vhs', 'VHS (cassette)'], ['vhs-c', 'VHS-C (caméscope)'], ['svhs', 'S-VHS'], ['betamax', 'Betamax'],
  ['laserdisc', 'LaserDisc'], ['minidv', 'MiniDV (bande numérique)'],
  ['dvd', 'DVD'], ['dvd-r', 'DVD-R (gravé)'], ['dvd-3d', 'DVD 3D'], ['hd-dvd', 'HD DVD'],
  ['blu-ray', 'Blu-ray'], ['blu-ray-3d', 'Blu-ray 3D'], ['blu-ray-uhd', 'Blu-ray 4K Ultra HD'],
  ['vcd', 'VCD'], ['divx', 'DivX / Xvid (fichier)'], ['mp4', 'MP4 / MKV (fichier)'],
  ['streaming', 'Streaming (VOD/SVOD)'], ['demat', 'Achat numérique (EST)'],
  ['vinyle-33', 'Vinyle 33 tours'], ['vinyle-45', 'Vinyle 45 tours'], ['vinyle-78', 'Vinyle 78 tours'],
  ['k7-audio', 'Cassette audio'], ['cd', 'CD audio'], ['cd-r', 'CD-R (gravé)'], ['sacd', 'SACD'],
  ['dvd-audio', 'DVD-Audio'], ['mp3', 'MP3 / FLAC (fichier audio)'], ['streaming-audio', 'Streaming audio'],
  ['cartouche', 'Cartouche (jeu)'], ['cd-rom', 'CD-ROM (jeu)'], ['gd-rom', 'GD-ROM (Dreamcast)'],
  ['dvd-rom', 'DVD-ROM (jeu)'], ['gc-disc', 'Disque GameCube'], ['wii-disc', 'Disque Wii'],
  ['blu-rom', 'Blu-ray (jeu PS3/PS4/Xbox One)'], ['blu-uhd-rom', 'Blu-ray UHD (PS5/Xbox Series)'], ['umd', 'UMD (PSP)'],
  ['disquette', 'Disquette'], ['cassette-jv', 'Cassette (données, C64/ZX)'],
  ['demat-jv', 'Jeu dématérialisé (Steam/GOG/Epic)'], ['demat-psn', 'Téléchargement PlayStation Store'],
  ['demat-xbox', 'Téléchargement Xbox Store'], ['demat-eshop', 'Téléchargement Nintendo eShop'],
  ['demat-mobile', 'Application mobile'], ['cloud-jv', 'Cloud gaming'], ['abo-jv', 'Abonnement (Game Pass/PS Plus)'],
  ['livre-cd', 'Livre + CD'], ['livre-dvd', 'Livre + DVD'],
];
const EDITIONS = [
  ['standard', 'Standard'], ['simple', 'Simple (1 disque)'], ['digipack', 'Digipack'], ['steelbook', 'Steelbook'],
  ['special', 'Édition spéciale'], ['collector', 'Collector'], ['deluxe', 'Deluxe'], ['ultime', 'Ultime'],
  ['limitee', 'Limitée'], ['numerotee', 'Numérotée'], ['signee', 'Signée / dédicacée'],
  ['coffret', 'Coffret'], ['coffret-int', 'Coffret intégral'], ['coffret-saison', 'Coffret saison'],
  ['anniversaire', 'Édition anniversaire'], ['remasterisee', 'Remasterisée / restaurée'],
  ['directors-cut', 'Director\u0027s Cut'], ['extended', 'Version longue'], ['theatrical', 'Version cinéma'],
  ['goty', 'Game of the Year (jeu + DLC)'], ['remastered', 'Remasterisée (jeu)'], ['remake', 'Remake'],
  ['poche', 'Poche (manga)'], ['perfect', 'Perfect Edition (kanzenban FR)'], ['reedition', 'Réédition (manga)'], ['specimen', 'Spécimen (manga)'],
  ['int-col', 'Intégrale collector (BD)'], ['luxe', 'Édition de luxe (BD)'],
  ['integrale', 'Intégrale (série complète en 1 volume)'], ['saison', 'Saison (série TV)'],
  ['gatefold', 'Gatefold (pochette ouvrante, vinyle)'], ['box-set', 'Box set (coffret disques)'], ['extended-ed', 'Édition étendue (titres bonus)'],
  ['pro', 'Professionnelle (logiciel)'], ['entreprise', 'Entreprise (logiciel)'],
  ['education', 'Éducation (logiciel)'], ['etudiant', 'Étudiant (logiciel)'], ['home', 'Famille / Personnel (logiciel)'],
  ['oem', 'OEM (préinstallé)'], ['trial', 'Démo / Essai (logiciel)'], ['gratuite', 'Gratuite / Freeware'],
  ['initiation', 'Boîte d\u0027initiation (JDR/wargame)'], ['kickstarter', 'Kickstarter (financement participatif)'],
  ['big-box', 'Big Box (jeu + extensions)'], ['extension-js', 'Extension (jeu de société)'],
  ['campagne', 'Campagne scénarisée'], ['scenario', 'Scénarios (JDR)'], ['demo', 'Démo / essai'],
  ['abonnement', 'Édition abonnés (presse)'], ['internationale', 'Édition internationale (presse)'],
  ['regionale', 'Édition régionale (presse)'], ['numero-special', 'Numéro spécial (presse)'],
  ['compilation', 'Compilation (plusieurs jeux)'], ['day-one', 'Day One / précommande'],
  ['digital-deluxe', 'Digital Deluxe (jeu)'], ['complete-jv', 'Complète (jeu + extensions)'],
  ['first', '1ʳᵉ édition'], ['rare', 'Rare'], ['incunable', 'Incunable'],
];

/* ═══ RÉFÉRENTIEL JEUX VIDÉO — genres (OLAC/UW), plateformes, modes ═══ */
const GAME_GENRES = [
  ['act', 'Action'], ['act-aa', 'Action-Aventure'], ['act-plat', 'Plateforme'], ['act-fight', 'Combat (Fighting)'],
  ['act-brawl', 'Beat\u0027em up'], ['act-stealth', 'Infiltration'], ['act-surv', 'Survie (action)'], ['act-fps', 'FPS (tir subjectif)'],
  ['act-moba', 'MOBA'], ['adv', 'Aventure'], ['adv-pc', 'Point & Click'],
  ['rpg', 'Jeu de rôle (RPG)'], ['rpg-j', 'JRPG'], ['rpg-a', 'Action-RPG'], ['rpg-t', 'RPG tactique'],
  ['rpg-mmo', 'MMORPG'], ['rpg-rl', 'Roguelike / Roguelite'], ['rpg-sand', 'Sandbox RPG'],
  ['str', 'Stratégie'], ['str-rts', 'Stratégie temps réel (RTS)'], ['str-tbs', 'Stratégie au tour par tour'], ['str-4x', '4X'],
  ['sim', 'Simulation'], ['sim-ges', 'Gestion / Construction'], ['sim-vol', 'Simulation de vol'], ['sim-course', 'Course'],
  ['sim-sport', 'Sport'], ['sim-vie', 'Simulation de vie'],
  ['puz', 'Puzzle / Réflexion'], ['mus', 'Musique / Rythme'], ['par', 'Party game'],
  ['edu', 'Éducatif'], ['arc', 'Arcade'], ['cas', 'Casual'],
  ['hor', 'Horreur'], ['surv-hor', 'Survival horror'], ['sf', 'Science-fiction'], ['fan', 'Fantasy'],
];
/* Pays de production — liste fermée ISO 3166-1 alpha-2 (labels FR).
   Grands pays producteurs d'abord (cinéma/musique/jeux/littérature), puis le reste mondial. */
/* Langues — liste fermée ISO 639-1 (labels FR). Le champ décrit la langue du média:
   langue d'écriture pour un livre/BD/manga, langue originale pour un film/album,
   pistes audio pour un DVD (champ séparé audioLangs). */
const LANGUAGES = [
  ['fr', 'Français'], ['en', 'Anglais'], ['ja', 'Japonais'], ['ko', 'Coréen'], ['zh', 'Chinois'], ['de', 'Allemand'],
  ['es', 'Espagnol'], ['it', 'Italien'], ['nl', 'Néerlandais'], ['pt', 'Portugais'], ['ru', 'Russe'],
  ['ar', 'Arabe'], ['la', 'Latin'], ['grc', 'Grec ancien'], ['mul', 'Multilingue'],
];

/* Normalisation des codes langue: les APIs renvoient de l'ISO 639-2/B (fre, eng, jpn...),
   le référentiel LANGUAGES est en ISO 639-1 (fr, en, ja...) — on mappe pour l'affichage et le save. */
const LANG_NORM = { fre: 'fr', fra: 'fr', eng: 'en', jpn: 'ja', ger: 'de', spa: 'es', ita: 'it', dut: 'nl', por: 'pt', rus: 'ru', ara: 'ar', chi: 'zh', kor: 'ko' };
const normLang = (v) => (LANG_NORM[String(v || '').toLowerCase().trim()] || (v || ''));

const COUNTRIES = [
  ['FR', 'France'], ['US', 'États-Unis'], ['GB', 'Royaume-Uni'], ['JP', 'Japon'], ['KR', 'Corée du Sud'], ['CN', 'Chine'],
  ['IT', 'Italie'], ['ES', 'Espagne'], ['DE', 'Allemagne'], ['CA', 'Canada'], ['BE', 'Belgique'], ['CH', 'Suisse'],
  ['AU', 'Australie'], ['NZ', 'Nouvelle-Zélande'], ['AT', 'Autriche'], ['DK', 'Danemark'], ['FI', 'Finlande'], ['NO', 'Norvège'],
  ['NL', 'Pays-Bas'], ['SE', 'Suède'], ['IE', 'Irlande'], ['PT', 'Portugal'], ['PL', 'Pologne'], ['GR', 'Grèce'],
  ['RU', 'Russie'], ['UA', 'Ukraine'], ['CZ', 'Tchéquie'], ['HU', 'Hongrie'], ['RO', 'Roumanie'], ['TR', 'Turquie'],
  ['IN', 'Inde'], ['ID', 'Indonésie'], ['TH', 'Thaïlande'], ['VN', 'Vietnam'], ['PH', 'Philippines'], ['MY', 'Malaisie'],
  ['TW', 'Taïwan'], ['HK', 'Hong Kong'], ['KP', 'Corée du Nord'], ['MN', 'Mongolie'],
  ['EG', 'Égypte'], ['MA', 'Maroc'], ['DZ', 'Algérie'], ['TN', 'Tunisie'], ['SN', 'Sénégal'], ['ZA', 'Afrique du Sud'],
  ['NG', 'Nigeria'], ['IL', 'Israël'], ['AE', 'Émirats arabes unis'], ['IR', 'Iran'], ['SA', 'Arabie saoudite'],
  ['BR', 'Brésil'], ['AR', 'Argentine'], ['MX', 'Mexique'], ['CL', 'Chili'], ['CO', 'Colombie'], ['PE', 'Pérou'],
  ['CU', 'Cuba'], ['BO', 'Bolivie'], ['VE', 'Venezuela'],
];

const PLATFORMS = [
  ['PC', 'PC'], ['PS5', 'PlayStation 5'], ['PS4', 'PlayStation 4'], ['PS3', 'PlayStation 3'], ['PS2', 'PlayStation 2'], ['PS1', 'PlayStation'], ['PSP', 'PSP'], ['VITA', 'PS Vita'],
  ['XSX', 'Xbox Series X|S'], ['XB1', 'Xbox One'], ['X360', 'Xbox 360'], ['XBOX', 'Xbox'],
  ['NSW', 'Nintendo Switch'], ['WIIU', 'Wii U'], ['WII', 'Wii'], ['NGC', 'GameCube'], ['N64', 'Nintendo 64'],
  ['SNES', 'Super Nintendo'], ['NES', 'NES'], ['NDS', 'Nintendo DS'], ['3DS', 'Nintendo 3DS'], ['GBA', 'Game Boy Advance'], ['GB', 'Game Boy'],
  ['MD', 'Mega Drive'], ['SMS', 'Master System'], ['SAT', 'Saturn'], ['DC', 'Dreamcast'],
  ['A2600', 'Atari 2600'], ['AMIGA', 'Amiga'], ['C64', 'Commodore 64'], ['MOBILE', 'Mobile (iOS/Android)'],
];
const GAME_MODES = [
  ['solo', 'Solo (1 joueur)'], ['multi-loc', 'Multijoueur local'], ['multi-onl', 'Multijoueur en ligne'],
  ['coop-loc', 'Coopératif local'], ['coop-onl', 'Coopératif en ligne'], ['mmo', 'MMO'], ['compet', 'Compétitif (e-sport)'],
];

/* ═══ RÉFÉRENTIEL MANGA — démographie (critère médiathèque), genres, formats éditoriaux japonais ═══ */
const MANGA_DEMOS = [
  ['kodomo', 'Kodomo (enfants 6-10 ans)'], ['shonen', 'Shonen (garçons ados 10-18)'],
  ['shojo', 'Shojo (filles ados 10-15)'], ['seinen', 'Seinen (jeunes adultes 18-40)'],
  ['josei', 'Josei (femmes jeunes adultes)'], ['seijin', 'Seijin (adultes, contenu explicite)'],
];
const MANGA_GENRES = [
  ['act', 'Action'], ['av', 'Aventure'], ['rom', 'Romance'], ['com', 'Comédie'], ['dra', 'Drame'],
  ['fan', 'Fantasy'], ['sf', 'Science-fiction'], ['hor', 'Horreur'], ['myst', 'Mystère / Enquête'],
  ['spo', 'Sport'], ['sli', 'Slice of life'], ['ise', 'Isekai'], ['mec', 'Mecha'], ['sen', 'Sentai'],
  ['mah', 'Mahou shoujo (filles magiques)'], ['hist', 'Historique'], ['guerre', 'Guerre'],
  ['psy', 'Psychologique'], ['cuis', 'Cuisine'], ['mus', 'Musique'], ['art-mart', 'Arts martiaux'],
  ['yak', 'Yakuza / Crime'], ['yaoi', 'Yaoi / Boys\u0027 Love (BL)'], ['yuri', 'Yuri / Girls\u0027 Love'],
  ['bara', 'Bara / Men\u0027s Love'], ['ecchi', 'Ecchi (suggestif)'],
];
const MANGA_FORMATS = [
  ['revue', 'Revue de prépublication (Jump…)'], ['revue-num', 'Revue numérique'],
  ['tankobon', 'Tankobon (volume standard)'], ['bunkoban', 'Bunkoban (format poche compact)'],
  ['kanzenban', 'Kanzenban (édition complète, grand format)'], ['a5', 'Grand format A5 (deluxe)'],
  ['b6', 'Format B6 (standard japonais)'], ['omnibus', 'Omnibus (plusieurs tomes en 1)'],
  ['demat-manga', 'Numérique (Kindle/Kobo)'], ['webtoon', 'Webtoon (lecture verticale)'],
];

/* ═══ RÉFÉRENTIEL BD — familles éditoriales (Thema/RVM), genres, formats franco-belges/comics ═══ */
const BD_FAMILIES = [
  ['bd-fb', 'BD franco-belge (album, héros récurrent)'], ['bd-rg', 'Roman graphique (one-shot littéraire)'],
  ['bd-com', 'Comics (tradition américaine)'], ['bd-str', 'Recueil de strips (presse)'],
  ['bd-web', 'Webcomic (publié en ligne)'], ['bd-doc', 'BD documentaire / reportage'],
  ['bd-aut', 'BD d\u0027auteur / alternative'],
];
const BD_GENRES = [
  ['act', 'Action / Aventure'], ['hum', 'Humour'], ['pol', 'Policier / Thriller'], ['sf', 'Science-fiction'],
  ['fan', 'Fantasy'], ['fant', 'Fantastique'], ['hist', 'Historique'], ['wes', 'Western'],
  ['bio', 'Biographique'], ['auto', 'Autobiographique'], ['doc', 'Documentaire'], ['rom', 'Romance'],
  ['dra', 'Drame / Psychologique'], ['sup', 'Super-héros'], ['jeun', 'Jeunesse'],
];
const BD_FORMATS = [
  ['alb-car', 'Album cartonné (format franco-belge)'], ['alb-sou', 'Album souple'],
  ['alb-48', 'Format 48 CC (standard historique)'], ['alb-gr', 'Grand format'], ['alb-pet', 'Petit format / poche'],
  ['int-bd', 'Intégrale (plusieurs tomes en 1)'], ['omnibus-bd', 'Omnibus (3-en-1 et plus)'], ['coffret-bd', 'Coffret'],
  ['comic-book', 'Comic book (fascicule US)'], ['tpb', 'Trade Paperback (recueil souple US)'],
  ['hc', 'Hardcover (recueil cartonné US)'], ['strip-r', 'Recueil de strips'],
  ['demat-bd', 'Numérique (PDF/EPUB/CBR)'], ['webtoon-bd', 'Webtoon (lecture verticale)'],
];

/* ═══ RÉFÉRENTIEL PRESSE — natures éditoriales, périodicité, formats de diffusion, états de collection ═══ */
const PRESS_TYPES = [
  ['quotidien', 'Quotidien (Le Monde…)'], ['hebdomadaire', 'Hebdomadaire (Télérama…)'],
  ['magazine', 'Magazine (Paris Match, Geo…)'], ['revue', 'Revue spécialisée (savante, culturelle)'],
  ['bulletin', 'Bulletin (institutionnel, associatif)'], ['annuaire', 'Annuaire (publication annuelle)'],
  ['presse-spe', 'Presse spécialisée (secteur, loisir)'],
];
const PRESS_PERIODICITIES = [
  ['quot', 'Quotidienne'], ['hebdo', 'Hebdomadaire'], ['bimen', 'Bimensuelle'], ['men', 'Mensuelle'],
  ['bimes', 'Bimestrielle'], ['trim', 'Trimestrielle'], ['sem', 'Semestrielle'], ['ann', 'Annuelle'],
  ['irr', 'Irrégulière'], ['hors-serie', 'Hors-série'],
];
const PRESS_FORMATS = [
  ['papier', 'Papier (format courant)'], ['tabloid', 'Tabloïd'], ['berliner', 'Berlinois (Le Monde)'],
  ['broadsheet', 'Grand format (historique)'], ['relie', 'Volume relié (recueil de numéros)'],
  ['microfilm', 'Microfilm / microfiche'], ['fascicule', 'Fascicule (revue savante)'],
  ['num-presse', 'Numérique (PDF/EPUB)'], ['web-presse', 'Site web / lecture en ligne'],
  ['app-presse', 'Application mobile'], ['base-presse', 'Base de données (Cairn…)'],
];
const COLLECTION_STATES = [
  ['en-cours', 'Collection en cours (abonnement actif)'], ['arrete', 'Collection arrêtée'],
  ['complet', 'Collection complète (depuis le n°1)'], ['partiel', 'Collection partielle (lacunes)'],
  ['pilon', 'Pilon (retrait prévu)'],
];

/* ═══ RÉFÉRENTIEL LIVRE — familles éditoriales (fiction vs documentaire), genres, formats ═══ */
const BOOK_FAMILIES = [
  ['roman', 'Roman (fiction narrative)'], ['essai', 'Essai / Réflexion'],
  ['biographie', 'Biographie'], ['autobiographie', 'Autobiographie / Mémoires'],
  ['documentaire', 'Documentaire (vulgarisation)'], ['beau-livre', 'Beau-livre / Album illustré'],
  ['jeunesse', 'Album jeunesse'], ['poesie', 'Poésie'], ['theatre', 'Théâtre'],
  ['guide', 'Guide pratique (méthodologie)'],
];
const BOOK_GENRES = [
  ['pol', 'Policier / Thriller'], ['sf', 'Science-fiction'], ['fan', 'Fantasy'], ['fant', 'Fantastique'],
  ['hist', 'Historique'], ['romance', 'Romance / Sentimental'], ['av', 'Aventure'], ['hum', 'Humour'],
  ['dra', 'Drame / Psychologique'], ['phi', 'Philosophie'], ['rel', 'Religion / Spiritualité'],
  ['sci', 'Sciences (vulgarisation)'], ['his-doc', 'Histoire (documentaire)'], ['geo', 'Géographie / Voyage'],
  ['art', 'Arts (peinture, musique, cinéma)'], ['soc', 'Société / Politique / Économie'], ['sco', 'Scolaire / Parascolaire'],
];
const BOOK_FORMATS = [
  ['broche', 'Broché (grand format)'], ['poche-livre', 'Poche'], ['relie-livre', 'Relié (couverture rigide)'],
  ['beau-format', 'Beau format (papier qualité)'], ['album-livre', 'Album (grand format illustré)'],
  ['semi-poche', 'Semi-poche'], ['coffret-livre', 'Coffret (plusieurs volumes)'],
  ['epub', 'EPUB (liseuses)'], ['pdf', 'PDF (format fixe)'], ['mobi', 'MOBI / Kindle'],
  ['audio', 'Livre audio (MP3/M4B)'], ['web-livre', 'Lecture en ligne (plateforme)'],
];

/* ═══ RÉFÉRENTIEL SÉRIES — familles éditoriales, genres, formats de diffusion, saisons/épisodes ═══ */
const SERIES_FAMILIES = [
  ['ser-fic', 'Série de fiction (Breaking Bad…)'], ['ser-an', 'Série d\u0027animation (occidentale)'],
  ['ser-an-jp', 'Anime (série japonaise)'], ['ser-min', 'Mini-série (2-6 épisodes, histoire complète)'],
  ['ser-feu', 'Feuilleton (épisodes courts, quotidien)'], ['ser-soa', 'Soap opera (sentimental, longue durée)'],
  ['ser-web', 'Web-série (diffusée sur internet)'], ['ser-doc', 'Série documentaire (Planète Terre…)'],
  ['ser-docu-fi', 'Docufiction'], ['ser-tel', 'Téléfilm / fiction unitaire TV'],
  ['ser-rea', 'Téléréalité / divertissement (Koh-Lanta…)'], ['ser-jeu', 'Jeu / divertissement (quiz)'],
];
const SERIES_GENRES = [
  ['pol', 'Policier / Thriller'], ['sf', 'Science-fiction'], ['fan', 'Fantasy'], ['fant', 'Fantastique'],
  ['hist', 'Historique'], ['romance', 'Romance / Sentimental'], ['com', 'Comédie'], ['dra', 'Drame / Psychologique'],
  ['av', 'Aventure'], ['guerre', 'Guerre'], ['wes', 'Western'], ['bio', 'Biographique'],
  ['jud', 'Judiciaire'], ['med', 'Médical'], ['sco', 'Scolaire / Adolescent'], ['fam', 'Familial'],
  ['sup', 'Super-héros'], ['mus', 'Musical'], ['spo', 'Sport'],
];
const SERIES_FORMATS = [
  ['vhs', 'VHS (patrimoine)'], ['dvd', 'DVD'], ['blu-ray', 'Blu-ray'], ['blu-ray-uhd', 'Blu-ray 4K Ultra HD'],
  ['cof-dvd', 'Coffret DVD (saison/intégrale)'], ['cof-blu', 'Coffret Blu-ray'], ['cof-uhd', 'Coffret 4K'],
  ['streaming', 'Streaming SVOD (Netflix…)'], ['dl-est', 'Téléchargement (achat numérique)'],
  ['vod', 'Vidéo à la demande (location)'], ['catchup', 'Replay / Catch-up (France.tv…)'], ['web-serie', 'Web (YouTube, plateforme)'],
];

/* ═══ RÉFÉRENTIEL MUSIQUE — classes PCDM (standard médiathèque), formats MusicBrainz, formation/instrument ═══ */
const MUSIC_CLASSES = [
  ['1.1', 'PCDM 1.1 — Blues'], ['1.2', 'PCDM 1.2 — Gospel'], ['1.3', 'PCDM 1.3 — Jazz'],
  ['1.4', 'PCDM 1.4 — Soul / Funk'], ['1.5', 'PCDM 1.5 — Hip-hop / Rap'], ['1.6', 'PCDM 1.6 — Reggae'],
  ['2.1', 'PCDM 2.1 — Rock\u0027n\u0027roll'], ['2.2', 'PCDM 2.2 — Pop'], ['2.3', 'PCDM 2.3 — Folk / Country'],
  ['2.4', 'PCDM 2.4 — Rock progressif'], ['2.5', 'PCDM 2.5 — Hard rock / Métal'], ['2.6', 'PCDM 2.6 — Punk'],
  ['2.7', 'PCDM 2.7 — New wave'], ['2.9', 'PCDM 2.9 — Variétés rock'],
  ['3.1', 'PCDM 3.1 — Musique de chambre'], ['3.2', 'PCDM 3.2 — Orchestrale'], ['3.24', 'PCDM 3.24 — Symphonie'],
  ['3.35', 'PCDM 3.35 — Opéra'], ['3.36', 'PCDM 3.36 — Opérette'], ['3.4', 'PCDM 3.4 — Vocale sacrée'],
  ['4.2', 'PCDM 4.2 — Ambient / Trip-hop'], ['4.3', 'PCDM 4.3 — House'], ['4.4', 'PCDM 4.4 — Techno / Trance'],
  ['4.7', 'PCDM 4.7 — Jungle / Drum\u0027n\u0027bass'], ['4.8', 'PCDM 4.8 — Dance'],
  ['5', 'PCDM 5 — Musiques fonctionnelles (relaxation, ambiance)'],
  ['6', 'PCDM 6 — Musique et cinéma (BOF)'],
  ['8', 'PCDM 8 — Chanson francophone'], ['8.615', 'PCDM 8.615 — Rap français'], ['8.62', 'PCDM 8.62 — Rock français'],
  ['9.1', 'PCDM 9.1 — Afrique'], ['9.2', 'PCDM 9.2 — Maghreb / Moyen-Orient'], ['9.3', 'PCDM 9.3 — Asie'],
  ['9.6', 'PCDM 9.6 — France régionale'], ['9.8', 'PCDM 9.8 — Amérique du Nord'], ['9.9', 'PCDM 9.9 — Amérique latine'],
];
const MUSIC_FORMATS = [
  ['vinyle-33', 'Vinyle 33 tours (LP)'], ['vinyle-45', 'Vinyle 45 tours (single/maxi)'], ['vinyle-78', 'Shellac 78 tours (patrimoine)'],
  ['k7-audio', 'Cassette audio'], ['k7-metal', 'Cassette métal'], ['8-track', 'Cartouche 8 pistes'],
  ['bobine', 'Bobine (reel-to-reel)'], ['dat', 'DAT (bande numérique)'], ['dcc', 'DCC'],
  ['cd', 'CD audio'], ['cd-r', 'CD-R (gravé)'], ['sacd', 'SACD (haute résolution)'],
  ['dvd-audio', 'DVD-Audio'], ['blu-audio', 'Blu-ray audio'], ['minidisc', 'MiniDisc'],
  ['dualdisc', 'DualDisc (CD+DVD)'], ['shm-cd', 'SHM-CD (Japon)'], ['blu-spec', 'Blu-spec CD (Sony)'],
  ['dl-musique', 'Téléchargement (MP3/FLAC)'], ['streaming-audio', 'Streaming (Spotify/Deezer/Qobuz)'], ['web-musique', 'Écoute en ligne'],
];
const FORMATIONS = [
  ['solo', 'Solo'], ['duo', 'Duo'], ['trio', 'Trio'], ['quatuor', 'Quatuor'],
  ['quintette', 'Quintette'], ['orch', 'Orchestre'], ['bigband', 'Big band'], ['chorale', 'Chorale'], ['ensemble', 'Ensemble'],
];
const INSTRUMENTS = [
  ['pia', 'Piano'], ['vio', 'Violon'], ['vlc', 'Violoncelle'], ['alto', 'Alto'],
  ['gtr', 'Guitare'], ['sax', 'Saxophone'], ['trp', 'Trompette'], ['flt', 'Flûte'],
  ['org', 'Orgue'], ['clr', 'Clarinette'], ['cnt', 'Contrebasse'], ['drm', 'Batterie'], ['voc', 'Voix'],
];

/* ═══ RÉFÉRENTIEL JEUX DE SOCIÉTÉ — ESAR (ludothèques), types BGG, mécanismes, composants ═══ */
const BOARDGAME_TYPES = [
  ['abs', 'Stratégie abstraite (échecs, Hive…)'], ['cus', 'Personnalisable (Magic, Warhammer…)'],
  ['the', 'Thématique / immersion (Demeures de l\u0027Épouvante…)'], ['fam', 'Familial (Catan, Carcassonne…)'],
  ['chi', 'Enfants (Haba…)'], ['par', 'Ambiance / party (Time\u0027s Up, Loups-Garous…)'],
  ['str', 'Stratégie / eurogame (Terraforming Mars…)'], ['war', 'Wargame (Mémoire 44, ASL…)'],
];
const BOARDGAME_ESAR = [
  ['E', 'ESAR E — Jeu d\u0027exercice (sensoriel, moteur)'], ['E01', 'ESAR E01 — Sensoriel sonore'], ['E02', 'ESAR E02 — Sensoriel visuel'],
  ['E03', 'ESAR E03 — Sensoriel tactile'], ['E06', 'ESAR E06 — Moteur'], ['E07', 'ESAR E07 — Manipulation'],
  ['S', 'ESAR S — Jeu symbolique (faire semblant)'], ['S01', 'ESAR S01 — Jeu de rôles'], ['S02', 'ESAR S02 — Mise en scène'],
  ['A', 'ESAR A — Jeu d\u0027assemblage (construire)'], ['A01', 'ESAR A01 — Construction'], ['A02', 'ESAR A02 — Puzzles'],
  ['R', 'ESAR R — Jeu de règles'], ['R01', 'ESAR R01 — Association'], ['R03', 'ESAR R03 — Circuit / parcours'],
  ['R04', 'ESAR R04 — Adresse'], ['R05', 'ESAR R05 — Sportif'], ['R06', 'ESAR R06 — Stratégie'],
  ['R07', 'ESAR R07 — Hasard'], ['R08', 'ESAR R08 — Questions / réponses'], ['R09', 'ESAR R09 — Mathématique'],
  ['R10', 'ESAR R10 — Vocabulaire / langue'], ['R11', 'ESAR R11 — Énigmes'],
];
const BOARDGAME_MECHANICS = [
  ['wp', 'Placement d\u0027ouvriers (Agricola…)'], ['ap', 'Points d\u0027action (Pandemic…)'],
  ['dr', 'Rédaction de dés (Troyes…)'], ['cd', 'Rédaction de cartes (7 Wonders…)'],
  ['ec', 'Économie / gestion de ressources (Catan…)'], ['auc', 'Enchères (Modern Art…)'], ['set', 'Collection d\u0027ensembles (Tokaido…)'],
  ['ac', 'Contrôle de zone (Risk, Small World…)'], ['am', 'Mouvement de zone (Mémoire 44…)'], ['ae', 'Enclos de zone (Go…)'],
  ['dice', 'Résolution par dés (Zombicide…)'], ['cdb', 'Résolution par cartes (Magic…)'], ['bluff', 'Bluff (Loups-Garous…)'],
  ['st', 'Conte / narration (Dixit…)'], ['role', 'Jeu de rôle (D&D…)'], ['coop', 'Coopératif (Pandemic…)'],
  ['ded', 'Déduction (Cluedo…)'], ['puz', 'Puzzle / casse-tête (Exit, Unlock!)'], ['mys', 'Mystère / enquête (MicroMacro…)'],
];
const BOARDGAME_FORMATS = [
  ['boite', 'Boîte standard'], ['petite-boite', 'Petite boîte (voyage/apéro)'], ['grande-boite', 'Grande boîte (figurines)'],
  ['coffret-js', 'Coffret premium'], ['sachet', 'Sachet / pochette (sans boîte)'],
  ['plateau', 'Plateau (composant dominant)'], ['cartes', 'Cartes (dominant)'], ['des', 'Dés (dominant)'],
  ['figurines', 'Figurines'], ['tuiles', 'Tuiles (Carcassonne…)'], ['pions', 'Pions / meeples'],
  ['livret-js', 'Livret / scénario'], ['ecran-mj', 'Écran de MJ (JDR)'],
  ['app-js', 'Application compagnon'], ['demat-js', 'Dématérialisé (Tabletop Simulator, BGA)'], ['print-js', 'Print & Play'],
];

/* ═══ RÉFÉRENTIEL LOGICIELS — familles fonctionnelles, catégories, formats, licences, versionnage sémantique ═══ */
const SOFTWARE_FAMILIES = [
  ['sys', 'Système / Utilitaire (Windows, antivirus…)'], ['bur', 'Bureautique (Office, LibreOffice…)'],
  ['gra', 'Graphisme / PAO / DAO (Photoshop, AutoCAD…)'], ['mao', 'Musique assistée (Ableton, Audacity…)'],
  ['vid', 'Montage vidéo / Animation (Premiere, Blender…)'], ['web-dev', 'Développement Web (VS Code, WordPress…)'],
  ['dev', 'Développement logiciel (Visual Studio, Python…)'], ['sgbd', 'Base de données (MySQL…)'],
  ['ges', 'Gestion / Métier (ERP, CRM, Sage…)'], ['edu-log', 'Éducatif / Ludo-éducatif (Adibou…)'],
  ['cat', 'Catalogage / Documentation (Koha, PMB…)'], ['sec', 'Sécurité (Bitdefender…)'], ['res', 'Réseau / Internet (Firefox…)'],
];
const SOFTWARE_CATEGORIES = [
  ['prop', 'Propriétaire (licence commerciale)'], ['lib', 'Libre / Open source (GPL, MIT…)'],
  ['freem', 'Freemium (gratuit limité + payant)'], ['saas', 'SaaS (abonnement en ligne)'],
];
const SOFTWARE_FORMATS = [
  ['cd-rom', 'CD-ROM'], ['dvd-rom', 'DVD-ROM'], ['blu-rom', 'Blu-ray'], ['usb', 'Clé USB'],
  ['disquette', 'Disquette (patrimoine)'], ['dl-log', 'Téléchargement (.exe/.dmg/.deb)'],
  ['saas-log', 'SaaS (abonnement en ligne)'], ['cloud-log', 'Cloud / streaming'], ['app-log', 'Application mobile'],
  ['webapp', 'Webapp (sans installation)'], ['cle-licence', 'Clé de licence (sans support)'],
];
const SOFTWARE_PLATFORMS = [
  ['WIN', 'Windows'], ['MAC', 'macOS'], ['LIN', 'Linux'], ['AND', 'Android'], ['IOS', 'iOS'], ['WEB', 'Web'],
];
const LICENSE_TYPES = [
  ['perpetuelle', 'Licence perpétuelle (achat unique)'], ['abonnement', 'Abonnement (récurrent)'],
  ['site', 'Licence site (illimitée sur un site)'], ['volume', 'Licence volume (multi-postes)'],
  ['nominative', 'Licence nominative (1 utilisateur)'], ['par-poste', 'Licence par poste (1 ordinateur)'],
];

/* ═══ RÉFÉRENTIELS DOCUMENTS PATRIMONIAUX & SPÉCIAUX (votre détail type par type) ═══ */
const PARTITION_TYPES = [
  ['par', 'Partition (édition complète)'], ['par-ch', 'Partition de ch\u0027\u0153ur'], ['par-red', 'Partition réduite (piano-chant)'],
  ['par-condu', 'Conducteur (chef d\u0027orchestre)'], ['par-prt', 'Partie séparée (instrumentale)'],
  ['par-voc', 'Partition vocale (voix+piano)'], ['par-etu', 'Partition d\u0027étude'],
];
const PARTITION_FORMATS = [
  ['papier-part', 'Papier (imprimée)'], ['braille-part', 'Braille'], ['num-part', 'PDF / MusicXML'], ['app-part', 'Application interactive'],
];
const MAP_TYPES = [
  ['carte', 'Carte géographique'], ['plan', 'Plan de ville'], ['atlas', 'Atlas (recueil)'],
  ['globe', 'Globe terrestre'], ['spher-cel', 'Sphère céleste'], ['spatiocarte', 'Image satellite'],
  ['carte-naut', 'Carte nautique'], ['carte-aero', 'Carte aéronautique'], ['carte-3d', 'Carte en relief'],
];
const MAP_FORMATS = [
  ['papier-carte', 'Papier'], ['toile', 'Toile (carte ancienne)'], ['num-carte', 'Numérique (raster/vecteur)'],
  ['web-carte', 'Carte interactive'], ['cd-rom-carte', 'Atlas numérique'],
];
const PHOTO_TYPES = [
  ['photo-nb', 'Noir et blanc'], ['photo-coul', 'Couleur'], ['photo-arg', 'Argentique'],
  ['photo-num', 'Natif numérique'], ['photo-aer', 'Aérienne'], ['photo-jour', 'Photojournalisme'],
  ['photo-studio', 'Portrait studio'], ['photo-art', 'Photographie d\u0027art'], ['photo-sci', 'Scientifique'],
];
const PHOTO_FORMATS = [
  ['tirage', 'Tirage papier'], ['negatif', 'Négatif'], ['diapo', 'Diapositive'],
  ['fichier-raw', 'Fichier (RAW/JPEG/TIFF)'], ['plaque', 'Plaque de verre'], ['album-photo', 'Album photo'],
];
const PRINT_TYPES = [
  ['grav-bois', 'Gravure sur bois'], ['eau-forte', 'Eau-forte'], ['litho', 'Lithographie'],
  ['serigr', 'Sérigraphie'], ['pointe-seche', 'Pointe sèche'], ['aquatinte', 'Aquatinte'],
  ['aff-cinema', 'Affiche de cinéma'], ['aff-spectacle', 'Affiche de spectacle'], ['aff-pub', 'Affiche publicitaire'],
  ['aff-politique', 'Affiche politique'], ['aff-touristique', 'Affiche touristique'],
];
const PRINT_FORMATS = [
  ['papier-estampe', 'Papier (vélin, japon, Arches)'], ['parchemin', 'Parchemin'], ['toile-est', 'Toile'], ['num-aff', 'Affiche numérique'],
];
const MANUSCRIPT_TYPES = [
  ['manuscrit', 'Manuscrit moderne'], ['manuscrit-med', 'Manuscrit médiéval'],
  ['corresp', 'Correspondance'], ['journal-pers', 'Journal personnel'], ['brouillon', 'Brouillon d\u0027\u0153uvre'],
  ['archive', 'Fonds d\u0027archives'], ['doc-admin', 'Document administratif'],
];
const MANUSCRIPT_FORMATS = [
  ['parchemin-ms', 'Parchemin'], ['papier-ms', 'Papier'], ['papyrus', 'Papyrus'], ['num-ms', 'Numérisation'],
];
const THESIS_TYPES = [
  ['these-doc', 'Thèse de doctorat'], ['these-master', 'Mémoire de master'], ['hdr', 'Habilitation à diriger des recherches'],
  ['memoire', 'Mémoire professionnel'], ['rapport-stage', 'Rapport de stage'],
  ['rapport-admin', 'Rapport administratif'], ['publ-gouv', 'Publication gouvernementale'], ['bulletin-off', 'Bulletin officiel'],
];
const THESIS_FORMATS = [
  ['papier-these', 'Papier'], ['pdf-these', 'PDF'], ['depot-electr', 'Dépôt électronique'], ['web-off', 'Publication en ligne'],
];
const EPHEMERA_TYPES = [
  ['tract', 'Tract'], ['flyer', 'Flyer'], ['affichette', 'Affichette'], ['menu', 'Menu'],
  ['carte-postale', 'Carte postale'], ['programme', 'Programme'], ['invitation', 'Invitation'], ['carte-voeux', 'Carte de v\u0153ux'],
];
const EPHEMERA_FORMATS = [
  ['papier-eph', 'Papier'], ['num-eph', 'Capture numérique (PDF)'],
];
const OBJECT_TYPES = [
  ['instrument', 'Instrument de musique'], ['objet-3d', 'Objet / artefact'],
  ['outil-peda', 'Outil pédagogique'], ['jeu-constr', 'Jeu de construction (Lego, Kapla)'],
  ['mallette-lect', 'Mallette de lecture'], ['mallette-them', 'Mallette thématique'],
  ['kamishibai', 'Kamishibaï (théâtre de papier)'], ['materiel-sci', 'Matériel scientifique'],
];
const OBJECT_FORMATS = [
  ['physique', 'Objet physique'], ['kit', 'Kit (ensemble d\u0027objets)'], ['modele-3d', 'Modèle 3D (STL/OBJ)'],
];
const DIGITAL_TYPES = [
  ['base-donnees', 'Base de données (Cairn, Europresse)'], ['plateforme', 'Plateforme (Toutapprendre…)'],
  ['revue-num', 'Revue en ligne'], ['livre-num', 'Bibliothèque numérique'],
  ['podcast', 'Podcast'], ['emission-radio', 'Émission de radio'], ['site-archive', 'Site web archivé'],
  ['app-mobile', 'Application mobile'], ['realite-virt', 'Expérience VR/AR'],
];
const DIGITAL_FORMATS = [
  ['web-res', 'Web (navigateur)'], ['app-res', 'Application'], ['api', 'API (accès programmatique)'],
  ['flux-rss', 'Flux RSS'], ['fichier-pod', 'Fichier audio (MP3)'], ['stl', 'Fichier 3D (STL/OBJ/FBX)', ],
];

/* ═══ TABLE DE CORRESPONDANCE (remplace le chaînage ternaire) ═══ */
const SUBTYPE_LISTS = { game: GAME_GENRES, videogame: GAME_GENRES, manga: MANGA_DEMOS, comic: BD_FAMILIES, bd: BD_FAMILIES, press: PRESS_TYPES, series: SERIES_FAMILIES, music: MUSIC_CLASSES, boardgame: BOARDGAME_TYPES, software: SOFTWARE_FAMILIES, book: BOOK_FAMILIES, partition: PARTITION_TYPES, map: MAP_TYPES, photo: PHOTO_TYPES, print: PRINT_TYPES, manuscript: MANUSCRIPT_TYPES, thesis: THESIS_TYPES, ephemera: EPHEMERA_TYPES, object: OBJECT_TYPES, digital: DIGITAL_TYPES };
const CARRIER_LISTS = { manga: MANGA_FORMATS, comic: BD_FORMATS, bd: BD_FORMATS, press: PRESS_FORMATS, series: SERIES_FORMATS, music: MUSIC_FORMATS, boardgame: BOARDGAME_FORMATS, software: SOFTWARE_FORMATS, book: BOOK_FORMATS, partition: PARTITION_FORMATS, map: MAP_FORMATS, photo: PHOTO_FORMATS, print: PRINT_FORMATS, manuscript: MANUSCRIPT_FORMATS, thesis: THESIS_FORMATS, ephemera: EPHEMERA_FORMATS, object: OBJECT_FORMATS, digital: DIGITAL_FORMATS };

/* ═══ Q3 — GÉNÉRATEUR DE COTE UNIFIÉ (5 segments) + Q4 — MOTEUR DE COHÉRENCE ═══ */
const MEDIUM_SHORT = { book: 'LIV', comic: 'BD', bd: 'BD', manga: 'MAN', film: 'FIL', series: 'SER', music: 'MUS', game: 'JV', videogame: 'JV', boardgame: 'JEU', jdr: 'JDR', press: 'PRES', software: 'LOG', partition: 'PART', map: 'CAR', photo: 'PHO', print: 'EST', manuscript: 'MS', thesis: 'THE', ephemera: 'EPH', object: 'OBJ', digital: 'NUM', other: 'AUT' };
const CARRIER_SHORT = { 'blu-ray': 'BLU', 'blu-ray-uhd': 'BLU4K', 'blu-ray-3d': 'BLU3D', dvd: 'DVD', vhs: 'VHS', 'vinyle-33': 'VIN33', 'vinyle-45': 'VIN45', cd: 'CD', sacd: 'SACD', streaming: 'STR', 'demat-jv': 'DEMAT', tankobon: 'TANKO', kanzenban: 'KANZ', omnibus: 'OMNI', 'poche-livre': 'POC', 'relie-livre': 'REL', epub: 'EPUB', broche: 'BRO' };
const EDITION_SHORT = { standard: 'STD', collector: 'COL', deluxe: 'DLX', integrale: 'INT', coffret: 'COF', anniversaire: 'ANN', remasterisee: 'REM', 'directors-cut': 'DC', goty: 'GOTY', saison: 'SAI', kickstarter: 'KS' };
function genererCote(it) {
  const warnings = [];
  const typeCode = MEDIUM_SHORT[it.medium] || (it.medium || 'AUT').toUpperCase().slice(0, 4);
  const genreCode = (it.mediaSubtype || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const typeGenre = genreCode ? typeCode + genreCode : typeCode;
  if (typeGenre.length > 8) warnings.push('TYPE+GENRE > 8 car.');
  const supCode = CARRIER_SHORT[it.carrier] || (it.carrier || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const edCode = EDITION_SHORT[it.editionType] || (it.editionType === 'standard' ? '' : (it.editionType || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3));
  const supportEd = supCode && edCode ? supCode + '-' + edCode : (supCode || edCode || '');
  if (supportEd.length > 9) warnings.push('SUPPORT-ÉD > 9 car.');
  const numCode = (it.volume || '').trim().slice(0, 6);
  const fac = [it.audience, it.readingDirection, it.zone].filter(Boolean);
  const facetteStr = fac.join('-').slice(0, 12);
  const parts = [typeGenre, supportEd];
  if (numCode) parts.push(numCode);
  if (facetteStr) parts.push(facetteStr);
  const cote = parts.filter(Boolean).join(' ');
  if (cote.length > 35) warnings.push('Cote > 35 car. (' + cote.length + ')');
  return { cote, segments: { type_genre: typeGenre, support_ed: supportEd, num: numCode, facettes: facetteStr }, warnings };
}
const COHERENCE_RULES = [
  /* ═══ 71 règles de votre IA, alignées sur nos enums réels (~55 actives, les autres adaptées ou écartées: champs inexistants) ═══ */
  // COMMUN
  { id: 'COM-001', sev: 'error', when: { all: [{ field: 'carrier', op: 'in', value: ['epub', 'pdf', 'mobi', 'web-livre', 'web-res', 'web-carte', 'web-presse', 'web-serie', 'web-musique', 'saas-log', 'cloud-log', 'cloud-jv', 'demat-jv', 'demat-manga', 'demat-bd', 'demat-js', 'dl-log', 'dl-musique', 'dl-est', 'streaming', 'num-presse', 'mp4'] }, { field: 'editionType', op: 'in', value: ['coffret', 'steelbook', 'box-set', 'luxe', 'collector', 'int-col'] }] }, msg: 'Support numérique incompatible avec une édition de collection physique' },
  { id: 'COM-002', sev: 'warning', when: { all: [{ field: 'carrier', op: 'in', value: ['broche', 'poche-livre', 'relie-livre', 'dvd', 'blu-ray', 'cd', 'vinyle-33', 'cartouche', 'boite'] }, { field: 'editionType', op: 'in', value: ['digital-deluxe', 'demat-jv'] }] }, msg: 'Support physique incompatible avec une édition dématérialisée' },
  { id: 'COM-003', sev: 'warning', when: { all: [{ field: 'publishedDate', op: 'matches', value: '^[0-9]{4}$' }, { field: 'publishedDate', op: 'gt', value: String(new Date().getFullYear() + 2) }] }, msg: 'Date de publication très éloignée dans le futur' },
  { id: 'COM-004', sev: 'warning', when: { all: [{ field: 'accessibility', op: 'in', value: ['braille-int', 'braille-abr'] }, { field: 'carrier', op: 'in', value: ['dvd', 'blu-ray', 'streaming', 'mp4', 'cd', 'epub', 'pdf'] }] }, msg: 'Le braille est incompatible avec un support vidéo/audio/numérique' },
  { id: 'COM-005', sev: 'warning', when: { all: [{ field: 'zone', op: 'is_not_null' }, { field: 'medium', op: 'in', value: ['book', 'comic', 'manga', 'music', 'partition', 'map', 'photo', 'print', 'manuscript', 'thesis'] }] }, msg: 'Zone géographique (DVD/Blu-ray) inhabituelle pour ce type de document' },
  // LIVRES
  { id: 'LIV-001', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'poche-livre' }, { field: 'editionType', op: 'eq', value: 'luxe' }] }, msg: 'Poche et édition de luxe : incohérent' },
  { id: 'LIV-002', sev: 'warning', when: { all: [{ field: 'editionType', op: 'eq', value: 'integrale' }, { field: 'seriesTotal', op: 'lt', value: 2 }] }, msg: 'Une intégrale doit couvrir au moins 2 volumes' },
  { id: 'LIV-003', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'audio' }, { field: 'audioVersion', op: 'is_null' }] }, msg: 'Livre audio sans version audio précisée (VO/VF/VOST)' },
  { id: 'LIV-004', sev: 'warning', when: { all: [{ field: 'editionType', op: 'eq', value: 'numerotee' }, { field: 'volume', op: 'is_null' }] }, msg: 'Édition numérotée sans numéro' },
  { id: 'LIV-005', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'epub' }, { field: 'accessibility', op: 'eq', value: 'gros-caracteres' }] }, msg: 'Gros caractères attendu sur support physique' },
  // BD
  { id: 'BD-001', sev: 'warning', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'bd-rg' }, { field: 'volume', op: 'is_not_null' }] }, msg: 'Un roman graphique one-shot ne devrait pas être numéroté' },
  { id: 'BD-002', sev: 'error', when: { all: [{ field: 'carrier', op: 'eq', value: 'comic-book' }, { field: 'editionType', op: 'eq', value: 'integrale' }] }, msg: 'Comic book fascicule incompatible avec une intégrale' },
  { id: 'BD-003', sev: 'warning', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'bd-fb' }, { field: 'carrier', op: 'eq', value: 'poche-livre' }] }, msg: 'BD franco-belge en poche : format atypique, à vérifier' },
  { id: 'BD-004', sev: 'warning', when: { all: [{ field: 'carrier', op: 'in', value: ['omnibus', 'omnibus-bd'] }, { field: 'volume', op: 'is_null' }] }, msg: 'Omnibus sans numérotation (nombre de tomes regroupés)' },
  // MANGAS
  { id: 'MAN-001', sev: 'error', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'kodomo' }, { field: 'genre', op: 'contains', value: 'hent' }] }, msg: 'Kodomo incompatible avec un contenu adulte (hentai)' },
  { id: 'MAN-003', sev: 'warning', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'seinen' }, { field: 'ageMin', op: 'in', value: ['3+', '6+', '8+', '10+'] }] }, msg: 'Seinen avec public inférieur à 16 ans : à vérifier' },
  { id: 'MAN-004', sev: 'warning', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'kodomo' }, { field: 'ageMin', op: 'in', value: ['12+', '14+', '18+'] }] }, msg: 'Kodomo avec public supérieur à 10 ans : à vérifier' },
  { id: 'MAN-005', sev: 'error', when: { all: [{ field: 'carrier', op: 'in', value: ['webtoon', 'webtoon-bd'] }, { field: 'editionType', op: 'eq', value: 'collector' }] }, msg: 'Webtoon incompatible avec une édition collector physique' },
  // FILMS
  { id: 'FIL-001', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'vhs' }, { field: 'publishedDate', op: 'gt', value: '2006' }] }, msg: 'VHS incompatible avec une œuvre postérieure à 2006' },
  { id: 'FIL-002', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'blu-ray-3d' }, { field: 'publishedDate', op: 'gt', value: '2018' }] }, msg: 'Blu-ray 3D après 2018 : format en déclin, à vérifier' },
  { id: 'FIL-003', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'blu-ray-uhd' }, { field: 'zone', op: 'not_in', value: ['A', 'B', 'C', '0'] }] }, msg: 'Zone Blu-ray UHD inhabituelle (attendu A/B/C ou region-free)' },
  { id: 'FIL-004', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'vhs' }, { field: 'editionType', op: 'in', value: ['directors-cut', 'extended'] }] }, msg: 'Version alternative (DC/longue) en VHS : à vérifier' },
  { id: 'FIL-005', sev: 'error', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'film-cm' }, { field: 'seasonsCount', op: 'gt', value: 0 }] }, msg: 'Un court métrage ne peut pas avoir de saisons' },
  { id: 'FIL-006', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'streaming' }, { field: 'collectionState', op: 'in', value: ['complet', 'en-cours'] }] }, msg: 'Streaming et collection physique : incohérence de gestion' },
  // SÉRIES
  { id: 'SER-001', sev: 'error', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'ser-min' }, { field: 'episodesCount', op: 'gt', value: 6 }] }, msg: 'Une mini-série ne peut excéder 6 épisodes' },
  { id: 'SER-002', sev: 'warning', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'ser-feu' }, { field: 'seasonsCount', op: 'gt', value: 0 }] }, msg: 'Un feuilleton se numérote par épisode global, pas par saison' },
  { id: 'SER-004', sev: 'warning', when: { all: [{ field: 'seasonsCount', op: 'gt', value: 0 }, { field: 'episodesCount', op: 'is_null' }] }, msg: 'Saisons déclarées sans nombre d\u0027épisodes' },
  // MUSIQUE
  { id: 'MUS-001', sev: 'error', when: { all: [{ field: 'carrier', op: 'eq', value: 'vinyle-33' }, { field: 'accessibility', op: 'in', value: ['braille-int', 'braille-abr'] }] }, msg: 'Vinyle et braille incompatibles' },
  { id: 'MUS-002', sev: 'warning', when: { all: [{ field: 'editionType', op: 'eq', value: 'anniversaire' }, { field: 'publishedDate', op: 'is_null' }] }, msg: 'Édition anniversaire sans millésime' },
  { id: 'MUS-003', sev: 'warning', when: { all: [{ field: 'mediaSubtype', op: 'in', value: ['3.1', '3.2', '3.24', '3.35', '3.36', '3.4'] }, { field: 'volume', op: 'is_null' }] }, msg: 'Musique classique sans numéro d\u0027opus (à préciser)' },
  { id: 'MUS-005', sev: 'warning', when: { all: [{ field: 'medium', op: 'eq', value: 'music' }, { field: 'audioVersion', op: 'in', value: ['VF', 'VOST', 'VFST'] }] }, msg: 'La musique n\u0027a pas de version audio VF/VOST (sauf livre audio)' },
  // JEUX VIDÉO
  { id: 'JV-002', sev: 'error', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'edu' }, { field: 'ageMin', op: 'eq', value: '18+' }] }, msg: 'Jeu éducatif incompatible avec un public 18+' },
  { id: 'JV-004', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'cloud-jv' }, { field: 'collectionState', op: 'eq', value: 'pilon' }] }, msg: 'Cloud gaming incompatible avec le pilon' },
  // LOGICIELS
  { id: 'LOG-001', sev: 'error', when: { all: [{ field: 'carrier', op: 'eq', value: 'cd-rom' }, { field: 'softwareCategory', op: 'eq', value: 'saas' }] }, msg: 'CD-ROM incompatible avec le modèle SaaS' },
  { id: 'LOG-002', sev: 'warning', when: { all: [{ field: 'editionType', op: 'eq', value: 'oem' }, { field: 'carrier', op: 'in', value: ['dl-log', 'webapp', 'saas-log'] }] }, msg: 'Licence OEM liée au matériel : support numérique inhabituel' },
  { id: 'LOG-003', sev: 'error', when: { all: [{ field: 'softwareCategory', op: 'eq', value: 'lib' }, { field: 'editionType', op: 'eq', value: 'oem' }] }, msg: 'Logiciel libre incompatible avec une licence OEM' },
  // JEUX DE SOCIÉTÉ
  { id: 'JDS-001', sev: 'warning', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'par' }, { field: 'players', op: 'contains', value: '1' }] }, msg: 'Un party game nécessite au moins 3 joueurs' },
  { id: 'JDS-002', sev: 'error', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'chi' }, { field: 'ageMin', op: 'eq', value: '18+' }] }, msg: 'Jeu enfants incompatible avec un public 18+' },
  { id: 'JDS-003', sev: 'warning', when: { all: [{ field: 'editionType', op: 'eq', value: 'extension-js' }, { field: 'volume', op: 'is_null' }] }, msg: 'Extension sans référence au jeu de base' },
  { id: 'JDS-004', sev: 'error', when: { all: [{ field: 'carrier', op: 'eq', value: 'sachet' }, { field: 'editionType', op: 'eq', value: 'big-box' }] }, msg: 'Sachet incompatible avec une Big Box' },
  // PRESSE
  { id: 'PRE-001', sev: 'error', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'annuaire' }, { field: 'periodicity', op: 'eq', value: 'quot' }] }, msg: 'Un annuaire ne peut pas être quotidien' },
  { id: 'PRE-002', sev: 'error', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'quotidien' }, { field: 'periodicity', op: 'in', value: ['men', 'trim', 'sem', 'ann'] }] }, msg: 'Un quotidien ne peut pas être mensuel ou annuel' },
  { id: 'PRE-003', sev: 'warning', when: { all: [{ field: 'collectionState', op: 'eq', value: 'complet' }, { field: 'volume', op: 'is_null' }] }, msg: 'Collection complète sans numérotation de référence' },
  // PARTITIONS
  { id: 'PAR-001', sev: 'warning', when: { all: [{ field: 'medium', op: 'eq', value: 'partition' }, { field: 'carrier', op: 'eq', value: 'num-part' }, { field: 'accessibility', op: 'in', value: ['braille-int', 'braille-abr'] }] }, msg: 'Partition braille : le support physique est attendu' },
  { id: 'PAR-002', sev: 'warning', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'par-red' }, { field: 'volume', op: 'is_null' }] }, msg: 'Partition réduite sans numéro d\u0027opus' },
  { id: 'PAR-003', sev: 'warning', when: { all: [{ field: 'medium', op: 'eq', value: 'partition' }, { field: 'audioVersion', op: 'is_not_null' }] }, msg: 'Une partition n\u0027a pas de version audio' },
  // CARTES
  { id: 'CAR-002', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'num-carte' }, { field: 'publishedDate', op: 'lt', value: '1800' }] }, msg: 'Carte antérieure à 1800 en numérique : vérifier la source' },
  { id: 'CAR-003', sev: 'error', when: { all: [{ field: 'carrier', op: 'eq', value: 'papier-carte' }, { field: 'accessibility', op: 'eq', value: 'audiodescription' }] }, msg: 'Audiodescription incompatible avec une carte papier' },
  // PHOTOS
  { id: 'PHO-001', sev: 'error', when: { all: [{ field: 'carrier', op: 'in', value: ['fichier-raw', 'num-eph'] }, { field: 'accessibility', op: 'in', value: ['braille-int', 'braille-abr'] }] }, msg: 'Photo numérique et braille incompatibles' },
  { id: 'PHO-003', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'plaque' }, { field: 'publishedDate', op: 'gt', value: '1950' }] }, msg: 'Plaque de verre après 1950 : à vérifier' },
  // ESTAMPES
  { id: 'EST-002', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'papier-estampe' }, { field: 'publishedDate', op: 'lt', value: '1500' }] }, msg: 'Estampe antérieure à 1500 : fonds patrimonial, vérifier la conservation' },
  // MANUSCRITS
  { id: 'MSN-002', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'parchemin-ms' }, { field: 'publishedDate', op: 'gt', value: '1500' }] }, msg: 'Parchemin après 1500 : à vérifier' },
  // ACCESSIBILITÉ
  { id: 'ADA-003', sev: 'warning', when: { all: [{ field: 'accessibility', op: 'eq', value: 'falc' }, { field: 'publishedDate', op: 'lt', value: '2009' }] }, msg: 'FALC antérieur à 2009 : norme non stabilisée, à vérifier' },
  // THÈSES
  { id: 'THE-002', sev: 'warning', when: { all: [{ field: 'mediaSubtype', op: 'eq', value: 'these-doc' }, { field: 'volume', op: 'is_null' }] }, msg: 'Thèse de doctorat sans numéro (dépôt institutionnel)' },
  // RESSOURCES NUMÉRIQUES
  { id: 'RNU-001', sev: 'warning', when: { all: [{ field: 'editionType', op: 'eq', value: 'abonnement' }, { field: 'carrier', op: 'in', value: ['papier', 'papier-part', 'papier-eph', 'boite'] }] }, msg: 'Abonnement incompatible avec un support papier seul' },
  { id: 'RNU-002', sev: 'warning', when: { all: [{ field: 'carrier', op: 'eq', value: 'web-res' }, { field: 'collectionState', op: 'eq', value: 'pilon' }] }, msg: 'Ressource web et pilon : vérifier la politique de conservation' },
  // FACETTES TRANSVERSALES (votre 4e livraison, alignées)
  { id: 'FAC-002', sev: 'error', when: { all: [{ field: 'medium', op: 'not_in', value: ['press', 'digital'] }, { field: 'periodicity', op: 'is_not_null' }] }, msg: 'La périodicité ne s\u0027applique qu\u0027à la presse et aux ressources numériques' },
  { id: 'FAC-005', sev: 'error', when: { all: [{ field: 'carrier', op: 'eq', value: 'blu-ray-uhd' }, { field: 'imageFormat', op: 'eq', value: '4:3' }] }, msg: 'Blu-ray 4K UHD incompatible avec un format image 4:3' },
  { id: 'FAC-006', sev: 'warning', when: { all: [{ field: 'language', op: 'eq', value: 'jpn' }, { field: 'zone', op: 'eq', value: 'Z1' }] }, msg: 'Zone 1 (USA) atypique pour un titre japonais — Z2 (Europe/Japon) attendue' },
  { id: 'FAC-010', sev: 'warning', when: { all: [{ field: 'accessibility', op: 'eq', value: 'audiodescription' }, { field: 'medium', op: 'in', value: ['book', 'comic', 'manga', 'music', 'partition', 'map'] }] }, msg: 'L\u0027audiodescription s\u0027applique en priorité aux documents vidéo et jeux' },
  // FORMATS (FOR) — validation de format, logique not_matches corrigée
  { id: 'FOR-001', sev: 'error', when: { all: [{ field: 'isbn', op: 'is_not_null' }, { field: 'isbn', op: 'not_matches', value: '^[0-9]{9}[0-9Xx]$|^[0-9]{13}$|^[0-9]{12}$|^[0-9]{8}$' }] }, msg: 'Format ISBN/EAN invalide (attendu ISBN-10, ISBN-13, EAN-13, UPC-12 ou EAN-8)' },
  { id: 'FOR-003', sev: 'error', when: { all: [{ field: 'publishedDate', op: 'is_not_null' }, { field: 'publishedDate', op: 'not_matches', value: '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' }] }, msg: 'Date de publication invalide (attendu AAAA, AAAA-MM ou AAAA-MM-JJ)' },
  { id: 'FOR-007', sev: 'warning', when: { all: [{ field: 'language', op: 'is_not_null' }, { field: 'language', op: 'not_matches', value: '^[a-z]{3}$' }] }, msg: 'Code langue invalide (attendu ISO 639-2/B sur 3 lettres)' },
  { id: 'FOR-008', sev: 'warning', when: { all: [{ field: 'publishedDate', op: 'matches', value: '^[0-9]{4}$' }, { field: 'publishedDate', op: 'lt', value: '1450' }] }, msg: 'Date antérieure à l\u0027imprimerie : à vérifier (manuscrit ? fac-similé ?)' },
  // COMPLÉTUDE (OBL)
  { id: 'OBL-004', sev: 'warning', when: { all: [{ field: 'publishedDate', op: 'is_null' }] }, msg: 'Date de publication manquante : la fiche sera difficile à retrouver chronologiquement' },
  { id: 'OBL-006', sev: 'warning', when: { all: [{ field: 'ageMin', op: 'is_null' }, { field: 'medium', op: 'in', value: ['game', 'boardgame'] }] }, msg: 'Âge minimum manquant pour un jeu : impact sur la médiation jeunesse' },
  { id: 'OBL-007', sev: 'warning', when: { all: [{ field: 'players', op: 'is_null' }, { field: 'medium', op: 'eq', value: 'boardgame' }] }, msg: 'Nombre de joueurs manquant pour un jeu de société' },
  // COHÉRENCE TEMPORELLE (TMP)
  { id: 'TMP-001', sev: 'warning', when: { all: [{ field: 'addedAt', op: 'is_not_null' }, { field: 'publishedDate', op: 'is_not_null' }, { field: 'addedAt', op: 'lt', value: { $ref: 'publishedDate' } }] }, msg: 'Date d\u0027ajout antérieure à la date de publication : vérifier (incohérence temporelle)' },
  { id: 'TMP-004', sev: 'warning', when: { all: [{ field: 'medium', op: 'eq', value: 'press' }, { field: 'periodicity', op: 'eq', value: 'quot' }, { field: 'publishedDate', op: 'is_null' }] }, msg: 'Un quotidien sans date de publication : la date est son identifiant principal' },
  // DOUBLONS (DUP)
  { id: 'DUP-004', sev: 'warning', when: { all: [{ field: 'title', op: 'matches', value: '.{80,}' }] }, msg: 'Titre très long (>80 caractères) : risque de faux positifs dans la détection de doublons' },
];
const COHERENCE_OPS = {
  eq: (a, b) => String(a) === String(b), neq: (a, b) => String(a) !== String(b),
  // comparaison numérique si possible, sinon lexicographique (les dates ISO AAAA-MM-JJ se trient correctement en chaînes)
  lt: (a, b) => { if (a === null || a === '' || a === undefined) return false; const na = +a, nb = +b; return (!isNaN(na) && !isNaN(nb)) ? na < nb : String(a) < String(b); },
  gt: (a, b) => { if (a === null || a === '' || a === undefined) return false; const na = +a, nb = +b; return (!isNaN(na) && !isNaN(nb)) ? na > nb : String(a) > String(b); },
  le: (a, b) => { if (a === null || a === undefined) return false; const na = +a, nb = +b; return (!isNaN(na) && !isNaN(nb)) ? na <= nb : String(a) <= String(b); },
  ge: (a, b) => { if (a === null || a === undefined) return false; const na = +a, nb = +b; return (!isNaN(na) && !isNaN(nb)) ? na >= nb : String(a) >= String(b); },
  in: (a, b) => Array.isArray(b) && b.map(String).includes(String(a)),
  not_in: (a, b) => a !== null && a !== undefined && a !== '' && (!Array.isArray(b) || !b.map(String).includes(String(a))),
  contains: (a, b) => String(a || '').toLowerCase().includes(String(b).toLowerCase()),
  matches: (a, b) => { try { return new RegExp(b).test(String(a || '')); } catch { return false; } },
  not_matches: (a, b) => { try { return !new RegExp(b).test(String(a || '')); } catch { return false; } },
  is_null: (a) => a === null || a === undefined || String(a).trim() === '',
  is_not_null: (a) => !(a === null || a === undefined || String(a).trim() === ''),
};
function evaluerCond(cond, doc) {
  if (cond.all) return cond.all.every((c) => evaluerCond(c, doc));
  if (cond.any) return cond.any.some((c) => evaluerCond(c, doc));
  if (cond.not) return !evaluerCond(cond.not, doc);
  // $ref: comparaison croisée entre champs (ex: addedAt < publishedDate)
  let val = cond.value;
  if (val && typeof val === 'object' && val.$ref) val = doc[val.$ref];
  return COHERENCE_OPS[cond.op](doc[cond.field], val);
}
function validerCoherence(doc) {
  const errors = [], warnings = [];
  for (const r of COHERENCE_RULES) {
    if (evaluerCond(r.when, doc)) (r.sev === 'error' ? errors : warnings).push(r.msg);
  }
  return { errors, warnings };
}

/* 📊 Audit de cohérence: simule les règles sur TOUTES les fiches — rapport par règle (son point 6: "quelles règles déclenchent combien de fois") */
function auditCoherence() {
  const counts = {}; // id -> { msg, sev, hits: [titles] }
  for (const it of store.items) {
    const res = validerCoherence(it);
    for (const m of [...res.errors, ...res.warnings]) {
      // retrouver la règle par msg
      const rule = COHERENCE_RULES.find((r) => r.msg === m);
      if (!rule) continue;
      if (!counts[rule.id]) counts[rule.id] = { msg: rule.msg, sev: rule.sev, hits: [] };
      counts[rule.id].hits.push((it.title || '?').slice(0, 40));
    }
  }
  const entries = Object.entries(counts).sort((a, b) => b[1].hits.length - a[1].hits.length);
  let txt = (LANG === 'en' ? 'COHERENCE AUDIT — ' : 'AUDIT DE COHÉRENCE — ') + store.items.length + (LANG === 'en' ? ' records, ' : ' fiches, ') + COHERENCE_RULES.length + (LANG === 'en' ? ' rules\n' : ' règles\n');
  txt += (LANG === 'en' ? 'Rules triggered (most frequent first):\n' : 'Règles déclenchées (par fréquence) :\n');
  if (!entries.length) txt += (LANG === 'en' ? '✅ No rule triggered — collection is coherent!' : '✅ Aucune règle déclenchée — collection cohérente !');
  for (const [id, c] of entries) {
    txt += `${c.sev === 'error' ? '🚫' : '⚠️'} ${id} × ${c.hits.length} — ${c.msg}\n   ${LANG === 'en' ? 'e.g.' : 'ex.'} ${c.hits.slice(0, 3).join(' · ')}${c.hits.length > 3 ? '…' : ''}\n`;
  }
  txt += '\n' + (LANG === 'en' ? 'Adjust: rules firing in mass are candidates for review (severity, threshold).' : 'Ajustement : les règles déclenchées en masse sont à revoir (sévérité, seuil).');
  return txt;
}

/* ═══ Q5 — RELATIONS TYPOLOGIÉES INTER-DOCUMENTS (13 codes — votre table §7) ═══ */
const RELATION_TYPES = [
  { code: 'adapt',   fr: 'Adaptation',       en: 'Adaptation',   invFr: "Est l'adaptation de",  invEn: 'Is the adaptation of', sym: false, prio: 5, vis: true },
  { code: 'suite',   fr: 'Suite / Séquelle', en: 'Sequel',       invFr: 'Précède',              invEn: 'Precedes',            sym: false, prio: 5, vis: true },
  { code: 'prequel', fr: 'Préquelle',        en: 'Prequel',      invFr: 'A pour suite',         invEn: 'Has sequel',          sym: false, prio: 5, vis: true },
  { code: 'remake',  fr: 'Remake',           en: 'Remake',       invFr: 'Est le remake de',     invEn: 'Is the remake of',    sym: false, prio: 4, vis: true },
  { code: 'trad',    fr: 'Traduction',       en: 'Translation',  invFr: 'Est la traduction de', invEn: 'Is the translation of', sym: false, prio: 4, vis: true },
  { code: 'spin',    fr: 'Spin-off',         en: 'Spin-off',     invFr: 'Est un spin-off de',   invEn: 'Is a spin-off of',    sym: false, prio: 4, vis: true },
  { code: 'univers', fr: 'Même univers',     en: 'Same universe',invFr: "Partage l'univers avec", invEn: 'Shares universe with', sym: true, prio: 3, vis: true },
  { code: 'insp',    fr: 'Inspiration',      en: 'Inspired by',  invFr: "S'inspire de",         invEn: 'Is inspired by',      sym: false, prio: 3, vis: true },
  { code: 'parod',   fr: 'Parodie',          en: 'Parody',       invFr: 'Est une parodie de',   invEn: 'Is a parody of',      sym: false, prio: 3, vis: true },
  { code: 'var',     fr: 'Variante',         en: 'Variant',      invFr: 'Est une variante de',  invEn: 'Is a variant of',     sym: true,  prio: 2, vis: true },
  { code: 'comp',    fr: 'Compagnon',        en: 'Companion',    invFr: 'Accompagne',           invEn: 'Accompanies',         sym: false, prio: 2, vis: false },
  { code: 'cross',   fr: 'Crossover',        en: 'Crossover',    invFr: 'Crossover avec',       invEn: 'Crossover with',      sym: true,  prio: 2, vis: false },
  { code: 'cite',    fr: 'Citation',         en: 'Citation',     invFr: 'Est cité par',         invEn: 'Is cited by',         sym: false, prio: 1, vis: false },
];
function relType(code) { return RELATION_TYPES.find((r) => r.code === code); }
function relationsOf(id) {
  const out = [];
  for (const src of store.items) {
    for (const rel of (src.relations || [])) {
      if (src.id === id && rel.t !== id) {
        const rt = relType(rel.ty); const target = store.findById(rel.t);
        if (rt && target) out.push({ dir: 'source', label: (LANG === 'en' ? rt.en : rt.fr), other: target, rel, rt });
      }
      if (rel.t === id && src.id !== id) {
        const rt = relType(rel.ty);
        if (rt && src) out.push({ dir: 'cible', label: (LANG === 'en' ? rt.invEn : rt.invFr) || (LANG === 'en' ? rt.en : rt.fr), other: src, rel, rt });
      }
    }
  }
  return out.sort((a, b) => (b.rt.prio || 0) - (a.rt.prio || 0));
}

/* ═══ Q5 — VALIDATION DES RELATIONS (12 règles REL de votre IA, exécutées à l'ajout) ═══ */
const REL_MATRIX_INTERDITS = [
  // combinaisons interdites (votre matrice §3, format: sourceMedium|cibleMedium) — vide = tout autorisé par défaut, on liste les interdits majeurs
  'music|manga', 'music|bd', 'press|manga', 'press|bd', 'press|film', 'press|series', 'press|music', 'press|game', 'press|boardgame',
  'manga|music', 'bd|music', 'manga|press', 'bd|press',
];
function relationCircular(sourceId, cibleId) {
  // BFS: la cible peut-elle atteindre la source par une chaîne de relations ? (REL-009)
  const visited = new Set(); const queue = [cibleId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const item = store.findById(cur);
    for (const r of ((item && item.relations) || [])) queue.push(r.t);
  }
  return false;
}
function validateRelation(src, cible, ty) {
  const warns = [];
  // REL-002: auto-référence (déjà bloquée à l'UI, double garde)
  if (src.id && cible.id && src.id === cible.id) return ['Un document ne peut pas être lié à lui-même'];
  // REL-001: adapt entre deux films → remake
  if (ty === 'adapt' && src.medium === 'film' && cible.medium === 'film') warns.push('Adaptation entre deux films : utiliser « remake » plutôt que « adapt » ?');
  // REL-003: suite avec date antérieure
  if ((ty === 'suite' || ty === 'adapt') && src.publishedDate && cible.publishedDate) {
    if (String(cible.publishedDate) < String(src.publishedDate)) warns.push(ty === 'suite' ? 'Une suite ne peut pas avoir une date antérieure à l\u0027œuvre source' : 'L\u0027adaptation est antérieure à l\u0027œuvre source : flèche probablement inversée');
  }
  // REL-009: circularité
  if (relationCircular(src.id, cible.id)) warns.push('Relation circulaire détectée (chaîne A → B → … → A)');
  // REL-010: trad même langue
  if (ty === 'trad' && src.language && cible.language && String(src.language) === String(cible.language)) warns.push('Traduction entre deux documents de même langue : vérifier (réédition ? variante ?)');
  // REL-011: matrice de compatibilité
  if (REL_MATRIX_INTERDITS.includes(src.medium + '|' + cible.medium)) warns.push('Combinaison source/cible peu probable : ' + src.medium + ' → ' + cible.medium);
  // REL-005: univers sur medium non narratif
  if (ty === 'univers' && !['book', 'comic', 'bd', 'manga', 'film', 'series', 'game'].includes(src.medium)) warns.push('Relation « même univers » attendue entre documents narratifs');
  // REL-012: relation subjective sans note
  if (['insp', 'parod', 'cite', 'univers', 'cross'].includes(ty)) warns.push('Relation subjective : documentez-la dans le champ Note de la fiche');
  return warns;
}

/* ═══ Q2 — RAMEAU (indexation matière, 92 termes curés — votre sélection, priorité 1-5) ═══ */
const RAMEAU_TERMS = [
  ['HIST-PRE', 'Préhistoire', 'Prehistory', 'Histoire', 'HIST|HIS-D|SCI|AV', 4],
  ['HIST-ANT', 'Antiquité', 'Antiquity', 'Histoire', 'HIST|HIS-D|PHI', 4],
  ['HIST-EGY', 'Égypte -- Antiquité', 'Ancient Egypt', 'Histoire', 'HIST|HIS-D|AV|REL', 5],
  ['HIST-GRE', 'Grèce -- Antiquité', 'Ancient Greece', 'Histoire', 'HIST|HIS-D|PHI|REL', 5],
  ['HIST-ROM', 'Rome -- Antiquité', 'Ancient Rome', 'Histoire', 'HIST|HIS-D|POL|REL', 5],
  ['HIST-MES', 'Antiquité -- Mésopotamie', 'Mesopotamia', 'Histoire', 'HIST|HIS-D|REL', 3],
  ['HIST-CHI', 'Chine -- Antiquité', 'Ancient China', 'Histoire', 'HIST|HIS-D|PHI', 3],
  ['HIST-IND', 'Inde -- Antiquité', 'Ancient India', 'Histoire', 'HIST|HIS-D|REL', 3],
  ['HIST-PRC', 'Amérique précolombienne', 'Pre-Columbian America', 'Histoire', 'HIST|HIS-D|REL', 3],
  ['HIST-MED', 'Moyen Âge', 'Middle Ages', 'Histoire', 'HIST|HIS-D|FAN|REL', 5],
  ['HIST-MED-H', 'Haut Moyen Âge', 'Early Middle Ages', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-MED-B', 'Bas Moyen Âge', 'High Middle Ages', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-REN', 'Renaissance', 'Renaissance', 'Histoire', 'HIST|HIS-D|ART', 4],
  ['HIST-MOD', 'Époque moderne', 'Early modern period', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-REV', 'Révolution française', 'French Revolution', 'Histoire', 'HIST|HIS-D|POL', 5],
  ['HIST-EMP', 'Premier Empire', 'First French Empire', 'Histoire', 'HIST|HIS-D|POL', 3],
  ['HIST-RES', 'Restauration', 'Restoration', 'Histoire', 'HIST|HIS-D', 2],
  ['HIST-JUL', 'Monarchie de Juillet', 'July Monarchy', 'Histoire', 'HIST|HIS-D', 2],
  ['HIST-SEC', 'Second Empire', 'Second French Empire', 'Histoire', 'HIST|HIS-D', 2],
  ['HIST-TRO', 'Troisième République', 'Third Republic', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-GM1', 'Première Guerre mondiale', 'World War I', 'Histoire', 'HIST|HIS-D|POL|AV', 5],
  ['HIST-ENT', 'Entre-deux-guerres', 'Interwar period', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-GM2', 'Seconde Guerre mondiale', 'World War II', 'Histoire', 'HIST|HIS-D|POL|AV', 5],
  ['HIST-SHO', 'Shoah', 'Shoah', 'Histoire', 'HIST|HIS-D|REL', 5],
  ['HIST-RES2', 'Résistance', 'French Resistance', 'Histoire', 'HIST|HIS-D', 4],
  ['HIST-GF', 'Guerre froide', 'Cold War', 'Histoire', 'HIST|HIS-D|POL|SF', 5],
  ['HIST-DEC', 'Décolonisation', 'Decolonization', 'Histoire', 'HIST|HIS-D|POL', 4],
  ['HIST-VE', 'Cinquième République', 'Fifth Republic', 'Histoire', 'HIST|HIS-D|POL', 3],
  ['HIST-FR', 'Histoire de France', 'History of France', 'Histoire', 'HIST|HIS-D', 5],
  ['HIST-CN', 'Histoire de la Chine', 'History of China', 'Histoire', 'HIST|HIS-D|GEO', 4],
  ['HIST-JP', 'Histoire du Japon', 'History of Japan', 'Histoire', 'HIST|HIS-D|GEO', 4],
  ['HIST-KR', 'Histoire de la Corée', 'History of Korea', 'Histoire', 'HIST|HIS-D|GEO', 3],
  ['HIST-US', 'Histoire des États-Unis', 'History of the United States', 'Histoire', 'HIST|HIS-D|POL', 4],
  ['HIST-RU', 'Histoire de la Russie', 'History of Russia', 'Histoire', 'HIST|HIS-D|POL', 3],
  ['HIST-DE', 'Histoire de l\u2019Allemagne', 'History of Germany', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-GB', 'Histoire du Royaume-Uni', 'History of the United Kingdom', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-IT', 'Histoire de l\u2019Italie', 'History of Italy', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-ES', 'Histoire de l\u2019Espagne', 'History of Spain', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-TR', 'Histoire de la Turquie', 'History of Turkey', 'Histoire', 'HIST|HIS-D|GEO', 3],
  ['HIST-EU', "Histoire de l'Europe", 'History of Europe', 'Histoire', 'HIST|HIS-D', 4],
  ['HIST-AF', "Histoire de l'Afrique", 'History of Africa', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-AS', "Histoire de l'Asie", 'History of Asia', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-AMN', "Histoire de l'Amérique du Nord", 'History of North America', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-AMS', "Histoire de l'Amérique du Sud", 'History of South America', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-MO', 'Histoire du Moyen-Orient', 'History of the Middle East', 'Histoire', 'HIST|HIS-D|POL', 3],
  ['HIST-OC', "Histoire de l'Océanie", 'History of Oceania', 'Histoire', 'HIST|HIS-D', 2],
  ['HIST-MED2', 'Histoire -- Méditerranée', 'Mediterranean history', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-REG', 'Histoire régionale', 'Regional history', 'Histoire', 'HIST|HIS-D', 3],
  ['HIST-COL', 'Colonisation', 'Colonization', 'Histoire', 'HIST|HIS-D|POL', 4],
  ['HIST-ESC', 'Esclavage', 'Slavery', 'Histoire', 'HIST|HIS-D|POL|SOC', 4],
  ['HIST-MIG', 'Migrations -- Histoire', 'Migrations -- History', 'Histoire', 'HIST|HIS-D|SOC', 3],
  ['HIST-IND2', 'Révolution industrielle', 'Industrial Revolution', 'Histoire', 'HIST|HIS-D|SCI|SOC', 3],
  ['HIST-GEN', 'Histoire -- Généralités', 'History -- General', 'Histoire', 'HIST|HIS-D', 4],
  ['GEO-AF', 'Afrique', 'Africa', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-AMN', 'Amérique du Nord', 'North America', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-AMS', 'Amérique du Sud', 'South America', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-AMC', 'Amérique centrale', 'Central America', 'Géographie', 'GEO|HIS-D|VOY', 2],
  ['GEO-AS', 'Asie', 'Asia', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-ASE', 'Asie du Sud-Est', 'Southeast Asia', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-ASC', 'Asie centrale', 'Central Asia', 'Géographie', 'GEO|HIS-D|VOY', 2],
  ['GEO-EU', 'Europe', 'Europe', 'Géographie', 'GEO|HIS-D|VOY', 5],
  ['GEO-EUE', "Europe de l'Est", 'Eastern Europe', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-EUN', 'Europe du Nord', 'Northern Europe', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-EUS', 'Europe du Sud', 'Southern Europe', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-OC', 'Océanie', 'Oceania', 'Géographie', 'GEO|HIS-D|VOY', 2],
  ['GEO-MO', 'Moyen-Orient', 'Middle East', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-MAG', 'Maghreb', 'Maghreb', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-SAH', 'Afrique subsaharienne', 'Sub-Saharan Africa', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-FR', 'France', 'France', 'Géographie', 'GEO|HIS-D|VOY', 5],
  ['GEO-DE', 'Allemagne', 'Germany', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-IT', 'Italie', 'Italy', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-ES', 'Espagne', 'Spain', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-UK', 'Royaume-Uni', 'United Kingdom', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-US', 'États-Unis', 'United States', 'Géographie', 'GEO|HIS-D|VOY', 5],
  ['GEO-JP', 'Japon', 'Japan', 'Géographie', 'GEO|HIS-D|VOY|ART', 5],
  ['GEO-CN', 'Chine', 'China', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-IN', 'Inde', 'India', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-RU', 'Russie', 'Russia', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-BR', 'Brésil', 'Brazil', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-CA', 'Canada', 'Canada', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-AU', 'Australie', 'Australia', 'Géographie', 'GEO|HIS-D|VOY', 2],
  ['GEO-EG', 'Égypte', 'Egypt', 'Géographie', 'GEO|HIS-D|VOY', 4],
  ['GEO-MA', 'Maroc', 'Morocco', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-DZ', 'Algérie', 'Algeria', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-TN', 'Tunisie', 'Tunisia', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-SN', 'Sénégal', 'Senegal', 'Géographie', 'GEO|HIS-D|VOY', 2],
  ['GEO-GR', 'Grèce', 'Greece', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-TR', 'Turquie', 'Turkey', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-IL', 'Israël', 'Israel', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-IR', 'Iran', 'Iran', 'Géographie', 'GEO|HIS-D|VOY', 2],
  ['GEO-MX', 'Mexique', 'Mexico', 'Géographie', 'GEO|HIS-D|VOY', 3],
  ['GEO-CU', 'Cuba', 'Cuba', 'Géographie', 'GEO|HIS-D|VOY', 2],
  ['GEO-MED', 'Méditerranée', 'Mediterranean', 'Géographie', 'GEO|HIS-D|VOY|NAT', 3],
  ['GEO-ALP', 'Alpes', 'Alps', 'Géographie', 'GEO|NAT|SPO|VOY', 2],
  ['GEO-PYR', 'Pyrénées', 'Pyrenees', 'Géographie', 'GEO|NAT|SPO|VOY', 2],
  ['SCI-AST', 'Astronomie', 'Astronomy', 'Sciences', 'SCI|SF|NAT', 5],
  ['SCI-ASP', 'Astrophysique', 'Astrophysics', 'Sciences', 'SCI|SF', 4],
  ['SCI-COS', 'Cosmologie', 'Cosmology', 'Sciences', 'SCI|SF', 4],
  ['SCI-SYS', 'Système solaire', 'Solar System', 'Sciences', 'SCI|SF', 5],
  ['SCI-ETO', 'Étoiles', 'Stars', 'Sciences', 'SCI|SF', 4],
  ['SCI-GAL', 'Galaxies', 'Galaxies', 'Sciences', 'SCI|SF', 3],
  ['SCI-UNI', 'Univers', 'Universe', 'Sciences', 'SCI|SF', 4],
  ['SCI-EXP', 'Exploration spatiale', 'Space exploration', 'Sciences', 'SCI|SF|HIS-D', 5],
  ['SCI-PHY', 'Physique', 'Physics', 'Sciences', 'SCI', 4],
  ['SCI-PHQ', 'Physique quantique', 'Quantum physics', 'Sciences', 'SCI', 3],
  ['SCI-REL', 'Relativité', 'Relativity', 'Sciences', 'SCI', 3],
  ['SCI-CHI', 'Chimie', 'Chemistry', 'Sciences', 'SCI', 4],
  ['SCI-BIO', 'Biologie', 'Biology', 'Sciences', 'SCI|NAT', 4],
  ['SCI-GEN', 'Génétique', 'Genetics', 'Sciences', 'SCI|NAT', 4],
  ['SCI-EVO', 'Évolution', 'Evolution', 'Sciences', 'SCI|NAT', 4],
  ['SCI-ECO', 'Écologie', 'Ecology', 'Sciences', 'SCI|NAT|SOC', 5],
  ['SCI-ENV', 'Environnement', 'Environment', 'Sciences', 'SCI|NAT|SOC', 5],
  ['SCI-CLI', 'Climat', 'Climate', 'Sciences', 'SCI|NAT|SOC', 5],
  ['SCI-RC', 'Réchauffement climatique', 'Global warming', 'Sciences', 'SCI|NAT|SOC', 5],
  ['SCI-DD', 'Développement durable', 'Sustainable development', 'Sciences', 'SCI|SOC', 4],
  ['SCI-MAT', 'Mathématiques', 'Mathematics', 'Sciences', 'SCI', 4],
  ['SCI-INF', 'Informatique', 'Computer science', 'Sciences', 'SCI|SF', 4],
  ['SCI-IA', 'Intelligence artificielle', 'Artificial intelligence', 'Sciences', 'SCI|SF|SOC', 5],
  ['SCI-MED', 'Médecine', 'Medicine', 'Sciences', 'SCI', 5],
  ['SCI-NEU', 'Neurosciences', 'Neuroscience', 'Sciences', 'SCI', 4],
  ['SCI-ANA', 'Anatomie', 'Anatomy', 'Sciences', 'SCI|NAT', 3],
  ['SCI-SAN', 'Santé', 'Health', 'Sciences', 'SCI|SOC', 4],
  ['SCI-NUT', 'Nutrition', 'Nutrition', 'Sciences', 'SCI|CUI|SAN', 3],
  ['SCI-GEO', 'Géologie', 'Geology', 'Sciences', 'SCI|NAT', 3],
  ['SCI-VOL', 'Volcanologie', 'Volcanology', 'Sciences', 'SCI|NAT', 2],
  ['SCI-OCE', 'Océanographie', 'Oceanography', 'Sciences', 'SCI|NAT', 3],
  ['SCI-MET', 'Météorologie', 'Meteorology', 'Sciences', 'SCI|NAT', 3],
  ['PHI-ANT', 'Philosophie antique', 'Ancient philosophy', 'Philosophie', 'PHI|HIS-D', 3],
  ['PHI-MOD', 'Philosophie moderne', 'Modern philosophy', 'Philosophie', 'PHI', 3],
  ['PHI-CON', 'Philosophie contemporaine', 'Contemporary philosophy', 'Philosophie', 'PHI', 3],
  ['PHI-ETH', 'Éthique', 'Ethics', 'Philosophie', 'PHI|SOC', 4],
  ['PHI-MET2', 'Métaphysique', 'Metaphysics', 'Philosophie', 'PHI', 3],
  ['PHI-EPI', 'Épistémologie', 'Epistemology', 'Philosophie', 'PHI|SCI', 3],
  ['PHI-LOG', 'Logique', 'Logic', 'Philosophie', 'PHI|SCI', 3],
  ['PHI-EST', 'Esthétique', 'Aesthetics', 'Philosophie', 'PHI|ART', 3],
  ['PHI-POL', 'Philosophie politique', 'Political philosophy', 'Philosophie', 'PHI|POL|SOC', 4],
  ['PHI-STO', 'Stoïcisme', 'Stoicism', 'Philosophie', 'PHI', 2],
  ['PHI-EXI', 'Existentialisme', 'Existentialism', 'Philosophie', 'PHI', 3],
  ['PHI-PHE', 'Phénoménologie', 'Phenomenology', 'Philosophie', 'PHI', 2],
  ['REL-CHR', 'Christianisme', 'Christianity', 'Religion', 'REL|HIS-D', 5],
  ['REL-CAT', 'Catholicisme', 'Catholicism', 'Religion', 'REL|HIS-D', 4],
  ['REL-PRO', 'Protestantisme', 'Protestantism', 'Religion', 'REL|HIS-D', 3],
  ['REL-ORT', 'Orthodoxie', 'Orthodoxy', 'Religion', 'REL|HIS-D', 2],
  ['REL-BIB', 'Bible', 'Bible', 'Religion', 'REL', 5],
  ['REL-JUD', 'Judaïsme', 'Judaism', 'Religion', 'REL|HIS-D', 4],
  ['REL-ISL', 'Islam', 'Islam', 'Religion', 'REL|HIS-D|SOC', 5],
  ['REL-COR', 'Coran', 'Quran', 'Religion', 'REL', 4],
  ['REL-SUN', 'Sunnisme', 'Sunni Islam', 'Religion', 'REL', 3],
  ['REL-CHI2', 'Chiisme', 'Shia Islam', 'Religion', 'REL', 3],
  ['REL-SOU', 'Soufisme', 'Sufism', 'Religion', 'REL', 2],
  ['REL-BOU', 'Bouddhisme', 'Buddhism', 'Religion', 'REL|HIS-D', 4],
  ['REL-HIN', 'Hindouisme', 'Hinduism', 'Religion', 'REL|HIS-D', 3],
  ['REL-SIK', 'Sikhisme', 'Sikhism', 'Religion', 'REL', 2],
  ['REL-TAO', 'Taoïsme', 'Taoism', 'Religion', 'REL|PHI', 2],
  ['REL-CON2', 'Confucianisme', 'Confucianism', 'Religion', 'REL|PHI', 2],
  ['REL-SHI', 'Shintoïsme', 'Shinto', 'Religion', 'REL', 2],
  ['REL-ANT', "Religions de l'Antiquité", 'Ancient religions', 'Religion', 'REL|HIS-D', 3],
  ['REL-MYG', 'Mythologie grecque', 'Greek mythology', 'Religion', 'REL|HIS-D|FAN', 5],
  ['REL-MYR', 'Mythologie romaine', 'Roman mythology', 'Religion', 'REL|HIS-D|FAN', 4],
  ['REL-MYN', 'Mythologie nordique', 'Norse mythology', 'Religion', 'REL|FAN', 4],
  ['REL-MYE', 'Mythologie égyptienne', 'Egyptian mythology', 'Religion', 'REL|HIS-D|FAN', 4],
  ['REL-MYM', 'Mythologie mésopotamienne', 'Mesopotamian mythology', 'Religion', 'REL|HIS-D', 2],
  ['REL-MYH', 'Mythologie hindoue', 'Hindu mythology', 'Religion', 'REL|FAN', 3],
  ['REL-MYC', 'Mythologie chinoise', 'Chinese mythology', 'Religion', 'REL|FAN', 2],
  ['REL-MYJ', 'Mythologie japonaise', 'Japanese mythology', 'Religion', 'REL|FAN', 2],
  ['REL-MYP', 'Mythologie précolombienne', 'Pre-Columbian mythology', 'Religion', 'REL|HIS-D', 2],
  ['REL-SPI', 'Spiritualité', 'Spirituality', 'Religion', 'REL|PHI|SOC', 4],
  ['REL-MED2', 'Méditation', 'Meditation', 'Religion', 'REL|SOC|SAN', 3],
  ['REL-YOG', 'Yoga', 'Yoga', 'Religion', 'REL|SAN|SPO', 3],
  ['REL-ESO', 'Ésotérisme', 'Esotericism', 'Religion', 'REL|FANT', 3],
  ['SOC-SOC', 'Sociologie', 'Sociology', 'Sciences humaines', 'SOC|HIS-D', 4],
  ['SOC-ANT', 'Anthropologie', 'Anthropology', 'Sciences humaines', 'SOC|HIS-D', 4],
  ['SOC-ETH', 'Ethnologie', 'Ethnology', 'Sciences humaines', 'SOC|HIS-D', 3],
  ['SOC-PSY', 'Psychologie', 'Psychology', 'Sciences humaines', 'SOC|PHI|SAN', 5],
  ['SOC-PSA', 'Psychanalyse', 'Psychoanalysis', 'Sciences humaines', 'SOC|PHI', 3],
  ['SOC-PSS', 'Psychologie sociale', 'Social psychology', 'Sciences humaines', 'SOC', 3],
  ['SOC-POL', 'Politique', 'Politics', 'Sciences humaines', 'SOC|POL|HIS-D', 5],
  ['SOC-ECO', 'Économie', 'Economics', 'Sciences humaines', 'SOC|POL', 4],
  ['SOC-ECP', 'Économie politique', 'Political economy', 'Sciences humaines', 'SOC|POL', 3],
  ['SOC-MON', 'Mondialisation', 'Globalization', 'Sciences humaines', 'SOC|POL|ECO', 4],
  ['SOC-DRO', 'Droit', 'Law', 'Sciences humaines', 'SOC', 4],
  ['SOC-DRC', 'Droit constitutionnel', 'Constitutional law', 'Sciences humaines', 'SOC|POL', 2],
  ['SOC-JUS', 'Justice', 'Justice', 'Sciences humaines', 'SOC|POL', 3],
  ['SOC-EDU', 'Éducation', 'Education', 'Sciences humaines', 'SOC|SCO', 4],
  ['SOC-PED', 'Pédagogie', 'Pedagogy', 'Sciences humaines', 'SOC|SCO', 3],
  ['SOC-FAM', 'Famille', 'Family', 'Sciences humaines', 'SOC', 5],
  ['SOC-GEN', 'Études de genre', 'Gender studies', 'Sciences humaines', 'SOC|POL', 3],
  ['SOC-FEM', 'Féminisme', 'Feminism', 'Sciences humaines', 'SOC|POL', 4],
  ['SOC-MIG', 'Migrations', 'Migrations', 'Sciences humaines', 'SOC|POL|HIS-D', 4],
  ['SOC-IMM', 'Immigration', 'Immigration', 'Sciences humaines', 'SOC|POL', 3],
  ['SOC-RAC', 'Racisme', 'Racism', 'Sciences humaines', 'SOC|POL|HIS-D', 4],
  ['SOC-DIS', 'Discrimination', 'Discrimination', 'Sciences humaines', 'SOC|POL', 4],
  ['SOC-INE', 'Inégalités sociales', 'Social inequality', 'Sciences humaines', 'SOC|POL|ECO', 4],
  ['SOC-PAU', 'Pauvreté', 'Poverty', 'Sciences humaines', 'SOC|ECO', 4],
  ['SOC-TRA', 'Travail', 'Work', 'Sciences humaines', 'SOC|ECO', 3],
  ['SOC-CHO', 'Chômage', 'Unemployment', 'Sciences humaines', 'SOC|ECO', 3],
  ['SOC-SYN', 'Syndicalisme', 'Trade unionism', 'Sciences humaines', 'SOC|POL|HIS-D', 3],
  ['SOC-MED3', 'Médias', 'Media', 'Sciences humaines', 'SOC|ART', 3],
  ['SOC-JOU', 'Journalisme', 'Journalism', 'Sciences humaines', 'SOC|ART', 3],
  ['SOC-PRO', 'Propagande', 'Propaganda', 'Sciences humaines', 'SOC|POL|HIS-D', 3],
  ['SOC-COM', 'Communication', 'Communication', 'Sciences humaines', 'SOC', 3],
  ['ART-PEI', 'Peinture', 'Painting', 'Arts', 'ART|HIS-D', 5],
  ['ART-SCU', 'Sculpture', 'Sculpture', 'Arts', 'ART|HIS-D', 4],
  ['ART-ARC', 'Architecture', 'Architecture', 'Arts', 'ART|HIS-D|GEO', 4],
  ['ART-PHO', 'Photographie', 'Photography', 'Arts', 'ART|HIS-D', 5],
  ['ART-CIN', 'Cinéma', 'Cinema', 'Arts', 'ART|SOC', 5],
  ['ART-THE', 'Théâtre', 'Theater', 'Arts', 'ART|HIS-D', 4],
  ['ART-DAN', 'Danse', 'Dance', 'Arts', 'ART|SPO', 3],
  ['ART-MUS', 'Musique', 'Music', 'Arts', 'ART|HIS-D', 5],
  ['ART-MUC', 'Musique classique', 'Classical music', 'Arts', 'ART|HIS-D', 4],
  ['ART-OPE', 'Opéra', 'Opera', 'Arts', 'ART|HIS-D', 3],
  ['ART-JAZ', 'Jazz', 'Jazz', 'Arts', 'ART|HIS-D', 4],
  ['ART-ROC', 'Rock', 'Rock music', 'Arts', 'ART|SOC', 4],
  ['ART-BD', 'Bande dessinée', 'Comic books', 'Arts', 'ART|BD', 5],
  ['ART-LIT', 'Littérature', 'Literature', 'Arts', 'ART|HIS-D', 5],
  ['ART-POE', 'Poésie', 'Poetry', 'Arts', 'ART', 4],
  ['ART-ROM', 'Roman (genre littéraire)', 'Novel', 'Arts', 'ART', 4],
  ['ART-DEC', 'Arts décoratifs', 'Decorative arts', 'Arts', 'ART|HIS-D', 3],
  ['ART-DES', 'Design', 'Design', 'Arts', 'ART|SOC', 3],
  ['ART-MOD', 'Mode', 'Fashion', 'Arts', 'ART|SOC', 3],
  ['ART-CAL', 'Calligraphie', 'Calligraphy', 'Arts', 'ART|HIS-D', 2],
  ['ART-GRA', 'Gravure', 'Engraving', 'Arts', 'ART|HIS-D', 2],
  ['ART-CER', 'Céramique', 'Ceramics', 'Arts', 'ART|HIS-D', 2],
  ['ART-CON', 'Art contemporain', 'Contemporary art', 'Arts', 'ART', 4],
  ['ART-MOD2', 'Art moderne', 'Modern art', 'Arts', 'ART', 3],
  ['ART-MED3', 'Art médiéval', 'Medieval art', 'Arts', 'ART|HIS-D', 3],
  ['ART-REN2', 'Art de la Renaissance', 'Renaissance art', 'Arts', 'ART|HIS-D', 3],
  ['ART-BAR', 'Art baroque', 'Baroque art', 'Arts', 'ART|HIS-D', 3],
  ['ART-IMP', 'Impressionnisme', 'Impressionism', 'Arts', 'ART|HIS-D', 3],
  ['ART-SUR', 'Surréalisme', 'Surrealism', 'Arts', 'ART', 3],
  ['ART-CUB', 'Cubisme', 'Cubism', 'Arts', 'ART', 2],
  ['NAT-ANI', 'Animaux', 'Animals', 'Nature', 'NAT|SCI', 5],
  ['NAT-MAM', 'Mammifères', 'Mammals', 'Nature', 'NAT|SCI', 4],
  ['NAT-OIS', 'Oiseaux', 'Birds', 'Nature', 'NAT|SCI', 4],
  ['NAT-REP', 'Reptiles', 'Reptiles', 'Nature', 'NAT|SCI', 3],
  ['NAT-AMP', 'Amphibiens', 'Amphibians', 'Nature', 'NAT|SCI', 2],
  ['NAT-POI', 'Poissons', 'Fish', 'Nature', 'NAT|SCI', 3],
  ['NAT-INS', 'Insectes', 'Insects', 'Nature', 'NAT|SCI', 3],
  ['NAT-ARA', 'Arachnides', 'Arachnids', 'Nature', 'NAT|SCI', 2],
  ['NAT-MAR', 'Animaux marins', 'Marine animals', 'Nature', 'NAT|SCI', 4],
  ['NAT-DIN', 'Dinosaures', 'Dinosaurs', 'Nature', 'NAT|SCI', 5],
  ['NAT-PLA', 'Plantes', 'Plants', 'Nature', 'NAT|SCI', 4],
  ['NAT-FLE', 'Fleurs', 'Flowers', 'Nature', 'NAT|SCI', 3],
  ['NAT-ARB', 'Arbres', 'Trees', 'Nature', 'NAT|SCI', 3],
  ['NAT-FOR', 'Forêts', 'Forests', 'Nature', 'NAT|SCI', 3],
  ['NAT-JAR', 'Jardins', 'Gardens', 'Nature', 'NAT|ART|CUI', 3],
  ['NAT-CHA', 'Champignons', 'Mushrooms', 'Nature', 'NAT|SCI|CUI', 2],
  ['NAT-ECO', 'Écosystèmes', 'Ecosystems', 'Nature', 'NAT|SCI', 3],
  ['NAT-BIO', 'Biodiversité', 'Biodiversity', 'Nature', 'NAT|SCI|SOC', 4],
  ['NAT-PRO', 'Protection de la nature', 'Nature conservation', 'Nature', 'NAT|SCI|SOC', 4],
  ['NAT-PAR', 'Parcs naturels', 'Natural parks', 'Nature', 'NAT|GEO|VOY', 2],
  ['NAT-MON', 'Montagnes', 'Mountains', 'Nature', 'NAT|GEO|SPO', 3],
  ['NAT-OCE2', 'Océans', 'Oceans', 'Nature', 'NAT|SCI|GEO', 4],
  ['NAT-MER', 'Mers', 'Seas', 'Nature', 'NAT|SCI|GEO', 3],
  ['NAT-RIV', 'Rivières', 'Rivers', 'Nature', 'NAT|SCI|GEO', 2],
  ['NAT-DES2', 'Déserts', 'Deserts', 'Nature', 'NAT|SCI|GEO', 3],
  ['SPO-FOOT', 'Football', 'Football', 'Sports', 'SPO', 5],
  ['SPO-RUG', 'Rugby', 'Rugby', 'Sports', 'SPO', 4],
  ['SPO-TEN', 'Tennis', 'Tennis', 'Sports', 'SPO', 4],
  ['SPO-CYC', 'Cyclisme', 'Cycling', 'Sports', 'SPO', 4],
  ['SPO-ATH', 'Athlétisme', 'Athletics', 'Sports', 'SPO', 3],
  ['SPO-NAT2', 'Natation', 'Swimming', 'Sports', 'SPO', 3],
  ['SPO-BAS', 'Basketball', 'Basketball', 'Sports', 'SPO', 3],
  ['SPO-HAN', 'Handball', 'Handball', 'Sports', 'SPO', 3],
  ['SPO-GOL', 'Golf', 'Golf', 'Sports', 'SPO', 2],
  ['SPO-COM', 'Sports de combat', 'Combat sports', 'Sports', 'SPO', 4],
  ['SPO-JUD', 'Judo', 'Judo', 'Sports', 'SPO', 3],
  ['SPO-BOX', 'Boxe', 'Boxing', 'Sports', 'SPO', 3],
  ['SPO-ESC', 'Escrime', 'Fencing', 'Sports', 'SPO', 2],
  ['SPO-EXT', 'Sports extrêmes', 'Extreme sports', 'Sports', 'SPO', 3],
  ['SPO-RAN', 'Randonnée', 'Hiking', 'Sports', 'SPO|NAT|VOY', 4],
  ['SPO-ALP', 'Alpinisme', 'Mountaineering', 'Sports', 'SPO|NAT', 3],
  ['SPO-VOI', 'Voile', 'Sailing', 'Sports', 'SPO', 2],
  ['SPO-AUT', 'Sports automobiles', 'Motorsport', 'Sports', 'SPO', 3],
  ['SPO-F1', 'Formule 1', 'Formula One', 'Sports', 'SPO', 4],
  ['SPO-JO', 'Jeux olympiques', 'Olympic Games', 'Sports', 'SPO|HIS-D', 4],
  ['CUI-FR', 'Cuisine française', 'French cuisine', 'Cuisine', 'CUI|ART', 5],
  ['CUI-IT', 'Cuisine italienne', 'Italian cuisine', 'Cuisine', 'CUI', 4],
  ['CUI-AS', 'Cuisine asiatique', 'Asian cuisine', 'Cuisine', 'CUI', 4],
  ['CUI-JP', 'Cuisine japonaise', 'Japanese cuisine', 'Cuisine', 'CUI', 4],
  ['CUI-CN', 'Cuisine chinoise', 'Chinese cuisine', 'Cuisine', 'CUI', 3],
  ['CUI-IN', 'Cuisine indienne', 'Indian cuisine', 'Cuisine', 'CUI', 3],
  ['CUI-MX', 'Cuisine mexicaine', 'Mexican cuisine', 'Cuisine', 'CUI', 2],
  ['CUI-MED4', 'Cuisine méditerranéenne', 'Mediterranean cuisine', 'Cuisine', 'CUI', 3],
  ['CUI-PAT', 'Pâtisserie', 'Pastry', 'Cuisine', 'CUI', 4],
  ['CUI-BOU', 'Boulangerie', 'Bakery', 'Cuisine', 'CUI', 3],
  ['CUI-VIN', 'Vins et spiritueux', 'Wine and spirits', 'Cuisine', 'CUI|SOC', 4],
  ['CUI-BIE', 'Bières', 'Beer', 'Cuisine', 'CUI', 3],
  ['CUI-REG', 'Régimes alimentaires', 'Diets', 'Cuisine', 'CUI|SAN', 3],
  ['CUI-VEG', 'Végétarisme', 'Vegetarianism', 'Cuisine', 'CUI|SAN|SOC', 3],
  ['CUI-VGN', 'Veganisme', 'Veganism', 'Cuisine', 'CUI|SAN|SOC', 3],
  ['VOY-GUI', 'Guides de voyage', 'Travel guides', 'Voyage', 'VOY|GEO', 5],
  ['VOY-REC', 'Récits de voyage', 'Travel narratives', 'Voyage', 'VOY|ART', 4],
  ['VOY-TOU', 'Tourisme', 'Tourism', 'Voyage', 'VOY|SOC', 3],
  ['VOY-VEL', 'Voyage à vélo', 'Bicycle touring', 'Voyage', 'VOY|SPO', 2],
  ['VOY-TRA', 'Voyage en train', 'Train travel', 'Voyage', 'VOY|HIS-D', 2],
  ['VOY-RAN2', 'Randonnée pédestre', 'Hiking', 'Voyage', 'VOY|SPO|NAT', 3],
  ['VOY-CAM', 'Camping', 'Camping', 'Voyage', 'VOY|NAT', 2],
  ['VOY-CRO', 'Croisières', 'Cruises', 'Voyage', 'VOY', 2],
  ['SF-SCI', 'Science-fiction', 'Science fiction', 'SF/Fantasy', 'SF|FAN|ART', 5],
  ['SF-ANT2', 'Anticipation', 'Anticipation', 'SF/Fantasy', 'SF', 4],
  ['SF-DYS', 'Dystopie', 'Dystopia', 'SF/Fantasy', 'SF|FANT|SOC', 5],
  ['SF-UCH', 'Uchronie', 'Alternate history', 'SF/Fantasy', 'SF|HIS-D', 3],
  ['SF-VSP', 'Voyage spatial', 'Space travel', 'SF/Fantasy', 'SF|SCI', 4],
  ['SF-EXT', 'Extraterrestres', 'Aliens', 'SF/Fantasy', 'SF', 4],
  ['SF-ROB', 'Robots', 'Robots', 'SF/Fantasy', 'SF|SCI', 4],
  ['SF-CYP', 'Cyberpunk', 'Cyberpunk', 'SF/Fantasy', 'SF|SCI', 3],
  ['SF-POS', 'Post-apocalyptique', 'Post-apocalyptic', 'SF/Fantasy', 'SF|FANT', 4],
  ['SF-FAN', 'Fantasy', 'Fantasy', 'SF/Fantasy', 'FAN|FANT', 5],
  ['SF-HEF', 'Heroic fantasy', 'Heroic fantasy', 'SF/Fantasy', 'FAN', 4],
  ['SF-MAG', 'Magie', 'Magic', 'SF/Fantasy', 'FAN|FANT', 4],
  ['SF-DRA', 'Dragons', 'Dragons', 'SF/Fantasy', 'FAN', 4],
  ['SF-ELF', 'Elfes', 'Elves', 'SF/Fantasy', 'FAN', 3],
  ['SF-MPA', 'Mondes parallèles', 'Parallel worlds', 'SF/Fantasy', 'SF|FANT', 3],
  ['SF-VTM', 'Voyage temporel', 'Time travel', 'SF/Fantasy', 'SF|FANT', 3],
  ['SF-FANT', 'Fantastique', 'The fantastic', 'SF/Fantasy', 'FANT', 4],
  ['SF-HOR', 'Horreur', 'Horror', 'SF/Fantasy', 'FANT|POL', 4],
  ['SF-VAM', 'Vampires', 'Vampires', 'SF/Fantasy', 'FANT|FAN', 4],
  ['SF-ZOM', 'Zombies', 'Zombies', 'SF/Fantasy', 'FANT|SF', 3],
  ['SF-LGR', 'Loups-garous', 'Werewolves', 'SF/Fantasy', 'FANT|FAN', 3],
  ['SF-FAN2', 'Fantômes', 'Ghosts', 'SF/Fantasy', 'FANT', 3],
  ['POL-POL', 'Roman policier', 'Detective fiction', 'Polar/Thriller', 'POL|ART', 5],
  ['POL-NOI', 'Roman noir', 'Noir fiction', 'Polar/Thriller', 'POL', 4],
  ['POL-THR', 'Thriller', 'Thriller', 'Polar/Thriller', 'POL|FIL', 5],
  ['POL-ESP', 'Espionnage', 'Espionage', 'Polar/Thriller', 'POL|HIS-D', 4],
  ['POL-ENQ', 'Enquête', 'Investigation', 'Polar/Thriller', 'POL|SOC', 4],
  ['POL-MEU', 'Meurtre', 'Murder', 'Polar/Thriller', 'POL|SOC', 3],
  ['POL-CRI', 'Crime', 'Crime', 'Polar/Thriller', 'POL|SOC', 3],
  ['POL-CRM', 'Criminalité', 'Criminality', 'Polar/Thriller', 'POL|SOC', 4],
  ['POL-MAF', 'Mafia', 'Mafia', 'Polar/Thriller', 'POL|SOC', 3],
  ['POL-TER', 'Terrorisme', 'Terrorism', 'Polar/Thriller', 'POL|SOC|HIS-D', 3],
  ['POL-DET', 'Détective', 'Detectives', 'Polar/Thriller', 'POL', 3],
  ['DIV-JV', 'Jeux vidéo', 'Video games', 'Divers', 'JV|SOC', 4],
  ['DIV-JDS', 'Jeux de société', 'Board games', 'Divers', 'JDS|SOC', 3],
  ['DIV-LOI', 'Loisirs créatifs', 'Crafts', 'Divers', 'SOC|ART', 3],
  ['DIV-COU', 'Couture', 'Sewing', 'Divers', 'ART|SOC', 2],
  ['DIV-TRI', 'Tricot', 'Knitting', 'Divers', 'ART|SOC', 2],
  ['DIV-BRI', 'Bricolage', 'DIY', 'Divers', 'SOC', 3],
  ['DIV-ANI', 'Animaux de compagnie', 'Pets', 'Divers', 'NAT|SOC', 3],
  ['DIV-CHA2', 'Chats', 'Cats', 'Divers', 'NAT|SOC', 3],
  ['DIV-CHI', 'Chiens', 'Dogs', 'Divers', 'NAT|SOC', 3],
  ['DIV-CHE', 'Chevaux', 'Horses', 'Divers', 'NAT|SPO', 2],
  ['DIV-ENE', 'Énergies renouvelables', 'Renewable energy', 'Divers', 'SCI|SOC', 3],
  ['DIV-NUC', 'Nucléaire', 'Nuclear energy', 'Divers', 'SCI|SOC|HIS-D', 3],
  ['DIV-PET', 'Pétrole', 'Petroleum', 'Divers', 'SCI|SOC|HIS-D', 3],
  ['DIV-CON3', 'Consommation', 'Consumption', 'Divers', 'SOC|ECO', 2],
  ['DIV-MON2', 'Monnaie', 'Money', 'Divers', 'SOC|ECO', 3],
  ['DIV-BAN', 'Banques', 'Banks', 'Divers', 'SOC|ECO', 3],
  ['DIV-BOU', 'Bourse', 'Stock exchange', 'Divers', 'SOC|ECO', 3],
];
function rameauByCode(c) { return RAMEAU_TERMS.find((r) => r[0] === c); }
/* Suggestions: termes alignés sur le genre de la fiche, triés par priorité */
function rameauSuggest(genre, medium) {
  const g = String(genre || '').toLowerCase();
  const scored = RAMEAU_TERMS.map((r) => {
    let score = r[5]; // priorité de base
    if (g && r[4].toLowerCase().includes(g.split('/')[0].trim())) score += 10; // alignement genre
    return { r, score };
  });
  return scored.sort((a, b) => b.score - a.score).map((x) => x.r);
}

/* Rendu des sujets RAMEAU — top-level (délégué au contexte openDetail via editingId) */
function renderSubj() {
  const sbox = document.getElementById('subjectsBox');
  if (!sbox || !editingId) return;
  const cur = store.findById(editingId);
  if (!cur) return;
  const subs = cur.subjects || [];
  const genreVal = document.querySelector('#detailForm [name="genre"]') ? document.querySelector('#detailForm [name="genre"]').value : '';
  const sugg = rameauSuggest(genreVal, cur.medium).slice(0, 60);
  let html = '';
  for (const c of subs) {
    const t = rameauByCode(c);
    html += `<span class="chip" style="background:#e8f0e6;border-color:#8fb58f;color:#2f5d2f">${esc(t ? (LANG === 'en' ? t[2] : t[1]) : c)} <button type="button" class="btn small" data-delsubj="${esc(c)}" style="padding:0 4px">✕</button></span> `;
  }
  if (subs.length < 3) {
    html += `<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
      <select id="subjSel" style="flex:1;min-width:140px">${sugg.map((r) => `<option value="${r[0]}">${esc(r[1])} (${r[3]})</option>`).join('')}</select>
      <button type="button" class="btn small" id="btnAddSubj">➕</button>
    </div>`;
  } else html += `<p class="hint">Maximum 3 sujets (règle RAMEAU pragmatique)</p>`;
  sbox.innerHTML = html;
  sbox.querySelectorAll('[data-delsubj]').forEach((b) => b.addEventListener('click', () => {
    const cur2 = store.findById(editingId);
    cur2.subjects = (cur2.subjects || []).filter((x) => x !== b.dataset.delsubj);
    store.update(cur2); renderSubj();
  }));
  const addS = sbox.querySelector('#btnAddSubj');
  if (addS) addS.addEventListener('click', () => {
    const c = sbox.querySelector('#subjSel').value;
    const cur2 = store.findById(editingId);
    cur2.subjects = cur2.subjects || [];
    if (!cur2.subjects.includes(c) && cur2.subjects.length < 3) { cur2.subjects.push(c); store.update(cur2); }
    renderSubj();
  });
}

/* Pré-suggestion RAMEAU (son §7.2): pour chaque fiche avec un genre, propose 1-3 sujets — l'utilisateur valide */
function presuggererSujets() {
  let proposés = 0, déjà = 0, sansGenre = 0;
  for (const it of store.items) {
    if ((it.subjects || []).length) { déjà++; continue; }
    if (!it.genre) { sansGenre++; continue; }
    const sugg = rameauSuggest(it.genre, it.medium).slice(0, 3);
    if (sugg.length) { it.subjects = sugg.map((r) => r[0]); proposés++; }
  }
  if (proposés) { store.save(); renderAll(); autoBackupTick(); }
  return { proposés, déjà, sansGenre };
}

function isBookEan(code) {
  return /^(978|979)/.test(code);
}

/* 🔎 Mode recherche par scan : le scan ouvre la fiche du livre si vous l'avez (aucun ajout) */
function scanLookupMode() {
  try { return localStorage.getItem('biblio.scanLookup') === '1'; } catch { return false; }
}
function toggleScanLookupMode() {
  const v = !scanLookupMode();
  try { localStorage.setItem('biblio.scanLookup', v ? '1' : '0'); } catch {}
  toast(v ? tm('lookup_on') : tm('lookup_off'), 3000);
  return v;
}

async function lookupAndMaybeAdd(isbn, silentDup = false) {
  isbn = normalizeIsbn(isbn);
  if (!/^[0-9]{9}[0-9X]|[0-9]{13}$/.test(isbn)) { toast(tm('bad_isbn')); return; }
  // 🔎 MODE RECHERCHE: ouvrir la fiche existante, jamais créer
  if (scanLookupMode()) {
    const found = store.items.filter((x) => x.isbn === isbn && !x.disposedHow);
    if (found.length) { stopScan(); openDetail(found[0].id); scanBeep(true); return; }
    scanBeep(false);
    toast(tm('lookup_notfound', isbn), 4000);
    return;
  }
  // EAN non-livre: d'abord tenter la reconnaissance automatique (MusicBrainz via relais — CD/vinyles)
  if (/^[0-9]{13}$/.test(isbn) && !isBookEan(isbn)) {
    if (!silentDup) toast(tm('searching'));
    let mediaMeta = await fetchRelay(isbn).catch(() => null);
    if (!(mediaMeta && mediaMeta.title && !/^EAN/.test(mediaMeta.title))) {
      // Fallback musique: Discogs par code-barres (le relais MusicBrainz n'a rien trouvé)
      try { mediaMeta = await fetchDiscogsByBarcodeOrTitle({ barcode: isbn }); } catch { mediaMeta = null; }
      if (mediaMeta) mediaMeta.medium = 'music';
    }
    if (mediaMeta && mediaMeta.title && !/^EAN/.test(mediaMeta.title)) {
      const dupM = store.findByIsbn(isbn);
      const media = store.add({ isbn, title: mediaMeta.title, authors: [], medium: mediaMeta.medium || 'music', status: 'unread', addedAt: new Date().toISOString(), related: [], ...mediaMeta });
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
    const media = store.add({ isbn, title: 'EAN ' + isbn, authors: [], medium: 'other', status: 'unread', addedAt: new Date().toISOString(),
      note: tm('media_ean_hint'), related: [] });
    toast(tm('media_ean_created_v2'), 7000);
    renderAll();
    openDetail(media.id);
    // focus direct sur le champ Titre: l'utilisateur saisit le titre (ex: « Rogue One ») puis 🤖 → TMDB trouve tout
    setTimeout(() => { const tEl = document.querySelector('#detailForm [name="title"]'); if (tEl) { tEl.focus(); tEl.select(); } }, 300);
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
  if (meta && meta.title && isNonLatinTitle(meta.title)) {
    scanBeep(false);
    toast((LANG === 'en' ? '\u26a0\ufe0f Title in non-Latin script (\u00ab ' : '\u26a0\ufe0f Titre en \u00e9criture non latine (\u00ab ') + String(meta.title).slice(0, 30) + (LANG === 'en' ? ' \u00bb) \u2014 dubious source record, verify this record' : ' \u00bb) \u2014 notice source douteuse, v\u00e9rifiez cette fiche'), 7000);
  }
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
$('#btnDupOpen').addEventListener('click', () => { $('#dupModal').classList.add('hidden'); if (pendingIsbn) { const ex = store.items.find((x) => x.isbn === pendingIsbn); if (ex) { openDetail(ex.id); return; } } const d = store.items.filter((x) => x.isbn === (pendingIsbn || '')); if (d.length) openDetail(d[0].id); });
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
    // caméra indisponible : la modale reste OUVERTE pour la douchette (le scan clavier marche sans caméra)
    $('#scanStatus').textContent = t('cam_nolib') + ' ' + t('scanner_ok_anyway');
    $('#scanVideo').style.display = 'none';
    return;
  }
  codeReader = new ZXing.BrowserMultiFormatReader();
  try {
    await codeReader.decodeFromVideoDevice(null, $('#scanVideo'), (result, err) => {
      if (result && scanActive) {
        const txt = result.getText();
        if (txt) processScanText(txt);
      }
    });
    $('#scanStatus').textContent = burstScan
      ? '⚡ Mode rafale : chaque code scanné est ajouté directement. Continuez sans fermer.'
      : 'Visez le code-barres (EAN-13 / ISBN) au dos du livre… ou scannez avec la douchette (elle fonctionne ici)';
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

/* ⌨️ Douchette dans la modale scan : le Netum C750 (mode Normal/HID) tape le code très vite
   puis envoie CR&LF. Quand la modale scan est ouverte, on bufferise et on traite au Enter —
   exactement le même flux que la caméra (processScanText). */
let __kbScanBuf = '';
let __kbScanLast = 0;
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('scanModal');
  if (!modal || modal.classList.contains('hidden')) return;
  // ne pas capter si le focus est dans un champ de saisie de la modale (aucun normalement)
  const tg = e.target;
  if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
  const now = Date.now();
  if (now - __kbScanLast > 300) __kbScanBuf = ''; // flot lent = frappe humaine, pas douchette
  __kbScanLast = now;
  if (e.key === 'Enter') {
    e.preventDefault();
    const code = __kbScanBuf.trim();
    __kbScanBuf = '';
    if (code && scanActive) processScanText(code);
    else if (code) $('#scanStatus').textContent = '⌨️ ' + code + ' ' + t('scanner_paused_hint');
    return;
  }
  if (e.key && e.key.length === 1) {
    __kbScanBuf += e.key;
    e.preventDefault();
    // retour visuel direct: la douchette tape, on le montre
    $('#scanStatus').textContent = '⌨️ ' + __kbScanBuf;
  }
});

function processScanText(txt) {

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
            // GARDE: le flag peut être périmé (scan annulé, session ultérieure) — ne JAMAIS détourner
            // un scan vers une fiche qui a déjà un vrai titre: créer une nouvelle fiche à la place
            const tgt = store.findById(targetId);
            if (!tgt || !isBlankFiche(tgt)) { lookupAndMaybeAdd(txt); return; }
            stopScan();
            completeBlankWithScan(targetId, txt);
            return;
          }
          // mode scan des inconnus du bilan photo: l'ISBN crée la fiche du prochain inconnu, rangée à sa position
          if (window.__shelfScanQueue && window.__shelfScanQueue.length && !invSession) {
            // GARDE ANTI-DOUBLON: la caméra détecte le code à CHAQUE frame — un seul traitement par code,
            // et attendre la fin du traitement précédent avant d'accepter le suivant
            const now = Date.now();
            if (window.__shelfScanBusy) return; // traitement en cours: ignorer les frames
            if (txt === window.__shelfScanLastCode && now - (window.__shelfScanLastTime || 0) < 2500) return;
            window.__shelfScanLastCode = txt;
            window.__shelfScanLastTime = now;
            window.__shelfScanBusy = true;
            const u = window.__shelfScanQueue[0];
            (async () => {
              try {
              const isbn = normalizeIsbn(txt);
              const meta = await fetchMetadataSmart(isbn).catch(() => null);
              if (!meta || !meta.title) { scanBeep(false); toast(tm('lookup_notfound', txt), 3500); window.__shelfScanBusy = false; return; }
              const parts = (u.loc || '').split('·').map((x) => x.trim()).filter(Boolean);
              const item = { ...blankItem(isbn), ...meta, title: meta.title, isbn,
                furniture: u.furniture || parts[0] || '', slot: u.slot || parts.slice(1).join(' · ') || '', location: u.loc || '',
                status: 'unread', photoPos: u.pos || null };
              store.add(item);
              window.__shelfScanQueue.shift();
              // retirer l'inconnu du bilan et faire disparaitre sa ligne
              window.__shelfUnknown = (window.__shelfUnknown || []).filter((x) => x !== u);
              const key = (u.loc || '') + '#' + (u.pos || '');
              if ($('#shelfResult')) {
                $('#shelfResult').querySelectorAll('.inv-line[data-key]').forEach((el) => { if (el.dataset.key === key) el.remove(); });
              }
              const cbBtn3 = document.getElementById('btnShelfCreateBlanks');
              if (cbBtn3) cbBtn3.textContent = '📥 ' + t('ph_create_blanks') + ' (' + (window.__shelfUnknown.length) + ')';
              const suBtn2 = document.getElementById('btnShelfScanUnknowns');
              if (suBtn2) suBtn2.textContent = '📷 ' + t('ph_scan_unknowns') + ' (' + (window.__shelfUnknown.length) + ')';
              scanBeep(true);
              toast(tm('ph_scan_unknowns_done', meta.title, window.__shelfScanQueue.length), 3000);
              if (window.__shelfScanQueue.length && $('#scanStatus')) {
                const nxt = window.__shelfScanQueue[0];
                $('#scanStatus').textContent = tm('ph_scan_next_hint', nxt.loc || '', nxt.pos || '?', window.__shelfScanQueue.length);
              }
              renderAll();
              autoBackupTick();
              scheduleAutoSync();
              if (!window.__shelfScanQueue.length) { stopScan(); toast(tm('ph_scan_unknowns_complete'), 5000); }
              } catch (e) { toast(tm('err_ai') + ' ' + (e && e.message), 4000); }
              window.__shelfScanBusy = false; // toujours libérer, même en cas d'erreur
            })();
            return;
          }
          if (invSession) { invHandleScan(txt); return; }
          if (burstScan) {
            // MODE COLLECTEUR (proposition utilisateur): on empile les codes SANS traiter —
            // zéro lookup async pendant le scan, zéro modal au milieu de la caméra.
            // Le traitement se fait en lot à la fermeture (stopScan -> processBurstCodes)
            const now = Date.now();
            if (txt === lastScannedCode && now - lastScanTime < 2500) return; // même code: anti-rebond caméra
            lastScannedCode = txt;
            lastScanTime = now;
            window.__burstCodes = window.__burstCodes || [];
            // PAS de dédoublonnage: deux scans du même code = DEUX EXEMPLAIRES physiques
            // (l'anti-rebond 2,5 s protège déjà des frames répétées de la caméra)
            window.__burstCodes.push(txt);
            scanBeep(true);
            $('#scanStatus').textContent = '\ud83d\udce5 ' + window.__burstCodes.length + (LANG === 'en' ? ' code(s) collected \u2014 keep scanning, close to process' : ' code(s) collect\u00e9(s) \u2014 continuez, fermez pour traiter');
            return;
          }
          stopScan();
          lookupAndMaybeAdd(txt);
        }
      }


/* Traitement en lot des codes collectés en rafale (à la fermeture du scan).
   Séquentiel (garde d'occupation), doublons ignorés sans modal, bilan final.
   Proposition utilisateur: « scanner et écrire tous les codes-barres puis ensuite
   les fiches seraient créées, doublon ou pas » */
async function processBurstCodes() {
  const codes = (window.__burstCodes || []).slice();
  window.__burstCodes = [];
  if (!codes.length) return;
  if (window.__burstBusy) return;
  window.__burstBusy = true;
  let created = 0, dups = 0, copies = 0, fails = 0, reshelved = 0, pos = 0;
  const seen = {};
  toast((LANG === 'en' ? 'Processing ' : 'Traitement de ') + codes.length + (LANG === 'en' ? ' code(s)\u2026' : ' code(s)\u2026'), 3000);
  for (const code of codes) {
    try {
      const isbn = normalizeIsbn(code);
      if (!isbn) { fails++; continue; }
      seen[isbn] = (seen[isbn] || 0) + 1;
      const existing = store.findByIsbn(isbn);
      // 1er scan d'un code déjà en bibliothèque: SANS modal —
      //   mode rangement actif (📦) = CONTRÔLE D'ÉTAGÈRE: la fiche existante se RE-RANGE sur l'étagère scannée
      //   sinon = ignoré (déjà présent)
      if (existing.length && seen[isbn] === 1) {
        if (shelveMode) { for (const ex of existing) { if (!ex.disposedHow) { applyShelveMode(ex); if (ex.photoPos) pos = ex.photoPos; else { ex.photoPos = ++pos; } store.update(ex); reshelved++; } } }
        else dups++;
        continue;
      }
      if (seen[isbn] > 1) copies++;
      await lookupAndMaybeAdd(isbn, true); // silentDup: pas de modal pendant le lot
      const last = store.items[store.items.length - 1];
      if (last && last.isbn === isbn && !/^(ISBN|EAN) \\d+/.test(String(last.title || ''))) {
        created++;
        if (shelveMode) {
          // INSERTION: le nouveau prend la place suivant la dernière position scannée,
          // les occupants >= cette position se décalent de +1 (procédure avant/manquant/après)
          const insPos = pos + 1;
          if (last.furniture && last.slot) {
            for (const o of store.items) {
              if (o.id !== last.id && o.furniture === last.furniture && o.slot === last.slot && o.photoPos && o.photoPos >= insPos) o.photoPos = o.photoPos + 1;
            }
          }
          last.photoPos = insPos; pos = insPos; store.update(last);
        }
      }
      else fails++;
    } catch (eB) { fails++; }
  }
  window.__burstBusy = false;
  scanBeep(true);
  toast('\u2705 ' + (LANG === 'en' ? 'Batch done: ' : 'Lot trait\u00e9 : ') + created + (LANG === 'en' ? ' created \u00b7 ' : ' cr\u00e9\u00e9e(s) \u00b7 ') + copies + (LANG === 'en' ? ' extra copy(ies) \u00b7 ' : ' exemplaire(s) en plus \u00b7 ') + reshelved + (LANG === 'en' ? ' re-shelved \u00b7 ' : ' re-rang\u00e9(e(s)) \u00b7 ') + dups + (LANG === 'en' ? ' already in library \u00b7 ' : ' d\u00e9j\u00e0 pr\u00e9sent(es) \u00b7 ') + fails + (LANG === 'en' ? ' not found (blank records, purgeable)' : ' introuvable(s) (fiches vides, purgeables)'), 9000);
  renderAll();
  autoBackupTick();
  scheduleAutoSync();
}

function stopScan() {
  // rafale: traiter les codes collectés à la fermeture
  if (window.__burstCodes && window.__burstCodes.length && !window.__burstBusy) { processBurstCodes(); }
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
        .join(' ').toLowerCase || (i.subjects || []).some((sc) => { const t = rameauByCode(sc); return t && (String(t[1]) + ' ' + String(t[2])).toLowerCase().includes(q); })().includes(q));
  }
  const cmp = {
    added: (a, b) => b.addedAt.localeCompare(a.addedAt),
    title: (a, b) => a.title.localeCompare(b.title, 'fr'),
    author: (a, b) => (a.authors[0] || '').localeCompare(b.authors[0] || '', 'fr'),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    year: (a, b) => (b.publishedDate || '').localeCompare(a.publishedDate || ''),
    dewey: (a, b) => (parseFloat(a.dewey) || 1e9) - (parseFloat(b.dewey) || 1e9) || (a.genre || '').localeCompare(b.genre || '', 'fr'),
    series: (a, b) => (a.series || a.title || '').localeCompare(b.series || b.title || '', 'fr', { numeric: true }) || (parseInt(a.volume, 10) || 0) - (parseInt(b.volume, 10) || 0) || (a.title || '').localeCompare(b.title || '', 'fr'),
    shelf: (a, b) => (a.furniture || '').localeCompare(b.furniture || '', 'fr', { numeric: true }) || (a.slot || '').localeCompare(b.slot || '', 'fr', { numeric: true }) || ((a.photoPos || 1e9) - (b.photoPos || 1e9)),
  }[sort];
  return items.sort(cmp);
}

/* Volume affichable sur les mini-fiches: champ volume, sinon numéro collé en fin de titre
   (cas des fiches créées avant l'extraction automatique — affichage seul, les données ne sont pas modifiées). */
function displayVolume(it) {
  if (it.volume) return String(it.volume);
  const m = String(it.title || '').match(/(?:tome|t\.|vol\.?|volume|#)\s*(\d{1,3})\s*$/i);
  return m ? m[1] : '';
}


/* En-tetes explicatifs des barres Actions/Selection — injectes par JS pour etre robustes
   (les valeurs data-i18n ecrasent le HTML au demarrage; l'injection JS garantit leur presence
   meme avec un index.html perime — bug reel: en-tetes jamais visibles chez l'utilisateur) */

/* 🗂️ Organiser une étagère: trier les livres d'une étagère selon un critère (titre, série+tome,
   genre, cote, auteur, ajout) et les numéroter 1, 2, 3… — la numérotation ordinale devient
   le plan de rangement physique de la collection (cahier des charges utilisateur). */
function openOrganizeShelf() {
  const mf = document.getElementById('orgFurniture');
  const sl = document.getElementById('orgSlot');
  if (!mf || !sl) return;
  mf.innerHTML = knownFurniture().map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  sl.innerHTML = knownSlots().map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  document.getElementById('organizeModal').classList.remove('hidden');
}
function orgToggleScope() {
  const all = document.getElementById('orgScope') && document.getElementById('orgScope').value === 'all';
  const o = document.getElementById('orgOneRow'); const a = document.getElementById('orgAllRows');
  if (o) o.style.display = all ? 'none' : 'flex';
  if (a) a.style.display = all ? 'flex' : 'none';
}
(function wireOrganize() {
  const osc = document.getElementById('orgScope');
  if (osc) osc.addEventListener('change', orgToggleScope);

  const ob = document.getElementById('btnOrganizeShelf');
  if (ob) ob.addEventListener('click', openOrganizeShelf);
  const oc = document.getElementById('btnOrganizeCancel');
  if (oc) oc.addEventListener('click', () => document.getElementById('organizeModal').classList.add('hidden'));
  const og = document.getElementById('btnOrganizeGo');
  const __orgGo = () => {
    const order = document.getElementById('orgOrder').value;
    const scopeAll = document.getElementById('orgScope') && document.getElementById('orgScope').value === 'all';
    let books, furn, slot;
    if (scopeAll) {
      // TOUTE LA COLLECTION: plan complet — tri global puis répartition étagère par étagère
      furn = (document.getElementById('orgAllFurniture') || {}).value || '';
      const cap = parseInt((document.getElementById('orgCapacity') || {}).value, 10) || 30;
      // Ordre « № sur l'étagère »: RE-NUMÉROTATION SANS DÉPLACEMENT — chaque livre reste dans
      // son meuble/étagère, on compacte simplement les n° 1..N par étagère (pas de destination requise)
      if (order === 'position') {
        const perShelf = {};
        for (const i of store.items) {
          if (i.disposedHow || i.wishlist) continue;
          const k = (i.furniture || '?') + '|' + (i.slot || '?');
          (perShelf[k] = perShelf[k] || []).push(i);
        }
        let tot = 0;
        for (const k of Object.keys(perShelf)) perShelf[k].sort((x, y) => (x.photoPos || 1e9) - (y.photoPos || 1e9));
        const all = Object.values(perShelf).flat();
        if (!all.length) { toast(tm('bulk_pick')); return; }
        if (!confirm((LANG === 'en' ? 'Re-number in place (no move) ' : 'Re-numéroter sur place (sans déplacer) ') + all.length + (LANG === 'en' ? ' book(s) across ' : ' livre(s) sur ') + Object.keys(perShelf).length + (LANG === 'en' ? ' shelf(s)?' : ' étagère(s) ?'))) return;
        saveBulkSnapshot(all);
        for (const k of Object.keys(perShelf)) perShelf[k].forEach((b, idx) => { b.photoPos = idx + 1; store.update(b); tot++; });
        document.getElementById('organizeModal').classList.add('hidden');
        renderAll();
        toast('✅ ' + tot + (LANG === 'en' ? ' re-numbered in place' : ' livre(s) re-numéroté(s) sur place'), 6000);
        return;
      }
      if (!furn) { toast(LANG === 'en' ? 'Pick a destination bookcase' : 'Choisissez le meuble de destination', 4000); return; }
      books = store.items.filter((i) => !i.disposedHow && !i.wishlist);
      if (!books.length) { toast(tm('bulk_pick')); return; }
      const nShelves = Math.ceil(books.length / cap);
      if (!confirm((LANG === 'en' ? 'Sort and shelve ALL ' : 'Trier et ranger TOUS les ') + books.length + (LANG === 'en' ? ' book(s) into ' : ' livre(s) dans ') + furn + ' · ' + nShelves + (LANG === 'en' ? ' shelf(s) of ' : ' étagère(s) de ') + cap + (LANG === 'en' ? ' (Étagère 1…' + nShelves + ') ?' : ' (Étagère 1…' + nShelves + ') ?'))) return;
      const cmpAll = {
        title: (a, b) => (a.title || '').localeCompare(b.title || '', 'fr'),
        series: (a, b) => (a.series || a.title || '').localeCompare(b.series || b.title || '', 'fr') || (parseInt(a.volume, 10) || 0) - (parseInt(b.volume, 10) || 0),
        genre: (a, b) => (a.genre || '').localeCompare(b.genre || '', 'fr') || (a.title || '').localeCompare(b.title || '', 'fr'),
        dewey: (a, b) => (parseFloat(a.dewey) || 1e9) - (parseFloat(b.dewey) || 1e9) || (a.title || '').localeCompare(b.title || '', 'fr'),
        author: (a, b) => (a.authors[0] || '').localeCompare(b.authors[0] || '', 'fr'),
        added: (a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''),
        'added-desc': (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
        position: (a, b) => (a.furniture || '').localeCompare(b.furniture || '', 'fr') || (a.slot || '').localeCompare(b.slot || '', 'fr') || ((a.photoPos || 1e9) - (b.photoPos || 1e9)),
      }[order] || ((a, b) => (a.title || '').localeCompare(b.title || '', 'fr'));
      books.sort(cmpAll);
      saveBulkSnapshot(books);
      books.forEach((b, idx) => {
        const shelfNo = Math.floor(idx / cap) + 1;
        b.furniture = furn;
        b.slot = 'Étagère ' + shelfNo;
        b.location = furn + ' · ' + b.slot;
        b.photoPos = (idx % cap) + 1;
        store.update(b);
      });
      document.getElementById('organizeModal').classList.add('hidden');
      renderAll();
      toast('✅ ' + books.length + (LANG === 'en' ? ' book(s) sorted and shelved into ' : ' livre(s) trié(s) et rangé(s) dans ') + nShelves + (LANG === 'en' ? ' shelf(s) — view with sort "Shelf (position)"' : ' étagère(s) — visualisez avec le tri « Étagère (position) »'), 8000);
      return;
    }
    furn = document.getElementById('orgFurniture').value;
    slot = document.getElementById('orgSlot').value;
    books = store.items.filter((i) => i.furniture === furn && i.slot === slot && !i.disposedHow);
    if (!books.length) { toast(LANG === 'en' ? 'No book on this shelf' : 'Aucun livre sur cette étagère', 4000); return; }
    if (!confirm((LANG === 'en' ? 'Sort and number ' : 'Trier et numéroter ') + books.length + (LANG === 'en' ? ' book(s) of ' : ' livre(s) de ') + furn + ' · ' + slot + ' ?')) return;
    const cmp = {
      title: (a, b) => (a.title || '').localeCompare(b.title || '', 'fr'),
      series: (a, b) => (a.series || a.title || '').localeCompare(b.series || b.title || '', 'fr') || (parseInt(a.volume, 10) || 0) - (parseInt(b.volume, 10) || 0),
      genre: (a, b) => (a.genre || '').localeCompare(b.genre || '', 'fr') || (a.title || '').localeCompare(b.title || '', 'fr'),
      dewey: (a, b) => (parseFloat(a.dewey) || 1e9) - (parseFloat(b.dewey) || 1e9) || (a.title || '').localeCompare(b.title || '', 'fr'),
      author: (a, b) => (a.authors[0] || '').localeCompare(b.authors[0] || '', 'fr'),
      added: (a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''),
      'added-desc': (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
      position: (a, b) => (a.photoPos || 1e9) - (b.photoPos || 1e9),
    }[order] || ((a, b) => (a.title || '').localeCompare(b.title || '', 'fr'));
    books.sort(cmp);
    saveBulkSnapshot(books);
    books.forEach((b, idx) => { b.photoPos = idx + 1; store.update(b); });
    document.getElementById('organizeModal').classList.add('hidden');
    renderAll();
    toast('✅ ' + books.length + (LANG === 'en' ? ' book(s) sorted and numbered — view with sort "Shelf (position)"' : ' livre(s) trié(s) et numéroté(s) № 1→' + books.length + ' — visualisez avec le tri « Étagère (position) »'), 7000);
  };
  if (og) og.addEventListener('click', __orgGo);
  window.__orgGo = __orgGo;
})();


/* Injection JS de l\u2019outil Organiser (bouton + modal): ind\u00e9pendant de la fra\u00eecheur d\u2019index.html —
   comme les en-t\u00eates de barres, la fonctionnalit\u00e9 existe d\u00e8s qu\u2019app.js est \u00e0 jour
   (bug r\u00e9el: bouton absent chez l\u2019utilisateur car son index.html \u00e9tait p\u00e9rim\u00e9). */
function ensureOrganizeUI() {
  if (!document.getElementById('organizeModal')) {
    const m = document.createElement('div');
    m.id = 'organizeModal'; m.className = 'modal hidden';
    m.innerHTML = `
  <div class="modal-box">
    <h2>🗂\uFE0F Organiser le rangement</h2>
    <p class="hint">Trie et num\u00e9rote selon le crit\u00e8re choisi. Port\u00e9e \u00ab TOUTE la collection \u00bb: r\u00e9partit tous les livres \u00e9tag\u00e8re par \u00e9tag\u00e8re dans le meuble de destination. Pour ins\u00e9rer UN livre entre deux num\u00e9ros: champ \u2116 de sa fiche, ou scan d\u2019insertion en rafale.</p>
    <div class="form-row">
      <div style="flex:1"><label>Port\u00e9e</label>
        <select id="orgScope">
          <option value="one">Une \u00e9tag\u00e8re (re-num\u00e9roter)</option>
          <option value="all">TOUTE la collection (plan complet)</option>
        </select>
      </div>
    </div>
    <div id="orgOneRow" class="form-row">
      <div style="flex:1"><label>Meuble</label><select id="orgFurniture"></select></div>
      <div style="flex:1"><label>\u00c9tag\u00e8re</label><select id="orgSlot"></select></div>
    </div>
    <div id="orgAllRows" class="form-row" style="display:none">
      <div style="flex:1"><label>Meuble de destination (tous les livres y seront rang\u00e9s)</label><input type="text" id="orgAllFurniture" list="furnitureList" placeholder="ex. Biblioth\u00e8que salon"></div>
      <div style="flex:1"><label>Capacit\u00e9 par \u00e9tag\u00e8re (nb de livres)</label><input type="number" id="orgCapacity" min="1" value="30"></div>
    </div>
    <div class="form-row">
      <div style="flex:1"><label>Ordre de rangement</label>
        <select id="orgOrder">
          <option value="title">Titre A \u2192 Z</option>
          <option value="series">S\u00e9rie + num\u00e9ro de tome</option>
          <option value="genre">Genre puis titre</option>
          <option value="dewey">Cote Dewey / genre</option>
          <option value="author">Auteur A \u2192 Z</option>
          <option value="added">Ajout (ancien \u2192 r\u00e9cent)</option>
          <option value="added-desc">Ajout (r\u00e9cent \u2192 ancien)</option>
          <option value="position">N\u00ba sur l\u2019\u00e9tag\u00e8re (ordre physique actuel, par meuble)</option>
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button id="btnOrganizeGo" class="btn btn-primary">🗂\uFE0F Organiser maintenant</button>
      <button id="btnOrganizeCancel" class="btn" data-i18n="cancel">Annuler</button>
    </div>
  </div>`;
    document.body.appendChild(m);
  }
  const fb = document.getElementById('filterOpsBar');
  if (fb && !document.getElementById('btnOrganizeShelf')) {
    const b = document.createElement('button');
    b.id = 'btnOrganizeShelf'; b.className = 'btn small';
    b.textContent = '🗂\uFE0F Organiser le rangement';
    const pur = document.getElementById('btnPurgeBlanks');
    if (pur) fb.insertBefore(b, pur.nextSibling); else fb.appendChild(b);
  }
  // (re)c\u00e2bler: les \u00e9couteurs sont idempotents gr\u00e2ce aux gardes d\u2019existence
  const ob = document.getElementById('btnOrganizeShelf');
  if (ob && !ob.dataset.wired) { ob.dataset.wired = '1'; ob.addEventListener('click', openOrganizeShelf); }
  const osc = document.getElementById('orgScope');
  if (osc && !osc.dataset.wired) { osc.dataset.wired = '1'; osc.addEventListener('change', orgToggleScope); }
  const oc = document.getElementById('btnOrganizeCancel');
  if (oc && !oc.dataset.wired) { oc.dataset.wired = '1'; oc.addEventListener('click', () => document.getElementById('organizeModal').classList.add('hidden')); }
  const og = document.getElementById('btnOrganizeGo');
  if (og && !og.dataset.wired) { og.dataset.wired = '1'; og.addEventListener('click', () => { if (window.__orgGo) window.__orgGo(); }); }
}

function ensureBarHeaders() {
  const mk = (bg, color, txt) => { const sp = document.createElement('span'); sp.className = 'badge bulk-hint-header'; sp.style.cssText = 'background:' + bg + ';color:' + color + ';flex:1 1 100%;white-space:normal;text-align:left'; sp.textContent = txt; return sp; };
  const bb = document.getElementById('bulkBar');
  if (bb && !bb.querySelector('.bulk-hint-header')) {
    bb.insertBefore(mk('#dfe8f0', '#2f5d8a', (LANG === 'en' ? "\u270f\ufe0f MODIFY the selection \u2014 the choices below APPLY to the checked records (to filter the view: lists at the top)" : "\u270f\ufe0f MODIFIER / RANGER la s\u00e9lection \u2014 les choix ci-dessous S'APPLIQUENT UNIQUEMENT aux fiches coch\u00e9es (pour filtrer l'affichage: listes en haut)")), bb.firstChild);
  }
  const fb = document.getElementById('filterOpsBar');
  if (fb && !fb.querySelector('.bulk-hint-header')) {
    fb.insertBefore(mk('#f0e6c8', '#7a5c1e', (LANG === 'en' ? "\u26a1 These actions apply to the WHOLE filtered view \u2014 not to a selection" : "\u26a1 Ces actions s'appliquent \u00e0 TOUT l'affichage filtr\u00e9 \u2014 pas \u00e0 une s\u00e9lection")), fb.firstChild);
  }
}

function renderGrid() {
  try { ensureBarHeaders(); ensureOrganizeUI(); } catch (eH) {}
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
        ${(displayVolume(it) || it.photoPos) ? `<div style="margin:3px 0 0;display:flex;flex-wrap:wrap;gap:4px">${displayVolume(it) ? `<span class="chip" style="background:#e8efe8;border-color:#7a9a7a;color:#2f5d50" title="${t('f_volume')}">T. ${esc(displayVolume(it))}</span>` : ''}${it.photoPos ? `<span class="chip" style="background:#efe8f0;border-color:#9a7a9a;color:#5d2f50" title="Position sur l'étagère">№ ${esc(it.photoPos)}</span>` : ''}</div>` : ''}
        <p>${esc((it.authors || []).join(', ') || it.isbn || '')}</p>
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
          ${it.carrier ? `<span class="chip" style="background:#efe6f0;border-color:#b58fb5;color:#5d2f5d">💿 ${esc(it.carrier)}</span>` : ''}
          ${it.mediaSubtype ? `<span class="chip" style="background:#e6eef0;border-color:#8fb5c0;color:#2f5d66">🎬 ${esc(it.mediaSubtype)}</span>` : ''}
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
  // 📊 MÉTRIQUE D'ACCEPTATION (retours d'expérience des bibliothèques): taux de fiches
  // complètes (titre + auteur + ISBN/EAN + emplacement) — le seuil de qualité du catalogage
  const completeRecords = items.filter((i) => i.title && !String(i.title).startsWith('ISBN ') && !String(i.title).startsWith('EAN ') && (i.authors || []).length && i.isbn && i.location).length;
  const acceptanceRate = items.length ? Math.round((completeRecords / items.length) * 100) : 0;
  const byFurniture = {};
  for (const i of items) {
    const f = i.furniture || (LANG === 'en' ? '(no furniture)' : '(sans meuble)');
    byFurniture[f] = (byFurniture[f] || 0) + (i.price || 0);
  }
  return { total, count: items.length, withPrice, byFurniture, items, acceptanceRate, completeRecords };
}

function exportInsuranceReport() {
  const r = insuranceReport();
  const today = new Date().toISOString().slice(0, 10);
  let txt = (LANG === 'en' ? 'HOME LIBRARY — INSURANCE REPORT' : 'BIBLIOTH\u00c8QUE PERSONNELLE — RAPPORT D\u0027ASSURANCE') + '\n'
    + (LANG === 'en' ? 'Generated: ' : 'G\u00e9n\u00e9r\u00e9 le : ') + today + '\n'
    + (LANG === 'en' ? 'Items: ' : '\u0152uvres : ') + r.count + '\n'
    + (LANG === 'en' ? 'Cataloguing acceptance rate (complete records): ' : 'Taux d\u0027acceptation du catalogage (fiches compl\u00e8tes) : ') + r.acceptanceRate + '% (' + r.completeRecords + '/' + r.count + ')\n'
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
  "Roman": {
    "Policier": { subs: ["Roman noir", "Procédural", "Whodunit", "Thriller psychologique", "Cosy mystery", "Espionnage", "Polar historique"] },
    "Science-fiction": { subs: ["Anticipation", "Dystopie", "Cyberpunk", "Space opera", "Hard SF", "Uchronie", "Voyage temporel", "Post-apocalyptique"] },
    "Fantasy": { subs: ["High fantasy", "Dark fantasy", "Fantasy urbaine", "Sword & Sorcery", "Fantasy historique", "Merveilleux"] },
    "Fantastique / Horreur": { subs: ["Horreur", "Épouvante", "Gothique"] },
    "Historique": { subs: ["Égypte antique", "Grèce antique", "Rome antique", "Moyen Âge", "Renaissance", "Révolution française", "Guerres mondiales", "Préhistoire", "Asie ancienne"] },
    "Aventure": { subs: ["Piraterie", "Exploration", "Survie", "Western"] },
    "Romance": { subs: [] }, "Comédie": { subs: [] }, "Drame": { subs: [] }, "Biopic": { subs: [] }, "Autobiographie romancée": { subs: [] }
  },
  "Nouvelle": { "Recueil": { subs: [] }, "Fantastique": { subs: [] }, "Science-fiction": { subs: [] } },
  "Biographie / Autobiographie": { "Témoignage": { subs: [] }, "Mémoires": { subs: [] }, "Journal intime": { subs: [] }, "Correspondance": { subs: [] }, "Biographie d'artiste": { subs: [] } },
  "Essai": { "Philosophie": { subs: [] }, "Sociologie": { subs: [] }, "Psychologie": { subs: [] }, "Politique": { subs: [] }, "Économie": { subs: [] }, "Écologie": { subs: [] }, "Anthropologie": { subs: [] } },
  "Histoire": { "Antiquité (Égypte, Grèce, Rome)": { subs: [] }, "Médiévale": { subs: [] }, "Époque moderne": { subs: [] }, "Contemporaine": { subs: [] }, "Guerres mondiales": { subs: [] }, "Histoire régionale": { subs: [] } },
  "Géographie / Voyage": { "Atlas": { subs: [] }, "Guide de voyage": { subs: [] }, "Récit de voyage": { subs: [] }, "Géopolitique": { subs: [] } },
  "Religion / Spiritualité": { "Christianisme": { subs: [] }, "Islam": { subs: [] }, "Judaïsme": { subs: [] }, "Bouddhisme": { subs: [] }, "Hindouisme": { subs: [] }, "Mythologies": { subs: [] }, "Ésotérisme": { subs: [] } },
  "Sciences": { "Physique": { subs: [] }, "Chimie": { subs: [] }, "Biologie": { subs: [] }, "Mathématiques": { subs: [] }, "Astronomie": { subs: [] }, "Médecine": { subs: [] }, "Écologie": { subs: [] } },
  "Poésie": { "Recueil": { subs: [] }, "Anthologie": { subs: [] } },
  "Théâtre": { "Comédie": { subs: [] }, "Tragédie": { subs: [] }, "Vaudeville": { subs: [] } },
  "Bande dessinée": {
    "Franco-belge": { subs: ["Aventure", "Humour", "Western", "Historique", "Fantastique", "Science-fiction"] },
    "Comics US": { subs: ["Super-héros", "Indépendant"] },
    "Roman graphique": { subs: [] }
  },
  "Pratique / Cuisine": { "Recettes": { subs: [] }, "Végétal": { subs: [] }, "Pâtisserie": { subs: [] }, "Bricolage": { subs: [] }, "Jardinage": { subs: [] }, "Santé / Bien-être": { subs: [] }, "Développement personnel": { subs: [] }, "Parentalité": { subs: [] } },
  "Jeunesse": { "Album illustré": { subs: [] }, "Roman jeunesse": { subs: [] }, "BD jeunesse": { subs: [] }, "Conte": { subs: [] } },
  "Jeu de société": { "Stratégie": { subs: [] }, "Coopératif": { subs: [] }, "Ambiance": { subs: [] }, "Enquête / Déduction": { subs: [] }, "Gestion": { subs: [] }, "Famille": { subs: [] }, "Quiz": { subs: [] }, "Jeu de cartes": { subs: [] } },
  "Jeu vidéo": {
    "Action": { subs: ["FPS", "TPS", "Beat'em up", "Plateforme", "Infiltration"] },
    "Aventure": { subs: ["Point & Click", "Action-aventure", "Survival horror", "Monde ouvert"] },
    "RPG": { subs: ["JRPG", "Action-RPG", "MMORPG", "Tactical RPG"] },
    "Stratégie": { subs: ["RTS", "Tour par tour", "Tower defense", "Gestion"] },
    "Simulation": { subs: ["Course", "Sport", "Vol", "Vie"] },
    "Réflexion": { subs: ["Puzzle", "Quiz", "Rythme", "Party game"] },
    "Éducatif": { subs: [] }
  },
  "JDR": { "Manuel de règles": { subs: [] }, "Scénario / Campagne": { subs: [] }, "Univers / Background": { subs: [] } },
  "Musique": { "Rock": { subs: ["Psychédélique", "Punk", "Métal"] }, "Pop": { subs: [] }, "Classique": { subs: ["Orchestral", "Musique de chambre", "Opéra", "Vocale"] }, "Jazz": { subs: ["Bebop", "Free jazz"] }, "Blues": { subs: [] }, "Soul / Funk": { subs: [] }, "Rap / Hip-hop": { subs: [] }, "Reggae": { subs: [] }, "Électronique": { subs: [] }, "Musiques du monde": { subs: [] }, "Folk / Traditionnel": { subs: [] }, "Bandes originales": { subs: [] }, "Variété / Chanson": { subs: [] }, "Gospel": { subs: [] } },
  "Film": { "Action": { subs: [] }, "Aventure": { subs: [] }, "Comédie": { subs: ["Romantique", "Dramatique", "Sociale"] }, "Drame": { subs: ["Psychologique", "Historique", "Biopic"] }, "Policier / Thriller": { subs: ["Film noir", "Espionnage", "Énigme"] }, "Science-fiction": { subs: ["Anticipation", "Space opera", "Dystopie"] }, "Fantasy": { subs: [] }, "Horreur / Épouvante": { subs: [] }, "Guerre": { subs: [] }, "Western": { subs: [] }, "Animation": { subs: [] }, "Documentaire": { subs: ["Nature", "Histoire", "Société", "Science"] }, "Comédie musicale": { subs: [] }, "Spectacle / Concert": { subs: [] }, "Humour": { subs: [] } },
  "Série": { "Drame": { subs: [] }, "Comédie": { subs: [] }, "Policier / Thriller": { subs: [] }, "Science-fiction / Fantasy": { subs: [] }, "Historique": { subs: [] }, "Documentaire": { subs: [] }, "Animation": { subs: [] } },
  "Autre": {}
};
/* Normaliser: array = sous-genres sans 4e niveau; objet {subs:[]} = avec 4e niveau */
function taxoSubs(node) { return Array.isArray(node) ? node : (node && Array.isArray(node.subs) ? node.subs : []); }


/* Corriger la structure mixte ci-dessus (certaines valeurs etaient des strings par erreur) */

/* Suggestions de genres : toutes les combinaisons taxonomie (autocompletion du champ genre).
   Format : "Nature", "Nature / Genre", "Nature / Genre / Sous-genre". */
function genreTaxoSuggestions() {
  const out = [];
  for (const [nat, genres] of Object.entries(GENRE_TAXONOMY)) {
    out.push(`<option value="${esc(nat)}">`);
    for (const [g, node] of Object.entries(genres)) {
      out.push(`<option value="${esc(nat + ' / ' + g)}">`);
      for (const sg of taxoSubs(node)) out.push(`<option value="${esc(nat + ' / ' + g + ' / ' + sg)}">`);
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
  if (typeof renderBulkShelfOptions === 'function') { try { renderBulkShelfOptions(); } catch {} }
  if (typeof renderBulkFurnitureOptions === 'function') { try { renderBulkFurnitureOptions(); } catch {} }
  if (typeof renderBulkGenreOptions === 'function') { try { renderBulkGenreOptions(); } catch {} }
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
  // Champ conditionnel: affiché uniquement si le medium correspond (ou si le medium n'est pas encore posé).
  // Champs communs = tous les autres. Évite le formulaire-scroll de 40 champs (guide de catalogage, étape 2).
  const fieldFor = (mediums, label, inner) => ((!it || !it.medium) || mediums.includes(it.medium)) ? field(label, inner) : '';
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
    ${field((it.medium === 'film' || it.medium === 'series') ? t('f_directors') : (it.medium === 'music' ? t('f_artists') : (it.medium === 'manga' || it.medium === 'bd') ? t('f_authors_manga') : ['game', 'boardgame', 'jdr'].includes(it.medium) ? 'Studio (développeur) — l’éditeur va dans Éditeur (ex: Bungie / Activision)' : t('f_authors')), `<input type="text" name="authors" value="${esc((it.authors || []).join(', '))}">`)}
    <div class="form-row">
      ${field(t('f_series'), `<input type="text" name="series" value="${esc(it.series || '')}">`)}
      ${field(t('f_volume'), `<input type="text" name="volume" value="${esc(it.volume || '')}">`)}
      ${field(t('f_seriesstate'), `<select name="seriesState">
        <option value="" ${!it.seriesState ? 'selected' : ''}>—</option>
        <option value="ongoing" ${it.seriesState === 'ongoing' ? 'selected' : ''}>${t('f_ongoing')}</option>
        <option value="complete" ${it.seriesState === 'complete' ? 'selected' : ''}>${t('f_complete')}</option>
      </select>`)}
      ${field(t('f_seriestotal'), `<input type="number" name="seriesTotal" min="1" value="${esc(it.seriesTotal ?? '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_record_state'), `<select name="recordState">
        <option value="draft" ${it.recordState === 'draft' ? 'selected' : ''}>${t('rs_draft')}</option>
        <option value="" ${(it.recordState || '') === '' ? 'selected' : ''}>${t('rs_complete')}</option>
        <option value="locked" ${it.recordState === 'locked' ? 'selected' : ''}>${t('rs_locked')}</option>
      </select>`)}
      ${field(t('f_mediasubtype'), `<select name="mediaSubtype">
        <option value="" ${!it.mediaSubtype ? 'selected' : ''}>—</option>
        ${((!it.medium || it.medium === 'book') ? BOOK_FAMILIES : SUBTYPE_LISTS[it.medium] || MEDIA_TYPES).map(([v, l]) => `<option value="${v}" ${it.mediaSubtype === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['film', 'series'], t('f_imageformat'), `<select name="imageFormat">
        ${[['', '—'], ['4:3', '4:3 (plein écran)'], ['16:9', '16:9 (widescreen)'], ['1.85:1', '1.85:1 (cinéma US)'], ['2.35:1', '2.35:1 (panoramique)'], ['2.39:1', '2.39:1 (scope)'], ['1.66:1', '1.66:1'], ['1.33:1', '1.33:1']].map(([v, l]) => `<option value="${v}" ${it.imageFormat === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${field(t('f_country'), `<select name="country">
        ${[['', '—'], ...COUNTRIES, [it.country || '', it.country || '']].filter(([v], i, a) => !v || a.findIndex(([v2]) => v2 === v) === i).map(([v, l]) => `<option value="${v}" ${it.country === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select>`)}
      ${field(t('f_language'), `<select name="language">
        ${[['', '—'], ...LANGUAGES, [normLang(it.language) || '', normLang(it.language) || '']].filter(([v], i, a) => !v || a.findIndex(([v2]) => v2 === v) === i).map(([v, l]) => `<option value="${v}" ${normLang(it.language) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select>`)}
      ${fieldFor(['film', 'series', 'game'], t('f_audiolangs'), `<input type="text" name="audioLangs" value="${esc(it.audioLangs || '')}" placeholder="japonais, anglais, français — pistes audio du disque">`)}
      ${fieldFor(['game', 'software'], t('f_platform'), `<select name="platform">
        <option value="" ${!it.platform ? 'selected' : ''}>—</option>
        ${(it.medium === 'software' ? SOFTWARE_PLATFORMS : PLATFORMS).map(([v, l]) => `<option value="${v}" ${it.platform === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${field(t('f_accessibility'), `<select name="accessibility">
        <option value="" ${!it.accessibility ? 'selected' : ''}>Standard</option>
        ${[['braille-int', 'Braille intégral'], ['braille-abr', 'Braille abrégé'], ['gros-caracteres', 'Gros caractères (malvoyance)'],
           ['falc', 'FALC (Facile à Lire et à Comprendre)'], ['dyslexie', 'Police adaptée dyslexie'],
           ['audiodescription', 'Audiodescription (malvoyance)'], ['sme', 'Sous-titres SME (sourds/malentendants)'],
           ['lsf', 'Langue des signes (LSF)'], ['tactile', 'Document tactile']].map(([v, l]) => `<option value="${v}" ${it.accessibility === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${field(t('f_awards'), `<input type="text" name="awards" value="${esc(it.awards || '')}" placeholder="Goncourt, César, Eisner, Grammy, Spiel des Jahres…">`)}
      ${fieldFor(['software'], t('f_softcat'), `<select name="softwareCategory">
        <option value="" ${!it.softwareCategory ? 'selected' : ''}>—</option>
        ${SOFTWARE_CATEGORIES.map(([v, l]) => `<option value="${v}" ${it.softwareCategory === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['software'], t('f_licensetype'), `<select name="licenseType">
        <option value="" ${!it.licenseType ? 'selected' : ''}>—</option>
        ${LICENSE_TYPES.map(([v, l]) => `<option value="${v}" ${it.licenseType === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['boardgame', 'jdr'], t('f_esar'), `<select name="esar">
        <option value="" ${!it.esar ? 'selected' : ''}>—</option>
        ${BOARDGAME_ESAR.map(([v, l]) => `<option value="${v}" ${it.esar === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['boardgame', 'jdr'], t('f_mechanic'), `<select name="mechanic">
        <option value="" ${!it.mechanic ? 'selected' : ''}>—</option>
        ${BOARDGAME_MECHANICS.map(([v, l]) => `<option value="${v}" ${it.mechanic === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['boardgame', 'jdr'], t('f_players'), `<input type="text" name="players" value="${esc(it.players || '')}" placeholder="2-4">`)}
      ${field(['game', 'boardgame', 'jdr'].includes(it.medium) ? 'Âge minimum (PEGI)' : t('f_agemin'), `<select name="ageMin">
        ${[['', '—'], ['3+', '3+'], ['6+', '6+'], ['8+', '8+'], ['10+', '10+'], ['12+', '12+'], ['14+', '14+'], ['16+', '16+'], ['18+', '18+']].map(([v, l]) => `<option value="${v}" ${it.ageMin === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['boardgame', 'jdr'], t('f_duration'), `<select name="playDuration">
        ${[['', '—'], ['-15', 'Moins de 15 min'], ['15-30', '15-30 min'], ['30-60', '30-60 min'], ['60-120', '60-120 min'], ['120+', '120 min et +']].map(([v, l]) => `<option value="${v}" ${it.playDuration === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['boardgame', 'jdr'], t('f_complexity'), `<select name="complexity">
        ${[['', '—'], ['leger', 'Léger (poids 1-2)'], ['moyen', 'Moyen (poids 2-3)'], ['lourd', 'Lourd (poids 3-5)']].map(([v, l]) => `<option value="${v}" ${it.complexity === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['partition', 'music'], t('f_formation'), `<select name="formation">
        <option value="" ${!it.formation ? 'selected' : ''}>—</option>
        ${FORMATIONS.map(([v, l]) => `<option value="${v}" ${it.formation === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['partition', 'music'], t('f_instrument'), `<select name="instrument">
        <option value="" ${!it.instrument ? 'selected' : ''}>—</option>
        ${INSTRUMENTS.map(([v, l]) => `<option value="${v}" ${it.instrument === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['series'], t('f_seasons'), `<input type="number" name="seasonsCount" min="1" value="${esc(it.seasonsCount ?? '')}">`)}
      ${fieldFor(['series'], t('f_episodes'), `<input type="number" name="episodesCount" min="1" value="${esc(it.episodesCount ?? '')}">`)}
      ${fieldFor(['series', 'digital'], t('f_channel'), `<input type="text" name="channel" value="${esc(it.channel || '')}" placeholder="TF1, Netflix, HBO…">`)}
      ${fieldFor(['press', 'digital'], t('f_periodicity'), `<select name="periodicity">
        <option value="" ${!it.periodicity ? 'selected' : ''}>—</option>
        ${PRESS_PERIODICITIES.map(([v, l]) => `<option value="${v}" ${it.periodicity === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['press'], t('f_collectionstate'), `<select name="collectionState">
        <option value="" ${!it.collectionState ? 'selected' : ''}>—</option>
        ${COLLECTION_STATES.map(([v, l]) => `<option value="${v}" ${it.collectionState === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['manga', 'bd', 'comic'], t('f_readdirection'), `<select name="readingDirection">
        ${[['', '—'], ['JPN', 'Droite → gauche (manga japonais, ou édition inversée au format japonais — certains manhua chinois)'], ['FR', 'Français (gauche → droite, remanié)'], ['FB', 'Franco-belge (gauche → droite)'], ['US', 'Comics US (gauche → droite)'], ['KR', 'Manhwa coréen (gauche → droite)'], ['CN', 'Gauche → droite (manhua chinois — sauf éditions inversées: vérifiez le livre)']].map(([v, l]) => `<option value="${v}" ${it.readingDirection === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['game'], t('f_gamemode'), `<select name="gameMode">
        <option value="" ${!it.gameMode ? 'selected' : ''}>—</option>
        ${GAME_MODES.map(([v, l]) => `<option value="${v}" ${it.gameMode === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${field(t('f_carrier'), `<select name="carrier">
        <option value="" ${!it.carrier ? 'selected' : ''}>—</option>
        ${((!it.medium || it.medium === 'book') ? BOOK_FORMATS : CARRIER_LISTS[it.medium] || CARRIERS).map(([v, l]) => `<option value="${v}" ${it.carrier === v ? 'selected' : ''}>${l}</option>`).join('')}
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
        <option value="press" ${it.medium === 'press' ? 'selected' : ''}>Revue / magazine / journal</option>
        <option value="software" ${it.medium === 'software' ? 'selected' : ''}>Logiciel</option>
        <option value="partition" ${it.medium === 'partition' ? 'selected' : ''}>Partition musicale</option>
        <option value="map" ${it.medium === 'map' ? 'selected' : ''}>Carte / plan / atlas</option>
        <option value="photo" ${it.medium === 'photo' ? 'selected' : ''}>Photographie</option>
        <option value="print" ${it.medium === 'print' ? 'selected' : ''}>Estampe / affiche</option>
        <option value="manuscript" ${it.medium === 'manuscript' ? 'selected' : ''}>Manuscrit / archive</option>
        <option value="thesis" ${it.medium === 'thesis' ? 'selected' : ''}>Thèse / mémoire / doc officiel</option>
        <option value="ephemera" ${it.medium === 'ephemera' ? 'selected' : ''}>Document éphémère</option>
        <option value="object" ${it.medium === 'object' ? 'selected' : ''}>Objet / instrument / mallette</option>
        <option value="digital" ${it.medium === 'digital' ? 'selected' : ''}>Ressource numérique / podcast / 3D</option>
        <option value="other" ${it.medium === 'other' ? 'selected' : ''}>Autre</option>
      </select>`)}
      ${field('Statut', `<select name="status">
        <option value="unread" ${it.status === 'unread' ? 'selected' : ''}>${((it.medium === 'film' || it.medium === 'series') ? ['À voir', 'En visionnage', 'Vu'] : (it.medium === 'music' ? ['À écouter', 'En écoute', 'Écouté'] : ['game', 'boardgame', 'jdr', 'software'].includes(it.medium) ? ['À jouer', 'En jeu', 'Joué'] : ['À lire', 'En lecture', 'Lu']))[0]}</option>
        <option value="reading" ${it.status === 'reading' ? 'selected' : ''}>${((it.medium === 'film' || it.medium === 'series') ? ['À voir', 'En visionnage', 'Vu'] : (it.medium === 'music' ? ['À écouter', 'En écoute', 'Écouté'] : ['game', 'boardgame', 'jdr', 'software'].includes(it.medium) ? ['À jouer', 'En jeu', 'Joué'] : ['À lire', 'En lecture', 'Lu']))[1]}</option>
        <option value="read" ${it.status === 'read' ? 'selected' : ''}>${((it.medium === 'film' || it.medium === 'series') ? ['À voir', 'En visionnage', 'Vu'] : (it.medium === 'music' ? ['À écouter', 'En écoute', 'Écouté'] : ['game', 'boardgame', 'jdr', 'software'].includes(it.medium) ? ['À jouer', 'En jeu', 'Joué'] : ['À lire', 'En lecture', 'Lu']))[2]}</option>
      </select>`)}
    </div>
    <div class="form-row">
      ${field(t('f_owner'), `<input type="text" name="owner" value="${esc(it.owner || '')}" placeholder="${t('f_owner_ph')}">`)}
      ${field(t('f_universe'), `<input type="text" name="universe" value="${esc(it.universe || '')}" placeholder="${t('f_universe_ph')}">`)}
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
        ${EDITIONS.map(([v, l]) => `<option value="${v}" ${it.editionType === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${field(t('f_price'), `<input type="number" name="price" step="0.01" min="0" value="${esc(it.price ?? '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_audience'), `<select name="audience">
        ${[['', '—'], ['TP', 'Tous publics'], ['J', 'Jeunesse'], ['ADO', 'Adolescent'], ['ADU', 'Adulte'], ['-10', '-10 ans'], ['-12', '-12 ans'], ['-16', '-16 ans'], ['-18', '-18 ans'], [it.audience || '', it.audience || '']].filter(([v], i, a) => !v || a.findIndex(([v2]) => v2 === v) === i).map(([v, l]) => `<option value="${esc(v)}" ${it.audience === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select>`)}
      ${fieldFor(['film', 'series', 'game'], t('f_zone'), `<select name="zone">
        ${[['', '—'], ['Z1', 'Zone 1 (USA/Canada)'], ['Z2', 'Zone 2 (Europe/Japon)'], ['Z3', 'Zone 3 (Asie du Sud-Est)'], ['Z4', 'Zone 4 (Australie/Amérique du Sud)'], ['A', 'Zone A (Blu-ray)'], ['B', 'Zone B (Blu-ray)'], ['C', 'Zone C (Blu-ray)'], ['0', 'Toutes zones (region free)']].map(([v, l]) => `<option value="${v}" ${it.zone === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
      ${fieldFor(['film', 'series', 'game'], t('f_audioversion'), `<select name="audioVersion">
        ${[['', '—'], ['VO', 'Version originale'], ['VF', 'Version française'], ['VOST', 'VO sous-titrée'], ['VOSTA', 'VO sous-titrée audio-description'], ['MULTI', 'Multilingue'], ['VFST', 'VF sous-titrée']].map(([v, l]) => `<option value="${v}" ${it.audioVersion === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`)}
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

        <!-- Éditeur de relations historique (related[]) retiré: doublon du système Q5 (relationsBox, 13 types typés) — ses selects n'étaient jamais persistés au save -->
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
      <input type="number" name="photoPos" min="1" placeholder="Position sur l'étagère (nº)" value="${esc(it.photoPos ?? '')}">
      <datalist id="furnitureList">${knownFurniture().map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
      <datalist id="slotList">${knownSlots().map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    </div>`)}
    ${field(t('f_cote'), `<div style="display:flex;gap:6px">
      <input type="text" name="cote" value="${esc(it.cote || '')}" placeholder="Cote générée (ex. SERPOL BLU-COL S01 ADU)">
      <button type="button" class="btn small" id="btnGenCote">🎯 Générer</button>
      <button type="button" class="btn small" id="btnNextVolume" title="Créer le tome suivant pré-rempli (catalogage par dérivation)">➕ Tome suivant</button>
    </div>`)}
    ${field(t('f_summary'), `<textarea name="summary" rows="4">${esc(it.summary || '')}</textarea>`)}
    ${it.fieldSources && Object.keys(it.fieldSources).length ? `<p class="hint">🔖 ${t('f_provenance')}: ${Object.entries(it.fieldSources).map(([k, v]) => esc(k) + ' ← ' + esc(v)).join(' · ')}</p>` : ''}
    ${it.aiAssisted ? `<p class="hint">🤖 ${t('f_ai_note')}</p>` : ''}
    ${field(t('f_relations'), `<div id='relationsBox'><p class='hint'>…</p></div>`)}
    ${field(t('f_subjects'), `<div id='subjectsBox'><p class='hint'>…</p></div>`)}
    ${field(t('f_backcover'), `<textarea name="backCoverText" rows="3" placeholder="${t('f_backcover_ph')}">${esc(it.backCoverText || '')}</textarea>`)}
    <div class="form-row">
      ${field(t('f_publisher'), `<input type="text" name="publisher" value="${esc(it.publisher || '')}">`)}
      ${field(t('f_pubdate'), `<input type="text" name="publishedDate" value="${esc(it.publishedDate || '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_isbn'), `<input type="text" name="isbn" value="${esc(it.isbn)}">`)}
      ${fieldFor(['book', 'comic', 'bd', 'manga', 'press', 'thesis'], t('f_pages'), `<input type="number" name="pageCount" value="${esc(it.pageCount ?? '')}">`)}
    </div>
    <div class="form-row">
      ${field(t('f_cover'), `<input type="text" name="cover" id="coverField" value="${esc(it.cover || '')}"><img id="coverPrevImg" src="${esc(it.cover || '')}" alt="" style="max-width:120px;max-height:160px;display:${it.cover ? 'block' : 'none'};margin-top:6px;border-radius:6px;border:1px solid var(--line)">`)}
      ${field(t('f_coverback'), `<input type="text" name="coverBack" id="coverBackField" value="${esc(it.coverBack || '')}"><img id="coverBackPrevImg" src="${esc(it.coverBack || '')}" alt="" style="max-width:120px;max-height:160px;display:${it.coverBack ? 'block' : 'none'};margin-top:6px;border-radius:6px;border:1px solid var(--line)">`)}
      <div class="form-row">
        <div>
          <label>Importer une image depuis l'appareil (contourne les liens bloqués — image stockée dans la fiche, à vie)</label>
          <div class="row">
            <input type="file" id="importCoverFront" accept="image/*" class="hidden">
            <input type="file" id="importCoverFrontCam" accept="image/*" capture="environment" class="hidden">
            <label for="importCoverFront" class="btn small" style="cursor:pointer">📷 Couverture devant…</label>
            <label for="importCoverFrontCam" class="btn small" style="cursor:pointer" title="Prendre une photo directement avec l'appareil">📸 Photo devant</label>
            <button type="button" class="btn small" id="btnAiReadCover" title="${t('ai_cover_title')}">🤖 ${t('ai_cover_btn')}</button>
            <input type="file" id="importCoverBack" accept="image/*" class="hidden">
            <input type="file" id="importCoverBackCam" accept="image/*" capture="environment" class="hidden">
            <label for="importCoverBackCam" class="btn small" style="cursor:pointer" title="Prendre une photo directement avec l'appareil">📸 Photo dos</label>
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
        <button type="button" class="btn small" id="btnAiFill" title="${t('ai_fill_title')}">🤖 ${t('ai_fill_btn')}</button>
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
  try { addLogToDetail(it); } catch (eL) { console.warn('log-detail', eL); }
  try {
    const btnNV = document.getElementById('btnNextVolume');
    if (btnNV) btnNV.addEventListener('click', () => { duplicateForNextVolume(store.findById(editingId)); });
    const btnCote = document.getElementById('btnGenCote');
    if (btnCote) btnCote.addEventListener('click', () => {
      const fresh = store.findById(editingId);
      const vol = document.querySelector('#detailForm [name="volume"]');
      const res = genererCote({ ...fresh, volume: vol ? vol.value : (fresh.volume || '') });
      const coteEl = document.querySelector('#detailForm [name="cote"]');
      if (coteEl) coteEl.value = res.cote;
      toast(res.warnings.length ? '⚠️ ' + res.cote + ' — ' + res.warnings.join(' · ') : '🎯 Cote: ' + res.cote, 5000);
    });
  } catch (eC) { console.warn('cote', eC); }
  // Q5: rendu des relations typées (bidirectionnel: source + cible avec libellé inverse)
  try {
    const box = document.getElementById('relationsBox');
    if (box) {
      const render = () => {
        const rels = relationsOf(editingId);
        let html = '';
        for (const r of rels) {
          html += `<div class="inv-line" style="display:flex;gap:6px;align-items:center;margin:2px 0">
            <span class="hint">${esc(r.label)} :</span> <b>${esc((r.other.title || '?').slice(0, 50))}</b>
            ${r.dir === 'source' ? `<button type="button" class="btn small" data-delrel="${esc(r.other.id)}|${esc(r.rel.ty)}">✕</button>` : ''}
          </div>`;
        }
        // formulaire d'ajout: type + cible
        const others = store.items.filter((x) => x.id !== editingId).slice(0, 200);
        html += `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          <select id="relTypeSel" style="max-width:140px"><option value="">—</option>${RELATION_TYPES.map((r) => `<option value="${r.code}">${esc((LANG === 'en' ? r.en : r.fr))}</option>`).join('')}</select>
          <select id="relTargetSel" style="flex:1;min-width:120px"><option value="">—</option>${others.map((o) => `<option value="${esc(o.id)}">${esc((o.title || '?').slice(0, 60))}</option>`).join('')}</select>
          <button type="button" class="btn small" id="btnAddRel">➕</button>
        </div>`;
        box.innerHTML = html;
        box.querySelectorAll('[data-delrel]').forEach((b) => b.addEventListener('click', () => {
          const [tid, ty] = b.dataset.delrel.split('|');
          const cur = store.findById(editingId);
          cur.relations = (cur.relations || []).filter((r) => !(r.t === tid && r.ty === ty));
          store.update(cur); render();
        }));
        const addBtn = box.querySelector('#btnAddRel');
        if (addBtn) addBtn.addEventListener('click', () => {
          const ty = box.querySelector('#relTypeSel').value;
          const t = box.querySelector('#relTargetSel').value;
          if (!ty) { toast(LANG === 'en' ? 'Choose a relation type' : 'Choisissez un type de relation', 3000); return; }
          if (!t || t === editingId) { toast('Un document ne peut pas être lié à lui-même', 3000); return; }
          const cur = store.findById(editingId);
          cur.relations = cur.relations || [];
          if (cur.relations.some((r) => r.t === t && r.ty === ty)) { toast('Cette relation existe déjà', 3000); return; }
          const relWarns = validateRelation(cur, store.findById(t), ty);
          cur.relations.push({ t, ty });
          store.update(cur); render();
          toast('🔗 ' + (relType(ty) ? (LANG === 'en' ? relType(ty).en : relType(ty).fr) : ty) + ' — ' + (LANG === 'en' ? 'relation added' : 'relation ajoutée') + (relWarns.length ? '\n⚠️ ' + relWarns.join(' · ') : ''), relWarns.length ? 8000 : 3000);
        });
      };
      render();
    }
  } catch (eR) { console.warn('relations', eR); }
  // Q2: rendu des sujets RAMEAU (picker fermé, 1-3 sujets, suggestions par genre)
  try {
    const sbox = document.getElementById('subjectsBox');
    if (sbox) {
      renderSubj(); // top-level
    }
  } catch (eS) { console.warn('subjects', eS); }
  try { wireCoverImport('importCoverFront', 'cover'); } catch (eW) { console.warn('wire1', eW); }
  try { wireCoverImport('importCoverBack', 'coverBack'); } catch (eW2) { console.warn('wire2', eW2); }
  try { wireCoverImport('importCoverFrontCam', 'cover'); } catch (eW3) { console.warn('wire3', eW3); }   // 📸 prise directe à l'appareil photo
  try { wireCoverImport('importCoverBackCam', 'coverBack'); } catch (eW4) { console.warn('wire4', eW4); }
  // ⌨️ Douchette pendant qu'une fiche est OUVERTE: si un scan complet (code + Enter rapide)
  // arrive sur le champ ISBN du formulaire, c'est un NOUVEAU document — pas une édition de la fiche.
  // On propose la création d'une nouvelle fiche au lieu de modifier silencieusement l'ISBN de la fiche courante.
  const isbnField = $('#detailForm') ? $('#detailForm').querySelector('[name="isbn"]') : null;
  if (isbnField) {
    let __formScanBuf = '';
    let __formScanLast = 0;
    isbnField.addEventListener('keydown', (e) => {
      const now = Date.now();
      if (now - __formScanLast > 400) __formScanBuf = '';
      __formScanLast = now;
      if (e.key === 'Enter') {
        const code = __formScanBuf.trim();
        __formScanBuf = '';
        if (/^[0-9]{8,14}$/.test(code) && code !== (it.isbn || '')) {
          e.preventDefault();
          const go = confirm(tm('scan_new_while_open', code));
          if (go) { lookupAndMaybeAdd(code); }
          return;
        }
        return;
      }
      if (e.key && e.key.length === 1) __formScanBuf += e.key;
    });
  }
  // aperçu EN DIRECT: l'image affichée suit le champ du formulaire (même avant enregistrement)
  const __livePrev = (fieldId, imgId) => {
    const f = document.getElementById(fieldId); const im = document.getElementById(imgId);
    if (!f || !im) return;
    const upd = () => { const v = f.value.trim(); im.src = v; im.style.display = (v && (v.startsWith('data:image') || v.startsWith('http'))) ? 'block' : 'none'; };
    f.addEventListener('input', upd);
    upd();
  };
  try { __livePrev('coverField', 'coverPrevImg'); __livePrev('coverBackField', 'coverBackPrevImg'); } catch (eP) { console.warn('preview', eP); }
  /* 🤖 IA lit la couverture : photo importée (devant/dos) -> IA vision extrait titre/auteur/ISBN/résumé */
  // snapshot du formulaire à l'ouverture pour détecter les modifications non enregistrées (croix)
  try {
    const f0 = $('#detailForm');
    // EXCLURE les inputs type=file (imports photo: leur valeur n'est pas une donnée de fiche et change à la prise de photo)
    const fields = [...f0.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'file');
    window.__detailFormSnapshot = fields.map((el) => (el.type === 'checkbox' ? el.checked : el.value)).join('\u0001');
    window.__detailFormFields = fields.map((el) => el.name || el.id || '?');
  } catch {}

  const btnAiCover = $('#btnAiReadCover');
  if (btnAiCover) btnAiCover.addEventListener('click', () => {
    const it2 = store.findById(editingId);
    // l'image du FORMULAIRE (même non encore enregistrée) prime sur celle de la fiche enregistrée
    const formEl = $('#detailForm');
    const formCoverBack = formEl && formEl.querySelector('[name="coverBack"]') ? formEl.querySelector('[name="coverBack"]').value : '';
    const formCover = formEl && formEl.querySelector('[name="cover"]') ? formEl.querySelector('[name="cover"]').value : '';
    const src = formCoverBack || formCover || (it2 && (it2.coverBack || it2.cover)) || '';
    if (!src) { toast(tm('ai_cover_needimg'), 4500); return; }
    // pédagogie : préciser quelle image sera lue et rappeler que le résumé vit sur le DOS
    const usingBack = !!(formCoverBack || (it2 && it2.coverBack));
    if (!usingBack && it2 && it2.cover) toast(tm('ai_cover_using_front'), 5500);
    else if (usingBack) toast(tm('ai_cover_using_back'), 2500);
    (async () => {
      if (!aiCfg.key && aiCfg.provider !== 'ollama') { toast(tm('ai_first'), 4000); return; }
      toast(tm('ai_cover_reading'), 3000);
      try {
                const sys = 'Tu es un expert en lecture de couvertures et jaquettes (livres, DVD, Blu-ray, jeux). Lis TOUT texte visible, même stylisé, partiel ou en petit. Renvoie UNIQUEMENT un JSON. IMPORTANT: "summary" est le PARAGRAPHE DESCRIPTIF/synopsis de l\u0027\u0153uvre (jamais un commentaire sur la fiche). Pour une JAQUETTE DE FILM (DVD/Blu-ray), extrais AUSSI: "authors" = [réalisateur, scénaristes, compositeur/musique, acteurs principaux] dans cet ordre; "note" = les détails techniques lisibles (nombre de disques, disque bonus, durée, formats vidéo/audio/sous-titres, âge conseillé, exclusivités, numéros de référence) en texte compact. ET les facettes: "mediaSubtype" = type de contenu (film / film-an / film-an-jp / serie / serie-an / serie-an-jp / doc / telefilm / concert / humour / jeunesse / reportage); "carrier" = support physique (vhs / dvd / blu-ray / blu-ray-3d / blu-ray-uhd / vinyle-33 / cd / streaming); "editionType" = édition (standard / special / collector / coffret / anniversaire / remasterisee / directors-cut / extended); "audioVersion" = version audio (VO / VF / VOST / MULTI); "zone" = zone (Z1 / Z2 / A / B / C / 0); "imageFormat" = format image (4:3 / 16:9 / 1.85:1 / 2.35:1 / 2.39:1). Chaîne vide si non lisible ou incertain — n\u0027invente JAMAIS. Ordre: {"summary":"synopsis","title":"titre","authors":["..."],"isbn":"ISBN/EAN","publisher":"studio","collection":"","note":"détails techniques","mediaSubtype":"","carrier":"","editionType":"","audioVersion":"","zone":"","imageFormat":""} — chaîne vide UNIQUEMENT si vraiment illisible.';
        const resp = await aiVisionShelf(sys, src, sys);
        const data = parseAiJson(resp);
        if (!data) {
          // réponse IA complète dans une fenêtre lisible (copiable pour diagnostic)
          showDiagModal(tm('ai_cover_badjson'), '--- Réponse IA complète ---\n' + String(resp || ''));
          return;
        }
        let n = 0;
        if (data.title && (!it2.title || it2.title === '?' || String(it2.title).startsWith('ISBN '))) {
          let tt = String(data.title).trim();
          // si le titre est ENTIÈREMENT EN MAJUSCULES (imprimé ainsi sur la couverture) → casse de titre lisible
          if (tt === tt.toUpperCase() && /[A-Z]{3}/.test(tt)) {
            tt = tt.toLowerCase().replace(/(^|[ \u2022\-·:])\p{L}/gu, (c) => c.toUpperCase());
          }
          it2.title = tt; n++;
        }
        // auteurs: filtrer les valeurs poubelle lues par l'IA ("[", ponctuation, 1 caractère)
        const authorsRaw = Array.isArray(data.authors) ? data.authors : (data.authors ? [String(data.authors)] : []);
        // l'IA écrit parfois la CHAÎNE "null"/"none" au lieu du JSON null — la traiter comme absente
        const isNullStr = (v) => { const x = String(v || '').trim().toLowerCase(); return !x || x === 'null' || x === 'none' || x === '(null)' || x === 'n/a'; };
        const authorsArr = authorsRaw.map((a) => String(a || '').trim()).filter((a) => !isNullStr(a) && a.length >= 2 && /[a-zA-ZÀ-ÿ]/.test(a));
        if (authorsArr.length && !(it2.authors || []).length) { it2.authors = authorsArr; n++; }
        const isbn13 = data.isbn ? normalizeIsbn(String(data.isbn)) : '';
        if (isbn13 && /^\d{13}$/.test(isbn13) && !it2.isbn) { it2.isbn = isbn13; n++; }
        if (data.summary) {
          // CONCEPTION: « IA lit la couverture » remplit UNIQUEMENT le champ « 4e de couverture » (backCoverText).
          // Le champ « Résumé » reste le domaine des recherches en ligne (Google Books, Compléter par IA…).
          // Garde-fou: un mot seul ou le nom de collection n'est pas un texte de 4e de couverture.
          const sm = String(data.summary).trim();
          const isCollectionName = sm && ((data.collection && sm.toLowerCase() === String(data.collection).trim().toLowerCase()) || (it2.collection && sm.toLowerCase() === String(it2.collection).trim().toLowerCase()) || (it2.series && sm.toLowerCase() === String(it2.series).trim().toLowerCase()) || sm.length < 25);
          if (isCollectionName) {
            // l'IA a confondu: c'est probablement la collection — la proposer là si vide
            if (!it2.collection && data.collection) {
              // correspondance TOLERANTE: distance de Levenshtein <= 2 (casse/accents ignorés, fautes d'IA corrigées)
              const normCol = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
              const lev = (a, b) => {
                const m = a.length, n2 = b.length;
                const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n2).fill(0)]);
                for (let j = 1; j <= n2; j++) d[0][j] = j;
                for (let i = 1; i <= m; i++) for (let j = 1; j <= n2; j++)
                  d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                return d[m][n2];
              };
              const want = normCol(data.collection);
              let best = null, bestD = 99;
              for (const k of KNOWN_COLLECTIONS) {
                const kk = normCol(k);
                const dist = lev(want, kk);
                if (dist < bestD) { bestD = dist; best = k; }
              }
              if (best && bestD <= 2) { it2.collection = best; n++; }
            }
          } else {
            if (!it2.backCoverText) { it2.backCoverText = sm; n++; }
          }
        }
        if (data.note && !it2.note) {
          const nt = String(data.note).trim();
          if (nt.length > 10 && nt.length < 800) { it2.note = nt; n++; }
        }
        // facettes: l'IA choisit si elle sait (mapping tolérant des réponses IA vers nos codes fermés)
        const CARRIER_MAP = { 'vhs': 'vhs', 'dvd': 'dvd', 'dvd-3d': 'dvd-3d', 'blu-ray': 'blu-ray', 'blu-ray 3d': 'blu-ray-3d', 'blu-ray-3d': 'blu-ray-3d', 'blu-ray 4k': 'blu-ray-uhd', 'blu-ray-uhd': 'blu-ray-uhd', '4k': 'blu-ray-uhd', 'uhd': 'blu-ray-uhd', 'vinyle': 'vinyle-33', 'vinyle-33': 'vinyle-33', 'cd': 'cd', 'streaming': 'streaming' };
        const SUBTYPE_MAP = { 'film': 'film', 'dessin anime': 'film-an', 'dessin-animé': 'film-an', 'film-an': 'film-an', 'anime': 'serie-an-jp', 'film-an-jp': 'film-an-jp', 'serie': 'serie', 'série': 'serie', 'serie-an': 'serie-an', 'serie-an-jp': 'serie-an-jp', 'doc': 'doc', 'documentaire': 'doc', 'telefilm': 'telefilm', 'téléfilm': 'telefilm', 'concert': 'concert', 'humour': 'humour', 'jeunesse': 'jeunesse', 'reportage': 'rep' };
        const applyFacet = (val, mapObj, target) => {
          if (!val || it2[target]) return false;
          const k = String(val).trim().toLowerCase();
          const code = mapObj[k] || mapObj[String(val).trim()];
          if (code) { it2[target] = code; n++; return true; }
          return false;
        };
        applyFacet(data.carrier, CARRIER_MAP, 'carrier');
        applyFacet(data.mediaSubtype, SUBTYPE_MAP, 'mediaSubtype');
        if (data.editionType && !it2.editionType) { const k = String(data.editionType).trim().toLowerCase(); const ed = { 'standard': 'standard', 'collector': 'collector', 'coffret': 'coffret', 'anniversaire': 'anniversaire', 'remasterisee': 'remasterisee', 'directors-cut': 'directors-cut', 'extended': 'extended' }[k]; if (ed) { it2.editionType = ed; n++; } }
        if (data.audioVersion && !it2.audioVersion) { const k = String(data.audioVersion).trim().toUpperCase(); if (['VO', 'VF', 'VOST', 'VOSTA', 'MULTI', 'VFST'].includes(k)) { it2.audioVersion = k; n++; } }
        if (data.zone && !it2.zone) { const k = String(data.zone).trim().toUpperCase(); if (['Z1', 'Z2', 'Z3', 'Z4', 'A', 'B', 'C', '0'].includes(k)) { it2.zone = k; n++; } }
        if (data.imageFormat && !it2.imageFormat) { const k = String(data.imageFormat).trim(); if (/^\d+(\.\d+)?:1$|^4:3$|^16:9$/.test(k)) { it2.imageFormat = k; n++; } }
        if (data.publisher && !it2.publisher) { it2.publisher = String(data.publisher).trim().replace(/^\p{L}/u, (c) => c.toUpperCase()); n++; }
        if (data.collection && !it2.collection && KNOWN_COLLECTIONS.includes(String(data.collection).trim())) { it2.collection = String(data.collection).trim(); n++; }
        if (n) {
          if (it2.recordState === 'draft' && it2.title && it2.title !== '?') it2.recordState = '';
          store.update(it2);
          renderAll();
          autoBackupTick();
          toast(tm('ai_cover_done', n), 4500);
          openDetail(it2.id);
        } else {
          // l'IA a lu quelque chose mais aucun garde-fou n'a laissé passer — montrer le JSON complet pour diagnostic
          const hasAny = data && Object.values(data).some((v) => v && String(v).trim());
          if (hasAny) showDiagModal(tm('ai_cover_partial_title'), '--- JSON lu par l\u0027IA ---\n' + JSON.stringify(data, null, 1) + '\n\n' + tm('ai_cover_partial_hint'));
          else toast(tm('ai_cover_fail'), 5000);
        }
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
    // fiche au titre placeholder (ISBN/EAN): l'IA ne peut rien déduire — guider vers la saisie du titre
    if (/^(ISBN|EAN|UPC)\s?\d/i.test(String(it.title || '').trim())) {
      toast(tm('ai_need_title'), 6000);
      const tEl2 = document.querySelector('#detailForm [name="title"]');
      if (tEl2) { tEl2.focus(); tEl2.select(); }
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
        const cfgInfo = (aiCfg.provider === 'ollama' ? 'ollama/' : '') + (aiCfg.textModel || aiCfg.model || '?');
        if (n) toast(tm('ai_filled') + ' (' + n + ') — ' + [...new Set(res.changed)].join(' · ') + ' [' + cfgInfo + ']', 6000);
        else if (steps.length) toast(tm('ai_failed_steps') + ' — ' + steps.join(' · ') + ' [' + cfgInfo + ']', 9000);
        else toast(tm('ai_nothing') + ' [IA: ' + cfgInfo + ']', 5000);
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
  // Null-sûr: la fiche adaptative masque les champs non pertinents (pageCount sur un jeu…) —
  // un champ absent vaut '' au lieu de faire crasher l'enregistrement (bug réel rapporté)
  const val = (n) => { const el = f.querySelector(`[name="${n}"]`); return el ? el.value.trim() : ''; };
  it.title = val('title');
  it.subtitle = val('subtitle');
  it.authors = val('authors').split(',').map((s) => s.trim()).filter(Boolean);
  it.recordState = f.querySelector('[name="recordState"]') ? f.querySelector('[name="recordState"]').value : '';
  it.medium = f.querySelector('[name="medium"]') ? f.querySelector('[name="medium"]').value : '';
  it.mediaSubtype = f.querySelector('[name="mediaSubtype"]') ? f.querySelector('[name="mediaSubtype"]').value : '';
  it.carrier = f.querySelector('[name="carrier"]') ? f.querySelector('[name="carrier"]').value : '';
  it.zone = f.querySelector('[name="zone"]') ? f.querySelector('[name="zone"]').value : '';
  it.audioVersion = f.querySelector('[name="audioVersion"]') ? f.querySelector('[name="audioVersion"]').value : '';
  it.imageFormat = f.querySelector('[name="imageFormat"]') ? f.querySelector('[name="imageFormat"]').value : '';
  it.country = f.querySelector('[name="country"]') ? f.querySelector('[name="country"]').value : '';
  it.language = f.querySelector('[name="language"]') ? normLang(f.querySelector('[name="language"]').value) : normLang(it.language || '');
  it.audioLangs = f.querySelector('[name="audioLangs"]') ? f.querySelector('[name="audioLangs"]').value : '';
  it.platform = f.querySelector('[name="platform"]') ? f.querySelector('[name="platform"]').value : '';
  it.gameMode = f.querySelector('[name="gameMode"]') ? f.querySelector('[name="gameMode"]').value : '';
  it.readingDirection = f.querySelector('[name="readingDirection"]') ? f.querySelector('[name="readingDirection"]').value : '';
  it.periodicity = f.querySelector('[name="periodicity"]') ? f.querySelector('[name="periodicity"]').value : '';
  it.collectionState = f.querySelector('[name="collectionState"]') ? f.querySelector('[name="collectionState"]').value : '';
  it.seasonsCount = +f.querySelector('[name="seasonsCount"]')?.value || null;
  it.episodesCount = +f.querySelector('[name="episodesCount"]')?.value || null;
  it.channel = f.querySelector('[name="channel"]') ? f.querySelector('[name="channel"]').value : '';
  it.formation = f.querySelector('[name="formation"]') ? f.querySelector('[name="formation"]').value : '';
  it.instrument = f.querySelector('[name="instrument"]') ? f.querySelector('[name="instrument"]').value : '';
  it.esar = f.querySelector('[name="esar"]') ? f.querySelector('[name="esar"]').value : '';
  it.mechanic = f.querySelector('[name="mechanic"]') ? f.querySelector('[name="mechanic"]').value : '';
  it.players = f.querySelector('[name="players"]') ? f.querySelector('[name="players"]').value : '';
  it.ageMin = f.querySelector('[name="ageMin"]') ? f.querySelector('[name="ageMin"]').value : '';
  it.playDuration = f.querySelector('[name="playDuration"]') ? f.querySelector('[name="playDuration"]').value : '';
  it.complexity = f.querySelector('[name="complexity"]') ? f.querySelector('[name="complexity"]').value : '';
  it.softwareCategory = f.querySelector('[name="softwareCategory"]') ? f.querySelector('[name="softwareCategory"]').value : '';
  it.licenseType = f.querySelector('[name="licenseType"]') ? f.querySelector('[name="licenseType"]').value : '';
  it.accessibility = f.querySelector('[name="accessibility"]') ? f.querySelector('[name="accessibility"]').value : '';
  it.awards = f.querySelector('[name="awards"]') ? f.querySelector('[name="awards"]').value : '';
  it.cote = f.querySelector('[name="cote"]') ? f.querySelector('[name="cote"]').value : '';
  // moteur de cohérence (Q4): warnings non bloquants, errors affichées
  try {
    const coh = validerCoherence(it);
    if (coh.warnings.length) toast('⚠️ Cohérence: ' + coh.warnings.join(' · '), 7000);
    if (coh.errors.length) toast('🚫 Incohérence: ' + coh.errors.join(' · '), 9000);
  } catch {}
  const newStatus = f.querySelector('[name="status"]') ? f.querySelector('[name="status"]').value : '';
  if (newStatus === 'read' && it.status !== 'read') it.readFinish = todayISO();
  if (newStatus !== 'read') it.readFinish = '';
  it.status = newStatus;
  it.series = val('series');
  it.owner = val('owner');
  it.volume = val('volume');
  // scenario/art: retirés du formulaire (doublon du champ authors « Scénariste(s)/Dessinateur(s) ») — valeurs existantes préservées
  const scEl = f.querySelector('[name="scenario"]'); it.scenario = scEl ? scEl.value.split(',').map((x) => x.trim()).filter(Boolean) : (it.scenario || []);
  const arEl = f.querySelector('[name="art"]'); it.art = arEl ? arEl.value.split(',').map((x) => x.trim()).filter(Boolean) : (it.art || []);
  it.seriesState = f.querySelector('[name="seriesState"]') ? f.querySelector('[name="seriesState"]').value : '';
  it.seriesTotal = +val('seriesTotal') || null;
  it.favorite = f.querySelector('[name="favorite"]').checked;
  it.wishlist = f.querySelector('[name="wishlist"]').checked;
  it.dewey = val('dewey').replace(',', '.').trim();
  it.genre = val('genre');
  it.collection = val('collection');
  it.format = f.querySelector('[name="format"]') ? f.querySelector('[name="format"]').value : '';
  it.editionType = f.querySelector('[name="editionType"]') ? f.querySelector('[name="editionType"]').value : '';
  it.price = +val('price') || null;
  it.audience = val('audience');
  it.borrowedFrom = val('borrowedFrom');
  it.acquiredAt = val('acquiredAt');
  it.acquiredFrom = val('acquiredFrom');
  it.acquiredPrice = +val('acquiredPrice') || null;
  it.disposedAt = val('disposedAt');
  it.disposedHow = f.querySelector('[name="disposedHow"]') ? f.querySelector('[name="disposedHow"]').value : '';
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
  // Position ordinale sur l'étagère: si l'utilisateur pose/CHANGE un n° occupé,
  // les suivants se décalent automatiquement de +1 (renumérotation automatique)
  const newPos = parseInt(val('photoPos'), 10) || 0;
  // Le n° se sauve même sans meuble/étagère (bug réel: le n° saisi dans la fiche n'était jamais
  // enregistré sans étagère — donc jamais visible sur la mini-fiche); le décalage des suivants
  // ne s'applique que si l'étagère est connue
  if (newPos && newPos !== it.photoPos) {
    if (it.furniture && it.slot) {
      for (const o of store.items) {
        if (o.id !== it.id && o.furniture === it.furniture && o.slot === it.slot && o.photoPos && o.photoPos >= newPos) o.photoPos = o.photoPos + 1;
      }
    }
    it.photoPos = newPos;
  }
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
  if (isRecordLocked(it)) { toast(tm('rs_locked_blocked'), 4500); return; } // déverrouiller explicitement avant de supprimer
  if (!confirm(tm('delete_confirm', it.title) + '\n' + tm('undo_available_hint'))) return;
  saveBulkSnapshot([it]);
  store.remove(editingId);
  $('#detailModal').classList.add('hidden');
  toast(tm('deleted'));
  const ub = document.getElementById('btnBulkUndo');
  if (ub) ub.classList.remove('hidden');
  scheduleAutoSync();
  renderAll();
});
$('#btnCloseDetail').addEventListener('click', () => {
  // modifications non enregistrées ? demander avant de fermer (votre demande UX)
  try {
    const f0 = $('#detailForm');
    const fields = [...f0.querySelectorAll('input, select, textarea')].filter((el) => el.type !== 'file');
    const vals = fields.map((el) => (el.type === 'checkbox' ? el.checked : el.value));
    const now = vals.join('\u0001');
    if (now !== window.__detailFormSnapshot && !$('#detailModal').classList.contains('hidden')) {
      // diagnostic: nommer le champ qui diffère (traçabilité du faux positif éventuel)
      let diffName = '?';
      const oldVals = String(window.__detailFormSnapshot || '').split('\u0001');
      const names = window.__detailFormFields || [];
      for (let i = 0; i < vals.length; i++) { if (vals[i] !== oldVals[i]) { diffName = names[i] || '?'; break; } }
      const choice = confirm(tm('unsaved_close_confirm') + '\n[' + diffName + ']');
      if (choice) $('#btnSaveDetail').click(); // enregistrer puis fermer (le save ferme la modale)
      // annuler = rester sur la fiche
      return;
    }
  } catch {}
  $('#detailModal').classList.add('hidden');
});

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
    try {
      // ne pousser QUE si les données ont réellement changé depuis le dernier push (fini les push à chaque ouverture de fiche)
      const state = JSON.stringify({ i: store.items, s: store.shelves, l: store.lists, c: coverStore.data || {} });
      let h = 0; for (let k = 0; k < state.length; k += 37) h = (h * 31 + state.charCodeAt(k)) | 0;
      if (window.__lastSyncHash === h) return; // rien n'a changé → pas de push
      await cloudBackupPush();
      window.__lastSyncHash = h;
      toast(tm('autosync_done'), 2500);
    } catch {}
  }, 30000);
}

/* ↩️ Annuler la dernière action en masse (bulk apply / suppression multiple) :
   snapshot des fiches avant modification, restauration en 1 clic. */
let __lastBulkSnapshot = null; // [{ id, avant: {...copie} }]
function saveBulkSnapshot(items) {
  __lastBulkSnapshot = items.map((it) => ({ id: it.id, before: JSON.parse(JSON.stringify(it)) }));
  // bouton Annuler global: visible des qu'une action annulable existe
  const ub = document.getElementById('btnGlobalUndo');
  if (ub) ub.classList.remove('hidden');
}
function undoBulkLast() {
  if (!__lastBulkSnapshot || !__lastBulkSnapshot.length) { toast(tm('undo_none'), 3500); return; }
  let n = 0;
  for (const snap of __lastBulkSnapshot) {
    const cur = store.findById(snap.id);
    if (cur) {
      for (const [k, v] of Object.entries(snap.before)) cur[k] = v;
      store.update(cur);
    } else {
      // fiche SUPPRIMÉE: la réinsérer intégralement
      store.items.push(snap.before);
      store.save();
    }
    n++;
  }
  __lastBulkSnapshot = null;
  const gb = document.getElementById('btnGlobalUndo');
  if (gb) gb.classList.add('hidden');
  renderAll();
  autoBackupTick();
  scheduleAutoSync();
  toast(tm('undo_done', n), 4500);
}

/* 🧹 Nettoyage / migration des données : applique les correctifs de format aux fiches créées
   par d'anciennes versions. Idempotent (relançable), compteur détaillé, jamais automatique. */
const DATA_MIGRATIONS = [
  {
    id: 'badauthors', label: () => tm('mig_badauthors'),
    // auteurs poubelle lus par IA ("[", 1 caractère) ou éditeur mal placé en auteur
    run(it) {
      if (!Array.isArray(it.authors) || !it.authors.length) return false;
      const KNOWN_PUB = ['hachette', 'gallimard', 'flammarion', 'albin michel', 'seuil', 'lelivresud', 'delcourt', 'dargaud', 'kana', 'pika', 'glénat', 'soleil'];
      const clean = it.authors.map((a) => String(a || '').trim()).filter((a) => {
        if (/^null$/i.test(a) || /^none$/i.test(a)) return false; // la chaîne "null" écrite par l'IA
        if (a.length < 2) return false;
        if (!/[a-zA-ZÀ-ÿ]/.test(a)) return false;
        // éditeur mal placé en auteur (si l'éditeur réel existe et y correspond)
        if (it.publisher && a.toLowerCase() === String(it.publisher).trim().toLowerCase()) return false;
        if (KNOWN_PUB.some((p) => a.toLowerCase().startsWith(p))) return false;
        return true;
      });
      if (clean.length === it.authors.length) return false;
      it.authors = clean;
      return true;
    },
  },
  {
    id: 'slots', label: () => tm('mig_slots'),
    // Assainit les étagères polluées par le meuble (« Meuble · Étagère » dans slot -> partie étagère seule)
    run(it) {
      let sl = (it.slot || '').trim();
      if (!sl.includes('·')) return false;
      const f = (it.furniture || '').trim();
      if (!f || !sl.toLowerCase().startsWith(f.toLowerCase())) return false;
      const clean = sl.split('·').map((x) => x.trim()).filter(Boolean).slice(1).join(' · ');
      if (!clean || clean === sl) return false;
      it.slot = clean;
      it.location = [f, it.slot].filter(Boolean).join(' · ');
      return true;
    },
  },
  {
    id: 'slots2', label: () => tm('mig_slots2'),
    // Étagère identique au meuble (doublon total « E1 · E1 ») -> étagère vidée
    run(it) {
      const f = (it.furniture || '').trim();
      const sl = (it.slot || '').trim();
      if (!f || !sl || f.toLowerCase() !== sl.toLowerCase()) return false;
      it.slot = '';
      it.location = f;
      return true;
    },
  },
];

function runDataCleanup() {
  let fixed = 0;
  const details = [];
  for (const mig of DATA_MIGRATIONS) {
    let n = 0;
    for (const it of store.items) {
      try { if (mig.run(it)) { store.update(it); n++; } } catch {}
    }
    if (n) { fixed += n; details.push(mig.label() + ' (' + n + ')'); }
  }
  return { fixed, details };
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
          if (dup && dup.medium !== it.medium) { toast((LANG === 'en' ? 'Different media type — no merge' : 'Medium différent — pas de fusion'), 5000); }
          else if (dup) {
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
  if (pref === 'yes') { shareRecordToBank(it).then(() => toast(tm('share_auto_done'), 3000)).catch((eSh) => toast(eSh && eSh.message ? eSh.message : tm('share_fail'), 6000)); return; }
  sharePromptItemId = it.id;
  const m = document.getElementById('sharePromptModal');
  if (m) { document.getElementById('chkShareRemember').checked = false; m.classList.remove('hidden'); }
}

async function shareRecordToBank(it) {
  if (!it.isbn) throw new Error(LANG === 'en' ? 'No ISBN: the community bank identifies records by ISBN — add the ISBN (or scan) to share.' : 'Pas d\u2019ISBN : la banque communautaire identifie les fiches par ISBN — ajoutez l\u2019ISBN (ou scannez) pour partager.');
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

/* Fiche type par support culturel: le medium est posé d'emblée — la fiche adaptative (fieldFor)
   n'affiche que ses champs (démographies pour un manga, saisons pour une série…) et la cote 🎯 est prête. */
const NEW_BY_TYPE_DEFAULTS = {
  manga: { readingDirection: 'JPN' },  // fonds: ~85% japonais, 5% chinois (CN), 5% coréen (KR), 5% européen (FR) — le défaut sert la majorité, les exceptions à un clic — l'option KR (manhwa) et FR/FB/US restent à un clic pour les exceptions
  press: { collectionState: 'en_cours' },            // état de collection: en cours par défaut
  series: { audioVersion: 'vost' },                  // VOST par défaut (modifiable)
};
const NEW_BY_TYPE_LABELS = { book: 'Nouvel ouvrage', bd: 'Nouvelle BD', manga: 'Nouveau manga', film: 'Nouveau film', series: 'Nouvelle série', music: 'Nouvel album', game: 'Nouveau jeu vidéo', boardgame: 'Nouveau jeu de société', press: 'Nouvelle revue', software: 'Nouveau logiciel', partition: 'Nouvelle partition', map: 'Nouvelle carte', photo: 'Nouvelle photographie', manuscript: 'Nouveau manuscrit', thesis: 'Nouvelle thèse', digital: 'Nouvelle ressource numérique' };
function addByType(medium) {
  if (!medium) return;
  const item = blankItem('');
  item.medium = medium;
  item.title = NEW_BY_TYPE_LABELS[medium] || 'Nouvelle fiche';
  Object.assign(item, NEW_BY_TYPE_DEFAULTS[medium] || {});
  applyShelveMode(item);
  store.add(item);
  renderAll();
  openDetail(item.id);
  toast((LANG === 'en' ? 'New record: ' : 'Nouvelle fiche : ') + (NEW_BY_TYPE_LABELS[medium] || medium) + (LANG === 'en' ? ' — type set, complete the structuring fields then 🎯' : ' — type posé, remplissez les structurants puis 🎯'), 5000);
}
(function wireNewByType() {
  const sel = document.getElementById('selNewByType');
  if (!sel) return;
  sel.addEventListener('change', () => { addByType(sel.value); sel.value = ''; });
})();

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

function refreshScanLookupLbl() {
  const b = document.getElementById('btnScanLookup');
  if (b) {
    b.classList.toggle('shelve-on', scanLookupMode());
    const lbl = document.getElementById('scanLookupLbl');
    if (lbl) lbl.textContent = scanLookupMode() ? t('lookup_on_lbl') : t('lookup_btn');
  }
}
document.getElementById('btnScanLookup') && document.getElementById('btnScanLookup').addEventListener('click', () => { toggleScanLookupMode(); refreshScanLookupLbl(); });

/* 🧹 Nettoyer mes données : migrations idempotentes, confirmation explicite, compte détaillé */
$('#btnDataCleanup').addEventListener('click', () => {
  if (!confirm(tm('cleanup_confirm'))) return;
  const res = runDataCleanup();
  if (res.fixed) {
    renderAll();
    autoBackupTick();
    scheduleAutoSync();
    toast(tm('cleanup_done', res.fixed) + ' — ' + res.details.join(', '), 6000);
  } else {
    toast(tm('cleanup_none'), 3500);
  }
});

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
let aiCfg = { provider: 'api', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', key: '', textModel: '' };
try { aiCfg = { ...aiCfg, ...(JSON.parse(localStorage.getItem(AI_KEY)) || {}) }; } catch {}
/* Modèle pour les tâches TEXTE (Compléter par IA, classification, déduction) :
   champ dédié s'il est rempli, sinon = modèle principal (compatibilité). */
function aiTextModel() { return (aiCfg.textModel && String(aiCfg.textModel).trim()) || aiCfg.model; }
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
  return { model: aiTextModel() || 'mistral-small-latest', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2 };
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

// support à vérifier par l'IA: tout 'book'/'other' est éligible (le scan ISBN ne peut pas deviner manga/BD/film)
function needsMediumPre(it) { return (it.medium === 'other' || !it.medium || it.medium === 'book'); }

async function aiFillItem(id) {
  const it = store.findById(id);
  if (!it) return {};
  const changed = [];

  // --- Etape IGDB (retrieval-constrained): pour un jeu vidéo, ALLER CHERCHER les données dans la base de référence ---
  if (apiKeys.igdbId && it.title && !String(it.title).startsWith('ISBN ') && !String(it.title).startsWith('EAN ') && (it.medium === 'game' || it.medium === 'other')) {
    try {
      const igdbMeta = await fetchIgdbByTitle(it.title);
      if (igdbMeta) {
        if (igdbMeta.authors && igdbMeta.authors.length && !(it.authors || []).length) { it.authors = igdbMeta.authors; changed.push('authors (IGDB: studio)'); }
        if (igdbMeta.summary && !it.summary) { it.summary = igdbMeta.summary; changed.push('summary (IGDB)'); }
        if (igdbMeta.publishedDate && !it.publishedDate) { it.publishedDate = igdbMeta.publishedDate; changed.push('publishedDate (IGDB)'); }
        if (igdbMeta.cover && !it.cover) { it.cover = igdbMeta.cover; changed.push('cover (IGDB)'); }
        if (igdbMeta.genre && !it.genre) { it.genre = igdbMeta.genre; changed.push('genre (IGDB)'); }
        if (igdbMeta.publisher && !it.publisher) { it.publisher = igdbMeta.publisher; changed.push('publisher (IGDB: éditeur)'); }
        if (igdbMeta.platform && !it.platform) { it.platform = igdbMeta.platform; changed.push('platform (IGDB)'); }
        if (it.medium === 'other' || !it.medium) { it.medium = 'game'; changed.push('medium (IGDB: game)'); }
        if (changed.length) { it.fieldSources = it.fieldSources || {}; for (const c of changed) { const fname = String(c).split(' (')[0]; it.fieldSources[fname] = 'IGDB'; } it.aiAssisted = true; }
      }
    } catch (eI) { (window.__aiSteps = window.__aiSteps || []).push('IGDB: ' + (eI && eI.message)); }
  }

  // --- Étape CrossRef (retrieval-constrained): pour une RESSOURCE NUMÉRIQUE, ALLER CHERCHER
  // (titre, auteurs, éditeur, année, revue) dans la base CrossRef — DOI collé dans le titre accepté (préfixe 10.) ---
  if (it.title && it.medium === 'digital') {
    try {
      const isDoi = /^10\./.test(String(it.title).trim());
      const crMeta = await fetchCrossrefByDoiOrTitle(isDoi ? { doi: it.title } : { title: it.title, auteur: (it.authors || [])[0] });
      if (crMeta) {
        if (crMeta.authors && crMeta.authors.length && !(it.authors || []).length) { it.authors = crMeta.authors; changed.push('authors (CrossRef)'); }
        if (crMeta.publisher && !it.publisher) { it.publisher = crMeta.publisher; changed.push('publisher (CrossRef)'); }
        if (crMeta.publishedDate && !it.publishedDate) { it.publishedDate = crMeta.publishedDate; changed.push('publishedDate (CrossRef)'); }
        if (crMeta.genre && !it.genre) { it.genre = crMeta.genre; changed.push('genre (CrossRef: revue)'); }
        if (crMeta.summary && !it.summary) { it.summary = crMeta.summary; changed.push('summary (CrossRef)'); }
        if (changed.length) { it.fieldSources = it.fieldSources || {}; for (const c of changed) { const fname = String(c).split(' (')[0]; it.fieldSources[fname] = 'CrossRef'; } it.aiAssisted = true; }
      }
    } catch (eC) { (window.__aiSteps = window.__aiSteps || []).push('CrossRef: ' + (eC && eC.message)); }
  }

  // --- Étape Discogs (retrieval-constrained): pour la MUSIQUE, ALLER CHERCHER les données
  // (artiste, label, année, genres/styles, format, pochette) dans la base Discogs (16 M de sorties, vinyles) ---
  if (it.title && it.medium === 'music') {
    try {
      const dcMeta = await fetchDiscogsByBarcodeOrTitle({ title: it.title, artiste: (it.authors || [])[0] });
      if (dcMeta) {
        if (dcMeta.authors && dcMeta.authors.length && !(it.authors || []).length) { it.authors = dcMeta.authors; changed.push('authors (Discogs)'); }
        if (dcMeta.publisher && !it.publisher) { it.publisher = dcMeta.publisher; changed.push('publisher (Discogs: label)'); }
        if (dcMeta.publishedDate && !it.publishedDate) { it.publishedDate = dcMeta.publishedDate; changed.push('publishedDate (Discogs)'); }
        if (dcMeta.genre && !it.genre) { it.genre = dcMeta.genre; changed.push('genre (Discogs)'); }
        if (dcMeta.cover && !it.cover) { it.cover = dcMeta.cover; changed.push('cover (Discogs)'); }
        if (dcMeta.carrier && !it.carrier) { it.carrier = dcMeta.carrier; changed.push('carrier (Discogs)'); }
        if (changed.length) { it.fieldSources = it.fieldSources || {}; for (const c of changed) { const fname = String(c).split(' (')[0]; it.fieldSources[fname] = 'Discogs'; } it.aiAssisted = true; }
      }
    } catch (eD) { (window.__aiSteps = window.__aiSteps || []).push('Discogs: ' + (eD && eD.message)); }
  }

  // --- Étape AniList (retrieval-constrained): pour un MANGA, ALLER CHERCHER les données de référence
  // (titre, auteurs, genres, synopsis, couverture, année) dans la base manga AVANT toute IA ---
  if (it.title && (it.medium === 'manga')) {
    try {
      const alMeta = await fetchAniListByTitle(it.title);
      if (alMeta) {
        if (alMeta.authors && alMeta.authors.length && !(it.authors || []).length) { it.authors = alMeta.authors; changed.push('authors (AniList)'); }
        if (alMeta.summary && !it.summary) { it.summary = alMeta.summary; changed.push('summary (AniList)'); }
        if (alMeta.publishedDate && !it.publishedDate) { it.publishedDate = alMeta.publishedDate; changed.push('publishedDate (AniList)'); }
        if (alMeta.cover && !it.cover) { it.cover = alMeta.cover; changed.push('cover (AniList)'); }
        if (alMeta.genre && !it.genre) { it.genre = alMeta.genre; changed.push('genre (AniList)'); }
        if (changed.length) { it.fieldSources = it.fieldSources || {}; for (const c of changed) { const fname = String(c).split(' (')[0]; it.fieldSources[fname] = 'AniList'; } it.aiAssisted = true; }
      }
    } catch (eA) { (window.__aiSteps = window.__aiSteps || []).push('AniList: ' + (eA && eA.message)); }
  }

  // --- Étape BGG (retrieval-constrained): pour un JEU DE SOCIÉTÉ, ALLER CHERCHER les données
  // (auteurs, année, joueurs, âge, durée, catégories, mécanismes, complexité, image) dans la base BGG ---
  if (it.title && it.medium === 'boardgame') {
    try {
      const bggMeta = await fetchBggByTitle(it.title);
      if (bggMeta) {
        if (bggMeta.authors && bggMeta.authors.length && !(it.authors || []).length) { it.authors = bggMeta.authors; changed.push('authors (BGG)'); }
        if (bggMeta.summary && !it.summary) { it.summary = bggMeta.summary; changed.push('summary (BGG)'); }
        if (bggMeta.publishedDate && !it.publishedDate) { it.publishedDate = bggMeta.publishedDate; changed.push('publishedDate (BGG)'); }
        if (bggMeta.cover && !it.cover) { it.cover = bggMeta.cover; changed.push('cover (BGG)'); }
        if (bggMeta.genre && !it.genre) { it.genre = bggMeta.genre; changed.push('genre (BGG)'); }
        if (bggMeta.publisher && !it.publisher) { it.publisher = bggMeta.publisher; changed.push('publisher (BGG: éditeur)'); }
        if (bggMeta.players && !it.players) { it.players = bggMeta.players; changed.push('players (BGG)'); }
        if (bggMeta.ageMin && !it.ageMin) { it.ageMin = bggMeta.ageMin; changed.push('ageMin (BGG)'); }
        if (bggMeta.playDuration && !it.playDuration) { it.playDuration = bggMeta.playDuration; changed.push('playDuration (BGG)'); }
        if (bggMeta.complexity && !it.complexity) { it.complexity = bggMeta.complexity; changed.push('complexity (BGG)'); }
        if (it.medium === 'other' || !it.medium) { it.medium = 'boardgame'; changed.push('medium (BGG: boardgame)'); }
        if (changed.length) { it.fieldSources = it.fieldSources || {}; for (const c of changed) { const fname = String(c).split(' (')[0]; it.fieldSources[fname] = 'BGG'; } it.aiAssisted = true; }
      }
    } catch (eB) { (window.__aiSteps = window.__aiSteps || []).push('BGG: ' + (eB && eB.message)); }
  }

  // --- Etape TMDB (retrieval-constrained): pour un film/série, ALLER CHERCHER les données de référence
  // (titre, réalisateur, acteurs, synopsis, année, affiche) dans la base cinématographique AVANT toute IA ---
  if (apiKeys.tmdb && it.title && !String(it.title).startsWith('ISBN ') && !String(it.title).startsWith('EAN ') && (it.medium === 'film' || it.medium === 'series' || it.medium === 'other' || needsMediumPre(it))) {
    try {
      let tmdbMeta = await fetchTmdbByTitle(it.title, it.publishedDate);
      // correspondance floue: « Rogue One » doit matcher « Rogue One: A Star Wars Story » (l'un contient l'autre, casse/accents ignorés)
      const normTitle2 = (x) => String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); // ponctuation/espaces ignorés: «Star Wars: Les Derniers Jedi» = «starwarslesderniersjedi»
      let tmdbMatch = tmdbMeta && (function (a, b) { return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)); })(normTitle2(tmdbMeta.title), normTitle2(it.title));
      // secours: la recherche FR peut renvoyer un titre FR que notre saisie ne matche pas → retenter avec le titre ORIGINAL (anglais)
      if (!tmdbMatch && tmdbMeta) {
        try {
          const metaEn = await fetchTmdbByTitle(it.title, it.publishedDate, 'en-US');
          if (metaEn && (function (a, b) { return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)); })(normTitle2(metaEn.title), normTitle2(it.title))) {
            tmdbMeta = metaEn; tmdbMatch = true;
          }
        } catch {}
      }
      if (tmdbMatch) {
        // correspondance trouvée: appliquer les données déterministes
        if (tmdbMeta.authors && tmdbMeta.authors.length && !(it.authors || []).length) { it.authors = tmdbMeta.authors; changed.push('authors (TMDB: réalisateur+acteurs)'); }
        if (tmdbMeta.summary && !it.summary) { it.summary = tmdbMeta.summary; changed.push('summary (TMDB)'); }
        if (tmdbMeta.publishedDate && !it.publishedDate) { it.publishedDate = tmdbMeta.publishedDate; changed.push('publishedDate (TMDB)'); }
        if (tmdbMeta.cover && !it.cover) { it.cover = tmdbMeta.cover; changed.push('cover (TMDB)'); }
        if (tmdbMeta.medium && (it.medium === 'other' || !it.medium)) { it.medium = tmdbMeta.medium; changed.push('medium (TMDB: ' + tmdbMeta.medium + ')'); }
        // PROVENANCE (traçabilité du document): chaque champ garde sa source + note de transparence
        if (changed.length) {
          it.fieldSources = it.fieldSources || {};
          for (const c of changed) {
            const fname = c.split(' (')[0];
            it.fieldSources[fname] = 'TMDB';
          }
          it.aiAssisted = true; // note de transparence: « métadonnées assistées par IA/source, à relire »
        }
      }
    } catch (eT) { (window.__aiSteps = window.__aiSteps || []).push('TMDB: ' + (eT && eT.message)); }
  }

  // --- Etape 0: VERIFIER ET CORRIGER les champs mal remplis (auteur dans le titre, serie/collection absentes...) ---
  // Suspect si: le titre contient un mot genre "Simplissime"/"Folio" (collection), ou un nom d'auteur colle au titre
  const suspicious = (it.title && (/[|] efficace| : l'essentiel|pour les nuls/i.test(it.title) || /^(Folio|Points|GF|Tel) /i.test(it.title) || it.title.split(' ').length > 7));
  const missingSerie = !it.series && !it.collection && it.title;
  // support mal classé à corriger: 'other' sans précision, ou 'book' alors que la fiche a un tome/une série de manga/BD
  // SUPPORT à vérifier par l'IA: tout 'book'/'other' est éligible (le scan ISBN ne peut pas deviner manga/BD/film — l'IA si)
  const needsMedium = (it.medium === 'other' || !it.medium || it.medium === 'book');
  if ((suspicious || missingSerie || needsMedium) && it.title && !String(it.title).startsWith('ISBN ')) {
    try {
      const sys = `Tu complètes et corriges des fiches de bibliothèque françaises. Renvoie UNIQUEMENT un JSON.
IMPORTANT: pour "medium", ne recopie JAMAIS le support actuel — DÉDUIS le support RÉEL depuis le contenu: un titre de manga japonais avec des tomes = "manga"; une série de BD franco-belge = "bd"; un film/œuvre cinématographique = "film"; une série TV = "series"; un roman/livre = "book".
Pour un FILM ou une SÉRIE TV: "authors" = le RÉALISATEUR puis les ACTEURS principaux (ex: ["Peter Landesman", "Zac Efron"]). Pour un manga/BD: le scénariste puis le dessinateur. Les champs "seriesTotal" (nombre total de tomes si connu) et "seriesState" ("ongoing" si en cours, "complete" si terminée, "oneshot" si one-shot — "inconnu" si tu ne sais pas) doivent toujours être remplis. "title"/"authors"/"series"/"collection": chaîne vide si déjà corrects.
ANTI-HALLUCINATION: n'invente JAMAIS une valeur absente — si tu ne connais pas une donnée avec certitude, mets la valeur JSON null (PAS le mot "null" entre guillemets) et ajoute son nom dans "champs_manquants". Ne génère aucun résumé de toi-même. Le champ "summary" doit contenir UNIQUEMENT le synopsis/résumé de l'œuvre — JAMAIS un commentaire sur la fiche (« document non identifié… ») : si tu ne connais pas l'œuvre, summary = null.
{"title": "titre NETTOYÉ sans l'auteur ni la collection (vide si déjà propre)", "authors": ["auteur extrait du titre si présent"], "series": "série d'œuvres", "champs_manquants": ["noms des champs que tu n'as pas pu déduire"], "seriesTotal": "nombre TOTAL de tomes de la série si connu (nombre)", "seriesState": "en cours | terminée | one-shot", "medium": "support réel: book | bd | manga | film | series | music | game | boardgame | jdr | other", "universe": "univers/cycle narratif si connu (ex: Cycle des Robots, Univers d'Asimov, monde de Bételgeuse) — chaîne vide sinon", "collection": "collection éditoriale (Simplissime, Folio, Que sais-je ?, Le Livre de Poche, Pocket…)", "volume": "numéro de tome si présent"}
Exemples: "Les héros de la galaxie 1" (un manga) -> {"title":"", "series":"Les héros de la galaxie", "medium":"manga", "seriesTotal":"", "seriesState":""}.
"Parkland" (un DVD de film) -> {"medium":"film"}.
"Simplissime Les plantes qui soignent Danièle Fest simple" -> title:"Les plantes qui soignent", collection:"Simplissime", authors:["Danièle Fest"].
"Le Petit Prince Folio Saint-Exupéry" -> title:"Le Petit Prince", collection:"Folio", authors:["Saint-Exupéry"].`;
      const user = `Fiche à classifier:\nTitre: ${it.title}\nAuteurs: ${(it.authors || []).join(', ') || '(vide)'}\nSérie: ${it.series || '(vide)'}\nÉditeur: ${it.publisher || '(vide)'}\nCollection: ${it.collection || '(vide)'}\nÉditeur: ${it.publisher || ''}`;
      const resp = await aiChat(sys, user, 300);
      (window.__aiSteps = window.__aiSteps || []).push('resp0: ' + String(resp || '').slice(0, 200));
      const data = parseAiJson(resp);
      if (data) {
        // appliquer uniquement les corrections CREDIBLES (ne pas casser une fiche saine)
        const isPlaceholderTitle = (t) => /^(EAN|ISBN|UPC)\s?\d/i.test(String(t || '').trim());
        if (data.title && data.title.length > 2 && data.title.length < (it.title || '').length && !/[|]/.test(data.title) && !isPlaceholderTitle(data.title)) {
          // le titre corrigé doit être plus court (on a retiré du bruit) et rester lisible
          it.title = data.title; changed.push('title');
        }
        if (Array.isArray(data.authors) && data.authors.length && !(it.authors || []).length) {
          const authorsClean0 = data.authors.map((a) => String(a || '').trim()).filter((a) => { const x = a.toLowerCase(); return a && x !== 'null' && x !== 'none' && a.length >= 2 && /[a-zA-ZÀ-ÿ]/.test(a); });
          if (authorsClean0.length) { it.authors = authorsClean0; changed.push('authors'); }
        }
        if (data.series && !it.series) { it.series = data.series; changed.push('series'); }
        const MEDIUMS = ['book', 'bd', 'manga', 'film', 'series', 'music', 'game', 'boardgame', 'jdr', 'press', 'software', 'partition', 'map', 'photo', 'print', 'manuscript', 'thesis', 'ephemera', 'object', 'digital', 'other'];
        // normalisation: l'IA peut renvoyer "Manga", "Bande dessinée", "BD", "roman"... → mapper vers nos codes
        if (changed.length) { it.fieldSources = it.fieldSources || {}; for (const c of changed) { const fname = String(c).split(' (')[0]; it.fieldSources[fname] = 'IA (complétion)'; } it.aiAssisted = true; it.aiPipelineVersion = 'v2'; }
        const mediumNorm = isNullStr(data.medium) ? '' : String(data.medium || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (mediumNorm === 'jeu') mediumNorm = 'jeu video'; // « jeu » seul = jeu vidéo dans notre taxonomie
        const mediumMap = { 'livre': 'book', 'roman': 'book', 'book': 'book', 'bd': 'bd', 'bande dessinee': 'bd', 'bandes dessinees': 'bd', 'comic': 'bd', 'manga': 'manga', 'manhwa': 'manga', 'manhua': 'manga', 'film': 'film', 'dvd': 'film', 'blu-ray': 'film', 'bluray': 'film', 'cinema': 'film', 'serie': 'series', 'series': 'series', 'television': 'series', 'musique': 'music', 'music': 'music', 'cd': 'music', 'vinyle': 'music', 'jeu video': 'game', 'jeu-video': 'game', 'game': 'game', 'video game': 'game', 'jeu de societe': 'boardgame', 'boardgame': 'boardgame', 'jeu de plateau': 'boardgame', 'jdr': 'jdr', 'jeu de role': 'jdr', 'rpg': 'jdr',
  'revue': 'press', 'magazine': 'press', 'journal': 'press', 'presse': 'press', 'quotidien': 'press', 'hebdomadaire': 'press', 'periodique': 'press', 'press': 'press',
  'logiciel': 'software', 'software': 'software', 'application': 'software', 'app': 'software', 'saas': 'software',
  'partition': 'partition', 'score': 'partition',
  'carte': 'map', 'plan': 'map', 'atlas': 'map', 'cartographique': 'map',
  'photographie': 'photo', 'photo': 'photo', 'image': 'photo',
  'estampe': 'print', 'gravure': 'print', 'affiche': 'print', 'lithographie': 'print',
  'manuscrit': 'manuscript', 'archive': 'manuscript', 'correspondance': 'manuscript',
  'these': 'thesis', 'memoire': 'thesis', 'rapport': 'thesis',
  'tract': 'ephemera', 'flyer': 'ephemera', 'menu': 'ephemera', 'carte postale': 'ephemera',
  'objet': 'object', 'instrument': 'object', 'mallette': 'object', 'kamishibai': 'object', 'lego': 'object',
  'base de donnees': 'digital', 'podcast': 'digital', 'ressource numerique': 'digital', 'site web': 'digital',
  'autre': 'other', 'other': 'other' };
        const mapped = mediumMap[mediumNorm] || (MEDIUMS.includes(mediumNorm) ? mediumNorm : null);
        if (mapped && mapped !== 'other' && (it.medium === 'other' || !it.medium || (it.medium === 'book' && mapped !== 'book'))) { it.medium = mapped; changed.push('medium'); }
        if (data.seriesTotal && !it.seriesTotal) { const st = parseInt(String(data.seriesTotal).replace(/[^0-9]/g, ''), 10); if (st > 0 && st < 500) { it.seriesTotal = st; changed.push('seriesTotal'); } }
        // garde-fou anti-résumé-méta: l'IA ne doit jamais écrire un commentaire SUR la fiche
        if (data.summary && !it.summary && !isNullStr(data.summary)) {
          const sm2 = String(data.summary).trim();
          const metaWords = /non identifi|aucune information|pas d'information|document non|code-barres|code barres|ean\b/i.test(sm2);
          if (!metaWords && sm2.length > 30) { it.summary = sm2; changed.push('summary'); }
        }
        if (data.seriesState && !it.seriesState && ['ongoing', 'complete', 'oneshot'].includes(String(data.seriesState).trim().toLowerCase())) { it.seriesState = String(data.seriesState).trim().toLowerCase(); changed.push('seriesState'); }
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
          if (dup && dup.medium !== it.medium) { toast((LANG === 'en' ? 'Different media type (' : 'Medium différent (') + dup.medium + (LANG === 'en' ? ') — no merge' : ') — pas de fusion'), 5000); }
          else if (dup) {
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
  // GARDE FONDAMENTALE: une œuvre NON IDENTIFIÉE (titre placeholder EAN/ISBN) ne se génère PAS —
  // l'IA inventerait des explications méta (« cette référence correspond à un code-barres… »)
  const isUnidentified = /^(EAN|ISBN|UPC)\s?\d/i.test(String(it.title || '').trim());
  const needAi = !isUnidentified && (!it.summary || !it.genre || !it.dewey);
  if (needAi) {
    const sys = `Tu complètes des fiches de bibliothèque${it.isbn ? '' : ' (sans ISBN — base-toi sur le titre et l\'auteur)'}. Renvoie UNIQUEMENT un objet JSON avec les champs: {"summary": "résumé en 3-4 phrases", "genre": "genre", "dewey": "cote Dewey comme 843 ou 741.5"}. Pas d'autre texte.`;
    const user = `Titre: ${it.title}${it.subtitle ? ' — ' + it.subtitle : ''}\nAuteurs: ${(it.authors || []).join(', ')}\nÉditeur: ${it.publisher}\nAnnée: ${it.publishedDate}\nType: ${it.medium}`;
    const resp = await aiChat(sys, user, 400);
    const m = resp.match(/\{[\s\S]*\}/);
    if (m) {
      const data = JSON.parse(m[0]);
      const metaWords2 = /non identifi|aucune information|sans informations|pas d'information|document non|code-barres|code barres|ean\b|r\u00e9f\u00e9rence correspond|R\u00e9f\u00e9rence correspond|produit standardis|suivi des stocks|vente au d\u00e9tail/i;
      if (data.summary && !it.summary && String(data.summary).trim().length > 30 && !metaWords2.test(String(data.summary))) { it.summary = String(data.summary).trim(); changed.push('summary'); }
      if (data.genre && !it.genre && !metaWords2.test(String(data.genre)) && String(data.genre).trim().length > 2) { it.genre = String(data.genre).trim(); changed.push('genre'); }
      if (data.dewey && !it.dewey && /^(\d{3}(\.\d+)?)$/.test(String(data.dewey).replace(',', '.').trim())) { it.dewey = String(data.dewey).replace(',', '.').trim(); changed.push('dewey'); }
    }
  }
  store.update(it);
  if (extractVolumeFromTitle(it)) changed.push('volume (extrait du titre)');
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
    model = prompt(LANG === 'en' ? 'Model for VISION (photos, e.g. pixtral-12b-latest):' : 'Modèle VISION (photos, ex. pixtral-12b-latest) :', model === 'llama3' ? 'mistral-small-latest' : model) || 'mistral-small-latest';
    key = prompt(LANG === 'en' ? 'API key (stored only in this browser):' : 'Clé API (stockée uniquement dans ce navigateur) :', key) || '';
    const tm0 = prompt(LANG === 'en' ? 'Model for TEXT tasks (Compléter par IA — empty = same as vision):' : 'Modèle TEXTE (Compléter par IA — vide = même que vision) :', aiCfg.textModel || '') || '';
    aiCfg.textModel = tm0.trim();
  }
  aiCfg = { provider, url, model, key, textModel: aiCfg.textModel || '' };
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

/* Remplir les listes de la sélection multiple avec les valeurs RÉELLES de la collection */
function renderBulkFurnitureOptions() {
  const sel = $('#bulkFurnitureSelect');
  if (!sel) return;
  const cur = sel.value;
  const furs = [...new Set(store.items.map((i) => (i.furniture || '').trim()).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">' + t('bulk_furniture') + '</option>' + furs.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  sel.value = cur;
}
function renderBulkGenreOptions() {
  const sel = $('#bulkGenreSelect');
  if (!sel) return;
  const cur = sel.value;
  // 3 groupes: vos genres complets (compteur) + vos sous-genres/CATEGORIES (segments, compteur) + taxonomie complete (natures + genres + sous-genres)
  const counts = {};
  const segCounts = {};
  for (const it of store.items) {
    const g = (it.genre || '').trim();
    if (g) {
      counts[g] = (counts[g] || 0) + 1;
      for (const seg of g.split('/').map((x) => x.trim()).filter(Boolean)) segCounts[seg] = (segCounts[seg] || 0) + 1;
    }
  }
  const mine = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const mySegs = Object.entries(segCounts).filter(([g2, n3]) => !counts[g2] && n3 >= 1).sort((a, b) => b[1] - a[1]).slice(0, 40);
  let taxoHtml = '';
  for (const [nat, genres] of Object.entries(GENRE_TAXONOMY)) {
    taxoHtml += `<optgroup label="${esc(nat)}">`;
    for (const [g2, node] of Object.entries(genres)) {
      taxoHtml += `<option value="${esc(nat + ' / ' + g2)}">${esc(g2)}</option>`;
      for (const sg of taxoSubs(node)) taxoHtml += `<option value="${esc(nat + ' / ' + g2 + ' / ' + sg)}">${esc('· ' + sg)}</option>`;
    }
    taxoHtml += '</optgroup>';
  }
  sel.innerHTML = '<option value="">' + t('g_genre') + '</option>'
    + '<optgroup label="' + t('gf_mine') + '">' + mine.map(([g, n2]) => `<option value="${esc(g)}">${esc(g)} (${n2})</option>`).join('') + '</optgroup>'
    + (mySegs.length ? '<optgroup label="' + t('gf_bytheme') + '">' + mySegs.map(([g2, n3]) => `<option value="/${esc(g2)}">${esc(g2)} — ${t('all_label')} (${n3})</option>`).join('') + '</optgroup>' : '')
    + '<optgroup label="' + t('gf_explore') + '">' + taxoHtml + '</optgroup>';
  sel.value = cur;
}

function renderBulkShelfOptions() {
  const sel = $('#bulkShelfSelect');
  if (!sel) return;
  const cur = sel.value;
  let options = store.shelves.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  // Si aucune étagère virtuelle : proposer les EMPLACEMENTS RÉELS (Meuble · Étagère) de la collection
  if (!store.shelves.length) {
    // UX: lister seulement la partie ÉTAGÈRE (slot) — le meuble se choisit à part.
    // Normalisation stricte (espaces, casse) pour éliminer les doublons "Étagères_1 1"/"Etagères_1 1 "
    const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const seen = new Set();
    const slots = [];
    for (const i of store.items) {
      let sl = (i.slot || '').trim();
      // assainir les slots pollués (« Meuble · Étagère » -> garder la partie étagère si elle répète le meuble)
      if (sl.includes('·') && (i.furniture || '').trim() && sl.toLowerCase().startsWith((i.furniture || '').trim().toLowerCase())) {
        sl = sl.split('·').map((x) => x.trim()).filter(Boolean).slice(1).join(' · ');
      }
      if (!sl) continue;
      const k = norm(sl);
      if (!seen.has(k)) { seen.add(k); slots.push(sl.replace(/\s+/g, ' ')); }
    }
    slots.sort((a, b) => a.localeCompare(b, 'fr'));
    options = slots.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  }
  sel.innerHTML = '<option value="">' + t('g_shelf') + '</option>' + options;
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
  // éligibles: champs manquants OU support à reclasser ('other', ou 'book' avec indices manga/BD/tome)
  const needsMedium = (i) => (i.medium === 'other' || !i.medium || i.medium === 'book');
  const items = filterOpsItems().filter((i) => !i.summary || !i.genre || !i.dewey || !i.isbn || needsMedium(i));
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

$('#btnPresuggestSubjects').addEventListener('click', () => {
  const go = confirm(tm('presuggest_confirm'));
  if (!go) return;
  const r = presuggererSujets();
  toast('🏷️ ' + tm('presuggest_done', r.proposés, r.déjà, r.sansGenre), 7000);
});
$('#btnPurgeBlanks').addEventListener('click', () => { try { purgeBlankFiches(); } catch (eP) { toast(String(eP.message || eP), 5000); } });
$('#btnAuditCoherence').addEventListener('click', () => {
  const txt = auditCoherence();
  showDiagModal('📊 ' + (LANG === 'en' ? 'Coherence audit' : 'Audit de cohérence'), txt);
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
  if (!confirm(tm('filter_del_confirm', items.length) + (sample ? `\n(${sample}${items.length > 3 ? '…' : ''})` : '') + '\n' + tm('undo_available_hint'))) return;
  saveBulkSnapshot(items);
  let n = 0;
  for (const it of items) { store.remove(it.id); n++; }
  renderAll();
  toast(tm('bulk_delete_done', n), 4000);
  const ub = document.getElementById('btnBulkUndo');
  if (ub) ub.classList.remove('hidden');
  scheduleAutoSync();
});

$('#btnBulkMode').addEventListener('click', () => {
  bulkMode = !bulkMode;
  try { ensureBarHeaders(); } catch (eH2) {} // re-injection à l'ouverture (ceinture et bretelles)

  bulkSel.clear();
  $('#bulkBar').classList.toggle('hidden', !bulkMode);
  $('#btnBulkMode').classList.toggle('shelve-on', bulkMode);
  renderBulkShelfOptions();
  renderGrid();
  if (bulkMode) toast(tm('bulk_hint'));
});

/* ☑ Tout sélectionner / désélectionner — bascule sur l'affichage courant */
/* 🎯 Double comportement du select Genre : Appliquer (modifie les fiches sélectionnées/affichées)
   ou Filtrer (affiche les fiches de ce genre/sous-genre pour explorer puis agir). */
let bulkGenreFilterMode = false;
function setBulkGenreMode(filter) {
  bulkGenreFilterMode = filter;
  const b = document.getElementById('btnBulkGenreMode');
  if (b) b.textContent = filter ? t('genre_mode_filter') : t('genre_mode_apply');
}
document.getElementById('btnBulkGenreMode') && document.getElementById('btnBulkGenreMode').addEventListener('click', () => {
  setBulkGenreMode(!bulkGenreFilterMode);
  toast(bulkGenreFilterMode ? tm('genre_mode_filter_on') : tm('genre_mode_filter_off'), 2500);
});
$('#bulkGenreSelect').addEventListener('change', () => {
  if (!bulkGenreFilterMode) return; // mode Appliquer: le genre sera pose au moment d'Appliquer
  // mode Filtrer: afficher les fiches de ce genre/sous-genre dans la grille
  const g = $('#bulkGenreSelect').value;
  if (!g) return;
  const isSeg = g.startsWith('/');
  const seg = isSeg ? g.slice(1).trim() : '';
  const target = isSeg ? seg : g;
  const matches = store.items.filter((i) => {
    const gi = (i.genre || '').trim();
    if (!gi) return false;
    return isSeg ? gi.split('/').map((x) => x.trim()).includes(seg) : gi.startsWith(target);
  });
  // cocher automatiquement ces fiches (le comportement 1 mene au 2: explorer -> agir)
  bulkSel.clear();
  for (const m of matches) bulkSel.add(m.id);
  $('#bulkCount').textContent = bulkSel.size + (LANG === 'en' ? ' selected' : ' sélectionné(s)');
  renderAll();
  toast(tm('genre_filter_selected', bulkSel.size), 3500);
});

$('#btnBulkSelectAll').addEventListener('click', () => {
  const items = filterOpsItems();
  const allSelected = items.length && items.every((it) => bulkSel.has(it.id));
  if (allSelected) {
    for (const it of items) bulkSel.delete(it.id);
    toast(tm('select_cleared'), 2500);
  } else {
    for (const it of items) bulkSel.add(it.id);
    toast(tm('filter_selected', items.length), 3000);
  }
  $('#bulkCount').textContent = bulkSel.size + (LANG === 'en' ? ' selected' : ' sélectionné(s)');
  renderAll();
});

$('#btnGlobalUndo').addEventListener('click', () => {
  undoBulkLast();
  document.getElementById('btnGlobalUndo').classList.add('hidden');
});

$('#btnBulkUndo').addEventListener('click', () => {
  undoBulkLast();
  document.getElementById('btnBulkUndo').classList.add('hidden');
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
  if (!confirm(tm('bulk_delete_confirm', bulkSel.size) + (titles ? '\n(' + titles + (bulkSel.size > 5 ? '…' : '') + ')' : '') + '\n' + tm('undo_available_hint'))) return;
  // snapshot AVANT suppression — l'Undo réinsèrera les fiches entières
  const targets = [...bulkSel].map((id) => store.findById(id)).filter(Boolean);
  saveBulkSnapshot(targets);
  let n = 0;
  for (const id of bulkSel) { if (store.remove(id)) n++; }
  bulkSel.clear();
  $('#bulkCount').textContent = '';
  toast(tm('bulk_delete_done', n), 3500);
  const ub = document.getElementById('btnBulkUndo');
  if (ub) ub.classList.remove('hidden');
  scheduleAutoSync();
  renderAll();
});

$('#btnBulkApply').addEventListener('click', () => {
  // SÉCURITÉ (incident réel: l'utilisateur a rangé TOUT son catalogue d'un coup sans s'en rendre compte):
  // l'ancien comportement appliquait automatiquement à TOUT l'affichage si rien n'était coché.
  // Désormais il FAUT cocher explicitement des fiches (☐ sur les mini-fiches) — pas d'effet de bord.
  if (!bulkSel.size) {
    toast((LANG === 'en' ? '\u26a0\ufe0f No record checked \u2014 tick records first (\u2610 on the cards), or \u00ab\u2611\u20f0 Select all (view)\u00bb' : "\u26a0\ufe0f Aucune fiche coch\u00e9e \u2014 cochez d'abord des fiches (\u2610 sur les mini-fiches), ou \u00ab\u2611\u20f0 Tout s\u00e9lectionner (affich\u00e9)\u00bb"), 6000);
    return;
  }
  const status = $('#bulkStatus').value;
  const shelf = $('#bulkShelfSelect').value;
  const genre = ($('#bulkGenreSelect') ? $('#bulkGenreSelect').value : '') || ($('#bulkGenre') ? $('#bulkGenre').value.trim() : '');
  const furn = $('#bulkFurnitureSelect') ? $('#bulkFurnitureSelect').value.trim() : '';
  const loc = $('#bulkLocation').value.trim();
  const posStart = ($('#bulkPosStart') ? parseInt($('#bulkPosStart').value, 10) : 0) || 0;
  if (!status && !shelf && !genre && !loc && !furn && !posStart) { toast(tm('pick_change')); return; }
  // snapshot pour l'annulation (Undo)
  const targets = [...bulkSel].map((id) => store.findById(id)).filter(Boolean);
  saveBulkSnapshot(targets);
  let n = 0;
  for (const id of bulkSel) {
    const it = store.findById(id);
    if (!it) continue;
    if (status) it.status = status;
    // meuble D'ABORD (ordre UX), puis étagère qui se combine dessus
    if (furn) {
      it.furniture = furn;
      it.location = [it.furniture, it.slot].filter(Boolean).join(' · ');
    }
    if (shelf) {
      // slot réel (ex. « Étagères_1 1 ») — se combine avec le meuble choisi ou existant
      it.slot = shelf;
      it.location = [it.furniture || furn, it.slot].filter(Boolean).join(' · ');
    }
    if (genre) it.genre = genre;
    if (loc) {
      // accepter "Meuble" seul OU "Meuble · Étagère" (le point median comme separateur, ou |)
      const parts = loc.split(/[·|]/).map((p) => p.trim()).filter(Boolean);
      it.furniture = parts[0] || '';
      it.slot = parts.slice(1).join(' · ');
      it.location = [it.furniture, it.slot].filter(Boolean).join(' · ');
    }
    store.update(it);
    n++;
  }
  // POSITIONS ORDINALES EN MASSE (mode rangement catalogue): № départ + ordre affiché.
  // Les fiches sélectionnées prennent start, start+1… dans l'ordre affiché (tri courant),
  // les occupants >= start se décalent du nombre de fiches insérées — renumérotation automatique.
  if (posStart) {
    const ordered = currentFilter().filter((i) => bulkSel.has(i.id));
    const t0 = ordered[0];
    if (t0 && t0.furniture && t0.slot) {
      for (const o of store.items) {
        if (!bulkSel.has(o.id) && o.photoPos && o.photoPos >= posStart && o.furniture === t0.furniture && o.slot === t0.slot) o.photoPos += ordered.length;
      }
    }
    ordered.forEach((i, idx) => { i.photoPos = posStart + idx; });
    n += ordered.length;
  }
  // diagnostic verbeux: dire exactement quels champs ont ete appliques
  const changes = [];
  if (status) changes.push(tm('bulk_diag_status'));
  if (shelf) changes.push(tm('bulk_diag_shelf'));
  if (genre) changes.push(tm('bulk_diag_genre'));
  if (furn) changes.push(tm('bulk_diag_furniture'));
  if (loc) changes.push(tm('bulk_diag_loc'));
  if (posStart) changes.push((LANG === 'en' ? 'positions (\u2116 from ' : 'positions (\u2116 depuis ') + posStart + ')');
  toast(tm('bulk_applied_undo', n, changes.join(', ')), 6000);
  const ub = document.getElementById('btnBulkUndo');
  if (ub) ub.classList.remove('hidden');
  $('#bulkStatus').value = '';
  $('#bulkShelfSelect').value = '';
  if ($('#bulkFurnitureSelect')) $('#bulkFurnitureSelect').value = '';
  if ($('#bulkGenreSelect')) $('#bulkGenreSelect').value = '';
  if ($('#bulkGenre')) $('#bulkGenre').value = '';
  if ($('#bulkPosStart')) $('#bulkPosStart').value = '';
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
let apiKeys = { googleBooks: '', tmdb: '', igdbId: '', igdbSecret: '', bggToken: '', discogsToken: '' };
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
  if ($('#keyTmdb')) $('#keyTmdb').value = apiKeys.tmdb || '';
  if ($('#keyIgdbId')) $('#keyIgdbId').value = apiKeys.igdbId || '';
  if ($('#keyIgdbSecret')) $('#keyIgdbSecret').value = apiKeys.igdbSecret || '';
  if ($('#keyBggToken')) $('#keyBggToken').value = apiKeys.bggToken || '';
  if ($('#keyDiscogsToken')) $('#keyDiscogsToken').value = apiKeys.discogsToken || '';
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
  if ($('#keyTmdb')) apiKeys.tmdb = $('#keyTmdb').value.trim();
  if ($('#keyIgdbId')) apiKeys.igdbId = $('#keyIgdbId').value.trim();
  if ($('#keyIgdbSecret')) apiKeys.igdbSecret = $('#keyIgdbSecret').value.trim();
  if ($('#keyBggToken')) apiKeys.bggToken = $('#keyBggToken').value.trim();
  if ($('#keyDiscogsToken')) apiKeys.discogsToken = $('#keyDiscogsToken').value.trim();
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

async function aiVisionShelf(prompt, imageDataUrl, sysOverride, maxTokens) {
  const sys = sysOverride || 'Tu es un assistant expert en reconnaissance de tranches de livres sur une photo d\'étagère. Réponds UNIQUEMENT en JSON valide.';
  const user = prompt;
  const tokens = maxTokens || 4000; // couverture: 4000 suffit — photo d'étagère (30+ livres): passer plus
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
  const callVision = async (mt) => {
    const r = await fetchWithTimeout(aiEndpoint(), 120000, {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({
        model: aiCfg.model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: sys + '\n' + user },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ] }], max_tokens: mt,
        temperature: 0.1,
      }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    // Mistral vision peut renvoyer content = [{type:'text', text:'...'}] — normaliser en string
    const txt = Array.isArray(raw) ? raw.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n') : raw;
    return String(txt || '').trim();
  };
  try {
    return await callVision(tokens);
  } catch (e) {
    // certains modeles refusent max_tokens > leur limite (HTTP 400) → retenter avec 4096 (limite universelle)
    if (tokens > 4096 && String(e && e.message).includes('400')) return await callVision(4096);
    throw e;
  }
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
    const resp = await aiVisionShelf(prompt, shelfPhotoData, null, 16000);
    const parsed = parseAiJson(resp);
    if (!parsed) throw new Error(LANG === 'en' ? 'unparsable AI response' : 'réponse IA non parsable');
    const rows = parsed.rows || [];
    // ROBUSTESSE: si l'IA ne renvoie pas pos, numéroter dans l'ordre (rangée par rangée)
    for (const row of rows) {
      const bks = row.books || [];
      let posCounter = 1;
      for (const b of bks) {
        if (!b.pos) b.pos = b.position || b.index || b.order || posCounter;
        posCounter++;
      }
    }
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
          html += `<div class="inv-line warn" data-key="${esc(rowLoc + '#' + (b.pos || ''))}" data-pos="${esc(b.pos || '')}" data-loc="${esc(rowLoc)}" style="cursor:grab">❓ <b>${esc(b.title || '?')}</b>${b.volume ? ' T.' + esc(b.volume) : ''}${b.pos ? ' <span class="hint">[' + b.pos + (b.flat ? '·' + t('flat_short') : '') + ']</span>' : ''}${extra.length ? ' — ' + extra.join(' · ') : ''} — ${t('ph_unknown_lib')}</div>`;
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
    const batchBtn = window.__shelfUnknown.length ? ` <button class="btn btn-primary small" id="btnShelfIdentifyAll">🔎 ${t('ph_identify_all')} (${window.__shelfUnknown.length})</button>${deduceBtn} <button class="btn small" id="btnShelfCreateBlanks">📥 ${t('ph_create_blanks')} (${window.__shelfUnknown.length})</button> <button class="btn small btn-primary" id="btnShelfScanUnknowns">📷 ${t('ph_scan_unknowns')} (${window.__shelfUnknown.length})</button>` : '';
    let totalSeen = 0;
    for (const row of rows) totalSeen += (row.books || []).length;
    html = `<div class="group-card"><b>${t('ph_summary')}</b> — ${knownHere} ${t('inv_ranged')} · ${misplaced} ${t('inv_misplaced')} · ${unknown} ${t('inv_inv')}${batchBtn}</div>` + posHtml + html;
    $('#shelfStatus').textContent = t('ph_done') + ' (' + totalSeen + ' ' + (LANG === 'en' ? 'books seen by the AI' : 'livres vus par l’IA') + ')';
    $('#shelfResult').innerHTML = html;
    $('#shelfStatus').textContent = t('ph_done');

    // ↕️ Réordonner les inconnus : cliquer le numéro de position [n] pour le modifier —
    // la ligne se réinsère à la bonne place, les autres se décalent.
    if ($('#shelfResult')) {
      $('#shelfResult').querySelectorAll('.inv-line[data-pos]').forEach((el) => {
        const posSpan = el.querySelector('.hint');
        if (!posSpan) return;
        // indice visuel clair: le numéro est souligné, la ligne entière est cliquable
        posSpan.style.cursor = 'pointer';
        posSpan.style.textDecoration = 'underline dotted';
        posSpan.title = t('ph_edit_pos_title');
        el.addEventListener('click', (ev) => {
          ev.preventDefault();
          const cur = el.dataset.pos;
          // modale native (prompt() peut être bloqué sur mobile)
          const m = document.getElementById('posEditModal');
          if (!m) return;
          const input = document.getElementById('posEditInput');
          const lbl = document.getElementById('posEditLbl');
          if (input) input.value = cur;
          if (lbl) lbl.textContent = tm('ph_edit_pos_prompt', cur);
          window.__posEditTarget = el;
          m.classList.remove('hidden');
        });
      });
    }
    const peOk = document.getElementById('posEditOk');
    if (peOk) peOk.addEventListener('click', () => {
      const el = window.__posEditTarget;
      const input = document.getElementById('posEditInput');
      if (!el || !input) return;
      document.getElementById('posEditModal').classList.add('hidden');
      const cur = el.dataset.pos;
      const v = String(input.value).trim();
      if (v === String(cur)) return;
      const np = parseInt(v, 10);
          if (!np || np < 1) { toast(tm('ph_edit_pos_invalid'), 3000); return; }
          const loc = el.dataset.loc;
          // decaler dans __shelfUnknown: toutes les positions >= np (de la meme rangée) prennent +1
          const mine = (window.__shelfUnknown || []).filter((u) => (u.loc || '') === loc);
          const moving = mine.find((u) => String(u.pos || '') === String(cur));
          if (!moving) return;
          for (const u of mine) {
            const p = +u.pos || 0;
            if (u === moving) continue;
            // decalage: entre min(cur,np) et max(cur,np) les positions se serrent d'un cran vers la place liberee
            if (np < cur && p >= np && p < cur) u.pos = p + 1;
            else if (np > cur && p > cur && p <= np) u.pos = p - 1;
          }
          moving.pos = np;
          // renumeroter visuellement: trier et reinserer
          const parent = el.parentNode;
          const all = [...parent.querySelectorAll('.inv-line[data-pos]')];
          const locs = {};
          for (const l of all) { const lk = l.dataset.loc; (locs[lk] = locs[lk] || []).push(l); }
          for (const [lk, lines] of Object.entries(locs)) {
            lines.sort((a, b) => (+a.dataset.pos || 0) - (+b.dataset.pos || 0));
            // rafraichir les numeros affiches depuis __shelfUnknown
            for (const l of lines) {
              const u = (window.__shelfUnknown || []).find((x) => (x.loc || '') === l.dataset.loc && String(x.pos || '') === String(l.dataset.pos));
              const hs = l.querySelector('.hint');
              if (hs && u) hs.textContent = '[' + u.pos + (u.flat ? '·' + t('flat_short') : '') + ']';
            }
            const anchorEl = lines[0];
            for (const l of lines) parent.insertBefore(l, anchorEl);
          }
          toast(tm('ph_moved_pos', cur, np), 3000);
    });

    // 📷 Scanner les fiches inconnues : scan en série — chaque ISBN scanné complète le prochain inconnu du bilan
    // (ordre des positions), la fiche est créée RANGÉE à sa position photo, la ligne disparaît du bilan.
    const suBtn = document.getElementById('btnShelfScanUnknowns');
    if (suBtn) suBtn.addEventListener('click', () => {
      const list = window.__shelfUnknown || [];
      if (!list.length) { toast(tm('ph_none_identifiable', 0), 4000); return; }
      // file d'attente des inconnus, dans l'ordre des positions
      window.__shelfScanQueue = list.slice().sort((a, b) => (a.pos || 0) - (b.pos || 0));
      // bulle d'info permanente pendant le scan: OU EN EST-ON (prochain livre a scanner)
      const next = window.__shelfScanQueue[0];
      $('#scanStatus').textContent = tm('ph_scan_next_hint', next.loc || '', next.pos || '?', window.__shelfScanQueue.length);
      toast(tm('ph_scan_unknowns_start', window.__shelfScanQueue.length), 5000);
      startScan();
    });

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
        const parts = (u.loc || '').split('·').map((x) => x.trim()).filter(Boolean);
        // slot = partie ÉTAGÈRE seule (sans le meuble) — le meuble est dans furniture
        const item = { ...blankItem(''), title: '?', series: u.series || '', volume: u.volume || '', publisher: u.publisher || '',
          furniture: u.furniture || parts[0] || '', slot: parts.slice(1).join(' · ') || (u.slot || ''), location: u.loc || '', status: 'unread',
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
      // faire DISPARAÎTRE les lignes identifiées du bilan (il ne reste que les inconnus)
      const goneKeys = new Set(identifiedSet.size ? [...identifiedSet].map((u) => (u.loc || '') + '#' + (u.pos || '')) : []);
      if (goneKeys.size && $('#shelfResult')) {
        $('#shelfResult').querySelectorAll('.inv-line[data-key]').forEach((el) => {
          if (goneKeys.has(el.dataset.key)) el.remove();
        });
      }
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
const APP_VERSION = '2.49.0';
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
        <h3>${esc(i.title)}${displayVolume(i) ? ` <span class="chip" style="background:#e8efe8;border-color:#7a9a7a;color:#2f5d50">T. ${esc(displayVolume(i))}</span>` : ''}</h3>
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
    // Format non decodable par le navigateur (ex. HEIC hors Safari) : NE PAS ecrire un data URL
    // brut non affichable dans le champ (lien sans image) -- signaler explicitement via cb(null)
    img.onerror = () => cb(null, 0, 0);
    img.src = fr.result;
  };
  fr.onerror = () => cb(null, 0, 0);
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
      // Format illisible (HEIC hors Safari, fichier corrompu...) : message explicite, jamais de lien sans image
      if (!dataUrl) {
        if (status) status.textContent = LANG === 'en' ? 'Unreadable image format (HEIC?). Shoot again or use a JPG.' : "Format d\u2019image illisible (HEIC ?). Reprenez la photo ou utilisez un JPG.";
        toast(LANG === 'en' ? 'Unreadable image format \u2014 photo NOT saved' : "Format d\u2019image illisible (HEIC ?) \u2014 photo NON enregistr\u00e9e", 5000);
        return;
      }
      const form = document.getElementById('detailForm');
      const fieldEl = form ? form.querySelector(`[name="${targetFieldName}"]`) : null;
      if (!fieldEl) {
        if (status) status.textContent = LANG === 'en' ? 'Form closed \u2014 reopen the record and retake the photo.' : 'Formulaire ferm\u00e9 \u2014 rouvrez la fiche et reprenez la photo.';
        return;
      }
      fieldEl.value = dataUrl;
      // Persisté AUSSI dans le store immédiatement: un re-rendu du formulaire (🎯, IA, relation…)
      // réinitialisait les champs depuis it — la photo était perdue à l'enregistrement (bug réel rapporté)
      try { const cur = store.findById(editingId); if (cur) { if (targetFieldName === 'coverBack') cur.coverBack = dataUrl; else cur.cover = dataUrl; store.update(cur); } } catch (eSt) {}
      // FIX: l\u2019affectation programmatique de .value ne d\u00e9clenche PAS l\u2019\u00e9v\u00e9nement \u2018input\u2019 \u2014
      // l\u2019aper\u00e7u (__livePrev) restait masqu\u00e9 : \u00ab un lien mais pas d\u2019image \u00bb. Mise \u00e0 jour DIRECTE de l\u2019aper\u00e7u.
      const im = document.getElementById(targetFieldName === 'coverBack' ? 'coverBackPrevImg' : 'coverPrevImg');
      if (im) { im.src = dataUrl; im.style.display = 'block'; }
      if (status) status.textContent = `Image int\u00e9gr\u00e9e (${w}\u00d7${h} px) \u2014 cliquez \u00ab Enregistrer \u00bb pour la fixer dans la fiche.`;
    });
  });
}

// NB: le cablage des imports photo se fait a l'ouverture de la fiche (openDetail) car le formulaire
// detail est RE-RENDU a chaque ouverture -- un cablage unique au chargement referencerait des inputs morts
// (bug aucune des deux photos). Pas de wireCoverImport top-level.

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
      // Transparence: si le relais est configuré mais que la BnF a bloqué (anti-bot 403/429), le dire
      // au lieu d'un échec silencieux — l'utilisateur sait qu'il peut retenter le scan
      if (data && data.found === false && data.diag && /HTTP 4\d\d|fetch error/i.test(String(data.diag))) {
        toast((LANG === 'en' ? 'Relay FR: BnF blocked the request (anti-bot) — you can retry the scan' : "Relais FR : la BnF a bloqué la requête (anti-bot) — vous pouvez retenter le scan"), 5000);
      }
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
