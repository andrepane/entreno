(function (global) {
  "use strict";

  const DB_NAME = "entreno-state-v1";
  const STORE_NAME = "profiles";
  const LOCAL_PREFIX = "workouts.v1";
  let dbPromise;

  function openDb() {
    if (!global.indexedDB) return Promise.reject(new Error("IndexedDB no disponible"));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = global.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("No se pudo abrir IndexedDB"));
        request.onblocked = () => reject(new Error("IndexedDB bloqueado"));
      }).catch((error) => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  }

  async function read(profileId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(profileId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("No se pudo leer IndexedDB"));
    });
  }

  async function write(profileId, serialized) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(serialized, profileId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("No se pudo guardar en IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("Guardado cancelado"));
    });
    if (await read(profileId) !== serialized) throw new Error("La verificación de IndexedDB falló");
  }

  function legacyKey(profileId) {
    return LOCAL_PREFIX + "." + profileId;
  }

  async function load(profileId) {
    const key = legacyKey(profileId);
    const legacy = global.localStorage.getItem(key);
    try {
      const stored = await read(profileId);
      if (stored !== null) {
        const storedState = JSON.parse(stored);
        if (legacy && legacy !== stored) {
          const legacyState = JSON.parse(legacy);
          const oldTime = Date.parse(legacyState.lastModifiedAt || "") || 0;
          const newTime = Date.parse(storedState.lastModifiedAt || "") || 0;
          if (oldTime > newTime) {
            await write(profileId, legacy);
            return legacyState;
          }
        }
        if (legacy) {
          if (await read(profileId) !== stored) throw new Error("La lectura de IndexedDB falló");
        }
        return storedState;
      }
      if (!legacy) return null;
      const parsed = JSON.parse(legacy);
      await write(profileId, legacy);
      return parsed;
    } catch (error) {
      // If migration fails, leave the old copy untouched.
      if (legacy) return JSON.parse(legacy);
      throw error;
    }
  }

  async function save(profileId, state) {
    const serialized = JSON.stringify(state);
    const key = legacyKey(profileId);
    try {
      await write(profileId, serialized);
      return true;
    } catch (error) {
      console.warn("IndexedDB no disponible; se intentará guardar localmente", error);
      try {
        global.localStorage.setItem(key, serialized);
        return true;
      } catch (fallbackError) {
        console.error("No se pudieron guardar los datos", fallbackError);
        return false;
      }
    }
  }

  async function finalize(profileId, state) {
    const serialized = JSON.stringify(state);
    if (await read(profileId) !== serialized) return false;
    global.localStorage.removeItem(legacyKey(profileId));
    return (await read(profileId)) === serialized;
  }

  global.entrenoStateStorage = { load, save, finalize };
})(typeof globalThis !== "undefined" ? globalThis : window);
