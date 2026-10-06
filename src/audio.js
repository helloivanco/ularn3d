// Bundled beds and effects in public/audio. Nothing is fetched from the network.
// Weapon and spell profiles still differ so each attack keeps its own pitch.
// Reduced motion is not consulted here; visuals already honor that preference.
import { bedForLevel } from "./expedition-cues.js";
const WEAPONS = {
  unarmed: [90, 45, "sine", 0.11, 0.7],
  axe: [170, 45, "sawtooth", 0.27, 0.8],
  spear: [950, 190, "triangle", 0.16, 0.22],
  lance: [640, 95, "triangle", 0.24, 0.4],
  dagger: [1650, 600, "triangle", 0.1, 0.25],
  flail: [380, 65, "square", 0.3, 0.65],
  hammer: [110, 30, "sine", 0.34, 0.85],
  staff: [280, 95, "triangle", 0.19, 0.55],
  sword: [1200, 240, "triangle", 0.22, 0.48],
  blunt: [190, 55, "sine", 0.2, 0.72],
  // Per-weapon overrides so each blade and haft sounds distinct in combat.
  26: [1320, 280, "triangle", 0.2, 0.42], // sword of slashing
  27: [95, 28, "sine", 0.38, 0.9], // Bessman's flailing hammer
  28: [1480, 320, "sawtooth", 0.18, 0.35], // sunsword
  29: [880, 160, "triangle", 0.28, 0.55], // two-handed sword
  30: [1020, 210, "triangle", 0.15, 0.2], // spear
  31: [1780, 720, "triangle", 0.09, 0.22], // dagger
  40: [210, 70, "square", 0.16, 0.5], // belt of striking
  57: [155, 40, "sawtooth", 0.3, 0.85], // battle axe
  58: [1100, 220, "triangle", 0.21, 0.45], // longsword
  59: [340, 55, "square", 0.32, 0.7], // flail
  65: [520, 80, "triangle", 0.26, 0.38], // lance of death
  89: [260, 90, "sine", 0.22, 0.5], // staff of power
  90: [1400, 360, "sawtooth", 0.17, 0.4], // vorpal blade
  91: [760, 120, "sawtooth", 0.25, 0.6], // slayer
};

export function weaponProfile(weapon) {
  if (weapon == null) return WEAPONS.unarmed;
  if (typeof weapon === "string") return WEAPONS[weapon] || WEAPONS.unarmed;
  if (weapon.id != null && WEAPONS[weapon.id]) return WEAPONS[weapon.id];
  return WEAPONS[weapon.type] || WEAPONS.unarmed;
}

export function weaponSoundKeys() {
  return Object.keys(WEAPONS);
}

export function spellProfile(spell = {}) {
  // Each spell has its own pitch, interval, envelope, and pulse pattern. Spell
  // families also differ in timbre (flame, lightning, cold, healing, utility).
  const id = Number(spell.id) || 0;
  const name = String(spell.name || spell.code || "magic").toLowerCase();
  const family = /fire|flame/.test(name)
    ? "fire"
    : /lightning|bolt/.test(name)
      ? "electric"
      : /cold|ice/.test(name)
        ? "ice"
        : /heal|cure/.test(name)
          ? "heal"
          : /death|drain|annihil/.test(name)
            ? "dark"
            : "arcane";
  const waves = {
    fire: "sawtooth",
    electric: "square",
    ice: "sine",
    heal: "sine",
    dark: "sawtooth",
    arcane: "triangle",
  };
  const base = {
    fire: 180,
    electric: 430,
    ice: 880,
    heal: 390,
    dark: 85,
    arcane: 260,
  };
  return {
    family,
    type: waves[family],
    frequency: base[family] * 2 ** ((id % 24) / 24),
    endRatio: 1.12 + id * 0.017,
    duration: 0.24 + (id % 7) * 0.035,
    pulses: 2 + (id % 3),
    interval: 0.055 + (id % 5) * 0.014,
  };
}

const FILES = {
  town: "/audio/town.mp3",
  cave: "/audio/cave.mp3",
  step: "/audio/step.mp3",
  swing: "/audio/swing.mp3",
  hit: "/audio/hit.mp3",
  door: "/audio/door.mp3",
  stairs: "/audio/stairs.mp3",
  spell: "/audio/spell.mp3",
};

const EFFECT_GAIN = {
  step: 0.78,
  swing: 0.7,
  hit: 0.74,
  door: 0.68,
  stairs: 0.7,
  spell: 0.46,
};

const rateForWeapon = (weapon) => {
  const [frequency] = weaponProfile(weapon);
  return Math.min(1.32, Math.max(0.7, frequency / 980));
};

const rateForSpell = (spell) => {
  const profile = spellProfile(spell);
  return Math.min(1.35, Math.max(0.78, profile.frequency / 520));
};

