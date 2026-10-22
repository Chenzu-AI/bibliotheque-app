# 📖 Manuel d'utilisation

Guide complet, pas à pas. Les fiches **1-INSTALLATION-PC** et **2-INSTALLATION-MOBILE** expliquent l'installation.

---

## Premiers pas

1. Ouvrez l'application (menu Démarrer / écran d'accueil)
2. Appuyez sur **📷 Scanner** (mobile) ou saisissez un **ISBN** dans la barre du bas (PC)
3. La fiche se crée avec couverture, résumé, références — cliquez sur la couverture pour tout modifier

> 📱 **Sur mobile en mode portrait**, les boutons secondaires de la barre du bas (**➕ Sans ISBN**, **📦 Mode rangement**, **🔎 Inventaire**) sont derrière le bouton **⋯** : un tap pour les afficher.

## 1. Ajouter des ouvrages

| Action | Comment |
|---|---|
| Scanner avec le téléphone | **📷 Scanner** → visez le code-barres au dos du livre |
| Scanner plusieurs d'affilée | Dans la fenêtre scan : **⚡ Mode rafale** → chaque livre s'ajoute sans fermer la caméra |
| Saisir un ISBN | Barre du bas → tapez les chiffres sous le code-barres → **➕ Ajouter** (ou Entrée) |
| Avec une douchette USB | Branchez-la, cliquez dans la barre du bas, scannez chaque livre : saisie + validation automatiques |
| Livre sans code-barres | **➕ Sans ISBN** → fiche vierge → complétez |
| Livre introuvable en ligne | L'app crée la fiche quand même → complétez à la main (ou bouton 🤖 Compléter par IA) |

**Doublons** : si l'ISBN est déjà connu, l'app vous demande « Ajouter quand même (2ᵉ exemplaire) ? ». Les doublons sont marqués ⚠ sur les couvertures.

## 2. Ranger les livres physiquement

### Mode rangement (une étagère entière en 2 minutes)
1. **📦 Mode rangement** (barre du bas)
2. Indiquez le **Meuble** (ex. « Bibliothèque salon ») et l'**Étagère** (ex. « Étagère 4 »)
3. Scannez tous les livres de l'étagère — chacun reçoit l'emplacement automatiquement
4. Re-cliquez **📦** pour arrêter

L'app **suggère** les meubles/étagères déjà connus (listes déroulantes dans les fiches).

### Modifier l'emplacement d'un livre
Ouvrez la fiche (clic sur la couverture) → **Meuble** + **Étagère** → 💾 Enregistrer.

### Alerte de dispersion
Au scan, si le livre appartient à une **série rangée à plusieurs endroits**, l'app vous prévient : « ⚠ Série « X » dispersée ! Ce tome ici, les autres à tel endroit — voulez-vous ouvrir la fiche ? ». La vue **👥 Par série / auteur** affiche les emplacements de chaque série en permanence.

## 3. Organiser la collection

