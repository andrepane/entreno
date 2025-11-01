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
const STORAGE_KEY = "workouts.v2";
const LEGACY_KEY = "workouts.v1";
// TODO: sincronizar entre dispositivos usando Firebase u otro backend.
let state = {
  selectedDate: fmt(new Date()),
  workouts: {} // { "YYYY-MM-DD": [exercise, ...] }
};

function load() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) raw = localStorage.getItem(LEGACY_KEY);
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
    goal: null,
    weightKg: formWeight.value ? Number(formWeight.value) : null
  };

  if (!ex.name) { alert("Pon un nombre al ejercicio."); return; }

  if (goalReps.checked) {
    ex.goal = "reps";
    ex.reps = formReps.value ? Number(formReps.value) : null;
    ex.failure = !!formFailure.checked;
    if (ex.failure) {
      ex.done = Array.from({length: ex.sets}, ()=>null);
    }
    if (!ex.failure && (!ex.reps || ex.reps<=0)) { alert("Indica un número de repeticiones mayor que cero."); return; }
    if (ex.reps!=null && ex.reps<=0) { alert("Indica un número de repeticiones mayor que cero."); return; }
  } else if (goalSecs.checked) {
    ex.goal = "seconds";
    ex.seconds = formSeconds.value ? Number(formSeconds.value) : null;
    ex.failure = !!formSecondsFailure.checked;
    if (ex.failure) {
      ex.done = Array.from({length: ex.sets}, ()=>null);
    }
    if (!ex.failure && (!ex.seconds || ex.seconds<=0)) { alert("Indica segundos mayores que cero."); return; }
    if (ex.seconds!=null && ex.seconds<=0) { alert("Indica segundos mayores que cero."); return; }
  } else {
    ex.goal = "emom";
    ex.emomMinutes = Number(formEmomMinutes.value||0);
    ex.emomReps = Number(formEmomReps.value||0);
    ex.failure = false;
    if (ex.emomMinutes<=0 || ex.emomReps<=0) { alert("Completa minutos y repeticiones por minuto (mayores que cero)."); return; }
  }

  if (ex.weightKg!=null && Number.isNaN(ex.weightKg)) {
    ex.weightKg = null;
  }

  if (!state.workouts[normalizedDay]) state.workouts[normalizedDay] = [];
  state.workouts[normalizedDay].push(ex);
  save();

  // Ajustar UI
  addForm.reset();
  updateGoalRows();
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

  let mutated = false;
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

    const editBox = document.createElement("div");
    editBox.className = "edit-box hidden";
    editBox.appendChild(buildEditForm(ex));

    editBtn.addEventListener("click", ()=>{
      editBox.classList.toggle("hidden");
    });
    delBtn.addEventListener("click", ()=>{
      if (!confirm("¿Eliminar este ejercicio?")) return;
      removeExercise(dayISO, ex.id);
    });

    const showDone = ex.failure && (ex.goal === "reps" || ex.goal === "seconds");
    if (showDone) {
      if (!Array.isArray(ex.done)) { ex.done = Array.from({length: ex.sets}, ()=>null); mutated = true; }
      if (ex.done.length > ex.sets) { ex.done.length = ex.sets; mutated = true; }
      while (ex.done.length < ex.sets) { ex.done.push(null); mutated = true; }

      const setsBox = document.createElement("div");
      setsBox.className = "sets-grid";
      for (let i=0;i<ex.sets;i++){
        const wrap = document.createElement("label");
        wrap.className = "field";
        const span = document.createElement("span");
        span.textContent = `Serie ${i+1}`;
        const input = document.createElement("input");
        input.type = "number";
        input.placeholder = ex.goal==="seconds" ? "seg" : "reps";
        input.value = ex.done?.[i] ?? "";
        input.addEventListener("change", ()=>{
          const v = input.value? Number(input.value) : null;
          ex.done = ex.done || [];
          ex.done[i] = v;
          save();
        });
        wrap.append(span, input);
        setsBox.append(wrap);
      }
      li.append(title, meta, setsBox, editBox);
    } else {
      if (Array.isArray(ex.done)) { delete ex.done; mutated = true; }
      li.append(title, meta, editBox);
    }
    exerciseList.append(li);
  });
  if (mutated) save();
}

