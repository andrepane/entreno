/* ==========
   Calendario Entrenos Híbridos
   - Guarda en localStorage
   - CRUD por día
   - Export/Import JSON
   - Plantillas rápidas
   ========== */

const daysGrid = document.getElementById('daysGrid');
const monthLabel = document.getElementById('monthLabel');
const prevBtn = document.getElementById('prevMonth');
const nextBtn = document.getElementById('nextMonth');
const selectedDateTitle = document.getElementById('selectedDateTitle');

const form = document.getElementById('entryForm');
const categoria = document.getElementById('categoria');
const ejercicio = document.getElementById('ejercicio');
const series = document.getElementById('series');
const reps = document.getElementById('reps');
const tiempo = document.getElementById('tiempo');
const peso = document.getElementById('peso');
const descanso = document.getElementById('descanso');
const notas = document.getElementById('notas');

const clearFormBtn = document.getElementById('clearForm');
const entriesList = document.getElementById('entriesList');
const exportDayBtn = document.getElementById('exportDay');
const deleteDayBtn = document.getElementById('deleteDay');
const exportAllBtn = document.getElementById('exportAll');
const importFile = document.getElementById('importFile');

const quickChips = document.getElementById('quickChips');

const calendarOverlay = document.getElementById('calendarOverlay');
const calendarMini = document.getElementById('calendarMini');
const closeCalendarBtn = document.getElementById('closeCalendar');
const miniDateLabel = document.getElementById('miniDateLabel');
const miniMonthLabel = document.getElementById('miniMonthLabel');

if(calendarMini){
  calendarMini.setAttribute('aria-expanded','false');
}

let current = new Date();
let selectedDateStr = toISODate(new Date());

const MONTH_NAMES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MONTH_NAMES_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

/* ===== Utils ===== */

function toISODate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function fromISODate(str){
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d);
}

function getData(){
  try{
    return JSON.parse(localStorage.getItem('hybridLog') || '{}');
  }catch(e){
    return {};
  }
}

function setData(data){
  localStorage.setItem('hybridLog', JSON.stringify(data));
}

function getDayEntries(dateStr){
  const db = getData();
  return db[dateStr] || [];
}

function setDayEntries(dateStr, entries){
  const db = getData();
  db[dateStr] = entries;
  setData(db);
}

function badgeClassFor(cat){
  if(!cat) return '';
  const c = cat.toLowerCase();
  if(c.includes('push') || c.includes('empuje')) return 'push';
  if(c.includes('tirón') || c.includes('espalda')) return 'pull';
  if(c.includes('pierna')) return 'legs';
  if(c.includes('skill')) return 'skills';
  if(c.includes('full')) return 'full';
  return '';
}

/* ===== Calendar Render ===== */

function renderCalendar(targetDate){
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth(); // 0-11

  // Etiqueta de mes (en español)
  monthLabel.textContent = `${capitalize(MONTH_NAMES[month])} ${year}`;
  updateMiniLabels();

  daysGrid.innerHTML = '';

  // Queremos que la semana empiece en Lunes
  const firstOfMonth = new Date(year, month, 1);
  let startDay = firstOfMonth.getDay(); // 0-Dom, 1-Lun ...
  if(startDay === 0) startDay = 7; // mover domingo al final
  const daysInMonth = new Date(year, month+1, 0).getDate();

  // Días del mes anterior para completar la primera semana
  const prevMonthDays = startDay - 1;

  // Total celdas: 6 filas * 7 columnas = 42 (para cuadrícula estable)
  const totalCells = 42;

  for(let cell=0; cell<totalCells; cell++){
    const dayEl = document.createElement('div');
    dayEl.className = 'day';

    const dayNumEl = document.createElement('div');
    dayNumEl.className = 'num';

    let thisDate;

    if(cell < prevMonthDays){
      // celdas del mes anterior
      const d = new Date(year, month, 1 - (prevMonthDays - cell));
      thisDate = d;
      dayEl.classList.add('out');
    } else if (cell >= prevMonthDays && cell < prevMonthDays + daysInMonth){
      // celdas del mes actual
      const day = cell - prevMonthDays + 1;
      thisDate = new Date(year, month, day);
    } else {
      // celdas del mes siguiente
      const day = cell - (prevMonthDays + daysInMonth) + 1;
      thisDate = new Date(year, month+1, day);
      dayEl.classList.add('out');
    }

    const dateStr = toISODate(thisDate);
    dayNumEl.textContent = thisDate.getDate();
    dayEl.appendChild(dayNumEl);

    // Badges por categorías presentes ese día
    const entries = getDayEntries(dateStr);
    if(entries.length){
      const badges = document.createElement('div');
      badges.className = 'badges';
      const presentCats = new Set(entries.map(e => e.categoria));
      presentCats.forEach(cat => {
        const b = document.createElement('span');
        b.className = `badge ${badgeClassFor(cat)}`;
        b.textContent = shortCat(cat);
        badges.appendChild(b);
      });
      dayEl.appendChild(badges);
    }

    // Selección de día
    dayEl.addEventListener('click', () => {
      selectedDateStr = dateStr;
      updateSelectedDateTitle();
      renderEntries();
      closeCalendarOverlay({focusTrigger:false});
      // scroll hacia editor en móvil
      if(window.innerWidth < 900){
        document.querySelector('.editor').scrollIntoView({behavior:'smooth', block:'start'});
      }
    });

    // Resaltar hoy
    if(toISODate(new Date()) === dateStr){
      dayEl.style.outline = '2px solid rgba(96,165,250,.35)';
      dayEl.style.outlineOffset = '0';
    }

    daysGrid.appendChild(dayEl);
  }
}

