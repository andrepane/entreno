(function (global) {
  "use strict";
  const canon = (value) => Array.isArray(value) ? value.map(canon) :
    value && typeof value === "object" ?
      Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])])) : value;
  const equal = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const without = (value, keys) => Object.fromEntries(
    Object.entries(value || {}).filter(([key]) => !keys.includes(key))
  );
  const iconFields = ["iconType", "iconName", "emoji", "imageDataUrl"];

  // Returns null unless every meaningful remote record also exists unchanged locally.
  // Absence in the older cloud cannot prove deletion; the user explicitly chooses recovery.
  function localSuperset(local, remote) {
    if (!local || !remote ||
        !(Date.parse(local.lastModifiedAt) > Date.parse(remote.lastModifiedAt))) return null;

    for (const field of ["workouts", "dayMeta", "weekTypes"]) {
      for (const [key, remoteValue] of Object.entries(remote[field] || {})) {
        const localValue = local[field]?.[key];
        if (field !== "workouts") {
          if (!equal(localValue, remoteValue)) return null;
          continue;
        }
        if (!Array.isArray(localValue) || !Array.isArray(remoteValue) ||
            localValue.length !== remoteValue.length) return null;
        if (localValue.some((exercise, index) =>
          !equal(without(exercise, iconFields), without(remoteValue[index], iconFields)))) return null;
      }
    }

    for (const field of ["libraryExercises", "globalNotes"]) {
      const localById = new Map((local[field] || []).map((item) => [item.id, item]));
      for (const remoteItem of remote[field] || []) {
        if (!localById.has(remoteItem.id) || !equal(localById.get(remoteItem.id), remoteItem)) return null;
      }
    }

    if (!equal(local.futureExercises || [], remote.futureExercises || [])) return null;
    const localTemplates = new Map((local.templates || []).map((item) => [item.id, item]));
    for (const remoteTemplate of remote.templates || []) {
      const template = localTemplates.get(remoteTemplate.id);
      if (!template || !equal(without(template, ["exercises"]), without(remoteTemplate, ["exercises"]))) return null;
      if (!Array.isArray(template.exercises) || !Array.isArray(remoteTemplate.exercises) ||
          template.exercises.length !== remoteTemplate.exercises.length) return null;
      if (template.exercises.some((exercise, index) =>
        !equal(without(exercise, ["id", "plannedId"]), without(remoteTemplate.exercises[index], ["id", "plannedId"])))) return null;
    }
    for (const [key, value] of Object.entries(remote.settings || {})) {
      if (Object.prototype.hasOwnProperty.call(local.settings || {}, key) &&
          !equal(local.settings[key], value)) return null;
    }
    const handled = new Set(["workouts", "dayMeta", "weekTypes", "libraryExercises",
      "globalNotes", "futureExercises", "templates", "settings", "selectedDate",
      "lastModifiedAt", "plannedExercises"]);
    for (const [key, value] of Object.entries(remote)) {
      if (!handled.has(key) && !equal(local[key], value)) return null;
    }
    return { ...local, settings: { ...remote.settings, ...local.settings } };
  }
  global.entrenoSyncResolve = { localSuperset };
})(typeof globalThis !== "undefined" ? globalThis : window);
