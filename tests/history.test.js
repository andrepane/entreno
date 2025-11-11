const assert = require('assert');
const history = require('../history.js');

function reset() {
  history.clear();
}

function testCompareWithLast() {
  reset();
  let diff = history.compareProgress(
    history.getEntriesByExerciseAndType('Dominadas', 'reps')
  );
  assert.strictEqual(diff.primero, null, 'Sin registros previos, primero debe ser null');
  assert.strictEqual(diff.ultimo, null, 'Sin registros previos, último debe ser null');
  assert.strictEqual(diff.delta, 0, 'Sin registros previos, delta debe ser 0');

  history.addEntry({
    fechaISO: '2024-01-01',
    ejercicio: 'Dominadas',
    tipo: 'reps',
    valor: 10
  });

  history.addEntry({
    fechaISO: '2024-01-10',
    ejercicio: 'Dominadas',
    tipo: 'reps',
    valor: 12
  });

  diff = history.compareProgress(
    history.getEntriesByExerciseAndType('Dominadas', 'reps')
  );
  assert.strictEqual(diff.primero.valor, 10, 'El primer registro debe conservar el valor inicial');
  assert.strictEqual(diff.ultimo.valor, 12, 'El último registro debe reflejar el valor más reciente');
  assert.strictEqual(diff.delta, 2, 'La diferencia debe calcularse correctamente');
  assert.ok(Math.abs(diff.pct - 20) < 0.0001, 'El porcentaje debe reflejar el progreso relativo');
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
  assert.strictEqual(result.entries.length, 1, 'Debe añadir el ejercicio al marcarlo como hecho');
  let entries = history.getAllEntries();
  assert.strictEqual(entries.length, 1, 'Debe existir un único registro para el ejercicio hecho');
  assert.strictEqual(entries[0].valor, 12, 'Debe registrar la mejor serie realizada');
  assert.deepStrictEqual(entries[0].series, [12, 10, 11], 'Debe guardar cada serie por separado');
  assert.ok(
    entries[0].notas && entries[0].notas.includes('Series: 12 · 10 · 11'),
    'Las notas deben incluir el detalle de series'
  );

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
  assert.strictEqual(result.entries.length, 1, 'Debe registrarse al marcar el estado como hecho');
  assert.strictEqual(history.getAllEntries().length, 1, 'Historial debe incluir la entrada cuando el estado es hecho');

  day.ejercicios[0].status = 'pending';
  result = history.addOrUpdateFromDay(day);
  assert.strictEqual(result.entries.length, 0, 'Cambiar el estado a pendiente debe eliminar la entrada existente');
  assert.strictEqual(history.getAllEntries().length, 0, 'Historial debe limpiarse cuando el estado vuelve a pendiente');
}

function run() {
  testCompareWithLast();
  testMinutesToSeconds();
  testAddOrUpdateFromDayRespectsHecho();
  testAddOrUpdateFromDayRespectsStatusField();
  console.log('All history tests passed');
}

run();
