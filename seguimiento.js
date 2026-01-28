(function (global) {
  "use strict";

  const historyStore = global.entrenoHistory;
  if (!historyStore) {
    console.warn("Seguimiento UI: history store no disponible");
    return;
  }

  const state = {
    selectedExercise: null,
    searchQuery: "",
    sortMode: "last-desc",
  };

  const elements = {};

  let unsubscribe = null;
  let toastTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeExerciseName(name) {
    if (historyStore && typeof historyStore.normalizeName === "function") {
      return historyStore.normalizeName(name || "");
    }
    return typeof name === "string" ? name.trim().toLowerCase() : "";
  }

  function formatExerciseName(name) {
    if (!name) return "";
    return name
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function getCalendarSnapshot() {
    const provider = global.entrenoApp && global.entrenoApp.getCalendarSnapshot;
    if (typeof provider !== "function") return null;
    return provider();
  }

  function getInitials(name) {
    if (!name) return "";
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || name.charAt(0).toUpperCase();
  }

  function getLibraryStore() {
    return global.entrenoLibrary || null;
  }

  function findLibraryExerciseByName(name) {
    const store = getLibraryStore();
    if (!store || typeof store.getLibrary !== "function") return null;
    const target = normalizeExerciseName(name);
    if (!target) return null;
    const list = store.getLibrary();
    return list.find((item) => normalizeExerciseName(item.name) === target) || null;
  }

  function buildHistoryThumbnail(name) {
    const exercise = findLibraryExerciseByName(name);
    const wrapper = document.createElement("span");
    wrapper.className = "miniature history-miniature";
    const label = formatExerciseName(name);
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", label);
    if (exercise) {
      if (exercise.iconType === "image" && exercise.imageDataUrl) {
        const img = document.createElement("img");
        img.src = exercise.imageDataUrl;
        img.alt = label;
        img.loading = "lazy";
        wrapper.append(img);
        return wrapper;
      }
      if (exercise.iconType === "emoji" && exercise.emoji) {
        const span = document.createElement("span");
        span.textContent = exercise.emoji;
        span.setAttribute("aria-hidden", "true");
        wrapper.append(span);
        return wrapper;
      }
    }
    const initials = getInitials(label);
    const span = document.createElement("span");
    span.textContent = initials || "?";
    span.setAttribute("aria-hidden", "true");
    wrapper.append(span);
    return wrapper;
  }

  function init() {
    elements.exerciseList = $("historyExerciseList");
    elements.exerciseEmpty = $("historyExerciseEmpty");
    elements.detailPanel = $("historyDetailPanel");
    elements.detailEmpty = $("historyDetailEmpty");
    elements.detail = $("historyDetail");
    elements.detailTitle = $("historyDetailTitle");
    elements.summaryList = $("historySummaryList");
    elements.summaryNote = $("historySummaryNote");
    elements.rebuildBtn = $("historyRebuildBtn");
    elements.searchInput = $("historySearchInput");
    elements.sortSelect = $("historySortSelect");
    elements.toast = $("historyToast");
    elements.warnings = $("historyWarnings");

    if (!elements.exerciseList || !elements.detail || !elements.summaryList) return;

    if (elements.rebuildBtn) {
      elements.rebuildBtn.addEventListener("click", handleRebuild);
    }
    if (elements.searchInput) {
      elements.searchInput.addEventListener("input", (event) => {
        state.searchQuery = event.target.value;
        renderExercises();
        renderDetail();
      });
    }
    if (elements.sortSelect) {
      elements.sortSelect.addEventListener("change", (event) => {
        state.sortMode = event.target.value;
        renderExercises();
        renderDetail();
      });
    }

    unsubscribe = historyStore.subscribe(() => {
      updateWarnings();
      renderExercises();
      renderDetail();
    });

    updateWarnings();
    renderExercises();
    if (!state.selectedExercise) {
      autoSelectFirst();
    }
    renderDetail();
  }

  function updateWarnings() {
    if (!elements.warnings) return;
    const warnings = historyStore.getWarnings();
    if (!warnings.length) {
      elements.warnings.classList.add("hidden");
      elements.warnings.textContent = "";
      return;
    }
    elements.warnings.classList.remove("hidden");
    elements.warnings.innerHTML = warnings.map((msg) => `<p>${msg}</p>`).join("");
  }

  function getFilteredExercises() {
    const map = historyStore.listExercises();
    const query = state.searchQuery.trim().toLowerCase();
    return Array.from(map.entries())
      .map(([name, info]) => ({ name, info }))
      .filter(({ name }) => {
        if (!query) return true;
        const normalized = normalizeExerciseName(name);
        const formatted = formatExerciseName(name).toLowerCase();
        return normalized.includes(query) || formatted.includes(query);
      });
  }

  function getTotalCount(info) {
    if (!info || !info.countPorTipo) return 0;
    return Object.values(info.countPorTipo).reduce((acc, val) => acc + (val || 0), 0);
  }

  function sortExercises(items) {
    const mode = state.sortMode;
    return items.sort((a, b) => {
      if (mode === "name-asc") {
        return a.name.localeCompare(b.name);
      }
      if (mode === "name-desc") {
        return b.name.localeCompare(a.name);
      }
      if (mode === "last-asc") {
        const dateA = a.info.lastDate || "";
        const dateB = b.info.lastDate || "";
        if (dateA !== dateB) {
          return dateA < dateB ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      }
      if (mode === "count-desc") {
        const countA = getTotalCount(a.info);
        const countB = getTotalCount(b.info);
        if (countA !== countB) {
          return countB - countA;
        }
        return a.name.localeCompare(b.name);
      }
      const dateA = a.info.lastDate || "";
      const dateB = b.info.lastDate || "";
      if (dateA !== dateB) {
        return dateA < dateB ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  function renderExercises() {
    if (!elements.exerciseList) return;
    const items = sortExercises(getFilteredExercises());

    elements.exerciseList.innerHTML = "";
    if (!items.length) {
      if (elements.exerciseEmpty) {
        elements.exerciseEmpty.textContent = state.searchQuery
          ? "No hay ejercicios que coincidan con la búsqueda."
          : "Sin registros todavía. Añade entrenos para comenzar.";
        elements.exerciseEmpty.classList.remove("hidden");
      }
      return;
    }
    if (elements.exerciseEmpty) {
      elements.exerciseEmpty.classList.add("hidden");
    }

    if (!items.some(({ name }) => name === state.selectedExercise)) {
      state.selectedExercise = items[0]?.name || null;
    }

    items.forEach(({ name }) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item-button";
      button.textContent = formatExerciseName(name);
      button.setAttribute("aria-label", `Ver resumen de ${formatExerciseName(name)}`);
      button.setAttribute("role", "option");
      button.addEventListener("click", () => selectExercise(name));

      if (state.selectedExercise === name) {
        button.classList.add("active");
        button.setAttribute("aria-selected", "true");
      } else {
        button.setAttribute("aria-selected", "false");
      }

      li.append(button);
      elements.exerciseList.append(li);
    });
  }

  function autoSelectFirst() {
    const items = getFilteredExercises();
    if (!items.length) {
      state.selectedExercise = null;
      return;
    }
    state.selectedExercise = items[0].name;
  }

  function selectExercise(name) {
    state.selectedExercise = name;
    renderExercises();
    renderDetail();
  }

  function isExerciseDone(exercise) {
    if (!exercise || typeof exercise !== "object") return false;
    if (exercise.hecho === true || exercise.completed === true) return true;
    if (typeof exercise.status === "string") {
      return exercise.status.trim().toLowerCase() === "done";
    }
    if (typeof exercise.estado === "string") {
      const normalized = exercise.estado.trim().toLowerCase();
      return ["done", "hecho", "completado", "completed"].includes(normalized);
    }
    return false;
  }

  function extractReps(exercise) {
    const done = Array.isArray(exercise.done) ? exercise.done : [];
    const reps = done
      .map((val) => Number(val))
      .filter((val) => Number.isFinite(val) && val > 0);
    if (reps.length) return reps;
    const planned = Number(exercise.reps);
    const sets = Number(exercise.sets);
    if (Number.isFinite(planned) && planned > 0 && Number.isFinite(sets) && sets > 0) {
      return Array.from({ length: sets }, () => planned);
    }
    return [];
  }

  function formatWeight(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "sin lastre";
    return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(1)} kg`;
  }

  function formatDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  }

  function sumReps(list) {
    return list.reduce((acc, val) => acc + val, 0);
  }

  function buildQuickComment(sessions) {
    if (sessions.length < 2) return "";
    const [latest, previous] = sessions;
    const weightDiff = (latest.weight || 0) - (previous.weight || 0);
    const repsDiff = sumReps(latest.reps) - sumReps(previous.reps);

    if (weightDiff < 0 && repsDiff > 0) {
      return "Comentario rápido: bajada de peso y subida de repeticiones.";
    }
    if (weightDiff > 0 && repsDiff < 0) {
      return "Comentario rápido: subida de peso y bajada de repeticiones.";
    }
    if (weightDiff > 0 && repsDiff > 0) {
      return "Comentario rápido: subida de peso y subida de repeticiones.";
    }
    if (weightDiff < 0 && repsDiff < 0) {
      return "Comentario rápido: bajada de peso y bajada de repeticiones.";
    }
    if (weightDiff === 0 && repsDiff > 0) {
      return "Comentario rápido: mismo peso y más repeticiones.";
    }
    if (weightDiff === 0 && repsDiff < 0) {
      return "Comentario rápido: mismo peso y menos repeticiones.";
    }
    return "Comentario rápido: sin cambios claros.";
  }

  function getExerciseSessions(name) {
    const calendar = getCalendarSnapshot();
    if (!calendar) return [];
    const target = normalizeExerciseName(name);
    const sessions = [];

    Object.entries(calendar).forEach(([dateISO, ejercicios]) => {
      if (!Array.isArray(ejercicios)) return;
      ejercicios.forEach((exercise) => {
        if (!exercise || typeof exercise !== "object") return;
        const normalizedName = normalizeExerciseName(exercise.name || exercise.ejercicio);
        if (!normalizedName || normalizedName !== target) return;
        if (!isExerciseDone(exercise)) return;
        const reps = extractReps(exercise);
        if (!reps.length) return;
        const weight = Number(exercise.weightKg) || 0;
        const note = typeof exercise.note === "string" ? exercise.note.trim() : "";
        sessions.push({ dateISO, weight, reps, note });
      });
    });

    sessions.sort((a, b) => b.dateISO.localeCompare(a.dateISO));
    return sessions;
  }

  function renderDetail() {
    if (!elements.detail || !elements.summaryList) return;
    if (!state.selectedExercise) {
      elements.detail.classList.add("hidden");
      if (elements.detailEmpty) {
        elements.detailEmpty.classList.remove("hidden");
      }
      if (elements.detailTitle) {
        elements.detailTitle.textContent = "";
      }
      elements.summaryList.innerHTML = "";
      if (elements.summaryNote) {
        elements.summaryNote.textContent = "";
      }
      return;
    }

    if (elements.detailEmpty) {
      elements.detailEmpty.classList.add("hidden");
    }
    elements.detail.classList.remove("hidden");
    if (elements.detailTitle) {
      elements.detailTitle.innerHTML = "";
      const thumb = buildHistoryThumbnail(state.selectedExercise);
      elements.detailTitle.append(thumb);
      const titleSpan = document.createElement("span");
      titleSpan.textContent = formatExerciseName(state.selectedExercise);
      elements.detailTitle.append(titleSpan);
    }

    const sessions = getExerciseSessions(state.selectedExercise);
    elements.summaryList.innerHTML = "";

    if (!sessions.length) {
      const empty = document.createElement("li");
      empty.className = "history-summary-empty";
      empty.textContent = "No hay repeticiones registradas para este ejercicio todavía.";
      elements.summaryList.append(empty);
      if (elements.summaryNote) {
        elements.summaryNote.textContent = "";
      }
      return;
    }

    sessions.forEach((session) => {
      const item = document.createElement("li");
      item.className = "history-summary-item";

      const title = document.createElement("div");
      title.className = "history-summary-title";
      const weightLabel = session.weight > 0 ? `con ${formatWeight(session.weight)}` : "sin lastre";
      title.textContent = `${formatExerciseName(state.selectedExercise)} ${weightLabel}: ${session.reps.join(" - ")}`;

      const meta = document.createElement("div");
      meta.className = "history-summary-meta";
      const dateEl = document.createElement("time");
      dateEl.dateTime = session.dateISO;
      dateEl.textContent = formatDate(session.dateISO);
      dateEl.className = "history-summary-date";
      meta.append(dateEl);

      if (session.note) {
        const noteEl = document.createElement("span");
        noteEl.className = "history-summary-note";
        noteEl.textContent = `Nota: ${session.note}`;
        meta.append(noteEl);
      }

      item.append(title, meta);
      elements.summaryList.append(item);
    });

    if (elements.summaryNote) {
      elements.summaryNote.textContent = buildQuickComment(sessions);
    }
  }

  function handleRebuild() {
    if (!historyStore) return;
    const calendarProvider = global.entrenoApp && global.entrenoApp.getCalendarSnapshot;
    if (typeof calendarProvider !== "function") {
      alert("No se pudo reconstruir el historial. Calendario no disponible.");
      return;
    }
    const calendar = calendarProvider();
    const result = historyStore.rebuildFromCalendar(calendar);
    showToast(`Historial reconstruido (${result.entries} registros)`);
    autoSelectFirst();
    renderExercises();
    renderDetail();
  }

  function showToast(message) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.classList.remove("visible");
    }, 3000);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (toastTimer) clearTimeout(toastTimer);
  }

  document.addEventListener("DOMContentLoaded", init);

  global.seguimientoUI = {
    refresh: () => {
      renderExercises();
      renderDetail();
    },
    showToast,
    destroy,
  };
})(typeof window !== "undefined" ? window : this);
