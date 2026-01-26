(function initIconPrune(global) {
  const ICON_PRUNE_LIMIT_DAYS = 14;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function getStartOfDay(date) {
    const base = date instanceof Date ? new Date(date) : new Date();
    base.setHours(0, 0, 0, 0);
    return base;
  }

  function parseISODate(value) {
    if (!value || typeof value !== "string") return null;
    const [year, month = 1, day = 1] = value.split("-").map(Number);
    if (!Number.isFinite(year)) return null;
    const date = new Date(year, (month || 1) - 1, day || 1);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function isDayOlderThanIconPruneLimit(dayISO, referenceDate = new Date(), limitDays = ICON_PRUNE_LIMIT_DAYS) {
    const dayDate = parseISODate(dayISO);
    if (!dayDate) return false;
    const reference = getStartOfDay(referenceDate);
    const diffDays = Math.floor((reference - dayDate) / MS_PER_DAY);
    return diffDays > limitDays;
  }

  function shouldIgnoreLibraryIcons(dayISO, autoPruneEnabled, referenceDate = new Date(), limitDays = ICON_PRUNE_LIMIT_DAYS) {
    if (!autoPruneEnabled) return false;
    return isDayOlderThanIconPruneLimit(dayISO, referenceDate, limitDays);
  }

  const api = {
    ICON_PRUNE_LIMIT_DAYS,
    isDayOlderThanIconPruneLimit,
    shouldIgnoreLibraryIcons,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  global.iconPrune = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
