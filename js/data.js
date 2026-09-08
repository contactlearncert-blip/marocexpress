/* ===========================================================
   webZa-sys — Données de référence (opérateurs, produits, emplacements)
   Portage fidèle de WarehouseData.kt — aucune donnée modifiée.
=========================================================== */

// Utilitaire SHA-256 (Web Crypto API) pour vérifier le PIN sans stocker le code en clair
async function sha256Hex(input) {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Aucun opérateur n'est jamais pré-rempli dans l'app livrée : les codes PIN
// n'existent qu'une fois créés par le responsable depuis le tableau de bord
// (voir services.create_operator côté backend). Un tableau vide ici garantit
// que verifyPin() (app.js) ne peut jamais reconnaître un code localement tant
// que ce téléphone ne s'est pas connecté au moins une fois au vrai serveur —
// voir OperatorCache, qui prend le relais après cette première connexion.
const OPERATORS = [];

// Catalogue des 89 références actuellement en stock (source : fichier
// EAN_CODE.xlsx fourni par l'utilisateur, 05/09/2026 — remplace l'ancien
// catalogue de 130 références, qui incluait des climatiseurs et autres
// modèles qui ne sont plus en stock actuellement).
const PRODUCT_REFERENCES = [
  '115C7K', '115X955MAX', '27R73Q', '32S4500A', '32S5400AF', '32S5K', '40S5400A', '40S5K',
  '43C655', '43G50K-IU', '43P635', '43P755', '43P7K', '43P7L', '43S5400A', '43S5K',
  '50C645', '50C655', '50C6K', '50P635', '50P755', '50P7K', '50P7L', '50S5K', '55C645',
  '55C655', '55C6K', '55C745', '55C755', '55C7K', '55C7L', '55G60K-IU', '55P635', '55P6K',
  '55P6L', '55P735', '55P755', '55P7K', '55P7L', '55P8K', '55P8L', '65C645', '65C655',
  '65C6K', '65C745', '65C755', '65C7K', '65C7L', '65C855', '65C8K', '65C8L', '65P635',
  '65P755', '65P7K', '65P7L', '65P8K', '65P8L', '75C655', '75C6K', '75C755', '75C7K',
  '75C7L', '75C855', '75C8K', '75C8L', '75P635', '75P6L', '75P755', '75P7K', '75P7L',
  '75P8K', '75P8L', '75X11L', '85C655', '85C6K', '85C7K', '85C7L', '85C855', '85P7L',
  '85P8K', '85P8L', '85X11L', '98C655', '98C735', '98C7K', '98C7L', '98P8K', '98P8L',
  '98X11L',
];

// Correspondance code-barres EAN -> référence produit, pour le scan caméra du
// champ Référence (voir openBarcodeScanner, app.js). Fournie par l'utilisateur
// (fichier EAN_CODE.xlsx, 05/09/2026) — 88 références sur les 130 du catalogue
// ont un code-barres connu ; les autres (climatiseurs RAC-/TAC-/P-prefixés pour
// la plupart) n'en avaient pas dans ce fichier.
const EAN_TO_REFERENCE = {
  '6921732815325': '55C745',
  '6921732815332': '65C645',
  '6921732815349': '55P735',
  '6921732815356': '75P635',
  '6921732815363': '43S5400A',
  '6921732815370': '32S5400AF',
  '6921732815394': '40S5400A',
  '6921732816841': '98C735',
  '6921732823238': '32S4500A',
  '6921732832209': '43P755',
  '6921732832216': '50P755',
  '6921732832223': '55P755',
  '6921732832230': '65P755',
  '6921732832247': '75P755',
  '6921732832254': '43C655',
  '6921732832261': '50C655',
  '6921732832278': '55C655',
  '6921732832285': '65C655',
  '6921732832292': '75C655',
  '6921732832308': '85C655',
  '6921732833664': '65C755',
  '6921732833671': '75C755',
  '6921732833688': '55C755',
  '6921732835637': '98C655',
  '6921732835644': '75C855',
  '6921732835651': '85C855',
  '6921732835668': '65C855',
  '6921732839307': '115X955MAX',
  '6921732847067': '55C6K',
  '6921732847074': '55C7K',
  '6921732847081': '65C6K',
  '6921732847098': '65C7K',
  '6921732847104': '43P7K',
  '6921732847111': '50P7K',
  '6921732847128': '55P7K',
  '6921732847135': '65P7K',
  '6921732847142': '75P7K',
  '6921732847159': '55P8K',
  '6921732847166': '65P8K',
  '6921732847180': '98P8K',
  '6921732889074': '50S5K',
  '6921732897208': '27R73Q',
  '6921732898281': '75P8K',
  '6921732898298': '85P8K',
  '6921732898304': '75C6K',
  '6921732898311': '85C7K',
  '6921732898328': '98C7K',
  '6921732898335': '115C7K',
  '6921732898342': '55P6K',
  '6921732898373': '65C8K',
  '6921732898380': '75C8K',
  '6937574800870': '85C6K',
  '6937574801501': '32S5K',
  '6937574801518': '40S5K',
  '6937574801525': '43S5K',
  '6937574817519': '50C6K',
  '6937574818950': '75X11L',
  '6937574819278': '98X11L',
  '6937574819353': '85X11L',
  '6937574819438': '98C7L',
  '6937574830198': '75C8L',
  '6937574830303': '65C8L',
  '6937574833533': '98P8L',
  '6937574838897': '65P8L',
  '6937574839191': '85P8L',
  '6937574839610': '75P8L',
  '6937574839665': '55P8L',
  '6937574840326': '75P7L',
  '6937574840371': '85P7L',
  '6937574841354': '50P7L',
  '6937574841576': '43P7L',
  '6937574841620': '55P7L',
  '6937574841675': '65P7L',
  '6937574848674': '75C7L',
  '6937574848780': '65C7L',
  '6937574849961': '85C7L',
  '6937574850073': '55C7L',
  '6937574855184': '55P6L',
  '6937574856310': '75P6L',
  '6937574872433': '55G60K-IU',
  '6937574873690': '43G50K-IU',
  '6973230611459': '43P635',
  '6973230611473': '50P635',
  '6973230611497': '55P635',
  '6973230611503': '75P635',
  '6973230611510': '50C645',
  '6973230611527': '65P635',
  '6973230611541': '55C645',
};

// Emplacements de racks (plan de traçage B1 SOFT — 3 zones/étages A, B, C,
// chacun avec des emplacements numérotés simplement 1..N, sans sous-zone).
function buildLocations() {
  const floorCounts = { A: 11, B: 14, C: 14 };
  const list = [];
  for (const floor of Object.keys(floorCounts)) {
    const count = floorCounts[floor];
    for (let i = 1; i <= count; i++) {
      list.push(`${floor}${i}`);
    }
  }
  return list;
}

const LOCATIONS = buildLocations();
