# ⚡ Ma Bibliothèque — Mode d'emploi synthétique

> Une page, l'essentiel. Les détails sont dans le manuel complet (`4-MANUEL.md`).

---

## 🚀 Démarrer — URL officielle : **https://chenzu-ai.github.io/bibliotheque-app/**

| | |
|---|---|
| **PC** | Ouvrir l'URL dans Edge/Chrome → **⊕ Installer** (30 s, sans serveur) |
| **Mobile Android** | Ouvrir l'URL dans Chrome → bouton **⬇️ Installer** (ou menu ⋯ → « Installer l'application ») |
| **iPhone** | Ouvrir l'URL dans **Safari** → bouton **Partager** (↑) → **« Sur l'écran d'accueil »** (pas d'autre voie sur iOS) |

> Hors-ligne sans l'URL : dossier de l'app → `python -m http.server 8080` → `http://localhost:8080` dans Edge → **⊕ Installer**

## ➕ Ajouter un livre
- **Mobile** : 📷 Scanner → visez le code-barres au dos. En série : ⚡ Mode rafale
- **PC** : ISBN dans la barre du bas (ou douchette USB, ou webcam)
- Pas de code-barres : **➕ Sans ISBN**
- Déjà scanné ? L'app demande si c'est un **2ᵉ exemplaire**

## 📦 Ranger
1. **📦 Mode rangement** → « Meuble / Étagère »
2. Scannez toute l'étagère → rangement automatique
3. Re-cliquez 📦 pour arrêter

## 🎯 Les 10 gestes

| Je veux… | Action |
|---|---|
| Modifier une fiche | Clic sur la couverture |
| Noter / annoter | Fiche → ★ étoiles → annotation |
| Créer une étagère virtuelle | ☰ → 🗂️ Étagères |
| Voir les tomes manquants d'une série | ☰ → 👥 Par série |
| Prêter un livre | Fiche → « Prêté à… » + retour prévu |
| Vérifier une étagère (récolement) | ☰ → 🔎 Inventaire → scanner → bilan |
| Chercher en langage naturel | 🤖 Recherche IA (à configurer : ☰ → 🤖 IA) |
| Modifier plein de livres d'un coup | ☑ Sélection multiple → cocher → Appliquer |
| Sauvegarder | ☰ → 💾 Sauvegarde immédiate (JSON) |
| Changer d'appareil | Export JSON → 📥 Importer (fusion auto) |

## 🔑 Reconnaissance des livres
- Sources par défaut : **BnF + Open Library** (gratuites)
- Pour le meilleur résultat (éditions FR) : **☰ → 🔑 Clés API** → clé Google Books perso (test intégré) — reste dans votre navigateur
- Livre introuvable ? Complétez la fiche ou **🤖 Compléter par IA**

## 📤 Exports
**JSON** (sauvegarde) · **CSV** (Excel) · **HTML** (impression) · **Markdown** (notes) · **🏷️ Étiquettes** (cotes 50×30 mm)

## 📱 À retenir sur mobile
- Boutons secondaires (Sans ISBN, Mode rangement, Inventaire) : derrière **⋯** en bas à gauche
- Mise à jour de l'app : fermer/rouvrir une fois (deux fois si l'ancienne version persiste)

## ⚠️ 3 règles d'or
1. **Export JSON régulier** — les données vivent dans le navigateur de l'appareil
2. **Titre/cote complets** avant impression d'étiquettes (Dewey + emplacement)
3. Sur mobile, pas de « couvertures embarquées » (stockage limité)

---
*Ma Bibliothèque — app locale et privée, sans compte, sans serveur. Détails : docs 1-4.*
---
*Ma Bibliothèque — Création AlphaPrim*
