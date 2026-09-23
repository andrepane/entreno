(function (global) {
  "use strict";
  const canonical = (value) => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

  // A missing base means this browser has never successfully synchronized this profile.
  // In that case only identical values and independent additions can be merged safely.
  function choose(local, remote, base, path, conflicts) {
    if (equal(local, remote)) return copy(local);
    if (base !== undefined) {
      if (equal(local, base)) return copy(remote);
      if (equal(remote, base)) return copy(local);
    } else {
      if (local === undefined) return copy(remote);
      if (remote === undefined) return copy(local);
    }
    conflicts.push(path);
    return copy(local);
  }

  function mergeMap(local, remote, base, path, conflicts) {
    const result = {};
    const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {}), ...Object.keys(base || {})]);
    keys.forEach((key) => {
      const value = choose(
        has(local, key) ? local[key] : undefined,
        has(remote, key) ? remote[key] : undefined,
        has(base, key) ? base[key] : undefined,
        path + "." + key,
        conflicts
      );
      if (value !== undefined) result[key] = value;
    });
    return result;
  }

  function merge(local, remote, base) {
    const conflicts = [];
    const merged = {};
    const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {}), ...Object.keys(base || {})]);
    keys.forEach((key) => {
      if (key === "selectedDate") {
        merged[key] = local[key] || remote[key];
        return;
      }
      if (key === "lastModifiedAt") {
        merged[key] = [local[key], remote[key]].filter(Boolean).sort().pop();
        return;
      }
      if (key === "plannedExercises") return; // Derived from workouts by app.js.
      const localValue = has(local, key) ? local[key] : undefined;
      const remoteValue = has(remote, key) ? remote[key] : undefined;
      const baseValue = has(base, key) ? base[key] : undefined;
      if (["workouts", "dayMeta", "weekTypes", "settings"].includes(key) &&
          (localValue || remoteValue) &&
          [localValue, remoteValue, baseValue].every((v) => v === undefined || (v && typeof v === "object" && !Array.isArray(v)))) {
        merged[key] = mergeMap(localValue, remoteValue, baseValue, key, conflicts);
      } else {
        const value = choose(localValue, remoteValue, baseValue, key, conflicts);
        if (value !== undefined) merged[key] = value;
      }
    });
    return { state: merged, conflicts };
  }

  global.entrenoSyncMerge = { merge };
})(typeof globalThis !== "undefined" ? globalThis : window);
