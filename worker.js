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

async function fetchBnfSru(isbn) {
  try {
    const q = `bib.isbn all "${isbn}"`;
    const url = 'https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=' + encodeURIComponent(q) + '&maximumRecords=1&recordSchema=dublincore';
    const r = await fetch(url);
    if (!r.ok) return null;
    const xml = await r.text();
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

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const isbn = (url.searchParams.get('isbn') || '').replace(/[^0-9Xx]/g, '');
    if (!isbn) return json({ found: false, error: 'isbn manquant' }, 400);
    // Essai Fnac puis BnF en parallèle; on garde le meilleur résultat
    const [fnac, bnf] = await Promise.all([fetchFnac(isbn).catch(() => null), fetchBnfSru(isbn).catch(() => null)]);
    let meta = fnac || bnf || null;
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
