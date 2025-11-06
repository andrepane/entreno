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
const CATEGORY_KEYS = ["calistenia", "musculacion", "cardio", "skill"];
const CATEGORY_LABELS = {
  calistenia: "Calistenia",
  musculacion: "Musculación",
  cardio: "Cardio",
  skill: "Skill"
};
const PHASE_KEYS = ["base", "intensificacion", "descarga"];
const PHASE_LABELS = {
  base: "Base",
  intensificacion: "Intensificación",
  descarga: "Descarga",
};

let state = {
  selectedDate: fmt(new Date()),
  workouts: {}, // { "YYYY-MM-DD": [exercise, ...] }
  dayMeta: {},
  futureExercises: [],
};

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

function normalizeCategory(value){
  const key = (value || "").toString().toLowerCase();
  return CATEGORY_KEYS.includes(key) ? key : CATEGORY_KEYS[0];
}

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
      .map((exercise) => {
        const cardioMinutesRaw = Number(exercise.cardioMinutes);
        const perceivedRaw = Number(exercise.perceivedEffort);
        return {
          ...exercise,
          category: normalizeCategory(exercise.category),
          done: Array.isArray(exercise.done) ? exercise.done : [],
          completed: !!exercise.completed,
          note: typeof exercise.note === "string" ? exercise.note : "",
          cardioMinutes: Number.isFinite(cardioMinutesRaw) ? cardioMinutesRaw : null,
          perceivedEffort: Number.isFinite(perceivedRaw) && perceivedRaw >= 1 && perceivedRaw <= 10 ? Math.round(perceivedRaw) : null,
        };
      });

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

function defaultDayMeta(){
  return {
    sessionRPE: null,
    habits: { sleep: false, mobility: false, handstand: false },
    phase: "",
  };
}

function normalizeDayMeta(rawMeta){
  if (!isPlainObject(rawMeta)) return {};
  const normalized = {};
  for (const [day, value] of Object.entries(rawMeta)){
    const dayISO = fmt(fromISO(day));
    const base = defaultDayMeta();
    const src = isPlainObject(value) ? value : {};
    const rpe = Number(src.sessionRPE);
    base.sessionRPE = Number.isFinite(rpe) && rpe >= 1 && rpe <= 10 ? Math.round(rpe) : null;
    const habits = isPlainObject(src.habits) ? src.habits : {};
    base.habits = {
      sleep: !!habits.sleep,
      mobility: !!habits.mobility,
      handstand: !!habits.handstand,
    };
    const phase = typeof src.phase === "string" ? src.phase.trim().toLowerCase() : "";
    base.phase = PHASE_KEYS.includes(phase) ? phase : "";
    normalized[dayISO] = base;
  }
  return normalized;
}

function normalizeFutureExercises(rawList){
  if (!Array.isArray(rawList)) return [];
  const result = [];
  rawList.forEach((entry)=>{
    if (typeof entry === "string"){
      const name = entry.trim();
      if (name) {
        result.push({
          id: randomUUID(),
          name,
          createdAt: new Date().toISOString(),
        });
      }
      return;
    }
    if (!isPlainObject(entry)) return;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) return;
    const createdAt = typeof entry.createdAt === "string" && entry.createdAt ? entry.createdAt : new Date().toISOString();
    const id = typeof entry.id === "string" && entry.id ? entry.id : randomUUID();
    result.push({ id, name, createdAt });
  });
  return result;
}

function ensureDayMeta(dayISO){
  const key = fmt(fromISO(dayISO));
  if (!state.dayMeta[key]){
    state.dayMeta[key] = defaultDayMeta();
  }
  return state.dayMeta[key];
}

function setDayMeta(dayISO, patch = {}){
  const key = fmt(fromISO(dayISO));
  const existing = state.dayMeta[key];
  const meta = ensureDayMeta(dayISO);
  let changed = !existing;

  if (patch.sessionRPE !== undefined){
    const next = Number(patch.sessionRPE);
    const normalized = Number.isFinite(next) && next >= 1 && next <= 10 ? Math.round(next) : null;
    if (meta.sessionRPE !== normalized){
      meta.sessionRPE = normalized;
      changed = true;
    }
  }
  if (patch.habits){
    const habits = meta.habits;
    if (patch.habits.sleep !== undefined){
      const next = !!patch.habits.sleep;
      if (habits.sleep !== next){
        habits.sleep = next;
        changed = true;
      }
    }
    if (patch.habits.mobility !== undefined){
      const next = !!patch.habits.mobility;
      if (habits.mobility !== next){
        habits.mobility = next;
        changed = true;
      }
    }
    if (patch.habits.handstand !== undefined){
      const next = !!patch.habits.handstand;
      if (habits.handstand !== next){
        habits.handstand = next;
        changed = true;
      }
    }
  }
  if (patch.phase !== undefined){
    const nextPhase = typeof patch.phase === "string" ? patch.phase.trim().toLowerCase() : "";
    const normalized = PHASE_KEYS.includes(nextPhase) ? nextPhase : "";
    if (meta.phase !== normalized){
      meta.phase = normalized;
      changed = true;
    }
  }

  state.dayMeta[key] = meta;

  if (changed){
    save();
    if (seguimientoModule?.refresh) {
      seguimientoModule.refresh();
    }
  }

  return meta;
}

