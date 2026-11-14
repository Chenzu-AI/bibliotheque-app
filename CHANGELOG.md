# Changelog — Ma Bibliothèque (Création PrimAlph)

## 2.2.0 — Édition « intégrale »
- 🌐 Traduction FR/EN **intégrale** : 73 messages dynamiques (notifications, confirmations) désormais bilingues — bascule 🌐 partout
- 🚀 Onboarding au premier lancement (3 étapes : scanner, sauvegarder, sources FR) — ne revient plus ensuite
- 📷 Import d'images depuis l'appareil (contourne les liens bloqués — image stockée dans la fiche, à vie)
- 🏛️ Banque de couvertures privée (dossier covers/, dernier recours de la reconnaissance + clé dans ☰ → 🔑)
- 🌙 Fixes dark mode : bouton de vue active, Centre d'aide, résumés, badges d'édition (⭐💎), bouton ⋯ mobile
- 🔧 Fix workflow de synchro (clone profond), f_rating manquant, wiring import d'images
- 📚 Fiches et README à jour (onboarding, i18n intégral, configuration DNS)

## 2.1.0 — i18n FR/EN
- 🌐 Bascule de langue FR/EN (bouton 🌐, détection automatique du navigateur, choix mémorisé)
- Restructuration pour la S.à r.l.-S : licence MIT, changelog, renommage PrimAlph

## 2.0.0 — Édition « référence »

## 2.0.0 — Édition « référence »
- QR codes d'exemplaires (étiquettes imprimables 64×25 mm, scan QR → fiche)
- Export UNIMARC (compatible Koha/PMB)
- Réservations (« Réservé pour »)
- Catalogue invité protégé par PIN (lecture seule)
- Suivi de lecture : objectif annuel, file « à lire ensuite », choix aléatoire, page courante, journal daté
- Cycle de vie : acquisition, emprunts inverses, cession (vendu/donné/perdu)
- Import CSV (Libib/CLZ/Excel) + import JSON fusionnant
- Rappels de prêt à l'ouverture
- Champs bibliophiles : collection, format, type d'édition (1ʳᵉ/collector/rare/incunable), prix, public
- Photo d'étagère IA (lecture des tranches rangée par rangée)
- Centre d'aide intégré, mode sombre, accessibilité (aria), scanner autonome (zéro CDN)
- Relais BnF/Fnac (Cloudflare Workers), diagnostic ISBN multi-sources, clés API personnelles

## 1.0.0 — Version initiale
- Scan de codes-barres, organisation (étagères, séries, prêts), exports multi-formats, PWA hors-ligne
