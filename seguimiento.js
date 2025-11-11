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
    compareIndex: null,
    loadFilter: "all",
  };

  const elements = {};

  let unsubscribe = null;
  let toastTimer = null;
  let resizeFrame = null;
  let lastChartEntries = [];

  function $(id) {
    return document.getElementById(id);
  }

  function hasValue(value) {
    return value !== undefined && value !== null;
  }

  function getInputValue(element) {
    return element && typeof element.value === "string" ? element.value : "";
  }

  function formatExerciseName(name) {
    if (!name) return "";
    return name
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function getLibraryStore() {
    return global.entrenoLibrary || null;
  }

  function normalizeKey(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function normalizeLoadValue(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function getLoadKey(load) {
    return normalizeLoadValue(load).toFixed(2);
  }

  function formatLoadLabel(load) {
    const value = normalizeLoadValue(load);
    if (Math.abs(value) < 0.25) return "BW";
    const abs = Math.abs(value);
    const formatted = abs % 1 === 0 ? abs : abs.toFixed(1);
    return value > 0 ? `+${formatted} kg` : `−${formatted} kg`;
  }

  function formatSetTitle(index) {
    return `Serie ${index + 1}`;
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

  function findLibraryExerciseByName(name) {
    const store = getLibraryStore();
    if (!store || typeof store.getLibrary !== "function") return null;
    const target = normalizeKey(name);
    if (!target) return null;
    const list = store.getLibrary();
    return list.find((item) => normalizeKey(item.name) === target) || null;
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
    elements.typeSelector = $("historyTypeSelector");
    elements.rangeSelect = $("historyRange");
    elements.orderBtn = $("historyOrderBtn");
    elements.summary = $("historySummary");
    elements.tableBody = $("historyTableBody");
    elements.table = $("historyTable");
    elements.canvas = $("historyChart");
    elements.chartWrapper = elements.canvas ? elements.canvas.parentElement : null;
    elements.loadFilter = $("historyLoadFilter");
    elements.rebuildBtn = $("historyRebuildBtn");
    elements.toast = $("historyToast");
    elements.warnings = $("historyWarnings");
    elements.phaseFilter = $("historyPhaseFilter");
    elements.trends = $("historyTrends");

    setupChartOverlay();
    buildComparisonPanel();

    if (elements.phaseFilter) {
      elements.phaseFilter.value = state.phase;
    }

    if (!elements.exerciseList || !elements.detail || !elements.tableBody) return;

    renderRangeOptions();

    if (elements.rangeSelect) {
      elements.rangeSelect.addEventListener("change", () => {
        state.range = elements.rangeSelect.value;
        renderDetail();
      });
    }

    if (elements.orderBtn) {
      elements.orderBtn.addEventListener("click", () => {
        state.order = state.order === "desc" ? "asc" : "desc";
        renderDetail();
      });
    }

    if (elements.phaseFilter) {
      elements.phaseFilter.addEventListener("change", () => {
        state.phase = elements.phaseFilter.value;
        renderDetail();
      });
    }

    if (elements.loadFilter) {
      elements.loadFilter.addEventListener("change", () => {
        state.loadFilter = elements.loadFilter.value;
        renderDetail();
      });
    }

    if (elements.rebuildBtn) {
      elements.rebuildBtn.addEventListener("click", handleRebuild);
    }

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
      if (elements.exerciseEmpty) {
        elements.exerciseEmpty.classList.remove("hidden");
      }
      return;
    }
    if (elements.exerciseEmpty) {
      elements.exerciseEmpty.classList.add("hidden");
    }

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
    const entry = historyStore.listExercises().get(name);
    const availableTypes = Array.from((entry && entry.tipos) || []);
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
      if (elements.detailEmpty) {
        elements.detailEmpty.classList.remove("hidden");
      }
      elements.detailTitle.textContent = "";
      elements.typeSelector.innerHTML = "";
      elements.summary.innerHTML = "";
      elements.tableBody.innerHTML = "";
      lastChartEntries = [];
      clearCanvas();
      resetComparisonControls();
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
      return meta && meta.phase === state.phase;
    });

    if (elements.phaseFilter) {
      elements.phaseFilter.value = state.phase;
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
    updateCanvasDimensions();
    renderTypeSelector(entries);
    const chronological = phaseFiltered.slice().sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));
    updateLoadFilterOptions(chronological);
    const filteredForView = applyLoadFilter(chronological);
    lastChartEntries = filteredForView;
    renderSummary(filteredForView);
    renderTrends(filteredForView);
    renderTable(applyLoadFilter(phaseFiltered));
    renderChart(filteredForView);
    resetComparisonControls();
    updateOrderButton();
  }

  function renderTypeSelector(entries) {
    elements.typeSelector.innerHTML = "";
    const tipos = Array.from(new Set(entries.map((entry) => entry.tipo)));
    if (!tipos.includes(state.selectedType)) {
      tipos.unshift(state.selectedType);
    }
    const selectedInfo = historyStore.listExercises().get(state.selectedExercise);
    const available = Array.from((selectedInfo && selectedInfo.tipos) || []);
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

    const sessions = groupEntriesBySession(entries);
    if (!sessions.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No hay sesiones registradas para comparar.";
      elements.summary.append(empty);
      return;
    }

    const latestSession = sessions[sessions.length - 1];
    const previousSession = sessions[sessions.length - 2] || null;
    const comparison = historyStore.compareSessionsBySet(
      latestSession.entries,
      previousSession ? previousSession.entries : [],
      { toleranceKg: 2 }
    );

    if (!comparison.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No hay series registradas en la última sesión.";
      elements.summary.append(empty);
      return;
    }

    const header = document.createElement("div");
    header.className = "summary-session-header";
    const currentSpan = document.createElement("span");
    currentSpan.textContent = `Última sesión: ${formatDate(latestSession.fecha)}`;
    header.append(currentSpan);
    const previousSpan = document.createElement("span");
    previousSpan.textContent = previousSession
      ? `Comparada con: ${formatDate(previousSession.fecha)}`
      : "Sin sesión anterior comparable";
    header.append(previousSpan);
    elements.summary.append(header);

    const grid = document.createElement("div");
    grid.className = "set-summary-grid";
    comparison.forEach((result) => {
      grid.append(createSetSummaryCard(result));
    });
    elements.summary.append(grid);
  }

  function createValueColumn(label, entry) {
    const column = document.createElement("div");
    column.className = "set-card-column";
    const labelSpan = document.createElement("span");
    labelSpan.className = "set-card-label";
    labelSpan.textContent = label;
    const valueStrong = document.createElement("strong");
    valueStrong.className = "set-card-value";
    valueStrong.textContent = entry ? formatValue(entry) : "—";
    column.append(labelSpan, valueStrong);
    const meta = document.createElement("span");
    meta.className = "set-card-meta";
    if (entry) {
      const load = formatLoadLabel(entry.lastreKg);
      meta.textContent = `${formatDate(entry.fechaISO)} · ${load}`;
    } else {
      meta.textContent = "—";
    }
    column.append(meta);
    return column;
  }

  function createSetSummaryCard(result) {
    const card = document.createElement("article");
    card.className = "set-card";
    const header = document.createElement("header");
    header.className = "set-card-header";
    const title = document.createElement("h3");
    title.textContent = formatSetTitle(result.setIndex);
    header.append(title);
    const loadValue = result.current ? result.current.lastreKg : result.previous ? result.previous.lastreKg : 0;
    const loadChip = document.createElement("span");
    loadChip.className = "set-card-chip";
    loadChip.textContent = formatLoadLabel(loadValue);
    header.append(loadChip);
    card.append(header);

    if (result.reason === "load-mismatch") {
      const warning = document.createElement("span");
      warning.className = "set-card-warning";
      warning.textContent = "⚠️ lastre distinto";
      card.append(warning);
    } else if (result.reason === "missing-prev") {
      const warning = document.createElement("span");
      warning.className = "set-card-warning";
      warning.textContent = "⚠️ sin referencia previa";
      card.append(warning);
    } else if (result.reason === "missing-current") {
      const warning = document.createElement("span");
      warning.className = "set-card-warning";
      warning.textContent = "⚠️ serie no realizada";
      card.append(warning);
    }

    const valuesRow = document.createElement("div");
    valuesRow.className = "set-card-values";
    valuesRow.append(createValueColumn("Actual", result.current));
    valuesRow.append(createValueColumn("Anterior", result.previous));
    card.append(valuesRow);

    const deltaRow = document.createElement("div");
    deltaRow.className = "set-card-delta";
    const deltaLabel = document.createElement("span");
    deltaLabel.textContent = "Δ";
    deltaRow.append(deltaLabel);
    const deltaValue = document.createElement("strong");
    deltaValue.className = "set-card-delta-value";
    deltaValue.textContent = result.comparable ? formatDelta(result.delta) : "—";
    deltaRow.append(deltaValue);
    const pctSpan = document.createElement("span");
    pctSpan.className = "set-card-pct";
    pctSpan.textContent =
      result.comparable && result.pct != null ? `${result.pct > 0 ? "+" : ""}${result.pct.toFixed(1)}%` : "—";
    deltaRow.append(pctSpan);
    card.append(deltaRow);

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

    const prs = historyStore.getPRsBySet(entries, state.selectedType);
    const keys = Object.keys(prs);
    if (!keys.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Aún no hay PRs registrados.";
      elements.trends.append(empty);
      return;
    }

    const sortedKeys = keys.sort((a, b) => {
      const [setA, loadA] = a.split("|").map(Number);
      const [setB, loadB] = b.split("|").map(Number);
      if (setA === setB) return loadA - loadB;
      return setA - setB;
    });

    let best = null;
    const grid = document.createElement("div");
    grid.className = "pr-grid";
    sortedKeys.forEach((key) => {
      const entry = prs[key];
      const [setStr, loadStr] = key.split("|");
      const setIndex = Number(setStr);
      const load = Number(loadStr);
      grid.append(createPRCard(entry, setIndex, load));
      if (!best || Number(entry.valor) > Number(best.entry.valor)) {
        best = { entry, setIndex, load };
      }
    });

    if (best) {
      const highlight = document.createElement("div");
      highlight.className = "pr-global";
      highlight.innerHTML = `<strong>PR global:</strong> ${formatValue(best.entry)} · ${formatSetTitle(best.setIndex)} (${formatLoadLabel(
        best.load
      )}) · ${formatDate(best.entry.fechaISO)}`;
      elements.trends.append(highlight);
    }

    elements.trends.append(grid);
  }

  function createPRCard(entry, setIndex, load) {
    const card = document.createElement("article");
    card.className = "pr-card";
    const title = document.createElement("h4");
    title.textContent = `PR ${formatSetTitle(setIndex)} (${formatLoadLabel(load)})`;
    const value = document.createElement("strong");
    value.textContent = formatValue(entry);
    const meta = document.createElement("span");
    meta.className = "pr-meta";
    meta.textContent = formatDate(entry.fechaISO);
    card.append(title, value, meta);
    return card;
  }

  function getPhaseForEntry(entry) {
    if (!entry) return null;
    if (entry.fase) return entry.fase;
    if (entry.phase) return entry.phase;
    const meta = getMetaForDate(entry.fechaISO);
    if (meta && (meta.phase || meta.fase)) {
      return meta.phase || meta.fase;
    }
    return null;
  }

  function getPhaseLabelText(phaseKey) {
    if (!phaseKey) return null;
    const normalized = normalizeKey(phaseKey)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return PHASE_LABELS[normalized] || phaseKey;
  }


  function setupChartOverlay() {
    if (!elements.chartWrapper) return;
    elements.chartWrapper.classList.add("history-chart-ready");
    if (!elements.chartOverlay) {
      const overlay = document.createElement("div");
      overlay.className = "history-chart-overlay hidden";
      const highlight = document.createElement("div");
      highlight.className = "history-chart-highlight";
      const marker = document.createElement("div");
      marker.className = "history-chart-marker";
      overlay.append(highlight, marker);
      elements.chartWrapper.append(overlay);
      elements.chartOverlay = overlay;
      elements.chartHighlight = highlight;
      elements.chartMarker = marker;
    }
    if (!elements.chartSlider) {
      const sliderContainer = document.createElement("div");
      sliderContainer.className = "history-chart-slider-container hidden";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.step = "1";
      slider.value = "0";
      slider.className = "history-chart-slider";
      slider.setAttribute("aria-label", "Comparar registro en la línea de tiempo");
      slider.addEventListener("input", handleChartSliderInput);
      sliderContainer.append(slider);
      elements.chartWrapper.insertAdjacentElement("afterend", sliderContainer);
      elements.chartSliderContainer = sliderContainer;
      elements.chartSlider = slider;
    }
  }

  function handleChartSliderInput() {
    if (!elements.chartSlider) return;
    const index = Number(elements.chartSlider.value);
    if (Number.isNaN(index)) return;
    const maxIndex = lastChartEntries.length ? lastChartEntries.length - 1 : 0;
    state.compareIndex = Math.max(0, Math.min(index, maxIndex));
    updateMarkerPosition(lastChartEntries);
    updateComparisonPanel(lastChartEntries);
  }

  function updateComparisonControls(entries) {
    if (!elements.chartSlider || !elements.chartOverlay) return;
    if (!entries || entries.length < 2) {
      resetComparisonControls();
      return;
    }
    const maxIndex = entries.length - 1;
    if (state.compareIndex === null || state.compareIndex > maxIndex) {
      state.compareIndex = 0;
    }
    elements.chartSlider.max = String(maxIndex);
    elements.chartSlider.value = String(state.compareIndex);
    elements.chartSliderContainer.classList.remove("hidden");
    elements.chartOverlay.classList.remove("hidden");
    updateMarkerPosition(entries);
    updateComparisonPanel(entries);
  }

  function resetComparisonControls() {
    state.compareIndex = null;
    if (elements.chartOverlay) {
      elements.chartOverlay.classList.add("hidden");
      elements.chartOverlay.style.setProperty("--marker-position", "100%");
    }
    if (elements.chartSliderContainer) {
      elements.chartSliderContainer.classList.add("hidden");
    }
    if (elements.comparisonPanel) {
      elements.comparisonPanel.classList.add("hidden");
    }
  }

  function buildComparisonPanel() {
    if (elements.comparisonPanel) return;
    const panel = document.createElement("section");
    panel.className = "comparison-panel hidden";
    const heading = document.createElement("h4");
    heading.textContent = "Comparativa temporal";
    const grid = document.createElement("div");
    grid.className = "comparison-grid";

    const selectedBlock = document.createElement("article");
    selectedBlock.className = "comparison-block selected";
    const selectedLabel = document.createElement("span");
    selectedLabel.className = "comparison-label";
    selectedLabel.textContent = "Seleccionado";
    const selectedValue = document.createElement("strong");
    selectedValue.className = "comparison-value";
    const selectedMeta = document.createElement("span");
    selectedMeta.className = "comparison-meta";
    selectedBlock.append(selectedLabel, selectedValue, selectedMeta);

    const diffBlock = document.createElement("div");
    diffBlock.className = "comparison-diff";
    const diffLabel = document.createElement("span");
    diffLabel.textContent = "Δ";
    const diffValue = document.createElement("strong");
    diffValue.className = "comparison-diff-value";
    const diffPct = document.createElement("span");
    diffPct.className = "comparison-diff-pct";
    diffBlock.append(diffLabel, diffValue, diffPct);

    const currentBlock = document.createElement("article");
    currentBlock.className = "comparison-block current";
    const currentLabel = document.createElement("span");
    currentLabel.className = "comparison-label";
    currentLabel.textContent = "Actual";
    const currentValue = document.createElement("strong");
    currentValue.className = "comparison-value";
    const currentMeta = document.createElement("span");
    currentMeta.className = "comparison-meta";
    currentBlock.append(currentLabel, currentValue, currentMeta);

    grid.append(selectedBlock, diffBlock, currentBlock);
    panel.append(heading, grid);

    elements.comparisonPanel = panel;
    elements.comparisonSelectedValue = selectedValue;
    elements.comparisonSelectedMeta = selectedMeta;
    elements.comparisonCurrentValue = currentValue;
    elements.comparisonCurrentMeta = currentMeta;
    elements.comparisonDiffValue = diffValue;
    elements.comparisonDiffPct = diffPct;
    elements.comparisonDiffBlock = diffBlock;
  }

  function updateComparisonPanel(entries) {
    if (!elements.comparisonPanel || !entries || entries.length < 2) {
      if (elements.comparisonPanel) {
        elements.comparisonPanel.classList.add("hidden");
      }
      return;
    }
    const maxIndex = entries.length - 1;
    const clampedIndex = Math.max(0, Math.min(state.compareIndex ?? 0, maxIndex));
    const selected = entries[clampedIndex];
    const current = entries[maxIndex];
    if (!selected || !current) {
      elements.comparisonPanel.classList.add("hidden");
      return;
    }
    state.compareIndex = clampedIndex;

    const selectedPhase = getPhaseForEntry(selected);
    const selectedPhaseLabel = getPhaseLabelText(selectedPhase);
    elements.comparisonSelectedValue.textContent = formatValue(selected);
    elements.comparisonSelectedMeta.textContent = selectedPhaseLabel
      ? `${formatDate(selected.fechaISO)} · ${selectedPhaseLabel}`
      : formatDate(selected.fechaISO);

    const currentPhase = getPhaseForEntry(current);
    const currentPhaseLabel = getPhaseLabelText(currentPhase);
    elements.comparisonCurrentValue.textContent = formatValue(current);
    elements.comparisonCurrentMeta.textContent = currentPhaseLabel
      ? `${formatDate(current.fechaISO)} · ${currentPhaseLabel}`
      : formatDate(current.fechaISO);

    const diff = Number(current.valor) - Number(selected.valor);
    const base = Number(selected.valor);
    const pct = base !== 0 ? (diff / base) * 100 : null;
    elements.comparisonDiffValue.textContent = formatDelta(diff);
    if (pct !== null && Number.isFinite(pct)) {
      const sign = pct > 0 ? "+" : "";
      elements.comparisonDiffPct.textContent = `${sign}${pct.toFixed(1)}%`;
    } else {
      elements.comparisonDiffPct.textContent = "—";
    }

    if (elements.comparisonDiffBlock) {
      elements.comparisonDiffBlock.classList.remove("up", "down", "same");
      if (diff > 0) {
        elements.comparisonDiffBlock.classList.add("up");
      } else if (diff < 0) {
        elements.comparisonDiffBlock.classList.add("down");
      } else {
        elements.comparisonDiffBlock.classList.add("same");
      }
    }

    elements.comparisonPanel.classList.remove("hidden");
  }

  function updateMarkerPosition(entries) {
    if (!elements.chartOverlay || !entries || !entries.length || state.compareIndex === null) {
      if (elements.chartOverlay) {
        elements.chartOverlay.style.setProperty("--marker-position", "100%");
      }
      return;
    }
    const maxIndex = entries.length - 1;
    const clamped = Math.max(0, Math.min(state.compareIndex, maxIndex));
    state.compareIndex = clamped;
    const denominator = Math.max(maxIndex, 1);
    const ratio = denominator ? clamped / denominator : 0;
    const percent = Math.max(0, Math.min(100, ratio * 100));
    elements.chartOverlay.style.setProperty("--marker-position", `${percent}%`);
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

  function updateLoadFilterOptions(entries) {
    if (!elements.loadFilter) return;
    const loadMap = new Map();
    (entries || []).forEach((entry) => {
      if (!entry) return;
      const key = getLoadKey(entry.lastreKg);
      if (!loadMap.has(key)) {
        loadMap.set(key, formatLoadLabel(entry.lastreKg));
      }
    });
    const keys = Array.from(loadMap.keys()).sort((a, b) => Number(a) - Number(b));
    elements.loadFilter.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "Todos";
    elements.loadFilter.append(allOption);
    keys.forEach((key) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = loadMap.get(key);
      elements.loadFilter.append(option);
    });
    if (state.loadFilter !== "all" && !loadMap.has(state.loadFilter)) {
      state.loadFilter = keys[0] || "all";
    }
    elements.loadFilter.value = state.loadFilter;
    const hideSelector = keys.length <= 1;
    elements.loadFilter.disabled = hideSelector;
    elements.loadFilter.classList.toggle("hidden", hideSelector);
  }

  function applyLoadFilter(entries) {
    if (!Array.isArray(entries)) return [];
    if (state.loadFilter === "all") return entries.slice();
    return entries.filter((entry) => getLoadKey(entry.lastreKg) === state.loadFilter);
  }

  function groupEntriesBySession(entries) {
    const map = new Map();
    entries.forEach((entry) => {
      if (!entry) return;
      const key = entry.sourceDayId || entry.fechaISO;
      if (!map.has(key)) {
        map.set(key, { id: key, fecha: entry.fechaISO, entries: [] });
      }
      const session = map.get(key);
      if (!session.fecha || session.fecha < entry.fechaISO) {
        session.fecha = entry.fechaISO;
      }
      session.entries.push(entry);
    });
    return Array.from(map.values())
      .map((session) => ({
        ...session,
        entries: session.entries.slice().sort((a, b) => a.setIndex - b.setIndex),
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  function getMetaForDate(iso) {
    const provider = global.entrenoApp && global.entrenoApp.getDayMeta;
    if (typeof provider !== "function") return null;
    try {
      return provider(iso) || null;
    } catch (err) {
      return null;
    }
  }

  function createIconActionButton(iconName, label, className, options = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    if (className) {
      btn.className = className;
    }
    const showLabel = options.showLabel === true;
    if (global.CaliGymIcons && typeof global.CaliGymIcons.decorate === "function") {
      global.CaliGymIcons.decorate(btn, iconName, { label, showLabel });
    } else {
      btn.textContent = label;
      if (!showLabel) {
        btn.setAttribute("aria-label", label);
      }
      btn.title = label;
    }
    return btn;
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
      const tdSet = document.createElement("td");
      const setIndexValue = Number.isFinite(Number(entry.setIndex)) && Number(entry.setIndex) >= 0 ? Number(entry.setIndex) : 0;
      tdSet.textContent = formatSetTitle(setIndexValue);
      const tdLoad = document.createElement("td");
      tdLoad.textContent = formatLoadLabel(entry.lastreKg);
      const tdValue = document.createElement("td");
      tdValue.textContent = formatValue(entry);
      const meta = getMetaForDate(entry.fechaISO) || {};
      const tdPhase = document.createElement("td");
      tdPhase.textContent = meta.phase ? PHASE_LABELS[meta.phase] || meta.phase : "—";
      const tdNotes = document.createElement("td");
      tdNotes.textContent = entry.notas || "—";
      const tdActions = document.createElement("td");
      const editBtn = createIconActionButton("edit", "Editar entrada", "ghost micro");
      editBtn.addEventListener("click", () => openEditModal(entry));
      const delBtn = createIconActionButton("trash", "Eliminar entrada", "ghost micro danger");
      delBtn.addEventListener("click", () => handleDeleteEntry(entry));
      tdActions.append(editBtn, delBtn);
      tr.append(tdDate, tdSet, tdLoad, tdValue, tdPhase, tdNotes, tdActions);
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
    const sessions = groupEntriesBySession(entries);
    if (!sessions.length) return;

    const setIndices = new Set();
    sessions.forEach((session) => {
      session.entries.forEach((entry) => {
        const idx = Number.isFinite(Number(entry.setIndex)) && Number(entry.setIndex) >= 0 ? Number(entry.setIndex) : 0;
        setIndices.add(idx);
      });
    });
    const sortedSets = Array.from(setIndices).sort((a, b) => a - b);
    const colors = ["#2563eb", "#f97316", "#10b981", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#f59e0b"];

    const allValues = [];
    sessions.forEach((session) => {
      session.entries.forEach((entry) => {
        allValues.push(Number(entry.valor));
      });
    });
    const max = Math.max(...allValues);
    const min = Math.min(...allValues);
    const range = max - min || 1;

    const paddingX = Math.max(12, Math.round(width * 0.06));
    const paddingY = Math.max(16, Math.round(height * 0.18));
    const plotWidth = width - paddingX * 2;
    const plotHeight = height - paddingY * 2;
    if (plotWidth <= 0 || plotHeight <= 0) return;

    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const denominator = Math.max(sessions.length - 1, 1);

    sortedSets.forEach((setIndex, idx) => {
      const color = colors[idx % colors.length];
      ctx.strokeStyle = color;
      ctx.beginPath();
      let drawing = false;
      sessions.forEach((session, sessionIdx) => {
        const entry = session.entries.find((item) => {
          const candidate = Number.isFinite(Number(item.setIndex)) && Number(item.setIndex) >= 0 ? Number(item.setIndex) : 0;
          return candidate === setIndex;
        });
        if (!entry) {
          drawing = false;
          return;
        }
        const value = Number(entry.valor);
        const x = paddingX + (sessionIdx / denominator) * plotWidth;
        const normalized = (value - min) / range;
        const y = paddingY + (1 - normalized) * plotHeight;
        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });
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
    if (elements.detail && elements.detail.classList && elements.detail.classList.contains("hidden")) return;
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
        const currentInfo = historyStore.listExercises().get(state.selectedExercise);
        const tipos = Array.from((currentInfo && currentInfo.tipos) || []);
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
    const fieldSet = createField(
      "Serie",
      "number",
      Number.isFinite(Number(entry.setIndex)) ? Number(entry.setIndex) + 1 : 1,
      { min: "1", step: "1" }
    );
    const fieldLoad = createField("Lastre (kg)", "number", entry.lastreKg ?? 0, { step: "0.5" });
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

    form.append(fieldDate.wrapper, fieldSet.wrapper, fieldLoad.wrapper, fieldValue.wrapper, typeRow, fieldNotes.wrapper, actions);
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
      let setIndexInput = Number(fieldSet.input.value);
      if (!Number.isFinite(setIndexInput) || setIndexInput < 1) {
        setIndexInput = 1;
      }
      const normalizedSetIndex = Math.max(0, Math.round(setIndexInput) - 1);
      const loadValue = Number(fieldLoad.input.value);
      historyStore.updateEntry(entry.id, {
        fechaISO,
        valor,
        notas,
        tipo: typeSelect.value,
        setIndex: normalizedSetIndex,
        lastreKg: Number.isFinite(loadValue) ? loadValue : 0
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
    input.value = hasValue(value) ? value : "";
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
