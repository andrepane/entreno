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
const STORAGE_APPROX_MAX_BYTES = 5 * 1024 * 1024; // NEW: Máximo aproximado permitido en localStorage
const STORAGE_WARN_THRESHOLD_BYTES = 4.5 * 1024 * 1024; // NEW: Umbral para mostrar alerta visual de almacenamiento
const STORAGE_SAVE_ERROR_MESSAGE =
  "No se pudo guardar tu entrenamiento en este dispositivo. Comprueba si el modo privado está activado o libera espacio y vuelve a intentarlo.";
const FIREBASE_COLLECTION = "workouts";
const FIREBASE_DOC_VERSION = 1;
let storageWarningEl = null;
let storageSaveFailed = false;
let lastStorageUsageBytes = 0; // NEW: Seguimiento del uso estimado de localStorage en bytes
let firebaseApp = null;
let firebaseDb = null;
let firebaseDocRef = null;
let firebaseUnsubscribe = null;
let firebaseSaveTimeout = null;
let firebaseReady = false;
const CATEGORY_KEYS = ["calistenia", "musculacion", "piernas", "cardio", "skill", "movilidad", "otro"];
const CATEGORY_LABELS = {
  calistenia: "Calistenia",
  musculacion: "Musculación",
  piernas: "Piernas",
  cardio: "Cardio",
  skill: "Skill",
  movilidad: "Movilidad",
  otro: "Otro",
};
const EQUIPMENT_KEYS = ["ninguno", "barra", "mancuernas", "anillas", "banda", "maquina", "polea", "paralelas"];
const EQUIPMENT_LABELS = {
  ninguno: "Sin equipo",
  barra: "Barra",
  mancuernas: "Mancuernas",
  anillas: "Anillas",
  banda: "Bandas",
  maquina: "Máquina",
  polea: "Polea",
  paralelas: "Paralelas",
};
const THEME_KEYS = ["neon", "solar", "aurora"];
const LEVEL_KEYS = ["principiante", "intermedio", "avanzado"];
const LEVEL_LABELS = {
  principiante: "Principiante",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
};
const GOAL_KEYS = ["fuerza", "hipertrofia", "resistencia", "skill", "movilidad"];
const GOAL_LABELS = {
  fuerza: "Fuerza",
  hipertrofia: "Hipertrofia",
  resistencia: "Resistencia",
  skill: "Skill",
  movilidad: "Movilidad",
};
const PHASE_KEYS = ["base", "intensificacion", "descarga"];
const PHASE_LABELS = {
  base: "Base",
  intensificacion: "Intensificación",
  descarga: "Descarga",
};

const WEEK_TYPE_KEYS = ["normal", "carga", "descarga"];
const WEEK_TYPE_LABELS = {
  normal: "Normal",
  carga: "Carga",
  descarga: "Descarga",
};

const EXERCISE_STATUS = {
  PENDING: "pending",
  DONE: "done",
  NOT_DONE: "not_done",
};

const EXERCISE_STATUS_LABELS = {
  [EXERCISE_STATUS.PENDING]: "Pendiente",
  [EXERCISE_STATUS.DONE]: "Completado",
  [EXERCISE_STATUS.NOT_DONE]: "No hecho",
};

const EXERCISE_STATUS_ALIASES = new Map([
  ["done", EXERCISE_STATUS.DONE],
  ["hecho", EXERCISE_STATUS.DONE],
  ["completado", EXERCISE_STATUS.DONE],
  ["completed", EXERCISE_STATUS.DONE],
  ["ok", EXERCISE_STATUS.DONE],
  ["listo", EXERCISE_STATUS.DONE],
  ["terminado", EXERCISE_STATUS.DONE],
  ["pending", EXERCISE_STATUS.PENDING],
  ["pendiente", EXERCISE_STATUS.PENDING],
  ["planificado", EXERCISE_STATUS.PENDING],
  ["planificada", EXERCISE_STATUS.PENDING],
  ["sin hacer", EXERCISE_STATUS.PENDING],
  ["not_done", EXERCISE_STATUS.NOT_DONE],
  ["not done", EXERCISE_STATUS.NOT_DONE],
  ["no hecho", EXERCISE_STATUS.NOT_DONE],
  ["no-hecho", EXERCISE_STATUS.NOT_DONE],
  ["no realizado", EXERCISE_STATUS.NOT_DONE],
  ["omitido", EXERCISE_STATUS.NOT_DONE],
  ["omitida", EXERCISE_STATUS.NOT_DONE],
  ["saltado", EXERCISE_STATUS.NOT_DONE],
  ["saltada", EXERCISE_STATUS.NOT_DONE],
  ["fallado", EXERCISE_STATUS.NOT_DONE],
  ["fallida", EXERCISE_STATUS.NOT_DONE],
  ["skipped", EXERCISE_STATUS.NOT_DONE],
  ["skip", EXERCISE_STATUS.NOT_DONE],
]);

const FIREBASE_DOC_ID = "shared";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function getInputValue(input) {
  return input && typeof input.value === "string" ? input.value : "";
}

function getTrimmedValue(input) {
  return getInputValue(input).trim();
}

function isChecked(input) {
  return !!(input && input.checked);
}