function getDayMeta(dayISO){
  const meta = ensureDayMeta(dayISO);
  return {
    sessionRPE: meta.sessionRPE,
    habits: { ...meta.habits },
    phase: meta.phase,
  };
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
const todayPanel = document.getElementById("todayPanel");
const todayDurationEl = document.getElementById("todayDuration");
const todayVolumeHint = document.getElementById("todayVolumeHint");
const todayFocusEl = document.getElementById("todayFocus");
const todayFocusDetail = document.getElementById("todayFocusDetail");
const todayMobilityText = document.getElementById("todayMobility");
const todayMobilityToggle = document.getElementById("todayMobilityToggle");
const todayRPEInput = document.getElementById("todayRPE");
const todayRPEValue = document.getElementById("todayRPEValue");
const todayRPEBadge = document.getElementById("todayRPEBadge");
const todayRPEClear = document.getElementById("todayRPEClear");
const todayBadges = document.getElementById("todayBadges");
const todayHabitInputs = todayPanel ? todayPanel.querySelectorAll('[data-habit]') : [];
const todayPhaseSelect = document.getElementById("todayPhase");
let suppressDayMetaEvents = false;

let activeDrag = null;

const tabs = document.querySelectorAll(".tab");
const tabPanels = {
  entreno: document.getElementById("tab-entreno"),
  nuevo: document.getElementById("tab-nuevo"),
  seguimiento: document.getElementById("tab-seguimiento")
};

const prevDayBtn = document.getElementById("prevDayBtn");
const nextDayBtn = document.getElementById("nextDayBtn");

/* Añadir */
const addForm = document.getElementById("addForm");
const formDate = document.getElementById("formDate");
const formName = document.getElementById("formName");
const formCategory = document.getElementById("formCategory");
const formSets = document.getElementById("formSets");
const goalReps = document.getElementById("goalReps");
const goalSecs = document.getElementById("goalSecs");
const goalEmom = document.getElementById("goalEmom");
const goalCardio = document.getElementById("goalCardio");
const rowReps = document.getElementById("rowReps");
const rowSeconds = document.getElementById("rowSeconds");
const rowEmom = document.getElementById("rowEmom");
const rowCardio = document.getElementById("rowCardio");
const formReps = document.getElementById("formReps");
const formFailure = document.getElementById("formFailure");
const formSeconds = document.getElementById("formSeconds");
const formSecondsFailure = document.getElementById("formSecondsFailure");
const formEmomMinutes = document.getElementById("formEmomMinutes");
const formEmomReps = document.getElementById("formEmomReps");
const formCardioMinutes = document.getElementById("formCardioMinutes");
const formWeight = document.getElementById("formWeight");
const formQuickNote = document.getElementById("formQuickNote");
const formStepButtons = document.querySelectorAll(".form-step-btn");
const formSteps = document.querySelectorAll(".form-step");
const formPrev = document.getElementById("formPrev");
const formNext = document.getElementById("formNext");
const formSubmitBtn = document.getElementById("formSubmit");
const formProgression = document.getElementById("formProgression");
let currentFormStep = 0;

/* Ejercicios futuros */
const futureForm = document.getElementById("futureForm");
const futureInput = document.getElementById("futureInput");
const futureList = document.getElementById("futureList");
const futureEmpty = document.getElementById("futureEmpty");

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
const historyStore = typeof window !== "undefined" ? window.entrenoHistory : null;
const seguimientoModule = typeof window !== "undefined" ? window.seguimientoUI : null;

/* ========= Inicialización ========= */
load();
const originalWorkoutsJSON = JSON.stringify(state.workouts || {});
const originalDayMetaJSON = JSON.stringify(state.dayMeta || {});
const originalFutureJSON = JSON.stringify(state.futureExercises || []);
const normalizedWorkouts = normalizeWorkouts(state.workouts);
const normalizedWorkoutsJSON = JSON.stringify(normalizedWorkouts);
const normalizedDayMeta = normalizeDayMeta(state.dayMeta);
const normalizedDayMetaJSON = JSON.stringify(normalizedDayMeta);
const normalizedFutureExercises = normalizeFutureExercises(state.futureExercises);
const normalizedFutureJSON = JSON.stringify(normalizedFutureExercises);
state.workouts = normalizedWorkouts;
state.dayMeta = normalizedDayMeta;
state.futureExercises = normalizedFutureExercises;

function getCalendarSnapshot(){
  const snapshot = {};
  Object.keys(state.workouts || {}).forEach((dayISO) => {
    const day = buildHistoryDaySnapshot(dayISO);
    snapshot[dayISO] = day.ejercicios;
  });
  return snapshot;
}

if (historyStore) {
  historyStore.rebuildFromCalendar(getCalendarSnapshot());
}

const today = new Date();
const todayISO = fmt(today);
const normalizedSelectedDate = fmt(fromISO(state.selectedDate));
const resetToToday = normalizedSelectedDate !== todayISO;
state.selectedDate = todayISO;
mcRefDate = new Date(today.getFullYear(), today.getMonth(), 1);
selectedDateInput.value = state.selectedDate;
formDate.value = state.selectedDate;
formCategory.value = normalizeCategory(formCategory.value);
renderAll();
if (
  originalWorkoutsJSON !== normalizedWorkoutsJSON ||
  originalDayMetaJSON !== normalizedDayMetaJSON ||
  originalFutureJSON !== normalizedFutureJSON ||
  resetToToday
) {
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
  rowCardio.classList.toggle("hidden", !goalCardio.checked);
}
[goalReps, goalSecs, goalEmom, goalCardio].forEach(el=>el.addEventListener("change", updateGoalRows));
updateGoalRows();

function validateStep(stepIndex){
  const step = formSteps[stepIndex];
  if (!step) return true;
  const fields = step.querySelectorAll("input, select, textarea");
  for (const field of fields){
    if (field.disabled || field.type === "button") continue;
    if (!field.checkValidity()){ field.reportValidity(); return false; }
  }
  return true;
}

function setFormStep(index){
  const max = formSteps.length ? formSteps.length - 1 : 0;
  currentFormStep = Math.max(0, Math.min(index, max));
  formSteps.forEach((step, idx)=>{
    step.classList.toggle("active", idx === currentFormStep);
  });
  formStepButtons.forEach((btn)=>{
    const target = Number(btn.dataset.stepTarget || "0");
    btn.classList.toggle("active", target === currentFormStep);
  });
  if (formPrev){
    formPrev.disabled = currentFormStep === 0;
    formPrev.classList.toggle("hidden", currentFormStep === 0);
  }
  if (formNext){
    formNext.classList.toggle("hidden", currentFormStep === max);
  }
  if (formSubmitBtn){
    formSubmitBtn.classList.toggle("hidden", currentFormStep !== max);
  }
}

function goToStep(target){
  if (target > currentFormStep){
    for (let i=currentFormStep; i<target; i+=1){
      if (!validateStep(i)) return;
    }
  }
  setFormStep(target);
}

function updateProgressionHint(){
  if (!formProgression) return;
  const key = normalizeCategory(formCategory.value);
  if (key === "calistenia"){
    formProgression.textContent = "Sugerencia: Dominadas pronas → supinas → lastradas. Añade hollow/arch para consolidar.";
  } else if (key === "skill"){
    formProgression.textContent = "Trabaja bloques cortos: entrada, control en isométrico y salida con calidad.";
  } else if (key === "cardio"){
    formProgression.textContent = "Alterna ritmos: 3' suave + 1' intenso para aumentar el volumen semanal.";
  } else {
    formProgression.textContent = "Combina variantes con tempo y descanso controlado para progresar semana a semana.";
  }
}

if (formPrev){
  formPrev.addEventListener("click", ()=> setFormStep(currentFormStep - 1));
}
if (formNext){
  formNext.addEventListener("click", ()=>{
    if (!validateStep(currentFormStep)) return;
    setFormStep(currentFormStep + 1);
  });
}
formStepButtons.forEach((btn)=>{
  btn.addEventListener("click", ()=>{
    const target = Number(btn.dataset.stepTarget || "0");
    goToStep(target);
  });
});
if (formCategory){
  formCategory.addEventListener("change", updateProgressionHint);
}
setFormStep(0);
updateProgressionHint();

if (todayMobilityToggle){
  todayMobilityToggle.addEventListener("click", ()=>{
    if (suppressDayMetaEvents) return;
    const meta = getDayMeta(state.selectedDate);
    setDayMeta(state.selectedDate, { habits: { mobility: !meta.habits.mobility } });
    renderTodayInsights(state.selectedDate, getDayExercises(state.selectedDate));
  });
}
if (todayHabitInputs?.length){
  todayHabitInputs.forEach((input)=>{
    input.addEventListener("change", ()=>{
      if (suppressDayMetaEvents) return;
      const habit = input.dataset.habit;
      setDayMeta(state.selectedDate, { habits: { [habit]: input.checked } });
      renderTodayInsights(state.selectedDate, getDayExercises(state.selectedDate));
    });
  });
}
if (todayRPEInput){
  todayRPEInput.addEventListener("input", ()=>{
    if (suppressDayMetaEvents) return;
    if (todayRPEValue) todayRPEValue.textContent = todayRPEInput.value;
  });
  todayRPEInput.addEventListener("change", ()=>{
    if (suppressDayMetaEvents) return;
    setDayMeta(state.selectedDate, { sessionRPE: Number(todayRPEInput.value) });
    renderTodayInsights(state.selectedDate, getDayExercises(state.selectedDate));
  });
}
if (todayRPEClear){
  todayRPEClear.addEventListener("click", ()=>{
    if (suppressDayMetaEvents) return;
    setDayMeta(state.selectedDate, { sessionRPE: null });
    renderTodayInsights(state.selectedDate, getDayExercises(state.selectedDate));
  });
}
if (todayPhaseSelect){
  todayPhaseSelect.addEventListener("change", ()=>{
    if (suppressDayMetaEvents) return;
    setDayMeta(state.selectedDate, { phase: todayPhaseSelect.value });
    renderTodayInsights(state.selectedDate, getDayExercises(state.selectedDate));
  });
}

addForm.addEventListener("reset", () => {
  requestAnimationFrame(() => {
    formCategory.value = CATEGORY_KEYS[0];
    updateGoalRows();
    if (formQuickNote) formQuickNote.value = "";
    setFormStep(0);
    updateProgressionHint();
  });
});

/* ==== Añadir ejercicio ==== */
addForm.addEventListener("submit", (e)=>{
  e.preventDefault();
  const day = formDate.value || state.selectedDate;
  const normalizedDay = fmt(fromISO(day));

  const ex = {
    id: randomUUID(),
    name: (formName.value || "").trim(),
    sets: Math.max(1, Number(formSets.value||1)),
    goal: null,          // "reps" | "seconds" | "emom" | "cardio"
    reps: null,          // si goal="reps"
    failure: false,      // si goal="reps" o goal="seconds"
    seconds: null,       // si goal="seconds"
    emomMinutes: null,   // si goal="emom"
    emomReps: null,      // si goal="emom"
    cardioMinutes: null, // si goal="cardio"
    weightKg: formWeight.value ? Number(formWeight.value) : null,
    done: [],            // array con reps logradas por serie (o segundos)
    completed: false,
    note: formQuickNote ? (formQuickNote.value || "").trim() : "",
    category: normalizeCategory(formCategory.value),
    perceivedEffort: null,
  };

  if (!ex.name) { alert("Pon un nombre al ejercicio."); return; }

  if (goalReps.checked) {
    ex.goal = "reps";
    ex.reps = formReps.value ? Number(formReps.value) : null;
    ex.failure = !!formFailure.checked;
    ex.seconds = null;
    ex.emomMinutes = null;
    ex.emomReps = null;
    ex.cardioMinutes = null;
  } else if (goalSecs.checked) {
    ex.goal = "seconds";
    ex.seconds = Number(formSeconds.value||0);
    ex.failure = !!formSecondsFailure.checked;
    ex.reps = null;
    ex.emomMinutes = null;
    ex.emomReps = null;
    ex.cardioMinutes = null;
  } else if (goalEmom.checked) {
    ex.goal = "emom";
    ex.emomMinutes = Number(formEmomMinutes.value||0);
    ex.emomReps = Number(formEmomReps.value||0);
    ex.failure = false;
    ex.reps = null;
    ex.seconds = null;
    ex.cardioMinutes = null;
  } else {
    ex.goal = "cardio";
    ex.cardioMinutes = Number(formCardioMinutes.value||0);
    ex.failure = false;
    ex.reps = null;
    ex.seconds = null;
    ex.emomMinutes = null;
    ex.emomReps = null;
  }

  if (!state.workouts[normalizedDay]) state.workouts[normalizedDay] = [];
  if (ex.failure) {
    ex.done = Array.from({length: ex.sets}, ()=>null);
  } else {
    ex.done = [];
  }
  state.workouts[normalizedDay].push(ex);
  save();
  syncHistoryForDay(normalizedDay, { showToast: true });

  // Ajustar UI
  formName.value = "";
  formFailure.checked = false;
  formSecondsFailure.checked = false;
  formCategory.value = CATEGORY_KEYS[0];
  if (formQuickNote) formQuickNote.value = "";
  renderDay(normalizedDay);
  switchToTab("entreno");
  state.selectedDate = normalizedDay;
  selectedDateInput.value = state.selectedDate;
  formDate.value = state.selectedDate;
  const selected = fromISO(state.selectedDate);
  mcRefDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
  save();
  renderMiniCalendar();
  if (seguimientoModule?.refresh) {
    seguimientoModule.refresh();
  }
  setFormStep(0);
  updateProgressionHint();
});

if (futureForm) {
  futureForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = (futureInput?.value || "").trim();
    if (!name) {
      futureInput?.focus();
      return;
    }
    const entry = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };
    state.futureExercises = Array.isArray(state.futureExercises)
      ? [...state.futureExercises, entry]
      : [entry];
    futureInput.value = "";
    save();
    renderFutureExercises();
  });
}

