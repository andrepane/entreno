const getCrypto = () =>
  (typeof globalThis !== "undefined" && globalThis.crypto) ||
  (typeof self !== "undefined" && self.crypto) ||
  (typeof window !== "undefined" && window.crypto) ||
  undefined;

const randomUUID = (() => {
  const cryptoObj = getCrypto();
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return () => cryptoObj.randomUUID();
  }
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    return () => {
      const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
  }
  return () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
})();

/* ========= Utilidades de fecha ========= */
const fmt = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth()+1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const fromISO = (iso) => {
  if (!iso) return new Date();
  const [y, m = 1, d = 1] = iso.split("-").map(Number);
  if (!Number.isFinite(y)) return new Date();
  const date = new Date(y, (m||1)-1, d||1);
  date.setHours(0,0,0,0);
  return date;
};
const toHuman = (iso) => {
  const d = fromISO(iso);
  return d.toLocaleDateString("es-ES", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
};

/* ========= Estado & almacenamiento ========= */
const STORAGE_KEY = "workouts.v1";
let state = {
  selectedDate: fmt(new Date()),
  workouts: {} // { "YYYY-MM-DD": [exercise, ...] }
};

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

function normalizeWorkouts(rawWorkouts) {
  if (!isPlainObject(rawWorkouts)) return {};

  const normalized = {};
  for (const [day, value] of Object.entries(rawWorkouts)) {
    const dayISO = fmt(fromISO(day));
    let items = [];

    if (Array.isArray(value)) {
      items = value;
    } else if (isPlainObject(value)) {
      items = Object.values(value);
    }

    const clean = items
      .filter(isPlainObject)
      .map((exercise) => ({
        ...exercise,
        done: Array.isArray(exercise.done) ? exercise.done : [],
        completed: !!exercise.completed
      }));

    if (!normalized[dayISO]) {
      normalized[dayISO] = [];
    }

    if (clean.length) {
      normalized[dayISO].push(...clean);
    } else if (Array.isArray(value) && value.length === 0 && !normalized[dayISO].length) {
      normalized[dayISO] = [];
    }
  }

  return normalized;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
    }
  } catch(e){ console.warn("Error loading storage", e); }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ========= DOM ========= */
const selectedDateInput = document.getElementById("selectedDate");
const dayTitle = document.getElementById("dayTitle");
const humanDateSpan = dayTitle.querySelector('[data-bind="humanDate"]');
const exerciseList = document.getElementById("exerciseList");
const emptyDayHint = document.getElementById("emptyDayHint");

const tabs = document.querySelectorAll(".tab");
const tabPanels = {
  hoy: document.getElementById("tab-hoy"),
  nuevo: document.getElementById("tab-nuevo"),
  seguimiento: document.getElementById("tab-seguimiento")
};

const prevDayBtn = document.getElementById("prevDayBtn");
const nextDayBtn = document.getElementById("nextDayBtn");

/* Añadir */
const addForm = document.getElementById("addForm");
const formDate = document.getElementById("formDate");
const formName = document.getElementById("formName");
const formSets = document.getElementById("formSets");
const goalReps = document.getElementById("goalReps");
const goalSecs = document.getElementById("goalSecs");
const goalEmom = document.getElementById("goalEmom");
const rowReps = document.getElementById("rowReps");
const rowSeconds = document.getElementById("rowSeconds");
const rowEmom = document.getElementById("rowEmom");
const formReps = document.getElementById("formReps");
const formFailure = document.getElementById("formFailure");
const formSeconds = document.getElementById("formSeconds");
const formSecondsFailure = document.getElementById("formSecondsFailure");
const formEmomMinutes = document.getElementById("formEmomMinutes");
const formEmomReps = document.getElementById("formEmomReps");
const formWeight = document.getElementById("formWeight");

/* Copiar día */
const copyDayToggleBtn = document.getElementById("copyDayToggleBtn");
const copyDayBox = document.getElementById("copyDayBox");
const copyTargetDate = document.getElementById("copyTargetDate");
const copyDayBtn = document.getElementById("copyDayBtn");
const cancelCopyBtn = document.getElementById("cancelCopyBtn");