function formatWeightOption(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildWeightOptions(select, { includeEmpty = true, emptyLabel = "Sin lastre" } = {}) {
  if (!select) return;
  select.innerHTML = "";
  if (includeEmpty) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = emptyLabel;
    select.append(emptyOption);
  }
  for (let i = 0; i <= 400; i += 1) {
    const weight = i / 2;
    const value = formatWeightOption(weight);
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${value} kg`;
    select.append(option);
  }
}

function setWeightSelectValue(select, value) {
  if (!select) return;
  if (!hasValue(value) || value === "") {
    select.value = "";
    return;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    select.value = "";
    return;
  }
  const formatted = formatWeightOption(numeric);
  const hasOption = Array.from(select.options).some((option) => option.value === formatted);
  if (!hasOption) {
    const option = document.createElement("option");
    option.value = formatted;
    option.textContent = `${formatted} kg`;
    select.append(option);
  }
  select.value = formatted;
}

function normalizeExerciseStatus(rawStatus, fallbackCompleted, fallbackHecho) {
  if (typeof rawStatus === "string") {
    const normalized = rawStatus.trim().toLowerCase();
    if (EXERCISE_STATUS_ALIASES.has(normalized)) {
      return EXERCISE_STATUS_ALIASES.get(normalized);
    }
  }

  const truthy = (value) => {
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return ["true", "1", "sí", "si", "hecho", "done", "completado", "completed"].includes(normalized);
    }
    return false;
  };

  if (truthy(fallbackCompleted) || truthy(fallbackHecho)) {
    return EXERCISE_STATUS.DONE;
  }

  return EXERCISE_STATUS.PENDING;
}

function getExerciseStatus(exercise) {
  if (!exercise || typeof exercise !== "object") {
    return EXERCISE_STATUS.PENDING;
  }
  const status = exercise.status;
  const normalized = normalizeExerciseStatus(status, exercise.completed, exercise.hecho);
  if (!Object.values(EXERCISE_STATUS).includes(normalized)) {
    return EXERCISE_STATUS.PENDING;
  }
  return normalized;
}

function setExerciseStatus(exercise, status) {
  const normalized = Object.values(EXERCISE_STATUS).includes(status)
    ? status
    : EXERCISE_STATUS.PENDING;
  if (exercise && typeof exercise === "object") {
    exercise.status = normalized;
    exercise.completed = normalized === EXERCISE_STATUS.DONE;
    exercise.hecho = normalized === EXERCISE_STATUS.DONE;
  }
  return normalized;
}

function isExerciseDone(exercise) {
  return getExerciseStatus(exercise) === EXERCISE_STATUS.DONE;
}

function isExerciseNotDone(exercise) {
  return getExerciseStatus(exercise) === EXERCISE_STATUS.NOT_DONE;
}

let state = {
  selectedDate: fmt(new Date()),
  workouts: {}, // { "YYYY-MM-DD": [exercise, ...] }
  dayMeta: {},
  weekTypes: {},
  futureExercises: [],
  libraryExercises: [],
  plannedExercises: [],
  templates: [],
  globalNotes: [],
  settings: {
    theme: "neon",
    density: "normal",
    fontSize: "normal",
    highContrast: false,
    reduceMotion: false,
    autoPruneOldIcons: false,
  },
  lastModifiedAt: null,
};

const dayMultiSelect = {
  active: false,
  selected: new Set(),
  targets: [],
};

const libraryMultiSelect = {
  active: false,
  selected: new Set(),
  targets: [],
};

const emomInstances = new Map();
let emomIntervalId = null;
let emomSaveTimeout = null;

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const ICON_PRUNE_LIMIT_DAYS = (() => {
  const value =
    globalThis.iconPrune && Number.isFinite(globalThis.iconPrune.ICON_PRUNE_LIMIT_DAYS)
      ? globalThis.iconPrune.ICON_PRUNE_LIMIT_DAYS
      : 14;
  return value > 0 ? value : 14;
})();

function isDayOlderThanIconPruneLimit(dayISO, referenceDate = new Date()) {
  if (globalThis.iconPrune && typeof globalThis.iconPrune.isDayOlderThanIconPruneLimit === "function") {
    return globalThis.iconPrune.isDayOlderThanIconPruneLimit(dayISO, referenceDate, ICON_PRUNE_LIMIT_DAYS);
  }
  if (!dayISO) return false;
  const dayDate = fromISO(dayISO);
  const reference = new Date(referenceDate);
  reference.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((reference - dayDate) / (24 * 60 * 60 * 1000));
  return diffDays > ICON_PRUNE_LIMIT_DAYS;
}

function shouldIgnoreLibraryIconsForDay(dayISO) {
  if (!state.settings.autoPruneOldIcons) return false;
  return isDayOlderThanIconPruneLimit(dayISO);
}

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
        const inferredStatus = normalizeExerciseStatus(
          typeof exercise.status === "string" ? exercise.status : exercise.estado,
          exercise.completed,
          exercise.hecho
        );
        const status = Object.values(EXERCISE_STATUS).includes(inferredStatus)
          ? inferredStatus
          : EXERCISE_STATUS.PENDING;
        const rawIconType = typeof exercise.iconType === "string" ? exercise.iconType.toLowerCase() : "";
        let iconType = ["emoji", "image", "asset"].includes(rawIconType) ? rawIconType : "";
        const emoji = typeof exercise.emoji === "string" ? exercise.emoji.trim() : "";
        const imageDataUrl = typeof exercise.imageDataUrl === "string" ? exercise.imageDataUrl : "";
        const iconName = typeof exercise.iconName === "string" ? exercise.iconName.trim() : "";
        if (iconType === "asset" && !iconName) {
          iconType = "";
        }
        if (iconType === "image" && !imageDataUrl) {
          iconType = "";
        }
        if (!iconType) {
          if (iconName) {
            iconType = "asset";
          } else if (imageDataUrl) {
            iconType = "image";
          } else if (emoji) {
            iconType = "emoji";
          } else {
            iconType = "emoji";
          }
        }
        return {
          ...exercise,
          category: normalizeCategory(exercise.category),
          done: Array.isArray(exercise.done) ? exercise.done : [],
          status,
          completed: status === EXERCISE_STATUS.DONE,
          hecho: status === EXERCISE_STATUS.DONE,
          note: typeof exercise.note === "string" ? exercise.note : "",
          cardioMinutes: Number.isFinite(cardioMinutesRaw) ? cardioMinutesRaw : null,
          perceivedEffort: Number.isFinite(perceivedRaw) && perceivedRaw >= 1 && perceivedRaw <= 10 ? Math.round(perceivedRaw) : null,
          iconType,
          emoji: iconType === "emoji" ? emoji : "",
          imageDataUrl: iconType === "image" ? imageDataUrl : "",
          iconName: iconType === "asset" ? iconName : "",
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

function getWeekStartISO(dayISO){
  const d = fromISO(dayISO);
  const isoDay = (d.getDay() + 6) % 7; // Lunes = 0
  d.setDate(d.getDate() - isoDay);
  return fmt(d);
}

function getWeekEndISO(weekStartISO){
  const end = fromISO(weekStartISO);
  end.setDate(end.getDate() + 6);
  return fmt(end);
}

function normalizeWeekTypes(raw){
  if (!isPlainObject(raw)) return {};
  const normalized = {};
  Object.entries(raw).forEach(([week, value]) => {
    const weekISO = fmt(fromISO(week));
    const type = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (WEEK_TYPE_KEYS.includes(type)) {
      normalized[weekISO] = type;
    }
  });
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

const GOAL_TYPES = ["reps", "isometrico", "fallo", "emom", "cardio"];

function normalizeGoalType(value){
  const key = (value || "").toString().toLowerCase();
  return GOAL_TYPES.includes(key) ? key : "reps";
}

function getExerciseGoalType(exercise){
  if (!exercise || typeof exercise !== "object") return "reps";
  if (exercise.goalType) return normalizeGoalType(exercise.goalType);
  if (exercise.goal === "seconds") return "isometrico";
  if (exercise.goal === "emom") return "emom";
  if (exercise.goal === "cardio") return "cardio";
  if (exercise.goal === "fallo") return "fallo";
  return "reps";
}

function getEmomTotalSeconds(exercise){
  const minutes = Number(exercise && exercise.emomMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round(minutes * 60);
}

function resetEmomTimerState(exercise){
  const totalSeconds = getEmomTotalSeconds(exercise);
  const totalMinutes = totalSeconds ? Math.ceil(totalSeconds / 60) : 0;
  const timer = {
    remainingSeconds: totalSeconds,
    currentMinute: totalMinutes ? 1 : 0,
    repsThisMinute: 0,
    isRunning: false,
    lastTick: null,
  };
  if (exercise && typeof exercise === "object") {
    exercise.emomTimer = timer;
  }
  return timer;
}

function ensureEmomTimerState(exercise){
  if (!exercise || typeof exercise !== "object") return null;
  const totalSeconds = getEmomTotalSeconds(exercise);
  const totalMinutes = totalSeconds ? Math.ceil(totalSeconds / 60) : 0;
  if (!isPlainObject(exercise.emomTimer)) {
    return resetEmomTimerState(exercise);
  }
  const timer = exercise.emomTimer;
  const remaining = Number(timer.remainingSeconds);
  timer.remainingSeconds = Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : totalSeconds;
  if (totalSeconds && timer.remainingSeconds > totalSeconds) {
    timer.remainingSeconds = totalSeconds;
  }
  const derivedMinute = totalMinutes
    ? Math.min(totalMinutes, Math.floor((totalSeconds - timer.remainingSeconds) / 60) + 1)
    : 0;
  const current = Number(timer.currentMinute);
  timer.currentMinute = totalMinutes
    ? Math.min(totalMinutes, Math.max(1, Number.isFinite(current) ? Math.floor(current) || derivedMinute : derivedMinute))
    : 0;
  const reps = Number(timer.repsThisMinute);
  timer.repsThisMinute = Number.isFinite(reps) && reps >= 0 ? Math.floor(reps) : 0;
  timer.isRunning = !!timer.isRunning;
  timer.lastTick = Number.isFinite(timer.lastTick) ? timer.lastTick : null;
  if (!totalSeconds) {
    timer.remainingSeconds = 0;
    timer.currentMinute = 0;
    timer.repsThisMinute = 0;
    timer.isRunning = false;
    timer.lastTick = null;
  } else if (timer.isRunning && !timer.lastTick) {
    timer.lastTick = Date.now();
  }
  return timer;
}

function formatEmomTime(totalSeconds){
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeTags(input){
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function extractInitials(name){
  if (!name) return "";
  const parts = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase());
  return parts.join("") || name.charAt(0).toUpperCase();
}

function addTargetToList(list, iso){
  if (!Array.isArray(list)) return false;
  if (!iso) return false;
  if (list.includes(iso)) return false;
  list.push(iso);
  list.sort();
  return true;
}

function removeTargetFromList(list, iso){
  if (!Array.isArray(list)) return false;
  const index = list.indexOf(iso);
  if (index === -1) return false;
  list.splice(index, 1);
  return true;
}

function normalizeLibraryExercises(rawList){
  if (!Array.isArray(rawList)) return [];
  const normalized = [];
  const seen = new Set();
  rawList.forEach((item) => {
    if (!isPlainObject(item)) return;
    const id = typeof item.id === "string" && item.id ? item.id : randomUUID();
    if (seen.has(id)) return;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) return;
    const category = normalizeCategory(item.category);
    const rawIconType = typeof item.iconType === "string" ? item.iconType.toLowerCase() : "";
    let iconType = ["emoji", "image", "asset"].includes(rawIconType) ? rawIconType : "";
    const emoji = typeof item.emoji === "string" ? item.emoji.trim() : "";
    const imageDataUrl = typeof item.imageDataUrl === "string" ? item.imageDataUrl : "";
    const iconName = typeof item.iconName === "string" ? item.iconName.trim() : "";
    if (iconType === "asset" && !iconName) {
      iconType = "";
    }
    if (iconType === "image" && !imageDataUrl) {
      iconType = "";
    }
    if (!iconType) {
      if (iconName) {
        iconType = "asset";
      } else if (imageDataUrl) {
        iconType = "image";
      } else if (emoji) {
        iconType = "emoji";
      } else {
        iconType = "emoji";
      }
    }
    const notes = typeof item.notes === "string" ? item.notes : "";
    const tags = normalizeTags(item.tags);
    const equipment = EQUIPMENT_KEYS.includes(item.equipment) ? item.equipment : "ninguno";
    const level = LEVEL_KEYS.includes(item.level) ? item.level : "principiante";
    const goal = GOAL_KEYS.includes(item.goal) ? item.goal : "fuerza";
    normalized.push({
      id,
      name,
      category,
      iconType,
      emoji: iconType === "emoji" ? emoji || "" : "",
      imageDataUrl: iconType === "image" ? imageDataUrl : "",
      iconName: iconType === "asset" ? iconName : "",
      notes,
      tags,
      equipment,
      level,
      goal,
    });
    seen.add(id);
  });
  return normalized;
}

function normalizeTemplates(rawList){
  if (!Array.isArray(rawList)) return [];
  const normalized = [];
  const seen = new Set();
  rawList.forEach((item) => {
    if (!isPlainObject(item)) return;
    const id = typeof item.id === "string" && item.id ? item.id : randomUUID();
    if (seen.has(id)) return;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) return;
    const exercises = Array.isArray(item.exercises)
      ? item.exercises.filter(isPlainObject).map((exercise) => ({
        ...exercise,
        id: randomUUID(),
        plannedId: randomUUID(),
        done: [],
        status: EXERCISE_STATUS.PENDING,
        completed: false,
        hecho: false,
      }))
      : [];
    normalized.push({
      id,
      name,
      exercises,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    });
    seen.add(id);
  });
  return normalized;
}

function normalizeGlobalNotes(rawList){
  if (!Array.isArray(rawList)) return [];
  const normalized = [];
  const seen = new Set();
  rawList.forEach((entry) => {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (!text) return;
      normalized.push({
        id: randomUUID(),
        text,
        done: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if (!isPlainObject(entry)) return;
    const id = typeof entry.id === "string" && entry.id ? entry.id : randomUUID();
    if (seen.has(id)) return;
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (!text) return;
    normalized.push({
      id,
      text,
      done: !!entry.done,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
    });
    seen.add(id);
  });
  return normalized;
}

function normalizeSettings(rawSettings){
  const settings = isPlainObject(rawSettings) ? rawSettings : {};
  const themeRaw = typeof settings.theme === "string" ? settings.theme.toLowerCase() : "";
  const densityRaw = typeof settings.density === "string" ? settings.density.toLowerCase() : "";
  const fontSizeRaw = typeof settings.fontSize === "string" ? settings.fontSize.toLowerCase() : "";
  let theme = "neon";
  if (THEME_KEYS.includes(themeRaw)) {
    theme = themeRaw;
  } else if (themeRaw === "light") {
    theme = "solar";
  } else if (themeRaw === "dark" || themeRaw === "auto") {
    theme = "neon";
  }
  const density = ["compact", "normal", "spacious"].includes(densityRaw) ? densityRaw : "normal";
  const fontSize = ["small", "normal", "large"].includes(fontSizeRaw) ? fontSizeRaw : "normal";
  const highContrast = !!settings.highContrast;
  const reduceMotion = !!settings.reduceMotion;
  const autoPruneOldIcons = !!settings.autoPruneOldIcons;
  return {
    theme,
    density,
    fontSize,
    highContrast,
    reduceMotion,
    autoPruneOldIcons,
  };
}

function cloneExerciseForTemplate(exercise) {
  if (!isPlainObject(exercise)) return null;
  const base = { ...exercise };
  base.id = randomUUID();
  base.plannedId = randomUUID();
  base.done = [];
  base.status = EXERCISE_STATUS.PENDING;
  base.completed = false;
  base.hecho = false;
  return base;
}

function buildTemplateFromDay(dayISO, name) {
  const exercises = getDayExercises(dayISO).map(cloneExerciseForTemplate).filter(Boolean);
  return {
    id: randomUUID(),
    name,
    exercises,
    createdAt: new Date().toISOString(),
  };
}

function formatTemplateMeta(template) {
  if (!template || !template.createdAt) return "";
  const date = new Date(template.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function normalizePlannedExercises(rawList){
  if (!Array.isArray(rawList)) return [];
  const normalized = [];
  const seen = new Set();
  rawList.forEach((item) => {
    if (!isPlainObject(item)) return;
    const id = typeof item.id === "string" && item.id ? item.id : randomUUID();
    if (seen.has(id)) return;
    const dateISO = fmt(fromISO(item.dateISO));
    const goalType = normalizeGoalType(item.goalType);
    const entry = {
      id,
      libraryId: typeof item.libraryId === "string" ? item.libraryId : "",
      dateISO,
      goalType,
      series: item.series != null ? Math.max(1, Number(item.series) || 1) : null,
      reps: item.reps != null ? Number(item.reps) : null,
      segundos: item.segundos != null ? Number(item.segundos) : null,
      minutos: item.minutos != null ? Number(item.minutos) : null,
      repsPorMin: item.repsPorMin != null ? Number(item.repsPorMin) : null,
      alFallo: !!item.alFallo,
      lastreKg: item.lastreKg != null && item.lastreKg !== "" ? Number(item.lastreKg) : null,
      notes: typeof item.notes === "string" ? item.notes : "",
      phase: typeof item.phase === "string" ? item.phase : undefined,
    };
    normalized.push(entry);
    seen.add(id);
  });
  return normalized;
}

function buildPlannedFromWorkouts(){
  const planned = [];
  Object.entries(state.workouts || {}).forEach(([dateISO, list]) => {
    if (!Array.isArray(list)) return;
    list.forEach((exercise) => {
      if (!isPlainObject(exercise)) return;
      const goalType = exercise.goalType ? normalizeGoalType(exercise.goalType) : (() => {
        if (exercise.goal === "seconds") return "isometrico";
        if (exercise.goal === "emom") return "emom";
        if (exercise.goal === "cardio") return "cardio";
        if (exercise.goal === "fallo") return "fallo";
        if (exercise.failure && !exercise.reps) return "fallo";
        return "reps";
      })();
      planned.push({
        id: typeof exercise.plannedId === "string" && exercise.plannedId ? exercise.plannedId : (exercise.id || randomUUID()),
        libraryId: typeof exercise.libraryId === "string" ? exercise.libraryId : "",
        dateISO: fmt(fromISO(dateISO)),
        goalType,
        series: Number.isFinite(Number(exercise.sets)) ? Number(exercise.sets) : null,
        reps: Number.isFinite(Number(exercise.reps)) ? Number(exercise.reps) : null,
        segundos: Number.isFinite(Number(exercise.seconds)) ? Number(exercise.seconds) : null,
        minutos: (() => {
          if (goalType === "cardio") return Number(exercise.cardioMinutes) || null;
          if (goalType === "emom") return Number(exercise.emomMinutes) || null;
          return null;
        })(),
        repsPorMin: goalType === "emom" ? Number(exercise.emomReps) || null : null,
        alFallo: !!exercise.failure,
        lastreKg: exercise.weightKg != null && exercise.weightKg !== "" ? Number(exercise.weightKg) : null,
        notes: typeof exercise.note === "string" ? exercise.note : "",
        phase: undefined,
      });
    });
  });
  return planned;
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
    callSeguimiento("refresh");
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

function getWeekType(dayISO){
  const weekKey = getWeekStartISO(dayISO);
  const type = state.weekTypes && state.weekTypes[weekKey];
  return WEEK_TYPE_KEYS.includes(type) ? type : "normal";
}

function setWeekType(dayISO, type){
  if (!state.weekTypes) state.weekTypes = {};
  const weekKey = getWeekStartISO(dayISO);
  const normalized = WEEK_TYPE_KEYS.includes(type) ? type : "normal";
  if (state.weekTypes[weekKey] === normalized) return normalized;
  state.weekTypes[weekKey] = normalized;
  save();
  renderMiniCalendar();
  return normalized;
}

function clearWeekType(dayISO){
  if (!state.weekTypes) return;
  const weekKey = getWeekStartISO(dayISO);
  if (state.weekTypes[weekKey]) {
    delete state.weekTypes[weekKey];
    save();
    renderMiniCalendar();
  }
}

function clearStorageWarning() {
  if (!storageWarningEl) return;
  storageWarningEl.textContent = "";
  storageWarningEl.classList.add("hidden");
}

function showStorageWarning(message) {
  if (!storageWarningEl) return;
  storageWarningEl.textContent = message;
  storageWarningEl.classList.remove("hidden");
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        state = { ...state, ...parsed };
      } else {
        console.warn("Se ignoró un estado almacenado inválido", parsed);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (removeErr) {
          console.warn("No se pudo limpiar el estado almacenado inválido", removeErr);
        }
      }
    }
  } catch(e){ console.warn("Error loading storage", e); }
}
// NEW: Calcula el espacio estimado utilizado en localStorage y devuelve un string humanizado
function estimateLocalStorageUsage() {
  if (typeof localStorage === "undefined" || localStorage === null) {
    lastStorageUsageBytes = 0; // NEW: Reinicia el uso registrado cuando localStorage no está disponible
    return "0 KB"; // NEW: Valor por defecto cuando no se puede acceder a localStorage
  }
  let totalBytes = 0; // NEW: Acumulador de bytes estimados
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || ""; // NEW: Obtiene la clave actual o string vacío
    const value = localStorage.getItem(key) || ""; // NEW: Obtiene el valor asociado o string vacío
    totalBytes += (key.length + value.length) * 2; // NEW: Suma longitud total en bytes (UTF-16 ~2 bytes por carácter)
  }
  lastStorageUsageBytes = totalBytes; // NEW: Actualiza el valor global para que showStorageUsage conozca los bytes estimados
  if (totalBytes >= 1024 * 1024) {
    const mb = totalBytes / (1024 * 1024); // NEW: Conversión a megabytes
    return `${mb.toFixed(2)} MB`; // NEW: Representación humanizada en MB
  }
  const kb = totalBytes / 1024; // NEW: Conversión a kilobytes
  return `${kb.toFixed(1)} KB`; // NEW: Representación humanizada en KB
}
// NEW: Muestra o actualiza un badge visible con el uso aproximado del almacenamiento local
function showStorageUsage() {
  const usageLabel = estimateLocalStorageUsage(); // NEW: Obtiene el texto humanizado del espacio utilizado
  let storageInfoEl = document.getElementById("storage-info"); // NEW: Localiza el nodo existente (si lo hay)
  if (!storageInfoEl) {
    storageInfoEl = document.createElement("div"); // NEW: Crea el badge cuando no existe
    storageInfoEl.id = "storage-info"; // NEW: Asigna el id solicitado
    const hostPanel = document.getElementById("todayPanel"); // NEW: Obtiene un panel representativo para anclar el badge
    const insertionTarget = hostPanel || document.body; // NEW: Define dónde insertar el badge
    insertionTarget.appendChild(storageInfoEl); // NEW: Inserta el badge en la UI
  }
  const maxLabel =
    STORAGE_APPROX_MAX_BYTES >= 1024 * 1024 // NEW: Determina si el máximo aproximado debe mostrarse en MB o KB
      ? `${Math.round(STORAGE_APPROX_MAX_BYTES / (1024 * 1024))} MB`
      : `${Math.round(STORAGE_APPROX_MAX_BYTES / 1024)} KB`; // NEW: Convierte el máximo aproximado a unidades legibles
  storageInfoEl.textContent = `Espacio ocupado: ${usageLabel} (máx. aprox. ${maxLabel})`; // NEW: Actualiza el contenido del badge
  const warn = lastStorageUsageBytes >= STORAGE_WARN_THRESHOLD_BYTES; // NEW: Determina si debe activarse el estado de alerta
  storageInfoEl.classList.toggle("warn", warn); // NEW: Alterna la clase de alerta cuando se supera el umbral
}

function getFirebaseConfig() {
  if (typeof window === "undefined") return null;
  const config = window.FIREBASE_CONFIG;
  return isPlainObject(config) ? config : null;
}

function getTimestampMillis(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cloneStateForRemote() {
  return JSON.parse(JSON.stringify(state));
}

function applyRemoteState(remoteState) {
  state = { ...state, ...remoteState };
  state.workouts = normalizeWorkouts(state.workouts);
  state.dayMeta = normalizeDayMeta(state.dayMeta);
  state.weekTypes = normalizeWeekTypes(state.weekTypes);
  state.futureExercises = normalizeFutureExercises(state.futureExercises);
  state.libraryExercises = normalizeLibraryExercises(state.libraryExercises);
  state.plannedExercises = normalizePlannedExercises(state.plannedExercises);
  state.plannedExercises = state.plannedExercises.length ? state.plannedExercises : buildPlannedFromWorkouts();
  state.templates = normalizeTemplates(state.templates);
  state.globalNotes = normalizeGlobalNotes(state.globalNotes);
  state.settings = normalizeSettings(state.settings);

  const selected = fmt(fromISO(state.selectedDate));
  state.selectedDate = selected;
  if (selectedDateInput) selectedDateInput.value = state.selectedDate;
  if (formDate) formDate.value = state.selectedDate;

  renderAll();
  applyThemeSettings();
  save({ skipRemote: true, updateTimestamp: false });
}

function queueRemoteSave() {
  if (!firebaseDocRef || typeof firebase === "undefined") return;
  if (!firebaseReady) return;
  if (firebaseSaveTimeout) clearTimeout(firebaseSaveTimeout);
  firebaseSaveTimeout = setTimeout(() => {
    const payload = {
      state: cloneStateForRemote(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      version: FIREBASE_DOC_VERSION,
    };
    firebaseDocRef.set(payload, { merge: true }).catch((err) => {
      console.warn("No se pudo sincronizar con Firebase", err);
    });
  }, 800);
}

function flushRemoteSave() {
  if (!firebaseDocRef || typeof firebase === "undefined") return;
  if (!firebaseSaveTimeout) return;
  clearTimeout(firebaseSaveTimeout);
  firebaseSaveTimeout = null;
  const payload = {
    state: cloneStateForRemote(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    version: FIREBASE_DOC_VERSION,
  };
  firebaseDocRef.set(payload, { merge: true }).catch((err) => {
    console.warn("No se pudo sincronizar con Firebase", err);
  });
}

function subscribeToRemoteState() {
  if (!firebaseDocRef) return;
  if (firebaseUnsubscribe) firebaseUnsubscribe();
  firebaseUnsubscribe = firebaseDocRef.onSnapshot(
    (doc) => {
      firebaseReady = true;
      if (!doc.exists) {
        if (state.lastModifiedAt) {
          queueRemoteSave();
        }
        return;
      }
      const data = doc.data() || {};
      if (!isPlainObject(data.state)) return;
      const remoteState = data.state;
      const remoteUpdated = getTimestampMillis(remoteState.lastModifiedAt);
      const localUpdated = getTimestampMillis(state.lastModifiedAt);
      if (!localUpdated || (remoteUpdated && remoteUpdated > localUpdated)) {
        applyRemoteState(remoteState);
        return;
      }
      if (localUpdated && (!remoteUpdated || localUpdated > remoteUpdated)) {
        queueRemoteSave();
      }
    },
    (err) => {
      console.warn("Error al escuchar cambios en Firebase", err);
    }
  );
}

function initFirebaseSync() {
  const config = getFirebaseConfig();
  if (!config || typeof firebase === "undefined") {
    return;
  }
  firebaseApp = firebase.initializeApp(config);
  firebaseDb = firebase.firestore();
  firebaseDocRef = firebaseDb.collection(FIREBASE_COLLECTION).doc(FIREBASE_DOC_ID);
  subscribeToRemoteState();
}

function pruneOldWorkoutIcons(referenceDate = new Date()) {
  if (!state.settings.autoPruneOldIcons) return false;
  let changed = false;
  Object.entries(state.workouts || {}).forEach(([dayISO, exercises]) => {
    if (!Array.isArray(exercises)) return;
    if (!isDayOlderThanIconPruneLimit(dayISO, referenceDate)) return;
    exercises.forEach((exercise) => {
      if (!isPlainObject(exercise)) return;
      if (exercise.iconType || exercise.emoji || exercise.imageDataUrl || exercise.iconName) {
        exercise.iconType = "";
        exercise.emoji = "";
        exercise.imageDataUrl = "";
        exercise.iconName = "";
        changed = true;
      }
    });
  });
  return changed;
}

function save({ skipRemote = false, updateTimestamp = true } = {}) {
  state.libraryExercises = normalizeLibraryExercises(state.libraryExercises);
  state.weekTypes = normalizeWeekTypes(state.weekTypes);
  state.plannedExercises = buildPlannedFromWorkouts();
  state.templates = normalizeTemplates(state.templates);
  state.settings = normalizeSettings(state.settings);
  pruneOldWorkoutIcons();
  if (updateTimestamp) {
    state.lastModifiedAt = new Date().toISOString();
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    showStorageUsage(); // NEW: Actualiza el indicador visual tras guardar en localStorage
    storageSaveFailed = false;
    clearStorageWarning();
    if (!skipRemote) {
      queueRemoteSave();
    }
  } catch (err) {
    console.warn("No se pudo guardar el estado de entreno", err);
    if (!storageSaveFailed) {
      showStorageWarning(STORAGE_SAVE_ERROR_MESSAGE);
    }
    storageSaveFailed = true;
  }
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
const weekTypeSelect = document.getElementById("weekType");
const weekTypeRange = document.getElementById("weekTypeRange");
const weekTypeBanner = document.getElementById("weekTypeBanner");
const weekTypePill = document.getElementById("weekTypePill");
const weekLoadStreakEl = document.getElementById("weekLoadStreak");
const weekTrendList = document.getElementById("weekTrend");
const weekCalendarToggle = document.getElementById("weekCalendarToggle");
const weekCalendar = document.getElementById("weekCalendar");
const weekCalendarCount = document.getElementById("weekCalendarCount");
const focusModeToggle = document.getElementById("focusModeToggle");
const quickCompleteAllBtn = document.getElementById("quickCompleteAll");
const quickMarkAllNotDoneBtn = document.getElementById("quickMarkAllNotDone");
const restTimerValue = document.getElementById("restTimerValue");
const restStartBtn = document.getElementById("restStartBtn");
const restPauseBtn = document.getElementById("restPauseBtn");
const restResetBtn = document.getElementById("restResetBtn");
const restPresetButtons = Array.from(document.querySelectorAll("[data-rest]"));
let suppressDayMetaEvents = false;
let suppressWeekTypeEvents = false;

let activeDrag = null;

function getDayWorkouts(dayISO) {
  if (!state.workouts) return [];
  const list = state.workouts[dayISO];
  return Array.isArray(list) ? list : [];
}

const seguimientoModule = typeof window !== "undefined" ? window.seguimientoUI : null;

function callSeguimiento(method, ...args) {
  if (!seguimientoModule) return;
  const fn = seguimientoModule[method];
  if (typeof fn === "function") {
    fn.apply(seguimientoModule, args);
  }
}

function hasIconDecorator() {
  return (
    typeof globalThis !== "undefined" &&
    globalThis.CaliGymIcons &&
    typeof globalThis.CaliGymIcons.decorate === "function"
  );
}

function decorateIcons(target, icon, options) {
  if (hasIconDecorator()) {
    globalThis.CaliGymIcons.decorate(target, icon, options);
  }
}

const tabs = document.querySelectorAll(".tab");
const tabPanels = {
  entreno: document.getElementById("tab-entreno"),
  nuevo: document.getElementById("tab-nuevo"),
  libreria: document.getElementById("tab-libreria"),
  seguimiento: document.getElementById("tab-seguimiento"),
  ajustes: document.getElementById("tab-ajustes")
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
const rowFailure = document.getElementById("rowFailure");
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
const formLibraryPreview = document.getElementById("formLibraryPreview");
const formFailureSets = document.getElementById("formFailureSets");
storageWarningEl = document.getElementById("storageWarning");
const goalFailure = document.getElementById("goalFailure");
const formStepButtons = document.querySelectorAll(".form-step-btn");
const formSteps = document.querySelectorAll(".form-step");
const formPrev = document.getElementById("formPrev");
const formNext = document.getElementById("formNext");
const formSubmitBtn = document.getElementById("formSubmit");
const formProgression = document.getElementById("formProgression");
const formProgressBar = document.getElementById("formProgressBar");
const formProgressBarFill = document.getElementById("formProgressBarFill");
let currentFormStep = 0;
let addFormSelectedLibrary = null;

/* Librería */
const openLibrarySelectorBtn = document.getElementById("openLibrarySelector");
const openLibraryFormBtn = document.getElementById("openLibraryForm");
const libraryListEl = document.getElementById("libraryList");
const libraryEmptyEl = document.getElementById("libraryEmpty");
const librarySearchInput = document.getElementById("librarySearch");
const libraryCategoryFilter = document.getElementById("libraryCategoryFilter");
const libraryEquipmentFilter = document.getElementById("libraryEquipmentFilter");
const libraryLevelFilter = document.getElementById("libraryLevelFilter");
const libraryTagsFilter = document.getElementById("libraryTagsFilter");
const libraryMultiToggleBtn = document.getElementById("libraryMultiToggle");
const libraryMultiBox = document.getElementById("libraryMultiBox");
const libraryMultiSummary = document.getElementById("libraryMultiSummary");
const libraryMultiDateInput = document.getElementById("libraryMultiDate");
const libraryMultiAddDateBtn = document.getElementById("libraryMultiAddDate");
const libraryMultiChips = document.getElementById("libraryMultiChips");
const libraryMultiApplyBtn = document.getElementById("libraryMultiApply");
const libraryMultiCancelBtn = document.getElementById("libraryMultiCancel");
const libraryMultiForm = document.getElementById("libraryMultiForm");
const libraryMultiGoalInputs = libraryMultiForm
  ? Array.from(libraryMultiForm.querySelectorAll('input[name="libraryMultiGoal"]'))
  : [];
const libraryMultiSeriesInput = document.getElementById("libraryMultiSeries");
const libraryMultiRepsInput = document.getElementById("libraryMultiReps");
const libraryMultiFailureInput = document.getElementById("libraryMultiFailure");
const libraryMultiIsoSeriesInput = document.getElementById("libraryMultiIsoSeries");
const libraryMultiIsoSecondsInput = document.getElementById("libraryMultiIsoSeconds");
const libraryMultiIsoFailureInput = document.getElementById("libraryMultiIsoFailure");
const libraryMultiFailSeriesInput = document.getElementById("libraryMultiFailSeries");
const libraryMultiEmomMinutesInput = document.getElementById("libraryMultiEmomMinutes");
const libraryMultiEmomRepsInput = document.getElementById("libraryMultiEmomReps");
const libraryMultiCardioMinutesInput = document.getElementById("libraryMultiCardioMinutes");
const libraryMultiWeightInput = document.getElementById("libraryMultiWeight");
const libraryMultiNotesInput = document.getElementById("libraryMultiNotes");
const libraryFormModal = document.getElementById("libraryFormModal");
const libraryForm = document.getElementById("libraryForm");
const libraryFormId = document.getElementById("libraryFormId");
const libraryFormName = document.getElementById("libraryFormName");
const libraryFormCategory = document.getElementById("libraryFormCategory");
const libraryIconEmoji = document.getElementById("libraryIconEmoji");
const libraryIconAsset = document.getElementById("libraryIconAsset");
const libraryEmojiRow = document.getElementById("libraryEmojiRow");
const libraryAssetRow = document.getElementById("libraryAssetRow");
const libraryFormEmoji = document.getElementById("libraryFormEmoji");
const libraryFormIcon = document.getElementById("libraryFormIcon");
const libraryIconPreview = document.getElementById("libraryIconPreview");
const libraryFormNotes = document.getElementById("libraryFormNotes");
const libraryFormEquipment = document.getElementById("libraryFormEquipment");
const libraryFormLevel = document.getElementById("libraryFormLevel");
const libraryFormGoal = document.getElementById("libraryFormGoal");
const libraryFormTags = document.getElementById("libraryFormTags");

const EXERCISE_ICON_BASE_PATH = "./icons/exercises";
let currentLibraryIconName = "";
let exerciseIconList = [];
let exerciseIconsLoaded = false;
let exerciseIconsLoadingPromise = null;

const librarySelectorModal = document.getElementById("librarySelectorModal");
const librarySelectorList = document.getElementById("librarySelectorList");
const librarySelectorEmpty = document.getElementById("librarySelectorEmpty");
const librarySelectorSearch = document.getElementById("librarySelectorSearch");
const librarySelectorCategory = document.getElementById("librarySelectorCategory");
const modalPreviousFocus = new WeakMap();

const goalConfigModal = document.getElementById("goalConfigModal");
const goalConfigForm = document.getElementById("goalConfigForm");
const goalConfigLibraryId = document.getElementById("goalConfigLibraryId");
const goalConfigDate = document.getElementById("goalConfigDate");
const goalConfigWeight = document.getElementById("goalConfigWeight");
const goalConfigNotes = document.getElementById("goalConfigNotes");
const goalConfigSections = goalConfigForm ? Array.from(goalConfigForm.querySelectorAll("[data-goal-config]")) : [];
const goalConfigTypeInputs = goalConfigForm ? Array.from(goalConfigForm.querySelectorAll('input[name="goalConfigType"]')) : [];
const goalConfigPreview = document.getElementById("goalConfigPreview");
const goalConfigTitleEl = document.getElementById("goalConfigTitle");
const goalConfigRepsSeries = document.getElementById("goalConfigRepsSeries");
const goalConfigRepsValue = document.getElementById("goalConfigRepsValue");
const goalConfigRepsFailure = document.getElementById("goalConfigRepsFailure");
const goalConfigIsoSeries = document.getElementById("goalConfigIsoSeries");
const goalConfigIsoSeconds = document.getElementById("goalConfigIsoSeconds");
const goalConfigIsoFailure = document.getElementById("goalConfigIsoFailure");
const goalConfigFailSeries = document.getElementById("goalConfigFailSeries");
const goalConfigEmomMinutes = document.getElementById("goalConfigEmomMinutes");
const goalConfigEmomReps = document.getElementById("goalConfigEmomReps");
const goalConfigCardioMinutes = document.getElementById("goalConfigCardioMinutes");
const weightSelectInputs = [formWeight, libraryMultiWeightInput, goalConfigWeight].filter(Boolean);

const globalNotesToggle = document.getElementById("globalNotesToggle");
const globalNotesBadge = document.getElementById("globalNotesBadge");
const globalNotesModal = document.getElementById("globalNotesModal");
const globalNotesForm = document.getElementById("globalNotesForm");
const globalNotesInput = document.getElementById("globalNotesInput");
const globalNotesList = document.getElementById("globalNotesList");
const globalNotesEmpty = document.getElementById("globalNotesEmpty");
const globalNotesArchive = document.getElementById("globalNotesArchive");
const globalNotesArchiveEmpty = document.getElementById("globalNotesArchiveEmpty");
weightSelectInputs.forEach((select) => {
  buildWeightOptions(select);
  setWeightSelectValue(select, select.value);
});

/* Ejercicios futuros */
const futureForm = document.getElementById("futureForm");
const futureInput = document.getElementById("futureInput");
const futureList = document.getElementById("futureList");
const futureEmpty = document.getElementById("futureEmpty");
const templateList = document.getElementById("templateList");
const templateEmpty = document.getElementById("templateEmpty");
const templateApplyDate = document.getElementById("templateApplyDate");
const saveTemplateBtn = document.getElementById("saveTemplateBtn");

/* Copiar día */
const copyDayToggleBtn = document.getElementById("copyDayToggleBtn");
const copyDayBox = document.getElementById("copyDayBox");
const copyTargetDate = document.getElementById("copyTargetDate");
const copyDayBtn = document.getElementById("copyDayBtn");
const cancelCopyBtn = document.getElementById("cancelCopyBtn");
const dayMultiToggleBtn = document.getElementById("dayMultiToggleBtn");
const dayMultiBox = document.getElementById("dayMultiBox");
const dayMultiSummary = document.getElementById("dayMultiSummary");
const dayMultiDateInput = document.getElementById("dayMultiDate");
const dayMultiAddDateBtn = document.getElementById("dayMultiAddDate");
const dayMultiChips = document.getElementById("dayMultiChips");
const dayMultiApplyBtn = document.getElementById("dayMultiApply");
const dayMultiCancelBtn = document.getElementById("dayMultiCancel");

/* Mini calendario */
const mcPrev = document.getElementById("mcPrev");
const mcNext = document.getElementById("mcNext");
const mcLabel = document.getElementById("mcLabel");
const mcGrid = document.getElementById("mcGrid");
let mcRefDate = new Date(); // referencia del mes mostrado
const DOW = ["L","M","X","J","V","S","D"];

/* Seguimiento */
const historyStore = typeof window !== "undefined" ? window.entrenoHistory : null;

/* Ajustes */
const themeSelect = document.getElementById("themeSelect");
const densitySelect = document.getElementById("densitySelect");
const fontSizeSelect = document.getElementById("fontSizeSelect");
const contrastToggle = document.getElementById("contrastToggle");
const reduceMotionToggle = document.getElementById("reduceMotionToggle");
const autoPruneOldIconsToggle = document.getElementById("autoPruneOldIcons");
const exportDataBtn = document.getElementById("exportDataBtn");
const importDataInput = document.getElementById("importDataInput");

const restTimerState = {
  duration: 90,
  remaining: 0,
  running: false,
  endAt: 0,
  intervalId: null,
};

function applyThemeSettings() {
  const settings = normalizeSettings(state.settings);
  state.settings = settings;
  document.body.classList.remove("theme-neon", "theme-solar", "theme-aurora");
  document.body.classList.remove(
    "density-compact",
    "density-normal",
    "density-spacious",
    "font-small",
    "font-normal",
    "font-large",
    "high-contrast",
    "reduce-motion"
  );
  document.body.classList.add(`theme-${settings.theme}`);
  document.body.classList.add(`density-${settings.density}`);
  document.body.classList.add(`font-${settings.fontSize}`);
  if (settings.highContrast) {
    document.body.classList.add("high-contrast");
  }
  if (settings.reduceMotion) {
    document.body.classList.add("reduce-motion");
  }
  if (themeSelect) themeSelect.value = settings.theme;
  if (densitySelect) densitySelect.value = settings.density;
  if (fontSizeSelect) fontSizeSelect.value = settings.fontSize;
  if (contrastToggle) contrastToggle.checked = settings.highContrast;
  if (reduceMotionToggle) reduceMotionToggle.checked = settings.reduceMotion;
  if (autoPruneOldIconsToggle) autoPruneOldIconsToggle.checked = settings.autoPruneOldIcons;
}

function updateRestTimerDisplay() {
  if (!restTimerValue) return;
  restTimerValue.textContent = formatEmomTime(restTimerState.remaining);
  if (restTimerState.remaining === 0) {
    restTimerValue.classList.remove("is-running");
  } else if (restTimerState.running) {
    restTimerValue.classList.add("is-running");
  }
}

function setRestTimer(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return;
  restTimerState.duration = Math.round(value);
  restTimerState.remaining = restTimerState.duration;
  updateRestTimerDisplay();
}

function tickRestTimer() {
  if (!restTimerState.running) return;
  const remainingMs = restTimerState.endAt - Date.now();
  restTimerState.remaining = Math.max(0, Math.ceil(remainingMs / 1000));
  updateRestTimerDisplay();
  if (restTimerState.remaining <= 0) {
    stopRestTimer();
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  }
}

function startRestTimer() {
  if (restTimerState.running) return;
  if (!restTimerState.remaining) {
    restTimerState.remaining = restTimerState.duration;
  }
  restTimerState.running = true;
  restTimerState.endAt = Date.now() + restTimerState.remaining * 1000;
  if (restTimerState.intervalId) clearInterval(restTimerState.intervalId);
  restTimerState.intervalId = setInterval(tickRestTimer, 500);
  tickRestTimer();
}

function pauseRestTimer() {
  if (!restTimerState.running) return;
  restTimerState.running = false;
  if (restTimerState.intervalId) {
    clearInterval(restTimerState.intervalId);
    restTimerState.intervalId = null;
  }
  tickRestTimer();
}

function stopRestTimer() {
  restTimerState.running = false;
  restTimerState.remaining = 0;
  if (restTimerState.intervalId) {
    clearInterval(restTimerState.intervalId);
    restTimerState.intervalId = null;
  }
  updateRestTimerDisplay();
}

function toggleFocusMode() {
  document.body.classList.toggle("focus-mode");
  if (focusModeToggle) {
    focusModeToggle.textContent = document.body.classList.contains("focus-mode") ? "Salir de foco" : "Modo foco";
  }
}

/* ========= Inicialización ========= */
load();
initFirebaseSync();
const originalWorkoutsJSON = JSON.stringify(state.workouts || {});
const originalDayMetaJSON = JSON.stringify(state.dayMeta || {});
const originalWeekTypesJSON = JSON.stringify(state.weekTypes || {});
const originalFutureJSON = JSON.stringify(state.futureExercises || []);
const originalLibraryJSON = JSON.stringify(state.libraryExercises || []);
const originalPlannedJSON = JSON.stringify(state.plannedExercises || []);
const originalTemplatesJSON = JSON.stringify(state.templates || []);
const originalGlobalNotesJSON = JSON.stringify(state.globalNotes || []);
const originalSettingsJSON = JSON.stringify(state.settings || {});
const normalizedWorkouts = normalizeWorkouts(state.workouts);
const normalizedWorkoutsJSON = JSON.stringify(normalizedWorkouts);
const normalizedDayMeta = normalizeDayMeta(state.dayMeta);
const normalizedDayMetaJSON = JSON.stringify(normalizedDayMeta);
const normalizedWeekTypes = normalizeWeekTypes(state.weekTypes);
const normalizedWeekTypesJSON = JSON.stringify(normalizedWeekTypes);
const normalizedFutureExercises = normalizeFutureExercises(state.futureExercises);
const normalizedFutureJSON = JSON.stringify(normalizedFutureExercises);
const normalizedLibraryExercises = normalizeLibraryExercises(state.libraryExercises);
const normalizedLibraryJSON = JSON.stringify(normalizedLibraryExercises);
const normalizedPlannedExercises = normalizePlannedExercises(state.plannedExercises);
const normalizedTemplates = normalizeTemplates(state.templates);
const normalizedTemplatesJSON = JSON.stringify(normalizedTemplates);
const normalizedGlobalNotes = normalizeGlobalNotes(state.globalNotes);
const normalizedGlobalNotesJSON = JSON.stringify(normalizedGlobalNotes);
const normalizedSettings = normalizeSettings(state.settings);
const normalizedSettingsJSON = JSON.stringify(normalizedSettings);
state.workouts = normalizedWorkouts;
state.dayMeta = normalizedDayMeta;
state.weekTypes = normalizedWeekTypes;
state.futureExercises = normalizedFutureExercises;
state.libraryExercises = normalizedLibraryExercises;
state.plannedExercises = normalizedPlannedExercises.length ? normalizedPlannedExercises : buildPlannedFromWorkouts();
state.templates = normalizedTemplates;
state.globalNotes = normalizedGlobalNotes;
state.settings = normalizedSettings;
const prunedOldIcons = pruneOldWorkoutIcons();

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
if (templateApplyDate) templateApplyDate.value = state.selectedDate;
formCategory.value = normalizeCategory(formCategory.value);
renderAll();
showStorageUsage(); // NEW: Muestra el uso estimado de almacenamiento al iniciar la app
applyThemeSettings();
setRestTimer(restTimerState.duration);
Promise.resolve().then(ensureExerciseIconsLoaded);
attachLibraryEventListeners();
if (
  originalWorkoutsJSON !== normalizedWorkoutsJSON ||
  originalDayMetaJSON !== normalizedDayMetaJSON ||
  originalWeekTypesJSON !== normalizedWeekTypesJSON ||
  originalFutureJSON !== normalizedFutureJSON ||
  originalLibraryJSON !== normalizedLibraryJSON ||
  originalPlannedJSON !== JSON.stringify(state.plannedExercises) ||
  originalTemplatesJSON !== normalizedTemplatesJSON ||
  originalGlobalNotesJSON !== normalizedGlobalNotesJSON ||
  originalSettingsJSON !== normalizedSettingsJSON ||
  prunedOldIcons ||
  resetToToday
) {
  const deferRemoteSync = firebaseDocRef && !firebaseReady;
  save(deferRemoteSync ? { skipRemote: true, updateTimestamp: false } : undefined);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushRemoteSave();
  }
});

window.addEventListener("pagehide", () => {
  flushRemoteSave();
});

tabs.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const activeTabBtn = document.querySelector(".tab.active");
    if (activeTabBtn) {
      activeTabBtn.classList.remove("active");
    }
    const selectedTabBtn = document.querySelector('.tab[aria-selected="true"]');
    if (selectedTabBtn) {
      selectedTabBtn.setAttribute("aria-selected", "false");
    }
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    const tab = btn.dataset.tab;
    for (const key in tabPanels) {
      const panel = tabPanels[key];
      if (!panel) continue;
      panel.classList.toggle("hidden", key !== tab);
    }
  });
});

if (focusModeToggle) {
  focusModeToggle.addEventListener("click", toggleFocusMode);
}

if (quickCompleteAllBtn) {
  quickCompleteAllBtn.addEventListener("click", () => {
    const list = getDayExercises(state.selectedDate);
    if (!list.length) return;
    const allDone = list.every((exercise) => getExerciseStatus(exercise) === EXERCISE_STATUS.DONE);
    const nextStatus = allDone ? EXERCISE_STATUS.PENDING : EXERCISE_STATUS.DONE;
    list.forEach((exercise) => {
      setExerciseStatus(exercise, nextStatus);
    });
    save();
    syncHistoryForDay(state.selectedDate, { showToast: nextStatus === EXERCISE_STATUS.DONE });
    renderDay(state.selectedDate);
    renderMiniCalendar();
    callSeguimiento("refresh");
  });
}

if (quickMarkAllNotDoneBtn) {
  quickMarkAllNotDoneBtn.addEventListener("click", () => {
    const list = getDayExercises(state.selectedDate);
    if (!list.length) return;
    const allNotDone = list.every((exercise) => getExerciseStatus(exercise) === EXERCISE_STATUS.NOT_DONE);
    const nextStatus = allNotDone ? EXERCISE_STATUS.PENDING : EXERCISE_STATUS.NOT_DONE;
    list.forEach((exercise) => {
      setExerciseStatus(exercise, nextStatus);
    });
    save();
    syncHistoryForDay(state.selectedDate, { showToast: false });
    renderDay(state.selectedDate);
    renderMiniCalendar();
    callSeguimiento("refresh");
  });
}

if (restPresetButtons.length) {
  restPresetButtons.forEach((btn) => {
    btn.addEventListener("click", () => setRestTimer(btn.dataset.rest));
  });
}

if (restStartBtn) restStartBtn.addEventListener("click", startRestTimer);
if (restPauseBtn) restPauseBtn.addEventListener("click", pauseRestTimer);
if (restResetBtn) restResetBtn.addEventListener("click", stopRestTimer);

if (themeSelect) {
  themeSelect.addEventListener("change", () => {
    state.settings.theme = themeSelect.value;
    applyThemeSettings();
    save();
  });
}

if (densitySelect) {
  densitySelect.addEventListener("change", () => {
    state.settings.density = densitySelect.value;
    applyThemeSettings();
    save();
  });
}

if (fontSizeSelect) {
  fontSizeSelect.addEventListener("change", () => {
    state.settings.fontSize = fontSizeSelect.value;
    applyThemeSettings();
    save();
  });
}

if (contrastToggle) {
  contrastToggle.addEventListener("change", () => {
    state.settings.highContrast = contrastToggle.checked;
    applyThemeSettings();
    save();
  });
}

if (reduceMotionToggle) {
  reduceMotionToggle.addEventListener("change", () => {
    state.settings.reduceMotion = reduceMotionToggle.checked;
    applyThemeSettings();
    save();
  });
}

if (autoPruneOldIconsToggle) {
  autoPruneOldIconsToggle.addEventListener("change", () => {
    state.settings.autoPruneOldIcons = autoPruneOldIconsToggle.checked;
    const pruned = pruneOldWorkoutIcons();
    save();
    if (pruned) {
      renderDay(state.selectedDate);
      renderMiniCalendar();
    }
  });
}

if (exportDataBtn) {
  exportDataBtn.addEventListener("click", () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      state: cloneStateForRemote(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `caligym-backup-${fmt(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

if (importDataInput) {
  importDataInput.addEventListener("change", async () => {
    const file = importDataInput.files && importDataInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = isPlainObject(parsed.state) ? parsed.state : parsed;
      if (!isPlainObject(incoming)) {
        alert("Archivo inválido.");
        return;
      }
      state = { ...state, ...incoming };
      state.workouts = normalizeWorkouts(state.workouts);
      state.dayMeta = normalizeDayMeta(state.dayMeta);
      state.weekTypes = normalizeWeekTypes(state.weekTypes);
      state.futureExercises = normalizeFutureExercises(state.futureExercises);
      state.libraryExercises = normalizeLibraryExercises(state.libraryExercises);
      state.plannedExercises = normalizePlannedExercises(state.plannedExercises);
      state.templates = normalizeTemplates(state.templates);
      state.globalNotes = normalizeGlobalNotes(state.globalNotes);
      state.settings = normalizeSettings(state.settings);
      state.selectedDate = fmt(fromISO(state.selectedDate));
      if (selectedDateInput) selectedDateInput.value = state.selectedDate;
      if (formDate) formDate.value = state.selectedDate;
      if (templateApplyDate) templateApplyDate.value = state.selectedDate;
      save();
      renderAll();
      applyThemeSettings();
      alert("Datos importados correctamente.");
    } catch (err) {
      console.error("Error importando datos", err);
      alert("No se pudo importar el archivo.");
    } finally {
      importDataInput.value = "";
    }
  });
}

document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-close-modal");
    const modal = targetId ? document.getElementById(targetId) : btn.closest(".modal");
    closeModal(modal);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const openModalEl = document.querySelector(".modal:not(.hidden)");
    if (openModalEl) {
      event.preventDefault();
      closeModal(openModalEl);
    }
  }
});

