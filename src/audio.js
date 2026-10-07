import { SCORE, audioSettings } from "./audio-score.js";

const WEAPONS = {
  unarmed: [80, 42, "sine", .13, .9], axe: [160, 45, "triangle", .3, .85],
  spear: [1200, 180, "triangle", .16, .28], lance: [720, 95, "triangle", .28, .5],
  dagger: [2000, 500, "triangle", .11, .2], flail: [420, 75, "triangle", .34, .7],
  hammer: [110, 32, "sine", .36, 1], staff: [260, 90, "triangle", .2, .6],
  sword: [1400, 250, "triangle", .24, .5], blunt: [150, 50, "sine", .23, .8],
};
export const weaponProfile = (type) => WEAPONS[type] || WEAPONS.unarmed;
export function spellProfile(spell = {}) {
  const id = Number(spell.id) || 0, name = String(spell.name || spell.code || "magic").toLowerCase();
  const family = /fire|flame/.test(name) ? "fire" : /lightning|bolt/.test(name) ? "electric" :
    /cold|ice/.test(name) ? "ice" : /heal|cure/.test(name) ? "heal" : /death|drain|annihil/.test(name) ? "dark" : "arcane";
  return { family, type: { fire: "triangle", electric: "triangle", ice: "sine", heal: "sine", dark: "triangle", arcane: "sine" }[family],
    frequency: { fire: 130, electric: 330, ice: 720, heal: 330, dark: 65, arcane: 220 }[family] * 2 ** ((id % 24) / 24),
    endRatio: 1.12 + id * .017, duration: .32 + (id % 7) * .04,
    pulses: 2 + id % 3, interval: .065 + id % 5 * .018 };
}

