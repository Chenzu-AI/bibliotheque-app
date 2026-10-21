# 🖥️ Fiche d'installation — PC (Windows 11)

**Ma Bibliothèque** s'installe sur Windows 11 comme une application autonome, sans store ni exécutable.

## ⭐ Méthode express — depuis l'URL en ligne (30 secondes, recommandée)

L'application est déjà hébergée en HTTPS : **https://chenzu-ai.github.io/bibliotheque-app/**

1. Ouvrez cette URL dans **Edge** ou **Chrome**
2. Icône **⊕ Installer l'application** dans la barre d'adresse → l'app s'installe comme application Windows (menu Démarrer, bureau)
3. **Avantages** : pas de serveur local à lancer, **scan par webcam possible**, mises à jour automatiques du site

> Les méthodes A et B ci-dessous ne servent que si vous voulez fonctionner 100 % hors-ligne depuis vos propres fichiers, sans l'URL.

---

## Ce qu'il vous faut (méthodes A/B)
- Windows 11 avec **Microsoft Edge** ou **Google Chrome** (préinstallés)
- Le dossier de l'application (`index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`, `icons/`)
- Python (optionnel, pour le serveur local — voir méthode B)

---

## Méthode A — Ouverture directe (la plus simple)

1. Copiez le dossier de l'application dans un répertoire fixe, par ex. `C:\Bibliotheque\`
2. Double-cliquez sur **`index.html`** → il s'ouvre dans votre navigateur
3. C'est tout ! Ajoutez la page aux favoris pour y revenir

> ⚠️ Limite de cette méthode : le scanner par caméra et l'installation « application » nécessitent un serveur local (méthode B). La saisie manuelle d'ISBN et toutes les autres fonctions marchent parfaitement en ouverture directe.

## Méthode B — Serveur local + installation en application (recommandée)

### Étape 1 : démarrer le serveur local
1. Ouvrez le **Terminal PowerShell** (clic droit sur le menu Démarrer → « Terminal »)
2. Allez dans le dossier de l'app :
   ```
   cd C:\Bibliotheque
   ```
3. Lancez un mini-serveur :
   ```
   python -m http.server 8080
   ```
   > Si Python n'est pas installé : ouvrez le Microsoft Store, tapez « Python 3 », installez, relancez. Alternative sans Python : `npx serve` (nécessite Node.js).

### Étape 2 : ouvrir l'application
1. Dans Edge ou Chrome, ouvrez : **`http://localhost:8080`**
2. L'application s'affiche

### Étape 3 : l'installer comme application Windows
1. Dans la barre d'adresse du navigateur, cliquez sur l'icône **⊕ Installer l'application** (ou menu ⋯ → Apps → Installer)
2. Confirmez → **Ma Bibliothèque** apparaît désormais :
   - dans le **menu Démarrer**
   - sur le **bureau** / dans la barre des tâches
   - dans une **fenêtre autonome**, sans barre de navigateur

3. Vous pouvez fermer PowerShell : le service worker met l'app en cache, elle s'ouvre **hors-ligne** directement depuis le menu Démarrer. (Relancez le serveur uniquement pour scanner avec la webcam ou récupérer de nouvelles couvertures.)

---

## 📷 Comment scanner sur PC

| Moyen | Utilisation | Recommandé |
|---|---|---|
| **Douchette USB** (lecteur de codes-barres, ~20-30 €) | Branchez-la, cliquez dans la barre du bas, visez le code-barres : l'ISBN est saisi + validation automatique | ⭐ Le plus rapide, comme en bibliothèque |
| **Saisie manuelle** | Tapez les chiffres sous le code-barres du livre dans la barre du bas, Entrée | Toujours disponible |
| **Webcam** | Bouton « 📷 Scanner » (serveur local requis) | Pour de petites quantités |

> 💡 La douchette fonctionne **sans rien installer** : elle simule un clavier.

## 🤖 IA sur PC (optionnel)

**Via Ollama (gratuit, 100 % local)** :
1. Téléchargez sur [ollama.com](https://ollama.com) et installez
2. Dans PowerShell : `ollama pull llama3` (ou `mistral`, `qwen2.5`…)
3. `ollama serve` (laissez tourner)
4. Dans l'app : menu ☰ → 🤖 IA → fournisseur **ollama**, URL `http://localhost:11434`

**Via clé API (Mistral, OpenAI…)** : menu ☰ → 🤖 IA → fournisseur **api**, collez votre clé (stockée uniquement dans votre navigateur).

## 💾 Sauvegarde des données

Les données vivent **dans le navigateur** (IndexedDB). Si vous réinstallez Windows ou changez de navigateur, elles ne suivent pas :
- **Sauvegarde auto** déjà incluse (tous les N scans, réglable via ⚙️ Sauvegarde auto)
- **Sauvegarde manuelle** : menu ☰ → 💾 Sauvegarde immédiate
- **Restauration** : menu ☰ → 📥 Importer JSON (fusion intelligente, sans doublons)
- Rangez vos exports JSON dans un dossier cloud (OneDrive…) pour une sécurité maximale
---
*Ma Bibliothèque — Création AlphaPrim*
