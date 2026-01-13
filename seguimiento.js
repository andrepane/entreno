(function (global) {
  "use strict";

  const STORAGE_KEY = "entreno.tracking.v2";
  const LEGACY_HISTORY_KEY = "entreno.history.v1";
  const LEGACY_KEYS = ["entreno.history", "historyEntries", "analyticsHistory"];
  const LOAD_TOLERANCE = 0.5;
  const REPS_TOLERANCE = 1;
  const ATTENTION_WINDOW = 3;
  const RANGE_OPTIONS = {
    "30": 30,
    "90": 90,
    all: null,
  };

  const elements = {};
  let trackingState = null;
  let selectedExerciseId = null;
  let selectedRange = "90";
  let topOnly = true;
  let toastTimer = null;

  const storage = (() => {
    if (typeof global !== "undefined" && global.localStorage) {
      return global.localStorage;
    }
    const memory = new Map();
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

  function $(id) {
    return document.getElementById(id);
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function toISODate(value) {
    if (!value) return todayISO();
    const [y, m = 1, d = 1] = String(value).split("-").map(Number);
    if (!Number.isFinite(y)) return todayISO();
    const date = new Date(y, (m || 1) - 1, d || 1);
    if (Number.isNaN(date.getTime())) return todayISO();
    date.setHours(0, 0, 0, 0);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function normalizeName(value) {
    if (!value) return "";
    return String(value).trim().replace(/\s+/g, " ");
  }

  function normalizeKey(value) {
    return normalizeName(value).toLowerCase();
  }

  function getLibraryStore() {
    return global.entrenoLibrary || null;
  }

  function getLibraryExercises() {
    const store = getLibraryStore();
    if (!store || typeof store.getLibrary !== "function") return [];
    return store.getLibrary() || [];
  }

  function findLibraryExerciseByName(name) {
    const target = normalizeKey(name);
    if (!target) return null;
    return getLibraryExercises().find((item) => normalizeKey(item.name) === target) || null;
  }

  function resolveExerciseId(name) {
    const match = findLibraryExerciseByName(name);
    if (match && match.id) return match.id;
    return normalizeKey(name).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  function formatExerciseName(name) {
    if (!name) return "";
    return name
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function parseLoadFromNotes(notes) {
    if (!notes) return 0;
    const match = String(notes).match(/lastre\s*\+?\s*([0-9]+(?:[.,][0-9]+)?)/i);
    if (!match) return 0;
    const value = Number(match[1].replace(",", "."));
    return Number.isFinite(value) ? value : 0;
  }

  function ensureNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function getWeekStart(date) {
    const copy = new Date(date.getTime());
    const day = (copy.getDay() + 6) % 7;
    copy.setDate(copy.getDate() - day);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function compareSets(prev, next) {
    const loadDelta = next.loadKg - prev.loadKg;
    const repsDelta = next.reps - prev.reps;
    const sameLoad = Math.abs(loadDelta) <= LOAD_TOLERANCE;
    const sameReps = Math.abs(repsDelta) <= REPS_TOLERANCE;

    if ((loadDelta > LOAD_TOLERANCE && repsDelta >= -REPS_TOLERANCE) || (repsDelta > REPS_TOLERANCE && loadDelta >= -LOAD_TOLERANCE)) {
      return 1;
    }
    if ((loadDelta < -LOAD_TOLERANCE && repsDelta <= REPS_TOLERANCE) || (repsDelta < -REPS_TOLERANCE && loadDelta <= LOAD_TOLERANCE)) {
      return -1;
    }
    if (sameLoad && sameReps) return 0;
    return 0;
  }

  function formatSet(set) {
    if (!set) return "—";
    const reps = Number.isFinite(set.reps) ? Math.round(set.reps) : 0;
    const load = Number.isFinite(set.loadKg) ? set.loadKg : 0;
    return `${reps} @ +${load.toFixed(1)}kg`;
  }

  function formatDelta(value, unit) {
    if (!Number.isFinite(value) || value === 0) return "=";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value}${unit}`;
  }

  function saveState() {
    if (!trackingState) return;
    storage.setItem(STORAGE_KEY, JSON.stringify(trackingState));
  }

  function defaultState() {
    return {
      version: 2,
      sessions: [],
      config: {
        attentionWindow: ATTENTION_WINDOW,
      },
      migrated: false,
    };
  }

  function migrateFromLegacy() {
    let entries = [];
    const historyStore = global.entrenoHistory;
    if (historyStore && typeof historyStore.getAllEntries === "function") {
      entries = historyStore.getAllEntries();
    } else {
      const raw = storage.getItem(LEGACY_HISTORY_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          entries = Array.isArray(parsed && parsed.entries) ? parsed.entries : [];
        } catch (err) {
          entries = [];
        }
      }
      if (!entries.length) {
        LEGACY_KEYS.some((key) => {
          const legacyRaw = storage.getItem(key);
          if (!legacyRaw) return false;
          try {
            const parsed = JSON.parse(legacyRaw);
            if (Array.isArray(parsed)) {
              entries = parsed;
              return true;
            }
          } catch (err) {
            return false;
          }
          return false;
        });
      }
    }

    if (!entries.length) return null;

    const sessionsMap = new Map();

    entries
      .filter((entry) => entry && entry.tipo === "reps" && Number(entry.valor) > 0)
      .forEach((entry) => {
        const dateISO = toISODate(entry.fechaISO || entry.dateISO || entry.date);
        const exerciseName = normalizeName(entry.ejercicio || entry.exercise || entry.name);
        if (!exerciseName) return;
        const exerciseId = resolveExerciseId(exerciseName);
        const loadKg = parseLoadFromNotes(entry.notas || entry.notes);
        const reps = Math.round(Number(entry.valor));
        const sessionKey = dateISO;
        if (!sessionsMap.has(sessionKey)) {
          sessionsMap.set(sessionKey, {
            id: `${dateISO}-${Math.random().toString(16).slice(2, 8)}`,
            dateISO,
            exercises: [],
          });
        }
        const session = sessionsMap.get(sessionKey);
        const existing = session.exercises.find((item) => item.exerciseId === exerciseId);
        if (existing) {
          if (reps > existing.topSet.reps) {
            existing.topSet = { reps, loadKg };
          }
          return;
        }
        session.exercises.push({
          exerciseId,
          exerciseName,
          topSet: { reps, loadKg },
        });
      });

    if (!sessionsMap.size) return null;

    return {
      version: 2,
      sessions: Array.from(sessionsMap.values()).sort((a, b) => a.dateISO.localeCompare(b.dateISO)),
      config: {
        attentionWindow: ATTENTION_WINDOW,
      },
      migrated: true,
    };
  }

  function loadState() {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.sessions)) {
          return parsed;
        }
      } catch (err) {
        return defaultState();
      }
    }

    const migrated = migrateFromLegacy();
    if (migrated) {
      storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    return defaultState();
  }

  function getAllExercises() {
    const map = new Map();
    trackingState.sessions.forEach((session) => {
      session.exercises.forEach((exercise) => {
        if (!map.has(exercise.exerciseId)) {
          map.set(exercise.exerciseId, {
            id: exercise.exerciseId,
            name: exercise.exerciseName || exercise.exerciseId,
            entries: [],
          });
        }
        map.get(exercise.exerciseId).entries.push({
          dateISO: session.dateISO,
          topSet: exercise.topSet,
          backoff: exercise.backoff,
        });
      });
    });
    return Array.from(map.values()).map((exercise) => {
      exercise.entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      return exercise;
    });
  }

  function getExerciseNameById(id) {
    const exercise = getAllExercises().find((item) => item.id === id);
    if (exercise) return exercise.name;
    const library = getLibraryExercises().find((item) => item.id === id);
    return library ? library.name : id;
  }

  function getFilteredEntries(entries) {
    const days = RANGE_OPTIONS[selectedRange] || null;
    if (!days) return entries.slice();
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - days);
    return entries.filter((item) => {
      const date = new Date(item.dateISO);
      return date >= start && date <= end;
    });
  }

  function getEntriesInDays(entries, days) {
    if (!days) return entries.slice();
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - days);
    return entries.filter((item) => {
      const date = new Date(item.dateISO);
      return date >= start && date <= end;
    });
  }

  function estimateVolume(entry) {
    if (!entry) return 0;
    const top = entry.topSet ? entry.topSet.reps * Math.max(1, entry.topSet.loadKg) : 0;
    const backoff = entry.backoff
      ? entry.backoff.sets * entry.backoff.reps * Math.max(1, entry.backoff.loadKg)
      : 0;
    return top + backoff;
  }

  function getExerciseStatus(entries) {
    if (!entries.length) return "→";
    const recent = entries.slice(-3);
    const comparisons = [];
    for (let i = 1; i < recent.length; i += 1) {
      comparisons.push(compareSets(recent[i - 1].topSet, recent[i].topSet));
    }
    if (comparisons.length >= 2 && comparisons.slice(-2).every((value) => value > 0)) return "↑";
    if (comparisons.length >= 2 && comparisons.slice(-2).every((value) => value < 0)) return "↓";
    return "→";
  }

  function buildSparkline(entries) {
    if (!entries.length) return "";
    const points = entries.slice(-8).map((entry) => entry.topSet.loadKg * 10 + entry.topSet.reps);
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const width = 120;
    const height = 32;
    const step = points.length > 1 ? width / (points.length - 1) : 0;
    const path = points
      .map((value, index) => {
        const x = index * step;
        const y = height - ((value - min) / range) * (height - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return `<svg viewBox="0 0 ${width} ${height}" class="tracking-spark" role="img" aria-label="Tendencia"><polyline points="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
  }

  function buildSummary() {
    const exercises = getAllExercises();
    let prReps = null;
    let prLoad = null;
    let bestMonth = null;

    exercises.forEach((exercise) => {
      const entries = exercise.entries;
      const previous = [];
      entries.forEach((entry) => {
        const comparableReps = previous.filter(
          (prev) => Math.abs(prev.topSet.loadKg - entry.topSet.loadKg) <= LOAD_TOLERANCE
        );
        if (comparableReps.length) {
          const bestReps = Math.max(...comparableReps.map((item) => item.topSet.reps));
          const delta = entry.topSet.reps - bestReps;
          if (delta > 0 && (!prReps || delta > prReps.delta)) {
            prReps = {
              exercise: exercise.name,
              delta,
            };
          }
        }

        const comparableLoad = previous.filter(
          (prev) => Math.abs(prev.topSet.reps - entry.topSet.reps) <= REPS_TOLERANCE
        );
        if (comparableLoad.length) {
          const bestLoad = Math.max(...comparableLoad.map((item) => item.topSet.loadKg));
          const delta = entry.topSet.loadKg - bestLoad;
          if (delta > 0 && (!prLoad || delta > prLoad.delta)) {
            prLoad = {
              exercise: exercise.name,
              delta,
            };
          }
        }

        previous.push(entry);
      });

      const monthEntries = getEntriesInDays(exercise.entries, 30);
      monthEntries.forEach((entry) => {
        const score = entry.topSet.loadKg * 10 + entry.topSet.reps;
        if (!bestMonth || score > bestMonth.score) {
          bestMonth = {
            score,
            exercise: exercise.name,
            set: entry.topSet,
          };
        }
      });
    });

    const volume = buildWeeklyVolume();
    const consistency = buildConsistency();

    elements.summaryGrid.innerHTML = [
      buildSummaryCard("PR reps", prReps ? `${prReps.exercise}` : "—", prReps ? `+${prReps.delta} reps` : "Sin PR"),
      buildSummaryCard("PR lastre", prLoad ? `${prLoad.exercise}` : "—", prLoad ? `+${prLoad.delta.toFixed(1)} kg` : "Sin PR"),
      buildSummaryCard("Mejor set 30d", bestMonth ? `${bestMonth.exercise}` : "—", bestMonth ? formatSet(bestMonth.set) : "Sin datos"),
      buildSummaryCard("Volumen semanal", volume.label, volume.delta),
      buildSummaryCard("Consistencia", consistency.label, consistency.detail),
    ].join("");
  }

  function buildSummaryCard(title, value, hint) {
    return `
      <article class="tracking-card">
        <header>${title}</header>
        <strong>${value}</strong>
        <small class="muted">${hint}</small>
      </article>
    `;
  }

  function buildWeeklyVolume() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const weekStart = getWeekStart(now);
    const prevWeekStart = new Date(weekStart.getTime());
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    let current = 0;
    let previous = 0;

    trackingState.sessions.forEach((session) => {
      const date = new Date(session.dateISO);
      session.exercises.forEach((exercise) => {
        const entry = { topSet: exercise.topSet, backoff: exercise.backoff };
        if (date >= weekStart && date <= now) {
          current += estimateVolume(entry);
        } else if (date >= prevWeekStart && date < weekStart) {
          previous += estimateVolume(entry);
        }
      });
    });

    const diff = current - previous;
    const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
    return {
      label: `${Math.round(current)}`,
      delta: `${arrow} ${Math.round(diff)}`,
    };
  }

  function buildConsistency() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const currentWeekStart = getWeekStart(now);
    const weeks = new Set();
    const streakWeeks = new Set();

    trackingState.sessions.forEach((session) => {
      const date = new Date(session.dateISO);
      const weekStart = getWeekStart(date);
      const weekKey = weekStart.toISOString().slice(0, 10);
      weeks.add(weekKey);
    });

    const pastWeeks = Array.from(weeks).sort();
    const last4 = pastWeeks.slice(-4);

    let streak = 0;
    const cursor = new Date(currentWeekStart.getTime());
    while (true) {
      const key = cursor.toISOString().slice(0, 10);
      if (weeks.has(key)) {
        streak += 1;
        streakWeeks.add(key);
      } else {
        break;
      }
      cursor.setDate(cursor.getDate() - 7);
    }

    return {
      label: `${last4.length}/4 semanas`,
      detail: streak ? `racha ${streak}` : "sin racha",
    };
  }

  function buildAttention() {
    const exercises = getAllExercises();
    const items = [];

    exercises.forEach((exercise) => {
      const entries = exercise.entries;
      if (entries.length < 2) return;
      const recent = entries.slice(-ATTENTION_WINDOW);
      const status = getExerciseStatus(entries);
      const comparisons = [];
      for (let i = 1; i < recent.length; i += 1) {
        comparisons.push(compareSets(recent[i - 1].topSet, recent[i].topSet));
      }
      const improved = comparisons.filter((value) => value > 0).length;
      const worsened = comparisons.filter((value) => value < 0).length;

      let label = "Estable";
      if (worsened >= 2 && status === "↓") label = "Bajando";
      else if (improved >= 2 && status === "↑") label = "Subiendo";
      else if (improved === 0 && entries.length >= ATTENTION_WINDOW) label = "Estancado";

      items.push({
        id: exercise.id,
        name: exercise.name,
        status,
        label,
        last: entries[entries.length - 1],
      });
    });

    const priority = {
      Bajando: 0,
      Estancado: 1,
      Subiendo: 2,
      Estable: 3,
    };

    const selected = items
      .sort((a, b) => priority[a.label] - priority[b.label])
      .slice(0, 5)
      .map((item) => {
        return `
          <li>
            <span class="tracking-status">${item.status}</span>
            <div>
              <strong>${item.name}</strong>
              <small class="muted">${item.label} · ${formatSet(item.last.topSet)}</small>
            </div>
          </li>
        `;
      })
      .join("");

    elements.attentionList.innerHTML = selected || "<li class=\"muted\">Sin alertas por ahora.</li>";
  }

  function renderExerciseTable() {
    const exercises = getAllExercises();
    elements.exerciseTableBody.innerHTML = exercises
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((exercise) => {
        const last = exercise.entries[exercise.entries.length - 1];
        const best = exercise.entries.reduce((acc, entry) => {
          const score = entry.topSet.loadKg * 10 + entry.topSet.reps;
          if (!acc || score > acc.score) {
            return { score, entry };
          }
          return acc;
        }, null);
        const status = getExerciseStatus(exercise.entries);
        const sparkline = buildSparkline(exercise.entries);
        return `
          <tr data-exercise-id="${exercise.id}">
            <td>
              <button class="tracking-link" type="button">${exercise.name}</button>
            </td>
            <td>${formatSet(last.topSet)}</td>
            <td>${best ? formatSet(best.entry.topSet) : "—"}</td>
            <td>${sparkline}</td>
            <td><span class="tracking-status">${status}</span></td>
          </tr>
        `;
      })
      .join("");

    Array.from(elements.exerciseTableBody.querySelectorAll("tr")).forEach((row) => {
      row.addEventListener("click", () => {
        const exerciseId = row.getAttribute("data-exercise-id");
        if (!exerciseId) return;
        selectedExerciseId = exerciseId;
        renderDetail();
      });
    });
  }

  function renderDetail() {
    const exercises = getAllExercises();
    const exercise = exercises.find((item) => item.id === selectedExerciseId) || exercises[0];
    if (!exercise) {
      elements.detailPanel.classList.add("hidden");
      elements.detailEmpty.classList.remove("hidden");
      return;
    }
    selectedExerciseId = exercise.id;
    elements.detailPanel.classList.remove("hidden");
    elements.detailEmpty.classList.add("hidden");

    elements.detailTitle.textContent = exercise.name;

    const entries = getFilteredEntries(exercise.entries);
    const last = entries[entries.length - 1];
    const previous = entries.length > 1 ? entries[entries.length - 2] : null;
    const delta = previous ? compareSets(previous.topSet, last.topSet) : 0;
    const deltaChip = previous
      ? `${formatDelta(last.topSet.reps - previous.topSet.reps, "r")} / ${formatDelta(
          Number((last.topSet.loadKg - previous.topSet.loadKg).toFixed(1)),
          "kg"
        )}`
      : "—";

    const best = exercise.entries.reduce((acc, entry) => {
      const score = entry.topSet.loadKg * 10 + entry.topSet.reps;
      if (!acc || score > acc.score) return { score, entry };
      return acc;
    }, null);

    const monthEntries = exercise.entries.filter((entry) => {
      const date = new Date(entry.dateISO);
      const limit = new Date();
      limit.setDate(limit.getDate() - 30);
      return date >= limit;
    });
    const bestMonth = monthEntries.reduce((acc, entry) => {
      const score = entry.topSet.loadKg * 10 + entry.topSet.reps;
      if (!acc || score > acc.score) return { score, entry };
      return acc;
    }, null);

    elements.detailChips.innerHTML = `
      <span class="tracking-chip">Δ última: ${deltaChip}</span>
      <span class="tracking-chip">Mejor: ${best ? formatSet(best.entry.topSet) : "—"}</span>
      <span class="tracking-chip">Mejor 30d: ${bestMonth ? formatSet(bestMonth.entry.topSet) : "—"}</span>
    `;

    elements.detailDelta.textContent = delta > 0 ? "↑ Mejora" : delta < 0 ? "↓ Bajando" : "→ Estable";

    renderScatterChart(entries, exercise);
    renderVolumeChart(entries);
  }

  function renderScatterChart(entries, exercise) {
    const data = entries.flatMap((entry) => {
      if (topOnly || !entry.backoff) {
        return [{ loadKg: entry.topSet.loadKg, reps: entry.topSet.reps, dateISO: entry.dateISO, type: "top" }];
      }
      return [
        { loadKg: entry.topSet.loadKg, reps: entry.topSet.reps, dateISO: entry.dateISO, type: "top" },
        { loadKg: entry.backoff.loadKg, reps: entry.backoff.reps, dateISO: entry.dateISO, type: "backoff" },
      ];
    });
    const width = 360;
    const height = 220;
    const padding = 32;
    if (!data.length) {
      elements.scatter.innerHTML = "<div class=\"muted\">Sin datos para este rango.</div>";
      return;
    }

    const minLoad = Math.min(...data.map((item) => item.loadKg));
    const maxLoad = Math.max(...data.map((item) => item.loadKg));
    const minReps = Math.min(...data.map((item) => item.reps));
    const maxReps = Math.max(...data.map((item) => item.reps));
    const loadRange = maxLoad - minLoad || 1;
    const repsRange = maxReps - minReps || 1;

    const points = data
      .map((item) => {
        const x = padding + ((item.loadKg - minLoad) / loadRange) * (width - padding * 2);
        const y = height - padding - ((item.reps - minReps) / repsRange) * (height - padding * 2);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="${
          item.type === "top" ? "tracking-point" : "tracking-point backoff"
        }" />`;
      })
      .join("");

    elements.scatter.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="tracking-scatter" aria-label="Reps vs lastre">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="tracking-axis" />
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="tracking-axis" />
        <text x="${width - padding}" y="${height - 8}" class="tracking-axis-label">+kg</text>
        <text x="8" y="${padding - 8}" class="tracking-axis-label">reps</text>
        ${points}
      </svg>
    `;
    elements.scatterTitle.textContent = `${exercise.name} · Reps vs Lastre`;
  }

  function renderVolumeChart(entries) {
    if (!entries.length) {
      elements.volume.innerHTML = "<div class=\"muted\">Sin datos para este rango.</div>";
      return;
    }
    const width = 360;
    const height = 160;
    const padding = 24;
    const volumes = entries.map((entry) => estimateVolume(entry));
    const max = Math.max(...volumes, 1);
    const barWidth = (width - padding * 2) / volumes.length;

    const bars = volumes
      .map((value, index) => {
        const x = padding + index * barWidth;
        const barHeight = ((value / max) * (height - padding * 2)) || 2;
        const y = height - padding - barHeight;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(barWidth - 6, 4).toFixed(
          1
        )}" height="${barHeight.toFixed(1)}" rx="4" class="tracking-bar" />`;
      })
      .join("");

    elements.volume.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="tracking-bars" aria-label="Volumen por sesión">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="tracking-axis" />
        ${bars}
      </svg>
    `;
  }

  function buildExerciseOptions() {
    const library = getLibraryExercises();
    const fromSessions = getAllExercises().map((item) => ({ id: item.id, name: item.name }));
    const combined = [...library.map((item) => ({ id: item.id, name: item.name })), ...fromSessions]
      .filter((item) => item && item.id && item.name)
      .reduce((acc, item) => {
        if (!acc.some((entry) => entry.id === item.id)) acc.push(item);
        return acc;
      }, [])
      .sort((a, b) => a.name.localeCompare(b.name));

    elements.exerciseSelect.innerHTML = `
      <option value="">Elegir ejercicio…</option>
      ${combined.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}
      <option value="custom">+ Nuevo ejercicio</option>
    `;
  }

  function validateForm(payload) {
    if (!payload.exerciseName) return "Selecciona un ejercicio.";
    if (!payload.dateISO) return "Selecciona una fecha.";
    if (!Number.isInteger(payload.topSet.reps) || payload.topSet.reps <= 0) return "Reps inválidas.";
    if (payload.topSet.loadKg < 0) return "Lastre inválido.";
    if (payload.backoff) {
      if (!Number.isInteger(payload.backoff.sets) || payload.backoff.sets <= 0) return "Series inválidas.";
      if (!Number.isInteger(payload.backoff.reps) || payload.backoff.reps <= 0) return "Reps inválidas.";
      if (payload.backoff.loadKg < 0) return "Lastre inválido.";
    }
    return "";
  }

  function handleSave(event) {
    event.preventDefault();
    const exerciseIdRaw = elements.exerciseSelect.value;
    const customName = normalizeName(elements.exerciseCustom.value);
    const exerciseName = exerciseIdRaw === "custom" ? customName : getExerciseNameById(exerciseIdRaw);
    const exerciseId = exerciseIdRaw === "custom" ? resolveExerciseId(customName) : exerciseIdRaw;

    const payload = {
      exerciseId,
      exerciseName,
      dateISO: toISODate(elements.entryDate.value),
      topSet: {
        reps: Math.round(Number(elements.topReps.value)),
        loadKg: Number(elements.topLoad.value),
      },
      backoff: null,
      notes: normalizeName(elements.entryNotes.value),
    };

    const backoffSets = Number(elements.backoffSets.value);
    const backoffReps = Number(elements.backoffReps.value);
    const backoffLoad = Number(elements.backoffLoad.value);
    if (backoffSets > 0 && backoffReps > 0) {
      payload.backoff = {
        sets: Math.round(backoffSets),
        reps: Math.round(backoffReps),
        loadKg: Number(backoffLoad || 0),
      };
    }

    const error = validateForm(payload);
    if (error) {
      showToast(error, true);
      return;
    }

    let session = trackingState.sessions.find((item) => item.dateISO === payload.dateISO);
    if (!session) {
      session = {
        id: `${payload.dateISO}-${Math.random().toString(16).slice(2, 8)}`,
        dateISO: payload.dateISO,
        exercises: [],
      };
      trackingState.sessions.push(session);
    }

    const existing = session.exercises.find((item) => item.exerciseId === payload.exerciseId);
    if (existing) {
      existing.topSet = payload.topSet;
      existing.backoff = payload.backoff;
      existing.notes = payload.notes;
    } else {
      session.exercises.push({
        exerciseId: payload.exerciseId,
        exerciseName: payload.exerciseName,
        topSet: payload.topSet,
        backoff: payload.backoff,
        notes: payload.notes,
      });
    }

    trackingState.sessions.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    saveState();
    showToast(existing ? "Sesión actualizada." : "Sesión guardada.");
    refresh();
  }

  function showToast(message, isWarning = false) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.toggle("warning", isWarning);
    elements.toast.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.classList.remove("visible");
    }, 2400);
  }

  function handleExerciseSelect() {
    const isCustom = elements.exerciseSelect.value === "custom";
    elements.exerciseCustomWrap.classList.toggle("hidden", !isCustom);
    if (isCustom) {
      elements.exerciseCustom.focus();
    }
  }

  function handleRangeChange(event) {
    selectedRange = event.target.value;
    renderDetail();
  }

  function handleTopOnlyToggle(event) {
    topOnly = event.target.checked;
    renderDetail();
  }

  function refresh() {
    buildExerciseOptions();
    buildSummary();
    buildAttention();
    renderExerciseTable();
    renderDetail();
  }

  function init() {
    trackingState = loadState();

    elements.entryForm = $("trackingEntryForm");
    elements.exerciseSelect = $("trackingExercise");
    elements.exerciseCustom = $("trackingExerciseCustom");
    elements.exerciseCustomWrap = $("trackingExerciseCustomWrap");
    elements.entryDate = $("trackingDate");
    elements.topReps = $("trackingTopReps");
    elements.topLoad = $("trackingTopLoad");
    elements.backoffSets = $("trackingBackoffSets");
    elements.backoffReps = $("trackingBackoffReps");
    elements.backoffLoad = $("trackingBackoffLoad");
    elements.entryNotes = $("trackingNotes");
    elements.summaryGrid = $("trackingSummary");
    elements.attentionList = $("trackingAttentionList");
    elements.exerciseTableBody = $("trackingExerciseTableBody");
    elements.detailPanel = $("trackingDetail");
    elements.detailEmpty = $("trackingDetailEmpty");
    elements.detailTitle = $("trackingDetailTitle");
    elements.detailChips = $("trackingDetailChips");
    elements.detailDelta = $("trackingDetailDelta");
    elements.scatter = $("trackingScatter");
    elements.scatterTitle = $("trackingScatterTitle");
    elements.volume = $("trackingVolume");
    elements.rangeSelect = $("trackingRange");
    elements.topOnlyToggle = $("trackingTopOnly");
    elements.toast = $("trackingToast");

    if (!elements.entryForm) return;

    elements.entryDate.value = todayISO();
    elements.topLoad.value = "0";
    elements.backoffLoad.value = "0";

    buildExerciseOptions();

    elements.entryForm.addEventListener("submit", handleSave);
    elements.exerciseSelect.addEventListener("change", handleExerciseSelect);
    elements.rangeSelect.addEventListener("change", handleRangeChange);
    elements.topOnlyToggle.addEventListener("change", handleTopOnlyToggle);

    handleExerciseSelect();
    refresh();
  }

  document.addEventListener("DOMContentLoaded", init);

  global.seguimientoUI = {
    refresh,
    showToast,
    destroy: () => {
      if (toastTimer) clearTimeout(toastTimer);
    },
  };
})(typeof window !== "undefined" ? window : this);
