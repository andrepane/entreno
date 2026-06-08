const assert = require("assert");
const {
  ICON_PRUNE_LIMIT_DAYS,
  isDayOlderThanIconPruneLimit,
  shouldIgnoreLibraryIcons,
} = require("../icon-prune.js");

function testIsDayOlderThanLimit() {
  const reference = new Date(2024, 4, 15);
  const dayJustInside = "2024-05-08";
  const dayJustOutside = "2024-05-07";

  assert.strictEqual(
    isDayOlderThanIconPruneLimit(dayJustInside, reference, ICON_PRUNE_LIMIT_DAYS),
    false,
    "No debe marcar como antiguo cuando está dentro de los últimos 7 días"
  );
  assert.strictEqual(
    isDayOlderThanIconPruneLimit(dayJustOutside, reference, ICON_PRUNE_LIMIT_DAYS),
    true,
    "Debe marcar como antiguo cuando supera los 7 días"
  );
}

function testShouldIgnoreLibraryIcons() {
  const reference = new Date(2024, 4, 15);
  assert.strictEqual(
    shouldIgnoreLibraryIcons("2024-05-07", false, reference, ICON_PRUNE_LIMIT_DAYS),
    false,
    "No debe ignorar iconos cuando autoPrune está desactivado"
  );
  assert.strictEqual(
    shouldIgnoreLibraryIcons("2024-05-07", true, reference, ICON_PRUNE_LIMIT_DAYS),
    true,
    "Debe ignorar iconos cuando autoPrune está activo y es anterior"
  );
  assert.strictEqual(
    shouldIgnoreLibraryIcons("2024-05-10", true, reference, ICON_PRUNE_LIMIT_DAYS),
    false,
    "No debe ignorar iconos dentro de los últimos 7 días"
  );
}

function run() {
  testIsDayOlderThanLimit();
  testShouldIgnoreLibraryIcons();
  console.log("All icon prune tests passed");
}

run();