/* Mini calendario */
const mcPrev = document.getElementById("mcPrev");
const mcNext = document.getElementById("mcNext");
const mcLabel = document.getElementById("mcLabel");
const mcGrid = document.getElementById("mcGrid");
let mcRefDate = new Date(); // referencia del mes mostrado
const DOW = ["L","M","X","J","V","S","D"];

/* Seguimiento */
const analyticsEmpty = document.getElementById("analyticsEmpty");
const analyticsContent = document.getElementById("analyticsContent");
const analyticsSummary = document.getElementById("analyticsSummary");
const analyticsCharts = document.getElementById("analyticsCharts");
const analyticsExerciseTable = document.getElementById("analyticsExerciseTable");

/* ========= Inicialización ========= */
load();
const originalWorkoutsJSON = JSON.stringify(state.workouts || {});
const normalizedWorkouts = normalizeWorkouts(state.workouts);
const normalizedWorkoutsJSON = JSON.stringify(normalizedWorkouts);
state.workouts = normalizedWorkouts;

const initialDate = fromISO(state.selectedDate);
const normalizedSelectedDate = fmt(initialDate);
const selectedDateChanged = state.selectedDate !== normalizedSelectedDate;
state.selectedDate = normalizedSelectedDate;
mcRefDate = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
selectedDateInput.value = state.selectedDate;
formDate.value = state.selectedDate;
renderAll();
if (originalWorkoutsJSON !== normalizedWorkoutsJSON || selectedDateChanged) {
  save();
}

tabs.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelector(".tab.active")?.classList.remove("active");
    document.querySelector('.tab[aria-selected="true"]')?.setAttribute("aria-selected", "false");
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    const tab = btn.dataset.tab;
    for (const key in tabPanels) {
      tabPanels[key].classList.toggle("hidden", key !== tab);
    }
  });
});

prevDayBtn.addEventListener("click", ()=> shiftSelectedDay(-1));
nextDayBtn.addEventListener("click", ()=> shiftSelectedDay(1));
selectedDateInput.addEventListener("change", (e)=>{
  const picked = fromISO(e.target.value || fmt(new Date()));
  state.selectedDate = fmt(picked);
  selectedDateInput.value = state.selectedDate;
  formDate.value = state.selectedDate;
  mcRefDate = new Date(picked.getFullYear(), picked.getMonth(), 1);
  save(); renderAll();
  highlightMiniCalSelected();
});

/* ==== Lógica Toggle de tipo de objetivo ==== */
function updateGoalRows() {
  rowReps.classList.toggle("hidden", !goalReps.checked);
  rowSeconds.classList.toggle("hidden", !goalSecs.checked);
  rowEmom.classList.toggle("hidden", !goalEmom.checked);
}
[goalReps, goalSecs, goalEmom].forEach(el=>el.addEventListener("change", updateGoalRows));
updateGoalRows();

/* ==== Añadir ejercicio ==== */
addForm.addEventListener("submit", (e)=>{
  e.preventDefault();
  const day = formDate.value || state.selectedDate;
  const normalizedDay = fmt(fromISO(day));

  const ex = {
    id: randomUUID(),
    name: (formName.value || "").trim(),
    sets: Math.max(1, Number(formSets.value||1)),
    goal: null,          // "reps" | "seconds" | "emom"
    reps: null,          // si goal="reps"
    failure: false,      // si goal="reps" o goal="seconds"
    seconds: null,       // si goal="seconds"
    emomMinutes: null,   // si goal="emom"
    emomReps: null,      // si goal="emom"
    weightKg: formWeight.value ? Number(formWeight.value) : null,
    done: [],            // array con reps logradas por serie (o segundos)
    completed: false
  };

  if (!ex.name) { alert("Pon un nombre al ejercicio."); return; }

  if (goalReps.checked) {
    ex.goal = "reps";
    ex.reps = formReps.value ? Number(formReps.value) : null;
    ex.failure = !!formFailure.checked;
  } else if (goalSecs.checked) {
    ex.goal = "seconds";
    ex.seconds = Number(formSeconds.value||0);
    ex.failure = !!formSecondsFailure.checked;
  } else {
    ex.goal = "emom";
    ex.emomMinutes = Number(formEmomMinutes.value||0);
    ex.emomReps = Number(formEmomReps.value||0);
    ex.failure = false;
  }

  if (!state.workouts[normalizedDay]) state.workouts[normalizedDay] = [];
  if (ex.failure) {
    ex.done = Array.from({length: ex.sets}, ()=>null);
  } else {
    ex.done = [];
  }
  state.workouts[normalizedDay].push(ex);
  save();

  // Ajustar UI
  formName.value = "";
  formFailure.checked = false;
  formSecondsFailure.checked = false;
  renderDay(normalizedDay);
  switchToTab("hoy");
  state.selectedDate = normalizedDay;
  selectedDateInput.value = state.selectedDate;
  formDate.value = state.selectedDate;
  const selected = fromISO(state.selectedDate);
  mcRefDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
  save();
  renderMiniCalendar();
  renderAnalytics();
});