if (globalNotesToggle) {
  globalNotesToggle.addEventListener("click", () => {
    renderGlobalNotes();
    openModal(globalNotesModal);
    if (globalNotesInput) {
      globalNotesInput.focus();
    }
  });
}

if (globalNotesForm) {
  globalNotesForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!globalNotesInput) return;
    const text = (globalNotesInput.value || "").trim();
    if (!text) return;
    const notes = Array.isArray(state.globalNotes) ? state.globalNotes : [];
    const now = new Date().toISOString();
    notes.unshift({ id: randomUUID(), text, done: false, createdAt: now, updatedAt: now });
    state.globalNotes = notes;
    globalNotesInput.value = "";
    save();
    renderGlobalNotes();
  });
}

prevDayBtn.addEventListener("click", ()=> shiftSelectedDay(-1));
nextDayBtn.addEventListener("click", ()=> shiftSelectedDay(1));
selectedDateInput.addEventListener("change", (e)=>{
  const picked = fromISO(e.target.value || fmt(new Date()));
  state.selectedDate = fmt(picked);
  selectedDateInput.value = state.selectedDate;
  formDate.value = state.selectedDate;
  if (templateApplyDate) templateApplyDate.value = state.selectedDate;
  mcRefDate = new Date(picked.getFullYear(), picked.getMonth(), 1);
  save(); renderAll();
  highlightMiniCalSelected();
});

