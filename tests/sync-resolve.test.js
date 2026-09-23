const assert = require("node:assert/strict");
const fs = require("node:fs");
require("../sync-resolve.js");
const resolve = globalThis.entrenoSyncResolve.localSuperset;

const remote = {
  workouts: { "2026-06-08": [{ id: "a", reps: 5, iconType: "asset", iconName: "a.png" }] },
  dayMeta: { "2026-06-08": { sessionRPE: 7 } },
  weekTypes: {},
  libraryExercises: [{ id: "a", name: "Press" }],
  globalNotes: [{ id: "n1", text: "Nota antigua" }],
  futureExercises: [],
  templates: [{ id: "t1", name: "Rutina", createdAt: "2026-01-01", exercises: [{ id: "x", plannedId: "p", name: "Press" }] }],
  settings: { theme: "neon", accent: "purple" },
  lastModifiedAt: "2026-06-12T00:00:00Z",
};
const local = structuredClone(remote);
local.workouts["2026-06-08"][0].iconType = "";
local.workouts["2026-09-23"] = [{ id: "b", reps: 10 }];
local.libraryExercises.push({ id: "b", name: "Pino" });
local.globalNotes.push({ id: "n2", text: "Nota nueva" });
local.templates[0].exercises[0].id = "new";
delete local.settings.accent;
local.lastModifiedAt = "2026-09-23T00:00:00Z";

const resolved = resolve(local, remote);
assert.ok(resolved);
assert.equal(Object.keys(resolved.workouts).length, 2);
assert.equal(resolved.settings.accent, "purple");
const changedReps = structuredClone(local);
changedReps.workouts["2026-06-08"][0].reps = 8;
assert.equal(resolve(changedReps, remote), null);
const cloudExtra = structuredClone(remote);
cloudExtra.workouts["2026-06-09"] = [{ id: "c" }];
assert.equal(resolve(local, cloudExtra), null);
const newerCloud = structuredClone(remote);
newerCloud.lastModifiedAt = "2026-09-24T00:00:00Z";
assert.equal(resolve(local, newerCloud), null);

const fixture = "upload/caligym-conflicto-andrea-2026-09-23.json";
if (fs.existsSync(fixture)) {
  const { local: phone, remoteAtConflict: cloud } = JSON.parse(fs.readFileSync(fixture));
  const actual = resolve(phone, cloud);
  assert.ok(actual);
  assert.equal(Object.keys(actual.workouts).length, 214);
  assert.equal(Object.values(actual.workouts).reduce((n, exercises) => n + exercises.length, 0), 2113);
  console.log("Copia real: 214 días y 2113 ejercicios conservados");
}