- **Étagères virtuelles** (☰ → 🗂️ Étagères) : groupes libres ( « Polars », «À prêter »…), un livre peut en faire partie de plusieurs — cochées dans sa fiche
- **Fiche d'un ouvrage** : note ★★★★★, annotation, tags, série + tome + état (en cours/complète), scénariste/dessinateur, **cote Dewey + genre**, favori ♥, souhait 🛒, résumé, couvertures devant/dos
- **Recherche** : tapez n'importe quoi (titre, auteur, ISBN, genre, meuble…) — filtrage instantané
- **Filtres** : étagère, statut (à lire / en lecture / lu / souhait / prêté), ★ favoris
- **Tri** : ajout, titre, auteur, note, année, **cote Dewey**
- **Listes dynamiques** (☰ → 📋 Mes listes) : filtrez puis **💾 Sauver cette recherche** — la liste se met à jour toute seule (idéal pour une liste d'achats)

### Sélection multiple (édition en masse)
1. **☑ Sélection multiple** (barre d'outils) → des cases apparaissent
2. Cochez les ouvrages → choisissez le nouveau statut / étagère / genre / emplacement → **Appliquer**

## 4. Gérer les séries

**☰ → 👥 Par série / auteur** : onglets Séries / Auteurs / Scénaristes / Dessinateurs. Pour chaque série :
- tomes possédés · badge *série en cours* / *série complète*
- **tomes manquants** calculés automatiquement (si le nombre total est indiqué) → bouton 🛒 pour les ajouter aux souhaits
- 📍 emplacements de rangement (et alerte si dispersée)

## 5. Prêter un livre

1. Ouvrez la fiche → champ **Prêté à…** + date de retour prévue → 💾
2. Le livre affiche le badge 📤 sur sa couverture
3. **☰ → 📤 Prêts** : prêts en cours (retards en rouge ⚠), bouton **↩ Retour**, et **historique par emprunteur** conservé après retour

## 6. Faire l'inventaire d'une étagère (récolement)

1. **☰ → 🔎 Inventaire d'étagère**
2. Choisissez l'emplacement → **Démarrer l'inventaire** (la caméra se propose automatiquement)
3. Scannez chaque livre de l'étagère, feedback en direct :
   - ✅ **bien rangé ici**
   - ⚠ **Intrus** : censé être ailleurs → **📦 Le ranger ici** ou ignorer
   - ❓ **Inconnu** : pas dans la bibliothèque → **➕ L'intégrer** (ajouté ici avec ses infos)
4. **Terminer** → **bilan** : manquants (avec mention « prêté à… » le cas échéant), intrus, inconnus
5. L'**historique** des inventaires se constitue en bas de page

## 7. Utiliser l'IA (optionnel)

**Configuration** (☰ → 🤖 IA) : fournisseur `api` (clé Mistral/OpenAI) ou `ollama` (local, gratuit).

- **🤖 Recherche IA** (barre d'outils) : décrivez en langage naturel → « les BD de Uderzo non lues rangées au salon »
- **🤖 Compléter par IA** (dans une fiche) : génère résumé, genre, cote Dewey pour les fiches incomplètes

## 7 bis. Optimiser la reconnaissance des livres (clé Google Books + relais BnF/Fnac)

La chaîne de recherche automatique : Open Library → Google Books → conversion ISBN-10 → **relais BnF/Fnac** → couvertures en secours. Deux réglages optionnels la rendent complète :

### A. Clé Google Books (résumés et couvertures, 1000 requêtes/jour gratuites)
1. [console.cloud.google.com](https://console.cloud.google.com) → projet → *API et services* → activer **« Google Books API »** → *Identifiants* → **Créer des identifiants** → **Clé API**
2. **☰ → 🔑 Clés API** → collez la clé → **🧪 Tester** (✅ = clé valide) → **💾 Enregistrer**
3. La clé reste **uniquement dans votre navigateur**. Recommandé : restreindre aux référants `chenzu-ai.github.io/*`

### B. Relais BnF/Fnac (indispensable pour les livres français, surtout d'avant 2010)
Les bases internationales ignorent une partie du fonds français ancien ; la **BnF, elle, a tout** (dépôt légal). Comme un navigateur ne peut pas interroger la BnF directement (CORS), un micro-service gratuit sert de relais :

1. **https://dash.cloudflare.com** → compte gratuit → **Workers & Pages** → Create → **« Commencez avec Hello World ! »** → nommez `biblio-relais` → Deploy
2. **Edit code** → remplacez le code par le fichier **`worker.js`** du dépôt → **Deploy**
3. Testez : `https://biblio-relais.votre-sous-domaine.workers.dev/?isbn=9782221110003` → JSON avec le titre = ✅
4. **☰ → 🔑 Clés API** → champ **« URL du relais français »** → collez l'URL → **💾 Enregistrer**

> Coût : 0 € (100 000 requêtes/jour gratuites). Le worker ne stocke rien ; seuls les ISBN consultés transitent. Sous-domaine personnalisable si vous ne voulez pas votre nom dans l'URL (Workers & Pages → réglages du sous-domaine).

### Diagnostic en cas d'échec
**☰ → 🔑 → « 🔍 Diagnostic d'un ISBN »** : entrez un ISBN → l'app montre ce que **chaque source** répond (y compris l'ISBN-10 converti et le relais). Si tout est ❌ : le livre est absent des catalogues → complétez à la main ou via **🤖 Compléter par IA**.

> 💡 **Rescan d'une fiche incomplète** : l'app complète automatiquement la fiche existante (pas de doublon). Pour un vrai 2ᵉ exemplaire, répondez « Ajouter quand même » quand la fiche est déjà complète.

## 8. Sauvegarder, exporter, restaurer

| Besoin | Action |
|---|---|
| Sauvegarde complète | ☰ → **💾 Sauvegarde immédiate** (JSON) |
| Sauvegarde automatique | ☰ → **⚙️ Sauvegarde auto** → tous les N scans (0 = off) |
| Transférer vers un autre appareil | **💾 Export JSON** → fichier → sur l'autre appareil : **📥 Importer JSON** (fusion sans doublons) |
| Tableur Excel | ☰ → **📄 Export CSV** |
| Catalogue à imprimer/partager | ☰ → **🖨️ Export HTML** |
| Obsidian/Notion/GitHub | ☰ → **📝 Export Markdown** |
| Étiquettes de cote à coller | ☰ → **🏷️ Étiquettes de cote** → imprimer (50×30 mm) |
| Couvertures hors-ligne à vie | ☰ → **🖼️ Couvertures embarquées** (recommandé PC uniquement) |

## 9. Suivre l'activité

**☰ → 📊 Statistiques** : totaux, statuts, prêts, favoris, **répartition par emplacement**, **courbe des ajouts** (12 mois), **top auteurs**.

## 10. Conseils

- **Rythme de sauvegarde** : un export JSON par mois minimum ; rangez-le dans un cloud (OneDrive…)
- **Grande collection** : la pagination (60 par page) garde l'interface fluide ; utilisez recherche + filtres
- **Fiche incomplète après scan** (livre rare) : complétez les champs vides, ou 🤖 Compléter par IA
- **Changement de PC/téléphone** : exportez le JSON **avant** de changer d'appareil
---
*Ma Bibliothèque — Création AlphaPrim*
