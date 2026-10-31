/* Relais bibliographique — à déployer sur Cloudflare Workers (gratuit, 100 000 requêtes/jour)
   Usage: https://VOTRE-WORKER.workers.dev/?isbn=9782505141358
   Retourne JSON: { source, title, authors, publisher, date, cover, summary } ou { found: false }

   Déploiement (5 min) :
   1. https://dash.cloudflare.com → Workers & Pages → Create Worker → nom "biblio-relais"
   2. Coller ce code entier → Save and Deploy
   3. Copier l'URL https://biblio-relais.VOTRE-SOUS-DOMAIRE.workers.dev
   4. Dans l'app : ☰ → 🔑 Clés API → champ "URL du relais"
*/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function fetchFnac(isbn) {
  try {
    const url = 'https://www.fnac.com/SearchResult/ResultList.aspx?Search=' + encodeURIComponent(isbn) + '&SCat=0%21&sft=1&sa=0';
    const r = await fetch(url, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9',
    } });
    if (!r.ok) return null;
    const html = await r.text();
    const titleMatch = html.match(/<a[^>]*class="[^"]*Article-title[^"]*"[^>]*>([^<]+)<\/a>/) || html.match(/<h2[^>]*>([^<]{5,150})<\/h2>/);
    if (!titleMatch) return null;
    let title = titleMatch[1].trim();
    const cutIdx = title.indexOf('Tout savoir sur');
    if (cutIdx > 0) {
      let base = title.slice(0, cutIdx).replace(/[\s:,-]+$/, '').trim();
      const sepIdx = base.indexOf('- :');
      if (sepIdx >= 0 && sepIdx < base.length - 4) base = base.slice(sepIdx + 3).trim();
      title = base;
    }
    title = title.replace(/\s*-\s*Tout savoir sur.*$/i, '').trim();
    const authors = [];
    const authorBlock = html.match(/([A-Z][a-zA-ZÀ-ÿ' -]+)\s*\(Illustration\)/) || html.match(/class="[^"]*Article-descSub[^"]*"[^>]*>([^<]+)</);
    if (authorBlock) {
      for (const a of authorBlock[1].split(/,|\bet\b/)) {
        const name = a.trim().replace(/\(.*\)/, '').trim();
        if (name && name.length > 2 && !/^\d/.test(name)) authors.push(name);
      }
    }
    let publisher = '';
    const pubMatch = html.match(/Editeur\s*<[^>]*>\s*([A-Za-zÀ-ÿ .]+?)\s*<\//i) || html.match(/Editeur ([A-Za-zÀ-ÿ .]+)\s/i);
    if (pubMatch) publisher = pubMatch[1].trim();
    let date = '';
    const dateMatch = html.match(/Parution\s*<[^>]*>\s*(\d{2}\/\d{2}\/(\d{4}))|Parution (\d{2}\/\d{2}\/(\d{4}))/);
    if (dateMatch) date = ((dateMatch[2] || dateMatch[4])) || '';
    let pages = null;
    const pagesMatch = html.match(/(\d{2,4})\s*pages/);
    if (pagesMatch) pages = parseInt(pagesMatch[1], 10);
    let summary = '';
    const sumMatch = html.match(/Lire la suite"\s*([^"]{40,600})/) || html.match(/class="[^"]*Article-description[^"]*"[^>]*>([^<]{40,600})</);
    if (sumMatch) summary = sumMatch[1].replace(/\s+/g, ' ').trim();
    if (!title) return null;
    // Couverture: miniature Fnac embarquee dans les resultats
    let cover = '';
    const coverRe = new RegExp('https://[^"\']+978' + isbn.replace(/[^0-9]/g, '') + '[^"\']*\.jpg', 'i');
    const coverMatch = html.match(coverRe) || html.match(new RegExp('https://[^"\s]+\.jpg', 'i'));
    if (coverMatch) cover = coverMatch[0];
    return { source: 'fnac', title, authors: authors.slice(0, 4), publisher, date, summary, cover, pages };
  } catch { return null; }
}

let lastDiag = '';