if (futureList) {
  futureList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (action !== "remove-future") return;
    const id = target.dataset.id;
    if (!id) return;
    const items = Array.isArray(state.futureExercises) ? state.futureExercises : [];
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return;
    state.futureExercises = next;
    save();
    renderFutureExercises();
  });
}

/* ========= Render ========= */
function renderAll(){
  renderDay(state.selectedDate);
  renderMiniCalendar();
  renderFutureExercises();
  if (seguimientoModule?.refresh) {
    seguimientoModule.refresh();
  }
}

function renderFutureExercises(){
  if (!futureList || !futureEmpty) return;
  futureList.innerHTML = "";
  const items = Array.isArray(state.futureExercises) ? state.futureExercises : [];
  futureEmpty.style.display = items.length ? "none" : "block";
  if (!items.length) {
    return;
  }
  const formatDate = (iso) => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  };
  items.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const li = document.createElement("li");
    li.className = "future-item";
    li.dataset.id = item.id;

    const text = document.createElement("span");
    text.className = "future-item-text";
    text.textContent = item.name;
    li.append(text);

    const metaText = formatDate(item.createdAt);
    if (metaText) {
      const meta = document.createElement("time");
      meta.className = "future-item-meta";
      meta.dateTime = item.createdAt;
      meta.textContent = metaText;
      li.append(meta);
    }

    const actions = document.createElement("div");
    actions.className = "future-item-actions";
    const removeBtn = button("Eliminar", "ghost micro");
    removeBtn.type = "button";
    removeBtn.dataset.action = "remove-future";
    removeBtn.dataset.id = item.id;
    removeBtn.setAttribute("aria-label", `Eliminar "${item.name}" de ejercicios futuros`);
    actions.append(removeBtn);
    li.append(actions);

    futureList.append(li);
  });
}

