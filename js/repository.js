/* ===========================================================
   webZa-sys — Dépôt local des opérations (équivalent Room DB)
   Persistance via localStorage (offline-first)
=========================================================== */

const OperationRepository = {
  STORAGE_KEY: 'wms_operations',
  ID_KEY: 'wms_next_id',

  _readAll() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  _writeAll(ops) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(ops));
  },

  _nextId() {
    let n = parseInt(localStorage.getItem(this.ID_KEY) || '0', 10);
    n += 1;
    localStorage.setItem(this.ID_KEY, String(n));
    return n;
  },

  getAllOperations() {
    return this._readAll().sort((a, b) => b.timestamp - a.timestamp);
  },

  getTotalCount() {
    return this._readAll().length;
  },

  getTodayCount() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const start = startOfDay.getTime();
    return this._readAll().filter((op) => op.timestamp >= start).length;
  },

  getPendingSync() {
    return this._readAll().filter((op) => op.syncStatus === 'PENDING');
  },

  insertOperation(operation) {
    const ops = this._readAll();
    const withId = { ...operation, id: this._nextId() };
    ops.push(withId);
    this._writeAll(ops);
    return withId;
  },

  updateOperation(updated) {
    const ops = this._readAll();
    const idx = ops.findIndex((o) => o.id === updated.id);
    if (idx !== -1) {
      ops[idx] = updated;
      this._writeAll(ops);
    }
  },

  deleteOperation(operation) {
    const ops = this._readAll().filter((o) => o.id !== operation.id);
    this._writeAll(ops);
  },
};

function makeUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
