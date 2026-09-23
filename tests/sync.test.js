const assert = require("node:assert/strict");
const fs = require("node:fs");
require("../sync-merge.js");
require("../sync-codec.js");

async function run() {
  const merge = globalThis.entrenoSyncMerge.merge;
  const base = { workouts: { "2026-01-01": [{ id: "a", reps: 5 }] }, dayMeta: {}, settings: { theme: "solar" } };
  const phone = structuredClone(base);
  phone.workouts["2026-01-02"] = [{ id: "b", reps: 8 }];
  const desktop = structuredClone(base);
  desktop.workouts["2026-01-03"] = [{ id: "c", reps: 9 }];
  const joined = merge(phone, desktop, base);
  assert.deepEqual(joined.conflicts, []);
  assert.equal(Object.keys(joined.state.workouts).length, 3);
  assert.deepEqual(merge(phone, desktop, null).conflicts, []);

  const edit = structuredClone(base);
  edit.workouts["2026-01-01"][0].reps = 10;
  const otherEdit = structuredClone(base);
  otherEdit.workouts["2026-01-01"][0].reps = 12;
  assert.deepEqual(merge(edit, otherEdit, base).conflicts, ["workouts.2026-01-01"]);
  const removed = structuredClone(base);
  delete removed.workouts["2026-01-01"];
  assert.deepEqual(merge(removed, base, base).state.workouts, {});
  assert.deepEqual(merge(removed, otherEdit, base).conflicts, ["workouts.2026-01-01"]);
  const samplePacked = await globalThis.entrenoSyncCodec.pack(base);
  await assert.rejects(
    globalThis.entrenoSyncCodec.unpack({ state: edit, packedState: samplePacked }),
    /versión antigua/
  );

  for (const filename of ["caligym-backup-2026-09-23.json", "caligym-backup-2026-09-23(Cintia).json"]) {
    if (!fs.existsSync("upload/" + filename)) continue; // Local fixtures; never commit personal backups.
    const backup = JSON.parse(fs.readFileSync("upload/" + filename, "utf8"));
    const packedState = await globalThis.entrenoSyncCodec.pack(backup.state);
    assert.ok(packedState.length < 900000, filename + " cabe en un documento");
    assert.deepEqual(await globalThis.entrenoSyncCodec.unpack({ packedState }), backup.state);
    assert.deepEqual(await globalThis.entrenoSyncCodec.unpack({ state: backup.state }), backup.state);
    console.log(filename, packedState.length, "bytes comprimidos en base64");
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