function getDayExercises(dayISO){
  const source = Array.isArray(state.workouts?.[dayISO]) ? state.workouts[dayISO] : [];
  return source.filter(isPlainObject);
}

function renderDay(dayISO){
  const list = getDayExercises(dayISO);
  humanDateSpan.textContent = toHuman(dayISO);
  exerciseList.innerHTML = "";
  emptyDayHint.style.display = list.length ? "none" : "block";
  renderTodayInsights(dayISO, list);

  list.forEach(ex=>{
    if (!ex.id) ex.id = randomUUID();
    ex.category = normalizeCategory(ex.category);
    const li = document.createElement("li");
    li.className = "exercise";
    li.dataset.category = ex.category;
    li.classList.add(`category-${ex.category}`);
    if (ex.completed) li.classList.add("completed");
    li.dataset.id = ex.id;

    const categoryName = CATEGORY_LABELS[ex.category] || CATEGORY_LABELS[CATEGORY_KEYS[0]];
    const categoryTag = document.createElement("span");
    categoryTag.className = `category-tag category-tag-${ex.category}`;
    categoryTag.textContent = categoryName;

    const title = document.createElement("div");
    title.className = "title";
    const titleMain = document.createElement("div");
    titleMain.className = "title-main";
    const dragBtn = document.createElement("button");
    dragBtn.type = "button";
    dragBtn.className = "drag-handle";
    dragBtn.setAttribute("aria-label", "Reordenar ejercicio");
    dragBtn.title = "Reordenar ejercicio";
    dragBtn.innerHTML = "<span aria-hidden=\"true\">☰</span>";
    const h3 = document.createElement("h3");
    h3.textContent = ex.name;
    h3.style.margin = "0";
    const controls = document.createElement("div");
    controls.className = "controls";
    const noteBtn = button("📝", "small ghost note-toggle");
    const updateNoteState = () => {
      const hasNote = !!(ex.note && ex.note.trim());
      noteBtn.classList.toggle("has-note", hasNote);
      const label = hasNote ? "Editar nota del ejercicio" : "Añadir nota al ejercicio";
      noteBtn.setAttribute("aria-label", label);
      noteBtn.title = hasNote ? "Editar nota" : "Añadir nota";
    };
    updateNoteState();
    const doneBtn = button(
      ex.completed ? "Marcar como pendiente" : "Marcar como hecho",
      ex.completed ? "small ghost" : "small success"
    );
    const editBtn = button("Editar", "small ghost");
    const delBtn = button("Eliminar", "small danger");
    doneBtn.addEventListener("click", ()=>{
      ex.completed = !ex.completed;
      save();
      if (ex.completed) {
        syncHistoryForDay(dayISO, { showToast: true });
      }
      renderDay(dayISO);
      renderMiniCalendar();
      if (seguimientoModule?.refresh) {
        seguimientoModule.refresh();
      }
    });
    controls.append(noteBtn, doneBtn, editBtn, delBtn);
    titleMain.append(dragBtn, h3);
    title.append(titleMain, controls);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = metaText(ex);

    let setsBox = null;
    const recoveryStrip = buildRecoveryStrip(ex);
    const noteBox = document.createElement("div");
    noteBox.className = "note-box hidden";
    const noteField = document.createElement("div");
    noteField.className = "field";
    const noteLabel = document.createElement("span");
    noteLabel.textContent = "Nota";
    const noteTextarea = document.createElement("textarea");
    noteTextarea.rows = 3;
    noteTextarea.placeholder = "Escribe una nota personal";
    noteTextarea.value = ex.note || "";

    let noteTimer = null;
    const persistNote = () => {
      ex.note = noteTextarea.value;
      updateNoteState();
      save();
      syncHistoryForDay(dayISO, { showToast: false });
      if (seguimientoModule?.refresh) {
        seguimientoModule.refresh();
      }
    };
    noteTextarea.addEventListener("input", () => {
      ex.note = noteTextarea.value;
      updateNoteState();
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        save();
        noteTimer = null;
        syncHistoryForDay(dayISO, { showToast: false });
        if (seguimientoModule?.refresh) {
          seguimientoModule.refresh();
        }
      }, 300);
    });
    noteTextarea.addEventListener("blur", () => {
      if (noteTimer) {
        clearTimeout(noteTimer);
        noteTimer = null;
      }
      persistNote();
    });

    noteField.append(noteLabel, noteTextarea);
    const noteActions = document.createElement("div");
    noteActions.className = "note-actions";
    const noteCloseBtn = button("Cerrar", "ghost small");
    noteCloseBtn.addEventListener("click", () => {
      noteBox.classList.add("hidden");
      noteTextarea.blur();
    });
    noteActions.append(noteCloseBtn);
    noteBox.append(noteField, noteActions);

    noteBtn.addEventListener("click", () => {
      const isHidden = noteBox.classList.contains("hidden");
      if (isHidden) {
        noteBox.classList.remove("hidden");
        requestAnimationFrame(() => {
          noteTextarea.focus();
          noteTextarea.setSelectionRange(noteTextarea.value.length, noteTextarea.value.length);
        });
      } else {
        noteBox.classList.add("hidden");
      }
    });
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
        input.placeholder = ex.goal==="seconds" ? "seg" : ex.goal==="cardio" ? "min" : "reps";
        input.value = doneValues[i] ?? "";
        input.addEventListener("change", ()=>{
          const v = input.value? Number(input.value) : null;
          const doneList = Array.isArray(ex.done) ? ex.done : [];
          doneList[i] = v;
          ex.done = doneList;
          save();
          syncHistoryForDay(dayISO, { showToast: true });
          if (seguimientoModule?.refresh) {
            seguimientoModule.refresh();
          }
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

    li.append(categoryTag, title, meta);
    if (recoveryStrip) li.append(recoveryStrip);
    li.append(noteBox);
    if (setsBox) li.append(setsBox);
    exerciseList.append(li);
    setupExerciseDrag(li, dayISO);

  });
}

