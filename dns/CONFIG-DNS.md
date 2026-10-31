# Configuration DNS PrimAlph — guide de branchement des domaines

Objectif : vos domaines (primalph.com / .fr / .lu / .eu / .app / .ai) pointent vers
l'app et les vitrines hébergées **gratuitement** sur GitHub Pages.

## Architecture cible

```
primalph.com  ──┐
primalph.fr   ──┤
primalph.lu   ──┼──► https://chenzu-ai.github.io/bibliotheque-app/  (l'app)
primalph.eu   ──┘        + site/public.html (vitrine) + site/pro.html (PRO)

primalph.app  ──► (plus tard) hub des 6 applications PrimAlph
primalph.ai   ──► (plus tard) page IA / projet IA locale
```

## Étape 1 — Activer le domaine personnalisé dans GitHub (UNE fois)

1. GitHub → dépôt `bibliotheque-app` → **Settings → Pages**
2. Champ **Custom domain** : saisir `primalph.com` → Save
3. GitHub crée automatiquement le fichier CNAME → attendre « DNS check » ✅
4. Cocher **Enforce HTTPS** (attendre ~15 min que le certificat se génère)

## Étape 2 — Configuration OVH (chaque domaine, 5 min)

Dans l'espace client OVH → Domaines → primalph.com → onglet **Zone DNS** :

### Pour primalph.com, primalph.fr, primalph.eu (domaine principal + redirections) :

| Type | Sous-domaine | Cible | TTL |
|---|---|---|---|
| **A** | (vide) | `185.199.108.153` | 3600 |
| **A** | (vide) | `185.199.109.153` | 3600 |
| **A** | (vide) | `185.199.110.153` | 3600 |
| **A** | (vide) | `185.199.111.153` | 3600 |
| **CNAME** | www | `chenzu-ai.github.io` | 3600 |

*(Les 4 adresses IP sont les serveurs GitHub Pages officiels — IPv6 facultatives :
`2606:50c0:8000::153` à `...8003::153`.)*

### Pour primalph.lu, primalph.app, primalph.ai (alias de marque) :

| Type | Sous-domaine | Cible |
|---|---|---|
| **CNAME** | (vide) ou redirection | `primalph.com` |
| **CNAME** | www | `primalph.com` |

*(Plus simple : OVH propose une redirection web transparente
www.primalph.lu → primalph.com — onglet « Redirections » du domaine.
Pratique pour .lu/.app/.ai qui ne servent que d'alias.)*

### Option email (gratuite) — pour contact@primalph.lu :

OVH → Domaine primalph.lu → **Emails → Redirections** :
- Créer `contact@primalph.lu` → redirige vers votre adresse personnelle
- Idem `contact@primalph.com`, `contact@primalph.fr` (une par domaine, gratuit)

## Étape 3 — Vérification (30 min après)

Vérifier avec un outil en ligne (dnschecker.org, whatsmydns.net) :
- `primalph.com` doit résoudre vers `185.199.108-111.153`
- `www.primalph.com` doit résoudre vers `chenzu-ai.github.io`
- Puis dans le navigateur : `https://primalph.com` → l'app s'ouvre ✅

## Délais de propagation

- .com/.fr/.eu : **15 min à 4 h** généralement
- .lu : jusqu'à 24 h (registry luxembourgeoise plus lente)
- .app/.ai : HTTPS forcé par nature — fonctionnent dès que le CNAME propage

## Notes importantes

- **Le domaine personnalisé se configure sur le DÉPÔT PUBLIC** (`bibliotheque-app`),
  pas sur le privé — c'est lui qui sert les pages
- Si un jour vous migrez vers le dépôt de la S.à r.l.-S : rechanger le CNAME dans
  Settings → Pages du nouveau dépôt (2 min), les DNS ne bougent pas
- La config ci-dessus reste dans la zone DNS gratuite d'OVH
