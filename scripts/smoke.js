/* Test de fumée — vérifications critiques avant tout déploiement.
   Usage: node scripts/smoke.js  (exit 1 si échec)
   Exécuté par .github/workflows/smoke.yml à chaque push. */
const fs = require('fs');
const path = require('path');
const acorn = require('./smoke-node_modules/acorn');

let failures = 0;
const fail = (msg) => { failures++; console.error('  ❌ ' + msg); };
const ok = (msg) => console.log('  ✅ ' + msg);

const root = path.join(__dirname, '..');

/* 1. Syntaxe JS (parse complet = attrape backticks cassés, parenthèses, etc.) */
console.log('[1] Syntaxe JavaScript');
for (const f of ['app.js', 'i18n.js', 'sw.js']) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  try {
    acorn.parse(src, { ecmaVersion: 'latest' });
    ok(f + ' parse OK');
  } catch (e) {
    fail(f + ' ERREUR SYNTAXE ' + e.loc.line + ':' + e.loc.column + ' — ' + e.message);
  }
}

/* 2. Fonctions critiques présentes (le bug fetchRelay ne reviendra plus) */
console.log('[2] Fonctions critiques présentes');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
for (const fn of ['fetchRelay', 'lookupAndMaybeAdd', 'renderAll', 'fetchMetadataSmart', 'openDetail', 'store']) {
  const re = new RegExp('(async )?function ' + fn + '\\b|(const|let|var) ' + fn + '\\b');
  if (re.test(app)) ok(fn); else fail('fonction manquante: ' + fn + ' (scan/UI cassée)');
}
/* chaque fonction appelée fetchXxx doit être définie (on retire les lignes de commentaire) */
const appCode = app.split('\n').filter(l => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n');
const called = [...appCode.matchAll(/(?<![a-zA-Z_$.])((?:fetch|render)[A-Za-z0-9]+)\s*\(/g)].map(m => m[1]);
const defined = [...app.matchAll(/(?:async )?function ([A-Za-z0-9]+)/g)].map(m => m[1]);
const missing = [...new Set(called.filter(f => !defined.includes(f)))];
if (missing.length) fail('fonctions appelées mais non définies: ' + missing.join(', '));
else ok('toutes les fonctions fetch*/render* appelées sont définies');

/* 3. i18n : parité FR/EN + clés utilisées existantes */
console.log('[3] Internationalisation FR/EN');
const i18nSrc = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
let I18N, MSGS;
try {
  const stub = "const navigator = { language: 'fr' }; const localStorage = { getItem: () => null, setItem: () => {} }; const document = { querySelectorAll: () => [], documentElement: { setAttribute: () => {} } };\n";
  ({ I18N, MSGS } = new Function(stub + i18nSrc + '; return { I18N, MSGS };')());
} catch (e) {
  fail('i18n.js ne s\'évalue pas: ' + e.message); I18N = { fr: {}, en: {} }; MSGS = {};
}
const kf = Object.keys(I18N.fr), ke = Object.keys(I18N.en);
if (kf.length === ke.length) ok('parité ' + kf.length + '/' + ke.length + ' clés');
else fail('parité FR(' + kf.length + ') != EN(' + ke.length + ') — manquants EN: ' + kf.filter(k => !(k in I18N.en)).slice(0, 8).join(', '));
for (const d of [['data-i18n', [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/data-i18n="([a-z_0-9]+)"/g)].map(m => m[1]), I18N.fr],
                 ['t()', [...app.matchAll(/(?<![a-zA-Z_.])t\('([a-z_0-9]+)'\)/g)].map(m => m[1]), I18N.fr],
                 ['tm()', [...app.matchAll(/(?<![a-zA-Z_.])tm\('([a-z_0-9]+)'\)/g)].map(m => m[1]), MSGS]]) {
  const miss = [...new Set(d[1].filter(k => !(k in d[2])))];
  if (miss.length) fail(d[0] + ' clés manquantes: ' + miss.slice(0, 8).join(', '));
  else ok(d[0] + ' : toutes les clés existent (' + new Set(d[1]).size + ' clés)');
}

/* 4. Pas de concat cassé dans les template literals (le bug sweep d'octobre) */
console.log('[4] Template literals sains');
const tree = acorn.parse(app, { ecmaVersion: 'latest', ranges: true });
const quasis = [];
(function walk(n) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'TemplateElement') quasis.push([n.range[0], n.range[1]]);
  for (const k in n) { const v = n[k];
    if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
})(tree);
let broken = 0;
for (const [a, b] of quasis) {
  const seg = app.slice(a, b);
  if (/' \+ (?:t|tm)\(/.test(seg)) { broken++; fail('concat cassé dans template literal (~ligne ' + app.slice(0, a).split('\n').length + ')'); }
}
if (!broken) ok('zéro concat cassé');

/* 4bis. Accessibilité : boutons icônes avec aria-label ou titre */
console.log('[4bis] Accessibilité (boutons)');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const buttons = [...htmlSrc.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
const iconOnly = buttons.filter(([, inner]) => inner.replace(/[\u2190-\u2BFF\u{1F000}-\u{1FAFF}\u2715\u2630\u2753\u2b07\u2601]/gu, '').trim().length < 3);
const noLabel = iconOnly.filter(([attrs]) => !/aria-label=|title=/.test(attrs));
if (noLabel.length) { console.log('  ⚠️  ' + noLabel.length + ' bouton(s) icône sans aria-label ni title:'); noLabel.slice(0, 5).forEach(([attrs]) => console.log('     ' + attrs.slice(0, 90))); }
else ok('tous les boutons icônes ont un aria-label ou title');

/* 4ter. Parité documentation FR/EN + site */
console.log('[4ter] Documentation bilingue (docs + site)');
const docPairs = [
  ['docs/1-INSTALLATION-PC.md', 'docs/en/1-INSTALLATION-PC.md'],
  ['docs/2-INSTALLATION-MOBILE.md', 'docs/en/2-INSTALLATION-MOBILE.md'],
  ['docs/3-FONCTIONNALITES.md', 'docs/en/3-FEATURES.md'],
  ['docs/4-MANUEL.md', 'docs/en/4-MANUAL.md'],
  ['docs/5-MODE-D-EMPLOI-SYNTHESE.md', 'docs/en/5-QUICK-REFERENCE.md'],
];
for (const [fr, en] of docPairs) {
  const frOk = fs.existsSync(path.join(root, fr));
  const enOk = fs.existsSync(path.join(root, en));
  if (frOk && enOk) {
    const frAge = fs.statSync(path.join(root, fr)).mtimeMs;
    const enAge = fs.statSync(path.join(root, en)).mtimeMs;
    if (enAge < frAge - 60000) fail('doc EN plus ancienne que FR: ' + en + ' — traduire la mise à jour');
    else ok(fr.split("/")[1].slice(0, 12) + ' : FR+EN à jour');
  } else fail((!frOk ? 'manque ' + fr : '') + (!enOk ? ' manque ' + en : ''));
}
for (const f of ['public.html', 'pro.html']) {
  const frOk = fs.existsSync(path.join(root, 'site', f));
  const enOk = fs.existsSync(path.join(root, 'site', 'en', f));
  if (frOk && enOk) {
    const frAge = fs.statSync(path.join(root, 'site', f)).mtimeMs;
    const enAge = fs.statSync(path.join(root, 'site', 'en', f)).mtimeMs;
    if (enAge < frAge - 60000) fail('site EN plus ancien que FR: site/en/' + f + ' — traduire la mise à jour');
    else ok('site/' + f + ' : FR+EN à jour');
  } else fail((!frOk ? 'manque site/' + f : '') + (!enOk ? ' manque site/en/' + f : ''));
}

/* 4quater. Sécurité miroir: les fichiers de données doivent être exclus du sync public */
console.log('[4quater] Sécurité miroir (données jamais publiées)');
const syncWf = fs.readFileSync(path.join(root, '.github/workflows/sync-mirror.yml'), 'utf8');
const mustExclude = [
  'Bibliotheque_memoire.md',
  'Bibliotheque_mémoire.md',
  'MEMOIRE-SESSION.md',
  'docs/LIMITES-VERSIONS.md',
  'bibliotheque-sauvegarde.json',
  'covers/fiches',
  'pro',
];
for (const f of mustExclude) {
  if (syncWf.includes(f)) ok('exclusion miroir: ' + f);
  else fail('SECURITE — fichier de données NON exclu du miroir public: ' + f + ' → ajouter git rm --cached dans sync-mirror.yml');
}

/* 4quinquies. Anti-régression UI: mécanismes critiques réellement présents ET branchés
   (né de l'incident du 30/10: remplacements de texte ratés poussés sans vérification du branchement) */
console.log('[4quinquies] Anti-régression UI (langue + handlers critiques)');
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const i18nSrc = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
  const inlineLang = (html.match(/onclick="[^"]*__toggleLang\(\)/g) || []).length;
  if (inlineLang >= 2) ok('bascule langue: ' + inlineLang + ' onclick inline (barre + menu)');
  else fail('BASCULE LANGUE: onclick inline absents du HTML (' + inlineLang + ' attendus >=2) — incident du 30/10');
  if (/__toggleLang\s*=/.test(i18nSrc)) ok('__toggleLang défini (i18n.js)');
  else fail('__toggleLang introuvable dans i18n.js');
  const critical = ['btnScan', 'btnHelp', 'btnMenu', 'btnSaveDetail', 'btnShelfAnalyze', 'btnQrLabels'];
  for (const b of critical) {
    if (appSrc.includes("$('#" + b + "')")) ok('handler ' + b + ' attaché');
    else fail('HANDLER CRITIQUE PERDU: ' + b);
  }
  // champs photo branchés au prompt
  if (appSrc.includes('booksPerRowHint}') && appSrc.includes('flatHint}')) ok('hints photo injectés dans le prompt');
  else fail('HINTS PHOTO NON BRANCHÉS (livres/rangée ou à plat)');
  // prompt piles complet
  if (appSrc.includes('PLUSIEURS PILES')) ok('règle plusieurs piles présente');
  else fail('règle plusieurs piles absente du prompt');
  // œuvres liées: champ univers + relations typées + bidirectionnel + recherche
  if (appSrc.includes('f_universe') && appSrc.includes('f_related_title')) ok('fiche: univers + œuvres liées');
  else fail('CHAMP UNIVERS/ŒUVRES LIÉES perdus de la fiche');
  if (appSrc.includes('REL_INVERSE') && appSrc.includes('function allRelated')) ok('liens bidirectionnels (inverses calculés)');
  else fail('BIDIRECTIONNEL perdu (REL_INVERSE/allRelated)');
  const relTypes = ['prequel','sequel','previous','next','spinoff','universe','adaptation','cycle','analysis','artbook','translation'];
  const missingRel = relTypes.filter((r) => !i18nSrc.includes('rel_' + r));
  if (!missingRel.length) ok('11 types de relations i18n (FR+EN)');
  else fail('TYPES DE RELATIONS i18n MANQUANTS: ' + missingRel.join(', '));
  if (appSrc.includes("groupMode === 'universe'")) ok('onglet/groupement par univers');
  else fail('GROUPEMENT PAR UNIVERS perdu');
  // multimédia: types + scan EAN + MusicBrainz + filtre
  const mediums = ['film','series','music','game'];
  const missingMed = mediums.filter((m) => !html.includes('value="' + m + '"'));
  if (!missingMed.length) ok('types multimédia dans la fiche (film/série/musique/jeu)');
  else fail('TYPES MULTIMÉDIA PERDUS DU SELECT: ' + missingMed.join(', '));
  if (appSrc.includes('isBookEan') && appSrc.includes('upcToEan13')) ok('scan EAN non-livre + normalisation UPC->EAN13');
  else fail('SCAN MULTIMÉDIA perdu (isBookEan/upcToEan13)');
  if (html.includes('id="mediumFilter"') && appSrc.includes('medium ===')) ok('filtre par support branché');
  else fail('FILTRE PAR SUPPORT perdu/non branché');
  const wk = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
  if (wk.includes('fetchMusicBrainz') && wk.includes('coverartarchive')) ok('worker: MusicBrainz + pochettes Cover Art Archive');
  else fail('WORKER MULTIMÉDIA perdu (MusicBrainz/CoverArtArchive)');
  // QR & douchette: étiquettes (choix champ + lot), scan caméra (UPC-12), beep, doublon multimédia
  if (appSrc.includes('qr_field_prompt') && appSrc.includes('qr_scope_prompt')) ok('étiquettes QR: choix du champ + choix du lot');
  else fail('ÉTIQUETTES QR: choix champ/lot perdus');
  if (/\[0-9\]\{13\}|\^\[0-9\]\{12\}\$/.test(appSrc) && appSrc.includes('upcToEan13')) ok('scan caméra: EAN-13 + UPC-12 acceptés');
  else fail('SCAN CAMÉRA: UPC-12 non accepté');
  if (appSrc.includes('function scanBeep') && appSrc.includes('scanBeep(true)')) ok('bip de scan (succès + échec)');
  else fail('BIP DE SCAN perdu');
  if (appSrc.includes('function showDupModal')) ok('modale doublon unifiée (livres + multimédia)');
  else fail('MODALE DOUBLON unifiée perdue');
  // dispersion: alerte scan + rapport + regroupement
  if (appSrc.includes('function checkSeriesScatter') && appSrc.includes('scatter_regroup')) ok('alerte dispersion au scan + regroupement');
  else fail('ALERTE DISPERSION/regroupement perdus');
  if (appSrc.includes('function scatterReport') && appSrc.includes('runScatterReport')) ok('rapport des séries dispersées');
  else fail('RAPPORT DISPERSION perdu');
  // cache reconnaissance + Sudoc
  if (appSrc.includes('metaCacheGet') && appSrc.includes('META_CACHE_TTL')) ok('cache local reconnaissance (30 j)');
  else fail('CACHE RECONNAISSANCE perdu');
  if (wk.includes('fetchSudoc')) ok('worker: Sudoc en dernier recours');
  else fail('SUDOC perdu du worker');
  // fonctions APPELÉES doivent être DÉFINIES (analyse photo = crash silencieux du 30/10)
  const calledButMaybeUndefined = ['analyzeSeriesPositions', 'showDupModal', 'scanBeep', 'metaCacheGet', 'upcToEan13', 'allRelated', 'scatterReport'];
  for (const fn of calledButMaybeUndefined) {
    const calls = (appSrc.match(new RegExp('(?<!function )' + fn + '\\(', 'g')) || []).length;
    const def = appSrc.includes('function ' + fn) || appSrc.includes('const ' + fn + ' =') || appSrc.includes(fn + ' = function');
    if (def && calls > 0) ok('fonction ' + fn + ' définie ET appelée (' + calls + 'x)');
    else if (!def && calls > 0) fail('FONCTION APPELÉE MAIS JAMAIS DÉFINIE: ' + fn + ' (crash à l\u0027exécution!)');
    else ok('fonction ' + fn + ' présente');
  }
  // ANTI-ID-DUPLIQUÉ: un id présent dans le HTML statique NE DOIT PAS être régénéré dans app.js
  // (incident du 30/10: btnAiFill existait aux deux endroits — le handler s'attachait au mauvais, bouton mort)
  const dynIds = [...appSrc.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]);
  const staticIds = [...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]);
  const dupl = dynIds.filter((id, i) => staticIds.includes(id) && dynIds.indexOf(id) === i);
  if (!dupl.length) ok('aucun id dupliqué HTML/JS');
  else fail('IDS DUPLIQUÉS (boutons morts!): ' + dupl.join(', '));
  // CSS: le bloc .modal doit contenir background ET display (incident du 30/10: insertion z-index avait rendu les proprietes orphelines -> modales transparentes)
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const modalBlock = css.match(/\.modal \{[^}]*\}/);
  if (modalBlock && modalBlock[0].includes('background') && modalBlock[0].includes('display: flex')) ok('CSS .modal complet (fond + centrage)');
  else fail('CSS .modal CASSE — background ou display manquant (modales transparentes!)');
  if (/#scanModal \{ z-index: 60; \}/.test(css)) ok('CSS scanModal z-index séparé');
  else fail('CSS scanModal z-index absent ou mal placé');
  // create-blanks: le garde doit etre par POSITION (photoPos), pas par emplacement (bug 1-fiche-par-rangée du 30/10)
  if (appSrc.includes('it.photoPos') && appSrc.includes("String(it.photoPos || '') === String(u.pos || '')")) ok('create-blanks: garde par position photo (44 fiches possibles)');
  else fail('CREATE-BLANKS: garde anti-doublon imprécis — vérifier photoPos!');
  // scan-complete: le mode doit exister (target + fonction)
  if (appSrc.includes('__scanCompleteTargetId') && appSrc.includes('function completeBlankWithScan')) ok('scan-pour-compléter branché (target + fonction)');
  else fail('SCAN-COMPLÉTER non branché!');
  // menu refermé universellement
  if (appSrc.includes("$('#mainNav').addEventListener('click'")) ok('règle universelle fermeture menu');
  else fail('RÈGLE FERMETURE MENU absente!');
}

