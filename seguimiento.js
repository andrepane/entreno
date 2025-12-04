(function (global) {
  "use strict";

  const historyStore = global.entrenoHistory;
  const libraryStore = global.entrenoLibrary;

  if (!historyStore) {
    console.warn("Seguimiento UI: history store no disponible");
    return;
  }

  const elements = {};
  let selectedExercise = null;

  const NORMALIZE =
    historyStore && typeof historyStore.normalizeName === "function"
      ? historyStore.normalizeName
      : (text) => (typeof text === "string" ? text.trim().toLowerCase() : "");

  function $(id) {
    return document.getElementById(id);
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
  }

  function uniqueWeights(series) {
    const set = new Set();
    series.forEach((setItem) => {
      if (setItem && setItem.peso != null) {
        set.add(setItem.peso);
      }
    });
    return Array.from(set);
  }

  function formatSeries(series) {
    return series.map((set) => (set.reps != null ? Number(set.reps) : "?" )).join("-");
  }

  function formatWeight(series) {
    const weights = uniqueWeights(series).filter((num) => Number.isFinite(num));
    if (!weights.length) return "";
    const label = weights.length === 1 ? `${weights[0]}` : weights.join("/");
    return ` @ ${label} kg`;
  }

  function sanitizeSeries(series, fallbackWeight) {
    if (!Array.isArray(series)) return [];
    return series
      .map((set) => {
        const reps = Number(set && set.reps);
        if (!Number.isFinite(reps) || reps <= 0) return null;
        const peso = Number(set && set.peso);
        return { reps, peso: Number.isFinite(peso) ? peso : fallbackWeight };
      })
      .filter(Boolean);
  }

  function buildSessionFromEntries(repsEntry, pesoEntry) {
    if (!repsEntry) return null;
    const fallbackWeight = Number.isFinite(pesoEntry && pesoEntry.valor) ? Number(pesoEntry.valor) : undefined;
    const baseSeries = repsEntry.series && repsEntry.series.length ? sanitizeSeries(repsEntry.series, fallbackWeight) : [];
    let series = baseSeries;
    if (!series.length && Number.isFinite(repsEntry.valor)) {
      series = sanitizeSeries([{ reps: repsEntry.valor, peso: fallbackWeight }]);
    }
    if (!series.length) return null;
    return { fechaISO: repsEntry.fechaISO, series, sourceDayId: repsEntry.sourceDayId };
  }

  function groupSessions(entries) {
    const byExercise = new Map();
    entries
      .filter((entry) => entry && entry.tipo === "reps")
      .forEach((entry) => {
        const key = entry.ejercicio;
        if (!byExercise.has(key)) byExercise.set(key, []);
        byExercise.get(key).push(entry);
      });

    const pesoByExerciseDate = new Map();
    entries
      .filter((entry) => entry && entry.tipo === "peso")
      .forEach((entry) => {
        const key = `${entry.ejercicio}__${entry.fechaISO}`;
        pesoByExerciseDate.set(key, entry);
      });

    const sessionsByExercise = new Map();
    byExercise.forEach((list, exercise) => {
      const sessions = [];
      const byDate = new Map();
      list.forEach((entry) => {
        if (!byDate.has(entry.fechaISO)) byDate.set(entry.fechaISO, entry);
      });

      byDate.forEach((repsEntry, dateKey) => {
        const pesoEntry = pesoByExerciseDate.get(`${exercise}__${dateKey}`) || null;
        const session = buildSessionFromEntries(repsEntry, pesoEntry);
        if (session) {
          sessions.push(session);
        }
      });

      sessions.sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));
      sessionsByExercise.set(exercise, sessions);
    });

    return sessionsByExercise;
  }

  function formatSessionLabel(session) {
    const pattern = formatSeries(session.series);
    const weightLabel = formatWeight(session.series);
    return `${pattern}${weightLabel}`;
  }

  function computeBestSet(session) {
    let best = null;
    session.series.forEach((set) => {
      const reps = Number(set.reps) || 0;
      const weight = Number(set.peso) || 0;
      const score = weight > 0 ? reps * weight : reps;
      if (!best || score > best.score) {
        best = { score, reps, weight };
      }
    });
    return best;
  }

  function computeBestMark(sessions) {
    let best = null;
    sessions.forEach((session) => {
      const candidate = computeBestSet(session);
      if (!candidate) return;
      if (!best || candidate.score > best.score) {
        best = { ...candidate, date: session.fechaISO };
      }
    });
    if (!best) return "";
    const weightPart = best.weight ? ` @ ${best.weight} kg` : "";
    return `${best.reps} reps${weightPart}`;
  }

  function formatExerciseName(name) {
    if (!name) return "";
    return name
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function getLibraryExercises() {
    if (!libraryStore || typeof libraryStore.getLibrary !== "function") return [];
    return libraryStore.getLibrary();
  }

  function buildExercises() {
    const entries = historyStore.getAllEntries();
    const sessionsByExercise = groupSessions(entries);
    const library = getLibraryExercises();
    const catalog = library
      .map((item) => ({ name: item.name, normalized: NORMALIZE(item.name) }))
      .filter((item) => item.normalized);

    const exercises = catalog
      .map((item) => {
        const sessions = sessionsByExercise.get(item.normalized) || [];
        if (!sessions.length) return null;
        const last = sessions[sessions.length - 1];
        const bestMark = computeBestMark(sessions);
        return {
          name: item.name,
          normalized: item.normalized,
          sessions,
          lastLabel: formatSessionLabel(last),
          bestMark,
          lastDate: last.fechaISO,
        };
      })
      .filter(Boolean);

    exercises.sort((a, b) => {
      if (a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return exercises;
  }

  function renderList(exercises) {
    if (!elements.exerciseList) return;
    elements.exerciseList.innerHTML = "";
    if (!exercises.length) {
      elements.empty.classList.remove("hidden");
      elements.detail.classList.add("hidden");
      return;
    }
    elements.empty.classList.add("hidden");

    exercises.forEach((item) => {
      const li = document.createElement("li");
      li.className = "strength-item";

      const button = document.createElement("button");
      button.className = "strength-item-btn";
      button.type = "button";
      button.addEventListener("click", () => selectExercise(item.normalized));

      const title = document.createElement("div");
      title.className = "strength-item-title";
      title.textContent = formatExerciseName(item.name);
      button.append(title);

      const meta = document.createElement("div");
      meta.className = "strength-item-meta";
      meta.innerHTML = `<strong>Último:</strong> ${item.lastLabel}`;
      button.append(meta);

      const best = document.createElement("div");
      best.className = "strength-item-best";
      best.innerHTML = `<span class="chip">Mejor: ${item.bestMark || "—"}</span>`;
      button.append(best);

      if (selectedExercise === item.normalized) {
        button.classList.add("active");
      }

      li.append(button);
      elements.exerciseList.append(li);
    });
  }

  function renderSessions(exercise) {
    if (!elements.sessions || !exercise) return;
    elements.sessions.innerHTML = "";
    exercise.sessions.forEach((session) => {
      const row = document.createElement("div");
      row.className = "session-row";
      const date = document.createElement("span");
      date.className = "session-date";
      date.textContent = `${formatDate(session.fechaISO)} ·`;
      const label = document.createElement("span");
      label.className = "session-label";
      label.textContent = formatSessionLabel(session);
      row.append(date, label);
      elements.sessions.append(row);
    });
  }

  function renderDetail(exercises) {
    if (!elements.detail || !elements.detailTitle || !elements.best) return;
    const exercise = exercises.find((item) => item.normalized === selectedExercise) || null;
    if (!exercise) {
      elements.detail.classList.add("hidden");
      return;
    }
    elements.detail.classList.remove("hidden");
    elements.detailTitle.textContent = formatExerciseName(exercise.name);
    elements.best.textContent = `Mejor: ${exercise.bestMark || "—"}`;
    renderSessions(exercise);
  }

  function selectExercise(normalized) {
    selectedExercise = normalized;
    refresh();
  }

  function refresh() {
    const exercises = buildExercises();
    renderList(exercises);
    renderDetail(exercises);
  }

  function showToast(message) {
    if (!elements.toast || !message) return;
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    setTimeout(() => elements.toast.classList.remove("visible"), 2000);
  }

  function init() {
    elements.exerciseList = $("strengthExerciseList");
    elements.empty = $("strengthEmpty");
    elements.detail = $("strengthDetail");
    elements.detailTitle = $("strengthExerciseName");
    elements.best = $("strengthBestLabel");
    elements.sessions = $("strengthSessions");
    elements.toast = $("historyToast");
    elements.back = $("strengthBackBtn");

    if (!elements.exerciseList || !elements.empty) return;

    if (elements.back) {
      elements.back.addEventListener("click", () => {
        selectedExercise = null;
        elements.detail.classList.add("hidden");
      });
    }

    if (typeof historyStore.subscribe === "function") {
      historyStore.subscribe(() => refresh());
    }

    refresh();
  }

  init();

  const api = { refresh, showToast };
  if (typeof global !== "undefined") {
    global.seguimientoUI = api;
  }
  return api;
})(typeof globalThis !== "undefined" ? globalThis : this);
