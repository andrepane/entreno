(function (global, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(global);
  } else {
    global.entrenoHistory = factory(global);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
  "use strict";

  const STORAGE_KEY = "entreno.history.v1";
  const LEGACY_KEYS = ["entreno.history", "historyEntries", "analyticsHistory"];
  const VALID_TYPES = new Set(["reps", "tiempo", "peso"]);

  const getCrypto = () =>
    (typeof global !== "undefined" && global.crypto) ||
    (typeof globalThis !== "undefined" && globalThis.crypto) ||
    (typeof window !== "undefined" && window.crypto) ||
    undefined;

  const cryptoObj = getCrypto();

  function uuid() {
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      return cryptoObj.randomUUID();
    }
    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function toISODate(value) {
    if (!value) return new Date().toISOString().slice(0, 10);
    const [y, m = 1, d = 1] = String(value).split("-").map(Number);
    if (!Number.isFinite(y)) {
      return new Date().toISOString().slice(0, 10);
    }
    const date = new Date(y, (m || 1) - 1, d || 1);
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString().slice(0, 10);
    }
    date.setHours(0, 0, 0, 0);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  const localStorageLike = (() => {
    if (typeof global !== "undefined" && global.localStorage) return global.localStorage;
    let store = new Map();
    return {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      }
    };
  })();

  let entries = [];
  let subscribers = [];
  let warnings = [];

  function minutesToSeconds(min) {
    const numeric = Number(min);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric * 60);
  }

  function clone(entry) {
    return { ...entry };
  }

  function validateEntry(entry) {
    if (!entry || typeof entry !== "object") return false;
    if (!entry.ejercicio || typeof entry.ejercicio !== "string") return false;
    if (!VALID_TYPES.has(entry.tipo)) return false;
    const valor = Number(entry.valor);
    if (!Number.isFinite(valor)) return false;
    return true;
  }

  function normalizeEntry(raw) {
    if (!validateEntry(raw)) return null;
    const normalized = {
      id: raw.id && typeof raw.id === "string" ? raw.id : uuid(),
      fechaISO: toISODate(raw.fechaISO),
      ejercicio: raw.ejercicio.trim(),
      tipo: raw.tipo,
      valor: Number(raw.valor),
    };
    if (raw.notas && typeof raw.notas === "string") {
      const clean = raw.notas.trim();
      if (clean) normalized.notas = clean;
    }
    return normalized;
  }

  function notify() {
    subscribers.forEach((fn) => {
      try {
        fn(getAllEntries());
      } catch (err) {
        console.warn("entrenoHistory subscriber error", err);
      }
    });
  }

  function getAllEntries() {
    return entries.map(clone);
  }

  function setEntries(next, skipSave) {
    entries = next;
    if (!skipSave) save();
    notify();
  }

  function migrateLegacy() {
    let migrated = 0;
    let failed = 0;
    if (entries.length) return { migrated, failed };
    LEGACY_KEYS.forEach((key) => {
      const raw = localStorageLike.getItem(key);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const candidateEntries = Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : [];
        candidateEntries.forEach((item) => {
          const normalized = normalizeEntry(item);
          if (normalized) {
            entries.push(normalized);
            migrated += 1;
          } else {
            failed += 1;
          }
        });
        localStorageLike.removeItem(key);
      } catch (err) {
        failed += 1;
      }
    });
    if (migrated || failed) {
      save();
    }
    return { migrated, failed };
  }

  function load() {
    warnings = [];
    entries = [];
    try {
      const raw = localStorageLike.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
        const restored = [];
        const seen = new Set();
        list.forEach((item) => {
          const normalized = normalizeEntry(item);
          if (normalized && !seen.has(normalized.id)) {
            seen.add(normalized.id);
            restored.push(normalized);
          }
        });
        entries = restored;
      }
    } catch (err) {
      console.warn("Error reading history storage", err);
      warnings.push("No se pudo leer el historial guardado. Se reinició el seguimiento.");
      entries = [];
    }
    const { migrated, failed } = migrateLegacy();
    if (failed) {
      warnings.push(`No se pudo migrar ${failed} entradas antiguas.`);
    }
    if (migrated) {
      warnings.push(`Se migraron ${migrated} entradas antiguas.`);
    }
    notify();
    return getAllEntries();
  }

  function save() {
    const payload = { version: 1, entries: entries.map(clone) };
    try {
      localStorageLike.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("No se pudo guardar el historial", err);
      warnings.push("No se pudo guardar el historial en el navegador.");
    }
  }

  function addEntry(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      throw new Error("Entrada de historial inválida");
    }
    entries = entries.concat(normalized);
    save();
    notify();
    return clone(normalized);
  }

  function updateEntry(id, patch) {
    if (!id) return null;
    let updated = null;
    entries = entries.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item };
      if (patch.fechaISO) next.fechaISO = toISODate(patch.fechaISO);
      if (patch.valor != null && Number.isFinite(Number(patch.valor))) {
        next.valor = Number(patch.valor);
      }
      if (typeof patch.notas === "string") {
        const clean = patch.notas.trim();
        if (clean) {
          next.notas = clean;
        } else {
          delete next.notas;
        }
      }
      if (patch.ejercicio && typeof patch.ejercicio === "string") {
        next.ejercicio = patch.ejercicio.trim();
      }
      if (patch.tipo && VALID_TYPES.has(patch.tipo)) {
        next.tipo = patch.tipo;
      }
      updated = next;
      return next;
    });
    if (updated) {
      save();
      notify();
      return clone(updated);
    }
    return null;
  }

  function deleteEntry(id) {
    if (!id) return false;
    const before = entries.length;
    entries = entries.filter((item) => item.id !== id);
    if (entries.length !== before) {
      save();
      notify();
      return true;
    }
    return false;
  }

  function clear() {
    entries = [];
    save();
    notify();
  }

  function listExercises() {
    const map = new Map();
    entries.forEach((entry) => {
      const key = entry.ejercicio;
      if (!map.has(key)) {
        map.set(key, {
          tipos: new Set([entry.tipo]),
          countPorTipo: { reps: 0, tiempo: 0, peso: 0 },
          lastDate: entry.fechaISO
        });
      }
      const data = map.get(key);
      data.tipos.add(entry.tipo);
      data.countPorTipo[entry.tipo] = (data.countPorTipo[entry.tipo] || 0) + 1;
      if (!data.lastDate || data.lastDate < entry.fechaISO) {
        data.lastDate = entry.fechaISO;
      }
    });
    return map;
  }

  function getEntriesByExerciseAndType(ejercicio, tipo) {
    if (!ejercicio || !VALID_TYPES.has(tipo)) return [];
    return entries
      .filter((entry) => entry.ejercicio === ejercicio && entry.tipo === tipo)
      .sort((a, b) => a.fechaISO.localeCompare(b.fechaISO))
      .map(clone);
  }

  function compareWithLast(ejercicio, tipo, nuevoValor) {
    if (!ejercicio || !VALID_TYPES.has(tipo)) {
      return { delta: 0, pct: null, last: null, message: "" };
    }
    const list = getEntriesByExerciseAndType(ejercicio, tipo);
    const lastEntry = list[list.length - 1] || null;
    if (!lastEntry) {
      return {
        delta: 0,
        pct: null,
        last: null,
        message: `Primer registro para ${ejercicio} (${tipo}).`
      };
    }
    const deltaRaw = Number(nuevoValor) - Number(lastEntry.valor);
    const delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;
    const deltaLabel = Number.isInteger(delta) ? delta : Number(delta.toFixed(2));
    const pct = lastEntry.valor > 0 ? (delta / lastEntry.valor) * 100 : null;
    let label;
    if (delta > 0) {
      label = `+${deltaLabel} ${tipo === "reps" ? "repeticiones" : tipo === "tiempo" ? "segundos" : "kg"} respecto al último registro`;
    } else if (delta < 0) {
      label = `${deltaLabel} ${tipo === "reps" ? "repeticiones" : tipo === "tiempo" ? "segundos" : "kg"} respecto al último registro`;
    } else {
      label = "Igual que el último registro";
    }
    return {
      delta,
      pct,
      last: Number(lastEntry.valor),
      message: label
    };
  }

  function exportJSON() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), entries: entries.map(clone) };
    return JSON.stringify(payload, null, 2);
  }

  async function importJSON(input) {
    let text = "";
    if (typeof input === "string") {
      text = input;
    } else if (input && typeof input.text === "function") {
      text = await input.text();
    } else {
      throw new Error("Formato de importación no soportado");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error("El archivo no contiene JSON válido");
    }
    const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const imported = [];
    list.forEach((item) => {
      const normalized = normalizeEntry(item);
      if (normalized) {
        imported.push(normalized);
      }
    });
    if (!imported.length) {
      throw new Error("No se encontraron entradas válidas para importar");
    }
    const dedup = new Map();
    imported.forEach((item) => {
      dedup.set(item.id, item);
    });
    entries = Array.from(dedup.values());
    save();
    notify();
    return { imported: entries.length };
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    subscribers.push(fn);
    return () => {
      subscribers = subscribers.filter((cb) => cb !== fn);
    };
  }

  function getWarnings() {
    return warnings.slice();
  }

  load();

  return {
    load,
    save,
    addEntry,
    updateEntry,
    deleteEntry,
    clear,
    listExercises,
    getEntriesByExerciseAndType,
    compareWithLast,
    exportJSON,
    importJSON,
    subscribe,
    getWarnings,
    minutesToSeconds,
    getAllEntries,
  };
});
