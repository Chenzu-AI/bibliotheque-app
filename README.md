# Ma Bibliothèque — gestion de bibliothèque personnelle

Application web progressive (PWA) : **installable sur PC Windows 11 et sur mobile**, sans compte, sans serveur, 100 % locale et privée.

> ✨ **Création AlphaPrim**

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