/* ==== Lógica Toggle de tipo de objetivo ==== */
function updateGoalRows() {
  if (rowReps) rowReps.classList.toggle("hidden", !isChecked(goalReps));
  if (rowSeconds) rowSeconds.classList.toggle("hidden", !isChecked(goalSecs));
  if (rowFailure) rowFailure.classList.toggle("hidden", !isChecked(goalFailure));
  if (rowEmom) rowEmom.classList.toggle("hidden", !isChecked(goalEmom));
  if (rowCardio) rowCardio.classList.toggle("hidden", !isChecked(goalCardio));
}
[goalReps, goalSecs, goalFailure, goalEmom, goalCardio]
  .filter(Boolean)
  .forEach((el) => el.addEventListener("change", updateGoalRows));
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
  const totalSteps = Math.max(formSteps.length, formStepButtons.length);
  formStepButtons.forEach((btn)=>{
    const target = Number(btn.dataset.stepTarget || "0");
    const isCurrent = target === currentFormStep;
    const isComplete = target < currentFormStep;
    btn.classList.toggle("is-current", isCurrent);
    btn.classList.toggle("is-complete", isComplete);
    btn.classList.toggle("is-upcoming", target > currentFormStep);
    btn.setAttribute("aria-current", isCurrent ? "step" : "false");
    btn.setAttribute("aria-disabled", isCurrent ? "true" : "false");
    const statusEl = btn.querySelector('[data-step-status]');
    if (statusEl){
      if (isCurrent){
        statusEl.textContent = "Paso actual";
        statusEl.dataset.stepStatus = "current";
      } else if (isComplete){
        statusEl.textContent = "Completado";
        statusEl.dataset.stepStatus = "complete";
      } else {
        statusEl.textContent = "Pendiente";
        statusEl.dataset.stepStatus = "upcoming";
      }
    }
  });
  if (formProgressBar && totalSteps > 0){
    const current = currentFormStep + 1;
    formProgressBar.setAttribute("aria-valuenow", String(current));
    formProgressBar.setAttribute("aria-valuemax", String(totalSteps));
    const percent = Math.min(100, Math.max(0, (current / totalSteps) * 100));
    if (formProgressBarFill){
      formProgressBarFill.style.width = `${percent}%`;
    }
  } else if (formProgressBarFill){
    formProgressBarFill.style.width = totalSteps === 0 ? "100%" : "0%";
  }
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

function clearAddFormLibrarySelection(){
  addFormSelectedLibrary = null;
  if (formLibraryPreview) {
    formLibraryPreview.classList.add("hidden");
    formLibraryPreview.innerHTML = "";
  }
}