function metaText(ex){
  const parts = [`${ex.sets} series`];

  if (ex.goal==="reps") {
    if (ex.reps && !ex.failure) parts.push(`${ex.sets} x ${ex.reps} reps`);
    else if (ex.reps && ex.failure) parts.push(`${ex.sets} x ${ex.reps} reps · al fallo`);
    else if (ex.failure) parts.push(`Al fallo`);
  } else if (ex.goal==="seconds") {
    if (ex.seconds && !ex.failure) parts.push(`${ex.sets} x ${ex.seconds}s`);
    else if (ex.seconds && ex.failure) parts.push(`${ex.sets} x ${ex.seconds}s · al fallo`);
    else if (ex.failure) parts.push(`Al fallo (segundos)`);
  } else if (ex.goal==="emom") {
    parts.push(`EMOM ${ex.emomMinutes}' x ${ex.emomReps} reps/min`);
  }

  if (ex.weightKg!=null) parts.push(`${ex.weightKg} kg`);
  return parts.map(t=>`<code>${t}</code>`).join(" · ");
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

  const initialFailure = !!ex.failure;

  const rowReps = document.createElement("div"); rowReps.className = "row indent";
  const repsField = fieldInline("Reps", "number", ex.reps ?? "", {min:1});
  const failRowReps = document.createElement("label"); failRowReps.className="row inline";
  const failChkReps = document.createElement("input"); failChkReps.type="checkbox"; failChkReps.checked = initialFailure;
  const failLblReps = document.createElement("span"); failLblReps.textContent="Al fallo";
  failRowReps.append(failChkReps, failLblReps);
  rowReps.append(repsField.wrap, failRowReps);

  const rowSecs = document.createElement("div"); rowSecs.className="row indent hidden";
  const secsField = fieldInline("Segundos", "number", ex.seconds ?? "", {min:1});
  const failRowSecs = document.createElement("label"); failRowSecs.className="row inline";
  const failChkSecs = document.createElement("input"); failChkSecs.type="checkbox"; failChkSecs.checked = initialFailure;
  const failLblSecs = document.createElement("span"); failLblSecs.textContent="Al fallo";
  failRowSecs.append(failChkSecs, failLblSecs);
  rowSecs.append(secsField.wrap, failRowSecs);

  failChkReps.addEventListener("change", ()=>{ failChkSecs.checked = failChkReps.checked; });
  failChkSecs.addEventListener("change", ()=>{ failChkReps.checked = failChkSecs.checked; });

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
      const failureReps = !!failChkReps.checked;
      if (!failureReps && (!ex.reps || ex.reps<=0)) { alert("Indica repeticiones mayores que cero."); return; }
      if (ex.reps!=null && ex.reps<=0) { alert("Indica repeticiones mayores que cero."); return; }
      ex.failure = failureReps;
      ex.seconds = null; ex.emomMinutes=null; ex.emomReps=null;
      if (ex.failure) {
        const prevDone = Array.isArray(ex.done) ? ex.done : [];
        ex.done = Array.from({length: ex.sets}, (_,i)=> prevDone[i] ?? null);
        if (ex.done.length > ex.sets) ex.done.length = ex.sets;
        while (ex.done.length < ex.sets) ex.done.push(null);
      } else {
        delete ex.done;
      }
    } else if (rSecs.input.checked){
      ex.goal="seconds";
      ex.seconds = secsField.input.value ? Number(secsField.input.value) : null;
      const failureSecs = !!failChkSecs.checked;
      if (!failureSecs && (!ex.seconds || ex.seconds<=0)) { alert("Indica segundos mayores que cero."); return; }
      if (ex.seconds!=null && ex.seconds<=0) { alert("Indica segundos mayores que cero."); return; }
      ex.reps = null; ex.emomMinutes=null; ex.emomReps=null;
      ex.failure = failureSecs;
      if (ex.failure) {
        const prevDone = Array.isArray(ex.done) ? ex.done : [];
        ex.done = Array.from({length: ex.sets}, (_,i)=> prevDone[i] ?? null);
        if (ex.done.length > ex.sets) ex.done.length = ex.sets;
        while (ex.done.length < ex.sets) ex.done.push(null);
      } else {
        delete ex.done;
      }
    } else {
      ex.goal="emom";
      ex.emomMinutes = Number(mField.input.value||0);
      ex.emomReps = Number(rField.input.value||0);
      if (ex.emomMinutes<=0 || ex.emomReps<=0) { alert("Completa minutos y repeticiones por minuto (mayores que cero)."); return; }
      ex.reps = null; ex.failure=false; ex.seconds=null;
      delete ex.done;
    }

    const weightValue = wField.input.value.trim();
    ex.weightKg = weightValue === "" ? null : Number(weightValue);
    if (ex.weightKg!=null && Number.isNaN(ex.weightKg)) ex.weightKg = null;

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
  const items = (state.workouts[src]||[]).map(x=> {
    const clone = {...x, id: crypto.randomUUID()};
    if (clone.failure && (clone.goal === "reps" || clone.goal === "seconds")) {
      clone.done = Array.from({length: clone.sets}, ()=>null);
    } else {
      delete clone.done;
    }
    return clone;
  });
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