function computeDurationSummary(exercises){
  let minutes = 0;
  let sets = 0;
  exercises.forEach((ex) => {
    const setsCount = Math.max(1, Number(ex.sets) || 0);
    sets += setsCount;
    if (ex.goal === "cardio") {
      minutes += (Number(ex.cardioMinutes) || 0) * setsCount;
    } else if (ex.goal === "seconds") {
      minutes += ((Number(ex.seconds) || 0) * setsCount) / 60;
    } else if (ex.goal === "emom") {
      minutes += Number(ex.emomMinutes) || setsCount * 2;
    } else {
      minutes += setsCount * 3;
    }
  });
  return { minutes: Math.round(minutes), sets };
}

function detectFocus(exercises){
  if (!exercises.length) {
    return { label: "Planifica", detail: "Añade ejercicios para ver un foco claro." };
  }
  const totals = { push: 0, pull: 0, skill: 0 };
  exercises.forEach((ex) => {
    const setsCount = Math.max(1, Number(ex.sets) || 0);
    if (ex.category === "skill") {
      totals.skill += setsCount;
      return;
    }
    const name = (ex.name || "").toLowerCase();
    const isPull = /(dominad|pull|remo|row|chin|tir[oó]n|australian)/.test(name);
    const isPush = /(flex|push|fond|press|empuj|dip|handstand push)/.test(name);
    if (isPull && !isPush) {
      totals.pull += setsCount;
    } else if (isPush && !isPull) {
      totals.push += setsCount;
    } else {
      totals.push += setsCount / 2;
      totals.pull += setsCount / 2;
    }
  });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const [key, amount] = sorted[0] || [];
  if (!amount) {
    return { label: "Balanceado", detail: "Mantén variedad o añade habilidades específicas." };
  }
  if (key === "skill") {
    return { label: "Skill", detail: "Refina control técnico y progresiones estáticas." };
  }
  if (key === "push") {
    return { label: "Empuje", detail: "Prioriza pectoral, hombros y tríceps." };
  }
  return { label: "Tirón", detail: "Carga dorsales y bíceps con variantes exigentes." };
}

function computeCompletion(dayISO){
  const exercises = getDayExercises(dayISO);
  const total = exercises.length;
  const completed = exercises.filter((ex) => ex.completed).length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return { total, completed, percent };
}

function computeStreaks(){
  const days = Object.keys(state.workouts || {}).sort();
  let best = 0;
  let current = 0;
  let previousCompleteDate = null;
  days.forEach((dayISO) => {
    const { total, completed } = computeCompletion(dayISO);
    const isPerfect = total > 0 && completed === total;
    const currentDate = fromISO(dayISO);
    if (isPerfect) {
      if (previousCompleteDate) {
        const diff = Math.round((currentDate - previousCompleteDate) / (24 * 60 * 60 * 1000));
        current = diff === 1 ? current + 1 : 1;
      } else {
        current = 1;
      }
      previousCompleteDate = currentDate;
      best = Math.max(best, current);
    } else {
      previousCompleteDate = null;
      current = 0;
    }
  });
  return { best, current };
}

function renderTodayBadges(dayISO){
  if (!todayBadges) return;
  todayBadges.innerHTML = "";
  const completion = computeCompletion(dayISO);
  const streaks = computeStreaks();

  const createBadge = (label, value) => {
    const box = document.createElement("div");
    box.className = "today-badge";
    const title = document.createElement("span");
    title.className = "muted";
    title.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    box.append(title, strong);
    return box;
  };

  todayBadges.append(
    createBadge(
      "Cumplimiento",
      completion.total ? `${completion.percent}% (${completion.completed}/${completion.total})` : "Sin ejercicios"
    ),
    createBadge("Mejor racha", `${streaks.best} ${streaks.best === 1 ? "día" : "días"}`),
    createBadge("Racha actual", `${streaks.current} ${streaks.current === 1 ? "día" : "días"}`)
  );
}

function renderTodayInsights(dayISO, exercises){
  if (!todayPanel) return;
  const meta = getDayMeta(dayISO);
  const duration = computeDurationSummary(exercises);
  const focus = detectFocus(exercises);

  suppressDayMetaEvents = true;

  if (todayDurationEl) {
    todayDurationEl.textContent = duration.minutes ? `${duration.minutes} min` : exercises.length ? "≈10-15 min" : "—";
  }
  if (todayVolumeHint) {
    todayVolumeHint.textContent = exercises.length ? `${duration.sets} series planificadas` : "Aún no hay series programadas.";
  }
  if (todayFocusEl) {
    todayFocusEl.textContent = focus.label;
  }
  if (todayFocusDetail) {
    todayFocusDetail.textContent = focus.detail;
  }
  if (todayMobilityText) {
    todayMobilityText.textContent = meta.habits.mobility
      ? "✅ Movilidad completada. Mantén la constancia."
      : "Recuerda dedicar 5' a movilidad para desbloquear rangos.";
  }
  if (todayMobilityToggle) {
    todayMobilityToggle.textContent = meta.habits.mobility ? "Desmarcar" : "Marcar movilidad";
  }
  if (todayRPEInput) {
    todayRPEInput.value = meta.sessionRPE != null ? meta.sessionRPE : "6";
  }
  if (todayRPEValue) {
    todayRPEValue.textContent = meta.sessionRPE != null ? meta.sessionRPE : "—";
  }
  if (todayRPEBadge) {
    todayRPEBadge.textContent = meta.sessionRPE != null ? `RPE ${meta.sessionRPE}` : "Sin registrar";
    todayRPEBadge.classList.toggle("up", meta.sessionRPE != null && meta.sessionRPE >= 8);
    todayRPEBadge.classList.toggle("down", meta.sessionRPE != null && meta.sessionRPE <= 4);
    todayRPEBadge.classList.toggle("same", meta.sessionRPE == null);
  }
  if (todayHabitInputs?.length){
    todayHabitInputs.forEach((input)=>{
      const habitKey = input.dataset.habit;
      input.checked = !!meta.habits[habitKey];
    });
  }
  if (todayPhaseSelect) {
    todayPhaseSelect.value = meta.phase || "";
  }

  renderTodayBadges(dayISO);

  suppressDayMetaEvents = false;
}

