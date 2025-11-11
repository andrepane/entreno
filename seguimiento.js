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
    lastChartEntries = chronological;
    renderSummary(chronological);
    renderTrends(chronological);
    renderTable(phaseFiltered);
    renderChart(chronological);
    if (chronological.length >= 2) {
      updateComparisonControls(chronological);
    } else {
      resetComparisonControls();
    }
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
      if (elements.trends) {
        elements.trends.innerHTML = "";
      }
      resetComparisonControls();
      return;
    }
    if (!historyStore) {
      resetComparisonControls();
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
      resetComparisonControls();
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

    const summaryRow = document.createElement("div");
    summaryRow.className = "summary-duo";
    const firstPhase = getPhaseForEntry(first);
    const lastPhase = getPhaseForEntry(last);
    const beforeCard = createSummaryCard(first, "before", { title: "Antes", phase: firstPhase });
    const transition = createSummaryTransition();
    const afterCard = createSummaryCard(last, "after", { title: "Ahora", phase: lastPhase, entries });
    summaryRow.append(beforeCard, transition, afterCard);

    const deltaCard = createDeltaCard(first, last, delta, pct);

    elements.summary.append(badge, summaryRow, deltaCard);
    if (elements.comparisonPanel) {
      elements.summary.append(elements.comparisonPanel);
    }
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

    const cards = [
      createTrendCard(
        "Mejor marca",
        best ? `${formatValue(best)} · ${formatDate(best.fechaISO)}` : "—",
        best && last && best.id === last.id ? "pr" : ""
      ),
      createTrendCard("Volumen 7 días", volumeLabel || "—"),
      createTrendCard("Último registro", last ? `${formatValue(last)} · ${formatDate(last.fechaISO)}` : "—", "last")
    ];
    elements.trends.append(...cards);

    const highlights = buildHighlights(sorted, suffix, best);
    if (highlights) {
      elements.trends.append(highlights);
    }
  }

  function createSummaryTransition() {
    const arrow = document.createElement("span");
    arrow.className = "summary-transition";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "➡️";
    return arrow;
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

  function createPhaseChip(phaseKey) {
    if (!phaseKey) return null;
    const label = getPhaseLabelText(phaseKey);
    const normalized = normalizeKey(phaseKey)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const chip = document.createElement("span");
    chip.className = `phase-chip phase-${normalized || "otro"}`;
    chip.textContent = label;
    return chip;
  }

  function createSummaryCard(entry, variant, options = {}) {
    const card = document.createElement("article");
    card.className = `summary-card ${variant}`;

    const icon = document.createElement("span");
    icon.className = `summary-card-icon ${variant}`;
    icon.textContent = variant === "before" ? "🕘" : "⚡";

    const body = document.createElement("div");
    body.className = "summary-card-body";

    const header = document.createElement("div");
    header.className = "summary-card-header";
    const label = document.createElement("span");
    label.className = "summary-card-label";
    label.textContent = options.title || (variant === "before" ? "Antes" : "Ahora");
    const type = document.createElement("span");
    type.className = "summary-card-type";
    type.textContent = TYPE_LABEL[entry.tipo] || entry.tipo;
    header.append(label, type);

    const value = document.createElement("strong");
    value.className = "summary-card-value";
    value.textContent = formatValue(entry);

    const meta = document.createElement("div");
    meta.className = "summary-card-meta";
    const date = document.createElement("time");
    date.dateTime = entry.fechaISO;
    date.textContent = formatDate(entry.fechaISO);
    meta.append(date);
    const phaseChip = createPhaseChip(options.phase);
    if (phaseChip) {
      meta.append(phaseChip);
    }

    body.append(header, value, meta);

    if (variant === "after") {
      const sparkline = createSparkline(options.entries || []);
      if (sparkline) {
        body.append(sparkline);
      }
    }

    card.append(icon, body);
    return card;
  }

  function createSparkline(entries) {
    if (!entries || entries.length < 2) return null;
    const sorted = entries.slice().sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));
    const width = 160;
    const height = 60;
    const padding = 6;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.className = "summary-sparkline";
    const ctx = canvas.getContext("2d");
    const values = sorted.map((entry) => Number(entry.valor));
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const denominator = Math.max(sorted.length - 1, 1);
    const plotWidth = width - padding * 2;
    const plotHeight = height - padding * 2;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    sorted.forEach((entry, index) => {
      const value = Number(entry.valor);
      const x = padding + (index / denominator) * plotWidth;
      const normalized = (value - min) / range;
      const y = padding + (1 - normalized) * plotHeight;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = "#48d06d";
    ctx.stroke();
    ctx.lineTo(padding + plotWidth, padding + plotHeight);
    ctx.lineTo(padding, padding + plotHeight);
    ctx.closePath();
    ctx.fillStyle = "rgba(72,208,109,0.12)";
    ctx.fill();
    return canvas;
  }

  function createDeltaCard(first, last, delta, pct) {
    const card = document.createElement("article");
    card.className = "summary-card delta";

    const icon = document.createElement("span");
    icon.className = `summary-card-icon delta ${delta > 0 ? "up" : delta < 0 ? "down" : "same"}`;
    icon.textContent = delta > 0 ? "📈" : delta < 0 ? "📉" : "⏺️";

    const body = document.createElement("div");
    body.className = "summary-card-body";

    const header = document.createElement("div");
    header.className = "summary-card-header";
    const label = document.createElement("span");
    label.className = "summary-card-label";
    label.textContent = "Cambio total";
    const type = document.createElement("span");
    type.className = "summary-card-type";
    type.textContent = TYPE_LABEL[last.tipo] || last.tipo;
    header.append(label, type);

    const valueRow = document.createElement("div");
    valueRow.className = "delta-value-row";
    const indicator = document.createElement("span");
    indicator.className = `delta-indicator ${delta > 0 ? "up" : delta < 0 ? "down" : "same"}`;
    indicator.textContent = delta > 0 ? "▲" : delta < 0 ? "▼" : "■";
    const value = document.createElement("strong");
    value.className = "summary-card-value";
    value.textContent = formatDelta(delta);
    valueRow.append(indicator, value);

    const bar = createDeltaBar(first, last, delta);

    const meta = document.createElement("div");
    meta.className = "summary-card-meta";
    const pctSpan = document.createElement("span");
    pctSpan.className = "delta-meta";
    pctSpan.textContent = pct != null ? `${pct.toFixed(1)}%` : "Sin cambio";
    const rangeSpan = document.createElement("span");
    rangeSpan.className = "summary-card-note";
    rangeSpan.textContent = `${formatDate(first.fechaISO)} → ${formatDate(last.fechaISO)}`;
    meta.append(pctSpan, rangeSpan);

    body.append(header, valueRow, bar, meta);
    card.append(icon, body);
    return card;
  }

  function createDeltaBar(first, last, delta) {
    const bar = document.createElement("div");
    bar.className = "delta-bar";
    const fill = document.createElement("div");
    fill.className = "delta-bar-fill";
    const baseline = Math.max(Math.abs(Number(first.valor)), Math.abs(Number(last.valor)));
    const ratioSource = baseline > 0 ? baseline : Math.abs(delta);
    const ratio = ratioSource ? Math.min(Math.abs(delta) / ratioSource, 1) : 0;
    fill.style.setProperty("--delta-size", `${(ratio * 100).toFixed(2)}`);
    if (delta > 0) {
      fill.dataset.dir = "positive";
    } else if (delta < 0) {
      fill.dataset.dir = "negative";
    } else {
      fill.dataset.dir = "neutral";
    }
    bar.append(fill);
    return bar;
  }

  function buildHighlights(sorted, suffix, bestEntry) {
    if (!sorted || !sorted.length) return null;

    const gainWeek = { diff: -Infinity };
    const gainAny = { diff: -Infinity };
    const dropWeek = { diff: Infinity };
    const dropAny = { diff: Infinity };

    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      const diff = Number(current.valor) - Number(previous.valor);
      const prevDate = new Date(previous.fechaISO);
      const currDate = new Date(current.fechaISO);
      const daysBetween = Math.abs((currDate - prevDate) / (1000 * 60 * 60 * 24));
      const candidate = { diff, from: previous, to: current, days: daysBetween };
      if (diff > 0) {
        if (!gainAny.from || diff > gainAny.diff) {
          Object.assign(gainAny, candidate);
        }
        if (daysBetween <= 7 && (!gainWeek.from || diff > gainWeek.diff)) {
          Object.assign(gainWeek, candidate);
        }
      }
      if (diff < 0) {
        if (!dropAny.from || diff < dropAny.diff) {
          Object.assign(dropAny, candidate);
        }
        if (daysBetween <= 7 && (!dropWeek.from || diff < dropWeek.diff)) {
          Object.assign(dropWeek, candidate);
        }
      }
    }

    const rise = gainWeek.from ? gainWeek : gainAny.from ? gainAny : null;
    const fall = dropWeek.from ? dropWeek : dropAny.from ? dropAny : null;

    const container = document.createElement("div");
    container.className = "history-highlights";

    const formattedSuffix = suffix ? ` ${suffix}` : "";

    const riseValue = rise ? `${formatDelta(rise.diff)}${formattedSuffix}`.trim() : "—";
    const riseMeta = rise
      ? `${formatDate(rise.from.fechaISO)} → ${formatDate(rise.to.fechaISO)}${rise.days ? ` · ${Math.round(rise.days)} días` : ""}`
      : "Sin datos recientes";
    container.append(
      createHighlightCard("🔥", "Mayor subida en una semana", riseValue, riseMeta, "gain")
    );

    const fallValue = fall ? `${formatDelta(fall.diff)}${formattedSuffix}`.trim() : "—";
    const fallMeta = fall
      ? `${formatDate(fall.from.fechaISO)} → ${formatDate(fall.to.fechaISO)}${fall.days ? ` · ${Math.round(fall.days)} días` : ""}`
      : "Sin datos recientes";
    container.append(
      createHighlightCard("⚠️", "Mayor caída", fallValue, fallMeta, "drop")
    );

    const prValue = bestEntry ? formatValue(bestEntry) : "—";
    const prMeta = bestEntry ? formatDate(bestEntry.fechaISO) : "Aún sin PR";
    container.append(createHighlightCard("🛡️", "Mayor PR", prValue, prMeta, "pr"));

    return container;
  }

  function createHighlightCard(icon, title, value, meta, variant = "") {
    const card = document.createElement("article");
    card.className = "highlight-card";
    if (variant) {
      card.classList.add(`highlight-${variant}`);
    }
    const iconSpan = document.createElement("span");
    iconSpan.className = "highlight-icon";
    iconSpan.textContent = icon;
    const info = document.createElement("div");
    info.className = "highlight-info";
    const heading = document.createElement("h5");
    heading.textContent = title;
    const strong = document.createElement("strong");
    strong.textContent = value;
    const metaSpan = document.createElement("span");
    metaSpan.className = "highlight-meta";
    metaSpan.textContent = meta;
    info.append(heading, strong, metaSpan);
    card.append(iconSpan, info);
    return card;
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
    if (!Number.isFinite(value)) return "—";
    const suffix = TYPE_SUFFIX[entry.tipo] || "";
    const formattedValue = Number.isInteger(value) ? String(value) : value.toFixed(2);
    const base = `${formattedValue} ${suffix}`.trim();
    if (Array.isArray(entry.series) && entry.series.length) {
      const prefix = entry.series.length > 1 ? "Mejor serie: " : "Serie: ";
      return `${prefix}${base}`.trim();
    }
    return base;
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" });
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

    updateMarkerPosition(entries);
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
