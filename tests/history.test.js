const assert = require('assert');
const history = require('../history.js');

function reset() {
  history.clear();
}

function testCompareWithLast() {
  reset();
  let diff = history.compareWithLast('Dominadas', 'reps', 10);
  assert.strictEqual(diff.last, null, 'Primer registro debería no tener último valor');
  assert.ok(diff.message.includes('Primer registro'), 'Debe indicar primer registro');

  history.addEntry({
    fechaISO: '2024-01-01',
    ejercicio: 'Dominadas',
    tipo: 'reps',
    valor: 10
  });

  diff = history.compareWithLast('Dominadas', 'reps', 12);
  assert.strictEqual(diff.last, 10, 'Último valor debe ser 10');
  assert.strictEqual(diff.delta, 2, 'Delta debe ser 2');
  assert.ok(diff.message.includes('+2'), 'Mensaje debe contener el incremento');
}

function testMinutesToSeconds() {
  const result = history.minutesToSeconds(2.5);
  assert.strictEqual(result, 150, '2.5 minutos son 150 segundos');
  assert.strictEqual(history.minutesToSeconds('invalid'), 0, 'Valores inválidos devuelven 0');
}

function run() {
  testCompareWithLast();
  testMinutesToSeconds();
  console.log('All history tests passed');
}

run();
