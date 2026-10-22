# 📚 Fiche de présentation — Fonctionnalités

**Ma Bibliothèque** — gestion de bibliothèque personnelle : livres, BD, mangas. Application web installable (PC + mobile), 100 % locale et privée, sans compte ni abonnement.

---

## 📷 Saisie des ouvrages
- **Scan de codes-barres** (EAN-13/ISBN) par caméra du téléphone
- **Saisie manuelle** d'ISBN, ou **douchette USB** sur PC (saisie instantanée)
- **Sans ISBN** : fiche vierge à compléter (vieux livres, éditions rares)
- **Recherche automatique multi-sources avec fusion** : Open Library (2 APIs) + Google Books + conversion ISBN-10/13 automatique + **relais BnF/Fnac** (micro-service gratuit) + couvertures en secours (2 formats d'ISBN). Chaque source complète les champs manquants des autres — la fiche finale est la plus complète possible
- **🇫🇷 Relais BnF/Fnac** (clé de voûte pour les livres français) : la BnF couvre **tout le dépôt légal français** (idéal pour les livres d'avant 2010, mal indexés dans les bases internationales) ; la Fnac couvre les nouveautés. Déploiement gratuit en 5 min (fichier `worker.js` → Cloudflare Workers), l'URL du relais se colle dans ☰ → 🔑
- **🔑 Clés API personnelles** (menu ☰ → Clés API) : clé Google Books + URL du relais, stockées dans SON navigateur uniquement (jamais dans le code public) — boutons de test intégrés (test de clé + **diagnostic par ISBN** qui montre ce que chaque source répond)
- **Sources activables au choix** (cases à cocher) : Google Books / BnF / Open Library
- **⚡ Scan en rafale** : caméra qui reste ouverte, ajout en chaîne
- **⚠ Détection de doublons** : l'app demande si vous ajoutez un 2ᵉ exemplaire

## 🗂️ Organisation
- **Étagères virtuelles** personnalisées (multi-appartenance) + **tags** libres
- **Localisation physique structurée** : meuble + étagère, avec suggestions automatiques
- **📦 Mode rangement** : scannez une étagère entière, chaque livre est rangé automatiquement au bon endroit
- **Type** (livre / BD / manga), **série + tome**, **scénariste / dessinateur** (BD)
- **Cote Dewey + genre**, tri par cote comme en bibliothèque
- **Statuts** : à lire / en lecture / lu / souhait (à acheter)
- **Favoris ♥** et **notes sur 5 étoiles** avec annotations personnelles
- **Recherche plein texte** (titre, auteur, ISBN, série, tags, genre, emplacement…), filtres et tris multiples
- **Pagination** fluide même avec 50 000 ouvrages

## 👥 Vues par série / auteur
- Regroupements automatiques : **séries, auteurs, scénaristes, dessinateurs**
- **Séries** : tomes possédés, **tomes manquants** (avec ajout direct aux souhaits 🛒), état **« série en cours / complète »**
- **📍 Détection de dispersion** : si une série est rangée à plusieurs endroits, alerte au scan + emplacements affichés dans la vue séries

## 📤 Prêts (comme une vraie bibliothèque)
- Enregistrement des prêts : emprunteur, date, **retour prévu**
- **Retards signalés** en rouge
- **Historique complet par emprunteur** (conservé après les retours) : prêts en cours, prêts rendus, nombre total

## 🔎 Inventaire d'étagère (récolement)
- Rescanner une étagère : l'app compare en direct le scanné et l'attendu
- ✅ Confirmés · ⚠ **Intrus** (censés être ailleurs — « Le ranger ici » en 1 clic) · ❌ **Manquants** · ❓ **Inconnus** (« L'intégrer » les ajoute)
- **📜 Historique des inventaires** : dater chaque récolement, suivre l'évolution

## 🤖 IA intégrée (optionnelle)
- **Recherche en langage naturel** : « les polars des années 90 notés 4+ »
- **Complétion de fiches** : résumé, genre, cote Dewey générés par IA
- Compatible **API** (Mistral, OpenAI…, clé stockée localement) ou **Ollama local** (gratuit, privé)

## 💾 Sauvegardes et échanges
- **Sauvegarde auto** tous les N scans (réglable) + sauvegarde immédiate
- **Exports** : **JSON** (complet, avec étagères/listes/couvertures), **CSV** (Excel), **HTML** imprimable, **Markdown** (Obsidian, Notion, GitHub)
- **Import JSON fusionnant** : ajoute les nouveautés, met à jour l'existant, aucun doublon
- **Listes sauvegardées dynamiques** : mémorisent vos filtres (ex. liste d'achats qui se vide au fur et à mesure)
- **Couvertures embarquées** (option PC) : images stockées dans l'app, visibles hors-ligne à vie

## 📊 Statistiques
- Total, auteurs, éditeurs, note moyenne, statuts, prêts, favoris
- **Répartition par emplacement** (barres de chaleur)
- **Courbe des ajouts** dans le temps (12 mois) · **Top auteurs**

## 🏷️ Édition avancée
- **Étiquettes de cote imprimables** (50×30 mm) : Dewey, emplacement, titre — prêtes à coller
- **☑ Sélection multiple** : modifier statut/étagère/genre/emplacement de N ouvrages d'un coup
- **Fiche complète éditable** : couvertures devant/dos, résumé, toutes les références

## 🔒 Technique
- Application web progressive (PWA) — fonctionne **hors-ligne** après installation
- Données **100 % locales** (IndexedDB) : aucun compte, aucun serveur, aucune donnée envoyée
- **Mises à jour automatiques** : architecture dépôt privé → miroir public → site en ligne ; chaque évolution se propage seule
- Bouton **⬇️ Installer** intégré à l'interface (Android/PC) ; sur iPhone, installation via le menu Partager de Safari
- Léger (~100 Ko), aucun framework, aucune dépendance à installer
---
*Ma Bibliothèque — Création AlphaPrim*