export class GameAudio {
  constructor() {
    this.context = null;
    this.voices = new Set();
    this.maxVoices = 24;
    this.buffers = null;
    this.loading = null;
    this.fetched = null;
    this.music = null;
    this.duck = null;
    this.bed = null;
    this.enabled = false;
  }
  prepare() {
    this.context ??= new AudioContext();
    if (!this.duck) {
      this.duck = this.context.createGain();
      this.duck.gain.value = 1;
      this.duck.connect(this.context.destination);
    }
    if (this.context.state === "suspended") this.context.resume().catch(() => {});
    return this.context;
  }
  prefetch() {
    if (this.fetched || this.buffers) return;
    this.fetched = Promise.all(
      Object.entries(FILES).map(async ([key, url]) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Missing audio ${url}`);
        return [key, await response.arrayBuffer()];
      }),
    ).catch(() => null);
  }
  async load() {
    if (this.buffers) return this.buffers;
    this.prefetch();
    this.loading ??= (async () => {
      const packed = await this.fetched;
      if (!packed) return null;
      const ctx = this.prepare();
      const decoded = await Promise.all(
        packed.map(async ([key, bytes]) => [key, await ctx.decodeAudioData(bytes.slice(0))]),
      );
      this.buffers = Object.fromEntries(decoded);
      return this.buffers;
    })().catch(() => null);
    return this.loading;
  }
  startBed(kind) {
    const buffer = this.buffers?.[kind === "volcano" ? "cave" : kind];
    if (!buffer) return;
    this.stopMusic();
    const ctx = this.prepare();
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = "lowpass";
    if (kind === "volcano") {
      source.playbackRate.value = 0.9;
      filter.frequency.value = 1400;
      gain.gain.value = 0.58;
    } else if (kind === "cave") {
      filter.frequency.value = 7200;
      gain.gain.value = 0.68;
    } else {
      filter.frequency.value = 12000;
      gain.gain.value = 0.72;
    }
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.duck);
    source.start();
    this.music = { source, filter, gain, kind };
    this.bed = kind;
  }
  stopMusic() {
    const music = this.music;
    this.music = null;
    if (!music) return;
    try {
      music.source.stop();
    } catch {
      /* already stopped */
    }
    music.source.disconnect();
    music.filter.disconnect();
    music.gain.disconnect();
  }
  syncBed(level) {
    this.bed = bedForLevel(level);
    if (!this.enabled || !this.buffers) return;
    if (this.music?.kind === this.bed) return;
    this.startBed(this.bed);
  }
  enable(level) {
    this.enabled = true;
    this.bed = bedForLevel(level);
    this.prepare();
    this.load().then(() => {
      if (this.enabled) this.syncBed(level);
    }).catch(() => {});
  }
  stopVoices() {
    for (const source of this.voices) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.onended?.();
    }
  }
  hold() {
    this.stopVoices();
    if (this.context?.state === "running") return this.context.suspend().catch(() => {});
  }
  resume() {
    if (!this.enabled) return;
    this.prepare();
    if (!this.music && this.bed) this.syncBed(this.bed === "town" ? 0 : this.bed === "volcano" ? 16 : 1);
  }
  suspend() {
    this.enabled = false;
    this.stopVoices();
    this.stopMusic();
    if (this.context?.state === "running") return this.context.suspend().catch(() => {});
  }
  effect(name, { rate = 1, volume = 0.6, delay = 0 } = {}) {
    const buffer = this.buffers?.[name];
    if (!buffer || this.voices.size >= this.maxVoices) return;
    const ctx = this.prepare();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const start = ctx.currentTime + delay;
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.setValueAtTime(volume, start);
    source.connect(gain);
    gain.connect(ctx.destination);
    this.voices.add(source);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(source);
      source.onended = null;
    };
    source.start(start);
    source.stop(start + buffer.duration / rate + 0.02);
    this.duck.gain.cancelScheduledValues(start);
    this.duck.gain.setTargetAtTime(0.42, start, 0.015);
    this.duck.gain.setTargetAtTime(1, start + 0.22, 0.08);
  }
  play(kind, detail = {}) {
    try {
      if (typeof document !== "undefined" && document.hidden) return;
      if (!this.buffers) return;
      if (kind === "weapon") {
        const rate = rateForWeapon(detail.weapon);
        this.effect("swing", { rate, volume: EFFECT_GAIN.swing });
        if (detail.hit) this.effect("hit", { rate: Math.min(1.15, rate), volume: EFFECT_GAIN.hit, delay: 0.06 });
        return;
      }
      if (kind === "spell") {
        this.effect("spell", { rate: rateForSpell(detail.spell), volume: EFFECT_GAIN.spell });
        return;
      }
      if (kind === "hurt") {
        this.effect("hit", { rate: 0.74, volume: 0.4 });
        return;
      }
      const name = kind === "open" ? "door" : kind;
      if (EFFECT_GAIN[name]) this.effect(name, { volume: EFFECT_GAIN[name] });
    } catch {
      /* Audio support is optional; gameplay continues normally. */
    }
  }
}
