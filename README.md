# Bibliotheque — Gestion bibliothèques

# Ma Bibliothèque — gestion de bibliothèque personnelle

Application web progressive (PWA) : **installable sur PC Windows 11 et sur mobile**, sans compte, sans serveur, 100 % locale et privée.

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

```bash
cd chemin/vers/le/dossier
python -m http.server 8080
# → http://localhost:8080 dans Edge/Chrome → icône « Installer »
```

Sur mobile : héberger le dossier sur un service statique HTTPS (Netlify Drop, GitHub Pages…), puis « Ajouter à l'écran d'accueil ».

## 🧩 En bref

- **Scan** : caméra (mobile), douchette USB ou saisie manuelle (PC), mode rafale, détection de doublons
- **Organisation** : étagères, tags, séries (tomes manquants, état), auteurs/scénaristes/dessinateurs, cote Dewey, favoris, souhaits
- **Rangement physique** : meuble + étagère, mode rangement, détection de séries dispersées, **inventaire d'étagère** avec historique
- **Prêts** : emprunteurs, retours prévus, retards, historique par personne
- **IA optionnelle** : recherche en langage naturel + complétion de fiches (API ou Ollama local)
- **Sauvegarde** : auto + manuelle, exports JSON / CSV / HTML / Markdown / étiquettes imprimables, import fusionnant
- **Capacité** : testée pour 50 000+ ouvrages (IndexedDB, pagination)

## 🔒 Confidentialité

Vos données restent **dans le navigateur de votre appareil**. Aucun compte, aucune télémétrie. Les métadonnées sont récupérées auprès d'Open Library et Google Books uniquement lors d'un scan ; l'IA ne fonctionne que si vous la configurez.

## 📁 Fichiers

```
index.html      page principale
app.js          toute la logique (aucune dépendance)
style.css       interface
manifest.json   installation PWA
sw.js           mode hors-ligne
icons/          icônes
docs/           documentation (5 fiches)
```
