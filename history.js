(function (global, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(global);
  } else {
    global.entrenoHistory = factory(global);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
  "use strict";

  const STORAGE_KEY = "entreno.history.v1";
  const VALID_TYPES = new Set(["reps", "tiempo", "peso"]);
  const LEGACY_KEYS = ["entreno.history", "historyEntries", "analyticsHistory"];
  const TYPE_UNITS = { reps: "reps", tiempo: "seg", peso: "kg" };
  const TYPE_LABEL = { reps: "repeticiones", tiempo: "tiempo", peso: "peso" };

  const STATUS_DONE_VALUES = new Set(["done", "hecho", "completado", "completed"]);
  const STATUS_NOT_DONE_VALUES = new Set([
    "not_done",
    "not done",
    "no hecho",
    "no-hecho",
    "no realizado",
    "omitido",
    "omitida",
    "saltado",
    "saltada",
    "fallado",
    "fallida",
    "skipped",
    "skip",
  ]);
  const STATUS_PENDING_VALUES = new Set(["pending", "pendiente", "planificado", "planificada", "sin hacer"]);

  const ALIAS_MAP = new Map([
    ["dominada", "dominadas"],
    ["dominadas", "dominadas"],
    ["pull up", "dominadas"],
    ["pull-up", "dominadas"],
    ["push up", "flexiones"],
    ["push-up", "flexiones"],
    ["pushups", "flexiones"],
    ["push ups", "flexiones"],
    ["fondos", "fondos"],
    ["muscle up", "muscle up"],
  ]);

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

  function minutesToSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric * 60);
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

  function normalizeName(name) {
    if (!name || typeof name !== "string") return "";
    let clean = name.trim().toLowerCase().replace(/\s+/g, " ");
    if (!clean) return "";
    if (ALIAS_MAP.has(clean)) {
      clean = ALIAS_MAP.get(clean);
    }
    return clean;
  }

  function cloneEntry(entry) {
    return { ...entry };
  }

  function makeKey(fechaISO, ejercicio, tipo) {
    return `${fechaISO}__${ejercicio}__${tipo}`;
  }

  function ensureNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function sumNumbers(values) {
    if (!Array.isArray(values)) return 0;
    return values.reduce((acc, item) => {
      const num = Number(item);
      return Number.isFinite(num) ? acc + num : acc;
    }, 0);
  }

  function normalizeDay(day) {
    if (!day || typeof day !== "object") return null;
    const fechaISO = toISODate(day.fechaISO || day.date || day.id);
    const sourceDayId = day.sourceDayId ? String(day.sourceDayId) : fechaISO;
    const ejercicios = Array.isArray(day.ejercicios)
      ? day.ejercicios.filter((item) => item && typeof item === "object")
      : [];
    return { fechaISO, sourceDayId, ejercicios };
  }

  function collectNotes(exercise) {
    const notes = [];
    if (exercise.failure) notes.push("al fallo");
    if (exercise.note && typeof exercise.note === "string") {
      const clean = exercise.note.trim();
      if (clean) notes.push(clean);
    }
    return notes;
  }

  function isMarkedDone(exercise) {
    if (!exercise || typeof exercise !== "object") return false;

    const truthy = (value) => {
      if (value === true) return true;
      if (value === 1) return true;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "true" || normalized === "1" || normalized === "sí" || normalized === "si";
      }
      return false;
    };

    if (truthy(exercise.hecho)) return true;
    if (truthy(exercise.completed)) return true;

    const interpretStatus = (value) => {
      if (typeof value !== "string") return null;
      const normalized = value.trim().toLowerCase();
      if (!normalized) return null;
      if (STATUS_DONE_VALUES.has(normalized)) return true;
      if (STATUS_NOT_DONE_VALUES.has(normalized)) return false;
      if (STATUS_PENDING_VALUES.has(normalized)) return false;
      return null;
    };

    const estadoResult = interpretStatus(exercise.estado);
    if (estadoResult != null) return estadoResult;

    const statusResult = interpretStatus(exercise.status);
    if (statusResult != null) return statusResult;

    if (typeof exercise.estado === "string") {
      const normalized = exercise.estado.trim().toLowerCase();
      if (normalized === "hecho" || normalized === "completado" || normalized === "completed") {
        return true;
      }
    }

    return false;
  }

  function extractEntriesFromDay(day) {
    const normalized = normalizeDay(day);
    if (!normalized) return [];
    const map = new Map();
    const fechaISO = normalized.fechaISO;
    const sourceDayId = normalized.sourceDayId;

    normalized.ejercicios.forEach((exerciseRaw) => {
      const name = normalizeName(exerciseRaw.name || exerciseRaw.ejercicio);
      if (!name) return;
      if (!isMarkedDone(exerciseRaw)) return;

      const sets = Math.max(1, Number(exerciseRaw.sets) || 1);
      const doneValues = Array.isArray(exerciseRaw.done) ? exerciseRaw.done : [];
      const numericDone = doneValues.map((val) => {
        if (val == null || val === "") return null;
        const num = Number(val);
        return Number.isFinite(num) ? num : null;
      });
      const hasDone = numericDone.some((val) => Number.isFinite(val));
      const goal = (exerciseRaw.goal || "").toLowerCase();
      const notes = collectNotes(exerciseRaw);
      const weight = ensureNumber(exerciseRaw.weightKg);
      const weightNote = weight && weight > 0 ? `lastre +${weight} kg` : null;

      const pushValue = (tipo, valor, extraNotes = []) => {
        const num = Number(valor);
        if (!Number.isFinite(num) || num <= 0) return;
        const key = makeKey(fechaISO, name, tipo);
        if (!map.has(key)) {
          map.set(key, {
            fechaISO,
            sourceDayId,
            ejercicio: name,
            tipo,
            valor: tipo === "peso" ? null : 0,
            notas: new Set(),
          });
        }
        const entry = map.get(key);
        if (tipo === "peso") {
          entry.valor = entry.valor == null ? num : Math.max(entry.valor, num);
        } else {
          entry.valor = (entry.valor || 0) + num;
        }
        [...notes, ...extraNotes].forEach((note) => {
          if (note && typeof note === "string") {
            entry.notas.add(note);
          }
        });
      };

      if (weight && weight > 0) {
        pushValue("peso", weight, weightNote ? [weightNote] : []);
      }

      if (goal === "reps" || goal === "emom") {
        let totalReps = 0;
        if (hasDone) {
          totalReps = sumNumbers(numericDone);
        } else if (goal === "emom") {
          const minutes = ensureNumber(exerciseRaw.emomMinutes) || 0;
          const repsPerMinute = ensureNumber(exerciseRaw.emomReps) || 0;
          if (minutes > 0 && repsPerMinute > 0) {
            totalReps = minutes * repsPerMinute;
          }
        } else {
          const planned = ensureNumber(exerciseRaw.reps);
          if (planned && planned > 0) {
            totalReps = planned * sets;
          }
        }
        if (totalReps > 0) {
          pushValue("reps", totalReps, weightNote ? [weightNote] : []);
        }
      } else if (goal === "seconds") {
        let totalSeconds = 0;
        if (hasDone) {
          totalSeconds = sumNumbers(numericDone);
        } else {
          const seconds = ensureNumber(exerciseRaw.seconds);
          if (seconds && seconds > 0) {
            totalSeconds = seconds * sets;
          }
        }
        if (totalSeconds > 0) {
          pushValue("tiempo", totalSeconds, weightNote ? [weightNote] : []);
        }
      } else if (goal === "cardio") {
        const minutes = ensureNumber(exerciseRaw.cardioMinutes);
        if (minutes && minutes > 0) {
          const seconds = minutesToSeconds(minutes * sets);
          if (seconds > 0) {
            pushValue("tiempo", seconds, weightNote ? [weightNote] : []);
          }
        }
      }
    });

    return Array.from(map.values())
      .map((item) => ({
        fechaISO: item.fechaISO,
        ejercicio: item.ejercicio,
        tipo: item.tipo,
        valor: item.valor == null ? 0 : Number(item.valor),
        notas: item.notas.size ? Array.from(item.notas).join(" · ") : undefined,
        sourceDayId,
      }))
      .filter((entry) => entry.valor > 0);
  }

  function cloneEntries(list) {
    return list.map(cloneEntry);
  }

  let entries = [];
  let subscribers = [];
  let warnings = [];

  const storage = (() => {
    if (typeof global !== "undefined" && global.localStorage) {
      return global.localStorage;
    }
    let memory = new Map();
    return {
      getItem(key) {
        return memory.has(key) ? memory.get(key) : null;
      },
      setItem(key, value) {
        memory.set(key, String(value));
      },
      removeItem(key) {
        memory.delete(key);
      },
    };
  })();

  function notify() {
    const snapshot = getAllEntries();
    subscribers.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (err) {
        console.warn("entrenoHistory subscriber error", err);
      }
    });
  }

  function save() {
    const payload = { version: 1, entries: cloneEntries(entries) };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("No se pudo guardar el historial", err);
      if (!warnings.includes("No se pudo guardar el historial en el navegador.")) {
        warnings.push("No se pudo guardar el historial en el navegador.");
      }
    }
  }

  function migrateLegacy() {
    let migrated = 0;
    let failed = 0;
    const seen = new Set();
    if (entries.length) return { migrated, failed };
    LEGACY_KEYS.forEach((key) => {
      const raw = storage.getItem(key);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const candidateEntries = Array.isArray(parsed && parsed.entries)
          ? parsed.entries
          : Array.isArray(parsed)
          ? parsed
          : [];
        candidateEntries.forEach((item) => {
          const normalized = normalizeStoredEntry(item);
          if (normalized) {
            if (!seen.has(normalized.id)) {
              seen.add(normalized.id);
              entries.push(normalized);
              migrated += 1;
            } else {
              failed += 1;
            }
          } else {
            failed += 1;
          }
        });
        storage.removeItem(key);
      } catch (err) {
        failed += 1;
      }
    });
    if (migrated) {
      save();
    }
    return { migrated, failed };
  }

  function load() {
    warnings = [];
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) {
        entries = [];
        return getAllEntries();
      }
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed && parsed.entries) ? parsed.entries : [];
      const restored = [];
      const seen = new Set();
      list.forEach((item) => {
        const normalized = normalizeStoredEntry(item);
        if (normalized && !seen.has(normalized.id)) {
          seen.add(normalized.id);
          restored.push(normalized);
        }
      });
      entries = restored;
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
      warnings.push(`Se migraron ${migrated} registros antiguos.`);
    }
    notify();
    return getAllEntries();
  }

  function normalizeStoredEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const ejercicio = normalizeName(raw.ejercicio || raw.name);
    const tipo = raw.tipo;
    const valor = Number(raw.valor);
    if (!ejercicio || !VALID_TYPES.has(tipo) || !Number.isFinite(valor) || valor <= 0) {
      return null;
    }
    const entry = {
      id: typeof raw.id === "string" ? raw.id : uuid(),
      fechaISO: toISODate(raw.fechaISO),
      ejercicio,
      tipo,
      valor,
    };
    if (raw.notas && typeof raw.notas === "string") {
      const clean = raw.notas.trim();
      if (clean) entry.notas = clean;
    }
    if (raw.sourceDayId) {
      entry.sourceDayId = String(raw.sourceDayId);
    }
    return entry;
  }

  function getAllEntries() {
    return entries.map(cloneEntry);
  }

  function listExercises() {
    const map = new Map();
    entries.forEach((entry) => {
      if (!map.has(entry.ejercicio)) {
        map.set(entry.ejercicio, {
          tipos: new Set(),
          countPorTipo: { reps: 0, tiempo: 0, peso: 0 },
          lastDate: entry.fechaISO,
        });
      }
      const item = map.get(entry.ejercicio);
      item.tipos.add(entry.tipo);
      item.countPorTipo[entry.tipo] = (item.countPorTipo[entry.tipo] || 0) + 1;
      if (!item.lastDate || item.lastDate < entry.fechaISO) {
        item.lastDate = entry.fechaISO;
      }
    });
    return map;
  }

  function getEntriesByExerciseAndType(ejercicio, tipo) {
    const name = normalizeName(ejercicio);
    if (!name || !VALID_TYPES.has(tipo)) return [];
    return entries
      .filter((entry) => entry.ejercicio === name && entry.tipo === tipo)
      .slice()
      .sort((a, b) => a.fechaISO.localeCompare(b.fechaISO))
      .map(cloneEntry);
  }

  function compareProgress(entriesList) {
    if (!Array.isArray(entriesList) || !entriesList.length) {
      return { primero: null, ultimo: null, delta: 0, pct: null };
    }
    const sorted = entriesList
      .slice()
      .sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));
    const primero = cloneEntry(sorted[0]);
    const ultimo = cloneEntry(sorted[sorted.length - 1]);
    const delta = Number(ultimo.valor) - Number(primero.valor);
    const pct = primero.valor > 0 ? (delta / primero.valor) * 100 : null;
    return { primero, ultimo, delta, pct };
  }

  function buildDiffData(tipo, previous, current) {
    if (!previous) {
      return {
        tipo,
        previous: null,
        current: Number(current),
        diff: null,
        text: `🔰 Primer registro para este ejercicio (tipo ${TYPE_LABEL[tipo] || tipo}).`,
      };
    }
    const diff = Number(current) - Number(previous);
    if (!Number.isFinite(diff)) {
      return null;
    }
    const absDiff = Math.abs(diff);
    const unit = TYPE_UNITS[tipo] || "";
    const formatted = Number.isInteger(absDiff) ? absDiff : Number(absDiff.toFixed(2));
    if (diff > 0) {
      return {
        tipo,
        previous: Number(previous),
        current: Number(current),
        diff,
        text: `🔼 +${formatted} ${unit} respecto al último`,
      };
    }
    if (diff < 0) {
      return {
        tipo,
        previous: Number(previous),
        current: Number(current),
        diff,
        text: `🔽 ${formatted} ${unit} menos respecto al último`,
      };
    }
    return {
      tipo,
      previous: Number(previous),
      current: Number(current),
      diff,
      text: "➖ Sin cambios respecto al último",
    };
  }

  function addOrUpdateFromDay(day) {
    const normalizedDay = normalizeDay(day);
    if (!normalizedDay) {
      return { entries: [], removed: [], messages: [] };
    }
    const dayEntries = extractEntriesFromDay(normalizedDay);
    const existingByKey = new Map();
    entries.forEach((entry) => {
      if (entry.fechaISO === normalizedDay.fechaISO) {
        existingByKey.set(makeKey(entry.fechaISO, entry.ejercicio, entry.tipo), entry);
      }
    });

    const entriesBefore = entries.map(cloneEntry);
    const applied = [];
    const messages = [];
    const processedKeys = new Set();

    dayEntries.forEach((newEntry) => {
      const key = makeKey(newEntry.fechaISO, newEntry.ejercicio, newEntry.tipo);
      processedKeys.add(key);

      const previousComparable = entriesBefore
        .filter(
          (item) =>
            item.ejercicio === newEntry.ejercicio &&
            item.tipo === newEntry.tipo &&
            item.fechaISO < newEntry.fechaISO
        )
        .sort((a, b) => a.fechaISO.localeCompare(b.fechaISO))
        .pop();

      const message = buildDiffData(newEntry.tipo, previousComparable && previousComparable.valor, newEntry.valor);

      if (existingByKey.has(key)) {
        const stored = existingByKey.get(key);
        stored.valor = newEntry.valor;
        if (newEntry.notas) {
          stored.notas = newEntry.notas;
        } else {
          delete stored.notas;
        }
        stored.sourceDayId = newEntry.sourceDayId;
        applied.push(cloneEntry(stored));
      } else {
        const entryToAdd = { ...newEntry, id: uuid() };
        entries.push(entryToAdd);
        applied.push(cloneEntry(entryToAdd));
      }

      if (message) {
        messages.push({ ...message, ejercicio: newEntry.ejercicio });
      }
    });

    const removed = [];
    entries = entries.filter((entry) => {
      if (entry.fechaISO !== normalizedDay.fechaISO) return true;
      const key = makeKey(entry.fechaISO, entry.ejercicio, entry.tipo);
      if (processedKeys.has(key)) return true;
      removed.push(cloneEntry(entry));
      return false;
    });

    save();
    notify();

    return { entries: applied, removed, messages };
  }

  function rebuildFromCalendar(calendarDays) {
    const days = [];
    if (Array.isArray(calendarDays)) {
      calendarDays.forEach((day) => {
        const normalized = normalizeDay(day);
        if (normalized) days.push(normalized);
      });
    } else if (calendarDays && typeof calendarDays === "object") {
      Object.entries(calendarDays).forEach(([fechaISO, ejercicios]) => {
        const day = normalizeDay({ fechaISO, ejercicios, sourceDayId: fechaISO });
        if (day) days.push(day);
      });
    }

    const nextEntries = [];
    days.forEach((day) => {
      const dayEntries = extractEntriesFromDay(day);
      dayEntries.forEach((entry) => {
        nextEntries.push({ ...entry, id: uuid() });
      });
    });

    entries = nextEntries;
    save();
    notify();

    return { days: days.length, entries: entries.length };
  }

  function addEntry(entry) {
    const normalized = normalizeStoredEntry(entry);
    if (!normalized) {
      throw new Error("Entrada de historial inválida");
    }
    entries.push(normalized);
    save();
    notify();
    return cloneEntry(normalized);
  }

  function updateEntry(id, patch) {
    if (!id) return null;
    let updated = null;
    entries = entries.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item };
      if (patch.fechaISO) next.fechaISO = toISODate(patch.fechaISO);
      if (patch.tipo && VALID_TYPES.has(patch.tipo)) next.tipo = patch.tipo;
      if (patch.valor != null && Number.isFinite(Number(patch.valor))) {
        const val = Number(patch.valor);
        if (val > 0) {
          next.valor = val;
        }
      }
      if (typeof patch.notas === "string") {
        const clean = patch.notas.trim();
        if (clean) {
          next.notas = clean;
        } else {
          delete next.notas;
        }
      }
      if (patch.ejercicio) {
        const normalizedName = normalizeName(patch.ejercicio);
        if (normalizedName) {
          next.ejercicio = normalizedName;
        }
      }
      updated = next;
      return next;
    });
    if (updated) {
      save();
      notify();
      return cloneEntry(updated);
    }
    return null;
  }

  function deleteEntry(id) {
    if (!id) return false;
    const before = entries.length;
    entries = entries.filter((entry) => entry.id !== id);
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

  function exportJSON() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: cloneEntries(entries),
    };
    return JSON.stringify(payload, null, 2);
  }

  function importJSON(text) {
    if (typeof text !== "string") {
      throw new Error("El contenido de importación debe ser texto JSON");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error("El archivo no contiene JSON válido");
    }
    const list = Array.isArray(parsed && parsed.entries) ? parsed.entries : [];
    if (!list.length) {
      throw new Error("No se encontraron entradas válidas para importar");
    }
    const imported = [];
    list.forEach((item) => {
      const normalized = normalizeStoredEntry(item);
      if (normalized) {
        imported.push(normalized);
      }
    });
    if (!imported.length) {
      throw new Error("No se encontraron entradas válidas para importar");
    }
    const dedupById = new Map();
    imported.forEach((item) => {
      dedupById.set(item.id, item);
    });
    const byKey = new Map();
    Array.from(dedupById.values()).forEach((item) => {
      const key = makeKey(item.fechaISO, item.ejercicio, item.tipo);
      byKey.set(key, item);
    });
    entries = Array.from(byKey.values());
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
    compareProgress,
    rebuildFromCalendar,
    addOrUpdateFromDay,
    exportJSON,
    importJSON,
    subscribe,
    getWarnings,
    minutesToSeconds,
    normalizeName,
    getAllEntries,
  };
});
