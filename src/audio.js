// Local synthesis keeps every effect available offline. Voices are bounded and
// disconnected on completion, including their filters and gain envelopes.
const WEAPONS = {
  unarmed: [90, 45, "sine", .11, .7],
  axe: [170, 45, "sawtooth", .27, .8],
  spear: [950, 190, "triangle", .16, .22],
  lance: [640, 95, "triangle", .24, .4],
  dagger: [1650, 600, "triangle", .1, .25],
  flail: [380, 65, "square", .3, .65],
  hammer: [110, 30, "sine", .34, .85],
  staff: [280, 95, "triangle", .19, .55],
  sword: [1200, 240, "triangle", .22, .48],
  blunt: [190, 55, "sine", .2, .72],
};
export function weaponProfile(type) {
  return WEAPONS[type] || WEAPONS.unarmed;
}
export function spellProfile(spell = {}) {
  // Each spell has its own pitch, interval, envelope, and pulse pattern. Spell
  // families also differ in timbre (flame, lightning, cold, healing, utility).
  const id = Number(spell.id) || 0;
  const name = String(spell.name || spell.code || "magic").toLowerCase();
  const family = /fire|flame/.test(name) ? "fire" : /lightning|bolt/.test(name) ? "electric" : /cold|ice/.test(name) ? "ice" : /heal|cure/.test(name) ? "heal" : /death|drain|annihil/.test(name) ? "dark" : "arcane";
  const waves = { fire: "sawtooth", electric: "square", ice: "sine", heal: "sine", dark: "sawtooth", arcane: "triangle" };
  const base = { fire: 180, electric: 430, ice: 880, heal: 390, dark: 85, arcane: 260 };
  return { family, type: waves[family], frequency: base[family] * 2 ** ((id % 24) / 24), endRatio: 1.12 + id * .017, duration: .24 + (id % 7) * .035, pulses: 2 + (id % 3), interval: .055 + (id % 5) * .014 };
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
  voice({ frequency = 200, end = 100, duration = .2, delay = 0, type = "sine", volume = .025, noise = false }) {
    if (this.voices.size >= this.maxVoices) return;
    const ctx = this.prepare(), start = ctx.currentTime + delay;
    const source = noise ? ctx.createBufferSource() : ctx.createOscillator();
    const gain = ctx.createGain();
    let filter;
    if (noise) {
      source.buffer = this.noise;
      filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(frequency, start);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, end), start + duration);
      source.connect(filter); filter.connect(gain);
    } else {
      source.type = type;
      source.frequency.setValueAtTime(frequency, start);
      source.frequency.exponentialRampToValueAtTime(Math.max(20, end), start + duration);
      source.connect(gain);
    }
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    this.voices.add(source);
    source.onended = () => {
      source.disconnect(); filter?.disconnect(); gain.disconnect();
      this.voices.delete(source);
      source.onended = null;
    };
    source.start(start); source.stop(start + duration + .015);
  }
  play(kind, detail = {}) {
    try {
      if (document.hidden) return;
      if (kind === "weapon") {
        const [frequency, end, type, duration, weight] = weaponProfile(detail.weapon?.type);
        this.voice({ frequency, end, type, duration, volume: .035 });
        this.voice({ frequency: frequency * 2, end, duration: duration * .8, noise: true, volume: .045 * weight });
        if (detail.hit) this.voice({ frequency: 130, end: 40, duration: .1, delay: .06, volume: .025 });
      } else if (kind === "spell") {
        const p = spellProfile(detail.spell);
        for (let i = 0; i < p.pulses; i++) this.voice({ frequency: p.frequency * (1 + i * .25), end: p.frequency * p.endRatio, type: p.type, duration: p.duration, delay: i * p.interval, volume: .014 });
        if (["fire", "electric", "dark"].includes(p.family)) this.voice({ frequency: p.frequency * 3, end: 90, duration: p.duration, noise: true, volume: .025 });
      } else if (kind === "hurt") this.voice({ frequency: 85, end: 35, type: "sawtooth", duration: .16, volume: .035 });
      else if (kind === "open") this.voice({ frequency: 420, end: 620, duration: .12, volume: .016 });
      else this.voice({ frequency: 120, end: 65, duration: .07, noise: true, volume: .018 });
    } catch { /* Audio support is optional; gameplay continues normally. */ }
  }
  suspend() {
    // Stop pending sounds before freezing the audio clock. Otherwise a full
    // voice pool cannot drain while suspended, or old attacks replay on resume.
    for (const source of this.voices) {
      try { source.stop(); } catch {}
      source.onended?.();
    }
    if (this.context?.state === "running") return this.context.suspend().catch(() => {});
  }
}
