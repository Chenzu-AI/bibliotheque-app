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
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
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
    let summary = '';
    const sumMatch = html.match(/Lire la suite"\s*([^"]{40,600})/) || html.match(/class="[^"]*Article-description[^"]*"[^>]*>([^<]{40,600})</);
    if (sumMatch) summary = sumMatch[1].replace(/\s+/g, ' ').trim();
    if (!title) return null;
    return { source: 'fnac', title, authors: authors.slice(0, 4), publisher, date, summary, cover: '' };
  } catch { return null; }
}

async function fetchBnfSru(isbn) {
  try {
    const q = `bib.persistentid all "isbn:${isbn}" or bib.persistentid all "${isbn}"`;
    const url = 'https://catalogue.bnf.fr/SRU?version=1.2&operation=searchRetrieve&query=' + encodeURIComponent(q) + '&maximumRecords=1&recordSchema=dc';
    const r = await fetch(url);
    if (!r.ok) return null;
    const xml = await r.text();
    const numMatch = xml.match(/<numberOfRecords>(\d+)<\/numberOfRecords>/);
    if (!numMatch || parseInt(numMatch[1], 10) === 0) return null;
    const title = (xml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/) || [])[1];
    if (!title) return null;
    const authors = [...xml.matchAll(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/g)].map((m) => m[1].trim());
    const publisher = (xml.match(/<dc:publisher[^>]*>([^<]+)<\/dc:publisher>/) || [])[1] || '';
    const date = (xml.match(/<dc:date[^>]*>([^<]{4})[\d-]*<\/dc:date>/) || [])[1] || '';
    return { source: 'bnf', title: title.trim(), authors: authors.slice(0, 4), publisher: publisher.trim(), date, summary: '', cover: '' };
  } catch { return null; }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const isbn = (url.searchParams.get('isbn') || '').replace(/[^0-9Xx]/g, '');
    if (!isbn) return json({ found: false, error: 'isbn manquant' }, 400);
    // Essai Fnac puis BnF en parallèle; on garde le meilleur résultat
    const [fnac, bnf] = await Promise.all([fetchFnac(isbn), fetchBnfSru(isbn)]);
    const meta = fnac || bnf || null;
    if (!meta) return json({ found: false, isbn });
    // fusion simple si les deux trouvent
    if (fnac && bnf) {
      meta.publisher = meta.publisher || bnf.publisher;
      meta.authors = meta.authors.length ? meta.authors : bnf.authors;
      meta.summary = meta.summary || bnf.summary;
    }
    return json({ found: true, isbn, ...meta });
  },
};
