(function (global) {
  "use strict";

  const historyStore = global.entrenoHistory;
  if (!historyStore) {
    console.warn("Seguimiento UI: history store no disponible");
    return;
  }

  const TYPE_LABEL = {
    reps: "Reps",
    tiempo: "Tiempo",
    peso: "Peso"
  };

  const TYPE_SUFFIX = {
    reps: "reps",
    tiempo: "s",
    peso: "kg"
  };

  const PHASE_LABELS = {
    base: "Base",
    intensificacion: "Intensificación",
    descarga: "Descarga",
  };

  const RANGE_PRESETS = {
    week: { label: "Última semana", days: 7 },
    month: { label: "Último mes", days: 30 },
    quarter: { label: "Últimos 3 meses", days: 90 },
    all: { label: "Todo", days: null }
  };

  const state = {
    selectedExercise: null,
    selectedType: null,
    range: "quarter",
    order: "desc",
    phase: "all",
  };

  const elements = {};

  let unsubscribe = null;
  let toastTimer = null;
  let resizeFrame = null;
  let lastChartEntries = [];

  function $(id) {
    return document.getElementById(id);
  }

  function formatExerciseName(name) {
    if (!name) return "";
    return name
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function init() {
    elements.exerciseList = $("historyExerciseList");
    elements.exerciseEmpty = $("historyExerciseEmpty");
    elements.detailPanel = $("historyDetailPanel");
    elements.detailEmpty = $("historyDetailEmpty");
    elements.detail = $("historyDetail");
    elements.detailTitle = $("historyDetailTitle");
    elements.typeSelector = $("historyTypeSelector");
    elements.rangeSelect = $("historyRange");
    elements.orderBtn = $("historyOrderBtn");
    elements.summary = $("historySummary");
    elements.tableBody = $("historyTableBody");
    elements.table = $("historyTable");
    elements.canvas = $("historyChart");
    elements.rebuildBtn = $("historyRebuildBtn");
    elements.toast = $("historyToast");
    elements.warnings = $("historyWarnings");
    elements.phaseFilter = $("historyPhaseFilter");
    elements.trends = $("historyTrends");

    if (elements.phaseFilter) {
      elements.phaseFilter.value = state.phase;
    }

    if (!elements.exerciseList || !elements.detail || !elements.tableBody) return;

    renderRangeOptions();

    elements.rangeSelect?.addEventListener("change", () => {
      state.range = elements.rangeSelect.value;
      renderDetail();
    });

    elements.orderBtn?.addEventListener("click", () => {
      state.order = state.order === "desc" ? "asc" : "desc";
      renderDetail();
    });

    elements.phaseFilter?.addEventListener("change", () => {
      state.phase = elements.phaseFilter.value;
      renderDetail();
    });

    elements.rebuildBtn?.addEventListener("click", handleRebuild);

    if (elements.canvas) {
      updateCanvasDimensions();
      window.addEventListener("resize", handleResize, { passive: true });
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

  function renderRangeOptions() {
    if (!elements.rangeSelect) return;
    elements.rangeSelect.innerHTML = "";
    Object.entries(RANGE_PRESETS).forEach(([value, info]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = info.label;
      elements.rangeSelect.append(option);
    });
    elements.rangeSelect.value = state.range;
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
    return Array.from(map.entries()).map(([name, info]) => ({ name, info }));
  }

  function renderExercises() {
    if (!elements.exerciseList) return;
    const items = getFilteredExercises();
    items.sort((a, b) => {
      const dateA = a.info.lastDate || "";
      const dateB = b.info.lastDate || "";
      if (dateA !== dateB) {
        return dateA < dateB ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });

    elements.exerciseList.innerHTML = "";
    if (!items.length) {
      elements.exerciseEmpty?.classList.remove("hidden");
      return;
    }
    elements.exerciseEmpty?.classList.add("hidden");

    items.forEach(({ name, info }) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item-button";
      button.textContent = formatExerciseName(name);
      button.setAttribute("aria-label", `Ver historial de ${formatExerciseName(name)}`);
      button.setAttribute("role", "option");
      button.addEventListener("click", () => selectExercise(name, null));

      if (state.selectedExercise === name) {
        button.classList.add("active");
        button.setAttribute("aria-selected", "true");
      } else {
        button.setAttribute("aria-selected", "false");
      }

      const chips = document.createElement("div");
      chips.className = "history-item-chips";
      ["reps", "tiempo", "peso"].forEach((typeKey) => {
        const count = info.countPorTipo[typeKey] || 0;
        if (!count) return;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `history-chip history-chip-${typeKey}`;
        chip.textContent = `${TYPE_LABEL[typeKey]} (${count})`;
        chip.setAttribute(
          "aria-label",
          `${TYPE_LABEL[typeKey]} para ${formatExerciseName(name)}, ${count} registros`
        );
        chip.addEventListener("click", (event) => {
          event.stopPropagation();
          selectExercise(name, typeKey);
        });
        if (state.selectedExercise === name && state.selectedType === typeKey) {
          chip.classList.add("active");
        }
        chips.append(chip);
      });

      li.append(button, chips);
      elements.exerciseList.append(li);
    });
  }

  function autoSelectFirst() {
    const items = getFilteredExercises();
    if (!items.length) {
      state.selectedExercise = null;
      state.selectedType = null;
      return;
    }
    state.selectedExercise = items[0].name;
    const tipos = Array.from(items[0].info.tipos);
    state.selectedType = tipos[0] || null;
  }

  function selectExercise(name, type) {
    state.selectedExercise = name;
    const availableTypes = Array.from(historyStore.listExercises().get(name)?.tipos || []);
    if (!availableTypes.length) {
      state.selectedType = null;
    } else if (type && availableTypes.includes(type)) {
      state.selectedType = type;
    } else if (!state.selectedType || !availableTypes.includes(state.selectedType)) {
      state.selectedType = availableTypes[0];
    }
    renderExercises();
    renderDetail();
  }

  function getDateRangeFilter() {
    const preset = RANGE_PRESETS[state.range] || RANGE_PRESETS.quarter;
    if (!preset.days) return null;
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - preset.days);
    from.setHours(0, 0, 0, 0);
    return from;
  }

  function renderDetail() {
    if (!elements.detail) return;
    if (!state.selectedExercise || !state.selectedType) {
      elements.detail.classList.add("hidden");
      elements.detailEmpty?.classList.remove("hidden");
      elements.detailTitle.textContent = "";
      elements.typeSelector.innerHTML = "";
      elements.summary.innerHTML = "";
      elements.tableBody.innerHTML = "";
      lastChartEntries = [];
      clearCanvas();
      return;
    }

    const entries = historyStore.getEntriesByExerciseAndType(state.selectedExercise, state.selectedType);
    const fromDate = getDateRangeFilter();
    const filtered = entries.filter((entry) => {
      if (!fromDate) return true;
      const entryDate = new Date(entry.fechaISO);
      return entryDate >= fromDate;
    });

    const phaseFiltered = filtered.filter((entry) => {
      if (state.phase === "all") return true;
      const meta = getMetaForDate(entry.fechaISO);
      return meta?.phase === state.phase;
    });

    if (elements.phaseFilter) {
      elements.phaseFilter.value = state.phase;
    }

    elements.detailEmpty?.classList.add("hidden");
    elements.detail.classList.remove("hidden");
    elements.detailTitle.textContent = formatExerciseName(state.selectedExercise);
    updateCanvasDimensions();
    renderTypeSelector(entries);
    renderSummary(phaseFiltered);
    renderTrends(phaseFiltered);
    renderTable(phaseFiltered);
    lastChartEntries = phaseFiltered;
    renderChart(phaseFiltered);
    updateOrderButton();
  }

  function renderTypeSelector(entries) {
    elements.typeSelector.innerHTML = "";
    const tipos = Array.from(new Set(entries.map((entry) => entry.tipo)));
    if (!tipos.includes(state.selectedType)) {
      tipos.unshift(state.selectedType);
    }
    const available = Array.from(historyStore.listExercises().get(state.selectedExercise)?.tipos || []);
    available.forEach((type) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-selector-btn";
      btn.textContent = TYPE_LABEL[type];
      btn.setAttribute("aria-pressed", state.selectedType === type ? "true" : "false");
      if (state.selectedType === type) btn.classList.add("active");
      btn.addEventListener("click", () => {
        state.selectedType = type;
        renderDetail();
      });
      elements.typeSelector.append(btn);
    });
  }

  function renderSummary(entries) {
    elements.summary.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No hay registros para mostrar en este rango.";
      elements.summary.append(empty);
      if (elements.trends) {
        elements.trends.innerHTML = "";
      }
      return;
    }
    if (!historyStore) {
      return;
    }
    const comparison = historyStore.compareProgress(entries);
    const first = comparison.primero;
    const last = comparison.ultimo;
    const delta = Number(comparison.delta || 0);
    const pct = comparison.pct;
    if (!first || !last) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Necesitas al menos un registro para comparar.";
      elements.summary.append(empty);
      return;
    }
    const badge = document.createElement("span");
    badge.className = "summary-badge";
    if (delta > 0) {
      badge.textContent = "🔼 Mejora";
      badge.classList.add("up");
    } else if (delta < 0) {
      badge.textContent = "🔽 Bajada";
      badge.classList.add("down");
    } else {
      badge.textContent = "➖ Igual";
      badge.classList.add("same");
    }

    const list = document.createElement("dl");
    list.className = "summary-grid";

    list.append(summaryItem("Primer registro", `${formatValue(first)} · ${formatDate(first.fechaISO)}`));
    list.append(summaryItem("Último registro", `${formatValue(last)} · ${formatDate(last.fechaISO)}`));
    list.append(summaryItem("Cambio", `${formatDelta(delta)}${pct != null ? ` (${pct.toFixed(1)}%)` : ""}`));

    elements.summary.append(badge, list);
  }

  function createTrendCard(title, value, variant = "") {
    const card = document.createElement("article");
    card.className = "trend-card";
    if (variant) {
      card.classList.add(`trend-${variant}`);
    }
    const heading = document.createElement("h4");
    heading.textContent = title;
    const strong = document.createElement("strong");
    strong.textContent = value;
    card.append(heading, strong);
    if (variant === "pr") {
      const badge = document.createElement("span");
      badge.className = "trend-badge";
      badge.textContent = "🔥 PR reciente";
      card.append(badge);
    }
    return card;
  }

  function renderTrends(entries) {
    if (!elements.trends) return;
    elements.trends.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Añade sesiones para ver tendencias.";
      elements.trends.append(empty);
      return;
    }
    const sorted = entries
      .slice()
      .sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));
    const last = sorted[sorted.length - 1];
    const best = sorted.reduce((acc, entry) => {
      if (!acc) return entry;
      return Number(entry.valor) > Number(acc.valor) ? entry : acc;
    }, null);
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const weeklyTotal = sorted.reduce((acc, entry) => {
      const d = new Date(entry.fechaISO);
      if (Number.isNaN(d.getTime()) || d < start) return acc;
      return acc + Number(entry.valor || 0);
    }, 0);
    const suffix = TYPE_SUFFIX[state.selectedType] || "";
    const volumeLabel = weeklyTotal
      ? `${weeklyTotal % 1 === 0 ? weeklyTotal : weeklyTotal.toFixed(1)} ${suffix}`.trim()
      : "—";

    elements.trends.append(
      createTrendCard(
        "Mejor marca",
        best ? `${formatValue(best)} · ${formatDate(best.fechaISO)}` : "—",
        best && last && best.id === last.id ? "pr" : ""
      ),
      createTrendCard("Volumen 7 días", volumeLabel || "—"),
      createTrendCard("Último registro", last ? `${formatValue(last)} · ${formatDate(last.fechaISO)}` : "—", "last")
    );
  }

  function summaryItem(label, value) {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    wrapper.append(dt, dd);
    return wrapper;
  }

  function formatDelta(value) {
    const num = Number(value);
    const formatted = Number.isInteger(num) ? num : Number(num.toFixed(2));
    if (num > 0) return `+${formatted}`;
    if (num < 0) return `${formatted}`;
    return "0";
  }

  function formatValue(entry) {
    const value = Number(entry.valor);
    const suffix = TYPE_SUFFIX[entry.tipo] || "";
    return `${value} ${suffix}`.trim();
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" });
  }

  function getMetaForDate(iso) {
    const provider = global.entrenoApp?.getDayMeta;
    if (typeof provider !== "function") return null;
    try {
      return provider(iso) || null;
    } catch (err) {
      return null;
    }
  }

  function renderTable(entries) {
    elements.tableBody.innerHTML = "";
    if (!entries.length) return;
    const sorted = entries.slice().sort((a, b) => {
      return state.order === "desc" ? b.fechaISO.localeCompare(a.fechaISO) : a.fechaISO.localeCompare(b.fechaISO);
    });

    sorted.forEach((entry) => {
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");
      tdDate.textContent = formatDate(entry.fechaISO);
      const tdValue = document.createElement("td");
      tdValue.textContent = formatValue(entry);
      const meta = getMetaForDate(entry.fechaISO) || {};
      const tdPhase = document.createElement("td");
      tdPhase.textContent = meta.phase ? PHASE_LABELS[meta.phase] || meta.phase : "—";
      const tdNotes = document.createElement("td");
      tdNotes.textContent = entry.notas || "—";
      const tdActions = document.createElement("td");
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "link-button";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", () => openEditModal(entry));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "link-button danger";
      delBtn.textContent = "Eliminar";
      delBtn.addEventListener("click", () => handleDeleteEntry(entry));
      tdActions.append(editBtn, delBtn);
      tr.append(tdDate, tdValue, tdPhase, tdNotes, tdActions);
      elements.tableBody.append(tr);
    });
  }

  function renderChart(entries) {
    if (!elements.canvas) return;
    const ctx = elements.canvas.getContext("2d");
    clearCanvas();
    if (!entries.length) return;
    updateCanvasDimensions();
    const width = elements.canvas.width;
    const height = elements.canvas.height;
    if (!width || !height) return;
    const sorted = entries.slice().sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));
    const values = sorted.map((entry) => Number(entry.valor));
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const paddingX = Math.max(12, Math.round(width * 0.05));
    const paddingY = Math.max(12, Math.round(height * 0.15));
    const plotWidth = width - paddingX * 2;
    const plotHeight = height - paddingY * 2;
    if (plotWidth <= 0 || plotHeight <= 0) return;
    const denominator = Math.max(sorted.length - 1, 1);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#2563eb";
    ctx.fillStyle = "rgba(37,99,235,0.15)";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    sorted.forEach((entry, index) => {
      const value = Number(entry.valor);
      const x = paddingX + (index / denominator) * plotWidth;
      const normalized = (value - min) / range;
      const y = paddingY + (1 - normalized) * plotHeight;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.lineTo(paddingX + plotWidth, paddingY + plotHeight);
    ctx.lineTo(paddingX, paddingY + plotHeight);
    ctx.closePath();
    ctx.fill();
  }

  function clearCanvas() {
    if (!elements.canvas) return;
    const ctx = elements.canvas.getContext("2d");
    ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  }

  function updateCanvasDimensions() {
    if (!elements.canvas) return;
    const wrapper = elements.canvas.parentElement;
    if (!wrapper) return;
    const width = Math.floor(wrapper.clientWidth);
    if (!width) return;
    const desiredHeight = Math.max(160, Math.round(width * 0.45));
    if (elements.canvas.style.width !== `${width}px`) {
      elements.canvas.style.width = `${width}px`;
    }
    if (elements.canvas.style.height !== `${desiredHeight}px`) {
      elements.canvas.style.height = `${desiredHeight}px`;
    }
    if (elements.canvas.width !== width) {
      elements.canvas.width = width;
    }
    if (elements.canvas.height !== desiredHeight) {
      elements.canvas.height = desiredHeight;
    }
  }

  function handleResize() {
    if (!elements.canvas) return;
    if (elements.detail?.classList.contains("hidden")) return;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      updateCanvasDimensions();
      renderChart(lastChartEntries);
    });
  }

  function handleDeleteEntry(entry) {
    if (!confirm("¿Eliminar esta entrada del historial?")) return;
    historyStore.deleteEntry(entry.id);
    showToast("Entrada eliminada");
    if (state.selectedExercise) {
      const entries = historyStore.getEntriesByExerciseAndType(state.selectedExercise, state.selectedType);
      if (!entries.length) {
        const tipos = Array.from(historyStore.listExercises().get(state.selectedExercise)?.tipos || []);
        if (!tipos.length) {
          autoSelectFirst();
        } else if (!tipos.includes(state.selectedType)) {
          state.selectedType = tipos[0];
        }
      }
    }
    renderExercises();
    renderDetail();
  }

  function openEditModal(entry) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const modal = document.createElement("div");
    modal.className = "modal";
    const title = document.createElement("h3");
    title.textContent = "Editar entrada";

    const form = document.createElement("form");
    form.className = "modal-form";

    const fieldDate = createField("Fecha", "date", entry.fechaISO);
    const fieldValue = createField("Valor", "number", entry.valor, { step: "0.01", min: "0" });
    const fieldNotes = createTextarea("Notas", entry.notas || "");

    const typeRow = document.createElement("div");
    typeRow.className = "modal-row";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Tipo";
    const typeSelect = document.createElement("select");
    ["reps", "tiempo", "peso"].forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = TYPE_LABEL[type];
      typeSelect.append(option);
    });
    typeSelect.value = entry.tipo;
    typeLabel.append(typeSelect);
    typeRow.append(typeLabel);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Guardar";
    saveBtn.className = "primary";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.className = "ghost";
    cancelBtn.addEventListener("click", close);

    actions.append(saveBtn, cancelBtn);

    form.append(fieldDate.wrapper, fieldValue.wrapper, typeRow, fieldNotes.wrapper, actions);
    modal.append(title, form);
    overlay.append(modal);
    document.body.append(overlay);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const fechaISO = fieldDate.input.value;
      const valor = Number(fieldValue.input.value);
      const notas = fieldNotes.input.value;
      if (!fechaISO) {
        alert("La fecha es obligatoria");
        return;
      }
      if (!Number.isFinite(valor)) {
        alert("El valor debe ser numérico");
        return;
      }
      historyStore.updateEntry(entry.id, {
        fechaISO,
        valor,
        notas,
        tipo: typeSelect.value
      });
      showToast("Entrada actualizada");
      close();
      renderDetail();
    });

    function close() {
      overlay.remove();
    }
  }

  function createField(labelText, type, value, attrs = {}) {
    const wrapper = document.createElement("label");
    wrapper.className = "modal-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = type;
    input.value = value ?? "";
    Object.entries(attrs).forEach(([key, val]) => input.setAttribute(key, val));
    wrapper.append(span, input);
    return { wrapper, input };
  }

  function createTextarea(labelText, value) {
    const wrapper = document.createElement("label");
    wrapper.className = "modal-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.value = value;
    wrapper.append(span, textarea);
    return { wrapper, input: textarea };
  }

  function updateOrderButton() {
    if (!elements.orderBtn) return;
    elements.orderBtn.textContent = state.order === "desc" ? "Ordenar ↑" : "Ordenar ↓";
    elements.orderBtn.setAttribute(
      "aria-label",
      state.order === "desc" ? "Ordenar por fecha ascendente" : "Ordenar por fecha descendente"
    );
  }

  function handleRebuild() {
    if (!historyStore) return;
    const calendarProvider = global.entrenoApp?.getCalendarSnapshot;
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
    if (resizeFrame) {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
    }
    window.removeEventListener("resize", handleResize);
  }

  document.addEventListener("DOMContentLoaded", init);

  global.seguimientoUI = {
    refresh: () => {
      renderExercises();
      renderDetail();
    },
    showToast,
    destroy
  };
})(typeof window !== "undefined" ? window : this);