function setAddFormLibrarySelection(item){
  if (!item) {
    clearAddFormLibrarySelection();
    return;
  }
  addFormSelectedLibrary = item;
  if (formName) formName.value = item.name;
  if (formCategory) {
    formCategory.value = item.category;
    updateProgressionHint();
  }
  if (formLibraryPreview) {
    formLibraryPreview.innerHTML = "";
    const thumb = createMiniatureElement(item, { size: 32, className: "library-mini-thumb" });
    const label = document.createElement("span");
    label.textContent = `${item.name} · ${CATEGORY_LABELS[item.category] || item.category}`;
    formLibraryPreview.append(thumb, label);
    formLibraryPreview.classList.remove("hidden");
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

if (openLibrarySelectorBtn){
  openLibrarySelectorBtn.addEventListener("click", () => {
    openLibrarySelector({
      defaultCategory: getInputValue(formCategory) || "all",
      onSelect: (item) => {
        setAddFormLibrarySelection(item);
      },
    });
  });
}

if (goalFailure && formFailureSets && formSets){
  goalFailure.addEventListener("change", () => {
    if (goalFailure.checked && (!formFailureSets.value || Number(formFailureSets.value) <= 0)) {
      formFailureSets.value = formSets.value || 3;
    }
  });
  formSets.addEventListener("change", () => {
    if (goalFailure.checked) {
      formFailureSets.value = formSets.value || formFailureSets.value;
    }
  });
}

if (todayMobilityToggle){
  todayMobilityToggle.addEventListener("click", ()=>{
    if (suppressDayMetaEvents) return;
    const meta = getDayMeta(state.selectedDate);
    setDayMeta(state.selectedDate, { habits: { mobility: !meta.habits.mobility } });
    renderTodayInsights(state.selectedDate, getDayExercises(state.selectedDate));
  });
}
if (todayHabitInputs && todayHabitInputs.length){
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
if (weekTypeSelect){
  weekTypeSelect.addEventListener("change", ()=>{
    if (suppressWeekTypeEvents) return;
    const picked = weekTypeSelect.value;
    if (!picked) {
      clearWeekType(state.selectedDate);
      renderTodayInsights(state.selectedDate, getDayExercises(state.selectedDate));
      return;
    }
    setWeekType(state.selectedDate, picked);
    renderTodayInsights(state.selectedDate, getDayExercises(state.selectedDate));
  });
}
if (weekCalendarToggle && weekCalendar){
  const syncWeekCalendarLabel = () => {
    weekCalendarToggle.textContent = weekCalendar.classList.contains("hidden")
      ? "Ver todas las semanas"
      : "Ocultar calendario";
  };
  syncWeekCalendarLabel();
  weekCalendarToggle.addEventListener("click", ()=>{
    weekCalendar.classList.toggle("hidden");
    syncWeekCalendarLabel();
    if (!weekCalendar.classList.contains("hidden")) {
      renderWeekCalendar(state.selectedDate);
    }
  });
}

addForm.addEventListener("reset", () => {
  requestAnimationFrame(() => {
    formCategory.value = CATEGORY_KEYS[0];
    updateGoalRows();
    if (formQuickNote) formQuickNote.value = "";
    setFormStep(0);
    updateProgressionHint();
    clearAddFormLibrarySelection();
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
    goal: null,
    goalType: "reps",
    reps: null,          // si goal="reps"
    failure: false,      // si goal="reps" o goal="seconds"
    seconds: null,       // si goal="seconds"
    emomMinutes: null,   // si goal="emom"
    emomReps: null,      // si goal="emom"
    cardioMinutes: null, // si goal="cardio"
    weightKg: formWeight.value ? Number(formWeight.value) : null,
    done: [],            // array con reps logradas por serie (o segundos)
    status: EXERCISE_STATUS.PENDING,
    completed: false,
    hecho: false,
    note: formQuickNote ? (formQuickNote.value || "").trim() : "",
    category: normalizeCategory(formCategory.value),
    perceivedEffort: null,
    iconType: "emoji",
    emoji: "",
    imageDataUrl: "",
    iconName: "",
  };

  if (!ex.name) { alert("Pon un nombre al ejercicio."); return; }

  if (addFormSelectedLibrary) {
    ex.libraryId = addFormSelectedLibrary.id;
    ex.iconType = addFormSelectedLibrary.iconType;
    ex.emoji = addFormSelectedLibrary.emoji;
    ex.imageDataUrl = addFormSelectedLibrary.imageDataUrl;
    ex.iconName = addFormSelectedLibrary.iconName;
    ex.tags = Array.isArray(addFormSelectedLibrary.tags) ? addFormSelectedLibrary.tags.slice() : [];
    if (addFormSelectedLibrary.notes) {
      ex.note = [addFormSelectedLibrary.notes, ex.note].filter(Boolean).join("\n");
    }
  }

  if (goalReps.checked) {
    ex.goalType = "reps";
    ex.goal = "reps";
    ex.reps = formReps.value ? Number(formReps.value) : null;
    ex.failure = !!formFailure.checked;
    ex.seconds = null;
    ex.emomMinutes = null;
    ex.emomReps = null;
    ex.cardioMinutes = null;
  } else if (goalSecs.checked) {
    ex.goalType = "isometrico";
    ex.goal = "seconds";
    ex.seconds = Number(formSeconds.value||0);
    ex.failure = !!formSecondsFailure.checked;
    ex.reps = null;
    ex.emomMinutes = null;
    ex.emomReps = null;
    ex.cardioMinutes = null;
  } else if (isChecked(goalFailure)) {
    ex.goalType = "fallo";
    ex.goal = "reps";
    const failureSetsValue = getInputValue(formFailureSets);
    const failureSets = failureSetsValue ? Number(failureSetsValue) : null;
    if (failureSets && failureSets > 0) {
      ex.sets = failureSets;
    }
    ex.reps = null;
    ex.seconds = null;
    ex.failure = true;
    ex.emomMinutes = null;
    ex.emomReps = null;
    ex.cardioMinutes = null;
  } else if (goalEmom.checked) {
    ex.goalType = "emom";
    ex.goal = "emom";
    ex.emomMinutes = Number(formEmomMinutes.value||0);
    ex.emomReps = Number(formEmomReps.value||0);
    ex.failure = false;
    ex.reps = null;
    ex.seconds = null;
    ex.cardioMinutes = null;
  } else {
    ex.goalType = "cardio";
    ex.goal = "cardio";
    ex.cardioMinutes = Number(formCardioMinutes.value||0);
    ex.failure = false;
    ex.reps = null;
    ex.seconds = null;
    ex.emomMinutes = null;
    ex.emomReps = null;
  }

  if (getExerciseGoalType(ex) === "emom") {
    resetEmomTimerState(ex);
  } else {
    delete ex.emomTimer;
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
  clearAddFormLibrarySelection();
  renderDay(normalizedDay);
  switchToTab("entreno");
  state.selectedDate = normalizedDay;
  selectedDateInput.value = state.selectedDate;
  formDate.value = state.selectedDate;
  const selected = fromISO(state.selectedDate);
  mcRefDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
  save();
  renderMiniCalendar();
  callSeguimiento("refresh");
  setFormStep(0);
  updateProgressionHint();
});

if (futureForm) {
  futureForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = getTrimmedValue(futureInput);
    if (!name) {
      if (futureInput && typeof futureInput.focus === "function") {
        futureInput.focus();
      }
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

if (saveTemplateBtn) {
  saveTemplateBtn.addEventListener("click", () => {
    const exercises = getDayExercises(state.selectedDate);
    if (!exercises.length) {
      alert("Añade ejercicios antes de guardar una plantilla.");
      return;
    }
    const name = prompt("Nombre de la plantilla:", `Rutina ${toHuman(state.selectedDate)}`);
    if (!name || !name.trim()) return;
    const template = buildTemplateFromDay(state.selectedDate, name.trim());
    state.templates = Array.isArray(state.templates) ? [template, ...state.templates] : [template];
    save();
    renderTemplates();
  });
}

if (templateList) {
  templateList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (!action || !id) return;
    const templates = Array.isArray(state.templates) ? state.templates : [];
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    if (action === "apply-template") {
      const dayISO = templateApplyDate && templateApplyDate.value ? fmt(fromISO(templateApplyDate.value)) : state.selectedDate;
      if (!dayISO) return;
      const list = Array.isArray(state.workouts[dayISO]) ? state.workouts[dayISO] : [];
      const cloned = Array.isArray(template.exercises) ? template.exercises.map(cloneExerciseForTemplate).filter(Boolean) : [];
      state.workouts[dayISO] = [...list, ...cloned];
      save();
      state.selectedDate = dayISO;
      selectedDateInput.value = dayISO;
      formDate.value = dayISO;
      renderAll();
      switchToTab("entreno");
    }
    if (action === "rename-template") {
      const nextName = prompt("Nuevo nombre de plantilla:", template.name);
      if (!nextName) return;
      template.name = nextName.trim() || template.name;
      save();
      renderTemplates();
    }
    if (action === "delete-template") {
      const ok = confirm("¿Eliminar esta plantilla?");
      if (!ok) return;
      state.templates = templates.filter((item) => item.id !== id);
      save();
      renderTemplates();
    }
  });
}

/* ========= Render ========= */
function renderAll(){
  renderDay(state.selectedDate);
  renderMiniCalendar();
  renderFutureExercises();
  renderTemplates();
  renderLibrary();
  renderLibrarySelector();
  renderGlobalNotes();
  callSeguimiento("refresh");
}

function updateGlobalNotesBadge(){
  if (!globalNotesBadge) return;
  const notes = Array.isArray(state.globalNotes) ? state.globalNotes : [];
  const pending = notes.filter((note) => !note.done);
  globalNotesBadge.classList.toggle("is-visible", pending.length > 0);
}

function formatGlobalNoteDate(value){
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function updateGlobalNote(noteId, patch){
  if (!noteId) return;
  const notes = Array.isArray(state.globalNotes) ? state.globalNotes : [];
  const note = notes.find((item) => item.id === noteId);
  if (!note) return;
  Object.assign(note, patch);
  note.updatedAt = new Date().toISOString();
  save();
  renderGlobalNotes();
}

function deleteGlobalNote(noteId){
  if (!noteId) return;
  const notes = Array.isArray(state.globalNotes) ? state.globalNotes : [];
  state.globalNotes = notes.filter((note) => note.id !== noteId);
  save();
  renderGlobalNotes();
}

function renderGlobalNotes(){
  updateGlobalNotesBadge();
  if (!globalNotesList || !globalNotesArchive || !globalNotesEmpty || !globalNotesArchiveEmpty) return;
  globalNotesList.innerHTML = "";
  globalNotesArchive.innerHTML = "";
  const notes = Array.isArray(state.globalNotes) ? state.globalNotes : [];
  const sorted = [...notes].sort((a, b) => getTimestampMillis(b.updatedAt) - getTimestampMillis(a.updatedAt));
  const pending = sorted.filter((note) => !note.done);
  const archived = sorted.filter((note) => note.done);

  const buildItem = (note, isArchived) => {
    const li = document.createElement("li");
    li.className = "global-notes-item";
    li.dataset.id = note.id;

    const textarea = document.createElement("textarea");
    textarea.value = note.text || "";
    textarea.rows = 2;
    textarea.readOnly = true;

    let isEditing = false;
    const editBtn = button("Editar", "ghost small");
    editBtn.type = "button";
    const setEditing = (nextState) => {
      isEditing = nextState;
      textarea.readOnly = !nextState;
      editBtn.textContent = nextState ? "Guardar" : "Editar";
      if (nextState) {
        textarea.focus();
        textarea.selectionStart = textarea.value.length;
      }
    };
    editBtn.addEventListener("click", () => {
      if (!isEditing) {
        setEditing(true);
        return;
      }
      const nextText = textarea.value.trim();
      if (!nextText) {
        deleteGlobalNote(note.id);
        return;
      }
      updateGlobalNote(note.id, { text: nextText });
      setEditing(false);
    });

    const meta = document.createElement("div");
    meta.className = "global-notes-meta";
    const dateLabel = formatGlobalNoteDate(note.updatedAt || note.createdAt);
    meta.textContent = dateLabel ? `Actualizada: ${dateLabel}` : "";

    const actions = document.createElement("div");
    actions.className = "global-notes-item-actions";
    if (isArchived) {
      actions.append(editBtn);
      const restoreBtn = button("Reabrir", "ghost small");
      restoreBtn.type = "button";
      restoreBtn.addEventListener("click", () => updateGlobalNote(note.id, { done: false }));
      const deleteBtn = button("Eliminar", "ghost danger small");
      deleteBtn.type = "button";
      deleteBtn.addEventListener("click", () => deleteGlobalNote(note.id));
      actions.append(restoreBtn, deleteBtn);
    } else {
      actions.append(editBtn);
      const doneBtn = button("Hecha", "ghost small");
      doneBtn.type = "button";
      doneBtn.addEventListener("click", () => updateGlobalNote(note.id, { done: true }));
      const deleteBtn = button("Eliminar", "ghost danger small");
      deleteBtn.type = "button";
      deleteBtn.addEventListener("click", () => deleteGlobalNote(note.id));
      actions.append(doneBtn, deleteBtn);
    }

    li.append(textarea, meta, actions);
    return li;
  };

  pending.forEach((note) => globalNotesList.append(buildItem(note, false)));
  archived.forEach((note) => globalNotesArchive.append(buildItem(note, true)));

  globalNotesEmpty.style.display = pending.length ? "none" : "block";
  globalNotesArchiveEmpty.style.display = archived.length ? "none" : "block";
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
    const removeBtn = button("", "ghost micro");
    removeBtn.type = "button";
    removeBtn.dataset.action = "remove-future";
    removeBtn.dataset.id = item.id;
    const removeLabel = `Eliminar "${item.name}" de ejercicios futuros`;
    if (hasIconDecorator()) {
      decorateIcons(removeBtn, "trash", { label: removeLabel });
    } else {
      removeBtn.textContent = "Eliminar";
      removeBtn.setAttribute("aria-label", removeLabel);
      removeBtn.title = removeLabel;
    }
    actions.append(removeBtn);
    li.append(actions);

    futureList.append(li);
  });
}

function renderTemplates() {
  if (!templateList || !templateEmpty) return;
  templateList.innerHTML = "";
  const templates = Array.isArray(state.templates) ? state.templates : [];
  templateEmpty.style.display = templates.length ? "none" : "block";
  if (!templates.length) return;
  templates.forEach((template) => {
    if (!template || typeof template !== "object") return;
    const li = document.createElement("li");
    li.className = "template-card";
    li.dataset.id = template.id;

    const header = document.createElement("div");
    header.className = "template-card-header";
    const title = document.createElement("div");
    title.className = "template-card-title";
    title.textContent = template.name;
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = formatTemplateMeta(template);
    header.append(title, meta);

    const tagsWrap = document.createElement("div");
    tagsWrap.className = "template-tags";
    const exerciseCount = Array.isArray(template.exercises) ? template.exercises.length : 0;
    const countChip = document.createElement("span");
    countChip.className = "template-tag";
    countChip.textContent = `${exerciseCount} ejercicios`;
    tagsWrap.append(countChip);

    const actions = document.createElement("div");
    actions.className = "template-card-actions";
    const applyBtn = button("Aplicar", "primary small");
    applyBtn.type = "button";
    applyBtn.dataset.action = "apply-template";
    applyBtn.dataset.id = template.id;
    const renameBtn = button("Renombrar", "ghost small");
    renameBtn.type = "button";
    renameBtn.dataset.action = "rename-template";
    renameBtn.dataset.id = template.id;
    const deleteBtn = button("Eliminar", "danger small");
    deleteBtn.type = "button";
    deleteBtn.dataset.action = "delete-template";
    deleteBtn.dataset.id = template.id;
    actions.append(applyBtn, renameBtn, deleteBtn);

    li.append(header, tagsWrap, actions);
    templateList.append(li);
  });
}

/* ========= Librería ========= */
function getLibrary(){
  return Array.isArray(state.libraryExercises) ? state.libraryExercises.slice() : [];
}

function saveLibrary(list){
  state.libraryExercises = normalizeLibraryExercises(list);
  save();
  renderLibrary();
  renderLibrarySelector();
}

function arraysShallowEqual(a, b) {
  if (!Array.isArray(a) && !Array.isArray(b)) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function updateExercisesFromLibrary(libraryExercise) {
  if (!libraryExercise || !libraryExercise.id) return [];
  const affectedDays = new Set();
  const tags = Array.isArray(libraryExercise.tags) ? libraryExercise.tags.slice() : [];
  Object.entries(state.workouts || {}).forEach(([dayISO, exercises]) => {
    if (!Array.isArray(exercises)) return;
    const ignoreIcons = shouldIgnoreLibraryIconsForDay(dayISO);
    const icon = ignoreIcons ? null : resolveExerciseIcon(libraryExercise);
    exercises.forEach((exercise) => {
      if (!isPlainObject(exercise) || exercise.libraryId !== libraryExercise.id) return;
      let changed = false;
      if (exercise.name !== libraryExercise.name) {
        exercise.name = libraryExercise.name;
        changed = true;
      }
      if (exercise.category !== libraryExercise.category) {
        exercise.category = libraryExercise.category;
        changed = true;
      }
      if (!ignoreIcons && icon) {
        if (exercise.iconType !== icon.iconType) {
          exercise.iconType = icon.iconType;
          changed = true;
        }
        if (exercise.emoji !== icon.emoji) {
          exercise.emoji = icon.emoji;
          changed = true;
        }
        if (exercise.imageDataUrl !== icon.imageDataUrl) {
          exercise.imageDataUrl = icon.imageDataUrl;
          changed = true;
        }
        if (exercise.iconName !== icon.iconName) {
          exercise.iconName = icon.iconName;
          changed = true;
        }
      }
      if (!arraysShallowEqual(exercise.tags, tags)) {
        exercise.tags = tags.slice();
        changed = true;
      }
      if (changed) {
        affectedDays.add(fmt(fromISO(dayISO)));
      }
    });
  });
  return Array.from(affectedDays);
}

function addToLibrary(item){
  const list = getLibrary();
  list.push(item);
  saveLibrary(list);
  return item;
}

function updateLibrary(item){
  const list = getLibrary();
  const idx = list.findIndex((entry) => entry.id === item.id);
  if (idx === -1) return null;
  const merged = { ...list[idx], ...item };
  const normalizedList = normalizeLibraryExercises([merged]);
  const normalizedItem = normalizedList.length ? normalizedList[0] : null;
  if (!normalizedItem) return list[idx];
  list[idx] = normalizedItem;
  const affectedDays = updateExercisesFromLibrary(normalizedItem);
  saveLibrary(list);
  if (affectedDays.length) {
    const selectedDayISO = fmt(fromISO(state.selectedDate));
    if (affectedDays.includes(selectedDayISO)) {
      renderDay(selectedDayISO);
    }
    renderMiniCalendar();
    affectedDays.forEach((dayISO) => {
      syncHistoryForDay(dayISO, { showToast: false });
    });
  }
  return findLibraryExercise(normalizedItem.id);
}

function removeFromLibrary(id){
  const list = getLibrary();
  const next = list.filter((item) => item.id !== id);
  if (next.length === list.length) return false;
  saveLibrary(next);
  return true;
}

function findLibraryExercise(id){
  if (!id) return null;
  const list = getLibrary();
  return list.find((item) => item.id === id) || null;
}

function resolveExerciseIcon(source, options = {}){
  const dayISO = typeof options.dayISO === "string" ? options.dayISO : "";
  const ignoreLibraryIcons = shouldIgnoreLibraryIconsForDay(dayISO);
  if (!source || typeof source !== "object") {
    return { iconType: "emoji", emoji: "", imageDataUrl: "", iconName: "", name: "" };
  }
  if (source.iconType === "asset" && source.iconName) {
    return { iconType: "asset", iconName: source.iconName, emoji: "", imageDataUrl: "", name: source.name || "" };
  }
  if (source.iconType === "image" && source.imageDataUrl) {
    return { iconType: "image", imageDataUrl: source.imageDataUrl, emoji: "", iconName: "", name: source.name || "" };
  }
  if (source.iconType === "emoji" && source.emoji) {
    return { iconType: "emoji", emoji: source.emoji, imageDataUrl: "", iconName: "", name: source.name || "" };
  }
  if (source.libraryId && !ignoreLibraryIcons) {
    const libraryExercise = findLibraryExercise(source.libraryId);
    if (libraryExercise) {
      return resolveExerciseIcon({ ...libraryExercise, name: source.name || libraryExercise.name }, options);
    }
  }
  const emoji = typeof source.emoji === "string" ? source.emoji : "";
  const imageDataUrl = typeof source.imageDataUrl === "string" ? source.imageDataUrl : "";
  const iconName = typeof source.iconName === "string" ? source.iconName : "";
  if (iconName) {
    return { iconType: "asset", iconName, emoji: "", imageDataUrl: "", name: source.name || "" };
  }
  if (imageDataUrl) {
    return { iconType: "image", imageDataUrl, emoji: "", iconName: "", name: source.name || "" };
  }
  if (emoji) {
    return { iconType: "emoji", emoji, imageDataUrl: "", iconName: "", name: source.name || "" };
  }
  return { iconType: "placeholder", emoji: "", imageDataUrl: "", iconName: "", name: source.name || "" };
}

function createMiniatureElement(source, options = {}){
  const icon = resolveExerciseIcon(source, { dayISO: options.dayISO });
  const size = options.size || 48;
  const sourceName = source && source.name ? source.name : "";
  const alt = options.alt || sourceName || "Ejercicio";
  const wrapper = document.createElement("div");
  wrapper.className = options.className ? `miniature ${options.className}` : "miniature";
  wrapper.style.setProperty("--miniature-size", `${size}px`);
  wrapper.setAttribute("role", "img");
  wrapper.setAttribute("aria-label", alt);
  if (icon.iconType === "asset" && icon.iconName) {
    const img = document.createElement("img");
    img.src = getExerciseIconUrl(icon.iconName);
    img.alt = alt;
    img.loading = "lazy";
    wrapper.append(img);
  } else if (icon.iconType === "image" && icon.imageDataUrl) {
    const img = document.createElement("img");
    img.src = icon.imageDataUrl;
    img.alt = alt;
    img.loading = "lazy";
    wrapper.append(img);
  } else if (icon.iconType === "emoji" && icon.emoji) {
    const span = document.createElement("span");
    span.textContent = icon.emoji;
    span.setAttribute("aria-hidden", "true");
    wrapper.append(span);
  } else {
    const initials = extractInitials(alt || sourceName || "");
    const span = document.createElement("span");
    span.textContent = initials || "?";
    span.setAttribute("aria-hidden", "true");
    wrapper.append(span);
  }
  return wrapper;
}

function filterLibraryItems(items, filters){
  const search = (filters.search || "").trim().toLowerCase();
  const category = (filters.category || "all").toLowerCase();
  const equipment = (filters.equipment || "all").toLowerCase();
  const level = (filters.level || "all").toLowerCase();
  const tags = normalizeTags(filters.tags || []);
  return items.filter((item) => {
    if (!item) return false;
    if (category !== "all" && item.category !== category) return false;
    if (equipment !== "all" && item.equipment !== equipment) return false;
    if (level !== "all" && item.level !== level) return false;
    if (search) {
      const haystack = `${item.name} ${Array.isArray(item.tags) ? item.tags.join(" ") : ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (tags.length) {
      const itemTags = Array.isArray(item.tags) ? item.tags.map((tag) => tag.toLowerCase()) : [];
      const matches = tags.some((tag) => itemTags.includes(tag.toLowerCase()));
      if (!matches) return false;
    }
    return true;
  });
}

function renderLibrary(){
  if (!libraryListEl || !libraryEmptyEl) return;
  const filters = {
    search: getInputValue(librarySearchInput),
    category: getInputValue(libraryCategoryFilter) || "all",
    equipment: getInputValue(libraryEquipmentFilter) || "all",
    level: getInputValue(libraryLevelFilter) || "all",
    tags: libraryTagsFilter ? normalizeTags(libraryTagsFilter.value) : [],
  };
  const items = filterLibraryItems(getLibrary(), filters);
  if (libraryMultiSelect.active) {
    const availableIds = new Set(getLibrary().map((item) => item.id));
    Array.from(libraryMultiSelect.selected).forEach((id) => {
      if (!availableIds.has(id)) {
        libraryMultiSelect.selected.delete(id);
      }
    });
  }
  libraryListEl.innerHTML = "";
  libraryEmptyEl.classList.toggle("hidden", items.length > 0);
  if (!items.length) {
    updateLibraryMultiUI();
    return;
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "library-card";
    card.dataset.id = item.id;

    const header = document.createElement("div");
    header.className = "library-card-header";
    const thumb = createMiniatureElement(item, { size: 48, className: "library-card-thumb" });
    const titleWrap = document.createElement("div");
    titleWrap.className = "library-card-title";
    const title = document.createElement("h3");
    title.textContent = item.name;
    const category = document.createElement("span");
    category.className = "library-card-category";
    category.textContent = CATEGORY_LABELS[item.category] || item.category;
    titleWrap.append(title, category);
    header.append(thumb, titleWrap);

    const body = document.createElement("div");
    body.className = "library-card-body";
    if (item.notes) {
      const notes = document.createElement("p");
      notes.className = "library-card-notes";
      notes.textContent = item.notes;
      body.append(notes);
    }
    const meta = document.createElement("div");
    meta.className = "library-card-meta";
    const metaItems = [
      { label: EQUIPMENT_LABELS[item.equipment] || item.equipment },
      { label: LEVEL_LABELS[item.level] || item.level },
      { label: GOAL_LABELS[item.goal] || item.goal },
    ];
    metaItems.forEach((info) => {
      if (!info.label) return;
      const chip = document.createElement("span");
      chip.className = "library-meta-chip";
      chip.textContent = info.label;
      meta.append(chip);
    });
    body.append(meta);
    if (Array.isArray(item.tags) && item.tags.length) {
      const tagsWrap = document.createElement("div");
      tagsWrap.className = "library-card-tags";
      item.tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = tag;
        tagsWrap.append(chip);
      });
      body.append(tagsWrap);
    }

    const actions = document.createElement("div");
    actions.className = "library-card-actions";
    const useBtn = button("Usar en…", "primary small");
    useBtn.type = "button";
    useBtn.addEventListener("click", () => openGoalConfigModal(item));
    const editBtn = button("", "ghost small");
    editBtn.type = "button";
    const editLabel = `Editar "${item.name}"`;
    if (hasIconDecorator()) {
      decorateIcons(editBtn, "edit", { label: editLabel });
    } else {
      editBtn.textContent = "Editar";
      editBtn.setAttribute("aria-label", editLabel);
      editBtn.title = editLabel;
    }
    editBtn.addEventListener("click", () => openLibraryForm(item));
    const deleteBtn = button("", "danger small");
    deleteBtn.type = "button";
    const deleteLabel = `Eliminar "${item.name}" de la librería`;
    if (hasIconDecorator()) {
      decorateIcons(deleteBtn, "trash", { label: deleteLabel });
    } else {
      deleteBtn.textContent = "Eliminar";
      deleteBtn.setAttribute("aria-label", deleteLabel);
      deleteBtn.title = deleteLabel;
    }
    deleteBtn.addEventListener("click", () => {
      const ok = confirm(`¿Eliminar "${item.name}" de la librería?`);
      if (!ok) return;
      removeFromLibrary(item.id);
    });
    actions.append(useBtn, editBtn, deleteBtn);

    if (libraryMultiSelect.active) {
      card.classList.add("is-selecting");
      const selectWrap = document.createElement("label");
      selectWrap.className = "library-card-select";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = libraryMultiSelect.selected.has(item.id);
      checkbox.setAttribute("aria-label", `Seleccionar ${item.name}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          libraryMultiSelect.selected.add(item.id);
        } else {
          libraryMultiSelect.selected.delete(item.id);
        }
        updateLibraryMultiUI();
      });
      selectWrap.append(checkbox);
      header.prepend(selectWrap);
    }

    card.append(header, body, actions);
    libraryListEl.append(card);
  });
  updateLibraryMultiUI();
}

let currentSelectorCallback = null;

function openModal(modal){
  if (!modal) return;
  const activeElement = document.activeElement;
  if (activeElement && typeof activeElement.blur === "function") {
    modalPreviousFocus.set(modal, activeElement);
  } else {
    modalPreviousFocus.delete(modal);
  }
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal(modal){
  if (!modal) return;
  const activeElement = document.activeElement;
  if (activeElement && modal.contains(activeElement) && typeof activeElement.blur === "function") {
    activeElement.blur();
  }
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (modal === librarySelectorModal) {
    currentSelectorCallback = null;
  }
  const previousFocus = modalPreviousFocus.get(modal);
  modalPreviousFocus.delete(modal);
  if (previousFocus && typeof previousFocus.focus === "function") {
    requestAnimationFrame(() => {
      if (document.body.contains(previousFocus)) {
        previousFocus.focus();
      }
    });
  }
  if (!document.querySelector(".modal:not(.hidden)")) {
    document.body.classList.remove("modal-open");
  }
}

function renderLibrarySelector(){
  if (!librarySelectorList || !librarySelectorEmpty) return;
  const filters = {
    search: getInputValue(librarySelectorSearch),
    category: getInputValue(librarySelectorCategory) || "all",
    tags: [],
  };
  const items = filterLibraryItems(getLibrary(), filters);
  librarySelectorList.innerHTML = "";
  librarySelectorEmpty.classList.toggle("hidden", items.length > 0);
  if (!items.length) return;
  items.sort((a, b) => a.name.localeCompare(b.name));
  items.forEach((item) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "library-select-card";
    option.setAttribute("aria-label", `Seleccionar ${item.name}`);
    const thumb = createMiniatureElement(item, { size: 40, className: "library-select-thumb" });
    const info = document.createElement("div");
    info.className = "library-select-info";
    const title = document.createElement("strong");
    title.textContent = item.name;
    const category = document.createElement("span");
    category.textContent = CATEGORY_LABELS[item.category] || item.category;
    info.append(title, category);
    option.append(thumb, info);
    option.addEventListener("click", () => {
      if (typeof currentSelectorCallback === "function") {
        currentSelectorCallback(item);
      }
      currentSelectorCallback = null;
      closeModal(librarySelectorModal);
    });
    librarySelectorList.append(option);
  });
}

function getExerciseIconUrl(name) {
  if (!name) return "";
  return `${EXERCISE_ICON_BASE_PATH}/${encodeURIComponent(name)}`;
}

function setLibraryIconPreview(name) {
  const iconName = name || currentLibraryIconName || "";
  currentLibraryIconName = iconName;
  if (!libraryIconPreview) return;
  libraryIconPreview.innerHTML = "";
  const url = getExerciseIconUrl(iconName);
  if (iconName && url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = getInputValue(libraryFormName) || "Icono del ejercicio";
    img.loading = "lazy";
    libraryIconPreview.append(img);
  }
}

function populateLibraryIconSelect() {
  if (!libraryFormIcon) return;
  const previous = libraryFormIcon.value;
  libraryFormIcon.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = exerciseIconList.length ? "Selecciona un icono" : "Sin iconos disponibles";
  placeholder.disabled = exerciseIconList.length > 0;
  placeholder.selected = true;
  libraryFormIcon.append(placeholder);
  exerciseIconList.forEach((fileName) => {
    const option = document.createElement("option");
    option.value = fileName;
    option.textContent = fileName.replace(/\.[^.]+$/, "");
    option.setAttribute("data-icon-name", fileName);
    libraryFormIcon.append(option);
  });
  if (libraryIconAsset) {
    const hasIcons = exerciseIconList.length > 0;
    libraryIconAsset.disabled = !hasIcons;
    if (!hasIcons && libraryIconAsset.checked && libraryIconEmoji) {
      libraryIconEmoji.checked = true;
    }
  }
  if (exerciseIconList.includes(previous)) {
    libraryFormIcon.value = previous;
  } else if (previous) {
    const fallbackOption = document.createElement("option");
    fallbackOption.value = previous;
    fallbackOption.textContent = previous.replace(/\.[^.]+$/, "");
    fallbackOption.selected = true;
    fallbackOption.setAttribute("data-icon-name", previous);
    libraryFormIcon.append(fallbackOption);
  }
  setLibraryIconPreview(libraryFormIcon.value);
  updateLibraryIconRows();
}

function ensureExerciseIconsLoaded() {
  if (exerciseIconsLoaded) {
    return Promise.resolve(exerciseIconList);
  }
  if (exerciseIconsLoadingPromise) {
    return exerciseIconsLoadingPromise;
  }
  exerciseIconsLoadingPromise = fetch(`${EXERCISE_ICON_BASE_PATH}/icons.json`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`No se pudieron cargar los iconos (${response.status})`);
      }
      return response.json();
    })
    .then((data) => {
      if (Array.isArray(data)) {
        exerciseIconList = data.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
        exerciseIconList.sort((a, b) => a.localeCompare(b, "es"));
      } else {
        exerciseIconList = [];
      }
      exerciseIconsLoaded = true;
      populateLibraryIconSelect();
      return exerciseIconList;
    })
    .catch((error) => {
      console.error("No se pudieron cargar los iconos de ejercicios", error);
      exerciseIconList = [];
      exerciseIconsLoaded = true;
      populateLibraryIconSelect();
      return exerciseIconList;
    });
  return exerciseIconsLoadingPromise;
}

function updateLibraryIconRows(){
  const useAsset = isChecked(libraryIconAsset);
  if (libraryEmojiRow) libraryEmojiRow.classList.toggle("hidden", !!useAsset);
  if (libraryAssetRow) libraryAssetRow.classList.toggle("hidden", !useAsset);
  if (libraryFormIcon) libraryFormIcon.required = !!useAsset && exerciseIconList.length > 0;
  if (useAsset) {
    setLibraryIconPreview(getInputValue(libraryFormIcon) || currentLibraryIconName);
  }
}

function resetLibraryForm(){
  if (!libraryForm) return;
  libraryForm.reset();
  currentLibraryIconName = "";
  if (libraryFormId) libraryFormId.value = "";
  if (libraryFormEmoji) libraryFormEmoji.value = "";
  if (libraryIconPreview) libraryIconPreview.innerHTML = "";
  if (libraryFormIcon) {
    populateLibraryIconSelect();
    libraryFormIcon.value = "";
  }
  if (libraryIconEmoji) libraryIconEmoji.checked = true;
  updateLibraryIconRows();
}

function openLibraryForm(item){
  ensureExerciseIconsLoaded().finally(() => {
    resetLibraryForm();
    if (item) {
      if (libraryFormId) libraryFormId.value = item.id;
      if (libraryFormName) libraryFormName.value = item.name;
      if (libraryFormCategory) libraryFormCategory.value = item.category;
      if (item.iconType === "asset" && item.iconName) {
        if (libraryIconAsset) libraryIconAsset.checked = true;
        currentLibraryIconName = item.iconName;
        if (libraryFormIcon) {
          libraryFormIcon.value = item.iconName;
          populateLibraryIconSelect();
        }
        setLibraryIconPreview(item.iconName);
      } else if (item.iconType === "image" && item.imageDataUrl) {
        if (libraryIconAsset) libraryIconAsset.checked = true;
        if (libraryIconPreview) {
          libraryIconPreview.innerHTML = "";
          const img = document.createElement("img");
          img.src = item.imageDataUrl;
          img.alt = item.name;
          img.loading = "lazy";
          libraryIconPreview.append(img);
        }
        if (libraryFormIcon) {
          populateLibraryIconSelect();
          libraryFormIcon.value = "";
        }
      } else {
        if (libraryIconEmoji) libraryIconEmoji.checked = true;
        if (libraryFormEmoji) libraryFormEmoji.value = item.emoji || "";
      }
      if (libraryFormNotes) libraryFormNotes.value = item.notes || "";
      if (libraryFormEquipment) libraryFormEquipment.value = item.equipment || "ninguno";
      if (libraryFormLevel) libraryFormLevel.value = item.level || "principiante";
      if (libraryFormGoal) libraryFormGoal.value = item.goal || "fuerza";
      if (libraryFormTags) libraryFormTags.value = Array.isArray(item.tags) ? item.tags.join(", ") : "";
    }
    updateLibraryIconRows();
    openModal(libraryFormModal);
    requestAnimationFrame(() => {
      if (libraryFormName && typeof libraryFormName.focus === "function") {
        libraryFormName.focus();
      }
    });
  });
}

function closeLibraryForm(){
  closeModal(libraryFormModal);
}

