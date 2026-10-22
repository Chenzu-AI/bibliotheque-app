'use strict';
/* ---------- i18n — FR (défaut) / EN — Création AlphaPrim ---------- */
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
