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
  nuevo: document.getElementById("tab-nuevo")
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

/* ========= Inicialización ========= */
load();
const initialDate = fromISO(state.selectedDate);
state.selectedDate = fmt(initialDate);
mcRefDate = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
selectedDateInput.value = state.selectedDate;
formDate.value = state.selectedDate;
renderAll();

tabs.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelector(".tab.active")?.classList.remove("active");
    btn.classList.add("active");
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
    id: crypto.randomUUID(),
    name: (formName.value || "").trim(),
    sets: Math.max(1, Number(formSets.value||1)),
    goal: null,          // "reps" | "seconds" | "emom"
    reps: null,          // si goal="reps"
    failure: false,      // si goal="reps" o goal="seconds"
    seconds: null,       // si goal="seconds"
    emomMinutes: null,   // si goal="emom"
    emomReps: null,      // si goal="emom"
    weightKg: formWeight.value ? Number(formWeight.value) : null,
    done: []             // array con reps logradas por serie (o segundos)
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
  save(); renderMiniCalendar();
});

/* ========= Render ========= */
function renderAll(){
  renderDay(state.selectedDate);
  renderMiniCalendar();
}

function renderDay(dayISO){
  const list = state.workouts[dayISO] || [];
  humanDateSpan.textContent = toHuman(dayISO);
  exerciseList.innerHTML = "";
  emptyDayHint.style.display = list.length ? "none" : "block";

  list.forEach(ex=>{
    const li = document.createElement("li");
    li.className = "exercise";
    li.dataset.id = ex.id;

    const title = document.createElement("div");
    title.className = "title";
    const h3 = document.createElement("h3");
    h3.textContent = ex.name;
    h3.style.margin = "0";
    const controls = document.createElement("div");
    controls.className = "controls";
    const editBtn = button("Editar", "small ghost");
    const delBtn = button("Eliminar", "small danger");
    controls.append(editBtn, delBtn);
    title.append(h3, controls);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = metaText(ex);

    let setsBox = null;
    if (ex.failure) {
      const doneValues = Array.from({length: ex.sets}, (_,i)=> ex.done?.[i] ?? null);
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
          ex.done = ex.done || [];
          ex.done[i] = v;
          save();
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

function metaText(ex){
  const parts = [`<span><strong>Series:</strong> ${ex.sets}</span>`];

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
      ex.done = (ex.done||[]).slice(0, ex.sets);
      while (ex.done.length < ex.sets) ex.done.push(null);
    } else {
      ex.done = [];
    }

    const editWrapper = box.parentElement;
    editWrapper?.classList.add("hidden");
    save(); renderDay(state.selectedDate);
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
  const list = state.workouts[dayISO] || [];
  const idx = list.findIndex(x=>x.id===id);
  if (idx>=0){
    list.splice(idx,1);
    state.workouts[dayISO] = list;
    save(); renderDay(dayISO); renderMiniCalendar();
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
  const items = (state.workouts[src]||[]).map(x=> ({
    ...x,
    id: crypto.randomUUID(),
    done: x.failure ? Array.from({length: x.sets}, ()=>null) : []
  }));
  state.workouts[dst] = (state.workouts[dst]||[]).concat(items);
  save();
  alert("Día copiado.");
  copyDayBox.classList.add("hidden");
  renderMiniCalendar();
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
    if ((state.workouts[dayISO]||[]).length) btn.classList.add("has");

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