function serializeLibraryForm(){
  const name = getTrimmedValue(libraryFormName);
  if (!name) {
    alert("Añade un nombre al ejercicio de la librería.");
    return null;
  }
  const category = normalizeCategory(getInputValue(libraryFormCategory));
  const iconType = isChecked(libraryIconAsset) ? "asset" : "emoji";
  let emoji = "";
  let imageDataUrl = "";
  let iconName = "";
  if (iconType === "asset") {
    iconName = (getInputValue(libraryFormIcon) || currentLibraryIconName || "").trim();
    if (!iconName) {
      alert("Elige un icono de la galería para este ejercicio.");
      return null;
    }
  } else {
    emoji = getTrimmedValue(libraryFormEmoji);
    if (!emoji) {
      emoji = extractInitials(name);
    }
  }
  const notes = getInputValue(libraryFormNotes);
  const tags = normalizeTags(getInputValue(libraryFormTags));
  const equipment = EQUIPMENT_KEYS.includes(getInputValue(libraryFormEquipment)) ? getInputValue(libraryFormEquipment) : "ninguno";
  const level = LEVEL_KEYS.includes(getInputValue(libraryFormLevel)) ? getInputValue(libraryFormLevel) : "principiante";
  const goal = GOAL_KEYS.includes(getInputValue(libraryFormGoal)) ? getInputValue(libraryFormGoal) : "fuerza";
  const base = {
    id: libraryFormId && libraryFormId.value ? libraryFormId.value : randomUUID(),
    name,
    category,
    iconType,
    emoji,
    imageDataUrl,
    iconName: iconType === "asset" ? iconName : "",
    notes,
    tags,
    equipment,
    level,
    goal,
  };
  return base;
}

function attachLibraryEventListeners(){
  if (libraryIconEmoji) libraryIconEmoji.addEventListener("change", updateLibraryIconRows);
  if (libraryIconAsset) libraryIconAsset.addEventListener("change", updateLibraryIconRows);
  if (libraryFormIcon) {
    libraryFormIcon.addEventListener("change", (event) => {
      currentLibraryIconName = event.target.value;
      setLibraryIconPreview(currentLibraryIconName);
    });
  }
  if (openLibraryFormBtn) {
    openLibraryFormBtn.addEventListener("click", () => openLibraryForm());
  }
  if (librarySearchInput) librarySearchInput.addEventListener("input", renderLibrary);
  if (libraryCategoryFilter) libraryCategoryFilter.addEventListener("change", renderLibrary);
  if (libraryEquipmentFilter) libraryEquipmentFilter.addEventListener("change", renderLibrary);
  if (libraryLevelFilter) libraryLevelFilter.addEventListener("change", renderLibrary);
  if (libraryTagsFilter) libraryTagsFilter.addEventListener("input", renderLibrary);
  if (librarySelectorSearch) librarySelectorSearch.addEventListener("input", renderLibrarySelector);
  if (librarySelectorCategory) librarySelectorCategory.addEventListener("change", renderLibrarySelector);
  if (libraryForm) {
    libraryForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = serializeLibraryForm();
      if (!data) return;
      if (libraryFormId && libraryFormId.value) {
        updateLibrary(data);
      } else {
        addToLibrary(data);
      }
      closeLibraryForm();
    });
  }
  if (goalConfigTypeInputs.length) {
    goalConfigTypeInputs.forEach((input) => {
      input.addEventListener("change", updateGoalConfigSections);
    });
  }
  if (goalConfigForm) {
    goalConfigForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const config = serializeGoalConfig();
      if (!config) return;
      scheduleExerciseFromLibrary(currentGoalConfigLibrary, config);
      closeGoalConfigModal();
    });
  }
}

function openLibrarySelector(options = {}){
  currentSelectorCallback = typeof options.onSelect === "function" ? options.onSelect : null;
  if (librarySelectorSearch) librarySelectorSearch.value = options.search || "";
  if (librarySelectorCategory) {
    const cat = options.defaultCategory || "all";
    librarySelectorCategory.value = CATEGORY_KEYS.includes(cat) ? cat : "all";
  }
  renderLibrarySelector();
  openModal(librarySelectorModal);
  requestAnimationFrame(() => {
    if (librarySelectorSearch && typeof librarySelectorSearch.focus === "function") {
      librarySelectorSearch.focus();
    }
  });
}

let currentGoalConfigLibrary = null;

function updateGoalConfigSections(){
  const selectedInput = goalConfigTypeInputs.find((input) => input.checked);
  const selected = selectedInput ? selectedInput.value : "reps";
  goalConfigSections.forEach((section) => {
    const type = section.getAttribute("data-goal-config");
    section.classList.toggle("hidden", type !== selected);
  });
}

function openGoalConfigModal(libraryExercise){
  currentGoalConfigLibrary = libraryExercise;
  if (!libraryExercise) return;
  if (goalConfigLibraryId) goalConfigLibraryId.value = libraryExercise.id;
  if (goalConfigDate) goalConfigDate.value = state.selectedDate;
  if (goalConfigWeight) goalConfigWeight.value = "";
  if (goalConfigNotes) goalConfigNotes.value = libraryExercise.notes || "";
  if (goalConfigTitleEl) goalConfigTitleEl.textContent = `Configurar ${libraryExercise.name}`;
  if (goalConfigPreview) {
    goalConfigPreview.innerHTML = "";
    const thumb = createMiniatureElement(libraryExercise, { size: 32, className: "library-mini-thumb" });
    const label = document.createElement("span");
    label.textContent = `${libraryExercise.name} · ${CATEGORY_LABELS[libraryExercise.category] || libraryExercise.category}`;
    goalConfigPreview.append(thumb, label);
    goalConfigPreview.classList.remove("hidden");
  }
  goalConfigTypeInputs.forEach((input, index) => {
    input.checked = index === 0;
  });
  if (goalConfigRepsSeries) goalConfigRepsSeries.value = 3;
  if (goalConfigRepsValue) goalConfigRepsValue.value = 8;
  if (goalConfigRepsFailure) goalConfigRepsFailure.checked = false;
  if (goalConfigIsoSeries) goalConfigIsoSeries.value = 3;
  if (goalConfigIsoSeconds) goalConfigIsoSeconds.value = 30;
  if (goalConfigIsoFailure) goalConfigIsoFailure.checked = false;
  if (goalConfigFailSeries) goalConfigFailSeries.value = 3;
  if (goalConfigEmomMinutes) goalConfigEmomMinutes.value = 10;
  if (goalConfigEmomReps) goalConfigEmomReps.value = 10;
  if (goalConfigCardioMinutes) goalConfigCardioMinutes.value = 20;
  updateGoalConfigSections();
  openModal(goalConfigModal);
  requestAnimationFrame(() => {
    if (goalConfigDate && typeof goalConfigDate.focus === "function") {
      goalConfigDate.focus();
    }
  });
}

function closeGoalConfigModal(){
  closeModal(goalConfigModal);
  currentGoalConfigLibrary = null;
  if (goalConfigPreview) {
    goalConfigPreview.classList.add("hidden");
    goalConfigPreview.innerHTML = "";
  }
  if (goalConfigTitleEl) goalConfigTitleEl.textContent = "Configurar objetivo";
}

function serializeGoalConfig(){
  if (!currentGoalConfigLibrary) return null;
  const typeInput = goalConfigTypeInputs.find((input) => input.checked);
  const goalType = normalizeGoalType(typeInput ? typeInput.value : "reps");
  const dateISO = fmt(fromISO(getInputValue(goalConfigDate) || state.selectedDate));
  const payload = {
    goalType,
    dateISO,
    weight: null,
    notes: getInputValue(goalConfigNotes),
  };
  const weightInput = getTrimmedValue(goalConfigWeight);
  if (weightInput) {
    const weightNumber = Number(weightInput);
    if (!Number.isFinite(weightNumber)) {
      alert("Introduce un valor numérico para el lastre.");
      return null;
    }
    payload.weight = weightNumber;
  }
  if (goalType === "reps") {
    const series = Number(getInputValue(goalConfigRepsSeries) || 0);
    const reps = Number(getInputValue(goalConfigRepsValue) || 0);
    if (!series || !reps) {
      alert("Indica series y repeticiones.");
      return null;
    }
    payload.series = series;
    payload.reps = reps;
    payload.alFallo = isChecked(goalConfigRepsFailure);
  } else if (goalType === "isometrico") {
    const series = Number(getInputValue(goalConfigIsoSeries) || 0);
    const segundos = Number(getInputValue(goalConfigIsoSeconds) || 0);
    if (!series || !segundos) {
      alert("Indica series y segundos.");
      return null;
    }
    payload.series = series;
    payload.segundos = segundos;
    payload.alFallo = isChecked(goalConfigIsoFailure);
  } else if (goalType === "fallo") {
    const series = Number(getInputValue(goalConfigFailSeries) || 0);
    if (!series) {
      alert("Indica cuántas series harás al fallo.");
      return null;
    }
    payload.series = series;
    payload.alFallo = true;
  } else if (goalType === "emom") {
    const minutos = Number(getInputValue(goalConfigEmomMinutes) || 0);
    const repsPorMin = Number(getInputValue(goalConfigEmomReps) || 0);
    if (!minutos || !repsPorMin) {
      alert("Indica minutos y reps por minuto del EMOM.");
      return null;
    }
    payload.minutos = minutos;
    payload.repsPorMin = repsPorMin;
    payload.series = null;
  } else if (goalType === "cardio") {
    const minutos = Number(getInputValue(goalConfigCardioMinutes) || 0);
    if (!minutos) {
      alert("Indica los minutos de cardio.");
      return null;
    }
    payload.minutos = minutos;
    payload.series = null;
  }
  return payload;
}

function buildExerciseFromLibrary(libraryExercise, config){
  if (!libraryExercise || !config) return null;
  const dayISO = fmt(fromISO(config.dateISO || state.selectedDate));
  const goalType = normalizeGoalType(config.goalType);
  const sets = config.series != null ? Math.max(1, Number(config.series) || 1) : 1;
  const exercise = {
    id: randomUUID(),
    plannedId: randomUUID(),
    libraryId: libraryExercise.id,
    name: libraryExercise.name,
    category: libraryExercise.category,
    iconType: libraryExercise.iconType,
    emoji: libraryExercise.emoji,
    imageDataUrl: libraryExercise.imageDataUrl,
    iconName: libraryExercise.iconName,
    tags: Array.isArray(libraryExercise.tags) ? libraryExercise.tags.slice() : [],
    equipment: libraryExercise.equipment,
    level: libraryExercise.level,
    goalFocus: libraryExercise.goal,
    note: config.notes != null && config.notes !== "" ? config.notes : libraryExercise.notes || "",
    sets,
    goalType,
    goal: goalType === "isometrico" ? "seconds" : goalType === "emom" ? "emom" : goalType === "cardio" ? "cardio" : goalType === "fallo" ? "fallo" : "reps",
    reps: goalType === "reps" ? Number(config.reps) : null,
    seconds: goalType === "isometrico" ? Number(config.segundos) : null,
    emomMinutes: goalType === "emom" ? Number(config.minutos) : null,
    emomReps: goalType === "emom" ? Number(config.repsPorMin) : null,
    cardioMinutes: goalType === "cardio" ? Number(config.minutos) : null,
    failure: goalType === "fallo" ? true : !!config.alFallo,
    done: [],
    status: EXERCISE_STATUS.PENDING,
    completed: false,
    hecho: false,
    weightKg: config.weight != null && config.weight !== "" ? Number(config.weight) : null,
    perceivedEffort: null,
  };
  if (getExerciseGoalType(exercise) === "emom") {
    resetEmomTimerState(exercise);
  }
  if (exercise.failure) {
    exercise.done = Array.from({ length: exercise.sets }, () => null);
  }
  return { dayISO, exercise };
}

function scheduleExerciseFromLibrary(libraryExercise, config){
  const result = buildExerciseFromLibrary(libraryExercise, config);
  if (!result) return;
  const { dayISO, exercise } = result;
  if (!Array.isArray(state.workouts[dayISO])) {
    state.workouts[dayISO] = [];
  }
  state.workouts[dayISO].push(exercise);
  save();
  state.selectedDate = dayISO;
  selectedDateInput.value = state.selectedDate;
  formDate.value = state.selectedDate;
  renderDay(dayISO);
  renderMiniCalendar();
  syncHistoryForDay(dayISO, { showToast: false });
  switchToTab("entreno");
}

function getDayExercises(dayISO){
  const source = getDayWorkouts(dayISO);
  return source.filter(isPlainObject);
}

function updateExerciseStatus(exercise, status, dayISO, options = {}) {
  const normalized = setExerciseStatus(exercise, status);
  save();
  const shouldToast = hasValue(options.showToast) ? options.showToast : normalized === EXERCISE_STATUS.DONE;
  syncHistoryForDay(dayISO, { showToast: shouldToast });
  renderDay(dayISO);
  renderMiniCalendar();
  callSeguimiento("refresh");
}