async function fetchBnfSru(isbn) {
  lastDiag = '';
  const q = `bib.isbn all "${isbn}"`;
  const url = 'https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=' + encodeURIComponent(q) + '&maximumRecords=1&recordSchema=dc';
  // La BnF bloque intermittemment les serveurs Cloudflare (anti-bot probabiliste): 3 tentatives
  let xml = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept': 'application/xml,text/xml,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      } });
      if (r.ok) { xml = await r.text(); break; }
      lastDiag = 'bnf HTTP ' + r.status + ' (tentative ' + attempt + ')';
    } catch (e) { lastDiag = 'bnf fetch error: ' + e.message; }
    if (attempt < 3) await new Promise((res) => setTimeout(res, 400 * attempt));
  }
  try {
    if (!xml) return null;
    const numMatch = xml.match(/<srw:numberOfRecords>(\d+)<\/srw:numberOfRecords>/);
    if (!numMatch || parseInt(numMatch[1], 10) === 0) return null;
    let title = (xml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/) || [])[1];
    if (!title) return null;
    title = title.split(' / ')[0].replace(/\s*:\s*roman\s*$/i, '').trim();
    const authors = [...xml.matchAll(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/g)].map((m) => m[1].split('(')[0].trim()).filter((a) => a && !/^\d/.test(a));
    const publisher = ((xml.match(/<dc:publisher[^>]*>([^<]+)<\/dc:publisher>/) || [])[1] || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const date = (xml.match(/<dc:date[^>]*>(\d{4})/) || [])[1] || '';
    const pages = (xml.match(/\((\d{2,4})\s*p\.\)/) || [])[1] || null;
    return { source: 'bnf', title, authors: authors.slice(0, 4), publisher, date, pages, summary: '', cover: '' };
  } catch { return null; }
}

/* ---------- Sites editeurs: la source la plus riche (resume officiel, collection, couverture) ----------
   Le worker n'est pas soumis au CORS: il peut lire les pages editeurs.
   Strategie: recherche interne du site editeur par ISBN -> fiche produit -> extraction
   des metadonnees standards (JSON-LD / og: / meta) + heuristiques FR (Collection X). */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function decodeEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\u00e9/g, 'é').replace(/\u00e8/g, 'è').replace(/\u00ea/g, 'ê')
    .replace(/\u00e0/g, 'à').replace(/\u00e2/g, 'â').replace(/\u00f4/g, 'ô')
    .replace(/\u00ee/g, 'î').replace(/\u00e7/g, 'ç');
}

