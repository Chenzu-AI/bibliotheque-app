# 📚 Fiche de présentation — Fonctionnalités

**Ma Bibliothèque** — gestion de bibliothèque personnelle : livres, BD, mangas. Application web installable (PC + mobile), 100 % locale et privée, sans compte ni abonnement.

---

## 📷 Saisie des ouvrages
- **Scan de codes-barres** (EAN-13/ISBN) par caméra du téléphone
- **Saisie manuelle** d'ISBN, ou **douchette USB** sur PC (saisie instantanée)
- **Sans ISBN** : fiche vierge à compléter (vieux livres, éditions rares)
- **Recherche automatique multi-sources avec fusion** (avec **cache local 30 jours** par ISBN : les mises à jour re-cliquées sont instantanées et gratuites) : Open Library (2 APIs) + Google Books + **catalogue BnF en direct** + conversion ISBN-10/13 automatique + **relais BnF/Fnac** (micro-service gratuit) + couvertures en secours (2 formats d'ISBN). Chaque source complète les champs manquants des autres — la fiche finale est la plus complète possible
- **Indicateur de sources par fiche** : chaque fiche affiche les sources qui l'ont renseignée (ex. « sources : Google Books, BnF, Relais FR ») + **🔍 bouton Diagnostiquer** : ce que chaque source répond pour CET ISBN précis
- **🤝 Banque communautaire (fiches + couvertures)** : au scan, si les catalogues échouent, le fond partagé par les utilisateurs répond en dernier recours. Partage volontaire par fiche (📝 métadonnées uniquement — prêts, notes, prix payé et toute donnée personnelle automatiquement exclus) ; à la sauvegarde d'une fiche complétée, l'app propose « Partager au fond communautaire ? » (Oui/Non + se souvenir de mon choix) ; le partage du fond entier est une fonction PRO
- **🇫🇷 Relais BnF/Fnac** (dernier recours du relais : le **Sudoc** — catalogue universitaire — pour les ouvrages académiques et anciens)

**🇫🇷 Relais BnF/Fnac** (clé de voûte pour les livres français) : la BnF couvre **tout le dépôt légal français** (idéal pour les livres d'avant 2010, mal indexés dans les bases internationales) ; la Fnac couvre les nouveautés. Déploiement gratuit en 5 min (fichier `worker.js` → Cloudflare Workers), l'URL du relais se colle dans ☰ → 🔑
- **🔑 Clés API personnelles** (menu ☰ → Clés API) : clé Google Books + URL du relais, stockées dans SON navigateur uniquement (jamais dans le code public) — boutons de test intégrés (test de clé + **diagnostic par ISBN** qui montre ce que chaque source répond)
- **Sources activables au choix** (cases à cocher) : Google Books / BnF / Open Library
- **⚡ Scan en rafale** : caméra qui reste ouverte, ajout en chaîne
- **📷 Photo d'étagère IA** : une photo paysage → l'IA lit les tranches **rangée par rangée** (rangées numérotées automatiquement : « Étagère 1, 2, 3… ») et compare à votre collection : ✅ bien rangés · ⚠ mal placés (bouton « Ranger ici ») · ❓ inconnus (recherche et ajout en 1 clic)
- **⚠ Détection de doublons** : l'app demande si vous ajoutez un 2ᵉ exemplaire
- **🧪 Bibliothèque de démonstration** : au premier lancement sur une bibliothèque vide, 6 ouvrages d'exemple peuvent être chargés pour tout découvrir en 1 minute (supprimables d'un coup)

## 🗂️ Organisation
- **Étagères virtuelles** personnalisées (multi-appartenance) + **tags** libres
- **Localisation physique structurée** : meuble + étagère, avec suggestions automatiques
- **📦 Mode rangement** : scannez une étagère entière, chaque livre est rangé automatiquement au bon endroit
- **⚠ Regroupement de série en 1 clic** : au scan d'un tome dont la série est dispersée, l'app propose de rassembler TOUS les tomes vers un seul emplacement (défaut = celui du tome courant) — emplacements multiples signalés, déplacements comptés
- **📐 Photo d'étagère : positions** : indiquez votre compte de « livres par rangée » (l'IA vérifie le sien), chaque livre détecté porte sa position [n] depuis la gauche, et une section **Conseils de rangement** détecte les suites complètes, les tomes manquants, les désordres et les insertions suspectes
- **Type** (livre / BD / manga), **série + tome**, **scénariste / dessinateur** (BD)
- **Cote Dewey + genre**, tri par cote comme en bibliothèque
- **Champs bibliophiles** : **collection éditoriale** (Folio, Pléiade… avec suggestions), **format** (broché, poche, relié…), **type d'édition** (standard, **1ʳᵉ édition, collector/limitée, rare, incunable**), **prix éditeur**, **public** — badges sur les couvertures (⭐ collector, 💎 rare…)
- **Valeur catalogue** : statistique totale des prix éditeurs (estimation d'assurance) + décompte des éditions remarquables
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
- **Photo d'étagère** : lecture des tranches par vision IA (modèle vision requis : Pixtral, GPT-4o, llama3.2-vision…)
- **Complétion de fiches** : résumé, genre, cote Dewey générés par IA
- Compatible **API** (Mistral, OpenAI…, clé stockée localement) ou **Ollama local** (gratuit, privé)

## 💾 Sauvegardes et échanges
- **Sauvegarde auto** tous les N scans (réglable) + sauvegarde immédiate
- **☁️ Sauvegarde cloud GitHub (privée)** : pousse la bibliothèque complète dans **votre dépôt GitHub privé** (fichier versionné, historique des versions inclus) — la récupération fusionne intelligemment (aucun écrasement). Votre jeton personnel reste dans votre navigateur ; les données ne transitent jamais par un serveur tiers. Idéal multi-appareils : push depuis le PC, pull depuis le mobile
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
- **Fiche complète éditable** : couvertures devant/dos, résumé, **texte de 4ᵉ de couverture** (le meilleur résumé pour les éditions FR), toutes les références

## 📖 Suivi de lecture
- **Objectif annuel** 🎯 : X livres/an avec progression et rythme nécessaire
- **File « à lire ensuite »** et **🎲 choix aléatoire** du prochain livre
- **Position de lecture** : page courante → progression en % avec barre d'avancement
- **Journal de lecture daté** : notes horodatées au fil de la lecture
- Fin de lecture **horodatée automatiquement** → statistiques annuelles (pages lues, heures estimées, moyenne/livre)

## 💼 Cycle de vie des livres
- **Acquisition** : date, lieu/origine, prix payé
- **Emprunts inverses** : « ce livre vient de… » (traces de qui vous l'a prêté)
- **Cession** : vendu / donné / perdu / prêté non rendu, avec date et prix — la fiche reste, le livre sort des vues actives
- **Valeur catalogue** (prix éditeur cumulés) et comparaison payé/vaut possible via les exports

## 📥 Import
- **JSON** (fusion intelligente sans doublons) · **CSV** (Libib, CLZ, Excel — colonnes titre/auteur/ISBN/statut reconnues, FR ou EN)
- **UNIMARC / ISO 2709** : reprise de fonds depuis un SIGB professionnel (Koha, PMB…) — les notices 010/200/210/215/330/690/910 sont converties en fiches et fusionnées

## 🏛️ Interopérabilité professionnelle
- **📤 Export UNIMARC** (ISO 2709, compatible Koha/PMB)
- **📤 Export MARC21 XML** (format international des SIGB)
- **📥 Import UNIMARC** : reprise d'un catalogue professionnel existant
- **🏷️ Étiquettes QR** : scan QR = fiche ouverte instantanément

## ⚡ Actions sur l'affichage
- **⚡ Actions** (barre d'outils) : agit sur le filtre courant **ou sur la sélection ☑** (prioritaire) — Compléter par IA · Mettre à jour sources · Diagnostiquer · Partager couvertures/fiches · Supprimer · Tout sélectionner
- **Menu groupé** : 3 sections (Collection & saisie · Sauvegarder & échanger · Professionnel & réglages) + **recherche de fonction** (tapez « unimarc », « étiquettes »…)

## 🎨 Ergonomie (v2.4)
- **Fiche regroupée** : les actions en 2 sections claires — **Vérifier & compléter** (🔍 Diagnostiquer · 🔄 Mettre à jour · 🤖 Compléter par IA) et **Partager à la banque** (🤝 couverture face/dos · 📝 fiche)
- **Barre de contexte** : dès qu'un filtre/recherche est actif, une barre affiche « X / total affichés » avec accès direct à ⚡ Actions, ☑ Sélection et ✕ Retirer le filtre

## 🔒 Technique
- **🌐 Bilingue FR/EN intégral** : bascule instantanée (bouton 🌐), détection automatique de la langue, choix mémorisé — interface, fiches, Centre d'aide ET messages (confirmations, notifications) traduits
- Application web progressive (PWA) — fonctionne **hors-ligne** après installation, **scanner inclus** (aucune dépendance CDN)
- Données **100 % locales** (IndexedDB) : aucun compte, aucun serveur, aucune donnée envoyée
- **Mises à jour automatiques** : architecture dépôt privé → miroir public → site en ligne ; chaque évolution se propage seule
- Bouton **⬇️ Installer** intégré à l'interface (Android/PC) ; sur iPhone, installation via le menu Partager de Safari
- **❓ Centre d'aide intégré** (bouton en haut) : guide condensé hors-ligne + liens vers la documentation complète
- **Mode sombre automatique** (selon le réglage du système)
- **Accessibilité** : labels sur les boutons, navigation clavier
- **Rappels de prêt** à l'ouverture (retards et retours du jour)
- Léger, aucun framework
---
*Ma Bibliothèque — Création PrimAlph*

> 🇬🇧 **English version**: [`docs/en/`](en/3-FEATURES.md)
