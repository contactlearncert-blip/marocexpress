/* ===========================================================
   webZa-sys — Application logic (port fidèle du WarehouseViewModel.kt)
=========================================================== */

(() => {
  'use strict';

  /* ---------------- State ---------------- */
  const state = {
    screen: 'login', // login | home | form | success | history | profile
    currentOperator: null,
    enteredPin: '',
    pinError: null,
    pinChecking: false,
    lockoutSeconds: 0,
    failedAttempts: 0,

    formState: null,
    lastOperation: null,

    historySearch: '',
    historyFilter: 'ALL',

    serverUrl: SyncManager.getServerUrl(),
    isServerConnected: null, // null unknown, true, false
    isSyncing: false,
    lastSyncMessage: null,
    pendingSyncCount: 0,

    // Comptage de container (réception uniquement) : session en cours,
    // prise en charge via /api/containers/claim — voir openContainerModal().
    activeContainer: null, // { id, code, lineCount }

    activeTab: 'home', // home | history | profile
  };

  /* ---------------- DOM helpers ---------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showScreen(name) {
    $$('.screen').forEach((el) => el.classList.remove('active'));
    const el = document.getElementById(`screen-${name}`);
    if (el) {
      el.classList.add('active');
      const dim = el.getAttribute('data-dim');
      if (dim) el.style.setProperty('--dim', dim);
    }
    state.screen = name;
    window.scrollTo(0, 0);
  }

  let toastTimer = null;
  function showToast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ---------------- Bottom nav ---------------- */
  function mountBottomNav(slotId) {
    const slot = document.getElementById(slotId);
    if (!slot) return;
    const tpl = document.getElementById('bottom-nav-template');
    slot.innerHTML = '';
    slot.appendChild(tpl.content.cloneNode(true));
    $$('.nav-tab', slot).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.tab;
        if (btn.dataset.tab === 'home') goHome();
        else if (btn.dataset.tab === 'history') goHistory();
        else if (btn.dataset.tab === 'profile') goProfile();
      });
    });
  }
  // querySelector scoped helper
  function $$scoped(root, sel) { return Array.from(root.querySelectorAll(sel)); }
  // override $$ used with two args above
  const _origQQ = $$;

  /* ===========================================================
     OPERATOR CACHE — noteurs reconnus sur CE téléphone
     ===========================================================
     Le roster livré avec l'app (OPERATORS, data.js) est figé au build et
     n'est jamais synchronisé automatiquement avec le backend. Un noteur
     ajouté après coup par le responsable depuis le backend n'y figure donc
     pas : son code d'accès échouerait toujours en vérification locale.
     Ce cache (localStorage) mémorise, sur cet appareil uniquement, tout
     noteur dont le code a déjà été confirmé au moins une fois par le
     serveur (voir verifyPin). Il permet ensuite à ce même téléphone de le
     reconnaître instantanément, y compris hors-ligne, exactement comme les
     opérateurs livrés par défaut. Le cookie de session HttpOnly posé par
     /api/operators/login (voir sync.js) reste lui l'autorisation réelle
     côté API.
  =========================================================== */
  const OperatorCache = {
    STORAGE_KEY: 'webza_local_operators',
    _readAll() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },
    _writeAll(list) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
    },
    findByHash(hash) {
      return this._readAll().find((o) => o.codeHash === hash) || null;
    },
    remember(operator) {
      const list = this._readAll().filter((o) => o.id !== operator.id);
      list.push(operator);
      this._writeAll(list);
    },
  };

  function initialsFromName(name) {
    if (!name) return '??';
    return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }

  // Le backend peut renvoyer des noms de champs différents du roster local ;
  // on normalise vers la même forme que les objets de OPERATORS (data.js).
  function normalizeOperator(raw, codeHash) {
    const name = raw.name || raw.full_name || raw.nom || 'Opérateur';
    return {
      id: String(raw.id ?? raw.operator_id ?? raw.code ?? name),
      name,
      initials: raw.initials || initialsFromName(name),
      role: raw.role || raw.poste || '',
      codeHash,
    };
  }

  /* ===========================================================
     LOGIN SCREEN
  =========================================================== */
  function renderPin() {
    const dots = $$('.pin-dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < state.enteredPin.length));
    const msgEl = $('#pin-message');
    if (state.pinChecking) {
      msgEl.textContent = 'Vérification auprès du serveur...';
    } else if (state.lockoutSeconds > 0) {
      msgEl.textContent = `Trop d'essais — Réessayez dans ${state.lockoutSeconds}s`;
    } else if (state.pinError) {
      msgEl.textContent = state.pinError;
    } else {
      msgEl.textContent = '';
    }
    $$('.key').forEach((k) => {
      k.disabled = state.lockoutSeconds > 0 || state.pinChecking;
    });
  }

  function shakePin() {
    const block = $('#pin-block');
    block.classList.remove('shake');
    void block.offsetWidth;
    block.classList.add('shake');
  }

  async function verifyPin(pin) {
    await new Promise((r) => setTimeout(r, 120));
    const hash = await sha256Hex(pin);

    // 1) Vérification locale instantanée : roster livré avec l'app
    //    (OPERATORS, data.js) + noteurs déjà validés au moins une fois sur
    //    CE téléphone (OperatorCache, alimenté à l'étape 2 ci-dessous).
    //    Fonctionne hors-ligne, retour visuel immédiat.
    const matched = OPERATORS.find((o) => o.codeHash === hash) || OperatorCache.findByHash(hash);

    if (matched) {
      state.failedAttempts = 0;
      state.currentOperator = matched;
      state.enteredPin = '';
      state.pinError = null;
      loginSuccess();
      // L'AUTORISATION réelle pour l'API reste la session serveur (cookie
      // HttpOnly) ouverte ici en tâche de fond : tant qu'elle n'est pas
      // établie (hors-ligne), les écritures restent en file locale (voir
      // sync.js ensureSession()/sendOperations()).
      SyncManager.login(pin).then((res) => {
        if (!res.success && !res.offline) {
          showToast('Connexion au serveur refusée — les données resteront en attente de synchro.');
        }
      });
      return;
    }

    // 2) Code inconnu de ce téléphone : peut-être un noteur tout juste
    //    ajouté depuis le backend par le responsable. Comme le roster
    //    local n'est jamais synchronisé automatiquement, on vérifie ce
    //    code directement auprès du serveur. Un succès pose le cookie de
    //    session ET mémorise ce noteur sur CET appareil (OperatorCache),
    //    pour que ses prochains accès — même hors-ligne — fonctionnent
    //    avec le même code.
    state.pinChecking = true;
    renderPin();
    const res = await SyncManager.login(pin);
    state.pinChecking = false;

    if (res.success && res.operator) {
      const operator = normalizeOperator(res.operator, hash);
      OperatorCache.remember(operator);
      state.failedAttempts = 0;
      state.currentOperator = operator;
      state.enteredPin = '';
      state.pinError = null;
      loginSuccess();
      showToast(`Bienvenue ${operator.name.split(' ')[0]} — appareil reconnu pour les prochains accès`);
      return;
    }

    state.enteredPin = '';

    if (res.offline) {
      // Aucune copie locale de ce code sur ce téléphone : sans connexion au
      // serveur, impossible de confirmer un noteur jamais validé ici avant.
      state.pinError = 'Code inconnu sur ce téléphone — connexion Internet requise la 1ère fois.';
      shakePin();
      renderPin();
      return;
    }

    // Code réellement refusé par le serveur (mauvais code, compte désactivé...)
    state.failedAttempts++;
    if (state.failedAttempts >= 5) {
      state.lockoutSeconds = 30;
      state.failedAttempts = 0;
      state.pinError = 'Trop de tentatives. Bloqué 30s.';
    } else {
      const remaining = 5 - state.failedAttempts;
      state.pinError = `Code d'accès incorrect (${remaining} essai${remaining > 1 ? 's' : ''} restant${remaining > 1 ? 's' : ''})`;
    }
    shakePin();
    renderPin();
  }

  function onKeypadPress(key) {
    if (state.lockoutSeconds > 0) return;
    if (key === 'clear') {
      state.enteredPin = '';
      state.pinError = null;
      renderPin();
      return;
    }
    if (key === 'back') {
      if (state.enteredPin.length > 0) {
        state.enteredPin = state.enteredPin.slice(0, -1);
        state.pinError = null;
        renderPin();
      }
      return;
    }
    if (state.enteredPin.length < 4) {
      state.enteredPin += key;
      renderPin();
      if (state.enteredPin.length === 4) {
        const pin = state.enteredPin;
        verifyPin(pin);
      }
    }
  }

  function loginSuccess() {
    renderPin();
    goHome();
    showToast(`Bienvenue, ${state.currentOperator.name.split(' ')[0]}`);
  }

  /* ===========================================================
     HOME SCREEN
  =========================================================== */
  function renderHome() {
    const op = state.currentOperator;
    $('#home-operator-name').textContent = op ? op.name.split(' ')[0] : 'Opérateur';
    renderServerBadge();
    mountBottomNav('bottom-nav-home');
  }

  function goHome() {
    state.activeTab = 'home';
    renderHome();
    showScreen('home');
  }

  function renderServerBadge() {
    const badge = $('#server-status-badge');
    const text = $('#server-status-text');
    let stateName = 'unknown';
    let label;
    if (state.isSyncing) {
      stateName = 'syncing';
      label = 'Synchro en cours...';
    } else if (state.isServerConnected === true) {
      stateName = 'connected';
      label = 'Serveur PC Connecté';
    } else if (state.isServerConnected === false) {
      stateName = 'offline';
      label = state.pendingSyncCount > 0 ? `Hors-ligne (${state.pendingSyncCount} en attente)` : 'Mode Hors-ligne';
    } else {
      label = state.pendingSyncCount > 0 ? `Stockage local (${state.pendingSyncCount} en attente)` : 'Mode Stockage Local';
    }
    badge.setAttribute('data-state', stateName);
    text.textContent = label;
  }

  /* ===========================================================
     OPERATION FORM SCREEN
  =========================================================== */
  const TITLES = {
    reception: ['Réception', 'Entrée de stock'],
    sortie: ['Sortie', 'Expédition & chargement'],
    retour: ['Retour', 'Contrôle qualité'],
    inventaire: ['Inventaire', 'Comptage physique'],
  };

  function startOperation(type) {
    // Comptage de container : uniquement à la réception, et seulement si
    // aucun container n'est déjà pris en charge (sinon on enchaîne direct
    // sur le formulaire, sans re-scanner — voir openContainerModal).
    if (type === 'reception' && !state.activeContainer) {
      openContainerModal();
      return;
    }
    state.formState = {
      operationType: type,
      reference: '',
      quantity: 1,
      location: 'A',
      truckType: 'Affrètement',
      grade: 'A',
      notes: '',
      referenceError: null,
      quantityError: null,
      locationError: null,
      isSubmitting: false,
      locationMode: 'default', // default | defined
      locationLevel: 'A',
    };
    renderForm();
    showScreen('form');
  }

  /* ---- Comptage de container (réception) ---- */
  function openContainerModal() {
    $('#container-code-input').value = '';
    setFieldError('container-code-error', null);
    $('#container-claim-btn').disabled = false;
    $('#container-modal-backdrop').hidden = false;
    setTimeout(() => $('#container-code-input').focus(), 50);
  }
  function closeContainerModal() {
    $('#container-modal-backdrop').hidden = true;
  }

  /* ---- Scan caméra du container (BarcodeDetector natif, pas de lib externe) ---- */
  let scannerStream = null;
  let scannerRAF = null;
  async function openBarcodeScanner() {
    if (!('BarcodeDetector' in window)) {
      showToast("Le scan caméra n'est pas pris en charge par ce navigateur — utilisez la saisie manuelle.");
      return;
    }
    const video = $('#scanner-video');
    const status = $('#scanner-status');
    status.textContent = '';
    $('#scanner-overlay').hidden = false;
    try {
      scannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (e) {
      closeBarcodeScanner();
      showToast("Impossible d'accéder à la caméra — vérifiez les autorisations du téléphone.");
      return;
    }
    video.srcObject = scannerStream;
    await video.play().catch(() => {});

    let detector;
    try {
      detector = new BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'itf', 'codabar'],
      });
    } catch (e) {
      closeBarcodeScanner();
      showToast('Scan caméra indisponible sur cet appareil — utilisez la saisie manuelle.');
      return;
    }

    const tick = async () => {
      if (!scannerStream) return; // scanner fermé entretemps
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length > 0) {
          const value = (codes[0].rawValue || '').trim().toUpperCase();
          closeBarcodeScanner();
          if (value) {
            $('#container-code-input').value = value;
            setFieldError('container-code-error', null);
            submitContainerClaim();
          }
          return;
        }
      } catch (e) {
        /* frame illisible, on continue */
      }
      scannerRAF = requestAnimationFrame(tick);
    };
    scannerRAF = requestAnimationFrame(tick);
  }
  function closeBarcodeScanner() {
    if (scannerRAF) {
      cancelAnimationFrame(scannerRAF);
      scannerRAF = null;
    }
    if (scannerStream) {
      scannerStream.getTracks().forEach((t) => t.stop());
      scannerStream = null;
    }
    const video = $('#scanner-video');
    if (video) video.srcObject = null;
    $('#scanner-overlay').hidden = true;
  }

  async function submitContainerClaim() {
    const code = $('#container-code-input').value.trim().toUpperCase();
    if (!code) {
      setFieldError('container-code-error', 'Le numéro de container ne peut pas être vide');
      return;
    }
    const btn = $('#container-claim-btn');
    btn.disabled = true;
    const result = await SyncManager.claimContainer(code);
    btn.disabled = false;
    if (result.success) {
      state.activeContainer = {
        id: result.session.id,
        code: result.session.code,
        lineCount: result.session.lineCount || 0,
      };
      closeContainerModal();
      startOperation('reception');
      return;
    }
    if (result.reason === 'busy') {
      setFieldError(
        'container-code-error',
        result.holderName
          ? `Déjà pris en charge par ${result.holderName} — prévenez-le avant de continuer.`
          : 'Déjà pris en charge par un autre noteur.'
      );
    } else if (result.reason === 'offline') {
      setFieldError('container-code-error', 'Connexion au serveur requise pour prendre en charge un container.');
    } else {
      setFieldError('container-code-error', "Impossible de prendre en charge ce container, réessayez.");
    }
  }
  async function finishActiveContainer() {
    if (!state.activeContainer) return;
    const { id, code } = state.activeContainer;
    const result = await SyncManager.closeContainer(id);
    if (!result.success && result.reason === 'offline') {
      showToast('Hors-ligne : la clôture sera à confirmer une fois connecté.');
    }
    state.activeContainer = null;
    showToast(`Container ${code} terminé`);
    goHome();
  }

  function renderForm() {
    const fs = state.formState;
    const [title, subtitle] = TITLES[fs.operationType] || TITLES.inventaire;
    $('#form-title').textContent = title;
    $('#form-subtitle').textContent = subtitle;

    const showContainerBanner = fs.operationType === 'reception' && !!state.activeContainer;
    $('#container-banner').hidden = !showContainerBanner;
    if (showContainerBanner) {
      $('#container-banner-code').textContent = state.activeContainer.code;
      const n = state.activeContainer.lineCount || 0;
      $('#container-banner-count').textContent = n === 0 ? 'Aucune ligne encore' : `${n} ligne(s) déjà enregistrée(s)`;
    }

    $('#ref-input').value = fs.reference;
    $('#ref-clear-btn').hidden = fs.reference.length === 0;
    setFieldError('ref-error', fs.referenceError);

    const qtyLabel = fs.operationType === 'inventaire' ? 'QUANTITÉ COMPTÉE' : 'QUANTITÉ';
    $('#qty-label').textContent = qtyLabel;
    $('#qty-input').value = fs.quantity > 0 ? String(fs.quantity) : '';
    setFieldError('qty-error', fs.quantityError);

    // Location mode buttons
    $('#loc-mode-default').classList.toggle('active', fs.locationMode === 'default');
    $('#loc-mode-defined').classList.toggle('active', fs.locationMode === 'defined');
    $('#loc-default-panel').hidden = fs.locationMode !== 'default';
    $('#loc-defined-panel').hidden = fs.locationMode !== 'defined';
    $('#loc-selected-level').textContent = `Sélection : ${fs.locationLevel}`;
    $$('.level-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.level === fs.locationLevel));
    if (fs.locationMode === 'defined') {
      $('#loc-input').value = fs.location;
    }

    // Truck / grade conditional blocks
    $('#truck-field-block').hidden = fs.operationType !== 'sortie';
    $('#grade-field-block').hidden = fs.operationType !== 'retour';
    $$('.segment').forEach((btn) => btn.classList.toggle('active', btn.dataset.truck === fs.truckType));
    $$('#grade-field-block .grade-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.grade === fs.grade));

    $('#notes-input').value = fs.notes;

    const submitBtn = $('#submit-op-btn');
    submitBtn.disabled = fs.isSubmitting;
    submitBtn.querySelector('span').textContent = fs.isSubmitting ? 'Enregistrement...' : "Valider l'opération";
  }

  function setFieldError(elId, message) {
    const el = document.getElementById(elId);
    if (message) {
      el.textContent = message;
      el.hidden = false;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function renderRefSuggestions(query) {
    const panel = $('#ref-suggestions');
    const listEl = $('#ref-suggestions-list');
    const list = (query.trim() === ''
      ? PRODUCT_REFERENCES.slice(0, 30)
      : PRODUCT_REFERENCES.filter((r) => r.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30));
    $('#ref-suggestions-count').textContent = `${list.length} référence(s)`;
    listEl.innerHTML = list
      .map((item) => `<div class="suggestion-item" data-value="${item}">${item}</div>`)
      .join('');
    panel.hidden = list.length === 0;
  }

  function renderLocSuggestions(query) {
    const panel = $('#loc-suggestions');
    const listEl = $('#loc-suggestions-list');
    const q = query.trim().toLowerCase();
    const list = LOCATIONS.filter((l) => l.toLowerCase().includes(q)).slice(0, 20);
    listEl.innerHTML = list
      .map((item) => `<div class="suggestion-item mono" data-value="${item}">${item}</div>`)
      .join('');
    panel.hidden = list.length === 0;
  }

  function validateAndSubmitOperation() {
    const fs = state.formState;
    let hasError = false;
    let refError = null;
    let qtyError = null;
    let locError = null;

    const trimmedRef = fs.reference.trim();
    if (trimmedRef === '') {
      refError = 'Veuillez sélectionner une référence produit valide';
      hasError = true;
    }
    if (fs.quantity < 1) {
      qtyError = 'La quantité doit être supérieure ou égale à 1';
      hasError = true;
    }
    const trimmedLoc = fs.location.trim();
    if (trimmedLoc === '') {
      locError = 'Veuillez saisir un emplacement valide';
      hasError = true;
    }

    if (hasError) {
      fs.referenceError = refError;
      fs.quantityError = qtyError;
      fs.locationError = locError;
      renderForm();
      showToast('Veuillez corriger les champs en erreur');
      return;
    }

    const operator = state.currentOperator || { id: 'agent', name: 'Opérateur' };
    const operation = {
      id: 0,
      serverUuid: makeUuid(),
      type: fs.operationType,
      reference: trimmedRef,
      quantity: fs.quantity,
      location: trimmedLoc.toUpperCase(),
      truckType: fs.operationType === 'sortie' ? fs.truckType : null,
      grade: fs.operationType === 'retour' ? fs.grade : null,
      operatorId: operator.id,
      operatorName: operator.name,
      timestamp: Date.now(),
      syncStatus: 'PENDING',
      notes: fs.notes.trim() === '' ? null : fs.notes.trim(),
      containerSessionId: fs.operationType === 'reception' && state.activeContainer ? state.activeContainer.id : null,
    };

    fs.isSubmitting = true;
    renderForm();

    setTimeout(() => {
      const saved = OperationRepository.insertOperation(operation);
      if (operation.containerSessionId && state.activeContainer) {
        state.activeContainer.lineCount = (state.activeContainer.lineCount || 0) + 1;
      }
      fs.isSubmitting = false;
      state.lastOperation = saved;
      updatePendingCount();
      renderSuccess(saved);
      showScreen('success');

      // Background non-blocking sync attempt
      SyncManager.sendOperations([saved]).then((res) => {
        if (res.success) {
          state.isServerConnected = true;
          OperationRepository.updateOperation({ ...saved, syncStatus: 'SYNCED' });
          updatePendingCount();
        } else {
          state.isServerConnected = false;
        }
        renderServerBadge();
      });
    }, 150);
  }

  /* ===========================================================
     SUCCESS SCREEN
  =========================================================== */
  const TYPE_META = {
    reception: { label: 'Réception', color: '#38BDF8' },
    sortie: { label: 'Sortie', color: '#F59E0B' },
    retour: { label: 'Retour', color: '#F43F5E' },
    inventaire: { label: 'Inventaire', color: '#10B981' },
  };
  const GRADE_META = {
    A: { label: 'Grade A (Stock)', color: '#10B981' },
    B: { label: 'Grade B (Maint. emb.)', color: '#F59E0B' },
    C: { label: 'Grade C (Pour pièce)', color: '#38BDF8' },
    D: { label: 'Grade D (Abîmé)', color: '#EF4444' },
  };

  function formatDateTime(ts, withSeconds) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    const base = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
  }

  function renderSuccess(op) {
    const meta = TYPE_META[op.type] || TYPE_META.inventaire;
    let detailBlock = '';
    if (op.truckType) {
      detailBlock = `
        <div class="field-pair end">
          <div class="label">EXPÉDITION</div>
          <div class="field-value">${escapeHtml(op.truckType)}</div>
        </div>`;
    } else if (op.grade) {
      const g = GRADE_META[op.grade.toUpperCase()] || { label: `Grade ${op.grade}`, color: '#fff' };
      detailBlock = `
        <div class="field-pair end">
          <div class="label">GRADE RETOUR</div>
          <div class="field-value" style="color:${g.color}">${escapeHtml(g.label)}</div>
        </div>`;
    }

    $('#success-card').innerHTML = `
      <div class="success-row">
        <span class="label">TYPE D'OPÉRATION</span>
        <span class="type-pill">✓ ${escapeHtml(op.syncStatus)}</span>
      </div>
      <div class="success-type-label" style="color:${meta.color}">${meta.label}</div>
      <div class="success-divider"></div>
      <div class="field-pair">
        <div>
          <div class="label">RÉFÉRENCE</div>
          <div class="field-value">${escapeHtml(op.reference)}</div>
        </div>
        <div class="field-pair end">
          <div class="label">QUANTITÉ</div>
          <div class="field-value cyan">${op.quantity} unités</div>
        </div>
      </div>
      <div class="field-pair">
        <div>
          <div class="label">EMPLACEMENT</div>
          <div class="field-value" style="font-family:'SFMono-Regular',Consolas,monospace">${escapeHtml(op.location)}</div>
        </div>
        ${detailBlock}
      </div>
      <div class="success-divider"></div>
      <div class="meta-row">
        <span>Opérateur : ${escapeHtml(op.operatorName)}</span>
        <span>${formatDateTime(op.timestamp, true)}</span>
      </div>
      <div class="uuid-text">UUID: ${escapeHtml(op.serverUuid)}</div>
    `;

    // Comptage container : sur une réception rattachée à un container
    // encore ouvert, on propose d'enchaîner directement une autre ligne
    // (sans re-scanner) ou de clôturer explicitement.
    const onActiveContainer = op.type === 'reception' && !!state.activeContainer;
    $('#success-finish-container-btn').hidden = !onActiveContainer;
    const repeatLabel = $('#success-repeat-btn span');
    if (repeatLabel) {
      repeatLabel.textContent = onActiveContainer
        ? `Ajouter une ligne au container ${state.activeContainer.code}`
        : 'Nouvelle opération';
    }
  }

  /* ===========================================================
     HISTORY SCREEN
  =========================================================== */
  function getFilteredOperations() {
    const all = OperationRepository.getAllOperations();
    const q = state.historySearch.trim().toLowerCase();
    const filter = state.historyFilter;
    return all.filter((op) => {
      const matchesType = filter === 'ALL' || op.type.toLowerCase() === filter.toLowerCase();
      const matchesQuery =
        q === '' ||
        op.reference.toLowerCase().includes(q) ||
        op.location.toLowerCase().includes(q) ||
        op.operatorName.toLowerCase().includes(q) ||
        (op.truckType && op.truckType.toLowerCase().includes(q)) ||
        (op.grade && op.grade.toLowerCase().includes(q));
      return matchesType && matchesQuery;
    });
  }

  function goHistory() {
    state.activeTab = 'history';
    renderHistory();
    showScreen('history');
  }

  function renderHistory() {
    mountBottomNav('bottom-nav-history');
    const ops = getFilteredOperations();
    $('#history-count').textContent = `${ops.length} opération(s) trouvée(s)`;
    $('#history-search').value = state.historySearch;
    $('#history-search-clear').hidden = state.historySearch.length === 0;

    $$('.chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.filter === state.historyFilter));

    const tbody = $('#ops-table-body');
    const emptyEl = $('#ops-empty');
    if (ops.length === 0) {
      tbody.innerHTML = '';
      emptyEl.hidden = false;
    } else {
      emptyEl.hidden = true;
      tbody.innerHTML = ops
        .map((op) => {
          const meta = TYPE_META[op.type.toLowerCase()] || TYPE_META.inventaire;
          return `
          <tr data-id="${op.id}">
            <td>${formatDateTime(op.timestamp, false)}</td>
            <td class="type-cell" style="color:${meta.color}">${meta.label}</td>
            <td>${escapeHtml(op.reference)}</td>
            <td>${escapeHtml(op.location)}</td>
            <td>${op.quantity} u.</td>
            <td>
              <button class="row-action-btn" data-menu-id="${op.id}" aria-label="Options">
                <svg viewBox="0 0 24 24" width="19" height="19"><path fill="currentColor" d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z"/></svg>
              </button>
            </td>
          </tr>`;
        })
        .join('');
    }
  }

  function openActionMenu(anchorBtn, opId) {
    const backdrop = $('#action-menu-backdrop');
    const menu = $('#action-menu');
    const rect = anchorBtn.getBoundingClientRect();
    backdrop.hidden = false;
    // Position near the button, keep on screen
    const menuWidth = 170;
    let left = rect.right - menuWidth;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    let top = rect.bottom + 6;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.dataset.opId = opId;
  }
  function closeActionMenu() {
    $('#action-menu-backdrop').hidden = true;
  }

  /* ---- Edit operation modal ---- */
  let editingOp = null;
  function openEditModal(op) {
    editingOp = { ...op };
    const opType = op.type.toLowerCase();
    const meta = TYPE_META[opType] || TYPE_META.inventaire;
    $('#edit-badge').textContent = `${meta.label} • #${op.id}`;
    $('#edit-badge').style.color = meta.color;
    $('#edit-badge').style.borderColor = meta.color;
    $('#edit-reference').value = op.reference;
    $('#edit-quantity').value = op.quantity;
    $('#edit-location').value = op.location;
    $('#edit-notes').value = op.notes || '';

    $('#edit-truck-block').hidden = opType !== 'sortie';
    $('#edit-grade-block').hidden = opType !== 'retour';
    if (opType === 'sortie') {
      $$('#edit-truck-segmented .segment').forEach((b) => b.classList.toggle('active', b.dataset.truck === (op.truckType || 'Affrètement')));
    }
    if (opType === 'retour') {
      $$('#edit-grade-row .grade-btn').forEach((b) => b.classList.toggle('active', b.dataset.grade === (op.grade || 'A')));
    }
    $('#edit-modal-backdrop').hidden = false;
  }
  function closeEditModal() {
    $('#edit-modal-backdrop').hidden = true;
    editingOp = null;
  }
  async function saveEditModal() {
    if (!editingOp) return;
    const reference = $('#edit-reference').value.trim().toUpperCase();
    const location = $('#edit-location').value.trim().toUpperCase();
    const quantity = Math.max(1, parseInt($('#edit-quantity').value, 10) || 0);
    const notes = $('#edit-notes').value.trim();
    if (reference === '') {
      showToast('La référence ne peut pas être vide');
      return;
    }
    if (location === '') {
      showToast("L'emplacement ne peut pas être vide");
      return;
    }
    const opType = editingOp.type.toLowerCase();
    const truckType = opType === 'sortie' ? ($('#edit-truck-segmented .segment.active')?.dataset.truck || 'Affrètement') : null;
    const grade = opType === 'retour' ? ($('#edit-grade-row .grade-btn.active')?.dataset.grade || 'A') : null;

    const updated = {
      ...editingOp,
      reference,
      location,
      quantity,
      truckType,
      grade,
      notes: notes === '' ? null : notes,
    };
    // Même règle des 24h que pour l'annulation : dans les 24h suivant
    // l'enregistrement, la correction est répercutée sur le serveur (donc
    // visible côté dashboard) si l'opération y était déjà synchronisée ;
    // passé ce délai, elle reste purement locale au téléphone.
    if (isWithinSelfCancelWindow(editingOp) && editingOp.syncStatus === 'SYNCED' && editingOp.serverUuid) {
      const result = await SyncManager.selfEditOperation(editingOp.serverUuid, {
        reference,
        quantity,
        location,
        truck_type: truckType,
        grade,
        notes: updated.notes,
      });
      if (!result.success && result.reason === 'offline') {
        showToast('Hors-ligne : modification non confirmée côté serveur, réessayez une fois connecté.');
      }
      // 'too_old' / 'not_own' / erreurs HTTP : cas limites — on garde quand
      // même la correction en local, le responsable reste seul maître de
      // la modification côté serveur au-delà de la fenêtre de 24h.
    }
    OperationRepository.updateOperation(updated);
    showToast(`Opération ${updated.reference} modifiée avec succès`);
    closeEditModal();
    renderHistory();
  }

  /* ---- Cancel (delete) operation modal ---- */
  // Fenêtre d'auto-annulation « définitive » (impacte aussi le serveur/
  // dashboard) : au-delà, l'annulation reste purement locale au téléphone.
  const WITHIN_SELF_CANCEL_MS = 24 * 60 * 60 * 1000;
  function isWithinSelfCancelWindow(op) {
    const recordedAt = new Date(op.timestamp).getTime();
    if (Number.isNaN(recordedAt)) return false;
    return Date.now() - recordedAt < WITHIN_SELF_CANCEL_MS;
  }
  /**
   * Point d'entrée unique pour annuler/supprimer une opération, utilisé
   * aussi bien depuis l'écran de succès que depuis l'historique :
   * - dans les 24h suivant l'enregistrement : suppression DÉFINITIVE,
   *   répercutée sur le serveur (stock inclus) si l'opération y était déjà
   *   synchronisée — donc aussi visible côté dashboard.
   * - passé ce délai : suppression purement locale au téléphone, sans
   *   aucun effet sur le serveur/dashboard (l'opération y reste, comptée
   *   normalement, jusqu'à ce que le responsable la supprime lui-même).
   */
  async function cancelOperation(op) {
    const recent = isWithinSelfCancelWindow(op);
    if (recent && op.syncStatus === 'SYNCED' && op.serverUuid) {
      const result = await SyncManager.selfCancelOperation(op.serverUuid);
      if (!result.success && result.reason === 'offline') {
        showToast('Hors-ligne : suppression non confirmée côté serveur, réessayez une fois connecté.');
      }
      // 'too_old' / 'not_own' / erreurs HTTP : cas limites (horloge décalée,
      // compte changé...) — on supprime quand même la copie locale, le
      // responsable reste seul maître de la suppression côté serveur.
    }
    OperationRepository.deleteOperation(op);
  }
  let opToCancel = null;
  function openCancelModal(op) {
    opToCancel = op;
    const opType = op.type.toLowerCase();
    const meta = TYPE_META[opType] || TYPE_META.inventaire;
    $('#cancel-summary').innerHTML = `
      <div class="summary-row"><span class="k">Type :</span><span class="v" style="color:${meta.color}">${meta.label}</span></div>
      <div class="summary-row"><span class="k">Référence :</span><span class="v">${escapeHtml(op.reference)}</span></div>
      <div class="summary-row"><span class="k">Quantité :</span><span class="v" style="color:#10B981">${op.quantity} unités</span></div>
      <div class="summary-row"><span class="k">Emplacement :</span><span class="v" style="font-family:'SFMono-Regular',Consolas,monospace">${escapeHtml(op.location)}</span></div>
      <div class="summary-row"><span class="k">Date :</span><span class="v" style="color:#94A3B8;font-weight:500">${formatDateTime(op.timestamp, false)}</span></div>
    `;
    $('#cancel-modal-backdrop').hidden = false;
  }
  function closeCancelModal() {
    $('#cancel-modal-backdrop').hidden = true;
    opToCancel = null;
  }
  async function confirmCancelOp() {
    if (!opToCancel) return;
    const op = opToCancel;
    closeCancelModal();
    await cancelOperation(op);
    showToast(`Opération ${op.reference} annulée / supprimée`);
    updatePendingCount();
    if (state.screen === 'history') renderHistory();
    if (state.screen === 'profile') renderProfile();
  }

  /* ---- Export CSV ---- */
  function exportToExcel() {
    const ops = getFilteredOperations();
    if (ops.length === 0) {
      const q = state.historySearch.trim();
      const filter = state.historyFilter;
      let msg;
      if (q !== '' && filter !== 'ALL') msg = `Aucune opération trouvée pour le filtre '${filter}' et la recherche '${q}'`;
      else if (q !== '') msg = `Aucune opération trouvée pour la recherche '${q}'`;
      else if (filter !== 'ALL') msg = `Aucune opération trouvée pour le filtre '${filter}'`;
      else msg = 'Aucune opération enregistrée à exporter';
      showToast(msg);
      return;
    }

    const q = state.historySearch.trim().replace(/ /g, '_');
    const filter = state.historyFilter.toUpperCase();
    let dynamicLabel;
    if (q !== '' && filter !== 'ALL') dynamicLabel = `${filter}_${q}`;
    else if (q !== '') dynamicLabel = `Recherche_${q}`;
    else if (filter !== 'ALL') dynamicLabel = `Filtre_${filter}`;
    else dynamicLabel = 'Historique_Complet';

    const fileDate = (() => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    })();

    const header = '\uFEFFID;Date Heure;Type Opération;Référence Produit;Emplacement;Quantité;Opérateur;Expédition / Grade;Observations;Statut Sync\n';
    const body = ops
      .map((op) => {
        const dateStr = formatDateTime(op.timestamp, true);
        let detail = '-';
        if (op.truckType) {
          detail = op.truckType;
        } else if (op.grade) {
          const g = GRADE_META[op.grade.toUpperCase()];
          detail = g ? g.label.replace('Grade A (Stock)', 'Grade A (Intégrable stock)').replace('Grade B (Maint. emb.)', 'Grade B (Maintenance emballage)').replace('Grade C (Pour pièce)', 'Grade C (Pour pièce)').replace('Grade D (Abîmé)', 'Grade D (Abîmé)') : `Grade ${op.grade}`;
        }
        const notes = (op.notes || '').replace(/;/g, ',').replace(/\n/g, ' ');
        return `${op.id};${dateStr};${op.type.toUpperCase()};${op.reference};${op.location};${op.quantity};${op.operatorName};${detail};${notes};${op.syncStatus}`;
      })
      .join('\n');

    const csv = header + body;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Export_${dynamicLabel}_${fileDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(`Export de ${ops.length} opération(s) généré (${dynamicLabel})`);
  }

  /* ===========================================================
     PROFILE SCREEN
  =========================================================== */
  function goProfile() {
    state.activeTab = 'profile';
    renderProfile();
    showScreen('profile');
  }

  function renderProfile() {
    mountBottomNav('bottom-nav-profile');
    const op = state.currentOperator;
    const all = OperationRepository.getAllOperations();

    $('#profile-initials').textContent = op ? op.initials : 'SB';
    $('#profile-name').textContent = op ? op.name : 'Sara Bennani';
    $('#profile-role').textContent = op ? op.role : 'Opératrice Sorties';

    const total = OperationRepository.getTotalCount();
    const today = OperationRepository.getTodayCount();
    $('#profile-total').textContent = total > 0 ? total : (all.length > 0 ? all.length : 4);
    $('#profile-today').textContent = today;

    const countBy = (type, fallback) =>
      all.length > 0 ? all.filter((o) => o.type.toLowerCase() === type).length : fallback;
    $('#activity-reception').textContent = countBy('reception', 12);
    $('#activity-sortie').textContent = countBy('sortie', 18);
    $('#activity-retour').textContent = countBy('retour', 4);
    $('#activity-inventaire').textContent = countBy('inventaire', 7);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    $('#sync-time').textContent = `Dernière synchronisation : ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  /* ===========================================================
     LOGOUT / SESSION
  =========================================================== */
  function logout() {
    SyncManager.logout(); // ferme aussi la session côté serveur (best-effort)
    state.currentOperator = null;
    state.enteredPin = '';
    state.pinError = null;
    renderPin();
    showScreen('login');
  }

  /* ===========================================================
     SERVER SYNC
  =========================================================== */
  function updatePendingCount() {
    state.pendingSyncCount = OperationRepository.getPendingSync().length;
    renderServerBadge();
  }

  async function testServerConnection(customUrl) {
    const res = await SyncManager.testConnection(customUrl);
    if (res.success) {
      state.isServerConnected = true;
      state.lastSyncMessage = res.message;
      showToast(res.message);
      syncPendingOperations();
    } else {
      state.isServerConnected = false;
      state.lastSyncMessage = res.message;
      showToast(res.message);
    }
    renderServerBadge();
    renderServerModalStatus();
  }

  async function syncPendingOperations() {
    state.isSyncing = true;
    renderServerBadge();
    renderServerModalStatus();
    const pending = OperationRepository.getPendingSync();
    if (pending.length === 0) {
      state.isSyncing = false;
      renderServerBadge();
      showToast('Toutes les opérations sont déjà synchronisées avec le PC');
      return;
    }
    const res = await SyncManager.sendOperations(pending);
    state.isSyncing = false;
    if (res.success) {
      state.isServerConnected = true;
      pending.forEach((op) => OperationRepository.updateOperation({ ...op, syncStatus: 'SYNCED' }));
      updatePendingCount();
      state.lastSyncMessage = res.message;
      showToast(`✅ ${res.message}`);
    } else {
      state.isServerConnected = false;
      state.lastSyncMessage = res.message;
      showToast('⚠️ Stocké en local (Serveur PC hors-ligne)');
    }
    renderServerBadge();
    renderServerModalStatus();
  }

  async function syncAllOperationsToPC() {
    state.isSyncing = true;
    renderServerBadge();
    renderServerModalStatus();
    const all = OperationRepository.getAllOperations();
    if (all.length === 0) {
      state.isSyncing = false;
      renderServerBadge();
      showToast('Aucune opération dans l\'historique à synchroniser');
      return;
    }
    const res = await SyncManager.sendOperations(all);
    state.isSyncing = false;
    if (res.success) {
      state.isServerConnected = true;
      all.forEach((op) => OperationRepository.updateOperation({ ...op, syncStatus: 'SYNCED' }));
      updatePendingCount();
      state.lastSyncMessage = res.message;
      showToast(`✅ Export complet vers PC réussi (${all.length} opérations)`);
    } else {
      state.isServerConnected = false;
      state.lastSyncMessage = res.message;
      showToast(`⚠️ Erreur : ${res.message}`);
    }
    renderServerBadge();
    renderServerModalStatus();
  }

  function openServerModal() {
    const usesBuildTimeDefault = WebzaConfig.usesBuildTimeDefault();
    $('#server-url-edit').hidden = usesBuildTimeDefault;
    $('#server-url-readonly').hidden = !usesBuildTimeDefault;
    if (usesBuildTimeDefault) {
      // URL fournie au build (tunnel Cloudflare) : affichage lecture seule,
      // pas de formulaire de saisie IP (workflow LAN obsolète).
      $('#server-url-label').textContent = 'ADRESSE DU SERVEUR (CONFIGURÉE)';
      $('#server-url-readonly-value').textContent = state.serverUrl;
    } else {
      $('#server-url-label').textContent = 'ADRESSE IP DU SERVEUR PC';
      $('#server-url-input').value = state.serverUrl;
    }
    renderServerModalStatus();
    $('#server-modal-backdrop').hidden = false;
  }

  // Clic sur le badge d'état serveur : si une URL de build (tunnel) est
  // deja configuree et que le serveur est hors-ligne, on relance juste un
  // test de connexion (bouton "Reessayer" implicite) plutot que de rouvrir
  // le formulaire de saisie IP, qui n'a plus lieu d'etre dans ce cas.
  function handleServerBadgeClick() {
    if (state.isServerConnected === false && WebzaConfig.usesBuildTimeDefault()) {
      showToast('Nouvelle tentative de connexion...');
      testServerConnection();
      return;
    }
    openServerModal();
  }
  function closeServerModal() {
    $('#server-modal-backdrop').hidden = true;
  }
  function renderServerModalStatus() {
    const banner = $('#server-status-banner');
    const icon = $('#server-status-icon');
    const title = $('#server-status-banner-title');
    const sub = $('#server-status-banner-sub');
    let stateName = 'unknown';
    let titleText = 'Non testé';
    let iconPath = '<path fill="#94A3B8" d="M12 4a1 1 0 011 1v6a1 1 0 01-2 0V5a1 1 0 011-1zm0 12a1.25 1.25 0 110 2.5A1.25 1.25 0 0112 16z"/>';
    if (state.isServerConnected === true) {
      stateName = 'connected';
      titleText = 'Connecté au PC';
      iconPath = '<path fill="#34D399" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>';
    } else if (state.isServerConnected === false) {
      stateName = 'offline';
      titleText = 'Serveur non joignable (Hors-ligne)';
      iconPath = '<path fill="#FBBF24" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>';
    }
    banner.setAttribute('data-state', stateName);
    icon.innerHTML = iconPath;
    title.textContent = titleText;
    sub.textContent = state.lastSyncMessage || '';
    sub.style.color = state.isServerConnected === true ? '#6EE7B7' : '#94A3B8';

    const syncBtnLabel = $('#server-sync-btn-label');
    syncBtnLabel.textContent = state.pendingSyncCount > 0 ? `Synchro (${state.pendingSyncCount})` : 'Synchro';
    $('#server-sync-btn').disabled = state.isSyncing;
    $('#server-sync-all-btn').disabled = state.isSyncing;
  }

  /* ===========================================================
     UTIL
  =========================================================== */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ===========================================================
     EVENT WIRING
  =========================================================== */
  function wireEvents() {
    // --- Login keypad ---
    $$('.key').forEach((btn) => {
      btn.addEventListener('click', () => onKeypadPress(btn.dataset.key));
    });
    // --- Login: bouton Paramètres serveur (haut droite) ---
    $('#login-settings-btn').addEventListener('click', openServerModal);

    // --- Home ---
    $('#home-logout-btn').addEventListener('click', logout);
    $('#server-status-badge').addEventListener('click', handleServerBadgeClick);
    $$('.tile').forEach((tile) => {
      tile.addEventListener('click', () => startOperation(tile.dataset.action));
    });

    // --- Form: reference ---
    const refInput = $('#ref-input');
    refInput.addEventListener('input', () => {
      state.formState.reference = refInput.value.toUpperCase();
      state.formState.referenceError = null;
      $('#ref-clear-btn').hidden = state.formState.reference.length === 0;
      setFieldError('ref-error', null);
      renderRefSuggestions(state.formState.reference);
    });
    refInput.addEventListener('focus', () => renderRefSuggestions(state.formState.reference));
    $('#ref-clear-btn').addEventListener('click', () => {
      state.formState.reference = '';
      refInput.value = '';
      $('#ref-clear-btn').hidden = true;
      renderRefSuggestions('');
      refInput.focus();
    });
    $('#ref-suggestions-close').addEventListener('click', () => { $('#ref-suggestions').hidden = true; });
    $('#ref-suggestions-list').addEventListener('click', (e) => {
      const item = e.target.closest('.suggestion-item');
      if (!item) return;
      state.formState.reference = item.dataset.value;
      refInput.value = item.dataset.value;
      $('#ref-suggestions').hidden = true;
      $('#ref-clear-btn').hidden = false;
    });

    // --- Form: quantity ---
    const qtyInput = $('#qty-input');
    qtyInput.addEventListener('input', () => {
      const digits = qtyInput.value.replace(/\D/g, '').slice(0, 6);
      qtyInput.value = digits;
      state.formState.quantity = digits === '' ? 0 : parseInt(digits, 10);
      state.formState.quantityError = null;
      setFieldError('qty-error', null);
    });

    // --- Form: location mode ---
    $('#loc-mode-default').addEventListener('click', () => {
      state.formState.locationMode = 'default';
      // Emplacement par défaut = la zone sélectionnée directement
      // (jamais un code d'emplacement précis type A1, B7...).
      state.formState.location = state.formState.locationLevel;
      renderForm();
    });
    $('#loc-mode-defined').addEventListener('click', () => {
      state.formState.locationMode = 'defined';
      if (!state.formState.location || /^[ABC]$/.test(state.formState.location)) {
        state.formState.location = LOCATIONS[0] || 'A1';
      }
      renderForm();
      renderLocSuggestions(state.formState.location);
    });
    $$('.level-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.formState.locationLevel = btn.dataset.level;
        state.formState.location = btn.dataset.level;
        renderForm();
      });
    });
    const locInput = $('#loc-input');
    locInput.addEventListener('input', () => {
      state.formState.location = locInput.value.toUpperCase();
      renderLocSuggestions(state.formState.location);
    });
    $('#loc-suggestions-list').addEventListener('click', (e) => {
      const item = e.target.closest('.suggestion-item');
      if (!item) return;
      state.formState.location = item.dataset.value;
      locInput.value = item.dataset.value;
      $('#loc-suggestions').hidden = true;
    });

    // --- Form: truck / grade ---
    $$('#truck-field-block .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.formState.truckType = btn.dataset.truck;
        renderForm();
      });
    });
    $$('#grade-field-block .grade-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.formState.grade = btn.dataset.grade;
        renderForm();
      });
    });

    // --- Form: notes / submit / back ---
    $('#notes-input').addEventListener('input', (e) => { state.formState.notes = e.target.value; });
    $('#form-back-btn').addEventListener('click', () => goHome());
    $('#submit-op-btn').addEventListener('click', validateAndSubmitOperation);

    // --- Success screen ---
    $('#success-repeat-btn').addEventListener('click', () => startOperation(state.lastOperation.type));
    $('#success-home-btn').addEventListener('click', () => goHome());
    $('#success-cancel-btn').addEventListener('click', async () => {
      if (!state.lastOperation) return;
      const op = state.lastOperation;
      await cancelOperation(op);
      showToast(`Opération ${op.reference} annulée / supprimée`);
      updatePendingCount();
      goHome();
    });

    // --- History ---
    const historySearchInput = $('#history-search');
    historySearchInput.addEventListener('input', () => {
      state.historySearch = historySearchInput.value;
      $('#history-search-clear').hidden = state.historySearch.length === 0;
      renderHistory();
    });
    $('#history-search-clear').addEventListener('click', () => {
      state.historySearch = '';
      historySearchInput.value = '';
      renderHistory();
    });
    $('#history-export-btn').addEventListener('click', exportToExcel);
    $('#filter-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.historyFilter = chip.dataset.filter;
      renderHistory();
    });
    $('#ops-table-body').addEventListener('click', (e) => {
      const btn = e.target.closest('.row-action-btn');
      if (!btn) return;
      const opId = Number(btn.dataset.menuId);
      openActionMenu(btn, opId);
    });
    $('#action-menu-backdrop').addEventListener('click', (e) => {
      if (e.target === $('#action-menu-backdrop')) closeActionMenu();
    });
    $('#action-menu-edit').addEventListener('click', () => {
      const opId = Number($('#action-menu').dataset.opId);
      const op = OperationRepository.getAllOperations().find((o) => o.id === opId);
      closeActionMenu();
      if (op) openEditModal(op);
    });
    $('#action-menu-cancel').addEventListener('click', () => {
      const opId = Number($('#action-menu').dataset.opId);
      const op = OperationRepository.getAllOperations().find((o) => o.id === opId);
      closeActionMenu();
      if (op) openCancelModal(op);
    });

    // --- Edit modal ---
    $('#edit-cancel-btn').addEventListener('click', closeEditModal);
    $('#edit-save-btn').addEventListener('click', saveEditModal);
    $$('#edit-truck-segmented .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#edit-truck-segmented .segment').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    $$('#edit-grade-row .grade-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#edit-grade-row .grade-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    $('#edit-modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('#edit-modal-backdrop')) closeEditModal();
    });

    // --- Cancel modal ---
    $('#cancel-keep-btn').addEventListener('click', closeCancelModal);
    $('#cancel-confirm-btn').addEventListener('click', confirmCancelOp);
    $('#cancel-modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('#cancel-modal-backdrop')) closeCancelModal();
    });

    // --- Container (comptage réception) ---
    $('#container-cancel-btn').addEventListener('click', () => {
      closeContainerModal();
      goHome();
    });
    $('#container-claim-btn').addEventListener('click', submitContainerClaim);
    $('#container-code-input').addEventListener('keydown', (e) => {
      // Un scanner code-barres se comporte comme un clavier et valide
      // généralement avec un Entrée en fin de scan.
      if (e.key === 'Enter') {
        e.preventDefault();
        submitContainerClaim();
      }
    });
    $('#container-modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('#container-modal-backdrop')) {
        closeContainerModal();
        goHome();
      }
    });
    $('#container-finish-btn').addEventListener('click', finishActiveContainer);
    $('#success-finish-container-btn').addEventListener('click', finishActiveContainer);
    $('#container-scan-btn').addEventListener('click', openBarcodeScanner);
    $('#scanner-close-btn').addEventListener('click', closeBarcodeScanner);

    // --- Profile ---
    $('#profile-logout-btn').addEventListener('click', logout);

    // --- Server config modal ---
    // NOTE : quand une URL de build (tunnel) est active, le formulaire de
    // saisie est masque (voir openServerModal) - on ne doit alors jamais
    // ecraser la config avec la valeur (obsolete/vide) du champ cache.
    $('#server-test-btn').addEventListener('click', () => {
      if (WebzaConfig.usesBuildTimeDefault()) {
        testServerConnection();
        return;
      }
      const url = $('#server-url-input').value.trim();
      SyncManager.setServerUrl(url);
      state.serverUrl = SyncManager.getServerUrl();
      testServerConnection(url);
    });
    $('#server-sync-btn').addEventListener('click', syncPendingOperations);
    $('#server-sync-all-btn').addEventListener('click', syncAllOperationsToPC);
    $('#server-save-close-btn').addEventListener('click', () => {
      if (WebzaConfig.usesBuildTimeDefault()) {
        testServerConnection();
        closeServerModal();
        return;
      }
      const url = $('#server-url-input').value.trim();
      SyncManager.setServerUrl(url);
      state.serverUrl = SyncManager.getServerUrl();
      testServerConnection(url);
      closeServerModal();
    });
    $('#server-modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('#server-modal-backdrop')) closeServerModal();
    });

    // Global: close suggestion panels / action menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#ref-input') && !e.target.closest('#ref-suggestions') && !e.target.closest('.field-block')) {
        // no-op — handled per-field above; kept for safety
      }
    });
  }

  /* ===========================================================
     BACKGROUND TIMERS (session + auto-sync, matches ViewModel init{})
  =========================================================== */
  function startTimers() {
    setInterval(() => {
      if (state.lockoutSeconds > 0) {
        state.lockoutSeconds -= 1;
        renderPin();
      }
    }, 1000);

    setInterval(async () => {
      updatePendingCount();
      const pending = OperationRepository.getPendingSync();
      if (pending.length > 0) {
        const res = await SyncManager.sendOperations(pending);
        if (res.success) {
          state.isServerConnected = true;
          pending.forEach((op) => OperationRepository.updateOperation({ ...op, syncStatus: 'SYNCED' }));
          updatePendingCount();
        } else {
          state.isServerConnected = false;
        }
        renderServerBadge();
      }
    }, 10000);
  }

  /* ===========================================================
     INIT
  =========================================================== */
  function init() {
    wireEvents();
    renderPin();
    updatePendingCount();
    startTimers();

    // Splash screen for a brief moment, then show login
    showScreen('splash');
    setTimeout(() => {
      showScreen('login');
    }, 900);

    // Register service worker for offline PWA support
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
