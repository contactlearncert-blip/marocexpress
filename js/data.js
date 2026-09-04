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

// Opérateurs par défaut avec PIN pré-hashés (1234, 2345, 3456, 4567, 5678)
const OPERATORS = [
  {
    id: 'karim',
    name: 'Karim El Idrissi',
    codeHash: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    initials: 'KE',
    role: "Chef d'équipe Réception",
  },
  {
    id: 'sara',
    name: 'Sara Bennani',
    codeHash: '38083c7ee9121e17401883566a148aa5c2e2d55dc53bc4a94a026517dbff3c6b',
    initials: 'SB',
    role: 'Opératrice Sorties',
  },
  {
    id: 'youssef',
    name: 'Youssef Amrani',
    codeHash: 'ceaa28bba4caba687dc31b1bbe79eca3c70c33f871f1ce8f528cf9ab5cfd76dd',
    initials: 'YA',
    role: 'Gestionnaire Retours',
  },
  {
    id: 'imane',
    name: 'Imane Zahiri',
    codeHash: 'db2e7f1bd5ab9968ae76199b7cc74795ca7404d5a08d78567715ce532f9d2669',
    initials: 'IZ',
    role: 'Contrôleuse Inventaire',
  },
  {
    id: 'nadia',
    name: 'Nadia Chraibi',
    codeHash: 'f8638b979b2f4f793ddb6dbd197e0ee25a7a6ea32b0ae22f5e3c5d119d839e75',
    initials: 'NC',
    role: 'Superviseure Logistique',
  },
];

// Catalogue complet des 130 références matériel
const PRODUCT_REFERENCES = [
  '115C7K', '27R73Q', '32S5400AF', '32S5K', '40S5400A', '40S5K', '43C655', '43G50K-IU',
  '43P635', '43P755', '43P7K', '43P7L', '43S5400A', '43S5K', '50C645', '50C655',
  '50C6K', '50P635', '50P755', '50P7K', '50P7L', '50S5K', '55C655', '55C6K',
  '55C745', '55C755', '55C7K', '55C7L', '55G60K-IU', '55P635', '55P6K', '55P6L',
  '55P7K', '55P7L', '55P8K', '55P8L', '55T6D', '65C645', '65C655', '65C6K',
  '65C745', '65C755', '65C7K', '65C7L', '65C8L', '65P635', '65P755', '65P7K',
  '65P7L', '65P8K', '65P8L', '65T6D', '75C655', '75C6K', '75C7K', '75C7L',
  '75C855', '75C8K', '75C8L', '75P6L', '75P755', '75P7K', '75P7L', '75P8K',
  '75P8L', '75X11L', '85C655', '85C6K', '85P7L', '85P8K', '85P8L', '85X11L',
  '98C7K', '98C7L', '98P8L', '98X11L', 'C1108FLG', 'C1109FLG', 'C2110FLG', 'C2110WDG',
  'C512FLG', 'C512WDG', 'F120SD', 'F312TLG', 'F330CF', 'F708TLG', 'F708TLW', 'F710TLS',
  'P433TMG', 'P532BFBG', 'P532BFBN', 'P560CDN', 'P606FLD', 'P606FLG', 'P607FLB', 'P607FLG',
  'P608FLB', 'P608FLG', 'P612FLB', 'P620CDBN', 'P790SBSN', 'Q85H', 'RAC-12CHSD/XAA1I-I',
  'RAC-12CHSD/XAA1I-O', 'RAC-18CHSD/ZG31I-I', 'RAC-18CHSD/ZG31I-O', 'RAC-24CHSD/ZG31I-I',
  'RAC-24CHSD/ZG31I-O', 'STD115G-O', 'TAC-09CHSA/XAA1-I', 'TAC-09CHSA/XAA1-O', 'TAC-09CHSD/UG11I-I',
  'TAC-09CHSD/UG11I-O', 'TAC-09CHSD/XA73I-I', 'TAC-09CHSD/XA73I-O', 'TAC-09CHSD/ZG21I-I',
  'TAC-09CHSD/ZG21I-O', 'TAC-12CHPB/DM4', 'TAC-12CHSD/UG11I-I', 'TAC-12CHSD/UG11I-O',
  'TAC-12CHSD/XA73I-I', 'TAC-12CHSD/XA73I-O', 'TAC-12CHSD/ZG21I-I', 'TAC-12CHSD/ZG21I-O',
  'TAC-18CHSD/ZG21I-I', 'TAC-18CHSD/ZG21I-O', 'TAC-24CHSD/ZG21I-I', 'TAC-24CHSD/ZG21I-O',
  'TY-LWYR107T', 'TY-LWYR110T',
];

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