/* 5. Fuites FR visibles côté EN (chaînes codées en dur dans les vues) */
console.log('[5] Fuites françaises en mode EN (statique)');
const frRe = /[éèêàçùâîôûÉÈÊÀÇÙÂÎÔÛ]|«|»/;
const literals = [];
(function walk2(n) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'Literal' && typeof n.value === 'string') literals.push([n.range[0], n.value]);
  for (const k in n) { const v = n[k];
    if (Array.isArray(v)) v.forEach(walk2); else if (v && typeof v.type === 'string') walk2(v); }
})(tree);
let leaks = [];
for (const [pos, v] of literals) {
  if (!frRe.test(v)) continue;
  const ctx = app.slice(Math.max(0, pos - 250), pos + 250);
  const bilingual = /LANG\s*===\s*'en'/.test(ctx) || /t\('/.test(ctx) || /tm\('/.test(ctx);
  if (!bilingual) leaks.push({ line: app.slice(0, pos).split('\n').length, v: v.slice(0, 50) });
}
if (leaks.length) { console.log('  ⚠️  ' + leaks.length + ' chaînes FR non traduites (aperçu):'); leaks.slice(0, 10).forEach(l => console.log('     L' + l.line + ': ' + JSON.stringify(l.v))); }
else ok('zéro fuite FR statique');

console.log('');
if (failures) { console.error('ÉCHEC: ' + failures + ' problème(s)'); process.exit(1); }
console.log('FUMÉE OK — toutes les vérifications passent');
