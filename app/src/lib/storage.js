/**
 * Session persistence.
 *
 * Two different things are being stored, and they need different treatment:
 *
 *   - settings are tiny and read synchronously on boot, so localStorage is
 *     right. IndexedDB is asynchronous and would flash the defaults first.
 *   - the project (entries, format metadata, original file text) can be several
 *     megabytes for a large PO file, and localStorage caps out around 5 MB, so
 *     it has to be IndexedDB.
 *
 * Everything degrades to a no-op rather than throwing: private browsing blocks
 * IndexedDB in some browsers, and losing autosave is annoying but must not take
 * the editor down with it.
 */

import { DEFAULT_SETTINGS } from './constants.js';

const DB_NAME = 'm3owl-poeditor';
const DB_VERSION = 1;
const STORE = 'session';
const SESSION_KEY = 'current';
const SETTINGS_KEY = 'm3owl-poeditor:settings';

// ------------------------------------------------------------- settings

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota or private mode; settings simply will not persist.
  }
}

// ------------------------------------------------------------- indexeddb

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the database.'));
  });

  // A failed open must not be cached as a permanent failure.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

function transaction(mode, run) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;

        try {
          result = run(store);
        } catch (error) {
          reject(error);
          return;
        }

        tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
        tx.onerror = () => reject(tx.error ?? new Error('Storage transaction failed.'));
        tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted.'));
      }),
  );
}

/**
 * Persist the working session.
 *
 * `bytes` and DOM nodes must not be stored, so only the serialisable parts of
 * the project are written.
 */
export async function saveSession(payload) {
  try {
    await transaction('readwrite', (store) =>
      store.put(
        {
          ...payload,
          savedAt: new Date().toISOString(),
        },
        SESSION_KEY,
      ),
    );
    return true;
  } catch {
    return false;
  }
}

export async function loadSession() {
  try {
    const value = await transaction('readonly', (store) => store.get(SESSION_KEY));
    return value ?? null;
  } catch {
    return null;
  }
}

export async function clearSession() {
  try {
    await transaction('readwrite', (store) => store.delete(SESSION_KEY));
    return true;
  } catch {
    return false;
  }
}

/** Approximate storage used, for the status bar. */
export async function storageEstimate() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/**
 * Debounced autosave.
 *
 * Called on every keystroke, so it must not write on every keystroke. The timer
 * is reset on each call and the write happens once typing pauses.
 */
export function createAutosave(delay = 1200) {
  let timer = null;
  let pending = null;
  let lastSaved = null;
  let onSaved = null;

  const flush = async () => {
    if (!pending) return;
    const payload = pending;
    pending = null;
    const ok = await saveSession(payload);
    if (ok) {
      lastSaved = new Date();
      onSaved?.(lastSaved);
    }
  };

  return {
    schedule(payload, callback) {
      pending = payload;
      if (callback) onSaved = callback;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, delay);
    },
    async flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
    get lastSaved() {
      return lastSaved;
    },
  };
}
