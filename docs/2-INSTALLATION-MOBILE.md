# 📱 Fiche d'installation — Mobile (Android / iPhone)

**Ma Bibliothèque** s'installe sur l'écran d'accueil du téléphone comme une vraie application, avec accès à la **caméra pour scanner**.

## Prérequis
- Android (Chrome) ou iPhone (Safari, iOS 16.4+ recommandé)
- L'application hébergée sur une adresse **HTTPS** (obligatoire pour la caméra)

---

## Étape 1 — Mettre l'app en ligne (une seule fois)

L'app est un simple dossier de fichiers statiques : hébergez-la gratuitement en HTTPS.

### ⭐ Option recommandée — GitHub Pages (si le dépôt GitHub existe déjà)

1. Sur la page du dépôt GitHub : **Settings** → **Pages** (menu de gauche)
2. Section « Build and deployment » → **Source** : *Deploy from a branch*
3. **Branch** : `main` / dossier `/ (root)` → **Save**
4. Attendez 1-2 minutes (un lien vert apparaît en haut de la page)
5. Votre app est en ligne : **`https://VOTRE-COMPTE.github.io/Bibliotheque/`**
   (ex. `https://chenzu-ai.github.io/Bibliotheque/`)

> ✅ L'application est déjà compatible GitHub Pages : aucun réglage de code nécessaire (chemins relatifs). Le scan caméra fonctionne car l'adresse est en HTTPS.

### Alternative — Netlify Drop (sans compte GitHub)

1. Allez sur [app.netlify.com/drop](https://app.netlify.com/drop)
2. Glissez-déposez le **dossier complet** de l'application
3. Vous obtenez une adresse du type `https://ma-bibliotheque.netlify.app`

**Autres options** : Vercel, Cloudflare Pages — tous gratuits pour un site statique.

> ⚠️ N'oubliez pas : les données sont stockées **dans le navigateur de chaque appareil**. Le site hébergé ne stocke rien lui-même (pas de compte, pas de serveur de données).

## Étape 2 — Installer sur Android

1. Ouvrez l'adresse HTTPS dans **Chrome** (la première fois, ignorez l'avertissement éventuel du dépôt privé : connectez-vous à GitHub ou rendez le dépôt public, voir note ci-dessous)
2. Menu ⋯ → **« Ajouter à l'écran d'accueil »** (ou bandeau « Installer l'application » s'il apparaît)
3. L'icône apparaît sur l'écran d'accueil → l'app s'ouvre **plein écran, sans barre de navigateur**

## Étape 2 (iPhone) — Installation sur iOS

1. Ouvrez l'adresse HTTPS dans **Safari**
2. Bouton **Partager** (carré avec flèche) → **« Sur l'écran d'accueil »**
3. Nommez l'app → **Ajouter** → l'icône apparaît

> 🔑 **Important — dépôt privé** : GitHub Pages d'un dépôt privé n'est accessible qu'en étant connecté à GitHub dans le navigateur du téléphone (l'adresse reste privée). Pour une app d'accès libre : **Settings** → tout en bas → **Change visibility** → *Public*. Sinon, restez connecté avec votre compte GitHub sur le mobile — c'est votre bibliothèque personnelle, autant garder le dépôt privé.

## Étape 3 — Scanner vos livres

1. Ouvrez l'app depuis l'écran d'accueil
2. Appuyez sur **📷 Scanner** → autorisez la caméra (une seule fois)
3. Visez le code-barres **au dos du livre** (EAN-13) : la fiche se crée automatiquement avec couverture et résumé

**Conseils de scan** :
- Bonne lumière, livre bien à plat
- Activez **🔆 Lampe** si l'éclairage est faible (si supporté par votre téléphone)
- **⚡ Mode rafale** : la caméra reste ouverte et chaque livre est ajouté d'affilée — idéal pour saisir une pile
- **📦 Mode rangement** : indiquez « Meuble X, Étagère Y » une fois, puis scannez toute l'étagère : chaque livre est rangé automatiquement

## 📲 Usage PC + mobile ensemble

Chaque appareil a sa propre base locale. Pour partager la bibliothèque :
1. Sur l'appareil source : menu ☰ → **💾 Export JSON**
2. Transférez le fichier (mail, cloud…)
3. Sur l'autre appareil : menu ☰ → **📥 Importer JSON** → **fusion intelligente** (aucun doublon, les fiches sont complétées)

> Sur mobile, restez en mode « couvertures par URL » (défaut) : l'option « couvertures embarquées » consomme du stockage et iOS purge le stockage des apps peu utilisées. Pensez aux exports JSON réguliers.