function shortCat(cat){
  if(!cat) return '';
  if(cat.includes('Push')) return 'Push';
  if(cat.includes('Tirón')) return 'Tirón';
  if(cat.includes('Pierna')) return 'Pierna';
  if(cat.includes('Skills')) return 'Skills';
  if(cat.includes('Full')) return 'Full';
  return cat;
}

function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

function updateMiniLabels(){
  if(miniDateLabel){
    const d = fromISODate(selectedDateStr);
    const day = d.getDate();
    const monthShort = MONTH_NAMES_SHORT[d.getMonth()] || '';
    miniDateLabel.textContent = `${day} ${capitalize(monthShort)}`;
  }
  if(miniMonthLabel){
    if(monthLabel && monthLabel.textContent){
      miniMonthLabel.textContent = monthLabel.textContent;
    } else {
      const d = fromISODate(selectedDateStr);
      miniMonthLabel.textContent = `${capitalize(MONTH_NAMES[d.getMonth()])} ${d.getFullYear()}`;
    }
  }
}

/* ===== Entries Render ===== */

function updateSelectedDateTitle(){
  const d = fromISODate(selectedDateStr);
  const label = `${d.getDate()}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  selectedDateTitle.textContent = `Día seleccionado: ${label}`;
  updateMiniLabels();
}

function renderEntries(){
  const entries = getDayEntries(selectedDateStr);
  entriesList.innerHTML = '';

  if(!entries.length){
    entriesList.classList.add('empty');
    entriesList.innerHTML = `<li>Sin ejercicios aún.</li>`;
    return;
  }
  entriesList.classList.remove('empty');

  entries.forEach((e, idx) => {
    const li = document.createElement('li');
    li.className = 'entry';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = `${e.ejercicio}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const pillCat = `<span class="pill">${e.categoria}</span>`;
    const pillMod = `<span class="pill">${e.modalidad}</span>`;
    const pillSR = (Number(e.series)||0) || (Number(e.reps)||0) ? `<span class="pill">${e.series||0}x${e.reps||0}</span>` : '';
    const pillT = e.tiempo ? `<span class="pill">${e.tiempo}s</span>` : '';
    const pillP = e.peso ? `<span class="pill">${e.peso} kg</span>` : '';
    const pillD = e.descanso ? `<span class="pill">${e.descanso}s desc.</span>` : '';
    meta.innerHTML = `${pillCat}${pillMod}${pillSR}${pillT}${pillP}${pillD}`;

    const notes = document.createElement('div');
    notes.style.fontSize = '13px';
    notes.style.color = '#c9d1d9';
    notes.textContent = e.notas || '';

    const ops = document.createElement('div');
    ops.className = 'ops';
    const btnEdit = document.createElement('button');
    btnEdit.className = 'ghost small';
    btnEdit.textContent = 'Editar';
    btnEdit.addEventListener('click', () => loadIntoForm(e, idx));

    const btnDel = document.createElement('button');
    btnDel.className = 'danger small';
    btnDel.textContent = 'Borrar';
    btnDel.addEventListener('click', () => deleteEntry(idx));

    ops.append(btnEdit, btnDel);

    li.append(title, meta);
    if(e.notas) li.appendChild(notes);
    li.appendChild(ops);
    entriesList.appendChild(li);
  });
}

/* ===== CRUD ===== */

let editIndex = null; // si no es null, estamos editando

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const modalidad = document.querySelector('input[name="modalidad"]:checked')?.value || 'Calistenia';

  const newEntry = {
    categoria: categoria.value,
    modalidad,
    ejercicio: ejercicio.value.trim(),
    series: series.value ? Number(series.value) : 0,
    reps: reps.value ? Number(reps.value) : 0,
    tiempo: tiempo.value ? Number(tiempo.value) : 0,
    peso: peso.value ? Number(peso.value) : 0,
    descanso: descanso.value ? Number(descanso.value) : 0,
    notas: (notas.value || '').trim()
  };

  if(!newEntry.categoria || !newEntry.ejercicio){
    alert('Categoría y ejercicio son obligatorios.');
    return;
  }

  const entries = getDayEntries(selectedDateStr);
  if(editIndex === null){
    entries.push(newEntry);
  } else {
    entries[editIndex] = newEntry;
    editIndex = null;
  }
  setDayEntries(selectedDateStr, entries);

  form.reset();
  // mantener modalidad calistenia por defecto
  document.getElementById('mod-cal').checked = true;

  renderEntries();
  renderCalendar(current);
});

