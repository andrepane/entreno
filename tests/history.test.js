const assert = require('assert');
const history = require('../history.js');

function reset() {
  history.clear();
}

function testCompareSessionsBySet() {
  reset();
  const previousSession = [
    {
      id: 'prev-s1',
      fechaISO: '2024-01-01',
      ejercicio: 'dominadas',
      tipo: 'reps',
      valor: 12,
      setIndex: 0,
      lastreKg: 0
    },
    {
      id: 'prev-s2',
      fechaISO: '2024-01-01',
      ejercicio: 'dominadas',
      tipo: 'reps',
      valor: 10,
      setIndex: 1,
      lastreKg: 0
    }
  ];
  const latestSession = [
    {
      id: 'latest-s1',
      fechaISO: '2024-01-10',
      ejercicio: 'dominadas',
      tipo: 'reps',
      valor: 13,
      setIndex: 0,
      lastreKg: 0
    },
    {
      id: 'latest-s2',
      fechaISO: '2024-01-10',
      ejercicio: 'dominadas',
      tipo: 'reps',
      valor: 9,
      setIndex: 1,
      lastreKg: 0
    }
  ];

  const comparison = history.compareSessionsBySet(latestSession, previousSession, { toleranceKg: 2 });
  assert.strictEqual(comparison.length, 2, 'Debe haber 2 comparativas (una por serie)');
  assert.strictEqual(comparison[0].delta, 1, 'Serie 1 debe mejorar en +1');
  assert.strictEqual(comparison[0].pct.toFixed(2), '8.33', 'Serie 1 debe mostrar porcentaje correcto');
  assert.strictEqual(comparison[1].delta, -1, 'Serie 2 debe bajar en -1');
  assert.strictEqual(comparison[1].comparable, true, 'Serie 2 es comparable con mismo lastre');

  const mismatch = history.compareSessionsBySet(
    [
      {
        id: 'latest-weighted',
        fechaISO: '2024-01-20',
        ejercicio: 'dominadas',
        tipo: 'reps',
        valor: 14,
        setIndex: 0,
        lastreKg: 0
      }
    ],
    [
      {
        id: 'prev-weighted',
        fechaISO: '2024-01-13',
        ejercicio: 'dominadas',
        tipo: 'reps',
        valor: 12,
        setIndex: 0,
        lastreKg: 10
      }
    ],
    { toleranceKg: 2 }
  );

  assert.strictEqual(mismatch[0].comparable, false, 'Lastres distintos deben marcarse no comparables');
  assert.strictEqual(mismatch[0].reason, 'load-mismatch', 'Debe informar motivo lastre distinto');
}

function testMinutesToSeconds() {
  const result = history.minutesToSeconds(2.5);
  assert.strictEqual(result, 150, '2.5 minutos son 150 segundos');
  assert.strictEqual(history.minutesToSeconds('invalid'), 0, 'Valores inválidos devuelven 0');
}

function testAddOrUpdateFromDayRespectsHecho() {
  reset();
  const day = {
    fechaISO: '2024-02-01',
    ejercicios: [
      {
        name: 'Dominadas',
        goal: 'reps',
        sets: 3,
        reps: 10,
        done: [12, 10, 11],
        hecho: false
      }
    ]
  };

  let result = history.addOrUpdateFromDay(day);
  assert.strictEqual(result.entries.length, 0, 'No debe registrar ejercicios sin marcar como hechos');
  assert.strictEqual(history.getAllEntries().length, 0, 'Historial debe permanecer vacío si no hay ejercicios hechos');

  day.ejercicios[0].hecho = true;
  result = history.addOrUpdateFromDay(day);
  assert.strictEqual(result.entries.length, 3, 'Debe crear una entrada por serie completada');
  let entries = history.getAllEntries();
  assert.strictEqual(entries.length, 3, 'Debe existir una entrada por cada serie realizada');
  const valores = entries.map((e) => e.valor).sort((a, b) => a - b);
  assert.deepStrictEqual(valores, [10, 11, 12], 'Las repeticiones deben guardarse por serie sin sumar');
  const sortedBySet = entries.slice().sort((a, b) => a.setIndex - b.setIndex);
  sortedBySet.forEach((entry, index) => {
    assert.strictEqual(entry.setIndex, index, 'Cada entrada debe conservar su índice de serie');
  });

  day.ejercicios[0].hecho = false;
  result = history.addOrUpdateFromDay(day);
  entries = history.getAllEntries();
  assert.strictEqual(entries.length, 0, 'Al desmarcar el ejercicio debe eliminarse del historial');
  assert.strictEqual(result.entries.length, 0, 'No debe registrar nuevas entradas al desmarcar el ejercicio');
}

function testAddOrUpdateFromDayRespectsStatusField() {
  reset();
  const day = {
    fechaISO: '2024-03-10',
    ejercicios: [
      {
        name: 'Fondos',
        goal: 'reps',
        sets: 2,
        reps: 10,
        done: [10, 10],
        status: 'not_done'
      }
    ]
  };

  let result = history.addOrUpdateFromDay(day);
  assert.strictEqual(result.entries.length, 0, 'Los ejercicios marcados como "no hecho" no deben registrarse');
  assert.strictEqual(history.getAllEntries().length, 0, 'Historial debe permanecer vacío si el estado es "no hecho"');

  day.ejercicios[0].status = 'done';
  result = history.addOrUpdateFromDay(day);
  assert.strictEqual(result.entries.length, 2, 'Debe registrarse una entrada por serie al marcar como hecho');
  assert.strictEqual(history.getAllEntries().length, 2, 'Historial debe incluir cada serie realizada');

  day.ejercicios[0].status = 'pending';
  result = history.addOrUpdateFromDay(day);
  assert.strictEqual(result.entries.length, 0, 'Cambiar el estado a pendiente debe eliminar la entrada existente');
  assert.strictEqual(history.getAllEntries().length, 0, 'Historial debe limpiarse cuando el estado vuelve a pendiente');
}

function testPRsSeparatedByLoad() {
  reset();
  const entries = [
    { id: 's1-bw', fechaISO: '2024-01-01', ejercicio: 'dominadas', tipo: 'reps', valor: 12, setIndex: 0, lastreKg: 0 },
    { id: 's1-plus', fechaISO: '2024-02-01', ejercicio: 'dominadas', tipo: 'reps', valor: 10, setIndex: 0, lastreKg: 10 },
    { id: 's1-bw-2', fechaISO: '2024-03-01', ejercicio: 'dominadas', tipo: 'reps', valor: 14, setIndex: 0, lastreKg: 0 }
  ];

  const prs = history.getPRsBySet(entries, 'reps');
  const keys = Object.keys(prs).sort();
  assert.strictEqual(keys.length, 2, 'Debe haber PRs separados por lastre');
  const bodyweightKey = keys.find((key) => key.startsWith('0|0'));
  const weightedKey = keys.find((key) => key.includes('10'));
  assert.ok(bodyweightKey, 'Debe existir clave para peso corporal');
  assert.ok(weightedKey, 'Debe existir clave para +10 kg');
  assert.strictEqual(prs[bodyweightKey].valor, 14, 'PR BW debe ser el mayor valor sin lastre');
  assert.strictEqual(prs[weightedKey].valor, 10, 'PR con lastre +10 debe mantenerse separado');
}

function run() {
  testCompareSessionsBySet();
  testMinutesToSeconds();
  testAddOrUpdateFromDayRespectsHecho();
  testAddOrUpdateFromDayRespectsStatusField();
  testPRsSeparatedByLoad();
  console.log('All history tests passed');
}

run();