function extractBookFromHtml(html, baseUrl) {
  const meta = (prop) => {
    const m = html.match(new RegExp('<meta[^>]+(?:property|name)="' + prop + '"[^>]+content="([^"]*)"', 'i')) ||
      html.match(new RegExp('<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + prop + '"', 'i'));
    return m ? decodeEntities(m[1]).trim() : '';
  };
  let title = meta('og:title');
  let summary = meta('og:description') || meta('description');
  let cover = meta('og:image');
  // JSON-LD (Magento et beaucoup d'editeurs l'embarquent)
  const ld = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (ld) {
    try {
      const data = JSON.parse(ld[1].trim());
      const obj = Array.isArray(data) ? data[0] : data;
      if (obj && (obj['@type'] === 'Product' || obj['@type'] === 'Book')) {
        if (!title && obj.name) title = decodeEntities(obj.name);
        if (!summary && obj.description) summary = decodeEntities(obj.description).replace(/<[^>]*>/g, '');
        if (obj.bookEdition || obj.isbn) { /* garder ISBN de confirmation */ }
      }
    } catch {}
  }
  if (!title) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) title = decodeEntities(h1[1].replace(/<[^>]*>/g, '')).trim();
  }
  // Resume Rustica: section "Résumé" (pas toujours en og:description)
  if (!summary) {
    const rm = html.match(/R\u00e9sum\u00e9[\s\S]{0,80}?<[^>]*>([\s\S]{40,600}?)<\/(?:div|p)>/i) ||
      html.match(/id="description"[^>]*>([\s\S]{40,600}?)<\/div>/i);
    if (rm) summary = decodeEntities(rm[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
  }
  // Heuristique FR: "Collection Les petits précieux Rustica"
  const colMatch = html.match(/Collection\s+(?:<[^>]*>)*([A-ZÀ-Ÿ][^<\n]{2,60}?)\s*(?:<|\n|$)/);
  const collection = colMatch ? decodeEntities(colMatch[1]).trim() : '';
  // Prix editeur (15,95 €) — ignorer les prix de livraison (0,01 € etc.): prix credible = entre 1 et 500 €
  let price = null;
  const priceMatches = html.matchAll(/(\d{1,3})[,.](\d{2})\s*€/g);
  for (const pm of priceMatches) {
    const p = parseFloat(pm[1] + '.' + pm[2]);
    if (p >= 1 && p <= 500) { price = p; break; } // premier prix credible = prix du livre (le prix promo vient apres)
  }
  // Pages (dans les tableaux detail: | 144)
  const pagesMatch = html.match(/>(\d{2,4})\s*<\/td>|\|\s*(\d{2,4})\s*\|/);
  const pages = pagesMatch ? parseInt(pagesMatch[1] || pagesMatch[2], 10) : null;
  if (cover && !/^https?:/.test(cover)) cover = baseUrl.replace(/\/?[^/]*$/, '') + '/' + cover.replace(/^\//, '');
  if (!title) return null;
  return { source: 'editeur', title, summary: (summary || '').replace(/<[^>]*>/g, '').trim(), cover, collection, pages, price };
}

let __pubRules = null;
let __pubRulesAt = 0;
async function getPublisherRules() {
  const now = Date.now();
  if (__pubRules && now - __pubRulesAt < 3600000) return __pubRules;
  try {
    const r = await fetch('https://raw.githubusercontent.com/Chenzu-AI/bibliotheque-app/main/publishers.json', { headers: { 'User-Agent': UA } });
    if (r.ok) { __pubRules = await r.json(); __pubRulesAt = now; }
  } catch {}
  return __pubRules || { rules: [] };
}

async function fetchPublisherSite(isbn, publisher, pageUrl, title) {
  /* BoardGameGeek XMLAPI2 (open data, SANS cle — comme MusicBrainz) — jeux de société par EAN.
   Stratégie: recherche par code-barres (l'API BGG accepte les EAN dans la recherche generique),
   puis recuperation du detail (nom, annee, joueurs, duree, mecanismes). */
async function fetchBoardGameGeek(ean) {
  try {
    const sr = await fetch('https://boardgamegeek.com/xmlapi2/search?query=' + encodeURIComponent(ean) + '&type=boardgame', { headers: { 'User-Agent': UA } });
    if (!sr.ok) return null;
    const sxml = await sr.text();
    const idm = sxml.match(/<item id="(\d+)"[^>]*type="boardgame"/);
    if (!idm) return null;
    const bgid = idm[1];
    // detail
    const dr = await fetch('https://boardgamegeek.com/xmlapi2/thing?id=' + bgid, { headers: { 'User-Agent': UA } });
    if (!dr.ok) return null;
    const dxml = await dr.text();
    const name = (dxml.match(/<name type="primary" sortindex="\d+" value="([^"]+)"/) || [])[1];
    if (!name) return null;
    const year = (dxml.match(/<yearpublished value="(\d+)"/) || [])[1] || '';
    const minp = (dxml.match(/<minplayers value="(\d+)"/) || [])[1] || '';
    const maxp = (dxml.match(/<maxplayers value="(\d+)"/) || [])[1] || '';
    const img = (dxml.match(/<image>([^<]+)<\/image>/) || [])[1] || '';
    const descRaw = (dxml.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
    const summary = descRaw.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#10;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
    return {
      source: 'boardgamegeek', medium: 'boardgame',
      title: name, authors: [], publisher: '',
      date: year, pages: null,
      summary: summary ? summary + '…' : '',
      cover: img, players: (minp && maxp ? minp + '-' + maxp : ''),
      series: '', volume: '',
    };
  } catch { return null; }
}

/* MusicBrainz (open data, pas de cle) — recherche de releases audio par code-barres (CD/vinyles).
   Respect de leur politique: User-Agent identifiable, 1 req/s max. */
async function fetchMusicBrainz(ean) {
  try {
    const url = 'https://musicbrainz.org/ws/2/release/?query=barcode:' + encodeURIComponent(ean) + '&fmt=json&limit=3';
    const r = await fetch(url, { headers: { 'User-Agent': 'MaBibliotheque/1.0 (bibliotheque-perso) ' + UA, 'Accept': 'application/json' } });
    if (!r.ok) return null;
    const data = await r.json();
    const rel = data && data.releases && data.releases[0];
    if (!rel || !rel.title) return null;
    const artist = (rel['artist-credit'] && rel['artist-credit'][0] && rel['artist-credit'][0].name) || '';
    // pochette via Cover Art Archive (open data, par MBID de release) — best-effort
    let cover = '';
    if (rel.id) {
      try {
        const ca = await fetch('https://coverartarchive.org/release/' + rel.id, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
        if (ca.ok) {
          const cad = await ca.json();
          const front = cad && cad.images && cad.images.find((im) => im.front) || (cad.images && cad.images[0]);
          if (front && front.thumbnails && front.thumbnails.small) cover = front.thumbnails.small;
          else if (front && front.image) cover = front.image;
        }
      } catch {}
    }
    return {
      source: 'musicbrainz', medium: 'music',
      title: rel.title,
      authors: artist ? [artist] : [],
      publisher: (rel['release-group'] && '') || '',
      date: String(rel.date || '').slice(0, 4) || '',
      pages: rel['track-count'] || null, // nombre de pistes
      summary: '', cover,
      series: '', volume: '',
    };
  } catch { return null; }
}

/* Sudoc SRU (catalogue des bibliotheques universitaires) — dernier recours quand
   BnF et Fnac n'ont rien: utile pour les ouvrages academiques et anciens. */
async function fetchSudoc(isbn) {
  try {
    const q = 'dc.identifier all "' + isbn + '"';
    const url = 'https://www.sudoc.abes.fr/cbs/sru/?version=1.1&operation=searchRetrieve&query=' + encodeURIComponent(q) + '&recordSchema=dublincore&maximumRecords=3';
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/xml' } });
    if (!r.ok) return null;
    const xml = await r.text();
    const numMatch = xml.match(/<numberOfRecords>(\d+)<\/numberOfRecords>/);
    if (!numMatch || parseInt(numMatch[1], 10) === 0) return null;
    const title = (xml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/) || [])[1];
    if (!title) return null;
    const creators = [...xml.matchAll(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/g)].map((m) => m[1].trim()).filter(Boolean);
    const publisher = (xml.match(/<dc:publisher[^>]*>([^<]+)<\/dc:publisher>/) || [])[1] || '';
    const date = (xml.match(/<dc:date[^>]*>(\d{4})/) || [])[1] || '';
    return { source: 'sudoc', title: title.trim(), authors: creators.slice(0, 4), publisher: publisher.trim(), date, pages: null, summary: '', cover: '' };
  } catch { return null; }
}

/* Regles editeurs chargees depuis publishers.json (miroir public), cache 1h.
     Ajouter un editeur = editer publishers.json sur GitHub, AUCUN re-deploiement du worker. */
  if (!pageUrl && title && publisher) {
    const cfg = await getPublisherRules();
    const pubLow = String(publisher).toLowerCase();
    for (const rule of (cfg.rules || [])) {
      const hit = (rule.publisher || []).some((p) => pubLow.includes(p.toLowerCase()));
      if (!hit) continue;
      let t = String(title);
      for (const sep of (rule.slugCut || [])) t = t.split(sep)[0];
      const slug = t
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’']/g, '-')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      // variantes de slug: seul, puis avec chaque prefixe de collection connu (ex. simplissime-)
      const variants = [slug];
      for (const pre of (rule.slugPrefix || [])) {
        const p2 = pre.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        if (!slug.startsWith(p2)) variants.push(p2 + '-' + slug);
      }
      for (const v of variants) {
        const u = String(rule.url || '').replace('{isbn}', isbn).replace('{slug}', v);
        if (!u || u.includes('{') || !u.includes(isbn)) continue;
        try {
          const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow' });
          if (r.ok) {
            const html = await r.text();
            const meta = extractBookFromHtml(html, u);
            if (meta && meta.title) return meta;
          }
        } catch {}
      }
    }
  }
  if (pageUrl && /^https?:\/\//.test(pageUrl)) {
    try {
      const r = await fetch(pageUrl, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow' });
      if (r.ok) {
        const html = await r.text();
        const meta = extractBookFromHtml(html, pageUrl);
        if (meta && meta.title) return meta;
      }
    } catch {}
  }
  return null;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const isbn = (url.searchParams.get('isbn') || '').replace(/[^0-9Xx]/g, '');
    if (!isbn) return json({ found: false, error: 'isbn manquant' }, 400);
    // Route de diagnostic: montre ce que chaque source repond reellement
    if (url.searchParams.get('test') === '1') {
      lastDiag = '';
      const raw = await fetch('https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=' + encodeURIComponent(`bib.isbn all "${isbn}"`) + '&maximumRecords=1&recordSchema=dc').catch((e) => 'FETCH ERROR: ' + e.message);
      const rawText = typeof raw === 'string' ? raw : (raw.ok ? (await raw.text()).slice(0, 400) : 'HTTP ' + raw.status);
      const meta = await fetchBnfSru(isbn).catch((e) => 'ERR ' + e.message);
      return json({ diag: { bnfRawStatus: typeof raw === 'string' ? raw : 'HTTP ' + raw.status, bnfRawExcerpt: rawText, parsed: meta ? 'OK' : 'NULL', lastDiag }, fnac: await fetchFnac(isbn).catch(() => null) ? 'OK' : 'NULL' });
    }
    // Essai Fnac puis BnF en parallèle; on garde le meilleur résultat
    const [fnac, bnf] = await Promise.all([fetchFnac(isbn).catch(() => null), fetchBnfSru(isbn).catch(() => null)]);
    let meta = fnac || bnf || null;
    // Source editeur (la plus riche: resume officiel, collection exacte, couverture officielle)
    const pubHint = (meta && meta.publisher) || '';
    const pubMeta = await fetchPublisherSite(isbn, pubHint, url.searchParams.get('page'), meta && meta.title).catch(() => null);
    if (pubMeta) {
      meta = meta ? { ...meta,
        summary: pubMeta.summary || meta.summary || '',
        collection: pubMeta.collection || meta.collection || '',
        pages: meta.pages || pubMeta.pages || null,
        price: pubMeta.price || meta.price || null,
        cover: pubMeta.cover || meta.cover || '',
      } : pubMeta;
    }
    if (!meta) {
      // Dernier recours: Sudoc (academique/ancien) si BnF/Fnac/editeur n'ont rien
      const sudoc = await fetchSudoc(isbn).catch(() => null);
      if (sudoc) meta = sudoc;
    }
    // EAN non-livre (audio): MusicBrainz (open data) — CD/vinyles
    if (!meta && !/^(978|979)/.test(isbn)) {
      const mb = await fetchMusicBrainz(isbn).catch(() => null);
      if (mb) meta = mb;
    }
    // EAN non-livre (jeu de societe): BoardGameGeek (open data, sans cle)
    if (!meta && !/^(978|979)/.test(isbn)) {
      const bgg = await fetchBoardGameGeek(isbn).catch(() => null);
      if (bgg) meta = bgg;
    }
    if (!meta) return json({ found: false, isbn });
    if (fnac && bnf) {
      meta = { ...fnac,
        publisher: fnac.publisher || bnf.publisher,
        authors: fnac.authors.length ? fnac.authors : bnf.authors,
        summary: fnac.summary || bnf.summary,
        date: fnac.date || bnf.date,
        pages: fnac.pages || bnf.pages || null,
      };
    }
    return json({ found: true, isbn, ...meta });
  },
};
