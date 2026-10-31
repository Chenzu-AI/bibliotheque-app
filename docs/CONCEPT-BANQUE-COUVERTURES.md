# 🖼️ Concept de la banque de couvertures — document de conception (PRIVÉ)

*Réponse aux questions : fond 10 000+ couvertures, gratuit vs pro, partage par fiche vs tout le fond, dédoublonnage et variantes.*

---

## 1. Le concept amélioré : une banque à deux étages

### Étage 1 — le fond de couverture communautaire (le « fond »)

**Ce que c'est** : le dossier `covers/` servi par URL brute (`raw.githubusercontent.com`), interrogé **automatiquement** comme dernier recours de reconnaissance. Aucune action utilisateur : on scanne, si aucune source n'a la couverture, la banque répond.

**Alimentation** — deux voies complémentaires :

| Voie | Qui | Comment | Statut |
|---|---|---|---|
| **Partage par fiche** 🤝 (bouton dans chaque fiche) | Tout utilisateur avec un token | Envoie LA couverture de CETTE fiche (utile : ciblé, vous ne partagez que ce que vous avez photographné/importé) | ✅ à implémenter (le bouton n'existait pas encore) |
| **Partage du fond entier** ☁️ (menu, option pro) | Pro | Pousse toutes vos couvertures **dédoublonnées** en une fois — nécessaire pour amorcer le fonds avec vos 10 000+ | ✅ à implémenter |

### Étage 2 — le mécanisme de variantes (la vraie amélioration)

**Le problème posé** : le même livre peut avoir plusieurs couvertures légitimes (poche vs grand format, réédition, collector, 1ʳᵉ édition), et 10 utilisateurs peuvent envoyer la même image 10 fois.

**La solution : nommage par ISBN + variante + empreinte de contenu**

```
covers/
  9782221110003.jpg              ← couverture "par défaut" (1ère reçue, la plus partagée)
  9782221110003-v2.jpg           ← variante (autre édition du même ISBN... non, voir ci-dessous)
  9782505141358.jpg
```

**Règles de résolution** :

1. **Un ISBN = une couverture principale**. Les éditions différentes ont des **ISBN différents** (c'est la définition même de l'ISBN : une édition = un ISBN). Le cas « même livre, couverture différente » se règle donc **naturellement par l'ISBN** : la poche et le grand format ont déjà deux ISBN distincts → deux fichiers distincts. **Il n'y a pas de collision à gérer pour ce cas-là.**

2. **Le même ISBN partagé 10 fois = UNE seule image**. Déduplication par **empreinte de contenu (hash)** : avant l'envoi, l'app calcule un hash du fichier compressé. Si le fichier existe déjà (même taille ± même hash), l'envoi est **ignoré silencieusement** — pas de doublon, pas d'écrasement. C'est le cas de 10 utilisateurs scannant le même best-seller.

3. **Le même ISBN avec deux images réellement différentes** (photographies personnelles d'un même exemplaire, qualité variable) : la **première image reçue gagne** (règle first-wins), car :
   - elle a forcément été validée par un humain (l'import est manuel) ;
   - écraser introduirait le risque de régression (une photo de moindre qualité remplaçant une propre) ;
   - le conflit réel est rare et se règle manuellement (curateur = vous, via le dépôt).

4. **La couverture locale de l'utilisateur prime toujours** : la banque ne remplace JAMAIS une couverture déjà présente dans une fiche — elle ne comble que les **manquantes** (même logique de fusion que les métadonnées : champ vide uniquement).

### Traitement technique d'un partage

```
1. Compression (max 600px, JPEG ~82%)          ← déjà en place (import local)
2. Hash du contenu (empreinte)
3. HEAD sur covers/<ISBN>.jpg dans le dépôt :
   - existe → rien à faire (silence, "déjà dans la banque") 
   - 404 → PUT via l'API GitHub Contents (base64) avec le token
4. Message : "Couverture partagée avec la banque — merci !" ou "Déjà présente"
```

Pour le **fond entier (10 000+)** : boucle avec **respect des limites GitHub** (l'API Contents accepte ~1 écriture/seconde de façon fiable ; le script envoie par lots avec pause, progression affichée). 10 000 images ≈ 3-4 h en arrière-plan — acceptable pour un lancement de nuit, et l'utilisateur peut fermer l'app et reprendre (les fichiers déjà envoyés sont détectés et sautés).

## 2. Gratuit ou Pro ? — ma recommandation

| Fonction | Gratuit | PRO 19 €/mois | Justification |
|---|---|---|---|
| **Consulter la banque** (le fond sert les couvertures automatiquement au scan) | ✅ | ✅ | L'effet réseau ne fonctionne que si tout le monde en profite — restreindre la lecture tuerait la banque |
| **Partage par fiche** 🤝 (bouton dans la fiche) | ✅ | ✅ | Acte volontaire, ponctuel, utile — c'est la contribution citoyenne qui alimente le fonds |
| **Partage du fond entier** ☁️ (10 000+ d'un coup) | ❌ | ✅ | C'est LA contribution de valeur d'un professionnel : un libraire qui verse son catalogue complet enrichit la banque plus que 1 000 particuliers. C'est aussi la fonction qui consomme des ressources (heures d'upload) — logique pro |

**La logique** : le gratuit **donne et reçoit au coup par coup** (équité), le pro **donne massivement et finance l'infrastructure**. Et pour un libraire, verser son fonds est même un argument d'adoption : « ma vitrine a des couvertures partout grâce à moi ».

**Régime juridique** (rappel du mémoire) : la banque reste **privée** (dépôt Bibliotheque, accès par token/URL interne) tant qu'il n'y a pas de validation juridique du modèle public. La mention « retrait sur demande de l'éditeur » s'appliquera au passage public.

## 3. Où est le fond ? — décision d'architecture

**Recommandation : `covers/` du dépôt PRIVÉ, servi via le miroir public.**

- Le dossier `covers/` est **exclu de l'exclusion** — c'est-à-dire qu'il FAUT le publier sur le miroir pour que les URL `raw.githubusercontent.com/bibliotheque-app` fonctionnent sans token ;
- Donc : dépôt privé = source de vérité + couvertures ajoutées par les tokens des contributeurs → sync automatique → miroir public les sert au monde entier via l'URL banque déjà pré-remplie ;
- Taille : 10 000 couvertures ≈ 600 Mo — GitHub Pages conseille <1 Go : **on est dans les clous jusqu'à ~16 000 images** ; au-delà (cinquième étape du mémoire) : migration Cloudflare R2 (10 Go gratuits), simple changement d'URL dans la modale 🔑.

## 4. Ce qui est implémenté dans cette session

- ✅ Banque branchée comme dernier recours des couvertures (`fetchCoverFallback`) avec l'URL configurable
- ✅ Bouton 🤝 « Partager avec la banque » sur chaque fiche (partage individuel, dédoublonné, gratuit)
- ✅ Mode pro « partager tout le fond » (menu, garde `guardPro` — désactivé jusqu'au verrouillage)
- ✅ Déduplication par existence (HEAD) + hash de contenu
- ✅ La couverture locale n'est jamais écrasée par la banque

## 5. Reste à décider par vous

1. **Confirmer gratuit/pro tel quel** (consultation libre + partage fiche gratuit ; partage fond = pro) ;
2. **Premier versement** : quand vous voudrez amorcer le fonds avec vos 10 000 couvertures, il faudra (a) activer « couvertures embarquées » sur PC, (b) lancer le partage du fond — une nuit de traitement ;
3. **Curateur** : vous êtes le curateur (validation visuelle du dépôt via GitHub) — rôle naturel de l'éditeur.

---
*PrimAlph — document interne.*

## 6. Extension : la banque de FICHES (v2.4)

Le même dossier héberge un second fond : `covers/fiches/<ISBN>.json` — **une fiche complète éditée par un humain** (résumé FR vérifié, genre, Dewey, 4ᵉ de couverture, éditeur…). Une fiche ainsi peaufinée vaut mieux qu'une notice BnF brute : c'est le vrai différenciateur du fonds français.

- **Export automatiquement dépersonnalisé** : la liste `PERSONAL_FIELDS` retire prêts, historique, notes, note étoilée, favoris, souhaits, file de lecture, prix payé, acquisition, cession, réservation, étagères, tags, emplacement — **aucune donnée personnelle ne sort jamais** ;
- **Consultation automatique** en dernier recours du scan (compensation du gratuit : chacun reçoit le fonds sans rien faire) ;
- **Partage manuel** 📝 par fiche (l'humain valide ce qu'il publie — cohérent avec le positionnement privacy-first) ;
- **Partage du fond de fiches entier** : pro (même logique que les couvertures).

Règles de conflit : un champ déjà rempli n'est jamais écrasé (même fusion champ-par-champ que les catalogues) ; la version la plus récente écrase l'ancienne à l'upload (sha GitHub) — la communauté affine les fiches au fil du temps, comme un wiki contrôlé par ISBN.
