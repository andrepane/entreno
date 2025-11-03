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
let state = {
  selectedDate: fmt(new Date()),
  workouts: {} // { "YYYY-MM-DD": [exercise, ...] }
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
        return {
          ...exercise,
          category: normalizeCategory(exercise.category),
          done: Array.isArray(exercise.done) ? exercise.done : [],
          completed: !!exercise.completed,
          note: typeof exercise.note === "string" ? exercise.note : "",
          cardioMinutes: Number.isFinite(cardioMinutesRaw) ? cardioMinutesRaw : null
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
const normalizedWorkouts = normalizeWorkouts(state.workouts);
const normalizedWorkoutsJSON = JSON.stringify(normalizedWorkouts);
state.workouts = normalizedWorkouts;

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
if (originalWorkoutsJSON !== normalizedWorkoutsJSON || resetToToday) {
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

addForm.addEventListener("reset", () => {
  requestAnimationFrame(() => {
    formCategory.value = CATEGORY_KEYS[0];
    updateGoalRows();
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
    note: "",
    category: normalizeCategory(formCategory.value)
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
  recordHistoryFromExercise(normalizedDay, ex, { showToast: true });

  // Ajustar UI
  formName.value = "";
  formFailure.checked = false;
  formSecondsFailure.checked = false;
  formCategory.value = CATEGORY_KEYS[0];
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
});

/* ========= Render ========= */
function renderAll(){
  renderDay(state.selectedDate);
  renderMiniCalendar();
  if (seguimientoModule?.refresh) {
    seguimientoModule.refresh();
  }
}

function renderDay(dayISO){
  const source = Array.isArray(state.workouts?.[dayISO]) ? state.workouts[dayISO] : [];
  const list = source.filter(isPlainObject);
  humanDateSpan.textContent = toHuman(dayISO);
  exerciseList.innerHTML = "";
  emptyDayHint.style.display = list.length ? "none" : "block";

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
        recordHistoryFromExercise(dayISO, ex, { showToast: true });
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
      recordHistoryFromExercise(dayISO, ex, { showToast: false });
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
        recordHistoryFromExercise(dayISO, ex, { showToast: false });
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
          recordHistoryFromExercise(dayISO, ex, { showToast: true });
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

    li.append(categoryTag, title, meta, noteBox);
    if (setsBox) li.append(setsBox);
    exerciseList.append(li);
    setupExerciseDrag(li, dayISO);

  });
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
    originalTouchAction: source.style ? source.style.touchAction : undefined
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

function updateDragPosition(event){
  if (!activeDrag) return;
  const listRect = exerciseList.getBoundingClientRect();
  const top = event.clientY - listRect.top - activeDrag.offsetY;
  const maxTop = Math.max(0, exerciseList.scrollHeight - activeDrag.placeholder.offsetHeight);
  const clampedTop = Math.min(Math.max(top, 0), maxTop);
  activeDrag.li.style.top = `${clampedTop}px`;

  const siblings = Array.from(exerciseList.children).filter((child) => child !== activeDrag.li && child !== activeDrag.placeholder);
  let inserted = false;
  for (const sibling of siblings){
    const rect = sibling.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2){
      exerciseList.insertBefore(activeDrag.placeholder, sibling);
      inserted = true;
      break;
    }
  }
  if (!inserted){
    exerciseList.appendChild(activeDrag.placeholder);
  }
}

function finishExerciseDrag(commit){
  if (!activeDrag) return;
  const { li, placeholder, source, pointerId, dayISO, originalNextSibling, originalTouchAction } = activeDrag;

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

function sumNumbers(values){
  if (!Array.isArray(values)) return 0;
  return values.reduce((acc, current) => {
    const num = Number(current);
    return Number.isFinite(num) ? acc + num : acc;
  }, 0);
}

function computeHistoryEntries(dayISO, exercise){
  if (!historyStore || !exercise || !exercise.name) return [];
  const ejercicio = exercise.name.trim();
  if (!ejercicio) return [];

  const entries = [];
  const weightValue = Number(exercise.weightKg);
  const hasWeight = Number.isFinite(weightValue) && weightValue > 0;
  const generalNotes = [];
  if (exercise.failure) generalNotes.push("al fallo");
  if (exercise.note && exercise.note.trim()) generalNotes.push(exercise.note.trim());
  const weightNote = hasWeight ? `lastre ${weightValue} kg` : null;

  const pushEntry = (tipo, valor, extraNotes = []) => {
    const num = Number(valor);
    if (!Number.isFinite(num) || num <= 0) return;
    const notes = [];
    if (tipo !== "peso" && weightNote) notes.push(weightNote);
    notes.push(...extraNotes.filter(Boolean));
    notes.push(...generalNotes);
    const notasText = notes.filter(Boolean).join(" · ") || undefined;
    entries.push({
      fechaISO: dayISO,
      ejercicio,
      tipo,
      valor: num,
      notas: notasText
    });
  };

  const sets = Math.max(1, Number(exercise.sets || 1));
  const doneValues = Array.isArray(exercise.done) ? exercise.done : [];
  const hasDoneValues = doneValues.some((v) => Number.isFinite(Number(v)));

  if (exercise.goal === "reps" || exercise.goal === "emom"){
    let totalReps = 0;
    if (exercise.goal === "emom"){
      const minutes = Number(exercise.emomMinutes || 0);
      const repsPerMinute = Number(exercise.emomReps || 0);
      if (minutes > 0 && repsPerMinute > 0){
        totalReps = minutes * repsPerMinute;
      }
    } else if (hasDoneValues){
      totalReps = sumNumbers(doneValues);
    } else if (Number.isFinite(Number(exercise.reps))){
      const planned = Number(exercise.reps);
      if (planned > 0){
        totalReps = planned * sets;
      }
    }
    if (totalReps > 0){
      pushEntry("reps", totalReps);
    }
  }

  if (exercise.goal === "seconds"){
    let totalSeconds = 0;
    if (hasDoneValues){
      totalSeconds = sumNumbers(doneValues);
    } else if (Number.isFinite(Number(exercise.seconds))){
      const secs = Number(exercise.seconds);
      if (secs > 0){
        totalSeconds = secs * sets;
      }
    }
    if (totalSeconds > 0){
      pushEntry("tiempo", totalSeconds);
    }
  }

  if (exercise.goal === "cardio"){
    const minutes = Number(exercise.cardioMinutes || 0);
    const seconds = minutesToSeconds(minutes * sets);
    if (seconds > 0){
      pushEntry("tiempo", seconds);
    }
  }

  if (hasWeight){
    pushEntry("peso", weightValue, [weightNote]);
  }

  return entries;
}

function recordHistoryFromExercise(dayISO, exercise, options = {}){
  if (!historyStore || !exercise) return;
  const nombre = exercise.name ? exercise.name.trim() : "";
  if (!nombre) return;

  const previousName = options.previousName && options.previousName.trim();
  if (previousName && previousName !== nombre){
    ["reps", "tiempo", "peso"].forEach((tipo)=>{
      historyStore
        .getEntriesByExerciseAndType(previousName, tipo)
        .filter((item)=> item.fechaISO === dayISO)
        .forEach((item)=> historyStore.updateEntry(item.id, { ejercicio: nombre }));
    });
  }

  const computed = computeHistoryEntries(dayISO, { ...exercise, name: nombre });
  const expectedTypes = new Set(computed.map((entry) => entry.tipo));
  const processedIds = new Set();

  computed.forEach((entry) => {
    const existing = historyStore
      .getEntriesByExerciseAndType(nombre, entry.tipo)
      .find((item) => item.fechaISO === entry.fechaISO);
    if (existing){
      const updated = historyStore.updateEntry(existing.id, {
        fechaISO: entry.fechaISO,
        valor: entry.valor,
        notas: entry.notas ?? "",
        ejercicio: nombre
      });
      if (updated) processedIds.add(updated.id);
    } else {
      const diff = historyStore.compareWithLast(nombre, entry.tipo, entry.valor);
      const created = historyStore.addEntry(entry);
      processedIds.add(created.id);
      if (options.showToast !== false && diff?.message){
        showHistoryToast(diff.message);
      }
    }
  });

  ["reps", "tiempo", "peso"].forEach((tipo)=>{
    if (expectedTypes.has(tipo)) return;
    historyStore
      .getEntriesByExerciseAndType(nombre, tipo)
      .filter((item)=> item.fechaISO === dayISO && !processedIds.has(item.id))
      .forEach((item)=> historyStore.deleteEntry(item.id));
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
  const previousName = ex.name;

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
    recordHistoryFromExercise(state.selectedDate, ex, { showToast: false, previousName });
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
    const removed = list[idx];
    list.splice(idx,1);
    state.workouts[dayISO] = list;
    if (historyStore && removed?.name){
      const nombre = removed.name.trim();
      if (nombre){
        ["reps", "tiempo", "peso"].forEach((tipo)=>{
          historyStore
            .getEntriesByExerciseAndType(nombre, tipo)
            .filter((entry)=> entry.fechaISO === dayISO)
            .forEach((entry)=> historyStore.deleteEntry(entry.id));
        });
      }
    }
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
