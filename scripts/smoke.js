/* Test de fumée — vérifications critiques avant tout déploiement.
   Usage: node scripts/smoke.js  (exit 1 si échec)
   Exécuté par .github/workflows/smoke.yml à chaque push. */
const fs = require('fs');
const path = require('path');
const acorn = require('./smoke-node_modules/acorn');

let failures = 0;
const fail = (msg) => { failures++; console.error('  ❌ ' + msg); };
let oks = 0;
const ok = (msg) => { oks++; console.log('  ✅ ' + msg); };

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
const cssSrc = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
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
  // rendu incassable: une fiche sans authors ne doit jamais casser la grille
  if (appSrc.includes("(it.authors || []).join(")) ok('rendu grille robuste (authors undefined)');
  else fail('RENDU GRILLE fragile — authors.join sur undefined peut casser toute la grille!');
  // fiches multimédia créées avec authors
  if (/store\.add\(\{ isbn, title: 'EAN ' \+ isbn, authors: \[\]/.test(appSrc)) ok('fiches multimédia avec authors:[]');
  else fail('FICHES MULTIMÉDIA sans authors — risque de grille cassée!');
  // normalisation content vision (Mistral renvoie un tableau de chunks)
  if (appSrc.includes("Array.isArray(raw)")) ok('normalisation réponse vision (content tableau)');
  else fail('NORMALISATION VISION absente — Mistral vision renvoie un tableau!');
  // fallback max_tokens
  if (appSrc.includes("callVision(4096)")) ok('fallback max_tokens 4096');
  else fail('FALLBACK MAX_TOKENS absent!');
  // garde anti-doublon scan douchette
  if (appSrc.includes('__shelfScanBusy')) ok('garde anti-doublon scan (busy-flag)');
  else fail('GARDE ANTI-DOUBLON SCAN absente!');
  // 2 modèles IA (vision + texte)
  if (appSrc.includes('function aiTextModel()')) ok('architecture 2 modèles IA (vision/texte)');
  else fail('MODÈLE TEXTE dédié absent!');
  if (appSrc.includes('aiTextModel()')) ok('aiChat utilise le modèle texte');
  else fail('aiChat n utilise pas le modèle texte!');
  // mapping medium robuste (synonymes IA)
  if (appSrc.includes('mediumMap')) ok('mapping support IA (28 synonymes)');
  else fail('MAPPING SUPPORT IA absent!');
  // déclencheur needsMedium (reclassification)
  if (appSrc.includes('needsMedium')) ok('déclencheur reclassification support');
  else fail('DÉCLENCHEUR NEEDSMEDIUM absent!');
  // séries: seriesTotal/seriesState par IA
  if (appSrc.includes("changed.push('seriesTotal')")) ok('IA remplit seriesTotal/seriesState');
  else fail('SÉRIES IA (total/état) absent!');
  // instruction classification: déduction sans recopie (anti-biais)
  if (appSrc.includes('ne recopie JAMAIS')) ok('instruction classification anti-biais (dédue, ne recopie pas)');
  else fail('INSTRUCTION CLASSIFICATION absente!');
  // TMDB + IGDB (retrieval-constrained, sources de référence)
  if (appSrc.includes('fetchTmdbByTitle')) ok('TMDB intégré (films/séries)');
  else fail('TMDB ABSENT!');
  if (appSrc.includes('fetchIgdbByTitle')) ok('IGDB intégré (jeux vidéo)');
  else fail('IGDB ABSENT!');
  // provenance par champ + note IA
  if (appSrc.includes('fieldSources')) ok('provenance par champ (traçabilité)');
  else fail('PROVENANCE PAR CHAMP absente!');
  if (appSrc.includes('aiAssisted')) ok('note de transparence IA');
  else fail('NOTE TRANSPARENCE absente!');
  // champs_manquants (anti-hallucination)
  if (appSrc.includes('champs_manquants')) ok('champs_manquants (null explicites)');
  else fail('CHAMPS_MANQUANTS absent!');
  // null-string IA («null» en texte au lieu du JSON null)
  if (appSrc.includes('isNullStr')) ok('filtre null-string IA');
  else fail('FILTRE NULL-STRING absent!');
  // correspondance TMDB floue (Rogue One vs Rogue One: A Star Wars Story)
  if (appSrc.includes('tmdbMatch') && appSrc.includes('includes(b)')) ok('correspondance TMDB floue');
  else fail('CORRESPONDANCE TMDB stricte — films au titre partiel rejetés!');
  // œuvre non identifiée jamais générée (titre EAN/ISBN placeholder)
  if (appSrc.includes('isUnidentified')) ok('œuvre non identifiée jamais générée (garde étape 2)');
  else fail('GARDE ŒUVRE NON IDENTIFIÉE absente!');
  if (appSrc.includes('isPlaceholderTitle')) ok('titre placeholder jamais accepté');
  else fail('TITRE PLACEHOLDER accepté en remplacement!');
  // résumés méta rejetés (étape 2 incluse)
  if (appSrc.includes('metaWords2')) ok('anti-résumé-méta étape 2');
  else fail('ANTI-RÉSUMÉ-MÉTA étape 2 absent!');
  // scan pendant fiche ouverte → nouvelle fiche proposée
  if (appSrc.includes('scan_new_while_open')) ok('scan pendant fiche ouverte (nouvelle fiche proposée)');
  else fail('SCAN PENDANT FICHE OUVERTE non gardé!');
  // aperçu couverture en direct
  if (appSrc.includes('__livePrev')) ok('aperçu couverture en direct');
  else fail('APERÇU LIVE absent!');
  // métrique d'acceptation
  if (appSrc.includes('acceptanceRate')) ok('métrique d\u0027acceptation (qualité catalogage)');
  else fail('MÉTRIQUE ACCEPTATION absente!');
  // version pipeline IA tracée
  if (appSrc.includes('aiPipelineVersion')) ok('version pipeline IA tracée');
  else fail('VERSION PIPELINE absente!');
  // garde scan-pendant-fiche (buffer ISBN formulaire)
  if (appSrc.includes('__formScanBuf')) ok('garde scan ISBN formulaire');
  else fail('GARDE SCAN FORMULAIRE absent!');
  // croix anti-perte: inputs file exclus du snapshot (faux positifs)
  if (appSrc.includes("el.type !== 'file'")) ok('croix anti-perte: inputs file exclus (pas de faux positif)');
  else fail('SNAPSHOT CROIX inclut les inputs file!');
  // diagnostic du champ modifié dans la question de fermeture
  if (appSrc.includes('__detailFormFields')) ok('croix: champ modifié nommé dans la question');
  else fail('DIAGNOSTIC CHAMP CROIX absent!');
  // auto-sync GitHub seulement si changement (hash)
  if (appSrc.includes('__lastSyncHash')) ok('auto-sync GitHub seulement si données changées (hash)');
  else fail('AUTO-SYNC pousse sans condition!');
  // TMDB: ponctuation ignorée + secours anglais
  if (appSrc.includes("replace(/[^a-z0-9]/g, '')")) ok('correspondance titres insensible à la ponctuation');
  else fail('CORRESPONDANCE PONCTUATION absente!');
  if (appSrc.includes("'en-US'")) ok('TMDB: secours recherche anglaise');
  else fail('TMDB SECOURS EN absent!');
  // diagnostic toast avec modèle IA
  if (appSrc.includes('cfgInfo')) ok('toast diagnostic avec modèle IA affiché');
  else fail('DIAGNOSTIC MODÈLE IA absent!');
  // capteur d'erreurs global (plus jamais de code mort silencieux)
  if (appSrc.includes("window.addEventListener('error'")) ok('capteur d\u0027erreurs global (toast)');
  else fail('CAPTEUR ERREURS GLOBAL absent!');
  // boutons IA jamais désactivés + guidage titre
  if (appSrc.includes('ai_need_title')) ok('bouton IA toujours actif + guidage titre');
  else fail('BOUTON IA désactivé sans guidage!');
  // pas de variable non définie dans openDetail (formEl bug)
  if (!appSrc.includes("const isbnField = formEl ?")) ok('formEl défini (plus de ReferenceError openDetail)');
  else fail('FORMEL NON DÉFINI — ReferenceError à chaque ouverture de fiche!');
  // tous les IDs référencés existent (audit HTML)
  if (htmlSrc.includes('id="btnMarc21"')) ok('btnMarc21 présent dans le HTML');
  else fail('BTNMARC21 MANQUANT — null.addEventListener au chargement!');
  // store.add retourne l'item (les flux multimédia utilisent media.id)
    if (/add\(item\) \{[\s\S]{0,400}return item;/.test(appSrc)) ok('store.add retourne l\u2019item (avec garde anti-collision)');
  // blocs openDetail protégés (une exception ne tue plus les handlers suivants)
  if (appSrc.includes("catch (eL) { console.warn('log-detail'")) ok('blocs openDetail protégés individuellement');
  else fail('BLOCS OPENDETAIL non protégés!');
  // aucun ID référencé manquant dans le HTML (audit complet)
  if (appSrc.includes("btnMarc21") && htmlSrc.includes('btnMarc21')) ok('audit IDs HTML complet');
  else fail('AUDIT IDs HTML incomplet!');
  // référentiel multimédia 4 axes (types/supports/éditions)
  if (appSrc.includes('MEDIA_TYPES') && appSrc.includes('CARRIERS') && appSrc.includes('EDITIONS')) ok('référentiel multimédia (types+supports+éditions)');
  else fail('RÉFÉRENTIEL MULTIMÉDIA absent!');
  if (appSrc.includes('name="mediaSubtype"') && appSrc.includes('name="carrier"')) ok('champs type détaillé + support dans la fiche');
  else fail('CHAMPS TYPE/SUPPORT absents du formulaire!');
  if (appSrc.includes('blu-ray-uhd') && appSrc.includes('vhs')) ok('supports: VHS → Blu-ray 4K UHD présents');
  else fail('SUPPORTS incomplets!');
  if (appSrc.includes('coffret-int') && appSrc.includes('anniversaire') && appSrc.includes('directors-cut')) ok('éditions étendues (coffret/anniversaire/director\u0027s cut)');
  else fail('ÉDITIONS ÉTENDUES absentes!');
  if (appSrc.includes('GAME_GENRES') && appSrc.includes('PLATFORMS') && appSrc.includes('GAME_MODES')) ok('référentiel jeux vidéo (genres+plateformes+modes)');
  else fail('RÉFÉRENTIEL JV absent!');
  if (appSrc.includes('rpg-j') && appSrc.includes('str-4x') && appSrc.includes('surv-hor')) ok('genres JV OLAC (JRPG, 4X, survival horror)');
  else fail('GENRES JV incomplets!');
  if (appSrc.includes('SUBTYPE_LISTS') && appSrc.includes('GAME_GENRES')) ok('listes contextuelles (jeux/manga/médias — via table)');
  else fail('LISTE CONTEXTUELLE absente!');
  if (appSrc.includes('PS5') && appSrc.includes('NSW') && appSrc.includes('Dreamcast')) ok('plateformes (PS5, Switch, rétro)');
  else fail('PLATEFORMES incomplètes!');
  if (appSrc.includes('goty') && appSrc.includes('remake') && appSrc.includes('day-one')) ok('éditions JV (GOTY, remake, day one)');
  else fail('ÉDITIONS JV absentes!');
  if (appSrc.includes('name="platform"') && appSrc.includes('name="gameMode"')) ok('champs plateforme + mode dans la fiche');
  else fail('CHAMPS PLATEFORME/MODE absents!');
  if (appSrc.includes('name="audience"') && appSrc.includes('<select name="audience"')) ok('public: liste déroulante');
  else fail('PUBLIC encore en champ texte!');
  if (appSrc.includes('name="zone"') && appSrc.includes('name="audioVersion"') && appSrc.includes('name="imageFormat"') && appSrc.includes('name="country"')) ok('facettes zone/audio/format/pays en listes');
  else fail('FACETTES absentes ou en texte!');
  if (appSrc.includes('MANGA_DEMOS') && appSrc.includes('MANGA_GENRES') && appSrc.includes('MANGA_FORMATS')) ok('référentiel manga (démographie+genres+formats)');
  else fail('RÉFÉRENTIEL MANGA absent!');
  if (appSrc.includes('shonen') && appSrc.includes('seinen') && appSrc.includes('josei')) ok('démographies manga (shonen/seinen/josei)');
  else fail('DÉMOGRAPHIES MANGA incomplètes!');
  if (appSrc.includes('tankobon') && appSrc.includes('kanzenban') && appSrc.includes('webtoon')) ok('formats éditoriaux japonais (tankobon/kanzenban/webtoon)');
  else fail('FORMATS MANGA incomplets!');
  if (appSrc.includes('manga: MANGA_DEMOS') && appSrc.includes('manga: MANGA_FORMATS')) ok('listes contextuelles manga (table)');
  else fail('CONTEXTUEL MANGA absent!');
  if (appSrc.includes('poche') && appSrc.includes('perfect') && appSrc.includes('reedition')) ok('éditions manga (poche/perfect/réédition)');
  else fail('ÉDITIONS MANGA absentes!');
  if (appSrc.includes('name="readingDirection"') && appSrc.includes('droite')) ok('sens de lecture (JPN/FR)');
  else fail('SENS DE LECTURE absent!');
  if (appSrc.includes('BD_FAMILIES') && appSrc.includes('BD_GENRES') && appSrc.includes('BD_FORMATS')) ok('référentiel BD (familles+genres+formats)');
  else fail('RÉFÉRENTIEL BD absent!');
  if (appSrc.includes('bd-fb') && appSrc.includes('bd-rg') && appSrc.includes('bd-com')) ok('familles éditoriales BD (franco-belge/roman graphique/comics)');
  else fail('FAMILLES BD incomplètes!');
  if (appSrc.includes('alb-car') && appSrc.includes('comic-book') && appSrc.includes('tpb')) ok('formats BD (album cartonné/comic book/TPB)');
  else fail('FORMATS BD incomplets!');
  if (appSrc.includes('comic: BD_FAMILIES') && appSrc.includes('bd: BD_FORMATS')) ok('listes contextuelles BD (table)');
  else fail('CONTEXTUEL BD absent!');
  if (appSrc.includes('int-col') && appSrc.includes('luxe')) ok('éditions BD (intégrale collector/luxe)');
  else fail('ÉDITIONS BD absentes!');
  if (appSrc.includes('FB') && appSrc.includes("Comics US")) ok('sens de lecture FB/US (traditions BD)');
  else fail('SENS FB/US absent!');
  if (appSrc.includes('PRESS_TYPES') && appSrc.includes('PRESS_PERIODICITIES') && appSrc.includes('PRESS_FORMATS')) ok('référentiel presse (natures+périodicités+formats)');
  else fail('RÉFÉRENTIEL PRESSE absent!');
  if (appSrc.includes('quotidien') && appSrc.includes('hebdomadaire') && appSrc.includes('magazine')) ok('natures éditoriales presse');
  else fail('NATURES PRESSE incomplètes!');
  if (appSrc.includes('berliner') && appSrc.includes('tabloid') && appSrc.includes('microfilm')) ok('formats presse (berlinois/tabloïd/microfilm)');
  else fail('FORMATS PRESSE incomplets!');
  if (appSrc.includes('name="periodicity"') && appSrc.includes('name="collectionState"')) ok('champs périodicité + état de collection');
  else fail('CHAMPS PRESSE absents!');
  if (appSrc.includes('en-cours') && appSrc.includes('pilon')) ok('états de collection (en cours → pilon)');
  else fail('ÉTATS COLLECTION absents!');
  if (appSrc.includes('value="press"')) ok('medium presse dans le select');
  else fail('MEDIUM PRESSE absent!');
  if (appSrc.includes('abonnement') && appSrc.includes('regionale')) ok('éditions presse (abonnés/régionale)');
  else fail('ÉDITIONS PRESSE absentes!');
  if (appSrc.includes('BOOK_FAMILIES') && appSrc.includes('BOOK_GENRES') && appSrc.includes('BOOK_FORMATS')) ok('référentiel livre (familles+genres+formats)');
  else fail('RÉFÉRENTIEL LIVRE absent!');
  if (appSrc.includes('roman') && appSrc.includes('essai') && appSrc.includes('beau-livre')) ok('familles éditoriales livre (roman/essai/beau-livre)');
  else fail('FAMILLES LIVRE incomplètes!');
  if (appSrc.includes('broche') && appSrc.includes('poche-livre') && appSrc.includes('epub')) ok('formats livre (broché/poche/EPUB)');
  else fail('FORMATS LIVRE incomplets!');
  if (appSrc.includes('book: BOOK_FAMILIES') && appSrc.includes('book: BOOK_FORMATS')) ok('listes contextuelles livre (table)');
  else fail('CONTEXTUEL LIVRE absent!');
  if (appSrc.includes('integrale')) ok('édition intégrale (série en 1 volume)');
  else fail('ÉDITION INTÉGRALE absente!');
  if (appSrc.includes('audio') && appSrc.includes('mobi')) ok('formats numériques livre (audio/Kindle)');
  else fail('NUMÉRIQUE LIVRE absent!');
  if (appSrc.includes('SERIES_FAMILIES') && appSrc.includes('SERIES_GENRES') && appSrc.includes('SERIES_FORMATS')) ok('référentiel séries (familles+genres+formats)');
  else fail('RÉFÉRENTIEL SÉRIES absent!');
  if (appSrc.includes('ser-fic') && appSrc.includes('ser-an-jp') && appSrc.includes('ser-min')) ok('familles séries (fiction/anime/mini-série)');
  else fail('FAMILLES SÉRIES incomplètes!');
  if (appSrc.includes('cof-dvd') && appSrc.includes('catchup') && appSrc.includes('streaming')) ok('formats séries (coffrets/catch-up/SVOD)');
  else fail('FORMATS SÉRIES incomplets!');
  if (appSrc.includes('name="seasonsCount"') && appSrc.includes('name="episodesCount"') && appSrc.includes('name="channel"')) ok('champs saisons/épisodes/chaîne');
  else fail('CHAMPS SÉRIES absents!');
  if (appSrc.includes('series: SERIES_FAMILIES') && appSrc.includes('series: SERIES_FORMATS')) ok('listes contextuelles séries (table)');
  else fail('CONTEXTUEL SÉRIES absent!');
  if (appSrc.includes('saison')) ok('édition saison (série TV)');
  else fail('ÉDITION SAISON absente!');
  if (appSrc.includes('jud') && appSrc.includes('med') && appSrc.includes('spo')) ok('genres séries (judiciaire/médical/sport)');
  else fail('GENRES SÉRIES incomplets!');
  if (appSrc.includes('MUSIC_CLASSES') && appSrc.includes('MUSIC_FORMATS')) ok('référentiel musique (classes PCDM+formats)');
  else fail('RÉFÉRENTIEL MUSIQUE absent!');
  if (appSrc.includes('PCDM 1.3') && appSrc.includes('PCDM 3.24') && appSrc.includes('PCDM 8')) ok('classes PCDM (jazz/symphonie/chanson FR)');
  else fail('CLASSES PCDM incomplètes!');
  if (appSrc.includes('sacd') && appSrc.includes('minidisc') && appSrc.includes('bobine')) ok('formats musique (SACD/MiniDisc/bobine)');
  else fail('FORMATS MUSIQUE incomplets!');
  if (appSrc.includes('name="formation"') && appSrc.includes('name="instrument"')) ok('champs formation + instrument');
  else fail('CHAMPS MUSIQUE absents!');
  if (appSrc.includes('music: MUSIC_CLASSES') && appSrc.includes('music: MUSIC_FORMATS')) ok('listes contextuelles musique (table)');
  else fail('CONTEXTUEL MUSIQUE absent!');
  if (appSrc.includes('gatefold') && appSrc.includes('box-set')) ok('éditions musique (gatefold/box set)');
  else fail('ÉDITIONS MUSIQUE absentes!');
  if (appSrc.includes('bigband') && appSrc.includes('quatuor')) ok('formations musicales (big band/quatuor)');
  else fail('FORMATIONS incomplètes!');
  if (appSrc.includes('BOARDGAME_TYPES') && appSrc.includes('BOARDGAME_ESAR') && appSrc.includes('BOARDGAME_MECHANICS') && appSrc.includes('BOARDGAME_FORMATS')) ok('référentiel jeux de société (BGG+ESAR+mécanismes+formats)');
  else fail('RÉFÉRENTIEL JEUX SOCIÉTÉ absent!');
  if (appSrc.includes('ESAR R11') && appSrc.includes('ESAR E —')) ok('classification ESAR (4 familles + sous-familles)');
  else fail('ESAR incomplet!');
  if (appSrc.includes('wargame') && appSrc.includes('eurogame')) ok('types BGG (wargame/eurogame)');
  else fail('TYPES BGG incomplets!');
  if (appSrc.includes("Placement d\\u0027ouvriers") && appSrc.includes('coop')) ok('mécanismes BGG (workers/coop)');
  else fail('MÉCANISMES incomplets!');
  if (appSrc.includes('name="esar"') && appSrc.includes('name="mechanic"') && appSrc.includes('name="players"') && appSrc.includes('name="ageMin"') && appSrc.includes('name="playDuration"') && appSrc.includes('name="complexity"')) ok('champs ESAR/mécanisme/joueurs/âge/durée/complexité');
  else fail('CHAMPS JEUX SOCIÉTÉ absents!');
  if (appSrc.includes('boardgame: BOARDGAME_TYPES') && appSrc.includes('boardgame: BOARDGAME_FORMATS')) ok('listes contextuelles jeux société (table)');
  else fail('CONTEXTUEL JEUX SOCIÉTÉ absent!');
  if (appSrc.includes('kickstarter') && appSrc.includes('big-box') && appSrc.includes('extension-js')) ok('éditions jeux société (KS/big box/extension)');
  else fail('ÉDITIONS JEUX SOCIÉTÉ absentes!');
  if (appSrc.includes('figurines') && appSrc.includes('ecran-mj')) ok('composants (figurines/écran MJ)');
  else fail('COMPOSANTS incomplets!');
  if (appSrc.includes('SOFTWARE_FAMILIES') && appSrc.includes('SOFTWARE_CATEGORIES') && appSrc.includes('SOFTWARE_FORMATS')) ok('référentiel logiciels (familles+catégories+formats)');
  else fail('RÉFÉRENTIEL LOGICIELS absent!');
  if (appSrc.includes('Bureautique') && appSrc.includes('Catalogage') && appSrc.includes('Sécurité')) ok('familles logiciels (bureautique/catalogage/sécurité)');
  else fail('FAMILLES LOGICIELS incomplètes!');
  if (appSrc.includes('Open source') && appSrc.includes('Freemium')) ok('catégories techniques (libre/freemium)');
  else fail('CATÉGORIES LOGICIELS incomplètes!');
  if (appSrc.includes('name="softwareCategory"') && appSrc.includes('name="licenseType"')) ok('champs catégorie + licence');
  else fail('CHAMPS LOGICIELS absents!');
  if (appSrc.includes('software: SOFTWARE_FAMILIES') && appSrc.includes('software: SOFTWARE_FORMATS')) ok('listes contextuelles logiciels (table)');
  else fail('CONTEXTUEL LOGICIELS absent!');
  if (appSrc.includes('oem') && appSrc.includes('trial') && appSrc.includes('gratuite')) ok('éditions logiciels (OEM/démo/gratuite)');
  else fail('ÉDITIONS LOGICIELS absentes!');
  if (appSrc.includes('perpetuelle') && appSrc.includes('par-poste')) ok('types de licence (perpétuelle/par poste)');
  else fail('LICENCES incomplètes!');
  if (appSrc.includes('value="software"')) ok('medium logiciel dans le select');
  else fail('MEDIUM LOGICIEL absent!');
  if (appSrc.includes('name="accessibility"') && appSrc.includes('falc') && appSrc.includes('braille-int')) ok('facette accessibilité (braille/FALC/gros caractères/SME)');
  else fail('ACCESSIBILITÉ absente — obligation légale!');
  if (appSrc.includes('name="awards"') && appSrc.includes('Goncourt')) ok('facette prix/récompenses');
  else fail('PRIX/RÉCOMPENSES absents!');
  if (appSrc.includes('audiodescription') && appSrc.includes('lsf')) ok('accessibilité audio (audiodescription/LSF)');
  else fail('ACCESSIBILITÉ AUDIO incomplète!');
  if (appSrc.includes('SUBTYPE_LISTS') && appSrc.includes('CARRIER_LISTS')) ok('table de correspondance contextuelle (refactor)');
  else fail('TABLE DE CORRESPONDANCE absente!');
  if (appSrc.includes('PARTITION_TYPES') && appSrc.includes('par-condu')) ok('référentiel partitions (conducteur/réduite/partie)');
  else fail('PARTITIONS absentes!');
  if (appSrc.includes('MAP_TYPES') && appSrc.includes('carte-naut') && appSrc.includes('spatiocarte')) ok('référentiel cartographique (nautique/satellite)');
  else fail('CARTOGRAPHIE absente!');
  if (appSrc.includes('PHOTO_TYPES') && appSrc.includes('negatif') && appSrc.includes('plaque')) ok('référentiel photographies (négatif/plaque de verre)');
  else fail('PHOTOGRAPHIES absentes!');
  if (appSrc.includes('PRINT_TYPES') && appSrc.includes('eau-forte') && appSrc.includes('aff-cinema')) ok('référentiel estampes/affiches');
  else fail('ESTAMPES/AFFICHES absentes!');
  if (appSrc.includes('MANUSCRIPT_TYPES') && appSrc.includes('papyrus')) ok('référentiel manuscrits/archives');
  else fail('MANUSCRITS absents!');
  if (appSrc.includes('THESIS_TYPES') && appSrc.includes('hdr')) ok('référentiel thèses/doc officiels');
  else fail('THÈSES absentes!');
  if (appSrc.includes('EPHEMERA_TYPES') && appSrc.includes('kamishibai'.replace('kamishibai','carte-postale'))) ok('référentiel éphémères');
  else fail('ÉPHÉMÈRES absents!');
  if (appSrc.includes('OBJECT_TYPES') && appSrc.includes('kamishibai')) ok('référentiel objets/mallettes (kamishibaï)');
  else fail('OBJETS/MALLETTES absents!');
  if (appSrc.includes('DIGITAL_TYPES') && appSrc.includes('base-donnees') && appSrc.includes('podcast')) ok('référentiel ressources numériques (Cairn/podcast)');
  else fail('RESSOURCES NUMÉRIQUES absentes!');
  if (appSrc.includes('value="partition"') && appSrc.includes('value="digital"')) ok('9 nouveaux mediums dans le select');
  else fail('NOUVEAUX MEDIUMS absents!');
  if (appSrc.includes('genererCote') && appSrc.includes('MEDIUM_SHORT') && appSrc.includes('CARRIER_SHORT')) ok('générateur de cote unifié (Q3)');
  else fail('GÉNÉRATEUR DE COTE absent!');
  if (appSrc.includes('COHERENCE_RULES') && appSrc.includes('validerCoherence') && appSrc.includes('evaluerCond')) ok('moteur de cohérence déclaratif (Q4)');
  else fail('MOTEUR DE COHÉRENCE absent!');
  if (appSrc.includes('name="cote"') && appSrc.includes('btnGenCote')) ok('champ cote + bouton Générer dans la fiche');
  else fail('CHAMP COTE absent!');
  if (appSrc.includes('Kodomo incompatible')) ok('règles cohérence représentatives (manga/enfants)');
  else fail('RÈGLES DE COHÉRENCE insuffisantes!');
  if (appSrc.includes('VHS incompatible')) ok('règle VHS/année (cohérence séries)');
  else fail('RÈGLE VHS absente!');
  if (appSrc.includes('is_null') && appSrc.includes('matches') && appSrc.includes('is_not_null')) ok('opérateurs complets (is_null/matches)');
  else fail('OPÉRATEURS COHÉRENCE incomplets!');
  if (appSrc.includes('annuaire ne peut pas')) ok('règles presse (annuaire/quotidien)');
  else fail('RÈGLES PRESSE absentes!');
  if (appSrc.includes('Blu-ray 3D après 2018')) ok('règles formats (blu-ray 3d/uhd zone)');
  else fail('RÈGLES FORMATS absentes!');
  if (appSrc.includes('getFullYear() + 2')) ok('seuil dynamique (année courante +2)');
  else fail('SEUIL DYNAMIQUE en dur!');
  if (fs.existsSync(path.join(root, 'docs/codebook.csv'))) ok('codebook CSV (source de vérité, passe 1)');
  else fail('CODEBOOK absent!');
  if (appSrc.includes('56 règles') || htmlSrc.includes('56 règles')) ok('seuils métier documentés dans l\u0027aide');
  else fail('SEUILS MÉTIER non documentés!');
  if (appSrc.includes('auditCoherence') && htmlSrc.includes('btnAuditCoherence')) ok('audit de cohérence (simulation sur toute la collection)');
  else fail('AUDIT DE COHÉRENCE absent!');
  if (appSrc.includes('EAN-8')) ok('FOR-001 élargi (EAN-13/UPC-12/EAN-8 — pas seulement ISBN 978/979)');
  else fail('FOR-001 TROP STRICT — faux positifs sur les EAN multimédia!');
  if (appSrc.includes('RELATION_TYPES') && appSrc.includes('relationsOf') && appSrc.includes('relType')) ok('Q5 relations typées (13 codes + bidirectionnel)');
  else fail('RELATIONS TYPOLOGIÉES absentes!');
  if (appSrc.includes("'adapt'") && appSrc.includes("'prequel'") && appSrc.includes("'cite'")) ok('13 codes relations (adapt/prequel/cite)');
  else fail('CODES RELATIONS incomplets!');
  if (appSrc.includes('relationsBox') && appSrc.includes('btnAddRel')) ok('UI relations (box + ajout/suppression)');
  else fail('UI RELATIONS absente!');
  if (appSrc.includes('invFr') && appSrc.includes('invEn')) ok('libellés inverses (affichage bidirectionnel)');
  else fail('LIBELLÉS INVERSES absents!');
  if (appSrc.includes('ne peut pas être lié à lui-même')) ok('garde source != cible (CHECK)');
  else fail('GARDE ANTI-BOUCLE absente!');
  if (appSrc.includes('RAMEAU_TERMS') && appSrc.includes('rameauSuggest') && appSrc.includes('rameauByCode')) ok('Q2 RAMEAU (indexation matière + suggestions)');
  else fail('RAMEAU ABSENT!');
  if (appSrc.includes('subjectsBox') && appSrc.includes('btnAddSubj')) ok('UI sujets (picker fermé)');
  else fail('UI SUJETS absente!');
  if (appSrc.includes('Maximum 3 sujets')) ok('limite 1-3 sujets (règle pragmatique)');
  else fail('LIMITE SUJETS absente!');
  if (fs.existsSync(path.join(root, 'docs/rameau.csv'))) ok('rameau.csv (source de vérité)');
  else fail('RAMEAU CSV absent!');
  if (appSrc.includes('presuggererSujets') && htmlSrc.includes('btnPresuggestSubjects')) ok('pré-suggestion RAMEAU (validation humaine)');
  else fail('PRÉ-SUGGESTION absente!');
  if (appSrc.includes("sugg.map((r) => r[0])")) ok('pré-remplissage 1-3 sujets par genre');
  else fail('PRÉ-REMPLISSAGE absent!');
  if (htmlSrc.includes('Guide de catalogage') && htmlSrc.includes('Cataloguing guide')) ok('guide de catalogage 7 gestes (FR+EN)');
  else fail('GUIDE CATALOGAGE absent!');
  if (htmlSrc.includes('Les 10 pièges') && htmlSrc.includes('10 pitfalls')) ok('les 10 pièges documentés');
  else fail('PIÈGES non documentés!');
  if (htmlSrc.includes('Stratégie de rattrapage')) ok('stratégie de rattrapage (lots 5-10)');
  else fail('STRATÉGIE RATTRAPAGE absente!');
  if (fs.existsSync(path.join(root, 'aide', 'catalogage.html'))) ok('guide HTML autonome aide/catalogage.html');
  else fail('GUIDE HTML AUTONOME absent!');
  const guideHtml = fs.readFileSync(path.join(root, 'aide', 'catalogage.html'), 'utf8');
  if (guideHtml.includes('id="principes"') && guideHtml.includes('id="etapes"') && guideHtml.includes('id="familles"') && guideHtml.includes('id="cas"') && guideHtml.includes('id="stock"')) ok('ancres du guide (#principes #etapes #familles #cas #stock)');
  else fail('ANCRES DU GUIDE ABSENTES!');
  if (guideHtml.includes('@media print') && guideHtml.includes('@media (max-width: 860px)')) ok('guide responsive + impression');
  else fail('GUIDE CSS PRINT/RESPONSIVE ABSENT!');
  if (guideHtml.includes('id="scan"') && guideHtml.includes('id="structurants"') && guideHtml.includes('id="facettes"') && guideHtml.includes('id="cote"') && guideHtml.includes('id="sujets"') && guideHtml.includes('id="relations"') && guideHtml.includes('id="verifications"')) ok('ancres des 7 étapes (#scan #structurants #facettes #cote #sujets #relations #verifications)');
  else fail('ANCRES 7 ÉTAPES ABSENTES!');
  if (guideHtml.includes('callout ok') && guideHtml.includes('callout error') && guideHtml.includes('badge warn')) ok('guide v2 documentalist (callouts à faire/à ne pas faire + badges sévérité)');
  else fail('GUIDE V2 CALLOUTS ABSENTS!');
  if (htmlSrc.includes('aide/catalogage.html')) ok('lien vers le guide HTML depuis l\u0027aide');
  else fail('LIEN GUIDE HTML ABSENT!');
  const orchDoc = fs.existsSync(path.join(root, 'docs', 'orchestration-api.md')) ? fs.readFileSync(path.join(root, 'docs', 'orchestration-api.md'), 'utf8') : '';
  if (orchDoc.includes('AniList') && orchDoc.includes('BGG XML API2') && orchDoc.includes('Wikidata') && orchDoc.includes('fusion non destructive')) ok('guide orchestration API (docs/orchestration-api.md)');
  else fail('GUIDE ORCHESTRATION API ABSENT!');
  if (/async function fetchAniListByTitle/.test(appSrc) && /async function fetchBggByTitle/.test(appSrc) && /async function fetchWikidataByIsbn/.test(appSrc)) ok('connecteurs AniList + BGG + Wikidata (retrieval-constrained)');
  else fail('CONNECTEURS ANILIST/BGG/WIKIDATA ABSENTS!');
  if (/bggThrottle/.test(appSrc) && /wdThrottle/.test(appSrc)) ok('throttles rate-limit BGG (1/5s) + Wikidata (1/s)');
  else fail('THROTTLES API ABSENTS!');
  if (/keyBggToken/.test(appSrc) && /keyBggToken/.test(htmlSrc) && /apiKeys.bggToken/.test(appSrc)) ok('token BGG dans ☰→🔑 (Bearer obligatoire depuis 07/2025)');
  else fail('TOKEN BGG ABSENT!');
  if (/250 - \(Date.now\(\) - \(fetchIgdbByTitle.__last/.test(appSrc)) ok('throttle IGDB 4 req/s (250 ms, guide orchestration)');
  else fail('THROTTLE IGDB ABSENT!');
  if (/involved_companies.publisher/.test(appSrc) && /publisher: pub && pub.company \? pub.company.name/.test(appSrc)) ok('IGDB: vrai éditeur (publisher via involved_companies, plus le littéral IGDB)');
  else fail('IGDB PUBLISHER ABSENT!');
  if (/igdbMeta.platform && !it.platform/.test(appSrc)) ok('IGDB: plateforme mappée sur la liste fermée PLATFORMS');
  else fail('IGDB PLATFORM MAPPING ABSENT!');
  if (/eviction LRU/.test(appSrc) && /rest.sort\(\(a, b\) => \(all\[a\].at/.test(appSrc)) ok('cache méta: purge TTL + éviction LRU (>500 entrées, fonds milliers de docs)');
  else fail('CACHE LRU ABSENT!');
  if (appSrc.includes('link[type="boardgamedesigner"]') && !/relation~=/.test(appSrc)) ok('BGG: sélecteurs XML type= corrigés (bug v2.35.0 relation~= ne matchait rien)');
  else fail('BGG SELECTEURS INCORRECTS!');
  if (/status === 202/.test(appSrc) && /status === 401 || res.status === 403/.test(appSrc) || (/status === 401/.test(appSrc) && /status === 403/.test(appSrc) && /status === 429/.test(appSrc))) ok('BGG: gestion statuts 202 (file attente) / 401-403 (token) / 429 (rate limit)');
  else fail('BGG STATUTS NON GÉRÉS!');
  if (/metaCacheStats/.test(appSrc) && /tauxHit/.test(appSrc) && /__metaCacheHits/.test(appSrc)) ok('santé du cache (hits/misses/taux) — dashboard allégé PWA');
  else fail('STATS CACHE ABSENTES!');
  if (/bggMeta.publisher && !it.publisher/.test(appSrc)) ok('BGG: éditeur rempli dans aiFillItem');
  else fail('BGG PUBLISHER FILL ABSENT!');
  if (/async function fetchDiscogsByBarcodeOrTitle/.test(appSrc) && /discogsThrottle/.test(appSrc)) ok('connecteur Discogs (fallback musique, throttle 1/s, 60 req/min)');
  else fail('CONNECTEUR DISCOGS ABSENT!');
  if (/keyDiscogsToken/.test(appSrc) && /keyDiscogsToken/.test(htmlSrc) && /apiKeys.discogsToken/.test(appSrc)) ok('token Discogs dans ☰→🔑');
  else fail('TOKEN DISCOGS ABSENT!');
  if (/barcode: isbn/.test(appSrc) && /fetchDiscogsByBarcodeOrTitle\(\{ title: it.title/.test(appSrc)) ok('Discogs: EAN musique (fallback relais) + aiFillItem par titre');
  else fail('BRANCHEMENT DISCOGS ABSENT!');
  if (/DISCOGS_CARRIERS/.test(appSrc) && /'vinyle-33'/.test(appSrc)) ok('Discogs: formats mappés sur le référentiel carriers fermé');
  else fail('MAPPING CARRIER DISCOGS ABSENT!');
  if (/async function fetchCrossrefByDoiOrTitle/.test(appSrc) && /crossrefThrottle/.test(appSrc)) ok('connecteur CrossRef (RNU/DOI, sans clé, throttle 10 req/s)');
  else fail('CONNECTEUR CROSSREF ABSENT!');
  if (/it.medium === 'digital'/.test(appSrc) && /fetchCrossrefByDoiOrTitle/.test(appSrc)) ok('CrossRef branché dans aiFillItem (ressource numérique, DOI préfixe 10. accepté)');
  else fail('BRANCHEMENT CROSSREF ABSENT!');
  if (/i.type === wantType && i.identifier === isbn/.test(appSrc)) ok('Google Books: filtrage ISBN exact (éditions multiples par ISBN — point d\u0027attention du documentalist)');
  else fail('FILTRE ISBN GOOGLE BOOKS ABSENT!');
  if (/async function olThrottle/.test(appSrc) && appSrc.match(/await olThrottle\(\);/g) && appSrc.match(/await olThrottle\(\);/g).length >= 3) ok('throttle Open Library 3 req/s (350 ms — lookup, recherche, couvertures)');
  else fail('THROTTLE OPEN LIBRARY ABSENT!');
  if (/coverBackPrevImg' : 'coverPrevImg/.test(appSrc) && /im.src = dataUrl; im.style.display = 'block'/.test(appSrc)) ok('photo recto/verso: aperçu mis à jour DIRECTEMENT après compression (fix « lien sans image » — .value programmatique ne déclenche pas input)');
  else fail('FIX APERÇU PHOTO ABSENT!');
  if (/img.onerror = \(\) => cb\(null, 0, 0\)/.test(appSrc)) ok('photo: format illisible (HEIC) signalé explicitement, plus de data URL brut dans le champ');
  else fail('FIX HEIC ABSENT!');
  if (!/\nwireCoverImport\('importCoverFront', 'cover'\);/.test(appSrc)) ok('photo: plus de double câblage top-level (inputs re-rendus par openDetail)');
  else fail('DOUBLE CÂBLAGE PHOTO ENCORE PRÉSENT!');
  if (/const COUNTRIES = \[/.test(appSrc) && appSrc.includes("['CN', 'Chine']") && appSrc.includes("['KR', 'Corée du Sud']") && /\.\.\.COUNTRIES/.test(appSrc)) ok('pays de production: liste complète (60 pays ISO, Chine + Corée du Sud incluses)');
  else fail('LISTE PAYS INCOMPLÈTE!');
  if (appSrc.includes("'HIST-CN', 'Histoire de la Chine'") && appSrc.includes("'HIST-JP', 'Histoire du Japon'") && appSrc.includes("'HIST-KR', 'Histoire de la Corée'")) ok('RAMEAU: histoire par pays (CN/JP/KR/US/RU/DE/GB/IT/ES — option B)');
  else fail('RAMEAU HISTOIRE PAR PAYS ABSENT!');
  const rameauCsv = fs.readFileSync(path.join(root, 'docs', 'rameau.csv'), 'utf8');
  if (rameauCsv.includes('HIST-CN,Histoire de la Chine') && rameauCsv.includes('HIST-KR,Histoire de la Corée')) ok('rameau.csv source de vérité synchronisée avec RAMEAU_TERMS');
  else fail('RAMEAU.CSV DÉSYNCHRONISÉ!');
  if (/const fieldFor = \(mediums, label, inner\)/.test(appSrc) && appSrc.match(/fieldFor\(\[/g) && appSrc.match(/fieldFor\(\[/g).length >= 15) ok('fiche adaptative: 15+ champs conditionnels par medium (fieldFor — divulgation progressive)');
  else fail('FICHE ADAPTATIVE ABSENTE!');
  if (/fieldFor\(\['series'\], t\('f_seasons'\)/.test(appSrc) && /fieldFor\(\['press'\], t\('f_collectionstate'\)/.test(appSrc) && /fieldFor\(\['film', 'series', 'game'\], t\('f_zone'\)/.test(appSrc)) ok('spécificités: saisons(séries), état de collection(presse), zone(vidéo/jeux)');
  else fail('MAPPING CHAMPS CONDITIONNELS INCORRECT!');
  if (/function addByType\(medium\)/.test(appSrc) && /NEW_BY_TYPE_DEFAULTS/.test(appSrc) && /selNewByType/.test(htmlSrc)) ok('fiche type par support culturel (16 types, défauts intelligents: JPN manga, en_cours presse, VOST séries)');
  else fail('FICHE PAR TYPE ABSENTE!');
  if (/manga: \{ readingDirection: 'JPN' \}/.test(appSrc) && appSrc.includes("['KR', 'Manhwa cor\u00e9en") && appSrc.includes("['CN', 'Gauche \u2192 droite (manhua chinois")) ok('sens de lecture: défaut JPN (85% du fonds) + options KR (coréen) et CN (chinois) pour les exceptions');
  else fail('SENS DE LECTURE MANGA INCORRECT!');
  if (/const LANGUAGES = \[/.test(appSrc) && /name="language"/.test(appSrc) && /name="audioLangs"/.test(appSrc)) ok('langues: champ langue (15 langues ISO, fallback valeurs API) + langues audio (film/séries/jeux)');
  else fail('CHAMPS LANGUES ABSENTS!');
  if (/fieldFor\(\['boardgame', 'jdr'\], t\('f_esar'\)/.test(appSrc) && /fieldFor\(\['boardgame', 'jdr'\], t\('f_mechanic'\)/.test(appSrc) && /fieldFor\(\['game'\], t\('f_gamemode'\)/.test(appSrc)) ok('champs jeux conditionnels: ESAR+mécanismes (JdS/JdR), mode de jeu (JV) — plus de fuite sur les fiches manga');
  else fail('CHAMPS JEUX NON CONDITIONNELS!');
  if (/fieldFor\(\['manga', 'bd', 'comic'\], t\('f_readdirection'\)/.test(appSrc) && /fieldFor\(\['series', 'digital'\], t\('f_channel'\)/.test(appSrc)) ok('sens de lecture (manga/BD/comics) + chaîne (séries/RNU) conditionnels');
  else fail('CHAMPS SENS DE LECTURE/CHAÎNE NON CONDITIONNELS!');
  if (/const LANG_NORM = \{/.test(appSrc) && /normLang\(it.language\) === v/.test(appSrc)) ok('langue: normalisation ISO 639-2/B → 639-1 (fre→fr, eng→en — les APIs BnF/GB)');
  else fail('NORMALISATION LANGUE ABSENTE!');
  if (!/\$\{field\(t\('f_scenario'\)/.test(appSrc) && !/\$\{field\(t\('f_art'\)/.test(appSrc) && /scEl \? scEl.value/.test(appSrc)) ok('scénariste/dessinateur: doublon scenario/art retiré du formulaire, valeurs anciennes préservées');
  else fail('DOUBLON SCÉNARISTE/DESSINATEUR ENCORE PRÉSENT!');
  if (!/id="relatedEditor"/.test(appSrc) && /Éditeur de relations historique/.test(appSrc)) ok('vieux éditeur related[] retiré (vestige mort — selects jamais persistés, doublon du Q5)');
  else fail('VIEUX ÉDITEUR RELATIONS ENCORE PRÉSENT!');
  if (/<option value="">—<\/option>/.test(appSrc) && /Choisissez un type de relation/.test(appSrc)) ok('ajout relation: « — » par défaut sur type et cible + garde type vide');
  else fail('DEFAULTS RELATION MANQUANTS!');
  if (/function duplicateForNextVolume/.test(appSrc) && /id="btnNextVolume"/.test(appSrc) && /it.volume = vol \? String\(parseInt/.test(appSrc)) ok('catalogage par dérivation: bouton « Tome suivant » (copie de série, ISBN/photos/résumés/cote réinitialisés, volume incrémenté)');
  else fail('TOME SUIVANT ABSENT!');
  if (/data.found === false && data.diag/.test(appSrc) && /anti-bot/.test(appSrc)) ok('relais FR: blocage BnF signalé au lieu d echec silencieux (worker renvoie diag, app toast)');
  else fail('TRANSPARENCE RELAIS ABSENTE!');
  if (/function extractVolumeFromTitle/.test(appSrc) && /volume \(extrait du titre\)/.test(appSrc)) ok('tome: extraction automatique du numéro collé au titre (IA) — le titre reste propre, le numéro va dans son champ');
  else fail('EXTRACTION TOME ABSENTE!');
    if (/T\. \\$\\{esc\\(displayVolume\\(it\\)\\)\\}/.test(appSrc)) ok('tome: badge « T. N » sur la mini-fiche (via displayVolume)');
  if (/t\('f_series'\)[\s\S]{0,200}t\('f_volume'\)[\s\S]{0,400}t\('f_seriesstate'\)/.test(appSrc)) ok('fiche: bloc SÉRIE regroupé après les auteurs (série, volume, état, total)');
  else fail('BLOC SÉRIE NON REGROUPÉ!');
  if (/function displayVolume/.test(appSrc) && appSrc.match(/displayVolume\(it\)/g) && appSrc.match(/displayVolume\(it\)/g).length >= 1 && /displayVolume\(i\)/.test(appSrc)) ok('badge tome robuste: champ volume OU numéro extrait du titre (affichage seul)');
  else fail('DISPLAYVOLUME ABSENT!');
  if (/x.id === item.id/.test(appSrc) && /crypto.randomUUID\(\) : String\(Date.now/.test(appSrc)) ok('store: garde anti-collision d\u2019id (régénère si collision — bug fiches inséparables)');
  else fail('GARDE ANTI-COLLISION ID ABSENTE!');
  if (/this.items.splice\(i, 1\)/.test(appSrc)) ok('store.remove: une seule entrée supprimée (splice, pas filter-all)');
  else fail('REMOVE MULTIPLE INCORRECT!');
  if (/if \(isRecordLocked\(it\)\) \{ toast\(tm\('rs_locked_blocked'\), 4500\); return; \} \/\/ d/.test(appSrc)) ok('suppression: fiche verrouillée protégée (déverrouillage explicite requis)');
  else fail('SUPPRESSION SANS GARDE VERROU!');
  if (appSrc.match(/dup.medium !== it.medium/g) && appSrc.match(/dup.medium !== it.medium/g).length >= 2) ok('fusion anti-doublon: jamais à travers deux mediums différents (bug Destiny 2/Hooked)');
  else fail('GARDE FUSION CROSS-MEDIUM ABSENTE!');
  if (/btnDupOpen/.test(appSrc) && /btnDupOpen/.test(htmlSrc)) ok('doublon « existe déjà »: bouton Ouvrir la fiche existante (sortie d\u2019impasse)');
  else fail('BOUTON OUVRIR DOUBLON ABSENT!');
  if (/cur.cover = dataUrl; store.update\(cur\)/.test(appSrc)) ok('photos: persistées dans le store dès la prise (survivent aux re-rendus du formulaire — bug « lien qui saute »)');
  else fail('PERSISTANCE PHOTO ABSENTE!');
  if (/\['À jouer', 'En jeu', 'Joué'\]/.test(appSrc) && /\['À voir', 'En visionnage', 'Vu'\]/.test(appSrc) && /\['À écouter', 'En écoute', 'Écouté'\]/.test(appSrc)) ok('statut contextuel par medium: À lire/À voir/À écouter/À jouer (tous types)');
  else fail('STATUT CONTEXTUEL ABSENT!');
  if (/\['16\+', '16\+'\]/.test(appSrc) && /Âge minimum \(PEGI\)/.test(appSrc)) ok('âge minimum: 16+ PEGI ajouté + libellé PEGI pour jeux');
  else fail('16+ PEGI ABSENT!');
  if (/fieldFor\(\['book', 'comic', 'bd', 'manga', 'press', 'thesis'\], t\('f_pages'\)/.test(appSrc)) ok('pageCount: réservé aux imprimés (livres/BD/mangas/presse/thèses)');
  else fail('PAGECOUNT NON CONDITIONNEL!');
  if (/const val = \(n\) => \{ const el = f.querySelector/.test(appSrc)) ok('save: val() null-sûr — un champ masqué par la fiche adaptative vaut « » au lieu de crasher l\u2019enregistrement');
  else fail('VAL() NON NULL-SÛR!');
  if (/Studio \(développeur\)/.test(appSrc) && /Bungie \/ Activision/.test(appSrc)) ok('jeux: champ auteurs libellé « Studio (développeur) » avec repère éditeur (Bungie/Activision)');
  else fail('LABEL STUDIO ABSENT!');
  if (/seen\[isbn\] > 1\) copies\+\+/.test(appSrc) && /exemplaire\(s\) en plus/.test(appSrc) && /DEUX EXEMPLAIRES physiques/.test(appSrc)) ok('rafale exemplaires: 2 scans du même code = 2 fiches (la 2e badge doublon); 1er scan d\u2019un code déjà en bibliothèque = ignoré');
  else fail('EXEMPLAIRES RAFALE ABSENTS!');
  if (/CONTRÔLE D'ÉTAGÈRE/.test(appSrc) && /reshelved\+\+/.test(appSrc) && /re-rang/.test(appSrc)) ok('contr\u00f4le d\u2019\u00e9tag\u00e8re: mode rafale + rangement \u2014 les pr\u00e9sents se re-rangent, les nouveaux s\u2019y cr\u00e9ent');
  else fail('CONTR\u00d4LE \u00c9TAG\u00c8RE RAFALE ABSENT!');
  if (/ex.photoPos = \+\+pos/.test(appSrc) && /last.photoPos = insPos/.test(appSrc)) ok('positions ordinales + insertion: re-rang\u00e9s gardent leur \u2116, nouveaux ins\u00e9r\u00e9s avec d\u00e9calage');
  else fail('POSITIONS ORDINALES ABSENTES!');
  if (/shelf: \(a, b\)/.test(appSrc) && /value="shelf"/.test(htmlSrc)) ok('tri \u00ab \u00c9tag\u00e8re (position) \u00bb: meuble \u2192 \u00e9tag\u00e8re \u2192 \u2116 \u2014 les trous se voient');
  else fail('TRI \u00c9TAG\u00c8RE ABSENT!');
  if (/№ \$\{esc\(it.photoPos\)\}/.test(appSrc)) ok('badge № position sur la mini-fiche (propre ligne sous le titre)');
  else fail('BADGE POSITION ABSENT!');
  if (/name="photoPos"/.test(appSrc) && /renum\u00e9rotation automatique/.test(appSrc)) ok('fiche: champ \u2116 position \u00e9ditable + d\u00e9calage auto des suivants en cas d\u2019insertion');
  else fail('CHAMP POSITION FICHE ABSENT!');
  if (/if \(ex.photoPos\) pos = ex.photoPos/.test(appSrc) && /INSERTION: le nouveau prend/.test(appSrc)) ok('rafale insertion: avant/manquant/apr\\u00e8s \u2014 les re-rang\\u00e9s gardent leur n\\u00b0, le manquant s\\u2019ins\\u00e8re avec d\\u00e9calage');
  else fail('INSERTION RAFALE ABSENTE!');
  if (/id="bulkPosStart"/.test(htmlSrc) && /POSITIONS ORDINALES EN MASSE/.test(appSrc) && /i.photoPos = posStart \+ idx/.test(appSrc)) ok('mode rangement catalogue: s\u00e9lection multiple + \u2116 d\u00e9part = positions en ordre affich\u00e9 avec d\u00e9calage auto');
  else fail('RANGEMENT CATALOGUE ABSENT!');
  if (/MODIFIER la s\u00e9lection/.test(htmlSrc) && /Ranger dans le meuble/.test(htmlSrc) && /S'APPLIQUENT aux fiches coch\u00e9es/.test(htmlSrc)) ok('UX: barre de s\u00e9lection \u00ab MODIFIER \u2014 S\u2019APPLIQUENT aux coch\u00e9es \u00bb + verbes (Ranger/D\u00e9finir) + distinction \u00e9crite avec le menu \u26a1Actions');
  else fail('UX CLARIFICATION ABSENTE!');
  if (/bulk_status: 'Définir le statut/.test(i18nSrc) && /bulk_furniture: 'Ranger dans le meuble/.test(i18nSrc)) ok('libell\\u00e9s verbes dans i18n (la vraie source des data-i18n) \u2014 l\u2019i18n n\u2019\\u00e9crase plus les nouveaux libell\\u00e9s');
  else fail('I18N LIBELL\\u00c9S NON CORRIG\\u00c9S!');
  if (/function ensureBarHeaders/.test(appSrc) && /bulk-hint-header/.test(appSrc)) ok('en-t\\u00eates inject\\u00e9s par JS \u2014 pr\\u00e9sents m\\u00eame avec un index.html p\\u00e9rim\\u00e9');
  else fail('INJECTION EN-T\\u00caATES ABSENTE!');
  if (/if \(\$\('#bulkGenre'\)\)/.test(appSrc)) ok('bulk apply: #bulkGenre gard\u00e9 (crash TypeError interne corrig\u00e9)');
  else fail('BULKGENRE NON GARD\u00c9!');
  if (/Aucune fiche coch\\u00e9e/.test(appSrc)) ok('bulk apply: s\u00e9lection explicite requise (auto-s\u00e9lection-de-tout supprim\u00e9e — incident r\u00e9el)');
  else fail('AUTO-S\u00c9LECTION TOUT ENCORE PR\u00c9SENTE!');
  if (/Mode genre \(appliquer\/filtrer\)/.test(htmlSrc)) ok('bouton mode genre d\u00e9sambigu\u00efs\u00e9 (plus de double Appliquer)');
  if (/btnOrganizeShelf/.test(appSrc) && /function openOrganizeShelf/.test(appSrc) && /photoPos = idx \+ 1/.test(appSrc)) ok('organiser une \u00e9tag\u00e8re: tri par crit\u00e8re (titre/s\u00e9rie+tome/genre/cote/auteur/ajout) + num\u00e9rotation 1..N');
  else fail('ORGANISER ÉTAGÈRE ABSENT!');
  if (/TOUTE la collection/.test(appSrc) && /Math.floor\(idx \/ cap\)/.test(appSrc)) ok('organiser TOUTE la collection: tri global + r\u00e9partition \u00e9tag\u00e8re par \u00e9tag\u00e8re (capacit\u00e9 par \u00e9tag\u00e8re, positions 1..N)');
  else fail('ORGANISER COLLECTION ABSENT!');
  if (/function ensureOrganizeUI/.test(appSrc) && /window.__orgGo/.test(appSrc)) ok('organiser: bouton + modal inject\u00e9s par JS (ind\u00e9pendant d\u2019index.html p\u00e9rim\u00e9)');
  else fail('INJECTION ORGANISER ABSENTE!');
  if (/added-desc/.test(appSrc) && /position: \(a, b\) => \(a.photoPos/.test(appSrc)) ok('ordres de rangement complets: ajout r\u00e9cent\u2192ancien + n\u00b0 \u00e9tag\u00e8re (ordre physique)');
  else fail('ORDRES RANGEMENT INCOMPLETS!');
  if (/brand-by { display: block/.test(cssSrc || '')) ok('header deux lignes: titre complet + sous-titre sous le titre');
  else fail('HEADER UNE LIGNE!');
  if (/RE-NUM\u00c9ROTATION SANS D\u00c9PLACEMENT/.test(appSrc)) ok('organiser: ordre \u00ab \u2116 \u00e9tag\u00e8re \u00bb en mode collection = re-num\u00e9rotation SUR PLACE (aucun d\u00e9placement, pas de destination requise)');
  else fail('RENUMÉROTATION SUR PLACE ABSENTE!');
  if (/numeric: true/.test(appSrc) && /sort_series/.test(i18nSrc)) ok('tri \u00e9tag\u00e8re num\u00e9rique (\u00c9tag\u00e8re 2 avant 10) + tri catalogue \u00ab S\u00e9rie + tome \u00bb');
  else fail('TRI NUMÉRIQUE/SÉRIE ABSENT!');
  if (/se sauve m\u00eame sans meuble/.test(appSrc)) ok('n\u00b0 de fiche: sauvegard\u00e9 m\u00eame sans meuble/\u00e9tag\u00e8re (visible sur la mini-fiche)');
  else fail('N° FICHE NON SAUVÉ SANS ÉTAGÈRE!');
  if (/flex-wrap:wrap;gap:4px/.test(appSrc) && /photoPos \? `<span class="chip"/.test(appSrc.replace(/\\\\/g, '\\\\'))) ok('badges T./\u2116 sur leur propre ligne (plus jamais rogn\u00e9s par le line-clamp du titre) + \u2116 litt\u00e9ral');
  else fail('BADGES DANS LE H3 CLAMPÉ!');
  const wfSrc = fs.readFileSync(path.join(root, '.github/workflows/sync-mirror.yml'), 'utf8');
  if (!/--depth 1[^\n]*Bibliotheque\.git src/.test(wfSrc) && /CLONE COMPLET/.test(wfSrc)) ok('sync miroir: clone COMPLET (un clone superficiel corrompt le push orphelin — incident v2.47.2)');
  else fail('SYNC MIROIR EN CLONE SUPERFICIEL!');
  if (!/btnBulkGenreMode/.test(htmlSrc)) ok('double « Appliquer » \u00e9limin\u00e9: bouton mode genre retir\u00e9');
  else fail('DOUBLE APPLIQUER ENCORE LÀ!');
    if (/__burstCodes/.test(appSrc) && /MODE COLLECTEUR/.test(appSrc)) ok('mode rafale COLLECTEUR: codes empilés sans traitement async pendant le scan (proposition utilisateur)');
  if (/!tgt \\|\\| !isBlankFiche\(tgt\)/.test(appSrc)) ok('scan-compléter: flag périmé neutralisé (jamais de détournement vers une fiche complète)');
  else fail('GARDE SCAN-COMPLÉTER ABSENTE!');
  if (/function purgeBlankFiches/.test(appSrc) && /btnPurgeBlanks/.test(htmlSrc)) ok('outil « Purger fiches vides » (⚡Actions) — nettoyage des scans non résolus, annulable');
  else fail('PURGE FICHES VIDES ABSENTE!');
  if (/function isNonLatinTitle/.test(appSrc) && /notice source douteuse/.test(appSrc)) ok('titre non latin (notice source erronée — ex: hébreu pour un ISBN français): avertissement, l\u2019humain vérifie');
  else fail('AVERTISSEMENT TITRE NON LATIN ABSENT!');
    if (/function processBurstCodes/.test(appSrc) && /d\\u00e9j\\u00e0 pr\\u00e9sent/.test(appSrc) && /silentDup: pas de modal/.test(appSrc)) ok('lot à la fermeture: séquentiel, doublons ignorés sans modal, bilan créé/déjà présents/introuvables');
  if (/fetchAniListByTitle\(it.title\)/.test(appSrc) && /fetchBggByTitle\(it.title\)/.test(appSrc)) ok('branchés dans aiFillItem (manga → AniList, boardgame → BGG)');
  else fail('BRANCHEMENT aiFillItem ABSENT!');
  if (/fetchWikidataByIsbn\(isbn/.test(appSrc)) ok('Wikidata fallback dans la cascade livres (fetchMetadataSmartRaw)');
  else fail('WIKIDATA FALLBACK ABSENT!');
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

/* ---------- Bilan final: exit 1 si échec (les guards de push en dépendent) ---------- */
console.log('');
const total = oks + failures;
if (failures > 0) { console.log('\u00c9CHEC: ' + failures + ' probl\u00e8me(s)'); process.exit(1); }
console.log('FUM\u00c9E OK \u2014 toutes les v\u00e9rifications passent (' + total + ')');
