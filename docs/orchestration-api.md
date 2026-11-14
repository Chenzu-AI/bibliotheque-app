# Guide d'orchestration API — où chercher les infos par média

> Source de vérité (livré par l'IA-documentalist, v1). L'appli pré-remplit déjà via : Open Library, Google Books, BnF, Fnac, MusicBrainz, TMDB, IGDB. Ce document définit la cascade cible et les sources à ajouter (AniList, BGG, Wikidata fallback).

## 1. Principe : l'orchestration en cascade

```
Identifiant (ISBN, EAN, DOI, titre)
    ↓
Source primaire (spécialisée média)
    ↓
Si complétude < 80 % → Source secondaire (généraliste)
    ↓
Si complétude < 80 % → Source tertiaire (Wikidata)
    ↓
Fiche pré-remplie, à valider humainement
```

**Règle d'or : l'IA ne génère rien. Elle orchestre des appels API et fusionne les résultats** (architecture retrieval-constrained déjà en place : sources avant IA).

## 2. Les sources par média (priorité décroissante)

| Média | Source 1 | Source 2 | Source 3 | Notes |
|---|---|---|---|---|
| 📚 Livres | BnF SRU (gratuit, illimité) | Google Books (1 000 req/j) | Open Library | Sudoc = complément académique |
| 🎨 BD | BnF SRU | Wikidata (scénariste + dessinateur) | Google Books | ⚠️ BD Gest'/Bedetheque : pas d'API, ne pas scraper |
| Comics | Comic Vine (200 req/h) | GCD (dump XML) | — | — |
| 🍙 Mangas | BnF SRU | **AniList** (gratuit, GraphQL — démographie, genres, synopsis, couverture) | Jikan/MyAnimeList, Kitsu | **AniList = meilleure source manga, À AJOUTER** |
| 🎬 Films | TMDB (référence, /find via IMDb) | OMDb (1 000 req/j) | DVDFr (fiche technique FR : zone, pistes audio — unique pour éditions FR) | IMDb datasets TSV = dump offline |
| 📺 Séries | TMDB | TVmaze (gratuit illimité, saisons/épisodes) | TheTVDB | — |
| 🎵 Musique | MusicBrainz (relais, 1 req/s, barcode) | **Discogs (✅ v2.35.3 : fallback barcode+titre, throttle 1/s, token 🔑, carriers mappés)** | Deezer (backlog) | Cover Art Archive pour les pochettes |
| 🎮 JV | IGDB (OAuth Twitch, 4 req/s, barcode, PEGI) | RAWG (20 req/min) | Steam API | IGDB déjà implémenté |
| 🎲 JDS | **BGG XML API2** (gratuit, ~1 req/s, cache indispensable) | — | — | **BGG = seule source sérieuse, À AJOUTER** (token Bearer depuis juillet 2025, 1 req/5s) |
| 📰 Presse | BnF SRU (ISSN) | Sudoc | ISSN Portal (payant) | Pas d'API gratuite exhaustive presse FR |
| 🎼 Partitions | BnF SRU (ISMN) | IMSLP (dump, pas d'API) | MusicBrainz works (opus) | — |
| 🗺️ Cartes | BnF SRU | Gallica IIIF (ARK) | OldMapsOnline | — |
| 📷 Patrimoniaux | Gallica IIIF | Europeana | POP / Joconde | — |
| 🎓 Thèses | theses.fr (exhaustif FR) | HAL | Sudoc | — |
| 💾 RNU | CrossRef (DOI) | OpenAlex | Unpaywall | — |
| 💻 Logiciels | Wikidata | GitHub API | — | — |

## 2bis. Stratégie de fallback complète par média (source primaire → fallback 1 → 2 → 3)

✅ = implémenté · ⏳ = backlog · Règles : cascade avec arrêt à 80 % de complétude, fusion non destructive (la primaire gagne), Wikidata en dernier recours, timeout 5 s/niveau, pas de fallback pour JDS (BGG unique) et ADA (saisie manuelle).

| Média | Source primaire | Fallback 1 | Fallback 2 | Fallback 3 |
|---|---|---|---|---|
| LIV | ✅ BnF SRU (RAMEAU) | ✅ Google Books (description, couverture) | ✅ Open Library (ISBN alternatif) → ✅ Banque → ✅ Relais FR | ✅ Wikidata |
| BD | ✅ BnF SRU | ✅ Google Books | ⏳ Wikidata (scénariste/dessinateur) | — |
| MAN | ⏳ AniList ✅ (titre) · BnF (ISBN) | ⏳ Jikan/MyAnimeList | ✅ BnF SRU | ✅ Wikidata |
| FIL | ✅ TMDB (casting, synopsis) | ⏳ OMDb | ⏳ DVDFr (éditions FR : zone, pistes) | ✅ Wikidata |
| SER | ✅ TMDB (saisons/épisodes) | ⏳ TVmaze | ⏳ TheTVDB | ✅ Wikidata |
| MUS | ✅ MusicBrainz (relais, barcode) | ✅ Discogs (vinyles, pressages) | ⏳ Deezer (UPC) | ✅ Wikidata |
| JV | ✅ IGDB (PEGI, plateformes) | ⏳ RAWG | ⏳ Steam API | ✅ Wikidata |
| JDS | ✅ BGG (unique source sérieuse) | — (saisie manuelle si échec) | — | Wikidata (rare) |
| PRE | ✅ BnF SRU (ISSN) | ⏳ Sudoc SRU | ❌ ISSN Portal (payant) | ✅ Wikidata |
| PAR | ✅ BnF SRU (ISMN) | ⏳ MusicBrainz works (opus) | ⏳ IMSLP (dump) | ✅ Wikidata |
| CAR | ✅ BnF SRU | ⏳ Gallica IIIF | ⏳ OldMapsOnline | ✅ Wikidata |
| PHO/EST/AFF/MSN | ⏳ Gallica IIIF | ⏳ Europeana | ⏳ POP / Joconde | ✅ Wikidata |
| THE | ⏳ theses.fr (exhaustif FR) | ⏳ HAL | ✅ BnF/Sudoc | ✅ CrossRef (si DOI) |
| RNU | ✅ CrossRef (DOI, articles/revues) | ⏳ OpenAlex | ⏳ Unpaywall | ✅ Wikidata |
| LOG | ⏳ Wikidata SPARQL | ⏳ GitHub API | — | — |
| ADA | Saisie manuelle (aucune API dédiée) | BnF (si édition adaptée existe) | — | — |

## 3. Wikidata — la source transversale (fallback universel)

- Endpoint SPARQL public : `https://query.wikidata.org/sparql` (CC0, pas de clé)
- ~1 req/s, User-Agent identifiable obligatoire
- Multilingue, liens vers BnF/VIAF/IMDb/MusicBrainz/TMDB
- **Usage : fallback quand la source spécialisée renvoie null** (backlog post-20-fiches)

```sparql
SELECT ?title ?authorLabel ?publisherLabel ?date WHERE {
  ?book wdt:P212 "9782344051238" ; wdt:P1476 ?title .
  OPTIONAL { ?book wdt:P50 ?author . }
  OPTIONAL { ?book wdt:P123 ?publisher . }
  OPTIONAL { ?book wdt:P577 ?date . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}
```

## 4. Règles d'orchestration (fusion non destructive)

1. **Ne jamais écraser** un champ déjà rempli par une source antérieure (priorité de la cascade)
2. **Timeout 5 s** par source (Promise.race), sinon la source lente bloque tout
3. **Arrêt à 80 % de complétude** (champs obligatoires du medium remplis)
4. **Cache local par identifiant, TTL 30 j** (IndexedDB côté PWA — SQLite non applicable, pas de node)
5. **Rate limiting strict** : MusicBrainz 1 req/s (obligatoire), BnF ~1 req/s, BGG 1 req/5s, TMDB 40 req/10s
6. **User-Agent descriptif** pour BnF/MusicBrainz/Wikidata (sinon 503)
7. **Champs manquants → null explicite**, jamais d'invention

## 5. Mapping champ → source prioritaire

| Champ | Primaire | Fallback |
|---|---|---|
| title | BnF (FR), TMDB, AniList | Google Books, Wikidata |
| creator | BnF, TMDB, IGDB | Wikidata |
| publisher | BnF, TMDB (studio), Discogs (label) | Wikidata |
| publishedDate | BnF, TMDB, IGDB | Wikidata |
| langue | BnF, TMDB | Wikidata |
| genre | TMDB, AniList, IGDB | BGG, Wikidata |
| description | TMDB, Google Books, AniList | Wikidata |
| couverture | Google Books, TMDB, AniList, IGDB | Cover Art Archive |
| casting | TMDB, TVmaze | Wikidata |
| saisons/épisodes | TMDB, TVmaze | — |
| pistes | MusicBrainz, Discogs | Deezer |
| plateforme/PEGI (JV) | IGDB | — |
| joueurs/âge/durée (JDS) | BGG | — |
| sujets RAMEAU | BnF SRU | — |

## 6. Légal

✅ Autorisé : BnF, Sudoc, Gallica, theses.fr (APIs publiques officielles) · TMDB, IGDB, MusicBrainz, Discogs, BGG, AniList, TVmaze (CGU claires) · Wikidata (CC0) · CrossRef/OpenAlex/Unpaywall (open data)

❌ Interdit : scraper BD Gest', Bedetheque, Manga-News, Allociné, IMDb (CGU) · contourner les rate limits · identifiants personnels vers APIs non conformes RGPD

## 7. Priorisation bibliothèque personnelle

**Déjà implémenté** : BnF, Google Books, Open Library, Fnac, MusicBrainz, TMDB, IGDB — soit 6 des 7 sources couvrant 90 % des besoins.

**Implémentés en v2.35.0** : AniList (mangas), BGG XML API2 (jeux de société, token Bearer obligatoire), Wikidata SPARQL (fallback cascade livres).

**Selon besoins ultérieurs** : Gallica (patrimonial), theses.fr (thèses), CrossRef/OpenAlex (articles), TVmaze (complément séries), DVDFr (fiches techniques FR des éditions DVD/BR).

**Hors périmètre (confirmé)** : ONIX, OAI-PMH, BIBFRAME, SIGB.

## 8. Clés API — état et procédures

| API | Clé ? | État dans l'appli | Procédure |
|---|---|---|---|
| BnF SRU | ❌ | ✅ implémenté | Endpoint public |
| Google Books | ⚠️ optionnelle | ✅ implémenté (clé dans ☰→🔑) | Google Cloud Console → Books API |
| TMDB | ✅ | ✅ implémenté (clé dans ☰→🔑) | themoviedb.org → Settings → API → Developer |
| IGDB | ✅ (Twitch OAuth) | ✅ implémenté (id+secret dans ☰→🔑, token ~60 j auto) | dev.twitch.tv/console/apps → Confidential → POST id.twitch.tv/oauth2/token |
| MusicBrainz | ❌ (User-Agent) | ✅ implémenté | User-Agent descriptif obligatoire |
| AniList | ❌ | ✅ implémenté (v2.35.0, retrieval-constrained) | GraphQL public, 90 req/min |
| BGG | ✅ (Bearer) | ✅ implémenté (v2.35.0, throttle 1/5s, token dans ☰→🔑) | boardgamegeek.com/applications → token, 1 req/5s — OBLIGATOIRE depuis 07/2025 (API refuse sans) |
| Wikidata | ❌ | ✅ implémenté (v2.35.0, fallback cascade livres, throttle 1/s) | query.wikidata.org/sparql, origin=* |

**Stockage** : les clés restent dans le ☰→🔑 de l'appli (localStorage, côté client uniquement — pas de serveur). Ne jamais les committer.
