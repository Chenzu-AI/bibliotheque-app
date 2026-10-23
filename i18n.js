'use strict';
/* ---------- i18n — FR (défaut) / EN — Création PrimAlph ---------- */
const I18N = {
  fr: {
    // Topbar + nav
    app_title: 'Ma Bibliothèque',
    scan: '📷 Scanner',
    scan_title: 'Scanner un code-barres',
    menu: '☰', help: '❓', help_title: "Centre d'aide",
    install_btn: '⬇️ Installer',
    // Bottom bar
    isbn_placeholder: 'Saisir un ISBN (10 ou 13 chiffres)',
    add: '➕ Ajouter', add_no_isbn: '➕ Sans ISBN', add_no_isbn_title: 'Créer une fiche vierge, sans ISBN',
    shelve_mode: '📦 Mode rangement',
    shelve_mode_title: 'Scanner/ranger en série : chaque ajout reçoit le même meuble + étagère',
    inv_quick: '🔎 Inventaire',
    inv_quick_title: 'Inventaire : comparer le contenu scanné avec ce qui est censé être rangé à un emplacement',
    // Nav
    nav_collection: '📚 Collection', nav_groups: '👥 Par série / auteur', nav_reading: '📖 Ma lecture',
    nav_loans: '📤 Prêts', nav_lists: '📋 Mes listes', nav_shelves: '🗂️ Étagères',
    nav_inventory: "🔎 Inventaire d'étagère", nav_stats: '📊 Statistiques',
    nav_import_json: '📥 Importer JSON', nav_import_csv: '📥 Importer CSV',
    nav_export_json: '💾 Export JSON', nav_export_csv: '📄 Export CSV', nav_export_html: '🖨️ Export HTML',
    nav_export_md: '📝 Export Markdown', nav_backup_now: '💾 Sauvegarde immédiate',
    nav_backup_cfg: '⚙️ Sauvegarde auto', nav_covers: '🖼️ Couvertures embarquées',
    nav_ai: '🤖 IA (recherche & fiches)', nav_keys: '🔑 Clés API (sources)',
    nav_shelf_photo: "📷 Photo d'étagère (IA)", nav_unimarc: '📤 Export UNIMARC (pro)',
    nav_qr_labels: '🏷️ Étiquettes QR', nav_guest: '👁️ Catalogue invité',
    // Toolbar
    search_placeholder: 'Rechercher (titre, auteur, ISBN, série, tag…)',
    sort_added: 'Ajout (récent)', sort_title: 'Titre A→Z', sort_author: 'Auteur A→Z',
    sort_rating: 'Note décroissante', sort_year: 'Année de publication', sort_dewey: 'Cote Dewey / genre',
    all_shelves: 'Toutes les étagères', all_status: 'Tous les statuts',
    st_unread: 'À lire', st_reading: 'En lecture', st_read: 'Lu', st_wish: '🛒 Souhaits (à acheter)', st_loaned: '📤 Prêtés',
    fav_only: '★ Favoris', save_search: '💾 Sauver cette recherche', ai_search: '🤖 Recherche IA',
    bulk_mode: '☑ Sélection multiple',
    more: 'Afficher plus',
    empty_msg: 'Aucun ouvrage pour le moment.<br>Appuyez sur « Scanner » ou ajoutez un ISBN ci-dessous.',
    // Fiche (detail form)
    f_type: 'Type', f_book: 'Livre', f_comic: 'BD', f_manga: 'Manga', f_other: 'Autre',
    f_status: 'Statut', f_title: 'Titre', f_subtitle: 'Sous-titre', f_authors: 'Auteur(s) — séparés par des virgules',
    f_series: 'Série', f_volume: 'Tome / Volume', f_scenario: 'Scénariste(s) — virgules', f_art: 'Dessinateur(s) — virgules',
    f_seriesstate: 'État de la série', f_ongoing: 'Série en cours (suite prévue)', f_complete: 'Série complète',
    f_seriestotal: 'Nombre de tomes de la série',
    f_dewey: 'Cote Dewey (ex. 843, 741.5)', f_genre: 'Genre (ex. Polar, SF, Heroic fantasy)',
    f_collection: 'Collection éditoriale (ex. Folio, Shonen Kana, Pléiade)', f_format: 'Format',
    f_fmt_broche: 'Broché', f_fmt_poche: 'Poche', f_fmt_relie: 'Relié', f_fmt_grand: 'Grand format', f_fmt_cart: 'Cartonné', f_fmt_digital: 'Digital',
    f_edition: "Type d'édition", f_ed_standard: 'Édition standard', f_ed_first: '1ʳᵉ édition', f_ed_collector: 'Édition collector / limitée', f_ed_rare: 'Édition rare', f_ed_incunable: 'Incunable (avant 1501)',
    f_price: 'Prix éditeur (€)', f_audience: 'Public (ex. Dès 10 ans, Adulte)',
    f_fav: '♥ Favori', f_wish: '🛒 Souhait (à acheter)',
    f_loan: 'Prêt', f_loanto: 'Prêté à…', f_loandue: 'Retour prévu', f_return: '↩ Retour',
    f_reserved: 'Réservé pour', f_reserved_ph: 'ex. Claire — quand il revient',
    f_borrowed: "Emprunté à quelqu'un ? (ce livre vient de…)",
    f_acqdate: 'Acquis le', f_acqfrom: 'Acquis chez / comment', f_acqprice: 'Prix payé (€)',
    f_disposed: 'Cédé / vendu / perdu ?', f_disp_sold: 'Vendu', f_disp_given: 'Donné', f_disp_lost: 'Perdu', f_disp_lent: 'Prêté non rendu', f_disp_none: '— toujours en bibliothèque',
    f_dispdate: 'Cédé le', f_dispprice: 'Prix de cession (€)',
    f_currentpage: 'Page courante (pour suivi de lecture)', f_readnext: 'Inclure dans ma file de lecture',
    f_notes: 'Annotation / avis personnel', f_shelves: 'Étagères', f_tags: 'Tags (virgules)',
    f_location: 'Emplacement physique', f_furniture: 'Meuble (ex. Bibliothèque salon)', f_slot: 'Étagère / rayon (ex. Étagère 4)',
    f_summary: 'Résumé', f_publisher: 'Éditeur', f_pubdate: 'Date de publication',
    f_pages: 'Pages', f_isbn: 'ISBN', f_cover: 'URL image couverture', f_coverback: 'URL image dos',
    f_save: '💾 Enregistrer', f_delete: '🗑️ Supprimer', f_aifill: '🤖 Compléter par IA',
    // Reading view
    r_goal: '🎯 Définir mon objectif annuel', r_random: '🎲 Choisir mon prochain livre',
    r_queue: 'File « à lire ensuite »', r_inprogress: '📚 En cours',
    // Loans / inventory / guest
    l_inprogress: 'Prêts en cours', l_borrowers: 'Par emprunteur',
    inv_title: "🔎 Inventaire d'étagère", inv_start: "Démarrer l'inventaire", inv_stop: 'Terminer',
    guest_title: '👁️ Catalogue en consultation', guest_exit: 'Quitter le catalogue invité',
    // Help
    help_heading: "❓ Centre d'aide",
    h_start: '🚀 Démarrer (5 min)',
    h_add: '📷 Ajouter des livres — toutes les voies',
    h_recog: '🤖 Reconnaissance — optimiser',
    h_org: '📚 Organiser',
    h_loans: '📤 Prêts et inventaire',
    h_reading: '📖 Ma lecture',
    h_exports: '💾 Exports et pro',
    h_docs: '📄 Documentation complète',
    version: 'version',
  },

  en: {
    app_title: 'My Library',
    scan: '📷 Scan',
    scan_title: 'Scan a barcode',
    menu: '☰', help: '❓', help_title: 'Help center',
    install_btn: '⬇️ Install',
    isbn_placeholder: 'Enter an ISBN (10 or 13 digits)',
    add: '➕ Add', add_no_isbn: '➕ No ISBN', add_no_isbn_title: 'Create a blank record without ISBN',
    shelve_mode: '📦 Shelving mode',
    shelve_mode_title: 'Scan and shelve in series: each add gets the same bookcase + shelf',
    inv_quick: '🔎 Inventory',
    inv_quick_title: 'Inventory: compare scanned content with what should be shelved at a location',
    nav_collection: '📚 Collection', nav_groups: '👥 By series / author', nav_reading: '📖 My reading',
    nav_loans: '📤 Loans', nav_lists: '📋 My lists', nav_shelves: '🗂️ Shelves',
    nav_inventory: '🔎 Shelf inventory', nav_stats: '📊 Statistics',
    nav_import_json: '📥 Import JSON', nav_import_csv: '📥 Import CSV',
    nav_export_json: '💾 Export JSON', nav_export_csv: '📄 Export CSV', nav_export_html: '🖨️ Export HTML',
    nav_export_md: '📝 Export Markdown', nav_backup_now: '💾 Backup now',
    nav_backup_cfg: '⚙️ Auto backup', nav_covers: '🖼️ Embedded covers',
    nav_ai: '🤖 AI (search & records)', nav_keys: '🔑 API keys (sources)',
    nav_shelf_photo: '📷 Shelf photo (AI)', nav_unimarc: '📤 UNIMARC export (pro)',
    nav_qr_labels: '🏷️ QR labels', nav_guest: '👁️ Guest catalog',
    search_placeholder: 'Search (title, author, ISBN, series, tag…)',
    sort_added: 'Recently added', sort_title: 'Title A→Z', sort_author: 'Author A→Z',
    sort_rating: 'Rating (high)', sort_year: 'Publication year', sort_dewey: 'Dewey / genre',
    all_shelves: 'All shelves', all_status: 'All statuses',
    st_unread: 'To read', st_reading: 'Reading', st_read: 'Read', st_wish: '🛒 Wishlist (to buy)', st_loaned: '📤 Loaned',
    fav_only: '★ Favorites', save_search: '💾 Save this search', ai_search: '🤖 AI search',
    bulk_mode: '☑ Multi-select',
    more: 'Show more',
    empty_msg: 'No books yet.<br>Press “Scan” or enter an ISBN below.',
    f_type: 'Type', f_book: 'Book', f_comic: 'Comic', f_manga: 'Manga', f_other: 'Other',
    f_status: 'Status', f_title: 'Title', f_subtitle: 'Subtitle', f_authors: 'Author(s) — comma separated',
    f_series: 'Series', f_volume: 'Volume', f_scenario: 'Scriptwriter(s)', f_art: 'Illustrator(s)',
    f_seriesstate: 'Series status', f_ongoing: 'Ongoing series', f_complete: 'Complete series',
    f_seriestotal: 'Total volumes in series',
    f_dewey: 'Dewey (e.g. 843, 741.5)', f_genre: 'Genre (e.g. Mystery, Sci-Fi)',
    f_collection: 'Publisher collection (e.g. Folio, Shonen Kana)', f_format: 'Format',
    f_fmt_broche: 'Paperback', f_fmt_poche: 'Pocket', f_fmt_relie: 'Hardcover', f_fmt_grand: 'Large format', f_fmt_cart: 'Board book', f_fmt_digital: 'Digital',
    f_edition: 'Edition type', f_ed_standard: 'Standard edition', f_ed_first: 'First edition', f_ed_collector: 'Collector / limited edition', f_ed_rare: 'Rare edition', f_ed_incunable: 'Incunable (before 1501)',
    f_price: 'List price (€)', f_audience: 'Audience (e.g. Ages 10+, Adult)',
    f_fav: '♥ Favorite', f_wish: '🛒 Wishlist (to buy)',
    f_loan: 'Loan', f_loanto: 'Loaned to…', f_loandue: 'Due back', f_return: '↩ Return',
    f_reserved: 'Reserved for', f_reserved_ph: 'e.g. Claire — when it comes back',
    f_borrowed: 'Borrowed from someone? (this book comes from…)',
    f_acqdate: 'Acquired on', f_acqfrom: 'Acquired from / how', f_acqprice: 'Price paid (€)',
    f_disposed: 'Sold / given / lost?', f_disp_sold: 'Sold', f_disp_given: 'Given', f_disp_lost: 'Lost', f_disp_lent: 'Lent not returned', f_disp_none: '— still in library',
    f_dispdate: 'Disposed on', f_dispprice: 'Sale price (€)',
    f_currentpage: 'Current page (reading progress)', f_readnext: 'Include in my reading queue',
    f_notes: 'Personal notes / review', f_shelves: 'Shelves', f_tags: 'Tags (comma separated)',
    f_location: 'Physical location', f_furniture: 'Bookcase (e.g. Living room)', f_slot: 'Shelf (e.g. Shelf 4)',
    f_summary: 'Summary', f_publisher: 'Publisher', f_pubdate: 'Publication date',
    f_pages: 'Pages', f_isbn: 'ISBN', f_cover: 'Front cover image URL', f_coverback: 'Back cover image URL',
    f_save: '💾 Save', f_delete: '🗑️ Delete', f_aifill: '🤖 Complete with AI',
    r_goal: '🎯 Set my annual goal', r_random: '🎲 Pick my next book',
    r_queue: '“Read next” queue', r_inprogress: '📚 In progress',
    l_inprogress: 'Active loans', l_borrowers: 'By borrower',
    inv_title: '🔎 Shelf inventory', inv_start: 'Start inventory', inv_stop: 'Finish',
    guest_title: '👁️ Browse catalog', guest_exit: 'Exit guest catalog',
    help_heading: '❓ Help center',
    h_start: '🚀 Getting started (5 min)',
    h_add: '📷 Adding books — all methods',
    h_recog: '🤖 Recognition — optimize',
    h_org: '📚 Organize',
    h_loans: '📤 Loans & inventory',
    h_reading: '📖 My reading',
    h_exports: '💾 Exports & pro',
    h_docs: '📄 Full documentation',
    version: 'version',
  },
};

let LANG = null;
try { LANG = localStorage.getItem('biblio.lang'); } catch {}
if (!LANG) LANG = (navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
if (!['fr', 'en'].includes(LANG)) LANG = 'fr';
function t(key) {
  const d = I18N[LANG] || I18N.fr;
  return d[key] || I18N.fr[key] || key;
}
function setLang(lang) {
  LANG = lang;
  try { localStorage.setItem('biblio.lang', lang); } catch {}
  applyI18n();
}
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    const v = t(k);
    if (k.endsWith('_title')) el.setAttribute('title', v);
    else if (k.endsWith('_placeholder')) el.setAttribute('placeholder', v);
    else el.textContent = v;
  });
  document.documentElement.setAttribute('lang', LANG);
}
