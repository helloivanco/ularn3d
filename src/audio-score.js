// Original score and synchronized tension stems, authored in scripts/build-audio.mjs.
export const SCORE = Object.freeze({
  title: { title: "The Caves Below", bed: "title", tempo: 72, beats: 4 },
  town: { title: "Hearth of Ularn", bed: "town", tempo: 78, beats: 3 },
  caves: { title: "Stone and Shadow", bed: "caves", tempo: 64, beats: 4 },
  volcano: { title: "Beneath the Ember", bed: "volcano", tempo: 88, beats: 4 },
});
export const audioSettings = (value = {}) => {
  const volume = (input, fallback) => Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : fallback;
  return { enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
    music: volume(value?.music, .55), effects: volume(value?.effects, .8) };
};