// Music is pre-rendered; gameplay only moves gain envelopes and short FX voices.
export class GameAudio {
  constructor(options = {}) {
    this.context = options.context || null; this.contextFactory = options.contextFactory || (() => new (window.AudioContext || window.webkitAudioContext)());
    this.settings = audioSettings(options); this.onChange = options.onChange || (() => {});
    this.voices = new Set(); this.maxVoices = 24; this.musicSources = new Set();
    this.cache = new Map(); this.epoch = 0; this.musicEpoch = 0; this.randomState = 0x83bd23;
    this.region = "title"; this.threat = 0; this.impactThreat = 0; this.menu = false;
    this.paused = false; this.unlocked = false; this.status = "idle"; this.error = "";
    this.history = []; this.effectsCount = 0; this.notesPlayed = 0;
  }
  random() { this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0; return this.randomState / 4294967296; }
  prepare() {
    if (!this.context || this.context.state === "closed") {
      if (this.context) this.context.onstatechange = null;
      this.stopMusic();
      for (const source of [...this.voices]) source.onended?.();
      this.context = this.contextFactory(); this.graph = null; this.noise = null;
    }
    const ctx = this.context;
    if (!this.graph) {
      this.master = ctx.createGain(); this.master.gain.value = .8;
      this.musicGain = ctx.createGain(); this.effectsGain = ctx.createGain(); this.duckGain = ctx.createGain();
      this.musicGain.gain.value = this.settings.music; this.effectsGain.gain.value = this.settings.effects;
      this.compressor = ctx.createDynamicsCompressor();
      Object.assign(this.compressor.threshold, { value: -12 }); this.compressor.knee.value = 18;
      this.compressor.ratio.value = 6; this.compressor.attack.value = .006; this.compressor.release.value = .2;
      this.musicGain.connect(this.duckGain); this.duckGain.connect(this.master); this.effectsGain.connect(this.master);
      this.master.connect(this.compressor); this.compressor.connect(ctx.destination);
      this.reverb = ctx.createConvolver(); this.wet = ctx.createGain(); this.wet.gain.value = .12;
      const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * .8), ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const data = impulse.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] = (this.random() * 2 - 1) * Math.exp(-i / ctx.sampleRate * 8);
      }
      this.reverb.buffer = impulse; this.reverb.connect(this.wet); this.wet.connect(this.effectsGain);
      this.graph = true;
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0); let low = 0;
      for (let i = 0; i < data.length; i++) { low = low * .7 + (this.random() * 2 - 1) * .3; data[i] = low * 2; }
      ctx.onstatechange = () => { if (ctx.state !== "running" && !this.paused && this.unlocked) this.status = "blocked"; this.notify(); };
    }
    return ctx;
  }
  notify() { this.onChange(this.metrics()); }
  async unlock() {
    if (!this.settings.enabled || this.paused) return false;
    try {
      const ctx = this.prepare(); this.unlocked = true;
      if (ctx.state !== "running") await ctx.resume();
      if (ctx.state !== "running" || this.paused || !this.settings.enabled) return false;
      if (!this.musicLoadError) { this.error = ""; this.status = this.loadingRegion ? "loading" : this.activeTrack ? "playing" : "ready"; }
      this.notify(); if (!this.musicLoadError) this.startMusic(); return true;
    } catch {
      this.status = "blocked"; this.error = "Sound could not start. Tap Sound to try again."; this.notify(); return false;
    }
  }
  configure(settings) {
    const previous = this.settings; this.settings = audioSettings({ ...previous, ...settings });
    if (this.context && this.graph) {
      const now = this.context.currentTime;
      this.musicGain.gain.setTargetAtTime(this.settings.music, now, .05);
      this.effectsGain.gain.setTargetAtTime(this.settings.effects, now, .03);
    }
    if (!this.settings.enabled) { this.error = ""; this.suspend(); }
    else if (!previous.enabled) { this.paused = false; this.unlock(); }
    if (this.settings.music === 0) this.stopMusic();
    else if (previous.music === 0 && this.settings.enabled) this.startMusic();
    this.notify();
  }
  scene(region, threat = 0) {
    const next = SCORE[region] ? region : "title";
    if (next !== this.region) { this.region = next; this.loadingRegion = null; this.musicLoadError = false; this.error = ""; this.musicEpoch++; this.offset = 0; this.startMusic(); }
    this.threat = Math.max(0, Math.min(1, threat)); this.updateTension();
  }
  setMenu(menu) { if (this.menu === !!menu) return; this.menu = !!menu; this.updateTension(); this.updateDuck(); }
  async load(name) {
    if (!this.cache.has(name)) this.cache.set(name, (async () => {
      const response = await fetch(`/audio/${name}.wav`);
      if (!response.ok) throw new Error("Music unavailable");
      return this.prepare().decodeAudioData(await response.arrayBuffer());
    })().catch((error) => { this.cache.delete(name); throw error; }));
    return this.cache.get(name);
  }
  async startMusic() {
    if (this.deferMusic || this.ended || !this.unlocked || this.paused || !this.settings.enabled || this.settings.music === 0 || this.context?.state !== "running") return;
    const region = this.region;
    if (this.activeTrack?.region === region || this.loadingRegion === region) return;
    const epoch = ++this.musicEpoch; this.loadingRegion = region; this.status = "loading"; this.notify();
    try {
      const [bed, stem] = await Promise.all([this.load(region), this.load(`${region}-tension`)]);
      if (epoch !== this.musicEpoch || this.paused || !this.settings.enabled || this.settings.music === 0) return;
      this.loadingRegion = null;
      const ctx = this.context, now = ctx.currentTime, offset = (this.offset || 0) % bed.duration;
      // Bound rapid stair transitions to the outgoing and incoming pair.
      for (const node of [...this.musicSources]) if (node !== this.activeTrack?.bed && node !== this.activeTrack?.stem) node.cleanup();
      if (this.activeTrack) for (const node of [this.activeTrack.bed, this.activeTrack.stem]) {
        node.gain.gain.cancelScheduledValues(now); node.gain.gain.setTargetAtTime(0, now, .35); node.source.stop(now + 1.8);
      }
      const create = (buffer, kind) => {
        const source = ctx.createBufferSource(), gain = ctx.createGain(); source.buffer = buffer; source.loop = true;
        source.connect(gain); gain.connect(this.musicGain); gain.gain.value = 0;
        const node = { source, gain, kind, region, cleanup: () => { try { source.stop(); } catch {} source.onended = null; source.disconnect(); gain.disconnect(); this.musicSources.delete(node); } };
        source.onended = node.cleanup; this.musicSources.add(node); source.start(now, offset % buffer.duration); return node;
      };
      this.activeTrack = { region, bed: create(bed, "bed"), stem: create(stem, "tension"), startedAt: now, offset, duration: bed.duration };
      this.activeTrack.bed.gain.gain.setTargetAtTime(1, now, .45); this.updateTension();
      this.status = "playing"; this.error = ""; this.notify();
      for (const key of this.cache.keys()) if (key !== region && key !== `${region}-tension`) this.cache.delete(key);
    } catch {
      if (epoch !== this.musicEpoch) return;
      this.loadingRegion = null; this.musicLoadError = true; this.status = "error"; this.error = "Music could not load. Effects remain available; tap Sound to retry."; this.notify();
    }
  }
  stopMusic() {
    this.musicEpoch++; this.loadingRegion = null;
    if (this.activeTrack && this.context) this.offset = (this.activeTrack.offset + this.context.currentTime - this.activeTrack.startedAt) % this.activeTrack.duration;
    for (const node of [...this.musicSources]) node.cleanup(); this.activeTrack = null;
  }
  finish(kind) {
    this.ended = true; this.epoch++; this.stopMusic();
    for (const source of [...this.voices]) { try { source.stop(); } catch {} source.onended?.(); }
    this.play(kind);
  }
  updateTension() {
    if (!this.activeTrack || !this.context) return;
    const value = Math.max(this.threat, this.impactThreat) * (this.menu ? .35 : .65);
    if (this.activeTrack.tension === value) return;
    this.activeTrack.tension = value;
    this.activeTrack.stem.gain.gain.setTargetAtTime(value, this.context.currentTime, .45);
  }
  combat() {
    this.impactThreat = .85; this.updateTension(); clearTimeout(this.tensionTimer);
    this.tensionTimer = setTimeout(() => { this.impactThreat = 0; this.updateTension(); }, 4000);
  }
  updateDuck() {
    if (!this.context || !this.graph) return;
    const now = this.context.currentTime, target = this.menu ? .55 : 1;
    this.duckGain.gain.cancelScheduledValues(now); this.duckGain.gain.setTargetAtTime(target, now, .12);
  }
  duck() {
    const now = this.context.currentTime;
    this.duckGain.gain.cancelScheduledValues(now); this.duckGain.gain.setTargetAtTime(.45, now, .025);
    this.duckGain.gain.setTargetAtTime(this.menu ? .55 : 1, now + .3, .18);
  }
  voice({ frequency = 200, end = 100, duration = .2, delay = 0, type = "sine", volume = .1, noise = false, pan = 0, resonance = 1, wet = true }) {
    if (this.voices.size >= this.maxVoices) return;
    const ctx = this.prepare(), start = ctx.currentTime + delay;
    const source = noise ? ctx.createBufferSource() : ctx.createOscillator(), gain = ctx.createGain();
    const filter = ctx.createBiquadFilter(); filter.type = noise ? "bandpass" : "lowpass"; filter.Q.value = resonance;
    if (noise) { source.buffer = this.noise; source.loop = true; filter.frequency.setValueAtTime(frequency, start); filter.frequency.exponentialRampToValueAtTime(Math.max(30, end), start + duration); }
    else { source.type = type; source.frequency.setValueAtTime(frequency, start); source.frequency.exponentialRampToValueAtTime(Math.max(25, end), start + duration); filter.frequency.value = Math.min(8000, frequency * 5); }
    const panner = ctx.createStereoPanner?.(); if (panner) panner.pan.value = Math.max(-.7, Math.min(.7, pan));
    source.connect(filter); filter.connect(gain); gain.connect(panner || this.effectsGain);
    if (panner) panner.connect(this.effectsGain); if (wet) gain.connect(this.reverb);
    gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    this.voices.add(source); this.notesPlayed++;
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); panner?.disconnect(); this.voices.delete(source); source.onended = null; };
    if (noise) source.start(start, this.random() * .7); else source.start(start);
    source.stop(start + duration + .02);
  }
  play(kind, detail = {}) {
    if (!this.settings.enabled || this.paused || globalThis.document?.hidden || this.settings.effects === 0) return;
    const epoch = this.epoch, timestamp = performance.now();
    this.unlock().then((ready) => {
      if (ready && epoch === this.epoch && performance.now() - timestamp < 350 && !this.paused) this.renderFX(kind, detail);
    });
  }
  renderFX(kind, detail = {}) {
    this.prepare(); this.effectsCount++; this.history.push(kind); if (this.history.length > 24) this.history.shift();
    const pan = Number(detail.pan) || 0;
    if (kind === "weapon") {
      const [pitch, end, type, duration, weight] = weaponProfile(detail.weapon?.type);
      const blade = ["sword", "dagger"].includes(detail.weapon?.type);
      this.voice({ frequency: 1800 + pitch, end: 300, noise: true, duration: duration * .65, delay: blade ? .025 : 0, volume: .13, pan });
      if (detail.hit) {
        // Match the visual contact at 105 ms; engine damage remains immediate.
        this.voice({ frequency: pitch * .7, end, type, duration, delay: .105, volume: .22 * weight, pan });
        this.voice({ frequency: 650, end: 180, noise: true, duration: .09, delay: .105, volume: .12, pan });
        if (["sword", "axe", "dagger", "flail"].includes(detail.weapon?.type)) this.voice({ frequency: pitch * 1.4, end: pitch, duration: .28, delay: .105, volume: .07, pan });
      }
      this.combat(); this.duck();
    } else if (kind === "spell") {
      const p = spellProfile(detail.spell);
      for (let i = 0; i < p.pulses; i++) this.voice({ frequency: p.frequency * 2 ** (i * 3 / 12), end: p.frequency * p.endRatio, type: p.type, duration: p.duration, delay: i * p.interval, volume: .075, pan });
      if (["fire", "electric", "dark"].includes(p.family)) this.voice({ frequency: p.family === "electric" ? 3300 : 450, end: 90, duration: p.duration, noise: true, volume: .15, resonance: .7, pan });
      else this.voice({ frequency: p.frequency * 2.01, end: p.frequency * 2.01, duration: .6, delay: .08, volume: .035, pan });
      this.combat(); this.duck();
    } else if (kind === "hurt") {
      this.voice({ frequency: 110, end: 45, duration: .18, volume: .2 });
      this.voice({ frequency: 700, end: 120, duration: .1, volume: .12, noise: true }); this.combat(); this.duck();
    } else if (kind === "step") {
      const grass = detail.surface === "grass", ash = this.region === "volcano";
      const pitch = (grass ? 900 : ash ? 1700 : 2500) * (.94 + this.random() * .12);
      this.voice({ frequency: pitch, end: grass ? 350 : 700, noise: true, duration: grass ? .11 : .08, volume: .11, wet: !grass, pan: this.random() * .16 - .08 });
      if (!grass) this.voice({ frequency: ash ? 90 : 150, end: 65, duration: .07, volume: .085, wet: false });
    } else if (kind === "door" || kind === "chest") {
      this.voice({ frequency: 350, end: 100, noise: true, duration: .35, volume: .14 });
      this.voice({ frequency: 170, end: 55, type: "triangle", duration: .14, delay: .22, volume: .14 });
      if (detail.exploded) this.voice({ frequency: 800, end: 45, noise: true, duration: .5, volume: .25 });
    } else if (kind === "potion") {
      for (let i = 0; i < 3; i++) this.voice({ frequency: 260 + i * 90, end: 110, duration: .075, delay: i * .09, volume: .09 });
      this.voice({ frequency: 1800, end: 800, duration: .15, noise: true, volume: .04 });
    } else if (kind === "read" || kind === "loot") {
      this.voice({ frequency: kind === "read" ? 2400 : 850, end: 400, noise: true, duration: .18, volume: .085 });
      if (kind === "loot") this.voice({ frequency: 660, end: 600, duration: .18, volume: .035 });
    } else if (kind === "coins") {
      for (let i = 0; i < 3; i++) this.voice({ frequency: 1500 + i * 310, end: 1300 + i * 300, duration: .13, delay: i * .025, volume: .045 });
    } else if (kind === "stairs") {
      this.voice({ frequency: 140, end: 65, noise: true, duration: .28, volume: .15 });
      this.voice({ frequency: detail.down ? 220 : 165, end: detail.down ? 110 : 330, duration: .65, delay: .1, volume: .05 });
    } else if (kind === "victory" || kind === "death") {
      this.stopMusic(); const notes = kind === "victory" ? [64, 67, 71, 76] : [52, 51, 47, 40];
      notes.forEach((note, i) => this.voice({ frequency: 440 * 2 ** ((note - 69) / 12), end: 440 * 2 ** ((note - 69) / 12), duration: 1.8, delay: i * .2, type: kind === "death" ? "triangle" : "sine", volume: .1 }));
    } else {
      this.voice({ frequency: 1200, end: 700, noise: true, duration: .045, volume: .045, wet: false });
      this.voice({ frequency: 330, end: 440, duration: .08, volume: .025, wet: false });
    }
  }
  async suspend() {
    this.paused = true; this.epoch++; clearTimeout(this.tensionTimer); this.impactThreat = 0;
    for (const source of [...this.voices]) { try { source.stop(); } catch {} source.onended?.(); }
    if (this.reverb && this.context?.state !== "closed") {
      const impulse = this.reverb.buffer; this.reverb.disconnect();
      this.reverb = this.context.createConvolver(); this.reverb.buffer = impulse; this.reverb.connect(this.wet);
    }
    this.stopMusic(); this.status = this.settings.enabled ? "suspended" : "muted"; this.notify();
    if (this.context && this.context.state !== "closed") try { await this.context.suspend(); } catch {}
  }
  resume() { this.paused = false; this.musicLoadError = false; this.error = ""; return this.unlock(); }
  metrics() {
    return { enabled: this.settings.enabled, musicVolume: this.settings.music, effectsVolume: this.settings.effects,
      contextState: this.context?.state || "not-started", status: this.status, error: this.error, track: SCORE[this.activeTrack?.region || this.region].title,
      playingRegion: this.activeTrack?.region || null,
      region: this.region, effectVoices: this.voices.size, maxVoices: this.maxVoices, musicSources: this.musicSources.size,
      cachedTracks: this.cache.size, threat: Math.max(this.threat, this.impactThreat), effectsPlayed: this.effectsCount, lastEffect: this.history.at(-1) || null };
  }
  async dispose() {
    await this.suspend();
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.cache.clear(); this.context = null; this.graph = null;
  }
}
