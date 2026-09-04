# webZa-sys · Version PWA (HTML / CSS / JS)

Portage fidèle de l'application Android (Kotlin / Jetpack Compose) en HTML5 / CSS3 / JavaScript pur,
sans aucun changement de design ni de comportement. Seul l'outillage de développement change,
ce qui vous permet de l'exécuter et de la tester directement depuis votre PC, sans Android Studio.

## Structure

```
webza-pwa/
├── index.html          Toutes les vues de l'application (login, accueil, formulaire, historique, profil...)
├── manifest.json        Manifeste PWA (icônes, nom, couleurs)
├── sw.js                 Service Worker (cache offline-first)
├── css/
│   └── style.css        Thème visuel identique (navy/cyan, cartes 3D, dégradés)
├── js/
│   ├── data.js           Opérateurs, références produit, emplacements (identique à WarehouseData.kt)
│   ├── sync.js            Client de synchronisation vers server_wms.py (mêmes endpoints /api/health, /api/sync)
│   ├── repository.js       Persistance locale des opérations (équivalent Room DB, via localStorage)
│   └── app.js              Logique de l'application, écrans et interactions
└── assets/                Images fournies (logo, icônes, fonds, badges d'action)
```

## Lancer l'application

1. Double-cliquez sur `index.html` — OU pour un rendu PWA complet (service worker actif), servez le
   dossier avec un petit serveur local, par exemple :
   ```
   cd webza-pwa
   python3 -m http.server 8080
   ```
   puis ouvrez `http://localhost:8080` dans votre navigateur.
2. L'application fonctionne 100% hors-ligne après le premier chargement (Service Worker).
3. Codes d'accès de démonstration (identiques à la version Android) :
   - Karim El Idrissi → **1234**
   - Sara Bennani → **2345**
   - Youssef Amrani → **3456**
   - Imane Zahiri → **4567**
   - Nadia Chraibi → **5678**

## Transformer en PWA installable

Le manifeste (`manifest.json`) et le service worker (`sw.js`) sont déjà en place. Une fois servie en
HTTPS (ou localhost), l'application proposera automatiquement l'installation sur mobile (Android/iOS)
et sur ordinateur (Chrome/Edge : icône d'installation dans la barre d'adresse).

## Synchronisation avec le serveur PC

Le comportement est identique à l'app Android : depuis l'écran d'accueil, appuyez sur le badge de
statut serveur pour ouvrir la fenêtre de configuration, saisir l'adresse IP de `server_wms.py`
(ex. `http://192.168.1.50:8000`), tester la connexion et synchroniser.

## Note sur les correctifs

Un seul correctif a été appliqué par rapport au code source fourni : les empreintes SHA-256 des codes
PIN des opérateurs ne correspondaient pas réellement aux codes indiqués en commentaire (1234, 2345...)
dans le fichier `WarehouseData.kt` d'origine — la connexion aurait donc échoué avec ces codes, y compris
dans la version Android. Les empreintes ont été recalculées pour correspondre aux codes documentés.
Aucune autre donnée, aucun autre comportement ni élément visuel n'a été modifié.
