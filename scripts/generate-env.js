#!/usr/bin/env node
/**
 * webZa-sys — génère js/env.js à partir de la variable d'environnement
 * Vercel WEBZA_API_BASE_URL (non secrète : c'est simplement l'URL publique
 * du backend, ex. https://api.webza.example.com).
 *
 * Appelé par vercel.json ("buildCommand"), exécuté avec pour répertoire de
 * travail la racine du projet Vercel (Root Directory = webza-pwa/).
 * N'écrit jamais de secret : si WEBZA_API_BASE_URL n'est pas définie, le
 * fichier généré reste vide et la PWA retombe sur le réglage manuel / la
 * valeur de développement (voir js/config.js).
 */
const fs = require('fs');
const path = require('path');

const apiBaseUrl = process.env.WEBZA_API_BASE_URL || '';
const outPath = path.join(__dirname, '..', 'js', 'env.js');

const content = `/* Généré automatiquement au build Vercel — ne pas éditer à la main. */
window.__WEBZA_ENV__ = {
  API_BASE_URL: ${JSON.stringify(apiBaseUrl)},
};
`;

fs.writeFileSync(outPath, content, 'utf8');
console.log(`[generate-env] écrit ${outPath} (API_BASE_URL=${apiBaseUrl || '(vide)'})`);
