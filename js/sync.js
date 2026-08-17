/* ===========================================================
   webZa-sys — Gestionnaire de synchronisation avec le backend
   Portage de SyncManager.kt, adapté à l'architecture tunnel/Vercel :
   - l'URL du serveur vient de WebzaConfig (jamais d'IP/localhost en dur) ;
   - toutes les requêtes passent credentials:'include' pour que le cookie
     de session HttpOnly (posé par /api/operators/login) soit envoyé ;
   - le PIN local (data.js) ne sert qu'à un retour visuel instantané hors
     connexion : la seule autorisation qui compte pour l'API est la session
     serveur ouverte par login(). Voir js/app.js.
=========================================================== */

const SyncManager = {
  // PIN gardé en mémoire (jamais persisté) le temps de la session en cours,
  // pour pouvoir rétablir automatiquement la session serveur dès que la
  // connexion revient, sans redemander le code à l'opérateur.
  _pendingPin: null,
  _sessionEstablished: false,

  getServerUrl() {
    return WebzaConfig.getApiBaseUrl();
  },

  setServerUrl(url) {
    WebzaConfig.setApiBaseUrl(url);
  },

  async _fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(id);
    }
  },

  async testConnection(customUrl) {
    const targetUrl = (customUrl || this.getServerUrl()).replace(/\/+$/, '');
    try {
      const res = await this._fetchWithTimeout(`${targetUrl}/api/health`, { method: 'GET' }, 3000);
      if (res.ok) {
        const json = await res.json();
        const serverName = json.server || 'Serveur WMS';
        return { success: true, message: `Connecté avec succès à ${serverName}` };
      }
      return { success: false, message: `Serveur a répondu avec code ${res.status}` };
    } catch (e) {
      return { success: false, message: `Impossible de joindre le serveur (${e.message || 'Délai dépassé'})` };
    }
  },

  /**
   * Ouvre une session serveur réelle à partir du code PIN. À appeler après
   * (ou en parallèle de) la vérification locale instantanée dans app.js.
   * Le cookie de session est posé automatiquement par le navigateur
   * (Set-Cookie de la réponse) : rien à stocker manuellement côté client.
   */
  async login(pin) {
    const targetUrl = this.getServerUrl();
    try {
      const res = await this._fetchWithTimeout(
        `${targetUrl}/api/operators/login`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ code: pin }),
        },
        5000
      );
      if (res.ok) {
        this._pendingPin = pin;
        this._sessionEstablished = true;
        const operator = await res.json();
        return { success: true, operator };
      }
      if (res.status === 429) {
        return { success: false, offline: false, message: 'Trop de tentatives, réessayez plus tard.' };
      }
      return { success: false, offline: false, message: 'Code incorrect côté serveur.' };
    } catch (e) {
      // Pas de réseau / serveur injoignable : on retente automatiquement
      // dès que la connexion revient (voir ensureSession).
      this._pendingPin = pin;
      this._sessionEstablished = false;
      return { success: false, offline: true, message: 'Hors-ligne : session serveur en attente.' };
    }
  },

  async logout() {
    const targetUrl = this.getServerUrl();
    this._pendingPin = null;
    this._sessionEstablished = false;
    try {
      await this._fetchWithTimeout(
        `${targetUrl}/api/auth/logout`,
        { method: 'POST', credentials: 'include' },
        3000
      );
    } catch (e) {
      // Rien à faire hors-ligne : la session expirera naturellement côté serveur.
    }
  },

  /** Tente d'établir la session serveur si elle ne l'est pas déjà (utile
   * après une connexion perdue puis retrouvée, avant une synchronisation). */
  async ensureSession() {
    if (this._sessionEstablished) return true;
    if (!this._pendingPin) return false;
    const res = await this.login(this._pendingPin);
    return !!res.success;
  },

  async sendOperations(operations) {
    if (!operations || operations.length === 0) {
      return { success: true, syncedCount: 0, message: 'Aucune opération à synchroniser' };
    }
    const hasSession = await this.ensureSession();
    if (!hasSession) {
      return { success: false, message: 'Session serveur non établie (hors-ligne ou non connecté).' };
    }

    const targetUrl = this.getServerUrl();
    try {
      const payload = {
        operations: operations.map((op) => ({
          id: op.id,
          serverUuid: op.serverUuid,
          type: op.type,
          reference: op.reference,
          quantity: op.quantity,
          location: op.location,
          truckType: op.truckType ?? null,
          grade: op.grade ?? null,
          operatorId: op.operatorId,
          operatorName: op.operatorName,
          timestamp: op.timestamp,
          notes: op.notes ?? null,
        })),
      };
      const res = await this._fetchWithTimeout(
        `${targetUrl}/api/sync`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload),
        },
        8000
      );
      if (res.status === 401) {
        // La session a expiré côté serveur : on force une ré-authentification
        // au prochain essai plutôt que de perdre silencieusement les données.
        this._sessionEstablished = false;
        return { success: false, message: 'Session expirée, reconnexion nécessaire.' };
      }
      if (res.ok) {
        const json = await res.json();
        const count = json.synced_count ?? operations.length;
        return { success: true, syncedCount: count, message: `${count} opération(s) synchronisée(s) vers le serveur` };
      }
      return { success: false, message: `Erreur serveur ${res.status}` };
    } catch (e) {
      return { success: false, message: `Échec de synchronisation : ${e.message || 'Connexion impossible'}` };
    }
  },
};