function renderDay(dayISO){
  const list = getDayExercises(dayISO);
  humanDateSpan.textContent = toHuman(dayISO);
  exerciseList.innerHTML = "";
  clearEmomInstances();
  emptyDayHint.style.display = list.length ? "none" : "block";
  renderTodayInsights(dayISO, list);

  if (dayMultiSelect.active) {
    const validIds = new Set(list.map((ex) => ex.id));
    Array.from(dayMultiSelect.selected).forEach((id) => {
      if (!validIds.has(id)) {
        dayMultiSelect.selected.delete(id);
      }
    });
  }

  list.forEach(ex=>{
    if (!ex.id) ex.id = randomUUID();
    ex.category = normalizeCategory(ex.category);
    const li = document.createElement("li");
    li.className = "exercise";
    li.dataset.category = ex.category;
    li.classList.add(`category-${ex.category}`);
    const currentStatus = getExerciseStatus(ex);
    li.dataset.status = currentStatus;
    if (currentStatus === EXERCISE_STATUS.DONE) li.classList.add("completed");
    if (currentStatus === EXERCISE_STATUS.NOT_DONE) li.classList.add("not-done");
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
    const thumb = createMiniatureElement(ex, { size: 56, className: "exercise-thumb", alt: ex.name, dayISO });
    const h3 = document.createElement("h3");
    h3.textContent = ex.name;
    h3.classList.add("heading-tight");
    const controls = document.createElement("div");
    controls.className = "controls";

    if (dayMultiSelect.active) {
      const selectWrap = document.createElement("label");
      selectWrap.className = "selection-control";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = dayMultiSelect.selected.has(ex.id);
      checkbox.setAttribute("aria-label", `Seleccionar ${ex.name}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          dayMultiSelect.selected.add(ex.id);
        } else {
          dayMultiSelect.selected.delete(ex.id);
        }
        updateDayMultiUI();
      });
      selectWrap.append(checkbox);
      titleMain.append(selectWrap);
    }

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
      isExerciseDone(ex) ? "↺" : "✔",
      isExerciseDone(ex) ? "small ghost" : "small success"
    );
    const skipBtn = button(
      isExerciseNotDone(ex) ? "↺" : "✖",
      isExerciseNotDone(ex) ? "small ghost" : "small danger"
    );
    doneBtn.setAttribute(
      "aria-label",
      isExerciseDone(ex) ? "Marcar ejercicio como pendiente" : "Marcar ejercicio como hecho"
    );
    skipBtn.setAttribute(
      "aria-label",
      isExerciseNotDone(ex) ? "Quitar estado no hecho" : "Marcar ejercicio como no hecho"
    );
    doneBtn.title = doneBtn.getAttribute("aria-label");
    skipBtn.title = skipBtn.getAttribute("aria-label");
    const editBtn = button("", "small ghost");
    const editLabel = `Editar "${ex.name}"`;
    if (hasIconDecorator()) {
      decorateIcons(editBtn, "edit", { label: editLabel });
    } else {
      editBtn.textContent = "Editar";
      editBtn.setAttribute("aria-label", editLabel);
      editBtn.title = editLabel;
    }
    const delBtn = button("", "small danger");
    const deleteLabel = `Eliminar "${ex.name}"`;
    if (hasIconDecorator()) {
      decorateIcons(delBtn, "trash", { label: deleteLabel });
    } else {
      delBtn.textContent = "Eliminar";
      delBtn.setAttribute("aria-label", deleteLabel);
      delBtn.title = deleteLabel;
    }
    doneBtn.addEventListener("click", ()=>{
      const nextStatus = isExerciseDone(ex) ? EXERCISE_STATUS.PENDING : EXERCISE_STATUS.DONE;
      updateExerciseStatus(ex, nextStatus, dayISO, { showToast: nextStatus === EXERCISE_STATUS.DONE });
    });
    skipBtn.addEventListener("click", ()=>{
      const nextStatus = isExerciseNotDone(ex) ? EXERCISE_STATUS.PENDING : EXERCISE_STATUS.NOT_DONE;
      updateExerciseStatus(ex, nextStatus, dayISO, { showToast: false });
    });
    controls.append(noteBtn, doneBtn, skipBtn, editBtn, delBtn);
    titleMain.append(dragBtn, thumb, h3);
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
      callSeguimiento("refresh");
    };
    noteTextarea.addEventListener("input", () => {
      ex.note = noteTextarea.value;
      updateNoteState();
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        save();
        noteTimer = null;
        syncHistoryForDay(dayISO, { showToast: false });
        callSeguimiento("refresh");
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
      const doneValues = Array.from({length: ex.sets}, (_,i)=> hasValue(doneArray[i]) ? doneArray[i] : null);
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
        input.value = hasValue(doneValues[i]) ? doneValues[i] : "";
        input.addEventListener("change", ()=>{
          const v = input.value? Number(input.value) : null;
          const doneList = Array.isArray(ex.done) ? ex.done : [];
          doneList[i] = v;
          ex.done = doneList;
          save();
          syncHistoryForDay(dayISO, { showToast: true });
          callSeguimiento("refresh");
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
    const emomControls = buildEmomControls(ex, dayISO);
    if (emomControls) li.append(emomControls);
    if (recoveryStrip) li.append(recoveryStrip);
    li.append(noteBox);
    if (setsBox) li.append(setsBox);
    exerciseList.append(li);
    setupExerciseDrag(li, dayISO);

  });

  updateDayMultiUI();
}

function renderSelectionChips(container, targets, onRemove){
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(targets) || !targets.length) {
    return;
  }
  targets.forEach((iso) => {
    const chip = document.createElement("span");
    chip.className = "selection-chip";
    const label = document.createElement("span");
    label.textContent = toHuman(iso);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Quitar ${toHuman(iso)}`);
    removeBtn.innerHTML = "×";
    removeBtn.addEventListener("click", () => onRemove(iso));
    chip.append(label, removeBtn);
    container.append(chip);
  });
}

function updateDayMultiUI(){
  if (dayMultiSummary) {
    if (!dayMultiSelect.active) {
      dayMultiSummary.textContent = "Selecciona ejercicios del listado para comenzar.";
    } else {
      const selectedCount = dayMultiSelect.selected.size;
      const targetCount = dayMultiSelect.targets.length;
      const exercisesText = selectedCount === 1 ? "1 ejercicio seleccionado" : `${selectedCount} ejercicios seleccionados`;
      const daysText = targetCount === 1 ? "1 día destino" : `${targetCount} días destino`;
      dayMultiSummary.textContent = `${exercisesText} · ${daysText}`;
    }
  }
  if (dayMultiApplyBtn) {
    const canApply = dayMultiSelect.active && dayMultiSelect.selected.size > 0 && dayMultiSelect.targets.length > 0;
    dayMultiApplyBtn.disabled = !canApply;
    dayMultiApplyBtn.textContent = dayMultiSelect.targets.length > 1
      ? `Copiar a ${dayMultiSelect.targets.length} días`
      : "Copiar ejercicios";
  }
  if (dayMultiChips) {
    dayMultiChips.classList.toggle("hidden", !dayMultiSelect.active || dayMultiSelect.targets.length === 0);
    if (dayMultiSelect.active) {
      renderSelectionChips(dayMultiChips, dayMultiSelect.targets, (iso) => {
        removeTargetFromList(dayMultiSelect.targets, iso);
        updateDayMultiUI();
      });
    } else {
      dayMultiChips.innerHTML = "";
    }
  }
  if (dayMultiBox) {
    dayMultiBox.classList.toggle("hidden", !dayMultiSelect.active);
  }
  if (dayMultiToggleBtn) {
    dayMultiToggleBtn.textContent = dayMultiSelect.active ? "Salir de selección" : "Seleccionar ejercicios…";
  }
  if (dayMultiDateInput && dayMultiSelect.active && !dayMultiDateInput.value) {
    dayMultiDateInput.value = state.selectedDate;
  }
}

function setDayMultiActive(active){
  const next = !!active;
  if (dayMultiSelect.active === next) {
    if (next && dayMultiDateInput && !dayMultiDateInput.value) {
      dayMultiDateInput.value = state.selectedDate;
    }
    updateDayMultiUI();
    return;
  }
  dayMultiSelect.active = next;
  dayMultiSelect.selected.clear();
  if (!next) {
    dayMultiSelect.targets = [];
  } else {
    dayMultiSelect.targets = [];
    addTargetToList(dayMultiSelect.targets, state.selectedDate);
    if (dayMultiDateInput) dayMultiDateInput.value = state.selectedDate;
  }
  if (next && copyDayBox) {
    copyDayBox.classList.add("hidden");
  }
  renderDay(state.selectedDate);
  updateDayMultiUI();
}

function handleDayMultiAddDate(){
  if (!dayMultiSelect.active || !dayMultiDateInput) return;
  const raw = getInputValue(dayMultiDateInput) || state.selectedDate;
  const iso = fmt(fromISO(raw));
  if (addTargetToList(dayMultiSelect.targets, iso)) {
    updateDayMultiUI();
  }
  dayMultiDateInput.value = "";
  dayMultiDateInput.focus();
}

function applyDayMultiSelection(){
  if (!dayMultiSelect.active) return;
  const selectedIds = Array.from(dayMultiSelect.selected);
  if (!selectedIds.length) {
    alert("Selecciona al menos un ejercicio del día.");
    return;
  }
  if (!dayMultiSelect.targets.length) {
    alert("Añade al menos un día destino.");
    return;
  }
  const sourceExercises = getDayWorkouts(state.selectedDate).filter((ex) => selectedIds.includes(ex.id));
  if (!sourceExercises.length) {
    alert("No se encontraron los ejercicios seleccionados.");
    return;
  }
  const updates = new Map();
  dayMultiSelect.targets.forEach((target) => {
    const iso = fmt(fromISO(target));
    sourceExercises.forEach((exercise) => {
      const clone = cloneExerciseForCopy(exercise);
      if (!clone) return;
      if (!updates.has(iso)) updates.set(iso, []);
      updates.get(iso).push(clone);
    });
  });
  if (!updates.size) {
    alert("No se pudieron preparar los ejercicios seleccionados.");
    return;
  }
  updates.forEach((list, iso) => {
    const existing = getDayWorkouts(iso);
    state.workouts[iso] = existing.concat(list);
  });
  save();
  updates.forEach((_, iso) => {
    syncHistoryForDay(iso, { showToast: false });
  });
  renderDay(state.selectedDate);
  renderMiniCalendar();
  callSeguimiento("refresh");
  const totalDays = updates.size;
  alert(totalDays === 1 ? "Ejercicios copiados en el día seleccionado." : `Ejercicios copiados en ${totalDays} días.`);
  setDayMultiActive(false);
}

function updateLibraryMultiGoalSections(){
  if (!libraryMultiForm) return;
  const selectedInput = libraryMultiGoalInputs.find((input) => input.checked);
  const selected = selectedInput ? selectedInput.value : "reps";
  const sections = libraryMultiForm.querySelectorAll("[data-goal]");
  sections.forEach((section) => {
    const goal = section.getAttribute("data-goal");
    section.classList.toggle("hidden", goal !== selected);
  });
}

function updateLibraryMultiUI(){
  if (libraryMultiSummary) {
    if (!libraryMultiSelect.active) {
      libraryMultiSummary.textContent = "Selecciona ejercicios para configurar el plan.";
    } else {
      const selectedCount = libraryMultiSelect.selected.size;
      const targetCount = libraryMultiSelect.targets.length;
      const exercisesText = selectedCount === 1 ? "1 ejercicio seleccionado" : `${selectedCount} ejercicios seleccionados`;
      const daysText = targetCount === 1 ? "1 día destino" : `${targetCount} días destino`;
      libraryMultiSummary.textContent = `${exercisesText} · ${daysText}`;
    }
  }
  if (libraryMultiApplyBtn) {
    const canApply = libraryMultiSelect.active && libraryMultiSelect.selected.size > 0 && libraryMultiSelect.targets.length > 0;
    libraryMultiApplyBtn.disabled = !canApply;
    libraryMultiApplyBtn.textContent = libraryMultiSelect.targets.length > 1
      ? `Añadir a ${libraryMultiSelect.targets.length} días`
      : "Añadir ejercicios";
  }
  if (libraryMultiChips) {
    libraryMultiChips.classList.toggle("hidden", !libraryMultiSelect.active || libraryMultiSelect.targets.length === 0);
    if (libraryMultiSelect.active) {
      renderSelectionChips(libraryMultiChips, libraryMultiSelect.targets, (iso) => {
        removeTargetFromList(libraryMultiSelect.targets, iso);
        updateLibraryMultiUI();
      });
    } else {
      libraryMultiChips.innerHTML = "";
    }
  }
  if (libraryMultiBox) {
    libraryMultiBox.classList.toggle("hidden", !libraryMultiSelect.active);
  }
  if (libraryMultiToggleBtn) {
    libraryMultiToggleBtn.textContent = libraryMultiSelect.active ? "Salir de selección" : "Seleccionar varios";
  }
  if (libraryMultiDateInput && libraryMultiSelect.active && !libraryMultiDateInput.value) {
    libraryMultiDateInput.value = state.selectedDate;
  }
}

function setLibraryMultiActive(active){
  const next = !!active;
  if (libraryMultiSelect.active === next) {
    if (next) {
      if (libraryMultiDateInput && !libraryMultiDateInput.value) {
        libraryMultiDateInput.value = state.selectedDate;
      }
      updateLibraryMultiUI();
    }
    return;
  }
  libraryMultiSelect.active = next;
  libraryMultiSelect.selected.clear();
  if (!next) {
    libraryMultiSelect.targets = [];
  } else {
    libraryMultiSelect.targets = [];
    addTargetToList(libraryMultiSelect.targets, state.selectedDate);
    if (libraryMultiDateInput) libraryMultiDateInput.value = state.selectedDate;
  }
  updateLibraryMultiGoalSections();
  renderLibrary();
  updateLibraryMultiUI();
}

function handleLibraryMultiAddDate(){
  if (!libraryMultiSelect.active || !libraryMultiDateInput) return;
  const raw = getInputValue(libraryMultiDateInput) || state.selectedDate;
  const iso = fmt(fromISO(raw));
  if (addTargetToList(libraryMultiSelect.targets, iso)) {
    updateLibraryMultiUI();
  }
  libraryMultiDateInput.value = "";
  libraryMultiDateInput.focus();
}

function serializeLibraryMultiConfig(){
  const goalInput = libraryMultiGoalInputs.find((input) => input.checked);
  const goalType = normalizeGoalType(goalInput ? goalInput.value : "reps");
  const payload = {
    goalType,
    weight: null,
    notes: getInputValue(libraryMultiNotesInput),
  };
  const weightRaw = getInputValue(libraryMultiWeightInput);
  if (weightRaw) {
    const weightNumber = Number(weightRaw);
    if (!Number.isFinite(weightNumber)) {
      alert("Introduce un valor numérico para el lastre.");
      return null;
    }
    payload.weight = weightNumber;
  }
  if (goalType === "reps") {
    const series = Number(getInputValue(libraryMultiSeriesInput) || 0);
    const reps = Number(getInputValue(libraryMultiRepsInput) || 0);
    if (!series || !reps) {
      alert("Indica series y repeticiones para el objetivo.");
      return null;
    }
    payload.series = series;
    payload.reps = reps;
    payload.alFallo = isChecked(libraryMultiFailureInput);
  } else if (goalType === "isometrico") {
    const series = Number(getInputValue(libraryMultiIsoSeriesInput) || 0);
    const seconds = Number(getInputValue(libraryMultiIsoSecondsInput) || 0);
    if (!series || !seconds) {
      alert("Indica series y segundos para el isométrico.");
      return null;
    }
    payload.series = series;
    payload.segundos = seconds;
    payload.alFallo = isChecked(libraryMultiIsoFailureInput);
  } else if (goalType === "fallo") {
    const series = Number(getInputValue(libraryMultiFailSeriesInput) || 0);
    if (!series) {
      alert("Indica cuántas series harás al fallo.");
      return null;
    }
    payload.series = series;
    payload.alFallo = true;
  } else if (goalType === "emom") {
    const minutes = Number(getInputValue(libraryMultiEmomMinutesInput) || 0);
    const repsPerMin = Number(getInputValue(libraryMultiEmomRepsInput) || 0);
    if (!minutes || !repsPerMin) {
      alert("Indica minutos y repeticiones por minuto para el EMOM.");
      return null;
    }
    payload.minutos = minutes;
    payload.repsPorMin = repsPerMin;
    payload.series = null;
  } else if (goalType === "cardio") {
    const minutes = Number(getInputValue(libraryMultiCardioMinutesInput) || 0);
    if (!minutes) {
      alert("Indica los minutos de cardio.");
      return null;
    }
    payload.minutos = minutes;
    payload.series = null;
  }
  return payload;
}

function applyLibraryMultiSelection(){
  if (!libraryMultiSelect.active) return;
  const selectedIds = Array.from(libraryMultiSelect.selected);
  if (!selectedIds.length) {
    alert("Selecciona al menos un ejercicio de la librería.");
    return;
  }
  if (!libraryMultiSelect.targets.length) {
    alert("Añade al menos un día destino.");
    return;
  }
  const config = serializeLibraryMultiConfig();
  if (!config) return;
  const libraryItems = getLibrary().filter((item) => selectedIds.includes(item.id));
  if (!libraryItems.length) {
    alert("Los ejercicios seleccionados ya no están disponibles.");
    return;
  }
  const updates = new Map();
  libraryMultiSelect.targets.forEach((target) => {
    const iso = fmt(fromISO(target));
    libraryItems.forEach((item) => {
      const result = buildExerciseFromLibrary(item, { ...config, dateISO: iso });
      if (!result) return;
      const { dayISO, exercise } = result;
      if (!updates.has(dayISO)) updates.set(dayISO, []);
      updates.get(dayISO).push(exercise);
    });
  });
  if (!updates.size) {
    alert("No se pudieron preparar los ejercicios seleccionados.");
    return;
  }
  updates.forEach((list, iso) => {
    const existing = getDayWorkouts(iso);
    state.workouts[iso] = existing.concat(list);
  });
  save();
  updates.forEach((_, iso) => {
    syncHistoryForDay(iso, { showToast: false });
  });
  renderDay(state.selectedDate);
  renderMiniCalendar();
  callSeguimiento("refresh");
  const totalDays = updates.size;
  alert(totalDays === 1 ? "Ejercicios añadidos al día seleccionado." : `Ejercicios añadidos en ${totalDays} días.`);
  setLibraryMultiActive(false);
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
  const completed = exercises.filter((ex) => isExerciseDone(ex)).length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return { total, completed, percent };
}

function computeLoadWeekStreak(dayISO){
  const startISO = getWeekStartISO(dayISO);
  let count = 0;
  let cursor = fromISO(startISO);
  for (let i = 0; i < 52; i += 1) { // limitar a un año para evitar bucles infinitos
    const weekISO = fmt(cursor);
    if (getWeekType(weekISO) === "carga") {
      count += 1;
      cursor.setDate(cursor.getDate() - 7);
      continue;
    }
    break;
  }
  return count;
}

function buildRecentWeekTypes(dayISO, amount = 6){
  const startDate = fromISO(getWeekStartISO(dayISO));
  const weeks = [];
  for (let i = amount - 1; i >= 0; i -= 1) {
    const cursor = new Date(startDate);
    cursor.setDate(cursor.getDate() - i * 7);
    const iso = fmt(cursor);
    weeks.push({ weekStart: iso, type: getWeekType(iso) });
  }
  return weeks;
}

function buildTrackedWeekCalendar(dayISO){
  const weekStarts = new Set();

  const addWeekStart = (iso) => {
    if (!iso) return;
    weekStarts.add(getWeekStartISO(iso));
  };

  if (state.weekTypes) {
    Object.keys(state.weekTypes).forEach((weekISO) => addWeekStart(weekISO));
  }
  if (state.workouts) {
    Object.keys(state.workouts).forEach((dayISO) => addWeekStart(dayISO));
  }

  const todayISO = fmt(new Date());
  addWeekStart(dayISO || state.selectedDate || todayISO);
  addWeekStart(todayISO);

  if (!weekStarts.size) return [];

  const sortedStarts = Array.from(weekStarts)
    .map((iso) => fromISO(getWeekStartISO(iso)))
    .sort((a, b) => a.getTime() - b.getTime());

  const first = sortedStarts[0];
  const last = sortedStarts[sortedStarts.length - 1];
  const cursor = new Date(first);
  const end = new Date(last);

  const calendar = [];
  while (cursor <= end) {
    const weekStart = fmt(cursor);
    calendar.push({
      weekStart,
      type: getWeekType(weekStart)
    });
    cursor.setDate(cursor.getDate() + 7);
  }

  return calendar;
}

function renderWeekCalendar(dayISO){
  if (!weekCalendar) return;

  const allWeeks = buildTrackedWeekCalendar(dayISO);
  const selectedWeek = getWeekStartISO(dayISO || state.selectedDate || fmt(new Date()));
  const currentWeek = getWeekStartISO(fmt(new Date()));

  if (weekCalendarCount) {
    weekCalendarCount.textContent = allWeeks.length
      ? `${allWeeks.length} ${allWeeks.length === 1 ? "semana" : "semanas"}`
      : "Sin semanas guardadas";
  }

  weekCalendar.innerHTML = "";
  if (!allWeeks.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Añade semanas de carga o descarga para ver el calendario.";
    weekCalendar.append(empty);
    return;
  }

  let currentMonthLabel = "";
  let monthGrid = null;

  allWeeks.forEach(({ weekStart, type }) => {
    const start = fromISO(weekStart);
    const end = fromISO(getWeekEndISO(weekStart));
    const monthLabel = start.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

    if (monthLabel !== currentMonthLabel) {
      currentMonthLabel = monthLabel;
      const monthSection = document.createElement("div");
      monthSection.className = "week-month";
      const title = document.createElement("div");
      title.className = "week-month-title";
      title.textContent = monthLabel;
      monthGrid = document.createElement("div");
      monthGrid.className = "week-month-grid";
      monthSection.append(title, monthGrid);
      weekCalendar.append(monthSection);
    }

    const card = document.createElement("div");
    card.className = `week-week-card week-type-${type}`;
    if (weekStart === selectedWeek) card.classList.add("selected");
    if (weekStart === currentWeek) card.classList.add("current");

    const range = document.createElement("span");
    range.className = "week-range";
    const startLabel = start.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    const endLabel = end.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    range.textContent = `${startLabel} – ${endLabel}`;

    const typeTag = document.createElement("span");
    typeTag.className = `week-type-tag ${type}`;
    typeTag.textContent = WEEK_TYPE_LABELS[type] || WEEK_TYPE_LABELS.normal;

    const legend = document.createElement("span");
    legend.className = "week-legend";
    legend.textContent = weekStart === currentWeek
      ? "Semana actual"
      : weekStart === selectedWeek
        ? "Semana seleccionada"
        : "Semana registrada";

    card.append(range, typeTag, legend);
    if (monthGrid) monthGrid.append(card);
  });
}

function renderTodayBadges(dayISO){
  if (!todayBadges) return;
  todayBadges.innerHTML = "";
  const completion = computeCompletion(dayISO);

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
    )
  );
}

function renderTodayInsights(dayISO, exercises){
  if (!todayPanel) return;
  const meta = getDayMeta(dayISO);
  const duration = computeDurationSummary(exercises);
  const focus = detectFocus(exercises);
  const weekStartISO = getWeekStartISO(dayISO);
  const weekEndISO = getWeekEndISO(weekStartISO);
  const weekType = getWeekType(dayISO);

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
  if (todayHabitInputs && todayHabitInputs.length){
    todayHabitInputs.forEach((input)=>{
      const habitKey = input.dataset.habit;
      input.checked = !!meta.habits[habitKey];
    });
  }
  if (todayPhaseSelect) {
    todayPhaseSelect.value = meta.phase || "";
  }
  if (weekTypeRange) {
    const startLabel = fromISO(weekStartISO).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    const endLabel = fromISO(weekEndISO).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    weekTypeRange.textContent = `Semana ${startLabel} – ${endLabel}`;
  }
  if (weekTypeSelect) {
    suppressWeekTypeEvents = true;
    weekTypeSelect.value = weekType || "";
    suppressWeekTypeEvents = false;
  }
  if (weekTypePill) {
    const pillLabel = WEEK_TYPE_LABELS[weekType] || WEEK_TYPE_LABELS.normal;
    weekTypePill.textContent = `Semana ${pillLabel.toLowerCase()}`;
    weekTypePill.className = `week-pill week-pill-${weekType}`;
  }
  if (weekLoadStreakEl) {
    const streak = computeLoadWeekStreak(dayISO);
    weekLoadStreakEl.textContent = streak
      ? `Racha de carga: ${streak} ${streak === 1 ? "semana" : "semanas"}`
      : "Sin racha de carga";
    weekLoadStreakEl.classList.toggle("accent", streak > 0);
  }
  if (weekTrendList) {
    const recentWeeks = buildRecentWeekTypes(dayISO, 6);
    weekTrendList.innerHTML = "";
    recentWeeks.forEach(({ weekStart, type }) => {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = `week-dot ${type}`;
      const startLabel = fromISO(weekStart).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
      const endLabel = fromISO(getWeekEndISO(weekStart)).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
      const label = WEEK_TYPE_LABELS[type] || WEEK_TYPE_LABELS.normal;
      li.title = `Semana ${startLabel} – ${endLabel}: ${label}`;
      const srOnly = document.createElement("span");
      srOnly.className = "week-dot-label";
      srOnly.textContent = `Semana ${startLabel} – ${endLabel}: ${label}`;
      li.append(dot, srOnly);
      weekTrendList.append(li);
    });
  }

  renderWeekCalendar(dayISO);

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
    pointerId: hasValue(event.pointerId) ? event.pointerId : null,
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
  const current = getDayWorkouts(dayISO);
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
  if (seguimientoModule && typeof seguimientoModule.showToast === "function"){
    seguimientoModule.showToast(message);
  } else {
    console.info(message);
  }
}

function minutesToSeconds(value){
  if (historyStore && typeof historyStore.minutesToSeconds === "function"){
    return historyStore.minutesToSeconds(value);
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 60);
}

function buildHistoryDaySnapshot(dayISO){
  const ejercicios = getDayWorkouts(dayISO)
    .filter(isPlainObject)
    .map((exercise) => {
      const status = getExerciseStatus(exercise);
      return {
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
        estado: status,
        status,
        hecho: status === EXERCISE_STATUS.DONE,
      };
    });
  return { fechaISO: dayISO, sourceDayId: dayISO, ejercicios };
}

function syncHistoryForDay(dayISO, options = {}){
  if (!historyStore) return;
  const snapshot = buildHistoryDaySnapshot(dayISO);
  const result = historyStore.addOrUpdateFromDay(snapshot);
  if (options.showToast === false) return;
  const messages = Array.isArray(result && result.messages) ? result.messages : [];
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
  window.entrenoLibrary = Object.assign(window.entrenoLibrary || {}, {
    getLibrary,
    saveLibrary,
    addToLibrary,
    updateLibrary,
    removeFromLibrary,
    findLibraryExercise,
  });
}