function loadIntoForm(entry, idx){
  editIndex = idx;
  categoria.value = entry.categoria;
  (entry.modalidad === 'Musculación' ? document.getElementById('mod-mus') : document.getElementById('mod-cal')).checked = true;
  ejercicio.value = entry.ejercicio;
  series.value = entry.series || '';
  reps.value = entry.reps || '';
  tiempo.value = entry.tiempo || '';
  peso.value = entry.peso || '';
  descanso.value = entry.descanso || '';
  notas.value = entry.notas || '';
  ejercicio.focus();
}

function deleteEntry(idx){
  const entries = getDayEntries(selectedDateStr);
  entries.splice(idx,1);
  setDayEntries(selectedDateStr, entries);
  renderEntries();
  renderCalendar(current);
}

clearFormBtn.addEventListener('click', () => {
  editIndex = null;
  form.reset();
  document.getElementById('mod-cal').checked = true;
});

/* ===== Export/Import ===== */

exportDayBtn.addEventListener('click', () => {
  const data = getDayEntries(selectedDateStr);
  downloadJSON(data, `entrenos_${selectedDateStr}.json`);
});

deleteDayBtn.addEventListener('click', () => {
  if(!confirm('¿Borrar todos los ejercicios del día?')) return;
  setDayEntries(selectedDateStr, []);
  renderEntries();
  renderCalendar(current);
});

exportAllBtn.addEventListener('click', () => {
  const all = getData();
  downloadJSON(all, `entrenos_todos.json`);
});

importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file) return;
  try{
    const text = await file.text();
    const json = JSON.parse(text);

    // Si es un array, asumimos importación de un solo día al seleccionado
    if(Array.isArray(json)){
      setDayEntries(selectedDateStr, json);
    } else if (typeof json === 'object'){
      // Merge con el existente
      const existing = getData();
      const merged = {...existing, ...json};
      setData(merged);
    } else {
      alert('Formato JSON no reconocido.');
      return;
    }
    renderEntries();
    renderCalendar(current);
    importFile.value = '';
    alert('Importación completada.');
  }catch(err){
    alert('Error al importar JSON.');
  }
});

function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ===== Month navigation ===== */

prevBtn.addEventListener('click', () => {
  current = new Date(current.getFullYear(), current.getMonth()-1, 1);
  renderCalendar(current);
});
nextBtn.addEventListener('click', () => {
  current = new Date(current.getFullYear(), current.getMonth()+1, 1);
  renderCalendar(current);
});

/* ===== Quick templates ===== */

quickChips.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-ej]');
  if(!btn) return;
  categoria.value = btn.dataset.cat || '';
  ejercicio.value = btn.dataset.ej || '';
  document.getElementById(btn.dataset.mod === 'Musculación' ? 'mod-mus' : 'mod-cal').checked = true;
  series.value = btn.dataset.ser || '';
  reps.value = btn.dataset.rep || '';
  tiempo.value = btn.dataset.t || '';
  peso.value = '';
  descanso.value = '';
  notas.value = '';
  ejercicio.focus();
});

/* ===== Calendar overlay control ===== */

function openCalendarOverlay(){
  if(!calendarOverlay) return;
  calendarOverlay.classList.add('open');
  calendarOverlay.setAttribute('aria-hidden','false');
  if(calendarMini){
    calendarMini.setAttribute('aria-expanded','true');
  }
  if(closeCalendarBtn){
    setTimeout(() => closeCalendarBtn.focus(), 50);
  }
}

function closeCalendarOverlay({focusTrigger = true} = {}){
  if(!calendarOverlay) return;
  const wasOpen = calendarOverlay.classList.contains('open');
  if(!wasOpen) return;
  calendarOverlay.classList.remove('open');
  calendarOverlay.setAttribute('aria-hidden','true');
  if(calendarMini){
    calendarMini.setAttribute('aria-expanded','false');
  }
  if(focusTrigger && calendarMini){
    calendarMini.focus();
  }
}

if(calendarMini){
  calendarMini.addEventListener('click', () => openCalendarOverlay());
}
if(closeCalendarBtn){
  closeCalendarBtn.addEventListener('click', () => closeCalendarOverlay());
}
if(calendarOverlay){
  calendarOverlay.addEventListener('click', (e) => {
    if(e.target === calendarOverlay){
      closeCalendarOverlay();
    }
  });
}

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && calendarOverlay?.classList.contains('open')){
    e.preventDefault();
    closeCalendarOverlay();
  }
});

/* ===== Init ===== */

function boot(){
  selectedDateStr = toISODate(new Date());
  updateSelectedDateTitle();
  renderCalendar(current);
  renderEntries();
}

boot();
