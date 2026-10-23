# Ma Bibliothèque — gestion de bibliothèque personnelle
# 📚 My Library — Personal Book Collection Manager

**[🇬🇧 English below](#-english)**

---

Application web progressive (PWA) : **installable sur PC Windows 11 et sur mobile**, sans compte, sans serveur, 100 % locale et privée.

> ✨ **Création PrimAlph**

Scannez les codes-barres de vos livres, BD et mangas ; la fiche se crée automatiquement (couverture, résumé, références). Organisez, prêtez, inventoriez, exportez.

## 📚 Documentation (dossier `docs/`)

| Fiche | Contenu |
|---|---|
| **[1-INSTALLATION-PC.md](docs/1-INSTALLATION-PC.md)** | Installation Windows 11 (serveur local, app autonome, douchette USB, IA locale) |
| **[2-INSTALLATION-MOBILE.md](docs/2-INSTALLATION-MOBILE.md)** | Installation Android/iOS (hébergement HTTPS, écran d'accueil, scan caméra) |
| **[3-FONCTIONNALITES.md](docs/3-FONCTIONNALITES.md)** | Présentation complète de toutes les fonctionnalités |
| **[4-MANUEL.md](docs/4-MANUEL.md)** | Manuel d'utilisation détaillé, pas à pas |
| **[5-MODE-D-EMPLOI-SYNTHESE.md](docs/5-MODE-D-EMPLOI-SYNTHESE.md)** | Fiche synthétique « les 10 gestes » |

## ⚡ Démarrage rapide

**L'application est en ligne : https://chenzu-ai.github.io/bibliotheque-app/** — ouvrez cette URL sur PC (icône ⊕ Installer) ou mobile (« Ajouter à l'écran d'accueil »).

Hors-ligne / en local :
```bash
cd chemin/vers/le/dossier
python -m http.server 8080
# → http://localhost:8080 dans Edge/Chrome → icône « Installer »
```

## 🧩 En bref

- **Scan** : caméra (mobile), douchette USB ou saisie manuelle (PC), mode rafale, détection de doublons
- **Reconnaissance multi-sources** : Open Library + Google Books (clé perso) + conversion ISBN-10/13 + **relais BnF/Fnac** (micro-service gratuit, `worker.js`) — optimisé pour l'édition française, y compris le fonds ancien
- **Organisation** : étagères, tags, séries (tomes manquants, état), auteurs/scénaristes/dessinateurs, cote Dewey, favoris, souhaits
- **Rangement physique** : meuble + étagère, mode rangement, détection de séries dispersées, **inventaire d'étagère** avec historique, **photo d'étagère IA** (lecture des tranches rangée par rangée)
- **Champs bibliophiles** : collection éditoriale, format, type d'édition (1ʳᵉ édition, collector, rare, incunable), prix éditeur, public — badges et statistique « valeur catalogue »
- **Prêts** : emprunteurs, retours prévus, retards, historique par personne
- **IA optionnelle** : recherche en langage naturel + complétion de fiches + photo d'étagère (API ou Ollama local)
- **Suivi de lecture** : objectif annuel, file « à lire ensuite », choix aléatoire, progression par page, journal daté, statistiques annuelles
- **Cycle de vie** : acquisition (date/origine/prix), emprunts inverses, cession (vendu/donné/perdu) — valeur catalogue
- **Qualité** : centre d'aide intégré, mode sombre, accessibilité, scanner autonome (sans CDN), import CSV/JSON
- **Sauvegarde** : auto + manuelle, exports JSON / CSV / HTML / Markdown / étiquettes imprimables, import fusionnant
- **Capacité** : testée pour 50 000+ ouvrages (IndexedDB, pagination)

## 🔒 Confidentialité

Vos données restent **dans le navigateur de votre appareil**. Aucun compte, aucune télémétrie. Les métadonnées sont récupérées auprès d'Open Library et Google Books uniquement lors d'un scan ; l'IA ne fonctionne que si vous la configurez. Le relais BnF/Fnac (optionnel, Cloudflare Workers) ne stocke rien : seuls les ISBN consultés transitent, et son URL reste dans votre navigateur.

## 📁 Fichiers

```
index.html      page principale
app.js          toute la logique (aucune dépendance)
style.css       interface
manifest.json   installation PWA
sw.js           mode hors-ligne
worker.js       relais BnF/Fnac à déployer sur Cloudflare Workers (optionnel, gratuit)
icons/          icônes
docs/           documentation (5 fiches)
```
<!-- sync test 2026-10-21T18:53:23Z -->

---

## 🇬🇧 English

**My Library** — a complete personal book collection manager as a Progressive Web App (PWA): installable on Windows 11 and mobile, with **no account, no server, 100 % local and private**. Scanning barcodes creates records automatically (cover, summary, references). Organize, lend, inventory, export.

> ✨ **by PrimAlph**

### Highlights

- **Scan** — camera (phone), USB barcode scanner or manual ISBN entry, burst mode, duplicate detection, **AI shelf photo** (reads book spines row by row)
- **Multi-source recognition** — Open Library + Google Books (your own key) + automatic ISBN-10/13 conversion + **BnF/Fnac relay** (free Cloudflare Worker) — optimized for French editions including pre-2010 backlist. Field-level merging across sources.
- **Organize** — shelves, tags, series (missing volumes, ongoing/complete status), Dewey, bibliophile fields (publisher collection, format, edition type: first/collector/rare/incunable, list price), favorites, wishlist
- **Physical shelving** — bookcase + shelf tracking, shelving mode, scattered-series detection, **shelf inventory** with history
- **Loans** — borrower, due dates, late reminders, per-person history, reservations, reverse loans ("borrowed from")
- **Reading tracking** — annual goal 🎯, "read next" queue, 🎲 random pick, page progress, dated reading journal
- **Life cycle** — acquisition (date/source/price paid), disposal (sold/given/lost), catalog value estimation
- **Pro & interoperability** — UNIMARC export (Koha/PMB compatible), QR-code labels (scan QR = record), CSV import (Libib/Excel), PIN-protected guest catalog
- **Privacy-first** — all data stays in **your browser** (IndexedDB). No account, no telemetry. JSON export at any time.
- **🌐 Bilingual FR/EN** — instant toggle, auto-detection · Dark mode, accessibility labels, built-in help center, fully offline scanner (no CDN)

### Quick start

The app runs entirely client-side — open `index.html` directly, or serve the folder (`python -m http.server 8080`) for PWA install + camera scanning. Each user's data and API keys live in their own browser. French guides in [`docs/`](docs/): installation, features, manual, quick reference.

### License

MIT — © 2026 PrimAlph. See [LICENSE](LICENSE).