function buildRecoveryStrip(ex){
  const wrapper = document.createElement("div");
  wrapper.className = "recovery-strip";

  const effortBlock = document.createElement("div");
  effortBlock.className = "recovery-effort";
  const effortLabel = document.createElement("span");
  effortLabel.textContent = "Esfuerzo";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "1";
  slider.max = "10";
  slider.step = "1";
  const valueLabel = document.createElement("span");
  valueLabel.className = "recovery-value";
  const clearBtn = button("Limpiar", "ghost micro");

  function syncEffort(){
    if (ex.perceivedEffort != null){
      slider.value = String(ex.perceivedEffort);
      valueLabel.textContent = ex.perceivedEffort;
      valueLabel.classList.add("active");
    } else {
      slider.value = "6";
      valueLabel.textContent = "—";
      valueLabel.classList.remove("active");
    }
  }
  syncEffort();

  slider.addEventListener("input", ()=>{
    valueLabel.textContent = slider.value;
  });
  slider.addEventListener("change", ()=>{
    const numeric = Number(slider.value);
    ex.perceivedEffort = Number.isFinite(numeric) ? numeric : null;
    syncEffort();
    save();
  });
  clearBtn.addEventListener("click", ()=>{
    ex.perceivedEffort = null;
    syncEffort();
    save();
  });

  effortBlock.append(effortLabel, slider, valueLabel, clearBtn);

  wrapper.append(effortBlock);
  return wrapper;
}

function setupExerciseDrag(li, dayISO){
  const handle = li.querySelector(".drag-handle");

  const onPointerMove = (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    event.preventDefault();
    updateDragPosition(event);
  };

  const onPointerUp = (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    event.preventDefault();
    finishExerciseDrag(true);
  };

  const onPointerCancel = (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    event.preventDefault();
    finishExerciseDrag(false);
  };

  const registerTarget = (target) => {
    if (!target) return;
    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerCancel);
    target.addEventListener("lostpointercapture", onPointerCancel);
  };

  registerTarget(handle);
  registerTarget(li);

  if (handle){
    handle.addEventListener("pointerdown", (event) => {
      if (event.button && event.button !== 0) return;
      event.preventDefault();
      beginExerciseDrag(event, handle, li, dayISO);
    });
  }

  let longPressTimer = null;
  let lastPressEvent = null;
  const startCoords = {x:0, y:0};

  const clearLongPress = () => {
    if (longPressTimer){
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    lastPressEvent = null;
    li.removeEventListener("pointermove", preDragMove);
    li.removeEventListener("pointerup", clearLongPress);
    li.removeEventListener("pointercancel", clearLongPress);
    li.removeEventListener("pointerleave", clearLongPress);
  };

  const preDragMove = (moveEvent) => {
    if (!lastPressEvent) return;
    lastPressEvent = moveEvent;
    const dx = Math.abs(moveEvent.clientX - startCoords.x);
    const dy = Math.abs(moveEvent.clientY - startCoords.y);
    if (dx > 8 || dy > 8){
      clearLongPress();
    }
  };

  li.addEventListener("pointerdown", (event) => {
    if (activeDrag) return;
    if (event.pointerType === "mouse") return;
    if (event.target.closest(".drag-handle")) return;
    if (event.target.closest(".controls") || event.target.closest(".edit-box") || event.target.closest(".sets-grid") || event.target.closest("input") || event.target.closest("select") || event.target.closest("textarea") || event.target.closest("button")) return;

    startCoords.x = event.clientX;
    startCoords.y = event.clientY;
    lastPressEvent = event;
    longPressTimer = window.setTimeout(() => {
      if (!lastPressEvent) return;
      beginExerciseDrag(lastPressEvent, li, li, dayISO);
      clearLongPress();
    }, 250);

    li.addEventListener("pointermove", preDragMove);
    li.addEventListener("pointerup", clearLongPress);
    li.addEventListener("pointercancel", clearLongPress);
    li.addEventListener("pointerleave", clearLongPress);
  });
}

function getScrollableContainer(element){
  const docEl = document.scrollingElement || document.documentElement;
  let node = element;
  while (node && node !== document.body && node !== document.documentElement){
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight){
      return node;
    }
    node = node.parentElement;
  }
  return docEl;
}

function beginExerciseDrag(event, source, li, dayISO){
  if (activeDrag) return;
  if (!li.dataset.id) return;

  if (event && typeof event.preventDefault === "function"){
    event.preventDefault();
  }

  const listRect = exerciseList.getBoundingClientRect();
  const itemRect = li.getBoundingClientRect();
  const placeholder = createDragPlaceholder(itemRect.height);
  const nextSibling = li.nextSibling;
  const scrollContainer = getScrollableContainer(exerciseList);
  const initialScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

  placeholder.style.width = `${itemRect.width}px`;
  placeholder.style.boxSizing = "border-box";

  exerciseList.insertBefore(placeholder, nextSibling);

  activeDrag = {
    pointerId: event.pointerId ?? null,
    li,
    source,
    dayISO,
    offsetY: event.clientY - itemRect.top,
    placeholder,
    originalNextSibling: nextSibling,
    originalTouchAction: source.style ? source.style.touchAction : undefined,
    scrollContainer,
    startScrollTop: initialScrollTop,
    autoScrollVelocity: 0,
    autoScrollFrame: null,
    lastClientY: event.clientY
  };

  if (source && source.style){
    source.style.touchAction = "none";
  }

  document.body.classList.add("is-dragging");
  li.classList.add("dragging");
  li.style.width = `${itemRect.width}px`;
  li.style.height = `${itemRect.height}px`;
  li.style.position = "absolute";
  li.style.left = "0px";
  li.style.top = `${itemRect.top - listRect.top}px`;
  li.style.zIndex = "20";
  li.style.pointerEvents = "none";
  li.style.boxSizing = "border-box";

  if (source.setPointerCapture && activeDrag.pointerId != null){
    try { source.setPointerCapture(activeDrag.pointerId); } catch(e){}
  }

  updateDragPosition(event);
}

function repositionActiveDrag(){
  if (!activeDrag) return;
  const pointerY = typeof activeDrag.lastClientY === "number" ? activeDrag.lastClientY : null;
  const listRect = exerciseList.getBoundingClientRect();
  const scrollContainer = activeDrag.scrollContainer;
  const scrollAdjustment = scrollContainer === exerciseList
    ? (scrollContainer.scrollTop - activeDrag.startScrollTop)
    : 0;
  const referenceY = pointerY != null ? pointerY : (listRect.top + activeDrag.offsetY);
  const top = referenceY - listRect.top - activeDrag.offsetY + scrollAdjustment;
  const maxTop = Math.max(0, exerciseList.scrollHeight - activeDrag.placeholder.offsetHeight);
  const clampedTop = Math.min(Math.max(top, 0), maxTop);
  activeDrag.li.style.top = `${clampedTop}px`;

  const siblings = Array.from(exerciseList.children).filter((child) => child !== activeDrag.li && child !== activeDrag.placeholder);
  let inserted = false;
  for (const sibling of siblings){
    const rect = sibling.getBoundingClientRect();
    const compareY = pointerY != null ? pointerY : (rect.top + rect.height / 2);
    if (compareY < rect.top + rect.height / 2){
      exerciseList.insertBefore(activeDrag.placeholder, sibling);
      inserted = true;
      break;
    }
  }
  if (!inserted){
    exerciseList.appendChild(activeDrag.placeholder);
  }
}