function metaText(ex){
  const goalType = getExerciseGoalType(ex);
  const parts = [];
  if (goalType !== "cardio" && goalType !== "emom") {
    parts.push(`<span><strong>Series:</strong> ${ex.sets}</span>`);
  }

  const statusLabel = EXERCISE_STATUS_LABELS[getExerciseStatus(ex)] || EXERCISE_STATUS_LABELS[EXERCISE_STATUS.PENDING];
  parts.push(`<span><strong>Estado:</strong> ${statusLabel}</span>`);

  if (goalType === "reps") {
    if (!ex.failure) {
      const repsLabel = ex.reps && ex.reps > 0 ? ex.reps : "—";
      parts.push(`<span><strong>Repeticiones:</strong> ${repsLabel}</span>`);
    }
  } else if (goalType === "isometrico") {
    if (!ex.failure) {
      const secsLabel = ex.seconds && ex.seconds > 0 ? ex.seconds : "—";
      parts.push(`<span><strong>Segundos:</strong> ${secsLabel}</span>`);
    }
  } else if (goalType === "emom") {
    const minutes = ex.emomMinutes && ex.emomMinutes > 0 ? ex.emomMinutes : "—";
    const reps = ex.emomReps && ex.emomReps > 0 ? ex.emomReps : "—";
    parts.push(`<span><strong>EMOM:</strong> ${minutes}' · ${reps} reps/min</span>`);
  } else if (goalType === "cardio") {
    const minutesLabel = ex.cardioMinutes && ex.cardioMinutes > 0 ? ex.cardioMinutes : "—";
    parts.push(`<span><strong>Cardio:</strong> ${minutesLabel} min</span>`);
  }

  if (ex.weightKg!=null) parts.push(`<span><strong>Lastre:</strong> ${ex.weightKg} kg</span>`);
  return parts.join(" · ");
}

function updateEmomUI(instance){
  if (!instance || !instance.ex || !instance.elements) return;
  const { ex, elements } = instance;
  const timer = ensureEmomTimerState(ex);
  const totalSeconds = getEmomTotalSeconds(ex);
  const totalMinutes = totalSeconds ? Math.ceil(totalSeconds / 60) : 0;
  const repsGoal = ex.emomReps && ex.emomReps > 0 ? ex.emomReps : "—";
  elements.timeEl.textContent = formatEmomTime(timer ? timer.remainingSeconds : 0);
  elements.minuteEl.textContent = totalMinutes
    ? `Minuto ${timer.currentMinute} de ${totalMinutes}`
    : "Minuto —";
  elements.repsCount.textContent = timer ? timer.repsThisMinute : 0;
  elements.repsGoal.textContent = `Reps objetivo: ${repsGoal}`;
  elements.toggleBtn.textContent = timer && timer.isRunning ? "Pausar" : "Iniciar";
  const disabled = totalSeconds === 0;
  elements.toggleBtn.disabled = disabled;
  elements.resetBtn.disabled = disabled;
}

function scheduleEmomSave(){
  if (emomSaveTimeout) return;
  emomSaveTimeout = setTimeout(() => {
    save({ updateTimestamp: false });
    emomSaveTimeout = null;
  }, 1000);
}

function tickEmomTimers(){
  if (!emomInstances.size) return;
  const now = Date.now();
  let shouldSave = false;
  emomInstances.forEach((instance) => {
    const timer = ensureEmomTimerState(instance.ex);
    if (!timer || !timer.isRunning) return;
    const totalSeconds = getEmomTotalSeconds(instance.ex);
    if (!totalSeconds) {
      timer.isRunning = false;
      timer.lastTick = null;
      updateEmomUI(instance);
      return;
    }
    const lastTick = Number(timer.lastTick) || now;
    const elapsedSeconds = Math.floor((now - lastTick) / 1000);
    if (elapsedSeconds <= 0) return;
    timer.lastTick = now;
    const prevMinute = timer.currentMinute;
    timer.remainingSeconds = Math.max(0, timer.remainingSeconds - elapsedSeconds);
    const totalMinutes = Math.ceil(totalSeconds / 60);
    const elapsedTotal = totalSeconds - timer.remainingSeconds;
    timer.currentMinute = Math.min(totalMinutes, Math.floor(elapsedTotal / 60) + 1);
    if (timer.currentMinute !== prevMinute) {
      timer.repsThisMinute = 0;
    }
    if (timer.remainingSeconds === 0) {
      timer.isRunning = false;
      timer.lastTick = null;
    }
    updateEmomUI(instance);
    shouldSave = true;
  });
  if (shouldSave) {
    scheduleEmomSave();
  }
}

function ensureEmomInterval(){
  if (!emomIntervalId) {
    emomIntervalId = setInterval(tickEmomTimers, 1000);
  }
}

function registerEmomInstance(ex, dayISO, elements){
  if (!ex || !elements) return;
  emomInstances.set(ex.id, { ex, dayISO, elements });
  ensureEmomInterval();
  updateEmomUI({ ex, dayISO, elements });
}

function clearEmomInstances(){
  emomInstances.clear();
}

function buildEmomControls(ex, dayISO){
  const goalType = getExerciseGoalType(ex);
  if (goalType !== "emom") return null;
  ensureEmomTimerState(ex);

  const wrapper = document.createElement("div");
  wrapper.className = "emom-controls";

  const timerBox = document.createElement("div");
  timerBox.className = "emom-timer";
  const timeEl = document.createElement("div");
  timeEl.className = "emom-time";
  const minuteEl = document.createElement("div");
  minuteEl.className = "emom-minute";
  timerBox.append(timeEl, minuteEl);

  const actions = document.createElement("div");
  actions.className = "emom-actions";
  const toggleBtn = button("Iniciar", "small ghost emom-toggle");
  const resetBtn = button("Reset", "small ghost emom-reset");
  actions.append(toggleBtn, resetBtn);

  const repsBox = document.createElement("div");
  repsBox.className = "emom-reps";
  const repsLabel = document.createElement("span");
  repsLabel.className = "emom-reps-label";
  repsLabel.textContent = "Reps del minuto";
  const repsControls = document.createElement("div");
  repsControls.className = "emom-reps-controls";
  const decBtn = button("−", "small ghost");
  const repsCount = document.createElement("span");
  repsCount.className = "emom-reps-count";
  const incBtn = button("+", "small ghost");
  repsControls.append(decBtn, repsCount, incBtn);
  const repsGoal = document.createElement("div");
  repsGoal.className = "emom-reps-goal";
  repsBox.append(repsLabel, repsControls, repsGoal);

  wrapper.append(timerBox, actions, repsBox);

  registerEmomInstance(ex, dayISO, {
    timeEl,
    minuteEl,
    toggleBtn,
    resetBtn,
    repsCount,
    repsGoal,
  });

  toggleBtn.addEventListener("click", () => {
    const timer = ensureEmomTimerState(ex);
    if (!timer) return;
    if (timer.isRunning) {
      timer.isRunning = false;
      timer.lastTick = null;
    } else {
      if (timer.remainingSeconds <= 0) {
        resetEmomTimerState(ex);
      }
      timer.isRunning = true;
      timer.lastTick = Date.now();
    }
    updateEmomUI({ ex, dayISO, elements: { timeEl, minuteEl, toggleBtn, resetBtn, repsCount, repsGoal } });
    save();
  });

  resetBtn.addEventListener("click", () => {
    resetEmomTimerState(ex);
    updateEmomUI({ ex, dayISO, elements: { timeEl, minuteEl, toggleBtn, resetBtn, repsCount, repsGoal } });
    save();
  });

  incBtn.addEventListener("click", () => {
    const timer = ensureEmomTimerState(ex);
    if (!timer) return;
    timer.repsThisMinute += 1;
    updateEmomUI({ ex, dayISO, elements: { timeEl, minuteEl, toggleBtn, resetBtn, repsCount, repsGoal } });
    save();
  });

  decBtn.addEventListener("click", () => {
    const timer = ensureEmomTimerState(ex);
    if (!timer) return;
    timer.repsThisMinute = Math.max(0, timer.repsThisMinute - 1);
    updateEmomUI({ ex, dayISO, elements: { timeEl, minuteEl, toggleBtn, resetBtn, repsCount, repsGoal } });
    save();
  });

  return wrapper;
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

  const goalType = getExerciseGoalType(ex);

  const rReps = radioRow("Repeticiones", "goalEdit-"+ex.id, goalType === "reps");
  const rSecs = radioRow("Isométrico (segundos)", "goalEdit-"+ex.id, goalType === "isometrico");
  const rFail = radioRow("Al fallo", "goalEdit-"+ex.id, goalType === "fallo");
  const rEmom = radioRow("EMOM", "goalEdit-"+ex.id, goalType === "emom");
  const rCardio = radioRow("Cardio", "goalEdit-"+ex.id, goalType === "cardio");

  const rowReps = document.createElement("div"); rowReps.className = "row indent";
  const repsField = fieldInline("Reps", "number", hasValue(ex.reps) ? ex.reps : "", {min:1});
  const failRow = document.createElement("label"); failRow.className="row inline";
  const failChk = document.createElement("input"); failChk.type="checkbox"; failChk.checked = !!ex.failure && goalType === "reps";
  const failLbl = document.createElement("span"); failLbl.textContent="Al fallo";
  failRow.append(failChk, failLbl);
  rowReps.append(repsField.wrap, failRow);

  const rowSecs = document.createElement("div"); rowSecs.className="row indent hidden";
  const secsField = fieldInline("Segundos", "number", hasValue(ex.seconds) ? ex.seconds : "", {min:1});
  const failSecsRow = document.createElement("label"); failSecsRow.className="row inline";
  const failSecsChk = document.createElement("input"); failSecsChk.type="checkbox"; failSecsChk.checked = !!ex.failure && goalType === "isometrico";
  const failSecsLbl = document.createElement("span"); failSecsLbl.textContent="Al fallo";
  failSecsRow.append(failSecsChk, failSecsLbl);
  rowSecs.append(secsField.wrap, failSecsRow);

  const rowFailure = document.createElement("div"); rowFailure.className="row indent hidden";
  const failureHint = document.createElement("p"); failureHint.className = "muted";
  failureHint.textContent = "Usa el campo de series para ajustar las rondas al fallo.";
  rowFailure.append(failureHint);

  const rowEmom = document.createElement("div"); rowEmom.className="row indent hidden";
  const mField = fieldInline("Minutos", "number", hasValue(ex.emomMinutes) ? ex.emomMinutes : "", {min:1});
  const rField = fieldInline("Reps/min", "number", hasValue(ex.emomReps) ? ex.emomReps : "", {min:1});
  rowEmom.append(mField.wrap, rField.wrap);

  const rowCardio = document.createElement("div"); rowCardio.className="row indent hidden";
  const cardioField = fieldInline("Minutos", "number", hasValue(ex.cardioMinutes) ? ex.cardioMinutes : "", {min:1});
  rowCardio.append(cardioField.wrap);

  function toggleRows(){
    rowReps.classList.toggle("hidden", !rReps.input.checked);
    rowSecs.classList.toggle("hidden", !rSecs.input.checked);
    rowFailure.classList.toggle("hidden", !rFail.input.checked);
    rowEmom.classList.toggle("hidden", !rEmom.input.checked);
    rowCardio.classList.toggle("hidden", !rCardio.input.checked);
  }
  [rReps.input, rSecs.input, rFail.input, rEmom.input, rCardio.input].forEach(i=>i.addEventListener("change", toggleRows));
  toggleRows();

  typeWrap.append(rReps.row, rowReps, rSecs.row, rowSecs, rFail.row, rowFailure, rEmom.row, rowEmom, rCardio.row, rowCardio);

  // Lastre
  const wField = weightField("Lastre (kg)", hasValue(ex.weightKg) ? ex.weightKg : "");

  const actions = document.createElement("div");
  actions.className = "actions";
  const saveBtn = button("Guardar", "primary small");
  const cancelBtn = button("Cerrar", "ghost small");
  const deleteBtn = button("", "danger small");
  const deleteLabel = "Eliminar ejercicio";
  if (hasIconDecorator()) {
    decorateIcons(deleteBtn, "trash", { label: deleteLabel, showLabel: true });
  } else {
    deleteBtn.textContent = "Eliminar";
    deleteBtn.title = deleteLabel;
  }
  actions.append(saveBtn, cancelBtn, deleteBtn);

  box.append(fName.wrap, categoryWrap, fSets.wrap, typeWrap, wField.wrap, actions);

  saveBtn.addEventListener("click", ()=>{
    const prevGoalType = getExerciseGoalType(ex);
    const prevEmomMinutes = ex.emomMinutes;
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
      ex.goalType = "reps";
      ex.goal="reps";
      ex.reps = repsField.input.value ? Number(repsField.input.value) : null;
      ex.failure = !!failChk.checked;
      ex.seconds = null; ex.emomMinutes=null; ex.emomReps=null; ex.cardioMinutes=null;
    } else if (rSecs.input.checked){
      ex.goalType = "isometrico";
      ex.goal="seconds";
      ex.seconds = Number(secsField.input.value||0);
      ex.reps = null; ex.failure=!!failSecsChk.checked; ex.emomMinutes=null; ex.emomReps=null; ex.cardioMinutes=null;
    } else if (rFail.input.checked){
      ex.goalType = "fallo";
      ex.goal = "reps";
      ex.reps = null;
      ex.seconds = null;
      ex.failure = true;
      ex.emomMinutes = null;
      ex.emomReps = null;
      ex.cardioMinutes = null;
    } else if (rEmom.input.checked){
      ex.goalType = "emom";
      ex.goal="emom";
      ex.emomMinutes = Number(mField.input.value||0);
      ex.emomReps = Number(rField.input.value||0);
      ex.reps = null; ex.failure=false; ex.seconds=null; ex.cardioMinutes=null;
    } else {
      ex.goalType = "cardio";
      ex.goal="cardio";
      ex.cardioMinutes = Number(cardioField.input.value||0);
      ex.reps = null; ex.failure=false; ex.seconds=null; ex.emomMinutes=null; ex.emomReps=null;
    }

    const nextGoalType = getExerciseGoalType(ex);
    if (nextGoalType === "emom") {
      if (prevGoalType !== "emom" || prevEmomMinutes !== ex.emomMinutes) {
        resetEmomTimerState(ex);
      } else {
        ensureEmomTimerState(ex);
      }
    } else if (prevGoalType === "emom") {
      delete ex.emomTimer;
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
    if (editWrapper && editWrapper.classList) {
      editWrapper.classList.add("hidden");
    }
    save();
    syncHistoryForDay(state.selectedDate, { showToast: false });
    renderDay(state.selectedDate);
    callSeguimiento("refresh");
  });
  cancelBtn.addEventListener("click", ()=>{
    const parent = box.parentElement;
    if (parent && parent.classList) {
      parent.classList.add("hidden");
    }
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
  input.type = type; input.value = hasValue(value) ? value : "";
  Object.entries(attrs).forEach(([k,v])=> input.setAttribute(k,v));
  wrap.append(span, input);
  return {wrap, input};
}
function weightField(label, value){
  const wrap = document.createElement("label"); wrap.className="field";
  const span = document.createElement("span"); span.textContent = label;
  const select = document.createElement("select");
  buildWeightOptions(select);
  setWeightSelectValue(select, value);
  wrap.append(span, select);
  return {wrap, input: select};
}
function fieldInline(label, type, value, attrs={}){
  const wrap = document.createElement("label"); wrap.className="field inline";
  const span = document.createElement("span"); span.textContent = label;
  const input = document.createElement("input");
  input.type = type; input.value = hasValue(value) ? value : "";
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

function cloneExerciseForCopy(exercise){
  if (!isPlainObject(exercise)) return null;
  const sets = Math.max(1, Number(exercise.sets) || 1);
  const clone = {
    ...exercise,
    id: randomUUID(),
    plannedId: randomUUID(),
    status: EXERCISE_STATUS.PENDING,
    completed: false,
    hecho: false,
    done: exercise.failure ? Array.from({ length: sets }, () => null) : [],
  };
  return clone;
}

function removeExercise(dayISO, id){
  const list = getDayWorkouts(dayISO);
  const idx = list.findIndex(x=>x.id===id);
  if (idx>=0){
    list.splice(idx,1);
    state.workouts[dayISO] = list;
    syncHistoryForDay(dayISO, { showToast: false });
    save();
    renderDay(dayISO);
    renderMiniCalendar();
    callSeguimiento("refresh");
  }
}

/* ========= Selección múltiple ========= */
if (dayMultiToggleBtn) {
  dayMultiToggleBtn.addEventListener("click", () => setDayMultiActive(!dayMultiSelect.active));
}
if (dayMultiCancelBtn) {
  dayMultiCancelBtn.addEventListener("click", () => setDayMultiActive(false));
}
if (dayMultiAddDateBtn) {
  dayMultiAddDateBtn.addEventListener("click", handleDayMultiAddDate);
}
if (dayMultiDateInput) {
  dayMultiDateInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleDayMultiAddDate();
    }
  });
}
if (dayMultiApplyBtn) {
  dayMultiApplyBtn.addEventListener("click", applyDayMultiSelection);
}

if (libraryMultiToggleBtn) {
  libraryMultiToggleBtn.addEventListener("click", () => setLibraryMultiActive(!libraryMultiSelect.active));
}
if (libraryMultiCancelBtn) {
  libraryMultiCancelBtn.addEventListener("click", () => setLibraryMultiActive(false));
}
if (libraryMultiAddDateBtn) {
  libraryMultiAddDateBtn.addEventListener("click", handleLibraryMultiAddDate);
}
if (libraryMultiDateInput) {
  libraryMultiDateInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleLibraryMultiAddDate();
    }
  });
}
if (libraryMultiApplyBtn) {
  libraryMultiApplyBtn.addEventListener("click", applyLibraryMultiSelection);
}
if (libraryMultiGoalInputs.length) {
  libraryMultiGoalInputs.forEach((input) => {
    input.addEventListener("change", updateLibraryMultiGoalSections);
  });
}

updateDayMultiUI();
updateLibraryMultiGoalSections();
updateLibraryMultiUI();

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
  const dstISO = fmt(fromISO(dst));
  const items = getDayWorkouts(src)
    .filter(isPlainObject)
    .map(cloneExerciseForCopy)
    .filter(Boolean);
  const targetList = getDayWorkouts(dstISO);
  state.workouts[dstISO] = targetList.concat(items);
  save();
  syncHistoryForDay(dstISO, { showToast: false });
  alert("Día copiado.");
  copyDayBox.classList.add("hidden");
  renderMiniCalendar();
  callSeguimiento("refresh");
});

/* ========= Cambiar de día (prev/next) ========= */
function shiftSelectedDay(delta){
  const d = fromISO(state.selectedDate);
  d.setDate(d.getDate()+delta);
  state.selectedDate = fmt(d);
  selectedDateInput.value = state.selectedDate;
  formDate.value = state.selectedDate;
  if (templateApplyDate) templateApplyDate.value = state.selectedDate;
  mcRefDate = new Date(d.getFullYear(), d.getMonth(), 1);
  save(); renderAll();
  highlightMiniCalSelected();
}

/* ========= Tabs helper ========= */
function switchToTab(name){
  const activeTabBtn = document.querySelector(".tab.active");
  if (activeTabBtn) {
    activeTabBtn.classList.remove("active");
  }
  const targetTabBtn = document.querySelector(`.tab[data-tab="${name}"]`);
  if (targetTabBtn) {
    targetTabBtn.classList.add("active");
  }
  document.querySelectorAll(".tab").forEach((tab)=>{
    tab.setAttribute("aria-selected", tab.dataset.tab === name ? "true" : "false");
  });
  for (const key in tabPanels) {
    const panel = tabPanels[key];
    if (!panel) continue;
    panel.classList.toggle("hidden", key !== name);
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
    const hasExercises = getDayWorkouts(dayISO).length > 0;
    if (hasExercises) btn.classList.add("has");
    const weekTypeKey = state.weekTypes && state.weekTypes[getWeekStartISO(dayISO)];
    if (weekTypeKey) {
      btn.classList.add(`week-type-${weekTypeKey}`);
    }

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
