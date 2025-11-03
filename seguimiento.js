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

  const RANGE_PRESETS = {
    week: { label: "Última semana", days: 7 },
    month: { label: "Último mes", days: 30 },
    quarter: { label: "Últimos 3 meses", days: 90 },
    all: { label: "Todo", days: null }
  };

  const state = {
    search: "",
    selectedExercise: null,
    selectedType: null,
    range: "quarter",
    order: "desc"
  };

  const elements = {};

  let unsubscribe = null;
  let toastTimer = null;

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
    elements.search = $("historySearch");
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
    elements.exportBtn = $("historyExportBtn");
    elements.importBtn = $("historyImportBtn");
    elements.importInput = $("historyImportFile");
    elements.clearBtn = $("historyClearBtn");
    elements.rebuildBtn = $("historyRebuildBtn");
    elements.toast = $("historyToast");
    elements.warnings = $("historyWarnings");

    if (!elements.search) return;

    renderRangeOptions();

    elements.search.addEventListener("input", () => {
      state.search = elements.search.value.toLowerCase();
      renderExercises();
    });

    elements.rangeSelect.addEventListener("change", () => {
      state.range = elements.rangeSelect.value;
      renderDetail();
    });

    elements.orderBtn.addEventListener("click", () => {
      state.order = state.order === "desc" ? "asc" : "desc";
      renderDetail();
    });

    elements.exportBtn?.addEventListener("click", handleExport);
    elements.importBtn?.addEventListener("click", () => elements.importInput?.click());
    elements.importInput?.addEventListener("change", handleImport);
    elements.clearBtn?.addEventListener("click", handleClear);
    elements.rebuildBtn?.addEventListener("click", handleRebuild);

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
    const entries = Array.from(map.entries()).map(([name, info]) => ({ name, info }));
    if (state.search) {
      return entries.filter(({ name }) => name.toLowerCase().includes(state.search));
    }
    return entries;
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

    elements.detailEmpty?.classList.add("hidden");
    elements.detail.classList.remove("hidden");
    elements.detailTitle.textContent = formatExerciseName(state.selectedExercise);
    renderTypeSelector(entries);
    renderSummary(filtered);
    renderTable(filtered);
    renderChart(filtered);
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
      tr.append(tdDate, tdValue, tdNotes, tdActions);
      elements.tableBody.append(tr);
    });
  }

  function renderChart(entries) {
    if (!elements.canvas) return;
    const ctx = elements.canvas.getContext("2d");
    clearCanvas();
    if (!entries.length) return;
    const sorted = entries.slice().sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));
    const values = sorted.map((entry) => Number(entry.valor));
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const width = elements.canvas.width;
    const height = elements.canvas.height;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#2563eb";
    ctx.fillStyle = "rgba(37,99,235,0.15)";
    ctx.beginPath();
    sorted.forEach((entry, index) => {
      const x = (index / (sorted.length - 1 || 1)) * width;
      const y = height - ((Number(entry.valor) - min) / range) * height;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
  }

  function clearCanvas() {
    if (!elements.canvas) return;
    const ctx = elements.canvas.getContext("2d");
    ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
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

  function handleExport() {
    try {
      const data = historyStore.exportJSON();
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `entreno-history-${Date.now()}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("Historial exportado");
    } catch (err) {
      console.error(err);
      showToast("No se pudo exportar el historial");
    }
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

  async function handleImport(event) {
    const file = event.target?.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const result = historyStore.importJSON(text);
      showToast(`Importadas ${result.imported} entradas`);
      autoSelectFirst();
      renderExercises();
      renderDetail();
    } catch (err) {
      console.error(err);
      alert(err.message || "No se pudo importar el archivo");
    }
  }

  function handleClear() {
    if (!confirm("¿Seguro que quieres borrar todo el historial?")) return;
    historyStore.clear();
    state.selectedExercise = null;
    state.selectedType = null;
    renderExercises();
    renderDetail();
    showToast("Historial borrado");
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
    destroy
  };
})(typeof window !== "undefined" ? window : this);
