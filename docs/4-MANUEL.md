# 📖 Manuel d'utilisation

Guide complet, pas à pas. Les fiches **1-INSTALLATION-PC** et **2-INSTALLATION-MOBILE** expliquent l'installation.

---

## Premiers pas

1. Ouvrez l'application (menu Démarrer / écran d'accueil)
2. Appuyez sur **📷 Scanner** (mobile) ou saisissez un **ISBN** dans la barre du bas (PC)
3. La fiche se crée avec couverture, résumé, références — cliquez sur la couverture pour tout modifier

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
