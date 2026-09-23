// Local synthesis keeps every effect available offline. Voices are bounded and
// disconnected on completion, including their filters and gain envelopes.
// Every wieldable weapon id has its own attack voice; types cover bare hands.
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

export class GameAudio {
  constructor() {
    this.context = null;
    this.voices = new Set();
    this.maxVoices = 24;
    this.noise = null;
  }
  prepare() {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") this.context.resume().catch(() => {});
    if (!this.noise) {
      const length = this.context.sampleRate;
      this.noise = this.context.createBuffer(1, length, length);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.context;
  }
  voice({
    frequency = 200,
    end = 100,
    duration = 0.2,
    delay = 0,
    type = "sine",
    volume = 0.025,
    noise = false,
  }) {
    if (this.voices.size >= this.maxVoices) return;
    const ctx = this.prepare(),
      start = ctx.currentTime + delay;
    const source = noise ? ctx.createBufferSource() : ctx.createOscillator();
    const gain = ctx.createGain();
    let filter;
    if (noise) {
      source.buffer = this.noise;
      filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(frequency, start);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, end),
        start + duration,
      );
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.type = type;
      source.frequency.setValueAtTime(frequency, start);
      source.frequency.exponentialRampToValueAtTime(
        Math.max(20, end),
        start + duration,
      );
      source.connect(gain);
    }
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    this.voices.add(source);
    source.onended = () => {
      source.disconnect();
      filter?.disconnect();
      gain.disconnect();
      this.voices.delete(source);
      source.onended = null;
    };
    source.start(start);
    source.stop(start + duration + 0.015);
  }
  play(kind, detail = {}) {
    try {
      if (document.hidden) return;
      if (kind === "weapon") {
        const [frequency, end, type, duration, weight] = weaponProfile(
          detail.weapon,
        );
        this.voice({ frequency, end, type, duration, volume: 0.035 });
        this.voice({
          frequency: frequency * 2,
          end,
          duration: duration * 0.8,
          noise: true,
          volume: 0.045 * weight,
        });
        if (detail.hit)
          this.voice({
            frequency: 130,
            end: 40,
            duration: 0.1,
            delay: 0.06,
            volume: 0.025,
          });
      } else if (kind === "spell") {
        const p = spellProfile(detail.spell);
        for (let i = 0; i < p.pulses; i++)
          this.voice({
            frequency: p.frequency * (1 + i * 0.25),
            end: p.frequency * p.endRatio,
            type: p.type,
            duration: p.duration,
            delay: i * p.interval,
            volume: 0.014,
          });
        if (["fire", "electric", "dark"].includes(p.family))
          this.voice({
            frequency: p.frequency * 3,
            end: 90,
            duration: p.duration,
            noise: true,
            volume: 0.025,
          });
      } else if (kind === "hurt")
        this.voice({
          frequency: 85,
          end: 35,
          type: "sawtooth",
          duration: 0.16,
          volume: 0.035,
        });
      else if (kind === "open")
        this.voice({ frequency: 420, end: 620, duration: 0.12, volume: 0.016 });
      else
        this.voice({
          frequency: 120,
          end: 65,
          duration: 0.07,
          noise: true,
          volume: 0.018,
        });
    } catch {
      /* Audio support is optional; gameplay continues normally. */
    }
  }
  suspend() {
    // Stop pending sounds before freezing the audio clock. Otherwise a full
    // voice pool cannot drain while suspended, or old attacks replay on resume.
    for (const source of this.voices) {
      try {
        source.stop();
      } catch {}
      source.onended?.();
    }
    if (this.context?.state === "running")
      return this.context.suspend().catch(() => {});
  }
}
