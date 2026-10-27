// Original orchestral score, composed and rendered by scripts/build-audio.mjs
// (see scripts/audio/score.mjs). Each region is a stereo bed plus a two-channel
// stem holding its intensity layers: channel 0 "stir" (pulse), channel 1
// "fray" (brass, timpani, tremolo). The title never plays on its own; it
// shares the town files.
export const SCORE = Object.freeze({
  title: { title: "The Caves Below", bed: "town", tempo: 168, beats: 6 },
  town: { title: "Hearth of Ularn", bed: "town", tempo: 168, beats: 6 },
  caves: { title: "Stone and Shadow", bed: "caves", tempo: 60, beats: 4 },
  deep: { title: "The Deep Halls", bed: "deep", tempo: 52, beats: 4 },
  volcano: { title: "Beneath the Ember", bed: "volcano", tempo: 84, beats: 4 },
});
// Orchestral stingers share one sprite, stingers.flac: [start, duration] in seconds.
export const STINGERS = Object.freeze({
  levelup: [0, 4.4], descend: [4.4, 5.2], cure: [9.6, 5.8], death: [15.4, 7.6], victory: [23, 10.6],
});
// Town, the upper caves, the deep caves (8–15) and the volcano.
export const musicRegion = (level) => (level === 0 ? "town" : level > 15 ? "volcano" : level >= 8 ? "deep" : "caves");
export const audioSettings = (value = {}) => {
  const volume = (input, fallback) => Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : fallback;
  return { enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
    music: volume(value?.music, .55), effects: volume(value?.effects, .8) };
};