function computeAutoScrollSpeed(distance, margin){
  if (margin <= 0) return 0;
  const maxSpeed = 28;
  const normalized = Math.min(1, Math.max(0, distance / margin));
  const eased = normalized * normalized;
  return eased * maxSpeed;
}

function stopAutoScroll(){
  if (!activeDrag) return;
  if (activeDrag.autoScrollFrame != null){
    cancelAnimationFrame(activeDrag.autoScrollFrame);
    activeDrag.autoScrollFrame = null;
  }
  activeDrag.autoScrollVelocity = 0;
}

function ensureAutoScrollLoop(){
  if (!activeDrag) return;
  if (activeDrag.autoScrollFrame != null) return;

  const step = () => {
    if (!activeDrag) return;
    const { scrollContainer, autoScrollVelocity } = activeDrag;
    if (!scrollContainer || Math.abs(autoScrollVelocity) < 0.01){
      activeDrag.autoScrollFrame = null;
      return;
    }
    const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    if (maxScroll <= 0){
      stopAutoScroll();
      return;
    }
    const currentScroll = scrollContainer.scrollTop;
    const nextScroll = Math.min(Math.max(currentScroll + autoScrollVelocity, 0), maxScroll);
    if (nextScroll !== currentScroll){
      scrollContainer.scrollTop = nextScroll;
      repositionActiveDrag();
    }
    updateAutoScroll();
    if (!activeDrag || Math.abs(activeDrag.autoScrollVelocity) < 0.01){
      activeDrag.autoScrollFrame = null;
      return;
    }
    activeDrag.autoScrollFrame = requestAnimationFrame(step);
  };

  activeDrag.autoScrollFrame = requestAnimationFrame(step);
}

function updateAutoScroll(){
  if (!activeDrag) return;
  const { scrollContainer } = activeDrag;
  if (!scrollContainer){
    stopAutoScroll();
    return;
  }

  const pointerY = typeof activeDrag.lastClientY === "number" ? activeDrag.lastClientY : null;
  if (pointerY == null){
    stopAutoScroll();
    return;
  }

  let rect;
  if (scrollContainer === document.scrollingElement || scrollContainer === document.documentElement || scrollContainer === document.body){
    rect = { top: 0, bottom: window.innerHeight };
  } else {
    rect = scrollContainer.getBoundingClientRect();
  }

  const marginBase = rect.bottom - rect.top;
  const margin = Math.max(60, Math.min(120, marginBase / 4));
  const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
  if (maxScroll <= 0){
    stopAutoScroll();
    return;
  }

  const scrollTop = scrollContainer.scrollTop;
  let velocity = 0;

  if (pointerY < rect.top + margin && scrollTop > 0){
    const distance = rect.top + margin - pointerY;
    velocity = -computeAutoScrollSpeed(distance, margin);
  } else if (pointerY > rect.bottom - margin && scrollTop < maxScroll){
    const distance = pointerY - (rect.bottom - margin);
    velocity = computeAutoScrollSpeed(distance, margin);
  }

  activeDrag.autoScrollVelocity = velocity;

  if (velocity !== 0){
    ensureAutoScrollLoop();
  } else {
    stopAutoScroll();
  }
}

function updateDragPosition(event){
  if (!activeDrag) return;
  if (event && typeof event.clientY === "number"){
    activeDrag.lastClientY = event.clientY;
  }
  repositionActiveDrag();
  updateAutoScroll();
}

function finishExerciseDrag(commit){
  if (!activeDrag) return;
  const { li, placeholder, source, pointerId, dayISO, originalNextSibling, originalTouchAction } = activeDrag;

  stopAutoScroll();

  if (!commit){
    if (originalNextSibling && originalNextSibling.parentNode === exerciseList){
      exerciseList.insertBefore(placeholder, originalNextSibling);
    } else if (!originalNextSibling){
      exerciseList.appendChild(placeholder);
    }
  }

  if (placeholder.parentNode){
    exerciseList.insertBefore(li, placeholder);
    placeholder.remove();
  }

  if (pointerId != null && source && source.releasePointerCapture){
    try { source.releasePointerCapture(pointerId); } catch(e){}
  }

  if (source && source.style){
    if (originalTouchAction){
      source.style.touchAction = originalTouchAction;
    } else {
      source.style.removeProperty("touch-action");
    }
  }

  document.body.classList.remove("is-dragging");
  li.classList.remove("dragging");
  li.style.position = "";
  li.style.left = "";
  li.style.top = "";
  li.style.width = "";
  li.style.height = "";
  li.style.zIndex = "";
  li.style.pointerEvents = "";
  li.style.boxSizing = "";

  activeDrag = null;

  if (commit){
    finalizeExerciseOrder(dayISO);
  }
}

function finalizeExerciseOrder(dayISO){
  const ids = Array.from(exerciseList.querySelectorAll("li.exercise"))
    .map((node) => node.dataset.id)
    .filter(Boolean);
  const current = Array.isArray(state.workouts?.[dayISO]) ? state.workouts[dayISO] : [];
  if (!current.length) return;
  const map = new Map(current.map((ex) => [ex.id, ex]));
  const newOrder = ids.map((id) => map.get(id)).filter(Boolean);
  if (newOrder.length !== current.length){
    renderDay(dayISO);
    return;
  }
  let changed = false;
  for (let i = 0; i < newOrder.length; i++){
    if (newOrder[i] !== current[i]){
      changed = true;
      break;
    }
  }
  if (changed){
    state.workouts[dayISO] = newOrder;
    save();
  }
}

function createDragPlaceholder(height){
  const placeholder = document.createElement("li");
  placeholder.className = "exercise-placeholder";
  placeholder.style.height = `${height}px`;
  placeholder.style.pointerEvents = "none";
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.setAttribute("role", "presentation");
  return placeholder;
}

function showHistoryToast(message){
  if (!message) return;
  if (seguimientoModule?.showToast){
    seguimientoModule.showToast(message);
  } else {
    console.info(message);
  }
}

function minutesToSeconds(value){
  if (historyStore?.minutesToSeconds){
    return historyStore.minutesToSeconds(value);
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 60);
}

