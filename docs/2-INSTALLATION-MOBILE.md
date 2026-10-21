# 📱 Fiche d'installation — Mobile (Android / iPhone)

**Ma Bibliothèque** s'installe sur l'écran d'accueil du téléphone comme une vraie application, avec accès à la **caméra pour scanner**.

## Prérequis
- Android (Chrome) ou iPhone (Safari, iOS 16.4+ recommandé)
- L'application hébergée sur une adresse **HTTPS** (obligatoire pour la caméra)

---

## Étape 0 — ✅ C'EST DÉJÀ FAIT ! L'app est en ligne

**URL de l'application : https://chenzu-ai.github.io/bibliotheque-app/**

Architecture en place (tout est déjà configuré et automatique) :

```
Dépôt privé  Chenzu-AI/Bibliotheque       ← référence complète (code + documentation)
        │  à chaque mise à jour (push)
        ▼  synchronisation automatique (GitHub Actions)
Dépôt public Chenzu-AI/bibliotheque-app   ← miroir d'hébergement
        │
        ▼
https://chenzu-ai.github.io/bibliotheque-app/   ← l'application en ligne
```

> Chaque mise à jour de l'application publiée dans le dépôt privé apparaît automatiquement sur l'URL en ligne ~2 minutes après. Rien à faire.
> 🔒 **Confidentialité** : le site public ne contient que le **logiciel**, jamais vos données. Vos livres, notes et prêts restent dans le navigateur de chaque appareil.

**Passez directement à l'Étape 2** (installation sur votre téléphone) ci-dessous.

---

## Étape 1 — (Référence) Héberger l'app soi-même

Si un jour vous voulez héberger l'application ailleurs :

- **GitHub Pages** : dépôt → **Settings** → **Pages** → Source : *Deploy from a branch* → `main` / `/ (root)` → **Save** → l'app est servie sur `https://VOTRE-COMPTE.github.io/NOM-DU-DEPOT/`. ⚠️ Le site Pages est toujours public (même depuis un dépôt privé) — d'où l'architecture miroir (privé pour le code, public pour l'hébergement)
- **Netlify Drop** : [app.netlify.com/drop](https://app.netlify.com/drop) → glissez-déposez le dossier complet → adresse du type `https://ma-bibliotheque.netlify.app`
- Autres : Vercel, Cloudflare Pages — tous gratuits

> ⚠️ N'oubliez pas : les données sont stockées **dans le navigateur de chaque appareil**. Le site hébergé ne stocke rien lui-même (pas de compte, pas de serveur de données).

## Étape 2 — Installer sur Android

1. Ouvrez **https://chenzu-ai.github.io/bibliotheque-app/** dans **Chrome**
2. Menu ⋯ → **« Ajouter à l'écran d'accueil »** (ou bandeau « Installer l'application » s'il apparaît)
3. L'icône apparaît sur l'écran d'accueil → l'app s'ouvre **plein écran, sans barre de navigateur**

## Étape 2 (iPhone) — Installation sur iOS

1. Ouvrez **https://chenzu-ai.github.io/bibliotheque-app/** dans **Safari**
2. Bouton **Partager** (carré avec flèche) → **« Sur l'écran d'accueil »**
3. Nommez l'app → **Ajouter** → l'icône apparaît

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

L'URL **https://chenzu-ai.github.io/bibliotheque-app/** fonctionne aussi sur PC (Edge/Chrome → icône ⊕ Installer) — sans serveur local : le HTTPS de GitHub Pages permet l'installation en application Windows et même le scan par webcam.

Chaque appareil a sa propre base locale. Pour partager la bibliothèque :
1. Sur l'appareil source : menu ☰ → **💾 Export JSON**
2. Transférez le fichier (mail, cloud…)
3. Sur l'autre appareil : menu ☰ → **📥 Importer JSON** → **fusion intelligente** (aucun doublon, les fiches sont complétées)

> Sur mobile, restez en mode « couvertures par URL » (défaut) : l'option « couvertures embarquées » consomme du stockage et iOS purge le stockage des apps peu utilisées. Pensez aux exports JSON réguliers.
---
*Ma Bibliothèque — Création AlphaPrim*