/* ========= Render ========= */
function renderAll(){
  renderDay(state.selectedDate);
  renderMiniCalendar();
  renderAnalytics();
}

function renderDay(dayISO){
  const source = Array.isArray(state.workouts?.[dayISO]) ? state.workouts[dayISO] : [];
  const list = source.filter(isPlainObject);
  humanDateSpan.textContent = toHuman(dayISO);
  exerciseList.innerHTML = "";
  emptyDayHint.style.display = list.length ? "none" : "block";

  list.forEach(ex=>{
    const li = document.createElement("li");
    li.className = "exercise";
    if (ex.completed) li.classList.add("completed");
    li.dataset.id = ex.id;

    const title = document.createElement("div");
    title.className = "title";
    const h3 = document.createElement("h3");
    h3.textContent = ex.name;
    h3.style.margin = "0";
    const controls = document.createElement("div");
    controls.className = "controls";
    const doneBtn = button(
      ex.completed ? "Marcar como pendiente" : "Marcar como hecho",
      ex.completed ? "small ghost" : "small success"
    );
    const editBtn = button("Editar", "small ghost");
    const delBtn = button("Eliminar", "small danger");
    doneBtn.addEventListener("click", ()=>{
      ex.completed = !ex.completed;
      save();
      renderDay(dayISO);
      renderMiniCalendar();
      renderAnalytics();
    });
    controls.append(doneBtn, editBtn, delBtn);
    title.append(h3, controls);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = metaText(ex);

    let setsBox = null;
    if (ex.failure) {
      const doneArray = Array.isArray(ex.done) ? ex.done : [];
      const doneValues = Array.from({length: ex.sets}, (_,i)=> doneArray[i] ?? null);
      setsBox = document.createElement("div");
      setsBox.className = "sets-grid";
      for (let i=0;i<ex.sets;i++){
        const wrap = document.createElement("label");
        wrap.className = "field";
        const span = document.createElement("span");
        span.textContent = `Serie ${i+1}`;
        const input = document.createElement("input");
        input.type = "number";
        input.placeholder = ex.goal==="seconds" ? "seg" : "reps";
        input.value = doneValues[i] ?? "";
        input.addEventListener("change", ()=>{
          const v = input.value? Number(input.value) : null;
          const doneList = Array.isArray(ex.done) ? ex.done : [];
          doneList[i] = v;
          ex.done = doneList;
          save();
          renderAnalytics();
        });
        wrap.append(span, input);
        setsBox.append(wrap);
      }
    }

    
editBtn.addEventListener("click", () => {
  // Si ya existe un editBox visible, lo ocultamos
  const existing = li.querySelector(".edit-box");
  if (existing && !existing.classList.contains("hidden")) {
    existing.classList.add("hidden");
    return;
  }

  // Si no existe, lo creamos dinámicamente
  let editBox = li.querySelector(".edit-box");
  if (!editBox) {
    editBox = document.createElement("div");
    editBox.className = "edit-box";
    editBox.appendChild(buildEditForm(ex));
    li.append(editBox);
  }

  editBox.classList.toggle("hidden");
});

delBtn.addEventListener("click", () => {
  if (!confirm("¿Eliminar este ejercicio?")) return;
  removeExercise(dayISO, ex.id);
});

li.append(title, meta);
if (setsBox) li.append(setsBox);
exerciseList.append(li);

  });
}