function buildHistoryDaySnapshot(dayISO){
  const ejercicios = (Array.isArray(state.workouts?.[dayISO]) ? state.workouts[dayISO] : [])
    .filter(isPlainObject)
    .map((exercise) => ({
      name: exercise.name || "",
      goal: exercise.goal || "",
      sets: exercise.sets,
      done: Array.isArray(exercise.done) ? exercise.done.slice() : [],
      failure: !!exercise.failure,
      reps: exercise.reps,
      seconds: exercise.seconds,
      emomMinutes: exercise.emomMinutes,
      emomReps: exercise.emomReps,
      cardioMinutes: exercise.cardioMinutes,
      weightKg: exercise.weightKg,
      note: exercise.note,
      hecho: exercise.completed === true,
    }));
  return { fechaISO: dayISO, sourceDayId: dayISO, ejercicios };
}

function syncHistoryForDay(dayISO, options = {}){
  if (!historyStore) return;
  const snapshot = buildHistoryDaySnapshot(dayISO);
  const result = historyStore.addOrUpdateFromDay(snapshot);
  if (options.showToast === false) return;
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const priority = ["reps", "tiempo", "peso"];
  let selected = null;
  for (const type of priority) {
    selected = messages.find((item) => item && item.tipo === type && item.text);
    if (selected) break;
  }
  if (!selected && messages.length) {
    selected = messages.find((item) => item && item.text) || null;
  }
  if (selected){
    showHistoryToast(selected.text);
  }
}

if (typeof window !== "undefined") {
  window.entrenoApp = Object.assign(window.entrenoApp || {}, {
    getCalendarSnapshot,
    syncHistoryForDay,
    getDayMeta,
    setDayMeta,
  });
}

function metaText(ex){
  const normalizedCategory = normalizeCategory(ex.category);
  const categoryName = CATEGORY_LABELS[normalizedCategory] || CATEGORY_LABELS[CATEGORY_KEYS[0]];
  const parts = [`<span><strong>Series:</strong> ${ex.sets}</span>`];

  parts.unshift(`<span><strong>Categoría:</strong> ${categoryName}</span>`);

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
  } else if (ex.goal==="cardio") {
    const minutesLabel = ex.cardioMinutes && ex.cardioMinutes > 0 ? ex.cardioMinutes : "—";
    parts.push(`<span><strong>Cardio:</strong> ${minutesLabel} min</span>`);
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
  // Categoría
  const categoryWrap = document.createElement("label");
  categoryWrap.className = "field";
  const categoryLabel = document.createElement("span");
  categoryLabel.textContent = "Categoría";
  const categorySelect = document.createElement("select");
  CATEGORY_KEYS.forEach((key)=>{
    const option = document.createElement("option");
    option.value = key;
    option.textContent = CATEGORY_LABELS[key] || key;
    categorySelect.append(option);
  });
  categorySelect.value = normalizeCategory(ex.category);
  categoryWrap.append(categoryLabel, categorySelect);
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
  const rCardio = radioRow("Cardio", "goalEdit-"+ex.id, ex.goal==="cardio");

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

  const rowCardio = document.createElement("div"); rowCardio.className="row indent hidden";
  const cardioField = fieldInline("Minutos", "number", ex.cardioMinutes ?? "", {min:1});
  rowCardio.append(cardioField.wrap);

  function toggleRows(){
    rowReps.classList.toggle("hidden", !rReps.input.checked);
    rowSecs.classList.toggle("hidden", !rSecs.input.checked);
    rowEmom.classList.toggle("hidden", !rEmom.input.checked);
    rowCardio.classList.toggle("hidden", !rCardio.input.checked);
  }
  [rReps.input, rSecs.input, rEmom.input, rCardio.input].forEach(i=>i.addEventListener("change", toggleRows));
  toggleRows();

  typeWrap.append(rReps.row, rowReps, rSecs.row, rowSecs, rEmom.row, rowEmom, rCardio.row, rowCardio);

  // Lastre
  const wField = field("Lastre (kg)", "number", ex.weightKg ?? "", {step:0.5});

  const actions = document.createElement("div");
  actions.className = "actions";
  const saveBtn = button("Guardar", "primary small");
  const cancelBtn = button("Cerrar", "ghost small");
  const deleteBtn = button("Eliminar", "danger small");
  actions.append(saveBtn, cancelBtn, deleteBtn);

  box.append(fName.wrap, categoryWrap, fSets.wrap, typeWrap, wField.wrap, actions);

  saveBtn.addEventListener("click", ()=>{
    ex.name = fName.input.value.trim() || ex.name;
    ex.sets = Math.max(1, Number(fSets.input.value||1));
    ex.category = normalizeCategory(categorySelect.value);

    const weightRaw = wField.input.value.trim();
    if (weightRaw === "") {
      ex.weightKg = null;
    } else {
      const weightNumber = Number(weightRaw);
      ex.weightKg = Number.isFinite(weightNumber) ? weightNumber : ex.weightKg;
    }

    if (rReps.input.checked){
      ex.goal="reps";
      ex.reps = repsField.input.value ? Number(repsField.input.value) : null;
      ex.failure = !!failChk.checked;
      ex.seconds = null; ex.emomMinutes=null; ex.emomReps=null; ex.cardioMinutes=null;
    } else if (rSecs.input.checked){
      ex.goal="seconds";
      ex.seconds = Number(secsField.input.value||0);
      ex.reps = null; ex.failure=!!failSecsChk.checked; ex.emomMinutes=null; ex.emomReps=null; ex.cardioMinutes=null;
    } else if (rEmom.input.checked){
      ex.goal="emom";
      ex.emomMinutes = Number(mField.input.value||0);
      ex.emomReps = Number(rField.input.value||0);
      ex.reps = null; ex.failure=false; ex.seconds=null; ex.cardioMinutes=null;
    } else {
      ex.goal="cardio";
      ex.cardioMinutes = Number(cardioField.input.value||0);
      ex.reps = null; ex.failure=false; ex.seconds=null; ex.emomMinutes=null; ex.emomReps=null;
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
    syncHistoryForDay(state.selectedDate, { showToast: false });
    renderDay(state.selectedDate);
    if (seguimientoModule?.refresh) {
      seguimientoModule.refresh();
    }
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
    syncHistoryForDay(dayISO, { showToast: false });
    save();
    renderDay(dayISO);
    renderMiniCalendar();
    if (seguimientoModule?.refresh) {
      seguimientoModule.refresh();
    }
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
  syncHistoryForDay(dst, { showToast: false });
  alert("Día copiado.");
  copyDayBox.classList.add("hidden");
  renderMiniCalendar();
  if (seguimientoModule?.refresh) {
    seguimientoModule.refresh();
  }
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
      switchToTab("entreno");
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
