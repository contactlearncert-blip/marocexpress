/* ===========================================================
   webZa-sys — Configuration runtime de la PWA
   ===========================================================
   Fournit l'URL publique du backend (API_BASE_URL) SANS jamais coder en
   dur une adresse IP locale ni "localhost" (qui, depuis un smartphone,
   désignerait le smartphone lui-même — voir mission de sécurité).

   Ordre de résolution :
     1. window.__WEBZA_ENV__.API_BASE_URL, injecté par env.js — fichier
        généré au build Vercel à partir de la variable d'environnement
        WEBZA_API_BASE_URL (voir scripts/generate-env.js et vercel.json).
        Ce n'est PAS un secret : c'est l'URL publique du point d'accès
        sécurisé du backend (ex. https://api.webza.example.com), il est
        normal qu'elle soit visible dans le JS livré au navigateur.
     2. Une valeur réglée manuellement dans l'app (écran "Serveur"),
        conservée dans localStorage — utile pour pointer vers un backend
        de test sans reconstruire la PWA.
     3. En dernier recours, une valeur de développement local.
   =========================================================== */

const WebzaConfig = {
  STORAGE_KEY: 'webza_api_base_url',

  _buildTimeUrl() {
    return (window.__WEBZA_ENV__ && window.__WEBZA_ENV__.API_BASE_URL) || '';
  },

  getApiBaseUrl() {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored) return stored.replace(/\/+$/, '');

    const buildTime = this._buildTimeUrl();
    if (buildTime) return buildTime.replace(/\/+$/, '');

    // Développement local uniquement (PWA servie par `python3 -m http.server`
    // à côté d'un backend lancé avec WEBZA_ENV=development sur la même
    // machine). Jamais utilisé en production si env.js est bien généré.
    return 'http://localhost:8000';
  },

  setApiBaseUrl(url) {
    let clean = (url || '').trim();
    if (!clean) {
      localStorage.removeItem(this.STORAGE_KEY);
      return;
    }
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://' + clean;
    }
    clean = clean.replace(/\/+$/, '');
    localStorage.setItem(this.STORAGE_KEY, clean);
  },

  usesBuildTimeDefault() {
    return !localStorage.getItem(this.STORAGE_KEY) && !!this._buildTimeUrl();
  },
};