function renderAnalytics(){
  if (!analyticsSummary) return;
  const entries = Object.entries(state.workouts || {});
  const daysWithExercises = entries
    .map(([day, exercises]) => ({
      day,
      exercises: Array.isArray(exercises) ? exercises.filter(isPlainObject) : []
    }))
    .filter((item) => item.exercises.length);

  if (!daysWithExercises.length){
    analyticsEmpty?.classList.remove("hidden");
    analyticsContent?.classList.add("hidden");
    return;
  }

  analyticsEmpty?.classList.add("hidden");
  analyticsContent?.classList.remove("hidden");

  daysWithExercises.sort((a,b)=> a.day.localeCompare(b.day));

  const totals = {
    days: daysWithExercises.length,
    exercises: 0,
    sets: 0,
    reps: 0,
    seconds: 0,
    weightVolume: 0
  };

  const dailyStats = [];
  const perExercise = new Map();

  daysWithExercises.forEach(({day, exercises})=>{
    const dayStats = {date: day, sets:0, reps:0, seconds:0, weightVolume:0};
    totals.exercises += exercises.length;

    exercises.forEach((ex)=>{
      const sets = Math.max(1, Number(ex.sets||0));
      totals.sets += sets;
      dayStats.sets += sets;

      const actual = actualWork(ex);
      if (actual.reps){
        totals.reps += actual.reps;
        dayStats.reps += actual.reps;
      }
      if (actual.seconds){
        totals.seconds += actual.seconds;
        dayStats.seconds += actual.seconds;
      }

      const weightContribution = Number.isFinite(ex.weightKg)
        ? (actual.reps || actual.seconds) * Number(ex.weightKg)
        : 0;
      if (weightContribution){
        totals.weightVolume += weightContribution;
        dayStats.weightVolume += weightContribution;
      }

      const name = ex.name || "Ejercicio";
      const info = perExercise.get(name) || {
        name,
        sessions: 0,
        totalSets: 0,
        totalReps: 0,
        totalSeconds: 0,
        bestWeight: null,
        lastDate: null
      };

      info.sessions += 1;
      info.totalSets += sets;
      info.totalReps += actual.reps;
      info.totalSeconds += actual.seconds;
      if (Number.isFinite(ex.weightKg)){
        info.bestWeight = info.bestWeight!=null ? Math.max(info.bestWeight, Number(ex.weightKg)) : Number(ex.weightKg);
      }
      if (!info.lastDate || day > info.lastDate){
        info.lastDate = day;
      }
      perExercise.set(name, info);
    });

    dailyStats.push(dayStats);
  });

  const summaryItems = [
    {label:"Días registrados", value: totals.days},
    {label:"Ejercicios guardados", value: totals.exercises},
    {label:"Series totales", value: totals.sets},
    {label:"Promedio series/día", value: totals.days ? totals.sets / totals.days : 0, decimals:1},
    {label:"Reps totales", value: totals.reps},
    {label:"Segundos totales", value: totals.seconds, formatter: formatDuration},
    {label:"Volumen con lastre", value: totals.weightVolume, suffix:"kg·reps"}
  ];

  analyticsSummary.innerHTML = summaryItems
    .map((item)=>{
      const display = item.formatter
        ? item.formatter(item.value)
        : formatNumber(item.value, item.decimals || 0);
      const suffix = item.suffix ? `<div class="stat-sub">${item.suffix}</div>` : "";
      return `<article class="stat-card"><span>${item.label}</span><div class="stat-value">${display}</div>${suffix}</article>`;
    })
    .join("");

  const metrics = [
    {key:"sets", label:"Series por día"},
    {key:"reps", label:"Reps por día"},
    {key:"seconds", label:"Segundos por día", formatter: formatDuration}
  ];
  if (totals.weightVolume > 0){
    metrics.push({key:"weightVolume", label:"Volumen con lastre", suffix:"kg·reps"});
  }

  const recentStats = dailyStats.slice(-14);
  analyticsCharts.innerHTML = metrics.map((metric)=>{
    if (!recentStats.length){
      return `<div class="chart-item"><h4>${metric.label}</h4><div class="chart-placeholder">Sin datos</div></div>`;
    }
    const values = recentStats.map((s)=>({date:s.date, value: s[metric.key] || 0}));
    const chart = sparkline(values);
    const last = values[values.length-1];
    const max = values.reduce((acc, curr)=> curr.value > acc.value ? curr : acc, values[0]);
    const lastLabel = metric.formatter ? metric.formatter(last.value) : formatNumber(last.value, metric.decimals || 0);
    const maxLabel = metric.formatter ? metric.formatter(max.value) : formatNumber(max.value, metric.decimals || 0);
    const rangeLabel = values.length > 1
      ? `${formatShortDate(values[0].date)} → ${formatShortDate(values[values.length-1].date)}`
      : formatShortDate(values[0].date);
    const suffix = metric.suffix ? ` ${metric.suffix}` : "";
    return `<div class="chart-item"><h4>${metric.label}</h4>${chart}<div class="chart-meta"><span>Último: ${lastLabel}${suffix}</span><span>Máx: ${maxLabel}${suffix}</span></div><div class="chart-meta"><span>${rangeLabel}</span><span>${values.length} día(s)</span></div></div>`;
  }).join("");

  const exerciseRows = Array.from(perExercise.values())
    .sort((a,b)=>{
      if (a.lastDate !== b.lastDate){
        return (b.lastDate||"").localeCompare(a.lastDate||"");
      }
      if (a.sessions !== b.sessions){
        return b.sessions - a.sessions;
      }
      return a.name.localeCompare(b.name);
    })
    .map((info)=>{
      const bestWeight = info.bestWeight!=null ? `${formatNumber(info.bestWeight, info.bestWeight % 1 ? 1 : 0)} kg` : "—";
      const lastDate = info.lastDate ? formatFullDate(info.lastDate) : "—";
      return `<tr>
        <td>${info.name}</td>
        <td data-align="right">${formatNumber(info.sessions)}</td>
        <td data-align="right">${formatNumber(info.totalSets)}</td>
        <td data-align="right">${formatNumber(info.totalReps)}</td>
        <td data-align="right">${info.totalSeconds ? formatDuration(info.totalSeconds) : "0 s"}</td>
        <td data-align="right">${bestWeight}</td>
        <td>${lastDate}</td>
      </tr>`;
    })
    .join("");

  analyticsExerciseTable.innerHTML = exerciseRows;
}

