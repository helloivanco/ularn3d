// Player feel and accessibility preferences, stored apart from game saves.
export const FEEL_KEY = "ularn3d.feel.v1";
export const MOTION_CHOICES = Object.freeze(["system", "reduced", "full"]);
export const feelSettings = (value = {}) => {
  const flag = (input, fallback) => typeof input === "boolean" ? input : fallback;
  return {
    shake: Number.isFinite(value?.shake) ? Math.max(0, Math.min(1, value.shake)) : .7,
    flashes: flag(value?.flashes, true),
    numbers: flag(value?.numbers, true),
    healthBars: flag(value?.healthBars, true),
    motion: MOTION_CHOICES.includes(value?.motion) ? value.motion : "system",
  };
};
export const loadFeel = (storage) => {
  try { return feelSettings(JSON.parse(storage?.getItem(FEEL_KEY) || "{}")); } catch { return feelSettings(); }
};
export const saveFeel = (storage, settings) => {
  try { storage?.setItem(FEEL_KEY, JSON.stringify(feelSettings(settings))); } catch {}
};
export const motionReduced = (settings, systemReduced) =>
  settings.motion === "reduced" || (settings.motion === "system" && !!systemReduced);