function actualWork(ex){
  const sets = Math.max(1, Number(ex.sets||0));
  const doneArray = Array.isArray(ex.done) ? ex.done : [];
  if (ex.goal === "reps"){
    const done = doneArray.filter((v)=> Number.isFinite(v));
    const base = Number(ex.reps)||0;
    const total = done.length ? sum(done) : sets * base;
    return {reps: total, seconds: 0};
  }
  if (ex.goal === "seconds"){
    const done = doneArray.filter((v)=> Number.isFinite(v));
    const base = Number(ex.seconds)||0;
    const total = done.length ? sum(done) : sets * base;
    return {reps: 0, seconds: total};
  }
  if (ex.goal === "emom"){
    const minutes = Number(ex.emomMinutes)||0;
    const reps = Number(ex.emomReps)||0;
    return {reps: minutes * reps, seconds: 0};
  }
  return {reps:0, seconds:0};
}

function sum(values){
  return values.reduce((acc, val)=> acc + (Number.isFinite(val) ? Number(val) : 0), 0);
}

function formatNumber(value, decimals=0){
  const options = {minimumFractionDigits: decimals, maximumFractionDigits: decimals};
  const safeValue = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("es-ES", options).format(safeValue);
}

function formatDuration(totalSeconds){
  const seconds = Math.max(0, Math.round(Number(totalSeconds)||0));
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes && secs){
    return `${minutes} min ${secs} s`;
  }
  if (minutes){
    return `${minutes} min`;
  }
  return `${secs} s`;
}

function formatShortDate(iso){
  const d = fromISO(iso);
  return d.toLocaleDateString("es-ES", {day:"2-digit", month:"short"});
}

function formatFullDate(iso){
  const d = fromISO(iso);
  return d.toLocaleDateString("es-ES", {day:"2-digit", month:"short", year:"numeric"});
}

function sparkline(points){
  if (!points.length){
    return `<div class="chart-placeholder">Sin datos</div>`;
  }
  const width = 200;
  const height = 70;
  const values = points.map((p)=> Number(p.value)||0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;
  const step = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points.map((p, idx)=>{
    const value = Number(p.value)||0;
    const ratio = range === 0 ? 0.5 : (value - min) / range;
    const x = points.length === 1 ? width / 2 : idx * step;
    const y = height - ratio * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const polygonPoints = [`0,${height}`].concat(coords).concat([`${width},${height}`]).join(" ");
  const lastPair = coords[coords.length-1].split(",").map(Number);

  return `<div class="sparkline"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-hidden="true">
    <polygon class="bg" points="${polygonPoints}"></polygon>
    <polyline class="line" points="${coords.join(" ")}"></polyline>
    <circle class="point" cx="${lastPair[0]}" cy="${lastPair[1]}" r="3"></circle>
  </svg></div>`;
}

function metaText(ex){
  const parts = [`<span><strong>Series:</strong> ${ex.sets}</span>`];

  parts.push(`<span><strong>Estado:</strong> ${ex.completed ? "Completado" : "Pendiente"}</span>`);

  if (ex.goal==="reps") {
    const repsLabel = ex.reps && ex.reps > 0 ? ex.reps : "—";
    parts.push(`<span><strong>Repeticiones:</strong> ${repsLabel}</span>`);
    if (ex.failure) parts.push(`<span>Al fallo</span>`);
  } else if (ex.goal==="seconds") {
    const secsLabel = ex.seconds && ex.seconds > 0 ? ex.seconds : "—";
    parts.push(`<span><strong>Segundos:</strong> ${secsLabel}</span>`);
    if (ex.failure) parts.push(`<span>Al fallo</span>`);
  } else if (ex.goal==="emom") {
    parts.push(`<span><strong>EMOM:</strong> ${ex.emomMinutes}' · ${ex.emomReps} reps/min</span>`);
  }

  if (ex.weightKg!=null) parts.push(`<span><strong>Lastre:</strong> ${ex.weightKg} kg</span>`);
  return parts.join(" · ");
}

function button(text, cls=""){
  const b = document.createElement("button");
  b.textContent = text;
  if (cls) b.className = cls;
  return b;
}

function buildEditForm(ex){
  const box = document.createElement("div");
  box.className = "grid";

  // Nombre
  const fName = field("Nombre", "text", ex.name);
  // Series
  const fSets = field("Series", "number", ex.sets, {min:1});

  // Tipo
  const typeWrap = document.createElement("div");
  typeWrap.className = "fieldset";

  const legend = document.createElement("span");
  legend.className = "legend";
  legend.textContent = "Tipo de objetivo";
  typeWrap.appendChild(legend);

  const rReps = radioRow("Repeticiones", "goalEdit-"+ex.id, ex.goal==="reps");
  const rSecs = radioRow("Isométrico (segundos)", "goalEdit-"+ex.id, ex.goal==="seconds");
  const rEmom = radioRow("EMOM", "goalEdit-"+ex.id, ex.goal==="emom");

  const rowReps = document.createElement("div"); rowReps.className = "row indent";
  const repsField = fieldInline("Reps", "number", ex.reps ?? "", {min:1});
  const failRow = document.createElement("label"); failRow.className="row inline";
  const failChk = document.createElement("input"); failChk.type="checkbox"; failChk.checked = !!ex.failure && ex.goal==="reps";
  const failLbl = document.createElement("span"); failLbl.textContent="Al fallo";
  failRow.append(failChk, failLbl);
  rowReps.append(repsField.wrap, failRow);

  const rowSecs = document.createElement("div"); rowSecs.className="row indent hidden";
  const secsField = fieldInline("Segundos", "number", ex.seconds ?? "", {min:1});
  const failSecsRow = document.createElement("label"); failSecsRow.className="row inline";
  const failSecsChk = document.createElement("input"); failSecsChk.type="checkbox"; failSecsChk.checked = !!ex.failure && ex.goal==="seconds";
  const failSecsLbl = document.createElement("span"); failSecsLbl.textContent="Al fallo";
  failSecsRow.append(failSecsChk, failSecsLbl);
  rowSecs.append(secsField.wrap, failSecsRow);

  const rowEmom = document.createElement("div"); rowEmom.className="row indent hidden";
  const mField = fieldInline("Minutos", "number", ex.emomMinutes ?? "", {min:1});
  const rField = fieldInline("Reps/min", "number", ex.emomReps ?? "", {min:1});
  rowEmom.append(mField.wrap, rField.wrap);

  function toggleRows(){
    rowReps.classList.toggle("hidden", !rReps.input.checked);
    rowSecs.classList.toggle("hidden", !rSecs.input.checked);
    rowEmom.classList.toggle("hidden", !rEmom.input.checked);
  }
  [rReps.input, rSecs.input, rEmom.input].forEach(i=>i.addEventListener("change", toggleRows));
  toggleRows();

  typeWrap.append(rReps.row, rowReps, rSecs.row, rowSecs, rEmom.row, rowEmom);

  // Lastre
  const wField = field("Lastre (kg)", "number", ex.weightKg ?? "", {step:0.5});

  const actions = document.createElement("div");
  actions.className = "actions";
  const saveBtn = button("Guardar", "primary small");
  const cancelBtn = button("Cerrar", "ghost small");
  const deleteBtn = button("Eliminar", "danger small");
  actions.append(saveBtn, cancelBtn, deleteBtn);

  box.append(fName.wrap, fSets.wrap, typeWrap, wField.wrap, actions);

  saveBtn.addEventListener("click", ()=>{
    ex.name = fName.input.value.trim() || ex.name;
    ex.sets = Math.max(1, Number(fSets.input.value||1));

    if (rReps.input.checked){
      ex.goal="reps";
      ex.reps = repsField.input.value ? Number(repsField.input.value) : null;
      ex.failure = !!failChk.checked;
      ex.seconds = null; ex.emomMinutes=null; ex.emomReps=null;
    } else if (rSecs.input.checked){
      ex.goal="seconds";
      ex.seconds = Number(secsField.input.value||0);
      ex.reps = null; ex.failure=!!failSecsChk.checked; ex.emomMinutes=null; ex.emomReps=null;
    } else {
      ex.goal="emom";
      ex.emomMinutes = Number(mField.input.value||0);
      ex.emomReps = Number(rField.input.value||0);
      ex.reps = null; ex.failure=false; ex.seconds=null;
    }

    // Ajustar tamaño del array done
    if (ex.failure){
      const existingDone = Array.isArray(ex.done) ? ex.done.slice(0, ex.sets) : [];
      while (existingDone.length < ex.sets) existingDone.push(null);
      ex.done = existingDone;
    } else {
      ex.done = [];
    }

    const editWrapper = box.parentElement;
    editWrapper?.classList.add("hidden");
    save();
    renderDay(state.selectedDate);
    renderAnalytics();
  });
  cancelBtn.addEventListener("click", ()=>{
    box.parentElement?.classList.add("hidden");
  });
  deleteBtn.addEventListener("click", ()=>{
    if (!confirm("¿Eliminar este ejercicio?")) return;
    removeExercise(state.selectedDate, ex.id);
  });

  return box;
}

function field(label, type, value, attrs={}){
  const wrap = document.createElement("label"); wrap.className="field";
  const span = document.createElement("span"); span.textContent = label;
  const input = document.createElement("input");
  input.type = type; input.value = value ?? "";
  Object.entries(attrs).forEach(([k,v])=> input.setAttribute(k,v));
  wrap.append(span, input);
  return {wrap, input};
}
function fieldInline(label, type, value, attrs={}){
  const wrap = document.createElement("label"); wrap.className="field inline";
  const span = document.createElement("span"); span.textContent = label;
  const input = document.createElement("input");
  input.type = type; input.value = value ?? "";
  Object.entries(attrs).forEach(([k,v])=> input.setAttribute(k,v));
  wrap.append(span, input);
  return {wrap, input};
}
function radioRow(text, name, checked=false){
  const row = document.createElement("label"); row.className="row";
  const input = document.createElement("input");
  input.type="radio"; input.name=name; input.checked = checked;
  const span = document.createElement("span"); span.textContent = text;
  row.append(input, span);
  return {row, input};
}

function removeExercise(dayISO, id){
  const list = Array.isArray(state.workouts?.[dayISO]) ? state.workouts[dayISO] : [];
  const idx = list.findIndex(x=>x.id===id);
  if (idx>=0){
    list.splice(idx,1);
    state.workouts[dayISO] = list;
    save();
    renderDay(dayISO);
    renderMiniCalendar();
    renderAnalytics();
  }
}

/* ========= Copiar día ========= */
copyDayToggleBtn.addEventListener("click", ()=>{
  copyDayBox.classList.toggle("hidden");
  copyTargetDate.value = state.selectedDate;
});
cancelCopyBtn.addEventListener("click", ()=>{
  copyDayBox.classList.add("hidden");
});
copyDayBtn.addEventListener("click", ()=>{
  const src = state.selectedDate;
  const dst = copyTargetDate.value;
  if (!dst){ alert("Selecciona una fecha destino."); return; }
  const items = (Array.isArray(state.workouts?.[src]) ? state.workouts[src] : [])
    .filter(isPlainObject)
    .map(x=> ({
    ...x,
    id: randomUUID(),
    done: x.failure ? Array.from({length: x.sets}, ()=>null) : [],
    completed: false
  }));
  const targetList = Array.isArray(state.workouts?.[dst]) ? state.workouts[dst] : [];
  state.workouts[dst] = targetList.concat(items);
  save();
  alert("Día copiado.");
  copyDayBox.classList.add("hidden");
  renderMiniCalendar();
  renderAnalytics();
});

/* ========= Cambiar de día (prev/next) ========= */
function shiftSelectedDay(delta){
  const d = fromISO(state.selectedDate);
  d.setDate(d.getDate()+delta);
  state.selectedDate = fmt(d);
  selectedDateInput.value = state.selectedDate;
  formDate.value = state.selectedDate;
  mcRefDate = new Date(d.getFullYear(), d.getMonth(), 1);
  save(); renderAll();
  highlightMiniCalSelected();
}

/* ========= Tabs helper ========= */
function switchToTab(name){
  document.querySelector(".tab.active")?.classList.remove("active");
  document.querySelector(`.tab[data-tab="${name}"]`)?.classList.add("active");
  document.querySelectorAll(".tab").forEach((tab)=>{
    tab.setAttribute("aria-selected", tab.dataset.tab === name ? "true" : "false");
  });
  for (const key in tabPanels) {
    tabPanels[key].classList.toggle("hidden", key !== name);
  }
}

/* ========= Mini Calendario ========= */
function renderMiniCalendar(){
  mcLabel.textContent = mcRefDate.toLocaleDateString("es-ES", {month:"long", year:"numeric"});
  mcGrid.innerHTML = "";

  // Cabecera días
  DOW.forEach(d=>{
    const el = document.createElement("div");
    el.className = "dow";
    el.textContent = d;
    mcGrid.append(el);
  });

  const year = mcRefDate.getFullYear();
  const month = mcRefDate.getMonth(); // 0-11
  const first = new Date(year, month, 1);
  const startDow = (first.getDay()+6)%7; // convertir a L=0 … D=6
  const daysInMonth = new Date(year, month+1, 0).getDate();

  // Huecos previos
  for (let i=0;i<startDow;i++){
    const spacer = document.createElement("div");
    mcGrid.append(spacer);
  }

  for (let d=1; d<=daysInMonth; d++){
    const btn = document.createElement("button");
    btn.className = "day";
    const dayISO = fmt(new Date(year, month, d));
    btn.textContent = d;

    if (dayISO === fmt(new Date())) btn.classList.add("today");
    if (dayISO === state.selectedDate) btn.classList.add("selected");
    const hasExercises = Array.isArray(state.workouts?.[dayISO]) ? state.workouts[dayISO].length > 0 : false;
    if (hasExercises) btn.classList.add("has");

    btn.addEventListener("click", ()=>{
      state.selectedDate = dayISO;
      selectedDateInput.value = state.selectedDate;
      formDate.value = state.selectedDate;
      mcRefDate = new Date(year, month, 1);
      save(); renderAll();
      highlightMiniCalSelected();
      switchToTab("hoy");
    });

    mcGrid.append(btn);
  }
}

function highlightMiniCalSelected(){
  mcGrid.querySelectorAll("button.day").forEach(b=>{
    b.classList.toggle("selected", dateFromCell(b)===state.selectedDate);
  });
  function dateFromCell(btn){
    const label = Number(btn.textContent);
    const y = mcRefDate.getFullYear();
    const m = mcRefDate.getMonth();
    return fmt(new Date(y, m, label));
  }
}

mcPrev.addEventListener("click", ()=>{
  mcRefDate.setMonth(mcRefDate.getMonth()-1);
  renderMiniCalendar();
});
mcNext.addEventListener("click", ()=>{
  mcRefDate.setMonth(mcRefDate.getMonth()+1);
  renderMiniCalendar();
});

/* ========= PWA ========= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js')
      .catch((err) => console.warn('Error registrando el service worker', err));
  });
}
